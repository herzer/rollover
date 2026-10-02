// The kitten (2026-09-30, Stefanie: "add some kitten love"). It sits on the rack, naps while others
// play, perks up on your turn, sends hearts when you lay a good meld, rolls over on a rollover run,
// celebrates a win — and purrs when you pet it. Since 2026-10-02 the kitten is Minka in 3D (minkacat.ts).

import { sfx } from './sound';

const SVG = `
<svg viewBox="0 0 120 104" aria-hidden="true">
  <g class="k-tail"><path d="M88 86 C112 86 116 62 104 50" fill="none" stroke="#e8914a" stroke-width="10" stroke-linecap="round"/>
    <path d="M104 50 C101 46 98 45 96 46" fill="none" stroke="#c96f2c" stroke-width="10" stroke-linecap="round"/></g>
  <ellipse cx="60" cy="80" rx="33" ry="22" fill="#f2a35c"/>
  <path d="M44 66 q4 6 0 12 M76 66 q-4 6 0 12" stroke="#d9802f" stroke-width="3" fill="none" stroke-linecap="round"/>
  <ellipse cx="47" cy="99" rx="9" ry="5.5" fill="#fff4e3"/><ellipse cx="73" cy="99" rx="9" ry="5.5" fill="#fff4e3"/>
  <g class="k-head">
    <path d="M35 34 L39 8 L56 24 Z" fill="#f2a35c"/><path d="M40 28 L42 15 L51 24 Z" fill="#ffb7b2"/>
    <path d="M85 34 L81 8 L64 24 Z" fill="#f2a35c"/><path d="M80 28 L78 15 L69 24 Z" fill="#ffb7b2"/>
    <circle cx="60" cy="44" r="27" fill="#f2a35c"/>
    <path d="M52 19 q2 6 0 10 M60 17 v11 M68 19 q-2 6 0 10" stroke="#d9802f" stroke-width="3" fill="none" stroke-linecap="round"/>
    <ellipse cx="60" cy="55" rx="15" ry="11" fill="#fff4e3"/>
    <circle cx="41" cy="52" r="5" fill="#ff9f9a" opacity=".55"/><circle cx="79" cy="52" r="5" fill="#ff9f9a" opacity=".55"/>
    <g class="k-eyes-open"><ellipse cx="49" cy="42" rx="4.6" ry="5.8" fill="#3b2a20"/><ellipse cx="71" cy="42" rx="4.6" ry="5.8" fill="#3b2a20"/>
      <circle cx="50.6" cy="40" r="1.7" fill="#fff"/><circle cx="72.6" cy="40" r="1.7" fill="#fff"/></g>
    <g class="k-eyes-happy" stroke="#3b2a20" stroke-width="3" fill="none" stroke-linecap="round"><path d="M44 44 q5 -7 10 0"/><path d="M66 44 q5 -7 10 0"/></g>
    <g class="k-eyes-shut" stroke="#3b2a20" stroke-width="3" fill="none" stroke-linecap="round"><path d="M44 43 q5 4 10 0"/><path d="M66 43 q5 4 10 0"/></g>
    <path d="M57 50 h6 l-3 3.5 z" fill="#ff8a8a"/>
    <path d="M54 56 q3 3 6 0 q3 3 6 0" stroke="#3b2a20" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M30 50 l12 2 M30 57 l12 -1 M90 50 l-12 2 M90 57 l-12 -1" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".9"/>
  </g>
</svg>
<span class="k-zzz">z<i>z</i><b>z</b></span>`;

/** The joker: a little ginger kitten face, drawn like the mascot. */
export const KITTEN_FACE = `<svg class="kface" viewBox="20 2 80 74" aria-hidden="true">
  <path d="M35 34 L39 8 L56 24 Z" fill="#f2a35c"/><path d="M40 28 L42 15 L51 24 Z" fill="#ffb7b2"/>
  <path d="M85 34 L81 8 L64 24 Z" fill="#f2a35c"/><path d="M80 28 L78 15 L69 24 Z" fill="#ffb7b2"/>
  <circle cx="60" cy="44" r="27" fill="#f2a35c"/>
  <path d="M52 19 q2 6 0 10 M60 17 v11 M68 19 q-2 6 0 10" stroke="#d9802f" stroke-width="3" fill="none" stroke-linecap="round"/>
  <ellipse cx="60" cy="55" rx="15" ry="11" fill="#fff4e3"/>
  <circle cx="41" cy="52" r="5" fill="#ff9f9a" opacity=".6"/><circle cx="79" cy="52" r="5" fill="#ff9f9a" opacity=".6"/>
  <ellipse cx="49" cy="42" rx="4.6" ry="5.8" fill="#3b2a20"/><ellipse cx="71" cy="42" rx="4.6" ry="5.8" fill="#3b2a20"/>
  <circle cx="50.6" cy="40" r="1.7" fill="#fff"/><circle cx="72.6" cy="40" r="1.7" fill="#fff"/>
  <path d="M57 50 h6 l-3 3.5 z" fill="#ff8a8a"/>
  <path d="M54 56 q3 3 6 0 q3 3 6 0" stroke="#3b2a20" stroke-width="2" fill="none" stroke-linecap="round"/>
</svg>`;

// Minka in 3D is the mascot (2026-10-02); ?kitty=classic shows the drawn kitten, which also stays when 3D cannot load
const CLASSIC = new URLSearchParams(location.search).get('kitty') === 'classic';
type Cat = { setAwake(a: boolean): void; happy(): void; rollover(): void; party(): void; pet(): void;
  walk(dir: -1 | 1): void; settle(): void; angry(): void; onStep: ((dx: number) => void) | null };

