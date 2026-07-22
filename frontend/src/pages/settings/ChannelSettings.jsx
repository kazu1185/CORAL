import { useState } from 'react';
import { api } from '../../api/client';
import { useConfirm } from '../../components/ConfirmDialog';
import { useMasterCrud } from '../../hooks/useMasterCrud';

/**
 * チャネルマスタ設定
 * OTA・手動入力チャネルの一覧管理。名称・色・TLマッチパターンを編集可能。
 * channel_codeは作成後変更不可（予約データのchannel列から参照されるため）。
 */
export default function ChannelSettings() {
  const { confirm, alert: showAlert } = useConfirm();
  const {
    items: channels, loading, error,
    modal, setModal, fetchData, toggleActive, save: handleSave,
  } = useMasterCrud('/master/channels', {
    listKey: 'channels',
    query: 'all=1',
    labelOf: (ch) => ch.channel_name,
  });

  const handleToggleActive = async (item) => {
    // other は無効化できない（TLからの未知チャネルの受け皿のため）
    if (item.channel_code === 'other') {
      await showAlert('操作不可', '「その他」チャネルは無効化できません');
      return;
    }
    toggleActive(item);
  };

  // 既存other予約の一括チャネル更新
  const handleRemapOther = async (channelCode) => {
    const ok = await confirm(
      '一括更新',
      `channel='other' の予約のうち、このチャネルのTLマッチパターンに一致するものを一括更新しますか？`
    );
    if (!ok) return;

    try {
      const res = await api.post('/master/channels/remap-other', { channel_code: channelCode });
      await showAlert('完了', res.message);
      fetchData();
    } catch (e) {
      await showAlert('エラー', e.message);
    }
  };

  if (loading) return <div className="settings-loading">読み込み中...</div>;

  const otaChannels = channels.filter(c => c.channel_type === 'ota');
  const manualChannels = channels.filter(c => c.channel_type === 'manual');

  return (
    <div>
      <div className="settings-header">
        <h2 className="settings-title">チャネルマスタ</h2>
        <button className="settings-btn settings-btn--primary" onClick={() => setModal({ isNew: true, channel_type: 'ota' })}>
          <span className="material-symbols-outlined">add</span>
          チャネル追加
        </button>
      </div>
      <p className="settings-desc">
        TLリンカーン経由のOTAチャネルと手動入力チャネルを管理します。
        TLマッチパターンを設定すると、TLから予約が来た際に自動でチャネルを判別します。
      </p>

      {error && <div className="settings-error">{error}</div>}

      {/* OTAチャネル */}
      <h3 className="settings-section-label">OTAチャネル</h3>
      <table className="settings-table">
        <thead>
          <tr>
            <th style={{ width: 32 }}></th>
            <th>コード</th>
            <th>チャネル名</th>
            <th>色</th>
            <th>TLマッチパターン</th>
            <th style={{ width: 60 }}>状態</th>
            <th style={{ width: 80 }}></th>
          </tr>
        </thead>
        <tbody>
          {otaChannels.map(ch => (
            <tr key={ch.id} style={{ opacity: ch.is_active ? 1 : 0.5 }}>
              <td>
                <span className="ota-badge" style={{ background: ch.color, padding: '2px 6px', fontSize: 10, borderRadius: 4 }}>
                  &nbsp;
                </span>
              </td>
              <td><code className="settings-code">{ch.channel_code}</code></td>
              <td>{ch.channel_name}</td>
              <td><code>{ch.color}</code></td>
              <td className="settings-mono">{ch.tl_match_patterns || <span style={{ color: '#94A3B8' }}>—</span>}</td>
              <td>
                <button
                  className={`settings-toggle-btn ${ch.is_active ? 'settings-toggle-btn--active' : ''}`}
                  onClick={() => handleToggleActive(ch)}
                  title={ch.is_active ? '有効' : '無効'}
                >
                  {ch.is_active ? '有効' : '無効'}
                </button>
              </td>
              <td>
                <button className="settings-btn settings-btn--sm" onClick={() => setModal({ ...ch, isNew: false })}>
                  編集
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 手動チャネル */}
      <h3 className="settings-section-label" style={{ marginTop: 24 }}>手動入力チャネル</h3>
      <table className="settings-table">
        <thead>
          <tr>
            <th style={{ width: 32 }}></th>
            <th>コード</th>
            <th>チャネル名</th>
            <th>色</th>
            <th style={{ width: 60 }}>状態</th>
            <th style={{ width: 80 }}></th>
          </tr>
        </thead>
        <tbody>
          {manualChannels.map(ch => (
            <tr key={ch.id} style={{ opacity: ch.is_active ? 1 : 0.5 }}>
              <td>
                <span className="ota-badge" style={{ background: ch.color, padding: '2px 6px', fontSize: 10, borderRadius: 4 }}>
                  &nbsp;
                </span>
              </td>
              <td><code className="settings-code">{ch.channel_code}</code></td>
              <td>{ch.channel_name}</td>
              <td><code>{ch.color}</code></td>
              <td>
                <button
                  className={`settings-toggle-btn ${ch.is_active ? 'settings-toggle-btn--active' : ''}`}
                  onClick={() => handleToggleActive(ch)}
                >
                  {ch.is_active ? '有効' : '無効'}
                </button>
              </td>
              <td>
                <button className="settings-btn settings-btn--sm" onClick={() => setModal({ ...ch, isNew: false })}>
                  編集
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 編集モーダル */}
      {modal && (
        <ChannelModal
          data={modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
          onRemapOther={handleRemapOther}
        />
      )}
    </div>
  );
}

function ChannelModal({ data, onSave, onClose, onRemapOther }) {
  const isNew = data.isNew;
  const [form, setForm] = useState({
    channel_code: data.channel_code || '',
    channel_name: data.channel_name || '',
    color: data.color || '#6B7280',
    channel_type: data.channel_type || 'ota',
    tl_match_patterns: data.tl_match_patterns || '',
    sort_order: data.sort_order ?? 99,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.channel_name.trim()) {
      setError('チャネル名は必須です');
      return;
    }
    if (isNew && !form.channel_code.trim()) {
      setError('チャネルコードは必須です');
      return;
    }

    setSaving(true);
    const payload = isNew ? form : { id: data.id, ...form };
    // 新規作成時以外はchannel_codeは送らない（変更不可）
    if (!isNew) delete payload.channel_code;

    const err = await onSave(payload);
    setSaving(false);
    if (err) setError(err);
  };

  return (
    <div className="settings-modal__overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="settings-modal__title">
          {isNew ? 'チャネル追加' : `「${data.channel_name}」を編集`}
        </h3>
        <form onSubmit={handleSubmit}>
          {isNew && (
            <div className="settings-form__group">
              <label className="settings-form__label">チャネルコード（英小文字、変更不可）</label>
              <input className="settings-form__input" value={form.channel_code}
                onChange={(e) => setForm(p => ({ ...p, channel_code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))}
                placeholder="例: tripadvisor" autoFocus />
            </div>
          )}
          <div className="settings-form__group">
            <label className="settings-form__label">チャネル名</label>
            <input className="settings-form__input" value={form.channel_name}
              onChange={(e) => setForm(p => ({ ...p, channel_name: e.target.value }))}
              placeholder="例: トリップアドバイザー" autoFocus={!isNew} />
          </div>
          <div className="settings-form__group">
            <label className="settings-form__label">バッジカラー</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="color" value={form.color}
                onChange={(e) => setForm(p => ({ ...p, color: e.target.value }))}
                style={{ width: 36, height: 36, border: 'none', padding: 0, cursor: 'pointer' }} />
              <span className="ota-badge" style={{ background: form.color }}>
                {form.channel_name || 'プレビュー'}
              </span>
              <code style={{ color: '#64748B', fontSize: 12 }}>{form.color}</code>
            </div>
          </div>
          <div className="settings-form__group">
            <label className="settings-form__label">種類</label>
            <select className="settings-form__select" value={form.channel_type}
              onChange={(e) => setForm(p => ({ ...p, channel_type: e.target.value }))}>
              <option value="ota">OTA（TL経由）</option>
              <option value="manual">手動入力</option>
            </select>
          </div>
          {form.channel_type === 'ota' && (
            <div className="settings-form__group">
              <label className="settings-form__label">TLマッチパターン（カンマ区切りで複数指定可）</label>
              <input className="settings-form__input" value={form.tl_match_patterns}
                onChange={(e) => setForm(p => ({ ...p, tl_match_patterns: e.target.value }))}
                placeholder="例: Trip.com,トリップドットコム" />
              <span style={{ fontSize: 11, color: '#94A3B8' }}>
                TLのSalesOfficeCompanyNameに含まれる文字列を指定
              </span>
            </div>
          )}
          <div className="settings-form__group">
            <label className="settings-form__label">表示順</label>
            <input className="settings-form__input settings-form__input--sm" type="number"
              value={form.sort_order}
              onChange={(e) => setForm(p => ({ ...p, sort_order: parseInt(e.target.value) || 0 }))} />
          </div>

          {error && <div className="settings-error">{error}</div>}

          <div className="settings-modal__actions">
            {/* 既存OTAチャネル編集時: other予約の一括更新ボタン */}
            {!isNew && data.channel_type === 'ota' && data.tl_match_patterns && (
              <button type="button" className="settings-btn" style={{ marginRight: 'auto' }}
                onClick={() => onRemapOther(data.channel_code)}>
                other予約を一括変更
              </button>
            )}
            <button type="button" className="settings-btn" onClick={onClose}>キャンセル</button>
            <button type="submit" className="settings-btn settings-btn--primary" disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
