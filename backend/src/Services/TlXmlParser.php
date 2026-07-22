<?php

namespace App\Services;

/**
 * TLリンカーンXML電文パーサー
 *
 * XMLを構造化配列に変換するクラス
 * OTA別の癖（楽天のPerRoomPaxCount=0、名前汚染等）はここで吸収する
 *
 * チャネルマッピングはDBマスタ（channelsテーブル）から取得した値を使用。
 * setChannelMap() で外部から注入する。未設定の場合はフォールバック定数を使用。
 *
 * 1617件の実データで検証済みのフォーマットに基づく
 */
class TlXmlParser
{
    /**
     * TLルームタイプコード → PMS部屋タイプマッピング
     * 1617件解析: 0003=820件, 0002=629件, 0005=168件
     */
    private const ROOM_TYPE_MAP = [
        '0002' => 'TW',   // ツイン（表記11パターン）
        '0003' => 'SW',   // セミダブル（表記13パターン）
        '0005' => 'LR',   // ラージツイン（表記10パターン）
    ];

    /**
     * OTA名 → PMSチャネルマッピング（フォールバック用定数）
     * 通常はsetChannelMap()でDBから取得した値を使用する。
     * DB未接続時（CLIテスト等）のフォールバックとして残す。
     */
    private const OTA_CHANNEL_MAP_FALLBACK = [
        'Booking.com'       => 'booking',
        'じゃらん'          => 'jalan',
        '楽天'              => 'rakuten',
        'Agoda'             => 'agoda',
        'Expedia'           => 'expedia',
        '一休'              => 'ikyu',
        'ＡＮＡ'            => 'ana',
        'ANA'               => 'ana',
        'JTB'               => 'jtb',
        'るるぶ'            => 'jtb',
        'ジャルパック'      => 'jal',
        'ｼﾞｬﾙﾊﾟｯｸ'         => 'jal',
        'スカイチケット'    => 'skyticket',
    ];

    /**
     * DBから読み込んだチャネルマップ
     * setChannelMap() で注入する。未設定時はフォールバック定数を使用。
     * 形式: ['パターン文字列' => 'channel_code', ...]
     */
    private array $channelMap = [];

    /**
     * DBのchannelsテーブルから構築したチャネルマップを設定する。
     * TlImportService から呼び出される。
     *
     * @param array $channels channelsテーブルの行配列（tl_match_patterns, channel_code を含む）
     */
    public function setChannelMap(array $channels): void
    {
        $this->channelMap = [];
        foreach ($channels as $ch) {
            $patterns = $ch['tl_match_patterns'] ?? '';
            if (!$patterns) continue;
            foreach (explode(',', $patterns) as $pattern) {
                $pattern = trim($pattern);
                if ($pattern !== '') {
                    $this->channelMap[$pattern] = $ch['channel_code'];
                }
            }
        }
    }

    /**
     * 電文種別の変換マップ
     */
    private const TRANSACTION_TYPE_MAP = [
        'NewBookReport'        => 'new',
        'ModificationReport'   => 'modify',
        'CancellationReport'   => 'cancel',
    ];

