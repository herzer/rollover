#!/usr/bin/env python3
"""Builds docs/palette-picker.html: the three friendly color schemes, drawn with the game's own CSS."""
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
tmpl = (pathlib.Path.home() / '.claude/templates/proposal-picker/template.html').read_text()
css = '\n'.join((root / f'src/ui/{n}').read_text() for n in ['styles.css', 'tile-styles.css', 'friendly.css'])
css = css.replace('overflow: hidden;\n}', 'overflow: auto;\n}', 1)
kitty_ts = (root / 'src/ui/kitty.ts').read_text()
MASCOT = re.search(r'const SVG = `(.*?)`;', kitty_ts, re.S).group(1)
FACE = re.search(r'export const KITTEN_FACE = `(.*?)`;', kitty_ts, re.S).group(1)

picker_style = tmpl[tmpl.index('<style>') + 7: tmpl.index('</style>')]
script = tmpl[tmpl.index('<div class="fallback"'):]
script = script.replace("const QS = ['first', 'second'];", "const QS = ['palette', 'kitten'];")
script = script.replace("'SLUG-picks'", "'rollover-colors-picks'").replace("'picks/SLUG'", "'picks/rollover-colors'")

SET = [(0, 12, 0), (0, 13, 0), (0, 1, 1), (1, 7, 0), (2, 7, 0), (3, 7, 0), (0, 0, 0)]
def tiles(tw):
    th = round(tw * 1.32); out = []
    for c, n, star in SET:
        inner = f'<span class="jk">{FACE}</span>' if n == 0 else f'<span class="n">{n}</span>'
        if star: inner += '<span class="st">★</span>'
        out.append(f'<span class="tile c{c}{" joker" if n == 0 else ""}" style="position:relative;--tw:{tw}px;--th:{th}px;--pos:none;cursor:default">{inner}</span>')
    return ''.join(out)

def scene(pal):
    return f'''<div class="scene friendly {pal} ts-3d">
      <div class="board" style="width:auto;height:auto;padding:24px 22px 32px;display:flex;gap:7px;flex-wrap:wrap">{tiles(54)}</div>
      <div style="position:relative">
        <div class="kitty" style="left:auto;right:14px;top:-58px;width:72px;height:62px">{MASCOT}</div>
        <div class="rack" style="width:auto;height:auto;padding:12px 16px 17px;display:flex;gap:5px;flex-wrap:wrap">{tiles(40)}</div>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><span class="btn" style="pointer-events:none">Draw a tile</span><span class="btn primary" style="pointer-events:none">Done</span></div>
    </div>'''

PALS = [
    ('pal-sage', 'Sunday morning', 'Warm cream around a soft sage felt, a honey-wood rack, coral buttons. Cozy, like a kitchen table.', 'The calmest of the three — if you want more color on screen, it is the quietest.', True),
    ('pal-sea', 'Seaside', 'Cool, airy light blue with a teal felt and driftwood rack, ocean-blue buttons.', 'Cooler and fresher; the blue tiles sit closest to the table color.', False),
    ('pal-lilac', 'Lilac evening', 'Soft lilac around a lavender felt with a walnut rack, violet buttons.', 'The most unusual — playful, but the darker walnut rack makes the scene heavier.', False),
]
opts = []
for i, (pal, name, what, catch, rec) in enumerate(PALS, 1):
    badge = '<span class="badge">recommended</span>' if rec else ''
    opts.append(f'''<label class="opt"><div class="top"><input type="radio" name="palette" value="{i}"><span class="nm">{i}. {name}</span>{badge}</div>
    <p class="rz">{what}</p><p class="catch"><b>Catch:</b> {catch}</p>{scene(pal)}</label>''')

