#!/usr/bin/env python3
"""Turns the generated iris (art/minka/eye-textures/iris-source.png) into the eyeball texture: the pupil widened to a big,
open kitten pupil (Stefanie: "more open pupil like before"), the fibers compressed outward, the iris sized to
the eyeball's mapping (radius 0.892 of the half-width). Writes art/minka/eye-textures/eyeball.png."""
import math, pathlib
from PIL import Image
E = pathlib.Path(__file__).resolve().parents[2] / 'art/minka/eyes'
T = E.parent / 'eye-textures'
src = Image.open(T / 'iris-source.png').convert('RGB'); S = src.width; sp = src.load()
c = S / 2
# measure: iris edge (where it turns dark outside) and pupil edge, along many rays
def lum(p): return 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]
pup, iri = [], []
for k in range(36):
    a = 2 * math.pi * k / 36; prof = [lum(sp[int(c + r * math.cos(a)), int(c + r * math.sin(a))]) for r in range(int(c) - 2)]
    pup.append(next(r for r in range(len(prof)) if prof[r] > 45))
    iri.append(max(r for r in range(len(prof)) if prof[r] > 70))
P0, RI = sorted(pup)[18], sorted(iri)[18]
print('pupil', P0, 'iris', RI, 'ratio %.2f' % (P0 / RI))
P1 = RI * 0.47                                        # pupil about half the iris, as in the reference render
N = 512; out = Image.new('RGB', (N, N)); op = out.load()
scale = RI / (0.892 * N / 2)                          # output px → source px, iris radius → 0.892 of the half
for y in range(N):
    for x in range(N):
        dx, dy = (x - N / 2) * scale, (y - N / 2) * scale
        r = math.hypot(dx, dy)
        if r < P1 - 1.5:
            op[x, y] = (4, 4, 6); continue
        if r <= RI:
            rs = P0 + (r - P1) * (RI - P0) / (RI - P1)        # compress the iris outward around the bigger pupil
            rs = max(rs, P0 + 1)
        else:
            rs = r
        k = rs / r if r else 0
        sx, sy = min(S - 1, max(0, int(c + dx * k))), min(S - 1, max(0, int(c + dy * k)))
        col = sp[sx, sy]
        if r < P1 + 1.5:                                       # soft pupil edge
            t = (r - (P1 - 1.5)) / 3; col = tuple(int(4 + (v - 4) * t) for v in col)
        op[x, y] = (min(255, int(col[0] * 1.08)), min(255, int(col[1] * 1.12)), min(255, int(col[2] * 1.22)))   # lighter and a touch bluer, like the reference
out.save(T / 'eyeball.png'); print('wrote eye-textures/eyeball.png')
