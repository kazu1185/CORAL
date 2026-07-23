import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useConfirm } from '../components/ConfirmDialog';
import ProductPicker from '../components/ProductPicker';
import { taxRateLabel } from '../utils/constants';
import { fmtDateTime, todayStr } from '../utils/date';
import './ProductSalesPage.css';

/**
 * 物販ページ（レジ画面）
 *
 * 商品を選んでカートに入れ、「即売」または「部屋付け」で確定する。
 * 下部に当日の販売履歴を出し、誤登録はその場で取消できる。
 *
 * ポーリングはしない（自画面の操作が主で、他端末の販売が即時に見えなくても支障がないため）。
 * 販売・取消の直後に履歴を再取得する。
 */
export default function ProductSalesPage() {
  const [products, setProducts] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [sales, setSales] = useState([]);
  const [inHouse, setInHouse] = useState([]);       // 在室中（CI済み）の予約
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [roomPicker, setRoomPicker] = useState(null);  // 部屋付け先を選ぶモーダルの状態
  const [paymentMethodId, setPaymentMethodId] = useState(null);  // 即売の支払方法

  const { confirm: showConfirm, alert: showAlert, prompt: showPrompt } = useConfirm();

  const fetchSales = useCallback(async () => {
    const res = await api.get(`/product-sales?date=${todayStr()}`);
    setSales(res.sales || []);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      // 商品・支払方法は有効なもののみ（無効化した商品を売れてしまわないように）
      const [prodRes, pmRes, inHouseRes] = await Promise.all([
        api.get('/master/products'),
        api.get('/master/payment-methods'),
        api.get('/reservations?status=checked_in&per_page=100'),
      ]);
      setProducts(prodRes.products || []);
      const methods = pmRes.payment_methods || [];
      setPaymentMethods(methods);
      // 既定は並び順の先頭（マスタで現金が先頭になっている想定）。
      // 未選択のまま販売ボタンを押せてしまうのを防ぐ
      setPaymentMethodId(prev => prev ?? methods[0]?.id ?? null);
      setInHouse(inHouseRes.data || []);
      await fetchSales();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [fetchSales]);

  useEffect(() => { fetchData(); }, [fetchData]);

  /** 即売の確定（支払方法を選んで確認ダイアログ→登録） */
  const handleImmediateSale = async (items, paymentMethod, total) => {
    const ok = await showConfirm(
      '即売の確定',
      `${items.reduce((s, i) => s + i.quantity, 0)}点 / 合計 ¥${total.toLocaleString()} を「${paymentMethod.method_name}」で販売します。よろしいですか？`,
      { confirmLabel: '販売する' }
    );
    if (!ok) return false;

    setSubmitting(true);
    try {
      await api.post('/product-sales', { items, payment_method_id: paymentMethod.id });
      await fetchSales();
      return true;
    } catch (e) {
      showAlert('販売に失敗しました', e.message);
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  /** 部屋付けの確定（在室中の予約を選んで確認ダイアログ→登録） */
  const handleRoomCharge = async (items, reservation, total) => {
    const ok = await showConfirm(
      '部屋付けの確定',
      `${items.reduce((s, i) => s + i.quantity, 0)}点 / 合計 ¥${total.toLocaleString()} を ${reservation.room_number || '（部屋未割当）'} ${reservation.guest_name} 様の明細に追加します。よろしいですか？`,
      { confirmLabel: '部屋付けする' }
    );
    if (!ok) return false;

    setSubmitting(true);
    try {
      // 楽観ロック（規約 #16）: 予約一覧取得時点の updated_at を送る
      await api.post('/product-sales', {
        items,
        reservation_id: reservation.id,
        updated_at: reservation.updated_at,
      });
      await fetchSales();
      // 明細追加で予約の請求額が変わるため、在室予約の updated_at を取り直す
      const res = await api.get('/reservations?status=checked_in&per_page=100');
      setInHouse(res.data || []);
      return true;
    } catch (e) {
      showAlert('部屋付けに失敗しました', e.message);
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * 即売の領収書発行（1会計＝1枚）
   *
   * 複数商品を1回で販売した場合、product_sales は商品ごとに行が分かれるが
   * 領収書は会計単位で1枚にする。同一会計は sale_group_id で束ねる。
   * 部屋付けはCO精算で宿泊の領収書に含まれるため、ここでは即売のみ対象
   */
  const handleReceipt = async (groupSales) => {
    const total = groupSales.reduce((s, x) => s + Number(x.amount), 0);
    const label = groupSales.length === 1
      ? `「${groupSales[0].product_name} ×${groupSales[0].quantity}」`
      : `${groupSales.length}品目（${groupSales.map(x => x.product_name).join('、')}）`;

    const addressee = await showPrompt(
      '領収書の発行',
      `${label}（¥${total.toLocaleString()}）の領収書を発行します。宛名を入力してください。`,
      { placeholder: '宛名（例: 山田 太郎）', confirmLabel: '発行する' }
    );
    if (addressee === null) return;
    if (!addressee.trim()) {
      showAlert('宛名が未入力です', '宛名を入力してください');
      return;
    }

    try {
      const res = await api.post('/documents/sales-receipt', {
        sale_ids: groupSales.map(x => x.id),
        addressee: addressee.trim(),
        payment_method_id: groupSales[0].payment_method_id,
      });
      // 発行成功 → 既存の領収書と同じくPDFをダウンロード
      await api.download(
        `/documents/${res.document_id}?format=pdf&download=1`,
        `receipt_${res.document_id}.pdf`
      );
      await fetchSales();
    } catch (e) {
      showAlert('領収書の発行に失敗しました', e.message);
    }
  };

  /** 販売の取消（論理削除。部屋付けは明細行も連動して取消される） */
  const handleCancel = async (sale) => {
    const target = sale.reservation_id
      ? `${sale.room_number || '部屋未割当'} への部屋付け`
      : '即売';
    const ok = await showConfirm(
      '販売の取消',
      `「${sale.product_name} ×${sale.quantity}」（${target} / ¥${Number(sale.amount).toLocaleString()}）を取消します。よろしいですか？`,
      { confirmLabel: '取消する', confirmColor: 'red' }
    );
    if (!ok) return;

    try {
      await api.put(`/product-sales/${sale.id}/cancel`, {});
      await fetchSales();
      // 部屋付けの取消は予約の請求額を再計算する（= updated_at が変わる）ため、
      // 部屋付け確定時と同様に在室予約を取り直す。
      // 取らないと、取消直後に同じ予約へ再度部屋付けした際に楽観ロックの409になる
      if (sale.reservation_id) {
        const res = await api.get('/reservations?status=checked_in&per_page=100');
        setInHouse(res.data || []);
      }
    } catch (e) {
      showAlert('取消に失敗しました', e.message);
    }
  };

  if (loading) return <div className="ps-page__loading">読み込み中...</div>;

  return (
    <div className="ps-page">
      <div className="ps-page__header">
        <h1 className="ps-page__title">
          <span className="material-symbols-outlined ps-page__icon">local_mall</span>
          物販
        </h1>
      </div>

      {error && <div className="ps-page__error">{error}</div>}

      <ProductPicker
        products={products}
        submitting={submitting}
        actions={({ items, total, clearCart, disabled }) => (
          <>
            <div className="ps-actions__label">即売（その場で決済）</div>
            {/* 決済方法はOTA決済を含め10件以上あるため、ボタン羅列ではなくセレクトにする
                （レジ画面のカートが縦に伸びて商品グリッドが押しにくくなるのを避ける） */}
            <div className="ps-actions__row">
              <select
                className="ps-select"
                /* 決済方法マスタの取得前は null になるため '' に落とす（React の制御コンポーネント警告対策） */
                value={paymentMethodId ?? ''}
                onChange={e => setPaymentMethodId(e.target.value ? Number(e.target.value) : null)}
              >
                {paymentMethods.map(pm => (
                  <option key={pm.id} value={pm.id}>{pm.method_name}</option>
                ))}
              </select>
              <button
                type="button"
                className="ps-btn ps-btn--primary"
                disabled={disabled || !paymentMethodId}
                onClick={async () => {
                  const pm = paymentMethods.find(m => m.id === paymentMethodId);
                  const ok = await handleImmediateSale(items, pm, total);
                  if (ok) clearCart();
                }}
              >
                販売
              </button>
            </div>

            <div className="ps-actions__label">部屋付け（CO時に精算）</div>
            <button
              type="button"
              className="ps-btn"
              disabled={disabled}
              onClick={() => setRoomPicker({ items, total, clearCart })}
            >
              <span className="material-symbols-outlined">door_front</span>
              在室中の予約から選ぶ
            </button>
          </>
        )}
      />

      {roomPicker && (
        <RoomChargeDialog
          reservations={inHouse}
          total={roomPicker.total}
          onClose={() => setRoomPicker(null)}
          onSelect={async (reservation) => {
            const ok = await handleRoomCharge(roomPicker.items, reservation, roomPicker.total);
            if (ok) {
              roomPicker.clearCart();
              setRoomPicker(null);
            }
          }}
        />
      )}

      <SalesHistory sales={sales} onCancel={handleCancel} onReceipt={handleReceipt} />
    </div>
  );
}

/** 当日の販売履歴 */
function SalesHistory({ sales, onCancel, onReceipt }) {
  // 領収書は会計単位で1枚のため、同じ会計（sale_group_id）の有効な即売行をまとめておく。
  // 発行ボタンは会計の先頭行にだけ出す
  const groups = new Map();
  for (const s of sales) {
    if (s.reservation_id || s.status !== 'active') continue;   // 部屋付け・取消済みは対象外
    const key = s.sale_group_id ?? s.id;   // sale_group_id 導入前のデータは自分自身を会計とみなす
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  // 会計の先頭行のID（この行にだけ領収書ボタンを出す）
  const receiptAnchorIds = new Set([...groups.values()].map(g => g[0].id));

  return (
    <div className="ps-history">
      <div className="ps-history__title">本日の販売履歴</div>

      <div className="ps-history__card">
        <table className="ps-history__table">
          <thead>
            <tr>
              <th style={{ width: 64 }}>時刻</th>
              <th>商品</th>
              <th style={{ width: 50 }}>数量</th>
              <th style={{ width: 90 }}>金額</th>
              <th style={{ width: 70 }}>税率</th>
              <th style={{ width: 160 }}>区分</th>
              <th style={{ width: 110 }}>スタッフ</th>
              <th style={{ width: 130 }}></th>
            </tr>
          </thead>
          <tbody>
            {sales.map(s => {
              const cancelled = s.status === 'cancelled';
              const group = groups.get(s.sale_group_id ?? s.id) || [];
              const isReceiptAnchor = receiptAnchorIds.has(s.id);
              return (
                <tr key={s.id} className={cancelled ? 'ps-history__row--cancelled' : ''}>
                  <td>{fmtDateTime(s.created_at, false).slice(-5)}</td>
                  <td>{s.product_name}</td>
                  <td>{s.quantity}</td>
                  <td className="ps-history__amount">¥{Number(s.amount).toLocaleString()}</td>
                  <td>{taxRateLabel(s.tax_rate)}</td>
                  <td>
                    {s.reservation_id
                      ? `部屋付け ${s.room_number || '（部屋未割当）'}${s.guest_name ? ` / ${s.guest_name}` : ''}`
                      : `即売 / ${s.payment_method_name || '-'}`}
                  </td>
                  <td>{s.staff_name}</td>
                  {/* flexは td に直接当てず内側の div に当てる（tdがtable-cellでなくなると行の高さ・縦位置がずれるため） */}
                  <td>
                    <div className="ps-history__actions">
                      {!cancelled && (
                        <>
                          {/* 領収書は即売のみ・会計単位で1枚。部屋付けはCO精算時に宿泊の領収書へ含める */}
                          {isReceiptAnchor && (
                            s.receipt_issued
                              ? <span className="ps-history__issued" title="この会計の領収書は発行済みです">発行済</span>
                              : <button className="ps-btn ps-btn--sm" onClick={() => onReceipt(group)}>
                                  領収書{group.length > 1 ? `（${group.length}品）` : ''}
                                </button>
                          )}
                          <button className="ps-btn ps-btn--sm" onClick={() => onCancel(s)}>取消</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {sales.length === 0 && (
              <tr>
                <td colSpan={8} className="ps-history__empty">本日の販売はまだありません</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 部屋付け先の予約を選ぶダイアログ（在室中の予約のみ） */
function RoomChargeDialog({ reservations, total, onClose, onSelect }) {
  const [keyword, setKeyword] = useState('');

  const filtered = reservations.filter(r => {
    if (!keyword) return true;
    const k = keyword.toLowerCase();
    return String(r.room_number || '').toLowerCase().includes(k)
      || String(r.guest_name || '').toLowerCase().includes(k);
  });

  return (
    <div className="ps-modal__overlay" onClick={onClose}>
      <div className="ps-modal" onClick={e => e.stopPropagation()}>
        <h3 className="ps-modal__title">部屋付け先を選択（合計 ¥{total.toLocaleString()}）</h3>

        <input
          className="ps-modal__search"
          placeholder="部屋番号・ゲスト名で絞り込み"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          autoFocus
        />

        <div className="ps-modal__list">
          {filtered.map(r => (
            <button key={r.id} type="button" className="ps-modal__item" onClick={() => onSelect(r)}>
              <span className="ps-modal__room">{r.room_number || '未割当'}</span>
              <span className="ps-modal__guest">{r.guest_name}</span>
              <span className="ps-modal__no">{r.reservation_no}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="ps-modal__empty">
              {reservations.length === 0 ? '在室中の予約がありません' : '該当する予約がありません'}
            </p>
          )}
        </div>

        <div className="ps-modal__actions">
          <button type="button" className="ps-btn" onClick={onClose}>キャンセル</button>
        </div>
      </div>
    </div>
  );
}
