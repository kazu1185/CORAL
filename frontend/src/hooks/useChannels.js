import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

/**
 * チャネルマスタ取得フック
 *
 * channelsテーブルのデータをAPIから取得し、キャッシュする。
 * 各ページでOTAラベル・色情報を動的に参照するために使用。
 *
 * 戻り値:
 *   channels    — 全チャネル配列（sort_order順）
 *   channelMap  — { code: { name, color, type } } のマップ
 *   otaChannels — OTAチャネルのcode配列（フィルタ用）
 *   manualChannels — 手動チャネルの配列（予約入力用）
 *   loading     — 読み込み中フラグ
 *   refresh     — 手動再読み込み
 */

// モジュールレベルキャッシュ（全コンポーネントで共有、ページ遷移で消えない）
let cachedChannels = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5分

export default function useChannels() {
  const [channels, setChannels] = useState(cachedChannels || []);
  const [loading, setLoading] = useState(!cachedChannels);

  const fetchChannels = useCallback(async (force = false) => {
    // キャッシュが有効ならスキップ
    if (!force && cachedChannels && Date.now() - cacheTimestamp < CACHE_TTL) {
      setChannels(cachedChannels);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const res = await api.get('/master/channels');
      cachedChannels = res.channels || [];
      cacheTimestamp = Date.now();
      setChannels(cachedChannels);
    } catch {
      // エラー時はキャッシュがあればそれを使う
      if (cachedChannels) setChannels(cachedChannels);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  // channelMap: { jalan: { name: 'じゃらん', color: '#DC2626', type: 'ota' }, ... }
  const channelMap = {};
  channels.forEach(ch => {
    channelMap[ch.channel_code] = {
      name: ch.channel_name,
      color: ch.color,
      type: ch.channel_type,
    };
  });

  // OTAチャネルのcode一覧（フィルタ用）
  const otaChannels = channels
    .filter(ch => ch.channel_type === 'ota' && ch.channel_code !== 'other')
    .map(ch => ch.channel_code);

  // 手動チャネル（予約入力画面用）
  const manualChannels = channels
    .filter(ch => ch.channel_type === 'manual')
    .map(ch => ({ value: ch.channel_code, label: ch.channel_name, color: ch.color }));

  // 全チャネルcode一覧（OTAフィルタ用、other除く）
  const allChannelCodes = channels
    .filter(ch => ch.channel_code !== 'other')
    .map(ch => ch.channel_code);

  return {
    channels,
    channelMap,
    otaChannels,
    manualChannels,
    allChannelCodes,
    loading,
    refresh: () => fetchChannels(true),
  };
}
