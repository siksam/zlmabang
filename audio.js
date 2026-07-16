/* =========================================================
   audio.js — 알람음/차임/음성 안내(TTS) 공통 모듈
   ========================================================= */
let ctx = null;
function ensure() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
}

/* ---------- 음성 준비 ---------- */
function loadVoices() { try { window.speechSynthesis.getVoices(); } catch (e) {} }
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  loadVoices();
  try { window.speechSynthesis.onvoiceschanged = loadVoices; } catch (e) {}
}
let warmed = false;
// 첫 사용자 동작 때 음성 엔진을 살짝 깨워둠(모바일 대응)
export function warmUpSpeech() {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0; u.lang = 'ko-KR';
    window.speechSynthesis.speak(u);
  } catch (e) {}
}
export function unlockAudioOnGesture() {
  const h = () => { ensure(); if (!warmed) { warmUpSpeech(); warmed = true; } };
  ['click', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, h));
}

/* ---------- 기본 비프(업로드/기본음용) ---------- */
export function beep(freq = 880, dur = 250, type = 'sine') {
  ensure();
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  o.connect(g); g.connect(ctx.destination);
  const now = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.3, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur / 1000);
  o.start(now); o.stop(now + dur / 1000);
}

/* ---------- 실로폰 차임(딩동댕) ---------- */
function mkTone(freq, t0, gain, dur) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  o.connect(g); g.connect(ctx.destination);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.004); // 빠른 어택
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); // 빠른 감쇠(타건음)
  o.start(t0); o.stop(t0 + dur + 0.02);
}
// 실로폰/마림바 느낌 한 음 (기음 + 3배·2배 배음)
function xyloNote(freq, when) {
  ensure();
  const t0 = ctx.currentTime + when;
  mkTone(freq, t0, 0.55, 0.7);
  mkTone(freq * 3, t0, 0.22, 0.45);
  mkTone(freq * 2, t0, 0.14, 0.5);
}
export function chime() {
  ensure();
  const notes = [523.25, 659.25, 783.99]; // 도-미-솔 상승
  notes.forEach((f, i) => xyloNote(f, i * 0.18));
}

/* ---------- 사운드 재생 ---------- */
export function playSound(s) {
  if (!s) { beep(); return; }
  if (s.dataUrl) {
    try { const a = new Audio(s.dataUrl); a.play().catch(() => {}); } catch (e) {}
    return;
  }
  const n = Math.max(1, s.beeps || 1);
  const dur = s.duration || 250;
  const spacing = (s.interval && s.interval > 0) ? s.interval : (dur + 80);
  for (let i = 0; i < n; i++) setTimeout(() => beep(s.freq || 880, dur, s.type || 'sine'), i * spacing);
}

/* ---------- 음성 안내(TTS) ---------- */
function pickKoVoice() {
  try {
    const vs = window.speechSynthesis.getVoices() || [];
    return vs.find(v => v.lang && v.lang.toLowerCase().startsWith('ko')) || null;
  } catch (e) { return null; }
}
export function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR'; u.rate = 1.0;
    const v = pickKoVoice(); if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  } catch (e) {}
}

export function speakAlarm(minutes) { chime(); setTimeout(() => speak(`${minutes}분 남았습니다`), 900); }
export function speakEnd() { chime(); setTimeout(() => speak('시간이 종료되었습니다'), 900); }
export function testSpeak() { chime(); setTimeout(() => speak('소리 테스트 정상입니다'), 900); }
export function endAlarm() { [0, 350, 700, 1050].forEach(d => setTimeout(() => beep(660, 300, 'square'), d)); }
