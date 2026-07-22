import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import { useConfirm } from '../../components/ConfirmDialog';

/**
 * 権限設定
 * ロール×権限のマトリクスをチェックボックスで表示
 * adminは全権限固定のため編集不可（グレーアウト表示）
 * 変更は1つずつ即時保存（頻度が低いため一括保存は不要）
 */

const ROLES = [
  { key: 'admin', label: '管理者' },
  { key: 'front_manager', label: 'フロントマネージャー' },
  { key: 'front', label: 'フロント' },
  { key: 'housekeeping', label: '清掃' },
];

export default function PermissionSettings() {
  const [permissions, setPermissions] = useState([]);
  const [rolePerms, setRolePerms] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { confirm } = useConfirm();

  const fetchData = useCallback(async () => {
    try {
      const [permRes, ...roleRes] = await Promise.all([
        api.get('/master/permissions'),
        ...ROLES.filter(r => r.key !== 'admin').map(r => api.get(`/master/role-permissions/${r.key}`)),
      ]);

      setPermissions(permRes.permissions || []);

      // ロール別の権限マップを構築
      const map = { admin: {} };
      // adminは全権限ONで固定
      (permRes.permissions || []).forEach(p => {
        map.admin[p.permission_key] = true;
      });
      roleRes.forEach((res) => {
        map[res.role] = res.permissions || {};
      });
      setRolePerms(map);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleToggle = async (role, permKey, currentValue) => {
    const action = currentValue ? 'OFF' : 'ON';
    const perm = permissions.find(p => p.permission_key === permKey);
    const roleLabel = ROLES.find(r => r.key === role)?.label;
    const ok = await confirm(
      '権限変更',
      `「${roleLabel}」の「${perm?.permission_name}」を${action}にしますか？`
    );
    if (!ok) return;

    try {
      await api.put(`/master/role-permissions/${role}`, {
        permissions: { [permKey]: !currentValue },
      });
      // ローカル状態を更新（再取得せず即座に反映するため）
      setRolePerms(prev => ({
        ...prev,
        [role]: { ...prev[role], [permKey]: !currentValue },
      }));
    } catch (e) {
      setError(e.message);
    }
  };

  if (loading) return <div className="settings-loading">読み込み中...</div>;

  // 権限をカテゴリ別にグループ化
  const categories = [];
  const catMap = {};
  permissions.forEach(p => {
    if (!catMap[p.category]) {
      catMap[p.category] = [];
      categories.push(p.category);
    }
    catMap[p.category].push(p);
  });

  return (
    <div>
      <div className="settings-page__header">
        <h2 className="settings-page__title">権限設定</h2>
      </div>

      {error && <div className="settings-error">{error}</div>}

      <div className="settings-card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="settings-table" style={{ minWidth: '600px' }}>
          <thead>
            <tr>
              <th style={{ minWidth: '200px' }}>権限</th>
              {ROLES.map(r => (
                <th key={r.key} style={{ textAlign: 'center', minWidth: '100px' }}>
                  <span className={`settings-badge settings-badge--${r.key}`}>{r.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map(cat => (
              <>
                <tr key={`cat-${cat}`}>
                  <td colSpan={ROLES.length + 1} style={{
                    background: 'var(--bg-main)',
                    fontWeight: 600,
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    padding: '6px 12px',
                  }}>
                    {cat}
                  </td>
                </tr>
                {catMap[cat].map(perm => (
                  <tr key={perm.permission_key}>
                    <td>
                      <div style={{ fontWeight: 500, fontSize: '13px' }}>{perm.permission_name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {perm.permission_key}
                      </div>
                    </td>
                    {ROLES.map(role => {
                      const isAdmin = role.key === 'admin';
                      const granted = isAdmin ? true : !!rolePerms[role.key]?.[perm.permission_key];
                      return (
                        <td key={role.key} style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={granted}
                            disabled={isAdmin}
                            onChange={() => handleToggle(role.key, perm.permission_key, granted)}
                            style={{
                              width: '16px',
                              height: '16px',
                              cursor: isAdmin ? 'not-allowed' : 'pointer',
                              opacity: isAdmin ? 0.5 : 1,
                            }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
        ※ 管理者（admin）は全権限が付与されており、変更できません
      </div>
    </div>
  );
}
