#!/usr/bin/env python3
"""Minka's colours for the toon cat (2026-10-01). Reads the pack's textures (never changes them) and writes
art/minka/toon/:
  albedo-minka.png — the gray tabby (v06) recoloured to Minka's warm brown tabby: its brightness mapped onto a
                     brown→cream ramp, pink nose / ear skin / paw pads kept;
  eyes-minka.png   — the eye atlas with the golden iris turned blue-gray like her film close-up."""
import colorsys, pathlib
from PIL import Image
ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / 'Toon Cats/Export/Textures'
OUT = ROOT / 'art/minka/toon'; OUT.mkdir(parents=True, exist_ok=True)
RAMP = [(0.00, (28, 20, 16)), (0.30, (46, 34, 26)), (0.48, (84, 62, 44)), (0.62, (132, 102, 74)),
        (0.74, (176, 146, 112)), (0.86, (224, 208, 184)), (1.00, (246, 238, 226))]
def ramp(t):
    for (a, ca), (b, cb) in zip(RAMP, RAMP[1:]):
        if t <= b:
            k = (t - a) / (b - a); return tuple(int(x + (y - x) * k) for x, y in zip(ca, cb))
    return RAMP[-1][1]
im = Image.open(SRC / 'T_StylizedCat_Albedo_v06.png').convert('RGBA'); px = im.load(); W, H = im.size
lut = [ramp(i / 255) for i in range(256)]
for y in range(H):
    for x in range(W):
        r, g, b, a = px[x, y]
        if r > g + 28 and r > b + 8: continue                      # pink skin: nose, ears, pads
        L = 0.299 * r + 0.587 * g + 0.114 * b
        L = 128 + (L - 128) * 1.55 + 22            # more contrast and a touch lighter: crisp stripes, cream muzzle/chest
        px[x, y] = (*lut[max(0, min(255, int(L)))], a)
im.save(OUT / 'albedo-minka.png')
e = Image.open(SRC / 'T_StylizedCat_Eyes.png').convert('RGBA'); ep = e.load(); W, H = e.size
for y in range(H):
    for x in range(W):
        r, g, b, a = ep[x, y]
        h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        if s > 0.25 and 0.06 < h < 0.2:                            # the golden iris
            r2, g2, b2 = colorsys.hls_to_rgb(0.57, min(0.85, l * 1.12), s * 0.55)   # Minka's blue-gray
            ep[x, y] = (int(r2 * 255), int(g2 * 255), int(b2 * 255), a)
e.save(OUT / 'eyes-minka.png')
print('wrote albedo-minka.png, eyes-minka.png')
