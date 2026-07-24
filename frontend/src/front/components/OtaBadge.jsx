import { OTA_LABELS } from '../../utils/constants';
import './OtaBadge.css';

// 既存 ota-badge.css に識別色があるチャネル。未登録チャネル(ikyu等)はフォールバック表示する
const KNOWN_OTA = new Set(['jalan', 'rakuten', 'booking', 'agoda', 'expedia', 'direct', 'phone', 'walkin', 'corporate']);

/** OTAバッジ（既存 styles/ota-badge.css を使用 = 規約 #15）。未知チャネルはニュートラル表示 */
export default function OtaBadge({ channel }) {
  if (!channel) return null;
  const label = OTA_LABELS[channel] || channel;
  const cls = KNOWN_OTA.has(channel) ? `ota-badge ota-${channel}` : 'ota-badge fota--unknown';
  return <span className={cls}>{label}</span>;
}