export class Kitty {
  el: HTMLElement;
  private mood: 'awake' | 'sleep' = 'awake';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cat: Cat | null = null;

  constructor(host: HTMLElement) {
    this.el = document.createElement('button');
    this.el.className = 'kitty';
    this.el.innerHTML = SVG;
    this.el.title = 'Pet the kitten';
    this.el.addEventListener('click', () => this.pet());
    host.appendChild(this.el);
    if (!CLASSIC) this.bringMinka();
  }

  /** Minka, her own 3D model (src/ui/minkacat.ts), loaded in the background; the drawn kitten shows until she is here. */
  private async bringMinka() {
    const { MinkaCat } = await import('./minkacat');
    this.el.classList.add('minka3d');
    const cat = await MinkaCat.create(this.el);
    if (!cat) { this.el.classList.remove('minka3d'); return; }
    this.el.querySelector('svg')?.remove();
    this.cat = cat;
    if (import.meta.env.DEV) (window as unknown as { minkaCat: unknown }).minkaCat = cat;
    cat.setAwake(this.mood === 'awake');
    this.place(this.at[0], this.at[1]);
  }

  setTitle(text: string) { this.el.title = text; }

  private at: [number, number] = [0, 0];
  private strolling = false;
  /** Sits on the top-right corner of the rack (Minka is larger: her bottom-right corner sits where the kitten's did). */
  place(x: number, y: number) {
    this.at = [x, y];
    if (this.strolling) return;
    const dx = this.cat ? 84 - this.el.offsetWidth : 0, dy = this.cat ? 73 - this.el.offsetHeight : 0;
    this.el.style.left = `${x + dx}px`;
    this.el.style.top = `${y + dy}px`;
  }

  setAwake(awake: boolean) {
    const mood = awake ? 'awake' : 'sleep';
    if (mood === this.mood) return;
    this.mood = mood;
    this.el.classList.toggle('sleep', !awake);
    this.cat?.setAwake(awake);
  }

  private flash(cls: string, ms: number) {
    this.el.classList.remove('happy', 'roll', 'party');
    void this.el.offsetWidth;
    this.el.classList.add(cls);
    if (cls !== 'happy') this.el.classList.add('happy');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.el.classList.remove('happy', 'roll', 'party'), ms);
  }

  hearts(n = 3) {
    for (let i = 0; i < n; i++) {
      const h = document.createElement('span');
      h.className = 'k-heart';
      h.textContent = '♥';
      h.style.left = `${30 + Math.random() * 50}%`;
      h.style.animationDelay = `${i * 0.15}s`;
      h.style.fontSize = `${14 + Math.random() * 10}px`;
      this.el.appendChild(h);
      setTimeout(() => h.remove(), 1800 + i * 150);
    }
  }

  get canStroll() { return !!this.cat && !this.strolling; }

  /** Minka takes a walk (2026-10-02, Stefanie: "make Minka walk … on the bottom board, not across, and the feet should
   *  not slide"): from her spot along `path` — points where her paws go, in the game's coordinates — then sits again.
   *  She lets clicks pass while out. */
  stroll(path: [number, number][]): Promise<void> {
    const cat = this.cat;
    if (!cat || this.strolling) return Promise.resolve();
    this.strolling = true;
    this.el.classList.add('walking');
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    const foot = (p: [number, number]) => { this.el.style.left = `${p[0] - w / 2}px`; this.el.style.top = `${p[1] - h * 0.92}px`; };
    // she moves only as her paws push: each frame, the paw on the ground stays where it is on screen and she moves
    // the other way by exactly as much (minkacat.ts onStep) — no sliding
    return new Promise((done) => {
      let seg = 0, x = path[0][0], y = path[0][1];
      const started = performance.now();
      const finish = () => {
        cat.onStep = null;
        this.strolling = false;
        this.el.classList.remove('walking');
        this.place(this.at[0], this.at[1]);
        cat.settle();
        done();
      };
      const head = () => {
        const b = path[seg + 1];
        cat.walk(b[0] < x ? -1 : 1);
      };
      head();
      foot([x, y]);
      cat.onStep = (dx) => {
        const b = path[seg + 1], dir = b[0] < path[seg][0] ? -1 : 1;
        if (dx * dir > 0) dx = 0;               // a paw lifting, not pushing: she never moves backward
        x -= dx;
        y = path[seg][1] + (b[1] - path[seg][1]) * Math.min(1, Math.abs(x - path[seg][0]) / (Math.abs(b[0] - path[seg][0]) || 1));
        if ((dir < 0 && x <= b[0]) || (dir > 0 && x >= b[0])) {
          x = b[0]; y = b[1]; seg++;
          if (seg >= path.length - 1) { foot([x, y]); finish(); return; }
          head();
        }
        foot([x, y]);
        if (performance.now() - started > 60000) finish();          // never stuck out on the rack
      };
    });
  }

  /** Where her paws are now, in the game's coordinates (the start of a stroll). */
  get paws(): [number, number] { return [this.el.offsetLeft + this.el.offsetWidth / 2, this.el.offsetTop + this.el.offsetHeight * 0.92]; }

  happy() { this.flash('happy', 1600); this.hearts(3); this.cat?.happy(); }
  /** A turn is taking long: Minka gets impatient (her angry swipe); the drawn kitten just stays as it is. */
  impatient() { if (!this.strolling) this.cat?.angry(); }
  rollover() { this.flash('roll', 1400); this.hearts(2); this.cat?.rollover(); }
  party() { this.flash('party', 3200); this.hearts(8); sfx.meow(); this.cat?.party(); }
  pet() { this.el.classList.remove('sleep'); this.flash('happy', 1800); this.hearts(4); sfx.purr(); this.cat?.pet(); }
}
