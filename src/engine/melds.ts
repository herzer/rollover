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
