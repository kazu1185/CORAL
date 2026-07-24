import { useState, useEffect, useRef, useCallback } from 'react';
import { api, ApiError } from '../../api/client';
import { useConfirm } from '../../components/ConfirmDialog';
import { FrontButton } from './FrontButton';
import './FrontPassportPanel.css';

/**
 * パスポート撮影パネル（フロントモード Phase 4） — 仕様書 §4.3 / handoff「代表＋同行者複数枚」
 *
 * 外国籍ゲストのCI確認画面で、代表者＋同行者のパスポート画像を複数枚撮影・保存する。
 * 撮影は <input type="file" accept="image/*" capture="environment">。
 *   iOS Safari ではこの capture 属性でカメラが直接起動する（getUserMediaの独自実装は不要・PWAで確実）。
 * 画像は認証必須(permission guest.edit)のため <img src> では出せず、
 *   api.fetchBlob → objectURL でサムネイル表示する（PC GuestDetailと同方式）。
 *
 * 既存API（バックエンド変更なし）:
 *   POST   /reservations/:id/passport  … multipart, フィールド名 passport_image, is_representative
 *   DELETE /passports/:id              … 論理削除
 *   GET    /passports/:id/image        … 画像配信（Bearer必須）
 * 一覧は GET /reservations/:id の passports（今回showにadditive追加）から受け取る。
 *
 * props:
 *   reservationId … 対象予約ID
 *   passports     … data.passports（[{id, is_representative, scanned_at, scanned_by_name}]）
 *   onChanged     … アップロード/削除後に親へ再取得させる
 */
const ALLOWED_TYPES = ['image/jpeg', 'image/png'];
const MAX_BYTES = 10 * 1024 * 1024;

export default function FrontPassportPanel({ reservationId, passports = [], onChanged }) {
  const { confirm: showConfirm, alert: showAlert } = useConfirm();
  const [thumbs, setThumbs] = useState({});   // { [passportId]: objectURL }
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState(null);  // 拡大表示中の objectURL
  const repInputRef = useRef(null);
  const companionInputRef = useRef(null);

  const hasRepresentative = passports.some(p => p.is_representative);

  // サムネイル取得（認証付きblob）。passports が変わるたびに作り直し、古いURLは解放する
  useEffect(() => {
    let revoked = false;
    const created = {};
    (async () => {
      const entries = await Promise.all(passports.map(async (p) => {
        try {
          const blob = await api.fetchBlob(`/passports/${p.id}/image`);
          if (revoked) return null;
          const url = URL.createObjectURL(blob);
          created[p.id] = url;
          return [p.id, url];
        } catch {
          return null;   // 1枚の失敗で他を巻き込まない
        }
      }));
      if (revoked) return;
      setThumbs(Object.fromEntries(entries.filter(Boolean)));
    })();
    return () => {
      revoked = true;
      Object.values(created).forEach(url => URL.revokeObjectURL(url));
    };
  }, [passports]);

  const validateAndUpload = useCallback(async (file, isRepresentative) => {
    if (!file) return;
    // クライアント側でも軽くチェック（サーバーでも検証するが、無駄な送信・待ちを避ける）
    if (!ALLOWED_TYPES.includes(file.type)) {
      await showAlert('画像を確認してください', 'JPEG または PNG 画像のみアップロードできます');
      return;
    }
    if (file.size > MAX_BYTES) {
      await showAlert('画像を確認してください', 'ファイルサイズが10MBを超えています');
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('passport_image', file);
      formData.append('is_representative', isRepresentative ? '1' : '0');
      await api.upload(`/reservations/${reservationId}/passport`, formData);
      onChanged && onChanged();
    } catch (e) {
      await showAlert('保存できませんでした', e instanceof ApiError ? e.message : 'アップロードに失敗しました');
    } finally {
      setUploading(false);
    }
  }, [reservationId, onChanged, showAlert]);

  // input は同じファイルを続けて選ぶと change が発火しないため、毎回 value をクリアする
  const onPick = (isRepresentative) => async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    await validateAndUpload(file, isRepresentative);
  };

  const handleDelete = async (p) => {
    const kind = p.is_representative ? '代表者' : '同行者';
    if (!await showConfirm('パスポート画像の削除', `${kind}のパスポート画像を削除します。よろしいですか？`, { confirmLabel: '削除する', confirmColor: 'red' })) return;
    try {
      await api.delete(`/passports/${p.id}`);
      onChanged && onChanged();
    } catch (e) {
      await showAlert('削除できませんでした', e instanceof ApiError ? e.message : 'エラーが発生しました');
    }
  };

  return (
    <div className="fpp">
      <div className="fpp__title">パスポート（外国籍ゲスト）</div>

      {passports.length > 0 && (
        <div className="fpp__grid">
          {passports.map(p => (
            <div key={p.id} className="fpp__item">
              <button
                type="button"
                className="fpp__thumb"
                onClick={() => thumbs[p.id] && setLightbox(thumbs[p.id])}
                aria-label="拡大表示"
              >
                {thumbs[p.id]
                  ? <img src={thumbs[p.id]} alt="パスポート" />
                  : <span className="fpp__thumb-ph">…</span>}
                <span className={`fpp__badge ${p.is_representative ? 'fpp__badge--rep' : ''}`}>
                  {p.is_representative ? '代表' : '同行者'}
                </span>
              </button>
              <button type="button" className="fpp__del" onClick={() => handleDelete(p)} aria-label="削除">✕ 削除</button>
            </div>
          ))}
        </div>
      )}

      <div className="fpp__actions">
        {!hasRepresentative && (
          <FrontButton variant="primary" size="lg" className="fpp__btn" disabled={uploading} onClick={() => repInputRef.current?.click()}>
            📷 代表者のパスポートを撮影
          </FrontButton>
        )}
        <FrontButton variant="secondary" size="lg" className="fpp__btn" disabled={uploading} onClick={() => companionInputRef.current?.click()}>
          ＋ 同行者を追加
        </FrontButton>
      </div>
      {uploading && <div className="fpp__uploading">アップロード中…</div>}
      <div className="fpp__hint">タブレットのカメラで撮影、またはJPEG/PNG画像を選択できます（10MBまで）</div>

      {/* capture=environment で iOS のカメラを直接起動 */}
      <input ref={repInputRef} type="file" accept="image/jpeg,image/png" capture="environment" hidden onChange={onPick(true)} />
      <input ref={companionInputRef} type="file" accept="image/jpeg,image/png" capture="environment" hidden onChange={onPick(false)} />

      {lightbox && (
        <div className="fpp__lightbox" onClick={() => setLightbox(null)} role="dialog" aria-modal="true">
          <img src={lightbox} alt="パスポート拡大" />
          <button type="button" className="fpp__lightbox-close" onClick={() => setLightbox(null)}>閉じる</button>
        </div>
      )}
    </div>
  );
}
