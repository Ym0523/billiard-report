// 操作マニュアル用のスクリーンショット撮影ヘルパー（依存なし：Chrome DevTools Protocol を Node の WebSocket で直接操作）。
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 1280, height = 800, scale = 1.5, port = 9333 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'manual-chrome-'));
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    `--window-size=${width},${height}`, '--hide-scrollbars', '--no-first-run', '--lang=ja-JP', 'about:blank',
  ], { stdio: 'ignore' });
  let ws = null;
  for (let i = 0; i < 50 && !ws; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch { /* 起動待ち */ }
    if (!ws) await sleep(200);
  }
  if (!ws) throw new Error('Chrome に接続できませんでした');
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { r, j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(m.error.message)) : r(m.result); }
  };
  const send = (method, params = {}) => new Promise((r, j) => { const id = ++seq; pending.set(id, { r, j }); ws.send(JSON.stringify({ id, method, params })); });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });

  const api = {
    send,
    /** ページ内で式を評価（await 可）し、値を返す。 */
    async eval(expr) {
      const res = await send('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
      return res.result.value;
    },
    async goto(url, waitMs = 1500) {
      await send('Page.navigate', { url });
      await sleep(waitMs);
    },
    /** スクリーンショット（JPEG）。clip は CSS px。 */
    async shot(file, clip) {
      const p = { format: 'jpeg', quality: 85, captureBeyondViewport: false };
      if (clip) p.clip = { ...clip, scale: 1 };
      const { data } = await send('Page.captureScreenshot', p);
      writeFileSync(file, Buffer.from(data, 'base64'));
    },
    // Browser.close は応答が返らないことがあるので待ちすぎない（返らないとプロセスが終わらない）
    async close() {
      try { await Promise.race([send('Browser.close'), sleep(1500)]); } catch { /* 無視 */ }
      try { ws.close(); } catch { /* 無視 */ }
      proc.kill();
    },
    sleep,
  };
  return api;
}
