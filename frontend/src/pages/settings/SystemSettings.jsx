import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useConfirm } from '../../components/ConfirmDialog';

/**
 * システム設定
 * system_settingsテーブルの5項目を編集
 * セッション・PIN・ロックに関する運用パラメータ
 */

const SETTING_DEFS = [
  { key: 'session_timeout_minutes', label: 'セッション有効期限（分）', min: 5, max: 1440, description: '無操作でログアウトされるまでの時間' },
  { key: 'pin_min_length',          label: 'PIN最小桁数',            min: 4, max: 6,    description: 'PIN変更時の最小桁数' },
  { key: 'pin_max_length',          label: 'PIN最大桁数',            min: 4, max: 8,    description: 'PIN変更時の最大桁数' },
  { key: 'login_fail_lock_count',   label: 'ロックまでの失敗回数',   min: 3, max: 20,   description: '連続失敗でアカウントがロックされる回数' },
  { key: 'login_fail_lock_minutes', label: 'ロック解除時間（分）',   min: 1, max: 60,   description: 'ロック後に再試行できるまでの時間' },
];

// トグル型設定（0/1）
const TOGGLE_DEFS = [
  { key: 'show_layout_editor', label: '配置編集ボタンを表示', description: 'ルームインジケーターの「配置編集」ボタンの表示/非表示。初期設定完了後はOFFにできます' },
];

export default function SystemSettings() {
  const [settings, setSettings] = useState({});
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
      const res = await api.get('/master/settings');
      setSettings(res.settings || {});
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setError('');
    setSuccess('');
  };

  const handleSave = async () => {
    // PIN桁数の整合性チェック（min ≤ max でないと運用不能になるため）
    const minLen = parseInt(settings.pin_min_length, 10);
    const maxLen = parseInt(settings.pin_max_length, 10);
    if (minLen > maxLen) {
      setError('PIN最小桁数はPIN最大桁数以下にしてください');
      return;
    }

    const ok = await confirm('保存確認', 'システム設定を更新しますか？\n変更は即座に反映されます。');
    if (!ok) return;

    setSaving(true);
    setError('');
    try {
      await api.put('/master/settings', { settings });
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
        <h2 className="settings-page__title">システム設定</h2>
      </div>

      {error && <div className="settings-error">{error}</div>}
      {success && <div className="settings-success">{success}</div>}

      <div className="settings-card">
        {SETTING_DEFS.map(def => (
          <div key={def.key} className="settings-form__group">
            <label className="settings-form__label">{def.label}</label>
            <input
              type="number"
              className="settings-form__input settings-form__input--sm"
              value={settings[def.key] || ''}
              onChange={e => handleChange(def.key, e.target.value)}
              min={def.min}
              max={def.max}
            />
            <small style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px', display: 'block' }}>
              {def.description}（{def.min}〜{def.max}）
            </small>
          </div>
        ))}

        {/* トグル型設定 */}
        {TOGGLE_DEFS.map(def => (
          <div key={def.key} className="settings-form__group" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings[def.key] === '1' || settings[def.key] === 1}
                onChange={e => handleChange(def.key, e.target.checked ? '1' : '0')}
                style={{ width: '18px', height: '18px', accentColor: 'var(--accent-blue)' }}
              />
              <span className="settings-form__label" style={{ margin: 0 }}>{def.label}</span>
            </label>
            <small style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{def.description}</small>
          </div>
        ))}

        <div style={{ marginTop: '24px' }}>
          <button className="settings-btn settings-btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
