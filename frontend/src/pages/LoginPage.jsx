import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api, ApiError } from '../api/client';
import PinChangeDialog from '../components/PinChangeDialog';
import './LoginPage.css';

export default function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const navigate = useNavigate();

  const [staffList, setStaffList] = useState([]);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPinChange, setShowPinChange] = useState(false);

  // 既にログイン済みならダッシュボードへ
  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard', { replace: true });
  }, [isAuthenticated, navigate]);

  // スタッフ一覧取得
  useEffect(() => {
    api.get('/auth/staff-list')
      .then(data => {
        setStaffList(data.staff || []);
        if (data.staff?.length > 0) {
          setSelectedStaffId(String(data.staff[0].id));
        }
      })
      .catch(() => setError('スタッフ一覧の取得に失敗しました'));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedStaffId || !pin) return;

    setError('');
    setSubmitting(true);

    try {
      const data = await login(Number(selectedStaffId), pin);
      if (data.staff.must_change_pin) {
        setShowPinChange(true);
      } else {
        navigate('/dashboard', { replace: true });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('ログインに失敗しました');
      }
      setPin('');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePinChanged = () => {
    setShowPinChange(false);
    navigate('/dashboard', { replace: true });
  };

  return (
    <div className="login">
      <form className="login__card" onSubmit={handleSubmit}>
        <div className="login__header">
          <img src="/logo-vertical.svg" alt="Hotel Patina Ishigakijima" className="login__logo" />
          <p className="login__subtitle">PMS ログイン</p>
        </div>

        <div className="login__field">
          <label className="login__label" htmlFor="staff-select">スタッフ</label>
          <select
            id="staff-select"
            className="login__select"
            value={selectedStaffId}
            onChange={(e) => setSelectedStaffId(e.target.value)}
          >
            {staffList.map(s => (
              <option key={s.id} value={s.id}>{s.staff_name}</option>
            ))}
          </select>
        </div>

        <div className="login__field">
          <label className="login__label" htmlFor="pin-input">PIN</label>
          <input
            id="pin-input"
            type="password"
            className="login__input"
            value={pin}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 6);
              setPin(v);
            }}
            placeholder="4〜6桁の数字"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            autoFocus
          />
          <div className="login__dots">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className={`login__dot ${i < pin.length ? 'login__dot--filled' : ''}`} />
            ))}
          </div>
        </div>

        {error && (
          <div className="login__error">
            <span className="material-symbols-outlined">error</span>
            {error}
          </div>
        )}

        <button
          type="submit"
          className="login__button"
          disabled={submitting || !pin || !selectedStaffId}
        >
          {submitting ? 'ログイン中...' : 'ログイン'}
        </button>
      </form>

      {showPinChange && (
        <PinChangeDialog onComplete={handlePinChanged} onCancel={() => setShowPinChange(false)} />
      )}
    </div>
  );
}
