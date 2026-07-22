<?php

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Database;
use App\Services\DocumentService;
use App\Services\ReceiptPdfService;
use PDO;

/**
 * 帳票コントローラー（領収書・請求書）
 * ルート定義: config/routes.php
 * 権限: receipt.issue / invoice.issue
 */
class DocumentController
{
    /**
     * POST /api/v1/documents/receipt — 領収書発行
     *
     * リクエストボディ:
     * - reservation_id (必須): 予約ID
     * - addressee (必須): 宛名
     * - description: 但し書き（デフォルト: 宿泊代として）
     * - payment_method_id: 決済方法ID
     * - charge_ids: 対象明細IDの配列（分割発行用。省略時は全明細）
     * - group: true の場合、グループ全室一括発行
     * - save_addressee: true の場合、宛名をゲストに保存
     */
    public function issueReceipt(Request $request): void
    {
        $db = Database::getInstance();
        $body = $request->body;
        $staffId = $request->auth['staff_id'];

        $reservationId = (int) ($body['reservation_id'] ?? 0);
        $addressee = trim($body['addressee'] ?? '');
        $description = trim($body['description'] ?? '宿泊代として');
        $paymentMethodId = !empty($body['payment_method_id']) ? (int) $body['payment_method_id'] : null;
        $chargeIds = $body['charge_ids'] ?? null;
        $isGroup = !empty($body['group']);
        $saveAddressee = !empty($body['save_addressee']);

        if (!$reservationId) {
            Response::error('reservation_id は必須です', 400);
        }
        if ($addressee === '') {
            Response::error('宛名は必須です', 400);
        }

        $service = new DocumentService();

        $db->beginTransaction();
        try {
            if ($isGroup) {
                // グループ全室一括発行
                $documentId = $service->issueGroupReceipt(
                    $db, $reservationId, $addressee, $description, $staffId, $paymentMethodId, $saveAddressee
                );
            } else {
                // 通常発行（分割発行対応）
                $documentId = $service->issueReceipt(
                    $db, $reservationId, $addressee, $description, $staffId, $paymentMethodId, $chargeIds, $saveAddressee
                );
            }
            $db->commit();
        } catch (\RuntimeException $e) {
            $db->rollBack();
            Response::error($e->getMessage(), 400);
        } catch (\Exception $e) {
            $db->rollBack();
            Response::error('領収書の発行に失敗しました: ' . $e->getMessage(), 500);
        }

        Response::json([
            'document_id' => $documentId,
            'message'     => '領収書を発行しました',
        ]);
    }

    /**
     * POST /api/v1/documents/sales-receipt — 即売の領収書発行
     *
     * リクエストボディ:
     * - sale_ids (必須): product_sales.id の配列
     * - addressee (必須): 宛名
     * - description: 但し書き（デフォルト: 品代として）
     * - payment_method_id: 決済方法ID
     */
    public function issueSalesReceipt(Request $request): void
    {
        $db = Database::getInstance();
        $body = $request->body;
        $staffId = $request->auth['staff_id'];

        $saleIds = $body['sale_ids'] ?? null;
        $addressee = trim($body['addressee'] ?? '');
        // 但し書きは物販なので「宿泊代として」ではなく「品代として」を既定にする
        $description = trim($body['description'] ?? '品代として');
        $paymentMethodId = !empty($body['payment_method_id']) ? (int) $body['payment_method_id'] : null;

        if (!is_array($saleIds) || empty($saleIds)) {
            Response::error('sale_ids は必須です', 400);
        }
        if ($addressee === '') {
            Response::error('宛名は必須です', 400);
        }

        $service = new DocumentService();

        $db->beginTransaction();
        try {
            $documentId = $service->issueSalesReceipt(
                $db, array_map('intval', $saleIds), $addressee, $description, $staffId, $paymentMethodId
            );
            $db->commit();
        } catch (\RuntimeException $e) {
            $db->rollBack();
            Response::error($e->getMessage(), 400);
        } catch (\Exception $e) {
            $db->rollBack();
            Response::error('領収書の発行に失敗しました: ' . $e->getMessage(), 500);
        }

        Response::json([
            'document_id' => $documentId,
            'message'     => '領収書を発行しました',
        ]);
    }

    /** POST /api/v1/documents/invoice — 請求書発行（未実装） */
    public function issueInvoice(Request $request): void
    {
        Response::error('未実装です', 501);
    }

