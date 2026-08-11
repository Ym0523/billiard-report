# ビリヤードPOS 売上分析レポート（暗号化・自動公開）

Firestore の自動バックアップ（`stores/store-a/backups/latest`）から売上分析レポートを生成し、
**パスワードで暗号化**した1枚の `index.html` を **GitHub Pages** に公開します。

- 🔒 レポート本文は AES‑GCM で暗号化。**平文はリポジトリに一切入りません**（公開リポでもパスワード無しでは中身を復元できません）。鍵はパスワードから PBKDF2(SHA‑256, 21万回) で導出。
- 🔁 GitHub Actions が **毎日21:00(JST)** に自動でビルド＆公開（手動実行も可）。
- 📊 KPI・日次推移・カテゴリ別・曜日/時間帯・商品/常連ランキング・特別日効果・メダル・現金差異。

## 中身
| ファイル | 役割 |
|---|---|
| `build.mjs` | 取得→集計→描画→暗号化→ `dist/index.html` 出力 |
| `lib/fetch.mjs` | Firestore から最新バックアップを取得（匿名認証・読取専用） |
| `lib/analytics.mjs` | 集計ロジック（取消は売上から除外） |
| `lib/render.mjs` | レポートHTML＋CSS（テーマ対応） |
| `lib/charts.mjs` | 依存なしのSVGチャート |
| `lib/crypto.mjs` | 暗号化＋パスワード入力ページ |
| `.github/workflows/deploy.yml` | 自動ビルド＆Pages公開 |

## ローカルで確認
```bash
npm install
# ① クラウドから取得して生成
REPORT_PASSWORD='任意のパスワード' node build.mjs
# ② 手元のバックアップJSONから生成（オフライン）
REPORT_PASSWORD='任意のパスワード' BACKUP_FILE=./backup.json node build.mjs
# 生成物: dist/index.html （ブラウザで開いてパスワード入力）
```

## GitHub で公開する手順（初回）
1. GitHub で **新しいリポジトリ**（例 `billiard-report`）を作成（Public でOK。中身は暗号化済み）。
2. このフォルダを push:
   ```bash
   git remote add origin https://github.com/<ユーザー名>/billiard-report.git
   git push -u origin main
   ```
3. リポジトリの **Settings → Secrets and variables → Actions** で:
   - **New repository secret**: `REPORT_PASSWORD` = 閲覧用パスワード（強めに）。
4. **Settings → Pages** で **Source = GitHub Actions** を選択。
5. **Actions** タブで `build-and-deploy` を **Run workflow**（または push で自動実行）。
   - 完了後、`https://<ユーザー名>.github.io/billiard-report/` で公開。パスワードを入れると表示。

> 以降は毎日自動更新。パスワードを変えたい時は Secret を更新して再実行。

## セキュリティ注意
- 公開ホスティング上での安全性は **パスワードの強度に依存**します。推測されにくいものにしてください。
- Firestore のバックアップには会計データが含まれます。Security Rules（本体リポの `firestore.rules`）で
  読取を絞る運用を推奨します（現状は「認証済みなら読取可」。多店舗化時は operator/member に限定）。
