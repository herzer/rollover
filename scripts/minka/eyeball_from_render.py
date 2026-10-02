#!/usr/bin/env python3
"""Turns a rendered eyeball picture (Stefanie's art/minka/eye-textures/cat_eyeball_texture_lblue_wide_open.jpg) into
Minka's eyeball texture: the iris centred and sized to the eyeball's mapping (iris radius = 0.446 of the width),
the baked highlight painted out (her live catchlight replaces it), and the white sclera faded to a dark rim — on a
kitten, white around the iris reads as startled.   python3 scripts/minka/eyeball_from_render.py [source.jpg]"""
import math, sys, pathlib
from PIL import Image, ImageFilter
T = pathlib.Path(__file__).resolve().parents[2] / 'art/minka/eye-textures'
src_path = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else T / 'cat_eyeball_texture_lblue_wide_open.jpg'
src = Image.open(src_path).convert('RGB'); W, H = src.size; sp = src.load()
lum = lambda p: 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]
# centre: the pupil (darkest blob) centroid
dark = [(x, y) for y in range(0, H, 2) for x in range(0, W, 2) if lum(sp[x, y]) < 30]
cx = sum(p[0] for p in dark) / len(dark); cy = sum(p[1] for p in dark) / len(dark)
# along rays: the pupil edge (leaving black) and the iris edge (entering the white sclera)
pr, ir = [], []
for k in range(72):
    a = 2 * math.pi * k / 72
    prof = []
    for r in range(int(min(W, H) / 2) - 4):
        x, y = int(cx + r * math.cos(a)), int(cy + r * math.sin(a))
        if not (0 <= x < W and 0 <= y < H): break
        prof.append(lum(sp[x, y]))
    p_edge = next((r for r, v in enumerate(prof) if v > 60), None)
    i_edge = next((r for r in range((p_edge or 0) + 30, len(prof)) if all(v > 170 for v in prof[r:r + 6])), None)
    if p_edge: pr.append(p_edge)
    if i_edge: ir.append(i_edge)
pr.sort(); ir.sort()
P, RI = pr[len(pr) // 2], ir[len(ir) // 2]
print('centre (%.0f, %.0f)  pupil r %d  iris r %d  ratio %.2f' % (cx, cy, P, RI, P / RI))
N = 1024; TARGET = 0.446 * N
out = Image.new('RGB', (N, N)); op = out.load()
s = RI / TARGET
RIM = (22, 28, 36)
for y in range(N):
    for x in range(N):
        dx, dy = (x - N / 2) * s, (y - N / 2) * s
        r = math.hypot(dx, dy)
        sx, sy = min(W - 1, max(0, int(cx + dx))), min(H - 1, max(0, int(cy + dy)))
        col = sp[sx, sy]
        if P * 1.05 < r < RI and lum(col) > 205:                  # the baked highlight: take the iris opposite
            ox, oy = min(W - 1, max(0, int(cx - dx))), min(H - 1, max(0, int(cy - dy)))
            col = sp[ox, oy]
        t = (r - RI * 0.97) / (RI * 0.08)                          # fade the sclera to a dark rim just past the iris
        if t > 0:
            t = min(1.0, t)
            col = tuple(int(c * (1 - t) + d * t) for c, d in zip(col, RIM))
        op[x, y] = col
out = out.filter(ImageFilter.SMOOTH_MORE) if False else out
out.save(T / 'eyeball.png'); print('wrote eye-textures/eyeball.png')
