# Rollover — a tile rummy game for Stefanie and her mom

A browser tile rummy game (the classic rules, as on rummikub.com) Stefanie plays remotely with her mom in Germany,
or against computer players. Built 2026-09-30.

## Decisions (picker: https://claude.ai/artifact/8vmn8Rnf599XdbEdtWGZNF, doc `picks/rummikub-start`)
- **Connect:** static web app on GitHub Pages; browsers talk peer-to-peer (PeerJS public broker).
  The host's browser is authoritative (validates every move, runs the computer players).
- **Language:** each player picks English (American) or German on their own device.
- **Rollover rule:** 13 is followed by 1 in runs (12-13-1, 13-1-2-3), max 13 tiles; a 1 is always
  worth 1 point. ON by default; the game creator can switch it off for classic.
- **Twist:** four ★ star tiles; laying one from your rack fires a surprise (Burden: next player
  draws; Peek: you see the next player's rack; Spotlight: next player's rack face-up for everyone).
  Switch in setup.
- Her note: tiles must look like **beautiful 3D renders** (done in CSS, see `src/ui/tiles.css`).

## Name and trademark (Stefanie, 2026-09-30)
The game is **Rollover** — "a tile rummy game". Tile rummy is a generic, decades-old game;
"Rummikub" is a trademark. **Never use the word Rummikub (or their slogans) in the UI, page
title, repo name, or published copy**, and don't copy their look: our joker is a crown, not their
smiley. (The local folder name `RummiKub` is just a folder.)

## Structure
- `src/engine/` — pure TS, no DOM: `tiles.ts`, `melds.ts` (validation incl. rollover),
  `board.ts` (grid table, segments), `game.ts` (state + actions), `ai.ts` (3 levels + hints).
- `src/net/` — PeerJS host/guest transport. `src/ui/` — DOM rendering, drag & drop, i18n, sound.
- `tests/` — vitest for engine + AI. `npm test`, `npm run dev`, `npm run build`.
- `docs/start-picker.html` — the decisions page source (republish same path to keep the URL).

## House rules that apply here
American English UI strings (German via `src/ui/i18n.ts`), Lucide icons (web), every control has
a tooltip (`title`), buttons are buttons (accent = primary, bordered = everything else), one
declared control height token `--control-h`.
