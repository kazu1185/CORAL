# PHP API基盤 実装指示書

Claude Code向け。この指示書に従ってPHP APIの基盤コードを実装すること。

---

## 0. 前提

- サーバー: XServer VPS (162.43.41.91) — Nginx + PHP 8.4 + MySQL 8.4
- DB名: pms_db / ユーザー: pms_user / パスワード: PmsD3v2026!
- ローカル開発: ~/NewPMS/ にプロジェクト構造あり
- 設計ドキュメント: docs/ 配下の .md ファイル群を参照（特に PMS設計ドキュメント_v1_4.md、スタッフ権限設計_引き継ぎ書.md、チェックインチェックアウト処理_引き継ぎ書.md）
- フレームワーク不使用。素のPHP + PDOで実装
- React（フロントエンド）からは /api/v1/ 配下にfetchする
- TLリンカーンとの連携コードはこの指示書の範囲外（API仕様書待ち）

---

## 1. ディレクトリ構成

```
backend/
├── public/
│   ├── index.php                ← 全リクエストのエントリポイント
│   └── .htaccess                ← URLリライト（Nginx用の場合は不要。nginx.conf側で対応）
├── src/
│   ├── Core/
│   │   ├── Router.php           ← URLルーティング
│   │   ├── Request.php          ← リクエスト解析（JSON body、クエリパラメータ）
│   │   ├── Response.php         ← JSONレスポンスヘルパー
│   │   └── Database.php         ← PDO接続（シングルトン）
│   ├── Middleware/
│   │   ├── AuthMiddleware.php   ← セッショントークン検証 + expires_at延長
│   │   └── PermissionMiddleware.php ← 権限チェック
│   └── Controllers/
│       ├── AuthController.php        ← ログイン/ログアウト/PIN変更/スタッフ一覧
│       ├── DashboardController.php   ← ダッシュボード用集約データ
│       ├── ReservationController.php ← 予約一覧・検索・詳細・手動作成
│       ├── RoomController.php        ← ルームインジケーター・清掃ステータス
│       ├── AssignController.php      ← アサインボード（CRUD・D&D操作）
│       ├── CheckinController.php     ← CI/CO処理
│       ├── GuestController.php       ← ゲスト管理・マッチング・マージ
│       ├── DocumentController.php    ← 領収書・請求書の発行
│       └── MasterController.php      ← 各種マスタ（部屋/プラン/税/法人/スタッフ/権限/設定）
├── config/
│   ├── config.php               ← DB接続情報・環境設定
│   └── routes.php               ← ルート定義一覧
└── composer.json                 ← 当面依存なし（autoload設定のみ）
```

---

## 2. エントリポイント（public/index.php）

```
処理フロー:
  ① CORSヘッダー設定（開発時のみ localhost:3000 許可）
  ② composer autoload 読み込み
  ③ config/config.php 読み込み
  ④ config/routes.php でルート定義を読み込み
  ⑤ Router::dispatch() でリクエストをルーティング
  ⑥ 未マッチ → 404 JSON レスポンス
```

### CORS設定の詳細

```php
// 開発環境: React dev server (localhost:3000) からのアクセスを許可
// 本番環境: same-origin になるためCORS不要
header('Access-Control-Allow-Origin: http://localhost:3000');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Credentials: true');

// preflight リクエスト（OPTIONS）はここで終了
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
```

---

## 3. Core クラス

### 3-1. Database.php

PDOシングルトン。全コントローラーから `Database::getInstance()` で取得。

```
設定:
  - charset: utf8mb4
  - PDO::ATTR_ERRMODE → EXCEPTION
  - PDO::ATTR_DEFAULT_FETCH_MODE → FETCH_ASSOC
  - PDO::ATTR_EMULATE_PREPARES → false
```

### 3-2. Request.php

```php
class Request {
    public string $method;      // GET, POST, PUT, PATCH, DELETE
    public string $path;        // /api/v1/reservations/123
    public array $params;       // URLパラメータ（ルートの :id 等）
    public array $query;        // $_GET クエリパラメータ
    public array $body;         // JSON body（POST/PUT/PATCH）
    public ?array $auth;        // 認証済みスタッフ情報（AuthMiddlewareがセット）

    public static function fromGlobals(): self
    // $_SERVER, php://input, $_GET からインスタンス生成
}
```

### 3-3. Response.php

```php
class Response {
    public static function json(mixed $data, int $status = 200): void
    // Content-Type: application/json、json_encode、exit

    public static function error(string $message, int $status = 400, ?array $details = null): void
    // {"error": message, "details": ...}

    public static function paginated(array $items, int $total, int $page, int $perPage): void
    // {"data": items, "pagination": {"total", "page", "per_page", "total_pages"}}
}
```

### 3-4. Router.php

