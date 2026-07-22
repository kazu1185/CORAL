<?php

namespace App\Controllers;

use App\Core\Database;
use App\Core\Request;
use App\Core\Response;
use PDO;

/**
 * アサインコントローラー
 *
 * CI前: 自由に変更可能。releasedは残さず上書き/物理削除
 * CI後: アサインボードからの操作はブロック。予約詳細画面からのみ部屋移動可能
 */
class AssignController
{
    /** GET /api/v1/assigns */
    public function index(Request $request): void
    {
        $db = Database::getInstance();
        $from = $request->query['from'] ?? date('Y-m-01');
        $to   = $request->query['to']   ?? date('Y-m-t');

        $rooms = $db->query("
            SELECT r.id, r.room_number, r.floor, r.status AS room_status,
                   rt.type_code, rt.type_name, rt.max_adults, rt.max_occupancy
            FROM rooms r
            JOIN room_types rt ON rt.id = r.room_type_id
            ORDER BY r.floor, r.room_number
        ")->fetchAll();

        $stmt = $db->prepare("
            SELECT ra.id, ra.reservation_id, ra.room_id, ra.check_in_date, ra.check_out_date, ra.status,
                   res.channel, res.reservation_no, res.status AS res_status,
                   res.adult_count, res.child_count, res.room_type, res.nights, res.amount,
                   COALESCE(g.name_kanji, g.name_kana, g.name_romaji,
                            TRIM(CONCAT(res.tl_last_name, ' ', res.tl_first_name))) AS guest_name,
                   COALESCE(g.is_vip, 0) AS is_vip,
                   CASE WHEN gl.id IS NOT NULL THEN 1 ELSE 0 END AS has_link,
                   gl.group_id AS link_group_id,
                   gl.sequence AS link_sequence
            FROM room_assignments ra
            JOIN reservations res ON res.id = ra.reservation_id
            LEFT JOIN guests g ON g.id = res.guest_id
            LEFT JOIN guest_links gl ON gl.reservation_id = res.id AND gl.status = 'active'
            WHERE ra.check_in_date < :to1
              AND ra.check_out_date > :from1
            ORDER BY ra.check_in_date
        ");
        $stmt->execute(['to1' => $to, 'from1' => $from]);
        $assigns = $stmt->fetchAll();

        foreach ($assigns as &$a) {
            $a['id'] = (int) $a['id'];
            $a['reservation_id'] = (int) $a['reservation_id'];
            $a['room_id'] = (int) $a['room_id'];
            $a['adult_count'] = (int) $a['adult_count'];
            $a['child_count'] = (int) $a['child_count'];
            $a['nights'] = (int) $a['nights'];
            $a['amount'] = (int) $a['amount'];
            $a['is_vip'] = (bool) $a['is_vip'];
            $a['has_link'] = (bool) $a['has_link'];
            $a['link_sequence'] = $a['link_sequence'] !== null ? (int) $a['link_sequence'] : null;
        }
        unset($a);

        // 未アサイン予約
        $stmt = $db->prepare("
            SELECT res.id, res.checkin_date, res.checkout_date, res.nights,
                   res.channel, res.reservation_no, res.room_type, res.status,
                   res.adult_count, res.child_count, res.amount,
                   COALESCE(g.name_kanji, g.name_kana, g.name_romaji,
                            TRIM(CONCAT(res.tl_last_name, ' ', res.tl_first_name))) AS guest_name,
                   rt.type_name AS room_type_name
            FROM reservations res
            LEFT JOIN guests g ON g.id = res.guest_id
            LEFT JOIN room_types rt ON rt.type_code = res.room_type
            WHERE res.status IN ('confirmed', 'checked_in')
              AND res.checkin_date < :to2
              AND res.checkout_date > :from2
              AND res.status != 'group_parent'
              AND NOT EXISTS (
                  SELECT 1 FROM room_assignments ra
                  WHERE ra.reservation_id = res.id AND ra.status = 'active'
              )
            ORDER BY res.checkin_date
        ");
        $stmt->execute(['to2' => $to, 'from2' => $from]);
        $unassigned = $stmt->fetchAll();

        foreach ($unassigned as &$u) {
            $u['id'] = (int) $u['id'];
            $u['nights'] = (int) $u['nights'];
            $u['adult_count'] = (int) $u['adult_count'];
            $u['child_count'] = (int) $u['child_count'];
            $u['amount'] = (int) $u['amount'];
        }
        unset($u);

        Response::json([
            'rooms'      => $rooms,
            'assigns'    => $assigns,
            'unassigned' => $unassigned,
            'period'     => ['from' => $from, 'to' => $to],
        ]);
    }

    /** POST /api/v1/assigns — 新規アサイン */
    public function store(Request $request): void
    {
        $db = Database::getInstance();
        $body = $request->body;
        $staffId = $request->auth['staff_id'];

        $reservationId = (int) ($body['reservation_id'] ?? 0);
        $roomId        = (int) ($body['room_id'] ?? 0);
        $ciDate        = $body['check_in_date'] ?? null;
        $coDate        = $body['check_out_date'] ?? null;

        if (!$reservationId || !$roomId || !$ciDate || !$coDate) {
            Response::error('reservation_id, room_id, check_in_date, check_out_date は必須です', 400);
        }

        // CI済みチェック
        if ($this->isCheckedIn($db, $reservationId)) {
            Response::error('チェックイン済みの予約はアサインボードから操作できません', 403);
        }

        $warnings = $this->checkWarnings($db, $reservationId, $roomId);

        // 重複チェック
        $stmt = $db->prepare("
            SELECT COUNT(*) FROM room_assignments
            WHERE room_id = :rid AND status = 'active'
              AND check_in_date < :co AND check_out_date > :ci
        ");
        $stmt->execute(['rid' => $roomId, 'co' => $coDate, 'ci' => $ciDate]);
        if ((int) $stmt->fetchColumn() > 0) {
            Response::error('この期間に既にアサインがあります', 409);
        }

        $stmt = $db->prepare("
            INSERT INTO room_assignments (reservation_id, room_id, check_in_date, check_out_date, status, updated_by)
            VALUES (:res_id, :room_id, :ci, :co, 'active', :staff_id)
        ");
        $stmt->execute([
            'res_id'   => $reservationId,
            'room_id'  => $roomId,
            'ci'       => $ciDate,
            'co'       => $coDate,
            'staff_id' => $staffId,
        ]);

        $assignId = (int) $db->lastInsertId();
        $this->logActivity($db, $staffId, 'assign_create', 'room_assignment', $assignId);

        Response::json([
            'message'  => 'アサインを作成しました',
            'id'       => $assignId,
            'warnings' => $warnings,
        ], 201);
    }

    /** PUT /api/v1/assigns/:id — 日程変更（延泊/短縮） */
    public function update(Request $request): void
    {
        $db = Database::getInstance();
        $id = (int) $request->params['id'];
        $body = $request->body;
        $staffId = $request->auth['staff_id'];

        $assign = $this->getAssign($db, $id);
        if (!$assign) {
            Response::error('アサインが見つかりません', 404);
        }

        // CI済みチェック
        if ($this->isCheckedIn($db, (int) $assign['reservation_id'])) {
            Response::error('チェックイン済みの予約はアサインボードから操作できません', 403);
        }

        $resId = (int) $assign['reservation_id'];
        $ciDate = $body['check_in_date'] ?? $assign['check_in_date'];
        $coDate = $body['check_out_date'] ?? $assign['check_out_date'];
        $oldCoDate = $assign['check_out_date'];

        $stmt = $db->prepare("
            SELECT COUNT(*) FROM room_assignments
            WHERE room_id = :rid AND status = 'active' AND id != :self_id
              AND check_in_date < :co AND check_out_date > :ci
        ");
        $stmt->execute(['rid' => $assign['room_id'], 'self_id' => $id, 'co' => $coDate, 'ci' => $ciDate]);
        if ((int) $stmt->fetchColumn() > 0) {
            Response::error('この期間に既にアサインがあります', 409);
        }

        $db->beginTransaction();
        try {
            // アサイン日程更新
            $db->prepare("
                UPDATE room_assignments
                SET check_in_date = :ci, check_out_date = :co, updated_at = NOW(), updated_by = :staff_id
                WHERE id = :id
            ")->execute(['ci' => $ciDate, 'co' => $coDate, 'staff_id' => $staffId, 'id' => $id]);

            // 延泊の場合のみ: 予約CO日・泊数を連動更新 + 売上明細自動生成
            // 短縮の場合: アサインの日程だけ変更。予約データ・明細には触らない
            //   → 途中退室の明細処理（cancel_fee / waived）は予約詳細のCO処理で行う
            if ($coDate > $oldCoDate) {
                $newNights = (int) ((strtotime($coDate) - strtotime($ciDate)) / 86400);
                $db->prepare("
                    UPDATE reservations
                    SET checkout_date = :co, nights = :nights, updated_at = NOW(), updated_by = :staff_id
                    WHERE id = :res_id
                ")->execute(['co' => $coDate, 'nights' => $newNights, 'staff_id' => $staffId, 'res_id' => $resId]);

                // 追加泊分の売上明細を自動生成（金額0 = 料金未設定）
                $d = new \DateTime($oldCoDate);
                $end = new \DateTime($coDate);
                while ($d < $end) {
                    $dateStr = $d->format('Y-m-d');
                    $stmt = $db->prepare("
                        SELECT COUNT(*) FROM reservation_charges
                        WHERE reservation_id = :rid AND date = :d AND charge_type = 'room'
                    ");
                    $stmt->execute(['rid' => $resId, 'd' => $dateStr]);
                    if ((int) $stmt->fetchColumn() === 0) {
                        $db->prepare("
                            INSERT INTO reservation_charges (reservation_id, date, charge_type, description, amount, tax_amount, accommodation_tax, status)
                            VALUES (:rid, :d, 'room', '延泊（料金未設定）', 0, 0, 0, 'active')
                        ")->execute(['rid' => $resId, 'd' => $dateStr]);
                    }
                    $d->modify('+1 day');
                }
            }

            $db->commit();
        } catch (\Exception $e) {
            $db->rollBack();
            Response::error('日程変更に失敗しました: ' . $e->getMessage(), 500);
        }

        $this->logActivity($db, $staffId, 'assign_update', 'room_assignment', $id);

        Response::json(['message' => 'アサインを更新しました']);
    }

    /** DELETE /api/v1/assigns/:id — アサイン解除（CI前のみ。物理削除） */
    public function destroy(Request $request): void
    {
        $db = Database::getInstance();
        $id = (int) $request->params['id'];
        $staffId = $request->auth['staff_id'];

        $assign = $this->getAssign($db, $id);
        if (!$assign) {
            Response::error('アサインが見つかりません', 404);
        }

        // CI済みチェック
        if ($this->isCheckedIn($db, (int) $assign['reservation_id'])) {
            Response::error('チェックイン済みの予約はアサインボードから操作できません', 403);
        }

        // CI前なので物理削除（履歴不要）
        $db->prepare("DELETE FROM room_assignments WHERE id = :id")->execute(['id' => $id]);

        $this->logActivity($db, $staffId, 'assign_delete', 'room_assignment', $id);

        Response::json(['message' => 'アサインを解除しました']);
    }

    /** POST /api/v1/assigns/:id/move — 部屋移動（CI前: 上書き / CI後: ブロック） */
    public function moveRoom(Request $request): void
    {
        $db = Database::getInstance();
        $id = (int) $request->params['id'];
        $newRoomId = (int) ($request->body['new_room_id'] ?? 0);
        $staffId = $request->auth['staff_id'];
        // source: 'detail' なら予約詳細画面からの呼び出し（CI後の部屋移動を許可）
        $source = $request->body['source'] ?? 'board';

        if (!$newRoomId) {
            Response::error('new_room_id は必須です', 400);
        }

        $assign = $this->getAssign($db, $id);
        if (!$assign) {
            Response::error('アサインが見つかりません', 404);
        }

        $isCI = $this->isCheckedIn($db, (int) $assign['reservation_id']);

        // CI済み + アサインボードからの操作 → ブロック
        if ($isCI && $source !== 'detail') {
            Response::error('チェックイン済みの予約はアサインボードから移動できません。予約詳細画面から操作してください', 403);
        }

        // 移動先の重複チェック
        $stmt = $db->prepare("
            SELECT COUNT(*) FROM room_assignments
            WHERE room_id = :rid AND status = 'active'
              AND check_in_date < :co AND check_out_date > :ci
        ");
        $stmt->execute(['rid' => $newRoomId, 'co' => $assign['check_out_date'], 'ci' => $assign['check_in_date']]);
        if ((int) $stmt->fetchColumn() > 0) {
            Response::error('移動先の部屋に既にアサインがあります', 409);
        }

        $db->beginTransaction();
        try {
            if ($isCI) {
                // CI後: released履歴を残す（実際の部屋移動記録）
                $db->prepare("UPDATE room_assignments SET status = 'released', updated_at = NOW(), updated_by = :sid WHERE id = :id")
                   ->execute(['sid' => $staffId, 'id' => $id]);
            } else {
                // CI前: 物理削除（作業過程なので履歴不要）
                $db->prepare("DELETE FROM room_assignments WHERE id = :id")->execute(['id' => $id]);
            }

            // 新アサイン作成
            $db->prepare("
                INSERT INTO room_assignments (reservation_id, room_id, check_in_date, check_out_date, status, updated_by)
                VALUES (:res_id, :room_id, :ci, :co, 'active', :sid)
            ")->execute([
                'res_id'  => $assign['reservation_id'],
                'room_id' => $newRoomId,
                'ci'      => $assign['check_in_date'],
                'co'      => $assign['check_out_date'],
                'sid'     => $staffId,
            ]);

            $db->commit();
        } catch (\Exception $e) {
            $db->rollBack();
            Response::error('部屋移動に失敗しました', 500);
        }

        $newId = (int) $db->lastInsertId();
        $this->logActivity($db, $staffId, $isCI ? 'room_move' : 'assign_move', 'room_assignment', $newId);

        // 予約イベント履歴: 部屋移動の記録（旧部屋→新部屋）
        $oldRoom = $db->prepare("SELECT room_number FROM rooms WHERE id = :id");
        $oldRoom->execute(['id' => $assign['room_id']]);
        $oldRoomNum = $oldRoom->fetchColumn() ?: '?';
        $newRoom = $db->prepare("SELECT room_number FROM rooms WHERE id = :id");
        $newRoom->execute(['id' => $newRoomId]);
        $newRoomNum = $newRoom->fetchColumn() ?: '?';
        $this->recordEvent($db, (int)$assign['reservation_id'], 'room_move',
            '部屋移動', "{$oldRoomNum}号室 → {$newRoomNum}号室", $staffId);

        Response::json(['message' => '部屋を移動しました', 'new_assign_id' => $newId]);
    }

    /** POST /api/v1/assigns/:id/split — 途中移動（CI後のみ。予約詳細画面から） */
    public function splitMove(Request $request): void
    {
        $db = Database::getInstance();
        $id = (int) $request->params['id'];
        $body = $request->body;
        $staffId = $request->auth['staff_id'];

        $splitDate = $body['split_date'] ?? null;
        $newRoomId = (int) ($body['new_room_id'] ?? 0);

        if (!$splitDate || !$newRoomId) {
            Response::error('split_date と new_room_id は必須です', 400);
        }

        $assign = $this->getAssign($db, $id);
        if (!$assign) {
            Response::error('アサインが見つかりません', 404);
        }

        if ($splitDate <= $assign['check_in_date'] || $splitDate >= $assign['check_out_date']) {
            Response::error('split_date はアサイン期間内である必要があります', 400);
        }

        // 移動先の重複チェック
        $stmt = $db->prepare("
            SELECT COUNT(*) FROM room_assignments
            WHERE room_id = :rid AND status = 'active'
              AND check_in_date < :co AND check_out_date > :ci
        ");
        $stmt->execute(['rid' => $newRoomId, 'co' => $assign['check_out_date'], 'ci' => $splitDate]);
        if ((int) $stmt->fetchColumn() > 0) {
            Response::error('移動先の部屋に既にアサインがあります', 409);
        }

        $db->beginTransaction();
        try {
            // 元アサインのCO日をsplit_dateに短縮
            $db->prepare("
                UPDATE room_assignments SET check_out_date = :split, updated_at = NOW(), updated_by = :sid WHERE id = :id
            ")->execute(['split' => $splitDate, 'sid' => $staffId, 'id' => $id]);

            // 新部屋にsplit_date〜元CO日のアサイン作成
            $db->prepare("
                INSERT INTO room_assignments (reservation_id, room_id, check_in_date, check_out_date, status, updated_by)
                VALUES (:res_id, :room_id, :ci, :co, 'active', :sid)
            ")->execute([
                'res_id'  => $assign['reservation_id'],
                'room_id' => $newRoomId,
                'ci'      => $splitDate,
                'co'      => $assign['check_out_date'],
                'sid'     => $staffId,
            ]);

            $db->commit();
        } catch (\Exception $e) {
            $db->rollBack();
            Response::error('途中移動に失敗しました', 500);
        }

        $newId = (int) $db->lastInsertId();
        $this->logActivity($db, $staffId, 'room_split_move', 'room_assignment', $newId);

        Response::json(['message' => '途中移動しました', 'new_assign_id' => $newId]);
    }

    // ================================================================
    // プライベートメソッド
    // ================================================================

    private function getAssign(PDO $db, int $id): ?array
    {
        $stmt = $db->prepare("SELECT * FROM room_assignments WHERE id = :id AND status = 'active'");
        $stmt->execute(['id' => $id]);
        return $stmt->fetch() ?: null;
    }

    /** 予約がチェックイン済みかどうか */
    private function isCheckedIn(PDO $db, int $reservationId): bool
    {
        $stmt = $db->prepare("SELECT status FROM reservations WHERE id = :id");
        $stmt->execute(['id' => $reservationId]);
        $status = $stmt->fetchColumn();
        return $status === 'checked_in';
    }

    private function checkWarnings(PDO $db, int $reservationId, int $roomId): array
    {
        $warnings = [];
        $stmt = $db->prepare("
            SELECT res.room_type, res.adult_count, rt.type_code, rt.max_adults
            FROM reservations res, rooms r
            JOIN room_types rt ON rt.id = r.room_type_id
            WHERE res.id = :res_id AND r.id = :room_id
        ");
        $stmt->execute(['res_id' => $reservationId, 'room_id' => $roomId]);
        $row = $stmt->fetch();

        if ($row) {
            if ($row['room_type'] !== $row['type_code']) {
                $warnings[] = [
                    'type'    => 'type_mismatch',
                    'message' => "予約タイプ({$row['room_type']})と部屋タイプ({$row['type_code']})が異なります",
                ];
            }
            if ((int) $row['adult_count'] > (int) $row['max_adults']) {
                $warnings[] = [
                    'type'    => 'capacity_exceeded',
                    'message' => "大人{$row['adult_count']}名は最大定員{$row['max_adults']}名を超えています",
                ];
            }
        }

        return $warnings;
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

    /** 予約イベント履歴を記録 */
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
