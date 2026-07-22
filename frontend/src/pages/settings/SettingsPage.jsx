import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import HotelInfoSettings from './HotelInfoSettings';
import SystemSettings from './SystemSettings';
import PaymentMethodSettings from './PaymentMethodSettings';
import RoomTypeSettings from './RoomTypeSettings';
import RoomSettings from './RoomSettings';
import PlanSettings from './PlanSettings';
import ProductSettings from './ProductSettings';
import CorporateSettings from './CorporateSettings';
import StaffSettings from './StaffSettings';
import PermissionSettings from './PermissionSettings';
import TaxRuleSettings from './TaxRuleSettings';
import ChannelSettings from './ChannelSettings';
import './SettingsPage.css';

/**
 * 設定画面シェル
 * 左メニュー + 右側にサブページを表示
 * メニュー項目は権限に基づいて表示/非表示を制御
 */

const MENU_SECTIONS = [
  {
    title: 'マスタ管理',
    items: [
      { path: 'room-types', label: '部屋タイプ',   icon: 'bed',              permission: 'master.rooms' },
      { path: 'rooms',      label: '部屋',         icon: 'meeting_room',     permission: 'master.rooms' },
      { path: 'plans',      label: 'プラン',       icon: 'restaurant_menu',  permission: 'master.plans' },
      { path: 'tax-rules',  label: '宿泊税ルール', icon: 'receipt_long',     permission: 'master.tax' },
      { path: 'corporates', label: '法人',         icon: 'business',         permission: 'master.corporate' },
      { path: 'payments',   label: '決済方法',     icon: 'payments',         permission: 'master.plans' },
      { path: 'products',   label: '商品',         icon: 'local_mall',       permission: 'master.products' },
      { path: 'channels',  label: 'チャネル',     icon: 'language',         permission: 'system.session_config' },
    ],
  },
  {
    title: '運用管理',
    items: [
      { path: 'staff',       label: 'スタッフ管理', icon: 'group',         permission: 'staff.manage' },
      { path: 'permissions', label: '権限設定',     icon: 'admin_panel_settings', permission: 'system.permissions' },
      { path: 'system',      label: 'システム設定', icon: 'tune',          permission: 'system.session_config' },
      { path: 'hotel-info',  label: 'ホテル基本情報', icon: 'apartment',   permission: 'system.session_config' },
    ],
  },
];

export default function SettingsPage() {
  const { hasPermission } = useAuth();

  // 権限がある最初のメニュー項目のパスを取得（デフォルトリダイレクト先）
  const firstAccessible = MENU_SECTIONS
    .flatMap(s => s.items)
    .find(item => hasPermission(item.permission));

  return (
    <div className="settings">
      <div className="settings__sidebar">
        {MENU_SECTIONS.map(section => (
          <div key={section.title} className="settings__section">
            <div className="settings__section-title">{section.title}</div>
            {section.items.map(item => {
              const accessible = hasPermission(item.permission);
              return (
                <NavLink
                  key={item.path}
                  to={accessible ? `/settings/${item.path}` : '#'}
                  className={({ isActive }) =>
                    `settings__menu-item ${isActive && accessible ? 'settings__menu-item--active' : ''} ${!accessible ? 'settings__menu-item--locked' : ''}`
                  }
                  onClick={e => { if (!accessible) e.preventDefault(); }}
                >
                  <span className="material-symbols-outlined settings__menu-icon">{item.icon}</span>
                  <span className="settings__menu-label">
                    {item.label}
                    {!accessible && <span className="material-symbols-outlined settings__lock-icon">lock</span>}
                  </span>
                </NavLink>
              );
            })}
          </div>
        ))}
      </div>

      <div className="settings__content">
        <Routes>
          <Route path="room-types" element={<RoomTypeSettings />} />
          <Route path="rooms" element={<RoomSettings />} />
          <Route path="plans" element={<PlanSettings />} />
          <Route path="tax-rules" element={<TaxRuleSettings />} />
          <Route path="corporates" element={<CorporateSettings />} />
          <Route path="payments" element={<PaymentMethodSettings />} />
          <Route path="products" element={<ProductSettings />} />
          <Route path="channels" element={<ChannelSettings />} />
          <Route path="staff" element={<StaffSettings />} />
          <Route path="permissions" element={<PermissionSettings />} />
          <Route path="system" element={<SystemSettings />} />
          <Route path="hotel-info" element={<HotelInfoSettings />} />
          <Route
            path="*"
            element={
              firstAccessible
                ? <Navigate to={`/settings/${firstAccessible.path}`} replace />
                : <p style={{ color: 'var(--text-secondary)' }}>アクセスできる設定項目がありません</p>
            }
          />
        </Routes>
      </div>
    </div>
  );
}
