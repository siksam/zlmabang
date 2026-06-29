/* =========================================================
   firebase-config.js
   Firebase 콘솔에서 받은 연결 정보입니다.
   (이 값들은 공개돼도 되는 값 — 실제 보안은 Firestore "규칙"으로 겁니다)

   ※ import / initializeApp 같은 초기화는 store.js가 합니다.
     이 파일은 "어느 프로젝트에 연결할지"만 알려주는 역할이에요.
   ========================================================= */
export const firebaseConfig = {
  apiKey: "AIzaSyA_fo9SEOsei2t724mue7SDF4Mt_ELH6_0",
  authDomain: "zlmabang.firebaseapp.com",
  projectId: "zlmabang",
  storageBucket: "zlmabang.firebasestorage.app",
  messagingSenderId: "1019967119204",
  appId: "1:1019967119204:web:ff62f237eca8fca08de471"
};
