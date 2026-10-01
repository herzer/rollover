// Game state and the actions that change it. Pure functions: the host runs them,
// guests only ever receive the resulting state.

import { makeTiles, rackPoints, rng, shuffle, type Tile } from './tiles';
import { checkBoard, cellKey, tidyBoard, BOARD_COLS, BOARD_ROWS, type Placed } from './board';
import { DEFAULT_RULES, type Rules } from './melds';

export type PlayerKind = 'human' | 'ai';
export type AiLevel = 1 | 2 | 3;

export interface Player {
  id: string;
  name: string;
  kind: PlayerKind;
  level?: AiLevel;
  rack: number[];
  opened: boolean;
  /** Points across rounds of this match. */
  score: number;
}

export type StarKind = 'burden' | 'peek' | 'spotlight';

export interface Reveal {
  /** Whose rack is shown. */
  target: number;
  /** Seat that may see it, or -1 for everyone. */
  viewer: number;
  /** Shown while state.turnNo <= until. */
  until: number;
}

export type LogEntry =
  | { k: 'play'; p: number; tiles: number; rollover: boolean; opened: boolean }
  | { k: 'draw'; p: number }
  | { k: 'pass'; p: number }
  | { k: 'star'; p: number; star: StarKind; target: number }
  | { k: 'win'; p: number }
  | { k: 'stalemate'; p: number };

export interface GameState {
  v: 1;
  /** Secret: the deal can be rebuilt from it, so the host never sends it to guests. */
  seed: number;
  /** Not secret: names this round for local keys (rack layout, scoreboard). */
  gameId: string;
  round: number;
  rules: Rules;
  tiles: Tile[];
  pool: number[];
  board: Placed[];
  players: Player[];
  turn: number;
  turnNo: number;
  turnStartedAt: number;
  passes: number;
  phase: 'playing' | 'over';
  winner: number | null;
  /** Points each seat won or lost in the round that just ended. */
  roundDelta: number[] | null;
  reveals: Reveal[];
  log: LogEntry[];
  /** Increments on every change, so stale messages can be ignored. */
  seq: number;
}

export interface SeatSpec { id: string; name: string; kind: PlayerKind; level?: AiLevel }

export const RACK_START = 14;

export function newGame(seats: SeatSpec[], rules: Rules = DEFAULT_RULES, seed = Date.now() % 2147483647, prev?: GameState): GameState {
  const rand = rng(seed);
  const tiles = makeTiles(rules.stars, rand);
  const pool = shuffle(tiles.map((t) => t.id), rand);
  const players: Player[] = seats.map((s, i) => ({
    ...s,
    rack: pool.splice(0, RACK_START),
    opened: false,
    score: prev?.players[i]?.score ?? 0,
  }));
  return {
    v: 1, seed, gameId: Math.random().toString(36).slice(2, 10), round: (prev?.round ?? 0) + 1, rules, tiles, pool, board: [], players,
    turn: prev ? (prev.round % seats.length) : 0, turnNo: 0, turnStartedAt: Date.now(), passes: 0,
    phase: 'playing', winner: null, roundDelta: null, reveals: [], log: [], seq: 1,
  };
}

export type CommitResult = { ok: true; state: GameState } | { ok: false; error: CommitError };
export type CommitError =
  | 'not-your-turn'
  | 'invalid-melds'
  | 'no-tiles-played'
  | 'tiles-missing'
  | 'foreign-tiles'
  | 'opening-too-low'
  | 'opening-touched-table';

export function boardValue(board: Placed[], ids: Set<number>, tiles: Tile[], rules: Rules): number {
  return checkBoard(board.filter((p) => ids.has(p.id)), tiles, rules).segs.reduce((a, s) => a + (s.eval.ok ? s.eval.value : 0), 0);
}

/** Checks a proposed table for the seat whose turn it is, without changing state. */
export function validateCommit(state: GameState, seat: number, board: Placed[]): { ok: true; played: number[] } | { ok: false; error: CommitError } {
  if (state.phase !== 'playing' || state.turn !== seat) return { ok: false, error: 'not-your-turn' };
  const player = state.players[seat];
  const before = new Set(state.board.map((p) => p.id));
  const after = new Set(board.map((p) => p.id));
  if (after.size !== board.length) return { ok: false, error: 'invalid-melds' };
  const cells = new Set<number>();
  for (const p of board) {
    if (!Number.isInteger(p.r) || !Number.isInteger(p.c) || p.r < 0 || p.r >= BOARD_ROWS || p.c < 0 || p.c >= BOARD_COLS) return { ok: false, error: 'invalid-melds' };
    const k = cellKey(p.r, p.c);
    if (cells.has(k)) return { ok: false, error: 'invalid-melds' };
    cells.add(k);
  }
  for (const id of before) if (!after.has(id)) return { ok: false, error: 'tiles-missing' };
  const rack = new Set(player.rack);
  const played = board.map((p) => p.id).filter((id) => !before.has(id));
  if (played.some((id) => !rack.has(id))) return { ok: false, error: 'foreign-tiles' };
  if (played.length === 0) return { ok: false, error: 'no-tiles-played' };
  const check = checkBoard(board, state.tiles, state.rules);
  if (!check.ok) return { ok: false, error: 'invalid-melds' };
  if (!player.opened) {
    // the opening is laid from your own rack only: the table stays exactly as it was
    const oldCells = new Map(state.board.map((p) => [p.id, cellKey(p.r, p.c)]));
    for (const p of board) if (oldCells.has(p.id) && oldCells.get(p.id) !== cellKey(p.r, p.c)) return { ok: false, error: 'opening-touched-table' };
    let value = 0;
    for (const s of check.segs) {
      const hasOld = s.ids.some((id) => before.has(id));
      const hasNew = s.ids.some((id) => !before.has(id));
      if (hasOld && hasNew) return { ok: false, error: 'opening-touched-table' };
      if (hasNew) value += s.eval.value;
    }
    if (value < state.rules.openingMin) return { ok: false, error: 'opening-too-low' };
  }
  return { ok: true, played };
}