    /**
     * XML文字列をパースして構造化配列を返す
     *
     * @throws \RuntimeException パース失敗時
     */
    public function parse(string $xmlContent): array
    {
        // XMLパース（エラーを例外に変換するためlibxmlのエラーを抑制）
        libxml_use_internal_errors(true);
        $xml = simplexml_load_string($xmlContent);
        if ($xml === false) {
            $errors = libxml_get_errors();
            libxml_clear_errors();
            $msg = !empty($errors) ? $errors[0]->message : '不明なXMLエラー';
            throw new \RuntimeException("XMLパース失敗: " . trim($msg));
        }

        $basic = $xml->BasicInformation;
        $rate  = $xml->BasicRateInformation;
        $sales = $xml->SalesOfficeInformation;
        $trans = $xml->TransactionType;

        // 電文種別
        $transactionType = self::TRANSACTION_TYPE_MAP[(string)$trans->DataClassification] ?? 'unknown';

        // OTAチャネル解決
        $companyName = (string)$sales->SalesOfficeCompanyName;
        $channel = $this->resolveChannel($companyName);

        // ゲスト名（クリーニング済み）
        $rawName = (string)$basic->GuestOrGroupNameSingleByte;
        $kanjiName = (string)$basic->GuestOrGroupNameKanjiName;
        // 姓名分割せず統合名として保持（guests.name_romaji/name_kanjiに対応）
        $cleanedName = $this->cleanGuestName($rawName);
        $cleanedKanji = $this->cleanGuestName($kanjiName);

        // TLのSingleByte/KanjiNameフィールドはアクセント文字や中国語漢字を「?」に置換する。
        // 「?」が含まれる場合、TelegramData（電文テキスト）の「宿泊者情報」から正しい名前を取得する。
        if (str_contains($cleanedName, '?') || str_contains($cleanedKanji, '?')) {
            $telegramData = (string)($basic->TelegramData ?? '');
            $fallbackName = $this->extractNameFromTelegram($telegramData);
            if ($fallbackName) {
                if (str_contains($cleanedName, '?')) $cleanedName = $fallbackName;
                if (str_contains($cleanedKanji, '?')) $cleanedKanji = $fallbackName;
            }
        }

        // 料金方式と日別料金
        $rateType = (string)$rate->RoomRateOrPersonalRate;
        $totalCharge = (int)$rate->TotalAccommodationCharge;
        $totalPax = (int)$basic->GrandTotalPaxCount;
        $roomCount = (int)$basic->TotalRoomCount ?: 1;

        // 日別料金の抽出
        $dailyRates = $this->extractDailyRates($xml, $rateType, $totalPax, $roomCount);

        // 複数室予約の場合は部屋別料金も抽出
        // extractDailyRatesByRoom() は分割取込時に子予約の個別chargesを生成するために使う
        $roomsData = null;
        if ($roomCount > 1) {
            $roomsData = $this->extractDailyRatesByRoom($xml, $rateType, $totalPax, $roomCount);
        }

        // 丸め差調整
        // Booking.com: ±7円以内（1室あたりの丸め積算）
        // Expedia: 数千〜数万円の差（手数料・税金が別途加算される模様）
        // 方針: 小さい差（1泊あたり10円以内）は最終日で吸収、大きい差はそのまま
        $dailySum = array_sum(array_column($dailyRates, 'amount'));
        if ($totalCharge > 0 && !empty($dailyRates) && $dailySum !== $totalCharge) {
            $diff = $totalCharge - $dailySum;
            $perNightDiff = count($dailyRates) > 0 ? abs($diff) / count($dailyRates) : 0;
            // 1泊あたり10円以内の差なら丸め誤差と判断して最終日で調整
            if ($perNightDiff <= 10) {
                $lastIdx = count($dailyRates) - 1;
                $dailyRates[$lastIdx]['amount'] += $diff;
            }
            // それ以上の差はOTA独自の手数料・税金の可能性があるため調整しない
        }

        // 複数室の丸め差も部屋別に調整
        if ($roomsData && !empty($roomsData['rooms'])) {
            foreach ($roomsData['rooms'] as $ri => &$room) {
                $roomTotal = array_sum(array_column($room['rates'], 'amount'));
                // 部屋別の合計と全体の整合性チェックは親側で行うため、
                // ここでは各部屋内の丸め差のみ調整（最終日で吸収）
            }
            unset($room);
        }

        // ルームタイプ
        $tlRoomTypeCode = $this->extractRoomTypeCode($xml);
        $roomType = self::ROOM_TYPE_MAP[$tlRoomTypeCode] ?? $tlRoomTypeCode;

        // 決済区分（OtherServiceInformationからテキスト解析）
        $otherInfo = (string)$basic->OtherServiceInformation;
        $settlementType = $this->extractSettlementType($otherInfo);

        // コミッション（Booking.comのみ）
        $commission = (int)$rate->TotalAccommodationCommissionAmount;

        // 人数内訳
        $maleCount = (int)$basic->TotalPaxMaleCount;
        $femaleCount = (int)$basic->TotalPaxFemaleCount;
        $childA = (int)$basic->TotalChildA70Count;
        $childB = (int)$basic->TotalChildB50Count;
        $childC = (int)$basic->TotalChildC30Count;
        $childD = (int)$basic->TotalChildDNoneCount;
        $adultCount = $maleCount + $femaleCount;
        $childCount = $childA + $childB + $childC + $childD;

        // 連絡先情報（Risaplsセクションから取得）
        $member = $xml->RisaplsInformation->RisaplsCommonInformation->Member ?? null;
        $basicRisapls = $xml->RisaplsInformation->RisaplsCommonInformation->Basic ?? null;
        $phone = (string)($member->UserTel ?? $basicRisapls->PhoneNumber ?? '');
        $email = (string)($member->UserMailAddr ?? $basicRisapls->Email ?? '');

        // 国籍推定（Booking.comのUserAddrに国名が入る）
        $userAddr = (string)($member->UserAddr ?? '');
        $countryCode = $this->resolveCountryCode($userAddr);

        return [
            // 電文メタ
            'transaction_type' => $transactionType,
            'data_id'          => (string)$trans->DataID,
            'system_date'      => (string)$trans->SystemDate,

            // OTA情報
            'channel'          => $channel,
            'channel_raw'      => $companyName,
            'sales_office_code' => (string)$sales->SalesOfficeCode,

            // 予約基本情報
            'reservation_no'   => (string)$basic->TravelAgencyBookingNumber,
            'booking_date'     => (string)$basic->TravelAgencyBookingDate,
            'booking_time'     => (string)$basic->TravelAgencyBookingTime,

            // ゲスト名（クリーニング済み・統合名）
            'name'             => $cleanedName,
            'name_kanji'       => $cleanedKanji,

            // 日程
            'checkin_date'     => (string)$basic->CheckInDate,
            'checkout_date'    => (string)$basic->CheckOutDate,
            'nights'           => (int)$basic->Nights,

            // 人数（集計値）
            'adult_count'      => $adultCount ?: $totalPax,
            'child_count'      => $childCount,
            'total_pax'        => $totalPax,
            'room_count'       => $roomCount,

            // 人数内訳（TL電文の6区分）
            'male_count'       => $maleCount,
            'female_count'     => $femaleCount,
            'child_a_count'    => $childA,   // 子供A: 70%料金
            'child_b_count'    => $childB,   // 子供B: 50%料金
            'child_c_count'    => $childC,   // 子供C: 30%料金
            'child_d_count'    => $childD,   // 子供D: 添い寝/0%

            // 部屋タイプ
            'room_type'        => $roomType,
            'tl_room_type_code' => $tlRoomTypeCode,

            // 料金
            'rate_type'        => $rateType,
            'total_charge'     => $totalCharge,
            'daily_rates'      => $dailyRates,
            'commission'       => $commission,

            // 決済
            'settlement_type'   => $settlementType,
            'other_info'        => $otherInfo,
            'points_discounts'  => $this->extractPointsDiscounts($xml),
            'amount_claimed'    => $this->extractAmountClaimed($xml),

            // 電文テキスト（人間可読形式の全情報。明細突合の確認用）
            'telegram_data'     => (string)($xml->RisaplsInformation->RisaplsCommonInformation->Basic->TelegramData ?? ''),

            // 複数室予約の部屋別データ（room_count > 1 の場合のみ）
            'rooms_data'        => $roomsData,

            // プラン
            'plan_name'        => (string)$basic->PackagePlanName,
            'plan_code'        => (string)$basic->PackagePlanCode,
            'meal_condition'   => (string)$basic->MealCondition,

            // 連絡先
            'phone'            => $phone,
            'email'            => $email,

            // 国籍（Booking.comのUserAddrから推定。取れない場合はnull）
            'country_code'     => $countryCode,
            // 優先言語（国籍から推定）
            'preferred_language' => $countryCode ? self::countryToLanguage($countryCode) : null,

            // 予約日時（TLの予約日+予約時刻を結合）
            'booked_at'        => trim((string)$basic->TravelAgencyBookingDate . ' ' . (string)$basic->TravelAgencyBookingTime) ?: null,
        ];
    }

