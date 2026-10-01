// The game screen: felt table, wooden rack, and every tile as one element in a layer
// above both — so a tile glides from the rack to the table instead of jumping.

import { BOARD_COLS, BOARD_ROWS, checkBoard, cellKey, segments, type Placed } from '../engine/board';
import { chooseMove, type Move } from '../engine/ai';
import type { GameState, LogEntry } from '../engine/game';
import type { Tile } from '../engine/tiles';
import type { Client, ClientEvent } from '../net/client';
import { REACTIONS } from '../net/protocol';
import { t, lang, setLang } from './i18n';
import { icon } from './icons';
import { sfx, isMuted, setMuted } from './sound';
import { confetti } from './fx';

const RACK_ROWS = 2;
export const FINISHES = ['ts-neon', 'ts-chrome', 'ts-wood', '', 'ts-porcelain', 'ts-jade', 'ts-glass', 'ts-clay', 'ts-gummy', 'ts-sugar', 'ts-hardcandy'];
/** Stefanie (2026-09-30): Maple "for now", then "a crisper, more Blade Runner look" — neon is the default;
 *  Maple, the classics and candy stay in the palette. */
export const DEFAULT_FINISH = 'ts-neon';
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
  active: boolean;
}

export function tileHTML(tile: Tile): string {
  const inner = tile.joker
    ? `<span class="jk">${icon('crown', 24, 2.4)}</span>`
    : `<span class="n">${tile.num}</span>`;
  return inner + (tile.star ? '<span class="st">★</span>' : '');
}
export const tileClass = (tile: Tile) => `tile c${tile.color}${tile.joker ? ' joker' : ''}`;

export class GameView {
  private el: HTMLElement;
  private boardEl!: HTMLElement;
  private rackEl!: HTMLElement;
  private layer!: HTMLElement;
  private tileEls = new Map<number, HTMLElement>();
  private draft: Placed[] | null = null;
  private draftKey = '';
  /** The state seq a commit or draw was sent for; buttons wait until the answer arrives. */
  private sentSeq = -1;
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

