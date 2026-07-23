import React, { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useConfirm } from '../../components/ConfirmDialog';
import ProductPicker from '../../components/ProductPicker';
import { todayStr } from '../../utils/date';

/**
 * 予約詳細の売上明細テーブル（インライン編集・行追加・入金記録）
 * ReservationDetailPage.jsx が2,200行超に肥大化したため分割（2026-06-11）
 */
const CHARGE_TYPE_OPTIONS = [
  { value: 'room', label: '宿泊' },
  { value: 'cancel_fee', label: 'キャンセル料' },
  { value: 'no_show_fee', label: 'NS料' },
  { value: 'addon', label: '追加' },
  { value: 'discount', label: '割引' },
  { value: 'goods', label: '物販' },
  { value: 'payment', label: '入金' },
  { value: 'refund', label: '返金' },
];

// 手動の行追加で選べない種別
//   payment … 専用の入金フォームがあるため
//   goods   … product_sales と対になる行なので、明細側から単独で作らせない
//             （物販の追加は「物販を追加」ボタン → ProductPicker 経由のみ）
const MANUAL_ADD_EXCLUDED_TYPES = ['payment', 'goods'];

const CHARGE_STATUS_OPTIONS = [
  { value: 'active', label: '有効' },
  { value: 'cancelled', label: '取消' },
  { value: 'waived', label: '免除' },
];

