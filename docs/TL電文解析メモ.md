# TL電文解析メモ

## 解析日: 2026-04-11

実際のTLリンカーン電文10件（7ファイル単体 + 2フォルダ×2件）を解析。

---

## 1. ファイル名の命名規則

```
TLPDAT_YYMMDD000NNNXXX.xml
         ↑日付  ↑連番 ↑室番号(001=1室目, 002=2室目)
```

- **1室予約** → XMLファイル単体
- **複数室予約** → フォルダにまとめて格納、末尾の番号で室を区別
- 予約番号はOTA側で室ごとに**別々**に発番される

---

## 2. 電文の種類（DataClassification）

| 値 | 意味 | サンプル数 |
|----|------|-----------|
| `NewBookReport` | 新規予約 | 5件 |
| `ModificationReport` | 変更通知 | 2件 |
| `CancellationReport` | 取消通知 | 3件 |

---

## 3. OTA別の特徴

### 3.1 料金方式（RoomRateOrPersonalRate）

| OTA | 方式 | 料金タグ | 計算方法 |
|-----|------|----------|----------|
| Booking.com | `RoomRate` | `TotalPerRoomRate` | そのまま1室料金 |
| Agoda | `RoomRate` | `TotalPerRoomRate` | そのまま1室料金 |
| じゃらん | `PersonalRate` | `PerPaxRate` | **PerPaxRate × 人数 = 日額** |
| 楽天(インバウンド) | `PersonalRate` | `PerPaxRate` | **PerPaxRate × 人数 = 日額** |

### 3.2 OTAコード（SalesOfficeCode） — 1617件解析で確認済み

**主要OTA（コード固定）:**

| コード | OTA名 | 件数 |
|--------|-------|------|
| 30 | Booking.com | 734 |
| 66 | じゃらんnet | 192 |
| 11 | 楽天トラベル | 168 |
| 2 | Agoda | 104 |
| 49 | Expedia | 90 |
| 001 | 一休.com | 66 |
| 77 | じゃらんHPダイレクト | 38 |
| 41 | 楽天トラベル | 34 |

**注意: 同一OTAでも複数コードが存在する**

| OTA | 確認済みコード |
|-----|---------------|
| じゃらん系 | 66, 77, AJ, 40, JJ, JCS, B5, E6 |
| 楽天系 | 11, 41, 22, 23, 1Z0 |
| Agoda | 2, 1051, 2606, 4536 |
| Expedia | 49, 47, 51, 52, 50, 48 |
| 一休 | 001, 005 |

→ PMS側のchannel判定はOTA名（SalesOfficeCompanyName）ベースが安全
→ コードだけでは同一OTA内の亜種を判別しきれない

**その他OTA（少数）:**

| OTA名 | 件数 |
|-------|------|
| ANA(トラベラーズホテル) | 17 |
| JTB現地払_るるぶ | 14 |
| ジャルパック | 8 |
| JTB（企画・るるぶ） | 5 |
| スカイチケット | 4 |
| JTB(るるぶ：法人払い) | 3 |
| 楽天グローバルプラットフォーム | 1 |

→ 計**15種類のOTA**を確認。当初想定の7種類より大幅に多い

### 3.3 決済方式の判別（1617件解析で確認）

**OtherServiceInformation内の「決済内容：」から抽出:**

| パターン | 件数 | 意味 |
|----------|------|------|
| `エージェント精算★` | 641 | OTA事前決済（Booking/Agoda等） |
| (決済内容記載なし) | 600 | 主にBooking.com現地精算 |
| `カード決済★` | 239 | じゃらんカード決済 |
| `ツアー会社精算★` | 28 | JTB/ジャルパック/ANA等 |
| `カード決済★ 事前` | 14+α | じゃらん事前カード決済（支払額付き） |
| `法人利用★` | 6 | 法人売掛 |
| `一部精算★` | 5 | 一部OTA精算+一部現地精算 |

→ 「支払額：\XXXXX」が付くパターンもある（一部精算時の現地請求額）
→ SettlementDiv/AmountClaimedは全件0/空 — **OtherServiceInformationのテキスト解析が唯一の判定手段**

### 3.4 ゲスト名のクセ

| OTA | 漢字名 | カナ/半角名 | 注意点 |
|-----|--------|-------------|--------|
| じゃらん | `馬場 祐紀` | `ﾊﾞﾊﾞ ﾕｳｷ`（半角カナ） | 住所・TEL・メール・年代あり |
| Booking.com | `Philippe Brunet` | 同左 | 漢字名=ローマ字名（同一値） |
| 楽天 | `CARLOS AGREDANINOT【精算不要】` | 同左 | **名前に「精算不要」が混入する！** |
| Agoda | `YUSAKU SHIBATA` | 同左 | ローマ字のみ |

