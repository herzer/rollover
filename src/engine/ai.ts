// The computer player. Three levels:
//   1 Easy   — lays melds from its own rack only
//   2 Medium — also adds single tiles to melds already on the table
//   3 Hard   — rearranges the whole table to get rid of as many tiles as possible
// The same search powers the hint button for people.

import { typeOf, typeColor, typeNum, type Tile } from './tiles';
import { BOARD_COLS, cellKey, findSpot, segments, layoutMelds, type Placed } from './board';
import { dropOnBoard, takeBack, type DropContext } from './drop';
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

/** One step of a hint: move tile `id` (from the rack or the table) to cell (r, c) — or, with `toRack`, take it back. */
export interface Step { id: number; r: number; c: number; toRack?: boolean }

/** The hint (2026-10-02, Stefanie: the hint "should never make the move … just the next step … and it has to
 *  re-evaluate based on its own given moves on the board"; then "the hint I was given did not work"). A good move is
 *  planned from the table as the player has it now, their own moves kept; then every possible next step is tried with
 *  the game's own drop rules (engine/drop.ts) and the one bringing the table closest to the plan is shown. Null when
 *  there is nothing left to do (draw, or press Done). */
export function hintStep(state: GameState, seat: number, draft: Placed[], budget = 80000, earlier?: number[][] | null): Step | null {
  return hintWithPlan(state, seat, draft, budget, earlier).step;
}

/** The hint and the plan it follows (pass the plan back next time: it is kept while it still fits). */
export function hintWithPlan(state: GameState, seat: number, draft: Placed[], budget = 80000, earlier?: number[][] | null): { step: Step | null; plan: number[][] | null } {
  const me = state.players[seat];
  const onTable = new Set(draft.map((p) => p.id));
  const rackLeft = me.rack.filter((id) => id >= 0 && !onTable.has(id));
  const raw = earlier && planFits(earlier, draft, rackLeft) ? earlier : hintPlan(state, seat, draft, budget);
  const start = new Set(state.board.map((p) => p.id));
  // no step toward a plan, but tiles of yours lie in lines that are not legal: the next step is taking one back
  const takeOneBack = (): Step | null => {
    const bad = new Set(segments(draft).filter((g) => !evalMeld(g.ids.map((id) => state.tiles[id]), state.rules).ok).flatMap((g) => g.ids));
    const p = draft.find((q) => !start.has(q.id) && bad.has(q.id));
    return p ? { id: p.id, r: p.r, c: p.c, toRack: true } : null;
  };
  if (!raw) return { step: takeOneBack(), plan: null };
  const plan = matchTwins(raw, draft, state.tiles);
  const step = bestStep(plan, draft, { tiles: state.tiles, rules: state.rules, opened: me.opened, tableAtStart: start }, new Set(me.rack));
  return { plan, step: step ?? takeOneBack() };
}

/** Legal melds that use every tile in `must` and as many of `may` as is best, or null. */
function solveAll(must: number[], may: number[], tiles: Tile[], rules: Rules, budget: number): number[][] | null {
  try {
    const all = counts([...must, ...may], tiles), mand = counts(must, tiles);
    const res = new Solver(rules.rollover, budget).solve(all.avail, mand.avail, all.jokers, mand.jokers);
    if (res.score === -Infinity) return null;
    const melds = materialize(res.melds, must, may, tiles, rules);
    const used = new Set(melds.flat());
    if (!must.every((id) => used.has(id)) || !melds.every((m) => evalMeld(m.map((id) => tiles[id]), rules).ok)) return null;
    return melds;
  } catch (e) {
    if (!(e instanceof OutOfBudget)) throw e;
    return null;
  }
}

/** Does an earlier hint's plan still fit: every tile on the table is in it, and every tile it needs is on the table
 *  or still on the rack? Then the hint keeps it, so the steps do not wander between equally good plans. */
export function planFits(plan: number[][], draft: Placed[], rack: number[]): boolean {
  const inPlan = new Set(plan.flat());
  const there = new Set([...draft.map((p) => p.id), ...rack]);
  return draft.every((p) => inPlan.has(p.id)) && [...inPlan].every((id) => there.has(id));
}

