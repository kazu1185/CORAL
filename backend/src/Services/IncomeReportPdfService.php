<?php

namespace App\Services;

use TCPDF;
use TCPDF_FONTS;

/**
 * 収入実績・予測表 PDF描画サービス
 *
 * A4横で日別の収入データをテーブル形式で出力する。
 * 参考PDF（r0490_income_comparison_report）のレイアウトに準拠:
 * - 白黒ベースの帳票デザイン（罫線テーブル）
 * - ヘッダー: タイトル / 対象年月 / 出力日時 / 業績日付 / ページ番号
 * - 列: 日・物理室数・販売室数・稼働率・売上金額・入数(大人/小人/計)
 *        ・前年(販売室数/稼働率/売上/入数)・室料合計・宿泊税・客室売上
 * - フッター: 合計行
 */
class IncomeReportPdfService
{
    private TCPDF $pdf;
    private string $jpFont;
    private float $currentY = 0;  // データ行描画後のY位置を追跡

    // レイアウト定数
    private const ML = 8;   // 左マージン（横長帳票なので狭め）
    private const MR = 8;
    private const MT = 6;
    private const ROW_H = 5.0;  // データ行の高さ（31行+合計を1ページに収めるため5.0mm）
    private const HDR_H = 5.0;  // ヘッダー行の高さ

    // カラー定数（帳票用: モノクロベース）
    private const C_BLACK     = [0, 0, 0];
    private const C_DARK_GRAY = [60, 60, 60];
    private const C_GRAY      = [120, 120, 120];
    private const C_LIGHT_BG  = [235, 235, 235];   // 予測行の背景
    private const C_HDR_BG    = [220, 220, 220];   // ヘッダー背景
    private const C_WHITE     = [255, 255, 255];

    // 曜日の日本語表記
    private const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

    /**
     * 列定義: [キー, 幅mm, ヘッダー表示名, 配置]
     * グループヘッダーは別途描画
     */
    private const COLUMNS = [
        ['key' => 'day',            'w' => 22, 'label' => '日',        'align' => 'C'],
        ['key' => 'physical',       'w' => 13, 'label' => '物理室数',  'align' => 'R'],
        ['key' => 'sold',           'w' => 13, 'label' => '販売室数',  'align' => 'R'],
        ['key' => 'occ_rate',       'w' => 15, 'label' => '稼働率(%)', 'align' => 'R'],
        ['key' => 'total_sales',    'w' => 23, 'label' => '売上金額',  'align' => 'R'],
        ['key' => 'adults',         'w' => 13, 'label' => '大人',      'align' => 'R'],
        ['key' => 'children',       'w' => 13, 'label' => '小人',      'align' => 'R'],
        ['key' => 'guest_total',    'w' => 13, 'label' => '合計',      'align' => 'R'],
        ['key' => 'prev_sold',      'w' => 13, 'label' => '販売室数',  'align' => 'R'],
        ['key' => 'prev_occ',       'w' => 15, 'label' => '稼働率(%)', 'align' => 'R'],
        ['key' => 'prev_sales',     'w' => 23, 'label' => '売上金額',  'align' => 'R'],
        ['key' => 'prev_guests',    'w' => 13, 'label' => '入数',      'align' => 'R'],
        ['key' => 'room_total',     'w' => 23, 'label' => '室料合計',  'align' => 'R'],
        ['key' => 'accom_tax',      'w' => 16, 'label' => '宿泊税',   'align' => 'R'],
        ['key' => 'room_revenue',   'w' => 23, 'label' => '客室売上',  'align' => 'R'],
    ];

    /**
     * グループヘッダー: [ラベル, 開始列index, 列数]
     */
    private const GROUP_HEADERS = [
        ['label' => '',           'start' => 0,  'span' => 5],   // 日〜売上金額は個別
        ['label' => '入数',       'start' => 5,  'span' => 3],   // 大人・小人・合計
        ['label' => '前年',       'start' => 8,  'span' => 4],   // 販売室数〜入数
        ['label' => '',           'start' => 12, 'span' => 3],   // 室料合計〜客室売上
    ];

