import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useConfirm } from '../components/ConfirmDialog';
import { OTA_LABELS, RESERVATION_STATUS_MINI } from '../utils/constants';
import './GroupReservationPage.css';

/**
 * グループ予約管理画面
 * 親予約(status=group_parent)を開いた時に表示される
 * 子予約一覧・一括CI/CO・グループ全体の売上明細・精算サマリーを提供
 */
export default function GroupReservationPage({ data: d, onRefresh }) {
  const navigate = useNavigate();
  const { confirm: showConfirm, alert: showAlert } = useConfirm();

  // 子予約のチェックボックス管理
  const children = d.child_reservations || [];
  const [selectedIds, setSelectedIds] = useState(() => children.map(c => c.id));

  // ゲストリンク対象の子予約ID
  const [linkTargetId, setLinkTargetId] = useState(null);

  // 領収書ダイアログ
  const [showReceipt, setShowReceipt] = useState(false);

  const toggleChild = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };
  const toggleAll = () => {
    if (selectedIds.length === children.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(children.map(c => c.id));
    }
  };

  // 選択中の子予約のステータス別カウント
  const selectedConfirmed = children.filter(c => selectedIds.includes(c.id) && c.status === 'confirmed');
  const selectedCheckedIn = children.filter(c => selectedIds.includes(c.id) && c.status === 'checked_in');

  // ── 一括チェックイン ──
  const handleGroupCheckin = async () => {
    if (selectedConfirmed.length === 0) return;
    const msg = selectedConfirmed.length === children.filter(c => c.status === 'confirmed').length
      ? `${selectedConfirmed.length}室を一括チェックインします。\n※アサイン済みの部屋のみ対象`
      : `選択した${selectedConfirmed.length}室をチェックインします。\n※アサイン済みの部屋のみ対象`;
    if (!await showConfirm('グループ チェックイン', msg)) return;
    try {
      const res = await api.post(`/reservations/${d.id}/group-checkin`, {
        reservation_ids: selectedConfirmed.map(c => c.id),
        updated_at: d.updated_at, // 楽観ロック（検証報告 #6）
      });
      showAlert('チェックイン', res.message);
      onRefresh();
    } catch (err) {
      showAlert('エラー', err.message);
    }
  };

  // ── 一括チェックアウト ──
  const handleGroupCheckout = async () => {
    if (selectedCheckedIn.length === 0) return;
    const msg = `選択した${selectedCheckedIn.length}室をチェックアウトします。`;
    if (!await showConfirm('グループ チェックアウト', msg)) return;
    try {
      const res = await api.post(`/reservations/${d.id}/group-checkout`, {
        reservation_ids: selectedCheckedIn.map(c => c.id),
        updated_at: d.updated_at, // 楽観ロック（検証報告 #6）
      });
      showAlert('チェックアウト', res.message);
      onRefresh();
    } catch (err) {
      showAlert('エラー', err.message);
    }
  };

  // ── グループ売上明細（フラット表示） ──
  const groupCharges = d.group_charges || [];
  const activeCharges = groupCharges.filter(c => c.status === 'active');
  const salesTotal = activeCharges
    .filter(c => !['payment', 'refund'].includes(c.charge_type))
    .reduce((s, c) => s + Number(c.amount), 0);
  const paymentTotal = activeCharges
    .filter(c => c.charge_type === 'payment')
    .reduce((s, c) => s + Number(c.amount), 0);
  const balance = salesTotal - paymentTotal;

  const channelLabel = OTA_LABELS[d.channel] || d.channel;

  return (
    <div className="grp">
      {/* ── ヘッダー ── */}
      <div className="grp__header">
        <button className="grp__back" onClick={() => navigate('/reservations')}>
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <div className="grp__title">
          <span className="material-symbols-outlined">groups</span>
          グループ予約
          <span className={`ota-badge ota-${d.channel}`}>{channelLabel}</span>
        </div>
        <div className="grp__meta">
          <span className="grp__meta-item">
            <span className="material-symbols-outlined">tag</span>
            {d.reservation_no}
          </span>
          <span className="grp__meta-item">
            <span className="material-symbols-outlined">calendar_month</span>
            {d.checkin_date} 〜 {d.checkout_date}（{d.nights}泊）
          </span>
          <span className="grp__meta-item">
            <span className="material-symbols-outlined">hotel</span>
            {children.length}室
          </span>
        </div>
      </div>

      {/* ── アクションバー ── */}
      <div className="grp__actions">
        <button className="grp__action-btn grp__action-btn--ci"
          disabled={selectedConfirmed.length === 0}
          onClick={handleGroupCheckin}>
          <span className="material-symbols-outlined">login</span>
          選択した室をCI（{selectedConfirmed.length}）
        </button>
        <button className="grp__action-btn grp__action-btn--co"
          disabled={selectedCheckedIn.length === 0}
          onClick={handleGroupCheckout}>
          <span className="material-symbols-outlined">logout</span>
          選択した室をCO（{selectedCheckedIn.length}）
        </button>
        <button className="grp__action-btn grp__action-btn--receipt"
          onClick={() => setShowReceipt(true)}>
          <span className="material-symbols-outlined">receipt_long</span>
          グループ領収書
        </button>
        <button className="grp__select-all" onClick={toggleAll}>
          {selectedIds.length === children.length ? '全解除' : '全選択'}
        </button>
      </div>

      <div className="grp__columns">
        <div className="grp__col--left">
          {/* ── 子予約一覧 ── */}
          <div className="grp__card">
            <h3 className="grp__card-title">
              <span className="material-symbols-outlined">apartment</span>
              室別予約
            </h3>
            <table className="grp__child-table">
              <thead>
                <tr>
                  <th><input type="checkbox"
                    checked={selectedIds.length === children.length && children.length > 0}
                    onChange={toggleAll} /></th>
                  <th>室</th>
                  <th>ゲスト名</th>
                  <th>部屋タイプ</th>
                  <th>部屋</th>
                  <th className="grp__right">金額</th>
                  <th>状態</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {children.map(child => (
                  <tr key={child.id}>
                    <td>
                      <input type="checkbox"
                        checked={selectedIds.includes(child.id)}
                        onChange={() => toggleChild(child.id)} />
                    </td>
                    <td><span className="grp__room-index">室{child.room_index}</span></td>
                    <td>
                      <span className="grp__guest-name">{child.guest_name || '—'}</span>
                      <button className="grp__guest-btn"
                        onClick={() => navigate(`/reservations/${child.id}`)}
                        title="ゲストリンクは子予約の詳細画面から変更">
                        <span className="material-symbols-outlined">edit</span>
                      </button>
                    </td>
                    <td>{child.room_type_name || child.room_type || '—'}</td>
                    <td>{child.assigned_room ? `${child.assigned_room}号室` : '未アサイン'}</td>
                    <td className="grp__right grp__amount">
                      {Number(child.amount || 0).toLocaleString()}円
                    </td>
                    <td>
                      <span className={`status-badge status-badge--${child.status}`}>
                        {RESERVATION_STATUS_MINI[child.status] || child.status}
                      </span>
                    </td>
                    <td>
                      <button className="grp__detail-link"
                        onClick={() => navigate(`/reservations/${child.id}`)}>
                        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>open_in_new</span>
                        詳細
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── グループ売上明細 ── */}
          <div className="grp__card">
            <h3 className="grp__card-title">
              <span className="material-symbols-outlined">receipt</span>
              グループ売上明細
            </h3>
            {groupCharges.length > 0 ? (
              <>
                <table className="grp__charges-table">
                  <thead>
                    <tr>
                      <th>室</th>
                      <th>日付</th>
                      <th>種別</th>
                      <th>摘要</th>
                      <th className="grp__right">金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupCharges.map(c => (
                      <tr key={c.id} className={c.status !== 'active' ? 'grp__charge-cancelled' : ''}>
                        <td><span className="grp__room-index">室{c.room_index}</span></td>
                        <td>{c.date?.slice(5) || ''}</td>
                        <td><ChargeTypeBadge type={c.charge_type} /></td>
                        <td>{c.description}</td>
                        <td className="grp__right grp__amount">
                          {Number(c.amount).toLocaleString()}円
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {/* 精算サマリー */}
                <div className="grp__summary">
                  <div className="grp__summary-item">
                    <div className="grp__summary-label">売上合計</div>
                    <div className="grp__summary-value">{salesTotal.toLocaleString()}円</div>
                  </div>
                  <div className="grp__summary-item">
                    <div className="grp__summary-label">入金済</div>
                    <div className="grp__summary-value grp__summary-value--paid">
                      {paymentTotal.toLocaleString()}円
                    </div>
                  </div>
                  <div className="grp__summary-item">
                    <div className="grp__summary-label">
                      {balance > 0 ? '未収' : balance < 0 ? '過入金' : '精算済'}
                    </div>
                    <div className={`grp__summary-value ${balance > 0 ? 'grp__summary-value--unpaid' : balance < 0 ? 'grp__summary-value--paid' : ''}`}>
                      {Math.abs(balance).toLocaleString()}円
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                売上明細がありません
              </p>
            )}
          </div>
        </div>

        {/* ── 右カラム: 帳票・予約情報 ── */}
        <div className="grp__col--right">
          <div className="grp__card">
            <h3 className="grp__card-title">
              <span className="material-symbols-outlined">info</span>
              予約情報
            </h3>
            <table className="grp__info-table" style={{ width: '100%', fontSize: 'var(--font-size-sm)' }}>
              <tbody>
                <InfoRow label="予約番号" value={d.reservation_no} />
                <InfoRow label="チャネル" value={channelLabel} />
                <InfoRow label="予約者" value={`${d.tl_last_name || ''} ${d.tl_first_name || ''}`.trim()} />
                <InfoRow label="CI日" value={d.checkin_date} />
                <InfoRow label="CO日" value={d.checkout_date} />
                <InfoRow label="泊数" value={`${d.nights}泊`} />
                <InfoRow label="室数" value={`${children.length}室`} />
                <InfoRow label="合計金額" value={`${children.reduce((s, c) => s + Number(c.amount || 0), 0).toLocaleString()}円`} />
              </tbody>
            </table>
          </div>

          {/* 発行済み帳票 */}
          {d.documents?.length > 0 && (
            <div className="grp__card">
              <h3 className="grp__card-title">
                <span className="material-symbols-outlined">description</span>
                発行済み帳票
              </h3>
              {d.documents.map(doc => (
                <div key={doc.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '6px 0', borderBottom: '1px solid #f0f0f0',
                  fontSize: 'var(--font-size-xs)'
                }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{doc.document_number}</div>
                    <div style={{ color: 'var(--text-secondary)' }}>
                      {doc.addressee} — {Number(doc.total).toLocaleString()}円
                    </div>
                  </div>
                  <button className="grp__detail-link" onClick={async () => {
                    try {
                      await api.download(`/documents/${doc.id}?format=pdf&download=1`, `${doc.document_number}.pdf`);
                    } catch (err) { showAlert('エラー', err.message); }
                  }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 13 }}>download</span>
                    PDF
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* グループ領収書ダイアログ */}
      {showReceipt && (
        <GroupReceiptDialog
          parentId={d.id}
          guestName={`${d.tl_last_name || ''} ${d.tl_first_name || ''}`.trim()}
          receiptAddressee={d.receipt_addressee}
          children={children}
          groupCharges={groupCharges}
          onIssued={() => { setShowReceipt(false); onRefresh(); }}
          onCancel={() => setShowReceipt(false)}
        />
      )}
    </div>
  );
}

/* ── ヘルパーコンポーネント ── */

function InfoRow({ label, value }) {
  return (
    <tr>
      <td style={{ padding: '4px 0', color: 'var(--text-secondary)', width: '80px' }}>{label}</td>
      <td style={{ padding: '4px 0', fontWeight: 500 }}>{value}</td>
    </tr>
  );
}

// 明細種別バッジ（ReservationDetailPageと同じ）
function ChargeTypeBadge({ type }) {
  const labels = {
    room: '宿泊', cancel_fee: 'キャンセル料', no_show_fee: 'NS料',
    addon: '追加', discount: '割引', payment: '入金', refund: '返金',
  };
  return <span className={`rd__charge-type rd__charge-type--${type}`}>{labels[type] || type}</span>;
}

/**
 * グループ領収書発行ダイアログ
 * グループ全室一括でgroup=trueで発行する
 */
function GroupReceiptDialog({ parentId, guestName, receiptAddressee, children, groupCharges, onIssued, onCancel }) {
  const { alert: showAlert } = useConfirm();

  const [addresseeMode, setAddresseeMode] = useState(
    receiptAddressee ? 'custom' : 'guest'
  );
  const [customAddressee, setCustomAddressee] = useState(receiptAddressee || '');
  const [saveAddressee, setSaveAddressee] = useState(false);
  const [description, setDescription] = useState('宿泊代として');
  const [issuing, setIssuing] = useState(false);

  // グループ全体の売上合計
  const activeCharges = groupCharges.filter(c => c.status === 'active' && !['payment', 'refund'].includes(c.charge_type));
  const total = activeCharges.reduce((s, c) => s + Number(c.amount), 0);

  const resolveAddressee = () => {
    if (addresseeMode === 'guest') return guestName;
    return customAddressee;
  };

  const handleIssue = async () => {
    const addressee = resolveAddressee();
    if (!addressee?.trim()) {
      showAlert('エラー', '宛名を入力してください');
      return;
    }
    setIssuing(true);
    try {
      const res = await api.post('/documents/receipt', {
        reservation_id: parentId,
        addressee: addressee.trim(),
        description,
        group: true,
        save_addressee: addresseeMode === 'custom' && saveAddressee,
      });
      await api.download(
        `/documents/${res.document_id}?format=pdf&download=1`,
        `receipt_group_${res.document_id}.pdf`
      );
      onIssued();
    } catch (err) {
      showAlert('エラー', err.message);
    }
    setIssuing(false);
  };

  return (
    <>
      <div className="rd__overlay" onClick={onCancel} />
      <div className="rd__dialog" style={{ width: 480 }}>
        <h2 className="rd__dialog-title">
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>receipt_long</span>
          グループ領収書発行
        </h2>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
          {children.length}室分の売上をまとめた領収書を発行します
        </p>

        {/* 宛名選択 */}
        <div className="rd__dialog-field">
          <label className="rd__dialog-label">宛名</label>
          <div className="rd__receipt-addressee">
            <label className="rd__receipt-radio">
              <input type="radio" name="grp_addr" value="guest"
                checked={addresseeMode === 'guest'} onChange={() => setAddresseeMode('guest')} />
              {guestName || '（ゲスト名なし）'}
            </label>
            <label className="rd__receipt-radio">
              <input type="radio" name="grp_addr" value="custom"
                checked={addresseeMode === 'custom'} onChange={() => setAddresseeMode('custom')} />
              直接入力
            </label>
            {addresseeMode === 'custom' && (
              <div className="rd__receipt-custom-wrap">
                <input className="rd__dialog-input" value={customAddressee}
                  onChange={(e) => setCustomAddressee(e.target.value)}
                  placeholder="宛名を入力" autoFocus />
                <label className="rd__receipt-save-label">
                  <input type="checkbox" checked={saveAddressee}
                    onChange={(e) => setSaveAddressee(e.target.checked)} />
                  次回以降のデフォルトとして保存
                </label>
              </div>
            )}
          </div>
        </div>

        {/* 但し書き */}
        <div className="rd__dialog-field">
          <label className="rd__dialog-label">但し書き</label>
          <input className="rd__dialog-input" value={description}
            onChange={(e) => setDescription(e.target.value)} />
        </div>

        {/* 合計表示 */}
        <div style={{
          marginTop: 12, padding: '10px 12px',
          background: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--font-size-sm)', display: 'flex', justifyContent: 'space-between',
        }}>
          <span>グループ合計（{children.length}室）</span>
          <strong>{total.toLocaleString()}円</strong>
        </div>

        <div className="rd__dialog-actions">
          <button className="rd__dialog-cancel" onClick={onCancel}>キャンセル</button>
          <button className="rd__dialog-confirm rd__dialog-confirm--receipt"
            onClick={handleIssue} disabled={issuing}>
            {issuing ? '発行中...' : 'グループ領収書を発行'}
          </button>
        </div>
      </div>
    </>
  );
}
