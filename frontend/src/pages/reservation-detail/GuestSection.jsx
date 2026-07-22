import { useState, useEffect, useRef } from 'react';
import { api } from '../../api/client';
import { useConfirm } from '../../components/ConfirmDialog';
import { COUNTRIES } from '../../utils/countries';

/**
 * 予約詳細のゲスト情報セクション部品
 * （属性行・人数編集・国籍選択・ゲストメモ）
 * ReservationDetailPage.jsx が2,200行超に肥大化したため分割（2026-06-11）
 */
export function AttrRow({ label, value }) {
  return (
    <div className="rd__attr">
      <span className="rd__attr-label">{label}</span>
      <span className="rd__attr-value">{value}</span>
    </div>
  );
}

/**
 * 人数インライン編集コンポーネント
 * onBlurで値が変わった場合のみAPI保存（onChange毎回呼ばない）
 */
/**
 * 人数編集コンポーネント
 * 大人/子供の集計値 + 男女別・子供区分別の内訳を全て編集可能
 * onBlurで変更があった場合のみAPI保存
 */
export function PaxEditor({ reservation: d, reservationId, updatedAt, onSaved }) {
  const fields = [
    { key: 'adult_count',   label: '大人' },
    { key: 'child_count',   label: '子供' },
    { key: 'male_count',    label: '男性',  cls: 'male' },
    { key: 'female_count',  label: '女性',  cls: 'female' },
    { key: 'child_a_count', label: '子A',   cls: 'child', hint: '70%' },
    { key: 'child_b_count', label: '子B',   cls: 'child', hint: '50%' },
    { key: 'child_c_count', label: '子C',   cls: 'child', hint: '30%' },
    { key: 'child_d_count', label: '子D',   cls: 'child', hint: '添寝' },
  ];

  // ローカルステートを一括管理
  const [vals, setVals] = useState(() => {
    const v = {};
    fields.forEach(f => { v[f.key] = Number(d[f.key]) || 0; });
    return v;
  });
  const { alert: showAlert } = useConfirm();

  // 親データが変わったら同期
  useEffect(() => {
    const v = {};
    fields.forEach(f => { v[f.key] = Number(d[f.key]) || 0; });
    setVals(v);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.updated_at]);

  const save = async (key) => {
    const original = Number(d[key]) || 0;
    if (vals[key] === original) return;
    try {
      await api.put(`/reservations/${reservationId}`, { [key]: vals[key], updated_at: updatedAt });
      onSaved();
    } catch (err) { showAlert('エラー', err.message); }
  };

  const setVal = (key, v) => setVals(prev => ({ ...prev, [key]: parseInt(v, 10) || 0 }));

  const adultFields = fields.slice(2, 4); // 男性・女性
  const childFields = fields.slice(4);    // 子A〜D

  return (
    <>
      <AttrRow label="人数" value={`大人${vals.adult_count}名${vals.child_count > 0 ? ` / 子供${vals.child_count}名` : ''}`} />
      <div className="rd__attr">
        <span className="rd__attr-label">大人</span>
        <span className="rd__attr-value rd__pax-breakdown">
          {adultFields.map(f => (
            <label key={f.key} className={`rd__pax-tag rd__pax-tag--${f.cls} rd__pax-tag--editable`} title={f.hint || ''}>
              {f.label}
              <input type="number" min="0" max="20" className="rd__pax-input rd__pax-input--tag"
                value={vals[f.key]} onChange={e => setVal(f.key, e.target.value)}
                onFocus={e => e.target.select()}
                onBlur={() => save(f.key)} />
            </label>
          ))}
        </span>
      </div>
      <div className="rd__attr">
        <span className="rd__attr-label">子供</span>
        <span className="rd__attr-value rd__pax-breakdown">
          {childFields.map(f => (
            <label key={f.key} className={`rd__pax-tag rd__pax-tag--${f.cls} rd__pax-tag--editable`} title={f.hint || ''}>
              {f.label}
              <input type="number" min="0" max="20" className="rd__pax-input rd__pax-input--tag"
                value={vals[f.key]} onChange={e => setVal(f.key, e.target.value)}
                onFocus={e => e.target.select()}
                onBlur={() => save(f.key)} />
            </label>
          ))}
        </span>
      </div>
    </>
  );
}