body = f'''<div class="wrap">
  <header>
    <h1>Rollover — the friendly color scheme</h1>
    <p class="sub">You said sweeter means 3D tiles and a friendly color scheme, and asked for some kitten love. The game now has thick, sculpted 3D tiles that lean back slightly, a kitten that sits on your rack, and a kitten as the joker. Below are three friendly color schemes, drawn live with the game’s own code. The game already uses the first one until you pick.</p>
  </header>

  <div class="ledger" style="border-color:var(--ok)">
    <h2 style="color:var(--ok)">Built — 2026-10-01</h2>
    <ul>
      <li><b>1 · Lilac evening</b> → built. It is now the game’s color scheme: lilac page, lavender felt, walnut rack, violet buttons. Sage and Seaside stay in the code, ready if you ever want them back.</li>
      <li><b>2 · The kitten on the rack, and a kitten joker</b> → built as shown: it naps while others play, wakes on your turn, sends hearts for a good meld, rolls over on a rollover run, purrs when you tap it.</li>
    </ul>
    <p>Live at <a href="https://herzer.github.io/rollover/">herzer.github.io/rollover</a> — reload if it is already open.</p>
  </div>

  <div class="ledger assume">
    <h2>The one rule this rests on — worth a yes or no first</h2>
    <p><b>Only the colors around the tiles change.</b> The 3D tile, the four number colors (coral, blue, marigold, charcoal) and the kitten are the same in all three schemes. Neon and candy stay available in the game’s palette menu for anyone who wants them.</p>
  </div>

  <div class="ledger">
    <h2>Where it goes</h2>
    <p>The whole game screen: the page around the table, the table felt and its wooden frame, the rack, and the main buttons. The tiles and the kitten stay put.</p>
  </div>

  <h2 class="q">1. Which color scheme should the game use?</h2>
  <p class="why">Only about the colors of the table, rack, page and buttons — not the tiles.</p>
  {''.join(opts)}
  <textarea class="note" data-note="palette" placeholder="Anything to add — e.g. “Seaside, but with a warmer rack”? (optional)" aria-label="Your note on question 1"></textarea>

  <h2 class="q">2. How much kitten?</h2>
  <p class="why">Only about the kitten — the rest of the game is the same either way.</p>
  <label class="opt"><div class="top"><input type="radio" name="kitten" value="1"><span class="nm">The kitten on the rack, and a kitten joker</span><span class="badge">recommended</span></div>
    <p class="rz">The kitten naps while others play, wakes up on your turn, sends hearts for a good meld, rolls over on a rollover run, purrs when you tap it. The joker tile is a kitten face.</p><p class="catch"><b>Catch:</b> it sits on the rack’s top-right corner, over a sliver of the table.</p></label>
  <label class="opt"><div class="top"><input type="radio" name="kitten" value="2"><span class="nm">Only the kitten joker</span></div>
    <p class="rz">No kitten on the rack; the joker tile stays a kitten face.</p><p class="catch"><b>Catch:</b> the game loses its little companion and the reactions it shows.</p></label>
  <label class="opt"><div class="top"><input type="radio" name="kitten" value="3"><span class="nm">No kitten</span></div>
    <p class="rz">A crown joker and no mascot.</p><p class="catch"><b>Catch:</b> less warmth; the game feels more like the classic.</p></label>
  <textarea class="note" data-note="kitten" placeholder="Anything to add, or none of these? (optional)" aria-label="Your note on question 2"></textarea>

  <h2 class="q notes">Anything else?</h2>
  <p class="why">Whatever the questions did not ask — optional.</p>
  <textarea class="note" data-note="general" placeholder="Your note (optional)" aria-label="Anything else" style="min-height:70px"></textarea>
</div>
'''
extra = '''
  .scene{margin:12px 0 2px 25px;max-width:600px;padding:16px;border-radius:16px;background:var(--bg);display:flex;flex-direction:column;gap:10px;}
  .scene .kitty{position:absolute;pointer-events:none;z-index:1;}
  .scene .btn{height:34px;}
  @media (max-width:600px){ .scene{margin-left:0;} }
'''
page = f'''<meta charset="utf-8">
<title>Rollover Color Picks</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Nunito:wght@500;600;700;800&display=swap" rel="stylesheet">
<style>
{css}
</style>
<style>{picker_style}{extra}</style>
{body}
{script}'''
(root / 'docs/palette-picker.html').write_text(page)
print('wrote', len(page))
