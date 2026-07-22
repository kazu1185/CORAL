import { useState } from 'react';
import { useMasterCrud } from '../../hooks/useMasterCrud';

/**
 * プランマスタ設定
 * 食事タイプに応じて価格フィールドの有効/無効が切り替わる
 * 削除は不可（予約から参照されるため）、is_activeで無効化
 */

const MEAL_TYPE_LABELS = {
  none: '素泊まり',
  breakfast: '朝食付き',
  dinner: '夕食付き',
  two_meals: '2食付き',
};

export default function PlanSettings() {
  const {
    items: plans, loading, error,
    modal, setModal, toggleActive: handleToggleActive, save: handleSave,
  } = useMasterCrud('/master/plans', {
    listKey: 'plans',
    labelOf: (p) => p.plan_name,
  });

  if (loading) return <div className="settings-loading">読み込み中...</div>;

  return (
    <div>
      <div className="settings-page__header">
        <h2 className="settings-page__title">プラン</h2>
        <button className="settings-btn settings-btn--primary" onClick={() => setModal({ plan_name: '', meal_type: 'none', breakfast_price: 0, dinner_price: 0 })}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add</span>
          追加
        </button>
      </div>

      {error && <div className="settings-error">{error}</div>}

      <div className="settings-card" style={{ padding: 0 }}>
        <table className="settings-table">
          <thead>
            <tr>
              <th>プラン名</th>
              <th>食事タイプ</th>
              <th style={{ textAlign: 'right' }}>朝食単価</th>
              <th style={{ textAlign: 'right' }}>夕食単価</th>
              <th style={{ width: 80 }}>有効</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {plans.map(p => (
              <tr key={p.id} className={!p.is_active ? 'inactive-row' : ''}>
                <td style={{ fontWeight: 500 }}>{p.plan_name}</td>
                <td>{MEAL_TYPE_LABELS[p.meal_type] || p.meal_type}</td>
                <td style={{ textAlign: 'right' }}>{p.breakfast_price > 0 ? `¥${Number(p.breakfast_price).toLocaleString()}` : '—'}</td>
                <td style={{ textAlign: 'right' }}>{p.dinner_price > 0 ? `¥${Number(p.dinner_price).toLocaleString()}` : '—'}</td>
                <td>
                  <label className="settings-toggle">
                    <input type="checkbox" checked={!!p.is_active} onChange={() => handleToggleActive(p)} />
                    <span className="settings-toggle__slider" />
                  </label>
                </td>
                <td>
                  <button className="settings-btn settings-btn--sm" onClick={() => setModal(p)}>編集</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && <PlanModal data={modal} onSave={handleSave} onClose={() => setModal(null)} />}
    </div>
  );
}

function PlanModal({ data, onSave, onClose }) {
  const [form, setForm] = useState({ ...data });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // 食事タイプに応じて価格フィールドの有効/無効を制御
  const hasBreakfast = form.meal_type === 'breakfast' || form.meal_type === 'two_meals';
  const hasDinner = form.meal_type === 'dinner' || form.meal_type === 'two_meals';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.plan_name) {
      setError('プラン名は必須です');
      return;
    }

    // 食事がないのに価格が設定されている場合はクリア
    const submitData = {
      ...form,
      breakfast_price: hasBreakfast ? (form.breakfast_price || 0) : 0,
      dinner_price: hasDinner ? (form.dinner_price || 0) : 0,
    };

    setSaving(true);
    const err = await onSave(submitData);
    if (err) {
      setError(err);
      setSaving(false);
    }
  };

  return (
    <div className="settings-modal__overlay" onClick={onClose}>
      <form className="settings-modal" onClick={e => e.stopPropagation()} onSubmit={handleSubmit}>
        <h3 className="settings-modal__title">{data.id ? 'プランを編集' : 'プランを追加'}</h3>

        {error && <div className="settings-error">{error}</div>}

        <div className="settings-form__group">
          <label className="settings-form__label">プラン名</label>
          <input
            className="settings-form__input"
            value={form.plan_name}
            onChange={e => setForm(f => ({ ...f, plan_name: e.target.value }))}
            autoFocus
          />
        </div>

        <div className="settings-form__group">
          <label className="settings-form__label">食事タイプ</label>
          <select
            className="settings-form__select"
            value={form.meal_type}
            onChange={e => setForm(f => ({ ...f, meal_type: e.target.value }))}
          >
            {Object.entries(MEAL_TYPE_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div className="settings-form__group">
            <label className="settings-form__label">朝食単価（円）</label>
            <input
              type="number"
              className="settings-form__input"
              value={form.breakfast_price || ''}
              onChange={e => setForm(f => ({ ...f, breakfast_price: parseInt(e.target.value, 10) || 0 }))}
              disabled={!hasBreakfast}
              style={!hasBreakfast ? { background: '#F1F5F9' } : {}}
              min={0}
            />
          </div>
          <div className="settings-form__group">
            <label className="settings-form__label">夕食単価（円）</label>
            <input
              type="number"
              className="settings-form__input"
              value={form.dinner_price || ''}
              onChange={e => setForm(f => ({ ...f, dinner_price: parseInt(e.target.value, 10) || 0 }))}
              disabled={!hasDinner}
              style={!hasDinner ? { background: '#F1F5F9' } : {}}
              min={0}
            />
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