/**
 * 国籍選択コンボボックス
 * コード入力（KR）でも国名入力（韓国/Korea）でもフィルタ可能
 * 国旗絵文字付き表示
 */
export function CountryPicker({ guestId, currentCode, onSaved }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { alert: showAlert } = useConfirm();
  const ref = useRef(null);

  // 国コードから国旗絵文字を生成（Regional Indicator Symbols）
  const flag = (code) => {
    if (!code || code.length !== 2) return '';
    return String.fromCodePoint(
      ...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
    );
  };

  // フィルタ: コード・日本語名・英語名で部分一致
  const filtered = query
    ? COUNTRIES.filter(c =>
        c.code.toLowerCase().includes(query.toLowerCase()) ||
        c.name.includes(query) ||
        c.nameEn.toLowerCase().includes(query.toLowerCase())
      )
    : COUNTRIES;

  // 外側クリックで閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const select = async (code) => {
    if (code === currentCode) { setOpen(false); return; }
    try {
      await api.put(`/guests/${guestId}`, { country_code: code });
      onSaved();
    } catch (err) { showAlert('エラー', err.message); }
    setOpen(false);
    setQuery('');
  };

  const current = COUNTRIES.find(c => c.code === currentCode);

  return (
    <div className="rd__attr" ref={ref} style={{ position: 'relative' }}>
      <span className="rd__attr-label">国籍</span>
      <span
        className="rd__country-display"
        onClick={() => { setOpen(!open); setQuery(''); }}
      >
        {flag(currentCode)} {current ? current.name : currentCode}
        <span className="rd__country-code">{currentCode}</span>
        <span className="material-symbols-outlined rd__country-arrow">expand_more</span>
      </span>
      {open && (
        <div className="rd__country-dropdown">
          <input
            className="rd__country-search"
            placeholder="コード or 国名で検索..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
          <div className="rd__country-list">
            {filtered.map(c => (
              <div
                key={c.code}
                className={`rd__country-option ${c.code === currentCode ? 'rd__country-option--selected' : ''}`}
                onClick={() => select(c.code)}
              >
                <span className="rd__country-flag">{flag(c.code)}</span>
                <span className="rd__country-name">{c.name}</span>
                <span className="rd__country-en">{c.code}</span>
              </div>
            ))}
            {filtered.length === 0 && <div className="rd__country-empty">該当なし</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * ゲストメモ編集（顧客管理と同期）
 * guests.guest_notes を直接編集。全滞在共通のメモ（アレルギー、要注意事項等）
 */
export function GuestNotesEditor({ guestId, initialNotes, onSaved }) {
  const [text, setText] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const { alert: showAlert } = useConfirm();

  useEffect(() => { setText(initialNotes); }, [initialNotes]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/guests/${guestId}`, { guest_notes: text });
      onSaved();
    } catch (err) { showAlert('エラー', err.message); }
    setSaving(false);
  };

  return (
    <div className="rd__card rd__card--guest-notes">
      <h3 className="rd__card-title">
        <span className="material-symbols-outlined" style={{ fontSize: '16px', verticalAlign: 'text-bottom' }}>person</span>
        {' '}ゲストメモ
        <span className="rd__card-subtitle">（顧客管理と同期）</span>
      </h3>
      <textarea
        className="rd__notes-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="アレルギー、要注意事項など（全滞在共通）"
      />
      <button className="rd__save-btn" onClick={handleSave} disabled={saving}>
        {saving ? '保存中...' : '保存'}
      </button>
    </div>
  );
}
