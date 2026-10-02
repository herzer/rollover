import { describe, it, expect } from 'vitest';
import { evalMeld, belongsTogether, meldAround, legalSplit } from '../src/engine/melds';
import type { Tile, Color } from '../src/engine/tiles';
import { checkBoard, closeUp, layoutMelds, relayRow, segments, type Placed } from '../src/engine/board';
import { newGame, commitTurn, drawTile, validateCommit, type GameState } from '../src/engine/game';
import { chooseMove, hintStep, stepToward } from '../src/engine/ai';

let nextId = 1000;
const T = (color: Color, num: number): Tile => ({ id: nextId++, color, num, joker: false, star: false });
const J = (): Tile => ({ id: nextId++, color: 0, num: 0, joker: true, star: false });
const ROLL = { rollover: true };
const CLASSIC = { rollover: false };

describe('melds', () => {
  it('accepts groups and rejects repeated colors', () => {
    expect(evalMeld([T(0, 7), T(1, 7), T(2, 7)], ROLL).ok).toBe(true);
    expect(evalMeld([T(0, 7), T(0, 7), T(2, 7)], ROLL).ok).toBe(false);
    expect(evalMeld([T(0, 7), T(1, 7), T(2, 7), T(3, 7), J()], ROLL).ok).toBe(false);
  });
  it('accepts runs in any order and tidies them', () => {
    const e = evalMeld([T(1, 6), T(1, 4), T(1, 5)], ROLL);
    expect(e.ok).toBe(true);
    expect(e.order.map((t) => t.num)).toEqual([4, 5, 6]);
    expect(e.value).toBe(15);
  });
  it('rolls over from 13 to 1 only when the rule is on', () => {
    const tiles = [T(0, 12), T(0, 13), T(0, 1), T(0, 2)];
    const on = evalMeld(tiles, ROLL);
    expect(on.ok).toBe(true);
    expect(on.wraps).toBe(true);
    expect(on.order.map((t) => t.num)).toEqual([12, 13, 1, 2]);
    expect(on.value).toBe(28); // a 1 is worth 1
    expect(evalMeld(tiles, CLASSIC).ok).toBe(false);
  });
  it('never allows a run longer than 13', () => {
    const all = Array.from({ length: 13 }, (_, i) => T(2, i + 1));
    expect(evalMeld(all, ROLL).ok).toBe(true);
    expect(evalMeld([...all, J()], ROLL).ok).toBe(false);
  });
  it('lets jokers fill gaps and ends', () => {
    expect(evalMeld([T(3, 13), J(), T(3, 2)], ROLL).ok).toBe(true);
    expect(evalMeld([T(3, 13), J(), T(3, 2)], CLASSIC).ok).toBe(false);
    const e = evalMeld([T(3, 5), J(), J()], ROLL);
    expect(e.ok).toBe(true);
    expect(e.value).toBe(18); // 5-6-7 beats a group of 5s (15)
  });
});

function stateWith(rack: Tile[], board: Tile[][] = [], opened = true): GameState {
  const s = newGame([{ id: 'a', name: 'A', kind: 'human' }, { id: 'b', name: 'B', kind: 'human' }], { rollover: true, stars: false, openingMin: 30 }, 1);
  // replace tiles with our own: ids 0..n-1
  const all = [...rack, ...board.flat()];
  all.forEach((t, i) => (t.id = i));
  s.tiles = all;
  s.pool = [];
  s.players[0].rack = rack.map((t) => t.id);
  s.players[0].opened = opened;
  s.players[1].rack = [];
  s.board = layoutMelds([], board.map((m) => m.map((t) => t.id)));
  return s;
}

