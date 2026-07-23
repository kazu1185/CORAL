<?php

namespace App\Services;

use TCPDF;
use TCPDF_FONTS;

/**
 * 領収書PDF描画サービス
 * 高級ホテル風デザイン: ダークネイビー＋ゴールドのアクセント
 *
 * デザインコンセプト:
 * - 上品で洗練されたミニマルレイアウト
 * - ダークネイビー(#1B2A4A) × ゴールド(#C6A962) のカラーパレット
 * - 罫線を最小限にし、余白とタイポグラフィで構造を表現
 * - 日本語(IPAexゴシック) + 欧文(Helvetica) の2フォント使い分け
 */
class ReceiptPdfService
{
    private TCPDF $pdf;
    private string $jpFont;   // 日本語フォント（IPAexゴシック）

    // カラーパレット: 高級ホテルをイメージしたダークネイビー×ゴールド
    private const C_NAVY   = [27, 42, 74];     // ダークネイビー — 見出し・強調
    private const C_GOLD   = [198, 169, 98];    // ゴールド — アクセントライン・装飾
    private const C_TEXT   = [45, 55, 72];      // テキスト主色
    private const C_SUB    = [113, 128, 150];   // サブテキスト
    private const C_LIGHT  = [245, 245, 242];   // 明るい背景（テーブルヘッダー等）
    private const C_WHITE  = [255, 255, 255];
    private const C_RED    = [180, 40, 40];     // 再発行マーク用

    // レイアウト定数
    private const ML = 20;  // 左マージン（やや広めで高級感）
    private const MR = 20;

    // 標準税率。document_items.tax_rate が NULL の明細（物販導入前の既存データ）は
    // この税率として扱う。軽減税率かどうかの判定基準であり、税額の計算には使わない
    // （税額は明細に保存済みの値を集計する）
    private const STANDARD_TAX_RATE = 10;

    public function generate(array $document, array $items, array $hotelInfo): string
    {
        $this->initPdf();
        $this->pdf->AddPage();

        $pageW = $this->pdf->getPageWidth();
        $contentW = $pageW - self::ML - self::MR;

        $y = 18;
        $y = $this->drawHeader($document, $hotelInfo, $y, $contentW);
        $y = $this->drawGoldRule($y, $contentW);
        $y = $this->drawAddressee($document['addressee'], $y, $contentW);
        $y = $this->drawTotalAmount($document['total'], $y, $contentW);
        $y = $this->drawDescription(
            $document['description'] ?? '宿泊代として',
            $document['payment_method_name'] ?? null,
            $y,
            $contentW
        );
        $y = $this->drawItemsTable($items, $y, $contentW);
        $y = $this->drawTaxSummary($document, $this->summarizeByTaxRate($document, $items), $y, $contentW);

        if ($document['total'] >= 50000) {
            $y = $this->drawStampArea($y);
        }

        $this->drawFooter($hotelInfo, $contentW);

        return $this->pdf->Output('receipt.pdf', 'S');
    }

    private function initPdf(): void
    {
        $this->pdf = new TCPDF('P', 'mm', 'A4', true, 'UTF-8', false);

        $this->pdf->SetCreator('Hotel PMS');
        $this->pdf->SetAuthor('Hotel PMS');
        $this->pdf->SetTitle('領収書');

        $this->pdf->setPrintHeader(false);
        $this->pdf->setPrintFooter(false);

        $this->pdf->SetMargins(self::ML, 18, self::MR);
        $this->pdf->SetAutoPageBreak(true, 20);

        // IPAexゴシック: 日本語表示用
        $fontPath = dirname(__DIR__, 2) . '/fonts/ipaexg.ttf';
        $this->jpFont = TCPDF_FONTS::addTTFfont($fontPath, 'TrueTypeUnicode', '', 96);
    }

    // ─── ヘッダー: ホテル名 + RECEIPT + 帳票情報 ───

