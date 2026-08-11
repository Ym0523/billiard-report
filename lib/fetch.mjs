// Firestore の backups/latest（クラウド自動バックアップ）を匿名認証で取得し、store を返す。
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { firebaseConfig, STORE_ID } from '../firebase.config.mjs';

export async function fetchStore() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  await signInAnonymously(auth);
  const db = getFirestore(app);
  const snap = await getDoc(doc(db, 'stores', STORE_ID, 'backups', 'latest'));
  if (!snap.exists()) throw new Error('backups/latest が見つかりません（まだクラウドバックアップされていません）。');
  const d = snap.data();
  const parsed = JSON.parse(String(d.data || '{}'));
  return { store: parsed.store || {}, exportedAt: Number(d.exportedAt) || parsed.exportedAt || null };
}
