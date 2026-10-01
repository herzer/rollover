// The computer player. Three levels:
//   1 Easy   — lays melds from its own rack only
//   2 Medium — also adds single tiles to melds already on the table
//   3 Hard   — rearranges the whole table to get rid of as many tiles as possible
// The same search powers the hint button for people.

import { typeOf, typeColor, typeNum, type Tile } from './tiles';
import { segments, layoutMelds, type Placed } from './board';
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
