// POSバックアップ(BackupData.store)から、年度／月度それぞれのスコープ集計を作る。
// 取消(voided)は売上から除外。日次の公式値は closings（締めスナップショット）を使い、
// 内訳（カテゴリ/時間帯/商品/常連）は明細(closed/sales)の取消除きから算出する。

const CAT_LABEL = { drink: 'ドリンク', tobacco: 'たばこ', snack: 'お菓子', ramen: 'ラーメン', goods: '備品', other: 'その他' };
const CAT_ORDER = ['drink', 'tobacco', 'snack', 'ramen', 'goods', 'other'];
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const DAY_LABEL = { normal: '通常日', ladies: 'レディース', halfPrice: '半額' };
const GROUP_LABEL = { billiard: 'ビリヤード', food: '飲食', goods: '備品', tobacco: 'たばこ', other: 'その他' };
const MEDAL_TYPES = ['TK', '□', '△', '♡'];

const sum = (a) => a.reduce((s, x) => s + (x || 0), 0);
const yenOf = (n) => Math.round(n || 0);

// 締めの配列から KPI をまとめる（全期間・年度・月度で共通利用）。
function kpiFrom(cl) {
  const days = cl.length;
  const t = (k) => sum(cl.map((c) => c[k] || 0));
  const totalYen = t('totalYen'), guestCount = t('guestCount'), saleCount = t('saleCount'), voidCount = t('voidCount');
  return {
    days, totalYen: yenOf(totalYen), avgDaily: days ? Math.round(totalYen / days) : 0,
    guestCount, perGuest: guestCount ? Math.round(totalYen / guestCount) : 0,
    timeYen: yenOf(t('timeYen')), itemYen: yenOf(t('itemYen')), gameYen: yenOf(t('gameYen')),
    saleCount, voidCount, voidYen: yenOf(t('voidYen')),
    voidRate: (saleCount + voidCount) ? voidCount / (saleCount + voidCount) : 0,
  };
}

const dailyRow = (c) => ({
  date: c.businessDate, wd: WEEK[new Date(c.businessDate + 'T00:00:00+09:00').getUTCDay()],
  time: yenOf(c.timeYen), item: yenOf(c.itemYen), game: yenOf(c.gameYen || 0),
  total: yenOf(c.totalYen), guests: c.guestCount || 0, cashDiff: c.cashDiff == null ? null : c.cashDiff,
});

