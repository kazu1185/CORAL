import { useState, useEffect } from 'react';
import { api, ApiError } from '../../api/client';
import { useConfirm } from '../../components/ConfirmDialog';
import { todayStr } from '../../utils/date';
import { calcMoney, yen } from '../money';
import { FrontButton } from './FrontButton';
import PdfPreviewOverlay from './PdfPreviewOverlay';
import './SettlementPanel.css';

/**
 * 精算パネル（金額サマリー＋入金登録＋領収書発行）— CI確認 / CO精算 で共用。
 * Patina はチェックイン時に精算する運用のため CI 画面にも載せる（2026-07-24 ユーザー指示）。
 *
 * 入金は PUT /reservations/:id(add_charges)（既存ChargesTableと同一）、
 * 領収書は POST /documents/receipt → アプリ内PDFプレビュー（規約 #29）。
 *
 * props:
 *   data      … GET /reservations/:id のレスポンス（charges/updated_at/guest_name/group情報を含む）
 *   onChanged … 入金登録などでデータが変わったとき親に再取得させるコールバック
 */
export default function SettlementPanel({ data, onChanged }) {
  const { alert: showAlert, prompt: showPrompt } = useConfirm();
  const [payMethods, setPayMethods] = useState([]);
  const [selectedPm, setSelectedPm] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [pdfUrl, setPdfUrl] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const money = calcMoney(data.charges);
  const isGroup = data.status === 'group_parent' || !!data.is_multi_room_child;
  const parentId = data.is_multi_room_child ? data.parent_reservation?.id : (data.status === 'group_parent' ? data.id : null);
  const displayName = data.guest_name || `${data.tl_last_name || ''} ${data.tl_first_name || ''}`.trim();

  // 支払方法マスタ（入金登録ボタン）
  useEffect(() => {
    api.get('/master/payment-methods')
      .then(d => {
        const list = d.payment_methods || d || [];
        setPayMethods(list);
        if (list.length > 0) setSelectedPm(prev => prev ?? list[0].id);
      })
      .catch(() => {});
  }, []);

  // 残額が変わったら入金額の初期値を残額にそろえる
  useEffect(() => {
    setPayAmount(money.due > 0 ? String(money.due) : '');
  }, [money.due]);

  // objectURL の後片付け
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  async function handleApiError(e) {
    if (e instanceof ApiError && e.status === 409) {
      await showAlert('再読み込みが必要です', '他の端末で更新されました。最新の内容を再読み込みします。');
      onChanged && onChanged();
    } else {
      await showAlert('処理できません', e instanceof ApiError ? e.message : 'エラーが発生しました');
    }
  }

  const registerPayment = async () => {
    const amt = Number(String(payAmount).replace(/[^\d]/g, ''));
    if (!amt || amt <= 0) { await showAlert('入金額を確認してください', '1円以上の金額を入力してください'); return; }
    const pm = payMethods.find(p => p.id === selectedPm);
    setSubmitting(true);
    try {
      await api.put(`/reservations/${data.id}`, {
        add_charges: [{
          date: todayStr(),
          charge_type: 'payment',
          description: pm?.method_name || '入金',
          amount: amt,
          payment_method_id: selectedPm || null,
        }],
        updated_at: data.updated_at,
      });
      onChanged && onChanged();
    } catch (e) {
      await handleApiError(e);
    } finally {
      setSubmitting(false);
    }
  };

  const issueReceipt = async () => {
    const addressee = await showPrompt('領収書の宛名', '宛名を入力してください', {
      defaultValue: displayName, confirmLabel: '発行する',
    });
    if (addressee === null) return;
    setSubmitting(true);
    try {
      const res = await api.post('/documents/receipt', {
        reservation_id: isGroup && parentId ? parentId : data.id,
        addressee: addressee.trim() || displayName,
        group: isGroup,
      });
      const blob = await api.fetchBlob(`/documents/${res.document_id}?format=pdf`);
      setPdfUrl(URL.createObjectURL(blob));
    } catch (e) {
      await handleApiError(e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="fd__card-title">精算</div>
      <div className="set__summary">
        <div className="set__row">合計<b className="num">{yen(money.total)}</b></div>
        <div className="set__row">入金済み<b className="num">{yen(money.paid)}</b></div>
        <div className="set__due">
          <div className="set__due-label">残額</div>
          <div className={`set__due-amt num ${money.due > 0 ? '' : 'set__due-amt--paid'}`}>
            {money.due > 0 ? yen(money.due) : '精算済み'}
          </div>
        </div>
      </div>

      {money.due > 0 && (
        <div className="set__pay">
          <div className="set__paygrid">
            {payMethods.map(pm => (
              <button
                key={pm.id}
                type="button"
                className={`set__paybtn ${selectedPm === pm.id ? 'is-selected' : ''}`}
                onClick={() => setSelectedPm(pm.id)}
              >{pm.method_name}</button>
            ))}
          </div>
          <input
            className="set__payamount num"
            inputMode="numeric"
            value={payAmount}
            onChange={(e) => setPayAmount(e.target.value.replace(/[^\d]/g, ''))}
            aria-label="入金額"
          />
          <FrontButton variant="secondary" size="lg" className="set__fullbtn" disabled={submitting} onClick={registerPayment}>入金を登録</FrontButton>
        </div>
      )}

      <FrontButton variant="secondary" size="lg" className="set__fullbtn set__receipt" disabled={submitting} onClick={issueReceipt}>🧾 領収書を発行</FrontButton>

      {pdfUrl && (
        <PdfPreviewOverlay
          url={pdfUrl}
          title="領収書"
          onClose={() => { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }}
        />
      )}
    </>
  );
}
