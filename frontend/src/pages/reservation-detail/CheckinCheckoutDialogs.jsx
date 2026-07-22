import { useState } from 'react';

/**
 * チェックイン / チェックアウト確認ダイアログ
 * ReservationDetailPage.jsx が2,200行超に肥大化したため分割（2026-06-11）
 */
export function CheckinDialog({ onConfirm, onCancel, reservation }) {
  const charges = reservation.charges || [];
  const salesTotal = charges.filter(c => c.status === 'active' && !['payment', 'refund'].includes(c.charge_type)).reduce((s, c) => s + Number(c.amount), 0);
  const paymentTotal = charges.filter(c => c.status === 'active' && c.charge_type === 'payment').reduce((s, c) => s + Number(c.amount), 0);
  const balance = salesTotal - paymentTotal;
  // 未精算 = 入金が売上に達していない（OTA事前決済の場合は入金行がないので未精算扱いになる）
  const hasUnpaid = balance > 0;

  return (
    <>
      <div className="rd__overlay" onClick={onCancel} />
      <div className="rd__dialog">
        <h2 className="rd__dialog-title">チェックイン確認</h2>
        <p>ゲスト: <strong>{reservation.guest_name || `${reservation.tl_last_name} ${reservation.tl_first_name}`}</strong></p>
        <p>部屋: <strong>{reservation.assignments?.find(a => a.status === 'active')?.room_number || '未アサイン'}</strong></p>

        {hasUnpaid && (
          <div className="rd__dialog-warning">
            <span className="material-symbols-outlined">error</span>
            <div>
              <div className="rd__dialog-warning-title">未精算があります</div>
              <div className="rd__dialog-warning-detail">
                売上 {salesTotal.toLocaleString()}円 に対し 入金 {paymentTotal.toLocaleString()}円
                — <strong>未収 {balance.toLocaleString()}円</strong>
              </div>
            </div>
          </div>
        )}

        {reservation.guest_notes && (
          <div className="rd__dialog-alert">
            <span className="material-symbols-outlined">warning</span>
            {reservation.guest_notes}
          </div>
        )}

        <div className="rd__dialog-actions">
          <button className="rd__dialog-cancel" onClick={onCancel}>キャンセル</button>
          <button className={`rd__dialog-confirm ${hasUnpaid ? 'rd__dialog-confirm--warn' : ''}`} onClick={() => onConfirm()}>
            {hasUnpaid ? '未精算のままチェックインする' : 'チェックインする'}
          </button>
        </div>
      </div>
    </>
  );
}

export function CheckoutDialog({ onConfirm, onCancel, reservation, isEarly }) {
  const [issueReceipt, setIssueReceipt] = useState(false);
  // 宛名選択: ReceiptIssueDialogと同じ3択パターン
  const guestName = reservation.guest_name
    || `${reservation.tl_last_name || ''} ${reservation.tl_first_name || ''}`.trim();
  const [addresseeMode, setAddresseeMode] = useState(
    reservation.receipt_addressee ? 'custom' : 'guest'
  );
  const [customAddressee, setCustomAddressee] = useState(
    reservation.receipt_addressee || ''
  );

  const handleConfirm = () => {
    const opts = {};
    if (issueReceipt) {
      const resolved = addresseeMode === 'guest' ? guestName
        : addresseeMode === 'company' ? (reservation.company_name || '')
        : customAddressee;
      opts.issue_receipt = true;
      opts.receipt_addressee = resolved;
      opts.receipt_description = '宿泊代として';
    }
    onConfirm(opts);
  };

  return (
    <>
      <div className="rd__overlay" onClick={onCancel} />
      <div className="rd__dialog">
        <h2 className="rd__dialog-title">チェックアウト確認</h2>
        <p>ゲスト: <strong>{guestName}</strong></p>
        <p>金額: <strong>{Number(reservation.amount).toLocaleString()}円</strong></p>

        {isEarly && (
          <div className="rd__dialog-alert">
            <span className="material-symbols-outlined">info</span>
            予定日より早いチェックアウトです（予定: {reservation.checkout_date}）
          </div>
        )}

        <label className="rd__dialog-checkbox">
          <input type="checkbox" checked={issueReceipt} onChange={(e) => setIssueReceipt(e.target.checked)} />
          領収書を発行する
        </label>

        {issueReceipt && (
          <div className="rd__dialog-field">
            <label className="rd__dialog-label">宛名</label>
            <div className="rd__receipt-addressee">
              <label className="rd__receipt-radio">
                <input type="radio" name="co_addressee" value="guest"
                  checked={addresseeMode === 'guest'} onChange={() => setAddresseeMode('guest')} />
                {guestName || '（ゲスト名なし）'}
              </label>
              {reservation.company_name && (
                <label className="rd__receipt-radio">
                  <input type="radio" name="co_addressee" value="company"
                    checked={addresseeMode === 'company'} onChange={() => setAddresseeMode('company')} />
                  {reservation.company_name}（法人）
                </label>
              )}
              <label className="rd__receipt-radio">
                <input type="radio" name="co_addressee" value="custom"
                  checked={addresseeMode === 'custom'} onChange={() => setAddresseeMode('custom')} />
                直接入力
              </label>
              {addresseeMode === 'custom' && (
                <div className="rd__receipt-custom-wrap">
                  <input className="rd__dialog-input" value={customAddressee}
                    onChange={(e) => setCustomAddressee(e.target.value)}
                    placeholder="宛名を入力" />
                </div>
              )}
            </div>
          </div>
        )}

        <div className="rd__dialog-actions">
          <button className="rd__dialog-cancel" onClick={onCancel}>キャンセル</button>
          <button className="rd__dialog-confirm rd__dialog-confirm--co" onClick={handleConfirm}>チェックアウトする</button>
        </div>
      </div>
    </>
  );
}
