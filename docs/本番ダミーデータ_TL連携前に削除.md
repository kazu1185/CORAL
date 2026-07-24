# 本番ダミーデータ（テストモード用）— TL連携開始前に必ず削除

作成: 2026-07-24 / 目的: 本番でTL電文取込を開始する**前**の動作確認・デモ用。

## ⚠ 最重要

**TLリンカーンとのAPI接続（電文取込）を開始する前に、必ず下記のteardownで跡形もなく削除すること。**
削除しないと、本物のTL予約とダミーが混在して稼働率・売上・部屋状況が壊れる。

## 投入済み内容（本番 pms.enjoyplanning.jp）

- 期間: 2026-07-24 〜 2026-08-12（直近20泊）／稼働率 平均 ≈89.6%
- 予約190件（子予約5含む）／ゲスト184／アサイン187／明細625／連結7
- 全レコードに **DMYマーカー**: `reservations.reservation_no LIKE 'DMY%'` / `guests.guest_code LIKE 'DMY%'` / `reservation_notes='【ダミー・TL連携前に削除】'`
- 網羅した特殊事例: 複数室グループ×2（group_parent＋子＋guest_links）／飛び泊（guest_links.status='gap'・room_blocked）／途中部屋移動（1予約2アサイン）／ノーショー／未アサイン確定（pending）／外国籍・子供連れ・VIP／各OTA・1〜4泊・全プラン混在
- 宿泊税は沖縄県ルールが valid_from 2027-02-01 のため対象期間は 0 円（正しい）
- 検証済み: 部屋二重予約0・課金整合（confirmed の amount と明細一致）・本物データ0件（全てDMY）

## スクリプト所在

- 生成: `backend/scripts/dummy_seed.php`（二重投入ガード付き・冪等でない＝再実行前に必ずteardown）
- 削除: `backend/scripts/dummy_teardown.php`（DMYマーカーのみ物理削除・本物には触れない）
- 本番サーバーにも scp 済み: `/var/www/pms/backend/scripts/`
- `backend/scripts/` は `deploy.sh` のrsync対象外（デプロイで消えも配布もされない。消えていたらリポジトリから再scp）

## 削除コマンド（TL連携前に実行）

```bash
ssh patina-vps "cd /var/www/pms/backend && php scripts/dummy_teardown.php"
```

出力の「残存DMY: 0（完全に削除されました）」を確認すること。実行後は reservations 等が0件に戻る
（TL取込前提のため本来空）。

## 再投入したい場合（構成を変えたい等）

先に teardown → 必要ならスクリプトを調整して scp → `php scripts/dummy_seed.php`。
乱数シードは固定（mt_srand(20260724)）なので同じ構成が再現される。
