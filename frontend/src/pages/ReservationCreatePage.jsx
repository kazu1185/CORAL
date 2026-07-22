import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useConfirm } from '../components/ConfirmDialog';
import { OTA_LABELS, MANUAL_CHANNELS } from '../utils/constants';
import { parseLocal, fmt, dayDiff } from '../utils/date';
import CalendarPicker from '../components/CalendarPicker';
import './ReservationCreatePage.css';

/**
 * 手動予約入力ページ
 * 電話・直販・法人経由の予約を手動登録する
 */
export default function ReservationCreatePage() {
  const navigate = useNavigate();
  const { confirm: showConfirm, alert: showAlert } = useConfirm();

  // --- マスタデータ ---
  const [roomTypes, setRoomTypes] = useState([]);
  const [plans, setPlans] = useState([]);

  // --- フォーム状態 ---
  const [form, setForm] = useState({
    channel: 'phone',
    guest_id: null,
    last_name: '',
    first_name: '',
    checkin_date: '',
    checkout_date: '',
    room_type: '',
    plan_id: '',
    adult_count: 1,
    child_count: 0,
    corporate_id: null,
    notes: '',
  });

  // --- 泊数入力（CI日+泊数→CO日を自動計算） ---
  const [nightsInput, setNightsInput] = useState('');

  // --- 泊別料金 ---
  const [charges, setCharges] = useState([]);

  // --- ゲスト検索 ---
  const [guestQuery, setGuestQuery] = useState('');
  const [guestResults, setGuestResults] = useState([]);
  const [selectedGuest, setSelectedGuest] = useState(null);
  const [showGuestDropdown, setShowGuestDropdown] = useState(false);
  const [showNewGuestForm, setShowNewGuestForm] = useState(false);
  const [newGuest, setNewGuest] = useState({ last_name: '', first_name: '', phone: '' });
  const guestSearchRef = useRef(null);
  const guestDropdownRef = useRef(null);

  // --- 送信状態 ---
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // === マスタデータ取得 ===
  useEffect(() => {
    Promise.all([
      api.get('/master/room-types'),
      api.get('/master/plans'),
    ]).then(([rtRes, plRes]) => {
      setRoomTypes(rtRes.room_types || []);
      setPlans(plRes.plans || []);
    }).catch(() => {});
  }, []);

  // === ゲスト検索（debounce） ===
  useEffect(() => {
    if (guestQuery.length < 2) {
      setGuestResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.get(`/guests?q=${encodeURIComponent(guestQuery)}&per_page=8`);
        setGuestResults(res.data || []);
        setShowGuestDropdown(true);
      } catch { setGuestResults([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [guestQuery]);

  // === ゲスト検索ドロップダウンの外側クリックで閉じる ===
  useEffect(() => {
    const handler = (e) => {
      if (guestDropdownRef.current && !guestDropdownRef.current.contains(e.target) &&
          guestSearchRef.current && !guestSearchRef.current.contains(e.target)) {
        setShowGuestDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // === CI日+泊数変更時にCO日を自動計算し、料金明細を更新 ===
  useEffect(() => {
    if (!form.checkin_date || !nightsInput) return;
    const n = parseInt(nightsInput);
    if (!n || n <= 0 || n > 90) return;

    // CO日を自動計算
    const ci = parseLocal(form.checkin_date);
    const co = new Date(ci);
    co.setDate(co.getDate() + n);
    const coStr = fmt(co);
    if (form.checkout_date !== coStr) {
      setForm(prev => ({ ...prev, checkout_date: coStr }));
    }
  }, [form.checkin_date, nightsInput]);

  // === CI/CO確定後に料金明細を自動更新 ===
  useEffect(() => {
    if (!form.checkin_date || !form.checkout_date) return;
    const nights = dayDiff(form.checkin_date, form.checkout_date);
    if (nights <= 0 || nights > 90) return;

    setCharges(prev => {
      // 既存の入力値を日付キーで保持し、新しい日付範囲に合わせて再構築
      const prevMap = {};
      prev.forEach(c => { prevMap[c.date] = c; });

      const newCharges = [];
      const ci = parseLocal(form.checkin_date);
      for (let i = 0; i < nights; i++) {
        const d = new Date(ci);
        d.setDate(d.getDate() + i);
        const dateStr = fmt(d);
        newCharges.push({
          date: dateStr,
          amount: prevMap[dateStr]?.amount ?? '',
          accom_tax: prevMap[dateStr]?.accom_tax ?? 0,
        });
      }
      return newCharges;
    });
  }, [form.checkin_date, form.checkout_date]);

  // === ゲスト選択 ===
  const selectGuest = useCallback((guest) => {
    setSelectedGuest(guest);
    setForm(prev => ({
      ...prev,
      guest_id: guest.id,
      last_name: '',
      first_name: '',
    }));
    setGuestQuery('');
    setShowGuestDropdown(false);
  }, []);

  const clearGuest = useCallback(() => {
    setSelectedGuest(null);
    setForm(prev => ({ ...prev, guest_id: null }));
  }, []);

  // === 新規ゲスト作成 ===
  const createNewGuest = useCallback(async () => {
    if (!newGuest.last_name.trim()) {
      await showAlert('エラー', '姓は必須です');
      return;
    }
    try {
      const nameKanji = (newGuest.last_name + '　' + newGuest.first_name).trim();
      const res = await api.post('/guests', {
        name_kanji: nameKanji,
        phone: newGuest.phone || null,
      });
      // 作成したゲストを選択
      selectGuest({
        id: res.id || res.guest?.id,
        name_kanji: nameKanji,
        guest_code: res.guest_code || res.guest?.guest_code || '',
        phone: newGuest.phone,
      });
      setShowNewGuestForm(false);
      setNewGuest({ last_name: '', first_name: '', phone: '' });
    } catch (e) {
      await showAlert('エラー', e.message);
    }
  }, [newGuest, selectGuest, showAlert]);

  // === フォーム送信 ===
  const handleSubmit = useCallback(async () => {
    setError(null);

    // 簡易バリデーション
    if (!form.checkin_date || !form.checkout_date) {
      setError('チェックイン日・チェックアウト日を入力してください');
      return;
    }
    if (!form.guest_id && !form.last_name.trim()) {
      setError('ゲストを選択するか、姓を入力してください');
      return;
    }
    if (charges.length === 0) {
      setError('料金明細がありません');
      return;
    }
    // 金額未入力チェック
    const hasEmptyAmount = charges.some(c => c.amount === '' || c.amount === null || c.amount === undefined);
    if (hasEmptyAmount) {
      setError('すべての泊の室料を入力してください');
      return;
    }

    // 合計金額計算
    const totalAmount = charges.reduce((sum, c) => sum + (parseInt(c.amount) || 0), 0);
    const totalTax = charges.reduce((sum, c) => sum + (parseInt(c.accom_tax) || 0), 0);
    const guestName = selectedGuest
      ? selectedGuest.name_kanji
      : `${form.last_name} ${form.first_name}`.trim();

    const ok = await showConfirm(
      '予約を登録しますか？',
      `${guestName}　${form.checkin_date} ～ ${form.checkout_date}（${charges.length}泊）\n` +
      `合計: ¥${(totalAmount + totalTax).toLocaleString()}`,
      { confirmLabel: '登録する', confirmColor: 'blue' }
    );
    if (!ok) return;

    setSubmitting(true);
    try {
      const payload = {
        ...form,
        plan_id: form.plan_id || null,
        corporate_id: form.corporate_id || null,
        charges: charges.map(c => ({
          date: c.date,
          amount: parseInt(c.amount) || 0,
          accom_tax: parseInt(c.accom_tax) || 0,
        })),
      };
      const res = await api.post('/reservations', payload);
      await showAlert('完了', `予約を作成しました（${res.reservation_no}）`);
      navigate(`/reservations/${res.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }, [form, charges, selectedGuest, showConfirm, showAlert, navigate]);

  // === フォームフィールド更新ヘルパー ===
  const setField = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  // === 料金セル更新 ===
  const updateCharge = (index, field, value) => {
    setCharges(prev => prev.map((c, i) =>
      i === index ? { ...c, [field]: value } : c
    ));
  };

  // 合計計算
  const totalAmount = charges.reduce((s, c) => s + (parseInt(c.amount) || 0), 0);
  const totalAccomTax = charges.reduce((s, c) => s + (parseInt(c.accom_tax) || 0), 0);
  const nights = form.checkin_date && form.checkout_date
    ? dayDiff(form.checkin_date, form.checkout_date) : 0;

  return (
    <div className="rc-page">
      <div className="rc-page__header">
        <h1 className="rc-page__title">
          <span className="material-symbols-outlined rc-page__icon">edit_note</span>
          手動予約入力
        </h1>
        <button className="rc-page__back" onClick={() => navigate('/reservations')}>
          <span className="material-symbols-outlined">arrow_back</span>
          予約一覧に戻る
        </button>
      </div>

      <div className="rc-form">
        {/* === チャネル選択 === */}
        <section className="rc-section">
          <h2 className="rc-section__title">チャネル</h2>
          <div className="rc-channel-group">
            {MANUAL_CHANNELS.map(ch => (
              <label key={ch.value} className={`rc-channel-chip ${form.channel === ch.value ? 'rc-channel-chip--active' : ''}`}>
                <input
                  type="radio"
                  name="channel"
                  value={ch.value}
                  checked={form.channel === ch.value}
                  onChange={() => setField('channel', ch.value)}
                />
                <span className={`ota-badge ota-${ch.value}`}>{ch.label}</span>
              </label>
            ))}
          </div>
        </section>

        {/* === ゲスト情報 === */}
        <section className="rc-section">
          <h2 className="rc-section__title">ゲスト情報</h2>

          {selectedGuest ? (
            <div className="rc-guest-selected">
              <span className="material-symbols-outlined">person</span>
              <span className="rc-guest-selected__name">{selectedGuest.name_kanji}</span>
              <span className="rc-guest-selected__code">{selectedGuest.guest_code}</span>
              {selectedGuest.phone && <span className="rc-guest-selected__phone">{selectedGuest.phone}</span>}
              <button className="rc-guest-selected__clear" onClick={clearGuest}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
          ) : (
            <>
              {/* ゲスト検索 */}
              <div className="rc-guest-search">
                <div className="rc-guest-search__input-wrap" ref={guestSearchRef}>
                  <span className="material-symbols-outlined rc-guest-search__icon">search</span>
                  <input
                    className="rc-guest-search__input"
                    placeholder="ゲスト名で検索（2文字以上）"
                    value={guestQuery}
                    onChange={(e) => setGuestQuery(e.target.value)}
                    onFocus={() => guestResults.length > 0 && setShowGuestDropdown(true)}
                  />
                </div>
                <button
                  className="rc-btn rc-btn--outline rc-btn--sm"
                  onClick={() => setShowNewGuestForm(true)}
                >
                  <span className="material-symbols-outlined">person_add</span>
                  新規ゲスト
                </button>
              </div>

              {/* 検索結果ドロップダウン */}
              {showGuestDropdown && guestResults.length > 0 && (
                <div className="rc-guest-dropdown" ref={guestDropdownRef}>
                  {guestResults.map(g => (
                    <button key={g.id} className="rc-guest-dropdown__item" onClick={() => selectGuest(g)}>
                      <span className="rc-guest-dropdown__name">{g.name_kanji || g.name_kana || g.name_romaji}</span>
                      <span className="rc-guest-dropdown__meta">
                        {g.guest_code}
                        {g.phone && ` / ${g.phone}`}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* ゲスト未選択時: 姓名直接入力 */}
              <div className="rc-field-row" style={{ marginTop: 8 }}>
                <div className="rc-field">
                  <label className="rc-label">姓 <span className="rc-required">*</span></label>
                  <input className="rc-input" value={form.last_name}
                    onChange={(e) => setField('last_name', e.target.value)}
                    placeholder="山田" />
                </div>
                <div className="rc-field">
                  <label className="rc-label">名</label>
                  <input className="rc-input" value={form.first_name}
                    onChange={(e) => setField('first_name', e.target.value)}
                    placeholder="太郎" />
                </div>
              </div>
              <p className="rc-hint">ゲストを選択しない場合は姓名を直接入力してください</p>
            </>
          )}

          {/* 新規ゲスト作成ダイアログ */}
          {showNewGuestForm && (
            <div className="rc-overlay" onClick={() => setShowNewGuestForm(false)}>
              <div className="rc-dialog" onClick={(e) => e.stopPropagation()}>
                <h3 className="rc-dialog__title">新規ゲスト作成</h3>
                <div className="rc-field-row">
                  <div className="rc-field">
                    <label className="rc-label">姓 <span className="rc-required">*</span></label>
                    <input className="rc-input" value={newGuest.last_name}
                      onChange={(e) => setNewGuest(prev => ({ ...prev, last_name: e.target.value }))}
                      placeholder="山田" autoFocus />
                  </div>
                  <div className="rc-field">
                    <label className="rc-label">名</label>
                    <input className="rc-input" value={newGuest.first_name}
                      onChange={(e) => setNewGuest(prev => ({ ...prev, first_name: e.target.value }))}
                      placeholder="太郎" />
                  </div>
                </div>
                <div className="rc-field">
                  <label className="rc-label">電話番号</label>
                  <input className="rc-input" value={newGuest.phone}
                    onChange={(e) => setNewGuest(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="090-1234-5678" />
                </div>
                <div className="rc-dialog__actions">
                  <button className="rc-btn rc-btn--outline" onClick={() => setShowNewGuestForm(false)}>キャンセル</button>
                  <button className="rc-btn rc-btn--primary" onClick={createNewGuest}>作成して選択</button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* === 宿泊情報 === */}
        <section className="rc-section">
          <h2 className="rc-section__title">宿泊情報</h2>

          <div className="rc-stay-layout">
            {/* 左: カレンダー */}
            <div className="rc-stay-layout__calendar">
              <CalendarPicker
                mode="range"
                value={{ from: form.checkin_date, to: form.checkout_date }}
                onChange={({ from, to }) => {
                  setForm(prev => ({ ...prev, checkin_date: from, checkout_date: to }));
                  if (from && to) {
                    setNightsInput(String(dayDiff(from, to)));
                  } else {
                    setNightsInput('');
                  }
                }}
              />
            </div>

            {/* 右: 泊数・部屋タイプ・プラン・人数 */}
            <div className="rc-stay-layout__fields">
              <div className="rc-field-row">
                <div className="rc-field rc-field--narrow">
                  <label className="rc-label">泊数</label>
                  <input className="rc-input rc-input--num" type="number" min="1" max="90"
                    value={nightsInput}
                    onChange={(e) => setNightsInput(e.target.value)}
                    placeholder="—" />
                </div>
                <div className="rc-field">
                  <label className="rc-label">部屋タイプ</label>
                  <select className="rc-select" value={form.room_type}
                    onChange={(e) => setField('room_type', e.target.value)}>
                    <option value="">-- 未選択 --</option>
                    {roomTypes.filter(rt => rt.is_active).map(rt => (
                      <option key={rt.id} value={rt.type_code}>{rt.type_name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rc-field">
                <label className="rc-label">プラン</label>
                <select className="rc-select" value={form.plan_id}
                  onChange={(e) => setField('plan_id', e.target.value)}>
                  <option value="">-- 未選択 --</option>
                  {plans.filter(p => p.is_active).map(p => (
                    <option key={p.id} value={p.id}>{p.plan_name}</option>
                  ))}
                </select>
              </div>

              <div className="rc-field-row">
                <div className="rc-field rc-field--narrow">
                  <label className="rc-label">大人</label>
                  <input className="rc-input rc-input--num" type="number" min="1" max="20"
                    value={form.adult_count}
                    onChange={(e) => setField('adult_count', parseInt(e.target.value) || 1)} />
                </div>
                <div className="rc-field rc-field--narrow">
                  <label className="rc-label">小人</label>
                  <input className="rc-input rc-input--num" type="number" min="0" max="20"
                    value={form.child_count}
                    onChange={(e) => setField('child_count', parseInt(e.target.value) || 0)} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* === 料金明細 === */}
        <section className="rc-section">
          <h2 className="rc-section__title">料金明細（泊別）</h2>
          {charges.length > 0 ? (
            <table className="rc-charges-table">
              <thead>
                <tr>
                  <th className="rc-charges-table__th">日付</th>
                  <th className="rc-charges-table__th rc-charges-table__th--num">室料（税込）</th>
                  <th className="rc-charges-table__th rc-charges-table__th--num">宿泊税</th>
                </tr>
              </thead>
              <tbody>
                {charges.map((c, i) => {
                  const d = parseLocal(c.date);
                  const dow = ['日','月','火','水','木','金','土'][d.getDay()];
                  return (
                    <tr key={c.date}>
                      <td className="rc-charges-table__td">{c.date}（{dow}）</td>
                      <td className="rc-charges-table__td rc-charges-table__td--num">
                        <input className="rc-input rc-input--num rc-input--charge"
                          type="number" min="0" step="100"
                          value={c.amount}
                          onChange={(e) => updateCharge(i, 'amount', e.target.value)}
                          placeholder="0" />
                      </td>
                      <td className="rc-charges-table__td rc-charges-table__td--num">
                        <input className="rc-input rc-input--num rc-input--charge"
                          type="number" min="0" step="100"
                          value={c.accom_tax}
                          onChange={(e) => updateCharge(i, 'accom_tax', e.target.value)}
                          placeholder="0" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="rc-charges-table__total">
                  <td className="rc-charges-table__td">合計</td>
                  <td className="rc-charges-table__td rc-charges-table__td--num">
                    ¥{totalAmount.toLocaleString()}
                  </td>
                  <td className="rc-charges-table__td rc-charges-table__td--num">
                    ¥{totalAccomTax.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <p className="rc-hint">チェックイン日・チェックアウト日を入力すると明細行が自動生成されます</p>
          )}
        </section>

        {/* === 備考 === */}
        <section className="rc-section">
          <h2 className="rc-section__title">備考</h2>
          <textarea className="rc-textarea" rows={3} value={form.notes}
            onChange={(e) => setField('notes', e.target.value)}
            placeholder="予約に関するメモ（アレルギー、到着時間、特別リクエスト等）" />
        </section>

        {/* === エラー表示 === */}
        {error && (
          <div className="rc-error">
            <span className="material-symbols-outlined">error_outline</span>
            {error}
          </div>
        )}

        {/* === アクションボタン === */}
        <div className="rc-actions">
          <button className="rc-btn rc-btn--outline" onClick={() => navigate('/reservations')}
            disabled={submitting}>
            キャンセル
          </button>
          <button className="rc-btn rc-btn--primary rc-btn--lg" onClick={handleSubmit}
            disabled={submitting}>
            <span className="material-symbols-outlined">check</span>
            {submitting ? '登録中...' : '予約を登録する'}
          </button>
        </div>
      </div>
    </div>
  );
}
