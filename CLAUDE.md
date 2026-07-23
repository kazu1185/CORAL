# CLAUDE.md - PMS プロジェクトルール

## 絶対ルール（必ず守ること）

1. **明示的な指示なしにコードを書かない。** 設計の確認・提案は自由にしてよいが、ファイルの作成・変更は必ずユーザーの承認を得てから行う。
   - **例外: git commit / git push は都度の承認不要。** 承認済みの作業のコミットとGitHub（origin/main）へのプッシュは、完了時にそのまま実行してよい（2026-07-23 ユーザー指示。コミットメッセージは日本語）。
2. **TLリンカーンへの書き込みコードは絶対に書かない。** PMSは1WAY（受信のみ）。TLへの送信API、在庫更新、料金更新のコードは一切禁止。
3. **物理DELETEは使わない。** データの削除はステータス変更（論理削除）で行う。ただしCI前のアサイン操作は例外（作業過程のため物理削除を許可）。
4. **日本語でコミュニケーションする。** コメントもコミットメッセージも日本語。
5. **コードにはなぜそう書いたかをコメントで残す。** 詳細は `docs/コーディング規約・注意事項.md` を参照。開発中に新しい注意事項が出たら追記する。
6. **開発の途中途中でまとめを .md ファイルに残す。** 機能実装・設計判断・仕様変更があった時点で、記憶が薄れる前に `docs/` に記録する。
7. **新セッション開始時は `docs/コーディング規約・注意事項.md` を必ず読む。** 過去セッションで判明した禁止事項・注意事項が蓄積されている。読まずにコーディングを始めてはならない。
8. **コンテキストが重くなったら申告する。** 会話が長くなりレスポンスが遅くなったり精度が落ちそうな場合は、ユーザーに「コンテキストが重くなってきました」と報告し、セッション引き継ぎファイルを書いてから新セッションへの切り替えを提案する。

---

## プロジェクト概要

沖縄県の小規模ホテル（11-30室）向けカスタムPMS。

- チャネルマネージャー: TLリンカーン（シーナッツ）から予約を受信するのみ（1WAY）
- ユーザー: フロントスタッフ最大6名、清掃スタッフ最大10名（タブレット）
- OTA: じゃらん・楽天・Booking.com・Agoda・Expedia他 計約20チャネル

---

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| バックエンド | PHP 8.4（開発）/ 8.5（本番）+ MySQL 8.4 |
| フロントエンド | React |
| Webサーバー | Nginx 1.28 |
| サーバー | XServer VPS（Ubuntu 26.04）※会計システム(transaction.enjoyplanning.jp)と相乗り |
| 本番IP | 162.43.23.146（SSH: `ssh patina-vps`） |
| 本番URL | https://pms.enjoyplanning.jp（Cloudflare経由） |
| 定期処理 | Cron（TL予約取込 5分間隔） |
| リアルタイム同期 | ポーリング方式（5〜10秒間隔）※WebSocket不使用 |

---

## ディレクトリ構造

```
~/NewPMS/
├── CLAUDE.md              ← このファイル
├── docs/                  ← 設計ドキュメント・引き継ぎ書・UI仕様書
│   ├── PMS設計ドキュメント_v1_4.md
│   ├── UI仕様_ダッシュボード.md
│   ├── UI仕様_予約一覧.md
│   ├── UI仕様_アサインボード.md
│   ├── UI仕様_ルームインジケーター.md
│   ├── UI仕様_予約詳細.md
│   └── ...引き継ぎ書各種
├── frontend/              ← React アプリ
│   ├── public/
│   ├── src/
│   │   ├── components/    ← 共通コンポーネント
│   │   ├── pages/         ← 画面コンポーネント
│   │   ├── hooks/         ← カスタムフック
│   │   ├── api/           ← API呼び出し関数
│   │   ├── styles/        ← CSS / テーマ
│   │   └── utils/         ← ユーティリティ
│   ├── package.json
│   └── ...
├── backend/               ← PHP API
│   ├── public/            ← Webルート（index.php）
│   │   └── index.php      ← APIルーター
│   ├── src/
│   │   ├── Controllers/   ← APIコントローラー
│   │   ├── Models/        ← データモデル
│   │   ├── Services/      ← ビジネスロジック
│   │   ├── Middleware/    ← 認証・権限チェック
│   │   └── Config/        ← DB接続・環境設定
│   ├── migrations/        ← DBマイグレーション（SQLファイル）
│   └── composer.json
├── database/              ← DB関連
│   ├── schema.sql         ← 全テーブル定義
│   ├── seed.sql           ← テストデータ
│   └── migrations/        ← 変更差分SQL
├── mock/                  ← UIモック（HTMLファイル）
│   ├── pms_dashboard.html
│   ├── pms_reservation_list.html
│   ├── pms_assign_board.html
│   ├── pms_room_indicator.html
│   ├── pms_reservation_detail.html
│   └── pms_housekeeping.html
└── deploy/                ← デプロイ用スクリプト
    └── deploy.sh
```

