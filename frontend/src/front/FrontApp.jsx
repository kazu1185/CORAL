import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import PinChangeDialog from '../components/PinChangeDialog';
import { FrontDataProvider } from './FrontDataContext';
import FrontLayout from './FrontLayout';
import TodayBoardPage from './TodayBoardPage';
import FrontCheckinPage from './FrontCheckinPage';
import FrontCheckoutPage from './FrontCheckoutPage';
import FrontLoginPinPad from './FrontLoginPinPad';
import FrontPlaceholder from './FrontPlaceholder';

/**
 * フロントモードのエントリ（/front 配下）。
 * - 未認証: 大型PINパッドログイン（既存のスタッフ+PIN認証を使用）
 * - 認証済み: FrontLayout（ヘッダー/タブ）＋各タブ
 *
 * 既存の PC 用 Layout/Sidebar/ProtectedRoute とは分離した専用シェル。
 */
export default function FrontApp() {
  const { isAuthenticated, staff, logout } = useAuth();

  // フロントモード表示中は body にクラスを付け、共通ダイアログをタブレット用に拡大する（仕様書 §5）
  useEffect(() => {
    document.body.classList.add('front-mode');
    return () => document.body.classList.remove('front-mode');
  }, []);

  if (!isAuthenticated) {
    return <FrontLoginPinPad />;
  }

  // 初回PIN変更が必要なスタッフはボードに入れず、変更を強制する。
  // 変更後は新PINで入り直させる（AuthContextのstaffは再ログインで最新化される）。
  if (staff?.must_change_pin) {
    return (
      <div className="fpin">
        <PinChangeDialog onComplete={logout} onCancel={logout} />
      </div>
    );
  }

  return (
    <FrontDataProvider>
      <Routes>
        <Route element={<FrontLayout />}>
          <Route index element={<Navigate to="checkin" replace />} />
          <Route path="checkin" element={<TodayBoardPage mode="checkin" />} />
          <Route path="checkout" element={<TodayBoardPage mode="checkout" />} />
          {/* CI確認(Phase 2)・CO精算(Phase 3)。 */}
          <Route path="checkin/:id" element={<FrontCheckinPage />} />
          <Route path="checkout/:id" element={<FrontCheckoutPage />} />
          {/* 追加機能タブは Phase 4 で実装 */}
          <Route path="pos" element={<FrontPlaceholder title="物販（即売POS）" phase={4} />} />
          <Route path="rooms" element={<FrontPlaceholder title="部屋状況" phase={4} />} />
          <Route path="*" element={<Navigate to="/front/checkin" replace />} />
        </Route>
      </Routes>
    </FrontDataProvider>
  );
}
