import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import './Header.css';

export default function Header() {
  const { staff, logout } = useAuth();
  const navigate = useNavigate();
  const [clock, setClock] = useState(formatTime());
  // 時計更新（毎秒）
  useEffect(() => {
    const id = setInterval(() => setClock(formatTime()), 1000);
    return () => clearInterval(id);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="header">
      <div className="header__top">
        <img src="/logo-horizontal.svg" alt="Hotel Patina Ishigakijima" className="header__logo" />
        <div className="header__right">
          <span className="header__clock">{clock}</span>
          <span className="header__staff">
            <span className="material-symbols-outlined header__staff-icon">person</span>
            {staff?.staff_name}
          </span>
          <button className="header__logout" onClick={handleLogout}>
            <span className="material-symbols-outlined">logout</span>
          </button>
        </div>
      </div>

    </header>
  );
}

function formatTime() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][now.getDay()];
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${month}/${day}(${weekday}) ${hours}:${minutes}`;
}
