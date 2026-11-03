// 操作マニュアルのスクリーンショットを撮る（POS の Web 版を Chrome で自動操作）。
// 使い方：billiard-pos で `npm run web -- --port 8091` を起動しておき、
//   node tools/manual/capture.mjs            （POS の画面）
//   node tools/manual/capture.mjs reorder    （Web 要発注リスト：dist を http://localhost:8765 で配信しておく）
// 出力：web/manual/img/*.jpg と web/manual/shots.json（各画像の番号マーカーの位置）。
// ※常連は ?demo=1 で架空の名前に差し替えて撮る（実在のお客さまの名前を公開しない）。
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { launch } from './cdp.mjs';

const POS = process.env.POS_URL || 'http://localhost:8091';
const OUT = 'web/manual/img';
const JSON_PATH = 'web/manual/shots.json';
mkdirSync(OUT, { recursive: true });
const shots = existsSync(JSON_PATH) ? JSON.parse(readFileSync(JSON_PATH, 'utf8')) : {};

// ページ内ヘルパー（読み込みのたびに注入）。時刻ずらし（入店を過去にする）もここで。
const HELPERS = `
(() => {
  const realNow = Date.now.bind(Date);
  window.__shift = 0;
  Date.now = () => realNow() + window.__shift;
  const norm = (s) => (s || '').replace(/\\s+/g, '');
  const btns = () => [...document.querySelectorAll('div[tabindex],[role=button],button')];
  const leaves = () => [...document.querySelectorAll('div,span')].filter((d) => d.childElementCount === 0);
  // 表示されている（大きさがある）要素。画面外でも対象にする（押す前に scrollIntoView する）
  const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const pick = (list, idx) => (idx < 0 ? list[list.length + idx] : list[idx]);
  window.__h = {
    // ボタン：文字が一致（exact）／前方一致。idx=-1 で最後（＝一番手前のシート側）
    btn(text, { exact = true, idx = -1 } = {}) {
      const t = norm(text).replace(/^✓/, '');
      const list = btns().filter((e) => visible(e) && (exact ? norm(e.textContent).replace(/^✓/, '') === t : norm(e.textContent).replace(/^✓/, '').startsWith(t)));
      return pick(list, idx) || null;
    },
    text(text, { exact = true, idx = -1 } = {}) {
      const t = norm(text);
      const list = leaves().filter((e) => visible(e) && (exact ? norm(e.textContent) === t : norm(e.textContent).includes(t)));
      return pick(list, idx) || null;
    },
    input(ph, idx = -1) { return pick([...document.querySelectorAll('input,textarea')].filter((e) => visible(e) && (e.placeholder || '').includes(ph)), idx) || null; },
    click(el) { if (!el) throw new Error('要素が見つかりません'); el.scrollIntoView({ block: 'nearest' }); el.click(); },
    type(el, value) { // TextInput に文字を入れる（React の onChange が反応するようネイティブの setter で）
      if (!el) throw new Error('入力欄が見つかりません');
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    press(el) { // onPressIn（即入力）のテンキー用：押す→離す
      if (!el) throw new Error('要素が見つかりません');
      const r = el.getBoundingClientRect(); const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
      el.dispatchEvent(new MouseEvent('mousedown', { ...o, buttons: 1 })); el.dispatchEvent(new MouseEvent('mouseup', o)); el.dispatchEvent(new MouseEvent('click', o));
    },
    rect(...els) {
      const rs = els.filter(Boolean).map((e) => e.getBoundingClientRect());
      if (!rs.length) return null;
      const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top));
      const x2 = Math.max(...rs.map((r) => r.right)), y2 = Math.max(...rs.map((r) => r.bottom));
      return { x: Math.round(x), y: Math.round(y), w: Math.round(x2 - x), h: Math.round(y2 - y) };
    },
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    // スクロールを全部いちばん上へ（撮影前：見出しやボタンが隠れないように）
    top() { for (const e of document.querySelectorAll('*')) if (e.scrollTop > 0) e.scrollTop = 0; window.scrollTo(0, 0); },
  };
})();`;

