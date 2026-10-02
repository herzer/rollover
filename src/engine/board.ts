// The table is a grid. A meld is any horizontal run of adjacent tiles in a row;
// an empty cell separates melds.

import type { Tile } from './tiles';
import { evalMeld, type MeldEval, type Rules } from './melds';

export const BOARD_COLS = 26;
export const BOARD_ROWS = 9;

export interface Placed { id: number; r: number; c: number }

export interface Segment { r: number; c: number; ids: number[] }

export const cellKey = (r: number, c: number) => r * 1000 + c;

export function segments(board: Placed[]): Segment[] {
  const byRow = new Map<number, Placed[]>();
  for (const p of board) {
    if (!byRow.has(p.r)) byRow.set(p.r, []);
    byRow.get(p.r)!.push(p);
  }
  const segs: Segment[] = [];
  for (const [r, row] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    row.sort((a, b) => a.c - b.c);
    let cur: Segment | null = null;
    for (const p of row) {
      if (cur && p.c === cur.c + cur.ids.length) cur.ids.push(p.id);
      else { cur = { r, c: p.c, ids: [p.id] }; segs.push(cur); }
    }
  }
  return segs;
}

export interface SegmentCheck extends Segment { eval: MeldEval }

export function checkBoard(board: Placed[], tiles: Tile[], rules: Pick<Rules, 'rollover'>): { segs: SegmentCheck[]; ok: boolean } {
  const segs = segments(board).map((s) => ({ ...s, eval: evalMeld(s.ids.map((id) => tiles[id]), rules) }));
  return { segs, ok: segs.every((s) => s.eval.ok) };
}

/** Rewrites each valid segment in its natural order (same cells). */
export function tidyBoard(board: Placed[], tiles: Tile[], rules: Pick<Rules, 'rollover'>): Placed[] {
  const out: Placed[] = [];
  for (const s of checkBoard(board, tiles, rules).segs) {
    const ids = s.eval.ok ? s.eval.order.map((t) => t.id) : s.ids;
    ids.forEach((id, i) => out.push({ id, r: s.r, c: s.c + i }));
  }
  return out;
}

/** Finds a free spot for a meld of width w, with an empty cell (or the edge) on both sides. */
export function findSpot(occupied: Set<number>, w: number, rows = BOARD_ROWS, cols = BOARD_COLS): { r: number; c: number } | null {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c + w <= cols; c++) {
      let free = true;
      for (let k = c - 1; k <= c + w; k++) {
        if (k < 0 || k >= cols) continue;
        if (occupied.has(cellKey(r, k))) { free = false; break; }
      }
      if (free) return { r, c };
    }
  }
  return null;
}

/**
 * Lays out melds on the board. Melds that already sit on the old board unchanged keep
 * their cells; a meld that only grew keeps its cells when the new tiles fit beside it;
 * everything else goes to the first free spot.
 */
export function layoutMelds(oldBoard: Placed[], melds: number[][]): Placed[] {
  const oldSegs = segments(oldBoard);
  const occupied = new Set<number>();
  const out: Placed[] = [];
  const pending: number[][] = [];
  const claim = (ids: number[], r: number, c: number) => {
    ids.forEach((id, i) => { out.push({ id, r, c: c + i }); occupied.add(cellKey(r, c + i)); });
  };
  const used = new Set<Segment>();
  // pass 1: unchanged melds stay put
  for (const m of melds) {
    const seg = oldSegs.find((s) => !used.has(s) && s.ids.length === m.length && s.ids.every((id, i) => id === m[i]));
    if (seg) { used.add(seg); claim(m, seg.r, seg.c); } else pending.push(m);
  }
  // pass 2: grown melds stay put when there is room on the row
  const rest: number[][] = [];
  for (const m of pending) {
    let placed = false;
    for (const s of oldSegs) {
      if (used.has(s)) continue;
      const at = indexOfRun(m, s.ids);
      if (at < 0) continue;
      const c0 = s.c - at;
      if (c0 < 0 || c0 + m.length > BOARD_COLS) continue;
      let free = true;
      for (let k = c0 - 1; k <= c0 + m.length; k++) {
        if (k < 0 || k >= BOARD_COLS) continue;
        if (occupied.has(cellKey(s.r, k))) { free = false; break; }
      }
      if (!free) continue;
      used.add(s);
      claim(m, s.r, c0);
      placed = true;
      break;
    }
    if (!placed) rest.push(m);
  }
  // pass 3: everything else goes to the first free spot
  for (const m of rest) {
    const spot = findSpot(occupied, m.length);
    if (!spot) return compactLayout(melds);
    claim(m, spot.r, spot.c);
  }
  return out;
}