    private function drawHeader(array $doc, array $hotel, float $y, float $cw): float
    {
        $ml = self::ML;

        // ── ロゴ（PNG優先 → テキストのフォールバック） ──
        // SVGはTCPDFで複雑なパスが崩れるためPNGを使用
        $logoPng = dirname(__DIR__, 2) . '/public/logo-mono.png';
        $hotelName = $hotel['hotel_name'] ?? '';

        if (file_exists($logoPng)) {
            // ロゴを中央配置（幅65mm、高さ自動算出）
            $logoW = 65;
            $logoX = $ml + ($cw - $logoW) / 2;
            $this->pdf->Image($logoPng, $logoX, $y, $logoW, 0, 'PNG', '', '', true, 300);
            // ロゴの高さ: 1200x264 → 65mm幅だと高さ≈14.3mm
            $y += 16;
        } else {
            // ロゴがない場合はテキストでホテル名表示
            $this->setColor(self::C_NAVY);
            $this->pdf->SetFont($this->jpFont, 'B', 13);
            $this->pdf->SetXY($ml, $y);
            $this->pdf->Cell($cw, 7, $hotelName, 0, 0, 'C');
            $y += 8;
        }

        // ── 住所・電話を小さくロゴ/ホテル名の下に ──
        $this->setColor(self::C_SUB);
        $postal = $hotel['postal_code'] ?? '';
        $address = $hotel['address'] ?? '';
        $phone = $hotel['phone'] ?? '';
        $this->pdf->SetFont($this->jpFont, '', 7);
        $this->pdf->SetXY($ml, $y);
        $this->pdf->Cell($cw, 4, "〒{$postal} {$address}", 0, 0, 'C');
        $y += 4;
        $this->pdf->SetXY($ml, $y);
        $this->pdf->Cell($cw, 4, "TEL {$phone}", 0, 0, 'C');
        $y += 8;

        // ── ゴールドの細線セパレーター ──
        $y = $this->drawGoldRule($y, $cw);
        $y += 2;

        // ── 「RECEIPT」タイトル（Helvetica大文字・ネイビー） ──
        // 欧文で洗練された印象を出し、下に日本語「領収書」を添える
        $this->setColor(self::C_NAVY);
        $this->pdf->SetFont('helvetica', 'B', 28);
        $this->pdf->SetXY($ml, $y);
        $this->pdf->Cell($cw, 13, 'RECEIPT', 0, 0, 'C');
        $y += 12;

        // 日本語サブタイトル
        $this->pdf->SetFont($this->jpFont, '', 9);
        $this->setColor(self::C_SUB);
        $this->pdf->SetXY($ml, $y);
        $this->pdf->Cell($cw, 5, '領 収 書', 0, 0, 'C');
        $y += 8;

        // ── 帳票番号・発行日（右寄せ、小さめ） ──
        $this->pdf->SetFont('helvetica', '', 8);
        $this->setColor(self::C_SUB);

        $issuedDate = date('Y.m.d', strtotime($doc['issued_at']));

        $this->pdf->SetXY($ml, $y);
        $this->pdf->Cell($cw, 4, "No. {$doc['document_number']}     Date: {$issuedDate}", 0, 0, 'R');
        $y += 5;

        // 再発行マーク
        if ($doc['reissue_count'] > 0) {
            $this->setColor(self::C_RED);
            $this->pdf->SetFont($this->jpFont, 'B', 8);
            $this->pdf->SetXY($ml, $y);
            $this->pdf->Cell($cw, 4, "REISSUE（再発行 {$doc['reissue_count']}回目）", 0, 0, 'R');
            $y += 5;
        }

        $y += 3;
        return $y;
    }

    // ─── ゴールドの水平ライン ───

    private function drawGoldRule(float $y, float $cw): float
    {
        $this->pdf->SetDrawColor(...self::C_GOLD);
        $this->pdf->SetLineWidth(0.4);
        $this->pdf->Line(self::ML, $y, self::ML + $cw, $y);
        $this->pdf->SetLineWidth(0.2);  // デフォルトに戻す
        return $y + 2;
    }