export function analyze(store, meta = {}) {
  const closingsAll = [...(store.closings || [])].sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  const closedAll = (store.closed || []).filter((r) => !r.voided);
  const salesAll = (store.sales || []).filter((r) => !r.voided);
  const regulars = new Map((store.regulars || []).map((r) => [r.id, r]));
  const cidToDate = new Map(closingsAll.map((c) => [c.id, c.businessDate]));

  // 1つのスコープ（締めの部分集合）の全指標を計算する。
  function computeScope(cls) {
    const ids = new Set(cls.map((c) => c.id));
    const closed = closedAll.filter((r) => ids.has(r.closingId));
    const sales = salesAll.filter((r) => ids.has(r.closingId));
    const kpi = kpiFrom(cls);
    const daily = cls.map(dailyRow);

    // 月グルーピング（月次推移＋月次サマリー用）
    const mMap = new Map();
    cls.forEach((c) => { const mk = c.businessDate.slice(0, 7); (mMap.get(mk) || mMap.set(mk, []).get(mk)).push(c); });
    const mKeys = [...mMap.keys()].sort();
    const monthly = mKeys.map((mk) => { const k = kpiFrom(mMap.get(mk)); return { date: mk, label: `${+mk.slice(5, 7)}月`, time: k.timeYen, item: k.itemYen, game: k.gameYen, total: k.totalYen, guests: k.guestCount }; });
    const monthSummary = mKeys.map((mk) => ({ label: `${+mk.slice(5, 7)}月`, kpi: kpiFrom(mMap.get(mk)) }));

    // 来店人数の内訳（時間会計＝closed ベース）。常連/一般・学生/女性/一般（学生>女性>一般の優先）。
    const zeroV = () => ({ reg: 0, walk: 0, student: 0, female: 0, general: 0 });
    const visByDate = new Map();
    closed.forEach((r) => {
      const date = cidToDate.get(r.closingId); if (!date) return;
      const o = visByDate.get(date) || zeroV();
      if (r.regularId) o.reg += 1; else o.walk += 1;
      const g = r.guest || r;
      if (g.isStudent) o.student += 1; else if (g.isFemale) o.female += 1; else o.general += 1;
      visByDate.set(date, o);
    });
    const visitDaily = cls.map((c) => ({ date: c.businessDate, ...(visByDate.get(c.businessDate) || zeroV()) }));
    const visByMonth = new Map();
    for (const [date, o] of visByDate) { const mk = date.slice(0, 7); const g = visByMonth.get(mk) || zeroV(); for (const k in o) g[k] += o[k]; visByMonth.set(mk, g); }
    const visitMonthly = mKeys.map((mk) => ({ date: mk, label: `${+mk.slice(5, 7)}月`, ...(visByMonth.get(mk) || zeroV()) }));
    const visitTotal = visitDaily.reduce((a, d) => { ['reg', 'walk', 'student', 'female', 'general'].forEach((k) => (a[k] += d[k])); return a; }, zeroV());
    // 曜日別の平均来店人数（その曜日の営業日数で割る）
    const VK = ['reg', 'walk', 'student', 'female', 'general'];
    const wdSum = WEEK.map(() => ({ days: 0, reg: 0, walk: 0, student: 0, female: 0, general: 0 }));
    visitDaily.forEach((d) => { const i = new Date(d.date + 'T00:00:00+09:00').getUTCDay(); const o = wdSum[i]; o.days += 1; VK.forEach((k) => (o[k] += d[k])); });
    const round1 = (n) => Math.round(n * 10) / 10;
    const weekdayVisit = WEEK.map((w, i) => { const o = wdSum[i], dv = o.days || 1; const r = { wd: w, days: o.days }; VK.forEach((k) => (r[k] = round1(o[k] / dv))); return r; });

    // 物販カテゴリ（カテゴリ→商品ごとの販売個数・金額）
    const catYen = {}; CAT_ORDER.forEach((k) => (catYen[k] = 0));
    const prodMap = new Map(), catProd = {};
    for (const s of sales) {
      for (const l of (s.lines || [])) {
        const gross = (l.yen || 0) * (l.qty || 1);
        catYen[l.cat] = (catYen[l.cat] || 0) + gross;
        const p = prodMap.get(l.name) || { qty: 0, yen: 0 }; p.qty += (l.qty || 1); p.yen += gross; prodMap.set(l.name, p);
        (catProd[l.cat] ||= new Map());
        const cp = catProd[l.cat].get(l.name) || { qty: 0, yen: 0 }; cp.qty += (l.qty || 1); cp.yen += gross; catProd[l.cat].set(l.name, cp);
      }
    }
    const itemGross = sum(Object.values(catYen));
    const categories = CAT_ORDER.map((k) => ({ key: k, label: CAT_LABEL[k], yen: yenOf(catYen[k]) })).filter((c) => c.yen > 0).sort((a, b) => b.yen - a.yen);
    const products = [...prodMap.entries()].map(([name, v]) => ({ name, qty: v.qty, yen: yenOf(v.yen) })).sort((a, b) => b.yen - a.yen).slice(0, 12);
    // カテゴリ別に「どの商品が何個売れたか」の全リスト（販売数の多い順）
    const categoryDetail = categories.map((c) => {
      const items = [...(catProd[c.key] || new Map()).entries()].map(([name, v]) => ({ name, qty: v.qty, yen: yenOf(v.yen) })).sort((a, b) => b.qty - a.qty || b.yen - a.yen);
      return { key: c.key, label: c.label, yen: c.yen, share: c.yen / (itemGross || 1), qty: items.reduce((s, it) => s + it.qty, 0), items };
    });

    const mix = [{ label: 'ビリヤード', yen: kpi.timeYen }, { label: '物販', yen: kpi.itemYen }, ...(kpi.gameYen > 0 ? [{ label: 'ゲーム', yen: kpi.gameYen }] : [])].filter((x) => x.yen > 0);

    // 曜日別（平均）
    const byWd = WEEK.map((w) => ({ wd: w, total: 0, guests: 0, days: 0 }));
    daily.forEach((d) => { const i = WEEK.indexOf(d.wd); byWd[i].total += d.total; byWd[i].guests += d.guests; byWd[i].days += 1; });
    const weekday = byWd.map((x) => ({ wd: x.wd, avgTotal: x.days ? Math.round(x.total / x.days) : 0, avgGuests: x.days ? +(x.guests / x.days).toFixed(1) : 0, days: x.days }));

    // 時間帯別の入場者数（入場時刻＝guest.startAt ベース）。1営業日あたり平均。並びは営業時間(10時〜翌4時)。
    const entryHours = Array.from({ length: 24 }, () => 0);
    closed.forEach((r) => { const st = (r.guest && r.guest.startAt) || r.startAt; if (!st) return; const h = new Date(st + 9 * 3600000).getUTCHours(); entryHours[h] += 1; });
    const opDays = cls.length || 1;
    const HOUR_ORDER = [];
    for (let h = 10; h <= 23; h++) HOUR_ORDER.push(h);
    for (let h = 0; h <= 4; h++) HOUR_ORDER.push(h);
    const hourly = HOUR_ORDER.map((h) => ({ h, count: entryHours[h], avg: Math.round((entryHours[h] / opDays) * 10) / 10 }));

    // 特別日
    const dayAgg = {};
    closed.forEach((r) => { const k = r.day || 'normal'; (dayAgg[k] ||= { n: 0, yen: 0 }); dayAgg[k].n += 1; dayAgg[k].yen += r.yen || 0; });
    const special = Object.entries(dayAgg).map(([k, v]) => ({ key: k, label: DAY_LABEL[k] || k, visits: v.n, yen: yenOf(v.yen), per: v.n ? Math.round(v.yen / v.n) : 0 })).sort((a, b) => b.visits - a.visits);

    // メダル
    const medalByType = Object.fromEntries(MEDAL_TYPES.map((t) => [t, 0]));
    cls.forEach((c) => MEDAL_TYPES.forEach((t) => (medalByType[t] += (c.medalCounts && c.medalCounts[t]) || 0)));
    const medalByGroup = {};
    const addMedals = (mbc) => { for (const g in (mbc || {})) { const cc = mbc[g]; const n = MEDAL_TYPES.reduce((s, t) => s + ((cc && cc[t]) || 0), 0); medalByGroup[g] = (medalByGroup[g] || 0) + n; } };
    closed.forEach((r) => addMedals(r.medalsByCat)); sales.forEach((r) => addMedals(r.medalsByCat));
    const medalGroups = Object.entries(medalByGroup).map(([k, n]) => ({ label: GROUP_LABEL[k] || k, n })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
    const medalTotal = sum(Object.values(medalByType));

    // 常連ランキング
    const regAgg = new Map();
    closed.forEach((r) => { if (!r.regularId) return; const a = regAgg.get(r.regularId) || { visits: 0, yen: 0, name: r.name }; a.visits += 1; a.yen += r.yen || 0; regAgg.set(r.regularId, a); });
    const regularsRank = [...regAgg.entries()].map(([id, v]) => ({ name: (regulars.get(id) || {}).name || v.name || id, visits: v.visits, yen: yenOf(v.yen) })).sort((a, b) => b.yen - a.yen).slice(0, 12);
    const regularVisits = sum([...regAgg.values()].map((v) => v.visits));
    const walkVisits = closed.length - regularVisits;

    const cashDiffDays = daily.filter((d) => d.cashDiff != null && d.cashDiff !== 0);

    return {
      kpi, daily, monthly, monthSummary, visitDaily, visitMonthly, visitTotal, weekdayVisit, mix, categories, itemGross: yenOf(itemGross), products, categoryDetail,
      weekday, hourly, special, medalByType, medalGroups, medalTotal, regularsRank, regularVisits, walkVisits, cashDiffDays,
      from: cls[0] && cls[0].businessDate, to: cls[cls.length - 1] && cls[cls.length - 1].businessDate,
    };
  }

  const byYear = new Map(), byMonth = new Map();
  closingsAll.forEach((c) => {
    const yk = c.businessDate.slice(0, 4), mk = c.businessDate.slice(0, 7);
    (byYear.get(yk) || byYear.set(yk, []).get(yk)).push(c);
    (byMonth.get(mk) || byMonth.set(mk, []).get(mk)).push(c);
  });
  const years = [...byYear.keys()].sort().map((k) => ({ key: k, label: `${+k}年`, scope: computeScope(byYear.get(k)) }));
  const months = [...byMonth.keys()].sort().map((k) => ({ key: k, label: `${+k.slice(0, 4)}年${+k.slice(5, 7)}月度`, scope: computeScope(byMonth.get(k)) }));

  return {
    meta: {
      store: meta.store || 'store-a', exportedAt: meta.exportedAt || null, generatedAt: meta.generatedAt || null,
      from: closingsAll[0] && closingsAll[0].businessDate, to: closingsAll[closingsAll.length - 1] && closingsAll[closingsAll.length - 1].businessDate,
      empty: closingsAll.length === 0,
    },
    years, months,
  };
}
