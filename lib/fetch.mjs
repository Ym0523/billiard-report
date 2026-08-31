// Firestore の backups/latest（クラウド自動バックアップ）を匿名認証で取得し、store を返す。
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { firebaseConfig, STORE_ID } from '../firebase.config.mjs';

export async function fetchStore() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  await signInAnonymously(auth);
  const db = getFirestore(app);
  const snap = await getDoc(doc(db, 'stores', STORE_ID, 'backups', 'latest'));
  if (!snap.exists()) throw new Error('backups/latest が見つかりません（まだクラウドバックアップされていません）。');
  const d = snap.data();
  // gzip圧縮(Bytes)なら解凍、旧形式(無圧縮の data 文字列)はそのまま。
  let dataStr;
  if (d.enc === 'gzip' && d.gz) {
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
