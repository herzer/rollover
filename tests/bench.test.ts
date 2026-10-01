import { it } from 'vitest';
import { newGame, commitTurn, drawTile } from '../src/engine/game';
import { chooseMove } from '../src/engine/ai';

it.skipIf(!(globalThis as { process?: { env: Record<string, string> } }).process?.env.BENCH)('bench hard AI', () => {
  const times: number[] = []; let rearr = 0; let moves = 0;
  for (let g = 0; g < 6; g++) {
    let s = newGame([{ id: 'a', name: 'A', kind: 'ai', level: 3 }, { id: 'b', name: 'B', kind: 'ai', level: 3 }, { id: 'c', name: 'C', kind: 'ai', level: 3 }], { rollover: true, stars: true, openingMin: 30 }, 500 + g);
    let guard = 0;
    while (s.phase === 'playing' && guard++ < 400) {
      const t0 = performance.now();
      const m = chooseMove(s, s.turn, 3, 150000);
      const m2 = chooseMove(s, s.turn, 2, 150000);
      times.push(performance.now() - t0);
      if (m && (m.played.length > (m2?.played.length ?? 0))) rearr++;
      if (m) moves++;
      const r = m ? commitTurn(s, s.turn, m.board) : drawTile(s, s.turn);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
  }
  times.sort((a, b) => a - b);
  console.log(`turns ${times.length}, plays ${moves}, hard beat medium ${rearr}x, median ${times[times.length >> 1].toFixed(0)}ms, p95 ${times[Math.floor(times.length * .95)].toFixed(0)}ms, max ${times[times.length - 1].toFixed(0)}ms`);
}, 600000);
