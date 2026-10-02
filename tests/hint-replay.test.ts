import { describe, it, expect } from 'vitest';
import { newGame, commitTurn, drawTile, validateCommit, type GameState } from '../src/engine/game';
import { chooseMove, hintWithPlan } from '../src/engine/ai';
import { checkBoard, segments, BOARD_ROWS, BOARD_COLS, type Placed } from '../src/engine/board';
import { dropOnBoard, takeBack } from '../src/engine/drop';

// Following the hint, step by step, as a player would (2026-10-02, "the hint I was given did not work"): every step
// must be a real move, and the steps must end in a table that can be committed.
// `own`: how often the player makes a move of their own instead (2026-10-02, "the hints do not take the player moves into
// account, they need to be recalculated each move") — a rack tile onto the end of a line or into a free spot. The
// hint then plans afresh from that table, and following it from there must still work.
function play(seed: number, own = 0) {
  let rnd = seed * 9301 + 49297;
  const random = () => ((rnd = (rnd * 9301 + 49297) % 233280) / 233280);
  let s: GameState = newGame([{ id: 'a', name: 'A', kind: 'human' }, { id: 'b', name: 'B', kind: 'ai', level: 3 }, { id: 'c', name: 'C', kind: 'ai', level: 3 }],
    { rollover: true, stars: false, openingMin: 30 }, seed);
  const problems: string[] = [];
  let hinted = 0;
  for (let turn = 0; turn < 36 && s.phase === 'playing'; turn++) {
    const seat = s.turn;
    if (seat !== 0) {
      const m = chooseMove(s, seat, 3, 40000);
      const r = m && validateCommit(s, seat, m.board).ok ? commitTurn(s, seat, m.board) : drawTile(s, seat);
      s = (r as { state: GameState }).state ?? s;
      continue;
    }
    // the player follows the hint
    let draft: Placed[] = s.board.map((p) => ({ ...p }));
    let steps = 0;
    let plan: number[][] | null = null;
    let owns = 0;
    for (; steps < 60; steps++) {
      if (own && owns < 3 && random() < own) {
        const o = { tiles: s.tiles, rules: s.rules, opened: s.players[0].opened, tableAtStart: new Set(s.board.map((p) => p.id)) };
        const free = s.players[0].rack.filter((id) => id >= 0 && !draft.some((p) => p.id === id));
        if (free.length) {
          const id = free[Math.floor(random() * free.length)];
          const lines = segments(draft);
          const spots: [number, number][] = lines.map((g) => [g.r, g.c + g.ids.length]);
          spots.push([Math.floor(random() * BOARD_ROWS), Math.floor(random() * (BOARD_COLS - 1))]);
          const [r, c] = spots[Math.floor(random() * spots.length)];
          const next = c < BOARD_COLS ? dropOnBoard(draft, [id], r, c, o) : null;
          if (next) { draft = next; plan = null; owns++; continue; }
        }
      }
      const h = hintWithPlan(s, 0, draft, 40000, plan);
      plan = h.plan;
      const st = h.step;
      if (!st) break;
      const onTable = draft.some((p) => p.id === st.id);
      const mine = s.players[0].rack.includes(st.id);
      if (!onTable && !mine) { problems.push(`seed ${seed} turn ${turn}: tile ${st.id} is neither on the table nor mine`); break; }
      const o = { tiles: s.tiles, rules: s.rules, opened: s.players[0].opened, tableAtStart: new Set(s.board.map((p) => p.id)) };
      const next = st.toRack ? takeBack(draft, [st.id], o) : dropOnBoard(draft, [st.id], st.r, st.c, o);
      if (!next) { problems.push(`seed ${seed} turn ${turn}: the game refuses the step`); break; }
      draft = next;
      hinted++;
    }
    if (steps >= 60) problems.push(`seed ${seed} turn ${turn}: the hint never finishes`);
    if (process.env.HINT_DEBUG && draft.length > s.board.length && !validateCommit(s, 0, draft).ok) {
      const name = (id: number) => { const x = s.tiles[id]; return x.joker ? 'J' : 'rbok'[x.color] + x.num; };
      const start = new Set(s.board.map((p) => p.id));
      const h = hintWithPlan(s, 0, draft, 40000, null);
      problems.push(`DEBUG seed ${seed} turn ${turn} opened=${s.players[0].opened} lines: ` + segments(draft).map((g) => g.ids.map((id) => (start.has(id) ? '' : '*') + name(id)).join('-')).join(' | ')
        + ` rack: ${s.players[0].rack.filter((id) => id >= 0 && !draft.some((p) => p.id === id)).map(name).join(',')} plan: ${JSON.stringify(h.plan?.map((m) => m.map(name)))} step: ${JSON.stringify(h.step)}`);
    }
    const placed = draft.length > s.board.length;
    if (placed) {
      const v = validateCommit(s, 0, draft);
      if (!v.ok) problems.push(`seed ${seed} turn ${turn}: after ${steps} steps the table cannot be committed (${(v as { error: string }).error}; ${checkBoard(draft, s.tiles, s.rules).segs.filter((g) => !g.eval.ok).length} bad lines)`);
      const r = v.ok ? commitTurn(s, 0, draft) : drawTile(s, 0);
      s = (r as { state: GameState }).state ?? s;
    } else {
      s = (drawTile(s, 0) as { state: GameState }).state ?? s;
    }
  }
  return { problems, hinted };
}

describe('following the hint (replayed games)', () => {
  it('every hint is a real move and ends in a table you can commit', () => {
    const all: string[] = []; let hinted = 0;
    for (let seed = 1; seed <= 40; seed++) { const r = play(seed); all.push(...r.problems); hinted += r.hinted; }
    console.log('hint steps followed:', hinted, 'problems:', all.length, all.slice(0, 12));
    expect(hinted).toBeGreaterThan(0);
    expect(all).toEqual([]);              // every hint step works when followed, to a table you can commit
  }, 300000);
  it('after moves of your own, the hint plans afresh and still leads to a table you can commit', () => {
    const all: string[] = []; let hinted = 0;
    for (let seed = 1; seed <= 40; seed++) { const r = play(seed, Number(process.env.OWN ?? 0.3)); all.push(...r.problems); hinted += r.hinted; }
    console.log('with own moves — hint steps followed:', hinted, 'problems:', all.length, JSON.stringify(Object.entries(all.reduce((a: Record<string, number>, x) => { const k = x.replace(/seed \d+ turn \d+: /, '').replace(/\d+/g, 'N'); a[k] = (a[k] ?? 0) + 1; return a; }, {}))), all.slice(0, 6));
    expect(hinted).toBeGreaterThan(0);
    expect(all).toEqual([]);
  }, 300000);
});
