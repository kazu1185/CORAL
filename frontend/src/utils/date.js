/**
 * 日付ユーティリティ
 *
 * コーディング規約 #2:
 * - new Date('YYYY-MM-DD') は使わない（UTC解釈で日付がずれる）
 * - toISOString() も使わない（UTCで出力される）
 * - 必ず parseLocal() / fmt() を使用すること
 */

// 日付文字列 → ローカルタイムの Date オブジェクト
// UTC解釈を避けるため、年月日を手動で分解して生成する
export function parseLocal(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Date オブジェクト → 'YYYY-MM-DD' 形式の文字列
// toISOString() はUTC出力のため使わず、ローカル時間で組み立てる
export function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 2つの日付文字列間の日数差
export function dayDiff(from, to) {
  return Math.round((parseLocal(to) - parseLocal(from)) / 86400000);
}

// 今日の 'YYYY-MM-DD'
// 各ページで fmt(new Date()) が散在していたため一元化
export function todayStr() {
  return fmt(new Date());
}

// 日付に days 日を加算して 'YYYY-MM-DD' を返す
// 引数は 'YYYY-MM-DD' 文字列でも Date でも良い（呼び出し側の組み立てコードを減らすため）
export function addDays(d, days) {
  const base = typeof d === 'string' ? parseLocal(d) : new Date(d);
  base.setDate(base.getDate() + days);
  return fmt(base);
}

// MySQL DATETIME（'YYYY-MM-DD HH:MM:SS'）→ 表示用文字列
// new Date(文字列) のパースはブラウザ実装依存のため、文字列操作だけで変換する
// withYear=false で 'MM/DD HH:MM'（一覧のコンパクト表示用）
export function fmtDateTime(s, withYear = true) {
  if (!s || s.length < 16) return s || '';
  const datePart = withYear ? s.slice(0, 10) : s.slice(5, 10);
  return `${datePart.replace(/-/g, '/')} ${s.slice(11, 16)}`;
}
