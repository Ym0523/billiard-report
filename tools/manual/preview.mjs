// マニュアルページの見た目確認：指定の章をパソコン幅・スマホ幅で撮る（確認用・公開しない）。
// 使い方：node tools/manual/preview.mjs settle multi  → web/manual/_preview-<章>-<幅>.jpg
import { launch } from './cdp.mjs';
const URL = process.env.MANUAL_URL || 'http://localhost:8765/manual.html';
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['main'];
for (const [tag, view] of [['pc', { width: 1280, height: 900, scale: 1 }], ['sp', { width: 390, height: 844, scale: 2 }]]) {
  const page = await launch({ ...view, port: 9334 });
  try {
    await page.goto(URL, 2000);
    for (const id of ids) {
      await page.eval(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'start' }); await new Promise((r) => setTimeout(r, 600));
        await Promise.all([...document.images].filter((i) => i.getBoundingClientRect().top < innerHeight * 2).map((i) => i.complete ? 0 : new Promise((r) => { i.loading = 'eager'; i.onload = i.onerror = r; setTimeout(r, 3000); })));`);
      await page.sleep(300);
      await page.shot(`web/manual/_preview-${id}-${tag}.jpg`);
      console.log('preview', id, tag);
    }
  } finally { await page.close(); }
}
