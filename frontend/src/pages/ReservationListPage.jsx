import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useConfirm } from '../components/ConfirmDialog';
import { OTA_LABELS, OTA_CHANNELS, RESERVATION_STATUS_LABELS } from '../utils/constants';
import { fmt, fmtDateTime } from '../utils/date';
import './ReservationListPage.css';

// 予約一覧用: 「全て」タブを先頭に追加
const STATUS_LABELS = { all: '全て', ...RESERVATION_STATUS_LABELS };

export default function ReservationListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState(searchParams.get('q') || '');
  const [drawer, setDrawer] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [linkGuestTarget, setLinkGuestTarget] = useState(null); // 名寄せ対象の予約
  const { confirm: showConfirm, alert: showAlert } = useConfirm();

  // 初回アクセス時（URLパラメータなし）はCI日を本日に設定
  // 運用時は当日分がデフォルト表示される方がフロントスタッフに使いやすい
  const today = fmt(new Date());
  const isInitialLoad = !searchParams.has('date_from') && !searchParams.has('date_to')
    && !searchParams.has('q') && !searchParams.has('status') && !searchParams.has('channel');
  if (isInitialLoad) {
    searchParams.set('date_from', today);
    searchParams.set('date_to', today);
  }

  // フィルタ状態
  const statusFilter = searchParams.get('status') || '';
  const channelFilter = searchParams.get('channel') || '';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const searchScope = searchParams.get('search_scope') || ''; // 'all' = 全件検索
  const dateType = searchParams.get('date_type') || 'ci'; // 'ci' or 'co'
  const showCancelled = searchParams.get('show_cancelled') === '1';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const sort = searchParams.get('sort') || 'checkin_date';
  const order = searchParams.get('order') || 'desc';

  const updateParam = useCallback((key, value) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      if (value) { p.set(key, value); } else { p.delete(key); }
      if (key !== 'page') p.set('page', '1');
      return p;
    });
  }, [setSearchParams]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('per_page', '15');
      params.set('sort', sort);
      params.set('order', order);
      if (searchParams.get('q')) params.set('q', searchParams.get('q'));
      if (statusFilter) params.set('status', statusFilter);
      if (channelFilter) params.set('channel', channelFilter);
      // 全件検索モードでは日付フィルターを無視（過去の予約をゲスト名等で探す用途）
      if (searchScope !== 'all') {
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);
      }
      if (dateType !== 'ci') params.set('date_type', dateType);
      if (!showCancelled) params.set('hide_cancelled', '1');

      const res = await api.get(`/reservations?${params.toString()}`);
      setData(res);
    } catch { /* エラーは無視 */ }
    setLoading(false);
  }, [page, sort, order, statusFilter, channelFilter, dateFrom, dateTo, dateType, searchScope, showCancelled, searchParams]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSearch = (e) => {
    e.preventDefault();
    updateParam('q', searchText);
  };

  const toggleSort = (key) => {
    if (sort === key) {
      updateParam('order', order === 'asc' ? 'desc' : 'asc');
    } else {
      setSearchParams(prev => {
        const p = new URLSearchParams(prev);
        p.set('sort', key);
        p.set('order', 'desc');
        p.set('page', '1');
        return p;
      });
    }
  };

  const handleRowClick = async (id) => {
    try {
      const res = await api.get(`/reservations/${id}`);
      setDrawer(res);
    } catch { /* エラーは無視 */ }
  };

  const sc = data?.status_counts || {};
  const pagination = data?.pagination || {};

  return (
    <div className="resv">
      {/* 検索バー */}
      <div className="resv__toolbar">
        <form className="resv__search" onSubmit={handleSearch}>
          <span className="material-symbols-outlined resv__search-icon">search</span>
          <input
            className="resv__search-input"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="ゲスト名・予約番号・電話番号で検索"
          />
          <button type="button"
            className={`resv__search-scope ${searchScope === 'all' ? 'resv__search-scope--all' : ''}`}
            onClick={() => updateParam('search_scope', searchScope === 'all' ? '' : 'all')}
            title={searchScope === 'all' ? '全予約から検索中' : '表示期間内で検索中'}
          >
            {searchScope === 'all' ? '全件' : '期間内'}
          </button>
        </form>
        <div className="resv__ota-filters">
          {OTA_CHANNELS.map(ch => (
            <button
              key={ch}
              className={`resv__ota-chip ota-${ch} ${channelFilter.split(',').includes(ch) ? 'resv__ota-chip--active' : ''}`}
              onClick={() => {
                const current = channelFilter ? channelFilter.split(',') : [];
                const next = current.includes(ch)
                  ? current.filter(c => c !== ch)
                  : [...current, ch];
                updateParam('channel', next.join(','));
              }}
            >
              {OTA_LABELS[ch]}
            </button>
          ))}
        </div>

        {/* 日付フィルター */}
        <div className="resv__date-filters">
          <button
            className={`resv__date-today ${dateFrom === fmt(new Date()) ? 'resv__date-today--active' : ''}`}
            onClick={() => {
              const today = fmt(new Date());
              // 本日ボタンのトグル: 既に本日なら解除
              if (dateFrom === today && dateTo === today) {
                setSearchParams(prev => {
                  const p = new URLSearchParams(prev);
                  p.delete('date_from'); p.delete('date_to'); p.set('page', '1');
                  return p;
                });
              } else {
                setSearchParams(prev => {
                  const p = new URLSearchParams(prev);
                  p.set('date_from', today); p.set('date_to', today); p.set('page', '1');
                  return p;
                });
              }
            }}
          >
            <span className="material-symbols-outlined">today</span>本日
          </button>
          <button type="button"
            className={`resv__date-type`}
            onClick={() => updateParam('date_type', dateType === 'ci' ? 'co' : 'ci')}
            title="クリックでCI日/CO日を切替"
          >
            {dateType === 'co' ? 'CO日' : 'CI日'}
          </button>
          <label className="resv__date-label">
            <input type="date" className="resv__date-input" value={dateFrom}
              onChange={(e) => {
                const v = e.target.value;
                // 開始日変更時、終了日が開始日より前なら開始日に揃える
                setSearchParams(prev => {
                  const p = new URLSearchParams(prev);
                  p.set('date_from', v);
                  if (!p.get('date_to') || p.get('date_to') < v) p.set('date_to', v);
                  p.set('page', '1');
                  return p;
                });
              }} />
          </label>
          <span className="resv__date-sep">〜</span>
          <label className="resv__date-label">
            <input type="date" className="resv__date-input" value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => updateParam('date_to', e.target.value)} />
          </label>
          {(dateFrom || dateTo) && (
            <button className="resv__date-clear" onClick={() => {
              setSearchParams(prev => {
                const p = new URLSearchParams(prev);
                p.delete('date_from'); p.delete('date_to'); p.set('page', '1');
                return p;
              });
            }}>
              <span className="material-symbols-outlined">close</span>
            </button>
          )}
        </div>
        {/* 手動予約入力ボタン */}
        <button className="resv__create-btn" onClick={() => navigate('/reservations/new')}>
          <span className="material-symbols-outlined">add</span>
          手動予約入力
        </button>
      </div>

      {/* ステータスチップ */}
      <div className="resv__status-chips">
        {Object.entries(STATUS_LABELS).map(([key, label]) => {
          // キャンセル非表示時は cancelled チップを薄く表示
          const isCancelledHidden = !showCancelled && key === 'cancelled';
          return (
            <button
              key={key}
              className={`resv__status-chip ${(key === 'all' ? !statusFilter : statusFilter === key) ? 'resv__status-chip--active' : ''} ${isCancelledHidden ? 'resv__status-chip--dimmed' : ''}`}
              onClick={() => updateParam('status', key === 'all' ? '' : key)}
            >
              {label}
              <span className="resv__chip-count">{key === 'all' ? sc.all ?? 0 : sc[key] ?? 0}</span>
            </button>
          );
        })}
        <label className="resv__cancel-toggle" title={showCancelled ? 'キャンセル分を非表示にする' : 'キャンセル分を表示する'}>
          <input type="checkbox" checked={showCancelled} onChange={(e) => updateParam('show_cancelled', e.target.checked ? '1' : '')} />
          <span className="resv__cancel-toggle-label">キャンセル表示</span>
        </label>
      </div>

      {/* テーブル */}
      <div className="resv__table-wrap">
        <table className="resv__table">
          <thead>
            <tr>
              <th className="resv__check-col"><input type="checkbox" onChange={(e) => {
                if (e.target.checked) { setSelectedIds(new Set(data?.data?.map(r => r.id) || [])); }
                else { setSelectedIds(new Set()); }
              }} checked={data?.data?.length > 0 && selectedIds.size === data?.data?.length} /></th>
              <SortTh label="CI日" sortKey="checkin_date" current={sort} order={order} onSort={toggleSort} />
              <SortTh label="CO日" sortKey="checkout_date" current={sort} order={order} onSort={toggleSort} />
              <th>泊</th>
              <SortTh label="ゲスト" sortKey="guest_name" current={sort} order={order} onSort={toggleSort} />
              <SortTh label="チャネル" sortKey="channel" current={sort} order={order} onSort={toggleSort} />
              <th>予約番号</th>
              <th>部屋</th>
              <SortTh label="ステータス" sortKey="status" current={sort} order={order} onSort={toggleSort} />
              <SortTh label="金額" sortKey="amount" current={sort} order={order} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="resv__loading">読み込み中...</td></tr>
            ) : data?.data?.length === 0 ? (
              <tr><td colSpan={10} className="resv__empty">該当する予約がありません</td></tr>
            ) : (
              data?.data?.map(r => (
                <tr key={r.id} className={`resv__row ${selectedIds.has(r.id) ? 'resv__row--selected' : ''}`} onClick={() => handleRowClick(r.id)}>
                  <td className="resv__check-col" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedIds.has(r.id)} onChange={(e) => {
                      setSelectedIds(prev => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(r.id); else next.delete(r.id);
                        return next;
                      });
                    }} />
                  </td>
                  <td>{r.checkin_date}</td>
                  <td>{r.checkout_date}</td>
                  <td className="resv__center">{r.nights}</td>
                  <td>
                    <div className="resv__guest">
                      <span className="resv__guest-name">
                        {r.guest_name}
                        {r.is_vip && <span className="resv__vip">VIP</span>}
                        {r.guest_match_status === 'pending' && (
                          <button
                            className="resv__nayose-btn"
                            title="名寄せ（既存ゲストに紐付け）"
                            onClick={(e) => { e.stopPropagation(); setLinkGuestTarget(r); }}
                          >
                            <span className="material-symbols-outlined">person_search</span>
                          </button>
                        )}
                      </span>
                      {r.guest_name_romaji !== r.guest_name && (
                        <span className="resv__guest-sub">{r.guest_name_romaji}</span>
                      )}
                    </div>
                  </td>
                  <td>
                    {r.channel ? (
                      <span className={`resv__ota ota-${r.channel}`}>{OTA_LABELS[r.channel] || r.channel}</span>
                    ) : (
                      <span className="resv__ota resv__ota--merged">統合</span>
                    )}
                  </td>
                  <td className="resv__mono">
                    {r.reservation_no || `#${r.id}`}
                    {/* 複数室予約の子はroom_indexバッジを表示 */}
                    {r.parent_reservation_id && r.room_index && (
                      <span className="resv__room-index" title="グループ管理画面を開く"
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => { e.stopPropagation(); navigate(`/reservations/${r.parent_reservation_id}`); }}>
                        室{r.room_index}
                      </span>
                    )}
                  </td>
                  <td>{r.room_number ? `${r.room_number}` : <span className="resv__unassigned">未割当</span>}</td>
                  <td><span className={`resv__status resv__status--${r.status}`}>{STATUS_LABELS[r.status] || r.status}</span></td>
                  <td className="resv__right">
                    {r.amount.toLocaleString()}
                    {r.unpaid_amount > 0 && <span className="resv__unpaid">未精算</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 選択アクションバー */}
      {selectedIds.size >= 2 && (
        <div className="resv__action-bar">
          <span className="resv__action-count">{selectedIds.size}件選択中</span>
          <button className="resv__action-merge" onClick={async () => {
            // 選択された予約の情報を取得して確認ダイアログに表示
            const selected = data?.data?.filter(r => selectedIds.has(r.id)) || [];
            // cancelled/checked_out を含む場合は警告
            const invalidItems = selected.filter(r => ['cancelled', 'checked_out', 'no_show', 'merged'].includes(r.status));
            if (invalidItems.length > 0) {
              showAlert('統合不可', `キャンセル済み・CO済みの予約が含まれています（${invalidItems.map(r => r.reservation_no).join(', ')}）`);
              return;
            }
            // CI日でソート
            const sorted = [...selected].sort((a, b) => a.checkin_date.localeCompare(b.checkin_date));
            const parent = sorted[0];
            const children = sorted.slice(1);
            const totalAmount = sorted.reduce((sum, r) => sum + r.amount, 0);
            const lastItem = sorted[sorted.length - 1];

            const detail = [
              `【統合対象】`,
              ...sorted.map(r => `  ${r.reservation_no}  ${r.checkin_date}〜${r.checkout_date}  ${r.amount.toLocaleString()}円`),
              ``,
              `【統合後】`,
              `  親予約: ${parent.reservation_no}`,
              `  日程: ${parent.checkin_date}〜${lastItem.checkout_date}`,
              `  合計金額: ${totalAmount.toLocaleString()}円`,
              ``,
              `※ ${children.map(r => r.reservation_no).join(', ')} は統合されて非表示になります`,
            ].join('\n');

            if (!await showConfirm('予約の統合', detail)) return;
            try {
              const res = await api.post('/reservations/merge', { reservation_ids: Array.from(selectedIds) });
              setSelectedIds(new Set());
              fetchData();
              showAlert('統合完了', `${res.nights}泊の予約に統合しました（合計 ${res.amount.toLocaleString()}円）`);
            } catch (err) { showAlert('エラー', err.message); }
          }}>
            <span className="material-symbols-outlined">merge</span> 選択した予約を統合
          </button>
          <button className="resv__action-clear" onClick={() => setSelectedIds(new Set())}>選択解除</button>
        </div>
      )}

      {/* ページネーション */}
      {pagination.total_pages > 1 && (
        <div className="resv__pagination">
          <button
            disabled={page <= 1}
            onClick={() => updateParam('page', String(page - 1))}
            className="resv__page-btn"
          >
            <span className="material-symbols-outlined">chevron_left</span>
          </button>
          <span className="resv__page-info">{page} / {pagination.total_pages}</span>
          <button
            disabled={page >= pagination.total_pages}
            onClick={() => updateParam('page', String(page + 1))}
            className="resv__page-btn"
          >
            <span className="material-symbols-outlined">chevron_right</span>
          </button>
        </div>
      )}

      {/* 名寄せダイアログ（予約一覧から直接ゲスト紐付け） */}
      {linkGuestTarget && (
        <LinkGuestFromListDialog
          reservation={linkGuestTarget}
          onLinked={() => { setLinkGuestTarget(null); fetchData(); }}
          onCancel={() => setLinkGuestTarget(null)}
        />
      )}

      {/* 詳細ドロワー */}
      {drawer && (
        <ReservationDrawer data={drawer} onClose={() => setDrawer(null)} />
      )}
    </div>
  );
}