    /**
     * PDF生成
     *
     * @param array  $data      IncomeReportService::collectDailyData() の戻り値
     * @param string $yearMonth 対象年月 'YYYY-MM'
     * @return string PDFバイナリ
     */
    public function generate(array $data, string $yearMonth): string
    {
        $this->initPdf();
        $this->pdf->AddPage();

        $pageW = $this->pdf->getPageWidth();
        $contentW = $pageW - self::ML - self::MR;

        // ヘッダー描画
        $this->drawPageHeader($yearMonth, $data['cutoff_date']);

        // テーブルヘッダー描画
        $this->drawTableHeader();

        // データ行描画
        $this->drawDataRows($data, $yearMonth);

        // 合計行描画
        $this->drawTotalRow($data);

        return $this->pdf->Output('income_report.pdf', 'S');
    }

    private function initPdf(): void
    {
        // A4横: 'L' = Landscape
        $this->pdf = new TCPDF('L', 'mm', 'A4', true, 'UTF-8', false);

        $this->pdf->SetCreator('CORAL PMS');
        $this->pdf->SetAuthor('CORAL PMS');
        $this->pdf->SetTitle('収入実績・予測表');

        $this->pdf->setPrintHeader(false);
        $this->pdf->setPrintFooter(false);

        $this->pdf->SetMargins(self::ML, self::MT, self::MR);
        $this->pdf->SetAutoPageBreak(false);  // 改ページは手動管理（テーブルレイアウトのため）

        // IPAexゴシック: 日本語表示用
        $fontPath = dirname(__DIR__, 2) . '/fonts/ipaexg.ttf';
        $this->jpFont = TCPDF_FONTS::addTTFfont($fontPath, 'TrueTypeUnicode', '', 96);
    }

    /**
     * ページヘッダー描画
     * タイトル行 + メタ情報行
     */
    private function drawPageHeader(string $yearMonth, string $cutoffDate): void
    {
        $ml = self::ML;
        $pageW = $this->pdf->getPageWidth();
        $contentW = $pageW - self::ML - self::MR;

        // タイトル
        $this->pdf->SetFont($this->jpFont, 'B', 10);
        $this->pdf->SetTextColor(...self::C_BLACK);
        $this->pdf->SetXY($ml, self::MT);
        $this->pdf->Cell($contentW, 5, '収入実績・予測表（日別・前年比）', 0, 0, 'L');

        // 出力日時（右端）
        $this->pdf->SetFont($this->jpFont, '', 6.5);
        $this->pdf->SetTextColor(...self::C_GRAY);
        $now = date('Y/m/d H:i');
        $this->pdf->SetXY($ml, self::MT);
        $this->pdf->Cell($contentW, 5, "出力日時：{$now}　　page: 1", 0, 0, 'R');

        // 2行目: 対象年月 + 業績日付
        $y2 = self::MT + 5;
        $this->pdf->SetFont($this->jpFont, '', 6.5);
        $this->pdf->SetTextColor(...self::C_DARK_GRAY);

        // 年月をYYYY/MM形式に
        $dispYm = str_replace('-', '/', $yearMonth);
        $dispCutoff = str_replace('-', '/', $cutoffDate);

        $this->pdf->SetXY($ml, $y2);
        $this->pdf->Cell(80, 4, "対象年月：{$dispYm}", 0, 0, 'L');

        $this->pdf->SetXY($ml + 160, $y2);
        $this->pdf->Cell(80, 4, "業績日付：{$dispCutoff}", 0, 0, 'R');
    }

