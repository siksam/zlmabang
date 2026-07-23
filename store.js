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
const SEAT_INDEX = { '동': 0, '남': 1, '서': 2, '북': 3 };

// 한 경기 순위: 점수 높은 순, 동점이면 동>남>서>북. 유니크 순위(1..n)
export function rankWithinGame(rows) {
  const scored = rows.filter(r => r.score !== null && r.score !== '' && !Number.isNaN(Number(r.score)));
  const sorted = [...scored].sort((a, b) => {
    const d = Number(b.score) - Number(a.score);
    if (d !== 0) return d;
    return (SEAT_INDEX[a.pos] ?? 9) - (SEAT_INDEX[b.pos] ?? 9);
  });
  const map = new Map();
  sorted.forEach((r, i) => map.set(r, i + 1));
  return map;
}

// 우마: 1등 +uma1, 2등 +uma2, 3등 -uma2, 4등 -uma1
function umaForRank(rank, uma1, uma2) {
  if (rank === 1) return  uma1;
  if (rank === 2) return  uma2;
  if (rank === 3) return -uma2;
  if (rank === 4) return -uma1;
  return 0;
}

// 한 경기의 승점: row -> { rank, points }
// 승점 = (점수 - 반환점수)/1000 + 우마
export function gamePoints(rows, t) {
  const ret  = (t && t.returnScore != null) ? Number(t.returnScore) : 25000;
  const uma1 = (t && t.uma1 != null) ? Number(t.uma1) : 0;
  const uma2 = (t && t.uma2 != null) ? Number(t.uma2) : 0;
  const ranks = rankWithinGame(rows);
  const out = new Map();
  rows.forEach(r => {
    if (!ranks.has(r)) return;
    const rank = ranks.get(r);
    const points = (Number(r.score) - ret) / 1000 + umaForRank(rank, uma1, uma2);
    out.set(r, { rank, points });
  });
  return out;
}

// 누적 개인 순위 (승점 합산)
export function computeStandings(games, t) {
  const map = new Map();
  for (const g of games) {
    const gp = gamePoints(g.rows, t);
    for (const r of g.rows) {
      const id = (r.id || '').trim();
      if (!id || !gp.has(r)) continue;
      if (!map.has(id)) map.set(id, { id, points: 0, count: 0, p1: 0, p2: 0, p3: 0, p4: 0, rankSum: 0 });
      const e = map.get(id);
      const { rank, points } = gp.get(r);
      e.points += points; e.count += 1; e.rankSum += rank;
      if (rank === 1) e.p1++; else if (rank === 2) e.p2++; else if (rank === 3) e.p3++; else if (rank === 4) e.p4++;
    }
  }
  const arr = [...map.values()].sort((a, b) => b.points - a.points);
  arr.forEach((e, i) => {
    e.rank = (i > 0 && arr[i - 1].points === e.points) ? arr[i - 1].rank : i + 1;
    e.gap = (i === 0) ? null : (arr[i - 1].points - e.points);   // 바로 윗순위와의 승점차
    e.avgPoints = e.count ? e.points / e.count : 0;
    e.avgRank = e.count ? e.rankSum / e.count : 0;
  });
  return arr;
}

// 팀 순위 (팀원 승점·착순 합산)
export function computeTeamStandings(standings, participants) {
  const teamOf = {};
  (participants || []).forEach(p => { if (p && p.id) teamOf[p.id] = p.team || '(미지정)'; });
  const map = new Map();
  standings.forEach(e => {
    const team = teamOf[e.id] || '(미지정)';
    if (!map.has(team)) map.set(team, { team, points: 0, count: 0, p1: 0, p2: 0, p3: 0, p4: 0, members: 0 });
    const tt = map.get(team);
    tt.points += e.points; tt.count += e.count; tt.members += 1;
    tt.p1 += e.p1; tt.p2 += e.p2; tt.p3 += e.p3; tt.p4 += e.p4;
    tt.rankSum = (tt.rankSum || 0) + (e.avgRank * e.count);
  });
  const arr = [...map.values()].sort((a, b) => b.points - a.points);
  arr.forEach((e, i) => {
    e.rank = (i > 0 && arr[i - 1].points === e.points) ? arr[i - 1].rank : i + 1;
    e.gap = (i === 0) ? null : (arr[i - 1].points - e.points);
    e.avgPoints = e.count ? e.points / e.count : 0;
    e.avgRank = e.count ? (e.rankSum || 0) / e.count : 0;
  });
  return arr;
}