    /**
     * 日別料金を抽出
     * RoomRate方式: TotalPerRoomRateをそのまま使用
     * PersonalRate方式: PerPaxRate × 人数（楽天のPerRoomPaxCount=0対策込み）
     */
    private function extractDailyRates(\SimpleXMLElement $xml, string $rateType, int $totalPax, int $roomCount): array
    {
        $rates = [];
        $roomAndGuest = $xml->RoomAndGuestInformation->RoomAndGuestList ?? null;
        if (!$roomAndGuest) return $rates;

        foreach ($roomAndGuest as $rg) {
            $date = (string)$rg->RoomRateInformation->RoomDate;
            if (!$date) continue;

            if ($rateType === 'RoomRate') {
                $amount = (int)$rg->RoomRateInformation->TotalPerRoomRate;
            } else {
                // PersonalRate: 1人料金 × 人数
                $perPax = (int)$rg->RoomRateInformation->PerPaxRate;
                $paxCount = $this->resolvePaxCount($rg->RoomInformation, $totalPax, $roomCount);
                $amount = $perPax * $paxCount;
            }

            $rates[] = ['date' => $date, 'amount' => $amount];
        }

        return $rates;
    }

    /**
     * 部屋内人数を解決
     * 楽天はPerRoomPaxCountを0で送ってくるため、Male+Femaleで代替する
     */
    private function resolvePaxCount(\SimpleXMLElement $roomInfo, int $totalPax, int $roomCount): int
    {
        $count = (int)$roomInfo->PerRoomPaxCount;
        if ($count > 0) return $count;

        // フォールバック: 男女別カウントから合算
        $male = (int)$roomInfo->RoomPaxMaleCount;
        $female = (int)$roomInfo->RoomPaxFemaleCount;
        if ($male + $female > 0) return $male + $female;

        // 最終フォールバック: 総人数 ÷ 室数
        return $roomCount > 0 ? (int)ceil($totalPax / $roomCount) : $totalPax;
    }

