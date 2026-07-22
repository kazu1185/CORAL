<?php

namespace App\Controllers;

use App\Controllers\Concerns\OptimisticLock;
use App\Core\Database;
use App\Core\Request;
use App\Core\Response;
use PDO;

/**
 * チェックイン・チェックアウトコントローラー
 */
class CheckinController
{
    use OptimisticLock;

    /** POST /api/v1/reservations/:id/checkin */
    public function checkin(Request $request): void
    {
        $db = Database::getInstance();
        $id = (int) $request->params['id'];
        $staffId = $request->auth['staff_id'];

        // 楽観ロック: 他スタッフによる同時操作を検出
        $this->checkOptimisticLock($id, $request->body['updated_at'] ?? null);

        // 予約取得
        $stmt = $db->prepare("SELECT id, status, guest_id FROM reservations WHERE id = :id");
        $stmt->execute(['id' => $id]);
        $reservation = $stmt->fetch();

        if (!$reservation) {
            Response::error('予約が見つかりません', 404);
        }

        if ($reservation['status'] !== 'confirmed') {
            Response::error('この予約はチェックインできません（ステータス: ' . $reservation['status'] . '）', 422);
        }

        // アサイン存在チェック
        $stmt = $db->prepare("
            SELECT COUNT(*) FROM room_assignments
            WHERE reservation_id = :id AND status = 'active'
        ");
        $stmt->execute(['id' => $id]);
        if ((int) $stmt->fetchColumn() === 0) {
            Response::error('部屋がアサインされていません', 422);
        }

        $paymentMethod = $request->body['payment_method'] ?? null;

        // 予約ステータス更新
        $stmt = $db->prepare("
            UPDATE reservations
            SET status = 'checked_in',
                actual_checkin_at = NOW(),
                payment_method = COALESCE(:pm, payment_method),
                updated_at = NOW(),
                updated_by = :staff_id
            WHERE id = :id
        ");
        $stmt->execute([
            'pm'       => $paymentMethod,
            'staff_id' => $staffId,
            'id'       => $id,
        ]);

        // 操作ログ
        $this->logActivity($db, $staffId, 'checkin', 'reservation', $id);

        // 予約イベント履歴に記録
        $this->recordEvent($db, $id, 'checkin', 'チェックイン', null, $staffId);

        Response::json(['message' => 'チェックインしました', 'reservation_id' => $id]);
    }

    /** POST /api/v1/reservations/:id/checkout */
    public function checkout(Request $request): void
    {
        $db = Database::getInstance();
        $id = (int) $request->params['id'];
        $staffId = $request->auth['staff_id'];

        // 楽観ロック: 他スタッフによる同時操作を検出
        $this->checkOptimisticLock($id, $request->body['updated_at'] ?? null);

        // 予約取得
        $stmt = $db->prepare("
            SELECT r.id, r.status, r.guest_id, r.checkout_date, r.checkin_date,
                   r.nights, r.amount, r.channel, r.corporate_id, r.parent_reservation_id
            FROM reservations r WHERE r.id = :id
        ");
        $stmt->execute(['id' => $id]);
        $reservation = $stmt->fetch();

        if (!$reservation) {
            Response::error('予約が見つかりません', 404);
        }

        if ($reservation['status'] !== 'checked_in') {
            Response::error('この予約はチェックアウトできません（ステータス: ' . $reservation['status'] . '）', 422);
        }

        $body = $request->body;
        $today = date('Y-m-d');
        $isEarly = $today < $reservation['checkout_date'];

        $db->beginTransaction();
        try {
            // ステータス更新
            $stmt = $db->prepare("
                UPDATE reservations
                SET status = 'checked_out',
                    actual_checkout_at = NOW(),
                    updated_at = NOW(),
                    updated_by = :staff_id
                WHERE id = :id
            ");
            $stmt->execute(['staff_id' => $staffId, 'id' => $id]);

            // 途中退室: 未宿泊分の処理
            if ($isEarly && !empty($body['early_checkout_charges'])) {
                foreach ($body['early_checkout_charges'] as $charge) {
                    $handling = $charge['handling'] ?? 'waived';
                    $chargeDate = $charge['date'] ?? $today;

                    if ($handling === 'cancel_fee') {
                        // 既存のroom chargeのステータスをcancel_feeに変更
                        $stmt = $db->prepare("
                            UPDATE reservation_charges
                            SET charge_type = 'cancel_fee',
                                description = CONCAT('キャンセル料（', description, '）'),
                                updated_at = NOW()
                            WHERE reservation_id = :rid AND date = :d AND charge_type = 'room'
                        ");
                        $stmt->execute(['rid' => $id, 'd' => $chargeDate]);
                    } elseif ($handling === 'waived') {
                        $stmt = $db->prepare("
                            UPDATE reservation_charges
                            SET status = 'waived', updated_at = NOW()
                            WHERE reservation_id = :rid AND date = :d AND charge_type = 'room'
                        ");
                        $stmt->execute(['rid' => $id, 'd' => $chargeDate]);
                    }
                    // refund は別途入金処理が必要なのでここでは省略
                }
            }

            // アサインをreleasedに
            $stmt = $db->prepare("
                UPDATE room_assignments
                SET status = 'released', updated_at = NOW(), updated_by = :staff_id
                WHERE reservation_id = :id AND status = 'active'
            ");
            $stmt->execute(['staff_id' => $staffId, 'id' => $id]);

            // 清掃ステータス更新（該当部屋を要清掃に）
            $stmt = $db->prepare("
                SELECT room_id FROM room_assignments WHERE reservation_id = :id
            ");
            $stmt->execute(['id' => $id]);
            $roomIds = $stmt->fetchAll(PDO::FETCH_COLUMN);

            foreach ($roomIds as $roomId) {
                $stmt = $db->prepare("
                    INSERT INTO housekeeping_status (room_id, date, status)
                    VALUES (:room_id, :date, 'needs_cleaning')
                    ON DUPLICATE KEY UPDATE status = 'needs_cleaning', updated_at = NOW()
                ");
                $stmt->execute(['room_id' => $roomId, 'date' => $today]);
            }

            // ゲストのvisit_count更新
            // グループ（複数室）の子予約は「1滞在=1回」のため、兄弟が既にCO済みなら加算しない（検証報告 #7）
            if ($reservation['guest_id'] && $this->shouldCountVisit($db, $reservation)) {
                $stmt = $db->prepare("
                    UPDATE guests
                    SET visit_count = visit_count + 1,
                        last_stay_date = :date,
                        updated_at = NOW()
                    WHERE id = :gid
                ");
                $stmt->execute(['date' => $today, 'gid' => $reservation['guest_id']]);
            }

            // 売上計上
            $stmt = $db->prepare("
                INSERT INTO revenue_postings (reservation_id, corporate_id, posting_date, channel, total_amount)
                VALUES (:rid, :cid, :date, :ch, :amount)
            ");
            $stmt->execute([
                'rid'    => $id,
                'cid'    => $reservation['corporate_id'],
                'date'   => $today,
                'ch'     => $reservation['channel'],
                'amount' => $reservation['amount'],
            ]);

            $db->commit();
        } catch (\Exception $e) {
            $db->rollBack();
            Response::error('チェックアウト処理に失敗しました: ' . $e->getMessage(), 500);
        }

        // 操作ログ
        $this->logActivity($db, $staffId, 'checkout', 'reservation', $id);

        // 予約イベント履歴に記録
        $this->recordEvent($db, $id, 'checkout', 'チェックアウト', null, $staffId);

        Response::json(['message' => 'チェックアウトしました', 'reservation_id' => $id]);
    }

    /**
     * グループ一括チェックイン
     * POST /api/v1/reservations/:id/group-checkin
     *
     * 親予約（group_parent）のIDを受け取り、子予約のうち
     * confirmed + アサイン済みのものを一括CIする。
     */
    public function groupCheckin(Request $request): void
    {
        $db = Database::getInstance();
        $parentId = (int) $request->params['id'];
        $staffId = $request->auth['staff_id'];

        // 楽観ロック: 他スタッフによる同時操作を検出（単体CI/COと同じ保護。検証報告 #6）
        $this->checkOptimisticLock($parentId, $request->body['updated_at'] ?? null);

        // 親予約の確認
        $stmt = $db->prepare("SELECT id, status, room_count FROM reservations WHERE id = :id");
        $stmt->execute(['id' => $parentId]);
        $parent = $stmt->fetch();

        if (!$parent || $parent['status'] !== 'group_parent') {
            Response::error('グループ親予約が見つかりません', 404);
        }

        // 選択式一括CI: reservation_idsが指定されていれば対象を絞る
        $selectedIds = $request->body['reservation_ids'] ?? null;

        // CI対象の子予約を取得（confirmed + アサイン済み）
        $sql = "
            SELECT r.id, r.status, r.guest_id
            FROM reservations r
            WHERE r.parent_reservation_id = :parent_id
              AND r.status = 'confirmed'
              AND EXISTS (
                  SELECT 1 FROM room_assignments ra
                  WHERE ra.reservation_id = r.id AND ra.status = 'active'
              )
            ORDER BY r.room_index
        ";
        $stmt = $db->prepare($sql);
        $stmt->execute(['parent_id' => $parentId]);
        $targets = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // 選択された子予約のみにフィルタ
        if (!empty($selectedIds) && is_array($selectedIds)) {
            $targets = array_filter($targets, fn($t) => in_array($t['id'], $selectedIds));
            $targets = array_values($targets);
        }

        if (empty($targets)) {
            Response::error('チェックイン可能な子予約がありません（未アサインまたは全てCI済み）', 422);
        }

        $paymentMethod = $request->body['payment_method'] ?? null;

        $db->beginTransaction();
        try {
            $checkedIn = [];
            foreach ($targets as $child) {
                // 子予約をCI
                $stmt = $db->prepare("
                    UPDATE reservations
                    SET status = 'checked_in',
                        actual_checkin_at = NOW(),
                        payment_method = COALESCE(:pm, payment_method),
                        updated_at = NOW(),
                        updated_by = :staff_id
                    WHERE id = :id
                ");
                $stmt->execute([
                    'pm'       => $paymentMethod,
                    'staff_id' => $staffId,
                    'id'       => $child['id'],
                ]);

                $this->recordEvent($db, (int)$child['id'], 'checkin', 'グループ一括チェックイン', null, $staffId);
                $checkedIn[] = $child['id'];
            }

            $db->commit();
        } catch (\Exception $e) {
            $db->rollBack();
            Response::error('グループチェックインに失敗しました: ' . $e->getMessage(), 500);
        }

        // 操作ログ（親IDで記録）
        $this->logActivity($db, $staffId, 'group_checkin', 'reservation', $parentId);

        Response::json([
            'message' => count($checkedIn) . '室をチェックインしました',
            'checked_in_ids' => $checkedIn,
        ]);
    }

    /**
     * グループ一括チェックアウト
     * POST /api/v1/reservations/:id/group-checkout
     *
     * 親予約（group_parent）のIDを受け取り、子予約のうち
     * checked_inのものを一括COする。
     */
    public function groupCheckout(Request $request): void
    {
        $db = Database::getInstance();
        $parentId = (int) $request->params['id'];
        $staffId = $request->auth['staff_id'];

        // 楽観ロック: 他スタッフによる同時操作を検出（単体CI/COと同じ保護。検証報告 #6）
        $this->checkOptimisticLock($parentId, $request->body['updated_at'] ?? null);

        // 親予約の確認
        $stmt = $db->prepare("SELECT id, status, room_count FROM reservations WHERE id = :id");
        $stmt->execute(['id' => $parentId]);
        $parent = $stmt->fetch();

        if (!$parent || $parent['status'] !== 'group_parent') {
            Response::error('グループ親予約が見つかりません', 404);
        }

        // 選択式一括CO: reservation_idsが指定されていれば対象を絞る
        $selectedIds = $request->body['reservation_ids'] ?? null;

        // CO対象の子予約を取得
        $stmt = $db->prepare("
            SELECT r.id, r.status, r.guest_id, r.checkout_date, r.checkin_date,
                   r.nights, r.amount, r.channel, r.corporate_id
            FROM reservations r
            WHERE r.parent_reservation_id = :parent_id
              AND r.status = 'checked_in'
            ORDER BY r.room_index
        ");
        $stmt->execute(['parent_id' => $parentId]);
        $targets = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // 選択された子予約のみにフィルタ
        if (!empty($selectedIds) && is_array($selectedIds)) {
            $targets = array_filter($targets, fn($t) => in_array($t['id'], $selectedIds));
            $targets = array_values($targets);
        }

        if (empty($targets)) {
            Response::error('チェックアウト可能な子予約がありません', 422);
        }

        $today = date('Y-m-d');

        // visit_count加算判定はステータス更新の前に行う必要がある（更新後だと自分たちがCO済みに見えるため）
        // 既にCO済みの兄弟がいる = この滞在は加算済み → 今回は加算しない（検証報告 #7: 部分COの多重加算防止）
        $alreadyStmt = $db->prepare("
            SELECT COUNT(*) FROM reservations
            WHERE parent_reservation_id = :pid AND status = 'checked_out'
        ");
        $alreadyStmt->execute(['pid' => $parentId]);
        $groupAlreadyCounted = (int) $alreadyStmt->fetchColumn() > 0;

        $db->beginTransaction();
        try {
            $checkedOut = [];
            foreach ($targets as $child) {
                // ステータス更新
                $stmt = $db->prepare("
                    UPDATE reservations
                    SET status = 'checked_out',
                        actual_checkout_at = NOW(),
                        updated_at = NOW(),
                        updated_by = :staff_id
                    WHERE id = :id
                ");
                $stmt->execute(['staff_id' => $staffId, 'id' => $child['id']]);

                // アサインをreleasedに
                $stmt = $db->prepare("
                    UPDATE room_assignments
                    SET status = 'released', updated_at = NOW(), updated_by = :staff_id
                    WHERE reservation_id = :id AND status = 'active'
                ");
                $stmt->execute(['staff_id' => $staffId, 'id' => $child['id']]);

                // 清掃ステータス更新
                $stmt = $db->prepare("
                    SELECT room_id FROM room_assignments WHERE reservation_id = :id
                ");
                $stmt->execute(['id' => $child['id']]);
                $roomIds = $stmt->fetchAll(PDO::FETCH_COLUMN);
                foreach ($roomIds as $roomId) {
                    $db->prepare("
                        INSERT INTO housekeeping_status (room_id, date, status)
                        VALUES (:room_id, :date, 'needs_cleaning')
                        ON DUPLICATE KEY UPDATE status = 'needs_cleaning', updated_at = NOW()
                    ")->execute(['room_id' => $roomId, 'date' => $today]);
                }

                // ゲストのvisit_count更新（同一ゲストの重複加算を防ぐため子1件目のみ）
                // → グループは同一ゲストなので最後にまとめて1回だけ加算する
                // ここでは加算しない（ループ後で1回だけ）

                // 売上計上
                $db->prepare("
                    INSERT INTO revenue_postings (reservation_id, corporate_id, posting_date, channel, total_amount)
                    VALUES (:rid, :cid, :date, :ch, :amount)
                ")->execute([
                    'rid'    => $child['id'],
                    'cid'    => $child['corporate_id'],
                    'date'   => $today,
                    'ch'     => $child['channel'],
                    'amount' => $child['amount'],
                ]);

                $this->recordEvent($db, (int)$child['id'], 'checkout', 'グループ一括チェックアウト', null, $staffId);
                $checkedOut[] = $child['id'];
            }

            // ゲストのvisit_countは1グループ滞在につき1回だけ加算
            // （同一ゲストが複数子予約に紐づいているため。部分COの2回目以降は加算しない）
            $guestId = $targets[0]['guest_id'] ?? null;
            if ($guestId && !$groupAlreadyCounted) {
                $db->prepare("
                    UPDATE guests
                    SET visit_count = visit_count + 1,
                        last_stay_date = :date,
                        updated_at = NOW()
                    WHERE id = :gid
                ")->execute(['date' => $today, 'gid' => $guestId]);
            }

            $db->commit();
        } catch (\Exception $e) {
            $db->rollBack();
            Response::error('グループチェックアウトに失敗しました: ' . $e->getMessage(), 500);
        }

        $this->logActivity($db, $staffId, 'group_checkout', 'reservation', $parentId);

        Response::json([
            'message' => count($checkedOut) . '室をチェックアウトしました',
            'checked_out_ids' => $checkedOut,
        ]);
    }

    /**
     * visit_count（来館回数）を加算してよいか判定
     * グループ（複数室）予約は「1滞在=1回」とするため、
     * 兄弟予約のいずれかが既にCO済みなら加算済みとみなしてスキップする（検証報告 #7）
     */
    private function shouldCountVisit(PDO $db, array $reservation): bool
    {
        if (empty($reservation['parent_reservation_id'])) {
            return true; // 単独予約は常に加算
        }
        $stmt = $db->prepare("
            SELECT COUNT(*) FROM reservations
            WHERE parent_reservation_id = :pid AND id != :self AND status = 'checked_out'
        ");
        $stmt->execute([
            'pid'  => $reservation['parent_reservation_id'],
            'self' => $reservation['id'],
        ]);
        return (int) $stmt->fetchColumn() === 0;
    }

    private function logActivity(PDO $db, int $staffId, string $action, ?string $targetType = null, ?int $targetId = null): void
    {
        $db->prepare("
            INSERT INTO staff_activity_logs (staff_id, action, target_type, target_id)
            VALUES (:staff_id, :action, :target_type, :target_id)
        ")->execute([
            'staff_id'    => $staffId,
            'action'      => $action,
            'target_type' => $targetType,
            'target_id'   => $targetId,
        ]);
    }

    /**
     * 予約イベント履歴を記録
     * 予約詳細のタイムライン表示に使用
     */
    private function recordEvent(PDO $db, int $reservationId, string $type, string $summary, ?string $detail = null, ?int $staffId = null): void
    {
        $db->prepare("
            INSERT INTO reservation_events (reservation_id, event_type, event_at, summary, detail, staff_id)
            VALUES (:reservation_id, :event_type, NOW(), :summary, :detail, :staff_id)
        ")->execute([
            'reservation_id' => $reservationId,
            'event_type'     => $type,
            'summary'        => $summary,
            'detail'         => $detail,
            'staff_id'       => $staffId,
        ]);
    }

}
