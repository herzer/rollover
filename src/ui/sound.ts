// Small synthesized sounds — no audio files to load.

let ctx: AudioContext | null = null;
let muted = (() => { try { return localStorage.getItem('rollover.muted') === '1'; } catch { return false; } })();

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem('rollover.muted', m ? '1' : '0'); } catch { /* storage blocked */ }
}

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.15, delay = 0, slideTo?: number) {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function click(gain = 0.25, freq = 2200) {
  const a = ac();
  if (!a) return;
  const len = Math.floor(a.sampleRate * 0.03);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 1.4;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

export const sfx = {
  pick: () => click(0.18, 3000),
  place: () => { click(0.35, 1800); tone(180, 0.05, 'sine', 0.05); },
  draw: () => { click(0.2, 1200); tone(330, 0.12, 'triangle', 0.06, 0.02, 260); },
  myTurn: () => { tone(660, 0.14, 'sine', 0.1); tone(880, 0.2, 'sine', 0.1, 0.12); },
  error: () => { tone(220, 0.18, 'square', 0.05); tone(180, 0.22, 'square', 0.05, 0.12); },
  rollover: () => { tone(300, 0.5, 'sawtooth', 0.05, 0, 1200); [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.09, 0.25 + i * 0.07)); },
  star: () => [1319, 1568, 2093, 2637].forEach((f, i) => tone(f, 0.3, 'sine', 0.07, i * 0.06)),
  win: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.28, 'triangle', 0.11, i * 0.13)),
  react: () => tone(990, 0.1, 'sine', 0.06),
};
