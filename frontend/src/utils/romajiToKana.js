/**
 * ローマ字（ヘボン式）→ カタカナ変換ユーティリティ
 * 日本人名のローマ字をカタカナに変換するための関数
 * スペースはそのまま保持（姓名の区切り）
 *
 * 対応パターン:
 * - 基本音節: ka, ki, ku, ke, ko, sa, shi, su, se, so, etc.
 * - 拗音: sha, chi, tsu, kya, etc.
 * - 促音: kk→ッキ, tt→ッチ, etc.（子音の重複）
 * - 長音: ou→オウ, uu→ウウ（そのまま変換、長音記号は使わない）
 * - ン: n の後に母音・y以外の子音 or 末尾
 */

// ローマ字→カタカナのマッピング（長い順に優先マッチ）
const ROMAJI_MAP = [
  // 4文字
  ['ttsu', 'ッツ'],
  ['cchi', 'ッチ'],
  // 3文字（拗音・特殊音）
  ['sha', 'シャ'], ['shi', 'シ'], ['shu', 'シュ'], ['she', 'シェ'], ['sho', 'ショ'],
  ['cha', 'チャ'], ['chi', 'チ'], ['chu', 'チュ'], ['che', 'チェ'], ['cho', 'チョ'],
  ['tsu', 'ツ'],
  ['kya', 'キャ'], ['kyi', 'キィ'], ['kyu', 'キュ'], ['kye', 'キェ'], ['kyo', 'キョ'],
  ['gya', 'ギャ'], ['gyi', 'ギィ'], ['gyu', 'ギュ'], ['gye', 'ギェ'], ['gyo', 'ギョ'],
  ['nya', 'ニャ'], ['nyi', 'ニィ'], ['nyu', 'ニュ'], ['nye', 'ニェ'], ['nyo', 'ニョ'],
  ['hya', 'ヒャ'], ['hyi', 'ヒィ'], ['hyu', 'ヒュ'], ['hye', 'ヒェ'], ['hyo', 'ヒョ'],
  ['bya', 'ビャ'], ['byi', 'ビィ'], ['byu', 'ビュ'], ['bye', 'ビェ'], ['byo', 'ビョ'],
  ['pya', 'ピャ'], ['pyi', 'ピィ'], ['pyu', 'ピュ'], ['pye', 'ピェ'], ['pyo', 'ピョ'],
  ['mya', 'ミャ'], ['myi', 'ミィ'], ['myu', 'ミュ'], ['mye', 'ミェ'], ['myo', 'ミョ'],
  ['rya', 'リャ'], ['ryi', 'リィ'], ['ryu', 'リュ'], ['rye', 'リェ'], ['ryo', 'リョ'],
  ['jya', 'ジャ'], ['jyi', 'ジィ'], ['jyu', 'ジュ'], ['jye', 'ジェ'], ['jyo', 'ジョ'],
  ['dya', 'ヂャ'], ['dyi', 'ヂィ'], ['dyu', 'ヂュ'], ['dye', 'ヂェ'], ['dyo', 'ヂョ'],
  // 2文字
  ['ka', 'カ'], ['ki', 'キ'], ['ku', 'ク'], ['ke', 'ケ'], ['ko', 'コ'],
  ['sa', 'サ'], ['si', 'シ'], ['su', 'ス'], ['se', 'セ'], ['so', 'ソ'],
  ['ta', 'タ'], ['ti', 'チ'], ['tu', 'ツ'], ['te', 'テ'], ['to', 'ト'],
  ['na', 'ナ'], ['ni', 'ニ'], ['nu', 'ヌ'], ['ne', 'ネ'], ['no', 'ノ'],
  ['ha', 'ハ'], ['hi', 'ヒ'], ['hu', 'フ'], ['he', 'ヘ'], ['ho', 'ホ'],
  ['fu', 'フ'],
  ['ma', 'マ'], ['mi', 'ミ'], ['mu', 'ム'], ['me', 'メ'], ['mo', 'モ'],
  ['ya', 'ヤ'], ['yi', 'イ'], ['yu', 'ユ'], ['ye', 'イェ'], ['yo', 'ヨ'],
  ['ra', 'ラ'], ['ri', 'リ'], ['ru', 'ル'], ['re', 'レ'], ['ro', 'ロ'],
  ['wa', 'ワ'], ['wi', 'ウィ'], ['we', 'ウェ'], ['wo', 'ヲ'],
  ['ga', 'ガ'], ['gi', 'ギ'], ['gu', 'グ'], ['ge', 'ゲ'], ['go', 'ゴ'],
  ['za', 'ザ'], ['zi', 'ジ'], ['zu', 'ズ'], ['ze', 'ゼ'], ['zo', 'ゾ'],
  ['da', 'ダ'], ['di', 'ヂ'], ['du', 'ヅ'], ['de', 'デ'], ['do', 'ド'],
  ['ba', 'バ'], ['bi', 'ビ'], ['bu', 'ブ'], ['be', 'ベ'], ['bo', 'ボ'],
  ['pa', 'パ'], ['pi', 'ピ'], ['pu', 'プ'], ['pe', 'ペ'], ['po', 'ポ'],
  ['ja', 'ジャ'], ['ji', 'ジ'], ['ju', 'ジュ'], ['je', 'ジェ'], ['jo', 'ジョ'],
  // 1文字（母音）
  ['a', 'ア'], ['i', 'イ'], ['u', 'ウ'], ['e', 'エ'], ['o', 'オ'],
  ['n', 'ン'], // 末尾の n はンに変換
];

