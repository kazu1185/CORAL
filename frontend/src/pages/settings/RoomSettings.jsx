import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useConfirm } from '../../components/ConfirmDialog';
import { useDragReorder } from '../../hooks/useDragReorder';

/**
 * 部屋マスタ設定
 * フロア別にグループ表示、フロア内でドラッグ&ドロップ並び替え
 * room_numberは変更不可（物理的な部屋番号のため）
 */

const STATUS_LABELS = {
  available: '利用可',
  out_of_order: '故障中',
  out_of_service: '利用停止',
};

const STATUS_COLORS = {
  available: 'settings-badge--active',
  out_of_order: 'settings-badge--inactive',
  out_of_service: 'settings-badge--inactive',
};

export default function RoomSettings() {
  const [rooms, setRooms] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const [roomRes, typeRes] = await Promise.all([
        api.get('/master/rooms'),
        api.get('/master/room-types'),
      ]);
      setRooms(roomRes.rooms || []);
      setRoomTypes(typeRes.room_types || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (data) => {
    try {
      await api.put(`/master/rooms/${data.id}`, data);
      setModal(null);
      fetchData();
    } catch (e) {
      return e.message;
    }
  };

  // ── ドラッグ&ドロップ（フロア内のみ） ──
  const { dragId, dragOverId, handleDragStart, handleDragEnd, handleDragOver } = useDragReorder({
    items: rooms,
    setItems: setRooms,
    endpoint: '/master/rooms/reorder',
    onError: setError,
    refetch: fetchData,
    // 同じフロア内のみ移動可能（物理的な配置に合わせるため）
    sameGroup: (a, b) => a.floor === b.floor,
    // APIには移動した部屋と同じフロアのIDだけを表示順どおり送る
    orderIds: (newItems, moved) => newItems.filter(r => r.floor === moved.floor).map(r => r.id),
  });

  if (loading) return <div className="settings-loading">読み込み中...</div>;

  // フロア別にグループ化
  const floors = [];
  const floorMap = {};
  rooms.forEach(r => {
    if (!floorMap[r.floor]) {
      floorMap[r.floor] = [];
      floors.push(r.floor);
    }
    floorMap[r.floor].push(r);
  });
  floors.sort((a, b) => a - b);

  return (
    <div>
      <div className="settings-page__header">
        <h2 className="settings-page__title">部屋</h2>
      </div>

      {error && <div className="settings-error">{error}</div>}

      {floors.map(floor => (
        <div key={floor} className="settings-card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-default)', background: 'var(--bg-main)' }}>
            <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{floor}F</strong>
            <span style={{ color: 'var(--text-muted)', marginLeft: '8px', fontSize: '12px' }}>
              {floorMap[floor].length}室
            </span>
          </div>
          <table className="settings-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}></th>
                <th>部屋番号</th>
                <th>部屋タイプ</th>
                <th>ステータス</th>
                <th>メモ</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {floorMap[floor].map(r => (
                <tr
                  key={r.id}
                  className={`${dragId === r.id ? 'pm-drag-source' : ''} ${dragOverId === r.id && dragId !== r.id ? 'pm-drag-over' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, r)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, r)}
                  onDragEnter={(e) => e.preventDefault()}
                >
                  <td style={{ cursor: 'grab', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>drag_indicator</span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{r.room_number}</td>
                  <td>{r.type_name}</td>
                  <td>
                    <span className={`settings-badge ${STATUS_COLORS[r.status] || ''}`}>
                      {STATUS_LABELS[r.status] || r.status}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '12px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.notes || '—'}
                  </td>
                  <td>
                    <button className="settings-btn settings-btn--sm" onClick={() => setModal(r)}>編集</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {modal && (
        <RoomModal data={modal} roomTypes={roomTypes} onSave={handleSave} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function RoomModal({ data, roomTypes, onSave, onClose }) {
  const [form, setForm] = useState({ ...data });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const { confirm } = useConfirm();

  const handleSubmit = async (e) => {
    e.preventDefault();

    // ステータス変更時は確認ダイアログ（稼働率・予約に影響するため）
    if (form.status !== data.status && form.status !== 'available') {
      const ok = await confirm(
        'ステータス変更',
        `${data.room_number}号室を「${STATUS_LABELS[form.status]}」に変更します。\nこの部屋はアサイン不可になります。`
      );
      if (!ok) return;
    }

    setSaving(true);
    const err = await onSave({
      id: form.id,
      room_type_id: form.room_type_id,
      status: form.status,
      notes: form.notes,
    });
    if (err) {
      setError(err);
      setSaving(false);
    }
  };

  return (
    <div className="settings-modal__overlay" onClick={onClose}>
      <form className="settings-modal" onClick={e => e.stopPropagation()} onSubmit={handleSubmit}>
        <h3 className="settings-modal__title">{data.room_number}号室を編集</h3>

        {error && <div className="settings-error">{error}</div>}

        <div className="settings-form__group">
          <label className="settings-form__label">部屋番号（変更不可）</label>
          <input className="settings-form__input settings-form__input--sm" value={form.room_number} disabled style={{ background: '#F1F5F9' }} />
        </div>

        <div className="settings-form__group">
          <label className="settings-form__label">部屋タイプ</label>
          <select
            className="settings-form__select"
            value={form.room_type_id}
            onChange={e => setForm(f => ({ ...f, room_type_id: parseInt(e.target.value, 10) }))}
          >
            {roomTypes.map(rt => (
              <option key={rt.id} value={rt.id}>{rt.type_name}</option>
            ))}
          </select>
        </div>

        <div className="settings-form__group">
          <label className="settings-form__label">ステータス</label>
          <select
            className="settings-form__select"
            value={form.status}
            onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
          >
            {Object.entries(STATUS_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>

        <div className="settings-form__group">
          <label className="settings-form__label">メモ</label>
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
