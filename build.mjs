// レポートをビルドして dist/index.html を出力する。
//   データ: 既定は Firestore から取得。BACKUP_FILE=path.json を指定すればローカルJSONを使う。
//   パスワード: 環境変数 REPORT_PASSWORD（必須）。
// 使い方: REPORT_PASSWORD=xxxx node build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { analyze } from './lib/analytics.mjs';
import { renderReport, REPORT_CSS } from './lib/render.mjs';
import { reorderAppPage } from './lib/reorderApp.mjs';
import { encrypt, pageTemplate } from './lib/crypto.mjs';

// 要発注リスト（ライブ版）が接続する Firebase の Web 設定。apiKey はアプリにも埋まる公開情報で、
// 防壁は Firestore ルール（認証必須）。パスワードで復号されるまでページには平文で出さない。
const FIREBASE_WEB = {
  apiKey: 'AIzaSyCZD5xa7m838clUatcqo_kCrP8g6w3FSnU',
  authDomain: 'pool-pos.firebaseapp.com',
  projectId: 'pool-pos',
  storageBucket: 'pool-pos.firebasestorage.app',
  messagingSenderId: '873721564308',
  appId: '1:873721564308:web:589f931b5dcfbf79d83881',
};

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

const { store, exportedAt, purchases } = await loadStore();
const now = Date.now();
const data = analyze(store, { store: process.env.STORE_ID || 'store-a', exportedAt, generatedAt: now, purchases: purchases || [] });

if (data.meta.empty) { console.error('ERROR: 締めデータ(closings)が0件です。まだ集計できません。'); process.exit(1); }

// 商品別・直近30日の実売個数（会計基準）を Firestore items.sold30 に保存 → アプリの「30日販売」表示に使う。
// stock_moves 依存をやめ、売上レポートと同じ会計値・端末間で同一の数にする。
// ★30日換算：販売できた日数が30日未満（開店直後・銘柄切替直後）は、その期間の実売を30日ぶんに換算する。
//   販売起点 ws = max(30日前, データ最古, その商品の銘柄切替時刻 brandChangedAt)。span=ws〜now の日数(1〜30)。
//   sold30 = round(期間内実売 / span * 30)。成熟店＆銘柄変更なしなら span=30 で従来どおり（換算なし）。
try {
  const DAY = 86400000;
  const cutMs = now - 30 * DAY;
  // データ最古（非取消の販売の最古 at）。無ければ cutMs。
  let storeStartMs = now;
  for (const s of (store.sales || [])) { if (!s.voided && s.at) storeStartMs = Math.min(storeStartMs, Number(s.at)); }
  if (storeStartMs === now) storeStartMs = cutMs;
  const bca = new Map((store.items || []).map((it) => [it.id, Number(it.brandChangedAt) || 0]));
  const raw = {}; // pid -> 期間内(ws以降)の実売個数
  for (const it of (store.items || [])) raw[it.id] = 0; // 全商品を0で初期化
  for (const s of (store.sales || [])) {
    if (s.voided || !s.at) continue;
    for (const l of (s.lines || [])) {
      const pid = String(l.id || '').split('#')[0];
      if (!pid) continue;
      const ws = Math.max(cutMs, storeStartMs, bca.get(pid) || 0);
      if (Number(s.at) < ws) continue; // その商品の販売起点より前は数えない
      raw[pid] = (raw[pid] || 0) + (l.qty || 1);
    }
  }
  const sold30 = {};
  let normalized = 0;
  for (const pid of Object.keys(raw)) {
    const ws = Math.max(cutMs, storeStartMs, bca.get(pid) || 0);
    const spanDays = Math.min(30, Math.max(1, Math.ceil((now - ws) / DAY)));
    sold30[pid] = Math.round((raw[pid] * 30) / spanDays);
    if (spanDays < 30 && raw[pid] > 0) normalized++;
  }
  const { writeSold30 } = await import('./lib/fetch.mjs');
  const n = await writeSold30(sold30);
  console.log(`OK: sold30（直近30日・会計基準／30日換算）を ${n} 品ぶん Firestore に保存（換算適用 ${normalized} 品）`);
} catch (e) {
  console.warn('WARN: sold30 の保存に失敗（レポート生成は継続）:', e && e.message || e);
}

const body = renderReport(data);
const payload = await encrypt(body, password);
const html = pageTemplate({ payload, reportCss: REPORT_CSS, hint: `期間 ${data.meta.from}〜${data.meta.to} の売上レポート。パスワードを入力してください。` });

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
writeFileSync('dist/.nojekyll', '');

// 要発注リスト（ライブ版・スマホ用）を reorder.html として出力。売上レポートと同じパスワードで
// 接続情報＋マスタ(seed)を復号 → その場で要発注/発注済み/発注/入荷ができる（在庫はアプリの stockMoves fold が正）。
// seed＝前夜バックアップの商品名/カテゴリ/発注点/ロット/在庫。Firestore にマスタが無くても名前が出て初回から動く。
const reorderCfg = { ...FIREBASE_WEB, storeId: process.env.STORE_ID || 'store-a' };
const seedItems = (store.items || [])
  .filter((i) => i && (i.reorderPoint != null || i.stock != null))
  .map((i) => ({
    id: i.id, cat: i.cat, name: i.name, code: i.code ?? null,
    reorderPoint: i.reorderPoint ?? null, orderLot: i.orderLot ?? null,
    stock: i.stock ?? null, onOrder: i.onOrder ?? null,
  }));
const reorderPayload = await encrypt(JSON.stringify({ cfg: reorderCfg, items: seedItems }), password);
const reorderHtml = reorderAppPage({ payload: reorderPayload, hint: 'パスワードを入力してください（売上レポートと同じ）。' });
writeFileSync('dist/reorder.html', reorderHtml);
console.log(`OK: dist/reorder.html を生成（ライブ版・Firestore直結／発注・入荷対応・seed ${seedItems.length}品）`);
const totDays = data.years.reduce((s, y) => s + y.scope.kpi.days, 0);
const totYen = data.years.reduce((s, y) => s + y.scope.kpi.totalYen, 0);
console.log(`OK: dist/index.html を生成（${data.years.length}年度 / ${data.months.length}月度 / ${data.weeks.length}週度 / ${totDays}営業日 / 総売上 ¥${totYen.toLocaleString('ja-JP')} / ${(html.length / 1024).toFixed(0)}KB・暗号化済み）`);

// Firebaseクライアントが接続・トークン更新のタイマーを開いたままにするため、
// 明示的に終了しないと CI でプロセスがハングする（処理は上で完了済み）。
process.exit(0);
