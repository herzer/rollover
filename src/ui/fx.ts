// Confetti in the tile colors.
export function confetti(host: HTMLElement, ms = 3200) {
  const c = document.createElement('canvas');
  c.className = 'confetti';
  const dpr = window.devicePixelRatio || 1;
  const W = host.clientWidth, H = host.clientHeight;
  c.width = W * dpr; c.height = H * dpr;
  c.style.width = W + 'px'; c.style.height = H + 'px';
  host.appendChild(c);
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  const colors = ['#d42a3b', '#1d5fd0', '#e98a00', '#22252b', '#e9b024'];
  const bits = Array.from({ length: 160 }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.35,
    vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4,
    w: 6 + Math.random() * 7, h: 9 + Math.random() * 8, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4,
    col: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  const frame = (now: number) => {
    const el = now - t0;
    g.clearRect(0, 0, W, H);
    for (const b of bits) {
      b.vy += 0.35; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.a += b.va;
      g.save(); g.translate(b.x, b.y); g.rotate(b.a);
      g.globalAlpha = Math.max(0, 1 - el / ms);
      g.fillStyle = b.col; g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      g.restore();
    }
    if (el < ms) requestAnimationFrame(frame); else c.remove();
  };
  requestAnimationFrame(frame);
}
