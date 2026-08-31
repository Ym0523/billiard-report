/*
 * 要発注リストのライブ版クライアント（Firestore直結・ハイブリッド）。
 *  流れ: 要発注リスト → 発注済にする（発注済みリスト＝入荷待ち）→ 入荷登録。
 *
 *  データの持ち方（ハイブリッド）:
 *   ・seed = 前夜バックアップ由来のマスタ（商品名/カテゴリ/発注点/ロット/在庫）。ページに暗号化埋め込み。
 *     → Firestore の items にマスタが無くても名前・カテゴリが出る。初回から動く。
 *   ・live = Firestore の items をリアルタイム購読。stock ミラー・onOrder を最新化。
 *   ・表示は id で seed に live を上書きマージ（stock/onOrder/発注点は live 優先、名前/カテゴリは seed 優先）。
 *
 *  在庫の"正"はアプリ側の stockMoves fold。ここは:
 *    発注 = onOrder を increment 加算
 *    入荷 = receive イベント(stockMoves)を1件追記 ＋ onOrder 減算 ＋ stock ミラー更新
 *  を書き戻す。書いた分はアプリ（items/stockMoves 購読）と翌朝の再ビルドに反映される。
 *  パスワードは埋め込みペイロード(cfg＋seed)の復号キー。正しいときだけ接続する。
 */
