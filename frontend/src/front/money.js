/**
 * フロントモードの金額ユーティリティ。
 * 合計/入金済み/残額の定義は front-board の unpaid_amount と規約 #28 の集計定義に合わせる:
 *   合計   = active な charge のうち charge_type が payment/refund 以外の合算（discountは負で含む）
 *   入金済 = active な charge_type='payment' の合算
 *   残額   = 合計 − 入金済
 */
export function calcMoney(charges = []) {
  let total = 0, paid = 0, accTax = 0;
  for (const c of charges) {
    if (c.status !== 'active') continue;
    accTax += Number(c.accommodation_tax) || 0;
    if (c.charge_type === 'payment') paid += Number(c.amount) || 0;
    else if (c.charge_type !== 'refund') total += Number(c.amount) || 0;
  }
  return { total, paid, due: total - paid, accTax };
}

export const yen = (n) => `¥${Number(n || 0).toLocaleString()}`;
