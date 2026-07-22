#!/bin/bash
#
# PMS デプロイスクリプト
# デプロイ先: patina-vps (162.43.23.146) ※会計システムと相乗り
# 使い方: ./deploy/deploy.sh [--skip-build]
#   --skip-build: フロントの再ビルドを省略（バックエンドのみの変更時）
#
set -euo pipefail

LOCAL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="patina-vps"
REMOTE_ROOT="/var/www/pms"

# ------------------------------------------------------------
# 1. フロントエンド本番ビルド
#    REACT_APP_API_URL=/api/v1 : 本番はsame-origin配信のため相対パス
# ------------------------------------------------------------
if [[ "${1:-}" != "--skip-build" ]]; then
    echo "=== フロントエンドをビルド中..."
    (cd "$LOCAL_ROOT/frontend" && REACT_APP_API_URL=/api/v1 npx react-scripts build)
fi

# ------------------------------------------------------------
# 2. バックエンド転送
#    config.local.php を必ず exclude すること:
#    本番DBパスワード等のサーバー固有設定であり、ローカルに存在しないため
#    exclude しないと --delete で本番から消えてしまう
# ------------------------------------------------------------
echo "=== バックエンドを転送中..."
rsync -az --delete \
    --exclude 'composer.phar' \
    --exclude '.DS_Store' \
    --exclude 'scripts/' \
    --exclude 'config/config.local.php' \
    "$LOCAL_ROOT/backend/" "$REMOTE:$REMOTE_ROOT/backend/"

# ------------------------------------------------------------
# 3. フロントエンド転送
# ------------------------------------------------------------
echo "=== フロントエンドを転送中..."
rsync -az --delete --exclude '.DS_Store' \
    "$LOCAL_ROOT/frontend/build/" "$REMOTE:$REMOTE_ROOT/frontend/build/"

# ------------------------------------------------------------
# 4. Cloudflareキャッシュのパージ（規約#23対策）
#    public/ 直下の無ハッシュアセット（ロゴSVG・favicon等）はエッジで
#    約4時間キャッシュされ、差し替えても旧版が配信され続けるため、
#    デプロイのたびにルート直下ファイルのURLを明示パージする。
#    ※static/ 配下はファイル名ハッシュ付きなのでパージ不要
#    ※Freeプランはホスト単位パージ不可・1リクエスト30URLまで（現状14個程度）
# ------------------------------------------------------------
CF_TOKEN_FILE="$HOME/.config/pms/cloudflare_token"
CF_ZONE_ID="4bac9b7704b3ea186e355d2df11c5903"  # enjoyplanning.jp（ゾーンIDは不変）
if [[ -f "$CF_TOKEN_FILE" ]]; then
    echo "=== Cloudflareキャッシュをパージ中..."
    CF_TOKEN=$(tr -d '[:space:]' < "$CF_TOKEN_FILE")
    # ビルドルート直下のファイル一覧からパージURLリストを生成（"/"=index.htmlも含める）
    PURGE_JSON=$(find "$LOCAL_ROOT/frontend/build" -maxdepth 1 -type f -exec basename {} \; |
        python3 -c '
import json, sys
urls = ["https://pms.enjoyplanning.jp/"]
urls += [f"https://pms.enjoyplanning.jp/{l.strip()}" for l in sys.stdin if l.strip()]
print(json.dumps({"files": urls}))')
    PURGE_RESULT=$(curl -s -X POST \
        -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
        --data "$PURGE_JSON" \
        "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" |
        python3 -c 'import json,sys; r=json.load(sys.stdin); print("OK" if r["success"] else f"失敗: {r[\"errors\"]}")')
    echo "パージ: $PURGE_RESULT"
    # パージ失敗はデプロイ失敗にはしない（最大4時間で自然反映されるため）
else
    echo "!!! $CF_TOKEN_FILE がありません。Cloudflareパージをスキップします（旧アセットが最大4時間残ります）"
fi

# ------------------------------------------------------------
# 5. デプロイ後の疎通確認（サーバー内から実行）
#    API 401 = 認証必要 = 正常。フロント 200 = 正常
# ------------------------------------------------------------
echo "=== 疎通確認..."
ssh "$REMOTE" '
    front=$(curl -s -o /dev/null -w "%{http_code}" -k https://localhost/ -H "Host: pms.enjoyplanning.jp")
    api=$(curl -s -o /dev/null -w "%{http_code}" -k https://localhost/api/v1/reservations -H "Host: pms.enjoyplanning.jp")
    echo "フロント: $front (200=正常) / API: $api (401=正常)"
    if [[ "$front" != "200" || "$api" != "401" ]]; then
        echo "!!! 疎通確認に失敗しました。/var/log/nginx/pms_error.log を確認してください"
        exit 1
    fi
'
echo "=== デプロイ完了 ==="