→ 楽天の名前フィールドから `【精算不要】` を除去するクレンジングが必要

---

## 4. TLルームタイプコード → PMSマッピング

| TLコード | 件数 | TLタイプ名（表記バリエーション多数） | PMS対応 |
|----------|------|-------------------------------------|---------|
| `0003` | 820 | セミダブルルーム 禁煙 / Small Double Bed Non-Smoking 等13パターン | **SW** |
| `0002` | 629 | ツインルーム 禁煙 / Twin - Non-Smoking 等11パターン | **TW** |
| `0005` | 168 | デラックス ツインルーム 禁煙 / ラージルーム(禁煙) 等10パターン | **LR** |

→ 同じTLコードでもOTAによってRoomTypeNameの表記が異なる（最大13パターン）
→ **RoomTypeCodeで紐づけるべき**（名前ではなく）

### STW（レギュラー）について — OTA上に存在しない内部タイプ

**STWはTLリンカーン / OTA上には存在しない。** ホテル内部のみで使用する部屋タイプ。

- OTAではSW（セミダブル）またはTW（ツイン）として販売
- 予約はSWかTWで入ってくる
- フロントスタッフが在庫状況を見て、**STWの部屋にアサインする手作業**を行う
- STW = SWにもTWにもなれる**兼用部屋**

```
OTA販売タイプ:  SW(0003) / TW(0002) / LR(0005) の3タイプ
PMS管理タイプ:  SW / STW / TW / LR の4タイプ
                STW = SW・TWどちらの予約も受け入れ可能な兼用部屋
```

**アサインロジックへの影響:**
- SW予約 → SW部屋 or STW部屋 にアサイン可能
- TW予約 → TW部屋 or STW部屋 にアサイン可能
- LR予約 → LR部屋のみ
- タイプ不一致アラートは、上記ルールに基づいて判定する必要がある

---

## 5. XML構造（共通フォーマット）

```xml
<AllotmentBookingReport>
  <TransactionType>
    <DataClassification>NewBookReport|ModificationReport|CancellationReport</DataClassification>
    <DataID>一意識別子</DataID>
    <SystemDate>YYYY-MM-DD</SystemDate>
  </TransactionType>

  <AccommodationInformation>
    <AccommodationCode>施設コード（OTA別）</AccommodationCode>
  </AccommodationInformation>

  <SalesOfficeInformation>
    <SalesOfficeCompanyName>OTA名</SalesOfficeCompanyName>
    <SalesOfficeCode>OTAコード</SalesOfficeCode>
  </SalesOfficeInformation>

  <BasicInformation>
    <TravelAgencyBookingNumber>OTA予約番号</TravelAgencyBookingNumber>
    <GuestOrGroupNameSingleByte>ゲスト名（半角/ローマ字）</GuestOrGroupNameSingleByte>
    <GuestOrGroupNameKanjiName>ゲスト名（漢字）</GuestOrGroupNameKanjiName>
    <CheckInDate>YYYY-MM-DD</CheckInDate>
    <CheckOutDate>YYYY-MM-DD</CheckOutDate>
    <Nights>泊数</Nights>
    <TotalRoomCount>室数</TotalRoomCount>
    <GrandTotalPaxCount>総人数</GrandTotalPaxCount>
    <TotalPaxMaleCount>男性数</TotalPaxMaleCount>
    <TotalPaxFemaleCount>女性数</TotalPaxFemaleCount>
    <TotalChildA70Count>子供A(70%)数</TotalChildA70Count>
    <TotalChildB50Count>子供B(50%)数</TotalChildB50Count>
    <TotalChildC30Count>子供C(30%)数</TotalChildC30Count>
    <TotalChildDNoneCount>子供D(0%)数</TotalChildDNoneCount>
    <PackagePlanName>プラン名</PackagePlanName>
    <PackagePlanCode>プランコード</PackagePlanCode>
    <MealCondition>食事条件</MealCondition>
    <OtherServiceInformation>決済情報・備考（フリーテキスト）</OtherServiceInformation>
    <!-- じゃらんのみ -->
    <CheckInTime>HH:MM:SS</CheckInTime>
    <CheckOutTime>HH:MM:SS</CheckOutTime>
  </BasicInformation>

  <BasicRateInformation>
    <RoomRateOrPersonalRate>RoomRate|PersonalRate</RoomRateOrPersonalRate>
    <TaxServiceFee>IncludingServiceAndTax</TaxServiceFee>
    <TotalAccommodationCharge>合計宿泊料（税サ込）</TotalAccommodationCharge>
    <TotalAccommodationCommissionAmount>コミッション額（Booking.comのみ）</TotalAccommodationCommissionAmount>
  </BasicRateInformation>

  <!-- 日別料金（泊数分繰り返し） -->
  <RoomAndGuestInformation>
    <RoomAndGuestList>  <!-- 1泊目 -->
      <RoomInformation>
        <RoomTypeCode>TLルームタイプコード</RoomTypeCode>
        <RoomTypeName>部屋タイプ名（OTA別表記ゆれあり）</RoomTypeName>
        <PerRoomPaxCount>室内人数</PerRoomPaxCount>
      </RoomInformation>
      <RoomRateInformation>
        <RoomDate>YYYY-MM-DD</RoomDate>
        <!-- RoomRateの場合 -->
        <TotalPerRoomRate>1室料金</TotalPerRoomRate>
        <!-- PersonalRateの場合 -->
        <PerPaxRate>1人料金</PerPaxRate>
      </RoomRateInformation>
    </RoomAndGuestList>
    <RoomAndGuestList>  <!-- 2泊目 ... -->
    </RoomAndGuestList>
  </RoomAndGuestInformation>

  <RisaplsInformation>
    <RisaplsCommonInformation>
      <Basic>
        <TelegramData>電文テキスト（人間可読形式の全情報）</TelegramData>
        <PhoneNumber>電話番号</PhoneNumber>
        <PostalCode>郵便番号</PostalCode>
        <Address>住所</Address>
      </Basic>
      <Member>
        <UserName>予約者名</UserName>
        <UserKana>予約者カナ</UserKana>
        <UserTel>電話</UserTel>
        <UserMailAddr>メール</UserMailAddr>
        <UserAddr>住所</UserAddr>
      </Member>
    </RisaplsCommonInformation>
    <AgentNativeInformation>
      <Extend>
        <AmountClaimed>宿泊者請求額（現地精算額、0=OTA精算済）</AmountClaimed>
      </Extend>
      <Extendmytrip>
        <SettlementDiv>決済区分（0=現地精算, 2=カード決済, 6=エージェント精算）</SettlementDiv>
      </Extendmytrip>
    </AgentNativeInformation>
  </RisaplsInformation>
</AllotmentBookingReport>
```

