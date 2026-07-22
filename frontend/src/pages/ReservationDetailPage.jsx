import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useConfirm } from '../components/ConfirmDialog';
import { GuestDetailModal } from './GuestDetailPage';
import { OTA_LABELS, RESERVATION_STATUS_SHORT as STATUS_LABELS, MERGE_ALERT_TYPE_LABELS } from '../utils/constants';
import { dayDiff, addDays, todayStr, fmtDateTime } from '../utils/date';
import GroupReservationPage from './GroupReservationPage';
// 2,200行超に肥大化していたため、セクション・ダイアログ群を reservation-detail/ に分割（2026-06-11）
import { TimelineDetailPopover } from './reservation-detail/Timeline';
import { AttrRow, PaxEditor, CountryPicker, GuestNotesEditor } from './reservation-detail/GuestSection';
import { EditableChargesTable } from './reservation-detail/ChargesTable';
import { CheckinDialog, CheckoutDialog } from './reservation-detail/CheckinCheckoutDialogs';
import { ReceiptIssueDialog, DocumentListSection } from './reservation-detail/ReceiptDialogs';
import { RoomTypeChangeDialog, LinkGuestDialog, DateChangeDialog, RoomMoveDialog, MergeAlertResolveDialog } from './reservation-detail/MiscDialogs';
import { GroupReservationCard } from './reservation-detail/GroupReservationCard';
import './ReservationDetailPage.css';


