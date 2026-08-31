// 要発注リストの「ライブ版」ページ（Firestore直結ミニアプリ）を生成する。
//  ・パスワードで Firebase 接続情報(payload) を復号 → 匿名認証 → items をライブ購読。
//  ・発注(onOrder加算)／入荷(receiveイベント追記＋onOrder減算＋stockミラー更新)をその場で書き戻す。
//  ・クライアント本体は web/reorderClient.js を丸ごと埋め込む（テンプレート内の記号衝突を避けるため）。
// GitHub Pages 配信なので CSP 制約は無く、Firebase SDK を gstatic から動的 import できる。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { REORDER_CSS } from './reorder.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const APP_CSS = `
.live{margin-top:10px;font-size:12px;color:var(--accent);font-weight:700;display:flex;align-items:center;gap:6px;}
.live .dot{width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 0 var(--accent);animation:pulse 2s infinite;}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(28,107,75,.5)}70%{box-shadow:0 0 0 7px rgba(28,107,75,0)}100%{box-shadow:0 0 0 0 rgba(28,107,75,0)}}
.mtabs{display:flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;margin:14px 0 10px;}
.mtab{flex:1;padding:11px 6px;border:0;background:var(--surface);color:var(--ink2);font-size:13px;font-weight:700;cursor:pointer;}
.mtab.on{background:var(--accent);color:#fff;}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;}
.chip{padding:7px 12px;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--ink2);font-size:13px;font-weight:700;cursor:pointer;}
.chip.on{background:var(--accent);color:#fff;border-color:transparent;}
.grp{margin-bottom:12px;}
.glabel{font-size:10px;letter-spacing:.1em;color:var(--ink3);font-weight:700;margin:14px 0 4px;}
.row{display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--line);}
.rinfo{flex:1;min-width:0;}
.rname{font-size:14px;color:var(--ink);font-weight:600;}
.rmeta{font-size:11px;color:var(--ink3);margin-top:2px;}
.rmeta .zero{color:var(--alert);font-weight:700;}
.rmeta .low{color:var(--low);font-weight:700;}
.stp{display:flex;align-items:center;gap:6px;}
.sbtn{width:40px;height:40px;border-radius:20px;border:0;background:var(--surface2);color:var(--ink);font-size:22px;font-weight:700;cursor:pointer;line-height:1;}
.snum{min-width:58px;padding:8px 8px;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--ink2);font-size:16px;font-weight:800;cursor:pointer;font-variant-numeric:tabular-nums;}
.snum.on{background:var(--accent-sf);border-color:var(--accent);color:var(--accent);}
.empty{font-size:14px;color:var(--ink3);padding:16px;background:var(--surface2);border-radius:10px;text-align:center;}
.ordcard{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:12px;}
.ordhd{margin-bottom:4px;}
.ordttl{font-weight:800;font-size:14px;color:var(--ink);}
.ordsub{display:block;font-size:11px;color:var(--ink3);margin-top:2px;line-height:1.5;}
.ordbar{display:flex;align-items:center;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid var(--line);}
.ordbar .binfo{font-size:12px;font-weight:700;color:var(--ink);}
.ordbar .sp{flex:1;}
.bar{position:sticky;bottom:0;left:0;right:0;display:flex;align-items:center;gap:8px;max-width:560px;margin:0 auto;padding:10px 14px;background:var(--surface);border-top:1px solid var(--line);}
.bar .binfo{font-size:13px;font-weight:700;color:var(--ink);}
.bar .sp{flex:1;}
.b{padding:11px 16px;border:0;border-radius:10px;font-size:14px;font-weight:800;cursor:pointer;}
.b.pri{background:var(--accent);color:#fff;}
.b.ghost{background:var(--surface2);color:var(--ink);}
.b:disabled{opacity:.45;cursor:default;}
#toast{position:fixed;left:50%;bottom:78px;transform:translateX(-50%) translateY(20px);background:var(--ink);color:var(--bg);padding:11px 18px;border-radius:24px;font-size:13px;font-weight:700;opacity:0;pointer-events:none;transition:.25s;max-width:88vw;text-align:center;z-index:50;}
#toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
`;

export function reorderAppPage({ payload, hint = '' }) {
  const client = readFileSync(join(HERE, '..', 'web', 'reorderClient.js'), 'utf8');
  const cfg = JSON.stringify(payload);
  return `<!doctype html><html lang="ja"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>要発注リスト</title>
<style>
*{box-sizing:border-box}
:root{--bg:#f4f6f4;--surface:#fff;--surface2:#f0f2ef;--ink:#182019;--ink2:#53605a;--ink3:#8a948e;--line:#e3e8e3;--accent:#1c6b4b;--accent-sf:#e7f1eb;--alert:#bf3a2b;--low:#b0781a;--wait:#7d5ba6;}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0e1512;--surface:#151e19;--surface2:#1b2620;--ink:#e7f0ea;--ink2:#a6b4ab;--ink3:#6d7b73;--line:#26332c;--accent:#59c08c;--accent-sf:#15251d;--alert:#e0736f;--low:#e0b062;--wait:#b79be0;}}
html,body{margin:0;background:var(--bg);color:var(--ink);font-family:'Hiragino Kaku Gothic ProN','Meiryo',system-ui,sans-serif;line-height:1.6;}
.gate{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}
.box{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:28px;max-width:360px;width:100%;box-shadow:0 8px 30px rgba(0,0,0,.06);}
.box h1{font-size:18px;margin:0 0 4px;}
.box p{color:var(--ink3);font-size:13px;margin:0 0 18px;line-height:1.5;}
.box label{font-size:12px;font-weight:700;color:var(--ink2);}
.box input{width:100%;margin-top:6px;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);font-size:15px;}
.box button{width:100%;margin-top:14px;padding:11px;border:0;border-radius:10px;background:var(--accent);color:#fff;font-size:15px;font-weight:700;cursor:pointer;}
.box button:disabled{opacity:.6;cursor:default;}
.err{color:#c0392b;font-size:13px;margin-top:10px;min-height:18px;font-weight:600;}
${REORDER_CSS}
${APP_CSS}
</style></head>
<body>
<div id="gate" class="gate"><form class="box" id="f">
  <h1>🔒 要発注リスト</h1>
  <p>${hint || 'パスワードを入力してください。'}</p>
  <label for="pw">パスワード</label>
  <input id="pw" type="password" autocomplete="current-password" autofocus>
  <button id="btn" type="submit">開く</button>
  <div class="err" id="err"></div>
</form></div>
<div id="app" style="display:none"></div>
<div id="toast"></div>
<script id="cfg" type="application/json">${cfg}</script>
<script>${client}</script>
</body></html>`;
}
