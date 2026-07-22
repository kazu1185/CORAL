import { useState } from 'react';
import { api, ApiError } from '../api/client';
import './PinChangeDialog.css';

export default function PinChangeDialog({ onComplete, onCancel }) {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPin.length < 4 || newPin.length > 6) {
      setError('新しいPINは4〜6桁で入力してください');
      return;
    }

    if (newPin !== confirmPin) {
      setError('新しいPINが一致しません');
      return;
    }

    setSubmitting(true);
    try {
      await api.put('/auth/pin', { current_pin: currentPin, new_pin: newPin });
      onComplete();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('PIN変更に失敗しました');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pin-dialog__overlay">
      <form className="pin-dialog" onSubmit={handleSubmit}>
        <h2 className="pin-dialog__title">PIN変更</h2>
        <p className="pin-dialog__desc">初回ログインのため、PINの変更が必要です。</p>

        <div className="pin-dialog__field">
          <label className="pin-dialog__label">現在のPIN</label>
          <input
            type="password"
            className="pin-dialog__input"
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            maxLength={6}
            autoFocus
          />
        </div>

        <div className="pin-dialog__field">
          <label className="pin-dialog__label">新しいPIN</label>
          <input
            type="password"
            className="pin-dialog__input"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            maxLength={6}
          />
        </div>

        <div className="pin-dialog__field">
          <label className="pin-dialog__label">新しいPIN（確認）</label>
          <input
            type="password"
            className="pin-dialog__input"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            maxLength={6}
          />
        </div>

        {error && (
          <div className="pin-dialog__error">
            <span className="material-symbols-outlined">error</span>
            {error}
          </div>
        )}

        <div className="pin-dialog__actions">
          <button type="button" className="pin-dialog__cancel" onClick={onCancel}>
            スキップ
          </button>
          <button
            type="submit"
            className="pin-dialog__submit"
            disabled={submitting || !currentPin || !newPin || !confirmPin}
          >
            {submitting ? '変更中...' : '変更する'}
          </button>
        </div>
      </form>
    </div>
  );
}
