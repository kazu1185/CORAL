import { NavLink } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useState, useEffect } from 'react';
import './Sidebar.css';

const MENU_ITEMS = [
  { path: '/dashboard',      label: 'ダッシュボード',       icon: 'grid_view',     permission: null },
  // iPad対面カウンター用フロントモードへの入口（PWA/ブックマークで直接 /front 起動も可）
  { path: '/front',          label: 'フロントモード',       icon: 'tablet_mac',    permission: null },
  { path: '/reservations',   label: '予約一覧',             icon: 'event_note',    permission: 'reservation.view' },
  { path: '/assign-board',   label: 'アサインボード',       icon: 'calendar_month', permission: 'assign.edit' },
  { path: '/room-indicator', label: 'ルームインジケーター', icon: 'door_front',    permission: 'reservation.view' },
  { path: '/room-inventory', label: '在庫カレンダー',       icon: 'event_available', permission: 'reservation.view' },
  { path: '/guests',         label: '顧客管理',             icon: 'person_search', permission: 'guest.edit' },
  { path: '/housekeeping',   label: '清掃管理',             icon: 'cleaning_services', permission: 'housekeeping.view' },
  { path: '/product-sales',  label: '物販',                 icon: 'local_mall',    permission: 'product_sales.view' },
  { path: '/reports',        label: '売上レポート',         icon: 'bar_chart',     permission: 'report.view' },
  { path: '/settings',       label: '設定',                 icon: 'settings',      permission: null, settingsGroup: true },
];

const SETTINGS_PERMISSIONS = [
  'master.rooms', 'master.plans', 'master.tax', 'master.corporate', 'master.products',
  'staff.manage', 'staff.pin_reset', 'system.session_config', 'system.permissions',
];

export default function Sidebar() {
  const { hasPermission, hasAnyPermission } = useAuth();
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('pms_sidebar_collapsed') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('pms_sidebar_collapsed', collapsed);
  }, [collapsed]);

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <div className="sidebar__logo">
        {/* ライトシェル化（2026-07 UI刷新）に伴い、白抜きロゴから墨色ロゴに差し替え */}
        {/* ?v= はCloudflareエッジキャッシュ対策（規約#23）。public/直下のSVGを差し替えたら番号を上げること */}
        {!collapsed && <img src="/coral-logo-dark.svg?v=2" alt="CORAL" className="sidebar__logo-img" />}
        {collapsed && <img src="/coral-icon-dark.svg?v=2" alt="CORAL" className="sidebar__logo-icon-img" />}
      </div>

      <nav className="sidebar__nav">
        {MENU_ITEMS.map(item => {
          const hasAccess = item.settingsGroup
            ? hasAnyPermission(SETTINGS_PERMISSIONS)
            : item.permission === null || hasPermission(item.permission);

          return (
            <NavLink
              key={item.path}
              to={hasAccess ? item.path : '#'}
              className={({ isActive }) =>
                `sidebar__item ${isActive && hasAccess ? 'sidebar__item--active' : ''} ${!hasAccess ? 'sidebar__item--locked' : ''}`
              }
              onClick={(e) => { if (!hasAccess) e.preventDefault(); }}
            >
              <span className="material-symbols-outlined sidebar__icon">{item.icon}</span>
              {!collapsed && (
                <span className="sidebar__label">
                  {item.label}
                  {!hasAccess && <span className="sidebar__lock material-symbols-outlined">lock</span>}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <button
        className="sidebar__toggle"
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? '展開' : '折りたたむ'}
      >
        <span className="material-symbols-outlined">
          {collapsed ? 'chevron_right' : 'chevron_left'}
        </span>
      </button>
    </aside>
  );
}
