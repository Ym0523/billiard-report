// dist をローカルで配信（公開前の確認・マニュアル撮影用）。PORT 環境変数に従う（既定 8765）。
const h = require('http'), f = require('fs'), p = require('path');
const ROOT = p.join(__dirname, '..', 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.css': 'text/css', '.js': 'text/javascript' };
h.createServer((q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  if (u.endsWith('/')) u += 'index.html';
  const fp = p.join(ROOT, u);
  if (!fp.startsWith(ROOT)) { r.writeHead(403); r.end(); return; }
  f.readFile(fp, (e, d) => {
    if (e) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': TYPES[p.extname(fp)] || 'application/octet-stream' });
    r.end(d);
  });
}).listen(Number(process.env.PORT) || 8765);
