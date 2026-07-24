import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useConfirm } from '../../components/ConfirmDialog';
import { dayDiff } from '../../utils/date';
import { MERGE_ALERT_TYPE_LABELS } from '../../utils/constants';

/**
 * 予約詳細の各種操作ダイアログ
 * （部屋タイプ変更・ゲスト紐付け・日程変更・部屋移動・統合分解確認）
 * ReservationDetailPage.jsx が2,200行超に肥大化したため分割（2026-06-11）
 */
export function RoomTypeChangeDialog({ reservation, roomTypes, onConfirm, onCancel }) {
  const [selected, setSelected] = useState(reservation.room_type);

  return (
    <>
      <div className="rd__overlay" onClick={onCancel} />
      <div className="rd__dialog">
        <h2 className="rd__dialog-title">部屋タイプ変更</h2>
        <p>現在: <strong>{reservation.room_type_name || reservation.room_type}</strong></p>

        <div className="rd__dialog-field">
          <label className="rd__dialog-label">変更先の部屋タイプ</label>
          <select className="rd__dialog-select" value={selected} onChange={(e) => setSelected(e.target.value)}>
            {roomTypes.map(rt => (
              <option key={rt.type_code} value={rt.type_code}>{rt.type_name}（定員{rt.max_adults}名 / {Number(rt.default_rate).toLocaleString()}円〜）</option>
            ))}
          </select>
        </div>

        <div className="rd__dialog-actions">
          <button className="rd__dialog-cancel" onClick={onCancel}>キャンセル</button>
          <button className="rd__dialog-confirm" disabled={selected === reservation.room_type} onClick={() => onConfirm(selected)}>変更する</button>
        </div>
      </div>
    </>
  );
}

/**
 * ゲスト紐付けダイアログ（名寄せ）
 *
 * 運用フロー:
 * - TL取込時に自動作成されたゲスト（情報が薄い）を、既存のゲスト（住所・パスポート等が充実）に寄せる
 * - 候補をクリック → この予約のguest_idを候補のゲストに差し替え
 * - 旧ゲストに紐づく他の予約も一括で移行するかを確認
 */
