// The computer player. Three levels:
//   1 Easy   — lays melds from its own rack only
//   2 Medium — also adds single tiles to melds already on the table
//   3 Hard   — rearranges the whole table to get rid of as many tiles as possible
// The same search powers the hint button for people.

import { typeOf, typeColor, typeNum, type Tile } from './tiles';
import { BOARD_COLS, cellKey, findSpot, segments, layoutMelds, type Placed } from './board';
import { evalMeld, type Rules } from './melds';
import type { GameState } from './game';

const JOKER = -1;
interface Spec { types: number[]; value: number }

class OutOfBudget extends Error {}

const wrapNum = (x: number) => ((((x - 1) % 13) + 13) % 13) + 1;

/** Every meld that contains one tile of type `t`, given what is available. */
function meldsWith(t: number, avail: number[], jokers: number, rollover: boolean, needJoker = false): Spec[] {
  const out: Spec[] = [];
  const n = typeNum(t), c = typeColor(t);
  // groups
  const others = [0, 1, 2, 3].filter((o) => o !== c && avail[o * 13 + n - 1] > 0);
  for (let mask = 0; mask < 1 << others.length; mask++) {
    const pick = others.filter((_, i) => mask & (1 << i)).map((o) => o * 13 + n - 1);
    for (let total = 3; total <= 4; total++) {
      const j = total - 1 - pick.length;
      if (j < 0 || j > jokers) continue;
      if (needJoker && j === 0) continue;
      out.push({ types: [t, ...pick, ...Array(j).fill(JOKER)], value: n * total });
    }
  }
  // runs: the window starts p places before n
  for (let p = 0; p < 13; p++) {
    const s = n - p;
    if (!rollover && s < 1) break;
    const types: number[] = [];
    let j = 0, value = 0;
    for (let i = 0; i < 13; i++) {
      const raw = s + i;
      if (!rollover && raw > 13) break;
      const num = wrapNum(raw);
      const type = c * 13 + num - 1;
      if (i === p) types.push(t);
      else if (avail[type] > 0) types.push(type);
      else { j++; if (j > jokers) break; types.push(JOKER); }
      value += num;
      if (i >= 2 && i >= p && (!needJoker || j > 0)) out.push({ types: types.slice(), value });
    }
  }
  return out;
}

interface Result { score: number; melds: Spec[] }
const NONE: Result = { score: -Infinity, melds: [] };

const specScore = (m: Spec) => m.types.reduce((a, t) => a + 1000 + (t === JOKER ? 0 : typeNum(t)), 0);

class Solver {
  nodes = 0;
  memo = new Map<string, Result>();
  constructor(public rollover: boolean, public budget: number) {}

  tick() { if (++this.nodes > this.budget) throw new OutOfBudget(); }

  take(m: Spec, avail: number[], mand: number[], jk: { a: number; m: number }) {
    for (const t of m.types) {
      if (t === JOKER) { jk.a--; if (jk.m > 0) jk.m--; }
      else { avail[t]--; if (mand[t] > avail[t]) mand[t] = avail[t]; }
    }
  }

  /** Every mandatory tile must be used; optional tiles are used as much as possible. */
  solve(avail: number[], mand: number[], jA: number, jM: number): Result {
    this.tick();
    const key = avail.join('') + mand.join('') + jA + jM;
    const hit = this.memo.get(key);
    if (hit) return hit;
    let anchor = mand.findIndex((x) => x > 0);
    let best: Result = NONE;
    if (anchor < 0 && jM === 0) {
      best = this.optional(avail, jA, 0);
    } else {
      const anchors = anchor >= 0 ? [anchor] : avail.map((x, i) => (x > 0 ? i : -1)).filter((i) => i >= 0);
      for (const a of anchors) {
        for (const m of meldsWith(a, avail, jA, this.rollover, anchor < 0)) {
          const av = avail.slice(), md = mand.slice(), jk = { a: jA, m: jM };
          this.take(m, av, md, jk);
          if (jk.m > jk.a) continue;
          const r = this.solve(av, md, jk.a, jk.m);
          if (r.score === -Infinity) continue;
          const sc = r.score + specScore(m);
          if (sc > best.score) best = { score: sc, melds: [m, ...r.melds] };
        }
      }
    }
    this.memo.set(key, best);
    return best;
  }

  /** Best set of melds from optional tiles only, at or after type `from`. */
  optional(avail: number[], jA: number, from: number): Result {
    this.tick();
    let t = from;
    while (t < 52 && avail[t] === 0) t++;
    if (t >= 52) return { score: 0, melds: [] };
    const key = 'o' + avail.join('') + jA + ':' + t;
    const hit = this.memo.get(key);
    if (hit) return hit;
    let best = this.optional(avail, jA, t + 1); // leave the rest of type t on the rack
    for (const m of meldsWith(t, avail, jA, this.rollover)) {
      const av = avail.slice(), jk = { a: jA, m: 0 };
      this.take(m, av, av.map(() => 0), jk);
      const r = this.optional(av, jk.a, t);
      const sc = r.score + specScore(m);
      if (sc > best.score) best = { score: sc, melds: [m, ...r.melds] };
    }
    this.memo.set(key, best);
    return best;
  }

