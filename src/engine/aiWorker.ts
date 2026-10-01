// Runs the computer player off the main thread so the table never freezes.
import { chooseMove } from './ai';
import type { GameState } from './game';

self.onmessage = (e: MessageEvent<{ state: GameState; seat: number; level: 1 | 2 | 3; budget: number; job: number }>) => {
  const { state, seat, level, budget, job } = e.data;
  const move = chooseMove(state, seat, level, budget);
  (self as unknown as Worker).postMessage({ job, move });
};
