// 集計結果 -> レポート本体HTML（暗号化して index.html に埋め込む中身）。
import { stackedBars, hBars, vBars, donut, legend, yen, esc, PALETTE } from './charts.mjs';

const jdate = (ms) => { if (!ms) return '—'; const d = new Date(ms + 9 * 3600000); const p = (n) => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
const pct = (f) => (f * 100).toFixed(1) + '%';

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

function section(title, sub, body) {
  return `<section class="card"><div class="sh"><h2>${esc(title)}</h2>${sub ? `<span class="ssub">${esc(sub)}</span>` : ''}</div>${body}</section>`;
}

export function renderReport(a) {
  const m = a.meta, k = a.kpi;
  const mixLegend = a.mix.map((x, i) => ({ label: x.label, color: PALETTE[i % PALETTE.length] }));

  // 日次（月度で切替）
  const dailySeries = [{ key: 'time', name: 'ビリヤード' }, { key: 'item', name: '物販' }, ...(k.gameYen > 0 ? [{ key: 'game', name: 'ゲーム' }] : [])];
  const dailyLegend = legend([{ label: 'ビリヤード' }, { label: '物販' }, ...(k.gameYen > 0 ? [{ label: 'ゲーム' }] : []), { label: '客数(折れ線)', color: 'var(--line-accent)' }]);
  const dailyChartOf = (days) => stackedBars(days.map((d) => ({ ...d, label: d.date })), dailySeries, { lineKey: 'guests' });
  let dailyBody;
  if (a.months.length <= 1) {
    dailyBody = dailyLegend + dailyChartOf(a.daily);
  } else {
    const active = a.months[a.months.length - 1].key; // 既定は最新月度
    const tabs = `<div class="mtabs">${a.months.map((m) => `<button type="button" class="monthbtn${m.key === active ? ' active' : ''}" data-m="${m.key}">${esc(m.label)}</button>`).join('')}</div>`;
    const panes = a.months.map((m) => `<div class="monthpane" data-m="${m.key}"${m.key === active ? '' : ' hidden'}>${dailyChartOf(m.days)}</div>`).join('');
    dailyBody = dailyLegend + tabs + panes;
  }

  // カテゴリ（物販内訳）
  const catRows = a.categories.map((c) => ({ label: c.label, value: c.yen, sub: pct(c.yen / (a.itemGross || 1)) }));
  // 物販カテゴリの詳細：日次推移（積み上げ）＋主要商品
  const catSeries = a.catKeysPresent.map((k) => ({ key: k, name: a.catLabels[k] }));
  const catDailyChart = stackedBars(a.itemDailyByCat.map((d) => ({ ...d, label: d.date })), catSeries, {});
  const catLegend = legend(catSeries.map((s) => ({ label: s.name })));
  const catDetailTbl = `<table class="tbl"><thead><tr><th>カテゴリ</th><th>売上</th><th>構成比</th><th>主要商品（点数）</th></tr></thead><tbody>${a.categoryDetail.map((c) => `<tr><td>${esc(c.label)}</td><td class="em">${yen(c.yen)}</td><td>${pct(c.share)}</td><td class="prodcell">${c.top.map((p) => `${esc(p.name)}<span class="q">×${p.qty}</span>`).join('、') || '—'}</td></tr>`).join('')}</tbody></table>`;
  // 商品Top
  const prodRows = a.products.map((p) => ({ label: p.name, value: p.yen, sub: `${p.qty}点` }));
  // 常連Top
  const regRows = a.regularsRank.map((r) => ({ label: r.name, value: r.yen, sub: `${r.visits}回` }));
  // 曜日
  const wdBars = vBars(a.weekday.map((w) => ({ label: w.wd, value: w.avgTotal })), { color: 'var(--c1)', kfmt: (v) => (v / 1000).toFixed(0) + 'k', vfmt: (v) => yen(v) });
  // 時間帯
  const hourBars = vBars(a.hourly.map((h) => ({ label: h.h + '時', value: h.count })), { color: 'var(--c3)', vfmt: (v) => v + '件' });
  // 特別日
  const specialTbl = `<table class="tbl"><thead><tr><th>区分</th><th>会計数</th><th>売上(時間)</th><th>客単価</th></tr></thead><tbody>${a.special.map((s) => `<tr><td>${esc(s.label)}</td><td>${s.visits}</td><td>${yen(s.yen)}</td><td class="em">${yen(s.per)}</td></tr>`).join('')}</tbody></table>`;
  // メダル
  const medalTypeRow = `<div class="medalrow">${Object.entries(a.medalByType).map(([t, n]) => `<div class="mchip"><span class="mt">${esc(t)}</span><span class="mn">${n}</span></div>`).join('')}<div class="mchip total"><span class="mt">合計</span><span class="mn">${a.medalTotal}</span></div></div>`;
  const medalGroupBars = hBars(a.medalGroups.map((g) => ({ label: g.label, value: g.n })), { fmt: (v) => v + '枚', labW: 90 });

  // 現金差異
  const cash = a.cashDiffDays.length
    ? `<table class="tbl"><thead><tr><th>営業日</th><th>差異</th></tr></thead><tbody>${a.cashDiffDays.map((d) => `<tr><td>${d.date}</td><td class="${d.cashDiff < 0 ? 'neg' : 'pos'}">${d.cashDiff > 0 ? '+' : ''}${yen(d.cashDiff)}</td></tr>`).join('')}</tbody></table>`
    : `<p class="ok">期間中の現金差異はありません（全日ピッタリ）。</p>`;

  return `
  <div class="report">
    <header class="rhead">
      <div>
        <h1>ビリヤードPOS 売上分析レポート</h1>
        <div class="period">${m.from} 〜 ${m.to}　（店舗: ${esc(m.store)}）</div>
      </div>
      <div class="gen">生成: ${jdate(m.generatedAt)}<br>データ基準: ${jdate(m.exportedAt)}</div>
    </header>

    ${kpiCards(k)}

    ${section('日次売上の推移', '締めベース・棒=売上内訳／折れ線=客数' + (a.months.length > 1 ? '・月度で切替' : ''), dailyBody)}

    <div class="grid2">
      ${section('売上構成', 'ビリヤード / 物販' + (k.gameYen > 0 ? ' / ゲーム' : ''), `<div class="donutwrap">${donut(a.mix.map((x) => ({ label: x.label, value: x.yen })))}${legend(mixLegend)}</div>`)}
      ${section('物販の内訳', '明細ベース（取消除く）', hBars(catRows, { labW: 96 }))}
    </div>

    ${section('物販カテゴリの詳細', 'カテゴリ別の日次推移（積み上げ）＋主要商品・明細ベース', catLegend + catDailyChart + catDetailTbl)}

    <div class="grid2">
      ${section('曜日別の平均日商', '締めベース', wdBars)}
      ${section('時間帯別の会計件数', '明細の会計時刻ベース', hourBars)}
    </div>

    <div class="grid2">
      ${section('商品ランキング Top12', '売上・明細ベース', hBars(prodRows, { labW: 170 }))}
      ${section('常連ランキング Top12', '時間会計の売上・明細ベース', hBars(regRows, { labW: 120 }))}
    </div>

    <div class="grid2">
      ${section('特別日の効果', '時間会計の客単価', specialTbl + `<p class="note">常連 ${a.regularVisits}回 / 一般 ${a.walkVisits}回（時間会計・取消除く）</p>`)}
      ${section('メダル利用', '種類別（締めベース）＋区分別（明細ベース）', medalTypeRow + medalGroupBars)}
    </div>

    ${section('現金の実査差異', 'レジ点検（締めベース）', cash)}

    <footer class="rfoot">このレポートは会計の締め・明細から自動生成しています。取消(void)は売上から除外。金額は税込・円。</footer>
  </div>`;
}

// レポート本文に適用するCSS（外側ページに埋め込む）。テーマ変数で light/dark 対応。
export const REPORT_CSS = `
:root{--bg:#f4f6f8;--surface:#fff;--ink:#1b2733;--ink2:#516072;--ink3:#8493a3;--line:#e6ebf0;--grid:#eef2f6;
--accent:#1f5fa8;--line-accent:#e8480b;--c1:#1f5fa8;--c2:#33a06f;--c3:#e8a23d;--c4:#c0504d;--c5:#7d5ba6;--c6:#4aa3c7;--ok:#2e7d55;--neg:#c0392b;--pos:#2e7d55;}
@media (prefers-color-scheme:dark){:root{--bg:#0f151b;--surface:#161f28;--ink:#e8eef4;--ink2:#a9b7c4;--ink3:#6f8091;--line:#25313d;--grid:#202b35;--accent:#5aa0e8;--line-accent:#ff7a4d;--c1:#5aa0e8;--c2:#4fc38a;--c3:#f0b862;--c4:#e0736f;--c5:#a684d0;--c6:#6cc0e0;}}
.report{max-width:1040px;margin:0 auto;padding:20px 16px 60px;color:var(--ink);font-family:'Segoe UI','Hiragino Kaku Gothic ProN','Meiryo',system-ui,sans-serif;}
.rhead{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:16px;}
.rhead h1{font-size:22px;margin:0 0 4px;font-weight:800;}
.period{color:var(--ink2);font-size:14px;font-weight:600;}
.gen{color:var(--ink3);font-size:12px;text-align:right;line-height:1.5;}
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
.mtabs{display:flex;gap:8px;margin:2px 0 10px;flex-wrap:wrap;}
.monthbtn{font-size:13px;font-weight:700;padding:7px 14px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--ink2);cursor:pointer;}
.monthbtn.active{background:var(--accent);color:#fff;border-color:transparent;}
.monthpane[hidden]{display:none;}
.chart{width:100%;height:auto;overflow:visible;}
.chart .ax{font-size:10px;fill:var(--ink3);}
.chart .lab{font-size:12px;fill:var(--ink);font-weight:600;}
.chart .val{font-size:12px;fill:var(--ink);font-weight:700;}
.chart .sub{fill:var(--ink3);font-weight:600;}
.donut{width:200px;height:200px;}
.donut .dcenter{font-size:17px;font-weight:800;fill:var(--ink);}
.donut .dsub{font-size:11px;fill:var(--ink3);}
.donutwrap{display:flex;align-items:center;gap:16px;flex-wrap:wrap;justify-content:center;}
.legend{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;}
.lg{font-size:12px;color:var(--ink2);display:flex;align-items:center;gap:5px;}
.lg i{width:11px;height:11px;border-radius:3px;display:inline-block;}
.tbl{width:100%;border-collapse:collapse;font-size:13px;}
.tbl th{text-align:left;color:var(--ink2);font-weight:700;border-bottom:2px solid var(--line);padding:6px 8px;font-size:12px;}
.tbl td{padding:6px 8px;border-bottom:1px solid var(--line);}
.tbl td.em{font-weight:800;color:var(--accent);}
.tbl td.neg{color:var(--neg);font-weight:700;}.tbl td.pos{color:var(--pos);font-weight:700;}
.prodcell{font-size:12px;color:var(--ink2);}
.prodcell .q{color:var(--ink3);font-size:11px;margin-left:1px;}
.note{font-size:12px;color:var(--ink3);margin:8px 2px 0;}
.ok{font-size:13px;color:var(--ok);font-weight:600;}
.medalrow{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;}
.mchip{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:6px 12px;display:flex;flex-direction:column;align-items:center;min-width:56px;}
.mchip.total{background:var(--accent);}.mchip.total .mt,.mchip.total .mn{color:#fff;}
.mt{font-size:12px;color:var(--ink2);font-weight:700;}.mn{font-size:18px;font-weight:800;}
.rfoot{margin-top:18px;color:var(--ink3);font-size:11px;text-align:center;}
`;
