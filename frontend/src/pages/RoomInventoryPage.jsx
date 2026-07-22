import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../api/client';
import { parseLocal, addDays, todayStr } from '../utils/date';
import { usePolling } from '../hooks/usePolling';
import './RoomInventoryPage.css';

// 30日分を読み込み、横スクロールで全日閲覧可能
const DISPLAY_DAYS = 30;
const DOW = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 部屋在庫カレンダー
 * 横軸=日付（14日間）、縦軸=部屋タイプ
 * ヘッダーに総残室数・CI・CO、各セルにタイプ別残室数を表示
 * セルクリックで将来の直予約入力画面への導線を用意
 */
export default function RoomInventoryPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // 日付範囲: 今日を起点に14日間
  const [dateRange, setDateRange] = useState(() => {
    // 今日の1日前をスタートにして、昨日→今日→未来の流れで表示
    const from = addDays(todayStr(), -1);
    return { from, to: addDays(from, DISPLAY_DAYS - 1) };
  });

  // テーブルコンテナref（今日カラムへの自動スクロール用）
  const tableWrapRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get(`/rooms/inventory?from=${dateRange.from}&to=${dateRange.to}`);
      setData(res);
    } catch { /* ignore */ }
    setLoading(false);
  }, [dateRange]);

  useEffect(() => { setLoading(true); fetchData(); }, [fetchData]);
  // 在庫は頻繁に変わらないので60秒間隔でポーリング
  usePolling(fetchData, 60000);

  const shiftDays = (delta) => {
    setDateRange(prev => ({ from: addDays(prev.from, delta), to: addDays(prev.to, delta) }));
  };

  // 今日の日付文字列（本日ハイライト用）
  const today = todayStr();

  // 日付配列にDate情報を付与（曜日・週末判定用）
  const dateInfos = useMemo(() => {
    if (!data?.dates) return [];
    return data.dates.map(d => {
      const dt = parseLocal(d);
      const dow = dt.getDay();
      return {
        date: d,
        day: dt.getDate(),
        dowLabel: DOW[dow],
        isSat: dow === 6,
        isSun: dow === 0,
        isToday: d === today,
        isWeekend: dow === 0 || dow === 6,
      };
    });
  }, [data?.dates, today]);

  // セルの色分けクラスを判定
  // オーバーブッキング（マイナス）は赤太字、満室=赤、残少=黄
  const cellClass = (available, total) => {
    if (available < 0) return 'inv__cell--over';
    if (available === 0) return 'inv__cell--full';
    if (total > 0 && (available <= 2 || available / total <= 0.3)) return 'inv__cell--low';
    return 'inv__cell--ok';
  };

  // セルクリック: 将来の直予約入力への導線（現在はplaceholder）
  const handleCellClick = (date, roomType) => {
    // TODO: 直予約入力ページが実装されたらナビゲート
    // navigate(`/reservations/new?date=${date}&room_type=${roomType.type_code}`);
    console.log(`直予約: ${date} ${roomType.type_name}`);
  };

  return (
    <div className="inv">
      {/* ── ナビゲーション ── */}
      <div className="inv__nav">
        <button className="inv__nav-btn" onClick={() => shiftDays(-7)}>
          <span className="material-symbols-outlined">keyboard_double_arrow_left</span> 1週間前
        </button>
        <button className="inv__nav-btn" onClick={() => shiftDays(-1)}>
          <span className="material-symbols-outlined">chevron_left</span> 1日前
        </button>
        <button className="inv__nav-btn" onClick={() => {
          const from = addDays(todayStr(), -1);
          setDateRange({ from, to: addDays(from, DISPLAY_DAYS - 1) });
        }}>今日</button>
        <button className="inv__nav-btn" onClick={() => shiftDays(1)}>
          1日後 <span className="material-symbols-outlined">chevron_right</span>
        </button>
        <button className="inv__nav-btn" onClick={() => shiftDays(7)}>
          1週間後 <span className="material-symbols-outlined">keyboard_double_arrow_right</span>
        </button>
        <input
          type="date"
          className="inv__nav-date"
          title="日付を指定してジャンプ"
          onChange={(e) => {
            if (!e.target.value) return;
            setDateRange({ from: e.target.value, to: addDays(e.target.value, DISPLAY_DAYS - 1) });
          }}
        />
        <span className="inv__nav-period">{dateRange.from} 〜 {dateRange.to}</span>
      </div>

      {/* ── テーブル ── */}
      <div className="inv__table-wrap" ref={tableWrapRef}>
        {loading && !data ? (
          <div className="inv__loading">読み込み中...</div>
        ) : data ? (
          <table className="inv__table">
            <thead>
              {/* 日付行 */}
              <tr>
                <th className="inv__type-header inv__header-date-label">日付</th>
                {dateInfos.map(di => (
                  <th key={di.date} className={`inv__date-cell ${di.isToday ? 'inv__date-cell--today' : ''} ${di.isWeekend ? 'inv__date-cell--weekend' : ''} ${di.isSat ? 'inv__date-cell--sat' : ''} ${di.isSun ? 'inv__date-cell--sun' : ''}`}>
                    {di.date.slice(5).replace('-', '/')}
                    <span className="inv__date-dow">{di.dowLabel}</span>
                  </th>
                ))}
              </tr>
              {/* 総残室数行 */}
              <tr>
                <th className="inv__type-header inv__summary-label">総残室数</th>
                {data.dates.map(d => (
                  <th key={d} className={`inv__summary-cell inv__summary-cell--total ${d === today ? 'inv__date-cell--today' : ''}`}>
                    {data.summary[d]?.available ?? ''}
                  </th>
                ))}
              </tr>
              {/* CI行 */}
              <tr>
                <th className="inv__type-header inv__summary-label">CI</th>
                {data.dates.map(d => (
                  <th key={d} className={`inv__summary-cell ${d === today ? 'inv__date-cell--today' : ''}`}>
                    {data.summary[d]?.ci ?? 0}
                  </th>
                ))}
              </tr>
              {/* CO行 */}
              <tr>
                <th className="inv__type-header inv__summary-label">CO</th>
                {data.dates.map(d => (
                  <th key={d} className={`inv__summary-cell ${d === today ? 'inv__date-cell--today' : ''}`}>
                    {data.summary[d]?.co ?? 0}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* 部屋タイプ行 */}
              {data.room_types.map(rt => (
                <tr key={rt.id}>
                  <td className="inv__type-cell">
                    <span className="inv__type-name">{rt.type_name}</span>
                    <span className="inv__type-code">{rt.type_code}</span>
                    <span className="inv__type-total">{rt.total_rooms}</span>
                  </td>
                  {data.dates.map(d => {
                    const avail = data.inventory[d]?.[String(rt.id)] ?? 0;
                    const total = parseInt(rt.total_rooms, 10);
                    return (
                      <td
                        key={d}
                        className={`inv__cell ${cellClass(avail, total)} ${d === today ? 'inv__col-today' : ''}`}
                        title={`${rt.type_name} ${d.slice(5).replace('-', '/')} — 残${avail}室 / 全${total}室`}
                        onClick={() => handleCellClick(d, rt)}
                      >
                        {avail}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {/* 合計行 */}
              <tr className="inv__total-row">
                <td className="inv__type-cell inv__total-label">
                  合計
                </td>
                {data.dates.map(d => {
                  const totalAvail = data.summary[d]?.available ?? 0;
                  const totalRooms = data.room_types.reduce((s, rt) => s + parseInt(rt.total_rooms, 10), 0);
                  return (
                    <td key={d} className={`inv__cell ${cellClass(totalAvail, totalRooms)} ${d === today ? 'inv__col-today' : ''}`}>
                      {totalAvail}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
