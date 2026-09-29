// 棚卸レポート・日次在庫用のデータ整形。stockMoves（直近180日）から必要な最小データを作る。
//  - prods:    動き/棚卸しに現れた商品 {id,name,cat,code}
//  - stkDates: 棚卸しが行われた日（JST・昇順・重複なし）。存在判定（在庫タブを出すか）に使う。
//  - mv:       mv[pid] = [[atMs, kind, delta, after], ...] 昇順。stocktake の delta は「実数 − あるべき数（動きを畳んで再計算）」。
//              棚卸比較（商品ごとの前回/今回）も日次在庫変動も、これ1つから導出する
//              （棚卸日は商品ごとに異なるため、店全体の“回”ではなく商品単位で前回/今回を取る）。
// クライアント（暗号化本文の復号後スクリプト）がこの JSON を読んで、比較表・日次変動表を描画する。

// 棚卸レポートの一覧に出す棚卸しの開始日（JST）。これより前（導入初期の 8/18〜9/1）は同期不具合・初期登録が
// 混ざってデータが不正確なため一覧・前回比較から外す。※在庫の計算（あるべき数の算出）には引き続き使う＝記録は消さない。
const STOCKTAKE_FROM = '2026-09-02';

const p2 = (n) => String(n).padStart(2, '0');
const jstDay = (ms) => { const d = new Date(Number(ms) + 9 * 3600000); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`; };

export function analyzeStock(items, stockMoves) {
  const meta = new Map((items || []).map((it) => [it.id, { name: it.name, cat: it.cat, code: it.code }]));
  const moves = (stockMoves || [])
    // 商品マスタから削除済みの商品（作り直した旧ID：旧コーラ d18 → 現 px5276 等）は出さない。
    // 残すと同じ商品名で古い棚卸しが別行として並び、最新の棚卸しと紛らわしい。
    .filter((m) => m && m.productId && m.at != null && (!meta.size || meta.has(String(m.productId))))
    .map((m) => ({ pid: String(m.productId), kind: String(m.kind || ''), delta: Number(m.delta) || 0, after: Number(m.after) || 0, at: Number(m.at) || 0, name: m.name }))
    .sort((a, b) => a.at - b.at || String(a.pid).localeCompare(b.pid));

  const prodMap = new Map(); // pid -> {id,name,cat,code}
  const stkSet = new Set();
  const mv = {};             // pid -> [[at,kind,delta,after]]
  const level = new Map();   // pid -> 動きを時刻順に畳んだ理論在庫
  // 初期の同期不具合で残った「中身が完全に同じ棚卸し（id違い）」の重複を除く（棚卸しは絶対値なので在庫計算は不変）。
  // ※販売等の重複は除かない：POS 自身の在庫計算（id単位で畳む）と数字がずれるため。
  const seen = new Set();
  for (const m of moves) {
    if (m.kind === 'stocktake') {
      const key = `${m.pid}|${m.at}|${m.after}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    if (!prodMap.has(m.pid)) {
      const mt = meta.get(m.pid) || {};
      prodMap.set(m.pid, { id: m.pid, name: mt.name || m.name || m.pid, cat: mt.cat || 'other', code: mt.code != null ? String(mt.code) : null });
    }
    // 起点＝期間内で最初の動きの直前の在庫（after − delta）。
    if (!level.has(m.pid)) level.set(m.pid, m.after - m.delta);
    let delta = m.delta;
    if (m.kind === 'stocktake') {
      // ★棚卸しのズレは、記録された delta（在庫端末が確定時点で持っていた在庫との差）ではなく、
      //   全端末の動きを時刻順に畳んだ「あるべき数」から計算し直す。在庫端末の同期が遅れていても
      //   （例：レジの販売13本が未反映のまま確定）偽のズレが出ない。
      delta = m.after - level.get(m.pid);
      level.set(m.pid, m.after);
      if (jstDay(m.at) >= STOCKTAKE_FROM) stkSet.add(jstDay(m.at));
    } else {
      level.set(m.pid, level.get(m.pid) + m.delta);
    }
    (mv[m.pid] = mv[m.pid] || []).push([m.at, m.kind, delta, m.after]);
  }
  return { prods: [...prodMap.values()], stkDates: [...stkSet].sort(), mv, days: 180, stkFrom: STOCKTAKE_FROM };
}
