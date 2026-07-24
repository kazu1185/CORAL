import { useState, useEffect, useCallback, useMemo } from 'react';
import { api, ApiError } from '../api/client';
import { useConfirm } from '../components/ConfirmDialog';
import { todayStr, fmtDateTime } from '../utils/date';
import { taxRateLabel } from '../utils/constants';
import { summarizeByTaxRate } from '../utils/tax';
import { yen } from './money';
import { FrontButton } from './components/FrontButton';
import SuccessOverlay from './components/SuccessOverlay';
import PdfPreviewOverlay from './components/PdfPreviewOverlay';
import './FrontPosPage.css';

/**
 * 物販POS（Phase 4） — 仕様書 §4.5 / mock #view-pos
 *
 * PCの ProductSalesPage と同じAPIを使うが、タブレット向けに大きなタップ面で作り直した。
 * 販売形態は2つ（規約 #25/#27）:
 *   即売     … 支払方法を選んでその場で決済（reservation_id なし）
 *   部屋付け … 在室中(CI済)の予約を選んで明細に追加し、CO時に精算（payment_method_id なし）
 *
 * 領収書はPC(api.download)と異なり、iPad PWAトラップ回避のため
 * fetchBlob → PdfPreviewOverlay で表示する（規約 #29）。即売のみ・会計単位で1枚。
 *
 * ポーリングはしない（自端末の操作が主。他端末の販売が即時に見えなくても支障がない）。
 * 販売・取消・部屋付けの直後に履歴と在室予約を取り直す。
 */
