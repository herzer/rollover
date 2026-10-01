#!/usr/bin/env python3
"""Builds docs/tile-picker.html from the game's own tile CSS, so the picker shows the real tiles."""
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
tmpl = (pathlib.Path.home() / '.claude/templates/proposal-picker/template.html').read_text()
game_css = (root / 'src/ui/styles.css').read_text() + '\n' + (root / 'src/ui/tile-styles.css').read_text()
game_css = game_css.replace('overflow: hidden;\n}', 'overflow: auto;\n}', 1)

picker_style = tmpl[tmpl.index('<style>') + 7: tmpl.index('</style>')]
script = tmpl[tmpl.index('<div class="fallback"'):]
script = script.replace("const QS = ['first', 'second'];", "const QS = ['finish', 'finishSwitch'];")
script = script.replace("'SLUG-picks'", "'rollover-tiles-picks'").replace("'picks/SLUG'", "'picks/rollover-tiles'")
script = script.replace('0 of 2 answered', '0 of 2 answered')

CROWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/></svg>'
SET = [(0, 12, 0), (0, 13, 0), (0, 1, 1), (1, 7, 0), (2, 7, 0), (3, 7, 0), (0, 0, 0)]

def tiles(tw):
    th = round(tw * 1.32)
    out = []
    for c, n, star in SET:
        inner = f'<span class="jk">{CROWN}</span>' if n == 0 else f'<span class="n">{n}</span>'
        if star: inner += '<span class="st">★</span>'
        out.append(f'<span class="tile c{c}{" joker" if n == 0 else ""}" style="position:relative;--tw:{tw}px;--th:{th}px;--pos:none;cursor:default">{inner}</span>')
    return ''.join(out)

def sample(cls):
    return f'''<div class="sample {cls}">
      <div class="board" style="width:auto;height:auto;padding:22px 20px 30px;display:flex;gap:7px;flex-wrap:wrap">{tiles(56)}</div>
      <div class="rack" style="width:auto;height:auto;padding:12px 16px 17px;display:flex;gap:5px;flex-wrap:wrap">{tiles(40)}</div></div>'''

FINISHES = [
    ('', 'Ivory', 'Cream tile with a raised rim and a slightly recessed face; numbers look painted into an engraved groove.', 'The most familiar look — the tile everyone expects, so it surprises least.', False),
    ('ts-porcelain', 'Porcelain', 'Bright white glazed ceramic with a fine gold hairline and glossy enamel numbers.', 'The gold hairline is fine detail; on a small phone it is barely visible.', True),
    ('ts-jade', 'Two-tone', 'An ivory face on a jade-green back, like a mahjong tile — the thickest, most three-dimensional of the six.', 'The colored back makes each tile look taller, and jade sits close to the green felt.', False),
    ('ts-wood', 'Maple', 'Warm wood grain with numbers carved in, as if cut by hand.', 'Lowest contrast for the black numbers; reads as cozy rather than crisp.', False),
    ('ts-glass', 'Frosted glass', 'Frosted acrylic that lets the table glow through, with softly glowing numbers.', 'The blur effect is the heaviest for older iPads, and the felt tints every tile.', False),
    ('ts-clay', 'Clay', 'Soft, pillowy, matte — like a studio clay render; numbers stand up in relief.', 'No rim or edge line, so it looks less like a real game piece and more like an illustration.', False),
]

opts = []
for i, (cls, name, what, catch, rec) in enumerate(FINISHES, 1):
    badge = '<span class="badge">recommended</span>' if rec else ''
    opts.append(f'''<label class="opt"><div class="top"><input type="radio" name="finish" value="{i}"><span class="nm">{i}. {name}</span>{badge}</div>
    <p class="rz">{what}</p><p class="catch"><b>Catch:</b> {catch}</p>{sample(cls)}</label>''')

body = f'''<div class="wrap">
  <header>
    <h1>Rollover — pick the tile</h1>
    <p class="sub">You asked for six versions of a beautifully rendered 3D tile. Each one below is drawn live with the game’s own code — this is exactly how it will look on the felt table (big) and on your wooden rack (play size).</p>
  </header>

  <div class="ledger assume">
    <h2>The one rule this rests on — worth a yes or no first</h2>
    <p><b>Only the finish changes.</b> In every version the four number colors (red, blue, orange, black), the crown joker, the gold ★ on star tiles, and the tile size stay exactly the same — so the game reads the same whichever you pick. None of them copies the trademarked game’s tile (theirs has a smiley joker; ours is a crown).</p>
  </div>

  <div class="ledger">
    <h2>Where it goes</h2>
    <p>Every tile in the game: on the table, on your rack, in the little rack previews when a star reveals someone’s tiles, and in the end-of-round summary. Nothing else on the screen moves or changes.</p>
  </div>

  <h2 class="q">1. Which tile should the game use?</h2>
  <p class="why">Only about the look of the tile itself — not the table, the rack, or the colors of the numbers.</p>
  {''.join(opts)}
  <textarea class="note" data-note="finish" placeholder="Anything to add — e.g. “3, but with a blue back”? (optional)" aria-label="Your note on question 1"></textarea>

  <h2 class="q">2. Should each player be able to switch tiles?</h2>
  <p class="why">Only about whether the other five stay available as a choice inside the game.</p>
  <label class="opt"><div class="top"><input type="radio" name="finishSwitch" value="1"><span class="nm">Yes — your pick is the default, and each player can change it on their own screen</span><span class="badge">recommended</span></div>
    <p class="rz">Mom can choose the one she likes best for her iPad or computer; it doesn’t change what you see.</p><p class="catch"><b>Catch:</b> one more control in the game’s menu.</p></label>
  <label class="opt"><div class="top"><input type="radio" name="finishSwitch" value="2"><span class="nm">No — one tile for everyone</span></div>
    <p class="rz">The game always uses your pick; the other five are removed.</p><p class="catch"><b>Catch:</b> if Mom finds your pick hard to read, she cannot change it.</p></label>
  <textarea class="note" data-note="finishSwitch" placeholder="Anything to add, or none of these? (optional)" aria-label="Your note on question 2"></textarea>

  <h2 class="q notes">Anything else?</h2>
  <p class="why">Whatever the questions did not ask — optional.</p>
  <textarea class="note" data-note="general" placeholder="Your note (optional)" aria-label="Anything else" style="min-height:70px"></textarea>
</div>
'''

extra = '''
  .sample{display:flex;flex-direction:column;gap:8px;margin:12px 0 2px 25px;max-width:560px;}
  .sample .board,.sample .rack{border-radius:14px;}
  label.opt{cursor:pointer;}
  .tile .jk svg{stroke:url(#crownInk);}
  @media (max-width:600px){ .sample{margin-left:0;} }
'''
defs = '''<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="crownInk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d42a3b"/><stop offset=".45" stop-color="#e98a00"/><stop offset="1" stop-color="#1d5fd0"/></linearGradient></defs></svg>'''

page = f'''<meta charset="utf-8">
<title>Rollover Tile Picks</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&display=swap" rel="stylesheet">
<style>
{game_css}
</style>
<style>{picker_style}{extra}</style>
{defs}
{body}
{script}'''
(root / 'docs/tile-picker.html').write_text(page)
print('wrote docs/tile-picker.html', len(page))
