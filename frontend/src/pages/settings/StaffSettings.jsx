import { useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useConfirm } from '../../components/ConfirmDialog';
import { useMasterCrud } from '../../hooks/useMasterCrud';

/**
 * スタッフ管理設定
 * 追加・編集・無効化・PINリセットが可能
 * 自分自身の無効化と最後のadmin無効化はバックエンドでもブロック
 */

const ROLE_LABELS = {
  admin: '管理者',
  front_manager: 'フロントマネージャー',
  front: 'フロント',
  housekeeping: '清掃',
};

export default function StaffSettings() {
  const { staff: currentStaff, hasPermission } = useAuth();
  const { confirm, alert } = useConfirm();
  const canResetPin = hasPermission('staff.pin_reset');

  const {
    items: staffList, loading, error, setError,
    modal, setModal, fetchData, toggleActive, save: handleSave,
  } = useMasterCrud('/master/staff', {
    listKey: 'staff',
    labelOf: (s) => s.staff_name,
    toggleNote: 'このスタッフはログインできなくなります。',
  });

  const handleToggleActive = async (item) => {
    // 自分自身の無効化はフロントで事前ブロック
    if (item.id === currentStaff?.id) {
      await alert('操作不可', '自分自身を無効化することはできません');
      return;
    }
    toggleActive(item);
  };

  const handleResetPin = async (item) => {
    const ok = await confirm(
      'PINリセット',
      `「${item.staff_name}」のPINを初期値（1234）にリセットしますか？\n次回ログイン時にPIN変更が要求されます。`,
      { confirmColor: 'red', confirmLabel: 'リセット' }
    );
    if (!ok) return;

    try {
      await api.post(`/master/staff/${item.id}/reset-pin`);
      await alert('完了', 'PINをリセットしました');
      fetchData();
    } catch (e) {
      setError(e.message);
    }
  };

  if (loading) return <div className="settings-loading">読み込み中...</div>;

  const emptyForm = { staff_name: '', login_name: '', role: 'front', pin: '' };

  return (
    <div>
      <div className="settings-page__header">
        <h2 className="settings-page__title">スタッフ管理</h2>
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
              <th>スタッフ名</th>
              <th>ログイン名</th>
              <th>ロール</th>
              <th>ステータス</th>
              <th style={{ width: 80 }}>有効</th>
              <th style={{ width: 160 }}></th>
            </tr>
          </thead>
          <tbody>
            {staffList.map(s => (
              <tr key={s.id} className={!s.is_active ? 'inactive-row' : ''}>
                <td style={{ fontWeight: 500 }}>
                  {s.staff_name}
                  {s.id === currentStaff?.id && (
                    <span style={{ fontSize: '11px', color: 'var(--accent-blue)', marginLeft: '6px' }}>（自分）</span>
                  )}
                </td>
                <td style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{s.login_name}</td>
                <td>
                  <span className={`settings-badge settings-badge--${s.role}`}>
                    {ROLE_LABELS[s.role] || s.role}
                  </span>
                </td>
                <td>
                  {s.must_change_pin ? (
                    <span style={{ fontSize: '11px', color: 'var(--accent-yellow)' }}>PIN変更必要</span>
                  ) : (
                    <span className={`settings-badge ${s.is_active ? 'settings-badge--active' : 'settings-badge--inactive'}`}>
                      {s.is_active ? '有効' : '無効'}
                    </span>
                  )}
                </td>
                <td>
                  <label className="settings-toggle">
                    <input type="checkbox" checked={!!s.is_active} onChange={() => handleToggleActive(s)} />
                    <span className="settings-toggle__slider" />
                  </label>
                </td>
                <td style={{ display: 'flex', gap: '4px' }}>
                  <button className="settings-btn settings-btn--sm" onClick={() => setModal(s)}>編集</button>
                  {canResetPin && s.is_active && s.id !== currentStaff?.id && (
                    <button className="settings-btn settings-btn--sm settings-btn--danger" onClick={() => handleResetPin(s)}>
                      PINリセット
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && <StaffModal data={modal} onSave={handleSave} onClose={() => setModal(null)} />}
    </div>
  );
}

function StaffModal({ data, onSave, onClose }) {
  const [form, setForm] = useState({ ...data });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const isNew = !data.id;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.staff_name || !form.login_name) {
      setError('スタッフ名とログイン名は必須です');
      return;
    }
    if (isNew && !form.pin) {
      setError('初期PINは必須です');
      return;
    }
    if (isNew && !/^\d{4,6}$/.test(form.pin)) {
      setError('PINは4〜6桁の数字で入力してください');
      return;
    }

    setSaving(true);
    const submitData = {
      staff_name: form.staff_name,
      login_name: form.login_name,
      role: form.role,
    };
    if (isNew) submitData.pin = form.pin;
    if (data.id) submitData.id = data.id;

    const err = await onSave(submitData);
    if (err) {
      setError(err);
      setSaving(false);
    }
  };

  return (
    <div className="settings-modal__overlay" onClick={onClose}>
      <form className="settings-modal" onClick={e => e.stopPropagation()} onSubmit={handleSubmit}>
        <h3 className="settings-modal__title">{isNew ? 'スタッフを追加' : 'スタッフを編集'}</h3>

        {error && <div className="settings-error">{error}</div>}

        <div className="settings-form__group">
          <label className="settings-form__label">スタッフ名</label>
          <input
            className="settings-form__input"
            value={form.staff_name}
            onChange={e => setForm(f => ({ ...f, staff_name: e.target.value }))}
            autoFocus
          />
        </div>

        <div className="settings-form__group">
          <label className="settings-form__label">ログイン名</label>
          <input
            className="settings-form__input settings-form__input--sm"
            value={form.login_name}
            onChange={e => setForm(f => ({ ...f, login_name: e.target.value }))}
          />
        </div>

        <div className="settings-form__group">
          <label className="settings-form__label">ロール</label>
          <select
            className="settings-form__select"
            value={form.role}
            onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
          >
            {Object.entries(ROLE_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>

        {isNew && (
          <div className="settings-form__group">
            <label className="settings-form__label">初期PIN（4〜6桁の数字）</label>
            <input
              type="password"
              className="settings-form__input settings-form__input--sm"
              value={form.pin || ''}
              onChange={e => setForm(f => ({ ...f, pin: e.target.value }))}
              maxLength={6}
              placeholder="****"
            />
            <small style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px', display: 'block' }}>
              初回ログイン時にPIN変更が要求されます
            </small>
          </div>
        )}

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
