import { useState } from 'react';
import { useMasterCrud } from '../../hooks/useMasterCrud';
import { useDragReorder } from '../../hooks/useDragReorder';

/**
 * 部屋タイプマスタ設定
 * ドラッグ&ドロップで並び替え、追加・編集・論理削除（is_active）が可能
 * type_codeは作成後変更不可（予約データから参照されるため）
 */
export default function RoomTypeSettings() {
  const {
    items: types, setItems: setTypes, loading, error, setError,
    modal, setModal, fetchData, toggleActive: handleToggleActive, save: handleSave,
  } = useMasterCrud('/master/room-types', {
    listKey: 'room_types',
    query: 'all=1',
    labelOf: (t) => t.type_name,
    toggleNote: 'このタイプは新規アサインで選択できなくなりますが、既存の予約データには影響しません。',
  });

  const { dragId, dragOverId, handleDragStart, handleDragEnd, handleDragOver } = useDragReorder({
    items: types,
    setItems: setTypes,
    endpoint: '/master/room-types/reorder',
    onError: setError,
    refetch: fetchData,
  });

  if (loading) return <div className="settings-loading">読み込み中...</div>;

  const emptyForm = {
    type_code: '', type_name: '', max_adults: 2, max_occupancy: 3,
    description: '', sort_order: 99,
  };

  return (
    <div>
      <div className="settings-page__header">
        <h2 className="settings-page__title">部屋タイプ</h2>
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
              <th style={{ width: 36 }}></th>
              <th>コード</th>
              <th>タイプ名</th>
              <th style={{ textAlign: 'right' }}>大人上限</th>
              <th style={{ textAlign: 'right' }}>最大定員</th>
              <th style={{ width: 80 }}>有効</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {types.map(t => (
              <tr
                key={t.id}
                className={`${!t.is_active ? 'inactive-row' : ''} ${dragId === t.id ? 'pm-drag-source' : ''} ${dragOverId === t.id && dragId !== t.id ? 'pm-drag-over' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, t)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, t)}
                onDragEnter={(e) => e.preventDefault()}
              >
                <td style={{ cursor: 'grab', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>drag_indicator</span>
                </td>
                <td style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{t.type_code}</td>
                <td style={{ fontWeight: 500 }}>{t.type_name}</td>
                <td style={{ textAlign: 'right' }}>{t.max_adults}名</td>
                <td style={{ textAlign: 'right' }}>{t.max_occupancy}名</td>
                <td>
                  <label className="settings-toggle">
                    <input type="checkbox" checked={!!t.is_active} onChange={() => handleToggleActive(t)} />
                    <span className="settings-toggle__slider" />
                  </label>
                </td>
                <td>
                  <button className="settings-btn settings-btn--sm" onClick={() => setModal(t)}>編集</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal && (
        <RoomTypeModal
          data={modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function RoomTypeModal({ data, onSave, onClose }) {
  const [form, setForm] = useState({ ...data });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const isNew = !data.id;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.type_name) {
      setError('タイプ名は必須です');
      return;
    }
    if (isNew && !form.type_code) {
      setError('タイプコードは必須です');
      return;
    }
    if (form.max_adults > form.max_occupancy) {
      setError('大人上限は最大定員以下にしてください');
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
        <h3 className="settings-modal__title">{isNew ? '部屋タイプを追加' : '部屋タイプを編集'}</h3>

        {error && <div className="settings-error">{error}</div>}

        <div className="settings-form__group">
          <label className="settings-form__label">タイプコード{!isNew && '（変更不可）'}</label>
          <input
            className="settings-form__input settings-form__input--sm"
            value={form.type_code}
            onChange={e => setForm(f => ({ ...f, type_code: e.target.value }))}
            disabled={!isNew}
            style={!isNew ? { background: '#F1F5F9' } : {}}
            placeholder="例: family"
            autoFocus={isNew}
          />
          {isNew && (
            <small style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px', display: 'block' }}>
              半角英数字（作成後は変更できません）
            </small>
          )}
        </div>

        <div className="settings-form__group">
          <label className="settings-form__label">タイプ名</label>
          <input
            className="settings-form__input"
            value={form.type_name}
            onChange={e => setForm(f => ({ ...f, type_name: e.target.value }))}
            autoFocus={!isNew}
            placeholder="例: ファミリー"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div className="settings-form__group">
            <label className="settings-form__label">大人上限（名）</label>
            <input
              type="number"
              className="settings-form__input"
              value={form.max_adults}
              onChange={e => setForm(f => ({ ...f, max_adults: parseInt(e.target.value, 10) || 1 }))}
              min={1}
            />
          </div>
          <div className="settings-form__group">
            <label className="settings-form__label">最大定員（名）</label>
            <input
              type="number"
              className="settings-form__input"
              value={form.max_occupancy}
              onChange={e => setForm(f => ({ ...f, max_occupancy: parseInt(e.target.value, 10) || 1 }))}
              min={1}
            />
          </div>
        </div>

        <div className="settings-form__group">
          <label className="settings-form__label">説明</label>
          <textarea
            className="settings-form__textarea"
            value={form.description || ''}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
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
