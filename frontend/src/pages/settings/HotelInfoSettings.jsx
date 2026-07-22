import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useConfirm } from '../../components/ConfirmDialog';

/**
 * ホテル基本情報設定
 * hotel_settingsテーブルの1レコードを編集
 * 帳票（領収書・請求書）に印字される情報のため正確性が重要
 */
export default function HotelInfoSettings() {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { confirm } = useConfirm();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const res = await api.get('/master/hotel-info');
      setForm(res.hotel_info || {});
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setError('');
    setSuccess('');
  };

  const handleSave = async () => {
    const ok = await confirm('保存確認', 'ホテル基本情報を更新しますか？');
    if (!ok) return;

    setSaving(true);
    setError('');
    try {
      await api.put('/master/hotel-info', form);
      setSuccess('保存しました');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="settings-loading">読み込み中...</div>;

  return (
    <div>
      <div className="settings-page__header">
        <h2 className="settings-page__title">ホテル基本情報</h2>
      </div>

      {error && <div className="settings-error">{error}</div>}
      {success && <div className="settings-success">{success}</div>}

      <div className="settings-card">
        <div className="settings-form__group">
          <label className="settings-form__label">ホテル名（日本語）</label>
          <input
            className="settings-form__input"
            value={form.hotel_name || ''}
            onChange={e => handleChange('hotel_name', e.target.value)}
          />
        </div>

        <div className="settings-form__group">
          <label className="settings-form__label">ホテル名（英語）</label>
          <input
            className="settings-form__input"
            value={form.hotel_name_en || ''}
            onChange={e => handleChange('hotel_name_en', e.target.value)}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
          <div className="settings-form__group">
            <label className="settings-form__label">郵便番号</label>
            <input
              className="settings-form__input"
              value={form.postal_code || ''}
              onChange={e => handleChange('postal_code', e.target.value)}
              placeholder="000-0000"
            />
          </div>
          <div className="settings-form__group">
            <label className="settings-form__label">電話番号</label>
            <input
              className="settings-form__input"
              value={form.phone || ''}
              onChange={e => handleChange('phone', e.target.value)}
              placeholder="098-000-0000"
            />
          </div>
        </div>

        <div className="settings-form__group">
          <label className="settings-form__label">住所</label>
          <input
            className="settings-form__input"
            value={form.address || ''}
            onChange={e => handleChange('address', e.target.value)}
          />
        </div>

        <div className="settings-form__group">
          <label className="settings-form__label">適格請求書発行事業者登録番号</label>
          <input
            className="settings-form__input settings-form__input--sm"
            value={form.invoice_registration_no || ''}
            onChange={e => handleChange('invoice_registration_no', e.target.value)}
            placeholder="T0000000000000"
          />
          <small style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px', display: 'block' }}>
            T + 13桁の数字（例: T1234567890123）
          </small>
        </div>

        <div style={{ marginTop: '24px' }}>
          <button className="settings-btn settings-btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
