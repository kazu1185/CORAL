import './FrontButton.css';

/**
 * フロントモード共通ボタン（仕様書 §5）
 * variant: 'primary' | 'secondary' | 'danger'
 * size:    'lg'(56px) | 'xl'(64px)
 * 色はPatinaトークンのみ（ハードコード禁止 = 規約 #21）
 */
export function FrontButton({ variant = 'primary', size = 'lg', disabled = false, onClick, children, className = '', ...rest }) {
  const cls = [
    'fbtn',
    `fbtn--${variant}`,
    `fbtn--${size}`,
    disabled ? 'fbtn--disabled' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} onClick={disabled ? undefined : onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  );
}

/** 戻るボタン（44×44px 円形・仕様書 §5） */
export function FrontBackButton({ onClick, ariaLabel = '戻る' }) {
  return (
    <button type="button" className="fbtn-back" onClick={onClick} aria-label={ariaLabel}>←</button>
  );
}
