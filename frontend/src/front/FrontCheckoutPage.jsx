import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useConfirm } from '../components/ConfirmDialog';
import { todayStr } from '../utils/date';
import { useFrontData } from './FrontDataContext';
import { calcMoney, yen } from './money';
import { FrontButton, FrontBackButton } from './components/FrontButton';
import SuccessOverlay from './components/SuccessOverlay';
import PdfPreviewOverlay from './components/PdfPreviewOverlay';
import './FrontDetail.css';
import './FrontCheckoutPage.css';

// 明細に出す種別（入金・返金は精算サマリー側に集約するので明細行には出さない）
const isBillCharge = (c) => c.charge_type !== 'payment' && c.charge_type !== 'refund';
// 物販(goods)は編集不可（規約 #25）。フロントでは鍵アイコンで示すのみ
const isLocked = (c) => c.charge_type === 'goods';

/**
 * チェックアウト精算画面 — 仕様書 §4.4 / mock #view-co-detail
 * フロー: 明細確認 →（不足あれば入金登録）→ 領収書 → CO実行。
 * データ源 GET /reservations/:id。入金は PUT /reservations/:id(add_charges)、
 * 領収書は POST /documents/receipt → アプリ内PDFプレビュー、CO は POST /reservations/:id/checkout。
 */