    // ゴールドの細い二重線（合計金額の上下に使う）
    private function drawGoldDoubleLine(float $y, float $x, float $w): float
    {
        $this->pdf->SetDrawColor(...self::C_GOLD);
        $this->pdf->SetLineWidth(0.3);
        $this->pdf->Line($x, $y, $x + $w, $y);
        $this->pdf->SetLineWidth(0.15);
        $this->pdf->Line($x, $y + 1, $x + $w, $y + 1);
        $this->pdf->SetLineWidth(0.2);
        return $y + 2;
    }

    // ─── 宛名 ───

    private function drawAddressee(string $addressee, float $y, float $cw): float
    {
        $ml = self::ML;

        $this->setColor(self::C_NAVY);
        $this->pdf->SetFont($this->jpFont, 'B', 16);
        $this->pdf->SetXY($ml, $y);
        $this->pdf->Cell(120, 10, $addressee . '　様', 0, 0, 'L');

        // 宛名の下にゴールドの下線
        $y += 11;
        $this->pdf->SetDrawColor(...self::C_GOLD);
        $this->pdf->SetLineWidth(0.5);
        $this->pdf->Line($ml, $y, $ml + 120, $y);
        $this->pdf->SetLineWidth(0.2);

        $y += 8;
        return $y;
    }

    // ─── 合計金額（ゴールドライン上下で挟む高級感のある表示） ───

    private function drawTotalAmount(int $total, float $y, float $cw): float
    {
        $ml = self::ML;
        $boxX = $ml + 20;
        $boxW = $cw - 40;

        // 上部ゴールドダブルライン
        $y = $this->drawGoldDoubleLine($y, $boxX, $boxW);
        $y += 2;

        // 金額を大きく中央表示
        $this->setColor(self::C_NAVY);
        // 円マークと金額で異なるフォントを使って洗練された印象に
        $amountStr = number_format($total);

        $this->pdf->SetFont('helvetica', '', 12);
        $yenW = $this->pdf->GetStringWidth('¥ ');

        // 中央揃えのために手動計算
        $this->pdf->SetFont('helvetica', 'B', 26);
        $numW = $this->pdf->GetStringWidth($amountStr);
        $this->pdf->SetFont('helvetica', '', 12);
        $dashW = $this->pdf->GetStringWidth(' -');

        $totalW = $yenW + $numW + $dashW;
        $startX = $boxX + ($boxW - $totalW) / 2;

        // ¥ マーク（小さめ）
        $this->pdf->SetFont('helvetica', '', 14);
        $this->pdf->SetXY($startX, $y + 3);
        $this->pdf->Cell($yenW, 12, '¥', 0, 0, 'L');

        // 金額数字（大きく太字）
        $this->pdf->SetFont('helvetica', 'B', 26);
        $this->pdf->SetXY($startX + $yenW, $y);
        $this->pdf->Cell($numW, 14, $amountStr, 0, 0, 'L');

        // ハイフン
        $this->pdf->SetFont('helvetica', '', 14);
        $this->pdf->SetXY($startX + $yenW + $numW, $y + 3);
        $this->pdf->Cell($dashW, 12, '-', 0, 0, 'L');

        $y += 16;

        // 下部ゴールドダブルライン
        $y = $this->drawGoldDoubleLine($y, $boxX, $boxW);

        $y += 4;
        return $y;
    }

    // ─── 但し書き ───

    private function drawDescription(string $description, ?string $paymentMethodName, float $y, float $cw): float
    {
        $ml = self::ML;

        $this->setColor(self::C_TEXT);
        $this->pdf->SetFont($this->jpFont, '', 10);
        $this->pdf->SetXY($ml, $y);
        $this->pdf->Cell(120, 6, "但　{$description}", 0, 0, 'L');

        // お支払方法（同じ行の右端）。決済方法が未設定の帳票では出さないので
        // 物販導入前に発行した領収書の見た目は変わらない
        if ($paymentMethodName !== null && $paymentMethodName !== '') {
            $this->setColor(self::C_SUB);
            $this->pdf->SetFont($this->jpFont, '', 8);
            $this->pdf->SetXY($ml, $y);
            $this->pdf->Cell($cw, 6, "お支払方法　{$paymentMethodName}", 0, 0, 'R');
        }

        $y += 10;
        return $y;
    }

