import { useNavigate } from 'react-router-dom';
import './FrontPlaceholder.css';

/**
 * フロントモードの未実装画面プレースホルダ。
 * Phase 1 ではタブ枠・遷移導線を先に用意し、中身は後続フェーズで差し替える。
 * （POS/部屋状況=Phase 4、CI確認=Phase 2、CO精算=Phase 3）
 */
export default function FrontPlaceholder({ title, phase, back }) {
  const navigate = useNavigate();
  return (
    <div className="fph">
      {back && (
        <button type="button" className="fph__back" onClick={() => navigate(back)} aria-label="戻る">←</button>
      )}
      <img src="/coral-icon-dark.svg?v=2" alt="" className="fph__ic" />
      <div className="fph__title">{title}</div>
      <div className="fph__note">この画面は Phase {phase} で実装します</div>
    </div>
  );
}
