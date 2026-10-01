// Small synthesized sounds — no audio files to load.

let ctx: AudioContext | null = null;
let muted = (() => { try { return localStorage.getItem('rollover.muted') === '1'; } catch { return false; } })();

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  if (m) stopMusic(); else if (musicPref) startMusic();
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
  meow: () => {
    const a = ac();
    if (!a) return;
    const t0 = a.currentTime;
    const o = a.createOscillator(); const f = a.createBiquadFilter(); const g = a.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(520, t0); o.frequency.linearRampToValueAtTime(820, t0 + 0.18); o.frequency.linearRampToValueAtTime(480, t0 + 0.55);
    f.type = 'bandpass'; f.Q.value = 3; f.frequency.setValueAtTime(900, t0); f.frequency.linearRampToValueAtTime(1800, t0 + 0.2); f.frequency.linearRampToValueAtTime(1000, t0 + 0.55);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.12, t0 + 0.06); g.gain.setValueAtTime(0.12, t0 + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
    o.connect(f).connect(g).connect(a.destination); o.start(t0); o.stop(t0 + 0.65);
  },
  purr: () => {
    const a = ac();
    if (!a) return;
    const t0 = a.currentTime, dur = 1.4;
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) { const tt = i / a.sampleRate; d[i] = (Math.random() * 2 - 1) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 24 * tt)) ** 3; }
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320;
    const g = a.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.5, t0 + 0.2); g.gain.linearRampToValueAtTime(0, t0 + dur);
    src.connect(f).connect(g).connect(a.destination); src.start(t0);
  },
  meld: () => { tone(784, 0.12, 'sine', 0.08); tone(1175, 0.22, 'sine', 0.08, 0.08); },
};

// ---- background music: a slow, warm synth pad (Am – F – C – G), generated live --------------

let musicPref = (() => { try { return localStorage.getItem('rollover.music') === '1'; } catch { return false; } })();
let music: { stop: () => void } | null = null;

export const musicOn = () => musicPref;
export function setMusic(on: boolean) {
  musicPref = on;
  try { localStorage.setItem('rollover.music', on ? '1' : '0'); } catch { /* storage blocked */ }
  if (on) startMusic(); else stopMusic();
}
/** Browsers only allow sound after a tap, so a remembered "music on" starts with the first one. */
export function resumeMusicOnGesture() {
  if (musicPref && !music) document.addEventListener('pointerdown', () => startMusic(), { once: true });
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

function startMusic() {
  if (music || muted) return;
  const a = ac();
  if (!a) return;
  const master = a.createGain();
  master.gain.setValueAtTime(0, a.currentTime);
  master.gain.linearRampToValueAtTime(0.05, a.currentTime + 4);
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.7;
  const lfo = a.createOscillator(); const lfoGain = a.createGain();
  lfo.frequency.value = 0.05; lfoGain.gain.value = 450;
  lfo.connect(lfoGain).connect(lp.frequency); lfo.start();
  const delay = a.createDelay(1); delay.delayTime.value = 0.45;
  const fb = a.createGain(); fb.gain.value = 0.35;
  lp.connect(master); lp.connect(delay); delay.connect(fb).connect(delay); delay.connect(master);
  master.connect(a.destination);

  const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
  const len = 8;
  let i = 0;
  const play = () => {
    const t0 = a.currentTime + 0.05;
    const notes = chords[i++ % chords.length];
    for (const n of [...notes, notes[0] - 12]) {
      for (const detune of n === notes[0] - 12 ? [0] : [-7, 7]) {
        const o = a.createOscillator(); const g = a.createGain();
        o.type = n === notes[0] - 12 ? 'sine' : 'sawtooth';
        o.frequency.value = midi(n); o.detune.value = detune;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(n === notes[0] - 12 ? 0.5 : 0.18, t0 + 2.5);
        g.gain.setValueAtTime(n === notes[0] - 12 ? 0.5 : 0.18, t0 + len - 1);
        g.gain.linearRampToValueAtTime(0, t0 + len + 2);
        o.connect(g).connect(lp);
        o.start(t0); o.stop(t0 + len + 2.1);
      }
    }
  };
  play();
  const timer = setInterval(play, len * 1000);
  music = {
    stop: () => {
      clearInterval(timer);
      master.gain.cancelScheduledValues(a.currentTime);
      master.gain.setValueAtTime(master.gain.value, a.currentTime);
      master.gain.linearRampToValueAtTime(0, a.currentTime + 1.5);
      setTimeout(() => { lfo.stop(); master.disconnect(); }, 1700);
    },
  };
}

function stopMusic() { music?.stop(); music = null; }
