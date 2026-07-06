/* =========================================================
   audio.js — 알람음 재생 공통 모듈 (Web Audio, 음원 파일 불필요)
   소리는 파라미터로 정의됩니다:
     { freq(주파수 Hz), type(파형), beeps(반복), duration(길이ms), interval(간격ms) }
   ========================================================= */
let ctx = null;
function ensure() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
}

// 페이지 첫 상호작용(클릭 등)에 소리 잠금 해제
export function unlockAudioOnGesture() {
  ['click', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, ensure));
}

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

// 사운드 파라미터로 재생 (null이면 기본 삑)
export function playSound(s) {
  if (!s) { beep(); return; }
  const n = Math.max(1, s.beeps || 1);
  const dur = s.duration || 250;
  const spacing = (s.interval && s.interval > 0) ? s.interval : (dur + 80);
  for (let i = 0; i < n; i++) {
    setTimeout(() => beep(s.freq || 880, dur, s.type || 'sine'), i * spacing);
  }
}

// 종료(0:00) 알림음
export function endAlarm() {
  [0, 350, 700, 1050].forEach(d => setTimeout(() => beep(660, 300, 'square'), d));
}