const bump = (s: GameState): GameState => ({ ...s, seq: s.seq + 1 });

export function commitTurn(state: GameState, seat: number, board: Placed[], starPick: () => StarKind = randomStar): CommitResult {
  const v = validateCommit(state, seat, board);
  if (!v.ok) return v;
  const s = structuredClone(state) as GameState;
  const player = s.players[seat];
  const tidy = tidyBoard(board, s.tiles, s.rules);
  const playedSet = new Set(v.played);
  player.rack = player.rack.filter((id) => !playedSet.has(id));
  const wasOpened = player.opened;
  player.opened = true;
  s.board = tidy;
  s.passes = 0;
  const rolled = checkBoard(tidy, s.tiles, s.rules).segs.some((g) => g.eval.wraps && g.ids.some((id) => playedSet.has(id)));
  s.log.push({ k: 'play', p: seat, tiles: v.played.length, rollover: rolled, opened: !wasOpened });

  if (player.rack.length === 0) return { ok: true, state: endRound(s, seat) };

  // star tiles laid from the rack fire their surprise
  const next = (seat + 1) % s.players.length;
  for (const id of v.played) {
    if (!s.tiles[id].star) continue;
    const star = starPick();
    s.log.push({ k: 'star', p: seat, star, target: next });
    if (star === 'burden') {
      const drawn = s.pool.shift();
      if (drawn !== undefined) s.players[next].rack.push(drawn);
    } else if (star === 'peek') {
      s.reveals.push({ target: next, viewer: seat, until: s.turnNo + s.players.length });
    } else {
      s.reveals.push({ target: next, viewer: -1, until: s.turnNo + 1 });
    }
  }
  return { ok: true, state: advance(s) };
}

export function randomStar(): StarKind {
  const kinds: StarKind[] = ['burden', 'peek', 'spotlight'];
  return kinds[Math.floor(Math.random() * kinds.length)];
}

/** Draw a tile (or pass when the pool is empty) and end the turn. */
export function drawTile(state: GameState, seat: number): CommitResult {
  if (state.phase !== 'playing' || state.turn !== seat) return { ok: false, error: 'not-your-turn' };
  const s = structuredClone(state) as GameState;
  const id = s.pool.shift();
  if (id === undefined) {
    s.passes += 1;
    s.log.push({ k: 'pass', p: seat });
    if (s.passes >= s.players.length) {
      // nobody can move: the lowest rack wins
      const totals = s.players.map((p) => rackTotal(s, p.rack));
      const best = totals.indexOf(Math.min(...totals));
      s.log.push({ k: 'stalemate', p: best });
      return { ok: true, state: endRound(s, best) };
    }
  } else {
    s.players[seat].rack.push(id);
    s.log.push({ k: 'draw', p: seat });
  }
  return { ok: true, state: advance(s) };
}

export const rackTotal = (s: GameState, rack: number[]) => rack.reduce((a, id) => a + rackPoints(s.tiles[id]), 0);

function advance(s: GameState): GameState {
  s.turn = (s.turn + 1) % s.players.length;
  s.turnNo += 1;
  s.turnStartedAt = Date.now();
  s.reveals = s.reveals.filter((r) => r.until >= s.turnNo);
  return bump(s);
}

function endRound(s: GameState, winner: number): GameState {
  const delta = s.players.map((p) => -rackTotal(s, p.rack));
  delta[winner] = delta.reduce((a, d, i) => (i === winner ? a : a - d), 0) + (s.players[winner].rack.length ? delta[winner] : 0);
  s.players.forEach((p, i) => (p.score += delta[i]));
  s.phase = 'over';
  s.winner = winner;
  s.roundDelta = delta;
  s.reveals = [];
  s.log.push({ k: 'win', p: winner });
  return bump(s);
}

/** Can `viewer` see seat `target`'s rack right now? */
export function canSee(s: GameState, viewer: number, target: number): boolean {
  if (viewer === target || s.phase === 'over') return true;
  return s.reveals.some((r) => r.target === target && (r.viewer === -1 || r.viewer === viewer) && r.until >= s.turnNo);
}
