#!/usr/bin/env python3
"""Enhances Tripo's own eyes in Minka's texture (2026-10-01, Stefanie: "the Tripo version is still the cutest",
with her reference of a kitten's big open pupils and fine, glossy irises). Tripo's pupil and outline stay
exactly as they are; only the blue ring gets fine radial fibers, a soft gray-blue with a hint of green near
the pupil, a darker rim and a lighter ring round the pupil. The iris and pupil also become glossy (ORM).
  python3 scripts/minka/enhance_eyes.py [color.png roughness.png out_color.png out_roughness.png]
Without arguments: the old model's textures → art/minka/eyes/Color-new.png, ORM-new.png. The irises are
found by their blue; the roughness map may be smaller than the color map (it is scaled to match).
In glTF's packed map, green is roughness."""
import math, pathlib, random, sys
from PIL import Image, ImageDraw, ImageFilter

EYES = pathlib.Path(__file__).resolve().parents[2] / 'art/minka/eyes'
# the film's Minka (art/minka/eyes/film-eyes-reference.webp): a soft gray-teal, lighter round the pupil, dark rim
TINT_OUTER, TINT_INNER = (70, 102, 126), (128, 160, 170)     # a touch bluer (Stefanie)

if len(sys.argv) == 5:
    src_c, src_o, dst_c, dst_o = map(pathlib.Path, sys.argv[1:])
else:
    src_c, src_o = next(EYES.glob('tex-Color_*.png')), next(EYES.glob('tex-ORM_*.png'))
    dst_c, dst_o = EYES / 'Color-new.png', EYES / 'ORM-new.png'
tex = Image.open(src_c).convert('RGB')
orm_small = Image.open(src_o).convert('RGB')
orm = orm_small.resize(tex.size, Image.BILINEAR) if orm_small.size != tex.size else orm_small
out, outo = tex.copy(), orm.copy()

def find_irises(im):
    """The two biggest blue blobs (Tripo's iris rings), as boxes in full-size pixels."""
    S = 1024; k = im.width / S
    px = im.resize((S, S)).load()
    blue = {(x, y) for y in range(S) for x in range(S) if px[x, y][2] > px[x, y][0] + 25 and px[x, y][2] > px[x, y][1] + 8}
    seen, boxes = set(), []
    for p in blue:
        if p in seen: continue
        stack, xs, ys = [p], [], []
        seen.add(p)
        while stack:
            x, y = stack.pop(); xs.append(x); ys.append(y)
            for dx in range(-3, 4):
                for dy in range(-3, 4):
                    q = (x + dx, y + dy)
                    if q in blue and q not in seen: seen.add(q); stack.append(q)
        boxes.append((len(xs), (int(min(xs) * k), int(min(ys) * k), int((max(xs) + 1) * k), int((max(ys) + 1) * k))))
    return [b for _, b in sorted(boxes, reverse=True)[:2]]

IRISES = find_irises(tex)
print('irises', IRISES)
import json
(dst_c.parent / 'iris-boxes.json').write_text(json.dumps(IRISES))
rnd = random.Random(7)
# irregular fibers: a random value per thin angular slice, smoothed a little, plus slower clumps —
# so neighbouring fibers differ in width and brightness instead of repeating like a comb
N = 720
raw = [rnd.random() for _ in range(N)]
fine = [(raw[i - 1] + 2 * raw[i] + raw[(i + 1) % N]) / 4 for i in range(N)]
clump = [rnd.random() for _ in range(48)]
def fibers(a, t):
    u = (a / 6.283185 + 0.5) * N
    i = int(u) % N; f = u - int(u)
    v = fine[i] * (1 - f) + fine[(i + 1) % N] * f
    k = (a / 6.283185 + 0.5) * 48; j = int(k) % 48; g = k - int(k)
    c = clump[j] * (1 - g) + clump[(j + 1) % 48] * g
    wob = math.sin(9 * a + 5 * t) * 0.15                       # fibers bend slightly as they run out
    return 0.78 + 0.32 * v + 0.18 * (c - 0.5) + wob * 0.2

for (x0, y0, x1, y1) in IRISES:
    m = 6
    box = (x0 - m, y0 - m, x1 + m, y1 + m)
    crop = tex.crop(box); px = crop.load(); W, H = crop.size
    cx, cy, rx, ry = W / 2, H / 2, (x1 - x0) / 2, (y1 - y0) / 2
    # the pupil: Tripo's dark center — keep it exactly; its centroid is the fibers' center
    dark = [(x, y) for y in range(H) for x in range(W)
            if sum(px[x, y]) < 120 and ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 0.55]
    pcx = sum(p[0] for p in dark) / len(dark); pcy = sum(p[1] for p in dark) / len(dark)
    res = crop.copy(); rp = res.load()
    mask = Image.new('L', (W, H), 0); mp = mask.load()
    for y in range(H):
        for x in range(W):
            r, g, b = px[x, y]
            e = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
            if e > 1.0 or not (b > r + 18 and b > g + 4): continue              # only Tripo's blue ring
            a = math.atan2(y - pcy, x - pcx)
            t = min(1.0, math.sqrt(e))                                           # 0 center … 1 rim
            fib = fibers(a, t)
            lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
            tint = [TINT_INNER[i] + (TINT_OUTER[i] - TINT_INNER[i]) * t for i in range(3)]
            shade = (0.55 + 0.9 * lum) * fib
            shade *= 1.0 - 0.45 * max(0.0, (t - 0.82) / 0.18)                    # darker rim
            shade *= 1.0 + 0.25 * max(0.0, 1.0 - abs(t - 0.45) / 0.12)           # lighter ring round the pupil
            new = [c * shade for c in tint]
            rp[x, y] = tuple(max(0, min(255, int(0.8 * n + 0.2 * o * fib))) for n, o in zip(new, (r, g, b)))   # keep some of Tripo's own blue
            mp[x, y] = 255
    mask = mask.filter(ImageFilter.GaussianBlur(0.8))
    out.paste(Image.composite(res, crop, mask), box[:2])
    # glossy iris and pupil (ORM green = roughness)
    gl = Image.new('L', (W, H), 0)
    ImageDraw.Draw(gl).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
    gl = gl.filter(ImageFilter.GaussianBlur(1.5))
    o = outo.crop(box); rr, gg, bb = o.split()
    gg = Image.composite(Image.new('L', (W, H), 12), gg, gl)
    outo.paste(Image.merge('RGB', (rr, gg, bb)), box[:2])
    print('eye', box, 'pupil centre', (round(pcx), round(pcy)), 'iris px', sum(1 for v in mask.getdata() if v > 128))
out.save(dst_c)
(outo.resize(orm_small.size, Image.LANCZOS) if orm_small.size != tex.size else outo).save(dst_o)
# before/after
tiles = []
for (x0, y0, x1, y1) in IRISES:
    b = (x0 - 50, y0 - 50, x1 + 50, y1 + 50)
    for im in (tex, out):
        c = im.crop(b); tiles.append(c.resize((c.width * 2, c.height * 2), Image.LANCZOS))
Wt = sum(t.width for t in tiles) + 30; Ht = max(t.height for t in tiles)
s = Image.new('RGB', (Wt, Ht), (255, 255, 255)); x = 0
for t in tiles: s.paste(t, (x, 0)); x += t.width + 10
s.save(EYES / 'enhance-compare.jpg', quality=90)
