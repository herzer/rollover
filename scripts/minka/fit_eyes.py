#!/usr/bin/env python3
"""Fits the repainted irises (art/minka/eyes/eye*-new.png) into Minka's texture, exactly inside the old iris
outline, and makes that spot glossy in the roughness map. Writes art/minka/eyes/Color-new.png, ORM-new.png."""
import pathlib
from PIL import Image, ImageDraw, ImageFilter

EYES = pathlib.Path(__file__).resolve().parents[2] / 'art/minka/eyes'

def blobs(im, test, step=2, reach=4):
    """Clusters of pixels passing test(r,g,b), on a coarse grid: [(x0,y0,x1,y1,count)]."""
    px = im.load(); W, H = im.size
    hits = {(x, y) for y in range(0, H, step) for x in range(0, W, step) if test(*px[x, y])}
    seen, out = set(), []
    for p in hits:
        if p in seen: continue
        stack, xs, ys = [p], [], []
        seen.add(p)
        while stack:
            x, y = stack.pop(); xs.append(x); ys.append(y)
            for dx in range(-reach * step, reach * step + 1, step):
                for dy in range(-reach * step, reach * step + 1, step):
                    q = (x + dx, y + dy)
                    if q in hits and q not in seen: seen.add(q); stack.append(q)
        out.append((min(xs), min(ys), max(xs), max(ys), len(xs)))
    return sorted(out, key=lambda b: -b[4])

tex = Image.open(next(EYES.glob('tex-Color_*.png'))).convert('RGB')
orm = Image.open(next(EYES.glob('tex-ORM_*.png'))).convert('RGB')
small = tex.resize((1024, 1024))
iris_old = [(x0 * 4, y0 * 4, x1 * 4 + 4, y1 * 4 + 4) for x0, y0, x1, y1, _ in
            blobs(small, lambda r, g, b: b > r + 25 and b > g + 8, step=1, reach=3)[:2]]
print('old irises', iris_old)

news = {}
for f in ['eyeA-new.png', 'eyeB-new.png']:
    im = Image.open(EYES / f).convert('RGB')
    # the painted iris: blue-gray, clearly bluer than the fur around it
    x0, y0, x1, y1, _ = blobs(im, lambda r, g, b: b > r + 12 and b > 70, step=2, reach=3)[0]
    news[f] = im.crop((x0, y0, x1 + 2, y1 + 2))
    print(f, 'iris box', (x0, y0, x1, y1))

# Each eye lies turned in the texture layout. Measured from the model (which way "up on her face" points in
# the texture, near each iris), the slit must lean this many degrees (PIL: positive = counter-clockwise):
TURN = {(1624, 1852): -24.0, (88, 248): 29.0}
iris_art = news['eyeA-new.png']            # the cleaner painting, used for both eyes so they match
out_c, out_o = tex.copy(), orm.copy()
for (x0, y0, x1, y1) in sorted(iris_old):
    f = f'eye at {(x0, y0)}'
    w, h = x1 - x0, y1 - y0
    side = max(iris_art.size)
    sq = iris_art.resize((side, side), Image.LANCZOS)
    sq = sq.rotate(TURN.get((x0, y0), 0.0), resample=Image.BICUBIC, expand=False, fillcolor=sq.getpixel((side // 2, 2)))
    patch = sq.resize((w, h), Image.LANCZOS)
    mask = Image.new('L', (w * 4, h * 4), 0)
    ImageDraw.Draw(mask).ellipse((w * 0.06, h * 0.06, w * 4 - w * 0.06, h * 4 - h * 0.06), fill=255)
    mask = mask.resize((w, h), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))
    out_c.paste(patch, (x0, y0), mask)
    # glossy: low roughness (ORM green) inside the iris
    r, g, b = out_o.crop((x0, y0, x1, y1)).split()
    g = Image.composite(Image.new('L', (w, h), 14), g, mask)
    out_o.paste(Image.merge('RGB', (r, g, b)), (x0, y0))
    print('fitted', f, 'into', (x0, y0, x1, y1))
out_c.save(EYES / 'Color-new.png'); out_o.save(EYES / 'ORM-new.png')
# a before/after of both eyes
pairs = []
for (x0, y0, x1, y1) in sorted(iris_old):
    m = 60; box = (x0 - m, y0 - m, x1 + m, y1 + m)
    a, b = tex.crop(box), out_c.crop(box)
    pairs += [a.resize((a.width * 2, a.height * 2)), b.resize((b.width * 2, b.height * 2))]
W = sum(p.width for p in pairs) + 30; H = max(p.height for p in pairs)
s = Image.new('RGB', (W, H), (255, 255, 255)); x = 0
for p in pairs: s.paste(p, (x, 0)); x += p.width + 10
s.save(EYES / 'fit-compare.jpg', quality=90)
