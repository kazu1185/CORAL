import { createContext, useState, useEffect, useCallback } from 'react';
import { api, setLogoutCallback } from '../api/client';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [staff, setStaff] = useState(() => {
    const saved = localStorage.getItem('pms_staff');
    return saved ? JSON.parse(saved) : null;
  });
  const [token, setToken] = useState(() => localStorage.getItem('pms_token'));
  const [loading, setLoading] = useState(false);

  const isAuthenticated = !!token && !!staff;

  const logout = useCallback(() => {
    // APIコール（エラーは無視）
    if (token) {
      api.post('/auth/logout').catch(() => {});
    }
    setToken(null);
    setStaff(null);
    localStorage.removeItem('pms_token');
    localStorage.removeItem('pms_staff');
  }, [token]);

  // 401時の自動ログアウトコールバック
  useEffect(() => {
    setLogoutCallback(() => {
      setToken(null);
      setStaff(null);
    });
  }, []);

  const login = async (staffId, pin) => {
    setLoading(true);
    try {
      const data = await api.post('/auth/login', { staff_id: staffId, pin });
      setToken(data.token);
      setStaff(data.staff);
      localStorage.setItem('pms_token', data.token);
      localStorage.setItem('pms_staff', JSON.stringify(data.staff));
      return data;
    } finally {
      setLoading(false);
    }
  };

  const hasPermission = useCallback((permissionKey) => {
    if (!staff) return false;
    if (staff.role === 'admin') return true;
    return staff.permissions?.includes(permissionKey) ?? false;
  }, [staff]);

  const hasAnyPermission = useCallback((keys) => {
    return keys.some(key => hasPermission(key));
  }, [hasPermission]);

  const value = {
    staff,
    token,
    isAuthenticated,
    loading,
    login,
    logout,
    hasPermission,
    hasAnyPermission,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