describe('game', () => {
  it('requires 30 points for the opening, from the rack only', () => {
    const s = stateWith([T(0, 1), T(0, 2), T(0, 3), T(1, 10), T(2, 10), T(3, 10)], [], false);
    const low: Placed[] = [{ id: 0, r: 0, c: 0 }, { id: 1, r: 0, c: 1 }, { id: 2, r: 0, c: 2 }];
    expect(validateCommit(s, 0, low)).toEqual({ ok: false, error: 'opening-too-low' });
    const ok: Placed[] = [...low, { id: 3, r: 1, c: 0 }, { id: 4, r: 1, c: 1 }, { id: 5, r: 1, c: 2 }];
    expect(validateCommit(s, 0, ok).ok).toBe(true);
  });
  it('rejects a table that lost a tile or holds an invalid meld', () => {
    const s = stateWith([T(0, 9)], [[T(1, 4), T(1, 5), T(1, 6)]]);
    const board = s.board.slice(0, 2).concat([{ id: 0, r: 0, c: 2 }]);
    expect(validateCommit(s, 0, board)).toEqual({ ok: false, error: 'tiles-missing' });
  });
  it('wins the round when the rack empties, and scores it', () => {
    const s = stateWith([T(1, 7)], [[T(1, 4), T(1, 5), T(1, 6)]]);
    s.players[1].rack = [];
    const extra = T(0, 9); extra.id = s.tiles.length; s.tiles.push(extra); s.players[1].rack = [extra.id];
    const board = [...s.board, { id: 0, r: s.board[0].r, c: s.board[2].c + 1 }];
    const r = commitTurn(s, 0, board);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe('over');
    expect(r.state.winner).toBe(0);
    expect(r.state.roundDelta).toEqual([9, -9]);
  });
  it('drawing passes the turn', () => {
    const s = newGame([{ id: 'a', name: 'A', kind: 'human' }, { id: 'b', name: 'B', kind: 'ai', level: 2 }]);
    const r = drawTile(s, 0);
    expect(r.ok && r.state.turn).toBe(1);
    expect(r.ok && r.state.players[0].rack.length).toBe(15);
  });
});

describe('computer player', () => {
  it('opens with 30+ points when it can', () => {
    const s = stateWith([T(0, 11), T(1, 11), T(2, 11), T(3, 2), T(0, 5)], [], false);
    const m = chooseMove(s, 0, 2);
    expect(m).not.toBeNull();
    expect(m!.played.length).toBe(3);
    expect(validateCommit(s, 0, m!.board).ok).toBe(true);
  });
  it('plays a rollover run', () => {
    const s = stateWith([T(2, 12), T(2, 13), T(2, 1)]);
    const m = chooseMove(s, 0, 1);
    expect(m?.played.length).toBe(3);
    expect(checkBoard(m!.board, s.tiles, ROLL).segs[0].eval.wraps).toBe(true);
  });
  it('medium lays off onto the table', () => {
    const s = stateWith([T(1, 7), T(0, 1)], [[T(1, 4), T(1, 5), T(1, 6)]]);
    const m = chooseMove(s, 0, 2)!;
    expect(m.played.length).toBe(1);
    expect(validateCommit(s, 0, m.board).ok).toBe(true);
  });
  it('hard rearranges the table', () => {
    // table: red 3-4-5-6 ; rack: red 4, red 5 → split into 3-4-5 + 4-5-6
    const s = stateWith([T(0, 4), T(0, 5)], [[T(0, 3), T(0, 4), T(0, 5), T(0, 6)]]);
    expect(chooseMove(s, 0, 2)).toBeNull();
    const m = chooseMove(s, 0, 3)!;
    expect(m.played.length).toBe(2);
    expect(validateCommit(s, 0, m.board).ok).toBe(true);
    expect(segments(m.board).length).toBe(2);
  });
  it('hard keeps table jokers on the table', () => {
    const s = stateWith([T(3, 8)], [[T(0, 9), J(), T(0, 11)], [T(1, 8), T(2, 8), T(0, 8)]]);
    const m = chooseMove(s, 0, 3)!;
    expect(m).not.toBeNull();
    expect(validateCommit(s, 0, m.board).ok).toBe(true);
  });
  it('plays whole AI-vs-AI games to the end with only valid moves', () => {
    for (let g = 0; g < 4; g++) {
      let s = newGame(
        [{ id: 'a', name: 'A', kind: 'ai', level: 3 }, { id: 'b', name: 'B', kind: 'ai', level: 2 }, { id: 'c', name: 'C', kind: 'ai', level: 1 }],
        { rollover: g % 2 === 0, stars: true, openingMin: 30 }, 100 + g,
      );
      let guard = 0;
      while (s.phase === 'playing' && guard++ < 400) {
        const seat = s.turn;
        const m = chooseMove(s, seat, s.players[seat].level ?? 3, 40000);
        const r = m ? commitTurn(s, seat, m.board) : drawTile(s, seat);
        if (!r.ok) throw new Error(`seat ${seat} made an invalid move: ${r.error}`);
        s = r.state;
      }
      expect(s.phase).toBe('over');
      const total = s.pool.length + s.board.length + s.players.reduce((a, p) => a + p.rack.length, 0);
      expect(total).toBe(106);
    }
  }, 120000);
});

