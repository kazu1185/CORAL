import { useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useConfirm } from '../components/ConfirmDialog';
import { useFrontData } from './FrontDataContext';
import './FrontLayout.css';

/** ヘッダーの時計（1分ごと更新） — new Date は表示専用なので規約 #2 の対象外（DBに渡さない） */
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  const w = ['日', '月', '火', '水', '木', '金', '土'][now.getDay()];
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${now.getMonth() + 1}月${now.getDate()}日（${w}） ${hh}:${mm}`;
}

const TABS = [
  { to: '/front/checkin',  icon: '🔑', label: '本日のチェックイン',   badge: 'checkin' },
  { to: '/front/checkout', icon: '🧳', label: '本日のチェックアウト', badge: 'checkout' },
  { to: '/front/pos',      icon: '🛍', label: '物販',                 badge: null },
  { to: '/front/rooms',    icon: '🚪', label: '部屋状況',             badge: null },
];

/**
 * フロントモードの骨格レイアウト — 仕様書 §3 / mock #scr-app
 * ヘッダー（56px）＋タブバー（64px）＋スクロールするコンテンツ。100dvh＋セーフエリア。
 * 既存 Layout/Sidebar は使わない（サイドバー無し）。
 */
export default function FrontLayout() {
  const clock = useClock();
  const { staff, logout } = useAuth();
  const { summary } = useFrontData();
  const { confirm: showConfirm } = useConfirm();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const staffRef = useRef(null);

  // スタッフチップのメニュー: 外側タップで閉じる（Phase 0 で pointerdown 化した作法に合わせる）
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => { if (staffRef.current && !staffRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [menuOpen]);

  // タブの残件バッジ = 本日件数 − 完了件数（0件なら非表示）
  const remaining = (kind) => {
    if (!summary) return 0;
    if (kind === 'checkin') return Math.max(0, (summary.checkin_today || 0) - (summary.checkin_done || 0));
    if (kind === 'checkout') return Math.max(0, (summary.checkout_today || 0) - (summary.checkout_done || 0));
    return 0;
  };

  const handleLogout = async () => {
    setMenuOpen(false);
    if (await showConfirm('ログアウト', `${staff?.staff_name || 'スタッフ'} をログアウトしますか？`)) {
      logout();
    }
  };

  return (
    <div className="fl">
      <header className="fl__header">
        <div className="fl__brand">
          <img src="/coral-icon-dark.svg?v=2" alt="CORAL PMS" className="fl__coral" />
          <span className="fl__brandname">CORAL PMS</span>
        </div>
        <div className="fl__clock">{clock}</div>
        <div className="fl__staffwrap" ref={staffRef}>
          <button type="button" className="fl__staff" onClick={() => setMenuOpen(o => !o)}>
            <span className="fl__staff-ic">👤</span>{staff?.staff_name || 'スタッフ'}
          </button>
          {menuOpen && (
            <div className="fl__menu">
              <button type="button" className="fl__menu-item" onClick={handleLogout}>ログアウト</button>
            </div>
          )}
        </div>
        {/* 管理画面への脱出口（目立たせない） */}
        <button type="button" className="fl__admin" onClick={() => navigate('/dashboard')}>管理画面 ↗</button>
      </header>

      <nav className="fl__tabbar">
        {TABS.map(t => {
          const n = t.badge ? remaining(t.badge) : 0;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) => `fl__tab ${isActive ? 'is-active' : ''}`}
            >
              <span className="fl__tab-ic">{t.icon}</span>
              <span className="fl__tab-label">{t.label}</span>
              {n > 0 && <span className="fl__tab-badge">{n}</span>}
            </NavLink>
          );
        })}
      </nav>

      <main className="fl__content">
        <div className="fl__inner">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
