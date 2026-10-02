#!/usr/bin/env python3
"""Paw pads pink, like a kitten's (Stefanie, 2026-10-01: "very red. They should be pinkish"). Inside the paw
faces' texture outlines (art/minka/eyes/pad-uvs.json), red-brown pixels take a soft pink, keeping their shading.
   python3 scripts/minka/pink_pads.py <color.png>   (in place)"""
import json, sys, colorsys, pathlib
from PIL import Image, ImageDraw
path = pathlib.Path(sys.argv[1])
im = Image.open(path).convert('RGB'); W, H = im.size
mask = Image.new('L', (W, H), 0); d = ImageDraw.Draw(mask)
for poly in json.load(open(pathlib.Path(__file__).resolve().parents[2] / 'art/minka/eyes/pad-uvs.json')):
    d.polygon([(u * W, (1 - v) * H) for u, v in poly], fill=255)
px, mp = im.load(), mask.load()
PINK_H, PINK_S = 352 / 360, 0.42               # a soft kitten pink
n = 0
for y in range(H):
    for x in range(W):
        if not mp[x, y]: continue
        r, g, b = px[x, y]
        h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        if (h < 0.06 or h > 0.92) and s > 0.25 and r > g + 25:      # the red of the pads
            l2 = min(0.88, 0.62 + l * 0.35)                          # light pink, keeping some shading
            r2, g2, b2 = colorsys.hls_to_rgb(PINK_H, l2, PINK_S)
            px[x, y] = (int(r2 * 255), int(g2 * 255), int(b2 * 255)); n += 1
im.save(path)
print('pink pixels', n)
