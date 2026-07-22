import { useState } from 'react';
import { useMasterCrud } from '../../hooks/useMasterCrud';
import { useDragReorder } from '../../hooks/useDragReorder';
import { TAX_RATE_OPTIONS, taxRateLabel } from '../../utils/constants';

/**
 * 商品マスタ設定（物販）
 * ドラッグ&ドロップで並び替え、トグルで有効/無効切替、新規追加・編集
 *
 * 並び順は物販ページの商品グリッドの表示順になるため、
 * よく売れる商品を上に持ってこられるようD&Dを付けている。
 */

export default function ProductSettings() {
  const {
    items: products, setItems: setProducts, loading, error, setError,
    modal, setModal, fetchData, toggleActive: handleToggleActive, save: handleSave,
  } = useMasterCrud('/master/products', {
    listKey: 'products',
    query: 'all=1',
    labelOf: (p) => p.product_name,
  });

  const { dragId, dragOverId, handleDragStart, handleDragEnd, handleDragOver } = useDragReorder({
    items: products,
    setItems: setProducts,
    endpoint: '/master/products/reorder',
    onError: setError,
    refetch: fetchData,
  });

  // カテゴリの入力補助用（既に登録済みのカテゴリをdatalistで候補表示する）
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))];

  if (loading) return <div className="settings-loading">読み込み中...</div>;

  return (
    <div>
      <div className="settings-page__header">
        <h2 className="settings-page__title">商品</h2>
        <button
          className="settings-btn settings-btn--primary"
          onClick={() => setModal({ product_name: '', category: '', price: '', tax_rate: 10, sort_order: 99 })}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add</span>
          追加
        </button>
      </div>

      {error && <div className="settings-error">{error}</div>}

      <div className="settings-card" style={{ padding: 0 }}>
        <table className="settings-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}></th>
              <th>商品名</th>
              <th style={{ width: 120 }}>カテゴリ</th>
              <th style={{ width: 110 }}>税込価格</th>
              <th style={{ width: 90 }}>税率</th>
              <th style={{ width: 80 }}>有効</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {products.map(p => (
              <tr
                key={p.id}
                className={`${!p.is_active ? 'inactive-row' : ''} ${dragId === p.id ? 'pm-drag-source' : ''} ${dragOverId === p.id && dragId !== p.id ? 'pm-drag-over' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, p)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, p)}
                onDragEnter={(e) => e.preventDefault()}
              >
                {/* ドラッグハンドル */}
                <td style={{ cursor: 'grab', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>drag_indicator</span>
                </td>
                <td>{p.product_name}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{p.category}</td>
                <td style={{ textAlign: 'right' }}>¥{Number(p.price).toLocaleString()}</td>
                <td>{taxRateLabel(p.tax_rate)}</td>
                <td>
                  <label className="settings-toggle">
                    <input type="checkbox" checked={!!p.is_active} onChange={() => handleToggleActive(p)} />
                    <span className="settings-toggle__slider" />
                  </label>
                </td>
                <td>
                  <button className="settings-btn settings-btn--sm" onClick={() => setModal(p)}>
                    編集
                  </button>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                  商品が登録されていません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <ProductModal
          data={modal}
          categories={categories}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function ProductModal({ data, categories, onSave, onClose }) {
  const [form, setForm] = useState(data);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const isNew = !data.id;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.product_name) {
      setError('商品名は必須です');
      return;
    }
    // 0円商品は物販として意味がないため弾く（サーバー側は0以上を許容するが入力段階で防ぐ）
    if (!form.price || Number(form.price) <= 0) {
      setError('税込価格を入力してください');
      return;
    }

    setSaving(true);
    const err = await onSave({
      ...form,
      category: form.category || 'その他',
      price: Number(form.price),
      tax_rate: Number(form.tax_rate),
    });
    if (err) {
      setError(err);
      setSaving(false);
    }
  };

  return (
    <div className="settings-modal__overlay" onClick={onClose}>
      <form className="settings-modal" onClick={e => e.stopPropagation()} onSubmit={handleSubmit}>
        <h3 className="settings-modal__title">{isNew ? '商品を追加' : '商品を編集'}</h3>

        {error && <div className="settings-error">{error}</div>}

        <div className="settings-form__group">
          <label className="settings-form__label">商品名</label>
          <input
            className="settings-form__input"
            value={form.product_name}
            onChange={e => setForm(f => ({ ...f, product_name: e.target.value }))}
            autoFocus
          />
        </div>

        <div className="settings-form__group">
          <label className="settings-form__label">カテゴリ</label>
          {/* 物販ページのタブ分けに使う。自由入力だが既存カテゴリを候補に出して表記ゆれを防ぐ */}
          <input
            className="settings-form__input"
            list="product-category-list"
            value={form.category || ''}
            placeholder="飲料 / 食品 / 雑貨 など（未入力は「その他」）"
            onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
          />
          <datalist id="product-category-list">
            {categories.map(c => <option key={c} value={c} />)}
          </datalist>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div className="settings-form__group">
            <label className="settings-form__label">税込価格（円）</label>
            <input
              type="number"
              className="settings-form__input"
              value={form.price ?? ''}
              onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
              min={1}
            />
          </div>
          <div className="settings-form__group">
            <label className="settings-form__label">税率</label>
            <select
              className="settings-form__select"
              value={form.tax_rate}
              onChange={e => setForm(f => ({ ...f, tax_rate: Number(e.target.value) }))}
            >
              {TAX_RATE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="settings-modal__actions">
          <button type="button" className="settings-btn" onClick={onClose}>キャンセル</button>
          <button type="submit" className="settings-btn settings-btn--primary" disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}
