// 依存なしの最小SVGチャート。文字列を返す。色はCSS変数（テーマ対応）を使う。
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const yen = (n) => '¥' + Math.round(n || 0).toLocaleString('ja-JP');
const nice = (max) => { if (max <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(max))); const f = max / p; const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10; return n * p; };

const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];

// 積み上げ縦棒（日次売上：ビリヤード/物販/ゲーム）＋任意で客数の折れ線
export function stackedBars(data, series, opts = {}) {
  const W = opts.w || 760, H = opts.h || 260, pad = { l: 52, r: 44, t: 12, b: 34 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const totals = data.map((d) => series.reduce((s, k) => s + (d[k.key] || 0), 0));
  const ymax = nice(Math.max(1, ...totals));
  const n = data.length, gap = 6, bw = Math.max(4, (iw / n) - gap);
  const x = (i) => pad.l + i * (iw / n) + (iw / n - bw) / 2;
  const y = (v) => pad.t + ih - (v / ymax) * ih;
  let bars = '';
  data.forEach((d, i) => {
    let acc = 0;
    series.forEach((s, si) => {
      const v = d[s.key] || 0; if (v <= 0) return;
      const y0 = y(acc), y1 = y(acc + v); acc += v;
      const vtxt = opts.vfmt ? opts.vfmt(v) : yen(v);
      bars += `<rect x="${x(i).toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${(y0 - y1).toFixed(1)}" fill="${PALETTE[si % PALETTE.length]}" rx="1.5"><title>${esc(d.label || d.date)} ${esc(s.name)} ${esc(vtxt)}</title></rect>`;
    });
  });
  // 客数の折れ線（右軸）
  let line = '';
  if (opts.lineKey) {
    const lv = data.map((d) => d[opts.lineKey] || 0); const lmax = nice(Math.max(1, ...lv));
    const ly = (v) => pad.t + ih - (v / lmax) * ih;
    const pts = data.map((d, i) => `${(x(i) + bw / 2).toFixed(1)},${ly(d[opts.lineKey] || 0).toFixed(1)}`).join(' ');
    line += `<polyline points="${pts}" fill="none" stroke="var(--line-accent)" stroke-width="2" />`;
    data.forEach((d, i) => (line += `<circle cx="${(x(i) + bw / 2).toFixed(1)}" cy="${ly(d[opts.lineKey] || 0).toFixed(1)}" r="2.6" fill="var(--line-accent)"><title>${esc(d.label || d.date)} ${d[opts.lineKey]}名</title></circle>`));
  }
  // グリッド＋Y軸
  let grid = '';
  for (let g = 0; g <= 4; g++) { const v = (ymax / 4) * g, yy = y(v); const yl = opts.yfmt ? opts.yfmt(v) : `${(v / 1000).toFixed(0)}k`; grid += `<line x1="${pad.l}" y1="${yy.toFixed(1)}" x2="${W - pad.r}" y2="${yy.toFixed(1)}" stroke="var(--grid)" stroke-width="1"/><text x="${pad.l - 6}" y="${(yy + 3).toFixed(1)}" text-anchor="end" class="ax">${esc(yl)}</text>`; }
  let xlab = '';
  data.forEach((d, i) => { if (n > 16 && i % 2) return; const t = d.x != null ? d.x : (d.date || '').slice(5); xlab += `<text x="${(x(i) + bw / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle" class="ax">${esc(t)}</text>`; });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${grid}${bars}${line}${xlab}</svg>`;
}

// 横棒（カテゴリ/常連/商品など）label + value、右に金額または件数
export function hBars(rows, opts = {}) {
  const fmt = opts.fmt || yen;
  const W = opts.w || 760, rh = opts.rh || 26, top = 6, labW = opts.labW || 150, valW = 92;
  const H = top * 2 + rows.length * rh; const bw = W - labW - valW - 12;
  const max = Math.max(1, ...rows.map((r) => r.value));
  let out = '';
  rows.forEach((r, i) => {
    const yy = top + i * rh; const w = Math.max(1, (r.value / max) * bw);
    out += `<text x="0" y="${yy + rh / 2 + 4}" class="lab">${esc(r.label)}</text>`;
    out += `<rect x="${labW}" y="${yy + 4}" width="${w.toFixed(1)}" height="${rh - 10}" rx="3" fill="${r.color || PALETTE[i % PALETTE.length]}"/>`;
    out += `<text x="${W}" y="${yy + rh / 2 + 4}" text-anchor="end" class="val">${esc(fmt(r.value))}${r.sub ? `<tspan class="sub">  ${esc(r.sub)}</tspan>` : ''}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${out}</svg>`;
}

// 縦棒（時間帯/曜日）
export function vBars(data, opts = {}) {
  const W = opts.w || 760, H = opts.h || 200, pad = { l: 40, r: 12, t: 10, b: 26 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const max = nice(Math.max(1, ...data.map((d) => d.value)));
  const n = data.length, gap = 6, bw = Math.max(4, iw / n - gap);
  const x = (i) => pad.l + i * (iw / n) + (iw / n - bw) / 2;
  const y = (v) => pad.t + ih - (v / max) * ih;
  let out = '';
  for (let g = 0; g <= 4; g++) { const v = (max / 4) * g, yy = y(v); out += `<line x1="${pad.l}" y1="${yy.toFixed(1)}" x2="${W - pad.r}" y2="${yy.toFixed(1)}" stroke="var(--grid)"/><text x="${pad.l - 6}" y="${(yy + 3).toFixed(1)}" text-anchor="end" class="ax">${opts.kfmt ? opts.kfmt(v) : v}</text>`; }
  data.forEach((d, i) => {
    out += `<rect x="${x(i).toFixed(1)}" y="${y(d.value).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(0) - y(d.value)).toFixed(1)}" rx="2" fill="${opts.color || 'var(--c1)'}"><title>${esc(d.label)} ${opts.vfmt ? opts.vfmt(d.value) : d.value}</title></rect>`;
    out += `<text x="${(x(i) + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="ax">${esc(d.label)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${out}</svg>`;
}

// ドーナツ（売上構成）
export function donut(rows, opts = {}) {
  const S = opts.s || 200, r = S / 2 - 6, cx = S / 2, cy = S / 2, thick = opts.thick || 34;
  const total = rows.reduce((s, x) => s + x.value, 0) || 1;
  let a0 = -Math.PI / 2, seg = '';
  rows.forEach((row, i) => {
    const frac = row.value / total, a1 = a0 + frac * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a, rr) => `${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`;
    const vt = opts.vfmt ? opts.vfmt(row.value) : yen(row.value);
    seg += `<path d="M ${p(a0, r)} A ${r} ${r} 0 ${large} 1 ${p(a1, r)} L ${p(a1, r - thick)} A ${r - thick} ${r - thick} 0 ${large} 0 ${p(a0, r - thick)} Z" fill="${PALETTE[i % PALETTE.length]}"><title>${esc(row.label)} ${esc(vt)} (${(frac * 100).toFixed(0)}%)</title></path>`;
    a0 = a1;
  });
  const cText = opts.centerText != null ? opts.centerText : yen(total);
  const cSub = opts.centerSub != null ? opts.centerSub : '総売上';
  return `<svg viewBox="0 0 ${S} ${S}" class="donut" role="img">${seg}<text x="${cx}" y="${cy - 2}" text-anchor="middle" class="dcenter">${esc(cText)}</text><text x="${cx}" y="${cy + 16}" text-anchor="middle" class="dsub">${esc(cSub)}</text></svg>`;
}

export function legend(rows) {
  return `<div class="legend">${rows.map((r, i) => `<span class="lg"><i style="background:${r.color || PALETTE[i % PALETTE.length]}"></i>${esc(r.label)}</span>`).join('')}</div>`;
}
export { esc, PALETTE };
