import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useConfirm } from '../components/ConfirmDialog';
import { romajiToKana, isConvertibleRomaji } from '../utils/romajiToKana';
import { OTA_LABELS, RESERVATION_STATUS_SHORT as STATUS_LABELS } from '../utils/constants';
import { getCountryName } from '../utils/countries';
import './GuestDetailPage.css';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:8080/api/v1';

const GENDER_OPTIONS = [
  { value: '', label: '未設定' },
  { value: 'male', label: '男性' },
  { value: 'female', label: '女性' },
  { value: 'other', label: 'その他' },
];

const PREFECTURES = [
  '', '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
  '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];

/** ページ版ラッパー */
export default function GuestDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  return <GuestDetailContent guestId={id} navigate={navigate} />;
}

/**
 * 顧客詳細コンテンツ（ページ・モーダル兼用）
 * 名前は統合フィールド（name_kanji, name_kana, name_romaji）で管理
 */
export function GuestDetailContent({ guestId, navigate: navFn, isModal = false, onClose }) {
  const navigate = navFn || (() => {});
  const { confirm: showConfirm, alert: showAlert } = useConfirm();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);

  const [passportUrls, setPassportUrls] = useState({});
  const [modalImage, setModalImage] = useState(null);
  const [uploadReservationId, setUploadReservationId] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const [guestNotes, setGuestNotes] = useState('');
  const [notesSaveStatus, setNotesSaveStatus] = useState('saved');
  const notesTimerRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get(`/guests/${guestId}`);
      setData(res);
      setGuestNotes(res.guest?.guest_notes || '');
    } catch {
      if (!isModal) navigate('/guests', { replace: true });
    } finally {
      setLoading(false);
    }
  }, [guestId, navigate, isModal]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // パスポート画像の認証付き取得
  useEffect(() => {
    if (!data?.passports?.length) return;
    const token = localStorage.getItem('pms_token');
    const urls = {};
    Promise.all(
      data.passports.map(async (pp) => {
        try {
          const res = await fetch(`${API_BASE}/passports/${pp.id}/image`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) return;
          const blob = await res.blob();
          urls[pp.id] = URL.createObjectURL(blob);
        } catch { /* skip */ }
      })
    ).then(() => setPassportUrls(urls));
    return () => { Object.values(urls).forEach((url) => URL.revokeObjectURL(url)); };
  }, [data?.passports]);

  // --- 編集 ---
  const startEditing = () => {
    const g = data.guest;
    setEditForm({
      name_kanji: g.name_kanji || '',
      name_kana: g.name_kana || '',
      name_romaji: g.name_romaji || '',
      phone: g.phone || '',
      mobile_phone: g.mobile_phone || '',
      email: g.email || '',
      company_name: g.company_name || '',
      postal_code: g.postal_code || '',
      prefecture: g.prefecture || '',
      city: g.city || '',
      address_line: g.address_line || '',
      gender: g.gender || '',
      birth_date: g.birth_date || '',
      country_code: g.country_code || '',
      preferred_language: g.preferred_language || '',
      is_vip: g.is_vip || false,
    });
    setEditing(true);
  };

  const cancelEditing = () => { setEditing(false); setEditForm({}); };
  const handleEditChange = (field, value) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/guests/${guestId}`, editForm);
      setEditing(false);
      fetchData();
    } catch (err) {
      showAlert('保存エラー', err.message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * ローマ字→カナ変換ボタンの処理
   * ローマ字フィールドの内容をカタカナに変換してカナフィールドにセット
   * スペース（姓名区切り）もそのまま保持
   */
  const handleRomajiToKana = () => {
    const romaji = editForm.name_romaji;
    if (!romaji) return;
    const kana = romajiToKana(romaji);
    setEditForm((prev) => ({ ...prev, name_kana: kana }));
  };

  // --- メモ自動保存 ---
  const handleNotesChange = (value) => {
    setGuestNotes(value);
    setNotesSaveStatus('changed');
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(async () => {
      setNotesSaveStatus('saving');
      try {
        await api.put(`/guests/${guestId}`, { guest_notes: value });
        setNotesSaveStatus('saved');
      } catch { setNotesSaveStatus('changed'); }
    }, 1000);
  };

  useEffect(() => { return () => { if (notesTimerRef.current) clearTimeout(notesTimerRef.current); }; }, []);

  // --- パスポート ---
  const handlePassportUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!uploadReservationId) { showAlert('エラー', 'アップロード先の予約を選択してください'); return; }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('passport_image', file);
      await api.upload(`/reservations/${uploadReservationId}/passport`, formData);
      fetchData();
    } catch (err) { showAlert('アップロードエラー', err.message); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const handlePassportDelete = async (passportId) => {
    if (!await showConfirm('パスポート画像削除', 'この画像を削除しますか？', { confirmColor: 'red', confirmLabel: '削除する' })) return;
    try {
      await api.delete(`/passports/${passportId}`);
      if (passportUrls[passportId]) URL.revokeObjectURL(passportUrls[passportId]);
      fetchData();
    } catch (err) { showAlert('削除エラー', err.message); }
  };

  if (loading || !data) return <div className="gd__loading">読み込み中...</div>;

  const guest = data.guest;
  const stayHistory = data.stay_history || [];
  const passports = data.passports || [];
  // 主表示名: 漢字 > カナ > ローマ字 の優先順
  const displayName = guest.name_kanji || guest.name_kana || guest.name_romaji || '';

  return (
    <div className="gd">
      {/* トップバー */}
      <div className="gd__topbar">
        {isModal ? (
          <button className="gd__back" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        ) : (
          <button className="gd__back" onClick={() => navigate('/guests')}>
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
        )}
        <div className="gd__topbar-info">
          <span className="gd__guest-code">{guest.guest_code}</span>
          <span className="gd__guest-name-top">{displayName}</span>
          {guest.is_vip ? <span className="gd__vip">VIP</span> : null}
        </div>
      </div>

      <div className="gd__columns">
        {/* ===== 左カラム: 基本情報 ===== */}
        <div className="gd__col gd__col--left">
          <div className="gd__card">
            <div className="gd__card-header">
              <h3 className="gd__card-title">基本情報</h3>
              {!editing ? (
                <button className="gd__edit-btn" onClick={startEditing}>
                  <span className="material-symbols-outlined">edit</span> 編集
                </button>
              ) : (
                <div className="gd__edit-actions">
                  <button className="gd__save-btn" onClick={handleSave} disabled={saving}>
                    {saving ? '保存中...' : '保存'}
                  </button>
                  <button className="gd__cancel-btn" onClick={cancelEditing} disabled={saving}>
                    キャンセル
                  </button>
                </div>
              )}
            </div>

            <div className="gd__code-display">{guest.guest_code}</div>

            {/* 名前セクション: 統合フィールド（漢字・カナ・ローマ字） */}
            {!editing ? (
              <div className="gd__name-block">
                {guest.name_kanji && <div className="gd__name-main">{guest.name_kanji}</div>}
                {guest.name_kana && <div className="gd__name-sub">{guest.name_kana}</div>}
                {guest.name_romaji && <div className="gd__name-sub">{guest.name_romaji}</div>}
                {!guest.name_kanji && !guest.name_kana && !guest.name_romaji && (
                  <div className="gd__name-main" style={{color: 'var(--text-muted)'}}>名前未登録</div>
                )}
              </div>
            ) : (
              <div className="gd__name-edit">
                <div className="gd__field-full">
                  <label className="gd__field-label">氏名（漢字）</label>
                  <input className="gd__input" type="text" value={editForm.name_kanji}
                    onChange={(e) => handleEditChange('name_kanji', e.target.value)}
                    placeholder="例: 渡辺 健太" />
                </div>
                <div className="gd__field-full">
                  <div className="gd__field-label-row">
                    <label className="gd__field-label">氏名（カナ）</label>
                    {/* ローマ字→カナ変換ボタン: ローマ字欄にアルファベットがある場合のみ表示 */}
                    {isConvertibleRomaji(editForm.name_romaji) && (
                      <button
                        type="button"
                        className="gd__convert-btn"
                        onClick={handleRomajiToKana}
                        title="ローマ字からカナに変換"
                      >
                        <span className="material-symbols-outlined">translate</span>
                        ローマ字→カナ
                      </button>
                    )}
                  </div>
                  <input className="gd__input" type="text" value={editForm.name_kana}
                    onChange={(e) => handleEditChange('name_kana', e.target.value)}
                    placeholder="例: ワタナベ ケンタ" />
                </div>
                <div className="gd__field-full">
                  <label className="gd__field-label">氏名（ローマ字）</label>
                  <input className="gd__input" type="text" value={editForm.name_romaji}
                    onChange={(e) => handleEditChange('name_romaji', e.target.value)}
                    placeholder="例: Watanabe Kenta" />
                </div>
              </div>
            )}

            {/* 属性表示 */}
            <div className="gd__attrs">
              <AttrField label="電話番号" value={guest.phone}
                editing={editing} editValue={editForm.phone}
                onChange={(v) => handleEditChange('phone', v)} />
              <AttrField label="携帯電話" value={guest.mobile_phone}
                editing={editing} editValue={editForm.mobile_phone}
                onChange={(v) => handleEditChange('mobile_phone', v)} />
              <AttrField label="メール" value={guest.email}
                editing={editing} editValue={editForm.email}
                onChange={(v) => handleEditChange('email', v)} type="email" />
              <AttrField label="会社名" value={guest.company_name}
                editing={editing} editValue={editForm.company_name}
                onChange={(v) => handleEditChange('company_name', v)} />

              {/* 住所 */}
              {!editing ? (
                <div className="gd__attr-row">
                  <span className="gd__attr-label">住所</span>
                  <span className="gd__attr-value">
                    {guest.postal_code && `〒${guest.postal_code} `}
                    {guest.prefecture}{guest.city}{guest.address_line}
                    {!guest.postal_code && !guest.prefecture && !guest.city && !guest.address_line && '—'}
                  </span>
                </div>
              ) : (
                <>
                  <AttrField label="郵便番号" value={guest.postal_code}
                    editing={true} editValue={editForm.postal_code}
                    onChange={(v) => handleEditChange('postal_code', v)} placeholder="000-0000" />
                  <div className="gd__attr-row">
                    <span className="gd__attr-label">都道府県</span>
                    <select className="gd__input gd__input--select" value={editForm.prefecture}
                      onChange={(e) => handleEditChange('prefecture', e.target.value)}>
                      {PREFECTURES.map((p) => <option key={p} value={p}>{p || '未選択'}</option>)}
                    </select>
                  </div>
                  <AttrField label="市区町村" value={guest.city}
                    editing={true} editValue={editForm.city}
                    onChange={(v) => handleEditChange('city', v)} />
                  <AttrField label="番地" value={guest.address_line}
                    editing={true} editValue={editForm.address_line}
                    onChange={(v) => handleEditChange('address_line', v)} />
                </>
              )}

              {/* 性別 */}
              {!editing ? (
                <div className="gd__attr-row">
                  <span className="gd__attr-label">性別</span>
                  <span className="gd__attr-value">
                    {GENDER_OPTIONS.find((g) => g.value === guest.gender)?.label || '未設定'}
                  </span>
                </div>
              ) : (
                <div className="gd__attr-row">
                  <span className="gd__attr-label">性別</span>
                  <select className="gd__input gd__input--select" value={editForm.gender}
                    onChange={(e) => handleEditChange('gender', e.target.value)}>
                    {GENDER_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                  </select>
                </div>
              )}

              <AttrField label="生年月日" value={guest.birth_date}
                editing={editing} editValue={editForm.birth_date}
                onChange={(v) => handleEditChange('birth_date', v)} type="date" />
              <AttrField label="国籍" value={getCountryName(guest.country_code)}
                editing={editing} editValue={editForm.country_code}
                onChange={(v) => handleEditChange('country_code', v)} placeholder="JP" />
              <AttrField label="優先言語" value={guest.preferred_language}
                editing={editing} editValue={editForm.preferred_language}
                onChange={(v) => handleEditChange('preferred_language', v)} placeholder="ja" />

              {/* VIP */}
              {!editing ? (
                <div className="gd__attr-row">
                  <span className="gd__attr-label">VIP</span>
                  <span className="gd__attr-value">
                    {guest.is_vip ? <span className="gd__vip">VIP</span> : '—'}
                  </span>
                </div>
              ) : (
                <div className="gd__attr-row">
                  <span className="gd__attr-label">VIP</span>
                  <label className="gd__checkbox-label">
                    <input type="checkbox" checked={editForm.is_vip}
                      onChange={(e) => handleEditChange('is_vip', e.target.checked)} />
                    VIPゲスト
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ===== 右カラム ===== */}
        <div className="gd__col gd__col--right">
          {/* 宿泊履歴 */}
          <StayHistoryTable stayHistory={stayHistory} isModal={isModal} navigate={navigate} />

          {/* ゲストマージ（名寄せ） */}
          <GuestMergeCard guestId={guest.id} guestCode={guest.guest_code} onMerged={fetchData} />

          {/* パスポート画像 */}
          <div className="gd__card">
            <h3 className="gd__card-title">パスポート画像</h3>
            <div className="gd__passport-upload">
              <select className="gd__input gd__input--select" value={uploadReservationId}
                onChange={(e) => setUploadReservationId(e.target.value)}>
                <option value="">予約を選択...</option>
                {stayHistory.map((stay) => (
                  <option key={stay.id} value={stay.id}>{stay.reservation_no} ({stay.checkin_date})</option>
                ))}
              </select>
              <input type="file" ref={fileInputRef} accept="image/jpeg,image/png"
                onChange={handlePassportUpload} style={{ display: 'none' }} />
              <button className="gd__upload-btn" onClick={() => fileInputRef.current?.click()}
                disabled={uploading || !uploadReservationId}>
                <span className="material-symbols-outlined">upload</span>
                {uploading ? 'アップロード中...' : 'アップロード'}
              </button>
            </div>
            {passports.length === 0 ? (
              <p className="gd__empty">パスポート画像がありません</p>
            ) : (
              <div className="gd__passport-grid">
                {passports.map((pp) => (
                  <div key={pp.id} className="gd__passport-item">
                    <div className="gd__passport-thumb"
                      onClick={() => passportUrls[pp.id] && setModalImage(passportUrls[pp.id])}>
                      {passportUrls[pp.id] ? (
                        <img src={passportUrls[pp.id]} alt="パスポート" />
                      ) : (
                        <div className="gd__passport-placeholder">
                          <span className="material-symbols-outlined">image</span>
                        </div>
                      )}
                      {pp.is_representative && <span className="gd__passport-badge">代表</span>}
                    </div>
                    <button className="gd__passport-delete" onClick={() => handlePassportDelete(pp.id)} title="削除">
                      <span className="material-symbols-outlined">delete</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 顧客メモ */}
          <div className="gd__card">
            <div className="gd__card-header">
              <h3 className="gd__card-title">顧客メモ</h3>
              <span className="gd__notes-status">
                {notesSaveStatus === 'saving' && '保存中...'}
                {notesSaveStatus === 'saved' && '保存済み'}
                {notesSaveStatus === 'changed' && '未保存'}
              </span>
            </div>
            <textarea className="gd__notes-textarea" value={guestNotes}
              onChange={(e) => handleNotesChange(e.target.value)}
              placeholder="メモを入力..." rows={5} />
          </div>
        </div>
      </div>

      {/* パスポート拡大モーダル */}
      {modalImage && (
        <div className="gd__modal-overlay" onClick={() => setModalImage(null)}>
          <div className="gd__modal-content" onClick={(e) => e.stopPropagation()}>
            <img src={modalImage} alt="パスポート拡大" className="gd__modal-image" />
            <button className="gd__modal-close" onClick={() => setModalImage(null)}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** モーダル版ラッパー */
/**
 * ゲストマージカード
 * 重複するゲストレコードを検索し、現在のゲストに統合する。
 * マージ元の予約は全てマージ先に移動される。
 */
/**
 * 宿泊履歴テーブル
 * - メモがある行にはアイコン表示（ホバーで内容表示）
 * - 行クリックで売上明細を折りたたみ展開（個別API取得）
 */
function StayHistoryTable({ stayHistory, isModal, navigate }) {
  const [expandedId, setExpandedId] = useState(null);
  const [charges, setCharges] = useState({});
  const [loadingId, setLoadingId] = useState(null);

  const toggleExpand = async (stayId) => {
    if (expandedId === stayId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(stayId);
    // 明細を未取得なら取得
    if (!charges[stayId]) {
      setLoadingId(stayId);
      try {
        const res = await api.get(`/reservations/${stayId}`);
        setCharges(prev => ({ ...prev, [stayId]: res.charges || [] }));
      } catch { /* ignore */ }
      setLoadingId(null);
    }
  };

  if (stayHistory.length === 0) {
    return (
      <div className="gd__card">
        <h3 className="gd__card-title">宿泊履歴</h3>
        <p className="gd__empty">宿泊履歴がありません</p>
      </div>
    );
  }

  return (
    <div className="gd__card">
      <h3 className="gd__card-title">宿泊履歴</h3>
      <div className="gd__table-wrap">
        <table className="gd__table">
          <thead>
            <tr>
              <th></th>
              <th>予約番号</th><th>CI日</th><th>CO日</th>
              <th>部屋タイプ</th><th>部屋番号</th><th>ステータス</th>
              <th>金額</th><th>チャネル</th><th></th>
            </tr>
          </thead>
          <tbody>
            {stayHistory.map((stay) => {
              const isExpanded = expandedId === stay.id;
              const stayCharges = charges[stay.id];
              return (
                <Fragment key={stay.id}>
                  <tr className={`gd__table-row ${isExpanded ? 'gd__table-row--expanded' : ''}`}
                    onClick={() => toggleExpand(stay.id)}>
                    <td className="gd__td-expand">
                      <span className={`material-symbols-outlined gd__expand-icon ${isExpanded ? 'gd__expand-icon--open' : ''}`}>
                        chevron_right
                      </span>
                    </td>
                    <td className="gd__td-mono">{stay.reservation_no}</td>
                    <td>{stay.checkin_date}</td>
                    <td>{stay.checkout_date}</td>
                    <td>{stay.room_type_name || stay.room_type}</td>
                    <td>{stay.room_number || '—'}</td>
                    <td><span className={`gd__status gd__status--${stay.status}`}>{STATUS_LABELS[stay.status] || stay.status}</span></td>
                    <td className="gd__td-amount">{stay.amount != null ? `${Number(stay.amount).toLocaleString()}円` : '—'}</td>
                    <td><span className={`gd__ota ota-${stay.channel}`}>{OTA_LABELS[stay.channel] || stay.channel}</span></td>
                    <td className="gd__td-memo">
                      {stay.reservation_notes && (
                        <span className="gd__memo-icon-wrap" title={stay.reservation_notes}>
                          <span className="material-symbols-outlined gd__memo-icon">sticky_note_2</span>
                          <div className="gd__memo-tooltip">{stay.reservation_notes}</div>
                        </span>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="gd__detail-row">
                      <td colSpan={10}>
                        <div className="gd__detail-content">
                          {loadingId === stay.id ? (
                            <span className="gd__detail-loading">読み込み中...</span>
                          ) : stayCharges && stayCharges.length > 0 ? (
                            <table className="gd__detail-table">
                              <thead>
                                <tr>
                                  <th>日付</th><th>種別</th><th>摘要</th>
                                  <th className="gd__right">金額</th><th className="gd__right">税</th>
                                </tr>
                              </thead>
                              <tbody>
                                {stayCharges.filter(c => c.status === 'active').map(c => (
                                  <tr key={c.id} className={c.charge_type === 'payment' ? 'gd__detail-payment' : ''}>
                                    <td>{c.date}</td>
                                    <td><span className={`gd__detail-type gd__detail-type--${c.charge_type}`}>
                                      {{ room: '宿泊', payment: '入金', addon: '追加', discount: '割引', cancel_fee: 'キャンセル料', refund: '返金' }[c.charge_type] || c.charge_type}
                                    </span></td>
                                    <td className="gd__detail-desc">{c.description}</td>
                                    <td className="gd__right">{Number(c.amount).toLocaleString()}</td>
                                    <td className="gd__right">{Number(c.tax_amount || 0).toLocaleString()}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <span className="gd__detail-empty">明細データなし</span>
                          )}
                          {!isModal && (
                            <button className="gd__detail-link" onClick={(e) => { e.stopPropagation(); navigate(`/reservations/${stay.id}`); }}>
                              予約詳細を開く <span className="material-symbols-outlined" style={{ fontSize: 14 }}>open_in_new</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GuestMergeCard({ guestId, guestCode, onMerged }) {
  const { confirm: showConfirm, alert: showAlert } = useConfirm();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [autoLoaded, setAutoLoaded] = useState(false);

  // マウント時に自動候補検索 — 候補があれば自動展開
  useEffect(() => {
    api.get(`/guests/match?guest_id=${guestId}`)
      .then(res => {
        const list = res.candidates || [];
        setCandidates(list);
        if (list.length > 0) setExpanded(true);
        setAutoLoaded(true);
      })
      .catch(() => { setAutoLoaded(true); });
  }, [guestId]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await api.get(`/guests/match?q=${encodeURIComponent(query.trim())}`);
      // 自分自身は除外
      setCandidates((res.candidates || []).filter(c => c.id !== guestId));
    } catch { /* ignore */ }
    setSearching(false);
  };

  const handleMerge = async () => {
    if (selected.size !== 1) return; // 寄せ先は1件のみ
    const targetId = Array.from(selected)[0];
    const target = candidates.find(x => x.id === targetId);
    const targetName = target ? `${target.guest_code} ${target.name}` : `ID=${targetId}`;

    // 方向: 選択した候補（情報豊富）が寄せ先、現在のゲストが吸収される側
    if (!await showConfirm(
      'ゲスト名寄せ',
      `このゲスト（${guestCode}）の予約を\n\n【寄せ先】${targetName}\n\nに移行します。${guestCode} は統合済みとなり非表示になります。\nこの操作は元に戻せません。`,
      { confirmColor: 'red', confirmLabel: '名寄せ実行' }
    )) return;

    try {
      // 選択した候補がマージ先（:id）、現在のゲストがマージ元（merge_from_ids）
      await api.post(`/guests/${targetId}/merge`, { merge_from_ids: [guestId] });
      showAlert('名寄せ完了', `${guestCode} の予約を ${targetName} に移行しました`);
      setSelected(new Set());
      setCandidates([]);
      onMerged();
    } catch (err) {
      showAlert('エラー', err.message);
    }
  };

  // 自動取得完了前は何も表示しない
  if (!autoLoaded) return null;

  if (!expanded) {
    return (
      <div className="gd__card">
        <button className="gd__merge-expand" onClick={() => setExpanded(true)}>
          <span className="material-symbols-outlined">merge</span>
          重複ゲストをマージ（名寄せ）
        </button>
      </div>
    );
  }

  return (
    <div className="gd__card">
      <h3 className="gd__card-title">ゲスト名寄せ</h3>
      <p className="gd__merge-desc">このゲスト（{guestCode}）の予約を、既存のゲストに寄せます。宿泊履歴のあるゲストを選択してください。</p>

      <div className="gd__merge-search">
        <input
          type="text"
          className="gd__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="ゲスト名で検索"
        />
        <button className="gd__merge-search-btn" onClick={handleSearch} disabled={searching}>
          {searching ? '...' : '検索'}
        </button>
      </div>

      <div className="gd__merge-results">
        {candidates.length === 0 ? (
          <p className="gd__empty">候補なし</p>
        ) : (
          candidates.map(c => (
            <label key={c.id} className={`gd__merge-item ${selected.has(c.id) ? 'gd__merge-item--selected' : ''}`}>
              <input
                type="radio"
                name="merge-target"
                checked={selected.has(c.id)}
                onChange={() => setSelected(new Set([c.id]))}
              />
              <div className="gd__merge-item-info">
                <div className="gd__merge-item-name">
                  {(() => {
                    const mf = c.matched_fields || [];
                    const hl = (field, text) => mf.includes(field)
                      ? <span className="gd__match-hl">{text}</span>
                      : <span>{text}</span>;
                    return <>
                      {hl('name_kanji', c.name)}
                      <span className="gd__merge-item-code">{c.guest_code}</span>
                      {c.is_vip && <span className="gd__vip">VIP</span>}
                    </>;
                  })()}
                </div>
                <div className="gd__merge-item-detail">
                  {(() => {
                    const mf = c.matched_fields || [];
                    const hl = (field, text) => mf.includes(field)
                      ? <span className="gd__match-hl">{text}</span>
                      : <span>{text}</span>;
                    return <>
                      {c.name_kana && c.name_kana !== c.name && hl('name_kana', c.name_kana)}
                      {c.name_romaji && c.name_romaji !== c.name && hl('name_romaji', c.name_romaji)}
                      {c.phone && hl('phone', `📞 ${c.phone}`)}
                      {c.email && hl('email', `✉ ${c.email}`)}
                      {c.country_code && c.country_code !== 'JP' && <span>🌐 {c.country_code}</span>}
                    </>;
                  })()}
                </div>
                <div className="gd__merge-item-detail">
                  {c.address && <span>📍 {c.address}</span>}
                </div>
                <div className="gd__merge-item-meta">
                  <span>予約{c.reservation_count}件</span>
                  {c.stay_count > 0 && <span>来館{c.stay_count}回</span>}
                  {c.last_stay_date && <span>最終: {c.last_stay_date}</span>}
                </div>
              </div>
            </label>
          ))
        )}
      </div>

      {selected.size > 0 && (
        <button className="gd__merge-btn" onClick={handleMerge}>
          <span className="material-symbols-outlined">arrow_forward</span>
          選択したゲストに寄せる
        </button>
      )}

      <button className="gd__merge-close" onClick={() => { setExpanded(false); setSelected(new Set()); }}>
        閉じる
      </button>
    </div>
  );
}

export function GuestDetailModal({ guestId, onClose }) {
  if (!guestId) return null;
  return (
    <div className="gd-modal-overlay" onClick={onClose}>
      <div className="gd-modal-container" onClick={(e) => e.stopPropagation()}>
        <GuestDetailContent guestId={guestId} isModal={true} onClose={onClose} />
      </div>
    </div>
  );
}

function AttrField({ label, value, editing, editValue, onChange, type = 'text', placeholder = '' }) {
  if (editing) {
    return (
      <div className="gd__attr-row">
        <span className="gd__attr-label">{label}</span>
        <input className="gd__input" type={type} value={editValue || ''} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }
  return (
    <div className="gd__attr-row">
      <span className="gd__attr-label">{label}</span>
      <span className="gd__attr-value">{value || '—'}</span>
    </div>
  );
}