export function LinkGuestDialog({ reservation, onLinked, onCancel }) {
  const { confirm: showConfirm, alert: showAlert } = useConfirm();
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [searching, setSearching] = useState(false);
  const [autoSearched, setAutoSearched] = useState(false);
  // 新規ゲスト登録モード
  const [showNewForm, setShowNewForm] = useState(false);
  // 新規登録フォームはTL予約通知から届いた情報（取込時に仮ゲストへ保存済み）をプリフィルする。
  // 空のフォームに手入力し直すのは二度手間なため（2026-07-25 ユーザー要望）。
  // 仮ゲスト未作成（guest_id NULL）の場合はTL原本名でフォールバックし、
  // 英数字のみならローマ字欄・それ以外は漢字欄へ入れる（TlImportServiceの振り分けと同じ発想）
  const tlName = [reservation.tl_last_name, reservation.tl_first_name].filter(Boolean).join(' ').trim();
  const tlNameIsAscii = /^[\x20-\x7E]*$/.test(tlName);
  const [newGuest, setNewGuest] = useState({
    name_kanji: reservation.name_kanji || (!tlNameIsAscii ? tlName : ''),
    name_kana: reservation.name_kana || '',
    name_romaji: reservation.name_romaji || (tlNameIsAscii ? tlName : ''),
    phone: reservation.guest_phone || '',
    email: reservation.guest_email || '',
  });
  const [creating, setCreating] = useState(false);

  // 初回表示時にguest_idから自動検索
  useEffect(() => {
    if (!autoSearched && reservation.guest_id) {
      setAutoSearched(true);
      api.get(`/guests/match?guest_id=${reservation.guest_id}`)
        .then(res => setCandidates(res.candidates || []))
        .catch(() => {});
    }
  }, [reservation.guest_id, autoSearched]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await api.get(`/guests/match?q=${encodeURIComponent(query.trim())}`);
      setCandidates(res.candidates || []);
    } catch { /* ignore */ }
    setSearching(false);
  };

  const handleLink = async (candidate) => {
    // 確認: 既存ゲストに寄せる方向であることを明示
    const candidateName = candidate.name || candidate.guest_code;
    const currentName = reservation.guest_name || `${reservation.tl_last_name} ${reservation.tl_first_name}`;
    const msg = [
      `この予約を以下の既存ゲストに紐付けます:`,
      ``,
      `【紐付け先】${candidateName}（${candidate.guest_code}）`,
      candidate.phone ? `  電話: ${candidate.phone}` : null,
      candidate.address ? `  住所: ${candidate.address}` : null,
      candidate.stay_count > 0 ? `  来館${candidate.stay_count}回` : null,
      ``,
      `現在のゲスト（${currentName}）の他の予約も一緒に移行します。`,
    ].filter(Boolean).join('\n');

    if (!await showConfirm('ゲスト紐付け', msg)) return;

    try {
      // migrate_all=true で旧ゲストの全予約を移行
      await api.post(`/reservations/${reservation.id}/link-guest`, {
        guest_id: candidate.id,
        migrate_all: true,
      });
      onLinked();
    } catch (err) {
      showAlert('エラー', err.message);
    }
  };

  // 新規ゲストを作成 → 即座にこの予約にリンク
  const handleCreateAndLink = async () => {
    const { name_kanji, name_kana, name_romaji } = newGuest;
    if (!name_kanji && !name_kana && !name_romaji) {
      showAlert('エラー', '名前（漢字・カナ・ローマ字のいずれか）を入力してください');
      return;
    }
    setCreating(true);
    try {
      // 1. ゲスト新規作成
      const created = await api.post('/guests', {
        name_kanji: newGuest.name_kanji || null,
        name_kana: newGuest.name_kana || null,
        name_romaji: newGuest.name_romaji || null,
        phone: newGuest.phone || null,
        email: newGuest.email || null,
      });
      // 2. この予約にリンク
      await api.post(`/reservations/${reservation.id}/link-guest`, {
        guest_id: created.id,
        migrate_all: false, // 新規作成なので他の予約は移行しない
      });
      onLinked();
    } catch (err) {
      showAlert('エラー', err.message);
    }
    setCreating(false);
  };

  const guestName = reservation.guest_name || `${reservation.tl_last_name} ${reservation.tl_first_name}`;

  return (
    <>
      <div className="rd__overlay" onClick={onCancel} />
      <div className="rd__dialog rd__dialog--wide">
        <h2 className="rd__dialog-title">ゲスト紐付け（名寄せ）</h2>
        <p className="rd__dialog-sub">
          この予約（{guestName}）を既存のゲストに紐付けるか、新規ゲストを登録します。
        </p>

        {/* タブ切り替え: 既存検索 / 新規登録 */}
        <div className="rd__link-tabs">
          <button
            className={`rd__link-tab ${!showNewForm ? 'rd__link-tab--active' : ''}`}
            onClick={() => setShowNewForm(false)}
          >
            既存ゲストを検索
          </button>
          <button
            className={`rd__link-tab ${showNewForm ? 'rd__link-tab--active' : ''}`}
            onClick={() => setShowNewForm(true)}
          >
            新規ゲスト登録
          </button>
        </div>

        {!showNewForm ? (
          <>
            {/* ── 既存ゲスト検索 ── */}
            <div className="rd__link-guest-search">
              <input
                type="text"
                className="rd__dialog-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="ゲスト名・カナ・ローマ字・電話番号で検索"
                autoFocus
              />
              <button className="rd__dialog-search-btn" onClick={handleSearch} disabled={searching}>
                {searching ? '検索中...' : '検索'}
              </button>
            </div>

            <div className="rd__link-guest-results">
              {candidates.length === 0 ? (
                <p className="rd__empty">候補が見つかりません</p>
              ) : (
                candidates.map(c => (
                  <button key={c.id} className="rd__link-guest-item" onClick={() => handleLink(c)}>
                    {(() => {
                      const mf = c.matched_fields || [];
                      const hl = (field, content) => mf.includes(field)
                        ? <span className="rd__match-highlight">{content}</span>
                        : <span>{content}</span>;
                      return <>
                        <div className="rd__link-guest-name">
                          {hl('name_kanji', c.name)}
                          <span className="rd__link-guest-code">{c.guest_code}</span>
                          {c.is_vip && <span className="rd__vip">VIP</span>}
                        </div>
                        <div className="rd__link-guest-detail">
                          {c.name_kana && c.name_kana !== c.name && hl('name_kana', c.name_kana)}
                          {c.name_romaji && c.name_romaji !== c.name && hl('name_romaji', c.name_romaji)}
                          {c.phone && hl('phone', `📞 ${c.phone}`)}
                          {c.email && hl('email', `✉ ${c.email}`)}
                          {c.country_code && c.country_code !== 'JP' && <span>🌐 {c.country_code}</span>}
                        </div>
                        <div className="rd__link-guest-meta">
                          <span>予約{c.reservation_count}件</span>
                          {c.stay_count > 0 && <span>来館{c.stay_count}回</span>}
                          {c.last_stay_date && <span>最終: {c.last_stay_date}</span>}
                        </div>
                      </>;
                    })()}
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            {/* ── 新規ゲスト登録フォーム ── */}
            <div className="rd__new-guest-form">
              <div className="rd__dialog-field">
                <label className="rd__dialog-label">名前（漢字）</label>
                <input className="rd__dialog-input" value={newGuest.name_kanji}
                  onChange={(e) => setNewGuest(g => ({ ...g, name_kanji: e.target.value }))}
                  placeholder="山田 太郎" autoFocus />
              </div>
              <div className="rd__dialog-field">
                <label className="rd__dialog-label">名前（カナ）</label>
                <input className="rd__dialog-input" value={newGuest.name_kana}
                  onChange={(e) => setNewGuest(g => ({ ...g, name_kana: e.target.value }))}
                  placeholder="ヤマダ タロウ" />
              </div>
              <div className="rd__dialog-field">
                <label className="rd__dialog-label">名前（ローマ字）</label>
                <input className="rd__dialog-input" value={newGuest.name_romaji}
                  onChange={(e) => setNewGuest(g => ({ ...g, name_romaji: e.target.value }))}
                  placeholder="Yamada Tarou" />
              </div>
              <div className="rd__dialog-field">
                <label className="rd__dialog-label">電話番号</label>
                <input className="rd__dialog-input" value={newGuest.phone}
                  onChange={(e) => setNewGuest(g => ({ ...g, phone: e.target.value }))}
                  placeholder="09012345678" />
              </div>
              <div className="rd__dialog-field">
                <label className="rd__dialog-label">メール</label>
                <input className="rd__dialog-input" value={newGuest.email}
                  onChange={(e) => setNewGuest(g => ({ ...g, email: e.target.value }))}
                  placeholder="guest@example.com" />
              </div>
            </div>

            <div className="rd__dialog-actions" style={{ marginTop: 12 }}>
              <button className="rd__dialog-cancel" onClick={() => setShowNewForm(false)}>戻る</button>
              <button className="rd__dialog-confirm" onClick={handleCreateAndLink} disabled={creating}>
                {creating ? '登録中...' : '登録してこの予約に紐付け'}
              </button>
            </div>
          </>
        )}

        {!showNewForm && (
          <div className="rd__dialog-actions">
            <button className="rd__dialog-cancel" onClick={onCancel}>閉じる</button>
          </div>
        )}
      </div>
    </>
  );
}

export function DateChangeDialog({ reservation, onConfirm, onCancel }) {
  const [ciDate, setCiDate] = useState(reservation.checkin_date);
  const [coDate, setCoDate] = useState(reservation.checkout_date);
  const nights = Math.max(0, dayDiff(ciDate, coDate));
  const isValid = nights >= 1;
  const hasChanged = ciDate !== reservation.checkin_date || coDate !== reservation.checkout_date;

  return (
    <>
      <div className="rd__overlay" onClick={onCancel} />
      <div className="rd__dialog">
        <h2 className="rd__dialog-title">日程変更</h2>
        <p>ゲスト: <strong>{reservation.guest_name || `${reservation.tl_last_name} ${reservation.tl_first_name}`}</strong></p>

        <div className="rd__dialog-field">
          <label className="rd__dialog-label">チェックイン日</label>
          <input type="date" className="rd__dialog-input" value={ciDate} onChange={(e) => setCiDate(e.target.value)} />
        </div>
        <div className="rd__dialog-field">
          <label className="rd__dialog-label">チェックアウト日</label>
          <input type="date" className="rd__dialog-input" value={coDate} min={ciDate} onChange={(e) => setCoDate(e.target.value)} />
        </div>

        <p style={{ fontSize: '13px', color: isValid ? 'var(--text-secondary)' : 'var(--accent-red)', marginTop: 8 }}>
          {isValid ? `${nights}泊` : 'CO日はCI日より後にしてください'}
        </p>

        <div className="rd__dialog-actions">
          <button className="rd__dialog-cancel" onClick={onCancel}>キャンセル</button>
          <button className="rd__dialog-confirm" disabled={!isValid || !hasChanged} onClick={() => onConfirm(ciDate, coDate)}>
            日程を変更する
          </button>
        </div>
      </div>
    </>
  );
}

export function RoomMoveDialog({ reservation, rooms, onMove, onCancel }) {
  const [selectedRoom, setSelectedRoom] = useState('');
  const activeAssign = reservation.assignments?.find(a => a.status === 'active');
  const currentRoomId = activeAssign ? Number(activeAssign.room_id) : null;
  const availableRooms = rooms.filter(r => r.id !== currentRoomId && r.status === 'available');

  const handleSubmit = () => {
    if (!selectedRoom || !activeAssign) return;
    onMove(activeAssign.id, Number(selectedRoom));
  };

  return (
    <>
      <div className="rd__overlay" onClick={onCancel} />
      <div className="rd__dialog">
        <h2 className="rd__dialog-title">部屋移動</h2>
        <p>ゲスト: <strong>{reservation.guest_name || `${reservation.tl_last_name} ${reservation.tl_first_name}`}</strong></p>
        <p>現在の部屋: <strong>{activeAssign?.room_number || '未アサイン'}</strong></p>

        <label className="rd__dialog-label">移動先の部屋</label>
        <select className="rd__dialog-select" value={selectedRoom} onChange={(e) => setSelectedRoom(e.target.value)}>
          <option value="">選択してください</option>
          {availableRooms.map(r => (
            <option key={r.id} value={r.id}>{r.room_number} ({r.type_name})</option>
          ))}
        </select>

        <div className="rd__dialog-actions">
          <button className="rd__dialog-cancel" onClick={onCancel}>キャンセル</button>
          <button className="rd__dialog-confirm" disabled={!selectedRoom} onClick={handleSubmit}>部屋を移動する</button>
        </div>
      </div>
    </>
  );
}

/**
 * merge_alert 承認ダイアログ
 * 統合を全解除して各予約を独立に戻す確認画面
 */
export function MergeAlertResolveDialog({ reservation, alerts, sources, onConfirm, onCancel }) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    // 最初のアラートのevent_idで処理（複数ある場合も全解除なので1回で済む）
    await onConfirm(alerts[0].event_id);
    setLoading(false);
  };

  return (
    <>
      <div className="rd__dialog-overlay" onClick={onCancel} />
      <div className="rd__dialog rd__dialog--wide">
        <h3 className="rd__dialog-title">統合予約の分解確認</h3>

        <p className="rd__dialog-text">
          以下の変更通知を受けたため、統合を解除してすべての予約を独立に戻します。
        </p>

        <div className="rd__merge-resolve-section">
          <h4 className="rd__merge-resolve-heading">変更内容</h4>
          {alerts.map((a, i) => {
            const beforeN = a.before_ci && a.before_co ? dayDiff(a.before_ci, a.before_co) : null;
            const afterN = a.after_ci && a.after_co ? dayDiff(a.after_ci, a.after_co) : null;
            return (
              <div key={i} className="rd__merge-resolve-change">
                <span className="rd__merge-resolve-channel">{a.channel}</span>
                <span>{a.source_reservation_no}</span>
                <span className="rd__merge-resolve-type">{MERGE_ALERT_TYPE_LABELS[a.alert_type] || a.alert_type}</span>
                {a.before_ci && (
                  <div className="rd__merge-resolve-dates">
                    {a.before_ci} ~ {a.before_co}（{beforeN}泊）
                    <span className="material-symbols-outlined" style={{ fontSize: '16px', verticalAlign: 'middle' }}>arrow_forward</span>
                    {a.after_ci} ~ {a.after_co}（{afterN}泊）
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="rd__merge-resolve-section">
          <h4 className="rd__merge-resolve-heading">分解後の予約</h4>
          {sources?.filter(s => s.status === 'active').map((s, i) => {
            // 変更対象のソースは変更後の日程を表示
            const matchedAlert = alerts.find(a => a.channel === s.channel && a.source_reservation_no === s.reservation_no);
            const ci = matchedAlert?.after_ci || s.checkin_date;
            const co = matchedAlert?.after_co || s.checkout_date;
            const nights = dayDiff(ci, co);
            const isChanged = !!matchedAlert;
            return (
              <div key={i} className={`rd__merge-resolve-source ${isChanged ? 'rd__merge-resolve-source--changed' : ''}`}>
                <span className="rd__merge-resolve-channel">{s.channel}</span>
                <span>{s.reservation_no}</span>
                <span>{ci} ~ {co}</span>
                <span>{nights}泊</span>
                {isChanged && <span className="rd__merge-resolve-badge">変更適用</span>}
              </div>
            );
          })}
        </div>

        <div className="rd__merge-resolve-note">
          ※ 部屋のアサインは解除されます。分解後に再度アサインしてください。
        </div>

        <div className="rd__dialog-actions">
          <button className="rd__dialog-cancel" onClick={onCancel} disabled={loading}>キャンセル</button>
          <button className="rd__dialog-confirm rd__dialog-confirm--red" onClick={handleConfirm} disabled={loading}>
            {loading ? '処理中...' : '分解を実行'}
          </button>
        </div>
      </div>
    </>
  );
}