```
シンプルなルーター。
  - addRoute(method, path, handler, options)
  - dispatch(request)

path はパターンマッチ: /api/v1/reservations/:id → params['id'] にキャプチャ

options:
  - 'auth' => true|false（デフォルトtrue。falseはログイン不要エンドポイント）
  - 'permission' => 'reservation.view' 等（権限チェック。省略時はチェックなし）
  - 'device_auth' => true（清掃用デバイストークン認証。authの代わりに使用）

handler は文字列: 'AuthController@login' 形式 → クラスインスタンス化してメソッド呼び出し
```

---

## 4. 認証（2系統）

設計書（スタッフ権限設計_引き継ぎ書.md）に基づく。

### 4-1. フロントスタッフ認証（PIN + セッション）

**ログインフロー:**

```
POST /api/v1/auth/login
Body: { "staff_id": 1, "pin": "1234" }

処理:
  ① staff_id で staffテーブルから取得（is_active = true のみ）
  ② アカウントロック判定:
     - staff の login_fail_count >= system_settings.login_fail_lock_count
       かつ last_login_fail_at + lock_minutes > 現在時刻
       → 423 Locked（"アカウントがロックされています。X分後に再試行してください"）
  ③ password_verify(pin, pin_hash) で照合
     - 失敗: login_fail_count++, last_login_fail_at 更新 → 401
     - 成功: login_fail_count = 0 にリセット
  ④ セッショントークン生成: bin2hex(random_bytes(32))
  ⑤ staff_sessions に INSERT（expires_at = now + timeout分）
  ⑥ レスポンス:
     {
       "token": "セッショントークン",
       "staff": {
         "id": 1,
         "staff_name": "鈴木 一郎",
         "role": "admin",
         "must_change_pin": false,
         "permissions": ["reservation.view", "reservation.create", ...]
       }
     }
```

**注意: staffテーブルに login_fail_count (INT DEFAULT 0) と last_login_fail_at (DATETIME NULL) カラムが必要。DBに存在しなければ ALTER TABLE で追加すること。**

**セッション検証（AuthMiddleware）:**

```
全APIリクエスト（auth=true のエンドポイント）で実行。

① Authorization ヘッダーから "Bearer {token}" を取得
② staff_sessions から token で検索
③ expires_at < 現在時刻 → 401（セッション期限切れ）
④ expires_at を「現在時刻 + timeout分」に UPDATE（アイドルタイムアウト延長）
   timeout値は system_settings から取得（session_timeout_minutes）
⑤ staff テーブルから staff_id でスタッフ情報取得
⑥ is_active = false → 401
⑦ request.auth にスタッフ情報をセット:
   {
     "staff_id": 1,
     "staff_name": "鈴木 一郎",
     "role": "admin",
     "permissions": ["reservation.view", ...]  ← role_permissions から取得
   }
```

**権限チェック（PermissionMiddleware）:**

```
ルート定義に 'permission' => 'reservation.view' がある場合に実行。

① request.auth.role が 'admin' → 常に許可（チェック不要）
② request.auth.permissions に該当 permission_key が含まれるか
③ 含まれない → 403 Forbidden
```

**ログアウト:**

```
POST /api/v1/auth/logout

① Authorization ヘッダーからトークン取得
② staff_sessions から DELETE
③ 200 OK
```

### 4-2. 清掃用デバイストークン認証

```
URLクエリパラメータ ?token=XXXXX で認証。

検証（AuthMiddleware内で分岐）:
  ① device_tokens から token で検索（is_active = true）
  ② マッチしない → 401
  ③ request.auth にセット:
     {
       "device_token": true,
       "device_name": "清掃用iPad-1",
       "role": "housekeeping",
       "permissions": [housekeepingロールの権限一覧]
     }
```

---

## 5. ルート定義（config/routes.php）

### 5-1. 認証

```
POST   /api/v1/auth/login              AuthController@login           auth:false
POST   /api/v1/auth/logout             AuthController@logout
GET    /api/v1/auth/me                 AuthController@me
PUT    /api/v1/auth/pin                AuthController@changePin
GET    /api/v1/auth/staff-list         AuthController@staffList        auth:false
```

- `staff-list` は auth:false（ログイン画面のプルダウン用。名前とIDのみ返す）

### 5-2. ダッシュボード

```
GET    /api/v1/dashboard               DashboardController@index       permission:reservation.view
GET    /api/v1/dashboard/alerts        DashboardController@alerts      permission:reservation.view
```

### 5-3. 予約

```
GET    /api/v1/reservations            ReservationController@index     permission:reservation.view
GET    /api/v1/reservations/:id        ReservationController@show      permission:reservation.view
POST   /api/v1/reservations           ReservationController@store      permission:reservation.create
PUT    /api/v1/reservations/:id        ReservationController@update    permission:reservation.view
POST   /api/v1/reservations/:id/cancel ReservationController@cancel   permission:reservation.cancel
```