describe('fairness and safety', () => {
  it('rejects tiles outside the table or stacked in one cell', () => {
    const s = stateWith([T(0, 9), T(1, 9), T(2, 9)]);
    const off: Placed[] = [{ id: 0, r: 9, c: 0 }, { id: 1, r: 9, c: 1 }, { id: 2, r: 9, c: 2 }];
    expect(validateCommit(s, 0, off)).toEqual({ ok: false, error: 'invalid-melds' });
    const stacked: Placed[] = [{ id: 0, r: 0, c: 0 }, { id: 1, r: 0, c: 0 }, { id: 2, r: 0, c: 1 }];
    expect(validateCommit(s, 0, stacked)).toEqual({ ok: false, error: 'invalid-melds' });
  });
  it('never lays melds below the table, even when it is crowded', () => {
    const rows = Array.from({ length: 9 }, (_, r) => [r * 3, r * 3 + 1, r * 3 + 2]);
    const crowded = layoutMelds([], []).concat(rows.flatMap((ids, r) => ids.map((id, i) => ({ id, r, c: 10 + i }))));
    const out = layoutMelds(crowded, [...rows, Array.from({ length: 13 }, (_, i) => 100 + i)]);
    expect(out.every((p) => p.r < 9 && p.c < 26)).toBe(true);
    expect(out.length).toBe(27 + 13);
  });
  it('does not send the deal seed to guests', async () => {
    const { redact } = await import('../src/net/host');
    const s = newGame([{ id: 'a', name: 'A', kind: 'human' }, { id: 'b', name: 'B', kind: 'human' }]);
    const r = redact(s, 1);
    expect(r.seed).toBe(0);
    expect(r.players[0].rack.every((id) => id === -1)).toBe(true);
    expect(r.pool.every((id) => id === -1)).toBe(true);
  });
});