// 促音になる子音（同じ子音が連続した場合にッを挿入）
const DOUBLE_CONSONANTS = new Set(['k', 'g', 's', 'z', 't', 'd', 'p', 'b', 'c', 'f', 'h', 'j', 'm', 'r', 'w']);

/**
 * ローマ字文字列をカタカナに変換
 * @param {string} romaji ローマ字文字列（スペース区切りOK）
 * @returns {string} カタカナ文字列（スペースは保持）
 */
export function romajiToKana(romaji) {
  if (!romaji) return '';

  // 小文字に統一してから変換
  const input = romaji.toLowerCase().trim();
  let result = '';
  let i = 0;

  while (i < input.length) {
    // スペースはそのまま保持（姓名の区切り）
    if (input[i] === ' ') {
      result += ' ';
      i++;
      continue;
    }

    // 促音チェック: 同じ子音が連続（例: kk, tt, pp）
    if (i + 1 < input.length
        && input[i] === input[i + 1]
        && DOUBLE_CONSONANTS.has(input[i])) {
      result += 'ッ';
      i++; // 1文字だけ進める（次の子音は通常のマッピングで処理）
      continue;
    }

    // 「n」の特殊処理: n の後が母音・y・n 以外ならン
    if (input[i] === 'n' && i + 1 < input.length) {
      const next = input[i + 1];
      if (!'aiueony'.includes(next)) {
        result += 'ン';
        i++;
        continue;
      }
    }

    // ローマ字マッピングを長い順にマッチ試行
    let matched = false;
    for (const [rom, kana] of ROMAJI_MAP) {
      if (input.substring(i, i + rom.length) === rom) {
        result += kana;
        i += rom.length;
        matched = true;
        break;
      }
    }

    // どのパターンにもマッチしない文字はそのまま出力（記号等）
    if (!matched) {
      result += input[i];
      i++;
    }
  }

  return result;
}

/**
 * 文字列が日本語のローマ字として変換可能かチェック
 * 全てアルファベットとスペースで構成されている場合にtrueを返す
 * @param {string} str
 * @returns {boolean}
 */
export function isConvertibleRomaji(str) {
  if (!str) return false;
  return /^[a-zA-Z\s]+$/.test(str.trim());
}
