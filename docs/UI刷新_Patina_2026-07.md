# UI刷新「Patina」デザイン言語（2026-07-02）

## 背景・意図

ユーザー要望:「システムチックなUIは好きではない。研ぎ澄まされたUIかつ見やすいフォントサイズなど細部までこだわる。スクラップ＆ビルド可」

旧UIは濃紺サイドバー＋青アクセント＋スレートグレーの典型的な管理画面テンプレート調だった。
これを、ホテルのロゴ（真鍮色の珊瑚 / HOTEL PATINA ISHIGAKIJIMA）に合わせた
**ウォームアイボリー基調＋墨色テキスト＋ブラス（真鍮）アクセント**の「Patina」デザイン言語に全面刷新した。

## デザイン原則

1. **寒色の排除** — スレート/青系をやめ、全てのグレーを暖色寄り（茶みのグレー）に統一
2. **線より面と余白** — 罫線を薄くし、区切りは余白・ホバー面・淡い影で表現
3. **可読性優先のタイポグラフィ** — base 14px→15px、極小フォント（9〜11px）は原則12px以上へ。バッジ類のみ11px許容
4. **色は意味があるときだけ** — 主要アクション=ブラス、危険=赤、成功=緑。OTA識別色とステータス意味色は維持
5. **静かなフィードバック** — フォーカスはブラスの淡いリング、ホバーは面色変化。ベタ塗り警告面は廃止（左3pxアクセントボーダー方式）

## トークン定義（styles/variables.css）

| トークン | 値 | 用途 |
|---------|-----|------|
| --text-primary | #26221B | 本文（墨色） |
| --text-secondary | #6F6858 | 補足 |
| --text-muted | #A79E8C | ラベル・無効 |
| --bg-main | #F4F2ED | 画面地（アイボリー） |
| --bg-card | #FFFFFF | カード面 |
| --bg-hover / --bg-inset | #F8F6F1 / #FAF8F4 | ホバー面 / くぼみ面 |
| --border-default / light / strong | #E6E1D6 / #F0ECE3 / #D4CDBD | 罫線3段階（strongは入力欄輪郭用） |
| --accent-blue | **#8A7440（ブラス）** | 主要アクション。**旧名のまま値だけ変更**（下記注意参照） |
| --accent-blue-hover / soft / ring | #6F5C31 / 10%面 / 28%リング | ホバー / 選択面 / フォーカスリング |
| --accent-red / green / yellow ほか | 彩度を落とした意味色 | 危険 / 成功 / 注意 |
| --status-* | 低彩度の意味色ペア | 予約ステータスバッジ |
| --ota-* | **変更なし** | OTAチャネル識別色（CLAUDE.md指定） |

フォント: Noto Sans JP のまま。xs12 / sm13 / base15 / lg17 / xl20 / 2xl25。
角丸: sm6 / md10 / lg14。影: 3段階（輪郭代わりの極薄 → 浮遊面用）。
ダークテーマは theme.css で暖色チャコールに上書き（ブラスは明るい真鍮 #C2A968 に振替）。

## ⚠️ 重要な注意（次セッション向け）

1. **--accent-blue は「ブラス色」**。変数名は歴史的経緯（1,200箇所超のvar()参照を壊さないため）で維持している。「青」に戻さないこと
2. **OTAカラー・意味色の系統は不変**。じゃらん赤 / 楽天深赤 / Booking紺 / 統合予約の紫グラデ等は識別色
3. **CRAのcss-loaderは CSS内の `content: url(/...)` / `url(/...)` をモジュール解決しようとしてビルドエラーになる**。public/ 配下の画像をCSSから参照しない。ダークテーマのロゴ切替は filter (invert+hue-rotate) で実装済み
4. **ロゴSVG** — ライトシェル用に `public/coral-logo-dark.svg` / `coral-icon-dark.svg`（墨色文字版）を生成して Sidebar.jsx から参照。元の白抜き版（coral-logo.svg / coral-icon.svg）も残してある
5. **ダッシュボードのアラート一覧**は `max-height: 44vh` のスクロール領域。子要素に `flex-shrink: 0` が必須（外すと潰れる）
6. 在庫カレンダーの sticky ヘッダーは行高固定（line-height明示）とセットで成立している。フォントサイズを変える場合は行高もセットで調整

## 変更ファイル一覧

- 基盤: styles/variables.css, styles/theme.css, index.css
- シェル: components/Sidebar.css(+jsx ロゴ差替), Header.css, Layout.css
- 共通: styles/ota-badge.css（11px化・角丸5px）, styles/status-badge.css（ピル型+先頭ドット）, components/ConfirmDialog.css, PinChangeDialog.css, CalendarPicker.css
- ページ: LoginPage, Dashboard, ReservationList, ReservationDetail, ReservationCreate, AssignBoard, RoomIndicator, RoomInventory, GuestList, GuestDetail, GroupReservation, Report, settings/SettingsPage の各css
- 追加アセット: public/coral-logo-dark.svg, public/coral-icon-dark.svg

**JSXの変更は Sidebar.jsx のロゴパス差し替えのみ。ロジック・レイアウト構造・セレクタ名は全て維持**（アサインボードのバー幅calc等、規約#7も遵守）。

## 未対応・今後の候補

- ダークテーマの切替UIは未実装（`html[data-theme="dark"]` を手動付与すれば動作する状態）
- ルームインジケーターの「在室」左ボーダーが旧「青」からブラスに変わった。別色（teal等）を割り当てる選択肢あり
- --accent-yellow-soft / --accent-teal-soft 等の淡面トークンは未定義（各ページでrgba直書き+コメントで対応）。増えるようならvariables.cssへ昇格させる