export default function FrontPosPage() {
  const { confirm: showConfirm, alert: showAlert, prompt: showPrompt } = useConfirm();

  const [products, setProducts] = useState([]);
  const [payMethods, setPayMethods] = useState([]);
  const [inHouse, setInHouse] = useState([]);      // 在室中(CI済)の予約
  const [sales, setSales] = useState([]);          // 本日の販売履歴
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // カート・選択状態
  const [cart, setCart] = useState([]);            // [{ product, quantity }]
  const [activeCategory, setActiveCategory] = useState('すべて');
  const [mode, setMode] = useState('immediate');   // 'immediate'(即売) | 'room'(部屋付け)
  const [selectedPm, setSelectedPm] = useState(null);
  const [roomTarget, setRoomTarget] = useState(null);  // 部屋付け先に選んだ在室予約
  const [roomPickerOpen, setRoomPickerOpen] = useState(false);

  // 演出・プレビュー
  const [successText, setSuccessText] = useState('');
  const [pdfUrl, setPdfUrl] = useState(null);

  const fetchSales = useCallback(async () => {
    const res = await api.get(`/product-sales?date=${todayStr()}`);
    setSales(res.sales || []);
  }, []);

  const fetchInHouse = useCallback(async () => {
    const res = await api.get('/reservations?status=checked_in&per_page=100');
    setInHouse(res.data || []);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      // 商品は有効なもののみ（無効化した商品を売れてしまわないように）。
      // 決済方法はフロント表示ONのものだけ（PC設定で選択・SettlementPanelと同じ front=1）
      const [prodRes, pmRes] = await Promise.all([
        api.get('/master/products'),
        api.get('/master/payment-methods?front=1'),
      ]);
      setProducts(prodRes.products || []);
      const methods = pmRes.payment_methods || pmRes || [];
      setPayMethods(methods);
      setSelectedPm(prev => prev ?? methods[0]?.id ?? null);
      await Promise.all([fetchInHouse(), fetchSales()]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [fetchInHouse, fetchSales]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // objectURL の後片付け（アンマウント時）
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  // ---- カート操作 ----
  const categories = useMemo(() => {
    const seen = [];
    for (const p of products) {
      if (p.category && !seen.includes(p.category)) seen.push(p.category);
    }
    return ['すべて', ...seen];
  }, [products]);

  const visibleProducts = activeCategory === 'すべて'
    ? products
    : products.filter(p => p.category === activeCategory);

  const addToCart = (product) => {
    setCart(prev => {
      const found = prev.find(l => l.product.id === product.id);
      if (found) return prev.map(l => l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l);
      return [...prev, { product, quantity: 1 }];
    });
  };
  const changeQuantity = (productId, delta) => {
    setCart(prev => prev
      .map(l => l.product.id === productId ? { ...l, quantity: l.quantity + delta } : l)
      .filter(l => l.quantity > 0));   // 0個になった行は消す
  };
  const removeLine = (productId) => setCart(prev => prev.filter(l => l.product.id !== productId));
  const clearCart = () => { setCart([]); setRoomTarget(null); };

  const total = cart.reduce((s, l) => s + l.product.price * l.quantity, 0);
  const taxBreakdown = summarizeByTaxRate(
    cart.map(l => ({ amount: l.product.price * l.quantity, tax_rate: l.product.tax_rate }))
  );
  const items = cart.map(l => ({ product_id: l.product.id, quantity: l.quantity }));
  const qtyCount = cart.reduce((s, l) => s + l.quantity, 0);

  async function handleApiError(e, fallbackTitle) {
    if (e instanceof ApiError && e.status === 409) {
      await showAlert('再読み込みが必要です', '他の端末で更新されました。在室予約を再取得します。');
      await fetchInHouse();
      setRoomTarget(null);
    } else {
      await showAlert(fallbackTitle, e instanceof ApiError ? e.message : 'エラーが発生しました');
    }
  }

  // ---- 即売 ----
  const doImmediateSale = async () => {
    if (cart.length === 0 || !selectedPm) return;
    const pm = payMethods.find(p => p.id === selectedPm);
    const ok = await showConfirm(
      '即売の確定',
      `${qtyCount}点 / 合計 ${yen(total)} を「${pm?.method_name || '選択した支払方法'}」で販売します。よろしいですか？`,
      { confirmLabel: '販売する' }
    );
    if (!ok) return;
    setSubmitting(true);
    try {
      await api.post('/product-sales', { items, payment_method_id: selectedPm });
      clearCart();
      await fetchSales();
      setSuccessText('会計が完了しました');
    } catch (e) {
      await handleApiError(e, '販売に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  // ---- 部屋付け ----
  const doRoomCharge = async () => {
    if (cart.length === 0 || !roomTarget) return;
    const ok = await showConfirm(
      '部屋付けの確定',
      `${qtyCount}点 / 合計 ${yen(total)} を ${roomTarget.room_number || '（部屋未割当）'} ${roomTarget.guest_name || ''} 様の明細に追加します。よろしいですか？`,
      { confirmLabel: '部屋付けする' }
    );
    if (!ok) return;
    setSubmitting(true);
    try {
      // 楽観ロック（規約 #16）: 予約一覧取得時点の updated_at を送る
      await api.post('/product-sales', {
        items,
        reservation_id: roomTarget.id,
        updated_at: roomTarget.updated_at,
      });
      clearCart();
      // 明細追加で予約の請求額(updated_at)が変わるため在室予約を取り直す
      await Promise.all([fetchSales(), fetchInHouse()]);
      setSuccessText('部屋付けが完了しました');
    } catch (e) {
      await handleApiError(e, '部屋付けに失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  // ---- 領収書（即売のみ・会計単位で1枚） ----
  const issueReceipt = async (groupSales) => {
    const receiptTotal = groupSales.reduce((s, x) => s + Number(x.amount), 0);
    const label = groupSales.length === 1
      ? `「${groupSales[0].product_name} ×${groupSales[0].quantity}」`
      : `${groupSales.length}品目（${groupSales.map(x => x.product_name).join('、')}）`;
    const addressee = await showPrompt(
      '領収書の発行',
      `${label}（${yen(receiptTotal)}）の領収書を発行します。宛名を入力してください。`,
      { placeholder: '宛名（例: 山田 太郎）', confirmLabel: '発行する' }
    );
    if (addressee === null) return;
    if (!addressee.trim()) { await showAlert('宛名が未入力です', '宛名を入力してください'); return; }
    setSubmitting(true);
    try {
      const res = await api.post('/documents/sales-receipt', {
        sale_ids: groupSales.map(x => x.id),
        addressee: addressee.trim(),
        payment_method_id: groupSales[0].payment_method_id,
      });
      // 規約 #29: <a download> ではなく fetchBlob → iframe プレビュー（iPad PWAトラップ回避）
      const blob = await api.fetchBlob(`/documents/${res.document_id}?format=pdf`);
      setPdfUrl(URL.createObjectURL(blob));
      await fetchSales();
    } catch (e) {
      await showAlert('領収書の発行に失敗しました', e instanceof ApiError ? e.message : 'エラーが発生しました');
    } finally {
      setSubmitting(false);
    }
  };

  // ---- 販売の取消（論理削除。部屋付けは明細行も連動取消） ----
  const cancelSale = async (sale) => {
    const target = sale.reservation_id
      ? `${sale.room_number || '部屋未割当'} への部屋付け`
      : '即売';
    const ok = await showConfirm(
      '販売の取消',
      `「${sale.product_name} ×${sale.quantity}」（${target} / ${yen(sale.amount)}）を取消します。よろしいですか？`,
      { confirmLabel: '取消する', confirmColor: 'red' }
    );
    if (!ok) return;
    try {
      await api.put(`/product-sales/${sale.id}/cancel`, {});
      await fetchSales();
      // 部屋付けの取消は予約の請求額を再計算する(updated_atが変わる)ため在室予約を取り直す。
      // 取らないと直後に同じ予約へ再度部屋付けした際に楽観ロック409になる
      if (sale.reservation_id) await fetchInHouse();
    } catch (e) {
      await showAlert('取消に失敗しました', e instanceof ApiError ? e.message : 'エラーが発生しました');
    }
  };

  if (loading) return <div className="fpos__loading">読み込み中…</div>;

  const confirmDisabled = cart.length === 0 || submitting
    || (mode === 'immediate' ? !selectedPm : !roomTarget);

  return (
    <div className="fpos">
      {error && <div className="fpos__error">{error}</div>}

      <div className="fpos__main">
        {/* 商品カタログ */}
        <div className="fpos__catalog">
          {categories.length > 2 && (
            <div className="fpos__cats">
              {categories.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`fpos-cat ${activeCategory === c ? 'is-active' : ''}`}
                  onClick={() => setActiveCategory(c)}
                >{c}</button>
              ))}
            </div>
          )}
          <div className="fpos__grid">
            {visibleProducts.map(p => (
              <button key={p.id} type="button" className="fpos-prod" onClick={() => addToCart(p)}>
                <span className="fpos-prod__name">{p.product_name}</span>
                <span className="fpos-prod__price num">
                  {yen(p.price)}
                  {/* 軽減税率の商品は取り違えやすいのでボタン上でも判別できるように */}
                  <span className="fpos-prod__tax">{taxRateLabel(p.tax_rate)}</span>
                </span>
              </button>
            ))}
            {visibleProducts.length === 0 && (
              <p className="fpos__empty">販売できる商品がありません</p>
            )}
          </div>
        </div>

        {/* カート */}
        <div className="fpos__cart">
          {/* 即売 / 部屋付け 切替 */}
          <div className="fpos__modes">
            <button
              type="button"
              className={`fpos-mode ${mode === 'immediate' ? 'is-active' : ''}`}
              onClick={() => setMode('immediate')}
            >即売</button>
            <button
              type="button"
              className={`fpos-mode ${mode === 'room' ? 'is-active' : ''}`}
              onClick={() => setMode('room')}
            >部屋付け</button>
          </div>

          {cart.length === 0 ? (
            <p className="fpos__cart-empty">商品をタップして追加</p>
          ) : (
            <div className="fpos__cart-lines">
              {cart.map(l => (
                <div key={l.product.id} className="fpos-line">
                  <span className="fpos-line__name">{l.product.product_name}</span>
                  <div className="fpos-line__stepper">
                    <button type="button" className="fpos-step" onClick={() => changeQuantity(l.product.id, -1)}>−</button>
                    <span className="fpos-line__qty num">{l.quantity}</span>
                    <button type="button" className="fpos-step" onClick={() => changeQuantity(l.product.id, 1)}>＋</button>
                  </div>
                  <span className="fpos-line__amt num">{yen(l.product.price * l.quantity)}</span>
                  <button type="button" className="fpos-line__rm" onClick={() => removeLine(l.product.id)} aria-label="削除">×</button>
                </div>
              ))}
            </div>
          )}

          {/* 税率別内訳（複数税率がある会計のみ） */}
          {taxBreakdown.length > 1 && cart.length > 0 && (
            <div className="fpos__breakdown">
              {taxBreakdown.map(b => (
                <div key={b.tax_rate} className="fpos__breakdown-row">
                  <span>{taxRateLabel(b.tax_rate)}対象</span>
                  <span className="num">{yen(b.amount)}（内税 {yen(b.tax_amount)}）</span>
                </div>
              ))}
            </div>
          )}

          <div className="fpos__total">
            <span className="fpos__total-label">合計</span>
            <span className="fpos__total-amt num">{yen(total)}</span>
          </div>

          {/* 確定エリア（モード別） */}
          {mode === 'immediate' ? (
            <>
              <div className="fpos__paygrid">
                {payMethods.map(pm => (
                  <button
                    key={pm.id}
                    type="button"
                    className={`fpos-pay ${selectedPm === pm.id ? 'is-selected' : ''}`}
                    onClick={() => setSelectedPm(pm.id)}
                  >{pm.method_name}</button>
                ))}
                {payMethods.length === 0 && (
                  <p className="fpos__empty">フロント表示の支払方法がありません（PC設定で選択してください）</p>
                )}
              </div>
              <FrontButton variant="primary" size="xl" className="fpos__cta" disabled={confirmDisabled} onClick={doImmediateSale}>
                会計する
              </FrontButton>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`fpos__roompick ${roomTarget ? 'is-set' : ''}`}
                onClick={() => setRoomPickerOpen(true)}
              >
                {roomTarget
                  ? <><span className="fpos__roompick-room">{roomTarget.room_number || '未割当'}</span><span className="fpos__roompick-name">{roomTarget.guest_name || ''} 様</span></>
                  : <span className="fpos__roompick-ph">在室中の予約から選ぶ</span>}
              </button>
              <FrontButton variant="primary" size="xl" className="fpos__cta" disabled={confirmDisabled} onClick={doRoomCharge}>
                部屋付けする
              </FrontButton>
            </>
          )}
        </div>
      </div>

      {/* 本日の販売履歴 */}
      <SalesHistory sales={sales} onCancel={cancelSale} onReceipt={issueReceipt} />

      {roomPickerOpen && (
        <RoomPickerOverlay
          reservations={inHouse}
          total={total}
          onClose={() => setRoomPickerOpen(false)}
          onSelect={(r) => { setRoomTarget(r); setRoomPickerOpen(false); }}
        />
      )}

      {pdfUrl && (
        <PdfPreviewOverlay url={pdfUrl} title="領収書" onClose={() => { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }} />
      )}

      <SuccessOverlay show={!!successText} text={successText} onDone={() => setSuccessText('')} />
    </div>
  );
}

/** 本日の販売履歴（取消・領収書） */
function SalesHistory({ sales, onCancel, onReceipt }) {
  // 領収書は会計単位で1枚。同じ会計(sale_group_id)の有効な即売行をまとめ、先頭行にだけボタンを出す
  const groups = new Map();
  for (const s of sales) {
    if (s.reservation_id || s.status !== 'active') continue;   // 部屋付け・取消済みは対象外
    const key = s.sale_group_id ?? s.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const receiptAnchorIds = new Set([...groups.values()].map(g => g[0].id));

  return (
    <div className="fpos-hist">
      <div className="fpos-hist__title">本日の販売履歴</div>
      <div className="fpos-hist__list">
        {sales.length === 0 && <div className="fpos-hist__empty">本日の販売はまだありません</div>}
        {sales.map(s => {
          const cancelled = s.status === 'cancelled';
          const group = groups.get(s.sale_group_id ?? s.id) || [];
          const isReceiptAnchor = receiptAnchorIds.has(s.id);
          return (
            <div key={s.id} className={`fpos-hist__row ${cancelled ? 'is-cancelled' : ''}`}>
              <span className="fpos-hist__time num">{fmtDateTime(s.created_at, false).slice(-5)}</span>
              <span className="fpos-hist__name">{s.product_name} ×{s.quantity}</span>
              <span className="fpos-hist__amt num">{yen(s.amount)}</span>
              <span className="fpos-hist__kind">
                {s.reservation_id
                  ? `部屋付け ${s.room_number || '（部屋未割当）'}`
                  : `即売 / ${s.payment_method_name || '-'}`}
              </span>
              <span className="fpos-hist__actions">
                {!cancelled && (
                  <>
                    {isReceiptAnchor && (
                      s.receipt_issued
                        ? <span className="fpos-hist__issued">発行済</span>
                        : <button type="button" className="fpos-hist__btn" onClick={() => onReceipt(group)}>領収書{group.length > 1 ? `（${group.length}品）` : ''}</button>
                    )}
                    <button type="button" className="fpos-hist__btn fpos-hist__btn--cancel" onClick={() => onCancel(s)}>取消</button>
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 部屋付け先の予約を選ぶオーバーレイ（在室中の予約のみ・部屋番号/ゲスト名で絞込） */
function RoomPickerOverlay({ reservations, total, onClose, onSelect }) {
  const [keyword, setKeyword] = useState('');
  const filtered = reservations.filter(r => {
    if (!keyword) return true;
    const k = keyword.toLowerCase();
    return String(r.room_number || '').toLowerCase().includes(k)
      || String(r.guest_name || '').toLowerCase().includes(k);
  });
  return (
    <div className="fpos-modal__ov" onClick={onClose}>
      <div className="fpos-modal" onClick={e => e.stopPropagation()}>
        <div className="fpos-modal__title">部屋付け先を選択（合計 {yen(total)}）</div>
        <input
          className="fpos-modal__search"
          placeholder="部屋番号・ゲスト名で絞り込み"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          autoFocus
        />
        <div className="fpos-modal__list">
          {filtered.map(r => (
            <button key={r.id} type="button" className="fpos-modal__item" onClick={() => onSelect(r)}>
              <span className="fpos-modal__room">{r.room_number || '未割当'}</span>
              <span className="fpos-modal__guest">{r.guest_name}</span>
              <span className="fpos-modal__no num">{r.reservation_no}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="fpos-modal__empty">
              {reservations.length === 0 ? '在室中の予約がありません' : '該当する予約がありません'}
            </p>
          )}
        </div>
        <div className="fpos-modal__foot">
          <FrontButton variant="secondary" size="lg" onClick={onClose}>キャンセル</FrontButton>
        </div>
      </div>
    </div>
  );
}
