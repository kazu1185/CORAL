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
    /**
     * GET /api/v1/reports/daily?date=YYYY-MM-DD
     * 日計（その日の締め作業用）
     *
     * 売上の集計定義は収入実績・予測表（IncomeReportService）と揃えている:
     *   売上 = reservation_charges の room/addon/discount/goods ＋ 物販の即売
     *   即売は reservation_charges に行が無いため product_sales から加算する
     *   （reservation_id IS NULL で絞らないと部屋付けが二重計上になる）
     *
     * 入金は「その日に受け取ったお金」なので、予約の入金行に加えて即売分も含める。
     * 即売はその場で決済が完了しているため
     */
    public function daily(Request $request): void
    {
        $date = $request->query['date'] ?? date('Y-m-d');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            Response::error('date パラメータの形式が不正です（YYYY-MM-DD）', 400);
        }

        $db = \App\Core\Database::getInstance();

        // --- 売上（予約明細）---
        $stmt = $db->prepare("
            SELECT
                COALESCE(SUM(CASE WHEN rc.charge_type = 'room' THEN rc.amount ELSE 0 END), 0) AS room_sales,
                COALESCE(SUM(CASE WHEN rc.charge_type = 'goods' THEN rc.amount ELSE 0 END), 0) AS goods_charged,
                COALESCE(SUM(CASE WHEN rc.charge_type IN ('addon','discount') THEN rc.amount ELSE 0 END), 0) AS other_sales,
                COALESCE(SUM(rc.tax_amount), 0) AS tax_amount,
                COALESCE(SUM(rc.accommodation_tax), 0) AS accommodation_tax
            FROM reservation_charges rc
            JOIN reservations r ON r.id = rc.reservation_id
            WHERE rc.date = :sales_date
              AND rc.status = 'active'
              AND rc.charge_type IN ('room','addon','discount','goods')
              AND r.status NOT IN ('cancelled','no_show','merged','group_parent')
        ");
        $stmt->execute(['sales_date' => $date]);
        $sales = $stmt->fetch(\PDO::FETCH_ASSOC);

        // --- 物販の即売 ---
        $stmt = $db->prepare("
            SELECT COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(tax_amount), 0) AS tax_amount
            FROM product_sales
            WHERE sale_date = :imm_date AND status = 'active' AND reservation_id IS NULL
        ");
        $stmt->execute(['imm_date' => $date]);
        $immediate = $stmt->fetch(\PDO::FETCH_ASSOC);

        $goodsTotal = (int) $sales['goods_charged'] + (int) $immediate['amount'];
        $totalSales = (int) $sales['room_sales'] + (int) $sales['other_sales'] + $goodsTotal;

        // --- 入金（予約の入金行。返金はマイナス扱いで別途集計）---
        $stmt = $db->prepare("
            SELECT pm.id AS payment_method_id, COALESCE(pm.method_name, '未設定') AS method_name,
                   SUM(rc.amount) AS amount
            FROM reservation_charges rc
            LEFT JOIN payment_methods pm ON pm.id = rc.payment_method_id
            WHERE rc.date = :pay_date AND rc.status = 'active' AND rc.charge_type = 'payment'
            GROUP BY pm.id, pm.method_name
        ");
        $stmt->execute(['pay_date' => $date]);
        $paymentRows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

        // --- 入金（即売。その場で決済済みなので当日の入金に含める）---
        $stmt = $db->prepare("
            SELECT pm.id AS payment_method_id, COALESCE(pm.method_name, '未設定') AS method_name,
                   SUM(ps.amount) AS amount
            FROM product_sales ps
            LEFT JOIN payment_methods pm ON pm.id = ps.payment_method_id
            WHERE ps.sale_date = :ipay_date AND ps.status = 'active' AND ps.reservation_id IS NULL
            GROUP BY pm.id, pm.method_name
        ");
        $stmt->execute(['ipay_date' => $date]);

        // 決済方法ごとに予約分と即売分をまとめる
        $payments = [];
        foreach (array_merge($paymentRows, $stmt->fetchAll(\PDO::FETCH_ASSOC)) as $row) {
            $key = $row['payment_method_id'] ?? 0;
            if (!isset($payments[$key])) {
                $payments[$key] = [
                    'payment_method_id' => $row['payment_method_id'] ? (int) $row['payment_method_id'] : null,
                    'method_name'       => $row['method_name'],
                    'amount'            => 0,
                ];
            }
            $payments[$key]['amount'] += (int) $row['amount'];
        }
        $payments = array_values($payments);
        usort($payments, fn($a, $b) => $b['amount'] <=> $a['amount']);
        $paymentTotal = array_sum(array_column($payments, 'amount'));

        // --- 返金（当日分。入金とは分けて表示する）---
        $stmt = $db->prepare("
            SELECT COALESCE(SUM(amount), 0) FROM reservation_charges
            WHERE date = :ref_date AND status = 'active' AND charge_type = 'refund'
        ");
        $stmt->execute(['ref_date' => $date]);
        $refundTotal = (int) $stmt->fetchColumn();

        // --- CI / CO 件数 ---
        $stmt = $db->prepare("
            SELECT
                (SELECT COUNT(*) FROM reservations WHERE DATE(actual_checkin_at) = :ci_date) AS checkin_count,
                (SELECT COUNT(*) FROM reservations WHERE DATE(actual_checkout_at) = :co_date) AS checkout_count
        ");
        $stmt->execute(['ci_date' => $date, 'co_date' => $date]);
        $movements = $stmt->fetch(\PDO::FETCH_ASSOC);

        // --- 稼働（その日に滞在しているアサイン数）---
        // 規約 #3: 同名プレースホルダは使えないため別名にする
        $stmt = $db->prepare("
            SELECT COUNT(*) FROM room_assignments
            WHERE status = 'active' AND check_in_date <= :occ_date AND check_out_date > :occ_date2
        ");
        $stmt->execute(['occ_date' => $date, 'occ_date2' => $date]);
        $soldRooms = (int) $stmt->fetchColumn();

        $physicalRooms = (int) $db->query("SELECT COUNT(*) FROM rooms WHERE status = 'available'")->fetchColumn();

        // --- 未収（在室中の予約の売上 − 入金）---
        // その日の締めで回収漏れを見つけるための指標
        $stmt = $db->prepare("
            SELECT COALESCE(SUM(
                (SELECT COALESCE(SUM(rc.amount), 0) FROM reservation_charges rc
                  WHERE rc.reservation_id = r.id AND rc.status = 'active'
                    AND rc.charge_type NOT IN ('payment','refund'))
              - (SELECT COALESCE(SUM(rc2.amount), 0) FROM reservation_charges rc2
                  WHERE rc2.reservation_id = r.id AND rc2.status = 'active'
                    AND rc2.charge_type = 'payment')
            ), 0)
            FROM reservations r
            WHERE r.status = 'checked_in'
        ");
        $stmt->execute();
        $unpaidInHouse = (int) $stmt->fetchColumn();

        Response::json([
            'date' => $date,
            'sales' => [
                'room'              => (int) $sales['room_sales'],
                'goods'             => $goodsTotal,
                'goods_charged'     => (int) $sales['goods_charged'],   // 内訳: 部屋付け
                'goods_immediate'   => (int) $immediate['amount'],      // 内訳: 即売
                'other'             => (int) $sales['other_sales'],
                'total'             => $totalSales,
                'tax_amount'        => (int) $sales['tax_amount'] + (int) $immediate['tax_amount'],
                'accommodation_tax' => (int) $sales['accommodation_tax'],
            ],
            'payments'       => $payments,
            'payment_total'  => $paymentTotal,
            'refund_total'   => $refundTotal,
            'movements'      => [
                'checkin_count'  => (int) $movements['checkin_count'],
                'checkout_count' => (int) $movements['checkout_count'],
            ],
            'rooms' => [
                'physical'  => $physicalRooms,
                'sold'      => $soldRooms,
                'occupancy' => $physicalRooms > 0 ? round($soldRooms / $physicalRooms * 100, 1) : 0,
            ],
            'unpaid_in_house' => $unpaidInHouse,
        ]);
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