    // ─── 内訳テーブル（ミニマルデザイン: ヘッダーはネイビー背景白文字） ───

    private function drawItemsTable(array $items, float $y, float $cw): float
    {
        $ml = self::ML;

        // セクションタイトル
        $this->setColor(self::C_SUB);
        $this->pdf->SetFont('helvetica', '', 7);
        $this->pdf->SetXY($ml, $y);
        $this->pdf->Cell($cw, 4, 'BREAKDOWN', 0, 0, 'L');
        $y += 5;

        // テーブルヘッダー（ネイビー背景）
        $colW = [
            'date'   => 24,
            'desc'   => $cw - 24 - 35,
            'amount' => 35,
        ];

        $this->pdf->SetFillColor(...self::C_NAVY);
        $this->pdf->SetTextColor(...self::C_WHITE);
        $this->pdf->SetFont($this->jpFont, 'B', 7.5);

        $this->pdf->SetXY($ml, $y);
        $this->pdf->Cell($colW['date'], 7, '日付', 0, 0, 'C', true);
        $this->pdf->Cell($colW['desc'], 7, '摘要', 0, 0, 'C', true);
        $this->pdf->Cell($colW['amount'], 7, '金額', 0, 0, 'C', true);
        $y += 7;

        // テーブルボディ（交互色なし、下線のみのミニマルデザイン）
        $this->pdf->SetFont($this->jpFont, '', 7.5);
        $rowCount = 0;
        foreach ($items as $item) {
            if ($y > 250) {
                $this->pdf->AddPage();
                $y = 18;
            }

            // 偶数行に極薄い背景色（視認性のため）
            if ($rowCount % 2 === 1) {
                $this->pdf->SetFillColor(...self::C_LIGHT);
                $fill = true;
            } else {
                $fill = false;
            }

            $this->setColor(self::C_TEXT);
            $dateStr = $item['date'] ? date('m/d', strtotime($item['date'])) : '';
            $amountStr = '¥' . number_format((int)$item['amount']);

            $this->pdf->SetXY($ml, $y);
            $this->pdf->Cell($colW['date'], 6, $dateStr, 0, 0, 'C', $fill);
            $this->pdf->Cell($colW['desc'], 6, $item['description'] ?? '', 0, 0, 'L', $fill);

            // 金額は右寄せ、等幅風に
            $this->pdf->SetFont('helvetica', '', 7.5);
            $this->pdf->Cell($colW['amount'], 6, $amountStr, 0, 0, 'R', $fill);
            $this->pdf->SetFont($this->jpFont, '', 7.5);

            $y += 6;
            $rowCount++;
        }

        // テーブル下部の線（ネイビー細線）
        $this->pdf->SetDrawColor(...self::C_NAVY);
        $this->pdf->SetLineWidth(0.3);
        $this->pdf->Line($ml, $y, $ml + $cw, $y);
        $this->pdf->SetLineWidth(0.2);

        $y += 5;
        return $y;
    }

    // ─── 税率別集計 ───

