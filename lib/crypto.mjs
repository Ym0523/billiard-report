// パスワードでレポート本文(HTML)をAES-GCM暗号化し、パスワード入力→ブラウザ内で復号する
// 単一HTMLを生成する。平文は一切コミットされない（公開リポでも中身はパスワード無しでは復元不可）。
// 鍵導出: PBKDF2(SHA-256) / 暗号: AES-GCM 256。Node と ブラウザで同一パラメータ。
import { webcrypto as wc } from 'node:crypto';

const ITER = 210000;
const b64 = (buf) => Buffer.from(buf).toString('base64');

export async function encrypt(plaintext, password) {
  const enc = new TextEncoder();
  const salt = wc.getRandomValues(new Uint8Array(16));
  const iv = wc.getRandomValues(new Uint8Array(12));
  const baseKey = await wc.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await wc.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = await wc.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { salt: b64(salt), iv: b64(iv), ct: b64(ct), iter: ITER };
}

// 外側ページ（ログイン＋復号）。reportCss は平文で埋め込む（機微情報を含まない）。
export function pageTemplate({ payload, reportCss, title = 'ビリヤードPOS 売上分析レポート', hint = '' }) {
  const P = JSON.stringify(payload);
  return `<!doctype html><html lang="ja"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${title}</title>
<style>
*{box-sizing:border-box}
:root{--bg:#f4f6f8;--surface:#fff;--ink:#1b2733;--ink2:#516072;--ink3:#8493a3;--line:#e6ebf0;--accent:#1f5fa8;}
@media(prefers-color-scheme:dark){:root{--bg:#0f151b;--surface:#161f28;--ink:#e8eef4;--ink2:#a9b7c4;--ink3:#6f8091;--line:#25313d;--accent:#5aa0e8;}}
html,body{margin:0;background:var(--bg);color:var(--ink);font-family:'Segoe UI','Hiragino Kaku Gothic ProN','Meiryo',system-ui,sans-serif;}
.gate{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}
.box{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:28px;max-width:360px;width:100%;box-shadow:0 8px 30px rgba(0,0,0,.06);}
.box h1{font-size:18px;margin:0 0 4px;}
.box p{color:var(--ink3);font-size:13px;margin:0 0 18px;line-height:1.5;}
.box label{font-size:12px;font-weight:700;color:var(--ink2);}
.box input{width:100%;margin-top:6px;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);font-size:15px;}
.box button{width:100%;margin-top:14px;padding:11px;border:0;border-radius:10px;background:var(--accent);color:#fff;font-size:15px;font-weight:700;cursor:pointer;}
.box button:disabled{opacity:.6;cursor:default;}
.err{color:#c0392b;font-size:13px;margin-top:10px;min-height:18px;font-weight:600;}
.rememberrow{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px;font-weight:600;color:var(--ink2);cursor:pointer;}
.rememberrow input{width:auto;margin:0;}
${reportCss}
</style></head>
<body>
<div id="gate" class="gate"><form class="box" id="f">
  <h1>🔒 売上分析レポート</h1>
  <p>${hint || 'パスワードを入力してください。内容は端末内で復号されます。'}</p>
  <label for="pw">パスワード</label>
  <input id="pw" type="password" autocomplete="current-password" autofocus>
  <label class="rememberrow"><input id="remember" type="checkbox"> この端末にパスワードを保存</label>
  <button id="btn" type="submit">開く</button>
  <div class="err" id="err"></div>
</form></div>
<div id="app" style="display:none"></div>
<script>
const P=${P};
const b64d=(s)=>{const b=atob(s),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u;};
async function decrypt(pw){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveKey']);
  const k=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b64d(P.salt),iterations:P.iter,hash:'SHA-256'},key,{name:'AES-GCM',length:256},false,['decrypt']);
  const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64d(P.iv)},k,b64d(P.ct));
  return new TextDecoder().decode(pt);
}
const PWKEY='billiardReportPw';
const f=document.getElementById('f'),err=document.getElementById('err'),btn=document.getElementById('btn'),rem=document.getElementById('remember');
function reveal(html){
  document.getElementById('app').innerHTML=html;
  document.getElementById('gate').style.display='none';
  document.getElementById('app').style.display='block';
  document.title=${JSON.stringify(title)};
  // 年度／月次モード＋期間の配線（暗号化本文は静的なので復号後にここで付ける）。
  function showScope(key){ document.querySelectorAll('.scopepane').forEach(function(p){ p.hidden=(p.getAttribute('data-scope')!==key); }); }
  document.querySelectorAll('.selrow').forEach(function(row){
    row.addEventListener('click',function(ev){ var b=ev.target.closest('.scopebtn'); if(!b) return;
      row.querySelectorAll('.scopebtn').forEach(function(x){ x.classList.toggle('active',x===b); });
      showScope(b.getAttribute('data-scope'));
    });
  });
  var modetabs=document.querySelector('.modetabs');
  if(modetabs){ modetabs.addEventListener('click',function(ev){ var b=ev.target.closest('.modebtn'); if(!b) return;
    var mode=b.getAttribute('data-mode');
    modetabs.querySelectorAll('.modebtn').forEach(function(x){ x.classList.toggle('active',x===b); });
    document.querySelectorAll('.selrow').forEach(function(r){ r.hidden=(r.getAttribute('data-mode')!==mode); });
    var srow=document.querySelector('.selrow[data-mode="'+mode+'"]');
    var act=srow.querySelector('.scopebtn.active')||srow.querySelector('.scopebtn');
    showScope(act.getAttribute('data-scope'));
  }); }
  // 日別の売上：日付行タップでその日の内訳を開閉。
  var appEl=document.getElementById('app');
  appEl.addEventListener('click',function(ev){
    var row=ev.target.closest('.dayrow'); if(!row) return;
    var date=row.getAttribute('data-date');
    var det=appEl.querySelector('.daydetail[data-detail="'+date+'"]');
    if(det){ det.hidden=!det.hidden; var ex=row.querySelector('.expand'); if(ex) ex.textContent=det.hidden?'＋':'−'; }
  });
  // 棚卸レポート（在庫）を組み立てる。
  try{ buildStock(appEl); }catch(e){}
}
function esc2(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function jday(ms){var d=new Date(Number(ms)+9*3600000);var p=function(n){return String(n).padStart(2,'0');};return d.getUTCFullYear()+'-'+p(d.getUTCMonth()+1)+'-'+p(d.getUTCDate());}
function buildStock(root){
  var el=(root&&root.querySelector('#stockdata'))||document.getElementById('stockdata');
  var pane=(root&&root.querySelector('#stockpane'))||document.getElementById('stockpane');
  if(!el||!pane) return;
  var S; try{ S=JSON.parse(el.textContent||'{}'); }catch(_){ pane.innerHTML='<div class="note">在庫データを読めませんでした。</div>'; return; }
  var prods={}; (S.prods||[]).forEach(function(p){ prods[p.id]=p; });
  var mv=S.mv||{}, DAYS=S.days||180;
  // 商品ごとの棚卸し履歴（mvから抽出・昇順）。棚卸日は商品ごとに異なる。
  var stkMap={}, pidsWithStk=[], maxLen=0;
  (S.prods||[]).forEach(function(p){
    var st=[]; (mv[p.id]||[]).forEach(function(r){ if(r[1]==='stocktake') st.push([jday(r[0]), r[3], r[2]]); }); // [date, 実数(after), ズレ(delta=実数-あるべき)]
    if(st.length){ stkMap[p.id]=st; pidsWithStk.push(p.id); if(st.length>maxLen) maxLen=st.length; }
  });
  var k=0, openPid=null; // k=0: 各商品の最新の棚卸し。k を増やすと全商品が1つ前へ。
  var CATO=['drink','snack','ramen','goods','other','tobacco'];
  function catRank(c){ var i=CATO.indexOf(c); return i<0?9:i; }
  function sortPids(pids){ return pids.slice().sort(function(a,b){ var pa=prods[a]||{},pb=prods[b]||{}; var d=catRank(pa.cat)-catRank(pb.cat); if(d) return d; if(pa.cat==='tobacco'&&pb.cat==='tobacco'){ var na=parseInt(pa.code,10)||1e9,nb=parseInt(pb.code,10)||1e9; if(na!==nb) return na-nb; } return String(pa.name||'').localeCompare(String(pb.name||''),'ja'); }); }
  function dailyTable(pid){
    var rows=(mv[pid]||[]), byDay={}, order=[];
    rows.forEach(function(r){ var d=jday(r[0]); if(!byDay[d]){ byDay[d]={sale:0,recv:0,adj:0,stk:null,close:null}; order.push(d);} var o=byDay[d],kd=r[1],delta=r[2],after=r[3];
      if(kd==='sale'||kd==='void') o.sale+=delta; else if(kd==='receive') o.recv+=delta; else if(kd==='stocktake') o.stk=after; else o.adj+=delta; o.close=after; });
    if(!order.length) return '<div class="note">この商品の在庫の動き（直近'+DAYS+'日）はありません。</div>';
    order.sort(); order.reverse();
    var body=order.map(function(d){ var o=byDay[d]; var sa=(o.stk!=null?('='+o.stk):'')+(o.adj?((o.stk!=null?' ':'')+(o.adj>0?'+':'')+o.adj):'');
      return '<tr><td>'+d.slice(5).replace('-','/')+'</td><td class="n">'+(o.sale?o.sale:'')+'</td><td class="n">'+(o.recv?('+'+o.recv):'')+'</td><td class="n">'+sa+'</td><td class="n em">'+(o.close==null?'':o.close)+'</td></tr>'; }).join('');
    return '<div class="tblscroll"><table class="tbl stktbl"><thead><tr><th>日付</th><th class="n">販売</th><th class="n">入荷</th><th class="n">棚卸/調整</th><th class="n">在庫</th></tr></thead><tbody>'+body+'</tbody></table></div>';
  }
  function cell(v,dstr){ return v==null?'—':(v+' <span class="d">'+String(dstr).slice(5).replace('-','/')+'</span>'); }
  function render(){
    if(!pidsWithStk.length){ pane.innerHTML='<section class="card"><div class="sh"><h2>棚卸レポート</h2></div><div class="note">棚卸しの記録（直近'+DAYS+'日）がありません。在庫端末で棚卸しすると、商品ごとの前回／今回が出ます。</div></section>'; return; }
    var pids=sortPids(pidsWithStk);
    var label=(k===0)?'各商品の最新の棚卸し':('最新から '+k+' つ前');
    var nav='<div class="stknav"><button type="button" data-stk="prev"'+(k>=maxLen-1?' disabled':'')+'>◀ 前回</button><span class="stklabel">'+label+'</span><button type="button" data-stk="next"'+(k<=0?' disabled':'')+'>次回 ▶</button></div>';
    var head='<tr><th>商品名</th><th class="n">今回（棚卸日）</th><th class="n">あるべき数</th><th class="n">ズレ</th></tr>';
    var body=pids.map(function(pid){
      var st=stkMap[pid]||[]; var ci=st.length-1-k;
      if(ci<0) return ''; // この段階に棚卸しが無い商品は表示しない
      var cur=st[ci]; var counted=cur[1], zure=cur[2], expect=counted-zure;
      var p=prods[pid]||{name:pid};
      var zt=zure>0?'<span class="up">+'+zure+'</span>':(zure<0?'<span class="down">'+zure+'</span>':'±0');
      var nm=(p.cat==='tobacco'&&p.code?(p.code+' '):'')+(p.name||pid);
      var main='<tr class="prodrow" data-pid="'+esc2(pid)+'"><td>'+esc2(nm)+' <span class="expand">'+(openPid===pid?'−':'＋')+'</span></td><td class="n">'+cell(counted, cur[0])+'</td><td class="n">'+expect+'</td><td class="n">'+zt+'</td></tr>';
      var det=openPid===pid?('<tr class="pdetail"><td colspan="4">'+dailyTable(pid)+'</td></tr>'):'';
      return main+det; }).join('');
    pane.innerHTML='<section class="card"><div class="sh"><h2>棚卸レポート</h2><span class="ssub">棚卸しの実数と「あるべき数（理論在庫）」のズレ（棚卸日は商品ごとに異なります）。＋＝実数が多い／−＝足りない。商品名タップで日次の在庫変動・直近'+DAYS+'日</span></div>'+nav+'<div class="tblscroll"><table class="tbl stktbl"><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div></section>';
  }
  pane.addEventListener('click',function(ev){
    var nb=ev.target.closest('[data-stk]');
    if(nb){ var dir=nb.getAttribute('data-stk'); if(dir==='prev'&&k<maxLen-1) k++; else if(dir==='next'&&k>0) k--; openPid=null; render(); return; }
    var pr=ev.target.closest('.prodrow'); if(pr){ var pid=pr.getAttribute('data-pid'); openPid=(openPid===pid)?null:pid; render(); }
  });
  render();
}
async function tryOpen(pw){ const html=await decrypt(pw); reveal(html); }
f.addEventListener('submit',async(e)=>{
  e.preventDefault();err.textContent='';btn.disabled=true;btn.textContent='復号中…';
  const pw=document.getElementById('pw').value;
  try{
    await tryOpen(pw);
    try{ if(rem&&rem.checked) localStorage.setItem(PWKEY,pw); else localStorage.removeItem(PWKEY); }catch(_){}
  }catch(_){
    err.textContent='パスワードが違います。';btn.disabled=false;btn.textContent='開く';
    document.getElementById('pw').select();
  }
});
// 端末に保存済みなら自動で開く（保存値が古い/誤りなら消してゲート表示）。
(function(){ try{ var saved=localStorage.getItem(PWKEY); if(saved){ var p=document.getElementById('pw'); p.value=saved; if(rem) rem.checked=true; tryOpen(saved).catch(function(){ try{localStorage.removeItem(PWKEY);}catch(_){}; p.value=''; }); } }catch(_){} })();
</script>
</body></html>`;
}
