// レポートをビルドして dist/index.html を出力する。
//   データ: 既定は Firestore から取得。BACKUP_FILE=path.json を指定すればローカルJSONを使う。
//   パスワード: 環境変数 REPORT_PASSWORD（必須）。
// 使い方: REPORT_PASSWORD=xxxx node build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { analyze } from './lib/analytics.mjs';
import { renderReport, REPORT_CSS } from './lib/render.mjs';
import { encrypt, pageTemplate } from './lib/crypto.mjs';

const password = process.env.REPORT_PASSWORD;
if (!password) { console.error('ERROR: 環境変数 REPORT_PASSWORD を設定してください。'); process.exit(1); }

async function loadStore() {
  const file = process.env.BACKUP_FILE;
  if (file) {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    // BackupData 丸ごと or store 部分の両方を許容
    const store = raw.store || raw;
    return { store, exportedAt: raw.exportedAt || null };
  }
  const { fetchStore } = await import('./lib/fetch.mjs');
  return fetchStore();
}

const { store, exportedAt } = await loadStore();
const now = Date.now();
const data = analyze(store, { store: process.env.STORE_ID || 'store-a', exportedAt, generatedAt: now });

if (!data.kpi.days) { console.error('ERROR: 締めデータ(closings)が0件です。まだ集計できません。'); process.exit(1); }

const body = renderReport(data);
const payload = await encrypt(body, password);
const html = pageTemplate({ payload, reportCss: REPORT_CSS, hint: `期間 ${data.meta.from}〜${data.meta.to} の売上レポート。パスワードを入力してください。` });

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
writeFileSync('dist/.nojekyll', '');
console.log(`OK: dist/index.html を生成（${data.kpi.days}営業日 / 総売上 ¥${data.kpi.totalYen.toLocaleString('ja-JP')} / ${(html.length / 1024).toFixed(0)}KB・暗号化済み）`);
