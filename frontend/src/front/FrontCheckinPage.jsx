import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useConfirm } from '../components/ConfirmDialog';
import { useFrontData } from './FrontDataContext';
import OtaBadge from './components/OtaBadge';
import { FrontButton, FrontBackButton } from './components/FrontButton';
import SuccessOverlay from './components/SuccessOverlay';
import './FrontDetail.css';

const MEAL_LABELS = { breakfast: '朝食付', dinner: '夕食付', two_meals: '朝夕食付' };
const yen = (n) => `¥${Number(n || 0).toLocaleString()}`;

// 明細から 合計/入金済み/残額 を算出（front-board の unpaid_amount と同じ定義）
function calcMoney(charges = []) {
  let total = 0, paid = 0;
  for (const c of charges) {
    if (c.status !== 'active') continue;
    if (c.charge_type === 'payment') paid += Number(c.amount) || 0;
    else if (c.charge_type !== 'refund') total += Number(c.amount) || 0;
  }
  return { total, paid, due: total - paid };
}

/**
 * チェックイン確認画面 — 仕様書 §4.3 / mock #view-ci-detail
 * データ源: GET /reservations/:id（Phase 2でplan_name/住所をadditive拡張済み）
 * CI実行: POST /reservations/:id/checkin（updated_at同送=規約#16）。グループは group-checkin。
 */
