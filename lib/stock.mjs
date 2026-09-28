// 棚卸レポート・日次在庫用のデータ整形。stockMoves（直近180日）から必要な最小データを作る。
//  - prods:    動き/棚卸しに現れた商品 {id,name,cat,code}
//  - stkDates: 棚卸しが行われた日（JST・昇順・重複なし）。存在判定（在庫タブを出すか）に使う。
//  - mv:       mv[pid] = [[atMs, kind, delta, after], ...] 昇順。
//              棚卸比較（商品ごとの前回/今回）も日次在庫変動も、これ1つから導出する
//              （棚卸日は商品ごとに異なるため、店全体の“回”ではなく商品単位で前回/今回を取る）。
// クライアント（暗号化本文の復号後スクリプト）がこの JSON を読んで、比較表・日次変動表を描画する。

const p2 = (n) => String(n).padStart(2, '0');
const jstDay = (ms) => { const d = new Date(Number(ms) + 9 * 3600000); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`; };

export function analyzeStock(items, stockMoves) {
  const meta = new Map((items || []).map((it) => [it.id, { name: it.name, cat: it.cat, code: it.code }]));
  const moves = (stockMoves || [])
    .filter((m) => m && m.productId && m.at != null)
    .map((m) => ({ pid: String(m.productId), kind: String(m.kind || ''), delta: Number(m.delta) || 0, after: Number(m.after) || 0, at: Number(m.at) || 0, name: m.name }))
    .sort((a, b) => a.at - b.at || String(a.pid).localeCompare(b.pid));

  const prodMap = new Map(); // pid -> {id,name,cat,code}
  const stkSet = new Set();
  const mv = {};             // pid -> [[at,kind,delta,after]]
  for (const m of moves) {
    if (!prodMap.has(m.pid)) {
      const mt = meta.get(m.pid) || {};
      prodMap.set(m.pid, { id: m.pid, name: mt.name || m.name || m.pid, cat: mt.cat || 'other', code: mt.code != null ? String(mt.code) : null });
    }
    (mv[m.pid] = mv[m.pid] || []).push([m.at, m.kind, m.delta, m.after]);
    if (m.kind === 'stocktake') stkSet.add(jstDay(m.at));
  }
  return { prods: [...prodMap.values()], stkDates: [...stkSet].sort(), mv, days: 180 };
}