    /**
     * 複数室予約の部屋別日別料金を抽出
     *
     * RoomAndGuestList は「日付 × 室数」分並ぶ構造。
     * 同一日付のN番目のエントリ = N番目の部屋。
     * Agoda 5室 / Booking 2室混在で検証済み。
     *
     * @return array ['rooms' => [0 => ['room_type'=>'TW', 'room_type_code'=>'0002', 'pax_count'=>2, 'rates'=>[['date'=>..., 'amount'=>...], ...]], ...]]
     */
    public function extractDailyRatesByRoom(\SimpleXMLElement $xml, string $rateType, int $totalPax, int $roomCount): array
    {
        $rooms = [];
        $roomAndGuest = $xml->RoomAndGuestInformation->RoomAndGuestList ?? null;
        if (!$roomAndGuest) return ['rooms' => []];

        // 日付ごとにグルーピング（出現順でroom_indexを振る）
        $dateCounters = []; // 日付 => 次のroom_index
        foreach ($roomAndGuest as $rg) {
            $date = (string)$rg->RoomRateInformation->RoomDate;
            if (!$date) continue;

            // 同一日付の何番目のエントリか（0-based）= room_index
            $roomIndex = $dateCounters[$date] ?? 0;
            $dateCounters[$date] = $roomIndex + 1;

            // 部屋タイプ
            $roomTypeCode = (string)($rg->RoomInformation->RoomTypeCode ?? '');
            $roomType = self::ROOM_TYPE_MAP[$roomTypeCode] ?? $roomTypeCode;

            // 人数（部屋別）
            $paxCount = $this->resolvePaxCount($rg->RoomInformation, $totalPax, $roomCount);

            // 料金
            if ($rateType === 'RoomRate') {
                $amount = (int)$rg->RoomRateInformation->TotalPerRoomRate;
            } else {
                $perPax = (int)$rg->RoomRateInformation->PerPaxRate;
                $amount = $perPax * $paxCount;
            }

            // rooms配列を初期化（room_indexが新出の場合）
            if (!isset($rooms[$roomIndex])) {
                $rooms[$roomIndex] = [
                    'room_type'      => $roomType,
                    'room_type_code' => $roomTypeCode,
                    'pax_count'      => $paxCount,
                    'rates'          => [],
                ];
            }

            $rooms[$roomIndex]['rates'][] = ['date' => $date, 'amount' => $amount];
        }

        return ['rooms' => $rooms];
    }

