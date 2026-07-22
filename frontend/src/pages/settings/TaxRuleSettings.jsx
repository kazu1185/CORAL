import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useConfirm } from '../../components/ConfirmDialog';

/**
 * 宿泊税ルール設定
 * 通常1レコードのみ（沖縄県の税ルール）
 * tax_type=flat の場合は料金帯（brackets）テーブルが付随
 * 税計算に直結するため変更時は必ず確認ダイアログを表示
 */
export default function TaxRuleSettings() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editRule, setEditRule] = useState(null);
  const { confirm } = useConfirm();

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const res = await api.get('/master/tax-rules');
      setRules(res.tax_rules || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (rule) => {
    // ディープコピー（bracketsの参照を切るため）
    setEditRule(JSON.parse(JSON.stringify(rule)));
    setError('');
    setSuccess('');
  };

  const handleSave = async () => {
    if (!editRule) return;

    // バリデーション
    if (editRule.tax_type === 'rate' && (!editRule.rate || parseFloat(editRule.rate) <= 0)) {
      setError('定率制の場合、税率を入力してください');
      return;
    }
    if (editRule.tax_type === 'flat' && (!editRule.brackets || editRule.brackets.length === 0)) {
      setError('定額制の場合、料金帯を1つ以上設定してください');
      return;
    }

    const ok = await confirm(
      '宿泊税ルール更新',
      'この変更は宿泊税計算に即座に反映されます。\n更新してよろしいですか？',
      { confirmColor: 'red', confirmLabel: '更新する' }
    );
    if (!ok) return;

    setSaving(true);
    setError('');
    try {
      await api.put(`/master/tax-rules/${editRule.id}`, editRule);
      setSuccess('更新しました');
      setEditRule(null);
      fetchData();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="settings-loading">読み込み中...</div>;

  // 編集モード
  if (editRule) {
    return (
      <TaxRuleForm
        rule={editRule}
        onChange={setEditRule}
        onSave={handleSave}
        onCancel={() => setEditRule(null)}
        saving={saving}
        error={error}
      />
    );
  }

  // 一覧表示
  return (
    <div>
      <div className="settings-page__header">
        <h2 className="settings-page__title">宿泊税ルール</h2>
      </div>

      {error && <div className="settings-error">{error}</div>}
      {success && <div className="settings-success">{success}</div>}

      {rules.length === 0 ? (
        <div className="settings-card" style={{ color: 'var(--text-muted)' }}>
          宿泊税ルールが設定されていません
        </div>
      ) : (
        rules.map(rule => (
          <div key={rule.id} className="settings-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  {rule.tax_type === 'rate' ? '定率制' : '定額制'}
                </h3>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  都道府県コード: {rule.prefecture_code}
                  {rule.municipality_code && ` / 市区町村: ${rule.municipality_code}`}
                </span>
              </div>
              <button className="settings-btn settings-btn--sm" onClick={() => handleEdit(rule)}>編集</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', fontSize: '13px' }}>
              {rule.tax_type === 'rate' && (
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>税率</div>
                  <div style={{ fontWeight: 600 }}>{(parseFloat(rule.rate) * 100).toFixed(2)}%</div>
                </div>
              )}
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>課税下限</div>
                <div>¥{Number(rule.min_charge).toLocaleString()}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>切り捨て単位</div>
                <div>¥{Number(rule.round_unit).toLocaleString()}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>子供免税</div>
                <div>{rule.child_exempt ? 'あり' : 'なし'}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>有効期間</div>
                <div>{rule.valid_from} 〜 {rule.valid_to || '無期限'}</div>
              </div>
            </div>

            {rule.tax_type === 'flat' && rule.brackets && rule.brackets.length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>料金帯</div>
                <table className="settings-table" style={{ fontSize: '12px' }}>
                  <thead>
                    <tr>
                      <th>下限</th>
                      <th>上限</th>
                      <th>税額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rule.brackets.map((b, i) => (
                      <tr key={i}>
                        <td>¥{Number(b.min_amount).toLocaleString()}</td>
                        <td>{b.max_amount != null ? `¥${Number(b.max_amount).toLocaleString()}` : '上限なし'}</td>
                        <td>¥{Number(b.tax_amount).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function TaxRuleForm({ rule, onChange, onSave, onCancel, saving, error }) {
  const updateField = (field, value) => {
    onChange({ ...rule, [field]: value });
  };

  const updateBracket = (index, field, value) => {
    const brackets = [...rule.brackets];
    brackets[index] = { ...brackets[index], [field]: value };
    onChange({ ...rule, brackets });
  };

  const addBracket = () => {
    const brackets = [...(rule.brackets || [])];
    const lastMax = brackets.length > 0 ? (brackets[brackets.length - 1].max_amount || 0) : 0;
    brackets.push({ min_amount: lastMax, max_amount: null, tax_amount: 0 });
    onChange({ ...rule, brackets });
  };

  const removeBracket = (index) => {
    const brackets = rule.brackets.filter((_, i) => i !== index);
    onChange({ ...rule, brackets });
  };

  return (
    <div>
      <div className="settings-page__header">
        <h2 className="settings-page__title">宿泊税ルール — 編集</h2>
      </div>

      <div style={{
        background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '6px',
        padding: '10px 14px', fontSize: '13px', color: '#92400E', marginBottom: '16px',
      }}>
        この設定は宿泊税計算に直接影響します。変更は慎重に行ってください。
      </div>

      {error && <div className="settings-error">{error}</div>}

      <div className="settings-card">
        <h4 style={{ margin: '0 0 16px', fontSize: '14px', color: 'var(--text-primary)' }}>基本設定</h4>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div className="settings-form__group">
            <label className="settings-form__label">課税方式</label>
            <select
              className="settings-form__select"
              value={rule.tax_type}
              onChange={e => updateField('tax_type', e.target.value)}
            >
              <option value="rate">定率制</option>
              <option value="flat">定額制</option>
            </select>
          </div>

          {rule.tax_type === 'rate' && (
            <div className="settings-form__group">
              <label className="settings-form__label">税率（%）</label>
              <input
                type="number"
                className="settings-form__input"
                value={rule.rate ? (parseFloat(rule.rate) * 100).toFixed(2) : ''}
                onChange={e => updateField('rate', (parseFloat(e.target.value) / 100).toFixed(4))}
                step="0.01"
                min={0}
              />
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
          <div className="settings-form__group">
            <label className="settings-form__label">課税下限額（円）</label>
            <input
              type="number"
              className="settings-form__input"
              value={rule.min_charge || 0}
              onChange={e => updateField('min_charge', parseInt(e.target.value, 10) || 0)}
              min={0}
            />
          </div>
          <div className="settings-form__group">
            <label className="settings-form__label">切り捨て単位（円）</label>
            <input
              type="number"
              className="settings-form__input"
              value={rule.round_unit || 1000}
              onChange={e => updateField('round_unit', parseInt(e.target.value, 10) || 1)}
              min={1}
            />
          </div>
          <div className="settings-form__group">
            <label className="settings-form__label">税額上限（円）</label>
            <input
              type="number"
              className="settings-form__input"
              value={rule.max_tax_amount || ''}
              onChange={e => updateField('max_tax_amount', e.target.value ? parseInt(e.target.value, 10) : null)}
              min={0}
              placeholder="上限なし"
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '8px' }}>
          <div className="settings-form__group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!rule.child_exempt}
                onChange={e => updateField('child_exempt', e.target.checked ? 1 : 0)}
              />
              <span className="settings-form__label" style={{ margin: 0 }}>子供免税</span>
            </label>
          </div>
          <div className="settings-form__group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!rule.include_consumption_tax}
                onChange={e => updateField('include_consumption_tax', e.target.checked ? 1 : 0)}
              />
              <span className="settings-form__label" style={{ margin: 0 }}>消費税込み金額に課税</span>
            </label>
          </div>
        </div>
      </div>

      <div className="settings-card">
        <h4 style={{ margin: '0 0 16px', fontSize: '14px', color: 'var(--text-primary)' }}>有効期間</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div className="settings-form__group">
            <label className="settings-form__label">開始日</label>
            <input
              type="date"
              className="settings-form__input"
              value={rule.valid_from || ''}
              onChange={e => updateField('valid_from', e.target.value)}
            />
          </div>
          <div className="settings-form__group">
            <label className="settings-form__label">終了日</label>
            <input
              type="date"
              className="settings-form__input"
              value={rule.valid_to || ''}
              onChange={e => updateField('valid_to', e.target.value || null)}
            />
            <small style={{ color: 'var(--text-muted)', fontSize: '11px' }}>空欄 = 無期限</small>
          </div>
        </div>
      </div>

      {rule.tax_type === 'flat' && (
        <div className="settings-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h4 style={{ margin: 0, fontSize: '14px', color: 'var(--text-primary)' }}>料金帯</h4>
            <button className="settings-btn settings-btn--sm" onClick={addBracket}>
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>add</span>
              追加
            </button>
          </div>

          {rule.brackets && rule.brackets.length > 0 ? (
            <table className="settings-table">
              <thead>
                <tr>
                  <th>下限額（円）</th>
                  <th>上限額（円）</th>
                  <th>税額（円）</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {rule.brackets.map((b, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        type="number"
                        className="settings-form__input"
                        value={b.min_amount}
                        onChange={e => updateBracket(i, 'min_amount', parseInt(e.target.value, 10) || 0)}
                        min={0}
                        style={{ width: '120px' }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="settings-form__input"
                        value={b.max_amount ?? ''}
                        onChange={e => updateBracket(i, 'max_amount', e.target.value ? parseInt(e.target.value, 10) : null)}
                        min={0}
                        style={{ width: '120px' }}
                        placeholder="上限なし"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="settings-form__input"
                        value={b.tax_amount}
                        onChange={e => updateBracket(i, 'tax_amount', parseInt(e.target.value, 10) || 0)}
                        min={0}
                        style={{ width: '120px' }}
                      />
                    </td>
                    <td>
                      <button
                        className="settings-btn settings-btn--sm settings-btn--danger"
                        onClick={() => removeBracket(i)}
                        title="削除"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>料金帯が設定されていません</div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
        <button className="settings-btn" onClick={onCancel}>キャンセル</button>
        <button className="settings-btn settings-btn--primary" onClick={onSave} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
}
