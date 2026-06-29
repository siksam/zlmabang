/* =========================================================
   store.js — Firestore(클라우드) 기반 저장·구독 모듈
   누군가 점수를 저장하면, 같은 화면을 보는 모든 사람에게
   실시간으로 자동 반영됩니다.

   Firestore 데이터 구조:
     boards/current  → { rows: [4명 점수], updatedAt }
     config/players  → { list: ["아이디", ...] }  (관리자 관리용)
   ========================================================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 좌석 순서: 동 → 남 → 서 → 북
export const SEATS = [
  { pos: '동', hanja: '東' },
  { pos: '남', hanja: '南' },
  { pos: '서', hanja: '西' },
  { pos: '북', hanja: '北' },
];

// 아이디 후보 기본값 (Firestore에 config/players 문서가 없을 때 사용)
const DEFAULT_PLAYERS = ['홍길동', '김영희', '이철수', '박민수'];

const boardRef   = doc(db, 'boards', 'current');
const playersRef = doc(db, 'config', 'players');

export function emptyRows() {
  return SEATS.map(s => ({ pos: s.pos, id: '', score: null }));
}

/* ---------- 점수 ---------- */

// 실시간 구독: 점수가 바뀔 때마다 callback(rows) 호출
export function onScores(callback) {
  return onSnapshot(boardRef, (snap) => {
    const data = snap.exists() ? snap.data() : null;
    callback(data && Array.isArray(data.rows) ? data.rows : emptyRows());
  }, (err) => {
    console.error('점수 구독 오류:', err);
    callback(emptyRows());
  });
}

// 한 번만 읽기 (입력 폼 초기값 채우기용)
export async function getScoresOnce() {
  const snap = await getDoc(boardRef);
  const data = snap.exists() ? snap.data() : null;
  return data && Array.isArray(data.rows) ? data.rows : emptyRows();
}

// 저장 (모든 사람 화면에 실시간 반영됨)
export async function saveScores(rows) {
  await setDoc(boardRef, { rows, updatedAt: serverTimestamp() });
}

/* ---------- 아이디 목록 (관리자 관리) ---------- */

export async function getPlayersOnce() {
  const snap = await getDoc(playersRef);
  const data = snap.exists() ? snap.data() : null;
  return data && Array.isArray(data.list) ? data.list : [...DEFAULT_PLAYERS];
}

export function onPlayers(callback) {
  return onSnapshot(playersRef, (snap) => {
    const data = snap.exists() ? snap.data() : null;
    callback(data && Array.isArray(data.list) ? data.list : [...DEFAULT_PLAYERS]);
  }, (err) => {
    console.error('아이디 구독 오류:', err);
    callback([...DEFAULT_PLAYERS]);
  });
}

/* ---------- 순위 계산 ---------- */
export function computeRanks(rows) {
  const scored = rows.filter(r => r.score !== null && r.score !== '');
  const sorted = [...scored].sort((a, b) => Number(b.score) - Number(a.score));
  const map = new Map();
  sorted.forEach((r, i) => {
    if (i > 0 && Number(sorted[i - 1].score) === Number(r.score)) {
      map.set(r, map.get(sorted[i - 1]));
    } else {
      map.set(r, i + 1);
    }
  });
  return map;
}
