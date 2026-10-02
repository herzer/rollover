// The game screen: felt table, wooden rack, and every tile as one element in a layer
// above both — so a tile glides from the rack to the table instead of jumping.

import { BOARD_COLS, BOARD_ROWS, checkBoard, cellKey, closeUp, findSpot, relayRow, segments, type Placed } from '../engine/board';
import { legalSplit, meldAround, meldProblem } from '../engine/melds';
import { chooseMove, rackMelds, type Move } from '../engine/ai';
import type { GameState, LogEntry } from '../engine/game';
import type { Tile } from '../engine/tiles';
import type { Client, ClientEvent } from '../net/client';
import { REACTIONS } from '../net/protocol';
import { t, lang, setLang } from './i18n';
import { icon } from './icons';
import { sfx, isMuted, setMuted, musicOn, setMusic, resumeMusicOnGesture } from './sound';
import { confetti } from './fx';
import { Kitty, KITTEN_FACE } from './kitty';

const RACK_ROWS = 2;
export const FINISHES = ['ts-3d', 'ts-wood', '', 'ts-porcelain', 'ts-jade', 'ts-clay', 'ts-glass', 'ts-neon', 'ts-chrome', 'ts-gummy', 'ts-sugar', 'ts-hardcandy'];
/** Stefanie (2026-09-30): Maple "for now", then "a crisper, more Blade Runner look" — neon is the default;
 *  Maple, the classics and candy stay in the palette. */