// 팀내순위: id -> { team, teamRank, teamSize }
export function computeTeamInfo(standings, participants) {
  const teamOf = {};
  (participants || []).forEach(p => { if (p && p.id) teamOf[p.id] = p.team || '(미지정)'; });
  const byTeam = {};
  standings.forEach(e => { const tm = teamOf[e.id] || '(미지정)'; (byTeam[tm] = byTeam[tm] || []).push(e); });
  const info = {};
  Object.entries(byTeam).forEach(([tm, members]) => {
    const sorted = [...members].sort((a, b) => b.points - a.points);
    sorted.forEach((e, i) => {
      const teamRank = (i > 0 && sorted[i - 1].points === e.points) ? info[sorted[i - 1].id].teamRank : i + 1;
      info[e.id] = { team: tm, teamRank, teamSize: members.length };
    });
  });
  return info;
}

// 승점 표시 (부호는 -만, 소수 1자리 고정)
export function fmtPoints(v) {
  const n = Math.round(v * 10) / 10;
  return (n === 0 ? 0 : n).toFixed(1);
}
// 소수 1자리 고정
export function fmt1(v) { const n = Math.round(v * 10) / 10; return (n === 0 ? 0 : n).toFixed(1); }
export function fmt2(v) { return (Math.round(v * 100) / 100).toFixed(2); }

/* ---------- 표시용 헬퍼 ---------- */
export function capacityLabel(c) { return (!c || c === 0) ? '무제한' : `${c}명`; }
export function ruleLabel(t) {
  const base = t.rule === 'team'
    ? `팀전${t.teamCount ? ` (${t.teamCount}팀)` : ''}`
    : '개인전';
  const time = t.timed ? `시간제 ${t.minutes || 0}분` : '시간제 없음';
  return `${base} · ${time}`;
}

/* ---------- 알람음 ---------- */
const soundsCol = collection(db, 'sounds');

// 기본 제공 사운드 3개(합성음, 항상 목록에 나타남). 나머지는 업로드.
const BUILTIN_SOUNDS = [
  { id: 'builtin:beep',   name: '기본 삑',     freq: 880, type: 'sine',   beeps: 1, duration: 250, interval: 0 },
  { id: 'builtin:double', name: '삑삑 (2회)',  freq: 880, type: 'sine',   beeps: 2, duration: 150, interval: 200 },
  { id: 'builtin:triple', name: '삑삑삑 (3회)',freq: 990, type: 'square', beeps: 3, duration: 130, interval: 170 },
];
export function builtinSounds() { return BUILTIN_SOUNDS.map(s => ({ ...s })); }
export function allSounds(custom) { return [...BUILTIN_SOUNDS, ...(custom || [])]; }
export function resolveSound(id, custom) {
  if (!id) return null;
  return allSounds(custom).find(s => s.id === id) || null;
}

export async function createSound(data) {
  const ref = await addDoc(soundsCol, { ...data, createdAt: serverTimestamp() });
  return ref.id;
}
export function onSounds(cb) {
  return onSnapshot(soundsCol, snap => {
    const l = []; snap.forEach(d => l.push({ id: d.id, ...d.data() })); cb(l);
  }, err => { console.error('알람음 구독 오류:', err); cb([]); });
}
export async function getSoundsOnce() {
  const snap = await getDocs(soundsCol);
  const l = []; snap.forEach(d => l.push({ id: d.id, ...d.data() })); return l;
}
export async function updateSound(id, patch) { await updateDoc(doc(db, 'sounds', id), patch); }
export async function deleteSound(id) { await deleteDoc(doc(db, 'sounds', id)); }

// 알람 형식 표준화: 숫자(옛) → {min, soundId}
export function normalizeAlarms(alarms) {
  return (alarms || []).map(a =>
    typeof a === 'number' ? { min: a, soundId: null } : { min: Number(a.min) || 0, soundId: a.soundId || null });
}