---

## 6. 複数室予約の構造

同一ゲストが複数室を同時予約した場合:
- **1フォルダに室数分のXMLファイル**が格納される
- ファイル名末尾の番号(001, 002)で室を区別
- **予約番号はOTA側で室ごとに別々に発番**
- PMS側では別々の予約として取り込み、guest_links（連結予約）で紐づける

### サンプル: 福佐 康正（じゃらん、2室同時予約）

| ファイル | 予約番号 | 部屋タイプ | 人数 | 合計 |
|---------|---------|-----------|------|------|
| 004001 | 0LM5QWN7 | 0005 ラージルーム | 大人3名 | ¥56,850 |
| 004002 | 0LM5QHKG | 0002 ツイン | 大人2名 | ¥41,174 |

### サンプル: KEIKO YAMAGUCHI（Agoda、2件同時キャンセル）

| ファイル | 予約番号 | 部屋タイプ | CI→CO | 合計 |
|---------|---------|-----------|--------|------|
| 003001 | 1671844071 | 0003 セミダブル | 6/22→6/27 | ¥0 |
| 003002 | 1684252591 | 0003 セミダブル | 6/29→7/4 | ¥0 |

---

## 7. 日別明細の計算ロジック

### RoomRate方式（Booking.com, Agoda）
```
日別売上 = TotalPerRoomRate
```

### PersonalRate方式（じゃらん, 楽天）
```
日別売上 = PerPaxRate × PerRoomPaxCount
```

### 計算例: 福佐 康正（じゃらん、ラージルーム、3名）
| 日付 | PerPaxRate | × 人数 | = 日額 |
|------|-----------|--------|--------|
| 6/5 | ¥6,225 | × 3 | ¥18,675 |
| 6/6 | ¥6,500 | × 3 | ¥19,500 |
| 6/7 | ¥6,225 | × 3 | ¥18,675 |
| **合計** | | | **¥56,850** ✓ |

---

## 8. 食事条件（MealCondition）— 1617件解析結果

| 値 | 件数 | 意味 |
|----|------|------|
| `1nightBreakfast` | 1,465 | 朝食付き（**90%**） |
| `Other` | 135 | その他（OTA独自プラン等） |
| `WithoutMeal` | 17 | 素泊まり |

---

## 重要: OTA別のTL金額の意味が異なる

### AgodaだけTLに「手数料控除後」の金額が来る

