import { useEffect } from 'react';
import './SuccessOverlay.css';

/**
 * 成功オーバーレイ（仕様書 §5 / mock #successov）
 * 全画面に ✓ を出して 800ms で自動クローズ。CI/CO/会計の成功演出で共用。
 * prefers-reduced-motion 時はポップアニメを無効化（CSS側で対応）。
 *
 * props:
 *   show  … 表示フラグ
 *   text  … 完了文言（例「チェックインが完了しました」）
 *   onDone … 800ms後に呼ばれる（本日ボードへ戻す等）
 */
export default function SuccessOverlay({ show, text, onDone }) {
  useEffect(() => {
    if (!show) return;
    const id = setTimeout(() => { onDone && onDone(); }, 800);
    return () => clearTimeout(id);
  }, [show, onDone]);

  if (!show) return null;
  return (
    <div className="fov" role="status" aria-live="polite">
      <div className="fov__mark">✓</div>
      <div className="fov__text">{text}</div>
    </div>
  );
}
