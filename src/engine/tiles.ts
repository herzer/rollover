// Tiles: 4 colors × 13 numbers × 2 copies + 2 jokers = 106, ids 0..105.

export type Color = 0 | 1 | 2 | 3; // red, blue, orange, black
export const COLORS: Color[] = [0, 1, 2, 3];
export const COLOR_KEYS = ['red', 'blue', 'orange', 'black'] as const;

export interface Tile {
  id: number;
  color: Color;
  num: number; // 1..13; 0 for jokers
  joker: boolean;
  star: boolean;
}

export const JOKER_POINTS = 30;
export const STAR_COUNT = 4;

/** Type index 0..51 for a non-joker tile (color-major). */
export const typeOf = (t: Tile) => t.color * 13 + (t.num - 1);
export const typeColor = (type: number) => Math.floor(type / 13) as Color;
export const typeNum = (type: number) => (type % 13) + 1;

/** Small seeded PRNG so deals are reproducible in tests and on reconnect. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function makeTiles(stars: boolean, rand: () => number): Tile[] {
  const tiles: Tile[] = [];
  let id = 0;
  for (let copy = 0; copy < 2; copy++)
    for (const color of COLORS)
      for (let num = 1; num <= 13; num++) tiles.push({ id: id++, color, num, joker: false, star: false });
  tiles.push({ id: id++, color: 0, num: 0, joker: true, star: false });
  tiles.push({ id: id++, color: 3, num: 0, joker: true, star: false });
  if (stars) {
    // one star per color, random number and copy — so stars are spread over the deal
    for (const color of COLORS) {
      const candidates = tiles.filter((t) => !t.joker && t.color === color);
      candidates[Math.floor(rand() * candidates.length)].star = true;
    }
  }
  return tiles;
}

/** Points a tile counts against you when left on your rack. */
export const rackPoints = (t: Tile) => (t.joker ? JOKER_POINTS : t.num);