  destroy() {
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
        <button class="btn icon" data-act="sound" title="${esc(t().soundTip)}">${icon(isMuted() ? 'mute' : 'sound')}</button>
        <button class="btn icon" data-act="leave" title="${esc(t().leaveTip)}">${icon('leave')}</button>
      </header>
      <div class="status" data-ref="status"></div>
      <div class="tablewrap"><div class="board" data-ref="board"></div></div>
      <div class="rotate-hint">${icon('refresh', 14)} ${lang() === 'de' ? 'Dreh dein Gerät quer — dann wird der Tisch größer.' : 'Turn your device sideways for a bigger table.'}</div>
      <div class="reveals" data-ref="reveals"></div>
      <div class="rackwrap"><div class="rack" data-ref="rack"></div></div>
      <div class="actions" data-ref="actions">
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
    `;
    const ref = (n: string) => this.el.querySelector(`[data-ref="${n}"]`) as HTMLElement;
    this.boardEl = ref('board');
    this.rackEl = ref('rack');
    this.layer = ref('layer');
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (b && !(b as HTMLButtonElement).disabled) this.act(b.dataset.act!, b);
    });
    this.layer.addEventListener('pointerdown', this.onDown);
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
      this.selected.clear();
      this.closeModal();
    }
    // a new turn throws away any draft and hint — a brief disconnect does not
    const key = `${s.round}:${s.turnNo}`;
    const mineInState = s.phase === 'playing' && s.turn === this.seat;
    if (mineInState) {
      if (this.draftKey !== key || !this.draft) { this.draft = s.board.map((p) => ({ ...p })); this.hint = null; }
    } else { this.draft = null; this.hint = null; }
    this.draftKey = key;
    if (s.seq !== this.sentSeq) this.sentSeq = -1;

    // what happened since the last update
    const fresh = s.board.filter((p) => !this.prevBoard.has(p.id)).map((p) => p.id);
    this.prevBoard = new Set(s.board.map((p) => p.id));
    for (let i = Math.max(0, this.logSeen); i < s.log.length; i++) this.happened(s.log[i], s);
    this.logSeen = s.log.length;
    if (this.myTurn && !this.wasMyTurn) { sfx.myTurn(); if (document.hidden) document.title = `● ${t().titleTurn} — ${t().appName}`; }
    if (!this.myTurn) document.title = `${t().appName} — a tile rummy game`;
    this.wasMyTurn = this.myTurn;

    this.render();
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
        if (e.rollover) { setTimeout(() => { this.banner(t().rollover); sfx.rollover(); }, 350); }
        else if (e.opened && e.p !== this.seat) this.toast(t().log.open(name(e.p)));
        break;
      case 'draw': if (e.p !== this.seat) sfx.draw(); break;
      case 'pass': this.toast(t().log.pass(name(e.p))); break;
      case 'star': {
        const card = t().star[e.star];
        setTimeout(() => { this.starCard(card.title, card.body(name(e.p), name(e.target))); sfx.star(); }, 500);
        break;
      }
      case 'win': setTimeout(() => sfx.win(), 300); break;
      default: break;
    }
  }

  // --------------------------------------------------------------- render --

  render() {
    const s = this.s;
    if (!s || !this.el.isConnected) return;
    this.syncRack();
    this.measure();
    const board = this.displayBoard();
    const mine = this.myTurn;
    this.boardEl.classList.toggle('mine', mine);
    this.rackEl.style.setProperty('--rrows', String(this.rackRows));
    this.rackEl.innerHTML = Array.from({ length: this.rackRows }, (_, r) => `<div class="ledge" style="top:${9 + (r + 1) * (this.rth + this.gap) - 3}px"></div>`).join('');

    // segment outlines while a turn is being built (mine, or the one I'm watching)
    const watching = board !== s.board;
    const check = checkBoard(board, s.tiles, s.rules);
    this.boardEl.innerHTML = watching || mine ? check.segs.map((g) => {
      const xy = this.cellXY('board', g.r, g.c);
      const o = this.origin('board');
      const x = xy.x - (o.box.left - o.host.left) - this.boardEl.clientLeft - 3, y = xy.y - (o.box.top - o.host.top) - this.boardEl.clientTop - 3;
      return `<div class="seg ${g.eval.ok ? 'ok' : 'bad'}${g.eval.wraps ? ' wrap' : ''}" style="left:${x}px;top:${y}px;width:${g.ids.length * (this.tw + this.gap) - this.gap + 6}px;height:${this.th + 6}px"></div>`;
    }).join('') : '';

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
    const lobby = this.client.lobby;
    const players = this.el.querySelector('[data-ref="players"]')!;
    players.innerHTML = s.players.map((p, i) => {
      const seatInfo = lobby?.seats.find((x) => x.id === p.id);
      const offline = p.kind === 'human' && seatInfo && !seatInfo.online;
      const label = p.kind === 'ai' ? icon('bot', 15) : '';
      return `<div class="chip${s.turn === i && s.phase === 'playing' ? ' turn' : ''}" data-seat="${i}" title="${esc(p.name)} — ${esc(tt.tilesCount(p.rack.length))}">
        ${label}<span>${esc(p.name)}${i === this.seat ? ` <span class="cnt">(${tt.you})</span>` : ''}</span>
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
      if (!me.opened) {
        const before = new Set(s.board.map((p) => p.id));
        const v = checkBoard(board, s.tiles, s.rules).segs
          .filter((g) => g.ids.every((id) => !before.has(id)) && g.eval.ok)
          .reduce((a, g) => a + g.eval.value, 0);
        html += `<span class="sub${v >= s.rules.openingMin ? ' ok' : ''}">${esc(tt.openHint(v, s.rules.openingMin))}</span>`;
      }
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
    const changed = this.myTurn && board.length !== s.board.length;
    btn('undo').disabled = !this.myTurn || !this.draftDiffers();
    btn('hint').disabled = !this.myTurn;
    const waiting = this.sentSeq === s.seq;
    btn('draw').disabled = !this.myTurn || waiting;
    btn('done').disabled = !this.myTurn || !changed || waiting;
    btn('done').classList.toggle('ready', changed && valid);
    const drawLabel = this.el.querySelector('[data-ref="drawLabel"]') as HTMLElement;
    drawLabel.textContent = s.pool.length ? tt.draw : tt.pass;
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
      case 'playFor': { const id = s?.players[s.turn].id; if (id) this.client.host?.playFor(id); return; }
      case 'sortRuns': this.sortRack('runs'); return;
      case 'sortGroups': this.sortRack('groups'); return;
      case 'next': this.client.host?.nextRound(); return;
      case 'closeModal': this.closeModal(); return;
      case 'showMe': if (this.hint && this.myTurn) { this.draft = this.hint.board.map((p) => ({ ...p })); this.hint = null; this.sendDraft(); this.render(); this.clearToast(); } return;
    }
    if (!s || !this.myTurn) return;
    switch (a) {
      case 'undo':
        this.draft = s.board.map((p) => ({ ...p }));
        this.selected.clear();
        this.sendDraft();
        this.render();
        break;
      case 'hint': {
        this.hint = chooseMove(s, this.seat, 3, 80000);
        if (!this.hint) this.toast(t().hintNone);
        else this.toast(t().hintSome(this.hint.played.length), false, `<button class="btn sm primary" data-act="showMe" title="${esc(t().showMeTip)}">${t().showMe}</button>`);
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
        this.selected.clear();
        this.client.send({ t: 'commit', board: this.draft, seq: s.seq });
        this.sentSeq = s.seq;
        this.render();
        break;
    }
  }