    /**
     * ルームタイプコードを抽出（最初のRoomAndGuestListから）
     */
    private function extractRoomTypeCode(\SimpleXMLElement $xml): string
    {
        $first = $xml->RoomAndGuestInformation->RoomAndGuestList->RoomInformation->RoomTypeCode ?? null;
        return $first ? (string)$first : '';
    }

    /**
     * 国コードから第一言語コード（ISO 639-1）を返す
     */
    private static function countryToLanguage(string $countryCode): string
    {
        // 国コード → 第一言語（ホテルで使う主要言語のみ）
        static $map = [
            'JP' => 'ja', 'KR' => 'ko', 'CN' => 'zh', 'TW' => 'zh', 'HK' => 'zh',
            'US' => 'en', 'GB' => 'en', 'AU' => 'en', 'NZ' => 'en', 'CA' => 'en',
            'IE' => 'en', 'SG' => 'en', 'PH' => 'en', 'IN' => 'en', 'ZA' => 'en',
            'FR' => 'fr', 'BE' => 'fr',
            'DE' => 'de', 'AT' => 'de', 'CH' => 'de',
            'ES' => 'es', 'MX' => 'es', 'AR' => 'es', 'CO' => 'es', 'CL' => 'es', 'PE' => 'es',
            'IT' => 'it',
            'PT' => 'pt', 'BR' => 'pt',
            'RU' => 'ru', 'UA' => 'ru',
            'TH' => 'th', 'VN' => 'vi', 'ID' => 'id', 'MY' => 'ms',
            'NL' => 'nl', 'SE' => 'sv', 'NO' => 'no', 'DK' => 'da', 'FI' => 'fi',
            'PL' => 'pl', 'CZ' => 'cs', 'HU' => 'hu', 'RO' => 'ro',
            'TR' => 'tr', 'GR' => 'el', 'IL' => 'he',
            'IS' => 'is', 'LT' => 'lt', 'LV' => 'lv', 'BG' => 'bg', 'HR' => 'hr', 'RS' => 'sr',
        ];
        return $map[$countryCode] ?? 'en';
    }

