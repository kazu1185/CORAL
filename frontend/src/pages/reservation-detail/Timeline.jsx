import { useState, useEffect, useRef } from 'react';
import { MERGE_ALERT_TYPE_LABELS } from '../../utils/constants';

/**
 * 予約詳細のタイムライン詳細ポップオーバー
 * ReservationDetailPage.jsx が2,200行超に肥大化したため分割（2026-06-11）
 */
export function TimelineDetailPopover({ ev }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const cardRef = useRef(null);

  useEffect(() => {
    if (!open || !cardRef.current || !wrapRef.current) return;

    const card = cardRef.current;
    const rect = card.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // 右にはみ出す場合は左側に表示
    if (rect.right > vw - 8) {
      card.style.left = 'auto';
      card.style.right = '0';
    }
    // 下にはみ出す場合は上方向に表示
    if (rect.bottom > vh - 8) {
      card.style.top = 'auto';
      card.style.bottom = '100%';
      card.style.marginBottom = '4px';
    }
  }, [open]);

  // 外側クリックで閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="rd__timeline-detail-wrap" ref={wrapRef}>
      <span
        className="material-symbols-outlined rd__timeline-info"
        onClick={() => setOpen(v => !v)}
      >info</span>
      {open && (
        <div className="rd__timeline-detail-card rd__timeline-detail-card--popover" ref={cardRef}>
          {formatEventDetail(ev)}
        </div>
      )}
    </div>
  );
}

/**
 * タイムラインのdetail（JSON文字列）を人間が読める形式に変換
 */
function formatEventDetail(ev) {
  if (!ev.detail) return null;
  // JSONパース試行。失敗したらそのまま返す
  let d;
  try { d = typeof ev.detail === 'string' ? JSON.parse(ev.detail) : ev.detail; }
  catch { return ev.detail; }

  // merge_alert: 統合予約への変更通知
  if (ev.event_type === 'merge_alert') {
    const lines = [];
    lines.push(`種別: ${MERGE_ALERT_TYPE_LABELS[d.alert_type] || d.alert_type}`);
    lines.push(`対象: ${d.channel} ${d.source_reservation_no}`);
    if (d.before_ci) lines.push(`変更前: ${d.before_ci} → ${d.before_co}`);
    if (d.after_ci) lines.push(`変更後: ${d.after_ci} → ${d.after_co}`);
    return lines.join('\n');
  }

  // merge: 予約統合
  if (ev.event_type === 'merge' && d.before) {
    const lines = [];
    if (d.before.child_ids) lines.push(`統合対象: ID ${d.before.child_ids.join(', ')}`);
    if (d.before.parent_dates) lines.push(`統合前: ${d.before.parent_dates}  ¥${Number(d.before.parent_amount).toLocaleString()}`);
    if (d.after) lines.push(`統合後: ${d.after.checkin_date} → ${d.after.checkout_date}（${d.after.nights}泊）¥${Number(d.after.amount).toLocaleString()}`);
    return lines.join('\n');
  }

  // split: 予約分割
  if (ev.event_type === 'split' && d.before) {
    const lines = [];
    lines.push(`分割前: ${d.before.checkin_date} → ${d.before.checkout_date}（${d.before.nights}泊）`);
    if (d.after?.front) lines.push(`前半: ID ${d.after.front.reservation_id}（${d.after.front.nights}泊）`);
    if (d.after?.back) lines.push(`後半: ID ${d.after.back.reservation_id}（${d.after.back.nights}泊）`);
    return lines.join('\n');
  }

  // unmerge: 統合解除
  if (ev.event_type === 'unmerge' && d.removed_source) {
    return `解除: ${d.removed_source.channel} ${d.removed_source.reservation_no}\n残り: ${d.remaining_count}件`;
  }

  // tl_modify: 変更通知（通常予約・統合内金額変更）
  if (ev.event_type === 'tl_modify' && d.source_reservation_no) {
    const lines = [`対象: ${d.source_reservation_no}`];
    if (d.before_amount != null) lines.push(`金額: ¥${Number(d.before_amount).toLocaleString()} → ¥${Number(d.after_amount).toLocaleString()}`);
    return lines.join('\n');
  }

  // その他: 生JSONを整形表示
  return ev.detail;
}