const mode = process.argv[2] || 'pos';
// 要発注リスト（Web）はスマホで見るので、スマホの画面サイズで撮る
const VIEW = mode === 'reorder' ? { width: 400, height: 860, scale: 2 } : { width: 1280, height: 800, scale: 1.5 };
const page = await launch(VIEW);
await page.send('Page.addScriptToEvaluateOnNewDocument', { source: HELPERS });
const S = (ms) => page.sleep(ms);
const ev = (code) => page.eval(`const h = window.__h; ${code}`);

/** 撮影：markers は [{label, rect}]（rect はページ内で h.rect(...) で取る）。clip で部分切り抜き。 */
async function shot(name, markersCode, clipCode) {
  await ev('h.top();');
  await S(400);
  const markers = markersCode ? await ev(`return (${markersCode});`) : [];
  const clip = clipCode ? await ev(`return (${clipCode});`) : null;
  const pad = 8;
  const c = clip ? { x: Math.max(0, clip.x - pad), y: Math.max(0, clip.y - pad), width: clip.w + pad * 2, height: clip.h + pad * 2 } : null;
  await page.shot(`${OUT}/${name}.jpg`, c);
  const W = c ? c.width : VIEW.width, H = c ? c.height : VIEW.height, ox = c ? c.x : 0, oy = c ? c.y : 0;
  shots[name] = {
    w: W, h: H,
    // 画像の外（スクロールしないと見えない所）の番号は付けない
    markers: markers.filter((m) => m && m.rect && m.rect.y - oy < H - 10 && m.rect.y + m.rect.h - oy > 10).map((m, i) => ({
      n: i + 1, label: m.label,
      // 画像に対する割合（％）で保存＝表示サイズが変わっても位置がずれない
      x: +(((m.rect.x - ox) / W) * 100).toFixed(2), y: +(((m.rect.y - oy) / H) * 100).toFixed(2),
      w: +((m.rect.w / W) * 100).toFixed(2), h: +((m.rect.h / H) * 100).toFixed(2),
    })),
  };
  console.log('shot', name, (shots[name].markers || []).length + ' markers');
}

try {
  if (mode === 'pos') await capturePos();
  else if (mode === 'inventory') await captureInventory();
  else if (mode === 'reorder') await captureReorder();
} catch (e) {
  await page.shot(`${OUT}/_debug.jpg`).catch(() => {}); // 失敗した時点の画面（原因調査用）
  console.error('FAILED:', e.message);
  process.exitCode = 1;
} finally {
  writeFileSync(JSON_PATH, JSON.stringify(shots, null, 1));
  await page.close();
}