---

## デプロイ先（VPS）の構成

```
VPS: /var/www/pms/            ※2026-07-07 本番デプロイ済み（詳細: docs/デプロイ記録_2026-07-07.md）
├── frontend/
│   └── build/             ← Nginxドキュメントルート（Reactビルド）
├── backend/               ← PHPソース一式（public/index.php にNginxがfastcgiで直結）
│   └── config/
│       └── config.local.php ← 本番DB接続情報（リポジトリ外・サーバーにのみ存在）
└── storage/
    ├── tl_incoming/       ← TL電文の受信ディレクトリ（cronが5分毎に取込）
    ├── tl_import/         ← TL受信XML全件アーカイブ
    ├── passports/         ← パスポート画像
    └── logs/              ← tl-import.log 等

デプロイ: ./deploy/deploy.sh （rsync方式。config.local.php は絶対に消さないこと）
Nginx設定: /etc/nginx/sites-available/pms ＋ /etc/nginx/conf.d/pms-ratelimit.conf
Cron: /etc/cron.d/pms-tl-import（www-data・5分間隔）
```

---

## ローカル開発サーバー起動手順

ユーザーから「システムを起動して」「開始して」等の指示があった場合、以下の順序で起動する。

```bash
# 1. PHPバックエンドAPIサーバー（ポート8080）
cd /Users/kazumasa/NewPMS/backend && php -S localhost:8080 -t public > /tmp/pms-api.log 2>&1 &

# 2. Reactフロントエンド開発サーバー（ポート3000）
cd /Users/kazumasa/NewPMS/frontend && PORT=3000 nohup npx react-scripts start > /tmp/pms-dev.log 2>&1 &

# 3. 起動確認（数秒待ってからHTTPステータスをチェック）
sleep 5
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/v1/reservations  # 401=認証必要=正常
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000                       # 200=正常
```

- **フロントURL:** http://localhost:3000
- **API URL:** http://localhost:8080/api/v1
- フロントエンドのAPI接続先は `frontend/src/api/client.js` の `API_BASE` で設定（デフォルト: `http://localhost:8080/api/v1`）
- 両方のサーバーを起動しないとDBからデータが読めない

---

## 設計原則

### データ設計
- 予約・アサイン・売上は独立エンティティ（分離設計）
- 税率・ルールはDBマスタテーブルで管理（ハードコードしない）
- 部屋・フロアの配置はマスタ駆動（rooms / room_types テーブル）
- updated_at / updated_by を重要テーブルに付与

### フロントエンド
- ライトテーマがデフォルト（ダークモードはCSS変数で切替可能）
- デザイントークン（2026-07「Patina」刷新後）: 背景#F4F2ED（アイボリー）、カード#fff、ボーダー#E6E1D6、テキスト主#26221B（墨色）、主要アクション#8A7440（ブラス。変数名は互換のため --accent-blue のまま）。詳細は docs/UI刷新_Patina_2026-07.md
- フォント: Noto Sans JP（300〜700）
- OTAカラー: じゃらん#DC2626、楽天#991B1B、Booking#1E3A5F、直販#16A34A、電話#EA580C、Agoda#7C3AED、Expedia#CA8A04

### バックエンド
- REST API（/api/reservations、/api/rooms 等）
- 認証: スタッフ名 + PIN → セッショントークン
- 清掃ボード: デバイストークン認証（PINログイン不要）
- TL受信XMLは全件ファイルアーカイブ

---

## DB接続情報

| 項目 | 値 |
|------|-----|
| ホスト | localhost |
| DB名 | pms_db |
| ユーザー | pms_user |
| パスワード | PmsD3v2026! |
| 文字セット | utf8mb4 |

---

## やってはいけないこと

- TLリンカーンへの書き込みコード
- 物理DELETE文（論理削除を使う）
- ユーザーの承認なしのコード生成
- 税率・宿泊税ルールのハードコード（マスタテーブルを参照する）
- 予約データの直接変更（TLから届いたtl_last_name等の原本フィールドは書き換えない）
