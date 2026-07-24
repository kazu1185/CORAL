import { useState, useCallback, useEffect } from 'react';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import './FrontRoomsPage.css';

/**
 * 部屋状況（フロントモード Phase 4・閲覧専用） — 仕様書 §4.6 / mock #view-rooms
 *
 * PCの RoomIndicator と同じ /rooms/indicator を流用するが、以下を変える:
 *   - 配置編集モードなし（フロントは見るだけ）
 *   - タップで予約詳細に飛ばない（誤操作防止・handoff Phase4方針）
 *   - コンパクトな一覧カード（部屋番号・状態・ゲスト名を一目で）
 * 10秒ポーリング（規約 #11: usePolling + 即時fetchの併用）。
 *
 * グリッド配置がPC設定されているフロアは物理配置（空セル込み）で描画し、
 * 未設定のフロアは auto-fill で流し込む（PCと同じ見え方にしてスタッフの空間認知を保つ）。
 */

// 部屋の状態＋清掃状況から、カードの見た目種別と状態ラベルを決める（mock #view-rooms の配色に一致）
function roomKind(room) {
  const st = room.state;
  if (st === 'out_of_order') return { kind: 'ooo', label: '使用不可' };
  if (st === 'occupied') return { kind: 'stay', label: '在室' };
  if (st === 'checkout_due') return { kind: 'stay', label: 'CO予定' };
  if (st === 'checkin_due') return { kind: 'arrival', label: 'CI予定' };
  if (st === 'overdue_checkin') return { kind: 'overdue', label: '未CI' };
  // vacant: 清掃状況で色分け
  switch (room.housekeeping_status) {
    case 'clean':      return { kind: 'ready',   label: '空室・清掃済' };
    case 'cleaning':   return { kind: 'dirty',   label: '清掃中' };
    case 'dirty':      return { kind: 'dirty',   label: '未清掃' };
    case 'inspecting': return { kind: 'inspect', label: '点検中' };
    default:           return { kind: 'ready',   label: '空室' };
  }
}

const LEGEND = [
  { kind: 'stay',    label: '在室' },
  { kind: 'ready',   label: '空室・清掃済' },
  { kind: 'dirty',   label: '清掃中・未清掃' },
  { kind: 'inspect', label: '点検中' },
  { kind: 'arrival', label: 'CI予定' },
  { kind: 'overdue', label: '未CI' },
  { kind: 'ooo',     label: '使用不可' },
];

export default function FrontRoomsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const fetchIndicator = useCallback(async () => {
    try {
      const res = await api.get('/rooms/indicator');
      setData(res);
      setError('');
    } catch (e) {
      // ポーリング中の一時失敗で画面を暗転させない。初回のみエラー表示
      setData(prev => { if (!prev) setError('部屋状況の取得に失敗しました'); return prev; });
    }
  }, []);

  // 10秒ポーリング（handoff）＋ マウント時に即時1回（規約 #11）
  usePolling(fetchIndicator, 10000, true);
  useEffect(() => { fetchIndicator(); }, [fetchIndicator]);

  if (error && !data) return <div className="frm__loading">{error}</div>;
  if (!data) return <div className="frm__loading">読み込み中…</div>;

  const { summary, floors } = data;

  return (
    <div className="frm">
      {/* 状態サマリー */}
      <div className="frm__summary">
        <SummaryChip label="在室"   count={summary.occupied}        kind="stay" />
        <SummaryChip label="CO予定" count={summary.checkout_due}    kind="stay" />
        <SummaryChip label="CI予定" count={summary.checkin_due}     kind="arrival" />
        <SummaryChip label="未CI"   count={summary.overdue_checkin} kind="overdue" />
        <SummaryChip label="空室"   count={summary.vacant}          kind="ready" />
      </div>

      {/* 凡例 */}
      <div className="frm__legend">
        {LEGEND.map(l => (
          <span key={l.kind} className="frm__legend-item">
            <span className={`frm__legend-dot frm__dot--${l.kind}`} />{l.label}
          </span>
        ))}
      </div>

      {/* フロア別 */}
      {floors.map(floor => {
        const hasGrid = floor.grid_cols && floor.grid_rows;
        const gridMap = {};
        if (hasGrid) {
          floor.rooms.forEach(r => {
            if (r.grid_row && r.grid_col) gridMap[`${r.grid_row}-${r.grid_col}`] = r;
          });
        }
        return (
          <section key={floor.floor} className="frm__floor">
            <div className="frm__floor-head">
              {floor.floor}F{floor.label ? <span className="frm__floor-label">{floor.label}</span> : null}
            </div>

            {hasGrid ? (
              <div className="frm__grid frm__grid--fixed" style={{ gridTemplateColumns: `repeat(${floor.grid_cols}, 1fr)` }}>
                {Array.from({ length: floor.grid_rows * floor.grid_cols }, (_, i) => {
                  const row = Math.floor(i / floor.grid_cols) + 1;
                  const col = (i % floor.grid_cols) + 1;
                  const room = gridMap[`${row}-${col}`];
                  return room
                    ? <RoomCard key={room.room_id} room={room} />
                    : <div key={`e-${row}-${col}`} className="frm__empty-cell" />;
                })}
              </div>
            ) : (
              <div className="frm__grid">
                {floor.rooms.map(room => <RoomCard key={room.room_id} room={room} />)}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function SummaryChip({ label, count, kind }) {
  return (
    <div className="frm__chip">
      <span className={`frm__chip-dot frm__dot--${kind}`} />
      <span className="frm__chip-count num">{count}</span>
      <span className="frm__chip-label">{label}</span>
    </div>
  );
}

/** 閲覧専用の部屋カード（タップ不可＝誤操作防止） */
function RoomCard({ room }) {
  const { kind, label } = roomKind(room);
  const r = room.reservation;
  const hasGuest = r && (room.state === 'occupied' || room.state === 'checkout_due'
    || room.state === 'checkin_due' || room.state === 'overdue_checkin');

  return (
    <div className={`frm__room frm__room--${kind}`}>
      <div className="frm__room-top">
        <span className="frm__room-no num">{room.room_number}</span>
        {kind === 'arrival' && <span className="frm__room-dot" aria-hidden="true" />}
      </div>
      {hasGuest ? (
        <div className="frm__room-guest" title={r.guest_name}>{r.guest_name}</div>
      ) : <div className="frm__room-guest frm__room-guest--empty">{room.room_type_code || room.room_type || ''}</div>}
      <div className="frm__room-state">
        {label}
        {hasGuest && r.total_nights ? <span className="frm__room-nights"> {r.current_night}/{r.total_nights}泊</span> : null}
      </div>
    </div>
  );
}