実データ検証（予約1686787587 / JINGJING RAO）:
```
Agoda管理画面:  販売料金(税込) ¥26,240 → 手数料 ¥3,148(12%) → 基本料金 ¥23,092
TL電文:         TotalAccommodationCharge = ¥23,092（手数料控除後）
Agoda精算CSV:   支払額 = ¥23,092（一致）
```

| OTA | TLの金額 | 手数料 | 備考 |
|-----|---------|--------|------|
| **Agoda** | **手数料控除後**（ホテル受取額） | TLに含まれない | 手数料率は販売実績で変動（±1%程度） |
| **Booking.com** | 手数料控除前（ゲスト支払額） | `TotalAccommodationCommissionAmount`で別途通知 | コミッション率は固定15%前後 |
| **じゃらん** | 手数料控除前（ゲスト支払額） | TLに含まれない | 精算書で別途確認 |
| **楽天** | 手数料控除前（ゲスト支払額） | TLに含まれない | 精算書で別途確認 |
| **Expedia** | 未確定（要精算書突合） | TLに含まれない | 日額合計との乖離あり、要調査 |

### 問題点
1. **売上分析の歪み**: Agodaだけ売上が低く見える（実質12%程度の差）
2. **会計データの不整合**: 他OTAは「売上」、Agodaは「入金額」がTLに入る
3. **手数料率の変動**: Agodaの手数料率は一律ではなく販売実績で1%前後変動するため、逆算不可

### 対応方針
- TL取込時はそのまま保存（逆算しない）
- 月次精算時にOTA各社のCSV精算書をPMSに取り込み、販売額・手数料・入金額を突合
- 会計ソフト連携フェーズで詳細設計

---

## 8. 食事条件（MealCondition）— 1617件解析結果

→ **実運用では全予約が朝食付き**（ホテルの料金設定が朝食込み）
→ OTAのシステム上「食事なし」が存在するだけで、実際にはどの予約でも朝食提供
→ PMS側で食事条件による出し分けロジックは不要

---

## 9. PMS設計への要件

### 必要なテーブル/カラム

1. **TLルームタイプマッピングテーブル**（新規）
   - tl_room_type_code → pms_room_type_id
   - 0002 → TW, 0003 → SW, 0005 → LR

2. **OTAコードマッピング**（SalesOfficeCode → PMS channel名）
   - 30 → booking, 66 → jalan, 41 → rakuten, 2 → agoda

3. **reservationsテーブルへの追加カラム候補**
   - tl_data_id: TL電文ID（DataID）
   - tl_settlement_div: 決済区分
   - tl_amount_claimed: 宿泊者請求額
   - tl_commission: コミッション額
   - tl_room_type_code: TLルームタイプコード
   - tl_plan_code: TLプランコード
   - tl_plan_name: TLプラン名

4. **reservation_charges 日別明細の自動生成**
   - RoomRateInformationから日別に生成
   - charge_type = 'room'
   - RoomRate: TotalPerRoomRate
   - PersonalRate: PerPaxRate × 人数

5. **名前クレンジング処理**
   - 楽天: `【精算不要】` を名前から除去
   - 半角カナ → 全角カナ変換（じゃらん）

### 未確認事項

- 直販（direct）予約の電文（TL経由ではない可能性）
- 子供料金区分（ChildA/B/C/D）の実際の料金計算方法（63件存在するが詳細未解析）
- 変更通知時の差分構造（全体上書き？差分のみ？）→ 今回のサンプルでは全体上書きに見える

---

## 10. 1617件 全体統計（2026-01〜2027-01）

| 項目 | 値 |
|------|-----|
| 総件数 | 1,617件 |
| パースエラー | 0件 |
| 新規 / 変更 / 取消 | 1,090 / 105 / 422 |
| OTA種類数 | **15種類** |
| 子供を含む予約 | 63件（4%） |
| 料金方式 | RoomRate 1,017件 / PersonalRate 600件 |
| 金額範囲 | ¥9,000 〜 ¥585,899 |
| 最長泊数 | 19泊 |
| 最大人数 | 20名 |
| CI日範囲 | 2026-01-14 〜 2027-01-30 |

### CI月別件数

| 月 | 件数 | | 月 | 件数 |
|----|------|---|----|------|
| 2026-01 | 37 | | 2026-07 | 107 |
| 2026-02 | 130 | | 2026-08 | 137 |
| 2026-03 | 239 | | 2026-09 | 52 |
| 2026-04 | 241 | | 2026-10 | 122 |
| 2026-05 | 235 | | 2026-11 | 69 |
| 2026-06 | 185 | | 2026-12 | 27 |
| | | | 2027-01 | 36 |
