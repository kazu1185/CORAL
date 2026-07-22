import { useState, useMemo } from 'react';
import { taxRateLabel } from '../utils/constants';
import { summarizeByTaxRate } from '../utils/tax';
import './ProductPicker.css';

/**
 * 商品グリッド＋カート（物販の共通パーツ）
 *
 * 物販ページ（レジ画面）と予約詳細の「物販追加」モーダルの両方で使う。
 * 同じ選択UIを2箇所にコピペしないため共通化した（規約 #15）。
 *
 * 確定処理そのもの（即売 / 部屋付け）は呼び出し側の責務。
 * 確定手段が画面ごとに異なる（物販ページは支払方法ボタンが複数＋部屋付け、
 * 予約詳細モーダルは部屋付けのみ）ため、確定ボタンは actions で差し込む形にした。
 *
 * @param {Array}    products  有効な商品の配列（サーバーの sort_order 順）
 * @param {Function} actions   ({ items, total, clearCart, disabled }) => ReactNode
 *                             items: [{product_id, quantity}]（そのままAPIに渡せる形）
 *                             確定に成功したら clearCart() を呼ぶこと
 * @param {boolean}  submitting 送信中（確定ボタンを無効化する）
 */
export default function ProductPicker({ products, actions, submitting = false }) {
  const [cart, setCart] = useState([]);   // [{ product, quantity }]
  const [activeCategory, setActiveCategory] = useState('すべて');

  // カテゴリタブ。商品の登録順（sort_order）で現れた順に並べる
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
      if (found) {
        return prev.map(l => l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l);
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const changeQuantity = (productId, delta) => {
    setCart(prev => prev
      .map(l => l.product.id === productId ? { ...l, quantity: l.quantity + delta } : l)
      .filter(l => l.quantity > 0)   // 0個になった行はカートから消す
    );
  };

  const removeLine = (productId) => setCart(prev => prev.filter(l => l.product.id !== productId));

  // 税率別の内訳（税込金額から内税を逆算）
  const taxBreakdown = summarizeByTaxRate(
    cart.map(l => ({ amount: l.product.price * l.quantity, tax_rate: l.product.tax_rate }))
  );
  const total = cart.reduce((sum, l) => sum + l.product.price * l.quantity, 0);

  // APIにそのまま渡せる形。呼び出し側が cart の内部構造（product オブジェクト）を
  // 知らなくて済むようにここで変換する
  const items = cart.map(l => ({ product_id: l.product.id, quantity: l.quantity }));

  return (
    <div className="pp">
      {/* 商品グリッド */}
      <div className="pp__catalog">
        {categories.length > 2 && (
          <div className="pp__tabs">
            {categories.map(c => (
              <button
                key={c}
                type="button"
                className={`pp__tab ${activeCategory === c ? 'pp__tab--active' : ''}`}
                onClick={() => setActiveCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        <div className="pp__grid">
          {visibleProducts.map(p => (
            <button key={p.id} type="button" className="pp__product" onClick={() => addToCart(p)}>
              <span className="pp__product-name">{p.product_name}</span>
              <span className="pp__product-price">
                ¥{Number(p.price).toLocaleString()}
                {/* 軽減税率の商品は取り違えやすいのでボタン上でも判別できるようにする */}
                <span className="pp__product-tax">{taxRateLabel(p.tax_rate)}</span>
              </span>
            </button>
          ))}
          {visibleProducts.length === 0 && (
            <p className="pp__empty">販売できる商品がありません</p>
          )}
        </div>
      </div>

      {/* カート */}
      <div className="pp__cart">
        <div className="pp__cart-title">カート</div>

        {cart.length === 0 ? (
          <p className="pp__empty">商品を選択してください</p>
        ) : (
          <div className="pp__cart-lines">
            {cart.map(l => (
              <div key={l.product.id} className="pp__line">
                <div className="pp__line-head">
                  <span className="pp__line-name">{l.product.product_name}</span>
                  <button
                    type="button"
                    className="pp__line-remove"
                    onClick={() => removeLine(l.product.id)}
                    title="この商品を削除"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
                <div className="pp__line-body">
                  <div className="pp__qty">
                    <button type="button" className="pp__qty-btn" onClick={() => changeQuantity(l.product.id, -1)}>−</button>
                    <span className="pp__qty-value">{l.quantity}</span>
                    <button type="button" className="pp__qty-btn" onClick={() => changeQuantity(l.product.id, 1)}>＋</button>
                  </div>
                  <span className="pp__line-amount">¥{(l.product.price * l.quantity).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="pp__summary">
          {taxBreakdown.map(b => (
            <div key={b.tax_rate} className="pp__summary-row">
              <span>{taxRateLabel(b.tax_rate)}対象</span>
              <span>¥{b.amount.toLocaleString()}（内税 ¥{b.tax_amount.toLocaleString()}）</span>
            </div>
          ))}
          <div className="pp__summary-row pp__summary-row--total">
            <span>合計</span>
            <span>¥{total.toLocaleString()}</span>
          </div>
        </div>

        <div className="pp__actions">
          {/* 確定ボタンの中身は呼び出し側から差し込む（即売＝支払方法選択 / 部屋付け＝予約選択） */}
          {actions({
            items,
            total,
            clearCart: () => setCart([]),
            disabled: cart.length === 0 || submitting,
          })}
        </div>
      </div>
    </div>
  );
}
