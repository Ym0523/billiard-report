// POSバックアップ(BackupData.store)から集計値を作る。取消(voided)は売上から除外。
// 日次の公式値は closings（締めスナップショット）を使い、内訳（カテゴリ/時間帯/商品/常連）は
// 明細(closed/sales)の取消除きから算出する。両者は概ね一致する（メダル計上タイミングで微差あり）。

const CAT_LABEL = { drink: 'ドリンク', tobacco: 'たばこ', snack: 'お菓子', ramen: 'ラーメン', goods: '備品', other: 'その他' };
const CAT_ORDER = ['drink', 'tobacco', 'snack', 'ramen', 'goods', 'other'];
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const DAY_LABEL = { normal: '通常日', ladies: 'レディース', halfPrice: '半額' };

const sum = (a) => a.reduce((s, x) => s + (x || 0), 0);
const yenOf = (n) => Math.round(n || 0);

export function analyze(store, meta = {}) {
  const closings = [...(store.closings || [])].sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  const closed = (store.closed || []).filter((r) => !r.voided);   // 時間会計（取消除く）
  const sales = (store.sales || []).filter((r) => !r.voided);     // 物販（取消除く）
  const regulars = new Map((store.regulars || []).map((r) => [r.id, r]));

  // ---- KPI（締めベース）----
  const days = closings.length;
  const totalYen = sum(closings.map((c) => c.totalYen));
  const timeYen = sum(closings.map((c) => c.timeYen));
  const itemYen = sum(closings.map((c) => c.itemYen));
  const gameYen = sum(closings.map((c) => c.gameYen || 0));
  const guestCount = sum(closings.map((c) => c.guestCount));
  const voidCount = sum(closings.map((c) => c.voidCount || 0));
  const voidYen = sum(closings.map((c) => c.voidYen || 0));
  const saleCount = sum(closings.map((c) => c.saleCount || 0));
  const avgDaily = days ? totalYen / days : 0;
  const perGuest = guestCount ? totalYen / guestCount : 0;

  // ---- 日次推移 ----
  const daily = closings.map((c) => ({
    date: c.businessDate,
    wd: WEEK[new Date(c.businessDate + 'T00:00:00+09:00').getUTCDay()],
    time: yenOf(c.timeYen), item: yenOf(c.itemYen), game: yenOf(c.gameYen || 0),
    total: yenOf(c.totalYen), guests: c.guestCount || 0,
    cashDiff: c.cashDiff == null ? null : c.cashDiff,
  }));

  // ---- カテゴリ別（物販の内訳・明細ベース）----
  const catYen = {}; CAT_ORDER.forEach((k) => (catYen[k] = 0));
  const prodMap = new Map(); // name -> {qty, yen}
  for (const s of sales) for (const l of (s.lines || [])) {
    const gross = (l.yen || 0) * (l.qty || 1);
    catYen[l.cat] = (catYen[l.cat] || 0) + gross;
    const p = prodMap.get(l.name) || { qty: 0, yen: 0 };
    p.qty += (l.qty || 1); p.yen += gross; prodMap.set(l.name, p);
  }
  const itemGross = sum(Object.values(catYen));
  const categories = CAT_ORDER.map((k) => ({ key: k, label: CAT_LABEL[k], yen: yenOf(catYen[k]) }))
    .filter((c) => c.yen > 0).sort((a, b) => b.yen - a.yen);
  const products = [...prodMap.entries()].map(([name, v]) => ({ name, qty: v.qty, yen: yenOf(v.yen) }))
    .sort((a, b) => b.yen - a.yen).slice(0, 12);

  // 売上構成（ビリヤード / 物販 / ゲーム）
  const mix = [
    { label: 'ビリヤード', yen: yenOf(timeYen) },
    { label: '物販', yen: yenOf(itemYen) },
    ...(gameYen > 0 ? [{ label: 'ゲーム', yen: yenOf(gameYen) }] : []),
  ].filter((x) => x.yen > 0);

  // ---- 曜日別（締めベース平均）----
  const byWd = WEEK.map((w) => ({ wd: w, total: 0, guests: 0, days: 0 }));
  daily.forEach((d) => { const i = WEEK.indexOf(d.wd); byWd[i].total += d.total; byWd[i].guests += d.guests; byWd[i].days += 1; });
  const weekday = byWd.map((x) => ({ wd: x.wd, avgTotal: x.days ? Math.round(x.total / x.days) : 0, avgGuests: x.days ? +(x.guests / x.days).toFixed(1) : 0, days: x.days }));

  // ---- 時間帯別（明細の会計時刻ベース・件数）----
  const hours = Array.from({ length: 24 }, (_, h) => ({ h, count: 0, yen: 0 }));
  const stamp = (at, yen) => { const h = new Date(at + 9 * 3600000).getUTCHours(); hours[h].count += 1; hours[h].yen += yen || 0; };
  closed.forEach((r) => stamp(r.at, r.yen));
  sales.forEach((r) => stamp(r.at, r.yen));
  const activeHours = hours.filter((x) => x.count > 0);
  const hourFrom = activeHours.length ? activeHours[0].h : 0;
  const hourTo = activeHours.length ? activeHours[activeHours.length - 1].h : 23;
  const hourly = hours.slice(hourFrom, hourTo + 1).map((x) => ({ ...x, yen: yenOf(x.yen) }));

  // ---- 特別日効果（時間会計の客単価・明細ベース）----
  const dayAgg = {};
  closed.forEach((r) => { const k = r.day || 'normal'; (dayAgg[k] ||= { n: 0, yen: 0 }); dayAgg[k].n += 1; dayAgg[k].yen += r.yen || 0; });
  const special = Object.entries(dayAgg).map(([k, v]) => ({ key: k, label: DAY_LABEL[k] || k, visits: v.n, yen: yenOf(v.yen), per: v.n ? Math.round(v.yen / v.n) : 0 }))
    .sort((a, b) => b.visits - a.visits);

  // ---- メダル利用 ----
  const medalTypes = ['TK', '□', '△', '♡'];
  const medalByType = Object.fromEntries(medalTypes.map((t) => [t, 0]));
  closings.forEach((c) => medalTypes.forEach((t) => (medalByType[t] += (c.medalCounts && c.medalCounts[t]) || 0)));
  // カテゴリ群別（明細の medalsByCat 合算）
  const medalByGroup = {};
  const addMedals = (mbc) => { for (const g in (mbc || {})) { const c = mbc[g]; const n = medalTypes.reduce((s, t) => s + ((c && c[t]) || 0), 0); medalByGroup[g] = (medalByGroup[g] || 0) + n; } };
  closed.forEach((r) => addMedals(r.medalsByCat));
  sales.forEach((r) => addMedals(r.medalsByCat));
  const GROUP_LABEL = { billiard: 'ビリヤード', food: '飲食', goods: '備品', tobacco: 'たばこ', other: 'その他' };
  const medalGroups = Object.entries(medalByGroup).map(([k, n]) => ({ label: GROUP_LABEL[k] || k, n })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  const medalTotal = sum(Object.values(medalByType));

  // ---- 常連ランキング（時間会計・明細ベース）----
  const regAgg = new Map();
  closed.forEach((r) => { if (!r.regularId) return; const a = regAgg.get(r.regularId) || { visits: 0, yen: 0, name: r.name }; a.visits += 1; a.yen += r.yen || 0; regAgg.set(r.regularId, a); });
  const regularsRank = [...regAgg.entries()].map(([id, v]) => ({ name: (regulars.get(id) || {}).name || v.name || id, visits: v.visits, yen: yenOf(v.yen) }))
    .sort((a, b) => b.yen - a.yen).slice(0, 12);
  const regularVisits = sum([...regAgg.values()].map((v) => v.visits));
  const walkVisits = closed.length - regularVisits;

  // 現金差異
  const cashDiffDays = daily.filter((d) => d.cashDiff != null && d.cashDiff !== 0);

  return {
    meta: { store: meta.store || 'store-a', exportedAt: meta.exportedAt || null, generatedAt: meta.generatedAt || null,
      from: closings[0] && closings[0].businessDate, to: closings[days - 1] && closings[days - 1].businessDate },
    kpi: { days, totalYen: yenOf(totalYen), avgDaily: Math.round(avgDaily), guestCount, perGuest: Math.round(perGuest),
      timeYen: yenOf(timeYen), itemYen: yenOf(itemYen), gameYen: yenOf(gameYen), saleCount,
      voidCount, voidYen: yenOf(voidYen), voidRate: (saleCount + voidCount) ? voidCount / (saleCount + voidCount) : 0 },
    daily, mix, categories, itemGross: yenOf(itemGross), products, weekday, hourly,
    special, medalByType, medalGroups, medalTotal, regularsRank, regularVisits, walkVisits, cashDiffDays,
  };
}
