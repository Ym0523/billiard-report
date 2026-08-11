// Firebase Web設定（公開情報・アプリと同一プロジェクト）。防壁は Firestore Security Rules。
// レポートは backups/latest を匿名認証で読むだけ（読取専用）。
export const firebaseConfig = {
  apiKey: 'AIzaSyCZD5xa7m838clUatcqo_kCrP8g6w3FSnU',
  authDomain: 'pool-pos.firebaseapp.com',
  projectId: 'pool-pos',
  storageBucket: 'pool-pos.firebasestorage.app',
  messagingSenderId: '873721564308',
  appId: '1:873721564308:web:589f931b5dcfbf79d83881',
};
export const STORE_ID = process.env.STORE_ID || 'store-a';