describe('picking up and dropping between tiles (2026-10-02)', () => {
  it('picks up only the tiles that belong together', () => {
    // a run of three, then a stray red 11 touching it
    const line = [T(1, 4), T(1, 5), T(1, 6), T(0, 11)];
    expect(meldAround(line, 1, ROLL)).toEqual([0, 3]);
    expect(meldAround(line, 3, ROLL)).toEqual([3, 4]);
    // a pair that could start a run still goes together; unrelated neighbors do not
    expect(meldAround([T(2, 8), T(2, 9), T(3, 1)], 0, ROLL)).toEqual([0, 2]);
    expect(meldAround([T(2, 8), T(3, 1)], 0, ROLL)).toEqual([0, 1]);
    expect(belongsTogether([T(0, 13), T(0, 1)], ROLL)).toBe(true);
    expect(belongsTogether([T(0, 13), T(0, 1)], CLASSIC)).toBe(false);
  });
  it('splits a line where every part becomes legal', () => {
    // 3-4-5-6-7 in blue, a blue 5 dropped after the 5 → 3-4-5 | 5-6-7
    const line = [T(1, 3), T(1, 4), T(1, 5), T(1, 5), T(1, 6), T(1, 7)];
    expect(legalSplit(line, 3, 4, ROLL)).toEqual([3]);
    // a run dropped into the middle of another: split on both sides
    const mid = [T(0, 1), T(0, 2), T(0, 3), T(3, 9), T(3, 10), T(3, 11), T(0, 4), T(0, 5), T(0, 6)];
    expect(legalSplit(mid, 3, 6, ROLL)).toEqual([3, 6]);
    // already legal, or no split helps: nothing to do
    expect(legalSplit([T(1, 3), T(1, 4), T(1, 5), T(1, 6)], 3, 4, ROLL)).toBeNull();
    expect(legalSplit([T(1, 3), T(1, 4), T(0, 9), T(1, 5)], 2, 3, ROLL)).toBeNull();
  });
});

describe('splitting a row on the table (2026-10-02)', () => {
  it('opens a gap at the cut and keeps the melds after it apart', () => {
    // six tiles at columns 2..7, cut before the 4th; a separate meld starts at 9
    const row: Placed[] = [1, 2, 3, 4, 5, 6].map((id, k) => ({ id, r: 0, c: 2 + k }));
    row.push({ id: 7, r: 0, c: 9 }, { id: 8, r: 0, c: 10 }, { id: 9, r: 0, c: 11 });
    const col = relayRow(row, new Set([4]))!;
    expect([1, 2, 3].map((id) => col.get(id))).toEqual([2, 3, 4]);
    expect([4, 5, 6].map((id) => col.get(id))).toEqual([6, 7, 8]);
    expect([7, 8, 9].map((id) => col.get(id))).toEqual([10, 11, 12]);    // pushed along, still one meld, still apart
    expect(segments(row.map((p) => ({ ...p, c: col.get(p.id)! }))).map((s) => s.ids)).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
  });
  it('gives up when the row would run off the table', () => {
    const row: Placed[] = [1, 2, 3, 4].map((id, k) => ({ id, r: 0, c: 22 + k }));
    expect(relayRow(row, new Set([3]), 26)).toBeNull();
  });
});

describe('taking a tile out of a line (2026-10-02)', () => {
  const tiles: Tile[] = [];
  const put = (t: Tile) => { tiles[t.id] = t; return t.id; };
  it('closes a group of four up when one tile is taken from the middle', () => {
    const ids = [put(T(0, 10)), put(T(1, 10)), put(T(2, 10)), put(T(3, 10))];
    const before: Placed[] = ids.map((id, k) => ({ id, r: 1, c: 4 + k }));
    const after = before.filter((p) => p.id !== ids[1]);
    const out = closeUp(before, after, new Set([ids[1]]), tiles, ROLL);
    expect(segments(out).map((g) => g.ids)).toEqual([[ids[0], ids[2], ids[3]]]);
    expect(out.find((p) => p.id === ids[0])!.c).toBe(4);
  });
  it('leaves a run that was split on purpose split', () => {
    const ids = [3, 4, 5, 6, 7, 8, 9].map((n) => put(T(1, n)));
    const before: Placed[] = ids.map((id, k) => ({ id, r: 2, c: k }));
    const taken = ids[3];
    const out = closeUp(before, before.filter((p) => p.id !== taken), new Set([taken]), tiles, ROLL);
    expect(segments(out).length).toBe(2);
  });
  it('does not move the table you found before your opening', () => {
    const ids = [put(T(0, 7)), put(T(1, 7)), put(T(2, 7)), put(T(3, 7))];
    const before: Placed[] = ids.map((id, k) => ({ id, r: 0, c: k }));
    const out = closeUp(before, before.filter((p) => p.id !== ids[1]), new Set([ids[1]]), tiles, ROLL, new Set(ids));
    expect(out.find((p) => p.id === ids[2])!.c).toBe(2);
  });
});