### 5-4. 部屋・清掃

```
GET    /api/v1/rooms                   RoomController@index            permission:reservation.view
GET    /api/v1/rooms/indicator         RoomController@indicator        permission:reservation.view
PUT    /api/v1/rooms/:id/housekeeping  RoomController@updateHousekeeping  permission:housekeeping.update

GET    /api/v1/housekeeping            RoomController@housekeepingBoard  device_auth:true
PUT    /api/v1/housekeeping/:id        RoomController@housekeepingUpdate device_auth:true
```

- `/api/v1/housekeeping` はデバイストークン認証（清掃iPad用）

### 5-5. アサイン

```
GET    /api/v1/assigns                 AssignController@index          permission:assign.edit
POST   /api/v1/assigns                AssignController@store           permission:assign.edit
PUT    /api/v1/assigns/:id            AssignController@update          permission:assign.edit
DELETE /api/v1/assigns/:id            AssignController@destroy         permission:assign.edit
POST   /api/v1/assigns/:id/move       AssignController@moveRoom       permission:assign.edit
POST   /api/v1/assigns/:id/split      AssignController@splitMove      permission:assign.edit
```

### 5-6. チェックイン・チェックアウト

```
POST   /api/v1/reservations/:id/checkin    CheckinController@checkin     permission:checkin.execute
POST   /api/v1/reservations/:id/checkout   CheckinController@checkout    permission:checkout.execute
```

### 5-7. ゲスト

```
GET    /api/v1/guests                  GuestController@index           permission:guest.edit
GET    /api/v1/guests/:id              GuestController@show            permission:guest.edit
POST   /api/v1/guests                 GuestController@store            permission:guest.edit
PUT    /api/v1/guests/:id             GuestController@update           permission:guest.edit
POST   /api/v1/guests/:id/merge       GuestController@merge            permission:guest.merge
GET    /api/v1/guests/match           GuestController@matchCandidates   permission:guest.edit
POST   /api/v1/reservations/:id/link-guest  GuestController@linkGuest  permission:guest.edit
```

### 5-8. 帳票（領収書・請求書）

```
POST   /api/v1/documents/receipt       DocumentController@issueReceipt   permission:receipt.issue
POST   /api/v1/documents/invoice       DocumentController@issueInvoice   permission:invoice.issue
GET    /api/v1/documents/:id           DocumentController@show           permission:receipt.issue
GET    /api/v1/documents               DocumentController@index          permission:receipt.issue
POST   /api/v1/documents/:id/reissue   DocumentController@reissue        permission:receipt.issue
```

### 5-9. マスタ管理

```
# 部屋タイプ
GET    /api/v1/master/room-types       MasterController@roomTypes        permission:reservation.view
PUT    /api/v1/master/room-types/:id   MasterController@updateRoomType   permission:master.rooms

# 部屋
GET    /api/v1/master/rooms            MasterController@rooms            permission:reservation.view
PUT    /api/v1/master/rooms/:id        MasterController@updateRoom       permission:master.rooms

# プラン
GET    /api/v1/master/plans            MasterController@plans            permission:reservation.view
PUT    /api/v1/master/plans/:id        MasterController@updatePlan       permission:master.plans

# 宿泊税
GET    /api/v1/master/tax-rules        MasterController@taxRules         permission:reservation.view
PUT    /api/v1/master/tax-rules/:id    MasterController@updateTaxRule    permission:master.tax

# 法人
GET    /api/v1/master/corporates       MasterController@corporates       permission:reservation.view
POST   /api/v1/master/corporates      MasterController@storeCorporate    permission:master.corporate
PUT    /api/v1/master/corporates/:id   MasterController@updateCorporate  permission:master.corporate

# スタッフ
GET    /api/v1/master/staff            MasterController@staff            permission:staff.manage
POST   /api/v1/master/staff           MasterController@storeStaff        permission:staff.manage
PUT    /api/v1/master/staff/:id        MasterController@updateStaff      permission:staff.manage
POST   /api/v1/master/staff/:id/reset-pin  MasterController@resetPin    permission:staff.pin_reset

# 権限
GET    /api/v1/master/permissions      MasterController@permissions      permission:system.permissions
GET    /api/v1/master/role-permissions/:role  MasterController@rolePermissions  permission:system.permissions
PUT    /api/v1/master/role-permissions/:role  MasterController@updateRolePermissions  permission:system.permissions

# システム設定
GET    /api/v1/master/settings         MasterController@settings         permission:system.session_config
PUT    /api/v1/master/settings         MasterController@updateSettings   permission:system.session_config

# 決済方法
GET    /api/v1/master/payment-methods  MasterController@paymentMethods   permission:reservation.view
```

### 5-10. 連結予約

