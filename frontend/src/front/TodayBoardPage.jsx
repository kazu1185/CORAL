import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import OtaBadge from './components/OtaBadge';
import { useFrontData } from './FrontDataContext';
import './TodayBoardPage.css';

// 食事区分ラベル（このページ専用なのでローカル定義でよい = 規約 #15 の但し書き）
const MEAL_LABELS = { breakfast: '朝食付', dinner: '夕食付', two_meals: '朝夕食付' };

/** 1予約の宿泊人数（大人＋子供） */
function headcount(r) {
  return (Number(r.adult_count) || 0) + (Number(r.child_count) || 0);
}

/** 予約カードのメタ行「2名 ・ 3泊 ・ ツイン ・ 朝食付」を組み立てる */
function metaLine(r, extra) {
  const parts = [];
  const people = headcount(r);
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
 *
 * 複数室予約（parent_reservation_id が同じ子予約群）は「1カード集約」で表示する（mock #view-board-ci の
 * 「宮里 洋一（グループ 3室）」カード）。個別に並べると同一予約が縦に散るため、代表1枚にまとめ、
 * タップで親詳細（既存の一括CI/CO画面）へ飛ばす。連結予約（guest_links）は会計もCIも別なので集約しない。
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

  // 表示アイテム化: 個別予約はそのまま、複数室予約は parent_reservation_id で1グループに集約。
  // グループの表示位置は「最初に現れた子」の位置に置く（既存の並び順 status/id を保つ）。
  const items = useMemo(() => {
    const result = [];
    const groupAt = new Map(); // parent_reservation_id → result内のインデックス
    for (const r of filtered) {
      const pid = r.parent_reservation_id;
      if (!pid) {
        result.push({ type: 'single', key: `r${r.reservation_id}`, r });
        continue;
      }
      if (groupAt.has(pid)) {
        result[groupAt.get(pid)].members.push(r);
      } else {
        groupAt.set(pid, result.length);
        result.push({ type: 'group', key: `g${pid}`, parentId: pid, members: [r] });
      }
    }
    return result;
  }, [filtered]);

  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  // 個別=そのID、グループ=親IDへ遷移（親詳細が既存の一括CI/CO画面 = FrontCheckinPage/FrontCheckoutPage）
  const goDetail = (id) => navigate(`/front/${mode}/${id}`);

  /** グループ集約カードの表示データを組み立てる（代表 = room_index 最小の子） */
  const buildGroup = (item) => {
    const ms = [...item.members].sort((a, b) => (Number(a.room_index) || 0) - (Number(b.room_index) || 0));
    const rep = ms[0];
    const count = ms.length;
    const doneCount = ms.filter(m => m.status === doneStatus).length;
    const totalPeople = ms.reduce((s, m) => s + headcount(m), 0);
    const unpaidTotal = ms.reduce((s, m) => s + (Number(m.unpaid_amount) || 0), 0);
    const rooms = ms.map(m => m.room_number || '未').join(' / ');
    // メタは室単位のプラン/食事が混在しうるので出さず、モック準拠で「人数・泊数・号室一覧」
    const metaParts = [];
    if (totalPeople > 0) metaParts.push(`${totalPeople}名`);
    if (rep.nights) metaParts.push(`${rep.nights}泊`);
    metaParts.push(rooms);
    if (!isCI && doneCount < count && unpaidTotal > 0) metaParts.push('残額あり');
    return {
      rep,
      count,
      doneCount,
      allDone: doneCount === count,
      anyUnassigned: ms.some(m => !m.room_number),
      roomBox: rep.room_number || '未',
      name: `${rep.guest_name}（グループ ${count}室）`,
      meta: metaParts.join(' ・ '),
    };
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
      ) : items.length === 0 ? (
        <div className="fb__empty">
          <img src="/coral-icon-dark.svg?v=2" alt="" className="fb__empty-ic" />
          <div>
            {query
              ? '該当する予約がありません'
              : isCI ? '本日のチェックインはすべて完了しました 🎉' : '本日のチェックアウトはすべて完了しました 🎉'}
          </div>
        </div>
      ) : (
        items.map(item => {
          if (item.type === 'group') {
            const g = buildGroup(item);
            const isDone = g.allDone;
            const showAlert = g.anyUnassigned && !isDone;
            return (
              <div
                key={item.key}
                className={`fb__card ${showAlert ? 'fb__card--alert' : ''} ${isDone ? 'fb__card--done' : ''}`}
                onClick={() => goDetail(item.parentId)}
                role="button"
              >
                <div className={`fb__room ${!g.rep.room_number ? 'fb__room--none' : ''}`}>{g.roomBox}</div>
                <div className="fb__main">
                  <div className="fb__name">
                    {g.name}
                    <OtaBadge channel={g.rep.channel} />
                  </div>
                  <div className="fb__meta">{g.meta}</div>
                  {showAlert && (
                    <div className="fb__alerttext">⚠ 未アサインの部屋があります — PCで割り当てが必要です</div>
                  )}
                  {/* 部分完了（例: 3室中1室だけCI済）は残室を明示。全室完了時はステータスバッジ側に集約 */}
                  {!isDone && g.doneCount > 0 && (
                    <div className="fb__groupprogress">{g.doneCount}/{g.count}室 {doneLabelPrefix}</div>
                  )}
                </div>
                {isDone ? (
                  <span className={`status-badge status-badge--${doneStatus} fb__status`}>
                    {doneLabelPrefix}（{g.count}室）
                  </span>
                ) : (
                  <div className="fb__action">{actionLabel}</div>
                )}
              </div>
            );
          }

          const r = item.r;
          const isDone = r.status === doneStatus;
          const unassigned = !r.room_number;
          const hasDue = Number(r.unpaid_amount) > 0;
          // COの未処理カードには「残額あり」を付す（mock #view-board-co）
          const extra = (!isCI && !isDone && hasDue) ? '残額あり' : null;
          const doneTime = isCI ? r.checkin_at : r.checkout_at;
          return (
            <div
              key={item.key}
              className={`fb__card ${unassigned && !isDone ? 'fb__card--alert' : ''} ${isDone ? 'fb__card--done' : ''}`}
              onClick={() => goDetail(r.reservation_id)}
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