describe('the hint: one next step, from the table as it is (2026-10-02)', () => {
  it('adds the next tile to a meld you started', () => {
    // rack: blue 6; the table has blue 3-4-5 → the next step puts the 6 right after the 5
    const s = stateWith([T(1, 6), T(0, 1)], [[T(1, 3), T(1, 4), T(1, 5)]]);
    const step = hintStep(s, 0, s.board)!;
    const five = s.board.find((p) => s.tiles[p.id].num === 5)!;
    expect(s.tiles[step.id].num).toBe(6);
    expect([step.r, step.c]).toEqual([five.r, five.c + 1]);
  });
  it('keeps your own moves and plans from them', () => {
    // you already laid the 6 after the 5; the rack's 7 is the next step, after your 6 — nothing is rolled back
    const s = stateWith([T(1, 6), T(1, 7)], [[T(1, 3), T(1, 4), T(1, 5)]]);
    const five = s.board.find((p) => s.tiles[p.id].num === 5)!;
    const six = s.players[0].rack[0];
    const draft: Placed[] = [...s.board, { id: six, r: five.r, c: five.c + 1 }];
    const step = hintStep(s, 0, draft)!;
    expect(s.tiles[step.id].num).toBe(7);
    expect([step.r, step.c]).toEqual([five.r, five.c + 2]);
  });
  it('before the opening, keeps your finished melds and counts their points', () => {
    // a group of 10s already laid (30 points): nothing more is needed — press Done
    const s = stateWith([T(0, 10), T(1, 10), T(2, 10), T(0, 2)], [], false);
    const [a, b, c] = s.players[0].rack;
    expect(hintStep(s, 0, [{ id: a, r: 0, c: 0 }, { id: b, r: 0, c: 1 }, { id: c, r: 0, c: 2 }])).toBeNull();
  });
  it('starts a new meld in a free spot when none is started', () => {
    const t = [T(2, 8), T(2, 9), T(2, 10)];
    t.forEach((x, i) => (x.id = i));
    const step = stepToward([[0, 1, 2]], [], t, ROLL)!;
    expect(step.id).toBe(0);
  });
  it('never parks a tile on a meld that merely holds one of its partners', () => {
    // red 6-7-8-9 and orange 9-10-11-12 on the table; the plan: a group of 9s (red, orange, blue from the rack) — the
    // first step goes to a free spot apart from both runs, never next to the red or the orange run
    const t = [T(0, 6), T(0, 7), T(0, 8), T(0, 9), T(2, 9), T(2, 10), T(2, 11), T(2, 12), T(1, 9)];
    t.forEach((x, i) => (x.id = i));
    const draft: Placed[] = [0, 1, 2, 3].map((id, k) => ({ id, r: 0, c: k })).concat([4, 5, 6, 7].map((id, k) => ({ id, r: 0, c: 5 + k })));
    const step = stepToward([[0, 1, 2], [5, 6, 7], [3, 4, 8]], draft, t, ROLL)!;
    expect([3, 4, 8]).toContain(step.id);
    // a free spot apart from both runs (cells 4 and 9 are the runs' ends)
    expect(step.r === 0 && step.c <= 9).toBe(false);
  });
  it('lays a meld straight from the rack before rearranging the table', () => {
    const t = [T(1, 4), T(3, 4), T(2, 4), T(0, 7), T(0, 8), T(0, 9), T(0, 10)];
    t.forEach((x, i) => (x.id = i));
    const draft: Placed[] = [3, 4, 5, 6].map((id, k) => ({ id, r: 0, c: k }));
    // planned: red 7-8-9-10 as it is, and the rack's 4s as a group
    const step = stepToward([[3, 4, 5, 6], [0, 1, 2]], draft, t, ROLL)!;
    expect([0, 1, 2]).toContain(step.id);
  });
});