function SortTh({ label, sortKey, current, order, onSort }) {
  const active = current === sortKey;
  return (
    <th className="resv__sortable" onClick={() => onSort(sortKey)}>
      {label}
      {active && (
        <span className="material-symbols-outlined resv__sort-icon">
          {order === 'asc' ? 'arrow_upward' : 'arrow_downward'}
        </span>
      )}
    </th>
  );
}

/**
 * 予約一覧から直接ゲスト紐付けするダイアログ
 * 新規予約が入ってきた時にリピーターを既存ゲストに素早く紐付けるための操作
 */
function LinkGuestFromListDialog({ reservation, onLinked, onCancel }) {
  const { alert: showAlert } = useConfirm();
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [searching, setSearching] = useState(false);

  // 初回表示時にguest_idから自動検索（名前・電話番号で類似ゲストを表示）
  useEffect(() => {
    if (reservation.guest_id) {
      api.get(`/guests/match?guest_id=${reservation.guest_id}`)
        .then(res => setCandidates(res.candidates || []))
        .catch(() => {});
    }
  }, [reservation.guest_id]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await api.get(`/guests/match?q=${encodeURIComponent(query.trim())}`);
      setCandidates(res.candidates || []);
    } catch { /* ignore */ }
    setSearching(false);
  };

  const handleLink = async (guestId) => {
    try {
      await api.post(`/reservations/${reservation.id}/link-guest`, { guest_id: guestId });
      onLinked();
    } catch (err) {
      showAlert('エラー', err.message);
    }
  };

  return (
    <>
      <div className="resv__overlay" onClick={onCancel} />
      <div className="resv__nayose-dialog">
        <h2 className="resv__nayose-title">ゲスト紐付け（名寄せ）</h2>
        <p className="resv__nayose-sub">
          予約 <strong>{reservation.reservation_no}</strong> ({reservation.checkin_date}〜{reservation.checkout_date})<br />
          現在のゲスト: <strong>{reservation.guest_name}</strong>
        </p>

        <div className="resv__nayose-search">
          <input
            type="text"
            className="resv__nayose-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="ゲスト名・電話番号で検索"
            autoFocus
          />
          <button className="resv__nayose-search-btn" onClick={handleSearch} disabled={searching}>
            {searching ? '...' : '検索'}
          </button>
        </div>

        <div className="resv__nayose-results">
          {candidates.length === 0 ? (
            <p className="resv__nayose-empty">候補が見つかりません</p>
          ) : (
            candidates.map(c => (
              <button key={c.id} className="resv__nayose-item" onClick={() => handleLink(c.id)}>
                <div className="resv__nayose-item-name">
                  <span>{c.name}</span>
                  <span className="resv__nayose-item-code">{c.guest_code}</span>
                  {c.is_vip && <span className="resv__vip">VIP</span>}
                </div>
                <div className="resv__nayose-item-detail">
                  {c.name_kana && c.name_kana !== c.name && <span>{c.name_kana}</span>}
                  {c.name_romaji && c.name_romaji !== c.name && <span>{c.name_romaji}</span>}
                  {c.phone && <span>{c.phone}</span>}
                </div>
                <div className="resv__nayose-item-meta">
                  <span>予約{c.reservation_count}件</span>
                  {c.stay_count > 0 && <span>来館{c.stay_count}回</span>}
                  {c.last_stay_date && <span>最終: {c.last_stay_date}</span>}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="resv__nayose-actions">
          <button className="resv__nayose-close" onClick={onCancel}>閉じる</button>
        </div>
      </div>
    </>
  );
}

function ReservationDrawer({ data, onClose }) {
  const d = data;
  const navigate = useNavigate();
  const guestName = d.guest_name || `${d.tl_last_name} ${d.tl_first_name}`;

  return (
    <>
      <div className="drawer__overlay" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer__header">
          <h2 className="drawer__title">予約サマリー</h2>
          <button className="drawer__close" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="drawer__body">
          <div className="drawer__section">
            <div className="drawer__row">
              <span className="drawer__label">ゲスト</span>
              <span className="drawer__value">{guestName}</span>
            </div>
            <div className="drawer__row">
              <span className="drawer__label">予約番号</span>
              <span className="drawer__value">{d.reservation_no || `#${d.id}`}</span>
            </div>
            <div className="drawer__row">
              <span className="drawer__label">チャネル</span>
              {d.channel ? (
                <span className={`resv__ota ota-${d.channel}`}>{OTA_LABELS[d.channel] || d.channel}</span>
              ) : (
                <span className="resv__ota resv__ota--merged">統合</span>
              )}
            </div>
            <div className="drawer__row">
              <span className="drawer__label">日程</span>
              <span className="drawer__value">{d.checkin_date} ~ {d.checkout_date} ({d.nights}泊)</span>
            </div>
            <div className="drawer__row">
              <span className="drawer__label">部屋タイプ</span>
              <span className="drawer__value">{d.room_type_name || d.room_type}</span>
            </div>
            <div className="drawer__row">
              <span className="drawer__label">人数</span>
              <span className="drawer__value">大人{d.adult_count}名{d.child_count > 0 ? ` / 子供${d.child_count}名` : ''}</span>
            </div>
            {(d.male_count > 0 || d.female_count > 0 || d.child_a_count > 0 || d.child_b_count > 0 || d.child_c_count > 0 || d.child_d_count > 0) && (
              <div className="drawer__row">
                <span className="drawer__label">内訳</span>
                <span className="drawer__value drawer__pax-breakdown">
                  {d.male_count > 0 && <span className="drawer__pax-tag drawer__pax-tag--male">男性{d.male_count}</span>}
                  {d.female_count > 0 && <span className="drawer__pax-tag drawer__pax-tag--female">女性{d.female_count}</span>}
                  {d.child_a_count > 0 && <span className="drawer__pax-tag drawer__pax-tag--child">子A{d.child_a_count}</span>}
                  {d.child_b_count > 0 && <span className="drawer__pax-tag drawer__pax-tag--child">子B{d.child_b_count}</span>}
                  {d.child_c_count > 0 && <span className="drawer__pax-tag drawer__pax-tag--child">子C{d.child_c_count}</span>}
                  {d.child_d_count > 0 && <span className="drawer__pax-tag drawer__pax-tag--child">子D{d.child_d_count}</span>}
                </span>
              </div>
            )}
            <div className="drawer__row">
              <span className="drawer__label">金額</span>
              <span className="drawer__value">
                {Number(d.amount).toLocaleString()}円
                {(() => {
                  const charges = d.charges || [];
                  const sales = charges.filter(c => c.status === 'active' && !['payment','refund'].includes(c.charge_type)).reduce((s,c) => s + Number(c.amount), 0);
                  const paid = charges.filter(c => c.status === 'active' && c.charge_type === 'payment').reduce((s,c) => s + Number(c.amount), 0);
                  const bal = sales - paid;
                  return bal > 0 ? <span className="resv__unpaid">未精算 {bal.toLocaleString()}円</span> : null;
                })()}
              </span>
            </div>
            <div className="drawer__row">
              <span className="drawer__label">ステータス</span>
              <span className={`resv__status resv__status--${d.status}`}>{STATUS_LABELS[d.status] || d.status}</span>
            </div>
            {d.reservation_notes && (
              <div className="drawer__row">
                <span className="drawer__label">メモ</span>
                <span className="drawer__value">{d.reservation_notes}</span>
              </div>
            )}
          </div>

          {/* 複数室予約: 兄弟予約セクション */}
          {d.is_multi_room_child && d.child_reservations?.length > 0 && (
            <div className="drawer__section">
              <h3 className="drawer__section-title">
                グループ予約（{d.child_reservations.length}室）
              </h3>
              {d.child_reservations.map(sibling => (
                <div
                  key={sibling.id}
                  className={`drawer__sibling ${sibling.id === d.id ? 'drawer__sibling--current' : ''}`}
                  onClick={() => sibling.id !== d.id && navigate(`/reservations/${sibling.id}`)}
                >
                  <span className="drawer__sibling-index">室{sibling.room_index}</span>
                  <span className="drawer__sibling-type">{sibling.room_type || '—'}</span>
                  <span className="drawer__sibling-room">{sibling.assigned_room ? `${sibling.assigned_room}号室` : '未割当'}</span>
                  <span className={`resv__status resv__status--${sibling.status}`}>
                    {STATUS_LABELS[sibling.status] || sibling.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          {d.assignments?.length > 0 && (
            <div className="drawer__section">
              <h3 className="drawer__section-title">アサイン</h3>
              {d.assignments.map(a => (
                <div key={a.id} className="drawer__row">
                  <span className="drawer__label">{a.room_number}</span>
                  <span className="drawer__value">{a.check_in_date} ~ {a.check_out_date} ({a.status})</span>
                </div>
              ))}
            </div>
          )}

          {d.charges?.length > 0 && (
            <div className="drawer__section">
              <h3 className="drawer__section-title">売上明細</h3>
              {d.charges.filter(c => c.status === 'active').map(c => (
                <div key={c.id} className="drawer__row">
                  <span className="drawer__label">{c.date}</span>
                  <span className="drawer__value">{c.description} — {Number(c.amount).toLocaleString()}円</span>
                </div>
              ))}
            </div>
          )}

          {/* タイムライン: OTA通知日時順にイベント履歴を表示 */}
          {d.events?.length > 0 && (
            <div className="drawer__section">
              <h3 className="drawer__section-title">タイムライン</h3>
              <div className="drawer__timeline">
                {d.events.map((ev, i) => (
                  <div key={ev.id || i} className={`drawer__timeline-item drawer__timeline-item--${ev.event_type}`}>
                    <div className="drawer__timeline-dot" />
                    {i < d.events.length - 1 && <div className="drawer__timeline-line" />}
                    <div className="drawer__timeline-content">
                      <span className="drawer__timeline-summary">{
                        { tl_new: '新規予約', tl_modify: '予約変更', tl_cancel: '予約取消' }[ev.event_type] || ev.summary
                      }</span>
                      <span className="drawer__timeline-time">{fmtDateTime(ev.event_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        <div className="drawer__footer">
          <button className="drawer__detail-btn" onClick={() => { onClose(); navigate(`/reservations/${d.id}`); }}>
            予約詳細を開く
            <span className="material-symbols-outlined">open_in_new</span>
          </button>
        </div>
      </aside>
    </>
  );
}
