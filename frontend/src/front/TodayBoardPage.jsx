import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import OtaBadge from './components/OtaBadge';
import { useFrontData } from './FrontDataContext';
import './TodayBoardPage.css';

// 食事区分ラベル（このページ専用なのでローカル定義でよい = 規約 #15 の但し書き）
const MEAL_LABELS = { breakfast: '朝食付', dinner: '夕食付', two_meals: '朝夕食付' };

/** 予約カードのメタ行「2名 ・ 3泊 ・ ツイン ・ 朝食付」を組み立てる */
function metaLine(r, extra) {
  const parts = [];
  const people = (Number(r.adult_count) || 0) + (Number(r.child_count) || 0);
  if (people > 0) parts.push(`${people}名`);
  if (r.nights) parts.push(`${r.nights}泊`);
  if (r.room_type) parts.push(r.room_type);
  if (MEAL_LABELS[r.meal_type]) parts.push(MEAL_LABELS[r.meal_type]);
  if (extra) parts.push(extra);
  return parts.join(' ・ ');
}

/**
 * 本日ボード（チェックイン / チェックアウト タブ共用） — 仕様書 §4.2 / mock #view-board-ci/co
 * データは FrontDataContext（/dashboard/front-board を8秒ポーリング）。
 */
export default function TodayBoardPage({ mode }) {
  const { summary, checkinList, checkoutList, loading } = useFrontData();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const isCI = mode === 'checkin';
  const list = isCI ? checkinList : checkoutList;
  const total = isCI ? (summary?.checkin_today || 0) : (summary?.checkout_today || 0);
  const done = isCI ? (summary?.checkin_done || 0) : (summary?.checkout_done || 0);
  const doneStatus = isCI ? 'checked_in' : 'checked_out';
  const actionLabel = isCI ? 'チェックイン →' : 'チェックアウト →';
  const doneLabelPrefix = isCI ? 'CI済' : 'CO済';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(r =>
      (r.guest_name || '').toLowerCase().includes(q) ||
      (r.guest_name_romaji || '').toLowerCase().includes(q)
    );
  }, [list, query]);

  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  const openDetail = (r) => {
    // 詳細画面は Phase 2/3 で実装（現状はプレースホルダに遷移）
    navigate(`/front/${mode}/${r.reservation_id}`);
  };

  return (
    <section className="fb">
      <div className="fb__summary">
        <div className="fb__summary-text">
          本日の{isCI ? 'チェックイン' : 'チェックアウト'} <b>{total}</b>件 ・ 完了 <b>{done}</b>件
        </div>
        <div className="fb__summary-bar"><div className="fb__summary-fill" style={{ width: `${progress}%` }} /></div>
        <label className="fb__search">
          <span className="fb__search-ic">🔍</span>
          <input
            className="fb__search-input"
            type="text"
            placeholder="ゲスト名で検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {loading && list.length === 0 ? (
        // 初回のみスケルトン（仕様書 §4.2 / §5）
        <div className="fb__skeletons">
          {[0, 1, 2].map(i => <div key={i} className="fb__skeleton" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="fb__empty">
          <img src="/coral-icon-dark.svg?v=2" alt="" className="fb__empty-ic" />
          <div>
            {query
              ? '該当する予約がありません'
              : isCI ? '本日のチェックインはすべて完了しました 🎉' : '本日のチェックアウトはすべて完了しました 🎉'}
          </div>
        </div>
      ) : (
        filtered.map(r => {
          const isDone = r.status === doneStatus;
          const unassigned = !r.room_number;
          const hasDue = Number(r.unpaid_amount) > 0;
          // COの未処理カードには「残額あり」を付す（mock #view-board-co）
          const extra = (!isCI && !isDone && hasDue) ? '残額あり' : null;
          const doneTime = isCI ? r.checkin_at : r.checkout_at;
          return (
            <div
              key={r.reservation_id}
              className={`fb__card ${unassigned && !isDone ? 'fb__card--alert' : ''} ${isDone ? 'fb__card--done' : ''}`}
              onClick={() => openDetail(r)}
              role="button"
            >
              <div className={`fb__room ${unassigned ? 'fb__room--none' : ''}`}>
                {r.room_number || '未'}
              </div>
              <div className="fb__main">
                <div className="fb__name">
                  {r.guest_name}
                  <OtaBadge channel={r.channel} />
                </div>
                <div className="fb__meta">{metaLine(r, extra)}</div>
                {unassigned && !isDone && (
                  <div className="fb__alerttext">⚠ 部屋未アサイン — PCで割り当てが必要です</div>
                )}
              </div>
              {isDone ? (
                <span className={`status-badge status-badge--${doneStatus} fb__status`}>
                  {doneLabelPrefix}{doneTime ? ` ${doneTime}` : ''}
                </span>
              ) : (
                <div className="fb__action">{actionLabel}</div>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
