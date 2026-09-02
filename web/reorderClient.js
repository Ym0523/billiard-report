/*
 * 要発注リストのライブ版クライアント（Firestore直結・発注バッチ方式）。
 *  流れ: ①発注タブ（要発注をカテゴリ別に発注）→ 発注を1件の「発注バッチ(orders)」として記録
 *        ②入荷タブ（発注ごとにカード表示）→ その発注が届いたら金額を入れて入荷（分割可）
 *
 *  データ:
 *   ・items … 商品マスタ＋在庫ミラー(stock)＋発注済(onOrder)。onOrder は「未入荷の合計」。
 *   ・orders … 発注1件＝1ドキュメント {at,cat,status,lines:[{id,name,ordered,received}]}。入荷はこの単位で行う。
 *   ・purchases … 入荷金額(仕入)。売上レポートが読む。
 *   ・stockMoves … 入荷=receiveイベントを追記（在庫の正はアプリのfold）。
 *   ・seed（前夜バックアップのマスタ）を埋め込み、live(items)で上書きマージ＝初回から動く。
 *  発注/入荷/取消は onOrder と orders を常に一緒に更新するので整合が保たれる（入荷はWebに一本化）。
 */
(function () {
  var ENC = JSON.parse(document.getElementById('cfg').textContent);
  var FB = 'https://www.gstatic.com/firebasejs/10.12.2/';

  var b64d = function (s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  async function decrypt(pw) {
    var key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    var k = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64d(ENC.salt), iterations: ENC.iter, hash: 'SHA-256' }, key, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(ENC.iv) }, k, b64d(ENC.ct));
    return new TextDecoder().decode(pt);
  }

  var CATS = [['drink', 'ドリンク'], ['tobacco', 'たばこ'], ['snack', 'お菓子'], ['ramen', 'ラーメン'], ['goods', '備品'], ['other', 'その他']];
  var catLabel = function (c) { for (var i = 0; i < CATS.length; i++) if (CATS[i][0] === c) return CATS[i][1]; return c || 'その他'; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var N = function (v) { return v == null ? 0 : (Number(v) || 0); };
  var uuid = function () { return crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2)); };
  var jshort = function (ms) { if (!ms) return '—'; var d = new Date(ms + 9 * 3600000); var p = function (n) { return String(n).padStart(2, '0'); }; return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()); };
  function suggest(i) {
    var stock = N(i.stock), on = N(i.onOrder), rp = N(i.reorderPoint);
    var short = Math.max(0, rp - (stock + on));
    if (short === 0) return 0;
    var lot = N(i.orderLot);
    return lot > 0 ? Math.max(1, Math.ceil(short / lot)) * lot : Math.max(1, short);
  }
  function isNeed(i) { return i.active !== false && i.stock != null && i.reorderPoint != null && Number(i.stock) < Number(i.reorderPoint); }

  // ---- state
  var db = null, store = 'store-a', fns = null;
  var seedById = {}, liveById = {}, ordersById = {};
  var items = [];
  var mode = 'order';       // 'order' | 'receive'
  var qtyO = {};            // 発注数（id -> 数量）
  var qtyR = {};            // 入荷数（'orderId::lineId' -> 数量）
  var cat = null;           // 発注タブの選択中カテゴリ
  var orderView = [];       // 入荷タブに表示中の発注一覧（イベント解決用）
  var busy = false;

  function mergeItems() {
    var ids = {};
    Object.keys(seedById).forEach(function (id) { ids[id] = 1; });
    Object.keys(liveById).forEach(function (id) { ids[id] = 1; });
    var out = [];
    Object.keys(ids).forEach(function (id) {
      var s = seedById[id] || {}, l = liveById[id] || {};
      var pick = function (k) { return l[k] != null ? l[k] : (s[k] != null ? s[k] : null); };
      var name = (s.name != null ? s.name : l.name);
      var catv = (s.cat != null ? s.cat : l.cat);
      if (name == null || catv == null) return;
      out.push({
        id: id, name: name, cat: catv, code: (s.code != null ? s.code : l.code),
        active: (l.active === false ? false : true),
        reorderPoint: pick('reorderPoint'), orderLot: pick('orderLot'), stock: pick('stock'),
        onOrder: (l.onOrder != null ? l.onOrder : (s.onOrder != null ? s.onOrder : 0)),
      });
    });
    return out;
  }
  function refresh() { items = mergeItems(); render(); }
  function findItem(id) { for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i]; return null; }

  // ---- 発注タブ（カテゴリ別・商品ごとの発注数）
  function getQty(i) { return (i.id in qtyO) ? qtyO[i.id] : suggest(i); }
  function setQty(i, v) { qtyO[i.id] = Math.max(0, v | 0); render(); }
  function step(i) { return N(i.orderLot) || 1; }
  function orderBase() { return items.filter(function (i) { return isNeed(i) && suggest(i) > 0; }); }
  function presentCats() { return CATS.filter(function (c) { return orderBase().some(function (i) { return i.cat === c[0]; }); }); }
  function ensureCat() { var p = presentCats().map(function (c) { return c[0]; }); if (cat == null || p.indexOf(cat) < 0) cat = p.length ? p[0] : null; }
  function catList() { return orderBase().filter(function (i) { return i.cat === cat; }); }
  function setMode(m) { mode = m; if (m === 'order') qtyO = {}; else qtyR = {}; ensureCat(); render(); }

  // ---- 入荷タブ（発注バッチ単位）。未入荷の発注＋（バッチに紐づかない旧onOrderは「以前の発注」として救済）
  function rKey(oid, lid) { return oid + '::' + lid; }
  function rGet(oid, line) { var k = rKey(oid, line.id); return (k in qtyR) ? qtyR[k] : line.remaining; }
  function rSet(oid, line, v) { qtyR[rKey(oid, line.id)] = Math.max(0, Math.min(line.remaining, v | 0)); render(); }
  function computeOpenOrders() {
    var list = [];
    Object.keys(ordersById).forEach(function (oid) {
      var o = ordersById[oid]; if (!o || o.status !== 'open') return;
      var lines = (o.lines || []).map(function (l) {
        var ordered = N(l.ordered), received = N(l.received);
        var it = findItem(l.id) || {};
        return { id: l.id, name: l.name || it.name || l.id, ordered: ordered, received: received, remaining: Math.max(0, ordered - received) };
      }).filter(function (l) { return l.remaining > 0; });
      if (!lines.length) return;
      list.push({ id: oid, at: N(o.at), cat: o.cat || 'other', lines: lines, isLegacy: false });
    });
    // バッチに紐づかない onOrder（旧・アプリ由来）はカテゴリごとに「以前の発注」として救済表示。
    var covered = {};
    list.forEach(function (o) { o.lines.forEach(function (l) { covered[l.id] = (covered[l.id] || 0) + l.remaining; }); });
    var byCat = {};
    items.forEach(function (i) {
      var leg = N(i.onOrder) - (covered[i.id] || 0);
      if (leg > 0) { (byCat[i.cat] = byCat[i.cat] || []).push({ id: i.id, name: i.name, ordered: leg, received: 0, remaining: leg }); }
    });
    Object.keys(byCat).forEach(function (c) { list.push({ id: 'legacy:' + c, at: 0, cat: c, lines: byCat[c], isLegacy: true }); });
    list.sort(function (a, b) { return b.at - a.at; });
    return list;
  }

  function toast(msg) {
    var t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.className = 'show';
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.className = ''; }, 2800);
  }

  // ---- 接続
  async function boot(cfg) {
    store = cfg.storeId || 'store-a';
    var appm = await import(FB + 'firebase-app.js');
    var authm = await import(FB + 'firebase-auth.js');
    var fs = await import(FB + 'firebase-firestore.js');
    fns = fs;
    var fbApp = appm.initializeApp({
      apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId,
      appId: cfg.appId, storageBucket: cfg.storageBucket, messagingSenderId: cfg.messagingSenderId,
    });
    var auth = authm.getAuth(fbApp);
    await authm.signInAnonymously(auth);
    db = fs.getFirestore(fbApp);
    fs.onSnapshot(fs.collection(db, 'stores', store, 'items'), function (snap) {
      var map = {};
      snap.forEach(function (d) {
        var v = d.data();
        map[d.id] = {
          id: d.id, cat: v.cat, name: v.name, code: v.code, active: v.active,
          stock: (v.stock == null ? null : Number(v.stock)),
          reorderPoint: (v.reorderPoint == null ? null : Number(v.reorderPoint)),
          orderLot: (v.orderLot == null ? null : Number(v.orderLot)),
          onOrder: (v.onOrder == null ? null : Math.max(0, Number(v.onOrder))), // 原子的increment(-q)で稀に負になっても表示は0で丸める
        };
      });
      liveById = map; refresh();
    }, function (e) { toast('接続エラー: ' + (e && e.message || e)); });
    fs.onSnapshot(fs.collection(db, 'stores', store, 'orders'), function (snap) {
      var m = {}; snap.forEach(function (d) { m[d.id] = d.data(); }); ordersById = m; render();
    }, function () { /* 無視 */ });
  }

  // ---- 発注（1件の発注バッチを作成 ＋ onOrder 加算）
  async function doOrder() {
    if (busy) return;
    if (!fns) { toast('接続中です。少し待ってからお試しください。'); return; }
    var picked = catList().filter(function (i) { return getQty(i) > 0; });
    if (!picked.length) return;
    if (!confirm(catLabel(cat) + ' を ' + picked.length + '品 発注します。よろしいですか？')) return;
    busy = true; render();
    try {
      var batch = fns.writeBatch(db); var now = Date.now();
      picked.forEach(function (i) { batch.set(fns.doc(db, 'stores', store, 'items', i.id), { onOrder: fns.increment(getQty(i)), onOrderAt: now }, { merge: true }); });
      var oid = 'web:' + uuid();
      batch.set(fns.doc(db, 'stores', store, 'orders', oid),
        { id: oid, at: now, cat: cat, status: 'open', source: 'web',
          lines: picked.map(function (i) { return { id: i.id, name: i.name || '', ordered: getQty(i), received: 0 }; }) });
      await batch.commit();
      qtyO = {};
      toast('発注しました（' + picked.length + '品）');
      busy = false; setMode('receive'); return;
    } catch (e) { toast('保存に失敗しました: ' + (e && e.message || e)); }
    busy = false; render();
  }

  // ---- 発注リストを共有（発注タブの選択カテゴリぶん）
  function doShare() {
    var rows = catList().filter(function (i) { return getQty(i) > 0; });
    if (!rows.length) { toast('対象の商品がありません'); return; }
    var lines = ['【発注リスト】' + catLabel(cat)];
    rows.forEach(function (i) { lines.push('・' + (i.code ? i.code + ' ' : '') + i.name + ' ×' + getQty(i) + '（残' + N(i.stock) + '／発注点' + (i.reorderPoint == null ? '-' : i.reorderPoint) + '）'); });
    var text = lines.join('\n');
    if (navigator.share) { navigator.share({ text: text }).catch(function () { }); }
    else if (navigator.clipboard) { navigator.clipboard.writeText(text).then(function () { toast('発注リストをコピーしました'); }, function () { toast('コピーできませんでした'); }); }
    else { toast('共有に非対応の端末です'); }
  }

  // ---- 入荷（発注バッチ単位・分割可）: receiveイベント追記＋onOrder減算＋stock更新＋金額(仕入)記録＋発注の受領数更新
  async function doReceiveOrder(order) {
    if (busy) return;
    if (!fns) { toast('接続中です。少し待ってからお試しください。'); return; }
    var picked = order.lines.map(function (l) { return { l: l, q: rGet(order.id, l) }; }).filter(function (x) { return x.q > 0; });
    if (!picked.length) return;
    var tot = picked.reduce(function (s, x) { return s + x.q; }, 0);
    var amount = null;
    while (true) {
      var a = prompt('入荷を登録します（' + picked.length + '品・計 ＋' + tot + '）。\nこの入荷の金額（円）を入力してください。', '');
      if (a === null) return;
      var dg = a.replace(/[^0-9]/g, '');
      if (dg === '') { alert('入荷金額を入力してください（0以上の数字）。'); continue; }
      amount = parseInt(dg, 10) || 0; break;
    }
    busy = true; render();
    try {
      var batch = fns.writeBatch(db); var now = Date.now();
      picked.forEach(function (x) {
        var l = x.l, q = x.q; var it = findItem(l.id) || {}; var after = N(it.stock) + q; var mid = 'web:' + uuid();
        batch.set(fns.doc(db, 'stores', store, 'stockMoves', mid),
          { id: mid, productId: l.id, name: l.name || '', kind: 'receive', delta: q, after: after, at: now, reason: '入荷（Web）' });
        // ★在庫ミラー(stock)はWebから書かない。入荷は上の stockMove(receive) が権威で、
        //   在庫端末の全move畳み込み(applyFolded)がミラーを更新する。ここは発注残(onOrder)だけ減らす。
        batch.set(fns.doc(db, 'stores', store, 'items', l.id),
          { onOrder: fns.increment(-q), onOrderAt: now }, { merge: true }); // 原子的に減算＝同時操作でも発注残を取りこぼさない
      });
      var pid = 'web:' + uuid();
      batch.set(fns.doc(db, 'stores', store, 'purchases', pid),
        { id: pid, at: now, total: amount, cat: order.cat, qty: tot, orderId: order.isLegacy ? null : order.id,
          lines: picked.map(function (x) { return { id: x.l.id, name: x.l.name || '', qty: x.q }; }), source: 'web' });
      if (!order.isLegacy) {
        var src = ordersById[order.id] || {}; var add = {}; picked.forEach(function (x) { add[x.l.id] = x.q; });
        var newLines = (src.lines || []).map(function (ol) { return { id: ol.id, name: ol.name, ordered: N(ol.ordered), received: N(ol.received) + (add[ol.id] || 0) }; });
        var done = newLines.every(function (ol) { return ol.received >= ol.ordered; });
        batch.set(fns.doc(db, 'stores', store, 'orders', order.id), { lines: newLines, status: done ? 'done' : 'open', updatedAt: now }, { merge: true });
      }
      await batch.commit();
      picked.forEach(function (x) { delete qtyR[rKey(order.id, x.l.id)]; });
      toast('入荷を登録しました（' + picked.length + '品・¥' + amount.toLocaleString() + '）');
    } catch (e) { toast('保存に失敗しました: ' + (e && e.message || e)); }
    busy = false; render();
  }

  // ---- 発注取消（その発注の未入荷ぶんを戻す：在庫は触らず onOrder のみ減算）
  async function doCancelOrder(order) {
    if (busy) return;
    if (!fns) { toast('接続中です。少し待ってからお試しください。'); return; }
    var rem = order.lines.filter(function (l) { return l.remaining > 0; });
    if (!rem.length) return;
    var tot = rem.reduce(function (s, l) { return s + l.remaining; }, 0);
    if (!confirm('この発注を取り消します（' + rem.length + '品・計 −' + tot + '）。在庫は変わりません。')) return;
    busy = true; render();
    try {
      var batch = fns.writeBatch(db); var now = Date.now();
      rem.forEach(function (l) { batch.set(fns.doc(db, 'stores', store, 'items', l.id), { onOrder: fns.increment(-l.remaining), onOrderAt: now }, { merge: true }); }); // 原子的に減算
      if (!order.isLegacy) batch.set(fns.doc(db, 'stores', store, 'orders', order.id), { status: 'cancelled', updatedAt: now }, { merge: true });
      await batch.commit();
      order.lines.forEach(function (l) { delete qtyR[rKey(order.id, l.id)]; });
      toast('発注を取り消しました');
    } catch (e) { toast('保存に失敗しました: ' + (e && e.message || e)); }
    busy = false; render();
  }

  // ---- 描画
  function render() {
    var app = document.getElementById('app'); if (!app || app.style.display === 'none') return;
    ensureCat();
    var needCnt = orderBase().length;
    var waitTot = items.reduce(function (s, i) { return s + N(i.onOrder); }, 0);
    var connected = !!fns;

    var h = '<div class="wrap">';
    h += '<header class="hd"><div class="eyebrow">在庫 ／ 発注</div><h1>要発注リスト</h1>';
    h += '<div class="stat"><div class="s"><b>' + needCnt + '</b><span>要発注</span></div><div class="s"><b>' + waitTot + '</b><span>入荷待ち(個)</span></div></div>';
    h += '<div class="live"><span class="dot' + (connected ? '' : ' off') + '"></span>' + (connected ? 'リアルタイム接続中 — この場で発注・入荷できます' : '接続中…（一覧は前回データ）') + '</div></header>';

    h += '<div class="mtabs">';
    h += '<button class="mtab' + (mode === 'order' ? ' on' : '') + '" data-act="mode" data-mode="order">① 発注（要発注）</button>';
    h += '<button class="mtab' + (mode === 'receive' ? ' on' : '') + '" data-act="mode" data-mode="receive">② 入荷（発注ごと）</button>';
    h += '</div>';

    if (mode === 'order') {
      h += renderOrderTab();
      h += '</div>'; // .wrap
      var picked = catList().filter(function (i) { return getQty(i) > 0; });
      var totUnits = picked.reduce(function (s, i) { return s + getQty(i); }, 0);
      h += '<div class="bar"><span class="binfo">発注 ' + picked.length + '品・計 ' + totUnits + '</span><span class="sp"></span>';
      h += '<button class="b ghost" data-act="share"' + (picked.length ? '' : ' disabled') + '>共有</button>';
      h += '<button class="b pri" data-act="order"' + (picked.length && !busy ? '' : ' disabled') + '>' + (busy ? '…' : '発注する') + '</button></div>';
    } else {
      h += renderReceiveTab();
      h += '</div>'; // .wrap
    }
    app.innerHTML = h;
  }

  function renderOrderTab() {
    var present = presentCats();
    var h = '<p class="note">在庫が発注点を割った商品です。数量を確認し、カテゴリごとに「発注する」を押してください。1回の発注は入荷タブに1件として並びます。</p>';
    if (present.length > 1) {
      h += '<div class="chips">';
      present.forEach(function (c) { h += '<button class="chip' + (cat === c[0] ? ' on' : '') + '" data-act="cat" data-cat="' + c[0] + '">' + c[1] + '</button>'; });
      h += '</div>';
    }
    var rows = catList();
    if (!rows.length) { h += '<p class="empty">いま要発注の商品はありません。</p>'; return h; }
    rows = rows.slice().sort(function (a, b) { return (N(b.reorderPoint) - N(b.stock)) - (N(a.reorderPoint) - N(a.stock)); });
    h += '<div class="grp"><div class="glabel">' + catLabel(cat) + ' ' + rows.length + '品</div>';
    rows.forEach(function (i) {
      var q = getQty(i); var stock = N(i.stock);
      h += '<div class="row"><div class="rinfo"><div class="rname">' + (i.code ? esc(i.code) + ' ' : '') + esc(i.name) + '</div>';
      h += '<div class="rmeta"><span class="' + (stock <= 0 ? 'zero' : 'low') + '">残' + stock + '</span> ／発注点' + (i.reorderPoint == null ? '-' : i.reorderPoint) + (N(i.onOrder) ? ' 発注中' + N(i.onOrder) : '') + ' → 発注 ×' + q + '</div></div>';
      h += '<div class="stp"><button class="sbtn" data-act="dec" data-id="' + i.id + '">−</button>';
      h += '<button class="snum' + (q > 0 ? ' on' : '') + '" data-act="edit" data-id="' + i.id + '">' + q + '</button>';
      h += '<button class="sbtn" data-act="inc" data-id="' + i.id + '">＋</button></div></div>';
    });
    h += '</div>';
    return h;
  }

  function renderReceiveTab() {
    orderView = computeOpenOrders();
    var h = '<p class="note">発注ごとに並んでいます。届いた分だけ数量を入れて「入荷を登録」。分割で届いたら残りは次回に残ります。誤発注は「発注取消」。金額の入力は必須です。</p>';
    if (!orderView.length) { h += '<p class="empty">入荷待ちの発注はありません。発注タブで「発注する」と、ここに1件ずつ並びます。</p>'; return h; }
    orderView.forEach(function (o) {
      var dstr = o.isLegacy ? '以前の発注' : jshort(o.at);
      var summary = o.lines.map(function (l) { return esc(l.name) + '×' + l.ordered; }).join('、');
      var pickTot = o.lines.reduce(function (s, l) { return s + rGet(o.id, l); }, 0);
      h += '<div class="ordcard">';
      h += '<div class="ordhd"><span class="ordttl">' + dstr + ' ／ ' + catLabel(o.cat) + '</span><span class="ordsub">' + summary + '</span></div>';
      o.lines.forEach(function (l) {
        var q = rGet(o.id, l);
        h += '<div class="row"><div class="rinfo"><div class="rname">' + esc(l.name) + '</div>';
        h += '<div class="rmeta">発注' + l.ordered + (l.received ? '／入荷済' + l.received : '') + '・残' + l.remaining + ' → 今回 ' + q + '</div></div>';
        h += '<div class="stp"><button class="sbtn" data-act="rdec" data-oid="' + esc(o.id) + '" data-lid="' + esc(l.id) + '">−</button>';
        h += '<button class="snum' + (q > 0 ? ' on' : '') + '" data-act="redit" data-oid="' + esc(o.id) + '" data-lid="' + esc(l.id) + '">＋' + q + '</button>';
        h += '<button class="sbtn" data-act="rinc" data-oid="' + esc(o.id) + '" data-lid="' + esc(l.id) + '">＋</button></div></div>';
      });
      h += '<div class="ordbar"><span class="binfo">今回入荷 計 ＋' + pickTot + '</span><span class="sp"></span>';
      h += '<button class="b ghost" data-act="cxl" data-oid="' + esc(o.id) + '"' + (busy ? ' disabled' : '') + '>発注取消</button>';
      h += '<button class="b pri" data-act="rcv" data-oid="' + esc(o.id) + '"' + (pickTot && !busy ? '' : ' disabled') + '>入荷を登録</button></div>';
      h += '</div>';
    });
    return h;
  }

  function findOrder(oid) { for (var i = 0; i < orderView.length; i++) if (orderView[i].id === oid) return orderView[i]; return null; }
  function findLine(order, lid) { for (var i = 0; i < order.lines.length; i++) if (order.lines[i].id === lid) return order.lines[i]; return null; }

  // ---- イベント（委譲）
  document.getElementById('app').addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var act = el.getAttribute('data-act');
    if (act === 'mode') { setMode(el.getAttribute('data-mode')); return; }
    if (act === 'cat') { cat = el.getAttribute('data-cat'); render(); return; }
    if (act === 'share') { doShare(); return; }
    if (act === 'order') { doOrder(); return; }
    // 入荷タブ：発注バッチ操作
    if (act === 'rcv' || act === 'cxl') {
      var o = findOrder(el.getAttribute('data-oid')); if (!o) return;
      if (act === 'rcv') doReceiveOrder(o); else doCancelOrder(o); return;
    }
    if (act === 'rinc' || act === 'rdec' || act === 'redit') {
      var ord = findOrder(el.getAttribute('data-oid')); if (!ord) return;
      var line = findLine(ord, el.getAttribute('data-lid')); if (!line) return;
      var cur = rGet(ord.id, line);
      if (act === 'rinc') rSet(ord.id, line, cur + 1);
      else if (act === 'rdec') rSet(ord.id, line, cur - 1);
      else { var v = prompt('入荷数：' + line.name + '（残' + line.remaining + '）', String(cur)); if (v != null) { var n = parseInt(v, 10); if (!isNaN(n)) rSet(ord.id, line, n); } }
      return;
    }
    // 発注タブ：商品ステッパー
    var id = el.getAttribute('data-id'); if (!id) return;
    var it = findItem(id); if (!it) return;
    if (act === 'inc') setQty(it, getQty(it) + step(it));
    else if (act === 'dec') setQty(it, getQty(it) - step(it));
    else if (act === 'edit') { var vv = prompt('発注数：' + it.name, String(getQty(it))); if (vv != null) { var nn = parseInt(vv, 10); if (!isNaN(nn)) setQty(it, nn); } }
  });

  // ---- パスワード → 復号（seedで即表示）→ 接続
  var f = document.getElementById('f'), err = document.getElementById('err'), btn = document.getElementById('btn');
  f.addEventListener('submit', async function (e) {
    e.preventDefault(); err.textContent = ''; btn.disabled = true; btn.textContent = '復号中…';
    var data;
    try { data = JSON.parse(await decrypt(document.getElementById('pw').value)); }
    catch (_) { err.textContent = 'パスワードが違います。'; btn.disabled = false; btn.textContent = '開く'; document.getElementById('pw').select(); return; }
    (data.items || []).forEach(function (i) { seedById[i.id] = i; });
    document.getElementById('gate').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    refresh();
    try { await boot(data.cfg || {}); }
    catch (_) { toast('接続できませんでした（通信状況をご確認ください）。一覧は前回データです。'); }
  });
})();
