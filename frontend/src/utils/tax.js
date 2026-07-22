/**
 * 消費税の計算ユーティリティ（物販）
 *
 * 税率はDBに保存された値（products.tax_rate / product_sales.tax_rate）を
 * 引数で受け取る。関数の中に 8 / 10 を書かないこと（税率ハードコード禁止）。
 */

/**
 * 税込金額から内消費税額を求める（円未満切り捨て）
 *   tax = amount - floor(amount / (1 + rate/100))
 * バックエンド ProductSaleController::calcTaxAmount() と同じ式。
 * 表示と保存で額がずれないよう、必ず両方この式を使う
 */
export function calcTaxAmount(amount, taxRate) {
  return amount - Math.floor(amount / (1 + taxRate / 100));
}

/**
 * 明細行の配列を税率ごとに集計する（インボイスの税率区分表示・カートの内税表示用）
 *
 * @param {Array} lines  { amount, tax_rate } を持つ行の配列（税込金額）
 * @returns {Array} [{ tax_rate, amount, tax_amount }] — 税率の降順
 *
 * 税額は「税率ごとの合計額から一度だけ計算する」。行ごとに計算して足すと
 * 端数処理の誤差が積み上がり、領収書の内税額と合計が合わなくなるため
 */
export function summarizeByTaxRate(lines) {
  const map = new Map();

  for (const line of lines) {
    const rate = Number(line.tax_rate);
    map.set(rate, (map.get(rate) || 0) + Number(line.amount));
  }

  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([tax_rate, amount]) => ({
      tax_rate,
      amount,
      tax_amount: calcTaxAmount(amount, tax_rate),
    }));
}