export default function FrontCheckinPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { confirm: showConfirm, alert: showAlert } = useConfirm();
  const { setPollEnabled, refetch } = useFrontData();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // 詳細滞在中はボードのポーリングを止める（編集中の上書き防止・仕様書 §7）
  useEffect(() => {
    setPollEnabled(false);
    return () => setPollEnabled(true);
  }, [setPollEnabled]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get(`/reservations/${id}`);
      setData(d);
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '予約の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="fd__loading">読み込み中…</div>;
  if (error) return (
    <div>
      <div className="fd__head"><FrontBackButton onClick={() => navigate('/front/checkin')} /><div className="fd__title">チェックイン</div></div>
      <div className="fd__error">{error}</div>
    </div>
  );
  if (!data) return null;

  const isGroupParent = data.status === 'group_parent';
  const isChild = !!data.is_multi_room_child;
  const isGroup = isGroupParent || isChild;
  const children = data.child_reservations || [];

  const activeAssign = (data.assignments || []).find(a => a.status === 'active');
  const roomNumber = activeAssign?.room_number || null;
  const money = calcMoney(data.charges);

  // グループの一括CI対象 = confirmed かつ 部屋アサイン済みの子
  const groupTargets = children.filter(c => c.status === 'confirmed' && c.assigned_room);
  const parentId = isChild ? data.parent_reservation?.id : (isGroupParent ? Number(id) : null);

  // 単体CIの可否
  const guestUnconfirmed = data.guest_match_status === 'pending' || data.guest_match_status === 'new_guest';
  const isForeign = data.country_code && data.country_code !== 'JP';

  // 楽観ロック用 updated_at（グループは親の updated_at）
  const singleUpdatedAt = data.updated_at;
  const parentUpdatedAt = isChild ? data.parent_reservation?.updated_at : data.updated_at;

  const displayName = data.guest_name || `${data.tl_last_name || ''} ${data.tl_first_name || ''}`.trim();
  const address = [data.guest_postal_code ? `〒${data.guest_postal_code}` : '', data.guest_prefecture || '', data.guest_address_line || '']
    .filter(Boolean).join(' ');

  const goBack = () => navigate('/front/checkin');

  const doSingleCheckin = async () => {
    if (!roomNumber) return;
    if (!await showConfirm('チェックイン', `${displayName} 様（${roomNumber}号室）をチェックインしますか？`, { confirmLabel: 'チェックインする' })) return;
    setSubmitting(true);
    try {
      await api.post(`/reservations/${id}/checkin`, { updated_at: singleUpdatedAt });
      setSuccess(true);
    } catch (e) {
      await handleApiError(e);
    } finally {
      setSubmitting(false);
    }
  };

  const doGroupCheckin = async () => {
    if (!parentId || groupTargets.length === 0) return;
    if (!await showConfirm('グループチェックイン', `グループ全体（${groupTargets.length}室）をチェックインしますか？`, { confirmLabel: 'チェックインする' })) return;
    setSubmitting(true);
    try {
      await api.post(`/reservations/${parentId}/group-checkin`, {
        reservation_ids: groupTargets.map(c => c.id),
        updated_at: parentUpdatedAt,
      });
      setSuccess(true);
    } catch (e) {
      await handleApiError(e);
    } finally {
      setSubmitting(false);
    }
  };

  // 409（楽観ロック）は再読み込みを促す。その他はメッセージ表示
  async function handleApiError(e) {
    if (e instanceof ApiError && e.status === 409) {
      await showAlert('再読み込みが必要です', '他の端末で更新されました。最新の内容を再読み込みします。');
      await load();
    } else {
      await showAlert('チェックインできません', e instanceof ApiError ? e.message : 'エラーが発生しました');
    }
  }

  return (
    <div>
      <div className="fd__head">
        <FrontBackButton onClick={goBack} />
        <div className="fd__title">チェックイン</div>
        <div className="fd__guest">{displayName} 様{roomNumber ? ` ・ ${roomNumber}` : ''}</div>
      </div>

      <div className="fd__cols">
        {/* 左: 予約内容 */}
        <div className="fd__card fd__card--l">
          <div className="fd__card-title">予約内容</div>
          <div className="fd__row">
            <div className="fd__label">日程</div>
            <div className="fd__value num">{data.checkin_date} IN → {data.checkout_date} OUT ・ {data.nights}泊</div>
          </div>
          <div className="fd__row">
            <div className="fd__label">部屋</div>
            <div className="fd__value">
              {roomNumber
                ? <><span className="fd__value--big num">{roomNumber}</span> <span className="fd__value--sub">{data.room_type_name || ''}</span></>
                : <span className="fd__value--due">未アサイン</span>}
            </div>
          </div>
          <div className="fd__row">
            <div className="fd__label">プラン</div>
            <div className="fd__value">{data.plan_name || '—'}{MEAL_LABELS[data.meal_type] ? `（${MEAL_LABELS[data.meal_type]}）` : ''}</div>
          </div>
          <div className="fd__row">
            <div className="fd__label">人数</div>
            <div className="fd__value">大人{data.adult_count || 0}名{data.child_count ? ` ・ 子供${data.child_count}名` : ''}</div>
          </div>
          <div className="fd__row">
            <div className="fd__label">チャネル</div>
            <div className="fd__value"><OtaBadge channel={data.channel} /> <span className="fd__value--sub num">{data.reservation_no || ''}</span></div>
          </div>
          <div className="fd__row">
            <div className="fd__label">料金合計</div>
            <div className="fd__value num">{yen(money.total)}</div>
          </div>
          <div className="fd__row">
            <div className="fd__label">入金済み</div>
            <div className="fd__value num">{yen(money.paid)}</div>
          </div>
          <div className="fd__row">
            <div className="fd__label">残額</div>
            <div className={`fd__value num ${money.due > 0 ? 'fd__value--due' : 'fd__value--paid'}`}>{yen(money.due)}</div>
          </div>

          {/* グループ子予約リスト */}
          {isGroup && children.length > 0 && (
            <div className="fd__group">
              <div className="fd__group-title">グループ（{children.length}室）</div>
              {children.map(c => (
                <div className="fd__group-row" key={c.id}>
                  <span className={`fd__group-room ${c.assigned_room ? '' : 'fd__group-room--none'}`}>{c.assigned_room || '未'}</span>
                  <span className="fd__group-name">{c.guest_name || c.room_type_name || `部屋${c.room_index ?? ''}`}</span>
                  <span className="fd__group-status">{c.status === 'checked_in' ? 'CI済' : c.status === 'confirmed' ? '未CI' : c.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 右: ゲスト */}
        <div className="fd__card fd__card--r">
          <div className="fd__card-title">ゲスト</div>
          <div className="fd__row">
            <div className="fd__label">氏名</div>
            <div className="fd__value">{displayName}{data.name_kana ? `（${data.name_kana}）` : ''}</div>
          </div>
          <div className="fd__row">
            <div className="fd__label">電話</div>
            <div className="fd__value num">{data.guest_phone || data.guest_mobile || '—'}</div>
          </div>
          <div className="fd__row">
            <div className="fd__label">住所</div>
            <div className="fd__value fd__value--sub">{address || '—'}</div>
          </div>
          <div className="fd__row">
            <div className="fd__label">利用回数</div>
            <div className="fd__value">{data.visit_count != null ? `${data.visit_count}回目` : '—'}</div>
          </div>

          {guestUnconfirmed && (
            <div className="fd__alert">⚠ ゲストが未確定です。PCの予約詳細で顧客確定を行ってください。</div>
          )}

          {isForeign && (
            <div className="fd__passport">
              <div>パスポート（外国籍ゲスト）</div>
              <FrontButton variant="secondary" size="lg" disabled>📷 パスポートを撮影</FrontButton>
              <div className="fd__passport-hint">撮影・アップロードは Phase 4 で実装します</div>
            </div>
          )}
        </div>
      </div>

      {/* 下部固定アクションバー */}
      <div className="fd__actionbar">
        {isGroup ? (
          <>
            {groupTargets.length === 0 && <div className="fd__actionbar-note">⚠ チェックイン可能な部屋がありません（未アサイン/全室CI済）</div>}
            <div className="fd__actionbar-spacer" />
            <FrontButton variant="primary" size="xl" disabled={submitting || groupTargets.length === 0} onClick={doGroupCheckin}>
              グループ全体をチェックイン（{groupTargets.length}室）
            </FrontButton>
          </>
        ) : (
          <>
            {!roomNumber && <div className="fd__actionbar-note">⚠ 部屋が未アサインです。PCのアサインボードで割り当ててください</div>}
            <div className="fd__actionbar-spacer" />
            <FrontButton variant="primary" size="xl" disabled={submitting || !roomNumber} onClick={doSingleCheckin}>
              チェックインする
            </FrontButton>
          </>
        )}
      </div>

      <SuccessOverlay show={success} text="チェックインが完了しました" onDone={() => { refetch(); goBack(); }} />
    </div>
  );
}
