import { useState, useCallback, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePolling } from '../hooks/usePolling';
import { useConfirm } from '../components/ConfirmDialog';
import { api } from '../api/client';
import { OTA_LABELS } from '../utils/constants';
import { parseLocal, fmt, dayDiff, addDays, todayStr } from '../utils/date';
import './AssignBoardPage.css';

const ROOM_COL_WIDTH = 80;
const DISPLAY_DAYS = 12; // 表示日数

export default function AssignBoardPage() {
  const navigate = useNavigate();
  const { confirm: showConfirm, alert: showAlert } = useConfirm();
  const [data, setData] = useState(null);
  const [dateRange, setDateRange] = useState(() => {
    // 昨日を起点に DISPLAY_DAYS 日分表示（昨日→今日→未来の流れ）
    const t = todayStr();
    return { from: addDays(t, -1), to: addDays(t, DISPLAY_DAYS - 2) };
  });
  const [dragState, setDragState] = useState(null);
  const [dragOverRoomId, setDragOverRoomId] = useState(null);
  const [previewResv, setPreviewResv] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [moveDialog, setMoveDialog] = useState(null);
  const [tooltip, setTooltip] = useState(null); // { x, y, assign }
  const [resizing, setResizing] = useState(null); // { assignId, originalCoDate, startX }
  const [panelOpen, setPanelOpen] = useState(() => {
    return localStorage.getItem('pms_assign_panel') !== 'closed';
  });
  // 統合選択モード: ヘッダーの「統合」ボタンで ON/OFF
  const [mergeMode, setMergeMode] = useState(false);
  // 選択された reservation_id の Set（merge API が reservation_ids を要求するため）
  const [mergeSelectedIds, setMergeSelectedIds] = useState(new Set());

  const [cellWidth, setCellWidth] = useState(80);
  const chartWrapRef = useRef(null);
  const firstCellRef = useRef(null);

  const dates = useMemo(() => {
    const result = [];
    const d = parseLocal(dateRange.from);
    const end = parseLocal(dateRange.to);
    while (d <= end) {
      result.push(fmt(d));
      d.setDate(d.getDate() + 1);
    }
    return result;
  }, [dateRange]);

  const today = todayStr();

  useLayoutEffect(() => {
    const measure = () => {
      if (firstCellRef.current) {
        const w = firstCellRef.current.getBoundingClientRect().width;
        if (w > 0) setCellWidth(w);
      }
    };
    const timer = setTimeout(measure, 30);
    window.addEventListener('resize', measure);
    return () => { clearTimeout(timer); window.removeEventListener('resize', measure); };
  }, [dateRange]);

  useEffect(() => {
    localStorage.setItem('pms_assign_panel', panelOpen ? 'open' : 'closed');
  }, [panelOpen]);

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get(`/assigns?from=${dateRange.from}&to=${dateRange.to}`);
      setData(res);
    } catch { /* ignore */ }
  }, [dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);
  usePolling(fetchData, 15000);

  // 統合モード中は ESC でモード終了
  useEffect(() => {
    if (!mergeMode) return;
    const h = (e) => {
      if (e.key === 'Escape') { setMergeMode(false); setMergeSelectedIds(new Set()); }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [mergeMode]);

  // 統合選択トグル
  const handleMergeToggle = useCallback((reservationId) => {
    setMergeSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(reservationId)) next.delete(reservationId);
      else next.add(reservationId);
      return next;
    });
  }, []);

  // 統合実行: 選択した予約の詳細を取得 → バリデーション → 確認 → API
  const handleMergeExecute = async () => {
    const selectedResvIds = Array.from(mergeSelectedIds);

    // 各予約の詳細を取得（updated_at とステータスが必要）
    let resvDetails;
    try {
      resvDetails = await Promise.all(
        selectedResvIds.map(id => api.get(`/reservations/${id}`))
      );
    } catch {
      showAlert('エラー', '予約情報の取得に失敗しました');
      return;
    }

    // ステータスチェック（統合不可なステータスを検出）
    const invalidItems = resvDetails.filter(r =>
      ['cancelled', 'checked_out', 'no_show', 'merged'].includes(r.status)
    );
    if (invalidItems.length > 0) {
      showAlert('統合不可',
        `キャンセル済み・CO済みの予約が含まれています（${invalidItems.map(r => r.reservation_no || `#${r.id}`).join(', ')}）`
      );
      return;
    }

    // CI日でソートして統合情報を構築
    const sorted = [...resvDetails].sort((a, b) => a.checkin_date.localeCompare(b.checkin_date));
    const parent = sorted[0];
    const children = sorted.slice(1);
    const lastItem = sorted[sorted.length - 1];
    const totalAmount = sorted.reduce((sum, r) => sum + Number(r.amount), 0);

    const detail = [
      `【統合対象】`,
      ...sorted.map(r =>
        `  ${r.reservation_no || `#${r.id}`}  ${r.checkin_date}〜${r.checkout_date}  ${Number(r.amount).toLocaleString()}円`
      ),
      ``,
      `【統合後】`,
      `  親予約: ${parent.reservation_no || `#${parent.id}`}`,
      `  日程: ${parent.checkin_date}〜${lastItem.checkout_date}`,
      `  合計金額: ${totalAmount.toLocaleString()}円`,
      ``,
      `※ ${children.map(r => r.reservation_no || `#${r.id}`).join(', ')} は統合されて非表示になります`,
    ].join('\n');

    if (!await showConfirm('予約の統合', detail)) return;

    try {
      // 楽観ロック用 updated_ats（規約 #16）
      const updated_ats = {};
      for (const r of resvDetails) updated_ats[r.id] = r.updated_at;

      const res = await api.post('/reservations/merge', {
        reservation_ids: selectedResvIds,
        updated_ats,
      });
      setMergeMode(false);
      setMergeSelectedIds(new Set());
      fetchData();
      showAlert('統合完了', `${res.nights}泊の予約に統合しました（合計 ${Number(res.amount).toLocaleString()}円）`);
    } catch (err) {
      showAlert('エラー', err.message);
    }
  };

  const shiftDays = (delta) => {
    setDateRange(prev => ({ from: addDays(prev.from, delta), to: addDays(prev.to, delta) }));
  };

  // 部屋番号マップ（確認ダイアログ用）
  const roomNumMap = useMemo(() => {
    if (!data) return {};
    const map = {};
    for (const r of data.rooms) map[r.id] = r.room_number;
    return map;
  }, [data]);

  const handleDrop = async (roomId, dropDate, drag) => {
    try {
      if (drag._dragType === 'assign') {
        if (roomId === drag.room_id) return;
        const fromRoom = roomNumMap[drag.room_id] || drag.room_id;
        const toRoom = roomNumMap[roomId] || roomId;
        if (!await showConfirm('部屋移動', `${drag.guest_name} を ${fromRoom}号室 → ${toRoom}号室 に移動しますか？`)) {
          setDragState(null); setDragOverRoomId(null); return;
        }
        await api.post(`/assigns/${drag.id}/move`, { new_room_id: roomId });
      } else {
        const toRoom = roomNumMap[roomId] || roomId;
        if (!await showConfirm('アサイン', `${drag.guest_name} を ${toRoom}号室 にアサインしますか？`)) {
          setDragState(null); setDragOverRoomId(null); return;
        }
        const res = await api.post('/assigns', {
          reservation_id: drag.id,
          room_id: roomId,
          check_in_date: drag.checkin_date,
          check_out_date: drag.checkout_date,
        });
        if (res.warnings?.length > 0) {
          showAlert('警告', res.warnings.map(w => w.message).join('\n'));
        }
      }
      fetchData();
    } catch (err) {
      showAlert('エラー', err.message);
    }
    setDragState(null);
    setDragOverRoomId(null);
  };

  const handleRemoveAssign = async (assignId) => {
    if (!await showConfirm('アサイン取消', 'このアサインを取り消しますか？', { confirmColor: 'red', confirmLabel: '取り消す' })) return;
    try {
      await api.delete(`/assigns/${assignId}`);
      setContextMenu(null);
      fetchData();
    } catch (err) { showAlert('エラー', err.message); }
  };

  const handleMoveRoom = async (assignId, newRoomId) => {
    try {
      await api.post(`/assigns/${assignId}/move`, { new_room_id: newRoomId });
      setMoveDialog(null);
      fetchData();
    } catch (err) { showAlert('エラー', err.message); }
  };

  const handleSplitMove = async (assignId, splitDate, newRoomId) => {
    try {
      await api.post(`/assigns/${assignId}/split`, { split_date: splitDate, new_room_id: newRoomId });
      setMoveDialog(null);
      fetchData();
    } catch (err) { showAlert('エラー', err.message); }
  };

  // 延泊/短縮: リサイズ完了
  const handleResizeEnd = async (assignId, originalCoDate, newCheckoutDate, guestName) => {
    const action = newCheckoutDate > originalCoDate ? '延泊' : '短縮';
    if (!await showConfirm(action, `${guestName} のCO日を ${originalCoDate} → ${newCheckoutDate} に${action}しますか？`)) {
      setResizing(null); return;
    }
    try {
      await api.put(`/assigns/${assignId}`, { check_out_date: newCheckoutDate });
      fetchData();
    } catch (err) { showAlert('エラー', err.message); }
    setResizing(null);
  };

  if (!data) {
    return <div className="ab__loading">読み込み中...</div>;
  }

  const { rooms, assigns, unassigned } = data;

  // room_id別にグループ化（released は全て非表示）
  const assignsByRoom = {};
  for (const a of assigns) {
    if (a.status === 'released') continue;
    if (!assignsByRoom[a.room_id]) assignsByRoom[a.room_id] = [];
    assignsByRoom[a.room_id].push(a);
  }

  const linkedGroups = {};
  for (const a of assigns) {
    if (a.status === 'released' || !a.link_group_id) continue;
    if (!linkedGroups[a.link_group_id]) linkedGroups[a.link_group_id] = [];
    linkedGroups[a.link_group_id].push(a);
  }
  for (const gid of Object.keys(linkedGroups)) {
    linkedGroups[gid].sort((a, b) => (a.link_sequence ?? 0) - (b.link_sequence ?? 0));
  }

  return (
    <div className="ab">
      {/* ナビゲーション */}
      <div className="ab__nav">
        <button className="ab__nav-btn" onClick={() => shiftDays(-7)}>
          <span className="material-symbols-outlined">keyboard_double_arrow_left</span> 1週間前
        </button>
        <button className="ab__nav-btn" onClick={() => shiftDays(-1)}>
          <span className="material-symbols-outlined">chevron_left</span> 1日前
        </button>
        <button className="ab__nav-btn" onClick={() => {
          const t = todayStr();
          setDateRange({ from: addDays(t, -1), to: addDays(t, DISPLAY_DAYS - 2) });
        }}>今日</button>
        <button className="ab__nav-btn" onClick={() => shiftDays(1)}>
          1日後 <span className="material-symbols-outlined">chevron_right</span>
        </button>
        <button className="ab__nav-btn" onClick={() => shiftDays(7)}>
          1週間後 <span className="material-symbols-outlined">keyboard_double_arrow_right</span>
        </button>
        {/* 日付指定ジャンプ: 指定日の2日前を起点に表示 */}
        <input
          type="date"
          className="ab__nav-date"
          title="日付を指定してジャンプ"
          onChange={(e) => {
            if (!e.target.value) return;
            // 指定日を中心に左2日分を表示するため、from = 指定日 - 2日
            const f = addDays(e.target.value, -2);
            setDateRange({ from: f, to: addDays(f, DISPLAY_DAYS - 1) });
          }}
        />
        <span className="ab__nav-period">{dateRange.from} ~ {dateRange.to}</span>

        {/* 統合モード切替: ボード上のバーをクリックで選択→統合する導線 */}
        <button
          className={`ab__nav-btn ab__merge-toggle ${mergeMode ? 'ab__merge-toggle--active' : ''}`}
          onClick={() => { setMergeMode(prev => !prev); setMergeSelectedIds(new Set()); }}
        >
          <span className="material-symbols-outlined">merge</span>
          {mergeMode ? '統合モード終了' : '統合'}
        </button>

        <button
          className={`ab__nav-btn ab__panel-toggle ${panelOpen ? 'ab__panel-toggle--active' : ''}`}
          onClick={() => setPanelOpen(p => !p)}
        >
          <span className="material-symbols-outlined">
            {panelOpen ? 'right_panel_close' : 'right_panel_open'}
          </span>
          未アサイン {unassigned.length > 0 && <span className="ab__badge">{unassigned.length}</span>}
        </button>
      </div>

      {/* メインエリア */}
      <div className="ab__body">
        <div className="ab__chart-wrap" ref={chartWrapRef}>
          <table className="ab__chart">
            <thead>
              <tr>
                <th className="ab__room-header">部屋</th>
                {dates.map((d, i) => {
                  const dt = parseLocal(d);
                  const dow = ['日','月','火','水','木','金','土'][dt.getDay()];
                  const isToday = d === today;
                  const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
                  return (
                    <th key={d}
                      ref={i === 0 ? firstCellRef : undefined}
                      className={`ab__date-header ${isToday ? 'ab__date-header--today' : ''} ${isWeekend ? 'ab__date-header--weekend' : ''}`}
                    >
                      <span className="ab__date-day">{dt.getDate()}</span>
                      <span className="ab__date-dow">{dow}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rooms.map(room => {
                const roomAssigns = assignsByRoom[room.id] || [];
                return (
                  <tr key={room.id}
                    className={`${room.room_status !== 'available' ? 'ab__row--disabled' : ''} ${dragState && dragOverRoomId === room.id ? 'ab__row--drag-over' : ''}`}
                  >
                    <td className="ab__room-cell">
                      <span className="ab__room-num">{room.room_number}</span>
                      <span className="ab__room-type">{room.type_name}</span>
                    </td>
                    {dates.map((d, colIdx) => {
                      const isToday = d === today;
                      const dt = parseLocal(d);
                      const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;

                      const renderedGroupIds = new Set();
                      const barsToRender = [];
                      for (const a of roomAssigns) {
                        const startIdx = Math.max(0, dayDiff(dateRange.from, a.check_in_date));
                        if (startIdx !== colIdx) continue;
                        if (a.link_group_id && linkedGroups[a.link_group_id]) {
                          const group = linkedGroups[a.link_group_id];
                          const groupFirstIdx = Math.max(0, dayDiff(dateRange.from, group[0].check_in_date));
                          if (groupFirstIdx !== colIdx) continue;
                          if (renderedGroupIds.has(a.link_group_id)) continue;
                          renderedGroupIds.add(a.link_group_id);
                          barsToRender.push({ type: 'linked', group });
                        } else {
                          barsToRender.push({ type: 'single', assign: a });
                        }
                      }

                      return (
                        <td key={d}
                          className={`ab__cell ${isToday ? 'ab__cell--today' : ''} ${isWeekend ? 'ab__cell--weekend' : ''}`}
                          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragState) setDragOverRoomId(room.id); }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (dragState) handleDrop(room.id, d, dragState);
                          }}
                        >
                          {barsToRender.map(bar => {
                            if (bar.type === 'linked') {
                              return <LinkedBar key={`grp-${bar.group[0].link_group_id}`} group={bar.group} dateRange={dateRange} dates={dates} setContextMenu={setContextMenu} setDragState={setDragState} setDragOverRoomId={setDragOverRoomId} setTooltip={setTooltip} setPreviewResv={setPreviewResv} mergeMode={mergeMode} mergeSelectedIds={mergeSelectedIds} onMergeToggle={handleMergeToggle} />;
                            } else {
                              return <SingleBar key={bar.assign.id} a={bar.assign} cellWidth={cellWidth} dateRange={dateRange} dates={dates} setContextMenu={setContextMenu} setDragState={setDragState} setDragOverRoomId={setDragOverRoomId} setTooltip={setTooltip} handleResizeEnd={handleResizeEnd} firstCellRef={firstCellRef} setPreviewResv={setPreviewResv} mergeMode={mergeMode} mergeSelectedIds={mergeSelectedIds} onMergeToggle={handleMergeToggle} />;
                            }
                          })}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 右サイドパネル */}
        {panelOpen && (
          <aside className="ab__panel">
            <div className="ab__panel-header">
              <h3 className="ab__panel-title">
                未アサイン <span className="ab__panel-count">{unassigned.length}</span>
              </h3>
              <button className="ab__panel-close" onClick={() => setPanelOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="ab__panel-body">
              {unassigned.length === 0 ? (
                <div className="ab__panel-empty">未アサイン予約なし</div>
              ) : unassigned.map(u => (
                <div key={u.id} className={`ab__unassigned-item ota-border-${u.channel} ${mergeMode ? 'ab__unassigned-item--merge-mode' : ''} ${mergeMode && mergeSelectedIds.has(u.id) ? 'ab__unassigned-item--merge-selected' : ''}`}
                  draggable={!mergeMode}
                  onDragStart={(e) => { if (mergeMode) { e.preventDefault(); return; } setDragState({ ...u, _dragType: 'unassigned' }); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragEnd={() => { setDragState(null); setDragOverRoomId(null); }}
                  onClick={async () => {
                    // 統合モード: u.id は reservation_id そのもの
                    if (mergeMode) { handleMergeToggle(u.id); return; }
                    try { setPreviewResv(await api.get(`/reservations/${u.id}`)); } catch {}
                  }}
                >
                  <div className="ab__unassigned-name">
                    {u.guest_name}
                    <span className="ab__unassigned-pax">（大{u.adult_count}{u.child_count > 0 ? ` 子${u.child_count}` : ''}）</span>
                  </div>
                  <div className="ab__unassigned-dates">{u.checkin_date} ~ {u.checkout_date} ({u.nights}泊)</div>
                  <div className="ab__unassigned-meta">
                    <span className={`ab__ota ota-${u.channel}`}>{OTA_LABELS[u.channel] || u.channel}</span>
                    <span className="ab__unassigned-type">{u.room_type_name || u.room_type}</span>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>

      {/* 統合モード: 選択アクションバー（2件以上選択時に画面下部に表示） */}
      {mergeMode && mergeSelectedIds.size >= 2 && (
        <div className="ab__merge-bar">
          <span className="ab__merge-count">{mergeSelectedIds.size}件選択中</span>
          <button className="ab__merge-exec" onClick={handleMergeExecute}>
            <span className="material-symbols-outlined">merge</span> 統合実行
          </button>
          <button className="ab__merge-cancel" onClick={() => setMergeSelectedIds(new Set())}>
            選択解除
          </button>
        </div>
      )}

      {/* ツールチップ */}
      {tooltip && (
        <div className="ab__tooltip" style={{ top: tooltip.y, left: tooltip.x }}>
          <div className="ab__tooltip-name">{tooltip.assign.guest_name}</div>
          <div className="ab__tooltip-row"><span className={`ab__ota ota-${tooltip.assign.channel}`}>{OTA_LABELS[tooltip.assign.channel]}</span> {tooltip.assign.reservation_no}</div>
          <div className="ab__tooltip-row">{tooltip.assign.check_in_date} ~ {tooltip.assign.check_out_date} ({tooltip.assign.nights}泊)</div>
          <div className="ab__tooltip-row">大人{tooltip.assign.adult_count}名{tooltip.assign.child_count > 0 ? ` 子供${tooltip.assign.child_count}名` : ''} — {Number(tooltip.assign.amount).toLocaleString()}円</div>
          {tooltip.assign.room_type && <div className="ab__tooltip-row">部屋タイプ: {tooltip.assign.room_type}</div>}
        </div>
      )}

      {/* コンテキストメニュー */}
      {contextMenu && (
        <>
          <div className="ab__ctx-overlay" onClick={() => setContextMenu(null)} />
          <div className="ab__ctx-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
            <div className="ab__ctx-header">{contextMenu.assign.guest_name}</div>
            <button className="ab__ctx-item" onClick={() => { setMoveDialog({ assign: contextMenu.assign, mode: 'move' }); setContextMenu(null); }}>
              <span className="material-symbols-outlined">swap_horiz</span> 部屋移動
            </button>
            <button className="ab__ctx-item" onClick={() => { setMoveDialog({ assign: contextMenu.assign, mode: 'split' }); setContextMenu(null); }}>
              <span className="material-symbols-outlined">call_split</span> 途中移動
            </button>
            <button className="ab__ctx-item ab__ctx-item--danger" onClick={() => handleRemoveAssign(contextMenu.assign.id)}>
              <span className="material-symbols-outlined">close</span> アサイン取消
            </button>
          </div>
        </>
      )}

      {moveDialog && <MoveRoomDialog assign={moveDialog.assign} mode={moveDialog.mode} rooms={data.rooms} onMove={handleMoveRoom} onSplit={handleSplitMove} onCancel={() => setMoveDialog(null)} />}
      {previewResv && <ReservationPreviewModal data={previewResv} onClose={() => setPreviewResv(null)} onNavigate={(id) => { setPreviewResv(null); navigate(`/reservations/${id}`); }} onRefresh={fetchData} />}
    </div>
  );
}

// ============================================================
// 通常バー
// ============================================================
function SingleBar({ a, cellWidth, dateRange, dates, setContextMenu, setDragState, setDragOverRoomId, setTooltip, handleResizeEnd, firstCellRef, setPreviewResv, mergeMode, mergeSelectedIds, onMergeToggle }) {
  const startIdx = Math.max(0, dayDiff(dateRange.from, a.check_in_date));
  const endIdx = Math.min(dates.length, dayDiff(dateRange.from, a.check_out_date));
  const span = endIdx - startIdx;
  const tooltipTimer = useRef(null);

  const showTooltip = (e) => {
    tooltipTimer.current = setTimeout(() => {
      setTooltip({ x: e.clientX + 12, y: e.clientY + 12, assign: a });
    }, 400);
  };
  const hideTooltip = () => {
    clearTimeout(tooltipTimer.current);
    setTooltip(null);
  };

  // リサイズハンドル
  const isResizingRef = useRef(false);
  const handleResizeStart = (e) => {
    e.preventDefault();
    e.stopPropagation();
    isResizingRef.current = true;
    const startX = e.clientX;
    const cw = firstCellRef?.current?.getBoundingClientRect().width || cellWidth;

    const onMove = (me) => {
      me.preventDefault();
    };
    const onUp = (ue) => {
      const deltaX = ue.clientX - startX;
      const deltaDays = Math.round(deltaX / cw);
      if (deltaDays !== 0) {
        const newCo = parseLocal(a.check_out_date);
        newCo.setDate(newCo.getDate() + deltaDays);
        const newCoStr = fmt(newCo);
        if (dayDiff(a.check_in_date, newCoStr) >= 1) {
          handleResizeEnd(a.id, a.check_out_date, newCoStr, a.guest_name);
        }
      }
      // クリックイベント抑制のため少し遅延してフラグをリセット
      setTimeout(() => { isResizingRef.current = false; }, 100);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const isCI = a.res_status === 'checked_in';
  const canDrag = a.status === 'active' && !isCI;

  return (
    <button
      className={`ab__bar ${a.channel ? `ota-bg-${a.channel}` : 'ab__bar--merged'} ${a.res_status === 'no_show' ? 'ab__bar--noshow' : ''} ${isCI ? 'ab__bar--checked-in' : ''} ${mergeMode ? 'ab__bar--merge-mode' : ''} ${mergeMode && mergeSelectedIds.has(a.reservation_id) ? 'ab__bar--merge-selected' : ''}`}
      style={{ width: `calc(${span} * 100% - 2px)` }}
      draggable={canDrag && !mergeMode}
      onDragStart={(e) => {
        if (!canDrag || mergeMode) { e.preventDefault(); return; }
        e.stopPropagation(); setDragState({ ...a, _dragType: 'assign' }); e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => { setDragState(null); setDragOverRoomId(null); }}
      onClick={async () => {
        if (isResizingRef.current) return;
        // 統合モード: クリックで選択/解除
        if (mergeMode) { onMergeToggle(a.reservation_id); return; }
        try { setPreviewResv(await api.get(`/reservations/${a.reservation_id}`)); } catch {}
      }}
      onContextMenu={(e) => {
        e.preventDefault(); e.stopPropagation();
        if (mergeMode) return; // 統合モード中は右クリックメニュー無効
        if (a.status === 'active' && !isCI) {
          setContextMenu({ x: e.clientX, y: e.clientY, assign: a });
        }
      }}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
    >
      <span className="ab__bar-name">{a.guest_name}</span>
      {a.is_vip && <span className="ab__bar-vip">V</span>}
      {isCI && <span className="ab__bar-ci-badge">CI</span>}
      {canDrag && (
        <span className="ab__bar-resize" onMouseDown={handleResizeStart} title="ドラッグで延泊/短縮" />
      )}
    </button>
  );
}

// ============================================================
// 連結バー
// ============================================================
function LinkedBar({ group, dateRange, dates, setContextMenu, setDragState, setDragOverRoomId, setTooltip, setPreviewResv, mergeMode, mergeSelectedIds, onMergeToggle }) {
  const first = group[0];
  const last = group[group.length - 1];
  const totalStartIdx = Math.max(0, dayDiff(dateRange.from, first.check_in_date));
  const totalEndIdx = Math.min(dates.length, dayDiff(dateRange.from, last.check_out_date));
  const totalSpan = totalEndIdx - totalStartIdx;
  const tooltipTimer = useRef(null);

  const showTooltip = (e) => {
    tooltipTimer.current = setTimeout(() => {
      setTooltip({ x: e.clientX + 12, y: e.clientY + 12, assign: { ...first, check_out_date: last.check_out_date, nights: dayDiff(first.check_in_date, last.check_out_date), channel: group.map(g => g.channel).join('/') } });
    }, 400);
  };
  const hideTooltip = () => { clearTimeout(tooltipTimer.current); setTooltip(null); };

  return (
    <div
      className={`ab__bar ab__bar--linked ${mergeMode ? 'ab__bar--merge-mode' : ''} ${mergeMode && mergeSelectedIds.has(first.reservation_id) ? 'ab__bar--merge-selected' : ''}`}
      style={{ width: `calc(${totalSpan} * 100% - 2px)` }}
      draggable={!mergeMode}
      onDragStart={(e) => { if (mergeMode) { e.preventDefault(); return; } e.stopPropagation(); setDragState({ ...first, _dragType: 'assign' }); e.dataTransfer.effectAllowed = 'move'; }}
      onDragEnd={() => { setDragState(null); setDragOverRoomId(null); }}
      onClick={async () => {
        // 統合モード: クリックで選択/解除
        if (mergeMode) { onMergeToggle(first.reservation_id); return; }
        try { setPreviewResv(await api.get(`/reservations/${first.reservation_id}`)); } catch {}
      }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (mergeMode) return; setContextMenu({ x: e.clientX, y: e.clientY, assign: first }); }}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
    >
      {group.map((seg, si) => {
        const segNights = dayDiff(seg.check_in_date, seg.check_out_date);
        const totalNights = dayDiff(first.check_in_date, last.check_out_date);
        const flexBasis = `${(segNights / totalNights) * 100}%`;
        return (
          <span key={seg.id} className={`ab__bar-segment ${seg.channel ? `ota-bg-${seg.channel}` : 'ab__bar--merged'}`} style={{ flexBasis }}>
            {si === 0 && <span className="ab__bar-name">{seg.guest_name}</span>}
            {si === 0 && seg.is_vip && <span className="ab__bar-vip">V</span>}
          </span>
        );
      })}
    </div>
  );
}

// ============================================================
// プレビューモーダル
// ============================================================
function ReservationPreviewModal({ data, onClose, onNavigate, onRefresh }) {
  const { alert: showAlert } = useConfirm();
  const d = data;
  const guestName = d.guest_name || `${d.tl_last_name} ${d.tl_first_name}`;

  // 部屋タイプ変更: クリックでドロップダウン表示
  const [editingType, setEditingType] = useState(false);
  const [roomTypes, setRoomTypes] = useState([]);
  const [selectedType, setSelectedType] = useState(d.room_type);

  // 部屋タイプマスタをドロップダウン表示時に取得（初回のみ）
  const handleStartEdit = async () => {
    if (roomTypes.length === 0) {
      try {
        const res = await api.get('/master/room-types');
        setRoomTypes(res.room_types || []);
      } catch { /* ignore */ }
    }
    setEditingType(true);
  };

  const handleTypeChange = async (newType) => {
    if (newType === d.room_type) {
      setEditingType(false);
      return;
    }
    try {
      await api.put(`/reservations/${d.id}`, {
        room_type: newType,
        updated_at: d.updated_at,
      });
      setEditingType(false);
      // モーダル内の表示を更新するためデータを再取得
      if (onRefresh) onRefresh();
    } catch (err) {
      showAlert('エラー', err.message);
    }
  };

  return (
    <>
      <div className="ab__modal-overlay" onClick={onClose} />
      <div className="ab__modal">
        <div className="ab__modal-header">
          <h2 className="ab__modal-title">予約詳細</h2>
          <button className="ab__modal-close" onClick={onClose}><span className="material-symbols-outlined">close</span></button>
        </div>
        <div className="ab__modal-body">
          <div className="ab__modal-row"><span className="ab__modal-label">ゲスト</span><span className="ab__modal-value">{guestName}{d.is_vip && <span className="ab__modal-vip">VIP</span>}</span></div>
          <div className="ab__modal-row"><span className="ab__modal-label">予約番号</span><span className="ab__modal-value ab__modal-mono">{d.reservation_no}</span></div>
          <div className="ab__modal-row"><span className="ab__modal-label">チャネル</span><span className={`ab__ota ota-${d.channel}`}>{OTA_LABELS[d.channel] || d.channel}</span></div>
          <div className="ab__modal-row"><span className="ab__modal-label">日程</span><span className="ab__modal-value">{d.checkin_date} ~ {d.checkout_date} ({d.nights}泊)</span></div>
          <div className="ab__modal-row">
            <span className="ab__modal-label">部屋タイプ</span>
            {editingType ? (
              <select
                className="ab__modal-select"
                value={selectedType}
                onChange={(e) => { setSelectedType(e.target.value); handleTypeChange(e.target.value); }}
                autoFocus
                onBlur={() => setEditingType(false)}
              >
                {roomTypes.map(rt => (
                  <option key={rt.type_code} value={rt.type_code}>{rt.type_name}</option>
                ))}
              </select>
            ) : (
              <span className="ab__modal-value ab__modal-editable" onClick={handleStartEdit} title="クリックで変更">
                {d.room_type_name || d.room_type}
                <span className="material-symbols-outlined" style={{ fontSize: 14, marginLeft: 4, opacity: 0.5 }}>edit</span>
              </span>
            )}
          </div>
          <div className="ab__modal-row"><span className="ab__modal-label">人数</span><span className="ab__modal-value">大人{d.adult_count}名{d.child_count > 0 ? ` / 子供${d.child_count}名` : ''}</span></div>
          <div className="ab__modal-row"><span className="ab__modal-label">金額</span><span className="ab__modal-value">{Number(d.amount).toLocaleString()}円</span></div>
          <div className="ab__modal-row"><span className="ab__modal-label">ステータス</span><span className={`ab__modal-status ab__modal-status--${d.status}`}>{d.status === 'confirmed' ? '予約確定' : d.status === 'checked_in' ? 'CI済' : d.status}</span></div>
          {d.guest_notes && <div className="ab__modal-row ab__modal-row--notes"><span className="ab__modal-label">ゲストメモ</span><span className="ab__modal-value ab__modal-notes">{d.guest_notes}</span></div>}
          {d.reservation_notes && <div className="ab__modal-row"><span className="ab__modal-label">滞在メモ</span><span className="ab__modal-value">{d.reservation_notes}</span></div>}
          {d.charges?.length > 0 && <div className="ab__modal-section"><h4 className="ab__modal-section-title">売上明細</h4>{d.charges.filter(c => c.status === 'active').map(c => <div key={c.id} className="ab__modal-charge"><span className="ab__modal-charge-date">{c.date}</span><span className="ab__modal-charge-desc" title={c.description}>{c.description}</span><span className="ab__modal-amount">{Number(c.amount).toLocaleString()}円</span></div>)}</div>}
        </div>
        <div className="ab__modal-footer">
          <button className="ab__modal-detail-btn" onClick={() => onNavigate(d.id)}>予約詳細を開く <span className="material-symbols-outlined">open_in_new</span></button>
        </div>
      </div>
    </>
  );
}

// ============================================================
// 部屋移動ダイアログ
// ============================================================
function MoveRoomDialog({ assign, mode, rooms, onMove, onSplit, onCancel }) {
  const [selectedRoom, setSelectedRoom] = useState('');
  const [splitDate, setSplitDate] = useState('');
  const availableRooms = rooms.filter(r => r.id !== assign.room_id && r.room_status === 'available');
  const handleSubmit = () => {
    if (!selectedRoom) return;
    if (mode === 'split') { if (!splitDate) return; onSplit(assign.id, splitDate, Number(selectedRoom)); }
    else { onMove(assign.id, Number(selectedRoom)); }
  };
  return (
    <>
      <div className="ab__modal-overlay" onClick={onCancel} />
      <div className="ab__modal" style={{ width: 400 }}>
        <div className="ab__modal-header"><h2 className="ab__modal-title">{mode === 'split' ? '途中移動' : '部屋移動'}</h2><button className="ab__modal-close" onClick={onCancel}><span className="material-symbols-outlined">close</span></button></div>
        <div className="ab__modal-body">
          <div className="ab__modal-row"><span className="ab__modal-label">ゲスト</span><span className="ab__modal-value">{assign.guest_name}</span></div>
          <div className="ab__modal-row"><span className="ab__modal-label">現在の部屋</span><span className="ab__modal-value">{rooms.find(r => r.id === assign.room_id)?.room_number || assign.room_id}</span></div>
          <div className="ab__modal-row"><span className="ab__modal-label">期間</span><span className="ab__modal-value">{assign.check_in_date} ~ {assign.check_out_date}</span></div>
          {mode === 'split' && <div style={{ marginTop: 12 }}><label className="ab__move-label">移動開始日</label><input type="date" className="ab__move-input" value={splitDate} min={assign.check_in_date} max={assign.check_out_date} onChange={(e) => setSplitDate(e.target.value)} /><p className="ab__move-hint">この日から {assign.check_out_date} まで新しい部屋に移動します</p></div>}
          <div style={{ marginTop: 12 }}><label className="ab__move-label">移動先の部屋</label><select className="ab__move-input" value={selectedRoom} onChange={(e) => setSelectedRoom(e.target.value)}><option value="">選択してください</option>{availableRooms.map(r => <option key={r.id} value={r.id}>{r.room_number} ({r.type_name})</option>)}</select></div>
        </div>
        <div className="ab__modal-footer" style={{ gap: 8 }}><button className="ab__move-cancel" onClick={onCancel}>キャンセル</button><button className="ab__move-submit" disabled={!selectedRoom || (mode === 'split' && !splitDate)} onClick={handleSubmit}>{mode === 'split' ? '途中移動する' : '部屋を移動する'}</button></div>
      </div>
    </>
  );
}