    /**
     * 住所文字列から国コードを推定
     * Booking.comのUserAddrに「France」「Japan」等の国名が入る
     * 先頭の「. 」を除去して国名マッチ。該当なしならnull
     * 実データ: ". France", "Japan", ". Germany", "Korea, South" 等
     */
    private function resolveCountryCode(string $address): ?string
    {
        if (empty($address)) return null;

        // 先頭の「. 」を除去（Booking.comの書式）
        $cleaned = preg_replace('/^\.\s*/', '', trim($address));
        if (empty($cleaned)) return null;

        // 国名 → 国コードマップ（実データから確認済みのパターン）
        static $countryMap = [
            'Japan'                    => 'JP',
            'France'                   => 'FR',
            'Germany'                  => 'DE',
            'United Kingdom'           => 'GB',
            'Canada'                   => 'CA',
            'Spain'                    => 'ES',
            'Poland'                   => 'PL',
            'Netherlands'              => 'NL',
            'Italy'                    => 'IT',
            'Hungary'                  => 'HU',
            'United States of America' => 'US',
            'United States'            => 'US',
            'Taiwan'                   => 'TW',
            'Belgium'                  => 'BE',
            'Switzerland'              => 'CH',
            'Sweden'                   => 'SE',
            'Finland'                  => 'FI',
            'Denmark'                  => 'DK',
            'Israel'                   => 'IL',
            'Australia'                => 'AU',
            'Peru'                     => 'PE',
            'Latvia'                   => 'LV',
            'Lithuania'                => 'LT',
            'Iceland'                  => 'IS',
            'Austria'                  => 'AT',
            'Russian Federation'       => 'RU',
            'Russia'                   => 'RU',
            'Korea, South'             => 'KR',
            'South Korea'              => 'KR',
            'China'                    => 'CN',
            'Hong Kong'                => 'HK',
            'Singapore'                => 'SG',
            'Thailand'                 => 'TH',
            'Philippines'              => 'PH',
            'Malaysia'                 => 'MY',
            'Indonesia'                => 'ID',
            'Vietnam'                  => 'VN',
            'India'                    => 'IN',
            'New Zealand'              => 'NZ',
            'Mexico'                   => 'MX',
            'Brazil'                   => 'BR',
            'Portugal'                 => 'PT',
            'Norway'                   => 'NO',
            'Ireland'                  => 'IE',
            'Czech Republic'           => 'CZ',
            'Greece'                   => 'GR',
            'Turkey'                   => 'TR',
            'South Africa'             => 'ZA',
            'Argentina'                => 'AR',
            'Colombia'                 => 'CO',
            'Chile'                    => 'CL',
            'Romania'                  => 'RO',
            'Croatia'                  => 'HR',
            'Bulgaria'                 => 'BG',
            'Serbia'                   => 'RS',
            'Ukraine'                  => 'UA',
            'Cambodia'                 => 'KH',
            'Sri Lanka'                => 'LK',
        ];

        // 完全一致（大文字小文字無視）
        foreach ($countryMap as $name => $code) {
            if (strcasecmp($cleaned, $name) === 0) {
                return $code;
            }
        }

        // 日本の住所（都道府県名が含まれる場合）
        if (preg_match('/[都道府県市区町村]/', $cleaned)) {
            return 'JP';
        }

        return null;
    }

    /**
     * OTA名からPMSチャネルを解決
     * 部分一致で判定（同一OTAでも表記ゆれがあるため完全一致は使わない）
     * DB注入マップ → フォールバック定数の順で照合する
     */
    private function resolveChannel(string $companyName): string
    {
        // まずDB由来のマップで照合
        $map = !empty($this->channelMap) ? $this->channelMap : self::OTA_CHANNEL_MAP_FALLBACK;
        foreach ($map as $pattern => $channel) {
            if (mb_strpos($companyName, $pattern) !== false) {
                return $channel;
            }
        }
        return 'other';
    }

