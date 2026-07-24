import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ReservationListPage from './pages/ReservationListPage';
import RoomIndicatorPage from './pages/RoomIndicatorPage';
import ReservationDetailPage from './pages/ReservationDetailPage';
import AssignBoardPage from './pages/AssignBoardPage';
import GuestListPage from './pages/GuestListPage';
import GuestDetailPage from './pages/GuestDetailPage';
import RoomInventoryPage from './pages/RoomInventoryPage';
import SettingsPage from './pages/settings/SettingsPage';
import ReportPage from './pages/ReportPage';
import ReservationCreatePage from './pages/ReservationCreatePage';
import ProductSalesPage from './pages/ProductSalesPage';
import { ConfirmProvider } from './components/ConfirmDialog';
import './styles/variables.css';
import './styles/ota-badge.css';
import './styles/status-badge.css';
import './styles/theme.css';
import './styles/touch.css';

function App() {
  return (
    <AuthProvider>
      <ConfirmProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* 認証保護エリア */}
          <Route path="/*" element={
            <ProtectedRoute>
              <Layout>
                <Routes>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/reservations" element={<ReservationListPage />} />
                  <Route path="/reservations/new" element={<ReservationCreatePage />} />
                  <Route path="/reservations/:id" element={<ReservationDetailPage />} />
                  <Route path="/assign-board" element={<AssignBoardPage />} />
                  <Route path="/room-indicator" element={<RoomIndicatorPage />} />
                  <Route path="/room-inventory" element={<RoomInventoryPage />} />
                  <Route path="/guests" element={<GuestListPage />} />
                  <Route path="/guests/:id" element={<GuestDetailPage />} />
                  <Route path="/housekeeping" element={<Placeholder title="清掃管理" phase={13} />} />
                  <Route path="/product-sales" element={<ProductSalesPage />} />
                  <Route path="/reports" element={<ReportPage />} />
                  <Route path="/settings/*" element={<SettingsPage />} />
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          } />
        </Routes>
      </BrowserRouter>
      </ConfirmProvider>
    </AuthProvider>
  );
}

function Placeholder({ title, phase }) {
  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</h1>
      <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>Phase {phase} で実装予定</p>
    </div>
  );
}

export default App;
