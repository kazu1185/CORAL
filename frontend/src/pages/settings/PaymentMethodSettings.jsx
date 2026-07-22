import { useState } from 'react';
import { useMasterCrud } from '../../hooks/useMasterCrud';
import { useDragReorder } from '../../hooks/useDragReorder';

/**
 * 決済方法マスタ設定
 * ドラッグ&ドロップで並び替え、トグルで有効/無効切替、新規追加・名称編集
 * method_codeは作成後変更不可（予約データから参照されるため）
 */
export default function PaymentMethodSettings() {
  const {
    items: methods, setItems: setMethods, loading, error, setError,
    modal, setModal, fetchData, toggleActive: handleToggleActive, save: handleSave,
  } = useMasterCrud('/master/payment-methods', {
    listKey: 'payment_methods',
    query: 'all=1',
    labelOf: (m) => m.method_name,
  });

  const { dragId, dragOverId, handleDragStart, handleDragEnd, handleDragOver } = useDragReorder({
    items: methods,
    setItems: setMethods,
    endpoint: '/master/payment-methods/reorder',
    onError: setError,
    refetch: fetchData,
  });

  if (loading) return <div className="settings-loading">読み込み中...</div>;

  return (
    <div>
      <div className="settings-page__header">
        <h2 className="settings-page__title">決済方法</h2>
        <button className="settings-btn settings-btn--primary" onClick={() => setModal({ method_name: '', method_code: '', sort_order: 99 })}>
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
              <th>決済方法名</th>
              <th>コード</th>
              <th style={{ width: 80 }}>有効</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {methods.map(m => (
              <tr
                key={m.id}
                className={`${!m.is_active ? 'inactive-row' : ''} ${dragId === m.id ? 'pm-drag-source' : ''} ${dragOverId === m.id && dragId !== m.id ? 'pm-drag-over' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, m)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, m)}
                onDragEnter={(e) => e.preventDefault()}
              >
                {/* ドラッグハンドル */}
                <td style={{ cursor: 'grab', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>drag_indicator</span>
                </td>
                <td>{m.method_name}</td>
                <td style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{m.method_code}</td>
                <td>
                  <label className="settings-toggle">
                    <input type="checkbox" checked={!!m.is_active} onChange={() => handleToggleActive(m)} />
                    <span className="settings-toggle__slider" />
                  </label>
                </td>
                <td>
                  <button className="settings-btn settings-btn--sm" onClick={() => setModal(m)}>
                    編集
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <PaymentMethodModal
          data={modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function PaymentMethodModal({ data, onSave, onClose }) {
  const [form, setForm] = useState(data);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const isNew = !data.id;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.method_name) {
      setError('決済方法名は必須です');
      return;
    }
    if (isNew && !form.method_code) {
      setError('コードは必須です');
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
        <h3 className="settings-modal__title">{isNew ? '決済方法を追加' : '決済方法を編集'}</h3>

        {error && <div className="settings-error">{error}</div>}

        <div className="settings-form__group">
          <label className="settings-form__label">決済方法名</label>
          <input
            className="settings-form__input"
            value={form.method_name}
            onChange={e => setForm(f => ({ ...f, method_name: e.target.value }))}
            autoFocus
          />
        </div>

        <div className="settings-form__group">
          <label className="settings-form__label">コード{!isNew && '（変更不可）'}</label>
          <input
            className="settings-form__input settings-form__input--sm"
            value={form.method_code}
            onChange={e => setForm(f => ({ ...f, method_code: e.target.value }))}
            disabled={!isNew}
            style={!isNew ? { background: '#F1F5F9' } : {}}
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