export function EditableChargesTable({ charges, reservationId, updatedAt, onSaved, canAddGoods = false }) {
  const { confirm: showConfirm, alert: showAlert } = useConfirm();
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  const [showAddRow, setShowAddRow] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showGoods, setShowGoods] = useState(false);
  const [newRow, setNewRow] = useState({ date: todayStr(), charge_type: 'addon', description: '', amount: '' });
  const [payRow, setPayRow] = useState({ date: todayStr(), description: '', amount: '', payment_method_id: '' });
  const [paymentMethods, setPaymentMethods] = useState([]);

  // 決済方法マスタ取得
  useEffect(() => {
    api.get('/master/payment-methods').then(d => setPaymentMethods(d.payment_methods || d)).catch(() => {});
  }, []);

  const startEdit = (c) => {
    setEditingId(c.id);
    setEditData({ date: c.date, charge_type: c.charge_type, description: c.description || '', amount: c.amount, status: c.status });
  };
  const cancelEdit = () => { setEditingId(null); setEditData({}); };

  const saveEdit = async (chargeId) => {
    setSaving(true);
    try {
      await api.put(`/reservations/${reservationId}`, {
        charges: [{ id: chargeId, ...editData, amount: Number(editData.amount) }],
        updated_at: updatedAt,
      });
      setEditingId(null);
      onSaved();
    } catch (err) { showAlert('エラー', err.message); }
    setSaving(false);
  };

  // 行追加
  const addCharge = async () => {
    if (!newRow.amount) return;
    setSaving(true);
    try {
      await api.put(`/reservations/${reservationId}`, {
        add_charges: [{ ...newRow, amount: Number(newRow.amount) }],
        updated_at: updatedAt,
      });
      setShowAddRow(false);
      setNewRow({ date: todayStr(), charge_type: 'addon', description: '', amount: '' });
      onSaved();
    } catch (err) { showAlert('エラー', err.message); }
    setSaving(false);
  };

  // 入金記録
  const addPayment = async () => {
    if (!payRow.amount) return;
    setSaving(true);
    try {
      const pmName = paymentMethods.find(p => String(p.id) === String(payRow.payment_method_id))?.method_name || '';
      await api.put(`/reservations/${reservationId}`, {
        add_charges: [{
          date: payRow.date,
          charge_type: 'payment',
          description: payRow.description || pmName,
          amount: Number(payRow.amount),
          payment_method_id: payRow.payment_method_id ? Number(payRow.payment_method_id) : null,
        }],
        updated_at: updatedAt,
      });
      setShowPayment(false);
      setPayRow({ date: todayStr(), description: '', amount: '', payment_method_id: '' });
      onSaved();
    } catch (err) { showAlert('エラー', err.message); }
    setSaving(false);
  };

  // 行削除（論理削除）
  const deleteCharge = async (chargeId) => {
    if (!await showConfirm('明細行の削除', 'この明細行を削除しますか？', { confirmColor: 'red', confirmLabel: '削除する' })) return;
    try {
      await api.put(`/reservations/${reservationId}`, { delete_charge_ids: [chargeId], updated_at: updatedAt });
      onSaved();
    } catch (err) { showAlert('エラー', err.message); }
  };

  // 各種合計の算出
  const activeCharges = charges.filter(c => c.status === 'active');
  const roomTotal = activeCharges.filter(c => c.charge_type === 'room').reduce((s, c) => s + Number(c.amount), 0);
  const discountTotal = activeCharges.filter(c => c.charge_type === 'discount').reduce((s, c) => s + Number(c.amount), 0); // マイナス値
  const addonTotal = activeCharges.filter(c => !['room', 'discount', 'payment', 'refund'].includes(c.charge_type)).reduce((s, c) => s + Number(c.amount), 0);
  // 売上合計 = 宿泊料 + 割引(マイナス) + その他
  const salesTotal = roomTotal + discountTotal + addonTotal;
  const paymentTotal = activeCharges.filter(c => c.charge_type === 'payment').reduce((s, c) => s + Number(c.amount), 0);
  const balance = salesTotal - paymentTotal;

  return (
    <div className="rd__card">
      <h3 className="rd__card-title">
        売上明細
        <span className="rd__charges-total">
          {balance > 0 && <span className="rd__balance rd__balance--unpaid">未収: {balance.toLocaleString()}円</span>}
          {balance < 0 && <span className="rd__balance rd__balance--over">過入金: {Math.abs(balance).toLocaleString()}円</span>}
          {balance === 0 && paymentTotal > 0 && <span className="rd__balance rd__balance--paid">精算済</span>}
        </span>
      </h3>

      <table className="rd__charges-table">
        <thead>
          <tr>
            <th style={{ width: '80px' }}>日付</th>
            <th style={{ width: '44px' }}>種別</th>
            <th>摘要</th>
            <th style={{ width: '64px' }} className="rd__right">金額</th>
            <th style={{ width: '32px' }} className="rd__right">税</th>
            <th style={{ width: '40px' }}>状態</th>
            <th style={{ width: '48px' }}></th>
          </tr>
        </thead>
        <tbody>
          {charges.map(c => {
            const isEditing = editingId === c.id;
            const isPending = c.amount === 0 && c.status === 'active' && c.charge_type !== 'payment';
            const isPayment = c.charge_type === 'payment';
            const isGoods = c.charge_type === 'goods';
            return (
              <React.Fragment key={c.id}>
                <tr className={`${c.status !== 'active' ? 'rd__charge--inactive' : ''} ${isPending ? 'rd__charge--pending' : ''} ${isPayment ? 'rd__charge--payment' : ''} ${isEditing ? 'rd__charge--editing' : ''}`}>
                  <td>{c.date}</td>
                  <td><ChargeTypeBadge type={c.charge_type} /></td>
                  <td className="rd__charge-desc" title={c.description}>{c.description}</td>
                  <td className="rd__right">{Number(c.amount).toLocaleString()}</td>
                  <td className="rd__right">{Number(c.tax_amount).toLocaleString()}</td>
                  <td><span className={`rd__charge-status rd__charge-status--${c.status}`}>{c.status === 'active' ? (isPending ? '要設定' : '') : c.status === 'cancelled' ? '取消' : c.status === 'waived' ? '免除' : c.status}</span></td>
                  <td>
                    {/* 物販行は product_sales と1対1で対応するため、明細側から
                        単独で編集・削除させない（片方だけ変えると売上集計が食い違う）。
                        取消は物販ページの履歴から行う */}
                    {isGoods ? (
                      <span className="rd__edit-actions" title="物販の修正・取消は物販ページから行ってください">
                        <span className="material-symbols-outlined rd__charge-locked">lock</span>
                      </span>
                    ) : (
                      <span className="rd__edit-actions">
                        <button className="rd__edit-btn" onClick={() => isEditing ? cancelEdit() : startEdit(c)}>
                          <span className="material-symbols-outlined">{isEditing ? 'close' : 'edit'}</span>
                        </button>
                        {!isEditing && (
                          <button className="rd__edit-btn" onClick={() => deleteCharge(c.id)}>
                            <span className="material-symbols-outlined">delete</span>
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
                {/* 編集カード: テーブル行の直下に展開 */}
                {isEditing && (
                  <tr>
                    <td colSpan="7" style={{ padding: 0 }}>
                      <div className="rd__edit-card">
                        <div className="rd__edit-card-fields">
                          <div className="rd__edit-card-field">
                            <label className="rd__edit-card-label">日付</label>
                            <input type="date" className="rd__edit-card-input" value={editData.date}
                              onChange={(e) => setEditData(d => ({ ...d, date: e.target.value }))} />
                          </div>
                          <div className="rd__edit-card-field">
                            <label className="rd__edit-card-label">種別</label>
                            {/* 行追加と同じく payment / goods への変更は不可（goods は product_sales と
                                対で管理するため、明細側から goods 行を作れてはならない）。
                                現在の種別だけは表示のため選択肢に残す */}
                            <select className="rd__edit-card-input" value={editData.charge_type}
                              onChange={(e) => setEditData(d => ({ ...d, charge_type: e.target.value }))}>
                              {CHARGE_TYPE_OPTIONS
                                .filter(o => !MANUAL_ADD_EXCLUDED_TYPES.includes(o.value) || o.value === editData.charge_type)
                                .map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </div>
                          <div className="rd__edit-card-field rd__edit-card-field--wide">
                            <label className="rd__edit-card-label">摘要</label>
                            <input type="text" className="rd__edit-card-input" value={editData.description}
                              onChange={(e) => setEditData(d => ({ ...d, description: e.target.value }))} />
                          </div>
                          <div className="rd__edit-card-field">
                            <label className="rd__edit-card-label">金額</label>
                            <input type="number" className="rd__edit-card-input rd__edit-card-amount" value={editData.amount}
                              onChange={(e) => setEditData(d => ({ ...d, amount: e.target.value }))} />
                          </div>
                          <div className="rd__edit-card-field">
                            <label className="rd__edit-card-label">状態</label>
                            <select className="rd__edit-card-input" value={editData.status}
                              onChange={(e) => setEditData(d => ({ ...d, status: e.target.value }))}>
                              {CHARGE_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </div>
                        </div>
                        <div className="rd__edit-card-actions">
                          <button className="rd__edit-card-save" onClick={() => saveEdit(c.id)} disabled={saving}>
                            <span className="material-symbols-outlined">check</span> {saving ? '保存中...' : '保存'}
                          </button>
                          <button className="rd__edit-card-cancel" onClick={cancelEdit}>キャンセル</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}

          {/* 行追加・入金フォーム: テーブル外に配置 */}
        </tbody>
      </table>

      {/* 明細行追加フォーム（カード型） */}
      {showAddRow && (
        <div className="rd__add-form">
          <div className="rd__add-form-header">
            <span className="material-symbols-outlined">receipt_long</span>
            明細行を追加
          </div>
          <div className="rd__add-form-body">
            <div className="rd__pay-field">
              <label className="rd__pay-label">日付</label>
              <input type="date" className="rd__pay-input" value={newRow.date}
                onChange={(e) => setNewRow(r => ({ ...r, date: e.target.value }))} />
            </div>
            <div className="rd__pay-field">
              <label className="rd__pay-label">種別</label>
              <select className="rd__pay-input rd__pay-select" value={newRow.charge_type}
                onChange={(e) => setNewRow(r => ({ ...r, charge_type: e.target.value }))}>
                {CHARGE_TYPE_OPTIONS.filter(o => !MANUAL_ADD_EXCLUDED_TYPES.includes(o.value)).map(o =>
                  <option key={o.value} value={o.value}>{o.label}</option>
                )}
              </select>
            </div>
            <div className="rd__pay-field" style={{ flex: 1 }}>
              <label className="rd__pay-label">摘要</label>
              <input type="text" className="rd__pay-input" value={newRow.description}
                onChange={(e) => setNewRow(r => ({ ...r, description: e.target.value }))}
                placeholder="内容を入力" />
            </div>
            <div className="rd__pay-field">
              <label className="rd__pay-label">金額</label>
              <div className="rd__pay-amount-wrap">
                <input type="number" className="rd__pay-input rd__pay-amount" value={newRow.amount}
                  onChange={(e) => setNewRow(r => ({ ...r, amount: e.target.value }))} placeholder="0" />
                <span className="rd__pay-yen">円</span>
              </div>
            </div>
          </div>
          <div className="rd__pay-form-actions">
            <button className="rd__pay-cancel" onClick={() => setShowAddRow(false)}>キャンセル</button>
            <button className="rd__add-submit" onClick={addCharge} disabled={saving || !newRow.amount}>
              {saving ? '処理中...' : '追加を確定'}
            </button>
          </div>
        </div>
      )}

      {/* 入金フォーム（カード型） */}
      {showPayment && (
        <div className="rd__pay-form">
          <div className="rd__pay-form-header">
            <span className="material-symbols-outlined">payments</span>
            入金を記録
          </div>
          <div className="rd__pay-form-body">
            <div className="rd__pay-field">
              <label className="rd__pay-label">日付</label>
              <input type="date" className="rd__pay-input" value={payRow.date}
                onChange={(e) => setPayRow(r => ({ ...r, date: e.target.value }))} />
            </div>
            <div className="rd__pay-field">
              <label className="rd__pay-label">決済方法</label>
              <select className="rd__pay-input rd__pay-select" value={payRow.payment_method_id}
                onChange={(e) => setPayRow(r => ({ ...r, payment_method_id: e.target.value }))}>
                <option value="">選択してください</option>
                {paymentMethods.map(pm => <option key={pm.id} value={pm.id}>{pm.method_name}</option>)}
              </select>
            </div>
            <div className="rd__pay-field">
              <label className="rd__pay-label">金額</label>
              <div className="rd__pay-amount-wrap">
                <input type="number" className="rd__pay-input rd__pay-amount" value={payRow.amount}
                  onChange={(e) => setPayRow(r => ({ ...r, amount: e.target.value }))} placeholder="0" />
                <span className="rd__pay-yen">円</span>
              </div>
            </div>
          </div>
          <div className="rd__pay-form-actions">
            <button className="rd__pay-cancel" onClick={() => setShowPayment(false)}>キャンセル</button>
            <button className="rd__pay-submit" onClick={addPayment} disabled={saving || !payRow.amount}>
              {saving ? '処理中...' : '入金を確定'}
            </button>
          </div>
        </div>
      )}

      {/* サマリー */}
      <div className="rd__charges-summary">
        <div className="rd__summary-row">
          <span className="rd__summary-label">宿泊料合計</span>
          <span className="rd__summary-value">{roomTotal.toLocaleString()}円</span>
        </div>
        {discountTotal !== 0 && (
          <div className="rd__summary-row rd__summary-row--discount">
            <span className="rd__summary-label">割引</span>
            <span className="rd__summary-value">{discountTotal.toLocaleString()}円</span>
          </div>
        )}
        {addonTotal !== 0 && (
          <div className="rd__summary-row">
            <span className="rd__summary-label">その他</span>
            <span className="rd__summary-value">{addonTotal.toLocaleString()}円</span>
          </div>
        )}
        <div className="rd__summary-row rd__summary-row--total">
          <span className="rd__summary-label">請求額</span>
          <span className="rd__summary-value">{salesTotal.toLocaleString()}円</span>
        </div>
        {paymentTotal > 0 && (
          <div className="rd__summary-row rd__summary-row--payment">
            <span className="rd__summary-label">入金済</span>
            <span className="rd__summary-value">-{paymentTotal.toLocaleString()}円</span>
          </div>
        )}
        {balance !== 0 && (
          <div className={`rd__summary-row ${balance > 0 ? 'rd__summary-row--unpaid' : 'rd__summary-row--over'}`}>
            <span className="rd__summary-label">{balance > 0 ? '未収' : '過入金'}</span>
            <span className="rd__summary-value">{Math.abs(balance).toLocaleString()}円</span>
          </div>
        )}
        {balance === 0 && paymentTotal > 0 && (
          <div className="rd__summary-row rd__summary-row--paid">
            <span className="rd__summary-label">精算済</span>
            <span className="rd__summary-value">0円</span>
          </div>
        )}
      </div>

      {/* アクションボタン */}
      <div className="rd__charges-actions">
        <button className="rd__charges-add" onClick={() => { setShowAddRow(true); setShowPayment(false); }}>
          <span className="material-symbols-outlined">add</span> 明細行を追加
        </button>
        <button className="rd__charges-pay" onClick={() => {
          // 未収額を初期値にセット
          setPayRow(r => ({ ...r, amount: balance > 0 ? String(balance) : '' }));
          setShowPayment(true); setShowAddRow(false);
        }}>
          <span className="material-symbols-outlined">payments</span> 入金を記録
        </button>
        {/* 物販の部屋付けはCI済み（在室中）の予約のみ。サーバー側でも同じ条件を検証している */}
        {canAddGoods && (
          <button className="rd__charges-add" onClick={() => setShowGoods(true)}>
            <span className="material-symbols-outlined">local_mall</span> 物販を追加
          </button>
        )}
      </div>

      {showGoods && (
        <GoodsDialog
          reservationId={reservationId}
          updatedAt={updatedAt}
          onClose={() => setShowGoods(false)}
          onAdded={() => { setShowGoods(false); onSaved(); }}
        />
      )}
    </div>
  );
}

/**
 * 物販追加ダイアログ（予約詳細用）
 * 商品グリッド＋カートは物販ページと同じ ProductPicker を使う（規約 #15）
 */
function GoodsDialog({ reservationId, updatedAt, onClose, onAdded }) {
  const { confirm: showConfirm, alert: showAlert } = useConfirm();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get('/master/products')
      .then(d => setProducts(d.products || []))
      .catch(e => showAlert('商品の取得に失敗しました', e.message))
      .finally(() => setLoading(false));
    // showAlert は毎レンダー生成されるため依存に入れない（初回のみ取得する意図）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rd__goods-overlay" onClick={onClose}>
      <div className="rd__goods-modal" onClick={e => e.stopPropagation()}>
        <div className="rd__goods-header">
          <h3 className="rd__goods-title">物販を追加（部屋付け）</h3>
          <button className="rd__edit-btn" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {loading ? (
          <p className="rd__goods-loading">読み込み中...</p>
        ) : (
          <ProductPicker
            products={products}
            submitting={submitting}
            actions={({ items, total, clearCart, disabled }) => (
              <button
                className="rd__add-submit"
                disabled={disabled}
                onClick={async () => {
                  const ok = await showConfirm(
                    '部屋付けの確定',
                    `${items.reduce((s, i) => s + i.quantity, 0)}点 / 合計 ¥${total.toLocaleString()} をこの予約の明細に追加します。よろしいですか？`,
                    { confirmLabel: '追加する' }
                  );
                  if (!ok) return;

                  setSubmitting(true);
                  try {
                    // 楽観ロック（規約 #16）
                    await api.post('/product-sales', {
                      items,
                      reservation_id: reservationId,
                      updated_at: updatedAt,
                    });
                    clearCart();
                    onAdded();
                  } catch (e) {
                    showAlert('部屋付けに失敗しました', e.message);
                  } finally {
                    setSubmitting(false);
                  }
                }}
              >
                {submitting ? '処理中...' : '明細に追加'}
              </button>
            )}
          />
        )}
      </div>
    </div>
  );
}

export function ChargeTypeBadge({ type }) {
  const labels = { room: '宿泊', cancel_fee: 'キャンセル料', no_show_fee: 'NS料', addon: '追加', discount: '割引', goods: '物販', payment: '入金', refund: '返金' };
  return <span className={`rd__charge-type rd__charge-type--${type}`}>{labels[type] || type}</span>;
}
