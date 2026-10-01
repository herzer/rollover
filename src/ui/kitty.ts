// The kitten (2026-09-30, Stefanie: "add some kitten love"). It sits on the rack, naps while others
// play, perks up on your turn, sends hearts when you lay a good meld, rolls over on a rollover run,
// celebrates a win — and purrs when you pet it.

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

export class Kitty {
  el: HTMLElement;
  private mood: 'awake' | 'sleep' = 'awake';
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(host: HTMLElement) {
    this.el = document.createElement('button');
    this.el.className = 'kitty';
    this.el.innerHTML = SVG;
    this.el.title = 'Pet the kitten';
    this.el.addEventListener('click', () => this.pet());
    host.appendChild(this.el);
  }

  setTitle(text: string) { this.el.title = text; }

  /** Sits on the top-right corner of the rack. */
  place(x: number, y: number) {
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }

  setAwake(awake: boolean) {
    const mood = awake ? 'awake' : 'sleep';
    if (mood === this.mood) return;
    this.mood = mood;
    this.el.classList.toggle('sleep', !awake);
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

  happy() { this.flash('happy', 1600); this.hearts(3); }
  rollover() { this.flash('roll', 1400); this.hearts(2); }
  party() { this.flash('party', 3200); this.hearts(8); sfx.meow(); }
  pet() { this.el.classList.remove('sleep'); this.flash('happy', 1800); this.hearts(4); sfx.purr(); }
}
