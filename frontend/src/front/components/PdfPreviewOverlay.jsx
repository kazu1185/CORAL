import { useEffect, useRef } from 'react';
import { FrontButton } from './FrontButton';
import './PdfPreviewOverlay.css';

/**
 * アプリ内PDFプレビュー（仕様書 §4.4 / 計画書§5-1 のスパイク方針）
 *
 * iPad standalone PWA では <a download> や別タブ遷移がトラップになりやすいため、
 * blob を objectURL 化して全画面モーダルの <iframe> に表示する。
 * 「印刷」は iframe から window.print() を呼び AirPrint に載せる（実機確認はPhase 5）。
 *
 * props:
 *   url   … objectURL（呼び出し側が apiFetchBlob→createObjectURL で生成。解放も呼び出し側）
 *   title … ヘッダー文言
 *   onClose … 閉じる
 */
export default function PdfPreviewOverlay({ url, title = '領収書', onClose }) {
  const iframeRef = useRef(null);

  // Escで閉じる（PC/外付けキーボード互換）
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handlePrint = () => {
    // iframe内のPDFを印刷（iPadではAirPrintダイアログが開く想定）
    try {
      iframeRef.current?.contentWindow?.focus();
      iframeRef.current?.contentWindow?.print();
    } catch {
      // 一部ブラウザでcross-origin扱いになる場合の保険（同一オリジンblobなら通常は成功）
      window.print();
    }
  };

  if (!url) return null;
  return (
    <div className="fpdf" role="dialog" aria-modal="true">
      <div className="fpdf__bar">
        <div className="fpdf__title">{title}</div>
        <div className="fpdf__spacer" />
        <FrontButton variant="secondary" size="lg" onClick={handlePrint}>🖨 印刷</FrontButton>
        <FrontButton variant="primary" size="lg" onClick={onClose}>閉じる</FrontButton>
      </div>
      <iframe ref={iframeRef} className="fpdf__frame" src={url} title={title} />
    </div>
  );
}