/** Every tile exists twice (and the jokers are alike): the planner may give a tile in a finished meld on the table
 *  to another meld than its identical twin, and the steps would then swap identical tiles back and forth. Twins are
 *  exchanged in the plan wherever that keeps more tiles in the line they are already in. */
export function matchTwins(plan: number[][], draft: Placed[], tiles: Tile[]): number[][] {
  const out = plan.map((m) => m.slice());
  const where = new Map<number, [number, number]>();
  out.forEach((m, i) => m.forEach((id, k) => where.set(id, [i, k])));
  const segs = segments(draft);
  const lineOf = new Map<number, number>();
  segs.forEach((g, i) => g.ids.forEach((id) => lineOf.set(id, i)));
  const meldOf = (id: number) => where.get(id)?.[0];
  // how many line neighbors of `id` share its planned meld
  const fit = (id: number) => {
    const l = lineOf.get(id);
    if (l === undefined) return 0;
    const ids = segs[l].ids, k = ids.indexOf(id), m = meldOf(id);
    return (k > 0 && meldOf(ids[k - 1]) === m ? 1 : 0) + (k + 1 < ids.length && meldOf(ids[k + 1]) === m ? 1 : 0);
  };
  const kind = (id: number) => (tiles[id].joker ? 'J' : `${tiles[id].color}:${tiles[id].num}`);
  const byKind = new Map<string, number[]>();
  for (const id of where.keys()) { const k = kind(id); byKind.set(k, [...(byKind.get(k) ?? []), id]); }
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const ids of byKind.values()) {
      for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
        const x = ids[a], y = ids[b];
        const before = fit(x) + fit(y);
        const [xi, xk] = where.get(x)!, [yi, yk] = where.get(y)!;
        out[xi][xk] = y; out[yi][yk] = x; where.set(x, [yi, yk]); where.set(y, [xi, xk]);
        if (fit(x) + fit(y) > before) { changed = true; continue; }
        out[xi][xk] = x; out[yi][yk] = y; where.set(x, [xi, xk]); where.set(y, [yi, yk]);
      }
    }
    if (!changed) break;
  }
  return out;
}

/** The table the hint works toward, as melds (lists of tile ids). */
export function hintPlan(state: GameState, seat: number, draft: Placed[], budget = 80000): number[][] | null {
  const { tiles, rules } = state;
  const me = state.players[seat];
  const onTable = new Set(draft.map((p) => p.id));
  const start = new Set(state.board.map((p) => p.id));
  const rackLeft = me.rack.filter((id) => id >= 0 && !onTable.has(id));
  const value = (m: number[]) => evalMeld(m.map((id) => tiles[id]), rules).value;
  if (me.opened) {
    // a move a person would make first: melds from the rack and single tiles added to melds on the table, nothing
    // rearranged — when the table is in order and such a move exists (a full rebuild can take dozens of steps)
    const lines = segments(draft).map((g) => g.ids);
    if (lines.every((m) => evalMeld(m.map((id) => tiles[id]), rules).ok)) {
      const simple = chooseMove({ ...state, board: draft, players: state.players.map((p, i) => (i === seat ? { ...p, rack: rackLeft } : p)) }, seat, 2, budget);
      if (simple && segments(simple.board).every((g) => evalMeld(g.ids.map((id) => tiles[id]), rules).ok)) return segments(simple.board).map((g) => g.ids);
    }
    // otherwise your own moves count (2026-10-02, "the hints do not take the player moves into account"): every
    // legal line you have stays exactly as it is, and only the unfinished lines are solved, with the rack's help
    // Tiles that were on the table when your turn began must stay on it; tiles you laid this turn are yours to use
    // or take back — one that fits nowhere goes back to the rack (the first kind of step)
    const ok = (m: number[]) => evalMeld(m.map((id) => tiles[id]), rules).ok;
    const good = lines.filter(ok), broken = lines.filter((m) => !ok(m)).flat();
    // the legal lines most likely to give or take a tile from the unfinished ones (same number, or same color close
    // by) are opened up a few at a time — small searches, and the rest of your table stays exactly as you have it
    const near = (a: Tile, b: Tile) => a.joker || b.joker || a.num === b.num || (a.color === b.color && Math.abs(a.num - b.num) <= 2);
    const related = good.map((m) => ({ m, n: broken.filter((id) => m.some((x) => near(tiles[x], tiles[id]))).length }))
      .sort((a, b) => b.n - a.n).filter((x) => x.n > 0).map((x) => x.m);
    let tried = -1;
    for (const k of [0, 2, 4, 8]) {
      const open = related.slice(0, k);
      if (open.length === tried) break;                       // no more related lines to open
      tried = open.length;
      const pool = [...broken, ...open.flat()];
      const rest = solveAll(pool.filter((id) => start.has(id)), [...rackLeft, ...pool.filter((id) => !start.has(id))], tiles, rules, budget);
      if (rest) return [...good.filter((m) => !open.includes(m)), ...rest];
    }
    // only when that cannot work: everything that was on the table stays on it, every line legal, the best added —
    // and if even that search gives up, the table as your turn began (always legal: the steps lead back to it)
    return solveAll(draft.filter((p) => start.has(p.id)).map((p) => p.id), [...rackLeft, ...draft.filter((p) => !start.has(p.id)).map((p) => p.id)], tiles, rules, budget)
      ?? segments(state.board).map((g) => g.ids);
  }
  // the opening: the table you found stays as it is; your laid tiles are kept when they can be part of 30 points
  const startMelds = segments(state.board).map((g) => g.ids);
  const placed = draft.filter((p) => !start.has(p.id)).map((p) => p.id);
  if (placed.length) {
    const kept = solveAll(placed, rackLeft, tiles, rules, budget);
    if (kept && kept.reduce((v, m) => v + value(m), 0) >= rules.openingMin) return [...startMelds, ...kept];
  }
  const fresh = solveAll([], me.rack.filter((id) => id >= 0), tiles, rules, budget);
  if (!fresh || !fresh.length || fresh.reduce((v, m) => v + value(m), 0) < rules.openingMin) return null;
  return [...startMelds, ...fresh];
}