    /**
     * テーブルヘッダー描画（2段: グループ名 + 列名）
     */
    private function drawTableHeader(): void
    {
        $ml = self::ML;
        $y = self::MT + 10;  // ページヘッダーの下
        $h = self::HDR_H;

        $this->pdf->SetFont($this->jpFont, 'B', 6.5);
        $this->pdf->SetTextColor(...self::C_BLACK);

        // --- 1段目: グループヘッダー ---
        $this->pdf->SetFillColor(...self::C_HDR_BG);
        $x = $ml;
        foreach (self::GROUP_HEADERS as $gh) {
            $groupW = 0;
            for ($i = $gh['start']; $i < $gh['start'] + $gh['span']; $i++) {
                $groupW += self::COLUMNS[$i]['w'];
            }
            if ($gh['label'] !== '') {
                // グループラベルがある場合は結合セルで描画
                $this->pdf->SetXY($x, $y);
                $this->pdf->Cell($groupW, $h, $gh['label'], 1, 0, 'C', true);
            } else {
                // ラベルなし: 個別列のヘッダーを1段目から描画（2段結合相当）
                $xi = $x;
                for ($i = $gh['start']; $i < $gh['start'] + $gh['span']; $i++) {
                    $col = self::COLUMNS[$i];
                    $this->pdf->SetXY($xi, $y);
                    // 2段分の高さで結合セル
                    $this->pdf->Cell($col['w'], $h * 2, $col['label'], 1, 0, 'C', true);
                    $xi += $col['w'];
                }
            }
            $x += $groupW;
        }

        // --- 2段目: グループ内の列名 ---
        $y2 = $y + $h;
        $x = $ml;
        foreach (self::GROUP_HEADERS as $gh) {
            if ($gh['label'] !== '') {
                // グループがある列は2段目に列名を描画
                $xi = $x;
                for ($i = $gh['start']; $i < $gh['start'] + $gh['span']; $i++) {
                    $col = self::COLUMNS[$i];
                    $this->pdf->SetXY($xi, $y2);
                    $this->pdf->Cell($col['w'], $h, $col['label'], 1, 0, 'C', true);
                    $xi += $col['w'];
                }
            }
            // ラベルなしグループは1段目で2段分描画済みなのでスキップ
            $groupW = 0;
            for ($i = $gh['start']; $i < $gh['start'] + $gh['span']; $i++) {
                $groupW += self::COLUMNS[$i]['w'];
            }
            $x += $groupW;
        }
    }

    /**
     * データ行の描画
     */
    private function drawDataRows(array $data, string $yearMonth): void
    {
        $ml = self::ML;
        $y = self::MT + 10 + self::HDR_H * 2;  // テーブルヘッダーの下
        $h = self::ROW_H;
        $physicalRooms = $data['physical_rooms'];
        $cutoff = $data['cutoff_date'];

        // 前年データを日付キーで参照できるよう整理
        // 当月 4/1 → 前年 4/1 にマッピング
        $prevDays = $data['prev_days'];

        $this->pdf->SetFont($this->jpFont, '', 6.5);

        foreach ($data['days'] as $dateStr => $day) {
            $dt = new \DateTime($dateStr);
            $dayNum = (int) $dt->format('d');
            $dow = self::WEEKDAYS[(int) $dt->format('w')];
            $isForecast = $dateStr > $cutoff;

            // 前年同日のデータ
            $prevYear = (int) $dt->format('Y') - 1;
            $prevDateStr = $prevYear . $dt->format('-m-d');
            $prevDay = $prevDays[$prevDateStr] ?? null;

            // 予測行は薄いグレー背景
            if ($isForecast) {
                $this->pdf->SetFillColor(...self::C_LIGHT_BG);
            } else {
                $this->pdf->SetFillColor(...self::C_WHITE);
            }

            // 日曜は赤、土曜は青
            $dowColor = self::C_BLACK;
            $wday = (int) $dt->format('w');
            if ($wday === 0) $dowColor = [200, 0, 0];
            if ($wday === 6) $dowColor = [0, 0, 180];

            $soldRooms = $day['sold_rooms'];
            $occRate = $physicalRooms > 0 ? round(($soldRooms / $physicalRooms) * 100, 2) : 0;
            $guestTotal = $day['adults'] + $day['children'];
            $roomRevenue = $day['room_sales'] + $day['accom_tax'];

            // 前年計算
            $prevSold = $prevDay ? $prevDay['sold_rooms'] : 0;
            $prevOcc = ($prevDay && $physicalRooms > 0) ? round(($prevSold / $physicalRooms) * 100, 2) : 0;
            $prevSales = $prevDay ? $prevDay['total_sales'] : 0;
            $prevGuests = $prevDay ? ($prevDay['adults'] + $prevDay['children']) : 0;

            // セル値の配列
            $values = [
                sprintf('%02d (%s)', $dayNum, $dow),                     // 日
                number_format($physicalRooms),                            // 物理室数
                number_format($soldRooms),                                // 販売室数
                number_format($occRate, 2),                               // 稼働率
                number_format($day['total_sales']),                       // 売上金額
                number_format($day['adults']),                            // 大人
                number_format($day['children']),                          // 小人
                number_format($guestTotal),                               // 合計
                number_format($prevSold),                                 // 前年販売室数
                number_format($prevOcc, 2),                               // 前年稼働率
                number_format($prevSales),                                // 前年売上金額
                number_format($prevGuests),                               // 前年入数
                number_format($day['room_sales']),                        // 室料合計
                number_format($day['accom_tax']),                         // 宿泊税
                number_format($roomRevenue),                              // 客室売上
            ];

            $x = $ml;
            foreach (self::COLUMNS as $i => $col) {
                // 日の列は曜日色、それ以外は黒
                if ($i === 0) {
                    $this->pdf->SetTextColor(...$dowColor);
                } else {
                    $this->pdf->SetTextColor(...self::C_BLACK);
                }

                $this->pdf->SetXY($x, $y);
                $this->pdf->Cell($col['w'], $h, $values[$i], 1, 0, $col['align'], true);
                $x += $col['w'];
            }

            $y += $h;

            // ページ下端に達したら改ページ（合計行分も含めて確認）
            $pageH = $this->pdf->getPageHeight();
            if ($y + $h * 2 > $pageH - 8) {
                $this->pdf->AddPage();
                $this->drawTableHeader();
                $y = self::MT + 10 + self::HDR_H * 2;
            }
        }

        // 合計行の描画位置を記録
        $this->currentY = $y;
    }

