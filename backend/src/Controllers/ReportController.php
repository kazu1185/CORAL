<?php

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Services\IncomeReportService;
use App\Services\IncomeReportPdfService;

/**
 * 売上・レポートコントローラー
 */
class ReportController
{
    /** GET /api/v1/reports/daily */
    public function daily(Request $request): void
    {
        // TODO: 日計レポート
        Response::error('未実装です', 501);
    }

    /** GET /api/v1/reports/monthly */
    public function monthly(Request $request): void
    {
        // TODO: 月計レポート
        Response::error('未実装です', 501);
    }

    /** GET /api/v1/reports/occupancy */
    public function occupancy(Request $request): void
    {
        // TODO: 稼働率レポート
        Response::error('未実装です', 501);
    }

    /**
     * GET /api/v1/reports/products?from=YYYY-MM-DD&to=YYYY-MM-DD
     * 物販の売上集計（商品別・税率別・即売/部屋付け別・支払方法別）
     *
     * 集計元は product_sales（active のみ）。売上がどの経路で計上されるかの整理:
     *   部屋付け … reservation_charges に charge_type='goods' の行があり、
     *              予約の請求額（reservations.amount）と領収書にはそちら経由で乗る
     *   即売     … reservation_charges には行が無く、product_sales にしか存在しない
     *
     * 収入実績・予測表（IncomeReportService）は両方を「売上金額」に含めており、
     * その内数を「物販」列に出している。つまりこのレポートの合計 = 同表の物販列の合計。
     * このレポートは物販の内訳を見るためのものなので、収入実績表に足し合わせないこと
     */
    public function products(Request $request): void
    {
        $from = $request->query['from'] ?? date('Y-m-01');
        $to   = $request->query['to']   ?? date('Y-m-d');

        foreach (['from' => $from, 'to' => $to] as $key => $value) {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
                Response::error("{$key} パラメータの形式が不正です（YYYY-MM-DD）", 400);
            }
        }

        $db = \App\Core\Database::getInstance();
        $params = ['from_date' => $from, 'to_date' => $to];

        // 商品別（数量・金額）。商品名は販売時のスナップショットで集計する
        // （マスタで改名しても当時の売上として集計が変わらないように）
        $byProduct = $db->prepare("
            SELECT product_id, product_name, tax_rate,
                   SUM(quantity) AS quantity,
                   SUM(amount) AS amount,
                   SUM(tax_amount) AS tax_amount
            FROM product_sales
            WHERE sale_date BETWEEN :from_date AND :to_date AND status = 'active'
            GROUP BY product_id, product_name, tax_rate
            ORDER BY amount DESC
        ");
        $byProduct->execute($params);

        // 税率別（インボイスの区分確認用）
        $byTaxRate = $db->prepare("
            SELECT tax_rate,
                   SUM(amount) AS amount,
                   SUM(tax_amount) AS tax_amount
            FROM product_sales
            WHERE sale_date BETWEEN :from_date AND :to_date AND status = 'active'
            GROUP BY tax_rate
            ORDER BY tax_rate DESC
        ");
        $byTaxRate->execute($params);

        // 即売 / 部屋付け の内訳
        $byType = $db->prepare("
            SELECT IF(reservation_id IS NULL, 'immediate', 'room_charge') AS sale_type,
                   COUNT(*) AS line_count,
                   SUM(quantity) AS quantity,
                   SUM(amount) AS amount,
                   SUM(tax_amount) AS tax_amount
            FROM product_sales
            WHERE sale_date BETWEEN :from_date AND :to_date AND status = 'active'
            GROUP BY sale_type
        ");
        $byType->execute($params);

        // 支払方法別（即売のみ。部屋付けはCO精算時に決まるためここでは集計できない）
        $byPayment = $db->prepare("
            SELECT ps.payment_method_id, pm.method_name,
                   SUM(ps.quantity) AS quantity,
                   SUM(ps.amount) AS amount
            FROM product_sales ps
            LEFT JOIN payment_methods pm ON pm.id = ps.payment_method_id
            WHERE ps.sale_date BETWEEN :from_date AND :to_date
              AND ps.status = 'active'
              AND ps.reservation_id IS NULL
            GROUP BY ps.payment_method_id, pm.method_name
            ORDER BY amount DESC
        ");
        $byPayment->execute($params);

        $byTypeRows = $byType->fetchAll(\PDO::FETCH_ASSOC);
        $totalAmount = array_sum(array_column($byTypeRows, 'amount'));
        $totalTax    = array_sum(array_column($byTypeRows, 'tax_amount'));

        Response::json([
            'from' => $from,
            'to'   => $to,
            'summary' => [
                'total_amount' => (int) $totalAmount,
                'tax_amount'   => (int) $totalTax,
            ],
            'by_product'        => $byProduct->fetchAll(\PDO::FETCH_ASSOC),
            'by_tax_rate'       => $byTaxRate->fetchAll(\PDO::FETCH_ASSOC),
            'by_sale_type'      => $byTypeRows,
            'by_payment_method' => $byPayment->fetchAll(\PDO::FETCH_ASSOC),
        ]);
    }

    /** GET /api/v1/reports/export */
    public function export(Request $request): void
    {
        // TODO: CSVエクスポート
        Response::error('未実装です', 501);
    }

    /**
     * GET /api/v1/reports/income-pdf
     *
     * 収入実績・予測表PDFを生成して返す
     * クエリパラメータ:
     *   - month:  対象年月 'YYYY-MM'（省略時: 当月）
     *   - cutoff: 業績日付 'YYYY-MM-DD'（省略時: 今日）
     */
    public function incomePdf(Request $request): void
    {
        $month = $request->query['month'] ?? date('Y-m');
        $cutoff = $request->query['cutoff'] ?? date('Y-m-d');

        // バリデーション: month形式チェック
        if (!preg_match('/^\d{4}-\d{2}$/', $month)) {
            Response::error('month パラメータの形式が不正です（YYYY-MM）', 400);
            return;
        }
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $cutoff)) {
            Response::error('cutoff パラメータの形式が不正です（YYYY-MM-DD）', 400);
            return;
        }

        $db = \App\Core\Database::getInstance();

        // データ集計
        $service = new IncomeReportService($db);
        $data = $service->collectDailyData($month, $cutoff);

        // PDF生成
        $pdfService = new IncomeReportPdfService();
        $pdfBinary = $pdfService->generate($data, $month);

        // PDFバイナリをレスポンス
        header('Content-Type: application/pdf');
        header('Content-Disposition: inline; filename="income_report_' . $month . '.pdf"');
        header('Content-Length: ' . strlen($pdfBinary));
        echo $pdfBinary;
        exit;
    }
}
