import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';

/**
 * フロントモードの本日ボードデータを一元管理するコンテキスト。
 *
 * ヘッダーのタブ残件バッジ（FrontLayout）と本日ボード（TodayBoardPage）が
 * 同じ /dashboard/front-board を参照するため、二重フェッチを避けてここで1回だけ取得・配布する。
 * ポーリングは規約 #11（usePolling + fetchData 併用）に従う。
 */
const FrontDataContext = createContext(null);

const POLL_MS = 8000; // 5〜10秒（計画書 §3.2）

export function FrontDataProvider({ children }) {
  const [summary, setSummary] = useState(null);
  const [checkinList, setCheckinList] = useState([]);
  const [checkoutList, setCheckoutList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadedOnce = useRef(false);

  // 詳細画面・入力中はポーリングを止めて画面の上書きを防ぐ（仕様書 §7 / 計画書リスク5）
  const [pollEnabled, setPollEnabled] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const data = await api.get('/dashboard/front-board');
      setSummary(data.summary || null);
      setCheckinList(data.checkin_list || []);
      setCheckoutList(data.checkout_list || []);
      setError('');
    } catch (e) {
      // ポーリング中の一時的な失敗で画面を暗転させない。初回のみエラー表示する
      if (!loadedOnce.current) setError('本日ボードの取得に失敗しました');
    } finally {
      loadedOnce.current = true;
      setLoading(false);
    }
  }, []);

  usePolling(fetchData, pollEnabled ? POLL_MS : 0, pollEnabled);

  // ポーリング再開時に即時1回取得（規約 #11: usePollingはinterval/enabled依存のため）
  useEffect(() => {
    if (pollEnabled) fetchData();
  }, [pollEnabled, fetchData]);

  const value = {
    summary, checkinList, checkoutList, loading, error,
    refetch: fetchData,
    setPollEnabled, // 詳細画面がマウント中に false にしてポーリングを止める（Phase 2/3で使用）
  };

  return <FrontDataContext.Provider value={value}>{children}</FrontDataContext.Provider>;
}

export function useFrontData() {
  const ctx = useContext(FrontDataContext);
  if (!ctx) throw new Error('useFrontData は FrontDataProvider 内で使用してください');
  return ctx;
}