/** Packs every meld row by row, one empty cell apart — used when the table is too full to keep places. */
export function compactLayout(melds: number[][]): Placed[] {
  const out: Placed[] = [];
  let r = 0, c = 0;
  for (const m of [...melds].sort((a, b) => b.length - a.length)) {
    if (c > 0 && c + m.length > BOARD_COLS) { r++; c = 0; }
    m.forEach((id, i) => out.push({ id, r, c: c + i }));
    c += m.length + 1;
  }
  return out;
}

function indexOfRun(hay: number[], needle: number[]): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Re-lays one row of the table with a gap opened before each tile in `cutBefore`, keeping tiles that touched
 *  touching and melds that were apart apart. New columns by id, or null when the row would run off the table. */
export function relayRow(row: Placed[], cutBefore: Set<number>, cols = BOARD_COLS): Map<number, number> | null {
  const col = new Map<number, number>();
  let prevOld = -1, prevNew = -1;
  for (const p of [...row].sort((a, b) => a.c - b.c)) {
    const touching = prevOld >= 0 && p.c === prevOld + 1 && !cutBefore.has(p.id);
    const nc = prevOld < 0 ? p.c : touching ? prevNew + 1 : Math.max(p.c, prevNew + 2);
    if (nc >= cols) return null;
    col.set(p.id, nc); prevOld = p.c; prevNew = nc;
  }
  return col;
}

/** After `taken` tiles left a line on the table (`before` → `after`), the rest closes up when it is a legal meld
 *  only together — take one tile from a group of four and the three stay one group (2026-10-02). A line whose parts
 *  are each legal (a run split on purpose) is left as it is; nothing moves onto an occupied cell, nor any tile in
 *  `keep` (before your opening, the table as it was). */
export function closeUp(before: Placed[], after: Placed[], taken: Set<number>, tiles: Tile[], rules: Pick<Rules, 'rollover'>,
  keep = new Set<number>()): Placed[] {
  const now = new Map(after.map((p) => [p.id, { ...p }]));
  for (const seg of segments(before)) {
    if (!seg.ids.some((id) => taken.has(id))) continue;
    const rest = seg.ids.filter((id) => !taken.has(id) && now.has(id));
    if (rest.length < 3 || rest.some((id) => now.get(id)!.r !== seg.r)) continue;
    const parts = segments(rest.map((id) => now.get(id)!));
    if (parts.length < 2) continue;
    if (parts.every((p) => evalMeld(p.ids.map((id) => tiles[id]), rules).ok)) continue;
    const order = parts.flatMap((p) => p.ids);
    if (!evalMeld(order.map((id) => tiles[id]), rules).ok) continue;
    const start = now.get(order[0])!.c;
    const others = new Set([...now.values()].filter((p) => !order.includes(p.id)).map((p) => cellKey(p.r, p.c)));
    if (order.some((_, k) => others.has(cellKey(seg.r, start + k)))) continue;
    if (order.some((id, k) => keep.has(id) && now.get(id)!.c !== start + k)) continue;
    order.forEach((id, k) => { now.get(id)!.c = start + k; });
  }
  return after.map((p) => now.get(p.id)!);
}