export default function ReservationDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { confirm: showConfirm, alert: showAlert, prompt: showPrompt } = useConfirm();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null); // 'checkin' | 'checkout' | 'room_move' | 'link_guest' | 'receipt' | null
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [allRooms, setAllRooms] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  // 顧客詳細モーダル: ゲストIDをセットするとモーダルが開く
  const [guestModalId, setGuestModalId] = useState(null);
  const [showTelegram, setShowTelegram] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get(`/reservations/${id}`);
      setData(res);
      setNotes(res.reservation_notes || '');
    } catch {
      navigate('/reservations', { replace: true });
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 部屋移動用の部屋一覧・部屋タイプマスタ取得
  useEffect(() => {
    api.get('/rooms').then(d => setAllRooms(d.rooms || [])).catch(() => {});
    api.get('/master/room-types').then(d => setRoomTypes(d.room_types || [])).catch(() => {});
  }, []);

  const handleCheckin = async () => {
    try {
      await api.post(`/reservations/${id}/checkin`, { updated_at: data?.updated_at });
      setDialog(null);
      fetchData();
    } catch (err) {
      showAlert('エラー', err.message);
    }
  };

  const handleCheckout = async (opts) => {
    try {
      await api.post(`/reservations/${id}/checkout`, { ...opts, updated_at: data?.updated_at });
      setDialog(null);
      fetchData();
    } catch (err) {
      showAlert('エラー', err.message);
    }
  };

  const handleRoomMove = async (assignId, newRoomId) => {
    try {
      await api.post(`/assigns/${assignId}/move`, { new_room_id: newRoomId, source: 'detail' });
      setDialog(null);
      fetchData();
    } catch (err) {
      showAlert('エラー', err.message);
    }
  };

  const handleCancel = async () => {
    if (!await showConfirm('予約キャンセル', 'この予約をキャンセルしますか？\nアサインも解除されます。', { confirmColor: 'red', confirmLabel: 'キャンセルする' })) return;
    try {
      await api.post(`/reservations/${id}/cancel`, { updated_at: data?.updated_at });
      fetchData();
    } catch (err) { showAlert('エラー', err.message); }
  };

  const handleRestore = async () => {
    if (!await showConfirm('予約復元', 'この予約を「予約確定」に戻しますか？')) return;
    try {
      await api.post(`/reservations/${id}/restore`, { updated_at: data?.updated_at });
      fetchData();
    } catch (err) { showAlert('エラー', err.message); }
  };

  const handleDateChange = async (newCI, newCO) => {
    const nights = dayDiff(newCI, newCO);
    const hasAssign = d.assignments?.some(a => a.status === 'active');
    const msg = `CI日: ${d.checkin_date} → ${newCI}\nCO日: ${d.checkout_date} → ${newCO}\n泊数: ${d.nights}泊 → ${nights}泊${hasAssign ? '\n\n⚠ 現在のアサインは解除されます。変更後に再アサインしてください。' : ''}`;
    if (!await showConfirm('日程変更', msg)) return;
    try {
      await api.put(`/reservations/${id}`, { checkin_date: newCI, checkout_date: newCO, updated_at: data?.updated_at });
      setDialog(null);
      fetchData();
    } catch (err) { showAlert('エラー', err.message); }
  };

  const handleSaveNotes = async () => {
    setSaving(true);
    try {
      await api.put(`/reservations/${id}`, { reservation_notes: notes, updated_at: data?.updated_at });
    } catch (err) {
      showAlert('エラー', err.message);
    }
    setSaving(false);
  };

  if (loading || !data) {
    return <div className="rd__loading">読み込み中...</div>;
  }

  // グループ予約の親レコード → 専用のグループ管理画面を表示
  if (data.status === 'group_parent') {
    return <GroupReservationPage data={data} onRefresh={fetchData} />;
  }

  const d = data;
  const guestName = d.guest_name || `${d.tl_last_name} ${d.tl_first_name}`;
  const canCI = d.status === 'confirmed';
  const canCO = d.status === 'checked_in';
  const canCancel = d.status === 'confirmed';
  const canRestore = d.status === 'cancelled' || d.status === 'no_show';
  const isEarlyCheckout = canCO && d.checkout_date > todayStr();

  return (
    <div className="rd">
      {/* トップバー */}
      <div className="rd__topbar">
        <button className="rd__back" onClick={() => navigate(-1)}>
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <div className="rd__topbar-info">
          {d.assignments?.find(a => a.status === 'active') && (
            <span className="rd__room-number">{d.assignments.find(a => a.status === 'active').room_number}</span>
          )}
          <button className="rd__room-type rd__room-type--editable" onClick={() => setDialog('room_type')} title="クリックで部屋タイプ変更">
            {d.room_type_name || d.room_type}
            <span className="material-symbols-outlined rd__dates-edit-icon">edit</span>
          </button>
          <span className={`rd__status rd__status--${d.status}`}>{STATUS_LABELS[d.status]}</span>
          <button className="rd__dates rd__dates--editable" onClick={() => setDialog('dates')} title="クリックで日程変更">
            {d.checkin_date} ~ {d.checkout_date} ({d.nights}泊)
            <span className="material-symbols-outlined rd__dates-edit-icon">edit</span>
          </button>
          {d.channel ? (
            <span className={`rd__ota ota-${d.channel}`}>{OTA_LABELS[d.channel] || d.channel}</span>
          ) : (
            <span className="rd__ota rd__ota--merged">統合</span>
          )}
          <span className="rd__resv-no">{d.reservation_no || `#${d.id}`}</span>
        </div>
      </div>

      {/* アクションバー */}
      <div className="rd__actions">
        <button className="rd__action-btn rd__action-btn--ci" disabled={!canCI} onClick={() => setDialog('checkin')}>
          <span className="material-symbols-outlined">login</span> チェックイン
        </button>
        <button className="rd__action-btn rd__action-btn--co" disabled={!canCO} onClick={() => setDialog('checkout')}>
          <span className="material-symbols-outlined">logout</span> チェックアウト
        </button>
        <button className="rd__action-btn rd__action-btn--move" disabled={!canCO} onClick={() => setDialog('room_move')}>
          <span className="material-symbols-outlined">swap_horiz</span> 部屋移動
        </button>
        <button className="rd__action-btn rd__action-btn--receipt" onClick={() => setDialog('receipt')}>
          <span className="material-symbols-outlined">receipt_long</span> 領収書
        </button>
        {canCancel && (
          <button className="rd__action-btn rd__action-btn--cancel" onClick={handleCancel}>
            <span className="material-symbols-outlined">block</span> キャンセル
          </button>
        )}
        {canRestore && (
          <button className="rd__action-btn rd__action-btn--restore" onClick={handleRestore}>
            <span className="material-symbols-outlined">undo</span> 予約を復元
          </button>
        )}
      </div>

      {/* アラートバー */}
      {d.guest_match_status === 'pending' && (
        <div className="rd__alert rd__alert--yellow">
          ゲスト未確定 — マッチング待ち
          <button className="rd__alert-btn" onClick={() => setDialog('link_guest')}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>person_search</span>
            名寄せ
          </button>
        </div>
      )}
      {d.child_count > 0 && d.child_amount == null && (
        <div className="rd__alert rd__alert--blue">子供料金が未入力です</div>
      )}
      {d.pending_merge_alerts?.length > 0 && (
        <div className="rd__alert rd__alert--red">
          <div className="rd__alert-merge">
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>link_off</span>
            <div className="rd__alert-merge-body">
              <strong>統合予約の中の予約に変更通知があります</strong>
              {d.pending_merge_alerts.map((a, i) => {
                const typeLabel = MERGE_ALERT_TYPE_LABELS[a.alert_type] || '変更';
                const beforeN = a.before_ci && a.before_co ? dayDiff(a.before_ci, a.before_co) : null;
                const afterN = a.after_ci && a.after_co ? dayDiff(a.after_ci, a.after_co) : null;
                return (
                  <div key={i} className="rd__alert-merge-item">
                    {a.channel} {a.source_reservation_no}: {typeLabel}
                    {beforeN != null && afterN != null && `（${beforeN}泊→${afterN}泊）`}
                  </div>
                );
              })}
            </div>
            <button className="rd__alert-btn rd__alert-btn--red" onClick={() => setDialog('resolve_merge_alert')}>
              確認して分解
            </button>
          </div>
        </div>
      )}

      {/* 2カラム: 左=ゲスト+予約情報+メモ、右=売上明細 */}
      <div className="rd__columns">
        {/* 左カラム: ゲスト・予約情報・メモ類 */}
        <div className="rd__col rd__col--left">
          <div className="rd__card">
            <h3 className="rd__card-title">ゲスト</h3>
            <div className="rd__guest-name-row">
              <span className="rd__guest-name">{guestName}</span>
              {d.is_vip ? <span className="rd__vip">VIP</span> : null}
              {d.guest_id && (
                <button className="rd__guest-detail-btn" onClick={() => setGuestModalId(d.guest_id)} title="顧客詳細を開く">
                  <span className="material-symbols-outlined">person_search</span>
                </button>
              )}
              <button
                className={`rd__guest-change-btn ${d.has_match_candidates ? 'rd__guest-change-btn--has-candidates' : ''}`}
                onClick={() => setDialog('link_guest')}
                title={d.has_match_candidates ? '名寄せ候補があります' : 'ゲスト紐付け変更'}
              >
                <span className="material-symbols-outlined">swap_horiz</span>
                {d.has_match_candidates && <span className="rd__match-dot" />}
              </button>
            </div>
            {d.name_kana && d.name_kana !== guestName && (
              <div className="rd__guest-sub">{d.name_kana}</div>
            )}
            {d.name_romaji && d.name_romaji !== guestName && (
              <div className="rd__guest-sub">{d.name_romaji}</div>
            )}

            <div className="rd__attrs">
              <PaxEditor
                reservation={d}
                reservationId={d.id}
                updatedAt={d.updated_at}
                onSaved={fetchData}
              />
              {d.visit_count >= 1 && d.guest_id ? (
                <div className="rd__attr rd__attr--clickable" onClick={() => setGuestModalId(d.guest_id)} title="宿泊履歴を表示">
                  <span className="rd__attr-label">来館回数</span>
                  <span className="rd__attr-value rd__visit-link">{d.visit_count}回目 <span className="material-symbols-outlined" style={{ fontSize: 14 }}>open_in_new</span></span>
                </div>
              ) : (
                <AttrRow label="来館回数" value="—" />
              )}
              <CountryPicker
                guestId={d.guest_id}
                currentCode={d.country_code || 'JP'}
                onSaved={fetchData}
              />
            </div>
          </div>

          {/* 複数室グループ情報（子予約の場合のみ表示） */}
          {d.is_multi_room_child && d.child_reservations?.length > 0 && (
            <GroupReservationCard
              siblings={d.child_reservations}
              currentId={d.id}
              parentReservation={d.parent_reservation}
              navigate={navigate}
              onAction={fetchData}
            />
          )}

          {/* 統合元情報（統合予約の場合のみ表示） */}
          {d.is_merged_parent && d.merged_sources?.length > 0 && (
            <div className="rd__card">
              <h3 className="rd__card-title">
                統合元予約
                {d.can_split && (
                  <button className="rd__split-btn" onClick={async () => {
                    const minDate = addDays(d.checkin_date, 1);
                    // 最大はCO日の前日。CO日当日を許すと後半が0泊の予約になるため（検証報告 #2）
                    const maxDate = addDays(d.checkout_date, -1);
                    const splitDate = await showPrompt(
                      '予約の分割',
                      '統合予約を指定日で前半・後半の2つに分割します。\n※ 元の予約に戻す操作ではありません。',
                      {
                        inputType: 'date',
                        defaultValue: minDate,
                        min: minDate,
                        max: maxDate,
                        hint: `${minDate} 〜 ${maxDate} の範囲で選択（前半・後半とも1泊以上）`,
                        confirmLabel: '分割する',
                        confirmColor: 'orange',
                      }
                    );
                    if (!splitDate) return;
                    try {
                      const res = await api.post(`/reservations/${d.id}/split`, { split_date: splitDate, updated_at: d.updated_at });
                      showAlert('分割完了', `前半: ID=${res.front_reservation_id}、後半: ID=${res.back_reservation_id}`);
                      fetchData();
                    } catch (err) { showAlert('エラー', err.message); }
                  }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>call_split</span>
                    分割
                  </button>
                )}
              </h3>
              <div className="rd__sources-list">
                {d.merged_sources.map(s => (
                  <div key={s.id}
                    className={`rd__source-row ${s.status === 'cancelled' ? 'rd__source-row--cancelled' : ''}`}
                    onClick={async () => {
                      if (s.status === 'cancelled') return;
                      if (!await showConfirm(
                        '統合解除',
                        `${OTA_LABELS[s.channel] || s.channel} ${s.reservation_no}\n${s.checkin_date}〜${s.checkout_date}（${s.nights}泊）\n\nこの予約を統合から外して独立予約に戻しますか？\n\n⚠ 残りの日程が連続しなくなる場合（中日の解除等）は統合全体が解除されます。\n⚠ 全解除になった場合、部屋のアサインは外れるため再アサインが必要です。`,
                        { confirmLabel: '解除する', confirmColor: 'orange' }
                      )) return;
                      try {
                        await api.post(`/reservations/${d.id}/unmerge-source`, { source_id: s.id, updated_at: d.updated_at });
                        showAlert('統合解除', `${s.reservation_no} を統合から外しました`);
                        fetchData();
                      } catch (err) { showAlert('エラー', err.message); }
                    }}
                  >
                    <span className={`rd__ota ota-${s.channel}`}>{OTA_LABELS[s.channel] || s.channel}</span>
                    <span className="rd__source-no">{s.reservation_no}</span>
                    <span className="rd__source-bottom">
                      <span className="rd__source-dates">{s.checkin_date}〜{s.checkout_date} ({s.nights}泊)</span>
                      <span className="rd__source-amount">{Number(s.amount).toLocaleString()}円</span>
                      {s.status === 'cancelled' && <span className="rd__source-cancelled">キャンセル</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rd__card">
            <h3 className="rd__card-title">予約情報</h3>
            <AttrRow label="PMS予約番号" value={`#${d.id}`} />
            {d.reservation_no && <AttrRow label="OTA予約番号" value={d.reservation_no} />}
            {d.channel && <AttrRow label="チャネル" value={OTA_LABELS[d.channel] || d.channel} />}
            <AttrRow label="TL原本名" value={`${d.tl_last_name} ${d.tl_first_name}`} />
            {d.tl_checkin_date && d.tl_checkin_date !== d.checkin_date && (
              <AttrRow label="TL原本CI日" value={d.tl_checkin_date} />
            )}
            {d.tl_checkout_date && d.tl_checkout_date !== d.checkout_date && (
              <AttrRow label="TL原本CO日" value={d.tl_checkout_date} />
            )}
            {d.tl_room_type && d.tl_room_type !== d.room_type && (
              <AttrRow label="TL原本タイプ" value={d.tl_room_type} />
            )}
            {d.actual_checkin_at && <AttrRow label="CI実績" value={d.actual_checkin_at} />}
            {d.actual_checkout_at && <AttrRow label="CO実績" value={d.actual_checkout_at} />}
            <AttrRow label="登録日" value={d.created_at} />
            {d.tl_telegram_data && (
              <button className="rd__telegram-btn" onClick={() => setShowTelegram(true)}>
                <span className="material-symbols-outlined">description</span>
                TL電文を表示
              </button>
            )}
          </div>

          {d.assignments?.filter(a => a.status === 'active').length > 0 && (
            <div className="rd__card">
              <h3 className="rd__card-title">アサイン</h3>
              {d.assignments.filter(a => a.status === 'active').map(a => (
                <div key={a.id} className="rd__assign-row">
                  <span className="rd__assign-room">{a.room_number}</span>
                  <span className="rd__assign-dates">{a.check_in_date} ~ {a.check_out_date}</span>
                </div>
              ))}
            </div>
          )}

          <div className="rd__card">
            <h3 className="rd__card-title">滞在メモ</h3>
            <textarea
              className="rd__notes-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="この滞在に関するメモ"
            />
            <button className="rd__save-btn" onClick={handleSaveNotes} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </button>
          </div>

          {d.guest_id && (
            <GuestNotesEditor guestId={d.guest_id} initialNotes={d.guest_notes || ''} onSaved={fetchData} />
          )}

          {/* 予約タイムライン */}
          {d.events && d.events.length > 0 && (
            <div className="rd__card">
              <h3 className="rd__card-title">タイムライン</h3>
              <div className="rd__timeline">
                {d.events.map((ev, i) => (
                  <div key={ev.id || i} className={`rd__timeline-item rd__timeline-item--${ev.event_type}`}>
                    <div className="rd__timeline-dot" />
                    {i < d.events.length - 1 && <div className="rd__timeline-line" />}
                    <div className="rd__timeline-content">
                      <span className="rd__timeline-summary">{
                        { tl_new: '新規予約', tl_modify: '予約変更', tl_cancel: '予約取消',
                          merge_alert: '統合予約に変更通知'
                        }[ev.event_type] || ev.summary
                      }</span>
                      <span className="rd__timeline-time">{fmtDateTime(ev.event_at)}</span>
                      {ev.staff_name && <span className="rd__timeline-staff">{ev.staff_name}</span>}
                      {ev.detail && (
                        <TimelineDetailPopover ev={ev} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 右カラム: 売上明細 */}
        <div className="rd__col rd__col--right">
          <EditableChargesTable
            charges={d.charges || []}
            reservationId={d.id}
            updatedAt={d.updated_at}
            onSaved={fetchData}
            canAddGoods={canCO}   /* canCO = 在室中（CI済み）。物販の部屋付けはこの間だけ */
          />
          {/* 発行済み帳票一覧: documentsがある場合のみ表示 */}
          {d.documents?.length > 0 && (
            <DocumentListSection documents={d.documents} onRefresh={fetchData} />
          )}
        </div>
      </div>

      {/* ダイアログ */}
      {dialog === 'checkin' && (
        <CheckinDialog onConfirm={handleCheckin} onCancel={() => setDialog(null)} reservation={d} />
      )}
      {dialog === 'checkout' && (
        <CheckoutDialog onConfirm={handleCheckout} onCancel={() => setDialog(null)} reservation={d} isEarly={isEarlyCheckout} />
      )}
      {dialog === 'room_move' && (
        <RoomMoveDialog
          reservation={d}
          rooms={allRooms}
          onMove={handleRoomMove}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'dates' && (
        <DateChangeDialog
          reservation={d}
          onConfirm={handleDateChange}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'room_type' && (
        <RoomTypeChangeDialog
          reservation={d}
          roomTypes={roomTypes}
          onConfirm={async (newType) => {
            const typeName = roomTypes.find(rt => rt.type_code === newType)?.type_name || newType;
            if (!await showConfirm('部屋タイプ変更', `${d.room_type_name || d.room_type} → ${typeName} に変更しますか？`)) return;
            try {
              await api.put(`/reservations/${id}`, { room_type: newType, updated_at: d.updated_at });
              setDialog(null);
              fetchData();
            } catch (err) { showAlert('エラー', err.message); }
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog === 'receipt' && (
        <ReceiptIssueDialog
          reservation={d}
          charges={d.charges || []}
          onIssued={() => { setDialog(null); fetchData(); }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog === 'link_guest' && (
        <LinkGuestDialog
          reservation={d}
          onLinked={() => { setDialog(null); fetchData(); }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog === 'resolve_merge_alert' && d.pending_merge_alerts?.length > 0 && (
        <MergeAlertResolveDialog
          reservation={d}
          alerts={d.pending_merge_alerts}
          sources={d.merged_sources}
          onConfirm={async (eventId) => {
            try {
              await api.post(`/reservations/${id}/resolve-merge-alert`, {
                event_id: eventId,
                updated_at: data?.updated_at
              });
              setDialog(null);
              fetchData();
            } catch (err) {
              // 規約 #14: ブラウザ標準alertは使わない
              showAlert('エラー', err.message || '統合解除に失敗しました');
            }
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {/* 顧客詳細モーダル: ゲスト名横のボタンで開く */}
      {guestModalId && (
        <GuestDetailModal
          guestId={guestModalId}
          onClose={() => { setGuestModalId(null); fetchData(); }}
        />
      )}

      {/* TL電文パネル: 右からスライドイン。明細と並べて突合確認できる */}
      {showTelegram && d.tl_telegram_data && (
        <aside className="rd__telegram-panel">
          <div className="rd__telegram-header">
            <h3 className="rd__telegram-title">TL電文 — {d.reservation_no || `#${d.id}`}</h3>
            <button className="rd__telegram-close" onClick={() => setShowTelegram(false)}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          <pre className="rd__telegram-body">{d.tl_telegram_data}</pre>
        </aside>
      )}
    </div>
  );
}

/**
 * タイムラインの詳細をクリックで表示するポップオーバー
 * 画面内に収まるよう位置を自動調整する
 */
