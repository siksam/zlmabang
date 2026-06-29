/* =========================================================
   store.js — Firestore 데이터 계층 (대회 관리 버전)

   구조:
     tournaments (컬렉션)   대회마다 문서 1개
        { name, rule:'team'|'individual', timed:bool, minutes:number|null,
          capacity:number(0=무제한), startDate:'YYYY-MM-DD', endDate:'YYYY-MM-DD',
          participants:[{id, team?}], createdAt }
     games (컬렉션)         경기마다 문서 1개
        { tournamentId, rows:[{pos,id,score}], createdAt }
     config/active (문서)   { tournamentId }  ← 현재 진행 중인 대회
   ========================================================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export const SEATS = [
  { pos: '동', hanja: '東' },
  { pos: '남', hanja: '南' },
  { pos: '서', hanja: '西' },
  { pos: '북', hanja: '北' },
];

// 관리자 비밀번호 (코드에 노출되는 약한 잠금장치)
const ADMIN_PASSWORD = 'zlmabang';
export function checkAdminPassword(pw) { return pw === ADMIN_PASSWORD; }

const tournamentsCol = collection(db, 'tournaments');
const gamesCol       = collection(db, 'games');
const activeRef      = doc(db, 'config', 'active');

export function emptyRows() {
  return SEATS.map(s => ({ pos: s.pos, id: '', score: null }));
}

/* ---------- 날짜 유틸 ---------- */
const z = n => String(n).padStart(2, '0');
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
export function addDaysStr(base, days) {
  const d = new Date(base + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
// 진행 중(날짜가 지나지 않음) = 종료일이 오늘 이후
export function isOngoing(t) { return t && t.endDate >= todayStr(); }

function tsMillis(ts) { return ts && ts.toMillis ? ts.toMillis() : Number.MAX_SAFE_INTEGER; }

/* ---------- 대회 ---------- */
export async function createTournament(data) {
  const ref = await addDoc(tournamentsCol, { ...data, createdAt: serverTimestamp() });
  return ref.id;
}
export function onTournaments(cb) {
  const q = query(tournamentsCol, orderBy('startDate', 'desc'));
  return onSnapshot(q, snap => {
    const list = []; snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    cb(list);
  }, err => { console.error('대회 구독 오류:', err); cb([]); });
}
export async function getTournament(id) {
  if (!id) return null;
  const snap = await getDoc(doc(db, 'tournaments', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
export async function updateTournament(id, patch) {
  await updateDoc(doc(db, 'tournaments', id), patch);
}
export async function updateParticipants(id, participants) {
  await updateDoc(doc(db, 'tournaments', id), { participants });
}
export async function deleteTournament(id) {
  const gsnap = await getDocs(query(gamesCol, where('tournamentId', '==', id)));
  const batch = writeBatch(db);
  gsnap.forEach(d => batch.delete(d.ref));
  batch.delete(doc(db, 'tournaments', id));
  await batch.commit();
  if (await getActiveTournamentId() === id) await setActiveTournament(null);
}

/* ---------- 진행 중인 대회 (active) ---------- */
export async function setActiveTournament(id) {
  await setDoc(activeRef, { tournamentId: id || null });
}
export async function getActiveTournamentId() {
  const snap = await getDoc(activeRef);
  return snap.exists() ? (snap.data().tournamentId || null) : null;
}
// 진행 대회 객체를 실시간으로 (선택이 바뀌면 다시 호출)
export function onActiveTournament(cb) {
  return onSnapshot(activeRef, async snap => {
    const tid = snap.exists() ? (snap.data().tournamentId || null) : null;
    cb(tid ? await getTournament(tid) : null);
  }, err => { console.error('진행대회 구독 오류:', err); cb(null); });
}

/* ---------- 경기(게임) ---------- */
export async function addGame(tournamentId, rows) {
  await addDoc(gamesCol, { tournamentId, rows, createdAt: serverTimestamp() });
}
export async function updateGame(gameId, rows) {
  await updateDoc(doc(db, 'games', gameId), { rows });
}
export async function deleteGame(gameId) {
  await deleteDoc(doc(db, 'games', gameId));
}
// 특정 대회의 경기들 실시간 (createdAt 내림차순은 JS에서 정렬 → 색인 불필요)
export function onGamesByTournament(tid, cb) {
  if (!tid) { cb([]); return () => {}; }
  const q = query(gamesCol, where('tournamentId', '==', tid));
  return onSnapshot(q, snap => {
    const games = [];
    snap.forEach(d => {
      const data = d.data();
      games.push({ id: d.id, rows: Array.isArray(data.rows) ? data.rows : [], createdAt: data.createdAt || null });
    });
    games.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
    cb(games);
  }, err => { console.error('경기 구독 오류:', err); cb([]); });
}
export async function getGamesByTournament(tid) {
  if (!tid) return [];
  const snap = await getDocs(query(gamesCol, where('tournamentId', '==', tid)));
  const games = [];
  snap.forEach(d => {
    const data = d.data();
    games.push({ id: d.id, rows: Array.isArray(data.rows) ? data.rows : [], createdAt: data.createdAt || null });
  });
  games.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
  return games;
}

/* ---------- 집계/순위 ---------- */
export function computeStandings(games) {
  const map = new Map();
  for (const g of games) {
    for (const r of g.rows) {
      const id = (r.id || '').trim();
      const score = (r.score === null || r.score === '') ? null : Number(r.score);
      if (!id || score === null || Number.isNaN(score)) continue;
      if (!map.has(id)) map.set(id, { id, total: 0, count: 0 });
      const e = map.get(id); e.total += score; e.count += 1;
    }
  }
  const arr = [...map.values()].sort((a, b) => b.total - a.total);
  arr.forEach((e, i) => { e.rank = (i > 0 && arr[i - 1].total === e.total) ? arr[i - 1].rank : i + 1; });
  return arr;
}
export function rankWithinGame(rows) {
  const scored = rows.filter(r => r.score !== null && r.score !== '');
  const sorted = [...scored].sort((a, b) => Number(b.score) - Number(a.score));
  const map = new Map();
  sorted.forEach((r, i) => {
    map.set(r, (i > 0 && Number(sorted[i - 1].score) === Number(r.score)) ? map.get(sorted[i - 1]) : i + 1);
  });
  return map;
}

/* ---------- 표시용 헬퍼 ---------- */
export function capacityLabel(c) { return (!c || c === 0) ? '무제한' : `${c}명`; }
export function ruleLabel(t) {
  const base = t.rule === 'team' ? '팀전' : '개인전';
  const time = t.timed ? `시간제 ${t.minutes || 0}분` : '시간제 없음';
  return `${base} · ${time}`;
}