    /**
     * 明細を税率ごとに集計する（インボイスの税率区分記載用）
     *
     * 返り値: [ ['rate' => 10, 'amount' => 税込対象額, 'tax' => 内消費税額], ... ] 税率の降順
     *
     * 軽減税率（8%）の明細が1件も無い場合は、10%だけの1要素を
     * 「従来と同じ計算（対象額 = 合計 - 宿泊税、税 = documents.tax_amount）」で返す。
     * 物販導入前に発行した領収書の見た目を変えないため
     */
    private function summarizeByTaxRate(array $doc, array $items): array
    {
        $total = (int) $doc['total'];
        $accomTax = (int) $doc['accommodation_tax'];
        $docTax = (int) $doc['tax_amount'];

        // 標準税率（tax_rate が NULL の既存明細）以外の税率ごとに集計
        // 税額は行ごとの税額（document_items.tax_amount）の合算ではなく、
        // 税率ごとの対象額合計から1回で計算する（インボイスの端数処理原則）。
        // DocumentService::calculateTotals / issueSalesReceipt と同じ方式にしており、
        // 発行時に保存した documents.tax_amount と表示が必ず一致する
        $others = [];   // rate => ['amount' => x, 'tax' => y]
        foreach ($items as $item) {
            $rate = $item['tax_rate'] ?? null;
            if ($rate === null || (int) $rate === self::STANDARD_TAX_RATE) {
                continue;   // 標準税率は残額として後から算出する
            }
            $rate = (int) $rate;
            $others[$rate]['amount'] = ($others[$rate]['amount'] ?? 0) + (int) $item['amount'];
        }
        foreach ($others as $rate => $v) {
            $others[$rate]['tax'] = TaxCalc::includedTax($v['amount'], $rate);
        }

        // 標準税率の対象額・税額は「全体から軽減税率分を引いた残り」とする。
        // 宿泊料は明細に税額を持たない運用のため、合計から逆算する既存の考え方を保つ
        $standard = [
            'rate'   => self::STANDARD_TAX_RATE,
            'amount' => $total - $accomTax - array_sum(array_column($others, 'amount')),
            'tax'    => $docTax - array_sum(array_column($others, 'tax')),
        ];

        $result = [$standard];
        krsort($others);
        foreach ($others as $rate => $v) {
            $result[] = ['rate' => $rate, 'amount' => $v['amount'], 'tax' => $v['tax']];
        }

        // 対象額が0の区分は出さない（8%の商品が無い領収書に8%行を出さないため）
        return array_values(array_filter($result, fn($r) => $r['amount'] > 0));
    }

    private function drawTaxSummary(array $doc, array $taxBreakdown, float $y, float $cw): float
    {
        $ml = self::ML;
        $rightX = $ml + $cw - 85;
        $labelW = 42;
        $valueW = 42;

        // 小計
        $this->setColor(self::C_TEXT);
        $this->pdf->SetFont($this->jpFont, '', 8);

        $this->pdf->SetXY($rightX, $y);
        $this->pdf->Cell($labelW, 5.5, '小計（税抜）', 0, 0, 'L');
        $this->pdf->SetFont('helvetica', '', 8);
        $this->pdf->Cell($valueW, 5.5, '¥' . number_format($doc['subtotal']), 0, 0, 'R');
        $y += 5.5;

        // 消費税（税率が複数ある場合は区分ごとに出す）
        foreach ($taxBreakdown as $b) {
            if ($b['tax'] <= 0) continue;
            $this->pdf->SetFont($this->jpFont, '', 8);
            $this->pdf->SetXY($rightX, $y);
            $this->pdf->Cell($labelW, 5.5, "消費税（{$b['rate']}%）", 0, 0, 'L');
            $this->pdf->SetFont('helvetica', '', 8);
            $this->pdf->Cell($valueW, 5.5, '¥' . number_format($b['tax']), 0, 0, 'R');
            $y += 5.5;
        }

        // 宿泊税
        if ($doc['accommodation_tax'] > 0) {
            $this->pdf->SetFont($this->jpFont, '', 8);
            $this->pdf->SetXY($rightX, $y);
            $this->pdf->Cell($labelW, 5.5, '宿泊税', 0, 0, 'L');
            $this->pdf->SetFont('helvetica', '', 8);
            $this->pdf->Cell($valueW, 5.5, '¥' . number_format($doc['accommodation_tax']), 0, 0, 'R');
            $y += 5.5;
        }

        // 合計（ゴールドライン区切り + 太字）
        $y += 1;
        $this->pdf->SetDrawColor(...self::C_GOLD);
        $this->pdf->SetLineWidth(0.3);
        $this->pdf->Line($rightX, $y, $rightX + $labelW + $valueW, $y);
        $y += 2;

        $this->setColor(self::C_NAVY);
        $this->pdf->SetFont($this->jpFont, 'B', 10);
        $this->pdf->SetXY($rightX, $y);
        $this->pdf->Cell($labelW, 6, '合計', 0, 0, 'L');
        $this->pdf->SetFont('helvetica', 'B', 10);
        $this->pdf->Cell($valueW, 6, '¥' . number_format($doc['total']), 0, 0, 'R');
        $y += 8;

        // インボイス注記（税率区分ごとの対象額と内消費税額）
        // 軽減税率の明細が無ければ1行だけになり、従来の領収書と同じ見た目になる
        $this->setColor(self::C_SUB);
        $this->pdf->SetFont($this->jpFont, '', 6.5);
        foreach ($taxBreakdown as $b) {
            $this->pdf->SetXY($rightX, $y);
            $this->pdf->Cell(
                $labelW + $valueW, 4,
                "※{$b['rate']}%対象: ¥" . number_format($b['amount']) . "（税: ¥" . number_format($b['tax']) . "）",
                0, 0, 'R'
            );
            $y += 4;
        }
        $y += 3;

        return $y;
    }