async function capturePos() {
  await page.goto(`${POS}/?demo=1`, 9000);
  // ---- サンプルの在店客をつくる（時刻をずらして入店させる＝経過時間・料金が出る） ----
  await ev(`window.__shift = -125 * 60000;
    h.click(h.btn('＋ 常連')); await h.wait(500); h.click(h.btn('佐藤', { exact: false })); await h.wait(500);
    h.click(h.btn('＋ 常連')); await h.wait(500); h.click(h.btn('鈴木', { exact: false })); await h.wait(500);`);
  await ev(`window.__shift = -95 * 60000;
    h.click(h.btn('＋ お客さま')); await h.wait(500); h.click(h.btn('1空き')); await h.wait(500);
    h.click(h.btn('＋')); await h.wait(150); h.click(h.btn('＋')); await h.wait(150);
    h.click(h.btn('学生', { idx: 1 })); await h.wait(150);
    h.click(h.btn('1番に3名を登録')); await h.wait(600);`);
  await ev(`window.__shift = -40 * 60000;
    h.click(h.btn('＋ お客さま')); await h.wait(500); h.click(h.btn('3空き')); await h.wait(500);
    h.click(h.btn('＋')); await h.wait(150);
    h.click(h.btn('3番に2名を登録')); await h.wait(600);
    window.__shift = 0;`);
  // 佐藤様の伝票に商品をつける（綾鷹・ポテトチップス）
  await ev(`h.click(h.btn('佐藤様', { exact: false })); await h.wait(900);
    h.click(h.btn('＋ 商品をつける')); await h.wait(900);
    h.click(h.btn('すべて')); await h.wait(400);
    h.click(h.btn('綾鷹', { exact: false })); await h.wait(200);
    h.click(h.btn('お菓子')); await h.wait(300); h.click(h.btn('すべて')); await h.wait(300);
    h.click(h.btn('ポテトチップス（うすしお）', { exact: false })); await h.wait(200);
    h.click(h.btn('伝票につける')); await h.wait(700);
    h.click(h.btn('閉じる')); await h.wait(600);`);

  // ---- 1. メイン画面 ----
  await shot('main', `[
    { label: '物販（ビリヤードをしないお客さまの会計）', rect: h.rect(h.btn('物販', { idx: 0 })) },
    { label: '両替（ドロワを開ける）', rect: h.rect(h.btn('両替')) },
    { label: '在庫', rect: h.rect(h.btn('在庫', { idx: 0 })) },
    { label: '会計履歴', rect: h.rect(h.btn('会計履歴')) },
    { label: '日報・締め', rect: h.rect(h.btn('日報・締め')) },
    { label: '管理者', rect: h.rect(h.btn('管理者')) },
    { label: '＋ 常連（常連さんの入店）', rect: h.rect(h.btn('＋ 常連')) },
    { label: '＋ お客さま（一般のお客さまの入店）', rect: h.rect(h.btn('＋ お客さま')) },
    { label: 'お客さまのカード（タップで精算）', rect: h.rect(h.btn('佐藤様', { exact: false })) },
    { label: 'まとめて精算', rect: h.rect(h.btn('まとめて精算')) },
  ]`);

  // ---- 2. 一般の入店 ----
  await ev(`h.click(h.btn('＋ お客さま')); await h.wait(700);`);
  await shot('walkin-table', `[{ label: '空いている卓をタップ', rect: h.rect(h.btn('2空き')) }]`);
  await ev(`h.click(h.btn('2空き')); await h.wait(600); h.click(h.btn('＋')); await h.wait(200);`);
  await shot('walkin-count', `[
    { label: '人数を − ／ ＋ で合わせる', rect: h.rect(h.btn('−', { idx: 0 }), h.btn('＋', { idx: 0 })) },
    { label: '学生・女性の方はタップ（あとで精算時にも変えられます）', rect: h.rect(h.btn('学生', { idx: 0 }), h.btn('女性', { idx: 1 })) },
    { label: '登録する', rect: h.rect(h.btn('2番に2名を登録')) },
  ]`);
  await ev(`h.click(h.btn('閉じる')); await h.wait(600);`);

  // ---- 3. 常連の入店 ----
  await ev(`h.click(h.btn('＋ 常連')); await h.wait(700);`);
  await shot('regular', `[
    { label: '名前・よみがなで検索', rect: h.rect(h.input('名前・よみがなで検索')) },
    { label: '名前をタップするだけで入店', rect: h.rect(h.btn('高橋', { exact: false })) },
    { label: '入場中の方は灰色（もう押せません）', rect: h.rect(h.btn('佐藤', { exact: false })) },
    { label: '常連さんの登録・編集', rect: h.rect(h.btn('＋ 常連の登録・編集')) },
  ]`);
  await ev(`h.click(h.btn('閉じる')); await h.wait(600);`);

  // ---- 4. 精算（1人） ----
  await ev(`h.click(h.btn('佐藤様', { exact: false })); await h.wait(1200);
    for (const k of ['5','0','0','0']) { h.press(h.btn(k)); await h.wait(120); }`);
  await shot('settle', `[
    { label: '区分（学生・女性・子供）', rect: h.rect(h.btn('学生'), h.btn('子供')) },
    { label: '休憩・時間の調整・卓移動・商品をつける', rect: h.rect(h.btn('⏸ 休憩する（中断）'), h.btn('＋ 商品をつける')) },
    { label: '伝票の商品（− ／ ＋ で数量を直す）', rect: h.rect(h.text('綾鷹', { exact: false })) },
    { label: '時間のメダル（1枚＝60分引き）', rect: h.rect(h.text('メダル（時間', { exact: false })) },
    { label: '商品のメダル（1枚300円）', rect: h.rect(h.text('商品のメダル', { exact: false })) },
    { label: 'お預かりをテンキーで入力', rect: h.rect(h.btn('1'), h.btn('←')) },
    { label: 'この内容で精算する', rect: h.rect(h.btn('この内容で精算する')) },
    { label: '入店を取り消す（会計しない）', rect: h.rect(h.btn('入店を取り消す（会計しない）')) },
  ]`);
  await ev(`h.click(h.btn('この内容で精算する')); await h.wait(700);`);
  await shot('settle-confirm', `[
    { label: '内容とおつりを確認', rect: h.rect(h.text('おつり', { idx: -1 })) },
    { label: '精算する（確定）', rect: h.rect(h.btn('精算する')) },
    { label: '戻る（直す）', rect: h.rect(h.btn('戻る')) },
  ]`);
  await ev(`h.click(h.btn('精算する')); await h.wait(900);`);
  await shot('settle-done', `[{ label: 'おつりを渡したら「閉じる」', rect: h.rect(h.btn('閉じる')) }]`);
  await ev(`h.click(h.btn('閉じる')); await h.wait(800);`);

  // ---- 5. まとめて精算（選んだ人だけ） ----
  await ev(`h.click(h.btn('まとめて精算')); await h.wait(500);
    h.click(h.btn('お客様1', { exact: false })); await h.wait(250); h.click(h.btn('お客様3', { exact: false })); await h.wait(400);`);
  await shot('pick', `[
    { label: '精算する人のカードをタップ（✓が付く）', rect: h.rect(h.btn('お客様1', { exact: false })) },
    { label: '選んだ人数と合計', rect: h.rect(h.text('名を選択中', { exact: false })) },
    { label: '精算へ', rect: h.rect(h.btn('精算へ', { exact: false })) },
    { label: 'やめる時はキャンセル', rect: h.rect(h.btn('キャンセル')) },
  ]`);
  await ev(`h.click(h.btn('精算へ', { exact: false })); await h.wait(1200);`);
  await shot('multi-settle', `[
    { label: '選んだ人だけが並ぶ', rect: h.rect(h.text('まとめて精算・2名')) },
    { label: 'お預かりは全員分まとめて', rect: h.rect(h.text('お預かり', { exact: false, idx: 0 })) },
  ]`);
  await ev(`h.click(h.btn('閉じる')); await h.wait(700);`);

  // ---- 6. メダル（拡大） ----
  await ev(`h.click(h.btn('鈴木様', { exact: false })); await h.wait(1200);
    h.click(h.btn('＋10', { idx: 0 })); await h.wait(200); h.click(h.btn('＋', { idx: 0 })); await h.wait(200);`);
  await shot('medal', `[
    { label: '− で1枚減らす', rect: h.rect(h.btn('−', { idx: 0 })) },
    { label: '＋ で1枚増やす', rect: h.rect(h.btn('＋', { idx: 0 })) },
    { label: '＋10 で10枚増やす（大量のとき）', rect: h.rect(h.btn('＋10', { idx: 0 })) },
  ]`, `h.rect(h.text('メダル（時間', { exact: false }), h.btn('＋10', { idx: 1 }), h.btn('＋10', { idx: 2 }))`);

  // 撮影で入れたメダルを0に戻す（後の写真のカードに「メダル11枚」が残らないように）
  await ev(`for (let i = 0; i < 11; i++) { h.click(h.btn('−', { idx: 0 })); await h.wait(60); }`);

  // ---- 7. 終了時刻の調整 ----
  await ev(`h.click(h.btn('終了時刻を調整')); await h.wait(800); h.click(h.btn('終了−10分')); await h.wait(200); h.click(h.btn('終了の打ち忘れ')); await h.wait(200);`);
  await shot('adjust-end', `[
    { label: '時刻を前後に動かす', rect: h.rect(h.btn('終了−1時間'), h.btn('終了＋1時間')) },
    { label: '理由を選ぶ（必須）', rect: h.rect(h.btn('終了の打ち忘れ'), h.btn('店側のミス')) },
    { label: 'この終了で確定', rect: h.rect(h.btn('この終了で確定')) },
  ]`);
  await ev(`h.click(h.btn('やめる')); await h.wait(500); h.click(h.btn('閉じる')); await h.wait(600);`);

  // ---- 8. 物販（その場で会計） ----
  await ev(`h.click(h.btn('物販', { idx: 0 })); await h.wait(1000);
    h.click(h.btn('¥170', { exact: false })); await h.wait(400);
    h.click(h.btn('綾鷹', { exact: false })); await h.wait(150); h.click(h.btn('濃い茶', { exact: false })); await h.wait(150); h.click(h.btn('濃い茶', { exact: false })); await h.wait(300);`);
  await shot('items', `[
    { label: '商品の登録・編集', rect: h.rect(h.btn('＋ 商品の登録・編集')) },
    { label: 'カテゴリ', rect: h.rect(h.btn('ドリンク'), h.btn('たばこ')) },
    { label: '値段で絞る', rect: h.rect(h.btn('¥130', { exact: false }), h.btn('すべて')) },
    { label: '商品をタップ（写真付き）', rect: h.rect(h.btn('綾鷹', { exact: false })) },
    { label: '購入リスト（− ／ ＋ で数量）', rect: h.rect(h.text('購入リスト'), h.text('濃い茶', { idx: -1 })) },
    { label: '清算する', rect: h.rect(h.btn('清算する')) },
  ]`);
  await ev(`h.click(h.btn('清算する')); await h.wait(900);
    h.click(h.btn('＋', { idx: -1 })); await h.wait(200);
    for (const k of ['1','0','0','0']) { h.press(h.btn(k)); await h.wait(120); }`);
  await shot('items-pay', `[
    { label: 'メダル（1枚300円・区分ごと）', rect: h.rect(h.text('メダル（1枚300円', { exact: false })) },
    { label: 'お預かりをテンキーで入力', rect: h.rect(h.btn('1'), h.btn('←')) },
    { label: '会計する', rect: h.rect(h.btn('会計する')) },
    { label: '戻る', rect: h.rect(h.btn('戻る')) },
  ]`);
  await ev(`h.click(h.btn('会計する')); await h.wait(900); h.click(h.btn('閉じる')); await h.wait(700);`);

  // ---- 9. たばこ（棚番号で探す） ----
  await ev(`h.click(h.btn('物販', { idx: 0 })); await h.wait(1000); h.click(h.btn('たばこ')); await h.wait(500);
    h.click(h.btn('1', { idx: -1 })); await h.wait(150); h.click(h.btn('2', { idx: -1 })); await h.wait(400);`);
  await shot('tobacco', `[
    { label: 'ばら売り ／ カートン売り（10個）', rect: h.rect(h.btn('ばら売り'), h.btn('カートン売り（10個）')) },
    { label: '棚番号をテンキーで入力', rect: h.rect(h.btn('1', { idx: -1 }), h.btn('←', { idx: -1 })) },
    { label: '見つかった銘柄をタップ', rect: h.rect(h.btn('12', { exact: false, idx: -1 })) },
  ]`);
  // 備品（金額を入力）
  await ev(`h.click(h.btn('備品')); await h.wait(500); h.click(h.btn('タップ', { exact: false, idx: 0 })); await h.wait(400);
    const card = [...document.querySelectorAll('div[tabindex]')].find((e) => e.textContent.includes('金額を入力')); h.click(card); await h.wait(700);
    for (const k of ['3','0','0','0']) { h.press(h.btn(k)); await h.wait(120); }`);
  await shot('goods-price', `[
    { label: '今回の金額を入力', rect: h.rect(h.btn('1'), h.btn('←')) },
    { label: 'かごに入れる', rect: h.rect(h.btn('かごに入れる')) },
  ]`);
  await ev(`h.click(h.btn('やめる')); await h.wait(500); h.click(h.btn('閉じる')); await h.wait(700);`);

  // ---- 10. 会計履歴（取消・修正） ----
  await ev(`h.click(h.btn('会計履歴')); await h.wait(1000);`);
  await shot('history', `[
    { label: '前の日 ／ 次の日（締めた日を見返す）', rect: h.rect(h.btn('◀ 前の日', { exact: false }), h.btn('次の日 ▶', { exact: false })) },
    { label: '種類で絞り込み', rect: h.rect(h.btn('すべて', { idx: -1 }), h.btn('ゲーム')) },
    { label: '修正（取消して作り直す）', rect: h.rect(h.btn('修正', { idx: 0 })) },
    { label: '取消', rect: h.rect(h.btn('取消', { idx: 0 })) },
  ]`);
  await ev(`h.click(h.btn('取消', { idx: 1 })); await h.wait(800); h.click(h.btn('打ち間違い')); await h.wait(200);`);
  await shot('void', `[
    { label: 'お客さまがまだ店内なら「席に戻す」', rect: h.rect(h.btn('席に戻す', { exact: false }), h.btn('記録の取消だけ', { exact: false })) },
    { label: '理由（必須）', rect: h.rect(h.btn('打ち間違い'), h.btn('お客さまの申し出')) },
    { label: '取消する', rect: h.rect(h.btn('取消する')) },
  ]`);
  await ev(`h.click(h.btn('やめる')); await h.wait(600); h.click(h.btn('修正', { idx: 0 })); await h.wait(700);`);
  await shot('redo', `[
    { label: '取消して作り直す（内容はカートに戻る）', rect: h.rect(h.btn('取消して作り直す')) },
    { label: 'やめる', rect: h.rect(h.btn('やめる')) },
  ]`);
  await ev(`h.click(h.btn('やめる')); await h.wait(500); h.click(h.btn('閉じる')); await h.wait(700);`);

  // ---- 11. 日報・締め ----
  await ev(`h.click(h.btn('日報・締め')); await h.wait(1000);
    for (const k of ['1','7','2','0']) { h.click(h.btn(k)); await h.wait(120); }
    h.click(h.btn('レジ現金を数えました（タップ）')); await h.wait(300);`);
  await shot('dayreport', `[
    { label: '数えた現金をテンキーで入力', rect: h.rect(h.btn('1'), h.btn('←')) },
    { label: '数えたらタップ', rect: h.rect(h.btn('✓ レジ現金を数えました', { exact: false })) },
    { label: '締める（CSVを保存）', rect: h.rect(h.btn('締める（CSVを保存）')) },
    { label: '本日の売上', rect: h.rect(h.text('ビリヤード', { exact: true, idx: -1 })) },
  ]`);
  await ev(`h.click(h.btn('閉じる')); await h.wait(700);`);

  // ---- 12. 在庫（レジ端末） ----
  await ev(`h.click(h.btn('在庫', { idx: 0 })); await h.wait(1000);`);
  await shot('stock-register', `[
    { label: 'カテゴリ・検索', rect: h.rect(h.btn('ドリンク', { idx: -1 }), h.btn('たばこ', { idx: -1 })) },
    { label: '要発注だけ表示・並べ替え・履歴', rect: h.rect(h.btn('要発注だけ', { exact: false }), h.btn('履歴', { exact: false })) },
  ]`);
  await ev(`h.click(h.btn('閉じる')); await h.wait(700);`);

  // ---- 13. 商品の登録・編集 ----
  await ev(`h.click(h.btn('物販', { idx: 0 })); await h.wait(1000); h.click(h.btn('＋ 商品の登録・編集')); await h.wait(900);`);
  await shot('master-drink', `[
    { label: '新しい商品を追加（商品名・値段 → 追加）', rect: h.rect(h.input('商品名', 0), h.btn('追加')) },
    { label: '写真（タップで選ぶ／長押しで外す）', rect: h.rect(h.btn('', { exact: false, idx: -1 }) && [...document.querySelectorAll('div[tabindex]')].find((e) => e.querySelector('img'))) },
    { label: '写真をまとめて取り込む', rect: h.rect(h.btn('写真をまとめて取り込む')) },
    { label: '名前・値段はタップして書き換え', rect: h.rect([...document.querySelectorAll('input')].filter((e) => e.value === '濃い茶')[0]) },
  ]`);
  await ev(`h.click(h.btn('たばこ', { idx: -1 })); await h.wait(700);`);
  await shot('master-tobacco', `[
    { label: '別銘柄に変更（空きスロットにするのもここ）', rect: h.rect(h.btn('別銘柄に変更', { idx: 0 })) },
    { label: '値段だけはここで直せる', rect: h.rect([...document.querySelectorAll('input')].filter((e) => /^\\d+$/.test(e.value))[0]) },
  ]`);
  await ev(`h.click(h.btn('別銘柄に変更', { idx: 0 })); await h.wait(700);`);
  await shot('brand', `[
    { label: '新しい銘柄名', rect: h.rect(h.input('新しい銘柄名')) },
    { label: '値段', rect: h.rect(h.input('値段', -1)) },
    { label: '保存（30日の販売数をリセット）', rect: h.rect(h.btn('保存（リセット）')) },
    { label: '取扱いをやめる時は空きスロットに', rect: h.rect(h.btn('この枠を空きスロットにする（取扱い終了）')) },
  ]`);
  await ev(`h.click(h.btn('キャンセル')); await h.wait(500); h.click(h.btn('閉じる')); await h.wait(500); h.click(h.btn('閉じる')); await h.wait(600);`);
}

