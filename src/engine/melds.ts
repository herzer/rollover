// Meld validation. A meld is evaluated as a multiset: the player may lay the tiles in
// any order, and a valid meld is tidied into its natural order on commit.

import type { Tile } from './tiles';

export interface Rules {
  rollover: boolean; // 13 may be followed by 1 in a run
  stars: boolean;
  openingMin: number; // 30
}

export const DEFAULT_RULES: Rules = { rollover: true, stars: true, openingMin: 30 };

export type MeldKind = 'group' | 'run';

export interface MeldEval {
  ok: boolean;
  kind?: MeldKind;
  /** Sum of the numbers the tiles stand for (jokers count as the tile they replace). */
  value: number;
  /** Tiles in natural order. */
  order: Tile[];
  /** What each tile in `order` stands for (number 1..13). */
  reps: number[];
  /** True for a run that rolls over from 13 to 1. */
  wraps: boolean;
}

const BAD = (tiles: Tile[]): MeldEval => ({ ok: false, value: 0, order: tiles, reps: [], wraps: false });

export function evalGroup(tiles: Tile[]): MeldEval | null {
  const n = tiles.length;
  if (n < 3 || n > 4) return null;
  const real = tiles.filter((t) => !t.joker);
  const jokers = tiles.filter((t) => t.joker);
  if (real.length === 0) return null;
  const num = real[0].num;
  if (real.some((t) => t.num !== num)) return null;
  const colors = new Set(real.map((t) => t.color));
  if (colors.size !== real.length) return null;
  const order = [...real.sort((a, b) => a.color - b.color), ...jokers];
  return { ok: true, kind: 'group', value: num * n, order, reps: order.map(() => num), wraps: false };
}

export function evalRun(tiles: Tile[], rollover: boolean): MeldEval | null {
  const n = tiles.length;
  if (n < 3 || n > 13) return null;
  const real = tiles.filter((t) => !t.joker);
  const jokers = tiles.filter((t) => t.joker);
  if (real.length === 0) return null;
  const color = real[0].color;
  if (real.some((t) => t.color !== color)) return null;
  const nums = new Set(real.map((t) => t.num));
  if (nums.size !== real.length) return null;

  let best: MeldEval | null = null;
  for (let s = 1; s <= 13; s++) {
    const wraps = s + n - 1 > 13;
    if (wraps && !rollover) break;
    // every real tile must fall inside the window s .. s+n-1 (cyclic)
    const slot: (Tile | null)[] = new Array(n).fill(null);
    let fits = true;
    for (const t of real) {
      const p = (t.num - s + 13) % 13;
      if (p >= n) { fits = false; break; }
      slot[p] = t;
    }
    if (!fits) continue;
    const js = jokers.slice();
    const order = slot.map((t) => t ?? js.shift()!);
    const reps = order.map((_, i) => ((s - 1 + i) % 13) + 1);
    const value = reps.reduce((a, b) => a + b, 0);
    const cand: MeldEval = { ok: true, kind: 'run', value, order, reps, wraps };
    // prefer the higher value; on a tie prefer a run that does not roll over
    if (!best || value > best.value || (value === best.value && best.wraps && !wraps)) best = cand;
  }
  return best;
}

export function evalMeld(tiles: Tile[], rules: Pick<Rules, 'rollover'>): MeldEval {
  const g = evalGroup(tiles);
  const r = evalRun(tiles, rules.rollover);
  if (g && r) return g.value >= r.value ? g : r;
  return g ?? r ?? BAD(tiles);
}

export type MeldProblem = 'short' | 'long' | 'mixed' | 'repeat-color' | 'gap';

/** Why a meld is not valid, in words a player can act on (null when it is valid). */
export function meldProblem(tiles: Tile[], rules: Pick<Rules, 'rollover'>): MeldProblem | null {
  if (evalMeld(tiles, rules).ok) return null;
  if (tiles.length < 3) return 'short';
  const real = tiles.filter((t) => !t.joker);
  if (real.every((t) => t.num === real[0].num)) return tiles.length > 4 ? 'long' : 'repeat-color';
  if (real.every((t) => t.color === real[0].color)) return tiles.length > 13 ? 'long' : 'gap';
  return 'mixed';
}

/** Whether tiles side by side belong together: a valid meld, or a pair that could start one (same number in two
 *  colors, or neighbors in one color — 13 and 1 too with the rollover rule; a joker goes with anything). */
export function belongsTogether(tiles: Tile[], rules: Pick<Rules, 'rollover'>): boolean {
  if (tiles.length < 2) return true;
  if (tiles.length >= 3) return evalMeld(tiles, rules).ok;
  const [a, b] = tiles;
  if (a.joker || b.joker) return true;
  if (a.num === b.num) return a.color !== b.color;
  if (a.color !== b.color) return false;
  const d = Math.abs(a.num - b.num);
  return d === 1 || (rules.rollover && d === 12);
}

/** The tiles a press-and-hold picks up (2026-10-02, Stefanie: keep tiles that don't belong apart): within a line of
 *  tiles, the longest stretch around tile `i` that belongs together; just that tile when nothing does. */
export function meldAround(tiles: Tile[], i: number, rules: Pick<Rules, 'rollover'>): [number, number] {
  for (let len = tiles.length; len >= 2; len--) {
    for (let a = Math.max(0, i - len + 1); a <= i && a + len <= tiles.length; a++) {
      if (belongsTogether(tiles.slice(a, a + len), rules)) return [a, a + len];
    }
  }
  return [i, i + 1];
}

/** Where to split a line of tiles that tiles were just dropped into (at `from`..`to`, exclusive), so that every
 *  part is a valid meld: before the dropped tiles, after them, or both. Null when the line is fine as it is or no
 *  split makes it legal (2026-10-02, Stefanie: "when dropping a tile in between things that will be legal when
 *  split, that split should just be made"). */
export function legalSplit(tiles: Tile[], from: number, to: number, rules: Pick<Rules, 'rollover'>): number[] | null {
  if (evalMeld(tiles, rules).ok) return null;
  const ok = (cuts: number[]) => {
    const edges = [0, ...cuts, tiles.length];
    for (let k = 0; k + 1 < edges.length; k++) {
      if (edges[k] === edges[k + 1] || !evalMeld(tiles.slice(edges[k], edges[k + 1]), rules).ok) return false;
    }
    return true;
  };
  for (const cuts of [[from], [to], [from, to]]) {
    if (cuts.every((c) => c > 0 && c < tiles.length) && ok(cuts)) return cuts;
  }
  return null;
}
