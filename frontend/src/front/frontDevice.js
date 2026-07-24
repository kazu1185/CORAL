/**
 * フロント端末フラグ（localStorage）
 *
 * 「この端末はフロントカウンターのiPad」という印を端末側に保存する。
 * 清掃ボードのデバイストークン方式と同じ発想だが、認証自体は既存のスタッフ+PINセッションを使う。
 * 用途: PCの通常ログインを経由した場合でも、フロント端末ならログイン後 /front に遷移させる。
 */
const KEY = 'pms_front_device';

export function markFrontDevice() {
  try { localStorage.setItem(KEY, '1'); } catch { /* localStorage不可でも致命的でない */ }
}

export function isFrontDevice() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
