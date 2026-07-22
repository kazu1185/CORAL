/**
 * 共通定数
 *
 * OTAラベル・予約ステータスラベルなど、複数ページで使用する定数を一元管理する。
 * 新しいOTAやステータスが追加された場合はここを更新すること。
 */

// OTAチャネルの表示名
export const OTA_LABELS = {
  jalan: 'じゃらん',
  rakuten: '楽天',
  booking: 'Booking.com',
  agoda: 'Agoda',
  expedia: 'Expedia',
  direct: '直販',
  phone: '電話',
  walkin: 'ウォークイン',
  corporate: '法人',
};

// OTAフィルタ用のチャネルキー一覧
export const OTA_CHANNELS = ['jalan', 'rakuten', 'booking', 'agoda', 'expedia', 'direct', 'phone', 'walkin', 'corporate'];

// 予約ステータスの表示名（フル表記）
export const RESERVATION_STATUS_LABELS = {
  confirmed: '予約確定',
  checked_in: 'チェックイン中',
  checked_out: 'チェックアウト済',
  cancelled: 'キャンセル',
  no_show: 'ノーショー',
  merged: '統合済',
  group_parent: 'グループ親',
};

// 予約ステータスの短縮表示名（詳細画面・履歴等のコンパクト表示用）
export const RESERVATION_STATUS_SHORT = {
  confirmed: '予約確定',
  checked_in: 'CI済',
  checked_out: 'CO済',
  cancelled: 'キャンセル',
  no_show: 'ノーショー',
  merged: '統合済',
  group_parent: 'グループ親',
};

// 予約ステータスの極小表示名（グループ子予約一覧などスペースが限られるバッジ用）
// SHORT よりさらに詰めた表記。表示文言を変えないようGroupReservationPageの定義をそのまま移設
export const RESERVATION_STATUS_MINI = {
  confirmed: '確定',
  checked_in: 'CI済',
  checked_out: 'CO済',
  cancelled: 'キャンセル',
  no_show: 'NS',
};

// 手動予約（TL経由でない予約）で選択可能なチャネル
export const MANUAL_CHANNELS = [
  { value: 'phone', label: '電話' },
  { value: 'direct', label: '直販' },
  { value: 'walkin', label: 'ウォークイン' },
  { value: 'corporate', label: '法人' },
];

// 統合予約への変更通知（merge_alert）の種別表示名
export const MERGE_ALERT_TYPE_LABELS = {
  date_change: '日程変更',
  cancellation: 'キャンセル',
  room_count_change: '室数変更',
};

// 消費税率の選択肢（物販）
// 商品マスタの入力・物販ページ・レポートの3箇所で同じ表記が必要なためここに置く。
// 値はDB（products.tax_rate / product_sales.tax_rate）に保存する選択肢であり、
// 金額計算に埋め込む定数ではない（計算は utils/tax.js が保存済みの税率を受け取って行う）
export const TAX_RATE_OPTIONS = [
  { value: 10, label: '10%' },
  { value: 8,  label: '軽減8%' },
];

// 税率 → 表示ラベル（未知の値はそのまま「N%」で出す）
export function taxRateLabel(rate) {
  const found = TAX_RATE_OPTIONS.find(o => o.value === Number(rate));
  return found ? found.label : `${rate}%`;
}