    // ─── 収入印紙貼付欄 ───

    private function drawStampArea(float $y): float
    {
        $ml = self::ML;

        $this->setColor(self::C_SUB);
        $this->pdf->SetFont($this->jpFont, '', 6.5);
        $this->pdf->SetXY($ml, $y);
        $this->pdf->Cell(28, 3.5, '収入印紙貼付欄', 0, 0, 'C');
        $y += 4;

        $this->pdf->SetDrawColor(...self::C_SUB);
        $this->pdf->SetLineStyle(['width' => 0.15, 'dash' => '2,2']);
        $this->pdf->Rect($ml, $y, 28, 22);
        $this->pdf->SetLineStyle(['width' => 0.2, 'dash' => 0]); // リセット
        $y += 26;

        return $y;
    }

    // ─── フッター: ホテル情報（ページ下部に固定配置） ───

    private function drawFooter(array $hotel, float $cw): void
    {
        $ml = self::ML;
        $pageH = $this->pdf->getPageHeight();
        $y = $pageH - 30;

        // AutoPageBreakを一時無効化（ページ下部に描画するため）
        $this->pdf->SetAutoPageBreak(false);

        // ゴールドセパレーター
        $this->drawGoldRule($y, $cw);
        $y += 3;

        // ホテル名
        $this->setColor(self::C_NAVY);
        $this->pdf->SetFont($this->jpFont, 'B', 8);
        $this->pdf->SetXY($ml, $y);
        $this->pdf->Cell($cw, 4, $hotel['hotel_name'] ?? '', 0, 0, 'C');
        $y += 4.5;

        // 住所・電話
        $this->setColor(self::C_SUB);
        $this->pdf->SetFont($this->jpFont, '', 6.5);
        $postal = $hotel['postal_code'] ?? '';
        $address = $hotel['address'] ?? '';
        $phone = $hotel['phone'] ?? '';
        $this->pdf->SetXY($ml, $y);
        $this->pdf->Cell($cw, 3.5, "〒{$postal} {$address}  |  TEL {$phone}", 0, 0, 'C');
        $y += 4;

        // 適格請求書発行事業者登録番号
        $regNo = $hotel['invoice_registration_no'] ?? '';
        if ($regNo) {
            $this->pdf->SetFont('helvetica', '', 6);
            $this->pdf->SetXY($ml, $y);
            $this->pdf->Cell($cw, 3.5, "Registration No. {$regNo}", 0, 0, 'C');
            $y += 4;
        }

        // "Thank you for your stay" メッセージ
        $this->setColor(self::C_GOLD);
        $this->pdf->SetFont('helvetica', 'I', 7);
        $this->pdf->SetXY($ml, $y);
        $this->pdf->Cell($cw, 4, 'Thank you for your stay.', 0, 0, 'C');
    }

    // ─── ヘルパー ───

    private function setColor(array $rgb): void
    {
        $this->pdf->SetTextColor($rgb[0], $rgb[1], $rgb[2]);
    }
}