async function captureInventory() {
  await page.goto(`${POS}/?demo=1&role=inventory`, 9000);
  // 発注点の設定（濃い茶：発注点10・ロット24）
  await ev(`h.click(h.text('発注点 未設定（タップで設定）', { idx: 0 })); await h.wait(700);
    h.type(h.input('例 10'), '10'); h.type(h.input('例 24'), '24'); await h.wait(300);`);
  await shot('order-setting', `[
    { label: '発注点（この数より少なくなったら要発注）', rect: h.rect(h.input('例 10')) },
    { label: '発注ロット（この数の単位で発注）', rect: h.rect(h.input('例 24')) },
    { label: '保存', rect: h.rect(h.btn('保存')) },
  ]`);
  await ev(`h.click(h.btn('保存')); await h.wait(600);`);
  // 棚卸し（濃い茶＝6個）
  await ev(`h.click(h.btn('棚卸し', { idx: 0 })); await h.wait(700); h.press(h.btn('クリア')); await h.wait(100); h.press(h.btn('6')); await h.wait(300);`);
  await shot('stocktake', `[
    { label: '数えた数をテンキーで入力', rect: h.rect(h.btn('1'), h.btn('←')) },
    { label: 'この数にする', rect: h.rect(h.btn('この数にする')) },
  ]`);
  await ev(`h.click(h.btn('この数にする')); await h.wait(600);
    h.click(h.btn('棚卸し', { idx: 1 })); await h.wait(600); h.press(h.btn('クリア')); h.press(h.btn('1')); h.press(h.btn('8')); await h.wait(200); h.click(h.btn('この数にする')); await h.wait(600);
    h.click(h.btn('棚卸し', { idx: 2 })); await h.wait(600); h.press(h.btn('クリア')); await h.wait(200); h.click(h.btn('この数にする')); await h.wait(600);`);
  // ロス/調整（エメマン：破損1）
  await ev(`h.click(h.btn('ロス/調整', { idx: 1 })); await h.wait(700); h.click(h.btn('破損')); await h.wait(150); h.press(h.btn('1')); await h.wait(300);`);
  await shot('loss', `[
    { label: '理由を選ぶ', rect: h.rect(h.btn('廃棄'), h.btn('その他', { idx: -1 })) },
    { label: '減らす数を入力', rect: h.rect(h.btn('1'), h.btn('←')) },
    { label: 'この数を減らす', rect: h.rect(h.btn('この数を減らす')) },
  ]`);
  await ev(`h.click(h.btn('この数を減らす')); await h.wait(600);`);
  await shot('inv-main', `[
    { label: '棚卸し（数え直した数に設定）', rect: h.rect(h.btn('棚卸し', { idx: 0 })) },
    { label: 'ロス/調整（廃棄・破損など）', rect: h.rect(h.btn('ロス/調整', { idx: 0 })) },
    { label: '発注点・発注ロット（タップで編集）', rect: h.rect(h.text('発注点', { exact: false, idx: 0 })) },
    { label: '要発注だけ表示・並べ替え・履歴', rect: h.rect(h.btn('要発注だけ', { exact: false }), h.btn('履歴', { exact: false })) },
  ]`);
}
// 要発注リスト（Web）：dist を配信しておき、パスワードは REPORT_PASSWORD（ローカル確認用ビルドのもの）。
// ★見るだけ：発注・入荷・差し戻しのボタンは押さない（本番データにつながっているため）。
async function captureReorder() {
  const url = process.env.REORDER_URL || 'http://localhost:8765/reorder.html';
  await page.goto(url, 1500);
  await ev(`const pw = document.querySelector('input[type=password]'); h.type(pw, ${JSON.stringify(process.env.REPORT_PASSWORD || '')}); pw.form.requestSubmit(); await h.wait(7000);`);
  await shot('reorder-amazon', `[
    { label: '① 発注 ／ ② 入荷 のタブ', rect: h.rect(h.btn('① 発注（要発注）'), h.btn('② 入荷（発注ごと）')) },
    { label: 'Amazon＝カートに追加（カート追加済み）', rect: h.rect(h.btn('Amazon', { idx: 0 })) },
    { label: '別発注＝Amazon以外で仕入れ', rect: h.rect(h.btn('別発注', { idx: 0 })) },
    { label: '×＝今回は発注しない', rect: h.rect(h.btn('×', { idx: 0 })) },
  ]`);
  // ドリンク以外（カテゴリ別の発注）までスクロールして撮る
  await ev(`const n = document.querySelector('.note'); const g = [...document.querySelectorAll('.chips, .grp')][0]; (g || n).scrollIntoView({ block: 'start' }); window.scrollBy(0, -10); await h.wait(400);`);
  await page.shot(`${OUT}/reorder-list.jpg`);
  shots['reorder-list'] = { w: VIEW.width, h: VIEW.height, markers: await ev(`
    const W = innerWidth, H = innerHeight;
    const pct = (r, n, label) => r && r.y < H && r.y + r.h > 0 ? { n, label, x: +(r.x / W * 100).toFixed(2), y: +(r.y / H * 100).toFixed(2), w: +(r.w / W * 100).toFixed(2), h: +(r.h / H * 100).toFixed(2) } : null;
    const chips = document.querySelector('.chips'); const row = document.querySelector('.grp .row'); const stp = row && row.querySelector('.stp');
    return [pct(chips && h.rect(chips), 1, 'カテゴリ'), pct(stp && h.rect(stp), 2, '数量（0＝見送り／−／＋／数字をタップで直接入力）')].filter(Boolean);`) };
  console.log('shot reorder-list', shots['reorder-list'].markers.length + ' markers');
  // 入荷タブ
  await ev(`h.click(h.btn('② 入荷（発注ごと）')); await h.wait(800); window.scrollTo(0, 0);`);
  await shot('reorder-receive', `[
    { label: 'ドリンクは商品ごとに「入荷」', rect: h.rect(h.btn('入荷', { idx: 0 })) },
    { label: '数量（届いた分だけ）', rect: h.rect(document.querySelector('.ordcard .stp')) },
    { label: '誤発注は「発注取消」', rect: h.rect(h.btn('発注取消', { idx: 0 })) },
  ]`);
  await ev(`const hist = [...document.querySelectorAll('.glabel')].find((e) => e.textContent.includes('入荷履歴')); hist && hist.scrollIntoView({ block: 'start' }); await h.wait(400);`);
  await page.shot(`${OUT}/reorder-history.jpg`);
  shots['reorder-history'] = { w: VIEW.width, h: VIEW.height, markers: await ev(`
    const W = innerWidth, H = innerHeight;
    const pct = (r, n, label) => r && r.y < H && r.y + r.h > 0 ? { n, label, x: +(r.x / W * 100).toFixed(2), y: +(r.y / H * 100).toFixed(2), w: +(r.w / W * 100).toFixed(2), h: +(r.h / H * 100).toFixed(2) } : null;
    const amt = h.btn('金額入力', { idx: 0 }) || h.btn('金額修正', { idx: 0 });
    return [pct(h.rect(amt), 1, '金額をあとから入力・修正'), pct(h.rect(h.btn('差し戻し', { idx: 0 })), 2, '入荷の差し戻し')].filter(Boolean);`) };
  console.log('shot reorder-history', shots['reorder-history'].markers.length + ' markers');
}
