// Firestore の backups/latest（クラウド自動バックアップ）を匿名認証で取得し、store を返す。
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, getDoc, collection, getDocs, writeBatch } from 'firebase/firestore';
import { firebaseConfig, STORE_ID } from '../firebase.config.mjs';

export async function fetchStore() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  await signInAnonymously(auth);
  const db = getFirestore(app);
  const snap = await getDoc(doc(db, 'stores', STORE_ID, 'backups', 'latest'));
  if (!snap.exists()) throw new Error('backups/latest が見つかりません（まだクラウドバックアップされていません）。');
  const d = snap.data();
  // バックアップ形式は3種を許容：
  //   enc='gzipb64' … gzip→base64文字列（現行アプリ）
  //   enc='gzip'    … gzip→Bytes（旧・一時版。RNでクラッシュしたが書き込み自体は成功しうる）
  //   （無し）       … 無圧縮の data 文字列（最初期）
  let dataStr;
  if (d.enc === 'gzipb64' && typeof d.data === 'string') {
    const { gunzipSync } = await import('node:zlib');
    dataStr = gunzipSync(Buffer.from(d.data, 'base64')).toString('utf8');
  } else if (d.enc === 'gzip' && d.gz) {
    const { gunzipSync } = await import('node:zlib');
    const u8 = typeof d.gz.toUint8Array === 'function' ? d.gz.toUint8Array() : d.gz;
    dataStr = gunzipSync(Buffer.from(u8)).toString('utf8');
  } else {
    dataStr = String(d.data || '{}');
  }
  const parsed = JSON.parse(dataStr);
  // 入荷金額（仕入）: Web入荷で記録された purchases コレクションを読む（無くてもエラーにしない）。
  let purchases = [];
  try {
    const ps = await getDocs(collection(db, 'stores', STORE_ID, 'purchases'));
    purchases = ps.docs.map((x) => x.data());
  } catch { /* purchases 未作成なら空 */ }
  return { store: parsed.store || {}, exportedAt: Number(d.exportedAt) || parsed.exportedAt || null, purchases };
}

/**
 * 商品別・直近30日の実売個数（会計基準）を Firestore の items.sold30 に保存する。
 * アプリ（レジ/在庫端末）はこの値を「直近30日の販売個数」として表示する＝売上レポートと一致し、
 * 端末間でも同じ値になる（各端末ローカルの stock_moves 依存をやめる）。merge で該当フィールドのみ更新。
 */
export async function writeSold30(map) {
  const app = initializeApp(firebaseConfig, 'sold30writer');
  await signInAnonymously(getAuth(app));
  const db = getFirestore(app);
  const ids = Object.keys(map);
  const at = Date.now();
  for (let i = 0; i < ids.length; i += 400) {
    const batch = writeBatch(db);
    for (const id of ids.slice(i, i + 400)) {
      batch.set(doc(db, 'stores', STORE_ID, 'items', id), { sold30: Math.round(map[id] || 0), sold30At: at }, { merge: true });
    }
    await batch.commit();
  }
  return ids.length;
}
