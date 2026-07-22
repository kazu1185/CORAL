<?php

namespace App\Services;

use App\Core\Database;
use PDO;

/**
 * TL電文取込サービス
 *
 * XMLファイルをパースしてreservationsテーブルに全自動で反映する
 * 新規・変更・取消の3種別を処理、結果をtl_import_logsに記録
 */
class TlImportService
{
    private TlXmlParser $parser;
    private \PDO $db;

    /** アーカイブ先ベースパス */
    private string $archiveBasePath;

    public function __construct()
    {
        $this->parser = new TlXmlParser();
        $this->db = Database::getInstance();
        // プロジェクトルートからの相対パスでアーカイブ先を決定
        $this->archiveBasePath = dirname(__DIR__, 2) . '/../storage/tl_import';

        // DBからチャネルマップを読み込んでパーサーに注入
        // OTA_CHANNEL_MAPのハードコードを廃止し、channelsテーブルで管理する
        $this->loadChannelMap();
    }

    /**
     * channelsテーブルからOTA名マッチパターンを読み込み、パーサーに設定する
     */
    private function loadChannelMap(): void
    {
        try {
            $stmt = $this->db->query("
                SELECT channel_code, tl_match_patterns
                FROM channels
                WHERE is_active = 1 AND tl_match_patterns IS NOT NULL
                ORDER BY sort_order
            ");
            $channels = $stmt->fetchAll(\PDO::FETCH_ASSOC);
            $this->parser->setChannelMap($channels);
        } catch (\Throwable $e) {
            // DB接続失敗時はフォールバック定数を使用（パーサー内で自動判断）
        }
    }

    /**
     * ディレクトリ内の全XMLを一括処理
     * サブディレクトリ（複数室予約フォルダ）も再帰的に検索
     */
    public function processDirectory(string $inputDir): array
    {
        $summary = [
            'processed' => 0,
            'new'       => 0,
            'modify'    => 0,
            'cancel'    => 0,
            'duplicate' => 0,
            'errors'    => 0,
            'details'   => [],
        ];

        // XMLファイル一覧（サブディレクトリ含む）
        $files = $this->collectXmlFiles($inputDir);
        if (empty($files)) return $summary;

        // ファイル名順にソート（複数室予約の001→002の順序を保証するため）
        sort($files);

        // 複数室予約のグループ検出用
        $multiRoomGroups = [];

        foreach ($files as $filePath) {
            $result = $this->processFile($filePath);
            $summary['processed']++;
            $summary['details'][] = $result;

            if ($result['status'] === 'success') {
                $summary[$result['type']]++;

                // 複数室グループの追跡
                $group = $this->detectMultiRoomGroup(basename($filePath));
                if ($group && $result['reservation_id']) {
                    $key = $group['group_key'];
                    $multiRoomGroups[$key][] = $result['reservation_id'];
                }
            } elseif ($result['status'] === 'duplicate') {
                $summary['duplicate']++;
            } else {
                $summary['errors']++;
            }
        }

        // 複数室予約の自動連結（2室以上のグループのみ）
        foreach ($multiRoomGroups as $groupKey => $reservationIds) {
            if (count($reservationIds) >= 2) {
                $this->linkMultiRoomReservations($reservationIds);
            }
        }

        return $summary;
    }

    /**
     * 1ファイルを処理
     */
    public function processFile(string $filePath): array
    {
        $fileName = basename($filePath);

        try {
            $xmlContent = file_get_contents($filePath);
            if ($xmlContent === false) {
                throw new \RuntimeException("ファイル読み込み失敗: {$filePath}");
            }

            $parsed = $this->parser->parse($xmlContent);

            // 重複チェック（同じDataIDで既に取込成功している場合はスキップ）
            if ($this->isDuplicate($parsed['data_id'], $parsed['reservation_no'])) {
                $this->logImport($parsed, null, 'duplicate', null, $filePath);
                return [
                    'status'         => 'duplicate',
                    'type'           => $parsed['transaction_type'],
                    'reservation_id' => null,
                    'file'           => $fileName,
                ];
            }

            // 種別別処理
            $reservationId = match ($parsed['transaction_type']) {
                'new'    => $this->handleNewBooking($parsed),
                'modify' => $this->handleModification($parsed),
                'cancel' => $this->handleCancellation($parsed),
                default  => throw new \RuntimeException("未知の電文種別: {$parsed['transaction_type']}"),
            };

            // アーカイブ
            $archivePath = $this->archiveFile($filePath);

            // ログ記録
            $this->logImport($parsed, $reservationId, 'success', null, $archivePath);

            // 同じ予約番号の過去エラーログを自動解消
            // 再処理で成功した場合、ダッシュボードのアラートから消える
            $this->resolveOldErrors($parsed['reservation_no']);

            return [
                'status'         => 'success',
                'type'           => $parsed['transaction_type'],
                'reservation_id' => $reservationId,
                'file'           => $fileName,
            ];

        } catch (\Throwable $e) {
            // エラー時もログ記録（ダッシュボードのアラートに表示されるため）
            $this->logImportError($fileName, $filePath, $e->getMessage());

            return [
                'status'         => 'error',
                'type'           => null,
                'reservation_id' => null,
                'file'           => $fileName,
                'error'          => $e->getMessage(),
            ];
        }
    }

    // ============================================================
    // 種別別処理
    // ============================================================

    /**
     * 新規予約の取込
     *
     * 同一予約番号+チャネルの既存レコードがあればUPDATE（重複INSERT防止）、
     * なければINSERT。いずれもreservation_eventsに履歴を記録する。
     *
     * room_count > 1（複数室予約）の場合は handleMultiRoomNewBooking() に委譲し、
     * 親1件 + 子N件に分割して取り込む。
     */
    private function handleNewBooking(array $parsed): int
    {
        // 同一予約番号+チャネルで既存チェック（重複INSERT防止）
        $existing = $this->findExistingReservation($parsed['reservation_no'], $parsed['channel']);

        if ($existing) {
            // 既存あり → UPDATE（上書き）で対応
            // 同じ予約番号の「新規」電文を変更扱いにするのは意図的（検証報告 #13 で検討の上維持）:
            // TL側のリトライ・再送で同一予約の新規電文が複数回届き得るため、
            // 新規としてINSERTすると予約が二重になる。既存があれば常に上書きが安全。
            // 複数室の親予約が既に存在する場合は変更通知として処理
            if (($existing['room_count'] ?? 1) > 1) {
                return $this->handleMultiRoomModification($existing, $parsed);
            }
            return $this->updateExistingReservation($existing, $parsed, 'tl_modify', 'TL変更通知（新規電文による上書き）');
        }

        // 複数室予約の場合は分割取込
        if (($parsed['room_count'] ?? 1) > 1 && !empty($parsed['rooms_data']['rooms'])) {
            return $this->handleMultiRoomNewBooking($parsed);
        }

        // 既存なし → 単室の新規INSERT
        return $this->createSingleReservation($parsed);
    }

    /**
     * 単室予約の新規INSERT（handleNewBookingから分離）
     *
     * 複数室の子予約作成時にも再利用するためメソッド化。
     * $overrides で room_type / amount / daily_rates / adult_count 等を上書き可能。
     */
    private function createSingleReservation(array $parsed, ?int $parentId = null, ?int $roomIndex = null, array $overrides = []): int
    {
        // ゲスト検索 or 作成（同一予約番号・同一電話番号の既存ゲストを再利用）
        $guestResult = $this->findOrCreateGuest(
            $parsed['name'],
            $parsed['name_kanji'] ?? null,
            $parsed['phone'] ?? null,
            $parsed['email'] ?? null,
            $parsed['country_code'] ?? null,
            $parsed['preferred_language'] ?? null,
            $parsed['reservation_no'] ?? null,
            $parsed['channel'] ?? null
        );

        // overridesで部屋別の値を上書き（複数室の子予約用）
        $roomType    = $overrides['room_type']   ?? $parsed['room_type'];
        $amount      = $overrides['amount']      ?? $parsed['total_charge'];
        $adultCount  = $overrides['adult_count'] ?? $parsed['adult_count'];
        $childCount  = $overrides['child_count'] ?? $parsed['child_count'];
        $dailyRates  = $overrides['daily_rates'] ?? $parsed['daily_rates'];
        // 子予約はreservation_noをNULLにする（親がOTA予約番号を保持）
        $reservationNo = ($parentId !== null) ? null : $parsed['reservation_no'];
        // 子予約のステータスは confirmed、親は group_parent（呼び出し元で制御）
        $status = ($parentId !== null) ? 'confirmed' : 'confirmed';

        $stmt = $this->db->prepare("
            INSERT INTO reservations (
                parent_reservation_id, room_count, room_index,
                guest_id, guest_match_status, channel, reservation_no,
                checkin_date, checkout_date, nights, room_type, amount,
                adult_count, child_count,
                male_count, female_count,
                child_a_count, child_b_count, child_c_count, child_d_count,
                status, booked_at,
                tl_last_name, tl_first_name,
                tl_checkin_date, tl_checkout_date, tl_room_type,
                tl_data_id, tl_plan_name, tl_plan_code,
                tl_settlement_type, tl_amount_claimed, tl_commission,
                tl_rate_type, tl_other_info, tl_telegram_data
            ) VALUES (
                :parent_id, :room_count, :room_index,
                :guest_id, :guest_match_status, :channel, :reservation_no,
                :checkin_date, :checkout_date, :nights, :room_type, :amount,
                :adult_count, :child_count,
                :male_count, :female_count,
                :child_a_count, :child_b_count, :child_c_count, :child_d_count,
                :status, :booked_at,
                :tl_last_name, :tl_first_name,
                :tl_checkin_date, :tl_checkout_date, :tl_room_type,
                :tl_data_id, :tl_plan_name, :tl_plan_code,
                :tl_settlement_type, :tl_amount_claimed, :tl_commission,
                :tl_rate_type, :tl_other_info, :tl_telegram_data
            )
        ");
        $stmt->execute([
            'parent_id'          => $parentId,
            'room_count'         => ($parentId !== null) ? 1 : ($parsed['room_count'] ?? 1),
            'room_index'         => $roomIndex,
            'guest_id'           => $guestResult['guest_id'],
            'guest_match_status' => $guestResult['match_status'],
            'channel'            => $parsed['channel'],
            'reservation_no'     => $reservationNo,
            'checkin_date'       => $parsed['checkin_date'],
            'checkout_date'      => $parsed['checkout_date'],
            'nights'             => $parsed['nights'],
            'room_type'          => $roomType,
            'amount'             => $amount,
            'adult_count'        => $adultCount,
            'child_count'        => $childCount,
            'male_count'         => $parsed['male_count'] ?? 0,
            'female_count'       => $parsed['female_count'] ?? 0,
            'child_a_count'      => $parsed['child_a_count'] ?? 0,
            'child_b_count'      => $parsed['child_b_count'] ?? 0,
            'child_c_count'      => $parsed['child_c_count'] ?? 0,
            'child_d_count'      => $parsed['child_d_count'] ?? 0,
            'status'             => $status,
            'booked_at'          => $parsed['booked_at'] ?? null,
            'tl_last_name'       => $parsed['name'],
            'tl_first_name'      => '',
            'tl_checkin_date'    => $parsed['checkin_date'],
            'tl_checkout_date'   => $parsed['checkout_date'],
            'tl_room_type'       => $roomType,
            'tl_data_id'         => $parsed['data_id'],
            'tl_plan_name'       => $parsed['plan_name'] ?: null,
            'tl_plan_code'       => $parsed['plan_code'] ?: null,
            'tl_settlement_type' => $parsed['settlement_type'],
            'tl_amount_claimed'  => $amount,
            'tl_commission'      => $parsed['commission'] ?: null,
            'tl_rate_type'       => $parsed['rate_type'],
            'tl_other_info'      => $parsed['other_info'] ?: null,
            'tl_telegram_data'   => $parsed['telegram_data'] ?: null,
        ]);

        $reservationId = (int)$this->db->lastInsertId();

        // 日別明細の生成（overridesのdaily_ratesを使う）
        $chargesParsed = $parsed;
        $chargesParsed['daily_rates'] = $dailyRates;
        $chargesParsed['total_charge'] = $amount;
        $this->createChargeLines($reservationId, $chargesParsed);

        // 未登録チャネル検知: channel='other' かつ CompanyName が存在する場合、
        // ダッシュボードアラート用にunknown_channelイベントを記録する
        if ($parsed['channel'] === 'other' && !empty($parsed['channel_raw'])) {
            $this->recordEvent($reservationId, 'unknown_channel',
                "未登録OTA: {$parsed['channel_raw']}",
                json_encode(['company_name' => $parsed['channel_raw']], JSON_UNESCAPED_UNICODE),
                $parsed['data_id']
            );
        }

        return $reservationId;
    }

    /**
     * 複数室予約の新規取込（親1件 + 子N件）
     *
     * 1電文にN室含まれる場合:
     * - 親予約: OTA予約そのもの（channel, reservation_no保持, status=group_parent）
     * - 子予約: 各部屋（独立CI/CO/精算, parent_reservation_id=親.id）
     * - guest_links: アサインボードのLinkedBar表示用に連結
     */
    private function handleMultiRoomNewBooking(array $parsed): int
    {
        $rooms = $parsed['rooms_data']['rooms'];
        $roomCount = count($rooms);

        $this->db->beginTransaction();
        try {
            // 1. 親予約を作成（group_parent ステータス）
            $guestResult = $this->findOrCreateGuest(
                $parsed['name'],
                $parsed['name_kanji'] ?? null,
                $parsed['phone'] ?? null,
                $parsed['email'] ?? null,
                $parsed['country_code'] ?? null,
                $parsed['preferred_language'] ?? null
            );

            $parentStmt = $this->db->prepare("
                INSERT INTO reservations (
                    parent_reservation_id, room_count, room_index,
                    guest_id, guest_match_status, channel, reservation_no,
                    checkin_date, checkout_date, nights, room_type, amount,
                    adult_count, child_count,
                    male_count, female_count,
                    child_a_count, child_b_count, child_c_count, child_d_count,
                    status, booked_at,
                    tl_last_name, tl_first_name,
                    tl_checkin_date, tl_checkout_date, tl_room_type,
                    tl_data_id, tl_plan_name, tl_plan_code,
                    tl_settlement_type, tl_amount_claimed, tl_commission,
                    tl_rate_type, tl_other_info, tl_telegram_data
                ) VALUES (
                    NULL, :room_count, NULL,
                    :guest_id, :guest_match_status, :channel, :reservation_no,
                    :checkin_date, :checkout_date, :nights, NULL, :amount,
                    :adult_count, :child_count,
                    :male_count, :female_count,
                    :child_a_count, :child_b_count, :child_c_count, :child_d_count,
                    'group_parent', :booked_at,
                    :tl_last_name, :tl_first_name,
                    :tl_checkin_date, :tl_checkout_date, NULL,
                    :tl_data_id, :tl_plan_name, :tl_plan_code,
                    :tl_settlement_type, :tl_amount_claimed, :tl_commission,
                    :tl_rate_type, :tl_other_info, :tl_telegram_data
                )
            ");
            $parentStmt->execute([
                'room_count'         => $roomCount,
                'guest_id'           => $guestResult['guest_id'],
                'guest_match_status' => $guestResult['match_status'],
                'channel'            => $parsed['channel'],
                'reservation_no'     => $parsed['reservation_no'],
                'checkin_date'       => $parsed['checkin_date'],
                'checkout_date'      => $parsed['checkout_date'],
                'nights'             => $parsed['nights'],
                'amount'             => $parsed['total_charge'],
                'adult_count'        => $parsed['adult_count'],
                'child_count'        => $parsed['child_count'],
                'male_count'         => $parsed['male_count'] ?? 0,
                'female_count'       => $parsed['female_count'] ?? 0,
                'child_a_count'      => $parsed['child_a_count'] ?? 0,
                'child_b_count'      => $parsed['child_b_count'] ?? 0,
                'child_c_count'      => $parsed['child_c_count'] ?? 0,
                'child_d_count'      => $parsed['child_d_count'] ?? 0,
                'booked_at'          => $parsed['booked_at'] ?? null,
                'tl_last_name'       => $parsed['name'],
                'tl_first_name'      => '',
                'tl_checkin_date'    => $parsed['checkin_date'],
                'tl_checkout_date'   => $parsed['checkout_date'],
                'tl_data_id'         => $parsed['data_id'],
                'tl_plan_name'       => $parsed['plan_name'] ?: null,
                'tl_plan_code'       => $parsed['plan_code'] ?: null,
                'tl_settlement_type' => $parsed['settlement_type'],
                'tl_amount_claimed'  => $parsed['total_charge'],
                'tl_commission'      => $parsed['commission'] ?: null,
                'tl_rate_type'       => $parsed['rate_type'],
                'tl_other_info'      => $parsed['other_info'] ?: null,
                'tl_telegram_data'   => $parsed['telegram_data'] ?: null,
            ]);
            $parentId = (int)$this->db->lastInsertId();

            // 親予約のイベント履歴
            $this->recordEvent(
                $parentId, 'tl_new',
                "TL新規予約（{$roomCount}室グループ）",
                json_encode(['room_count' => $roomCount], JSON_UNESCAPED_UNICODE),
                $parsed['data_id'],
                $parsed['booked_at'] ?? null
            );

            // 2. 子予約をN件作成
            $childIds = [];
            foreach ($rooms as $roomIndex => $roomData) {
                $roomAmount = array_sum(array_column($roomData['rates'], 'amount'));

                // Agodaの人数問題: 1室目に全員分が入り他室は0 or 小さい値
                // → 全室のpax_countが均等でなければ総人数の均等割りにする
                // Booking.comは部屋ごとのPerRoomPaxCountが正しく入る
                $paxCount = $roomData['pax_count'] ?? 0;
                if ($paxCount <= 0 || $paxCount > (int)ceil($parsed['adult_count'] / $roomCount) * 2) {
                    // 0 or 明らかに偏りすぎ（全員分が1室に入っている）→ 均等割り
                    $paxCount = (int)ceil($parsed['adult_count'] / $roomCount);
                }

                $childId = $this->createSingleReservation($parsed, $parentId, $roomIndex + 1, [
                    'room_type'   => $roomData['room_type'],
                    'amount'      => $roomAmount,
                    'daily_rates' => $roomData['rates'],
                    'adult_count' => $paxCount,
                    'child_count' => 0, // 子供人数は親で管理、子予約では按分しない
                ]);
                $childIds[] = $childId;

                // 子予約のイベント履歴
                $this->recordEvent(
                    $childId, 'tl_new',
                    "TL新規予約（グループ室" . ($roomIndex + 1) . "/{$roomCount}）",
                    json_encode([
                        'parent_id'  => $parentId,
                        'room_index' => $roomIndex + 1,
                        'room_type'  => $roomData['room_type'],
                        'amount'     => $roomAmount,
                    ], JSON_UNESCAPED_UNICODE),
                    $parsed['data_id'],
                    $parsed['booked_at'] ?? null
                );
            }

            // 3. guest_linksで子予約を連結（アサインボードのLinkedBar表示用）
            if (count($childIds) >= 2) {
                $this->linkMultiRoomReservations($childIds);
            }

            $this->db->commit();
            return $parentId;

        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    /**
     * 予約変更の取込
     * 既存予約を検索→変更前の状態をイベント記録→運用フィールドを上書き→明細を再生成
     *
     * source経由でヒットした場合（統合済み予約への変更通知）:
     * - 金額変更のみ → charges更新 + source.amount更新（自動反映）
     * - 日程変更あり → merge_alertイベントを記録（自動処理しない）
     */
    private function handleModification(array $parsed): int
    {
        // 既存予約を予約番号+チャネルで検索
        $existing = $this->findExistingReservation($parsed['reservation_no'], $parsed['channel']);

        if (!$existing) {
            // 既存予約が見つからない場合は新規として取込（TLの変更通知が先に届くケースへの対策）
            return $this->handleNewBooking($parsed);
        }

        // source経由でヒット = 統合済み予約への変更通知
        if (($existing['match_via'] ?? '') === 'source') {
            return $this->handleMergedReservationModification($existing, $parsed);
        }

        // 複数室予約の親 → 専用の変更処理
        if (($existing['room_count'] ?? 1) > 1 && $existing['status'] === 'group_parent') {
            return $this->handleMultiRoomModification($existing, $parsed);
        }

        // CI済み・CO済みの予約は自動変更不可（手動対応が必要）
        if (in_array($existing['status'], ['checked_in', 'checked_out'])) {
            throw new \RuntimeException(
                "CI済み予約の変更通知は自動反映不可（予約ID:{$existing['id']}, ステータス:{$existing['status']}）"
            );
        }

        // 共通のUPDATE処理に委譲
        return $this->updateExistingReservation($existing, $parsed, 'tl_modify', 'TL変更通知');
    }

    /**
     * 予約取消の取込
     * ステータスをcancelledに変更 + アサイン物理削除
     *
     * source経由でヒットした場合（統合済み予約への取消通知）:
     * → merge_alertイベントを記録（自動処理しない、スタッフ判断に委ねる）
     */
    private function handleCancellation(array $parsed): int
    {
        $existing = $this->findExistingReservation($parsed['reservation_no'], $parsed['channel']);

        if (!$existing) {
            // 新規通知なしでキャンセルだけ届くケース（データ期間外の予約等）
            // エラーではなく警告として記録し、スキップする
            $this->logImport($parsed, null, 'success', '取消対象なし（新規通知未受信）', '');
            return 0;
        }

        // source経由でヒット = 統合済み予約への取消通知 → アラート
        if (($existing['match_via'] ?? '') === 'source') {
            $this->recordMergeAlert(
                (int) $existing['id'],
                $parsed['reservation_no'],
                'cancel',
                '統合予約の一部がキャンセルされました',
                $parsed
            );
            return (int) $existing['id'];
        }

        // 複数室予約の親が見つかった場合は子も含めて全キャンセル
        if (($existing['room_count'] ?? 1) > 1 && $existing['status'] === 'group_parent') {
            return $this->cancelMultiRoomReservation($existing, $parsed);
        }

        // CI済みの予約は自動取消不可
        if ($existing['status'] === 'checked_in') {
            throw new \RuntimeException(
                "CI済み予約のTL取消通知は自動反映不可（予約ID:{$existing['id']}）"
            );
        }

        // 既にキャンセル済みならスキップ（重複取消通知）
        if ($existing['status'] === 'cancelled') {
            return $existing['id'];
        }

        $this->db->beginTransaction();
        try {
            // イベント履歴: 取消（event_atはOTA取消日時）
            $this->recordEvent(
                $existing['id'],
                'tl_cancel',
                'TL予約取消',
                json_encode([
                    'before_status' => $existing['status'],
                    'checkin'       => $existing['checkin_date'],
                    'checkout'      => $existing['checkout_date'],
                ], JSON_UNESCAPED_UNICODE),
                $parsed['data_id'],
                $parsed['booked_at'] ?? null
            );

            // ステータスをキャンセルに変更
            $this->db->prepare("
                UPDATE reservations SET status = 'cancelled', tl_data_id = :tl_data_id
                WHERE id = :id
            ")->execute([
                'tl_data_id' => $parsed['data_id'],
                'id'         => $existing['id'],
            ]);

            // アサインを物理削除（CI前なので履歴不要 — CLAUDE.md準拠）
            $this->db->prepare("
                DELETE FROM room_assignments WHERE reservation_id = :id
            ")->execute(['id' => $existing['id']]);

            // 新規→取消のみのゲストを掃除（予約自体はtl_last_name等で履歴が残る）
            $guestId = $existing['guest_id'] ?? null;
            if ($guestId) {
                $this->cleanupOrphanGuest((int) $guestId);
            }

            $this->db->commit();
            return $existing['id'];

        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    // ============================================================
    // ヘルパー
    // ============================================================

    /**
     * 新規→取消のみで作られた孤立ゲストを物理削除する。
     *
     * 保持条件（いずれかに該当すれば残す）:
     * - visit_count > 0（宿泊実績あり＝リピーター）
     * - キャンセル/ノーショー以外の予約がある（アクティブな予約保有）
     * - guest_match_status='matched' の予約がある（スタッフが手動で名寄せ済み）
     *
     * FK制約回避: 削除前にキャンセル済み予約の guest_id を NULL にする。
     * 予約側は tl_last_name / tl_first_name / tl_telegram_data に原本が残るので
     * キャンセル履歴としてのゲスト名追跡は可能。
     */
    private function cleanupOrphanGuest(int $guestId): void
    {
        $stmt = $this->db->prepare("SELECT id, visit_count FROM guests WHERE id = :id");
        $stmt->execute(['id' => $guestId]);
        $guest = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$guest) return;

        // 宿泊実績ありなら残す
        if ((int)($guest['visit_count'] ?? 0) > 0) return;

        // キャンセル/ノーショー以外の予約があれば残す
        $stmt = $this->db->prepare("
            SELECT COUNT(*) FROM reservations
            WHERE guest_id = :gid AND status NOT IN ('cancelled', 'no_show')
        ");
        $stmt->execute(['gid' => $guestId]);
        if ((int)$stmt->fetchColumn() > 0) return;

        // 手動名寄せ済みがあれば残す
        $stmt = $this->db->prepare("
            SELECT COUNT(*) FROM reservations
            WHERE guest_id = :gid AND guest_match_status = 'matched'
        ");
        $stmt->execute(['gid' => $guestId]);
        if ((int)$stmt->fetchColumn() > 0) return;

        // FK解除: キャンセル/ノーショー予約の guest_id を NULL にしてから削除
        // 予約側は tl_last_name 等で原本情報が残るため履歴追跡に支障なし
        $this->db->prepare("
            UPDATE reservations SET guest_id = NULL
            WHERE guest_id = :gid AND status IN ('cancelled', 'no_show')
        ")->execute(['gid' => $guestId]);

        $this->db->prepare("DELETE FROM guests WHERE id = :id")->execute(['id' => $guestId]);
    }

    /**
     * 日別明細（reservation_charges）の生成
     */
    private function createChargeLines(int $reservationId, array $parsed): void
    {
        if (empty($parsed['daily_rates'])) return;

        // Phase 1: 宿泊料（room）行 — 日別に1行ずつ
        $roomStmt = $this->db->prepare("
            INSERT INTO reservation_charges (reservation_id, date, charge_type, description, amount, status)
            VALUES (:reservation_id, :date, 'room', :description, :amount, 'active')
        ");
        foreach ($parsed['daily_rates'] as $rate) {
            $roomStmt->execute([
                'reservation_id' => $reservationId,
                'date'           => $rate['date'],
                'description'    => $parsed['plan_name'] ?: '宿泊料',
                'amount'         => $rate['amount'],
            ]);
        }

        // Phase 2: 割引（discount）行 — ポイント・補助金・クーポン等
        // じゃらんのPointsDiscountListから取得。CO日に一括計上（OTA売掛の精算タイミングに合わせる）。
        if (!empty($parsed['points_discounts'])) {
            $discountStmt = $this->db->prepare("
                INSERT INTO reservation_charges (reservation_id, date, charge_type, description, amount, status)
                VALUES (:reservation_id, :date, 'discount', :description, :amount, 'active')
            ");
            foreach ($parsed['points_discounts'] as $discount) {
                $discountStmt->execute([
                    'reservation_id' => $reservationId,
                    'date'           => $parsed['checkout_date'],
                    'description'    => $discount['name'],
                    'amount'         => -1 * $discount['amount'], // マイナス金額で記録
                ]);
            }
        }

        // Phase 3: 入金（payment）行 — OTA事前決済の場合のみ自動生成
        // スタッフが後から修正・削除可能。変更通知時はこの行を触らない。
        // OTA事前決済 or カード事前決済 → いずれも現地精算不要なので入金行を自動生成
        // card: 楽天・じゃらん等の「カード決済」はOTA側で決済済み
        $settlement = $parsed['settlement_type'] ?? '';
        if ($settlement === 'ota_prepaid' || $settlement === 'card') {
            $roomTotal = array_sum(array_column($parsed['daily_rates'], 'amount'));
            $discountTotal = 0;
            foreach ($parsed['points_discounts'] ?? [] as $d) {
                $discountTotal += $d['amount'];
            }
            // 入金額 = 宿泊料合計 - 割引合計（割引はXML上正の値なので減算）
            $paymentAmount = $roomTotal - $discountTotal;

            $otaLabel = $parsed['channel_raw'] ?: $parsed['channel'];
            $this->db->prepare("
                INSERT INTO reservation_charges (reservation_id, date, charge_type, description, amount, payment_method_id, status)
                VALUES (:reservation_id, :date, 'payment', :description, :amount, NULL, 'active')
            ")->execute([
                'reservation_id' => $reservationId,
                // 入金日はCO日（OTA売掛の精算タイミングに合わせる）
                'date'           => $parsed['checkout_date'],
                'description'    => 'OTA事前決済（' . $otaLabel . '）',
                'amount'         => $paymentAmount,
            ]);
        }
    }

    /**
     * 既存予約の検索（予約番号 + チャネルで一意特定）
     *
     * 検索順序:
     * 1. reservations.reservation_no で検索
     * 2. 見つからなければ reservation_sources.reservation_no で検索（統合済み予約対応）
     *
     * @return array|null 見つかった場合は予約情報 + match_via キー（'direct' or 'source'）
     */
    private function findExistingReservation(string $reservationNo, string $channel): ?array
    {
        // 1. 通常の予約番号検索
        // room_countも返す（複数室予約の親かどうかの判定に使用）
        $stmt = $this->db->prepare("
            SELECT id, status, checkin_date, checkout_date, room_count, guest_id, guest_match_status
            FROM reservations
            WHERE reservation_no = :reservation_no AND channel = :channel
            LIMIT 1
        ");
        $stmt->execute([
            'reservation_no' => $reservationNo,
            'channel'        => $channel,
        ]);
        $result = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($result) {
            // merged の子予約にヒットした場合はdirect扱いしない。
            // 統合で子のreservation_noは残るが、変更通知はsource経由で
            // 親予約に対して処理すべきため、Step 2 に進む。
            if ($result['status'] !== 'merged') {
                $result['match_via'] = 'direct';
                return $result;
            }
        }

        // 2. reservation_sources 経由で検索（統合された子予約の番号でTL通知が来た場合）
        return $this->findReservationViaSource($reservationNo, $channel);
    }

    /**
     * reservation_sources 経由で親予約を検索
     *
     * 統合された子予約のOTA予約番号から、親予約を辿る。
     * TL通知がmerged子の予約番号で届いた場合に使用。
     *
     * @return array|null 親予約情報 + source情報 + match_via='source'
     */
    private function findReservationViaSource(string $reservationNo, string $channel): ?array
    {
        $stmt = $this->db->prepare("
            SELECT rs.id AS source_id, rs.reservation_id AS parent_id,
                   rs.checkin_date AS source_ci, rs.checkout_date AS source_co,
                   rs.amount AS source_amount,
                   r.id, r.status, r.checkin_date, r.checkout_date
            FROM reservation_sources rs
            JOIN reservations r ON r.id = rs.reservation_id
            WHERE rs.reservation_no = :reservation_no AND rs.channel = :channel
                  AND rs.status = 'active'
            LIMIT 1
        ");
        $stmt->execute([
            'reservation_no' => $reservationNo,
            'channel'        => $channel,
        ]);
        $result = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$result) return null;

        $result['match_via'] = 'source';
        return $result;
    }

    /**
     * 重複チェック（同一電文の再処理防止）
     * 同じDataIDの予約が既に存在すればtrue。modify/cancelは別DataIDなのでDataIDで判定。
     *
     * $reservationNo を引数に残している理由:
     *   将来、reservation_no + DataID の組み合わせで重複検知する可能性がある（例:
     *   tl_import_logs に data_id カラムを追加して履歴ベースで判定する場合）。
     *   呼出側（processFile）で両方を渡す実装になっているため、シグネチャを維持して
     *   拡張時に呼出側の変更を最小化する。現実装ではDataIDのみで十分。
     */
    private function isDuplicate(string $dataId, string $reservationNo): bool
    {
        $stmt = $this->db->prepare("
            SELECT COUNT(*) FROM reservations WHERE tl_data_id = :data_id
        ");
        $stmt->execute(['data_id' => $dataId]);
        return (int)$stmt->fetchColumn() > 0;
    }

    /**
     * XMLファイルをアーカイブ
     * storage/tl_import/YYYY/MM/DD/ に日付別で保存
     */
    private function archiveFile(string $sourcePath): string
    {
        $date = date('Y/m/d');
        $archiveDir = $this->archiveBasePath . '/' . $date;

        if (!is_dir($archiveDir)) {
            mkdir($archiveDir, 0755, true);
        }

        $archivePath = $archiveDir . '/' . basename($sourcePath);

        // 同名ファイルがある場合はタイムスタンプを付与
        if (file_exists($archivePath)) {
            $ext = pathinfo($archivePath, PATHINFO_EXTENSION);
            $base = pathinfo($archivePath, PATHINFO_FILENAME);
            $archivePath = $archiveDir . '/' . $base . '_' . date('His') . '.' . $ext;
        }

        copy($sourcePath, $archivePath);
        return $archivePath;
    }

    /**
     * 取込ログ記録
     */
    private function logImport(array $parsed, ?int $reservationId, string $status, ?string $errorMsg, string $filePath): void
    {
        $importType = match ($parsed['transaction_type']) {
            'new'    => 'new',
            'modify' => 'modify',
            'cancel' => 'cancel',
            default  => null,
        };

        $stmt = $this->db->prepare("
            INSERT INTO tl_import_logs (reservation_no, channel, file_path, parse_status, reservation_id, error_message, import_type)
            VALUES (:reservation_no, :channel, :file_path, :status, :reservation_id, :error_message, :import_type)
        ");
        $stmt->execute([
            'reservation_no' => $parsed['reservation_no'],
            'channel'        => $parsed['channel'],
            'file_path'      => $filePath,
            'status'         => $status,
            'reservation_id' => $reservationId,
            'error_message'  => $errorMsg,
            'import_type'    => $importType,
        ]);
    }

    /**
     * エラー時のログ記録（パース前のためparsedデータなし）
     */
    private function logImportError(string $fileName, string $filePath, string $errorMsg): void
    {
        $stmt = $this->db->prepare("
            INSERT INTO tl_import_logs (reservation_no, channel, file_path, parse_status, error_message)
            VALUES (:reservation_no, NULL, :file_path, 'error', :error_message)
        ");
        $stmt->execute([
            'reservation_no' => $fileName,
            'file_path'      => $filePath,
            'error_message'  => $errorMsg,
        ]);
    }

    /**
     * ディレクトリ内のXMLファイルを再帰的に収集
     */
    private function collectXmlFiles(string $dir): array
    {
        $files = [];

        // 直下のXMLファイル
        foreach (glob("{$dir}/TLPDAT_*.xml") as $f) {
            $files[] = $f;
        }

        // サブディレクトリ内のXMLファイル（複数室予約フォルダ）
        foreach (glob("{$dir}/*/TLPDAT_*.xml") as $f) {
            $files[] = $f;
        }

        return $files;
    }

    /**
     * ファイル名から複数室予約グループを検出
     * TLPDAT_260411000004001.xml → group_key=TLPDAT_260411000004, sequence=1
     */
    private function detectMultiRoomGroup(string $filename): ?array
    {
        // 末尾の3桁が室番号（001, 002, ...）
        if (preg_match('/^(TLPDAT_\d{15})(\d{3})\.xml$/', $filename, $m)) {
            return [
                'group_key' => $m[1],
                'sequence'  => (int)$m[2],
            ];
        }
        return null;
    }

    /**
     * 複数室予約の全キャンセル（親 + 子全件）
     *
     * TL取消通知で親予約にヒットした場合、子予約も含めて全キャンセルする。
     * ただしCI済みの子が1件でもあれば自動処理不可とする。
     */
    private function cancelMultiRoomReservation(array $parent, array $parsed): int
    {
        $parentId = (int)$parent['id'];

        // 子予約を全件取得
        $childStmt = $this->db->prepare("
            SELECT id, status FROM reservations
            WHERE parent_reservation_id = :parent_id
        ");
        $childStmt->execute(['parent_id' => $parentId]);
        $children = $childStmt->fetchAll(\PDO::FETCH_ASSOC);

        // CI済みの子がいたら自動処理不可
        foreach ($children as $child) {
            if (in_array($child['status'], ['checked_in', 'checked_out'])) {
                throw new \RuntimeException(
                    "CI済み子予約があるため複数室予約のTL取消を自動反映不可（親ID:{$parentId}, 子ID:{$child['id']}）"
                );
            }
        }

        $this->db->beginTransaction();
        try {
            // 親予約をキャンセル
            $this->recordEvent(
                $parentId, 'tl_cancel',
                'TL予約取消（複数室グループ）',
                json_encode([
                    'before_status' => $parent['status'],
                    'child_count'   => count($children),
                ], JSON_UNESCAPED_UNICODE),
                $parsed['data_id'],
                $parsed['booked_at'] ?? null
            );
            $this->db->prepare("
                UPDATE reservations SET status = 'cancelled', tl_data_id = :data_id WHERE id = :id
            ")->execute(['data_id' => $parsed['data_id'], 'id' => $parentId]);

            // 子予約を全キャンセル + アサイン削除
            foreach ($children as $child) {
                if ($child['status'] === 'cancelled') continue; // 既にキャンセル済みはスキップ

                $this->recordEvent(
                    (int)$child['id'], 'tl_cancel',
                    'TL予約取消（グループ親のキャンセルに連動）',
                    json_encode(['parent_id' => $parentId], JSON_UNESCAPED_UNICODE),
                    $parsed['data_id'],
                    $parsed['booked_at'] ?? null
                );
                $this->db->prepare("
                    UPDATE reservations SET status = 'cancelled', tl_data_id = :data_id WHERE id = :id
                ")->execute(['data_id' => $parsed['data_id'], 'id' => $child['id']]);

                // CI前のアサインを物理削除（CLAUDE.md準拠）
                $this->db->prepare("
                    DELETE FROM room_assignments WHERE reservation_id = :id
                ")->execute(['id' => $child['id']]);
            }

            // 孤立ゲストを掃除（グループ内の各子予約のguest_idをチェック）
            $guestStmt = $this->db->prepare("
                SELECT DISTINCT guest_id FROM reservations
                WHERE parent_reservation_id = :pid AND guest_id IS NOT NULL
            ");
            $guestStmt->execute(['pid' => $parentId]);
            foreach ($guestStmt->fetchAll(\PDO::FETCH_COLUMN) as $gid) {
                $this->cleanupOrphanGuest((int)$gid);
            }

            $this->db->commit();
            return $parentId;

        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    /**
     * 複数室予約の変更通知処理
     *
     * 親予約にヒットした場合の処理:
     * - 室数変更あり → merge_alert（スタッフ判断に委ねる）
     * - 室数同じ & 日程変更なし → 各子の金額を更新
     * - 日程変更あり → merge_alert
     */
    private function handleMultiRoomModification(array $existing, array $parsed): int
    {
        $parentId = (int)$existing['id'];
        $oldRoomCount = (int)($existing['room_count'] ?? 1);
        $newRoomCount = (int)($parsed['room_count'] ?? 1);

        // 日程変更チェック
        $hasDateChange = ($parsed['checkin_date'] !== $existing['checkin_date']
                       || $parsed['checkout_date'] !== $existing['checkout_date']);

        // 室数変更 or 日程変更 → 自動処理しない（merge_alertでスタッフに委ねる）
        // 複数室の室数減/増は「どの子を削除するか」の判断が自動化困難なため
        if ($oldRoomCount !== $newRoomCount || $hasDateChange) {
            $this->recordMergeAlert(
                $parentId,
                $parsed['reservation_no'],
                $hasDateChange ? 'date_change' : 'room_count_change',
                $hasDateChange
                    ? "複数室予約の日程変更あり（{$oldRoomCount}室）"
                    : "複数室予約の室数変更（{$oldRoomCount}室→{$newRoomCount}室）",
                $parsed,
                [
                    'before_room_count' => $oldRoomCount,
                    'after_room_count'  => $newRoomCount,
                    'before_ci'         => $existing['checkin_date'],
                    'before_co'         => $existing['checkout_date'],
                    'after_ci'          => $parsed['checkin_date'],
                    'after_co'          => $parsed['checkout_date'],
                ]
            );
            return $parentId;
        }

        // 室数同じ & 日程同じ → 金額変更のみ（自動反映）
        $rooms = $parsed['rooms_data']['rooms'] ?? [];
        if (empty($rooms)) {
            // rooms_dataが取れない場合もアラートに回す
            $this->recordMergeAlert(
                $parentId, $parsed['reservation_no'], 'parse_error',
                '複数室予約の変更通知: 部屋別料金の解析に失敗',
                $parsed
            );
            return $parentId;
        }

        $this->db->beginTransaction();
        try {
            // 子予約をroom_index順に取得
            $childStmt = $this->db->prepare("
                SELECT id, room_index, status FROM reservations
                WHERE parent_reservation_id = :parent_id AND status != 'cancelled'
                ORDER BY room_index
            ");
            $childStmt->execute(['parent_id' => $parentId]);
            $children = $childStmt->fetchAll(\PDO::FETCH_ASSOC);

            // 子予約ごとに金額を更新
            foreach ($children as $child) {
                $ri = (int)$child['room_index'] - 1; // 0-based index
                if (!isset($rooms[$ri])) continue;

                $roomData = $rooms[$ri];
                $newAmount = array_sum(array_column($roomData['rates'], 'amount'));

                // CI済みの子は自動更新スキップ（手動対応）
                if (in_array($child['status'], ['checked_in', 'checked_out'])) continue;

                // 既存chargesを論理削除 → 新しい明細を生成
                $this->db->prepare("
                    UPDATE reservation_charges SET status = 'cancelled'
                    WHERE reservation_id = :id AND charge_type IN ('room', 'discount') AND status = 'active'
                ")->execute(['id' => $child['id']]);

                $childParsed = $parsed;
                $childParsed['daily_rates'] = $roomData['rates'];
                $childParsed['total_charge'] = $newAmount;
                $this->createChargeLines((int)$child['id'], $childParsed);

                // 子予約のamount更新
                $this->db->prepare("
                    UPDATE reservations SET amount = :amount, room_type = :room_type, tl_data_id = :data_id
                    WHERE id = :id
                ")->execute([
                    'amount'    => $newAmount,
                    'room_type' => $roomData['room_type'],
                    'data_id'   => $parsed['data_id'],
                    'id'        => $child['id'],
                ]);
            }

            // 親予約の合計金額・tl_data_idを更新
            $this->db->prepare("
                UPDATE reservations SET amount = :amount, tl_data_id = :data_id WHERE id = :id
            ")->execute([
                'amount'  => $parsed['total_charge'],
                'data_id' => $parsed['data_id'],
                'id'      => $parentId,
            ]);

            // イベント記録
            $this->recordEvent(
                $parentId, 'tl_modify',
                "複数室予約の金額変更（{$oldRoomCount}室）",
                json_encode([
                    'new_total' => $parsed['total_charge'],
                ], JSON_UNESCAPED_UNICODE),
                $parsed['data_id'],
                $parsed['booked_at'] ?? null
            );

            $this->db->commit();
            return $parentId;

        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    /**
     * 複数室予約の自動連結
     * 同一グループの予約をguest_linksで紐づける
     */
    private function linkMultiRoomReservations(array $reservationIds): void
    {
        // ランダムなグループIDを生成
        $groupId = 'GRP-' . strtoupper(substr(bin2hex(random_bytes(6)), 0, 12));

        $stmt = $this->db->prepare("
            INSERT INTO guest_links (group_id, reservation_id, sequence, status)
            VALUES (:group_id, :reservation_id, :sequence, 'active')
        ");

        foreach ($reservationIds as $i => $reservationId) {
            $stmt->execute([
                'group_id'       => $groupId,
                'reservation_id' => $reservationId,
                'sequence'       => $i + 1,
            ]);
        }
    }

    /**
     * 新規ゲストを作成（自動マッチングしない）
     *
     * 方針:
     * 1. 同一予約番号で既にゲストがリンクされていればそのguest_idを再利用
     *    （変更通知が新規として届いた場合や、名寄せ済みゲストの電話番号が変わっている場合に対応）
     * 2. 同一名前+電話番号（正規化済み）のアクティブゲストが存在すれば再利用
     *    （全く同じ人がOTA再予約した場合の重複防止）
     * 3. 上記に該当しなければ新規ゲスト作成
     * 4. リピーター判定（名寄せ済み）のゲストは match_status='matched' を維持
     *
     * @param string $nameRomaji ローマ字名（姓名統合）
     * @param string|null $nameKanji 漢字名（姓名統合、あれば）
     * @param string|null $phone 電話番号（TL電文から取得）
     * @param string|null $email メールアドレス（TL電文から取得）
     * @param string|null $reservationNo 予約番号（同一予約番号のゲスト再利用判定用）
     * @param string|null $channel チャネル（予約番号と組み合わせて検索）
     * @return array ['guest_id' => int, 'match_status' => string]
     */
    private function findOrCreateGuest(
        string $nameRomaji,
        ?string $nameKanji = null,
        ?string $phone = null,
        ?string $email = null,
        ?string $countryCode = null,
        ?string $preferredLanguage = null,
        ?string $reservationNo = null,
        ?string $channel = null
    ): array {
        // ── ステップ1: 同一予約番号の既存予約からguest_idを引き継ぐ ──
        // 変更通知が新規として届いた場合や、名寄せ済みゲストの再利用
        if ($reservationNo && $channel) {
            $stmt = $this->db->prepare("
                SELECT guest_id, guest_match_status
                FROM reservations
                WHERE reservation_no = :rno AND channel = :ch AND guest_id IS NOT NULL
                LIMIT 1
            ");
            $stmt->execute(['rno' => $reservationNo, 'ch' => $channel]);
            $existing = $stmt->fetch(\PDO::FETCH_ASSOC);
            if ($existing && $existing['guest_id']) {
                return [
                    'guest_id'     => (int) $existing['guest_id'],
                    'match_status' => $existing['guest_match_status'] ?: 'new_guest',
                ];
            }
        }

        // ── ステップ2: 同一名前+電話番号（正規化済み）の既存ゲストを再利用 ──
        // 電話番号を正規化（+81, ハイフン, スペース等を除去して数字のみに）
        $normalizedPhone = $phone ? preg_replace('/[^0-9]/', '', $phone) : null;
        // 先頭の国番号81を0に変換（81901234... → 0901234...）
        if ($normalizedPhone && strlen($normalizedPhone) > 10 && str_starts_with($normalizedPhone, '81')) {
            $normalizedPhone = '0' . substr($normalizedPhone, 2);
        }

        if ($normalizedPhone && strlen($normalizedPhone) >= 10) {
            // 名前（ローマ字 or 漢字）+ 電話番号の正規化版で検索
            $stmt = $this->db->prepare("
                SELECT id, name_romaji
                FROM guests
                WHERE status = 'active'
                  AND merged_into_guest_id IS NULL
                  AND REPLACE(REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '+81', '0'), '+', '') = :phone_norm
                ORDER BY id ASC
                LIMIT 1
            ");
            $stmt->execute(['phone_norm' => $normalizedPhone]);
            $matched = $stmt->fetch(\PDO::FETCH_ASSOC);
            if ($matched) {
                return [
                    'guest_id'     => (int) $matched['id'],
                    'match_status' => 'new_guest',
                ];
            }
        }

        // ── ステップ3: 該当なし → 新規ゲスト作成 ──
        $maxStmt = $this->db->query(
            "SELECT MAX(CAST(SUBSTRING(guest_code, 2) AS UNSIGNED)) FROM guests"
        );
        $maxNum = (int) $maxStmt->fetchColumn();
        $guestCode = 'G' . str_pad($maxNum + 1, 5, '0', STR_PAD_LEFT);

        $cc = $countryCode ?: 'JP';
        $lang = $preferredLanguage ?: 'ja';

        $insertStmt = $this->db->prepare("
            INSERT INTO guests (
                guest_code, name_romaji, name_kanji,
                phone, email,
                country_code, preferred_language
            ) VALUES (
                :guest_code, :name, :name_kanji,
                :phone, :email,
                :country_code, :preferred_language
            )
        ");
        $insertStmt->execute([
            'guest_code'         => $guestCode,
            'name'               => $nameRomaji,
            'name_kanji'         => $nameKanji,
            'phone'              => $phone ?: null,
            'email'              => $email ?: null,
            'country_code'       => $cc,
            'preferred_language' => $lang,
        ]);

        return [
            'guest_id'     => (int) $this->db->lastInsertId(),
            'match_status' => 'new_guest',
        ];
    }

    /**
     * 既存予約のUPDATE処理（handleNewBooking/handleModification共通）
     *
     * 変更前の状態をreservation_eventsに記録し、予約レコードを上書きする。
     * cancelledだった場合はconfirmedに復活させる。
     */
    private function updateExistingReservation(array $existing, array $parsed, string $eventType, string $eventSummary): int
    {
        // CI済み・CO済みの予約は自動変更不可（手動対応が必要）
        if (in_array($existing['status'], ['checked_in', 'checked_out'])) {
            throw new \RuntimeException(
                "CI済み予約の変更通知は自動反映不可（予約ID:{$existing['id']}, ステータス:{$existing['status']}）"
            );
        }

        $this->db->beginTransaction();
        try {
            // イベント履歴: 変更（event_atはOTA変更日時）
            $this->recordEvent(
                $existing['id'],
                $eventType,
                $eventSummary,
                json_encode([
                    'before_status'   => $existing['status'],
                    'before_checkin'  => $existing['checkin_date'],
                    'before_checkout' => $existing['checkout_date'],
                ], JSON_UNESCAPED_UNICODE),
                $parsed['data_id'],
                $parsed['booked_at'] ?? null
            );

            // cancelledだった場合はconfirmedに復活
            $newStatus = ($existing['status'] === 'cancelled') ? 'confirmed' : $existing['status'];

            // 運用フィールドを更新（tl_*原本も新しい値で更新、booked_at追加）
            $stmt = $this->db->prepare("
                UPDATE reservations SET
                    checkin_date = :checkin_date,
                    checkout_date = :checkout_date,
                    nights = :nights,
                    room_type = :room_type,
                    amount = :amount,
                    adult_count = :adult_count,
                    child_count = :child_count,
                    male_count = :male_count,
                    female_count = :female_count,
                    child_a_count = :child_a_count,
                    child_b_count = :child_b_count,
                    child_c_count = :child_c_count,
                    child_d_count = :child_d_count,
                    status = :status,
                    booked_at = :booked_at,
                    tl_last_name = :tl_last_name,
                    tl_first_name = :tl_first_name,
                    tl_checkin_date = :tl_checkin_date,
                    tl_checkout_date = :tl_checkout_date,
                    tl_room_type = :tl_room_type,
                    tl_data_id = :tl_data_id,
                    tl_plan_name = :tl_plan_name,
                    tl_plan_code = :tl_plan_code,
                    tl_settlement_type = :tl_settlement_type,
                    tl_commission = :tl_commission,
                    tl_rate_type = :tl_rate_type,
                    tl_other_info = :tl_other_info,
                    tl_telegram_data = :tl_telegram_data
                WHERE id = :id
            ");
            $stmt->execute([
                'checkin_date'       => $parsed['checkin_date'],
                'checkout_date'      => $parsed['checkout_date'],
                'nights'             => $parsed['nights'],
                'room_type'          => $parsed['room_type'],
                'amount'             => $parsed['total_charge'],
                'adult_count'        => $parsed['adult_count'],
                'child_count'        => $parsed['child_count'],
                'male_count'         => $parsed['male_count'] ?? 0,
                'female_count'       => $parsed['female_count'] ?? 0,
                'child_a_count'      => $parsed['child_a_count'] ?? 0,
                'child_b_count'      => $parsed['child_b_count'] ?? 0,
                'child_c_count'      => $parsed['child_c_count'] ?? 0,
                'child_d_count'      => $parsed['child_d_count'] ?? 0,
                'status'             => $newStatus,
                'booked_at'          => $parsed['booked_at'] ?? null,
                'tl_last_name'       => $parsed['name'],
                'tl_first_name'      => '',
                'tl_checkin_date'    => $parsed['checkin_date'],
                'tl_checkout_date'   => $parsed['checkout_date'],
                'tl_room_type'       => $parsed['room_type'],
                'tl_data_id'         => $parsed['data_id'],
                'tl_plan_name'       => $parsed['plan_name'] ?: null,
                'tl_plan_code'       => $parsed['plan_code'] ?: null,
                'tl_settlement_type' => $parsed['settlement_type'],
                'tl_commission'      => $parsed['commission'] ?: null,
                'tl_rate_type'       => $parsed['rate_type'],
                'tl_other_info'      => $parsed['other_info'] ?: null,
                'tl_telegram_data'   => $parsed['telegram_data'] ?: null,
                'id'                 => $existing['id'],
            ]);

            // 既存の宿泊料・割引明細を論理削除→新しい明細を生成
            // payment行は触らない（スタッフが手動修正している可能性があるため）
            $this->db->prepare("
                UPDATE reservation_charges SET status = 'cancelled'
                WHERE reservation_id = :id AND charge_type IN ('room', 'discount') AND status = 'active'
            ")->execute(['id' => $existing['id']]);

            $this->createChargeLines($existing['id'], $parsed);

            // 日程変更時はアサインを解除（CI前なので物理削除OK — CLAUDE.md準拠）
            if ($parsed['checkin_date'] !== $existing['checkin_date']
                || $parsed['checkout_date'] !== $existing['checkout_date']) {
                $this->db->prepare("
                    DELETE FROM room_assignments WHERE reservation_id = :id
                ")->execute(['id' => $existing['id']]);
            }

            $this->db->commit();
            return $existing['id'];

        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    /**
     * 統合済み予約への変更通知の処理
     *
     * source経由でヒットした場合の判定:
     * - 日程変更あり → merge_alert（自動処理しない）
     * - 金額変更のみ（日程不変） → chargesの該当日付を更新 + source.amount更新
     */
    private function handleMergedReservationModification(array $existing, array $parsed): int
    {
        $parentId = (int) $existing['id'];
        $sourceCi = $existing['source_ci'];
        $sourceCo = $existing['source_co'];

        // 日程変更があるかチェック
        $hasDateChange = ($parsed['checkin_date'] !== $sourceCi || $parsed['checkout_date'] !== $sourceCo);

        if ($hasDateChange) {
            // 日程変更あり → アラートのみ（自動処理しない）
            $this->recordMergeAlert(
                $parentId,
                $parsed['reservation_no'],
                'date_change',
                '統合予約の一部に日程変更がありました',
                $parsed,
                [
                    'before_ci' => $sourceCi,
                    'before_co' => $sourceCo,
                    'after_ci'  => $parsed['checkin_date'],
                    'after_co'  => $parsed['checkout_date'],
                ]
            );
            return $parentId;
        }

        // 金額変更のみ → 自動反映
        $this->db->beginTransaction();
        try {
            // 該当日付のchargesを更新（source範囲内の日別明細）
            // 既存の宿泊料・割引明細を論理削除（payment行は手動修正の可能性があるため維持）
            $this->db->prepare("
                UPDATE reservation_charges SET status = 'cancelled'
                WHERE reservation_id = :parent_id
                  AND charge_type IN ('room', 'discount') AND status = 'active'
                  AND date >= :ci AND date < :co
            ")->execute([
                'parent_id' => $parentId,
                'ci'        => $sourceCi,
                'co'        => $sourceCo,
            ]);

            // 新しい明細を生成
            if (!empty($parsed['daily_rates'])) {
                $stmt = $this->db->prepare("
                    INSERT INTO reservation_charges (reservation_id, date, charge_type, description, amount, status)
                    VALUES (:rid, :date, 'room', :desc, :amount, 'active')
                ");
                foreach ($parsed['daily_rates'] as $rate) {
                    $stmt->execute([
                        'rid'    => $parentId,
                        'date'   => $rate['date'],
                        'desc'   => $parsed['plan_name'] ?: '宿泊料',
                        'amount' => $rate['amount'],
                    ]);
                }
            }

            // source.amount を更新
            $this->db->prepare("
                UPDATE reservation_sources SET amount = :amount
                WHERE reservation_id = :parent_id
                  AND reservation_no = :resno AND channel = :channel
            ")->execute([
                'amount'    => $parsed['total_charge'],
                'parent_id' => $parentId,
                'resno'     => $parsed['reservation_no'],
                'channel'   => $parsed['channel'],
            ]);

            // 親予約のamountを再計算
            $stmt = $this->db->prepare("
                SELECT COALESCE(SUM(amount), 0) FROM reservation_charges
                WHERE reservation_id = :rid AND status = 'active' AND charge_type NOT IN ('payment','refund')
            ");
            $stmt->execute(['rid' => $parentId]);
            $newTotal = (int) $stmt->fetchColumn();
            $this->db->prepare("UPDATE reservations SET amount = :total WHERE id = :id")
                ->execute(['total' => $newTotal, 'id' => $parentId]);

            // イベント記録（event_atはOTA変更日時）
            $this->recordEvent(
                $parentId, 'tl_modify',
                "統合予約の金額変更（{$parsed['reservation_no']}）",
                json_encode([
                    'source_reservation_no' => $parsed['reservation_no'],
                    'before_amount'         => (int) $existing['source_amount'],
                    'after_amount'          => $parsed['total_charge'],
                ], JSON_UNESCAPED_UNICODE),
                $parsed['data_id'],
                $parsed['booked_at'] ?? null
            );

            $this->db->commit();
            return $parentId;

        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    /**
     * 統合予約への影響アラートを記録
     *
     * TL通知が統合子の予約番号で届き、自動処理できない場合に
     * merge_alert イベントとして記録。ダッシュボードに表示される。
     */
    private function recordMergeAlert(
        int $parentReservationId,
        string $sourceReservationNo,
        string $alertType,
        string $summary,
        array $parsed,
        array $extra = []
    ): void {
        $detail = array_merge([
            'alert_type'            => $alertType,
            'source_reservation_no' => $sourceReservationNo,
            'channel'               => $parsed['channel'],
            'data_id'               => $parsed['data_id'],
        ], $extra);

        // merge_alertのevent_atは「通知を受信した時刻」=NOW()にする。
        // booked_at（OTA予約日）を使うと過去日になり、ダッシュボードの期間フィルタに引っかからない。
        $this->recordEvent(
            $parentReservationId,
            'merge_alert',
            $summary,
            json_encode($detail, JSON_UNESCAPED_UNICODE),
            $parsed['data_id'],
            null  // null → recordEvent内で NOW() になる
        );
    }

    /**
     * reservation_eventsにイベントを記録するヘルパー
     *
     * @param int $reservationId 予約ID
     * @param string $type イベント種別（tl_new, tl_modify, tl_cancel等）
     * @param string $summary 概要テキスト
     * @param string|null $detail 詳細（JSON等）
     * @param string|null $tlDataId TL電文のDataID
     */
    /**
     * @param string|null $eventAt イベント日時。OTA予約日時（booked_at）を渡す。NULLならNOW()
     */
    private function recordEvent(int $reservationId, string $type, string $summary, ?string $detail = null, ?string $tlDataId = null, ?string $eventAt = null): void
    {
        $this->db->prepare("
            INSERT INTO reservation_events (reservation_id, event_type, event_at, summary, detail, tl_data_id)
            VALUES (:reservation_id, :event_type, COALESCE(:event_at, NOW()), :summary, :detail, :tl_data_id)
        ")->execute([
            'reservation_id' => $reservationId,
            'event_type'     => $type,
            'event_at'       => $eventAt,
            'summary'        => $summary,
            'detail'         => $detail,
            'tl_data_id'     => $tlDataId,
        ]);
    }

    /**
     * 同じ予約番号の過去エラーログを自動解消
     * 再処理成功時にダッシュボードのアラートから消すため
     */
    private function resolveOldErrors(string $reservationNo): void
    {
        $this->db->prepare("
            UPDATE tl_import_logs
            SET resolved_at = NOW()
            WHERE reservation_no = :rno AND parse_status = 'error' AND resolved_at IS NULL
        ")->execute(['rno' => $reservationNo]);
    }
}
