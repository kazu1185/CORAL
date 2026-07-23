<?php

namespace App\Services;

/**
 * 消費税の計算ヘルパー
 *
 * 「税込金額 → 内消費税額」の式をここに一元化する。
 * ProductSaleController（販売時のスナップショット）と
 * DocumentService / ReceiptPdfService（領収書の税率区分記載）が同じ式を使うため、
 * コピペで式がずれるのを防ぐ目的で切り出した。
 * フロントエンド（frontend/src/utils/tax.js）にも同じ式のミラーがある。
 */
class TaxCalc
{
    /**
     * 税込金額に含まれる消費税額（円未満切り捨て）
     *   tax = amount - floor(amount / (1 + rate/100))
     *
     * インボイス制度では「1つの適格請求書につき税率ごとに端数処理1回」が原則のため、
     * 領収書に記載する税額は明細行ごとの税額を合算するのではなく、
     * 税率ごとの対象額合計に対してこの関数を1回適用して求めること。
     * （行ごとに切り捨ててから合算すると、合算結果が数円小さくなり得る）
     */
    public static function includedTax(int $amount, int $taxRate): int
    {
        return $amount - (int) floor($amount / (1 + $taxRate / 100));
    }
}