export default function FrontCheckoutPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { confirm: showConfirm, alert: showAlert, prompt: showPrompt } = useConfirm();
  const { setPollEnabled, refetch } = useFrontData();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const [payMethods, setPayMethods] = useState([]);
  const [selectedPm, setSelectedPm] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [pdfUrl, setPdfUrl] = useState(null);

  // 詳細滞在中はボードのポーリングを止める（仕様書 §7）
  useEffect(() => {
    setPollEnabled(false);
    return () => setPollEnabled(true);
  }, [setPollEnabled]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get(`/reservations/${id}`);
      setData(d);
      const money = calcMoney(d.charges);
      setPayAmount(money.due > 0 ? String(money.due) : '');
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '予約の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // 支払方法マスタ（入金登録用ボタン）
  useEffect(() => {
    api.get('/master/payment-methods')
      .then(d => {
        const list = d.payment_methods || d || [];
        setPayMethods(list);
        if (list.length > 0) setSelectedPm(list[0].id);
      })
      .catch(() => {});
  }, []);

  // objectURL の後片付け
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  if (loading) return <div className="fd__loading">読み込み中…</div>;
  if (error) return (
    <div>
      <div className="fd__head"><FrontBackButton onClick={() => navigate('/front/checkout')} /><div className="fd__title">チェックアウト</div></div>
      <div className="fd__error">{error}</div>
    </div>
  );
  if (!data) return null;

  const isGroupParent = data.status === 'group_parent';
  const isChild = !!data.is_multi_room_child;
  const isGroup = isGroupParent || isChild;
  const children = data.child_reservations || [];
  const parentId = isChild ? data.parent_reservation?.id : (isGroupParent ? Number(id) : null);
  const groupTargets = children.filter(c => c.status === 'checked_in');

  const activeAssign = (data.assignments || []).find(a => a.status === 'active');
  const roomNumber = activeAssign?.room_number || null;
  const money = calcMoney(data.charges);
  const billRows = (data.charges || []).filter(c => c.status === 'active' && isBillCharge(c));

  const isEarly = todayStr() < data.checkout_date; // 本日より前がCO日 = 途中退室
  const displayName = data.guest_name || `${data.tl_last_name || ''} ${data.tl_first_name || ''}`.trim();
  const parentUpdatedAt = isChild ? data.parent_reservation?.updated_at : data.updated_at;

  const goBack = () => navigate('/front/checkout');

  async function handleApiError(e) {
    if (e instanceof ApiError && e.status === 409) {
      await showAlert('再読み込みが必要です', '他の端末で更新されました。最新の内容を再読み込みします。');
      await load();
    } else {
      await showAlert('処理できません', e instanceof ApiError ? e.message : 'エラーが発生しました');
    }
  }

  // 入金登録（既存 ChargesTable と同じ add_charges パターン）
  const registerPayment = async () => {
    const amt = Number(String(payAmount).replace(/[^\d-]/g, ''));
    if (!amt || amt <= 0) { await showAlert('入金額を確認してください', '1円以上の金額を入力してください'); return; }
    const pm = payMethods.find(p => p.id === selectedPm);
    setSubmitting(true);
    try {
      await api.put(`/reservations/${id}`, {
        add_charges: [{
          date: todayStr(),
          charge_type: 'payment',
          description: pm?.method_name || '入金',
          amount: amt,
          payment_method_id: selectedPm || null,
        }],
        updated_at: data.updated_at,
      });
      await load();
    } catch (e) {
      await handleApiError(e);
    } finally {
      setSubmitting(false);
    }
  };

  // 領収書発行 → アプリ内PDFプレビュー
  const issueReceipt = async () => {
    const addressee = await showPrompt('領収書の宛名', '宛名を入力してください', {
      defaultValue: displayName, confirmLabel: '発行する',
    });
    if (addressee === null) return;
    setSubmitting(true);
    try {
      const res = await api.post('/documents/receipt', {
        reservation_id: isGroup && parentId ? parentId : Number(id),
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

  const doSingleCheckout = async () => {
    const warn = money.due > 0
      ? `残額 ${yen(money.due)} がありますが、チェックアウトしますか？`
      : `${displayName} 様（${roomNumber || ''}）をチェックアウトしますか？`;
    if (!await showConfirm('チェックアウト', warn, { confirmLabel: 'チェックアウトする', confirmColor: money.due > 0 ? 'orange' : 'blue' })) return;
    setSubmitting(true);
    try {
      await api.post(`/reservations/${id}/checkout`, { updated_at: data.updated_at });
      setSuccess(true);
    } catch (e) {
      await handleApiError(e);
    } finally {
      setSubmitting(false);
    }
  };

  const doGroupCheckout = async () => {
    if (!parentId || groupTargets.length === 0) return;
    if (!await showConfirm('グループチェックアウト', `グループ全体（${groupTargets.length}室）をチェックアウトしますか？`, { confirmLabel: 'チェックアウトする' })) return;
    setSubmitting(true);
    try {
      await api.post(`/reservations/${parentId}/group-checkout`, {
        reservation_ids: groupTargets.map(c => c.id),
        updated_at: parentUpdatedAt,
      });
      setSuccess(true);
    } catch (e) {
      await handleApiError(e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="fd__head">
        <FrontBackButton onClick={goBack} />
        <div className="fd__title">チェックアウト</div>
        <div className="fd__guest">{displayName} 様{roomNumber ? ` ・ ${roomNumber}` : ''}</div>
      </div>

      <div className="fd__cols">
        {/* 左: 利用明細 */}
        <div className="fd__card fd__card--l">
          <div className="fd__card-title">利用明細</div>
          {billRows.length === 0 ? (
            <div className="fd__value--sub" style={{ padding: '12px 0' }}>明細がありません</div>
          ) : billRows.map(c => (
            <div className="fco__row" key={c.id}>
              <span className="fco__date num">{c.date ? c.date.slice(5) : '—'}</span>
              <span className="fco__desc">
                {c.description || c.charge_type}
                {isLocked(c) && <span className="fco__lock">🔒物販</span>}
              </span>
              <span className="fco__amt num">{yen(c.amount)}</span>
            </div>
          ))}
          {money.accTax > 0 && (
            <div className="fco__row"><span className="fco__date">—</span><span className="fco__desc">宿泊税</span><span className="fco__amt num">{yen(money.accTax)}</span></div>
          )}
          <div className="fd__card-foot">明細の修正はPCの予約詳細から行ってください</div>
          {isEarly && (
            <div className="fd__alert">途中退室（早期チェックアウト）の精算はPCの予約詳細で行ってください。ここでは通常のチェックアウトのみ行えます。</div>
          )}
        </div>

        {/* 右: 精算 */}
        <div className="fd__card fd__card--r">
          <div className="fd__card-title">精算</div>
          <div className="fco__summary">
            <div className="fco__summary-row">合計<b className="num">{yen(money.total)}</b></div>
            <div className="fco__summary-row">入金済み<b className="num">{yen(money.paid)}</b></div>
            <div className="fco__due">
              <div className="fco__due-label">残額</div>
              <div className={`fco__due-amt num ${money.due > 0 ? '' : 'fco__due-amt--paid'}`}>
                {money.due > 0 ? yen(money.due) : '精算済み'}
              </div>
            </div>
          </div>

          {/* 入金登録（残額>0時のみ） */}
          {money.due > 0 && (
            <div className="fco__pay">
              <div className="fco__paygrid">
                {payMethods.map(pm => (
                  <button
                    key={pm.id}
                    type="button"
                    className={`fco__paybtn ${selectedPm === pm.id ? 'is-selected' : ''}`}
                    onClick={() => setSelectedPm(pm.id)}
                  >{pm.method_name}</button>
                ))}
              </div>
              <input
                className="fco__payamount num"
                inputMode="numeric"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value.replace(/[^\d]/g, ''))}
                aria-label="入金額"
              />
              <FrontButton variant="secondary" size="lg" className="fco__fullbtn" disabled={submitting} onClick={registerPayment}>入金を登録</FrontButton>
            </div>
          )}

          <FrontButton variant="secondary" size="lg" className="fco__fullbtn fco__receipt" disabled={submitting} onClick={issueReceipt}>🧾 領収書を発行</FrontButton>

          {/* グループ子予約リスト */}
          {isGroup && children.length > 0 && (
            <div className="fd__group">
              <div className="fd__group-title">グループ（{children.length}室）</div>
              {children.map(c => (
                <div className="fd__group-row" key={c.id}>
                  <span className={`fd__group-room ${c.assigned_room ? '' : 'fd__group-room--none'}`}>{c.assigned_room || '—'}</span>
                  <span className="fd__group-name">{c.guest_name || `部屋${c.room_index ?? ''}`}</span>
                  <span className="fd__group-status">{c.status === 'checked_out' ? 'CO済' : c.status === 'checked_in' ? '在室' : c.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 下部固定アクションバー */}
      <div className="fd__actionbar">
        {isGroup ? (
          <>
            {groupTargets.length === 0 && <div className="fd__actionbar-note">⚠ チェックアウト可能な部屋がありません</div>}
            <div className="fd__actionbar-spacer" />
            <FrontButton variant="primary" size="xl" disabled={submitting || groupTargets.length === 0} onClick={doGroupCheckout}>
              グループ全体をチェックアウト（{groupTargets.length}室）
            </FrontButton>
          </>
        ) : (
          <>
            {money.due > 0 && <div className="fd__actionbar-note">⚠ 残額 {yen(money.due)} があります</div>}
            <div className="fd__actionbar-spacer" />
            <FrontButton variant="primary" size="xl" disabled={submitting} onClick={doSingleCheckout}>
              チェックアウトする
            </FrontButton>
          </>
        )}
      </div>

      {pdfUrl && (
        <PdfPreviewOverlay
          url={pdfUrl}
          title="領収書"
          onClose={() => { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }}
        />
      )}
      <SuccessOverlay show={success} text="チェックアウトが完了しました" onDone={() => { refetch(); goBack(); }} />
    </div>
  );
}
