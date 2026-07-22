import { useState } from 'react';
import { api } from '../../api/client';
import { useConfirm } from '../../components/ConfirmDialog';
import { fmtDateTime } from '../../utils/date';
import { ChargeTypeBadge } from './ChargesTable';

/**
 * 領収書発行・再発行ダイアログと発行済み帳票一覧
 * ReservationDetailPage.jsx が2,200行超に肥大化したため分割（2026-06-11）
 */
/**
 * 領収書発行ダイアログ
 * 宛名選択（ゲスト名/法人名/直接入力）+ 明細チェックボックス + グループ一括
 * 全ステータスで使用可能（CO前の仮領収書にも対応）
 */
export function ReceiptIssueDialog({ reservation, charges, onIssued, onCancel }) {
  const { alert: showAlert } = useConfirm();

  // 領収書対象: payment/refund以外のアクティブ明細
  const eligibleCharges = (charges || []).filter(
    c => c.status === 'active' && !['payment', 'refund'].includes(c.charge_type)
  );

  const guestName = reservation.guest_name
    || `${reservation.tl_last_name || ''} ${reservation.tl_first_name || ''}`.trim();

  // 宛名モード: receipt_addressee保存済みなら直接入力をデフォルトにする
  const [addresseeMode, setAddresseeMode] = useState(
    reservation.receipt_addressee ? 'custom' : 'guest'
  );
  const [customAddressee, setCustomAddressee] = useState(
    reservation.receipt_addressee || ''
  );
  const [saveAddressee, setSaveAddressee] = useState(false);
  const [description, setDescription] = useState('宿泊代として');
  const [selectedChargeIds, setSelectedChargeIds] = useState(
    () => eligibleCharges.map(c => c.id)
  );
  const [isGroup, setIsGroup] = useState(false);
  const [issuing, setIssuing] = useState(false);

  const resolveAddressee = () => {
    switch (addresseeMode) {
      case 'guest': return guestName;
      case 'company': return reservation.company_name || '';
      case 'custom': return customAddressee;
      default: return '';
    }
  };

  const toggleCharge = (chargeId) => {
    setSelectedChargeIds(prev =>
      prev.includes(chargeId)
        ? prev.filter(id => id !== chargeId)
        : [...prev, chargeId]
    );
  };

  const toggleAll = () => {
    if (selectedChargeIds.length === eligibleCharges.length) {
      setSelectedChargeIds([]);
    } else {
      setSelectedChargeIds(eligibleCharges.map(c => c.id));
    }
  };

  const selectedTotal = eligibleCharges
    .filter(c => selectedChargeIds.includes(c.id))
    .reduce((sum, c) => sum + Number(c.amount), 0);

  const handleIssue = async () => {
    const addressee = resolveAddressee();
    if (!addressee?.trim()) {
      showAlert('エラー', '宛名を入力してください');
      return;
    }
    if (selectedChargeIds.length === 0 && !isGroup) {
      showAlert('エラー', '対象明細を選択してください');
      return;
    }
    setIssuing(true);
    try {
      // 全明細選択時はcharge_idsを省略（バックエンドが全件対象と判断）
      const allSelected = selectedChargeIds.length === eligibleCharges.length;
      // グループ一括発行時は親予約IDを送る（子予約から呼ぶため）
      const targetId = isGroup && reservation.parent_reservation
        ? reservation.parent_reservation.id
        : reservation.id;
      const res = await api.post('/documents/receipt', {
        reservation_id: targetId,
        addressee: addressee.trim(),
        description,
        charge_ids: allSelected ? undefined : selectedChargeIds,
        group: isGroup,
        save_addressee: addresseeMode === 'custom' && saveAddressee,
      });
      // 発行成功 → 即PDFダウンロード
      await api.download(
        `/documents/${res.document_id}?format=pdf&download=1`,
        `receipt_${res.document_id}.pdf`
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
      <div className="rd__dialog rd__dialog--receipt">
        <h2 className="rd__dialog-title">
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>receipt_long</span>
          領収書発行
        </h2>

        {/* 宛名選択 */}
        <div className="rd__dialog-field">
          <label className="rd__dialog-label">宛名</label>
          <div className="rd__receipt-addressee">
            <label className="rd__receipt-radio">
              <input type="radio" name="addressee" value="guest"
                checked={addresseeMode === 'guest'} onChange={() => setAddresseeMode('guest')} />
              {guestName || '（ゲスト名なし）'}
            </label>
            {/* 法人名: company_nameがある場合のみ表示 */}
            {reservation.company_name && (
              <label className="rd__receipt-radio">
                <input type="radio" name="addressee" value="company"
                  checked={addresseeMode === 'company'} onChange={() => setAddresseeMode('company')} />
                {reservation.company_name}（法人）
              </label>
            )}
            <label className="rd__receipt-radio">
              <input type="radio" name="addressee" value="custom"
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
                  この宛名を次回以降のデフォルトとして保存
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

        {/* 対象明細 */}
        {eligibleCharges.length > 0 ? (
          <>
            <div className="rd__receipt-charges-header">
              <h4>対象明細</h4>
              <button className="rd__receipt-select-all" onClick={toggleAll}>
                {selectedChargeIds.length === eligibleCharges.length ? '全解除' : '全選択'}
              </button>
            </div>
            <div className="rd__receipt-charges">
              {eligibleCharges.map(c => (
                <div key={c.id} className="rd__receipt-charge-row"
                  onClick={() => toggleCharge(c.id)}>
                  <input type="checkbox" checked={selectedChargeIds.includes(c.id)}
                    onChange={() => toggleCharge(c.id)}
                    onClick={(e) => e.stopPropagation()} />
                  <span className="rd__receipt-charge-date">{c.date?.slice(5) || ''}</span>
                  <ChargeTypeBadge type={c.charge_type} />
                  <span className="rd__receipt-charge-desc">{c.description}</span>
                  <span className="rd__receipt-charge-amount">
                    {Number(c.amount).toLocaleString()}円
                  </span>
                </div>
              ))}
            </div>
            <div className="rd__receipt-total">
              選択合計: {selectedTotal.toLocaleString()}円
            </div>
          </>
        ) : (
          <div className="rd__receipt-no-charges">
            対象となる明細がありません
          </div>
        )}

        {/* グループ一括: 複数室予約の子室の場合のみ表示 */}
        {reservation.is_multi_room_child && reservation.child_reservations?.length > 0 && (
          <label className="rd__receipt-group-option">
            <input type="checkbox" checked={isGroup}
              onChange={(e) => setIsGroup(e.target.checked)} />
            グループ全室一括で発行（{reservation.child_reservations.length}室分）
          </label>
        )}

        <div className="rd__dialog-actions">
          <button className="rd__dialog-cancel" onClick={onCancel}>キャンセル</button>
          <button
            className="rd__dialog-confirm rd__dialog-confirm--receipt"
            onClick={handleIssue}
            disabled={issuing || (eligibleCharges.length === 0 && !isGroup)}
          >
            {issuing ? '発行中...' : '領収書を発行'}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * 発行済み帳票一覧セクション
 * 売上明細テーブルの下に表示。PDFダウンロード・再発行ボタン付き
 */
export function DocumentListSection({ documents, onRefresh }) {
  const { alert: showAlert } = useConfirm();
  // 再発行ダイアログの対象ドキュメント（帳票一覧と密結合なのでローカル管理）
  const [reissueDoc, setReissueDoc] = useState(null);

  const handleDownload = async (doc) => {
    try {
      await api.download(
        `/documents/${doc.id}?format=pdf&download=1`,
        `${doc.document_number}.pdf`
      );
    } catch (err) {
      showAlert('エラー', err.message);
    }
  };

  return (
    <div className="rd__card rd__doc-section">
      <h3>
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>description</span>
        発行済み帳票
      </h3>
      <table className="rd__doc-table">
        <thead>
          <tr>
            <th>帳票番号</th>
            <th>宛名</th>
            <th className="rd__right">金額</th>
            <th>発行日</th>
            <th>発行者</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {documents.map(doc => (
            <tr key={doc.id}>
              <td>
                {doc.document_number}
                {doc.reissue_count > 0 && (
                  <span className="rd__doc-reissue-count">（再{doc.reissue_count}回）</span>
                )}
              </td>
              <td>{doc.addressee}</td>
              <td className="rd__right">{Number(doc.total).toLocaleString()}円</td>
              <td>{fmtDateTime(doc.issued_at, false)}</td>
              <td>{doc.issued_by_name}</td>
              <td>
                <div className="rd__doc-actions">
                  <button className="rd__doc-btn" onClick={() => handleDownload(doc)}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>download</span>
                    PDF
                  </button>
                  <button className="rd__doc-btn" onClick={() => setReissueDoc(doc)}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>refresh</span>
                    再発行
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {reissueDoc && (
        <ReceiptReissueDialog
          document={reissueDoc}
          onReissued={() => { setReissueDoc(null); onRefresh(); }}
          onCancel={() => setReissueDoc(null)}
        />
      )}
    </div>
  );
}

/**
 * 領収書再発行ダイアログ
 * 宛名・但し書きを変更して再発行 → PDFダウンロード
 */
function ReceiptReissueDialog({ document: doc, onReissued, onCancel }) {
  const { alert: showAlert } = useConfirm();
  const [addressee, setAddressee] = useState(doc.addressee);
  const [description, setDescription] = useState(doc.description || '宿泊代として');
  const [issuing, setIssuing] = useState(false);

  const handleReissue = async () => {
    if (!addressee?.trim()) {
      showAlert('エラー', '宛名を入力してください');
      return;
    }
    setIssuing(true);
    try {
      const res = await api.post(`/documents/${doc.id}/reissue`, {
        addressee: addressee.trim(),
        description,
      });
      await api.download(
        `/documents/${res.document_id}?format=pdf&download=1`,
        `receipt_reissue_${res.document_id}.pdf`
      );
      onReissued();
    } catch (err) {
      showAlert('エラー', err.message);
    }
    setIssuing(false);
  };

  return (
    <>
      <div className="rd__overlay" onClick={onCancel} />
      <div className="rd__dialog">
        <h2 className="rd__dialog-title">領収書 再発行</h2>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          元帳票: {doc.document_number}
          {doc.reissue_count > 0 && ` （既に${doc.reissue_count}回再発行済み）`}
        </p>

        <div className="rd__dialog-field">
          <label className="rd__dialog-label">宛名</label>
          <input className="rd__dialog-input" value={addressee}
            onChange={(e) => setAddressee(e.target.value)} />
        </div>
        <div className="rd__dialog-field">
          <label className="rd__dialog-label">但し書き</label>
          <input className="rd__dialog-input" value={description}
            onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="rd__dialog-actions">
          <button className="rd__dialog-cancel" onClick={onCancel}>キャンセル</button>
          <button className="rd__dialog-confirm" onClick={handleReissue} disabled={issuing}>
            {issuing ? '発行中...' : '再発行する'}
          </button>
        </div>
      </div>
    </>
  );
}
