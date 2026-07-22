import { useEffect, useRef } from 'react';

/**
 * ポーリング用カスタムフック
 * @param {Function} callback - 定期的に実行する関数
 * @param {number} interval - 間隔（ミリ秒）
 * @param {boolean} enabled - ポーリングの有効/無効（デフォルトtrue）
 */
export function usePolling(callback, interval, enabled = true) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || interval <= 0) return;

    // 初回即時実行
    savedCallback.current();

    const id = setInterval(() => {
      savedCallback.current();
    }, interval);

    return () => clearInterval(id);
  }, [interval, enabled]);
}
