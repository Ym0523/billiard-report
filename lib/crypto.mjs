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
${reportCss}
</style></head>
<body>
<div id="gate" class="gate"><form class="box" id="f">
  <h1>🔒 売上分析レポート</h1>
  <p>${hint || 'パスワードを入力してください。内容は端末内で復号されます。'}</p>
  <label for="pw">パスワード</label>
  <input id="pw" type="password" autocomplete="current-password" autofocus>
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
const f=document.getElementById('f'),err=document.getElementById('err'),btn=document.getElementById('btn');
f.addEventListener('submit',async(e)=>{
  e.preventDefault();err.textContent='';btn.disabled=true;btn.textContent='復号中…';
  try{
    const html=await decrypt(document.getElementById('pw').value);
    document.getElementById('app').innerHTML=html;
    document.getElementById('gate').style.display='none';
    document.getElementById('app').style.display='block';
    document.title=${JSON.stringify(title)};
  }catch(_){
    err.textContent='パスワードが違います。';btn.disabled=false;btn.textContent='開く';
    document.getElementById('pw').select();
  }
});
</script>
</body></html>`;
}
