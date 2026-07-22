import React, { useState, useMemo, useCallback } from 'react';
import { parseLocal, fmt } from '../utils/date';
import './CalendarPicker.css';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 自作カレンダーコンポーネント
 *
 * mode='single': 単日選択（value: string, onChange: (date: string) => void）
 * mode='range':  範囲選択（value: { from, to }, onChange: ({ from, to }) => void）
 *   - 1回目クリック → from設定、toリセット
 *   - 2回目クリック → to設定（fromより前ならfromと入れ替え）
 *   - ホバー時にfrom〜マウス位置の範囲をプレビュー
 *
 * 将来拡張: renderDay prop でセル内に稼働率・料金を表示可能
 */
export default function CalendarPicker({
  mode = 'single',
  value,
  onChange,
  minDate,
  maxDate,
  highlightToday = true,
}) {
  // 表示中の年月（カレンダーのページ）
  const initialMonth = useMemo(() => {
    const target = mode === 'range' ? value?.from : value;
    if (target) {
      const d = parseLocal(target);
      return { year: d.getFullYear(), month: d.getMonth() };
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [viewYear, setViewYear] = useState(initialMonth.year);
  const [viewMonth, setViewMonth] = useState(initialMonth.month);

  // 範囲選択の途中状態: fromのみ選択済みでtoが未決定
  const [pendingFrom, setPendingFrom] = useState(null);
  // ホバー中の日付（プレビュー用）
  const [hoverDate, setHoverDate] = useState(null);

  const todayStr = useMemo(() => fmt(new Date()), []);

  // 月送り
  const shiftMonth = useCallback((delta) => {
    setViewMonth(prev => {
      let newMonth = prev + delta;
      let newYear = viewYear;
      if (newMonth < 0) { newMonth = 11; newYear--; }
      if (newMonth > 11) { newMonth = 0; newYear++; }
      setViewYear(newYear);
      return newMonth;
    });
  }, [viewYear]);

  // カレンダーグリッドの日付配列を生成（前月末日＋当月＋翌月始日で6週分42日）
  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const startDow = firstDay.getDay(); // 月初の曜日（0=日曜）
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    const days = [];

    // 前月の日を埋める
    if (startDow > 0) {
      const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();
      for (let i = startDow - 1; i >= 0; i--) {
        const d = new Date(viewYear, viewMonth - 1, prevMonthDays - i);
        days.push({ date: fmt(d), day: prevMonthDays - i, isCurrentMonth: false });
      }
    }

    // 当月
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(viewYear, viewMonth, d);
      days.push({ date: fmt(dt), day: d, isCurrentMonth: true });
    }

    // 翌月の日で6週分（42日）に埋める
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const dt = new Date(viewYear, viewMonth + 1, d);
      days.push({ date: fmt(dt), day: d, isCurrentMonth: false });
    }

    return days;
  }, [viewYear, viewMonth]);

  // 日付クリック
  const handleDayClick = useCallback((dateStr) => {
    // 無効判定
    if (minDate && dateStr < minDate) return;
    if (maxDate && dateStr > maxDate) return;

    if (mode === 'single') {
      onChange(dateStr);
      return;
    }

    // range モード
    if (!pendingFrom) {
      // 1回目クリック: fromを設定
      setPendingFrom(dateStr);
      onChange({ from: dateStr, to: '' });
    } else {
      // 2回目クリック: toを設定
      let from = pendingFrom;
      let to = dateStr;
      // fromより前ならスワップ
      if (to < from) [from, to] = [to, from];
      setPendingFrom(null);
      setHoverDate(null);
      onChange({ from, to });
    }
  }, [mode, onChange, pendingFrom, minDate, maxDate]);

  // 各日のCSS状態を計算
  const getDayState = useCallback((dateStr, isCurrentMonth) => {
    const classes = ['cp__day'];

    if (!isCurrentMonth) classes.push('cp__day--outside');

    // 無効日
    const disabled = (minDate && dateStr < minDate) || (maxDate && dateStr > maxDate);
    if (disabled) classes.push('cp__day--disabled');

    // 曜日の色
    const d = parseLocal(dateStr);
    const dow = d.getDay();
    if (dow === 0) classes.push('cp__day--sun');
    if (dow === 6) classes.push('cp__day--sat');

    // 今日
    if (highlightToday && dateStr === todayStr) classes.push('cp__day--today');

    if (mode === 'single') {
      if (dateStr === value) classes.push('cp__day--selected');
    } else {
      const from = pendingFrom || value?.from || '';
      const to = value?.to || '';

      // 選択端点
      if (dateStr === from) classes.push('cp__day--from');
      if (dateStr === to) classes.push('cp__day--to');

      // 確定範囲
      if (from && to && dateStr > from && dateStr < to) {
        classes.push('cp__day--in-range');
      }

      // ホバープレビュー（fromのみ選択中）
      if (pendingFrom && hoverDate && !to) {
        const previewFrom = pendingFrom < hoverDate ? pendingFrom : hoverDate;
        const previewTo = pendingFrom < hoverDate ? hoverDate : pendingFrom;
        if (dateStr > previewFrom && dateStr < previewTo) {
          classes.push('cp__day--preview');
        }
        if (dateStr === previewTo && dateStr !== pendingFrom) {
          classes.push('cp__day--preview-end');
        }
      }
    }

    return classes.join(' ');
  }, [mode, value, pendingFrom, hoverDate, minDate, maxDate, highlightToday, todayStr]);

  // 範囲情報の表示テキスト
  const rangeInfo = useMemo(() => {
    if (mode !== 'range') return null;
    const from = value?.from;
    const to = value?.to;
    if (!from && !to) return 'チェックイン日をクリックしてください';
    if (from && !to) return `${from}（チェックアウト日をクリック）`;
    if (from && to) {
      const nights = Math.round((parseLocal(to) - parseLocal(from)) / 86400000);
      return `${from} → ${to}（${nights}泊）`;
    }
    return null;
  }, [mode, value]);

  return (
    <div className="cp">
      {/* ヘッダー: 月送り */}
      <div className="cp__header">
        <button type="button" className="cp__nav" onClick={() => shiftMonth(-1)} title="前月">
          <span className="material-symbols-outlined">chevron_left</span>
        </button>
        <span className="cp__month-label">
          {viewYear}年 {viewMonth + 1}月
        </span>
        <button type="button" className="cp__nav" onClick={() => shiftMonth(1)} title="翌月">
          <span className="material-symbols-outlined">chevron_right</span>
        </button>
      </div>

      {/* 曜日ヘッダー */}
      <div className="cp__dow-row">
        {DOW_LABELS.map((label, i) => (
          <div key={i} className={`cp__dow ${i === 0 ? 'cp__dow--sun' : ''} ${i === 6 ? 'cp__dow--sat' : ''}`}>
            {label}
          </div>
        ))}
      </div>

      {/* 日付グリッド */}
      <div className="cp__grid">
        {calendarDays.map(({ date, day, isCurrentMonth }) => (
          <button
            key={date}
            type="button"
            className={getDayState(date, isCurrentMonth)}
            onClick={() => handleDayClick(date)}
            onMouseEnter={() => pendingFrom && setHoverDate(date)}
            onMouseLeave={() => setHoverDate(null)}
            disabled={(minDate && date < minDate) || (maxDate && date > maxDate)}
          >
            {day}
          </button>
        ))}
      </div>

      {/* 範囲情報 */}
      {rangeInfo && (
        <div className="cp__info">{rangeInfo}</div>
      )}
    </div>
  );
}
