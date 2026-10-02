#!/usr/bin/env python3
"""Builds docs/fur-picker.html: how Minka gets real fur — options, before/after renders, fur length."""
import base64, io, pathlib
from PIL import Image
root = pathlib.Path(__file__).resolve().parent.parent
fur = root / 'art/minka/fur'
tmpl = (pathlib.Path.home() / '.claude/templates/proposal-picker/template.html').read_text()
style = tmpl[tmpl.index('<style>') + 7: tmpl.index('</style>')]
script = tmpl[tmpl.index('<div class="fallback"'):]
script = script.replace("const QS = ['first', 'second'];", "const QS = ['fur_method', 'fur_length'];")
script = script.replace("'SLUG-picks'", "'minka-fur-picks'").replace("'picks/SLUG'", "'picks/minka-fur'")
script = script.replace('0 of 2 answered', '0 of 2 answered')

def img(path, w=1200, crop=None):
    im = Image.open(path).convert('RGB')
    if crop: im = im.crop(crop)
    im.thumbnail((w, w))
    b = io.BytesIO(); im.save(b, 'JPEG', quality=80)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()

def fig(path, cap, crop=None, w=1200):
    return f'<figure><img src="{img(path, w, crop)}" alt="{cap}"><figcaption>{cap}</figcaption></figure>'

# the three lengths, one per option (each render is 1800×1400)
short, medium, long_ = (fig(fur / f, c, w=700) for f, c in [
    ('len-short.png', 'Short and sleek'), ('body-fur.png', 'Medium (all other renders on this page)'), ('len-long.png', 'Long and fluffy')])

def opt(name, val, title, what, catch, extra='', rec=False):
    badge = '<span class="badge">recommended</span>' if rec else ''
    return f'''<label class="opt"><div class="top"><input type="radio" name="{name}" value="{val}"><span class="nm">{title}</span>{badge}</div>
    <p class="rz">{what}</p><p class="catch"><b>Catch:</b> {catch}</p>{extra}</label>'''