  private sortRack(mode: 'runs' | 'groups') {
    const s = this.s;
    if (!s) return;
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
    sfx.pick();
    this.render();
  }

  private sendDraft() {
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => {
      const s = this.s;
      if (s && this.draft && this.myTurn) this.client.send({ t: 'draft', board: this.draft, seq: s.seq });
    }, 120);
  }

  // ---------------------------------------------------------- drag & drop --

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
  };

  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return;
      d.active = true;
      d.group = this.selected.has(d.id) ? this.orderedSelection() : [d.id];
      if (!d.group.includes(d.id)) d.group = [d.id];
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
  };

  private onUp = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.drag = null;
    if (!d.active) { this.tapped(d.id); return; }
    for (const id of d.group) this.tileEls.get(id)?.classList.remove('dragging');
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
  private drop(area: Area, r: number, c: number, ids: number[]): boolean {
    const s = this.s!;
    const tableAtStart = new Set(s.board.map((p) => p.id));
    if (area === 'board' && !this.myTurn) return false;
    if (area === 'rack' && ids.some((id) => tableAtStart.has(id))) {
      this.toast(t().errors['tiles-missing'], true);
      return false;
    }
    if (area === 'board' && !this.draft) return false;
    const cols = area === 'board' ? BOARD_COLS : this.rackCols;
    const n = ids.length;
    if (n > cols) return false;
    c = Math.min(c, cols - n);
    const moving = new Set(ids);

    // current occupancy of the target area without the moving tiles
    const cells = new Map<number, number>(); // cellKey -> id
    if (area === 'board') for (const p of this.draft!) { if (!moving.has(p.id)) cells.set(cellKey(p.r, p.c), p.id); }
    else for (const [id, p] of this.rackPos) { if (!moving.has(id)) cells.set(cellKey(p.r, p.c), id); }
    const free = (cc: number) => !cells.has(cellKey(r, cc));

    // tiles in this row from c onward make room; melds that were apart stay apart
    const moves = new Map<number, number>(); // id -> new column
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
    if (!ok) return false;
    // before your opening the table must stay exactly as it is, so its tiles are never pushed aside
    if (area === 'board' && !s.players[this.seat].opened && [...moves.keys()].some((id) => tableAtStart.has(id))) {
      this.toast(t().errors['opening-touched-table'], true);
      return false;
    }

    if (area === 'board') {
      const board = this.draft!.filter((p) => !moving.has(p.id)).map((p) => (moves.has(p.id) ? { ...p, c: moves.get(p.id)! } : p));
      ids.forEach((id, k) => board.push({ id, r, c: c + k }));
      this.draft = board;
      for (const id of ids) this.rackPos.delete(id);
      this.sendDraft();
    } else {
      for (const [id, col] of moves) this.rackPos.set(id, { r, c: col });
      ids.forEach((id, k) => this.rackPos.set(id, { r, c: c + k }));
      if (this.draft && ids.some((id) => this.draft!.some((p) => p.id === id))) {
        this.draft = this.draft.filter((p) => !moving.has(p.id));
        this.sendDraft();
      }
      this.saveRack();
    }
    return true;
  }

  private tapped(id: number) {
    const now = Date.now();
    const onBoard = this.displayBoard().find((p) => p.id === id);
    if (onBoard && this.lastClick.id === id && now - this.lastClick.at < 380) {
      // double tap on the table picks up the whole meld
      const seg = segments(this.displayBoard()).find((g) => g.ids.includes(id));
      if (seg) { this.selected = new Set(seg.ids); }
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
  private toast(text: string, warn = false, extra = '') {
    this.clearToast();
    const el = document.createElement('div');
    el.className = 'toast' + (warn ? ' warn' : '');
    el.innerHTML = `<span>${esc(text)}</span>${extra ? ' ' + extra : ''}`;
    if (extra) el.style.display = 'flex', el.style.gap = '10px', el.style.alignItems = 'center';
    this.el.appendChild(el);
    this.toastEl = el;
    this.toastTimer = setTimeout(() => this.clearToast(), extra ? 9000 : 3800);
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