/** The next step from `draft` toward `plan`, the way a person tidies a table (2026-10-02). Every planned meld has a
 *  home: the line on the table holding most of its tiles (or, for a meld with none there yet, a free spot set
 *  aside). A tile in a line that is not its meld's home is out of place. The steps, in order: your own tile the plan
 *  does not use goes back to the rack; a rack tile joins its meld's home when that line holds nothing out of place;
 *  a new meld is laid straight from the rack; a tile out of place moves to its meld's home; the rest. Each step is
 *  tried with the game's own drop rules and only kept when the tile lands where it should — never merging into a
 *  neighboring meld. */
export function bestStep(plan: number[][], draft: Placed[], o: DropContext, mine: Set<number>): Step | null {
  const planOf = new Map<number, number>();
  plan.forEach((m, i) => m.forEach((id) => planOf.set(id, i)));
  const segs = segments(draft);
  const lineOf = new Map<number, number>();
  segs.forEach((g, i) => g.ids.forEach((id) => lineOf.set(id, i)));
  // each line's own meld (the planned meld with most tiles in it), then each meld's home line
  const home = new Map<number, number>();                 // meld → line
  const best = new Map<number, number>();                 // meld → its tiles in the home line
  const taken = new Set(draft.map((p) => cellKey(p.r, p.c)));
  // a line boxed in (another meld one empty cell away on both sides) cannot grow without merging: no home
  const boxed = (g: { r: number; c: number; ids: number[] }) => {
    const right = g.c + g.ids.length < BOARD_COLS && !taken.has(cellKey(g.r, g.c + g.ids.length + 1));
    const left = g.c - 1 >= 0 && !taken.has(cellKey(g.r, g.c - 2));
    return !right && !left;
  };
  segs.forEach((g, i) => {
    const tally = new Map<number, number>();
    for (const id of g.ids) { const m = planOf.get(id); if (m !== undefined) tally.set(m, (tally.get(m) ?? 0) + 1); }
    let own = -1, n = 0;
    for (const [m, k] of tally) if (k > n || (k === n && plan[m].length > plan[own].length)) { own = m; n = k; }
    // a boxed line is still home when the whole meld is already in it: it only has to lose tiles, never grow
    const whole = own >= 0 && n === plan[own].length;
    if (own >= 0 && (whole || !boxed(g)) && n > (best.get(own) ?? 0)) { home.set(own, i); best.set(own, n); }
  });
  const outOfPlace = (id: number) => {
    const line = lineOf.get(id);
    if (line === undefined) return false;
    const m = planOf.get(id);
    return m === undefined || home.get(m) !== line;
  };
  const clean = (line: number) => segs[line].ids.every((id) => !outOfPlace(id));
  // free spots set aside for melds with no home yet
  const occupied = new Set(draft.map((p) => cellKey(p.r, p.c)));
  const reserved = new Map<number, { r: number; c: number }>();
  plan.forEach((m, i) => {
    if (home.has(i) || m.every((id) => o.tableAtStart.has(id) && !o.opened)) return;
    const spot = findSpot(occupied, m.length);
    if (!spot) return;
    reserved.set(i, spot);
    for (let k = -1; k <= m.length; k++) occupied.add(cellKey(spot.r, spot.c + k));
  });
  const pos = new Map(draft.map((p) => [p.id, p]));
  // where tile `id` should go: the ends of its meld's home line, or its meld's reserved spot
  const targets = (id: number): [number, number][] => {
    const m = planOf.get(id)!;
    const h = home.get(m);
    if (h !== undefined) { const g = segs[h]; return [[g.r, g.c + g.ids.length], [g.r, g.c - 1]]; }
    const sp = reserved.get(m);
    return sp ? [[sp.r, sp.c]] : [];
  };
  // try a move with the game's drop rules: keep it only when the tile lands in its own meld's line, nothing else
  const tryMove = (id: number): Step | null => {
    const m = planOf.get(id)!;
    for (const [r, c] of targets(id)) {
      if (c < 0 || c >= BOARD_COLS) continue;
      const after = dropOnBoard(draft, [id], r, c, o);
      if (!after) continue;
      const line = segments(after).find((g) => g.ids.includes(id))!;
      const h = home.get(m);
      const expect = new Set([...(h !== undefined ? segs[h].ids.filter((x) => !outOfPlace(x) || x === id) : []), id]);
      if (line.ids.every((x) => planOf.get(x) === m) && line.ids.length >= expect.size - (h !== undefined ? segs[h].ids.filter(outOfPlace).length : 0)) {
        const landed = after.find((p) => p.id === id)!;
        return { id, r: landed.r, c: landed.c };
      }
    }
    return null;
  };
  // 0. your own tiles the plan does not use go back
  for (const p of draft) if (!planOf.has(p.id) && mine.has(p.id) && !o.tableAtStart.has(p.id)) return { id: p.id, r: p.r, c: p.c, toRack: true };
  const rackTiles = plan.flat().filter((id) => !pos.has(id) && mine.has(id));
  // 1. a rack tile onto its meld's clean home line (the meld with most tiles there first)
  for (const id of [...rackTiles].sort((a, b) => (best.get(planOf.get(b)!) ?? 0) - (best.get(planOf.get(a)!) ?? 0))) {
    const h = home.get(planOf.get(id)!);
    if (h === undefined || !clean(h)) continue;
    const st = tryMove(id);
    if (st) return st;
  }
  // 2. a new meld straight from the rack
  for (const [i, m] of plan.entries()) {
    if (home.has(i) || !m.every((id) => rackTiles.includes(id))) continue;
    const st = tryMove(m[0]);
    if (st) return st;
  }
  // 3. a tile out of place moves to its meld's home (or its reserved spot)
  for (const p of draft) {
    if (!outOfPlace(p.id) || !planOf.has(p.id) || (!o.opened && o.tableAtStart.has(p.id))) continue;
    const st = tryMove(p.id);
    if (st) return st;
  }
  // 4. the rest of the rack
  for (const id of rackTiles) { const st = tryMove(id); if (st) return st; }
  return null;
}

/** The first move that brings the table closer to `melds` (kept for the tests of the older rule set). */
export function stepToward(melds: number[][], draft: Placed[], tiles: Tile[], rules: Pick<Rules, 'rollover'>): Step | null {
  const mine = new Set(melds.flat().filter((id) => !draft.some((p) => p.id === id)));
  return bestStep(melds, draft, { tiles, rules, opened: true, tableAtStart: new Set() }, mine);
}
