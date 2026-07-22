/**
 * 国コード・国名マスタ（ISO 3166-1 alpha-2）
 * よく使う国を先頭に配置（沖縄のホテルで頻出する国籍順）
 * コード入力でも名前検索でもヒットするよう日英両方を持つ
 */
export const COUNTRIES = [
  // よく使う国（先頭グループ）
  { code: 'JP', name: '日本', nameEn: 'Japan' },
  { code: 'KR', name: '韓国', nameEn: 'South Korea' },
  { code: 'TW', name: '台湾', nameEn: 'Taiwan' },
  { code: 'CN', name: '中国', nameEn: 'China' },
  { code: 'HK', name: '香港', nameEn: 'Hong Kong' },
  { code: 'US', name: 'アメリカ', nameEn: 'United States' },
  { code: 'TH', name: 'タイ', nameEn: 'Thailand' },
  { code: 'PH', name: 'フィリピン', nameEn: 'Philippines' },
  { code: 'SG', name: 'シンガポール', nameEn: 'Singapore' },
  { code: 'AU', name: 'オーストラリア', nameEn: 'Australia' },
  { code: 'GB', name: 'イギリス', nameEn: 'United Kingdom' },
  { code: 'FR', name: 'フランス', nameEn: 'France' },
  { code: 'DE', name: 'ドイツ', nameEn: 'Germany' },
  { code: 'CA', name: 'カナダ', nameEn: 'Canada' },
  { code: 'MY', name: 'マレーシア', nameEn: 'Malaysia' },
  { code: 'ID', name: 'インドネシア', nameEn: 'Indonesia' },
  { code: 'VN', name: 'ベトナム', nameEn: 'Vietnam' },
  { code: 'IN', name: 'インド', nameEn: 'India' },
  { code: 'IT', name: 'イタリア', nameEn: 'Italy' },
  { code: 'ES', name: 'スペイン', nameEn: 'Spain' },
  { code: 'NZ', name: 'ニュージーランド', nameEn: 'New Zealand' },
  { code: 'MX', name: 'メキシコ', nameEn: 'Mexico' },
  { code: 'BR', name: 'ブラジル', nameEn: 'Brazil' },
  { code: 'RU', name: 'ロシア', nameEn: 'Russia' },
  // その他（アルファベット順）
  { code: 'AF', name: 'アフガニスタン', nameEn: 'Afghanistan' },
  { code: 'AL', name: 'アルバニア', nameEn: 'Albania' },
  { code: 'DZ', name: 'アルジェリア', nameEn: 'Algeria' },
  { code: 'AR', name: 'アルゼンチン', nameEn: 'Argentina' },
  { code: 'AT', name: 'オーストリア', nameEn: 'Austria' },
  { code: 'BD', name: 'バングラデシュ', nameEn: 'Bangladesh' },
  { code: 'BE', name: 'ベルギー', nameEn: 'Belgium' },
  { code: 'BT', name: 'ブータン', nameEn: 'Bhutan' },
  { code: 'BO', name: 'ボリビア', nameEn: 'Bolivia' },
  { code: 'BG', name: 'ブルガリア', nameEn: 'Bulgaria' },
  { code: 'KH', name: 'カンボジア', nameEn: 'Cambodia' },
  { code: 'CL', name: 'チリ', nameEn: 'Chile' },
  { code: 'CO', name: 'コロンビア', nameEn: 'Colombia' },
  { code: 'HR', name: 'クロアチア', nameEn: 'Croatia' },
  { code: 'CZ', name: 'チェコ', nameEn: 'Czech Republic' },
  { code: 'DK', name: 'デンマーク', nameEn: 'Denmark' },
  { code: 'EG', name: 'エジプト', nameEn: 'Egypt' },
  { code: 'FI', name: 'フィンランド', nameEn: 'Finland' },
  { code: 'GR', name: 'ギリシャ', nameEn: 'Greece' },
  { code: 'HU', name: 'ハンガリー', nameEn: 'Hungary' },
  { code: 'IS', name: 'アイスランド', nameEn: 'Iceland' },
  { code: 'IR', name: 'イラン', nameEn: 'Iran' },
  { code: 'IQ', name: 'イラク', nameEn: 'Iraq' },
  { code: 'IE', name: 'アイルランド', nameEn: 'Ireland' },
  { code: 'IL', name: 'イスラエル', nameEn: 'Israel' },
  { code: 'JO', name: 'ヨルダン', nameEn: 'Jordan' },
  { code: 'KZ', name: 'カザフスタン', nameEn: 'Kazakhstan' },
  { code: 'KE', name: 'ケニア', nameEn: 'Kenya' },
  { code: 'KW', name: 'クウェート', nameEn: 'Kuwait' },
  { code: 'LA', name: 'ラオス', nameEn: 'Laos' },
  { code: 'LB', name: 'レバノン', nameEn: 'Lebanon' },
  { code: 'LU', name: 'ルクセンブルク', nameEn: 'Luxembourg' },
  { code: 'MO', name: 'マカオ', nameEn: 'Macau' },
  { code: 'MV', name: 'モルディブ', nameEn: 'Maldives' },
  { code: 'MN', name: 'モンゴル', nameEn: 'Mongolia' },
  { code: 'MA', name: 'モロッコ', nameEn: 'Morocco' },
  { code: 'MM', name: 'ミャンマー', nameEn: 'Myanmar' },
  { code: 'NP', name: 'ネパール', nameEn: 'Nepal' },
  { code: 'NL', name: 'オランダ', nameEn: 'Netherlands' },
  { code: 'NG', name: 'ナイジェリア', nameEn: 'Nigeria' },
  { code: 'NO', name: 'ノルウェー', nameEn: 'Norway' },
  { code: 'OM', name: 'オマーン', nameEn: 'Oman' },
  { code: 'PK', name: 'パキスタン', nameEn: 'Pakistan' },
  { code: 'PA', name: 'パナマ', nameEn: 'Panama' },
  { code: 'PE', name: 'ペルー', nameEn: 'Peru' },
  { code: 'PL', name: 'ポーランド', nameEn: 'Poland' },
  { code: 'PT', name: 'ポルトガル', nameEn: 'Portugal' },
  { code: 'QA', name: 'カタール', nameEn: 'Qatar' },
  { code: 'RO', name: 'ルーマニア', nameEn: 'Romania' },
  { code: 'SA', name: 'サウジアラビア', nameEn: 'Saudi Arabia' },
  { code: 'RS', name: 'セルビア', nameEn: 'Serbia' },
  { code: 'LK', name: 'スリランカ', nameEn: 'Sri Lanka' },
  { code: 'SE', name: 'スウェーデン', nameEn: 'Sweden' },
  { code: 'CH', name: 'スイス', nameEn: 'Switzerland' },
  { code: 'TR', name: 'トルコ', nameEn: 'Turkey' },
  { code: 'UA', name: 'ウクライナ', nameEn: 'Ukraine' },
  { code: 'AE', name: 'アラブ首長国連邦', nameEn: 'United Arab Emirates' },
  { code: 'UZ', name: 'ウズベキスタン', nameEn: 'Uzbekistan' },
  { code: 'ZA', name: '南アフリカ', nameEn: 'South Africa' },
];

/**
 * 国コードから表示名を取得（コード付き: "日本（JP）"形式）
 *
 * getCountryShort() と別に存在する理由:
 * - ゲスト詳細の情報欄ではコード単体だと不親切、名前単体だと国籍フィールドが
 *   実際は2文字コードを保持していることが直感的に分かりにくい。
 * - 「日本（JP）」のように両方見せることでコードと名前の対応を明示する用途。
 * - 一覧やバッジでは getCountryShort（短縮形）を使う。使い分けが必要なので統合しない。
 */
export function getCountryName(code) {
  if (!code) return '—';
  const c = COUNTRIES.find(c => c.code === code);
  return c ? `${c.name}（${c.code}）` : code;
}

/**
 * 国コードから短い表示名を取得
 */
export function getCountryShort(code) {
  if (!code) return '—';
  const c = COUNTRIES.find(c => c.code === code);
  return c ? c.name : code;
}