    /**
     * ゲスト名のクリーニング
     * 楽天が名前に【精算不要】を混入させる問題等を除去
     */
    /**
     * TelegramData（電文テキスト）から宿泊者名を抽出する
     * XMLの名前フィールドが文字化け（?）している場合のフォールバック用。
     * 全OTA共通で「宿泊者情報：\n  名前  TEL:」の形式。
     *
     * @return string|null 抽出成功時は名前、失敗時はnull（元の名前をそのまま使う）
     */
    private function extractNameFromTelegram(string $telegramData): ?string
    {
        if (empty($telegramData)) return null;

        // 「宿泊者情報：」の次の行から名前を取得
        // DB内では実改行(\n)で格納されている
        // 形式: "宿泊者情報：\n  名前  TEL:..." or "宿泊者情報：\n  名前\n"
        if (preg_match('/宿泊者情報[：:]\s*\n\s+(.+?)(?:\s+TEL:|\n)/u', $telegramData, $m)) {
            $name = trim($m[1]);
            // cleanGuestNameと同じ処理を適用（楽天の精算タグ等を除去）
            $name = preg_replace('/【[^】]*】/u', '', $name);
            $name = trim(preg_replace('/\s+/u', ' ', $name));
            // 空や「?」のままなら失敗
            if ($name !== '' && !str_contains($name, '?')) {
                return $name;
            }
        }

        return null;
    }

    private function cleanGuestName(string $name): string
    {
        // 楽天の精算情報タグを除去
        $name = preg_replace('/【[^】]*】/u', '', $name);

        // じゃらんの末尾ゴミ除去
        $name = preg_replace('/_!$/', '', $name);

        // 前後の空白を正規化
        return trim(preg_replace('/\s+/u', ' ', $name));
    }

    /**
     * 名前を姓・名に分割
     * 最初のスペースで分割。スペースなしの場合は全体を姓に
     */
    private function splitName(string $name): array
    {
        $parts = preg_split('/\s+/u', $name, 2);
        return [
            $parts[0] ?? '',
            $parts[1] ?? '',
        ];
    }

    /**
     * 決済区分をOtherServiceInformationから抽出
     * TLの構造化フィールド（SettlementDiv/AmountClaimed）は全件0/空で信頼できないため
     * フリーテキストのパターンマッチが唯一の判定手段
     */
    private function extractSettlementType(string $otherInfo): string
    {
        if (mb_strpos($otherInfo, 'エージェント精算') !== false) return 'ota_prepaid';
        if (mb_strpos($otherInfo, 'ツアー会社精算') !== false)   return 'ota_prepaid';
        if (mb_strpos($otherInfo, 'カード決済') !== false)       return 'card';
        if (mb_strpos($otherInfo, '法人利用') !== false)         return 'corporate';
        if (mb_strpos($otherInfo, '一部精算') !== false)         return 'partial';
        return 'on_site';
    }

    /**
     * ポイント割引・補助金・クーポン等を抽出
     * XMLパス: RisaplsInformation > RisaplsCommonInformation > BasicRate > PointsDiscountList
     * じゃらんのみ存在。複数エントリあり（ポイント + 補助金 + PayPay等が並列）。
     * PointsDivは省略されるケースがあるためnull許容。
     */
    private function extractPointsDiscounts(\SimpleXMLElement $xml): array
    {
        $discounts = [];
        $basicRate = $xml->RisaplsInformation->RisaplsCommonInformation->BasicRate ?? null;
        if (!$basicRate) return $discounts;

        foreach ($basicRate->PointsDiscountList as $pd) {
            $amount = (int)$pd->PointsDiscount;
            if ($amount <= 0) continue; // 0円割引は無視

            $discounts[] = [
                'name'   => (string)$pd->PointsDiscountName ?: 'ポイント割引',
                'amount' => $amount,
                'div'    => $pd->PointsDiv !== null ? (int)$pd->PointsDiv : null,
            ];
        }

        return $discounts;
    }

    /**
     * 宿泊者請求額を抽出
     * 0 = OTA精算済み（ゲストへの請求なし）
     * 正の値 = 現地で受け取る金額
     * 注意: 全件0/空のOTAもあるため、テキスト解析（extractSettlementType）と併用する
     */
    private function extractAmountClaimed(\SimpleXMLElement $xml): int
    {
        $extend = $xml->RisaplsInformation->AgentNativeInformation->Extend ?? null;
        return $extend ? (int)$extend->AmountClaimed : 0;
    }
}