body = f'''<div class="wrap">
  <header>
    <h1>Minka’s fur</h1>
    <p class="sub">You asked whether Minka’s coat could look truly furry, since she’d be “ever so much cuter” with a more realistic fur look. You thought it wasn’t a Tripo feature but weren’t sure. I checked the options, then built a working prototype so you can judge real renders instead of descriptions.</p>
  </header>

  <div class="ledger assume">
    <h2>The one rule this rests on — worth a yes or no first</h2>
    <p><b>Minka stays the 3D model Tripo made; only her coat changes.</b> Her shape, face, skeleton and walk stay exactly as they are. Her whiskers, the guard hairs inside her ears, her eyes, nose and paw pads <b>never</b> get fur, whichever way we go.</p>
  </div>

  <div class="ledger">
    <h2>What I found</h2>
    <ul>
      <li><b>Tripo has no fur feature.</b> You were right. Its only style options are lego, voxel, voronoi and minecraft. It can repaint her texture at higher resolution (up to 8K), but a painted coat still has a smooth, plastic-like outline.</li>
      <li><b>Real fur can be drawn live in the game, on her current model.</b> The game draws her coat as many thin layers of strands, combed from head to tail. They move with her skeleton, so the fur walks with her. That is the prototype in every “with fur” render below. It costs nothing extra; it is code in the game.</li>
      <li><b>Blender is installed on your Mac.</b> It can groom real individual hairs, film-quality. But a browser can’t show those live, so she would become pre-rendered pictures or clips, no longer a live 3D kitten.</li>
    </ul>
  </div>

  <div class="ledger">
    <h2>Before and after: her current model, with and without the live fur</h2>
    <div class="figs">
      {fig(fur / 'compare-body.png' if (fur / 'compare-body.png').exists() else fur / 'compare-body.jpg', 'Left: Tripo’s painted coat. Right: live fur. Look at the fuzzy outline against the background.')}
      {fig(fur / 'compare-face.jpg', 'The face: whiskers stay clean, single hairs; eyes and nose stay bare; the muzzle keeps short velvet fur.')}
      {fig(fur / 'compare-ears.jpg', 'The ears: the inside stays bare skin, with no fur on the guard hairs. A few flyaway strands on top of her head still feather a little; I’d clean those up next.')}
      {fig(fur / 'compare-top.jpg', 'From above, as she’ll often be seen on the table: the coat is even, with no bald patches.')}
    </div>
  </div>

  <div class="ledger">
    <h2>Where it goes</h2>
    <p>Nothing moves on the game screen. Only Minka’s coat changes, on the rack now and later when she walks across the table. The buttons, the table and the tiles stay as they are.</p>
  </div>

  <h2 class="q">1. How should Minka get her fur?</h2>
  <p class="why">Only about the method. Length is the next question.</p>
  {opt('fur_method', 1, 'Live fur in the game (the prototype shown above)', 'The game draws her coat as about 26 thin layers of strands on her current model, combed toward her tail. It moves with her when she walks, sits or swipes tiles, and costs nothing per use.', 'The computer draws her coat 26 extra times per frame. On an older laptop or a phone I’d draw fewer layers automatically, so the fur gets a little thinner there. A few flyaway strands on her head still need cleanup, and the backs of her ears keep their painted fur.', rec=True)}
  {opt('fur_method', 2, 'Groomed hair in Blender, rendered as film stills or clips', 'Real individual hairs, groomed and rendered in Blender at film quality, the way the movie maker renders scenes.', 'She would no longer be a live 3D kitten. Every reaction becomes a pre-made picture or clip, so she can’t walk to any tile or react freely, which works against “full 3D”.')}
  {opt('fur_method', 3, 'Hair cards from Blender, inside the game', 'Clumps of hair drawn as many small strips, the way video games usually do fur, groomed by hand in Blender and loaded into the game.', 'Days of hand grooming, a much heavier model to download, and it tends to look spiky and game-like unless there are very many strips.')}
  {opt('fur_method', 4, 'Keep the painted coat, sharpen it', 'Tripo repaints her texture at up to 8K, so the painted fur strokes look crisper up close.', 'Her outline stays smooth like plastic, which is exactly the look you want to get away from. Costs Tripo credits.')}
  <textarea class="note" data-note="fur_method" placeholder="Anything to add, or none of these? (optional)" aria-label="Your note on question 1"></textarea>

  <h2 class="q">2. How long should her fur be?</h2>
  <p class="why">Only about length, for the live fur. If you pick another method in question 1, this guides that one too.</p>
  {opt('fur_length', 1, 'Short and sleek', 'Close to the body; the stripes stay crisp.', 'The least fluffy of the three; from a distance it is close to the painted coat.', short)}
  {opt('fur_length', 2, 'Medium', 'Soft and fluffy, with a clearly fuzzy outline, and the stripes still read.', 'A fluffy kitten could go a little longer still.', medium, rec=True)}
  {opt('fur_length', 3, 'Long and fluffy', 'The fluffiest: a soft halo all around her and big fluffy paws.', 'The stripes blur a little, and she looks a bit bigger.', long_)}
  <textarea class="note" data-note="fur_length" placeholder="Anything to add — e.g. “medium, but longer on the chest”? (optional)" aria-label="Your note on question 2"></textarea>

  <h2 class="q notes">Anything else?</h2>
  <p class="why">Whatever the questions didn’t ask. It would help to know what your mom plays on (computer, iPad or phone), so I can size the fur for it.</p>
  <textarea class="note" data-note="general" placeholder="Your note (optional)" aria-label="Anything else" style="min-height:70px"></textarea>
</div>
'''
extra = '''
  .figs{display:grid;gap:14px;margin-top:8px;}
  figure{margin:0;} figure img{display:block;width:100%;height:auto;border-radius:8px;border:1px solid var(--line);}
  figcaption{font-size:12.3px;color:var(--soft);margin-top:5px;}
  label.opt figure{margin:10px 0 0 25px;max-width:520px;}
  @media (max-width:600px){ label.opt figure{margin-left:0;} }
'''
page = f'<meta charset="utf-8">\n<title>Minka’s Fur</title>\n<style>{style}{extra}</style>\n{body}\n{script}'
(root / 'docs/fur-picker.html').write_text(page)
print('wrote', len(page) // 1024, 'KB')
