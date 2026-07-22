# TL連携 設計メモ

TLリンカーン（シーナッツ）との連携に関する設計方針。API仕様書は未到着のため、現時点での設計判断を記録する。

---

## 基本原則

- **1WAY（受信のみ）**。PMSからTLへの書き込みは一切行わない
- TL受信データは**原本として保持**し、書き換えない
- フロント操作で変更するのは運用フィールド（`checkin_date`, `display_last_name` 等）

---

## 取込フロー

```
① TL受信（Cron 5分間隔）
   → XMLをファイルアーカイブ（storage/tl_import/）
   → パースして tl_pending_imports テーブル（仮称）に一時保存
   → tl_import_logs に受信ログ記録

② ダッシュボードに通知表示
   → 種別ごとに表示: 新規予約 / 予約変更 / 予約取消
   → 件数バッジでスタッフに知らせる

③ スタッフが内容を確認
   → 新規: 予約概要を表示
   → 変更: 旧値 → 新値 の差分表示
   → 取消: 対象予約の情報表示 + アサイン状況の警告

④ 取込ボタンで反映
   → reservations テーブルに反映
   → tl_pending_imports のステータスを「取込済」に更新
```

**自動反映はしない。** 必ずスタッフの目視確認を経て取り込む。

---

## 通知種別と処理

### 新規予約

```
取込処理:
  ① reservations に INSERT
  ② tl_* カラムに原本値をセット
  ③ guest_match_status = 'pending'（ゲスト紐付け待ち）
  ④ ダッシュボードのアラートに「ゲスト未確定」が表示される
```

### 予約変更

主な変更内容:
- **支払方法の変更**（現地払い→事前カード決済、ポイント追加等）
- **日程の短縮**（OTA各社は日程延長に対応していないため、短縮のみ）
- **人数変更**
- **ゲスト名変更**

```
取込画面:
  ① 変更内容を差分表示（旧値 → 新値）
  ② アサイン済みで日程短縮の場合:
     → 警告ダイアログ「アサインが解除されます。再アサインしてください」
  ③ 確認後に取込:
     → reservations の運用フィールドを更新
     → tl_* カラムも新しいTL値で更新
     → 日程短縮の場合はアサインを物理削除（CI前なので履歴不要）
```

### 予約取消

```
取込処理:
  ① status = 'cancelled' に更新
  ② アサインを物理削除（CI前なので履歴不要）
  ③ CI済み（checked_in）の場合は取消不可の警告を表示
     → スタッフの判断で手動対応
```

---

## TL原本フィールド

reservationsテーブルに以下のTL原本カラムを保持（migration 002で追加済み）:

| カラム | 用途 | 書き換え |
|--------|------|---------|
| `tl_last_name` | TL原本姓 | 不可 |
| `tl_first_name` | TL原本名 | 不可 |
| `tl_checkin_date` | TL原本CI日 | TL変更通知時のみ更新 |
| `tl_checkout_date` | TL原本CO日 | TL変更通知時のみ更新 |
| `tl_room_type` | TL原本部屋タイプ | TL変更通知時のみ更新 |

フロント操作で変更するフィールド:

| カラム | 用途 |
|--------|------|
| `checkin_date` / `checkout_date` | 運用上の日程 |
| `room_type` | 運用上の部屋タイプ |
| `display_last_name` / `display_first_name` | 表示用ゲスト名 |

予約詳細の「予約情報」セクションでは、TL原本と運用値が異なる場合のみ原本値を表示する。

---

## 保留テーブル（未作成・仮設計）

TL受信データを一時保持するテーブル。API仕様書到着後にカラムを確定する。

```sql
-- 仮: tl_pending_imports
CREATE TABLE tl_pending_imports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    import_type ENUM('new', 'modify', 'cancel') NOT NULL,
    reservation_no VARCHAR(50) NULL,
    channel VARCHAR(30) NULL,
    raw_xml TEXT NULL,                -- 受信XMLの生データ
    parsed_data JSON NULL,            -- パース済みデータ
    matched_reservation_id INT NULL,  -- 既存予約とのマッチング結果
    status ENUM('pending', 'imported', 'rejected', 'error') NOT NULL DEFAULT 'pending',
    imported_at DATETIME NULL,
    imported_by INT NULL,
    received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_status (status),
    INDEX idx_received (received_at)
);
```

---

## 現状の実装状況

| 項目 | 状態 | 備考 |
|------|------|------|
| TL受信・XMLパース | ❌ 未実装 | API仕様書待ち |
| 保留テーブル | ❌ 未作成 | 上記の仮設計あり |
| ダッシュボード通知 | ⚠ ログ表示のみ | 取込ボタン・差分表示は未実装 |
| TL原本カラム | ✅ 実装済み | tl_checkin_date, tl_checkout_date, tl_room_type |
| キャンセルAPI | ✅ 実装済み | アサインも物理削除 |
| 日程変更時のアサイン解除 | ✅ 実装済み | 予約詳細の日程変更で物理削除 |
| 予約復元API | ✅ 実装済み | cancelled/no_show → confirmed |

---

## 注意事項

- TLからの受信XMLは全件ファイルアーカイブする（`storage/tl_import/`）
- 重複受信（同じ予約番号の再送）は tl_import_logs で duplicate として記録
- CI済み予約のTL取消通知は自動反映せず、スタッフの判断に委ねる
- TL連携コードは全て `backend/src/Services/` 配下に置く予定（Controllers からは呼ばない）

---

_API仕様書到着後にこの文書を更新すること。_
