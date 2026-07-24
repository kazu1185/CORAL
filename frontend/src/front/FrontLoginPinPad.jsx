import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api, ApiError } from '../api/client';
import { markFrontDevice } from './frontDevice';
import './FrontLoginPinPad.css';

/**
 * フロントモード ログイン（大型PINパッド） — 仕様書 §4.1 / mock #scr-login
 *
 * 共用のiPad端末で最速・確実にログインするための画面。
 * 認証APIは既存（スタッフ名+PIN）のまま（AuthContext.login を使用）。
 *
 * PIN送信方式: 実システムのPINは4〜6桁可変のため「4桁自動送信」ではなく
 * ⏎確定キー方式を採用（2026-07-24 ユーザー決定）。4桁以上で確定キーが有効化される。
 */
export default function FrontLoginPinPad() {
  const { login } = useAuth();

  const [staffList, setStaffList] = useState([]);
  const [selectedStaffId, setSelectedStaffId] = useState(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const MIN_PIN = 4;
  const MAX_PIN = 6;

  // この画面が表示された端末はフロント端末とみなす（ログイン後 /front に留まる）
  useEffect(() => {
    markFrontDevice();
  }, []);

  // スタッフ一覧取得（既存API /auth/staff-list を再利用）
  useEffect(() => {
    api.get('/auth/staff-list')
      .then(data => {
        const list = data.staff || [];
        setStaffList(list);
        if (list.length > 0) setSelectedStaffId(list[0].id);
      })
      .catch(() => setError('スタッフ一覧の取得に失敗しました'));
  }, []);

  const submit = useCallback(async () => {
    if (submitting || selectedStaffId == null || pin.length < MIN_PIN) return;
    setSubmitting(true);
    setError('');
    try {
      await login(Number(selectedStaffId), pin);
      // 成功時は AuthContext の状態更新で FrontApp が描画を切り替える。
      // 初回PIN変更（must_change_pin）は FrontApp 側のゲートで強制する。
    } catch (err) {
      // 失敗: ドットを赤く2回シェイク → 自動クリア（mock #scr-login 挙動）
      setError(err instanceof ApiError ? err.message : 'ログインに失敗しました');
      setShake(true);
      setTimeout(() => { setShake(false); setPin(''); }, 700);
    } finally {
      setSubmitting(false);
    }
  }, [submitting, selectedStaffId, pin, login]);

  const pressKey = (n) => {
    setError('');
    setPin(prev => (prev.length >= MAX_PIN ? prev : prev + n));
  };
  const pressDel = () => { setError(''); setPin(prev => prev.slice(0, -1)); };

  // 物理キーボードも並行受付（PC・外付けキーボード互換。仕様書 §4.1）
  useEffect(() => {
    const onKey = (e) => {
      if (e.key >= '0' && e.key <= '9') pressKey(e.key);
      else if (e.key === 'Backspace') pressDel();
      else if (e.key === 'Enter') submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submit]);

  const canSubmit = pin.length >= MIN_PIN && !submitting;

  return (
    <div className="fpin">
      <div className="fpin__brand">
        <img src="/coral-icon-dark.svg?v=2" alt="CORAL PMS" className="fpin__logo" />
        <div className="fpin__title">CORAL PMS</div>
        <div className="fpin__sub">HOTEL PATINA ISHIGAKIJIMA</div>
      </div>

      <div className="fpin__card">
        {/* 左: スタッフ選択（タイプさせない） */}
        <div className="fpin__staffpane">
          <div className="fpin__label">スタッフを選択</div>
          <div className="fpin__stafflist">
            {staffList.map(s => (
              <button
                key={s.id}
                type="button"
                className={`fpin__staffbtn ${selectedStaffId === s.id ? 'is-selected' : ''}`}
                onClick={() => { setSelectedStaffId(s.id); setPin(''); setError(''); }}
              >
                {s.staff_name}
              </button>
            ))}
          </div>
        </div>

        {/* 右: PIN入力 */}
        <div className="fpin__pinpane">
          <div className="fpin__label">PINを入力</div>
          <div className={`fpin__dots ${shake ? 'is-error' : ''}`}>
            {Array.from({ length: MAX_PIN }, (_, i) => (
              <span key={i} className={`fpin__dot ${i < pin.length ? 'is-filled' : ''}`} />
            ))}
          </div>
          <div className="fpin__error">{error}</div>
          <div className="fpin__pad">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
              <button key={n} type="button" className="fpin__key" onClick={() => pressKey(String(n))}>{n}</button>
            ))}
            <button type="button" className="fpin__key fpin__key--ghost" onClick={pressDel} aria-label="訂正">⌫</button>
            <button type="button" className="fpin__key" onClick={() => pressKey('0')}>0</button>
            <button
              type="button"
              className={`fpin__key fpin__key--enter ${canSubmit ? '' : 'is-disabled'}`}
              onClick={submit}
              aria-label="ログイン"
            >⏎</button>
          </div>
        </div>
      </div>
    </div>
  );
}
