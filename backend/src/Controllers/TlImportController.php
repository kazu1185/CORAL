<?php

namespace App\Controllers;

use App\Core\Database;
use App\Core\Request;
use App\Core\Response;
use App\Services\TlImportService;
use PDO;

/**
 * TL取込コントローラー
 * ダッシュボードからの手動トリガーと取込ログの閲覧
 */
class TlImportController
{
    /**
     * POST /api/v1/tl-import/process
     * 指定ディレクトリのXMLファイルを一括取込
     */
    public function process(Request $request): void
    {
        $inputDir = $request->body['input_dir'] ?? null;

        if (!$inputDir || !is_dir($inputDir)) {
            Response::error('有効な入力ディレクトリを指定してください', 400);
        }

        $service = new TlImportService();
        $result = $service->processDirectory($inputDir);

        Response::json([
            'message' => 'TL取込処理が完了しました',
            'summary' => [
                'processed' => $result['processed'],
                'new'       => $result['new'],
                'modify'    => $result['modify'],
                'cancel'    => $result['cancel'],
                'duplicate' => $result['duplicate'],
                'errors'    => $result['errors'],
            ],
        ]);
    }

    /**
     * GET /api/v1/tl-import/logs
     * 取込ログ一覧（ページネーション・フィルタ付き）
     */
    public function logs(Request $request): void
    {
        $db = Database::getInstance();
        $page = max(1, (int)($request->query['page'] ?? 1));
        $perPage = min(100, max(10, (int)($request->query['per_page'] ?? 30)));
        $status = $request->query['status'] ?? null;

        $where = '';
        $params = [];
        if ($status) {
            $where = 'WHERE parse_status = :status';
            $params['status'] = $status;
        }

        // 件数取得
        $countStmt = $db->prepare("SELECT COUNT(*) FROM tl_import_logs {$where}");
        $countStmt->execute($params);
        $total = (int)$countStmt->fetchColumn();

        // データ取得
        $offset = ($page - 1) * $perPage;
        $dataStmt = $db->prepare("
            SELECT id, received_at, reservation_no, channel, file_path,
                   parse_status, reservation_id, error_message, import_type
            FROM tl_import_logs
            {$where}
            ORDER BY received_at DESC
            LIMIT {$perPage} OFFSET {$offset}
        ");
        $dataStmt->execute($params);

        Response::paginated($dataStmt->fetchAll(PDO::FETCH_ASSOC), $total, $page, $perPage);
    }
}