```
POST   /api/v1/guest-links             ReservationController@createLink    permission:reservation.view
DELETE /api/v1/guest-links/:group_id   ReservationController@deleteLink    permission:reservation.view
GET    /api/v1/guest-links/:group_id   ReservationController@showLink      permission:reservation.view
```

### 5-11. 売上・レポート

```
GET    /api/v1/reports/daily           ReportController@daily              permission:report.view
GET    /api/v1/reports/monthly         ReportController@monthly            permission:report.view
GET    /api/v1/reports/occupancy       ReportController@occupancy          permission:report.view
GET    /api/v1/reports/export          ReportController@export             permission:report.export
```

---

## 6. 実装の優先順位

Claude Codeはこの順番でファイルを作成・実装すること。

### Phase 1: 基盤（まずこれが動かないと何もできない）

```
1. composer.json          — autoload 設定
2. config/config.php      — DB接続情報、環境変数
3. src/Core/Database.php  — PDO シングルトン
4. src/Core/Request.php   — リクエストパーサー
5. src/Core/Response.php  — JSONレスポンスヘルパー
6. src/Core/Router.php    — ルーティングエンジン
7. src/Middleware/AuthMiddleware.php      — セッション検証
8. src/Middleware/PermissionMiddleware.php — 権限チェック
9. config/routes.php      — 全ルート定義
10. public/index.php      — エントリポイント
```

### Phase 2: 認証API（ログインできないとフロントが作れない）

```
11. src/Controllers/AuthController.php
    - login（PIN照合・セッション発行・ロック判定）
    - logout（セッション削除）
    - me（現在のセッション情報）
    - changePin（PIN変更）
    - staffList（ログイン画面用。名前とIDのみ）
```

### Phase 3: 画面用API（フロント実装に直結するもの）

```
12. src/Controllers/DashboardController.php
13. src/Controllers/ReservationController.php
14. src/Controllers/RoomController.php
15. src/Controllers/AssignController.php
16. src/Controllers/CheckinController.php
17. src/Controllers/GuestController.php
18. src/Controllers/DocumentController.php
19. src/Controllers/MasterController.php
```

**Phase 3 のコントローラーは、Phase 1〜2が完成してからClaude Codeに別途指示する。この指示書ではPhase 1〜2のコードを完成させることが目標。Phase 3のコントローラーはメソッドのスケルトン（中身はTODOコメント）だけ作り、実装は後回しにすること。**

---

## 7. コーディング規約

- PHP 8.4 の機能を積極的に使用（readonly、named arguments、match式、null safe operator 等）
- 型宣言を必ず付ける（引数・戻り値・プロパティ）
- PSR-4 オートロード（namespace: App\Core、App\Controllers、App\Middleware）
- インデント: スペース4つ
- ファイル末尾に空行1つ
- SQLインジェクション対策: 全クエリでプリペアドステートメント使用（例外なし）
- エラーハンドリング: try-catch でPDOExceptionをキャッチし、Response::error() で返す
- パスワード（PIN）: password_hash() / password_verify() で処理（bcrypt）
- セッショントークン: bin2hex(random_bytes(32))
- 日時: MySQL の DATETIME 型。PHP側は date('Y-m-d H:i:s')
- JSON: JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR

---

## 8. Nginx設定（参考）

```nginx
# /api/v1/ 以下のリクエストを全て public/index.php に転送
location /api/v1/ {
    try_files $uri /backend/public/index.php?$query_string;
}
```

Xserver VPS の nginx.conf に上記を追加。具体的なパスはデプロイ時に調整。

---

## 9. テスト方法

Phase 1〜2 完成後、以下で動作確認:

```bash
# ヘルスチェック（認証不要エンドポイントを1つ作っておく）
curl http://localhost:8080/api/v1/auth/staff-list

# ログイン
curl -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"staff_id": 1, "pin": "1234"}'

# 認証付きリクエスト
curl http://localhost:8080/api/v1/auth/me \
  -H "Authorization: Bearer {token}"

# ログアウト
curl -X POST http://localhost:8080/api/v1/auth/logout \
  -H "Authorization: Bearer {token}"
```

---

## 10. 注意事項

- **TLリンカーンへの書き込みコードは絶対に書かない**（設計の根幹: 受動的PMS）
- DELETEは物理削除しない。論理削除（ステータス変更）で対応
- updated_at / updated_by を持つテーブルは更新時に必ずセット
- adminロールは常に全権限ON。権限チェックのif文で早期returnすること
- staff_activity_logs への記録は重要操作のみ（閲覧操作は記録しない）
- 本番ではCORSヘッダーは出力しない（same-originで動作するため）
- staffテーブルにlogin_fail_count, last_login_fail_at カラムが不足している場合は、seed.sqlの前にALTER TABLEで追加すること
