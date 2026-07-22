import { useState } from 'react';
import { api } from '../../api/client';
import { useConfirm } from '../../components/ConfirmDialog';
import { RESERVATION_STATUS_LABELS } from '../../utils/constants';

/**
 * 複数室グループ予約カード
 * 兄弟一覧 + 一括CI/COボタン + グループ精算サマリー
 */
export function GroupReservationCard({ siblings, currentId, parentReservation, navigate, onAction }) {
  const { confirm: showConfirm, alert: showAlert } = useConfirm();
  const [loading, setLoading] = useState(false);

  // 各ステータスの件数
  const confirmedCount = siblings.filter(s => s.status === 'confirmed').length;
  const checkedInCount = siblings.filter(s => s.status === 'checked_in').length;
  const activeCount    = siblings.filter(s => !['cancelled', 'checked_out'].includes(s.status)).length;

  // グループ合計金額
  const totalAmount = siblings.reduce((sum, s) => sum + Number(s.amount || 0), 0);

  // 対象の子予約IDを明示的に送る（検証報告 #12: 未指定だとバックエンドが「全件」解釈になり
  // GroupReservationPageの選択式CI/COと挙動が食い違うため、ボタン表記どおりの対象を送る）
  // updated_at は親予約の楽観ロック用（検証報告 #6）
  const handleGroupCheckin = async () => {
    if (!await showConfirm(
      'グループ一括チェックイン',
      `${confirmedCount}室を一括チェックインします。\n※ アサイン済みの部屋のみ対象です。`,
    )) return;
    setLoading(true);
    try {
      const res = await api.post(`/reservations/${parentReservation.id}/group-checkin`, {
        reservation_ids: siblings.filter(s => s.status === 'confirmed').map(s => s.id),
        updated_at: parentReservation.updated_at,
      });
      showAlert('一括チェックイン', res.message);
      onAction();
    } catch (err) { showAlert('エラー', err.message); }
    setLoading(false);
  };

  const handleGroupCheckout = async () => {
    if (!await showConfirm(
      'グループ一括チェックアウト',
      `${checkedInCount}室を一括チェックアウトします。`,
      { confirmLabel: 'チェックアウト', confirmColor: 'orange' }
    )) return;
    setLoading(true);
    try {
      const res = await api.post(`/reservations/${parentReservation.id}/group-checkout`, {
        reservation_ids: siblings.filter(s => s.status === 'checked_in').map(s => s.id),
        updated_at: parentReservation.updated_at,
      });
      showAlert('一括チェックアウト', res.message);
      onAction();
    } catch (err) { showAlert('エラー', err.message); }
    setLoading(false);
  };

  return (
    <div className="rd__card">
      <h3 className="rd__card-title">
        <span className="material-symbols-outlined" style={{ fontSize: '18px', verticalAlign: 'text-bottom' }}>group</span>
        {' '}グループ予約（{siblings.length}室）
      </h3>

      {/* グループ管理画面へのリンク */}
      {parentReservation && (
        <button
          className="rd__group-btn"
          style={{ background: '#7C3AED', color: '#fff', marginBottom: 8, width: '100%' }}
          onClick={() => navigate(`/reservations/${parentReservation.id}`)}
        >
          <span className="material-symbols-outlined">groups</span>
          グループ管理画面を開く
        </button>
      )}

      {/* 一括アクションボタン */}
      <div className="rd__group-actions">
        {confirmedCount > 0 && (
          <button className="rd__group-btn rd__group-btn--ci" onClick={handleGroupCheckin} disabled={loading}>
            <span className="material-symbols-outlined">login</span>
            一括CI（{confirmedCount}室）
          </button>
        )}
        {checkedInCount > 0 && (
          <button className="rd__group-btn rd__group-btn--co" onClick={handleGroupCheckout} disabled={loading}>
            <span className="material-symbols-outlined">logout</span>
            一括CO（{checkedInCount}室）
          </button>
        )}
      </div>

      {/* 兄弟予約一覧 */}
      <div className="rd__group-list">
        {siblings.map(sibling => (
          <div
            key={sibling.id}
            className={`rd__group-row ${sibling.id === currentId ? 'rd__group-row--current' : ''} ${sibling.status === 'cancelled' ? 'rd__group-row--cancelled' : ''}`}
            onClick={() => sibling.id !== currentId && navigate(`/reservations/${sibling.id}`)}
          >
            <span className="rd__group-index">室{sibling.room_index}</span>
            <span className="rd__group-type">{sibling.room_type || '—'}</span>
            <span className="rd__group-room">{sibling.assigned_room ? `${sibling.assigned_room}号室` : '未割当'}</span>
            <span className="rd__group-amount">{Number(sibling.amount).toLocaleString()}円</span>
            <span className={`resv__status resv__status--${sibling.status}`}>
              {RESERVATION_STATUS_LABELS[sibling.status] || sibling.status}
            </span>
          </div>
        ))}
      </div>

      {/* グループ精算サマリー */}
      {parentReservation && (
        <div className="rd__group-summary">
          <div className="rd__group-summary-row">
            <span>OTA予約番号</span>
            <span className="rd__mono">{parentReservation.reservation_no}</span>
          </div>
          <div className="rd__group-summary-row">
            <span>グループ合計</span>
            <span className="rd__group-summary-amount">{totalAmount.toLocaleString()}円</span>
          </div>
        </div>
      )}
    </div>
  );
}
