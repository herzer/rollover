// Dropping tiles on the table, the rules in one place (2026-10-02): the game uses them for your drags and taps, and
// the hint uses them to try each possible next step exactly as it would happen. Tiles in the row from the drop on
// make room (melds that were apart stay apart); a line that only becomes legal split is split; a line that loses
// tiles closes up when the rest is legal only together; before your opening the table you found never moves.

import type { Tile } from './tiles';
import { BOARD_COLS, cellKey, closeUp, relayRow, segments, type Placed } from './board';
import { legalSplit, type Rules } from './melds';

export interface DropContext {
  tiles: Tile[];
  rules: Pick<Rules, 'rollover'>;
  /** Has the player made their opening? Before it, the table at the start of the turn stays exactly as it is. */
  opened: boolean;
  tableAtStart: Set<number>;
  cols?: number;
}

export type BoardDropPlan = { ok: true; c: number; moves: Map<number, number> } | { ok: false; why?: 'opening-touched-table' };

/** Where `ids` would land in a line starting at (r, c), and which tiles move aside — without changing anything. */
export function planBoardDrop(draft: Placed[], ids: number[], r: number, c: number, o: DropContext): BoardDropPlan {
  const cols = o.cols ?? BOARD_COLS;
  const n = ids.length;
  if (n > cols) return { ok: false };
  c = Math.max(0, Math.min(c, cols - n));
  const moving = new Set(ids);
  const cells = new Map<number, number>();
  for (const p of draft) if (!moving.has(p.id)) cells.set(cellKey(p.r, p.c), p.id);
  const free = (cc: number) => !cells.has(cellKey(r, cc));
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
  if (!o.opened && [...moves.keys()].some((id) => o.tableAtStart.has(id))) return { ok: false, why: 'opening-touched-table' };
  // dropped in between tiles where the line only becomes legal split in two (or three): split it
  const after = boardAfterDrop(draft, r, c, ids, moves);
  const seg = segments(after).find((x) => x.ids.includes(ids[0]));
  const from = seg ? seg.ids.indexOf(ids[0]) : -1;
  const cuts = seg ? legalSplit(seg.ids.map((id) => o.tiles[id]), from, from + n, o.rules) : null;
  if (seg && cuts) {
    const col = relayRow(after.filter((p) => p.r === r), new Set(cuts.map((k) => seg.ids[k])), cols);
    const was = new Map(draft.map((p) => [p.id, p.c]));
    const split = new Map<number, number>();
    if (col) for (const [id, nc] of col) if (!moving.has(id) && nc !== was.get(id)) split.set(id, nc);
    if (col && (o.opened || ![...split.keys()].some((id) => o.tableAtStart.has(id)))) return { ok: true, c: col.get(ids[0])!, moves: split };
  }
  return { ok: true, c, moves };
}

/** The table after a planned drop (before any closing up). */
export function boardAfterDrop(draft: Placed[], r: number, c: number, ids: number[], moves: Map<number, number>): Placed[] {
  const moving = new Set(ids);
  const board = draft.filter((p) => !moving.has(p.id)).map((p) => (moves.has(p.id) ? { ...p, c: moves.get(p.id)! } : p));
  ids.forEach((id, k) => board.push({ id, r, c: c + k }));
  return board;
}

/** The table after dropping `ids` at (r, c), lines that lost tiles closed up — or null when the drop is not allowed. */
export function dropOnBoard(draft: Placed[], ids: number[], r: number, c: number, o: DropContext): Placed[] | null {
  const plan = planBoardDrop(draft, ids, r, c, o);
  if (!plan.ok) return null;
  return closeUp(draft, boardAfterDrop(draft, r, plan.c, ids, plan.moves), new Set(ids), o.tiles, o.rules, o.opened ? new Set() : o.tableAtStart);
}

/** The table after taking `ids` back to the rack (only your own tiles laid this turn can go back). */
export function takeBack(draft: Placed[], ids: number[], o: DropContext): Placed[] {
  const moving = new Set(ids);
  return closeUp(draft, draft.filter((p) => !moving.has(p.id)), moving, o.tiles, o.rules, o.opened ? new Set() : o.tableAtStart);
}
