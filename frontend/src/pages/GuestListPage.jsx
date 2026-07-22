import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import './GuestListPage.css';

/**
 * 顧客一覧ページ
 * - ReservationListPageと同じパターンでURLSearchParams管理・ページネーション・ソートを実装
 * - 検索は名前・カナ・電話番号・顧客コードを1つの入力欄で統合検索する
 */
export default function GuestListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // 検索テキストはURLのqパラメータと同期させる（初期値はURLから取得）
  const [searchText, setSearchText] = useState(searchParams.get('q') || '');

  // URLSearchParamsからソート・ページ状態を取得
  const page = parseInt(searchParams.get('page') || '1', 10);
  const sort = searchParams.get('sort') || 'guest_code';
  const order = searchParams.get('order') || 'asc';

  /**
   * URLパラメータを更新するヘルパー
   * ページ以外のパラメータ変更時はページを1にリセットする
   * （フィルタ変更後に存在しないページを表示しないため）
   */
  const updateParam = useCallback((key, value) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      if (value) { p.set(key, value); } else { p.delete(key); }
      if (key !== 'page') p.set('page', '1');
      return p;
    });
  }, [setSearchParams]);

  /**
   * APIから顧客一覧を取得
   * ソート・ページ・検索クエリの変更で再取得される
   */
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('per_page', '20');
      params.set('sort', sort);
      params.set('order', order);
      if (searchParams.get('q')) params.set('q', searchParams.get('q'));

      const res = await api.get(`/guests?${params.toString()}`);
      setData(res);
    } catch {
      // APIエラー時は何も表示しない（ローディングを解除するのみ）
    }
    setLoading(false);
  }, [page, sort, order, searchParams]);

  useEffect(() => { fetchData(); }, [fetchData]);

  /** フォーム送信で検索実行（Enterキー対応） */
  const handleSearch = (e) => {
    e.preventDefault();
    updateParam('q', searchText);
  };

  /**
   * ソートトグル
   * 同じカラムをクリック → asc/desc切替
   * 別のカラムをクリック → そのカラムでdescソート
   */
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

  /** 行クリックで顧客詳細ページへ遷移 */
  const handleRowClick = (id) => {
    navigate(`/guests/${id}`);
  };

  const pagination = data?.pagination || {};

  return (
    <div className="guest">
      {/* ヘッダー: 検索バー + 新規登録ボタン */}
      <div className="guest__toolbar">
        <form className="guest__search" onSubmit={handleSearch}>
          <span className="material-symbols-outlined guest__search-icon">search</span>
          <input
            className="guest__search-input"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="名前・カナ・電話番号・顧客コードで検索"
          />
        </form>
        <button
          className="guest__add-btn"
          onClick={() => navigate('/guests/new')}
        >
          <span className="material-symbols-outlined">person_add</span>
          新規登録
        </button>
      </div>

      {/* テーブル */}
      <div className="guest__table-wrap">
        <table className="guest__table">
          <thead>
            <tr>
              <SortTh label="顧客コード" sortKey="guest_code" current={sort} order={order} onSort={toggleSort} />
              <SortTh label="名前" sortKey="name" current={sort} order={order} onSort={toggleSort} />
              <th>電話番号</th>
              <SortTh label="宿泊回数" sortKey="stay_count" current={sort} order={order} onSort={toggleSort} />
              <SortTh label="最終宿泊日" sortKey="last_stay_date" current={sort} order={order} onSort={toggleSort} />
              <th>VIP</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="guest__loading">読み込み中...</td></tr>
            ) : data?.data?.length === 0 ? (
              <tr><td colSpan={6} className="guest__empty">該当する顧客がいません</td></tr>
            ) : (
              data?.data?.map(g => (
                <tr
                  key={g.id}
                  className="guest__row"
                  onClick={() => handleRowClick(g.id)}
                >
                  {/* 顧客コード: モノスペースで見やすく */}
                  <td className="guest__mono">{g.guest_code}</td>
                  {/* 名前: 漢字/ローマ字の2段表示で日本人・外国人ゲストの両方に対応 */}
                  <td>
                    <div className="guest__name">
                      <span className="guest__name-main">{g.name}</span>
                      {g.name_romaji && g.name_romaji !== g.name && (
                        <span className="guest__name-sub">{g.name_romaji}</span>
                      )}
                    </div>
                  </td>
                  <td>{g.phone || <span className="guest__no-data">-</span>}</td>
                  {/* 宿泊回数: 右寄せ・tabular-numsで数字を揃える */}
                  <td className="guest__right">{g.stay_count ?? 0}</td>
                  <td>{g.last_stay_date || <span className="guest__no-data">-</span>}</td>
                  {/* VIPバッジ: 星アイコン+黄色背景で視認性を確保 */}
                  <td className="guest__center">
                    {g.is_vip && <span className="guest__vip-badge">⭐ VIP</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ページネーション: ReservationListPageと同じパターン */}
      {pagination.total_pages > 1 && (
        <div className="guest__pagination">
          <button
            disabled={page <= 1}
            onClick={() => updateParam('page', String(page - 1))}
            className="guest__page-btn"
          >
            <span className="material-symbols-outlined">chevron_left</span>
          </button>
          <span className="guest__page-info">{page} / {pagination.total_pages}</span>
          <button
            disabled={page >= pagination.total_pages}
            onClick={() => updateParam('page', String(page + 1))}
            className="guest__page-btn"
          >
            <span className="material-symbols-outlined">chevron_right</span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * ソート可能なテーブルヘッダー
 * ReservationListPageのSortThと同じ実装パターン
 * アクティブなソートカラムには矢印アイコンを表示する
 */
function SortTh({ label, sortKey, current, order, onSort }) {
  const active = current === sortKey;
  return (
    <th className="guest__sortable" onClick={() => onSort(sortKey)}>
      {label}
      {active && (
        <span className="material-symbols-outlined guest__sort-icon">
          {order === 'asc' ? 'arrow_upward' : 'arrow_downward'}
        </span>
      )}
    </th>
  );
}
