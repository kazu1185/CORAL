import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePolling } from '../hooks/usePolling';
import { api } from '../api/client';
import { OTA_LABELS } from '../utils/constants';
import './RoomIndicatorPage.css';

const STATE_LABELS = {
  occupied: '在室', checkout_due: 'CO予定', checkin_due: 'CI予定',
  overdue_checkin: '未CI', vacant: '空室', out_of_order: '使用不可',
};

export default function RoomIndicatorPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  // 配置編集モード
  const [editMode, setEditMode] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [dragFloor, setDragFloor] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const dragNode = useRef(null);

  const fetchIndicator = useCallback(async () => {
    try {
      const res = await api.get('/rooms/indicator');
      setData(res);
    } catch { /* ignore */ }
  }, []);

  // 編集モード中はポーリング停止（データが書き変わらないように）
  usePolling(fetchIndicator, 10000, !editMode);

  // ドラッグ中の部屋ID
  const [dragRoomId, setDragRoomId] = useState(null);

  // ── グリッド配置のドラッグ＆ドロップ ──

  const handleGridDragStart = (e, roomId, floorNum) => {
    setDragId(roomId);
    setDragFloor(floorNum);
    setDragRoomId(roomId);
    dragNode.current = e.currentTarget;
    requestAnimationFrame(() => {
      if (dragNode.current) dragNode.current.style.opacity = '0.4';
    });
  };

  // グリッドセル（空セル or 部屋カード）にドロップ
  const handleGridDrop = async (floorNum, targetRow, targetCol, targetRoomId) => {
    if (dragNode.current) dragNode.current.style.opacity = '1';
    dragNode.current = null;
    if (!dragId || dragFloor !== floorNum) { resetDrag(); return; }

    const newFloors = data.floors.map(f => {
      if (f.floor !== floorNum) return f;
      const rooms = f.rooms.map(r => {
        // ドラッグした部屋 → ドロップ先の座標に移動
        if (r.room_id === dragId) {
          return { ...r, grid_row: targetRow, grid_col: targetCol };
        }
        // ドロップ先に既に部屋がある → ドラッグ元の座標にスワップ
        if (targetRoomId && r.room_id === targetRoomId) {
          const dragRoom = f.rooms.find(x => x.room_id === dragId);
          return { ...r, grid_row: dragRoom?.grid_row, grid_col: dragRoom?.grid_col };
        }
        return r;
      });
      return { ...f, rooms };
    });
    setData({ ...data, floors: newFloors });

    // APIで永続化（変更のあった部屋だけ送る）
    const floor = newFloors.find(f => f.floor === floorNum);
    const changed = floor.rooms.filter(r => r.grid_row != null && r.grid_col != null);
    try {
      await api.post('/rooms/grid-layout', {
        layout: changed.map(r => ({ room_id: r.room_id, grid_row: r.grid_row, grid_col: r.grid_col })),
      });
    } catch { /* ignore */ }

    resetDrag();
  };

  // グリッドサイズ変更
  const handleGridSizeChange = async (floorNum, cols, rows) => {
    // ローカル更新
    const newFloors = data.floors.map(f =>
      f.floor === floorNum ? { ...f, grid_cols: cols, grid_rows: rows } : f
    );
    setData({ ...data, floors: newFloors });

    // API保存（全フロアのconfig）
    const config = {};
    newFloors.forEach(f => {
      if (f.grid_cols && f.grid_rows) {
        config[f.floor] = { cols: f.grid_cols, rows: f.grid_rows };
      }
    });
    try {
      await api.post('/rooms/grid-config', { config });
    } catch { /* ignore */ }
  };

  // 自動配置（未配置の部屋をグリッドに順番に配置する）
  const handleAutoPlace = async (floorNum) => {
    const floor = data.floors.find(f => f.floor === floorNum);
    if (!floor || !floor.grid_cols || !floor.grid_rows) return;

    const occupied = new Set();
    floor.rooms.forEach(r => {
      if (r.grid_row && r.grid_col) occupied.add(`${r.grid_row}-${r.grid_col}`);
    });

    let nextIdx = 0;
    const allCells = [];
    for (let row = 1; row <= floor.grid_rows; row++) {
      for (let col = 1; col <= floor.grid_cols; col++) {
        allCells.push({ row, col });
      }
    }

    const layout = [];
    for (const room of floor.rooms) {
      if (room.grid_row && room.grid_col) {
        layout.push({ room_id: room.room_id, grid_row: room.grid_row, grid_col: room.grid_col });
        continue;
      }
      // 空いているセルを探す
      while (nextIdx < allCells.length && occupied.has(`${allCells[nextIdx].row}-${allCells[nextIdx].col}`)) nextIdx++;
      if (nextIdx < allCells.length) {
        const cell = allCells[nextIdx];
        layout.push({ room_id: room.room_id, grid_row: cell.row, grid_col: cell.col });
        occupied.add(`${cell.row}-${cell.col}`);
        nextIdx++;
      }
    }

    // ローカル更新
    const newFloors = data.floors.map(f => {
      if (f.floor !== floorNum) return f;
      return { ...f, rooms: f.rooms.map(r => {
        const l = layout.find(x => x.room_id === r.room_id);
        return l ? { ...r, grid_row: l.grid_row, grid_col: l.grid_col } : r;
      })};
    });
    setData({ ...data, floors: newFloors });

    try {
      await api.post('/rooms/grid-layout', { layout });
    } catch { /* ignore */ }
  };

  const resetDrag = () => {
    setDragId(null);
    setDragFloor(null);
    setDragOverId(null);
    setDragRoomId(null);
  };

  if (!data) {
    return <div className="ri__loading">読み込み中...</div>;
  }

  const { summary, floors } = data;

  return (
    <div className="ri">
      {/* サマリー + 編集モードボタン */}
      <div className="ri__header-row">
        <div className="ri__summary">
          <SummaryChip label="在室" count={summary.occupied} state="occupied" />
          <SummaryChip label="CO予定" count={summary.checkout_due} state="checkout_due" />
          <SummaryChip label="CI予定" count={summary.checkin_due} state="checkin_due" />
          <SummaryChip label="未CI" count={summary.overdue_checkin} state="overdue_checkin" />
          <SummaryChip label="空室" count={summary.vacant} state="vacant" />
        </div>
        {/* 配置編集ボタン: システム設定で非表示にできる */}
        {(data.show_layout_editor || editMode) && (
          <button
            className={`ri__edit-btn ${editMode ? 'ri__edit-btn--active' : ''}`}
            onClick={() => { setEditMode(v => !v); if (editMode) fetchIndicator(); }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
              {editMode ? 'check' : 'drag_indicator'}
            </span>
            {editMode ? '完了' : '配置編集'}
          </button>
        )}
      </div>

      {editMode && (
        <div className="ri__edit-hint">
          <span>ドラッグ＆ドロップで部屋の配置を変更できます（フロア内のみ）</span>
          <button className="ri__floor-order-btn" onClick={async () => {
            const newOrder = data.floor_order === 'desc' ? 'asc' : 'desc';
            // 即座にフロア順を反転
            setData(prev => ({
              ...prev,
              floor_order: newOrder,
              floors: [...prev.floors].reverse(),
            }));
            // APIで永続化（_metaにfloor_orderを保存）
            const config = {};
            data.floors.forEach(f => {
              if (f.grid_cols && f.grid_rows) config[f.floor] = { cols: f.grid_cols, rows: f.grid_rows };
            });
            config._meta = { floor_order: newOrder };
            try { await api.post('/rooms/grid-config', { config }); } catch {}
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>swap_vert</span>
            {data.floor_order === 'desc' ? '上階から表示中' : '下階から表示中'}
          </button>
        </div>
      )}

      {/* フロア別グリッド */}
      {floors.map(floor => {
        const hasGrid = floor.grid_cols && floor.grid_rows;
        // グリッド配置マップ: "row-col" → room
        const gridMap = {};
        if (hasGrid) {
          floor.rooms.forEach(r => {
            if (r.grid_row && r.grid_col) gridMap[`${r.grid_row}-${r.grid_col}`] = r;
          });
        }

        return (
          <section key={floor.floor} className="ri__floor">
            <div className="ri__floor-header">
              <h2 className="ri__floor-title">
                {floor.floor}F
                <span className="ri__floor-label">{floor.label}</span>
              </h2>
              {editMode && (
                <div className="ri__grid-config">
                  <label className="ri__grid-config-label">列</label>
                  <input type="number" className="ri__grid-config-input" min="1" max="10"
                    value={floor.grid_cols || 6}
                    onChange={e => handleGridSizeChange(floor.floor, parseInt(e.target.value) || 6, floor.grid_rows || 2)}
                  />
                  <label className="ri__grid-config-label">行</label>
                  <input type="number" className="ri__grid-config-input" min="1" max="10"
                    value={floor.grid_rows || 2}
                    onChange={e => handleGridSizeChange(floor.floor, floor.grid_cols || 6, parseInt(e.target.value) || 2)}
                  />
                  <button className="ri__auto-place-btn" onClick={() => handleAutoPlace(floor.floor)}>
                    自動配置
                  </button>
                </div>
              )}
            </div>

            {hasGrid ? (
              /* 固定グリッド表示 */
              <div className="ri__grid ri__grid--fixed"
                style={{ gridTemplateColumns: `repeat(${floor.grid_cols}, 1fr)` }}
              >
                {Array.from({ length: floor.grid_rows * floor.grid_cols }, (_, i) => {
                  const row = Math.floor(i / floor.grid_cols) + 1;
                  const col = (i % floor.grid_cols) + 1;
                  const room = gridMap[`${row}-${col}`];

                  if (room) {
                    return (
                      <RoomCard
                        key={room.room_id}
                        room={room}
                        editMode={editMode}
                        isDragOver={dragOverId === room.room_id}
                        onDragStart={(e) => handleGridDragStart(e, room.room_id, floor.floor)}
                        onDragOver={(e) => { e.preventDefault(); if (dragFloor === floor.floor) setDragOverId(room.room_id); }}
                        onDrop={() => handleGridDrop(floor.floor, row, col, room.room_id)}
                        onClick={() => { if (!editMode && room.reservation?.id) navigate(`/reservations/${room.reservation.id}`); }}
                      />
                    );
                  }

                  // 空セル
                  return (
                    <div
                      key={`empty-${row}-${col}`}
                      className={`ri__empty-cell ${editMode ? 'ri__empty-cell--editable' : ''} ${dragRoomId && dragFloor === floor.floor ? 'ri__empty-cell--drop-target' : ''}`}
                      onDragOver={editMode ? (e) => { e.preventDefault(); } : undefined}
                      onDrop={editMode ? () => handleGridDrop(floor.floor, row, col, null) : undefined}
                    />
                  );
                })}
              </div>
            ) : (
              /* 従来のauto-fillグリッド */
              <div className="ri__grid">
                {floor.rooms.map(room => (
                  <RoomCard
                    key={room.room_id}
                    room={room}
                    editMode={editMode}
                    isDragOver={false}
                    onDragStart={() => {}}
                    onDragOver={() => {}}
                    onDrop={() => {}}
                    onClick={() => { if (!editMode && room.reservation?.id) navigate(`/reservations/${room.reservation.id}`); }}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function SummaryChip({ label, count, state }) {
  return (
    <div className={`ri__chip ri__chip--${state}`}>
      <span className="ri__chip-count">{count}</span>
      <span className="ri__chip-label">{label}</span>
    </div>
  );
}

function RoomCard({ room, onClick, editMode, isDragOver, onDragStart, onDragOver, onDrop }) {
  const r = room.reservation;
  const hasReservation = r && room.state !== 'vacant' && room.state !== 'out_of_order';

  return (
    <button
      className={`ri__card ri__card--${room.state} ${editMode ? 'ri__card--editable' : ''} ${isDragOver ? 'ri__card--drag-over' : ''}`}
      onClick={onClick}
      disabled={!editMode && !hasReservation}
      draggable={editMode}
      onDragStart={editMode ? onDragStart : undefined}
      onDragOver={editMode ? (e) => { e.preventDefault(); onDragOver?.(e); } : undefined}
      onDrop={editMode ? onDrop : undefined}
    >
      <div className="ri__card-top">
        <span className="ri__room-number">{room.room_number}</span>
        {/* 部屋タイプコード（SW, TW等）を部屋番号の横に表示 */}
        {room.room_type_code && (
          <span className="ri__type-code">{room.room_type_code}</span>
        )}
        <span className="ri__state-badge">{STATE_LABELS[room.state]}</span>
      </div>

      {hasReservation ? (
        <div className="ri__card-body">
          <div className="ri__guest-row">
            <span className="ri__guest-name">
              {r.guest_name}
            </span>
            {/* VIP・リピーター・連結予約のアイコン */}
            <span className="ri__guest-icons">
              {r.is_vip && <span className="ri__vip">VIP</span>}
              {r.visit_count > 1 && (
                <span className="ri__repeater" title={`${r.visit_count}回目のご利用`}>
                  <span className="material-symbols-outlined">repeat</span>
                  {r.visit_count}
                </span>
              )}
              {r.has_link && (
                <span className="material-symbols-outlined ri__link-icon" title="連結予約">link</span>
              )}
            </span>
          </div>
          <div className="ri__meta-row">
            <span className={`ri__ota ota-${r.channel}`}>
              {OTA_LABELS[r.channel] || r.channel}
            </span>
            <span className="ri__nights">{r.current_night}/{r.total_nights}泊</span>
            <span className="ri__pax">
              {r.adult_count}名{r.child_count > 0 ? `+子${r.child_count}` : ''}
            </span>
          </div>
          {/* 追加情報行: 未精算・リクエスト・ゲストメモ・到着予定 */}
          {(r.has_guest_notes || r.has_request || r.unpaid_amount > 0 || r.estimated_arrival) && (
            <div className="ri__icons-row">
              {r.unpaid_amount > 0 && (
                <span className="ri__unpaid" title={`未精算 ¥${r.unpaid_amount.toLocaleString()}`}>
                  <span className="material-symbols-outlined">payment</span>
                  ¥{r.unpaid_amount.toLocaleString()}
                </span>
              )}
              {r.has_request && (
                <span className="material-symbols-outlined ri__request-icon" title="特別リクエストあり">campaign</span>
              )}
              {r.has_guest_notes && (
                <span className="material-symbols-outlined ri__note-icon" title="ゲストメモあり">sticky_note_2</span>
              )}
              {r.estimated_arrival && (
                <span className="ri__eta" title="到着予定時刻">
                  <span className="material-symbols-outlined">schedule</span>
                  {r.estimated_arrival}
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="ri__card-body ri__card-body--empty">
          <span className="ri__room-type">{room.room_type}</span>
        </div>
      )}

      <div className="ri__card-footer">
        <span className={`ri__hk ri__hk--${room.housekeeping_status}`}>
          {room.housekeeping_status === 'clean' ? '清掃済' :
           room.housekeeping_status === 'cleaning' ? '清掃中' :
           room.housekeeping_status === 'inspecting' ? '点検中' :
           room.housekeeping_status === 'dirty' ? '未清掃' : room.housekeeping_status}
        </span>
      </div>
    </button>
  );
}
