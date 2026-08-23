// 要発注リスト（カテゴリ別）を出先のスマホで見る用のページ。
// store.items の 在庫(stock)・発注点(reorderPoint)・入荷ロット(orderLot)・発注済(onOrder) から算出。
// 要発注＝在庫<発注点。推奨数＝(在庫+発注済)を発注点まで戻すロット単位の数。

const CAT = [
  ['drink', 'ドリンク'], ['tobacco', 'たばこ'], ['snack', 'お菓子'], ['ramen', 'ラーメン'], ['goods', '備品'], ['other', 'その他'],
];
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (v) => (v == null ? null : Number(v));

function suggest(i) {
  const stock = num(i.stock) ?? 0;
  const on = num(i.onOrder) ?? 0;
  const rp = num(i.reorderPoint) ?? 0;
  const short = Math.max(0, rp - (stock + on));
  if (short === 0) return 0;
  const lot = num(i.orderLot) ?? 0;
  return lot > 0 ? Math.max(1, Math.ceil(short / lot)) * lot : Math.max(1, short);
}

const jdate = (ms) => {
  if (!ms) return '—';
  const d = new Date(ms + 9 * 3600000); const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

export function renderReorder(store, meta = {}) {
  const items = (store.items || []).filter((i) => i && i.stock != null && i.reorderPoint != null);
  const need = items.filter((i) => num(i.stock) < num(i.reorderPoint));           // 要発注
  const waiting = (store.items || []).filter((i) => (num(i.onOrder) ?? 0) > 0);     // 入荷待ち
  const totalNeed = need.length;
  const totalWait = waiting.reduce((s, i) => s + (num(i.onOrder) ?? 0), 0);

  const catBlock = (list, kind) => CAT.map(([k, label]) => {
    const rows = list.filter((i) => i.cat === k).sort((a, b) => (num(b.reorderPoint) - num(b.stock)) - (num(a.reorderPoint) - num(a.stock)));
    if (!rows.length) return '';
    const body = rows.map((i) => {
      const stock = num(i.stock) ?? 0, rp = num(i.reorderPoint), lot = num(i.orderLot), on = num(i.onOrder) ?? 0;
      if (kind === 'need') {
        const q = suggest(i);
        return `<tr>
          <td class="nm">${esc(i.code ? i.code + ' ' : '')}${esc(i.name)}</td>
          <td class="n ${stock <= 0 ? 'zero' : 'low'}">${stock}</td>
          <td class="n dim">${rp}</td>
          <td class="n dim">${lot ?? '-'}</td>
          <td class="n sug">${q > 0 ? '＋' + q : (on ? '発注済' : '-')}</td>
        </tr>`;
      }
      return `<tr>
        <td class="nm">${esc(i.code ? i.code + ' ' : '')}${esc(i.name)}</td>
        <td class="n">${stock}</td>
        <td class="n wait">${on}</td>
      </tr>`;
    }).join('');
    const head = kind === 'need'
      ? '<tr><th class="l">商品</th><th>残</th><th>発注点</th><th>ロット</th><th>推奨</th></tr>'
      : '<tr><th class="l">商品</th><th>残</th><th>入荷待ち</th></tr>';
    return `<section class="cat"><h2>${label}<span class="cnt">${rows.length}品</span></h2>
      <div class="tw"><table>${head}${body}</table></div></section>`;
  }).join('');

  return `
  <div class="wrap">
    <header class="hd">
      <div class="eyebrow">在庫 ／ 発注</div>
      <h1>要発注リスト</h1>
      <div class="stat">
        <div class="s"><b>${totalNeed}</b><span>要発注</span></div>
        <div class="s"><b>${totalWait}</b><span>入荷待ち(個)</span></div>
      </div>
      <div class="gen">在庫データ基準: ${jdate(meta.exportedAt)}<br>生成: ${jdate(meta.generatedAt)}（毎日10時ごろ更新）</div>
    </header>

    ${totalNeed === 0 ? '<p class="ok">いま要発注の商品はありません。</p>' : `<div class="note">在庫が発注点を割った商品です。推奨＝(在庫＋発注済)を発注点まで戻すロット単位の数。</div>${catBlock(need, 'need')}`}

    ${totalWait > 0 ? `<h3 class="sh">発注済・入荷待ち</h3>${catBlock(waiting, 'wait')}` : ''}

    <footer class="ft">在庫の締め（クラウドバックアップ）を基準に生成。数量は目安です。実際の発注・入荷登録はアプリの「発注・入荷」から。</footer>
  </div>`;
}

export const REORDER_CSS = `
:root{--bg:#f4f6f4;--surface:#fff;--surface2:#f0f2ef;--ink:#182019;--ink2:#53605a;--ink3:#8a948e;--line:#e3e8e3;--accent:#1c6b4b;--accent-sf:#e7f1eb;--alert:#bf3a2b;--low:#b0781a;--wait:#7d5ba6;}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0e1512;--surface:#151e19;--surface2:#1b2620;--ink:#e7f0ea;--ink2:#a6b4ab;--ink3:#6d7b73;--line:#26332c;--accent:#59c08c;--accent-sf:#15251d;--alert:#e0736f;--low:#e0b062;--wait:#b79be0;}}
:root[data-theme="dark"]{--bg:#0e1512;--surface:#151e19;--surface2:#1b2620;--ink:#e7f0ea;--ink2:#a6b4ab;--ink3:#6d7b73;--line:#26332c;--accent:#59c08c;--accent-sf:#15251d;--alert:#e0736f;--low:#e0b062;--wait:#b79be0;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:'Hiragino Kaku Gothic ProN','Meiryo',system-ui,sans-serif;line-height:1.6;}
.wrap{max-width:560px;margin:0 auto;padding:18px 14px 60px;}
.hd{border-bottom:2px solid var(--ink);padding-bottom:14px;margin-bottom:14px;}
.eyebrow{font-size:11px;font-weight:700;letter-spacing:.15em;color:var(--accent);}
.hd h1{font-size:26px;margin:4px 0 10px;font-weight:800;}
.stat{display:flex;gap:10px;}
.s{flex:1;background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:10px;padding:8px 12px;}
.s b{font-size:24px;font-weight:800;font-variant-numeric:tabular-nums;}
.s span{display:block;font-size:11px;color:var(--ink3);}
.gen{font-size:11px;color:var(--ink3);margin-top:10px;line-height:1.5;}
.note{font-size:12px;color:var(--ink2);background:var(--surface2);border-radius:8px;padding:8px 12px;margin-bottom:12px;}
.ok{font-size:15px;color:var(--accent);font-weight:700;background:var(--accent-sf);border-radius:10px;padding:16px;text-align:center;}
.cat{margin-bottom:14px;}
.cat h2{font-size:15px;font-weight:800;margin:0 0 6px;display:flex;align-items:baseline;gap:8px;}
.cnt{font-size:11px;color:var(--ink3);font-weight:600;}
.sh{font-size:15px;font-weight:800;margin:22px 0 8px;color:var(--wait);}
.tw{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--surface);}
table{width:100%;border-collapse:collapse;font-size:13px;}
th{background:var(--surface2);color:var(--ink2);font-weight:700;font-size:11px;text-align:right;padding:7px 10px;white-space:nowrap;border-bottom:1px solid var(--line);}
th.l{text-align:left;}
td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;}
tr:last-child td{border-bottom:0;}
td.nm{text-align:left;white-space:normal;color:var(--ink);font-weight:600;min-width:150px;}
td.n{font-weight:700;}
td.dim{color:var(--ink3);font-weight:400;}
td.zero{color:var(--alert);}
td.low{color:var(--low);}
td.sug{color:var(--accent);font-weight:800;}
td.wait{color:var(--wait);font-weight:800;}
.ft{margin-top:20px;font-size:11px;color:var(--ink3);line-height:1.6;border-top:1px solid var(--line);padding-top:14px;}
`;
