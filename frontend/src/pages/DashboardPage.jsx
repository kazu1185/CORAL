import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePolling } from '../hooks/usePolling';
import { api } from '../api/client';
import { OTA_LABELS } from '../utils/constants';
import './DashboardPage.css';

const SEVERITY_CLASS = { red: 'alert--red', yellow: 'alert--yellow' };

export default function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await api.get('/dashboard');
      setData(res);
    } catch { /* Header側でも取得しているのでここでは無視 */ }
  }, []);

  usePolling(fetchDashboard, 10000);

  if (!data) {
    return <div className="dash__loading">読み込み中...</div>;
  }

  const { summary, alerts, checkin_list, checkout_list, tomorrow, tl_logs } = data;

  // TL取込エラーを手動で対応済みにする
  const resolveTlError = async (logId, e) => {
    e.stopPropagation(); // 親buttonのクリックイベントを止める
    try {
      await api.post('/dashboard/resolve-tl-error', { log_id: logId });
      // ローカルstateから即座に除去（再フェッチを待たない）
      setData(prev => ({
        ...prev,
        alerts: prev.alerts.filter(a => !(a.type === 'tl_error' && a.log_id === logId)),
      }));
    } catch { /* ポーリングで次回消える */ }
  };

  const resolveAllTlErrors = async () => {
    try {
      await api.post('/dashboard/resolve-tl-errors');
      setData(prev => ({
        ...prev,
        alerts: prev.alerts.filter(a => a.type !== 'tl_error'),
      }));
    } catch { /* ポーリングで次回消える */ }
  };

  const hasTlErrors = alerts.filter(a => a.type === 'tl_error').length;

  return (
    <div className="dash">
      {/* アラート */}
      <section className="dash__section">
        <div className="dash__section-header">
          <h2 className="dash__section-title">アラート</h2>
          {hasTlErrors >= 2 && (
            <button className="dash__resolve-all" onClick={resolveAllTlErrors}>
              TLエラーをすべて対応済みにする
            </button>
          )}
        </div>
        {alerts.length === 0 ? (
          <div className="dash__no-alert">対応事項はありません</div>
        ) : (
          <div className="dash__alerts">
            {alerts.map((a, i) => (
              <button
                key={a.log_id || i}
                className={`dash__alert ${SEVERITY_CLASS[a.severity] || ''}`}
                onClick={() => a.reservation_id && navigate(`/reservations/${a.reservation_id}`)}
              >
                <span className="material-symbols-outlined dash__alert-icon">
                  {a.type === 'merge_alert' ? 'link_off' : a.severity === 'red' ? 'error' : 'warning'}
                </span>
                <div className="dash__alert-body">
                  <span className="dash__alert-msg">{a.message}</span>
                  <span className="dash__alert-detail">{a.detail}</span>
                </div>
                {/* TL取込エラーのみ: 対応済みボタン */}
                {a.type === 'tl_error' && (
                  <span
                    className="dash__alert-dismiss"
                    title="対応済みにする"
                    onClick={(e) => resolveTlError(a.log_id, e)}
                  >
                    <span className="material-symbols-outlined">close</span>
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* CI/CO リスト */}
      <div className="dash__lists">
        <section className="dash__section dash__section--half">
          <div className="dash__section-header">
            <h2 className="dash__section-title">
              チェックイン予定
              <span className="dash__count">{summary.checkin_done}/{summary.checkin_today}</span>
            </h2>
            <button className="dash__link" onClick={() => navigate('/reservations?status=confirmed')}>
              全件表示
            </button>
          </div>
          <GuestList items={checkin_list} timeKey="checkin_at" navigate={navigate} />
        </section>

        <section className="dash__section dash__section--half">
          <div className="dash__section-header">
            <h2 className="dash__section-title">
              チェックアウト予定
              <span className="dash__count">{summary.checkout_done}/{summary.checkout_today}</span>
            </h2>
            <button className="dash__link" onClick={() => navigate('/reservations?status=checked_in')}>
              全件表示
            </button>
          </div>
          <GuestList items={checkout_list} timeKey="checkout_at" navigate={navigate} />
        </section>
      </div>

      {/* 下段: 明日プレビュー + TLログ */}
      <div className="dash__lists">
        <section className="dash__section dash__section--half">
          <h2 className="dash__section-title">明日のプレビュー</h2>
          <div className="dash__tomorrow">
            <TomorrowItem label="CI予定" value={`${tomorrow.checkin_count}件`} />
            <TomorrowItem label="CO予定" value={`${tomorrow.checkout_count}件`} />
            <TomorrowItem label="稼働率予測" value={`${tomorrow.occupancy_forecast.occupied}/${tomorrow.occupancy_forecast.total}室 (${tomorrow.occupancy_forecast.rate}%)`} />
          </div>
        </section>

        <section className="dash__section dash__section--half">
          <h2 className="dash__section-title">TL受信ログ</h2>
          <div className="dash__tl-logs">
            {tl_logs.length === 0 ? (
              <div className="dash__empty">ログなし</div>
            ) : (
              tl_logs.map((log, i) => (
                <div key={i} className={`dash__tl-row ${log.status === 'error' ? 'dash__tl-row--error' : ''}`}>
                  <span className="dash__tl-time">{log.time}</span>
                  <span className={`dash__tl-channel ota-${log.channel}`}>
                    {OTA_LABELS[log.channel] || log.channel}
                  </span>
                  <span className="dash__tl-no">{log.reservation_no}</span>
                  <span className={`dash__tl-status dash__tl-status--${log.status}`}>
                    {log.status === 'success' ? 'OK' : 'ERR'}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function GuestList({ items, timeKey, navigate }) {
  if (!items || items.length === 0) {
    return <div className="dash__empty">該当なし</div>;
  }
  return (
    <div className="dash__guest-list">
      {items.map((item) => (
        <button
          key={item.reservation_id}
          className="dash__guest-row"
          onClick={() => navigate(`/reservations/${item.reservation_id}`)}
        >
          <div className="dash__guest-info">
            <span className="dash__guest-name">{item.guest_name}</span>
            <span className="dash__guest-meta">
              {item.room_number ? `${item.room_number} ${item.room_type}` : '未アサイン'}
            </span>
          </div>
          <div className="dash__guest-right">
            <span className={`dash__ota ota-${item.channel}`}>
              {OTA_LABELS[item.channel] || item.channel}
            </span>
            {item[timeKey] && (
              <span className="dash__guest-time">{item[timeKey]}</span>
            )}
            <StatusBadge status={item.status} />
            {Number(item.unpaid_amount) > 0 && <span className="dash__unpaid">未精算</span>}
          </div>
        </button>
      ))}
    </div>
  );
}

function StatusBadge({ status }) {
  const labels = {
    confirmed: '予約確定', checked_in: 'CI済', checked_out: 'CO済',
    cancelled: 'キャンセル', no_show: 'ノーショー',
  };
  return (
    <span className={`dash__status dash__status--${status}`}>
      {labels[status] || status}
    </span>
  );
}

function TomorrowItem({ label, value }) {
  return (
    <div className="dash__tomorrow-item">
      <span className="dash__tomorrow-label">{label}</span>
      <span className="dash__tomorrow-value">{value}</span>
    </div>
  );
}