  /** Opening: melds from the rack worth at least `min` points, as many tiles as possible. */
  opening(avail: number[], jA: number, min: number): Spec[] | null {
    let best: { tiles: number; value: number; melds: Spec[] } | null = null;
    const dfs = (av: number[], j: number, from: number, value: number, tiles: number, chosen: Spec[]) => {
      this.tick();
      if (value >= min && (!best || tiles > best.tiles || (tiles === best.tiles && value > best.value))) best = { tiles, value, melds: chosen.slice() };
      let t = from;
      while (t < 52 && av[t] === 0) t++;
      if (t >= 52) return;
      dfs(av, j, t + 1, value, tiles, chosen);
      for (const m of meldsWith(t, av, j, this.rollover)) {
        const a2 = av.slice(), jk = { a: j, m: 0 };
        this.take(m, a2, a2.map(() => 0), jk);
        chosen.push(m);
        dfs(a2, jk.a, t, value + m.value, tiles + m.types.length, chosen);
        chosen.pop();
      }
    };
    try { dfs(avail, jA, 0, 0, 0, []); } catch (e) { if (!(e instanceof OutOfBudget)) throw e; }
    return best ? (best as { melds: Spec[] }).melds : null;
  }
}

function counts(ids: number[], tiles: Tile[]) {
  const avail = new Array(52).fill(0);
  let jokers = 0;
  for (const id of ids) { const t = tiles[id]; if (t.joker) jokers++; else avail[typeOf(t)]++; }
  return { avail, jokers };
}

/** Turns type-level melds into tile ids, using table tiles first, then rack tiles. */
function materialize(melds: Spec[], tableIds: number[], rackIds: number[], tiles: Tile[], rules: Pick<Rules, 'rollover'>): number[][] {
  const stacks = new Map<number, number[]>();
  for (const id of [...rackIds, ...tableIds]) {
    const t = tiles[id];
    const k = t.joker ? JOKER : typeOf(t);
    if (!stacks.has(k)) stacks.set(k, []);
    stacks.get(k)!.push(id); // table ids are pushed last, so pop() takes them first
  }
  return melds.map((m) => {
    const ids = m.types.map((k) => stacks.get(k)!.pop()!);
    const e = evalMeld(ids.map((id) => tiles[id]), rules);
    return e.ok ? e.order.map((t) => t.id) : ids;
  });
}

export interface Move { board: Placed[]; played: number[] }

/** The best move for `seat`, or null to draw. */
export function chooseMove(state: GameState, seat: number, level: 1 | 2 | 3 = 3, budget = 120000): Move | null {
  const { tiles, rules } = state;
  const player = state.players[seat];
  const rack = player.rack;
  const solver = new Solver(rules.rollover, budget);
  const { avail: rAvail, jokers: rJ } = counts(rack, tiles);

  if (!player.opened) {
    const melds = solver.opening(rAvail, rJ, rules.openingMin);
    if (!melds) return null;
    const ids = materialize(melds, [], rack, tiles, rules);
    const board = layoutMelds(state.board, [...segments(state.board).map((s) => s.ids), ...ids]);
    return { board, played: ids.flat() };
  }

  // level 1 and 2: keep the table as it is, add melds from the rack
  let simple: Move | null = null;
  try {
    let melds = solver.optional(rAvail, rJ, 0).melds;
    if (level === 1 && melds.length > 1 && Math.random() < 0.35) melds = melds.slice(0, 1);
    const newMelds = materialize(melds, [], rack, tiles, rules);
    let tableMelds = segments(state.board).map((s) => s.ids);
    const usedSet = new Set(newMelds.flat());
    if (level >= 2) {
      // lay off single tiles onto any meld
      let changed = true;
      while (changed) {
        changed = false;
        for (const id of rack) {
          if (usedSet.has(id)) continue;
          for (const list of [tableMelds, newMelds]) {
            for (let i = 0; i < list.length; i++) {
              const e = evalMeld([...list[i], id].map((x) => tiles[x]), rules);
              if (e.ok) { list[i] = e.order.map((t) => t.id); usedSet.add(id); changed = true; break; }
            }
            if (usedSet.has(id)) break;
          }
        }
      }
    }
    if (usedSet.size > 0) simple = { board: layoutMelds(state.board, [...tableMelds, ...newMelds]), played: [...usedSet] };
  } catch (e) {
    if (!(e instanceof OutOfBudget)) throw e;
  }
  if (level < 3) return simple;

  // level 3: rearrange everything
  try {
    const tableIds = state.board.map((p) => p.id);
    const all = counts([...tableIds, ...rack], tiles);
    const mand = counts(tableIds, tiles);
    const hard = new Solver(rules.rollover, budget);
    const res = hard.solve(all.avail, mand.avail, all.jokers, mand.jokers);
    if (res.score !== -Infinity) {
      const melds = materialize(res.melds, tableIds, rack, tiles, rules);
      const tableSet = new Set(tableIds);
      const played = melds.flat().filter((id) => !tableSet.has(id));
      if (played.length > (simple?.played.length ?? 0)) return { board: layoutMelds(state.board, melds), played };
    }
  } catch (e) {
    if (!(e instanceof OutOfBudget)) throw e;
  }
  return simple;
}