    /**
     * 合計行の描画
     */
    private function drawTotalRow(array $data): void
    {
        $ml = self::ML;
        $h = self::ROW_H;
        $physicalRooms = $data['physical_rooms'];
        $totals = $data['totals'];
        $prevTotals = $data['prev_totals'];
        $daysCount = $totals['days_count'];

        // drawDataRowsが記録したY位置を使用
        $y = $this->currentY;

        $this->pdf->SetFont($this->jpFont, 'B', 6.5);
        $this->pdf->SetTextColor(...self::C_BLACK);
        $this->pdf->SetFillColor(...self::C_HDR_BG);

        // 平均稼働率: 合計販売室数 / (物理室数 × 日数)
        $avgOcc = ($physicalRooms * $daysCount > 0)
            ? round(($totals['sold_rooms'] / ($physicalRooms * $daysCount)) * 100, 2)
            : 0;

        $prevDaysCount = $prevTotals['days_count'];
        $prevAvgOcc = ($physicalRooms * $prevDaysCount > 0)
            ? round(($prevTotals['sold_rooms'] / ($physicalRooms * $prevDaysCount)) * 100, 2)
            : 0;

        $guestTotal = $totals['adults'] + $totals['children'];
        $prevGuestTotal = $prevTotals['adults'] + $prevTotals['children'];
        $roomRevenue = $totals['room_sales'] + $totals['accom_tax'];

        $values = [
            '合計',
            number_format($physicalRooms * $daysCount),
            number_format($totals['sold_rooms']),
            number_format($avgOcc, 2),
            number_format($totals['total_sales']),
            number_format($totals['adults']),
            number_format($totals['children']),
            number_format($guestTotal),
            number_format($prevTotals['sold_rooms']),
            number_format($prevAvgOcc, 2),
            number_format($prevTotals['total_sales']),
            number_format($prevGuestTotal),
            number_format($totals['room_sales']),
            number_format($totals['accom_tax']),
            number_format($roomRevenue),
        ];

        $x = $ml;
        foreach (self::COLUMNS as $i => $col) {
            $this->pdf->SetXY($x, $y);
            $this->pdf->Cell($col['w'], $h, $values[$i], 1, 0, $col['align'], true);
            $x += $col['w'];
        }
    }
}
