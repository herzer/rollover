import { describe, it, expect } from 'vitest';
import { newGame, commitTurn, drawTile, validateCommit, type GameState } from '../src/engine/game';
import { chooseMove, hintWithPlan } from '../src/engine/ai';
import { checkBoard, type Placed } from '../src/engine/board';
import { dropOnBoard, takeBack } from '../src/engine/drop';

// Following the hint, step by step, as a player would (2026-10-02, "the hint I was given did not work"): every step
// must be a real move, and the steps must end in a table that can be committed.
function play(seed: number) {
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
    for (; steps < 60; steps++) {
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
    expect(all).toEqual([]);
  }, 300000);
});
