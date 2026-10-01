# Rollover — a tile rummy game

A browser tile rummy game for family across the ocean: play together online (peer-to-peer, no
accounts, no server) or against up to three computer players.

- **Rollover rule** (switchable): 13 is followed by 1 in runs — `12‑13‑1‑2` is a valid run.
- **Star tiles** (switchable): four ★ tiles set off a surprise when laid from your rack.
- English and German, chosen per player.

## Play
Open the published page, enter your name, choose **Play with family online**, and send the
link it shows. The person who creates the game keeps the page open — their browser hosts it.

## Develop
```bash
npm install
npm run dev     # http://localhost:5173
npm test        # rules engine + computer player
npm run build   # static site in dist/
```
Pushing to `main` deploys to GitHub Pages (`.github/workflows/pages.yml`).
