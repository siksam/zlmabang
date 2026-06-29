/* =========================================================
   store.js — Firestore 기반 저장·구독 모듈 (누적 버전)

   데이터 구조:
     games (컬렉션)      → 경기마다 문서 1개 { rows:[4명], createdAt }
     config/players (문서) → { list:["아이디", ...] }  (관리자 관리용)

   "저장하기"를 누르면 games 컬렉션에 새 문서가 추가됩니다(덮어쓰지 않음).
   점수판은 모든 경기를 합산해 누적 순위를 보여줍니다.
   ========================================================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, doc, getDoc,
  onSnapshot, query, orderBy, serverTimestamp
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

// 아이디 후보 기본값 (config/players 문서가 없을 때 사용)
const DEFAULT_PLAYERS = ['홍길동', '김영희', '이철수', '박민수'];

// 관리자 비밀번호
// ⚠️ 이 값은 코드에 들어가므로 "약한 잠금장치"입니다(누구나 코드를 열면 볼 수 있음).
//    제대로 된 보안이 필요해지면 추후 Firebase 인증(Auth) + 규칙으로 바꿉니다.
const ADMIN_PASSWORD = 'zlmabang';
export function checkAdminPassword(pw) {
  return pw === ADMIN_PASSWORD;
}

const gamesCol   = collection(db, 'games');
const playersRef = doc(db, 'config', 'players');

export function emptyRows() {
  return SEATS.map(s => ({ pos: s.pos, id: '', score: null }));
}

/* ---------- 경기(점수) ---------- */

// 새 경기 추가 (누적)
export async function addGame(rows) {
  await addDoc(gamesCol, { rows, createdAt: serverTimestamp() });
}

// 모든 경기 실시간 구독 (최신순)
export function onGames(callback) {
  const q = query(gamesCol, orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => {
    const games = [];
    snap.forEach(d => {
      const data = d.data();
      games.push({
        id: d.id,
        rows: Array.isArray(data.rows) ? data.rows : [],
        createdAt: data.createdAt || null,
      });
    });
    callback(games);
  }, (err) => {
    console.error('경기 구독 오류:', err);
    callback([]);
  });
}

/* ---------- 누적 순위 집계 ---------- */
// 모든 경기를 아이디별로 합산: { id, total(총점), count(국수), rank(순위) }
export function computeStandings(games) {
  const map = new Map();
  for (const g of games) {
    for (const r of g.rows) {
      const id = (r.id || '').trim();
      const score = (r.score === null || r.score === '') ? null : Number(r.score);
      if (!id || score === null || Number.isNaN(score)) continue;
      if (!map.has(id)) map.set(id, { id, total: 0, count: 0 });
      const e = map.get(id);
      e.total += score;
      e.count += 1;
    }
  }
  const arr = [...map.values()].sort((a, b) => b.total - a.total);
  arr.forEach((e, i) => {
    e.rank = (i > 0 && arr[i - 1].total === e.total) ? arr[i - 1].rank : i + 1;
  });
  return arr;
}

// 한 경기 내 순위 (점수 desc, 동점 같은 등수) — 기록확인 페이지용
export function rankWithinGame(rows) {
  const scored = rows.filter(r => r.score !== null && r.score !== '');
  const sorted = [...scored].sort((a, b) => Number(b.score) - Number(a.score));
  const map = new Map();
  sorted.forEach((r, i) => {
    map.set(r, (i > 0 && Number(sorted[i - 1].score) === Number(r.score))
      ? map.get(sorted[i - 1]) : i + 1);
  });
  return map;
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
