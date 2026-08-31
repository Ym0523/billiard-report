// スコープ集計 -> レポートHTML。年度／月度モードを切替え、選んだスコープの本体を丸ごと表示する。
import { stackedBars, hBars, vBars, donut, legend, yen, esc, PALETTE } from './charts.mjs';

const jdate = (ms) => { if (!ms) return '—'; const d = new Date(ms + 9 * 3600000); const p = (n) => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
const pct = (f) => (f * 100).toFixed(1) + '%';

function section(title, sub, body) {
  return `<section class="card"><div class="sh"><h2>${esc(title)}</h2>${sub ? `<span class="ssub">${esc(sub)}</span>` : ''}</div>${body}</section>`;
}

function kpiCards(k) {
  const cards = [
    ['総売上', yen(k.totalYen), `${k.days}営業日`],
    ['平均日商', yen(k.avgDaily), '1営業日あたり'],
    ['総客数', k.guestCount.toLocaleString('ja-JP') + '名', `客単価 ${yen(k.perGuest)}`],
    ['ビリヤード', yen(k.timeYen), `構成比 ${pct(k.timeYen / (k.totalYen || 1))}`],
    ['物販', yen(k.itemYen), `構成比 ${pct(k.itemYen / (k.totalYen || 1))}`],
    ['取消(void)', `${k.voidCount}件`, `${yen(k.voidYen)}・${pct(k.voidRate)}`],
  ];
  return `<div class="kpis">${cards.map(([t, v, s]) => `<div class="kpi"><div class="kt">${t}</div><div class="kv">${v}</div><div class="ks">${esc(s)}</div></div>`).join('')}</div>`;
}

const PCAT = { drink: 'ドリンク', tobacco: 'たばこ', snack: 'お菓子', ramen: 'ラーメン', goods: '備品', other: 'その他' };

// 仕入（入荷金額）と粗利のKPI。Web入荷で金額が記録されている期間だけ表示。
function profitCards(scope) {
  const gp = scope.grossProfit, rate = scope.kpi.totalYen ? gp / scope.kpi.totalYen : 0;
  const cards = [
    ['仕入（入荷）', yen(scope.purchaseYen), '期間内の入荷金額'],
    ['粗利', yen(gp), `売上−仕入・粗利率 ${pct(rate)}`],
  ];
  return `<div class="kpis">${cards.map(([t, v, s]) => `<div class="kpi"><div class="kt">${t}</div><div class="kv">${v}</div><div class="ks">${esc(s)}</div></div>`).join('')}</div>`;
}

// 仕入（入荷）明細：Web入荷で記録した金額の一覧。
function purchasesSection(scope) {
  const rows = scope.purchases.map((p) => `<tr><td>${jdate(p.at).slice(0, 10)}</td><td>${esc(PCAT[p.cat] || p.cat)}</td><td>${p.qty == null ? '' : p.qty + '点'}</td><td class="em">${yen(p.total)}</td></tr>`).join('');
  const tbl = `<div class="tblscroll"><table class="tbl"><thead><tr><th>日付</th><th>カテゴリ</th><th>数量</th><th>金額</th></tr></thead><tbody>${rows}<tr class="totalrow"><td>合計</td><td></td><td></td><td class="em">${yen(scope.purchaseYen)}</td></tr></tbody></table></div>`;
  return section('仕入（入荷）明細', 'Web入荷で記録した金額', tbl);
}

// 売上の推移（gran='day'→日次／'month'→月次）
function trendSection(scope, gran) {
  const gameOn = scope.kpi.gameYen > 0;
  const series = [{ key: 'time', name: 'ビリヤード' }, { key: 'item', name: '物販' }, ...(gameOn ? [{ key: 'game', name: 'ゲーム' }] : [])];
  const lg = legend([{ label: 'ビリヤード' }, { label: '物販' }, ...(gameOn ? [{ label: 'ゲーム' }] : []), { label: '客数(折れ線)', color: 'var(--line-accent)' }]);
  if (gran === 'month') {
    const rows = scope.monthly.map((d) => ({ ...d, x: d.label }));
    return section('月次売上の推移', '締めベース・棒=売上内訳／折れ線=客数', lg + stackedBars(rows, series, { lineKey: 'guests' }));
  }
  const rows = scope.daily.map((d) => ({ ...d, x: (d.date || '').slice(5) }));
  return section('日次売上の推移', '締めベース・棒=売上内訳／折れ線=客数', lg + stackedBars(rows, series, { lineKey: 'guests' }));
}

// 月次サマリー表（年度スコープのみ）
function summarySection(scope) {
  const rows = [...scope.monthSummary.map((r) => ({ label: r.label, ...r.kpi })), { label: '合計', ...scope.kpi }];
  const tbl = `<div class="tblscroll"><table class="tbl mtbl"><thead><tr><th>月</th><th>営業日</th><th>総売上</th><th>ビリヤード</th><th>物販</th><th>客数</th><th>客単価</th><th>平均日商</th><th>取消</th></tr></thead><tbody>${rows.map((r, i) => `<tr class="${i === rows.length - 1 ? 'totalrow' : ''}"><td>${esc(r.label)}</td><td>${r.days}</td><td class="em">${yen(r.totalYen)}</td><td>${yen(r.timeYen)}</td><td>${yen(r.itemYen)}</td><td>${r.guestCount}</td><td>${yen(r.perGuest)}</td><td>${yen(r.avgDaily)}</td><td>${r.voidCount}件</td></tr>`).join('')}</tbody></table></div>`;
  return section('月次サマリー', '締めベース・月ごとの集計', tbl);
}

// 客層構成（期間合計・ドーナツ2種）
function compositionSection(scope) {
  const v = scope.visitTotal, total = v.reg + v.walk;
  if (!total) return section('客層構成', '時間会計ベース', '<p class="note">来店（時間会計）の記録がありません。</p>');
  const dOpts = { centerText: total + '人', centerSub: '来店', vfmt: (n) => n + '人' };
  const rows1 = [{ label: '常連', value: v.reg }, { label: '一般', value: v.walk }].filter((r) => r.value > 0);
  const rows2 = [{ label: '学生', value: v.student }, { label: '女性', value: v.female }, { label: '一般', value: v.general }].filter((r) => r.value > 0);
  const cell = (title, rows) => `<div class="donutcell"><div class="dctitle">${title}</div><div class="donutwrap">${donut(rows, dOpts)}${legend(rows.map((r) => ({ label: r.label })))}</div></div>`;
  return section('客層構成', '期間内の来店人数の内訳（時間会計ベース）', `<div class="donutrow">${cell('常連／一般', rows1)}${cell('学生／女性／一般', rows2)}</div>`);
}

// 来店人数の推移（gran='day'→日別／'month'→月別）
function visitorTrend(scope, gran, series, legendRows, subtitleTail) {
  const rows = gran === 'month' ? scope.visitMonthly.map((d) => ({ ...d, x: d.label })) : scope.visitDaily.map((d) => ({ ...d, x: (d.date || '').slice(5) }));
  const chart = stackedBars(rows, series, { yfmt: (n) => String(Math.round(n)), vfmt: (n) => Math.round(n) + '人' });
  return section((gran === 'month' ? '月別' : '日別') + `の来店人数（${subtitleTail}）`, '時間会計ベース・棒=人数', legend(legendRows) + chart);
}
function visitorTypeSection(scope, gran) {
  return visitorTrend(scope, gran, [{ key: 'reg', name: '常連' }, { key: 'walk', name: '一般' }], [{ label: '常連' }, { label: '一般' }], '常連／一般');
}
function visitorAttrSection(scope, gran) {
  return visitorTrend(scope, gran, [{ key: 'student', name: '学生' }, { key: 'female', name: '女性' }, { key: 'general', name: '一般' }], [{ label: '学生' }, { label: '女性' }, { label: '一般' }], '学生／女性／一般');
}

function mixSection(scope) {
  const mixLegend = scope.mix.map((x, i) => ({ label: x.label, color: PALETTE[i % PALETTE.length] }));
  return section('売上構成', 'ビリヤード / 物販' + (scope.kpi.gameYen > 0 ? ' / ゲーム' : ''), `<div class="donutwrap">${donut(scope.mix.map((x) => ({ label: x.label, value: x.yen })))}${legend(mixLegend)}</div>`);
}

function catBreakdownSection(scope) {
  const rows = scope.categories.map((c) => ({ label: c.label, value: c.yen, sub: pct(c.yen / (scope.itemGross || 1)) }));
  return section('物販の内訳', '明細ベース（取消除く）', rows.length ? hBars(rows, { labW: 96 }) : '<p class="note">物販の売上はありません。</p>');
}

function catDetailSection(scope) {
  if (!scope.categoryDetail.length) return section('物販 カテゴリ別 商品内訳', '明細ベース（取消除く）', '<p class="note">物販の売上はありません。</p>');
  const blocks = scope.categoryDetail.map((c) => `
    <div class="catblock">
      <div class="cathead"><span class="catname">${esc(c.label)}</span><span class="catmeta">${c.qty}個・${yen(c.yen)}・${pct(c.share)}</span></div>
      <table class="tbl catitems"><tbody>${c.items.map((it) => `<tr><td>${esc(it.name)}</td><td class="q">${it.qty}個</td><td class="y">${yen(it.yen)}</td></tr>`).join('')}</tbody></table>
    </div>`).join('');
  return section('物販 カテゴリ別 商品内訳', '期間内にカテゴリ別で売れた商品と数量（販売数の多い順・明細ベース）', `<div class="catgrid">${blocks}</div>`);
}

function weekdaySection(scope) {
  const gameOn = scope.kpi.gameYen > 0;
  const series = [{ key: 'time', name: 'ビリヤード' }, ...scope.categories.map((c) => ({ key: c.key, name: c.label })), ...(gameOn ? [{ key: 'game', name: 'ゲーム' }] : [])];
  const rows = scope.weekdaySales.map((d) => ({ ...d, x: d.wd }));
  return section('曜日別の平均日商（内訳）', 'ビリヤード＋物販カテゴリ別・棒=1営業日あたり平均', legend(series.map((s) => ({ label: s.name }))) + stackedBars(rows, series, { yfmt: (v) => (v / 1000).toFixed(0) + 'k', vfmt: (v) => yen(v) }));
}
// 曜日別の平均来店人数（積み上げ・その曜日の営業日平均）
function weekdayVisitorSection(scope, series, legendRows, tail) {
  const rows = scope.weekdayVisit.map((d) => ({ ...d, x: d.wd }));
  return section(`曜日別の平均来店人数（${tail}）`, '時間会計ベース・棒=1営業日あたり平均人数', legend(legendRows) + stackedBars(rows, series, { yfmt: (n) => String(Math.round(n)), vfmt: (n) => (Math.round(n * 10) / 10) + '人' }));
}
function weekdayVisitorTypeSection(scope) {
  return weekdayVisitorSection(scope, [{ key: 'reg', name: '常連' }, { key: 'walk', name: '一般' }], [{ label: '常連' }, { label: '一般' }], '常連／一般');
}
function weekdayVisitorAttrSection(scope) {
  return weekdayVisitorSection(scope, [{ key: 'student', name: '学生' }, { key: 'female', name: '女性' }, { key: 'general', name: '一般' }], [{ label: '学生' }, { label: '女性' }, { label: '一般' }], '学生／女性／一般');
}
// 時間帯別の入場者数（平均・積み上げ）。入場時刻ベース。
function hourlyVisitorSection(scope, series, legendRows, tail) {
  const rows = scope.hourly.map((h) => ({ ...h, x: h.h + '時' }));
  return section(`時間帯別の入場者数（平均・${tail}）`, '入場時刻ベース・1営業日あたり平均人数', legend(legendRows) + stackedBars(rows, series, { yfmt: (n) => String(Math.round(n * 10) / 10), vfmt: (n) => (Math.round(n * 10) / 10) + '人' }));
}
function hourlyTypeSection(scope) {
  return hourlyVisitorSection(scope, [{ key: 'reg', name: '常連' }, { key: 'walk', name: '一般' }], [{ label: '常連' }, { label: '一般' }], '常連／一般');
}
function hourlyAttrSection(scope) {
  return hourlyVisitorSection(scope, [{ key: 'student', name: '学生' }, { key: 'female', name: '女性' }, { key: 'general', name: '一般' }], [{ label: '学生' }, { label: '女性' }, { label: '一般' }], '学生／女性／一般');
}
function regularsSection(scope) {
  const rows = scope.regularsRank.map((r) => ({ label: r.name, value: r.yen, sub: `${r.visits}回` }));
  return section('常連ランキング Top12', '時間会計の売上・明細ベース', (rows.length ? hBars(rows, { labW: 120 }) : '<p class="note">常連の会計はありません。</p>') + `<p class="note">常連 ${scope.regularVisits}回 / 一般 ${scope.walkVisits}回（時間会計・取消除く）</p>`);
}
function specialSection(scope) {
  const tbl = `<table class="tbl"><thead><tr><th>区分</th><th>会計数</th><th>売上(時間)</th><th>客単価</th></tr></thead><tbody>${scope.special.map((s) => `<tr><td>${esc(s.label)}</td><td>${s.visits}</td><td>${yen(s.yen)}</td><td class="em">${yen(s.per)}</td></tr>`).join('')}</tbody></table>`;
  return section('特別日の効果', '時間会計の客単価', tbl);
}
function medalSection(scope) {
  const typeRow = `<div class="medalrow">${Object.entries(scope.medalByType).map(([t, n]) => `<div class="mchip"><span class="mt">${esc(t)}</span><span class="mn">${n}</span></div>`).join('')}<div class="mchip total"><span class="mt">合計</span><span class="mn">${scope.medalTotal}</span></div></div>`;
  const groupBars = scope.medalGroups.length ? hBars(scope.medalGroups.map((g) => ({ label: g.label, value: g.n })), { fmt: (v) => v + '枚', labW: 90 }) : '';
  return section('メダル利用', '種類別（締めベース）＋区分別（明細ベース）', typeRow + groupBars);
}
function cashSection(scope) {
  const cash = scope.cashDiffDays.length
    ? `<table class="tbl"><thead><tr><th>営業日</th><th>差異</th></tr></thead><tbody>${scope.cashDiffDays.map((d) => `<tr><td>${d.date}</td><td class="${d.cashDiff < 0 ? 'neg' : 'pos'}">${d.cashDiff > 0 ? '+' : ''}${yen(d.cashDiff)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="ok">この期間の現金差異はありません（全日ピッタリ）。</p>';
  return section('現金の実査差異', 'レジ点検（締めベース）', cash);
}

// 1スコープ（年度 or 月度）の本体。gran='month'→年度（月次推移＋月次サマリー）／'day'→月度（日次）。
function scopeBody(scope, gran, label) {
  const period = scope.from && scope.to ? `${scope.from}〜${scope.to}` : '';
  return `
    <div class="scopehead"><span class="slabel">${esc(label)}</span><span class="speriod">期間 ${period}</span></div>
    ${kpiCards(scope.kpi)}
    ${scope.purchaseYen ? profitCards(scope) : ''}
    ${trendSection(scope, gran)}
    ${gran === 'month' ? summarySection(scope) : ''}
    ${compositionSection(scope)}
    ${visitorTypeSection(scope, gran)}
    ${visitorAttrSection(scope, gran)}
    <div class="grid2">${mixSection(scope)}${catBreakdownSection(scope)}</div>
    ${weekdaySection(scope)}
    <div class="grid2">${weekdayVisitorTypeSection(scope)}${weekdayVisitorAttrSection(scope)}</div>
    ${hourlyTypeSection(scope)}
    ${hourlyAttrSection(scope)}
    <div class="grid2">${regularsSection(scope)}${specialSection(scope)}</div>
    ${medalSection(scope)}
    ${cashSection(scope)}
    ${scope.purchases && scope.purchases.length ? purchasesSection(scope) : ''}
    ${catDetailSection(scope)}`;
}

export function renderReport(a) {
  const m = a.meta;
  const weeks = a.weeks || [];
  const defYear = a.years[a.years.length - 1].key;
  const defMonth = a.months[a.months.length - 1].key;
  const defWeek = weeks.length ? weeks[weeks.length - 1].key : null;
  const defMode = 'month';

  const modeTabs = `<div class="modetabs">
    <button type="button" class="modebtn${defMode === 'year' ? ' active' : ''}" data-mode="year">年レポート</button>
    <button type="button" class="modebtn${defMode === 'month' ? ' active' : ''}" data-mode="month">月次レポート</button>
    <button type="button" class="modebtn${defMode === 'week' ? ' active' : ''}" data-mode="week">週次レポート</button>
  </div>`;
  const yearSel = `<div class="selrow" data-mode="year"${defMode === 'year' ? '' : ' hidden'}>${a.years.map((y) => `<button type="button" class="scopebtn${y.key === defYear ? ' active' : ''}" data-scope="${y.key}">${esc(y.label)}</button>`).join('')}</div>`;
  const monthSel = `<div class="selrow" data-mode="month"${defMode === 'month' ? '' : ' hidden'}>${a.months.map((mo) => `<button type="button" class="scopebtn${mo.key === defMonth ? ' active' : ''}" data-scope="${mo.key}">${esc(mo.label)}</button>`).join('')}</div>`;
  // 週次：新しい週が右に来るよう昇順のまま。最新週を既定アクティブに。
  const weekSel = `<div class="selrow" data-mode="week"${defMode === 'week' ? '' : ' hidden'}>${weeks.map((w) => `<button type="button" class="scopebtn${w.key === defWeek ? ' active' : ''}" data-scope="${w.key}">${esc(w.label)}</button>`).join('')}</div>`;

  const panes = [
    ...a.years.map((y) => `<div class="scopepane" data-scope="${y.key}"${y.key === defMonth ? '' : ' hidden'}>${scopeBody(y.scope, 'month', y.label)}</div>`),
    ...a.months.map((mo) => `<div class="scopepane" data-scope="${mo.key}"${mo.key === defMonth ? '' : ' hidden'}>${scopeBody(mo.scope, 'day', mo.label)}</div>`),
    ...weeks.map((w) => `<div class="scopepane" data-scope="${w.key}" hidden>${scopeBody(w.scope, 'day', '週次 ' + w.label)}</div>`),
  ].join('');

  return `
  <div class="report">
    <header class="rhead">
      <div>
        <h1>ビリヤードPOS 売上分析レポート</h1>
        <div class="period">全体期間 ${m.from} 〜 ${m.to}　（店舗: ${esc(m.store)}）</div>
      </div>
      <div class="gen">生成: ${jdate(m.generatedAt)}<br>データ基準: ${jdate(m.exportedAt)}</div>
    </header>

    <div class="controls">${modeTabs}${yearSel}${monthSel}${weekSel}</div>

    ${panes}

    <footer class="rfoot">締め・明細から自動生成。取消(void)は売上から除外。金額は税込・円。上のボタンで年／月次／週次（月〜日）と期間を切替えられます。</footer>
  </div>`;
}

// レポート本文に適用するCSS（外側ページに埋め込む）。テーマ変数で light/dark 対応。
export const REPORT_CSS = `
:root{--bg:#f4f6f8;--surface:#fff;--ink:#1b2733;--ink2:#516072;--ink3:#8493a3;--line:#e6ebf0;--grid:#eef2f6;
--accent:#1f5fa8;--line-accent:#e8480b;--c1:#1f5fa8;--c2:#33a06f;--c3:#e8a23d;--c4:#c0504d;--c5:#7d5ba6;--c6:#4aa3c7;--c7:#d17ba6;--c8:#7f8a97;--ok:#2e7d55;--neg:#c0392b;--pos:#2e7d55;}
@media (prefers-color-scheme:dark){:root{--bg:#0f151b;--surface:#161f28;--ink:#e8eef4;--ink2:#a9b7c4;--ink3:#6f8091;--line:#25313d;--grid:#202b35;--accent:#5aa0e8;--line-accent:#ff7a4d;--c1:#5aa0e8;--c2:#4fc38a;--c3:#f0b862;--c4:#e0736f;--c5:#a684d0;--c6:#6cc0e0;--c7:#e79dc0;--c8:#9aa6b3;}}
.report{max-width:1040px;margin:0 auto;padding:20px 16px 60px;color:var(--ink);font-family:'Segoe UI','Hiragino Kaku Gothic ProN','Meiryo',system-ui,sans-serif;}
.rhead{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:14px;}
.rhead h1{font-size:22px;margin:0 0 4px;font-weight:800;}
.period{color:var(--ink2);font-size:14px;font-weight:600;}
.gen{color:var(--ink3);font-size:12px;text-align:right;line-height:1.5;}
.controls{margin-bottom:14px;padding:12px;background:var(--surface);border:1px solid var(--line);border-radius:12px;}
.modetabs,.selrow{display:flex;gap:8px;flex-wrap:wrap;}
.selrow{margin-top:10px;}
.selrow[hidden]{display:none;}
.modebtn,.scopebtn{font-size:13px;font-weight:700;padding:8px 16px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--ink2);cursor:pointer;}
.modebtn.active{background:var(--ink);color:var(--surface);border-color:transparent;}
.scopebtn.active{background:var(--accent);color:#fff;border-color:transparent;}
.scopepane[hidden]{display:none;}
.scopehead{display:flex;align-items:baseline;gap:12px;margin:2px 0 12px;flex-wrap:wrap;}
.scopehead .slabel{font-size:19px;font-weight:800;}
.scopehead .speriod{font-size:12px;color:var(--ink3);}
.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:16px;}
@media(max-width:820px){.kpis{grid-template-columns:repeat(3,1fr);}}
@media(max-width:520px){.kpis{grid-template-columns:repeat(2,1fr);}}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px;}
.kt{font-size:12px;color:var(--ink2);font-weight:700;}
.kv{font-size:22px;font-weight:800;margin:4px 0 2px;letter-spacing:-.5px;}
.ks{font-size:11px;color:var(--ink3);}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:14px;}
.sh{display:flex;align-items:baseline;gap:10px;margin-bottom:10px;}
.sh h2{font-size:15px;margin:0;font-weight:800;}
.ssub{font-size:11px;color:var(--ink3);}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
@media(max-width:820px){.grid2{grid-template-columns:1fr;}}
.chart{width:100%;height:auto;overflow:visible;}
.chart .ax{font-size:10px;fill:var(--ink3);}
.chart .lab{font-size:12px;fill:var(--ink);font-weight:600;}
.chart .val{font-size:12px;fill:var(--ink);font-weight:700;}
.chart .sub{fill:var(--ink3);font-weight:600;}
.donut{width:200px;height:200px;}
.donut .dcenter{font-size:17px;font-weight:800;fill:var(--ink);}
.donut .dsub{font-size:11px;fill:var(--ink3);}
.donutwrap{display:flex;align-items:center;gap:16px;flex-wrap:wrap;justify-content:center;}
.donutrow{display:flex;gap:16px;flex-wrap:wrap;}
.donutcell{flex:1;min-width:240px;}
.dctitle{font-size:13px;font-weight:800;color:var(--ink2);text-align:center;margin-bottom:6px;}
.legend{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;}
.lg{font-size:12px;color:var(--ink2);display:flex;align-items:center;gap:5px;}
.lg i{width:11px;height:11px;border-radius:3px;display:inline-block;}
.tbl{width:100%;border-collapse:collapse;font-size:13px;}
.tbl th{text-align:left;color:var(--ink2);font-weight:700;border-bottom:2px solid var(--line);padding:6px 8px;font-size:12px;}
.tbl td{padding:6px 8px;border-bottom:1px solid var(--line);}
.tbl td.em{font-weight:800;color:var(--accent);}
.tbl td.neg{color:var(--neg);font-weight:700;}.tbl td.pos{color:var(--pos);font-weight:700;}
.tblscroll{overflow-x:auto;}
.mtbl th,.mtbl td{text-align:right;white-space:nowrap;}
.mtbl th:first-child,.mtbl td:first-child{text-align:left;}
.mtbl .totalrow td{font-weight:800;border-top:2px solid var(--line);}
.catgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
@media(max-width:820px){.catgrid{grid-template-columns:1fr;}}
.catblock{border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--bg);}
.cathead{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:4px;border-bottom:2px solid var(--line);padding-bottom:6px;}
.catname{font-size:14px;font-weight:800;}
.catmeta{font-size:11px;color:var(--ink3);font-weight:700;}
.catitems td{padding:4px 6px;font-size:12px;}
.catitems td.q{text-align:right;white-space:nowrap;font-weight:700;color:var(--ink);}
.catitems td.y{text-align:right;white-space:nowrap;color:var(--ink3);width:78px;}
.note{font-size:12px;color:var(--ink3);margin:8px 2px 0;}
.ok{font-size:13px;color:var(--ok);font-weight:600;}
.medalrow{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;}
.mchip{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:6px 12px;display:flex;flex-direction:column;align-items:center;min-width:56px;}
.mchip.total{background:var(--accent);}.mchip.total .mt,.mchip.total .mn{color:#fff;}
.mt{font-size:12px;color:var(--ink2);font-weight:700;}.mn{font-size:18px;font-weight:800;}
.rfoot{margin-top:18px;color:var(--ink3);font-size:11px;text-align:center;}
`;
