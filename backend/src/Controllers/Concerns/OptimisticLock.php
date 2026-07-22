<?php

namespace App\Controllers\Concerns;

use App\Core\Database;
use App\Core\Response;

/**
 * 楽観ロック（同時更新の競合防止）の共通実装
 *
 * 以前は ReservationController / CheckinController に同じロジックが
 * 別々に実装されていた（規約 #16 の「共通ヘルパー」が実体としては2重定義）ため、
 * Trait に集約した。予約更新系のコントローラーを新設する場合はこの Trait を use すること。
 */
trait OptimisticLock
{
    /**
     * クライアントが保持する updated_at と DB の現在値を比較し、
     * 不一致なら 409 Conflict を返して終了する（= 別スタッフが先に更新した）。
     *
     * @param int         $reservationId     対象予約ID
     * @param string|null $expectedUpdatedAt クライアントが保持している updated_at
     *                                       （null の場合は後方互換のためチェックをスキップ）
     */
    private function checkOptimisticLock(int $reservationId, ?string $expectedUpdatedAt): void
    {
        // updated_at が送られていない場合はチェックをスキップ（後方互換）
        if (!$expectedUpdatedAt) return;

        // Database::getInstance() はシングルトンなので、呼出側のPDOを引き回す必要はない
        $db = Database::getInstance();
        $stmt = $db->prepare("SELECT updated_at FROM reservations WHERE id = :id");
        $stmt->execute(['id' => $reservationId]);
        $current = $stmt->fetchColumn();

        if ($current && $current !== $expectedUpdatedAt) {
            Response::error(
                'この予約は別のスタッフによって更新されています。画面を再読み込みしてください。',
                409
            );
        }
    }
}
