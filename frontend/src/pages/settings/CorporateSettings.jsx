import { useState } from 'react';
import { useMasterCrud } from '../../hooks/useMasterCrud';

/**
 * 法人マスタ設定
 * 法人売掛の請求先管理。新規追加・編集・is_activeトグルが可能
 */

const CYCLE_LABELS = {
  monthly: '月次',
  per_stay: '都度',
};

export default function CorporateSettings() {
  const {
    items: corporates, loading, error,
    modal, setModal, toggleActive: handleToggleActive, save: handleSave,
  } = useMasterCrud('/master/corporates', {
    listKey: 'corporates',
    labelOf: (c) => c.company_name,
  });

  if (loading) return <div className="settings-loading">読み込み中...</div>;

  const emptyForm = {
    company_name: '', billing_address: '', contact_person: '',
    contact_email: '', payment_cycle: 'monthly', payment_terms: '', notes: '',
  };

  return (
    <div>
      <div className="settings-page__header">
        <h2 className="settings-page__title">法人</h2>
        <button className="settings-btn settings-btn--primary" onClick={() => setModal(emptyForm)}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add</span>
          追加
        </button>
      </div>

      {error && <div className="settings-error">{error}</div>}

      <div className="settings-card" style={{ padding: 0 }}>
        <table className="settings-table">
          <thead>
            <tr>
              <th>会社名</th>
              <th>担当者</th>
              <th>請求サイクル</th>
              <th>支払条件</th>
              <th style={{ width: 80 }}>有効</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {corporates.map(c => (
              <tr key={c.id} className={!c.is_active ? 'inactive-row' : ''}>
                <td style={{ fontWeight: 500 }}>{c.company_name}</td>
                <td>{c.contact_person || '—'}</td>
                <td>{CYCLE_LABELS[c.payment_cycle] || c.payment_cycle}</td>
                <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{c.payment_terms || '—'}</td>
                <td>
                  <label className="settings-toggle">
                    <input type="checkbox" checked={!!c.is_active} onChange={() => handleToggleActive(c)} />
                    <span className="settings-toggle__slider" />
                  </label>
                </td>
                <td>
                  <button className="settings-btn settings-btn--sm" onClick={() => setModal(c)}>編集</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && <CorporateModal data={modal} onSave={handleSave} onClose={() => setModal(null)} />}
    </div>
  );
}

function CorporateModal({ data, onSave, onClose }) {
  const [form, setForm] = useState({ ...data });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const isNew = !data.id;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.company_name) {
      setError('会社名は必須です');
      return;
    }

    setSaving(true);
    const err = await onSave(form);
    if (err) {
      setError(err);
      setSaving(false);
    }
  };

  return (
    <div className="settings-modal__overlay" onClick={onClose}>
      <form className="settings-modal" onClick={e => e.stopPropagation()} onSubmit={handleSubmit}>
        <h3 className="settings-modal__title">{isNew ? '法人を追加' : '法人を編集'}</h3>

        {error && <div className="settings-error">{error}</div>}

        <div className="settings-form__group">
          <label className="settings-form__label">会社名</label>
          <input
            className="settings-form__input"
            value={form.company_name}
            onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))}
            autoFocus
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div className="settings-form__group">
            <label className="settings-form__label">担当者名</label>
            <input
              className="settings-form__input"
              value={form.contact_person || ''}
              onChange={e => setForm(f => ({ ...f, contact_person: e.target.value }))}
            />
          </div>
          <div className="settings-form__group">
            <label className="settings-form__label">メールアドレス</label>
            <input
              type="email"
              className="settings-form__input"
              value={form.contact_email || ''}
              onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))}
            />
          </div>
        </div>

        <div className="settings-form__group">
          <label className="settings-form__label">請求先住所</label>
          <textarea
            className="settings-form__textarea"
            value={form.billing_address || ''}
            onChange={e => setForm(f => ({ ...f, billing_address: e.target.value }))}
            rows={2}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div className="settings-form__group">
            <label className="settings-form__label">請求サイクル</label>
            <select
              className="settings-form__select"
              value={form.payment_cycle}
              onChange={e => setForm(f => ({ ...f, payment_cycle: e.target.value }))}
            >
              <option value="monthly">月次</option>
              <option value="per_stay">都度</option>
            </select>
          </div>
          <div className="settings-form__group">
            <label className="settings-form__label">支払条件</label>
            <input
              className="settings-form__input"
              value={form.payment_terms || ''}
              onChange={e => setForm(f => ({ ...f, payment_terms: e.target.value }))}
              placeholder="例: 月末締め翌月末払い"
            />
          </div>
        </div>

        <div className="settings-form__group">
          <label className="settings-form__label">備考</label>
          <textarea
            className="settings-form__textarea"
            value={form.notes || ''}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          />
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
