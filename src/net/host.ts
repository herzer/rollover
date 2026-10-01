// The host: owns the real game, checks every move, runs the computer players, and
// tells each player only what they may see.

import { newGame, commitTurn, drawTile, canSee, type GameState, type AiLevel } from '../engine/game';
import { chooseMove, type Move } from '../engine/ai';
import { DEFAULT_RULES, type Rules } from '../engine/melds';
import type { Lobby, SeatInfo, ToClient, ToHost } from './protocol';

type Send = (msg: ToClient) => void;

const SAVE_KEY = 'rollover.host';
const AI_DELAY_MS = 1100;

export function redact(state: GameState, seat: number): GameState {
  const s = structuredClone(state) as GameState;
  s.players.forEach((p, i) => {
    if (!canSee(state, seat, i)) p.rack = p.rack.map(() => -1);
  });
  s.pool = s.pool.map(() => -1);
  return s;
}

export class Host {
  lobby: Lobby;
  state: GameState | null = null;
  private clients = new Map<string, Send>();
  private worker: Worker | null = null;
  private job = 0;
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  onChange: () => void = () => {};

  constructor(hostId: string, hostName: string, code: string | null, saved?: { lobby: Lobby; state: GameState | null }) {
    if (saved) {
      this.lobby = saved.lobby;
      this.state = saved.state;
      this.lobby.seats.forEach((s) => (s.online = s.kind === 'ai'));
    } else {
      this.lobby = {
        code, hostId, started: false,
        rules: { ...DEFAULT_RULES },
        seats: [{ id: hostId, name: hostName, kind: 'human', online: true }],
      };
    }
    try {
      this.worker = new Worker(new URL('../engine/aiWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this.aiDone(e.data.job, e.data.move);
    } catch { this.worker = null; }
  }

  static load(): { lobby: Lobby; state: GameState | null } | null {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; }
  }
  static clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* storage blocked */ } }

  private save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ lobby: this.lobby, state: this.state })); } catch { /* storage blocked */ }
  }

  // ---- connections -------------------------------------------------------

  attach(clientId: string, send: Send) {
    this.clients.set(clientId, send);
  }

  detach(clientId: string) {
    this.clients.delete(clientId);
    const seat = this.lobby.seats.find((s) => s.id === clientId);
    if (seat) { seat.online = false; this.broadcast(); }
  }

  receive(clientId: string, msg: ToHost) {
    const send = this.clients.get(clientId);
    if (msg.t === 'hello') {
      let seat = this.lobby.seats.find((s) => s.id === clientId);
      if (!seat) {
        if (this.lobby.started || this.lobby.seats.length >= 4) { send?.({ t: 'full' }); return; }
        seat = { id: clientId, name: (msg.name || 'Player').slice(0, 20), kind: 'human', online: true };
        this.lobby.seats.push(seat);
      } else if (msg.name) {
        seat.name = msg.name.slice(0, 20);
        if (this.state) { const p = this.state.players.find((p) => p.id === clientId); if (p) p.name = seat.name; }
      }
      seat.online = true;
      this.broadcast();
      return;
    }
    const seatIdx = this.state ? this.state.players.findIndex((p) => p.id === clientId) : -1;
    if (msg.t === 'react') {
      const idx = this.lobby.seats.findIndex((s) => s.id === clientId);
      for (const s of this.clients.values()) s({ t: 'react', seat: seatIdx >= 0 ? seatIdx : idx, emoji: msg.emoji });
      return;
    }
    if (!this.state || seatIdx < 0) return;
    if (msg.t === 'draft') {
      if (this.state.turn !== seatIdx) return;
      for (const [id, s] of this.clients) if (id !== clientId) s({ t: 'draft', seat: seatIdx, board: msg.board, seq: this.state.seq });
      return;
    }
    if (msg.seq !== this.state.seq) { send?.({ t: 'error', error: 'not-your-turn' }); this.sendState(clientId); return; }
    const r = msg.t === 'commit' ? commitTurn(this.state, seatIdx, msg.board) : drawTile(this.state, seatIdx);
    if (!r.ok) { send?.({ t: 'error', error: r.error }); return; }
    this.setState(r.state);
  }

  // ---- lobby (host only) -------------------------------------------------

  addComputer(names: string[]) {
    if (this.lobby.seats.length >= 4) return;
    const used = new Set(this.lobby.seats.map((s) => s.name));
    const name = names.find((n) => !used.has(n)) ?? `Bot ${this.lobby.seats.length}`;
    this.lobby.seats.push({ id: 'ai-' + Math.random().toString(36).slice(2, 8), name, kind: 'ai', level: 2, online: true });
    this.broadcast();
  }
  setLevel(id: string, level: AiLevel) {
    const s = this.lobby.seats.find((x) => x.id === id);
    if (s) s.level = level;
    if (this.state) { const p = this.state.players.find((x) => x.id === id); if (p) p.level = level; }
    this.broadcast();
  }
  removeSeat(id: string) {
    if (this.lobby.started || id === this.lobby.hostId) return;
    this.lobby.seats = this.lobby.seats.filter((s) => s.id !== id);
    this.clients.get(id)?.({ t: 'full' });
    this.broadcast();
  }
  setRules(rules: Partial<Rules>) {
    if (this.lobby.started) return;
    this.lobby.rules = { ...this.lobby.rules, ...rules };
    this.broadcast();
  }
  start() {
    if (this.lobby.seats.length < 2) return;
    this.lobby.started = true;
    this.setState(newGame(this.seatSpecs(), this.lobby.rules));
  }
  nextRound() {
    if (!this.state || this.state.phase !== 'over') return;
    this.setState(newGame(this.seatSpecs(), this.lobby.rules, undefined, this.state));
  }
  private seatSpecs() {
    return this.lobby.seats.map((s: SeatInfo) => ({ id: s.id, name: s.name, kind: s.kind, level: s.level }));
  }

  // ---- state -------------------------------------------------------------

  private setState(s: GameState) {
    this.state = s;
    this.broadcast();
    this.scheduleAi();
  }

  private sendState(clientId: string) {
    const send = this.clients.get(clientId);
    if (!send) return;
    send({ t: 'lobby', lobby: this.lobby });
    if (!this.state) { send({ t: 'state', state: null, seat: -1 }); return; }
    const seat = this.state.players.findIndex((p) => p.id === clientId);
    send({ t: 'state', state: redact(this.state, seat), seat });
  }

  broadcast() {
    this.save();
    for (const id of this.clients.keys()) this.sendState(id);
    this.onChange();
  }

  private scheduleAi() {
    if (this.aiTimer) clearTimeout(this.aiTimer);
    const s = this.state;
    if (!s || s.phase !== 'playing') return;
    const p = s.players[s.turn];
    if (p.kind !== 'ai') return;
    const job = ++this.job;
    this.aiTimer = setTimeout(() => {
      const level = p.level ?? 2;
      const budget = level === 3 ? 150000 : 60000;
      if (this.worker) this.worker.postMessage({ state: s, seat: s.turn, level, budget, job });
      else this.aiDone(job, chooseMove(s, s.turn, level, budget));
    }, AI_DELAY_MS + Math.random() * 900);
  }

  private aiDone(job: number, move: Move | null) {
    if (job !== this.job || !this.state) return;
    const s = this.state;
    const seat = s.turn;
    let r = move ? commitTurn(s, seat, move.board) : drawTile(s, seat);
    if (!r.ok) r = drawTile(s, seat); // never let a computer player stall the game
    if (r.ok) this.setState(r.state);
  }

  /** The computer plays one turn for a seat whose player has lost their connection. */
  playFor(seatId: string) {
    const s = this.state;
    if (!s || s.phase !== 'playing' || s.players[s.turn].id !== seatId) return;
    const job = ++this.job;
    if (this.worker) this.worker.postMessage({ state: s, seat: s.turn, level: 2, budget: 60000, job });
    else this.aiDone(job, chooseMove(s, s.turn, 2, 60000));
  }

  /** Restarts the computer players after a reload. */
  kick() { this.scheduleAi(); }

  /** The human seat the game is waiting on while they are offline, if any. */
  isWaitingOn(): SeatInfo | null {
    if (!this.state || this.state.phase !== 'playing') return null;
    const id = this.state.players[this.state.turn].id;
    const seat = this.lobby.seats.find((s) => s.id === id) ?? null;
    return seat && seat.kind === 'human' && !seat.online ? seat : null;
  }

  dispose() {
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.worker?.terminate();
  }
}
