import type { Placed } from '../engine/board';
import type { AiLevel, GameState } from '../engine/game';
import type { Rules } from '../engine/melds';

export interface SeatInfo {
  id: string;
  name: string;
  kind: 'human' | 'ai';
  level?: AiLevel;
  online: boolean;
}

export interface Lobby {
  code: string | null; // null for a game on this device only
  hostId: string;
  seats: SeatInfo[];
  rules: Rules;
  started: boolean;
}

export type ToHost =
  | { t: 'hello'; clientId: string; name: string }
  | { t: 'commit'; board: Placed[]; seq: number }
  | { t: 'draw'; seq: number }
  | { t: 'draft'; board: Placed[]; seq: number }
  | { t: 'react'; emoji: string };

export type ToClient =
  | { t: 'lobby'; lobby: Lobby }
  | { t: 'state'; state: GameState | null; seat: number }
  | { t: 'draft'; seat: number; board: Placed[]; seq: number }
  | { t: 'react'; seat: number; emoji: string }
  | { t: 'error'; error: string }
  | { t: 'full' };

export const REACTIONS = ['👏', '😂', '😮', '😅', '❤️', '🎉', '🤔', '😎'];