(function () {
  var ENC = JSON.parse(document.getElementById('cfg').textContent); // 暗号化ペイロード {salt,iv,ct,iter}
  var FB = 'https://www.gstatic.com/firebasejs/10.12.2/';

  var b64d = function (s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  async function decrypt(pw) {
    var key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    var k = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64d(ENC.salt), iterations: ENC.iter, hash: 'SHA-256' }, key, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(ENC.iv) }, k, b64d(ENC.ct));
    return new TextDecoder().decode(pt);
  }

  var CATS = [['drink', 'ドリンク'], ['tobacco', 'たばこ'], ['snack', 'お菓子'], ['ramen', 'ラーメン'], ['goods', '備品'], ['other', 'その他']];
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var N = function (v) { return v == null ? 0 : (Number(v) || 0); };
  function suggest(i) {
    var stock = N(i.stock), on = N(i.onOrder), rp = N(i.reorderPoint);
    var short = Math.max(0, rp - (stock + on));
    if (short === 0) return 0;
    var lot = N(i.orderLot);
    return lot > 0 ? Math.max(1, Math.ceil(short / lot)) * lot : Math.max(1, short);
  }
  function isNeed(i) { return i.active !== false && i.stock != null && i.reorderPoint != null && Number(i.stock) < Number(i.reorderPoint); }
  function isWait(i) { return N(i.onOrder) > 0; }
  var uuid = function () { return crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2)); };

  // ---- state
  var db = null, store = 'store-a', fns = null;
  var seedById = {};    // 埋め込みマスタ（id -> item）
  var liveById = {};    // Firestore ライブ（id -> item）
  var items = [];       // マージ後の表示用
  var mode = 'order';   // 'order' | 'receive'
  var qtyO = {}, qtyR = {};
  var cat = null; // 選択中カテゴリ（発注・入荷はこのカテゴリだけを対象にする）
  var busy = false;

  function mergeItems() {
    var ids = {};
    Object.keys(seedById).forEach(function (id) { ids[id] = 1; });
    Object.keys(liveById).forEach(function (id) { ids[id] = 1; });
    var out = [];
    Object.keys(ids).forEach(function (id) {
      var s = seedById[id] || {}, l = liveById[id] || {};
      var pick = function (k) { return l[k] != null ? l[k] : (s[k] != null ? s[k] : null); };
      var name = (s.name != null ? s.name : l.name);   // 名前・カテゴリは seed 優先（liveに無いことがある）
      var catv = (s.cat != null ? s.cat : l.cat);
      if (name == null || catv == null) return;        // 表示に必要な情報が無いものは出さない
      out.push({
        id: id, name: name, cat: catv, code: (s.code != null ? s.code : l.code),
        active: (l.active === false ? false : true),
        reorderPoint: pick('reorderPoint'),
        orderLot: pick('orderLot'),
        stock: pick('stock'),
        onOrder: (l.onOrder != null ? l.onOrder : (s.onOrder != null ? s.onOrder : 0)),
      });
    });
    return out;
  }
  function refresh() { items = mergeItems(); render(); }

  function curMap() { return mode === 'order' ? qtyO : qtyR; }
  function defQty(i) { return mode === 'order' ? suggest(i) : N(i.onOrder); }
  function getQty(i) { var m = curMap(); return (i.id in m) ? m[i.id] : defQty(i); }
  function setQty(i, v) { curMap()[i.id] = Math.max(0, v | 0); render(); }
  function step(i) { return mode === 'order' ? (N(i.orderLot) || 1) : 1; }
  function setMode(m) { mode = m; if (m === 'order') qtyO = {}; else qtyR = {}; ensureCat(); render(); }
  // このモードの対象商品（カテゴリ絞り込み前）。発注＝要発注、入荷＝入荷待ち。
  function modeBase() { return mode === 'order' ? items.filter(function (i) { return isNeed(i) && suggest(i) > 0; }) : items.filter(isWait); }
  // 対象がある（＝タブに出す）カテゴリ一覧。
  function presentCats() { return CATS.filter(function (c) { return modeBase().some(function (i) { return i.cat === c[0]; }); }); }
  // 選択中カテゴリを常に有効な値に保つ（無ければ先頭カテゴリ）。カテゴリ別に発注・入荷するため「すべて」は持たない。
  function ensureCat() { var p = presentCats().map(function (c) { return c[0]; }); if (cat == null || p.indexOf(cat) < 0) cat = p.length ? p[0] : null; }
  // 発注・入荷・共有の対象は「選択中カテゴリだけ」。他カテゴリの数量は混ざらない。
  function baseList() { return modeBase().filter(function (i) { return i.cat === cat; }); }

  function toast(msg) {
    var t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.className = 'show';
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.className = ''; }, 2800);
  }

  // ---- 接続（パスワードOK後・seed は既に表示済み）
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
          onOrder: (v.onOrder == null ? null : Number(v.onOrder)),
        };
      });
      liveById = map;
      refresh();
    }, function (e) { toast('接続エラー: ' + (e && e.message || e)); });
  }

  // ---- 発注済にする（onOrder 加算）
  async function doOrder() {
    if (busy) return;
    if (!fns) { toast('接続中です。少し待ってからお試しください。'); return; }
    var picked = baseList().filter(function (i) { return getQty(i) > 0; });
    if (!picked.length) return;
    if (!confirm(picked.length + '品を発注済（入荷待ち）にします。よろしいですか？')) return;
    busy = true; render();
    try {
      var batch = fns.writeBatch(db); var now = Date.now();
      picked.forEach(function (i) {
        batch.set(fns.doc(db, 'stores', store, 'items', i.id), { onOrder: fns.increment(getQty(i)), onOrderAt: now }, { merge: true });
      });
      await batch.commit();
      qtyO = {};
      toast('発注済にしました（' + picked.length + '品）');
      busy = false; setMode('receive');
      return;
    } catch (e) { toast('保存に失敗しました: ' + (e && e.message || e)); }
    busy = false; render();
  }

  // ---- 入荷を登録（receive イベント追記 ＋ onOrder 減算 ＋ stock ミラー更新）
  async function doReceive() {
    if (busy) return;
    if (!fns) { toast('接続中です。少し待ってからお試しください。'); return; }
    var picked = baseList().filter(function (i) { return getQty(i) > 0; });
    if (!picked.length) return;
    var tot = picked.reduce(function (s, i) { return s + getQty(i); }, 0);
    if (!confirm('入荷を登録します（' + picked.length + '品・計 ＋' + tot + '）。在庫に反映し、入荷待ちを減らします。')) return;
    busy = true; render();
    try {
      var batch = fns.writeBatch(db); var now = Date.now();
      picked.forEach(function (i) {
        var q = getQty(i); var after = N(i.stock) + q; var mid = 'web:' + uuid();
        // 在庫の動き（アプリと同じ形式・moveId で冪等）。アプリが取り込んで fold し在庫を確定する。
        batch.set(fns.doc(db, 'stores', store, 'stockMoves', mid),
          { id: mid, productId: i.id, name: i.name || '', kind: 'receive', delta: q, after: after, at: now, reason: '入荷（Web）' });
        // マスタ側：入荷待ちを受け取った分だけ減らし、在庫ミラーも即時更新（アプリが再fold時に同値へ収束）。
        batch.set(fns.doc(db, 'stores', store, 'items', i.id),
          { onOrder: Math.max(0, N(i.onOrder) - q), onOrderAt: now, stock: after, stockAt: now }, { merge: true });
      });
      await batch.commit();
      qtyR = {};
      toast('入荷を登録しました（' + picked.length + '品）');
    } catch (e) { toast('保存に失敗しました: ' + (e && e.message || e)); }
    busy = false; render();
  }

  // ---- 発注リストを共有
  function doShare() {
    var base = baseList();
    var lines = ['【発注リスト】'];
    CATS.forEach(function (c) {
      var rows = base.filter(function (i) { return i.cat === c[0] && getQty(i) > 0; });
      if (!rows.length) return;
      lines.push('', '■ ' + c[1]);
      rows.forEach(function (i) { lines.push('・' + (i.code ? i.code + ' ' : '') + i.name + ' ×' + getQty(i) + '（残' + N(i.stock) + '／発注点' + (i.reorderPoint == null ? '-' : i.reorderPoint) + '）'); });
    });
    if (lines.length === 1) { toast('対象の商品がありません'); return; }
    var text = lines.join('\n');
    if (navigator.share) { navigator.share({ text: text }).catch(function () { }); }
    else if (navigator.clipboard) { navigator.clipboard.writeText(text).then(function () { toast('発注リストをコピーしました'); }, function () { toast('コピーできませんでした'); }); }
    else { toast('共有に非対応の端末です'); }
  }

  // ---- 描画
  function render() {
    var app = document.getElementById('app'); if (!app || app.style.display === 'none') return;
    ensureCat();
    var needCnt = items.filter(isNeed).length;
    var waitTot = items.filter(isWait).reduce(function (s, i) { return s + N(i.onOrder); }, 0);
    var present = presentCats();
    var base = baseList();
    var picked = base.filter(function (i) { return getQty(i) > 0; });
    var totUnits = picked.reduce(function (s, i) { return s + getQty(i); }, 0);
    var connected = !!fns;

    var h = '';
    h += '<div class="wrap">';
    h += '<header class="hd"><div class="eyebrow">在庫 ／ 発注</div><h1>要発注リスト</h1>';
    h += '<div class="stat"><div class="s"><b>' + needCnt + '</b><span>要発注</span></div><div class="s"><b>' + waitTot + '</b><span>入荷待ち(個)</span></div></div>';
    h += '<div class="live"><span class="dot' + (connected ? '' : ' off') + '"></span>' + (connected ? 'リアルタイム接続中 — この場で発注・入荷できます' : '接続中…（一覧は前回データ）') + '</div></header>';

    h += '<div class="mtabs">';
    h += '<button class="mtab' + (mode === 'order' ? ' on' : '') + '" data-act="mode" data-mode="order">① 発注（要発注）</button>';
    h += '<button class="mtab' + (mode === 'receive' ? ' on' : '') + '" data-act="mode" data-mode="receive">② 入荷（入荷待ち）</button>';
    h += '</div>';

    h += '<p class="note">' + (mode === 'order'
      ? '在庫が発注点を割った商品です。数量を確認し、発注したら「発注済にする」を押してください。'
      : '発注済（入荷待ち）の商品です。届いた数に直して「入荷を登録」を押すと在庫に反映されます。') + '</p>';

    if (present.length > 1) {
      h += '<div class="chips">';
      present.forEach(function (c) { h += '<button class="chip' + (cat === c[0] ? ' on' : '') + '" data-act="cat" data-cat="' + c[0] + '">' + c[1] + '</button>'; });
      h += '</div>';
    }

    if (!base.length) {
      h += '<p class="empty">' + (mode === 'order'
        ? 'いま要発注の商品はありません。'
        : '入荷待ちの商品はありません。発注タブで「発注済にする」と、ここに出ます。') + '</p>';
    }

    var shownCats = present.filter(function (c) { return c[0] === cat; });
    shownCats.forEach(function (c) {
      var rows = base.filter(function (i) { return i.cat === c[0]; });
      if (!rows.length) return;
      if (mode === 'order') rows.sort(function (a, b) { return (N(b.reorderPoint) - N(b.stock)) - (N(a.reorderPoint) - N(a.stock)); });
      h += '<div class="grp"><div class="glabel">' + c[1] + ' ' + rows.length + '品</div>';
      rows.forEach(function (i) {
        var q = getQty(i); var stock = N(i.stock);
        h += '<div class="row"><div class="rinfo"><div class="rname">' + (i.code ? esc(i.code) + ' ' : '') + esc(i.name) + '</div>';
        h += '<div class="rmeta"><span class="' + (stock <= 0 ? 'zero' : 'low') + '">残' + stock + '</span> ／発注点' + (i.reorderPoint == null ? '-' : i.reorderPoint);
        if (mode === 'order') { h += (N(i.onOrder) ? ' 発注中' + N(i.onOrder) : '') + ' → 発注 ×' + q; }
        else { h += ' 入荷待ち' + N(i.onOrder) + ' → 入荷後 残' + (stock + q); }
        h += '</div></div>';
        h += '<div class="stp"><button class="sbtn" data-act="dec" data-id="' + i.id + '">−</button>';
        h += '<button class="snum' + (q > 0 ? ' on' : '') + '" data-act="edit" data-id="' + i.id + '">' + (mode === 'order' ? '' : '＋') + q + '</button>';
        h += '<button class="sbtn" data-act="inc" data-id="' + i.id + '">＋</button></div>';
        h += '</div>';
      });
      h += '</div>';
    });

    h += '</div>'; // .wrap

    h += '<div class="bar">';
    if (mode === 'order') {
      h += '<span class="binfo">発注 ' + picked.length + '品・計 ' + totUnits + '</span><span class="sp"></span>';
      h += '<button class="b ghost" data-act="share"' + (picked.length ? '' : ' disabled') + '>共有</button>';
      h += '<button class="b pri" data-act="order"' + (picked.length && !busy ? '' : ' disabled') + '>' + (busy ? '…' : '発注済にする') + '</button>';
    } else {
      h += '<span class="binfo">入荷 ' + picked.length + '品・計 ＋' + totUnits + '</span><span class="sp"></span>';
      h += '<button class="b pri" data-act="receive"' + (picked.length && !busy ? '' : ' disabled') + '>' + (busy ? '…' : '入荷を登録') + '</button>';
    }
    h += '</div>';

    app.innerHTML = h;
  }

  // ---- イベント（委譲）
  document.getElementById('app').addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var act = el.getAttribute('data-act');
    if (act === 'mode') { setMode(el.getAttribute('data-mode')); return; }
    if (act === 'cat') { cat = el.getAttribute('data-cat'); render(); return; }
    if (act === 'share') { doShare(); return; }
    if (act === 'order') { doOrder(); return; }
    if (act === 'receive') { doReceive(); return; }
    var id = el.getAttribute('data-id'); if (!id) return;
    var i = items.find(function (x) { return x.id === id; }); if (!i) return;
    if (act === 'inc') { setQty(i, getQty(i) + step(i)); }
    else if (act === 'dec') { setQty(i, getQty(i) - step(i)); }
    else if (act === 'edit') {
      var v = prompt((mode === 'order' ? '発注数' : '入荷数') + '：' + i.name, String(getQty(i)));
      if (v != null) { var n = parseInt(v, 10); if (!isNaN(n)) setQty(i, n); }
    }
  });

  // ---- パスワード → 復号（seedで即表示）→ 接続（liveで最新化）
  var f = document.getElementById('f'), err = document.getElementById('err'), btn = document.getElementById('btn');
  f.addEventListener('submit', async function (e) {
    e.preventDefault(); err.textContent = ''; btn.disabled = true; btn.textContent = '復号中…';
    var data;
    try { data = JSON.parse(await decrypt(document.getElementById('pw').value)); }
    catch (_) { err.textContent = 'パスワードが違います。'; btn.disabled = false; btn.textContent = '開く'; document.getElementById('pw').select(); return; }
    // seed を先に表示（接続前でも一覧が見える）
    (data.items || []).forEach(function (i) { seedById[i.id] = i; });
    document.getElementById('gate').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    refresh();
    try { await boot(data.cfg || {}); }
    catch (_) { toast('接続できませんでした（通信状況をご確認ください）。一覧は前回データです。'); }
  });
})();