/** The best melds hiding in a rack (ignoring the table and the opening rule), plus what is left. */
export function rackMelds(state: GameState, seat: number, budget = 60000): { melds: number[][]; rest: number[] } {
  const rack = state.players[seat].rack.filter((id) => id >= 0);
  const { avail, jokers } = counts(rack, state.tiles);
  let melds: number[][] = [];
  try {
    melds = materialize(new Solver(state.rules.rollover, budget).optional(avail, jokers, 0).melds, [], rack, state.tiles, state.rules);
  } catch (e) {
    if (!(e instanceof OutOfBudget)) throw e;
  }
  const used = new Set(melds.flat());
  return { melds, rest: rack.filter((id) => !used.has(id)) };
}

/** One step of a hint: move tile `id` (from the rack or the table) to cell (r, c). */
export interface Step { id: number; r: number; c: number }

/** The hint (2026-10-02, Stefanie: the hint "should never make the move … just the next step … and it has to
 *  re-evaluate based on its own given moves on the board"): a good move planned from the table as the player has it
 *  now — their own moves kept — and only its next step. Null when there is nothing to add (draw, or press Done). */
export function hintStep(state: GameState, seat: number, draft: Placed[], budget = 80000): Step | null {
  const { tiles, rules } = state;
  const me = state.players[seat];
  const onTable = new Set(draft.map((p) => p.id));
  const start = new Set(state.board.map((p) => p.id));
  const withRack = (rack: number[]): GameState => ({ ...state, players: state.players.map((p, i) => (i === seat ? { ...p, rack } : p)) });
  let melds: number[][] | null = null;
  if (me.opened) {
    // everything on the table now stays on it; the plan adds from what is left on the rack
    const plan = chooseMove({ ...withRack(me.rack.filter((id) => id >= 0 && !onTable.has(id))), board: draft }, seat, 3, budget);
    if (plan) melds = segments(plan.board).map((g) => g.ids);
  } else {
    // the opening: the melds already finished are kept; the rest of the 30 points is planned from the rack
    // (tiles laid in an unfinished meld count as rack tiles again)
    const kept = segments(draft).filter((g) => g.ids.every((id) => !start.has(id)) && evalMeld(g.ids.map((id) => tiles[id]), rules).ok);
    const keptIds = new Set(kept.flatMap((g) => g.ids));
    const value = kept.reduce((v, g) => v + evalMeld(g.ids.map((id) => tiles[id]), rules).value, 0);
    const need = rules.openingMin - value;
    const loose = draft.some((p) => !start.has(p.id) && !keptIds.has(p.id));
    if (need <= 0 && !loose) return null;
    const rack = me.rack.filter((id) => id >= 0 && !keptIds.has(id));
    const plan = chooseMove({ ...withRack(rack), rules: { ...rules, openingMin: Math.max(1, need) } }, seat, 3, budget)
      ?? chooseMove(state, seat, 3, budget);
    if (plan) melds = [...kept.map((g) => g.ids), ...segments(plan.board).map((g) => g.ids).filter((m) => m.some((id) => !start.has(id)))];
  }
  return melds ? stepToward(melds, draft, tiles, rules) : null;
}

/** The first move that brings the table closer to `melds`: finish what is started first. */
export function stepToward(melds: number[][], draft: Placed[], tiles: Tile[], rules: Pick<Rules, 'rollover'>): Step | null {
  const segs = segments(draft);
  const segOf = new Map<number, number>();
  segs.forEach((g, i) => g.ids.forEach((id) => segOf.set(id, i)));
  const occupied = new Set(draft.map((p) => cellKey(p.r, p.c)));
  const ranked = melds.map((m) => {
    const tally = new Map<number, number>();
    for (const id of m) { const i = segOf.get(id); if (i !== undefined) tally.set(i, (tally.get(i) ?? 0) + 1); }
    let best = -1, overlap = 0;
    for (const [i, n] of tally) if (n > overlap) { best = i; overlap = n; }
    return { m, best, overlap };
  }).filter((x) => !(x.overlap === x.m.length && segs[x.best].ids.length === x.m.length))
    .sort((a, b) => b.overlap - a.overlap);
  for (const { m, best, overlap } of ranked) {
    const e = evalMeld(m.map((id) => tiles[id]), rules);
    const order = e.ok ? e.order.map((t) => t.id) : m;
    if (overlap === 0) {
      const spot = findSpot(occupied, m.length);
      if (spot) return { id: order[0], r: spot.r, c: spot.c };
      continue;
    }
    const D = segs[best];
    const inD = new Set(D.ids);
    const lo = Math.min(...order.map((id, i) => (inD.has(id) ? i : Infinity)));
    for (const id of order) {
      if (inD.has(id)) continue;
      const c = order.indexOf(id) < lo ? D.c - 1 : D.c + D.ids.length;
      if (c < 0 || c >= BOARD_COLS || occupied.has(cellKey(D.r, c))) continue;
      return { id, r: D.r, c };
    }
  }
  return null;
}