    /**
     * GET /api/v1/documents/:id — 帳票詳細 or PDF取得
     *
     * クエリパラメータ:
     * - format=pdf: PDFバイナリを返す
     * - download=1: Content-Dispositionにattachmentを付与（ダウンロード用）
     * - デフォルト: JSON形式で返す
     */
    public function show(Request $request): void
    {
        $db = Database::getInstance();
        $id = (int) $request->params['id'];
        $format = $request->query['format'] ?? 'json';
        $download = !empty($request->query['download']);

        // ドキュメント取得
        // 支払方法名は領収書PDFの「お支払方法」欄に出すため一緒に引く
        $stmt = $db->prepare("
            SELECT d.*, s.staff_name AS issued_by_name, pm.method_name AS payment_method_name
            FROM documents d
            LEFT JOIN staff s ON s.id = d.issued_by
            LEFT JOIN payment_methods pm ON pm.id = d.payment_method_id
            WHERE d.id = :id
        ");
        $stmt->execute(['id' => $id]);
        $document = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$document) {
            Response::error('帳票が見つかりません', 404);
        }

        // 明細取得
        $stmt = $db->prepare("
            SELECT di.*, rc.charge_type
            FROM document_items di
            LEFT JOIN reservation_charges rc ON rc.id = di.charge_id
            WHERE di.document_id = :did
            ORDER BY di.date, di.id
        ");
        $stmt->execute(['did' => $id]);
        $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

        if ($format === 'pdf') {
            // ホテル情報取得
            $hotelInfo = $db->query("SELECT * FROM hotel_settings LIMIT 1")->fetch(PDO::FETCH_ASSOC) ?: [];

            // PDF生成
            $pdfService = new ReceiptPdfService();
            $pdfBinary = $pdfService->generate($document, $items, $hotelInfo);

            // PDFレスポンス（Response::json()ではなく直接出力）
            $filename = "{$document['document_number']}.pdf";
            header('Content-Type: application/pdf');
            if ($download) {
                header("Content-Disposition: attachment; filename=\"{$filename}\"");
            } else {
                header("Content-Disposition: inline; filename=\"{$filename}\"");
            }
            header('Content-Length: ' . strlen($pdfBinary));
            echo $pdfBinary;
            exit;
        }

        // JSON形式
        $document['items'] = $items;
        Response::json($document);
    }

    /**
     * GET /api/v1/documents — 帳票一覧
     *
     * クエリパラメータ:
     * - reservation_id: 特定予約の帳票のみ
     * - type: receipt / invoice
     * - page, per_page
     */
    public function index(Request $request): void
    {
        $db = Database::getInstance();
        $q = $request->query;

        $where = ["d.status = 'issued'"];
        $params = [];

        if (!empty($q['reservation_id'])) {
            $where[] = "d.reservation_id = :rid";
            $params['rid'] = (int) $q['reservation_id'];
        }
        if (!empty($q['type'])) {
            $where[] = "d.type = :type";
            $params['type'] = $q['type'];
        }

        $whereClause = implode(' AND ', $where);
        $page = max(1, (int)($q['page'] ?? 1));
        $perPage = min(100, max(1, (int)($q['per_page'] ?? 50)));
        $offset = ($page - 1) * $perPage;

        // 件数取得
        $countStmt = $db->prepare("SELECT COUNT(*) FROM documents d WHERE {$whereClause}");
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        // データ取得
        $stmt = $db->prepare("
            SELECT d.id, d.document_number, d.type, d.reservation_id,
                   d.addressee, d.total, d.issued_at, d.reissue_count,
                   d.original_document_id, d.status,
                   s.staff_name AS issued_by_name
            FROM documents d
            LEFT JOIN staff s ON s.id = d.issued_by
            WHERE {$whereClause}
            ORDER BY d.issued_at DESC
            LIMIT {$perPage} OFFSET {$offset}
        ");
        $stmt->execute($params);
        $documents = $stmt->fetchAll(PDO::FETCH_ASSOC);

        Response::paginated($documents, $total, $page, $perPage);
    }

    /**
     * POST /api/v1/documents/:id/reissue — 再発行
     *
     * リクエストボディ:
     * - addressee: 宛名（変更可能。省略時は元の宛名を引き継ぐ）
     * - description: 但し書き（変更可能）
     */
    public function reissue(Request $request): void
    {
        $db = Database::getInstance();
        $originalId = (int) $request->params['id'];
        $body = $request->body;
        $staffId = $request->auth['staff_id'];

        // 元ドキュメントの取得（宛名・但し書きのデフォルト値として使用）
        $stmt = $db->prepare("SELECT addressee, description FROM documents WHERE id = :id AND status = 'issued'");
        $stmt->execute(['id' => $originalId]);
        $original = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$original) {
            Response::error('元の帳票が見つかりません', 404);
        }

        $addressee = trim($body['addressee'] ?? $original['addressee']);
        $description = trim($body['description'] ?? $original['description']);

        $service = new DocumentService();

        $db->beginTransaction();
        try {
            $newDocumentId = $service->reissueDocument($db, $originalId, $addressee, $description, $staffId);
            $db->commit();
        } catch (\RuntimeException $e) {
            $db->rollBack();
            Response::error($e->getMessage(), 400);
        } catch (\Exception $e) {
            $db->rollBack();
            Response::error('再発行に失敗しました: ' . $e->getMessage(), 500);
        }

        Response::json([
            'document_id' => $newDocumentId,
            'message'     => '領収書を再発行しました',
        ]);
    }
}