export const DEFAULT_FINISH = 'ts-3d';
/** "Sweeter to me means 3D tiles and a friendly color scheme" (2026-09-30): friendly is the default look. */
export const DEFAULT_PALETTE = 'pal-lilac'; // her pick, picks/rollover-colors (2026-10-01)
export const PALETTES = ['pal-sage', 'pal-sea', 'pal-lilac'];
export function palette(): string {
  try { const p = localStorage.getItem('rollover.palette'); if (p && PALETTES.includes(p)) return p; } catch { /* storage blocked */ }
  return DEFAULT_PALETTE;
}
/** A neon tile brings the night-city look (table, rack, chrome) with it. */
const NEON = ['ts-neon', 'ts-chrome'];
/** A candy tile brings the whole candy look (table, rack, buttons) with it; every other tile keeps the classic table. */
const CANDY = ['ts-gummy', 'ts-sugar', 'ts-hardcandy'];
export function finish(): string {
  try { const f = localStorage.getItem('rollover.finish'); if (f !== null && FINISHES.includes(f)) return f; } catch { /* storage blocked */ }
  return DEFAULT_FINISH;
}
function setFinish(f: string) { try { localStorage.setItem('rollover.finish', f); } catch { /* storage blocked */ } applyFinish(); }
/** The finish lives on <body>, so the home screen and lobby tiles match the game. */
export function applyFinish() {
  for (const f of FINISHES) if (f) document.body.classList.remove(f);
  const f = finish();
  if (f) document.body.classList.add(f);
  document.body.classList.toggle('candy', CANDY.includes(f));
  document.body.classList.toggle('neon', NEON.includes(f));
  const friendly = !CANDY.includes(f) && !NEON.includes(f);
  document.body.classList.toggle('friendly', friendly);
  for (const p of PALETTES) document.body.classList.toggle(p, friendly && p === palette());
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

type Area = 'board' | 'rack';
interface Drag {
  id: number;
  pointerId: number;
  x0: number; y0: number;
  grabX: number; grabY: number;
  w: number; h: number;
  group: number[];
  /** Set when a whole meld was picked up by its handle. */
  forced?: boolean;
  active: boolean;
}

export function tileHTML(tile: Tile): string {
  const inner = tile.joker
    ? `<span class="jk">${KITTEN_FACE}</span>`
    : `<span class="n">${tile.num}</span>`;
  return inner + (tile.star ? '<span class="st">★</span>' : '');
}
export const tileClass = (tile: Tile) => `tile c${tile.color}${tile.joker ? ' joker' : ''}`;

export class GameView {
  private el: HTMLElement;
  private boardEl!: HTMLElement;
  private rackEl!: HTMLElement;
  private layer!: HTMLElement;
  /** Above the tiles: rack meld labels and the drop ghost. */
  private overlay!: HTMLElement;
  private kitty!: Kitty;
  private tileEls = new Map<number, HTMLElement>();
  private draft: Placed[] | null = null;
  private draftKey = '';
  /** The state seq a commit or draw was sent for; buttons wait until the answer arrives. */
  private sentSeq = -1;
  /** Melds that were already valid, so a newly valid one can light up once. */
  private validKeys = new Set<string>();
  private pendingSort = false;
  private prevRack: Set<number> | null = null;
  private rackPos = new Map<number, { r: number; c: number }>();
  private selected = new Set<number>();
  private hint: Move | null = null;
  private drag: Drag | null = null;
  private lastClick = { id: -1, at: 0 };
  private tw = 44; private th = 58; private gap = 4;
  /** Rack tiles can be bigger than table tiles on small screens. */
  private rtw = 44; private rth = 58; private rackCols = 24;
  private rackRows = RACK_ROWS;
  private prevBoard = new Set<number>();
  private logSeen = -1;
  private roundSeen = -1;
  private wasMyTurn = false;
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  private off: () => void;
  private modalOpen: 'over' | 'help' | null = null;

  constructor(private root: HTMLElement, private client: Client, private onLeave: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'game';
    applyFinish();
    root.replaceChildren(this.el);
    this.build();
    this.off = client.on((e) => this.onEvent(e));
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    this.loadRack();
    this.render();
    if (import.meta.env.DEV) window.addEventListener('keydown', this.onDevKey);
    resumeMusicOnGesture();
  }

  // ⌘⇧D / Ctrl+Shift+D — developer panel, dev builds only (never on a shipping surface)
  private autoplay: ReturnType<typeof setInterval> | null = null;
  private onDevKey = (e: KeyboardEvent) => {
    if (!(e.shiftKey && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd')) return;
    e.preventDefault();
    const open = this.el.querySelector('.devpanel');
    if (open) { open.remove(); return; }
    const p = document.createElement('div');
    p.className = 'devpanel';
    p.innerHTML = `<b>Developer</b>
      <button class="btn sm" data-dev="banner" title="Preview the rollover banner">Rollover banner</button>
      <button class="btn sm" data-dev="star" title="Preview a star card">Star card</button>
      <button class="btn sm" data-dev="confetti" title="Preview confetti">Confetti</button>
      <button class="btn sm" data-dev="react" title="Preview a reaction">Reaction</button>
      <button class="btn sm" data-dev="auto" title="Play my turns with the hint, automatically">Autoplay my turns</button>`;
    p.addEventListener('click', (ev) => {
      const k = (ev.target as HTMLElement).closest('[data-dev]') as HTMLElement | null;
      if (!k) return;
      if (k.dataset.dev === 'banner') { this.banner(t().rollover); sfx.rollover(); }
      if (k.dataset.dev === 'star') { const c = t().star.spotlight; this.starCard(c.title, c.body('Robin', 'Mama')); sfx.star(); }
      if (k.dataset.dev === 'confetti') { confetti(this.el); sfx.win(); }
      if (k.dataset.dev === 'react') this.floatReaction(this.seat, '🎉');
      if (k.dataset.dev === 'auto') {
        if (this.autoplay) { clearInterval(this.autoplay); this.autoplay = null; k.textContent = 'Autoplay my turns'; return; }
        k.textContent = 'Stop autoplay';
        this.autoplay = setInterval(() => {
          const s = this.s;
          if (!s || !this.myTurn) return;
          const m = chooseMove(s, this.seat, 3, 60000);
          if (m) this.client.send({ t: 'commit', board: m.board, seq: s.seq });
          else this.client.send({ t: 'draw', seq: s.seq });
        }, 1500);
      }
    });
    this.el.appendChild(p);
  };

  // Minka gets impatient when a turn drags on — anyone's: after a minute, then every half minute (2026-10-02)
  private turnSince = Date.now();
  private turnKey = '';
  private lastAngry = 0;
  private impatience = setInterval(() => {
    const s = this.s;
    if (!s || s.phase !== 'playing' || document.hidden || this.modalOpen) return;
    const now = Date.now();
    if (now - this.turnSince > 60000 && now - this.lastAngry > 30000) { this.lastAngry = now; this.kitty.impatient(); }
  }, 5000);

  // Minka strolls along the rack now and then: first soon after she arrives, then every few minutes (2026-10-02)
  private strollTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduleStroll(first = false) {
    if (this.strollTimer) clearTimeout(this.strollTimer);
    this.strollTimer = setTimeout(() => this.stroll(), first ? 12000 : 150000 + Math.random() * 150000);
  }
  private stroll() {
    // not while you are moving tiles, reading a message, or looking away
    if (this.drag || this.modalOpen || document.hidden || !this.kitty.canStroll) { this.scheduleStroll(); return; }
    // along the top of the rack (the bottom board) to its far end and back — not across the table
    const host = this.el.getBoundingClientRect(), rk = this.rackEl.getBoundingClientRect();
    const home = this.kitty.paws;
    const far: [number, number] = [rk.left - host.left + rk.width * 0.1, home[1]];
    void this.kitty.stroll([home, far, home]).then(() => this.scheduleStroll());
  }

  destroy() {
    if (this.strollTimer) clearTimeout(this.strollTimer);
    clearInterval(this.impatience);
    this.off();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('keydown', this.onDevKey);
    if (this.autoplay) clearInterval(this.autoplay);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
  }

  private onResize = () => { this.measure(); this.render(); };
  private onVisible = () => { if (!document.hidden) document.title = `${t().appName} — a tile rummy game`; };

  // ---------------------------------------------------------------- build --

  private build() {
    this.el.innerHTML = `
      <header class="topbar">
        <span class="logo">${t().appName}</span>
        <div class="players" data-ref="players"></div>
        <div class="chip poolchip" data-ref="pool" title="${esc(t().poolTip)}"><span class="poolstack"></span><span data-ref="poolN"></span></div>
        <button class="btn icon" data-act="help" title="${esc(t().helpTip)}">${icon('help')}</button>
        <button class="btn icon" data-act="lang" title="${esc(t().langTip)}">${lang() === 'en' ? 'DE' : 'EN'}</button>
        <button class="btn icon" data-act="tiles" title="${esc(t().tilesTip)}">${icon('palette')}</button>
        <button class="btn icon${musicOn() ? ' on' : ''}" data-act="music" title="${esc(t().musicTip)}">${icon('music')}</button>
        <button class="btn icon" data-act="sound" title="${esc(t().soundTip)}">${icon(isMuted() ? 'mute' : 'sound')}</button>
        <button class="btn icon" data-act="leave" title="${esc(t().leaveTip)}">${icon('leave')}</button>
      </header>
      <div class="status" data-ref="status"></div>
      <div class="tablewrap"><div class="board" data-ref="board"></div></div>
      <div class="rotate-hint">${icon('refresh', 14)} ${lang() === 'de' ? 'Dreh dein Gerät quer — dann wird der Tisch größer.' : 'Turn your device sideways for a bigger table.'}</div>
      <div class="reveals" data-ref="reveals"></div>
      <div class="rackwrap"><div class="rack" data-ref="rack"></div></div>
      <div class="actions" data-ref="actions">
        <button class="btn" data-act="sortMelds" title="${esc(t().sortMeldsTip)}">${icon('sparkles')}${t().sortMelds}</button>
        <button class="btn" data-act="sortRuns" title="${esc(t().sortRunsTip)}">${icon('sortNum')}${t().sortRuns}</button>
        <button class="btn" data-act="sortGroups" title="${esc(t().sortGroupsTip)}">${icon('sortGroup')}${t().sortGroups}</button>
        <span class="spacer"></span>
        <button class="btn" data-act="undo" title="${esc(t().undoTip)}">${icon('undo')}${t().undo}</button>
        <button class="btn" data-act="hint" title="${esc(t().hintTip)}">${icon('hint')}${t().hint}</button>
        <button class="btn icon" data-act="react" title="${esc(t().reactTip)}">${icon('smile')}</button>
        <span class="spacer"></span>
        <button class="btn" data-act="draw" title="${esc(t().drawTip)}">${icon('hand')}<span data-ref="drawLabel">${t().draw}</span></button>
        <button class="btn primary" data-act="done" title="${esc(t().doneTip)}">${icon('check')}${t().done}</button>
      </div>
      <div class="tiles" data-ref="layer"></div>
      <div class="over" data-ref="over"></div>
    `;
    const ref = (n: string) => this.el.querySelector(`[data-ref="${n}"]`) as HTMLElement;
    this.boardEl = ref('board');
    this.rackEl = ref('rack');
    this.layer = ref('layer');
    this.overlay = ref('over');
    this.kitty = new Kitty(this.el);
    this.kitty.setTitle(t().petKitty);
    this.scheduleStroll(true);
    if (import.meta.env.DEV) (window as unknown as { minkaStroll: () => void }).minkaStroll = () => this.stroll();
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (b && !(b as HTMLButtonElement).disabled) this.act(b.dataset.act!, b);
    });
    this.layer.addEventListener('pointerdown', this.onDown);
    this.boardEl.addEventListener('pointerdown', this.onGripDown);
    this.boardEl.addEventListener('click', this.onAreaTap);
    this.rackEl.addEventListener('click', this.onAreaTap);
    this.tileEls.clear();
    requestAnimationFrame(() => { this.measure(); this.render(); });
  }

  // -------------------------------------------------------------- helpers --

  private get s(): GameState | null { return this.client.state; }
  private get seat() { return this.client.seat; }
  private get myTurn() { const s = this.s; return !!s && s.phase === 'playing' && s.turn === this.seat && this.client.status === 'ok'; }
  private get myRack(): number[] { const s = this.s; return s && this.seat >= 0 ? s.players[this.seat].rack.filter((id) => id >= 0) : []; }

  /** The table as it should look right now. */
  private displayBoard(): Placed[] {
    const s = this.s;
    if (!s) return [];
    if (this.myTurn && this.draft) return this.draft;
    const other = this.client.drafts.get(s.turn);
    if (s.phase === 'playing' && s.turn !== this.seat && other && other.seq === s.seq) return other.board;
    return s.board;
  }

  private rackKey() { const s = this.s; return s ? `rollover.rack.${s.gameId}.${this.seat}` : ''; }
  private loadRack() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.rackKey()) || 'null') as [number, { r: number; c: number }][] | null;
      if (raw) this.rackPos = new Map(raw);
    } catch { /* storage blocked */ }
  }
  private saveRack() { try { localStorage.setItem(this.rackKey(), JSON.stringify([...this.rackPos])); } catch { /* storage blocked */ } }

  /** Tiles from my rack that are not on the (draft) table. */
  private rackIds(): number[] {
    const onBoard = new Set(this.displayBoard().map((p) => p.id));
    return this.myRack.filter((id) => !onBoard.has(id));
  }

  private syncRack() {
    const ids = this.rackIds();
    const keep = new Set(ids);
    for (const id of [...this.rackPos.keys()]) if (!keep.has(id)) this.rackPos.delete(id);
    const need = ids.length;
    this.rackRows = Math.max(RACK_ROWS, Math.ceil((need + 2) / this.rackCols));
    const used = new Set([...this.rackPos.values()].map((p) => cellKey(p.r, p.c)));
    for (const id of ids) {
      if (this.rackPos.has(id)) {
        const p = this.rackPos.get(id)!;
        if (p.r < this.rackRows && p.c < this.rackCols) continue;
        this.rackPos.delete(id);
        used.delete(cellKey(p.r, p.c));
      }
      const spot = this.freeRackCell(used);
      this.rackPos.set(id, spot);
      used.add(cellKey(spot.r, spot.c));
    }
  }

  private freeRackCell(used: Set<number>) {
    for (let r = 0; r < this.rackRows; r++) for (let c = 0; c < this.rackCols; c++) if (!used.has(cellKey(r, c))) return { r, c };
    this.rackRows++;
    return { r: this.rackRows - 1, c: 0 };
  }

  // -------------------------------------------------------------- measure --

  private measure() {
    const W = this.el.clientWidth || window.innerWidth;
    const H = this.el.clientHeight || window.innerHeight;
    const gap = W < 700 ? 2 : 4;
    const byW = (W - 52) / BOARD_COLS - gap;
    const chrome = 56 + 28 + 64 + 46 + 30 + (this.el.querySelector('.reveals')?.clientHeight ?? 0);
    // aim for rack tiles of about 50px — comfortable for fingers — even when the table must be smaller
    const k = (tw: number) => Math.min(2.2, Math.max(1, 52 / tw));
    let tw = Math.min(60, byW);
    for (let i = 0; i < 3; i++) {
      const byH = (H - chrome - (BOARD_ROWS + this.rackRows) * gap) / (1.32 * (BOARD_ROWS + this.rackRows * k(tw)));
      tw = Math.max(16, Math.min(60, byW, byH));
    }
    tw = Math.floor(tw);
    this.tw = tw; this.th = Math.round(tw * 1.32); this.gap = gap;
    this.rtw = Math.round(tw * k(tw)); this.rth = Math.round(this.rtw * 1.32);
    this.rackCols = Math.max(10, Math.min(24, Math.floor((Math.min(W, BOARD_COLS * (tw + gap) + 60) - 50) / (this.rtw + gap))));
    const st = this.el.style;
    st.setProperty('--tw', tw + 'px');
    st.setProperty('--th', this.th + 'px');
    st.setProperty('--rtw', this.rtw + 'px');
    st.setProperty('--rth', this.rth + 'px');
    st.setProperty('--gap', gap + 'px');
    this.boardEl.style.setProperty('--cols', String(BOARD_COLS));
    this.boardEl.style.setProperty('--rows', String(BOARD_ROWS));
    this.rackEl.style.setProperty('--rcols', String(this.rackCols));
  }

  private size(area: Area) { return area === 'board' ? { w: this.tw, h: this.th } : { w: this.rtw, h: this.rth }; }

  private origin(area: Area) {
    const host = this.el.getBoundingClientRect();
    const box = (area === 'board' ? this.boardEl : this.rackEl).getBoundingClientRect();
    return { x: box.left - host.left + (area === 'board' ? 14 : 10), y: box.top - host.top + (area === 'board' ? 14 : 9), box, host };
  }

  private cellXY(area: Area, r: number, c: number) {
    const o = this.origin(area);
    const z = this.size(area);
    return { x: o.x + c * (z.w + this.gap) + this.gap / 2, y: o.y + r * (z.h + this.gap) + this.gap / 2 };
  }

  // --------------------------------------------------------------- events --

  private onEvent(e: ClientEvent) {
    if (e.t === 'react') { this.floatReaction(e.seat, e.emoji); return; }
    if (e.t === 'error') { this.sentSeq = -1; this.render(); sfx.error(); this.toast(t().errors[e.error] ?? e.error, true); return; }
    if (e.t === 'draft') { this.render(); return; }
    this.onState();
  }

  private onState() {
    const s = this.s;
    if (!s) return;
    if (s.round !== this.roundSeen) {
      this.roundSeen = s.round;
      this.logSeen = this.logSeen < 0 ? s.log.length : 0;
      this.prevBoard = new Set(s.board.map((p) => p.id));
      this.rackPos.clear();
      this.loadRack();
      if (this.rackPos.size === 0) this.pendingSort = true; // a fresh deal arrives sorted
      this.prevRack = null;
      this.selected.clear();
      this.closeModal();
    }
    // a new turn throws away any draft and hint — a brief disconnect does not
    const key = `${s.round}:${s.turnNo}`;
    if (key !== this.turnKey) { this.turnKey = key; this.turnSince = Date.now(); }
    const mineInState = s.phase === 'playing' && s.turn === this.seat;
    if (mineInState) {
      if (this.draftKey !== key || !this.draft) { this.draft = s.board.map((p) => ({ ...p })); this.hint = null; this.validKeys.clear(); }
    } else { this.draft = null; this.hint = null; }
    this.draftKey = key;
    if (s.seq !== this.sentSeq) this.sentSeq = -1;

    // what happened since the last update
    const fresh = s.board.filter((p) => !this.prevBoard.has(p.id)).map((p) => p.id);
    this.prevBoard = new Set(s.board.map((p) => p.id));
    for (let i = Math.max(0, this.logSeen); i < s.log.length; i++) this.happened(s.log[i], s);
    this.logSeen = s.log.length;
    const rackNow = new Set(this.myRack);
    const drawn = this.prevRack ? [...rackNow].filter((id) => !this.prevRack!.has(id)) : [];
    this.prevRack = rackNow;
    if (this.myTurn && !this.wasMyTurn) { this.maybeCoach(); sfx.myTurn(); if (document.hidden) document.title = `● ${t().titleTurn} — ${t().appName}`; }
    if (!this.myTurn) document.title = `${t().appName} — a tile rummy game`;
    this.wasMyTurn = this.myTurn;

    this.render();
    for (const id of drawn) {
      const el = this.tileEls.get(id);
      if (!el) continue;
      el.classList.add('drawn');
      setTimeout(() => el.classList.remove('drawn'), 4000);
    }
    for (const id of fresh) {
      const el = this.tileEls.get(id);
      if (!el) continue;
      el.classList.remove('fresh'); void el.offsetWidth; el.classList.add('fresh');
      setTimeout(() => el.classList.remove('fresh'), 2700);
    }
    if (s.phase === 'over' && this.modalOpen !== 'over') this.showRoundOver();
  }

  private happened(e: LogEntry, s: GameState) {
    const name = (p: number) => (p === this.seat ? (lang() === 'de' ? 'Du' : 'You') : s.players[p]?.name ?? '?');
    switch (e.k) {
      case 'play':
        if (e.p !== this.seat) sfx.place();
        if (e.rollover) { setTimeout(() => { this.banner(t().rollover); sfx.rollover(); this.kitty.rollover(); }, 350); }
        else if (e.p === this.seat) this.kitty.happy();
        else if (e.opened && e.p !== this.seat) this.toast(t().log.open(name(e.p)));
        break;
      case 'draw': if (e.p !== this.seat) sfx.draw(); break;
      case 'pass': this.toast(t().log.pass(name(e.p))); break;
      case 'star': {
        const card = t().star[e.star];
        setTimeout(() => { this.starCard(card.title, card.body(name(e.p), name(e.target))); sfx.star(); }, 500);
        break;
      }
      case 'win': setTimeout(() => { sfx.win(); if (s.players[e.p]?.kind === 'human') this.kitty.party(); }, 300); break;
      default: break;
    }
  }

  // --------------------------------------------------------------- render --

  render() {
    const s = this.s;
    if (!s || !this.el.isConnected) return;
    this.syncRack();
    if (this.pendingSort && this.myRack.length) { this.pendingSort = false; this.arrangeRack('melds'); }
    this.measure();
    const board = this.displayBoard();
    const mine = this.myTurn;
    this.boardEl.classList.toggle('mine', mine);
    this.rackEl.style.setProperty('--rrows', String(this.rackRows));
    this.rackEl.innerHTML = Array.from({ length: this.rackRows }, (_, r) => `<div class="ledge" style="top:${9 + (r + 1) * (this.rth + this.gap) - 3}px"></div>`).join('');

    // segment outlines while a turn is being built (mine, or the one I'm watching)
    const watching = board !== s.board;
    const check = checkBoard(board, s.tiles, s.rules);
    const startIds = new Set(s.board.map((p) => p.id));
    let lit = false;
    this.boardEl.innerHTML = watching || mine ? check.segs.map((g, i) => {
      const xy = this.cellXY('board', g.r, g.c);
      const o = this.origin('board');
      const x = xy.x - (o.box.left - o.host.left) - this.boardEl.clientLeft - 3, y = xy.y - (o.box.top - o.host.top) - this.boardEl.clientTop - 3;
      // a meld that just became valid with one of my tiles in it lights up once
      const key = [...g.ids].sort((a, b) => a - b).join(',');
      let pulse = '';
      if (mine && g.eval.ok && g.ids.some((id) => !startIds.has(id)) && !this.validKeys.has(key)) { this.validKeys.add(key); pulse = ' pulse'; lit = true; }
      const why = mine && !g.eval.ok ? meldProblem(g.ids.map((id) => s.tiles[id]), s.rules) : null;
      const grip = mine && !this.drag?.active ? `<div class="grip" data-seg="${i}" title="${esc(t().gripTip)}" style="left:${x - 13}px;top:${y + 3}px;height:${this.th}px"></div>` : '';
      return `<div class="seg ${g.eval.ok ? 'ok' : 'bad'}${g.eval.wraps ? ' wrap' : ''}${pulse}" style="left:${x}px;top:${y}px;width:${g.ids.length * (this.tw + this.gap) - this.gap + 6}px;height:${this.th + 6}px">${why ? `<span class="why">${esc(t().problem[why])}</span>` : ''}</div>${grip}`;
    }).join('') : '';
    if (lit) { sfx.meld(); this.kitty.happy(); }
    // runs and groups sitting together on the rack glow, so you can see what you could lay — one tap lays them
    const rackSegs = checkBoard([...this.rackPos].filter(([id]) => this.rackIds().includes(id)).map(([id, p]) => ({ id, r: p.r, c: p.c })), s.tiles, s.rules).segs;
    const ro = this.origin('rack');
    const okSegs = rackSegs.filter((g) => g.eval.ok);
    this.rackEl.innerHTML += okSegs.map((g) => {
      const xy = this.cellXY('rack', g.r, g.c);
      const x = xy.x - (ro.box.left - ro.host.left) - this.rackEl.clientLeft - 3, y = xy.y - (ro.box.top - ro.host.top) - this.rackEl.clientTop - 3;
      return `<div class="seg ok rackseg${g.eval.wraps ? ' wrap' : ''}" style="left:${x}px;top:${y}px;width:${g.ids.length * (this.rtw + this.gap) - this.gap + 6}px;height:${this.rth + 6}px"></div>`;
    }).join('');
    if (!this.drag?.active) {
      const spots = this.hint && mine ? this.hint.board.filter((p) => this.hint!.played.includes(p.id)).map((p) => {
        const xy = this.cellXY('board', p.r, p.c);
        return `<div class="ghost hintspot" style="left:${xy.x - 2}px;top:${xy.y - 2}px;width:${this.tw + 4}px;height:${this.th + 4}px"></div>`;
      }).join('') : '';
      this.overlay.innerHTML = spots + okSegs.map((g) => {
        const xy = this.cellXY('rack', g.r, g.c);
        const label = `${g.eval.kind === 'group' ? t().kindGroup : t().kindRun} · ${g.eval.value}`;
        return mine
          ? `<button class="lay${g.eval.wraps ? ' wrap' : ''}" data-act="lay" data-ids="${g.ids.join(',')}" title="${esc(t().layTip)}" style="left:${xy.x}px;top:${xy.y - 11}px">${esc(label)} ${icon('arrowUp', 11, 3)}</button>`
          : `<span class="lay idle${g.eval.wraps ? ' wrap' : ''}" style="left:${xy.x}px;top:${xy.y - 11}px">${esc(label)}</span>`;
      }).join('');
    }

    // tiles
    const want = new Map<number, { x: number; y: number; area: Area }>();
    for (const p of board) want.set(p.id, { ...this.cellXY('board', p.r, p.c), area: 'board' });
    for (const id of this.rackIds()) {
      const p = this.rackPos.get(id)!;
      want.set(id, { ...this.cellXY('rack', p.r, p.c), area: 'rack' });
    }
    const tableAtStart = new Set(s.board.map((p) => p.id));
    for (const [id, el] of this.tileEls) if (!want.has(id)) { el.remove(); this.tileEls.delete(id); }
    for (const [id, pos] of want) {
      let el = this.tileEls.get(id);
      const tile = s.tiles[id];
      if (!el) {
        el = document.createElement('div');
        el.className = tileClass(tile);
        el.innerHTML = tileHTML(tile);
        el.dataset.id = String(id);
        // new tiles fly in from whoever produced them
        const from = this.spawnPoint(id, pos.area);
        el.style.setProperty('--pos', `translate(${from.x}px, ${from.y}px)`);
        this.layer.appendChild(el);
        this.tileEls.set(id, el);
        void el.offsetWidth;
      }
      if (this.drag?.active && this.drag.group.includes(id)) continue;
      el.style.setProperty('--pos', `translate(${pos.x}px, ${pos.y}px)`);
      const movable = pos.area === 'rack' || (mine && pos.area === 'board');
      el.classList.toggle('locked', !movable);
      el.classList.toggle('onrack', pos.area === 'rack');
      el.classList.toggle('sel', this.selected.has(id));
      el.classList.toggle('hint', !!this.hint && this.hint.played.includes(id) && pos.area === 'rack');
      el.classList.toggle('ghosted', pos.area === 'board' && watching && !mine && !tableAtStart.has(id));
      el.title = '';
    }

    this.renderChrome(s, board, check.ok);
  }

  private spawnPoint(id: number, area: Area) {
    const s = this.s!;
    const host = this.el.getBoundingClientRect();
    if (area === 'rack') {
      const pool = this.el.querySelector('[data-ref="pool"]')!.getBoundingClientRect();
      return { x: pool.left - host.left, y: pool.top - host.top };
    }
    const owner = s.players.findIndex((p) => p.rack.includes(id));
    const chip = this.el.querySelector(`[data-seat="${owner >= 0 ? owner : s.turn}"]`)?.getBoundingClientRect();
    return chip ? { x: chip.left - host.left + chip.width / 2, y: chip.top - host.top } : { x: host.width / 2, y: -60 };
  }

  private renderChrome(s: GameState, board: Placed[], valid: boolean) {
    const tt = t();
    const startIds = new Set(s.board.map((p) => p.id));
    const openingValue = checkBoard(board, s.tiles, s.rules).segs
      .filter((g) => g.ids.every((id) => !startIds.has(id)) && g.eval.ok)
      .reduce((a, g) => a + g.eval.value, 0);
    const lobby = this.client.lobby;
    const players = this.el.querySelector('[data-ref="players"]')!;
    players.innerHTML = s.players.map((p, i) => {
      const seatInfo = lobby?.seats.find((x) => x.id === p.id);
      const offline = p.kind === 'human' && seatInfo && !seatInfo.online;
      const label = p.kind === 'ai' ? icon('bot', 15) : '';
      return `<div class="chip${s.turn === i && s.phase === 'playing' ? ' turn' : ''}" data-seat="${i}" title="${esc(p.name)} — ${esc(tt.tilesCount(p.rack.length))}">
        ${label}<span>${esc(p.name)}${i === this.seat ? ` <span class="cnt">(${tt.you})</span>` : ''}${p.kind === 'ai' && s.turn === i && s.phase === 'playing' ? '<span class="dots"></span>' : ''}</span>
        <span class="cnt">${p.rack.length}</span>${p.score ? `<span class="sc">${p.score > 0 ? '+' : ''}${p.score}</span>` : ''}
        ${offline ? `<span class="off">${icon('wifiOff', 13)}</span>` : ''}</div>`;
    }).join('');
    (this.el.querySelector('[data-ref="poolN"]') as HTMLElement).textContent = String(s.pool.length);

    // status line
    const status = this.el.querySelector('[data-ref="status"]') as HTMLElement;
    const cur = s.players[s.turn];
    let html = '';
    if (this.client.status === 'lost') html = `<span style="color:var(--warn)">${esc(tt.hostLost)}</span>`;
    else if (s.phase === 'over') html = esc(tt.roundOver);
    else if (this.myTurn) {
      html = esc(tt.yourTurn);
      const me = s.players[this.seat];
      const laid = board.filter((p) => !startIds.has(p.id)).length;
      if (laid && !valid) html += `<span class="sub bad">${esc(tt.fixRed)}</span>`;
      else if (!me.opened && openingValue < s.rules.openingMin) html += `<span class="sub">${esc(tt.openHint(openingValue, s.rules.openingMin))}</span>`;
      else if (laid) html += `<span class="sub ok">${esc(tt.readyDone)}</span>`;
      else if (!me.opened) html += `<span class="sub">${esc(tt.openHint(0, s.rules.openingMin))}</span>`;
    } else if (this.client.host?.isWaitingOn()) {
      html = `<span style="color:var(--warn)">${esc(tt.offlineWait(cur.name))}</span> <button class="btn sm" data-act="playFor" title="${esc(tt.playForTip)}">${icon('bot', 15)}${esc(tt.playFor(cur.name))}</button>`;
    } else html = esc(cur.kind === 'ai' ? tt.thinking(cur.name) : tt.theirTurn(cur.name));
    status.innerHTML = html;
    status.classList.toggle('mine', this.myTurn);

    // revealed racks (star tiles, or the end of a round)
    const reveals = this.el.querySelector('[data-ref="reveals"]') as HTMLElement;
    reveals.innerHTML = s.phase === 'playing' ? s.players.map((p, i) => {
      if (i === this.seat || p.rack.length === 0 || p.rack[0] < 0) return '';
      return `<div class="reveal" title="${esc(tt.seeRack(p.name))}">${icon('eye', 14)} ${esc(tt.seeRack(p.name))}
        <span class="mini">${p.rack.map((id) => `<span class="${tileClass(s.tiles[id])}">${tileHTML(s.tiles[id])}</span>`).join('')}</span></div>`;
    }).join('') : '';

    // buttons
    const btn = (a: string) => this.el.querySelector(`[data-act="${a}"]`) as HTMLButtonElement;
    // one obvious next step: Draw while nothing is laid, Done once something is
    const laid = this.myTurn ? board.filter((p) => !startIds.has(p.id)).length : 0;
    const me = s.players[this.seat];
    const ready = laid > 0 && valid && (me?.opened || openingValue >= s.rules.openingMin);
    btn('undo').disabled = !this.myTurn || !this.draftDiffers();
    btn('hint').disabled = !this.myTurn;
    const waiting = this.sentSeq === s.seq;
    btn('draw').disabled = !this.myTurn || waiting;
    btn('draw').classList.toggle('primary', laid === 0);
    btn('done').hidden = laid === 0;
    btn('done').disabled = !this.myTurn || !ready || waiting;
    const drawLabel = this.el.querySelector('[data-ref="drawLabel"]') as HTMLElement;
    drawLabel.textContent = s.pool.length ? tt.draw : tt.pass;
    // the kitten sits on the rack's top-right corner, awake for your turn and for the end of a round
    const host = this.el.getBoundingClientRect(), rk = this.rackEl.getBoundingClientRect();
    this.kitty.place(rk.right - host.left - 92, rk.top - host.top - 64);
    this.kitty.setAwake(this.myTurn || s.phase === 'over');
    btn('draw').title = s.pool.length ? tt.drawTip : tt.passTip;
  }

  private draftDiffers(): boolean {
    const s = this.s;
    if (!s || !this.draft) return false;
    if (this.draft.length !== s.board.length) return true;
    const at = new Map(s.board.map((p) => [p.id, cellKey(p.r, p.c)]));
    return this.draft.some((p) => at.get(p.id) !== cellKey(p.r, p.c));
  }

  // -------------------------------------------------------------- actions --

  private act(a: string, b: HTMLElement) {
    const s = this.s;
    switch (a) {
      case 'leave': this.onLeave(); return;
      case 'help': this.showHelp(); return;
      case 'lang': setLang(lang() === 'en' ? 'de' : 'en'); this.build(); this.render(); return;
      case 'sound': setMuted(!isMuted()); b.innerHTML = icon(isMuted() ? 'mute' : 'sound'); return;
      case 'react': this.reactionPicker(b); return;
      case 'tiles': this.finishPicker(b); return;
      case 'lay': this.layMeld((b.dataset.ids ?? '').split(',').map(Number).filter((n) => !Number.isNaN(n))); return;
      case 'music': setMusic(!musicOn()); b.classList.toggle('on', musicOn()); return;
      case 'playFor': { const id = s?.players[s.turn].id; if (id) this.client.host?.playFor(id); return; }
      case 'sortRuns': this.sortRack('runs'); return;
      case 'sortMelds': this.sortRack('melds'); return;
      case 'sortGroups': this.sortRack('groups'); return;
      case 'next': this.client.host?.nextRound(); return;
      case 'closeModal': this.closeModal(); return;
      case 'showMe': {
        if (!this.hint || !this.myTurn) return;
        const played = this.hint.played;
        this.draft = this.hint.board.map((p) => ({ ...p }));
        this.hint = null;
        this.sendDraft();
        this.render();
        sfx.place();
        // what changed glows, and the next step is right there in the message
        for (const id of played) {
          const el = this.tileEls.get(id);
          if (!el) continue;
          el.classList.add('drawn', 'boing');
          setTimeout(() => el.classList.remove('drawn', 'boing'), 5000);
        }
        this.toast(t().laidForYou(played.length), false,
          `<button class="btn sm" data-act="undo" title="${esc(t().undoTip)}">${icon('undo', 15)}${t().undo}</button><button class="btn sm primary" data-act="done" title="${esc(t().doneTip)}">${icon('check', 15)}${t().done}</button>`, true);
        return;
      }
    }
    if (!s || !this.myTurn) return;
    switch (a) {
      case 'undo':
        this.clearToast();
        this.draft = s.board.map((p) => ({ ...p }));
        this.selected.clear();
        this.sendDraft();
        this.render();
        break;
      case 'hint': {
        this.hint = chooseMove(s, this.seat, 3, 80000);
        if (!this.hint) this.toast(t().hintNone);
        else this.toast(t().hintSome(this.hint.played.length), false, `<button class="btn sm primary" data-act="showMe" title="${esc(t().showMeTip)}">${t().showMe}</button>`, true);
        this.render();
        break;
      }
      case 'draw':
        this.draft = s.board.map((p) => ({ ...p }));
        this.selected.clear();
        sfx.draw();
        this.client.send({ t: 'draw', seq: s.seq });
        this.sentSeq = s.seq;
        this.render();
        break;
      case 'done':
        if (!this.draft) return;
        this.clearToast();
        this.selected.clear();
        this.client.send({ t: 'commit', board: this.draft, seq: s.seq });
        this.sentSeq = s.seq;
        this.render();
        break;
    }
  }

  private sortRack(mode: 'runs' | 'groups' | 'melds') {
    this.arrangeRack(mode);
    sfx.pick();
    this.render();
  }

  private arrangeRack(mode: 'runs' | 'groups' | 'melds') {
    const s = this.s;
    if (!s) return;
    if (mode === 'melds') { this.arrangeMelds(); return; }
    const ids = this.rackIds().map((id) => s.tiles[id]);
    const key = (x: Tile) => (x.joker ? 1000 : mode === 'runs' ? x.color * 20 + x.num : x.num * 10 + x.color);
    ids.sort((a, b) => key(a) - key(b) || a.id - b.id);
    // lay out row by row, with a gap between colors (runs) or numbers (groups) when it fits
    const bucket = (x: Tile) => (x.joker ? 99 : mode === 'runs' ? x.color : x.num);
    const buckets = new Set(ids.map(bucket)).size;
    const withGaps = ids.length + buckets - 1 <= this.rackRows * this.rackCols;
    this.rackPos.clear();
    let r = 0, c = 0, prev: number | null = null;
    for (const x of ids) {
      if (withGaps && prev !== null && bucket(x) !== prev && c > 0) c++;
      if (c >= this.rackCols) { r++; c = 0; }
      this.rackPos.set(x.id, { r, c });
      c++;
      prev = bucket(x);
    }
    this.saveRack();
  }

  /** Every run and group the rack can make, each kept together, then the leftovers in color order. */
  private arrangeMelds() {
    const s = this.s!;
    const onTable = new Set(this.displayBoard().map((p) => p.id));
    const { melds, rest } = rackMelds(s, this.seat);
    const lines = melds.map((m) => m.filter((id) => !onTable.has(id))).filter((m) => m.length);
    const left = rest.filter((id) => !onTable.has(id)).sort((a, b) => {
      const x = s.tiles[a], y = s.tiles[b];
      return (x.joker ? 99 : x.color * 20 + x.num) - (y.joker ? 99 : y.color * 20 + y.num);
    });
    this.rackPos.clear();
    let r = 0, c = 0;
    const put = (ids: number[], gapAfter: boolean) => {
      if (c > 0 && c + ids.length > this.rackCols) { r++; c = 0; }
      ids.forEach((id) => { if (c >= this.rackCols) { r++; c = 0; } this.rackPos.set(id, { r, c: c++ }); });
      if (gapAfter) c++;
    };
    for (const m of lines) put(m, true);
    if (lines.length && left.length && c > 0) { r++; c = 0; } // leftovers start on their own row
    put(left, false);
    this.rackRows = Math.max(this.rackRows, r + 1);
    this.saveRack();
  }

  private sendDraft() {
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => {
      const s = this.s;
      if (s && this.draft && this.myTurn) this.client.send({ t: 'draft', board: this.draft, seq: s.seq });
    }, 120);
  }

  // ---------------------------------------------------------- drag & drop --

  private holdTimer: ReturnType<typeof setTimeout> | null = null;

  /** The meld a tile sits in — on the table, or side by side on the rack. Only the tiles that belong together
   *  (a meld, or a pair that could start one); a tile that merely touches them stays put (2026-10-02). */
  private meldOf(id: number): number[] {
    const onBoard = this.displayBoard().some((p) => p.id === id);
    const cells = onBoard
      ? this.displayBoard()
      : this.rackIds().map((x) => ({ id: x, ...this.rackPos.get(x)! }));
    const ids = segments(cells).find((g) => g.ids.includes(id))?.ids ?? [id];
    const [a, b] = meldAround(ids.map((x) => this.s!.tiles[x]), ids.indexOf(id), this.s!.rules);
    return ids.slice(a, b);
  }

  private onDown = (e: PointerEvent) => {
    const el = (e.target as HTMLElement).closest('.tile') as HTMLElement | null;
    if (!el || this.drag || e.button > 0) return;
    const id = Number(el.dataset.id);
    const onBoard = this.displayBoard().some((p) => p.id === id);
    if (onBoard && !this.myTurn) return;
    if (!onBoard && !this.myRack.includes(id)) return;
    const r = el.getBoundingClientRect();
    this.drag = { id, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, grabX: e.clientX - r.left, grabY: e.clientY - r.top, w: r.width, h: r.height, group: [id], active: false };
    e.preventDefault();
    // press and hold: the whole meld lifts and moves as one
    if (this.holdTimer) clearTimeout(this.holdTimer);
    const d = this.drag;
    this.holdTimer = setTimeout(() => {
      if (this.drag !== d || d.active) return;
      const meld = this.meldOf(id).filter((x) => onBoard || this.myRack.includes(x));
      if (meld.length < 2) return;
      d.group = meld;
      d.forced = true;
      this.selected = new Set(meld);
      for (const x of meld) this.tileEls.get(x)?.classList.add('sel');
      sfx.pick();
      try { navigator.vibrate?.(12); } catch { /* not supported */ }
    }, 420);
  };

  /** Tap tiles, then tap an empty spot: they move there — no dragging needed. */
  private onAreaTap = (e: MouseEvent) => {
    if (!this.selected.size || (e.target as HTMLElement).closest('.grip')) return;
    const tgt = this.hitTest(e.clientX, e.clientY);
    if (!tgt) return;
    const ids = this.orderedSelection().filter((id) => this.displayBoard().some((p) => p.id === id) ? this.myTurn : this.myRack.includes(id));
    if (!ids.length) return;
    if (this.drop(tgt.area, tgt.r, tgt.c, ids)) { sfx.place(); this.selected.clear(); }
    this.render();
  };

  /** The handle on the left of a meld picks up the whole meld. */
  private onGripDown = (e: PointerEvent) => {
    const grip = (e.target as HTMLElement).closest('.grip') as HTMLElement | null;
    if (!grip || this.drag || !this.myTurn) return;
    const seg = checkBoard(this.displayBoard(), this.s!.tiles, this.s!.rules).segs[Number(grip.dataset.seg)];
    if (!seg) return;
    const first = this.tileEls.get(seg.ids[0]);
    if (!first) return;
    const r = first.getBoundingClientRect();
    this.selected = new Set(seg.ids);
    this.drag = { id: seg.ids[0], pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, grabX: e.clientX - r.left, grabY: e.clientY - r.top, w: r.width, h: r.height, group: seg.ids, active: false, forced: true };
    e.preventDefault();
  };

  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return;
      if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null; }
      d.active = true;
      if (!d.forced) {
        d.group = this.selected.has(d.id) ? this.orderedSelection() : [d.id];
        if (!d.group.includes(d.id)) d.group = [d.id];
      }
      for (const id of d.group) this.tileEls.get(id)?.classList.add('dragging');
      sfx.pick();
    }
    const host = this.el.getBoundingClientRect();
    const idx = d.group.indexOf(d.id);
    d.group.forEach((id, i) => {
      const el = this.tileEls.get(id);
      if (!el) return;
      const x = e.clientX - host.left - d.grabX + (i - idx) * (d.w + this.gap);
      const y = e.clientY - host.top - d.grabY;
      el.style.setProperty('--pos', `translate(${x}px, ${y}px) rotate(${(i - idx) * 0.6 + 1.5}deg) scale(1.06)`);
    });
    const tgt = this.hitTest(e.clientX - d.grabX - idx * (d.w + this.gap) + d.w / 2, e.clientY - d.grabY + d.h / 2);
    this.showGhost(tgt?.area ?? null, tgt?.r ?? 0, tgt?.c ?? 0, d.group);
  };

  private onUp = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.drag = null;
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null; }
    if (!d.active) { if (d.forced) this.render(); else this.tapped(d.id); return; }
    for (const id of d.group) this.tileEls.get(id)?.classList.remove('dragging');
    this.showGhost(null, 0, 0, []);
    const idx = d.group.indexOf(d.id);
    // where the first tile of the line lands
    const left = e.clientX - d.grabX - idx * (d.w + this.gap) + d.w / 2;
    const top = e.clientY - d.grabY + d.h / 2;
    const target = this.hitTest(left, top);
    if (!target || !this.drop(target.area, target.r, target.c, d.group)) {
      for (const id of d.group) { const el = this.tileEls.get(id); el?.classList.add('shake'); setTimeout(() => el?.classList.remove('shake'), 400); }
    } else {
      sfx.place();
      this.selected.clear();
    }
    this.render();
    for (const id of d.group) {
      const el = this.tileEls.get(id);
      if (!el) continue;
      el.classList.remove('boing'); void el.offsetWidth; el.classList.add('boing');
      setTimeout(() => el.classList.remove('boing'), 520);
    }
  };

  private orderedSelection(): number[] {
    const board = new Map(this.displayBoard().map((p) => [p.id, p]));
    const pos = (id: number) => {
      const b = board.get(id);
      if (b) return b.r * 100 + b.c;
      const r = this.rackPos.get(id);
      return 10000 + (r ? r.r * 100 + r.c : 0);
    };
    return [...this.selected].sort((a, b) => pos(a) - pos(b));
  }

  private hitTest(x: number, y: number): { area: Area; r: number; c: number } | null {
    for (const area of ['board', 'rack'] as Area[]) {
      const box = (area === 'board' ? this.boardEl : this.rackEl).getBoundingClientRect();
      if (x < box.left - 20 || x > box.right + 20 || y < box.top - 20 || y > box.bottom + 20) continue;
      const pad = area === 'board' ? 14 : 10;
      const z = this.size(area);
      const c = Math.floor((x - box.left - pad) / (z.w + this.gap));
      const r = Math.floor((y - box.top - (area === 'board' ? 14 : 9)) / (z.h + this.gap));
      const rows = area === 'board' ? BOARD_ROWS : this.rackRows;
      const cols = area === 'board' ? BOARD_COLS : this.rackCols;
      return { area, r: Math.max(0, Math.min(rows - 1, r)), c: Math.max(0, Math.min(cols - 1, c)) };
    }
    return null;
  }

  /** Puts `ids` in a line starting at (r, c), nudging neighbors aside when needed. */
  /** Works out where `ids` would land at (r, c), nudging neighbors aside — without changing anything. */
  private planDrop(area: Area, r: number, c: number, ids: number[]): { ok: true; c: number; moves: Map<number, number> } | { ok: false; why?: string } {
    const s = this.s!;
    const tableAtStart = new Set(s.board.map((p) => p.id));
    if (area === 'board' && (!this.myTurn || !this.draft)) return { ok: false };
    if (area === 'rack' && ids.some((id) => tableAtStart.has(id))) return { ok: false, why: t().errors['tiles-missing'] };
    const cols = area === 'board' ? BOARD_COLS : this.rackCols;
    const n = ids.length;
    if (n > cols) return { ok: false };
    c = Math.max(0, Math.min(c, cols - n));
    const moving = new Set(ids);
    const cells = new Map<number, number>(); // cellKey -> id, without the moving tiles
    if (area === 'board') for (const p of this.draft!) { if (!moving.has(p.id)) cells.set(cellKey(p.r, p.c), p.id); }
    else for (const [id, p] of this.rackPos) { if (!moving.has(id)) cells.set(cellKey(p.r, p.c), id); }
    const free = (cc: number) => !cells.has(cellKey(r, cc));

    // tiles in this row from c onward make room; melds that were apart stay apart
    const moves = new Map<number, number>();
    let ok = true;
    for (let k = 0; k < n; k++) if (!free(c + k)) ok = false;
    if (!ok) {
      const row = [...cells.entries()]
        .map(([key, id]) => ({ id, col: key % 1000, r: Math.floor(key / 1000) }))
        .filter((x) => x.r === r && x.col >= c)
        .sort((x, y) => x.col - y.col);
      let prevOld = -1, prevNew = c + n - 1;
      ok = true;
      for (const x of row) {
        const touching = prevOld >= 0 ? x.col === prevOld + 1 : true;
        const need = prevOld < 0 ? prevNew + 1 : touching ? prevNew + 1 : prevNew + 2;
        const col = Math.max(x.col, need);
        if (col >= cols) { ok = false; break; }
        if (col !== x.col) moves.set(x.id, col);
        prevOld = x.col; prevNew = col;
      }
    }
    if (!ok) return { ok: false };
    // before your opening the table must stay exactly as it is, so its tiles are never pushed aside
    const opened = s.players[this.seat].opened;
    if (area === 'board' && !opened && [...moves.keys()].some((id) => tableAtStart.has(id))) {
      return { ok: false, why: t().errors['opening-touched-table'] };
    }
    // dropped in between tiles where the line only becomes legal split in two (or three): split it (2026-10-02)
    if (area === 'board') {
      const after = this.boardAfter(r, c, ids, moves);
      const seg = segments(after).find((x) => x.ids.includes(ids[0]));
      const from = seg ? seg.ids.indexOf(ids[0]) : -1;
      const cuts = seg ? legalSplit(seg.ids.map((id) => s.tiles[id]), from, from + n, s.rules) : null;
      if (seg && cuts) {
        const col = relayRow(after.filter((p) => p.r === r), new Set(cuts.map((k) => seg.ids[k])), cols);
        const was = new Map(this.draft!.map((p) => [p.id, p.c]));
        const split = new Map<number, number>();
        if (col) for (const [id, nc] of col) if (!moving.has(id) && nc !== was.get(id)) split.set(id, nc);
        if (col && (opened || ![...split.keys()].some((id) => tableAtStart.has(id)))) {
          return { ok: true, c: col.get(ids[0])!, moves: split };
        }
      }
    }
    return { ok: true, c, moves };
  }

  /** The table as it would be after the planned drop. */
  private boardAfter(r: number, c: number, ids: number[], moves: Map<number, number>): Placed[] {
    const moving = new Set(ids);
    const board = this.draft!.filter((p) => !moving.has(p.id)).map((p) => (moves.has(p.id) ? { ...p, c: moves.get(p.id)! } : p));
    ids.forEach((id, k) => board.push({ id, r, c: c + k }));
    return board;
  }

  private drop(area: Area, r: number, c: number, ids: number[]): boolean {
    const plan = this.planDrop(area, r, c, ids);
    if (!plan.ok) { if (plan.why) this.toast(plan.why, true); return false; }
    const moving = new Set(ids);
    // a line that loses tiles closes up when the rest is legal only together (a group of four, minus one)
    const s = this.s!;
    const keep = s.players[this.seat].opened ? new Set<number>() : new Set(s.board.map((p) => p.id));
    const tidy = (before: Placed[], after: Placed[]) => closeUp(before, after, moving, s.tiles, s.rules, keep);
    if (area === 'board') {
      this.draft = tidy(this.draft!, this.boardAfter(r, plan.c, ids, plan.moves));
      for (const id of ids) this.rackPos.delete(id);
      this.sendDraft();
    } else {
      for (const [id, col] of plan.moves) this.rackPos.set(id, { r, c: col });
      ids.forEach((id, k) => this.rackPos.set(id, { r, c: plan.c + k }));
      if (this.draft && ids.some((id) => this.draft!.some((p) => p.id === id))) {
        this.draft = tidy(this.draft, this.draft.filter((p) => !moving.has(p.id)));
        this.sendDraft();
      }
      this.saveRack();
    }
    return true;
  }

  /** While dragging: a ghost where the tiles will land, glowing if the meld they make is valid. */
  private showGhost(area: Area | null, r: number, c: number, ids: number[]) {
    const g = this.overlay.querySelector('.ghost') as HTMLElement | null;
    if (!area) { g?.remove(); return; }
    const plan = this.planDrop(area, r, c, ids);
    if (!plan.ok) { g?.remove(); return; }
    let state = 'neutral';
    if (area === 'board') {
      const s = this.s!;
      const seg = segments(this.boardAfter(r, plan.c, ids, plan.moves)).find((x) => x.ids.includes(ids[0]));
      if (seg) state = checkBoard(seg.ids.map((id, i) => ({ id, r: 0, c: i })), s.tiles, s.rules).ok ? 'ok' : seg.ids.length < 3 ? 'neutral' : 'bad';
    }
    const z = this.size(area);
    const xy = this.cellXY(area, r, plan.c);
    const el = g ?? document.createElement('div');
    el.className = `ghost ${state}`;
    el.style.cssText = `left:${xy.x - 2}px;top:${xy.y - 2}px;width:${ids.length * (z.w + this.gap) - this.gap + 4}px;height:${z.h + 4}px`;
    if (!g) this.overlay.appendChild(el);
  }

  /** One tap on a rack meld's label lays the whole meld on the table. */
  private layMeld(ids: number[]) {
    const s = this.s;
    if (!s || !this.myTurn || !this.draft) return;
    const occupied = new Set(this.draft.map((p) => cellKey(p.r, p.c)));
    const spot = findSpot(occupied, ids.length);
    if (!spot) return;
    if (!this.drop('board', spot.r, spot.c, ids)) return;
    sfx.place();
    this.render();
    for (const id of ids) {
      const el = this.tileEls.get(id);
      if (!el) continue;
      el.classList.remove('boing'); void el.offsetWidth; el.classList.add('boing');
      setTimeout(() => el.classList.remove('boing'), 520);
    }
  }

  private tapped(id: number) {
    const now = Date.now();
    const onBoard = this.displayBoard().find((p) => p.id === id);
    if (onBoard && this.lastClick.id === id && now - this.lastClick.at < 380) {
      // double tap on the table picks up the whole meld
      this.selected = new Set(this.meldOf(id));
      this.lastClick = { id: -1, at: 0 };
    } else {
      if (this.selected.has(id)) this.selected.delete(id); else this.selected.add(id);
      this.lastClick = { id, at: now };
    }
    sfx.pick();
    this.render();
  }

  // ------------------------------------------------------------ overlays --

  private toastEl: HTMLElement | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private toast(text: string, warn = false, extra = '', sticky = false) {
    this.clearToast();
    const el = document.createElement('div');
    el.className = 'toast' + (warn ? ' warn' : '');
    el.innerHTML = `<span>${esc(text)}</span>${extra ? ' ' + extra : ''}`;
    if (extra) el.style.display = 'flex', el.style.gap = '10px', el.style.alignItems = 'center';
    this.el.appendChild(el);
    // sit at the bottom of the table — new melds fill it from the top, and the rack stays visible
    const host = this.el.getBoundingClientRect(), bd = this.boardEl.getBoundingClientRect();
    el.style.top = `${Math.max(64, bd.bottom - host.top - el.offsetHeight - 22)}px`;
    this.toastEl = el;
    if (!sticky) this.toastTimer = setTimeout(() => this.clearToast(), extra ? 9000 : 3800);
  }
  private clearToast() { this.toastEl?.remove(); this.toastEl = null; if (this.toastTimer) clearTimeout(this.toastTimer); }

  private banner(text: string) {
    const el = document.createElement('div');
    el.className = 'banner';
    el.textContent = text;
    this.el.appendChild(el);
    setTimeout(() => el.remove(), 1900);
  }

  private starCard(title: string, body: string) {
    const el = document.createElement('div');
    el.className = 'starcard';
    el.innerHTML = `<div class="big">★</div><h3>${esc(title)}</h3><p>${esc(body)}</p>`;
    this.el.appendChild(el);
    setTimeout(() => el.remove(), 4200);
    el.addEventListener('click', () => el.remove());
  }

  private floatReaction(seat: number, emoji: string) {
    sfx.react();
    const chip = this.el.querySelector(`[data-seat="${seat}"]`)?.getBoundingClientRect();
    const host = this.el.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'float';
    el.textContent = emoji;
    const x = chip ? chip.left - host.left + chip.width / 2 - 22 : host.width / 2;
    const y = chip ? chip.bottom - host.top + 160 : host.height / 2;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    this.el.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  private reactionPicker(anchor: HTMLElement) {
    this.el.querySelector('.popover')?.remove();
    const host = this.el.getBoundingClientRect();
    const r = anchor.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.className = 'popover';
    pop.innerHTML = REACTIONS.map((e) => `<button title="${e}">${e}</button>`).join('');
    pop.style.left = Math.max(8, r.left - host.left - 80) + 'px';
    pop.style.bottom = host.bottom - r.top + 8 + 'px';
    pop.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest('button');
      if (b) this.client.send({ t: 'react', emoji: b.textContent! });
      pop.remove();
    });
    this.el.appendChild(pop);
    setTimeout(() => document.addEventListener('pointerdown', (ev) => { if (!pop.contains(ev.target as Node)) pop.remove(); }, { once: true }), 0);
  }

  private finishPicker(anchor: HTMLElement) {
    this.el.querySelector('.popover')?.remove();
    const host = this.el.getBoundingClientRect();
    const r = anchor.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.className = 'popover finishes';
    const sample: Tile = { id: -1, color: 0, num: 13, joker: false, star: false };
    pop.innerHTML = FINISHES.map((f, i) => `<button class="${f}${f === finish() ? ' on' : ''}" data-finish="${f}" title="${esc(t().finishes[i])}">
      <span class="${tileClass(sample)}" style="position:relative;--tw:30px;--th:40px;--pos:none">${tileHTML(sample)}</span><small>${esc(t().finishes[i])}</small></button>`).join('');
    pop.style.right = Math.max(8, host.right - r.right) + 'px';
    pop.style.top = r.bottom - host.top + 8 + 'px';
    pop.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest('[data-finish]') as HTMLElement | null;
      if (!b) return;
      setFinish(b.dataset.finish!);
      pop.remove();
      sfx.place();
    });
    this.el.appendChild(pop);
    setTimeout(() => document.addEventListener('pointerdown', (ev) => { if (!pop.contains(ev.target as Node)) pop.remove(); }, { once: true }), 0);
  }

  private maybeCoach() {
    try { if (localStorage.getItem('rollover.coached')) return; localStorage.setItem('rollover.coached', '1'); } catch { return; }
    const c = t().coach;
    this.closeModal();
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal coach"><h2>${esc(c.title)}</h2>
      <ol>${c.steps.map(([h, b]) => `<li><b>${esc(h)}</b><span>${esc(b)}</span></li>`).join('')}</ol>
      <p class="msg">${esc(c.tip)}</p>
      <div class="row" style="justify-content:flex-end"><button class="btn primary" data-act="closeModal" title="${esc(c.go)}">${icon('play')}${esc(c.go)}</button></div></div>`;
    this.el.appendChild(back);
    this.modalOpen = 'help';
  }

  private closeModal() { this.el.querySelector('.modal-back')?.remove(); this.modalOpen = null; }

  private showHelp() {
    this.closeModal();
    const h = t().help;
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal"><h2>${esc(h.title)}</h2><ul>${h.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      <div class="row" style="justify-content:flex-end"><button class="btn primary" data-act="closeModal" title="${esc(h.close)}">${esc(h.close)}</button></div></div>`;
    this.el.appendChild(back);
    this.modalOpen = 'help';
  }

  private showRoundOver() {
    const s = this.s!;
    this.closeModal();
    this.modalOpen = 'over';
    const tt = t();
    const w = s.winner ?? 0;
    const stalemate = s.log.some((e) => e.k === 'stalemate');
    const delta = s.roundDelta ?? s.players.map(() => 0);
    const rows = s.players.map((p, i) => `<tr><td>${i === w ? '🏆 ' : ''}${esc(p.name)}
        <div class="mini" style="margin-top:4px">${p.rack.filter((id) => id >= 0).map((id) => `<span class="${tileClass(s.tiles[id])}">${tileHTML(s.tiles[id])}</span>`).join('')}</div></td>
      <td class="${delta[i] >= 0 ? 'pos' : 'neg'}">${delta[i] > 0 ? '+' : ''}${delta[i]}</td><td>${p.score > 0 ? '+' : ''}${p.score}</td></tr>`).join('');
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal"><h2>${esc(w === this.seat ? tt.youWon : tt.wonRound(s.players[w].name))}</h2>
      ${stalemate ? `<p class="msg">${esc(tt.stalemate)}</p>` : ''}
      <table><tr><th></th><th>${tt.thisRound}</th><th>${tt.total}</th></tr>${rows}</table>
      <div class="row" style="justify-content:flex-end">
        <button class="btn" data-act="leave" title="${esc(tt.leaveTip)}">${icon('leave')}${tt.leave}</button>
        ${this.client.isHost ? `<button class="btn primary" data-act="next" title="${esc(tt.nextRoundTip)}">${icon('refresh')}${tt.nextRound}</button>` : `<span class="msg">${esc(tt.waitingNext)}</span>`}
      </div></div>`;
    this.el.appendChild(back);
    if (s.players[w].kind === 'human') confetti(this.el);
    recordWin(s);
  }
}

/** The family scoreboard: rounds won, by name, kept on this device. */
export function recordWin(s: GameState) {
  try {
    const seen = JSON.parse(localStorage.getItem('rollover.scored') || '[]') as string[];
    const key = `${s.gameId}:${s.round}`;
    if (seen.includes(key) || s.winner === null) return;
    seen.push(key);
    localStorage.setItem('rollover.scored', JSON.stringify(seen.slice(-200)));
    const board = JSON.parse(localStorage.getItem('rollover.scores') || '{}') as Record<string, number>;
    const name = s.players[s.winner].name;
    board[name] = (board[name] ?? 0) + 1;
    localStorage.setItem('rollover.scores', JSON.stringify(board));
  } catch { /* storage blocked */ }
}
