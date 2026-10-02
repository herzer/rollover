import { it, expect } from 'vitest';
import { newGame, commitTurn, drawTile, type GameState } from '../src/engine/game';
import { chooseMove } from '../src/engine/ai';

// Is a level really stronger? Two computer players play whole rounds against each other, each deal twice with the
// seats swapped, so the deal cancels out. 2026-10-02: an "Expert" (deeper search, saving jokers, then keeping the
// rack with most melds in the making) tied Hard 52–52 over 104 rounds and lost 247 points — it was not shipped.
//   STRENGTH=40 A=3 B=2 SEED0=0 npx vitest run tests/strength.test.ts
const ENV = (globalThis as { process?: { env: Record<string, string> } }).process?.env ?? {};
const N = Number(ENV.STRENGTH ?? 0), SEED0 = Number(ENV.SEED0 ?? 0);
const BUDGET: Record<number, number> = { 1: 60000, 2: 60000, 3: 150000 };   // as the host gives them
export function match(a: 1 | 2 | 3, b: 1 | 2 | 3, games: number) {
  const wins = { a: 0, b: 0, none: 0 }; let points = 0; const ms: number[] = [];
  for (let g = 0; g < games; g++) {
    const levels = g % 2 ? [b, a] : [a, b];
    let s: GameState = newGame(levels.map((l, i) => ({ id: 'p' + i, name: 'P' + i, kind: 'ai' as const, level: l })), { rollover: true, stars: false, openingMin: 30 }, 1000 + SEED0 + Math.floor(g / 2));
    let guard = 0;
    while (s.phase === 'playing' && guard++ < 600) {
      const l = levels[s.turn];
      const t0 = performance.now();
      const m = chooseMove(s, s.turn, l, BUDGET[l]);
      if (l === a) ms.push(performance.now() - t0);
      const r = m ? commitTurn(s, s.turn, m.board) : drawTile(s, s.turn);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    const aSeat = g % 2 ? 1 : 0;
    if (s.winner === null) wins.none++; else if (s.winner === aSeat) wins.a++; else wins.b++;
    if (s.roundDelta) points += s.roundDelta[aSeat];
  }
  ms.sort((x, y) => x - y);
  return { wins, points, medianMs: Math.round(ms[ms.length >> 1]), p95Ms: Math.round(ms[Math.floor(ms.length * 0.95)]) };
}
it.skipIf(!N)('one level against another', () => {
  const a = Number(ENV.A ?? 3) as 1 | 2 | 3, b = Number(ENV.B ?? 2) as 1 | 2 | 3;
  const r = match(a, b, N);
  console.log(`level ${a} vs level ${b} over ${N} rounds:`, JSON.stringify(r));
  expect(r.wins.a + r.wins.b + r.wins.none).toBe(N);
}, 3600000);
