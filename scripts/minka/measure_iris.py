#!/usr/bin/env python3
"""Measures the iris in an eyeball texture image, so the eyeball's UV mapping can fit it exactly — the image itself
is used unchanged (Stefanie, 2026-10-01: "use the original texture … adjust the scaling by UV mapping").
A circle is fitted to the iris's outer edge (where the dark limbal ring meets the white sclera); its centre and
radius, and the pupil radius, go to <image>.json beside it. A check image with the fitted circles is written too.
   python3 scripts/minka/measure_iris.py <image>"""
import json, math, sys, pathlib
from PIL import Image, ImageDraw

path = pathlib.Path(sys.argv[1])
rgb = Image.open(path).convert('RGB'); im = rgb.convert('L'); W, H = im.size; px = im.load()

def profile(cx, cy, a, rmax):
    out = []
    for r in range(int(rmax)):
        x, y = int(cx + r * math.cos(a)), int(cy + r * math.sin(a))
        if not (0 <= x < W and 0 <= y < H): break
        out.append(px[x, y])
    return out

def iris_edge(cx, cy):
    """Along each ray, walk inward from the white sclera: the iris begins where it turns darker than the sclera
    and stays dark for 12 px (veins are thin and do not)."""
    pts = []
    rmax = int(min(W, H) * 0.44)
    for k in range(240):
        a = 2 * math.pi * k / 240
        prof = profile(cx, cy, a, rmax)
        if len(prof) < rmax - 2: continue
        scl = sorted(prof[-40:])[20]                     # the sclera's brightness on this ray
        for r in range(len(prof) - 1, int(min(W, H) * 0.15), -1):
            if all(v < scl - 55 for v in prof[r - 12:r]):
                pts.append((cx + r * math.cos(a), cy + r * math.sin(a))); break
    return pts

def pupil_edge(cx, cy):
    pts = []
    for k in range(240):
        a = 2 * math.pi * k / 240
        prof = profile(cx, cy, a, min(W, H) * 0.4)
        r = next((r for r in range(len(prof)) if prof[r] > 55), None)
        if r: pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

def fit(pts):
    """Least-squares circle (x²+y² + D x + E y + F = 0), solved by Cramer's rule."""
    S = lambda f: sum(f(x, y) for x, y in pts)
    a11, a12, a13 = S(lambda x, y: x * x), S(lambda x, y: x * y), S(lambda x, y: x)
    a22, a23, a33 = S(lambda x, y: y * y), S(lambda x, y: y), len(pts)
    b1, b2, b3 = -S(lambda x, y: x * (x * x + y * y)), -S(lambda x, y: y * (x * x + y * y)), -S(lambda x, y: x * x + y * y)
    M = [[a11, a12, a13], [a12, a22, a23], [a13, a23, a33]]; b = [b1, b2, b3]
    det = lambda m: m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    d = det(M)
    D, E, F = [det([[b[i] if j == c else M[i][j] for j in range(3)] for i in range(3)]) / d for c in range(3)]
    cx, cy = -D / 2, -E / 2
    return cx, cy, math.sqrt(max(0.0, cx * cx + cy * cy - F))

def robust(pts):
    cx, cy, r = fit(pts)
    for _ in range(3):                      # drop points far off the circle (eyelash-like strays, the highlight)
        keep = [p for p in pts if abs(math.hypot(p[0] - cx, p[1] - cy) - r) < 0.04 * r]
        if len(keep) < 20: break
        cx, cy, r = fit(keep); pts = keep
    return cx, cy, r, len(pts)

cx, cy = W / 2, H / 2
for _ in range(3):
    cx, cy, R, n = robust(iris_edge(cx, cy))
pcx, pcy, P, pn = robust(pupil_edge(cx, cy))
print('iris centre (%.1f, %.1f) radius %.1f from %d edge points; pupil centre (%.1f, %.1f) radius %.1f (%.0f%% of the iris)' % (cx, cy, R, n, pcx, pcy, P, 100 * P / R))
out = {'image': path.name, 'size': [W, H], 'iris': {'cx': cx, 'cy': cy, 'r': R}, 'pupil': {'cx': pcx, 'cy': pcy, 'r': P}}
path.with_suffix('.json').write_text(json.dumps(out, indent=1))
chk = rgb.copy(); d = ImageDraw.Draw(chk)
d.ellipse((cx - R, cy - R, cx + R, cy + R), outline=(255, 0, 200), width=3)
d.ellipse((pcx - P, pcy - P, pcx + P, pcy + P), outline=(0, 230, 255), width=3)
d.line((cx - 12, cy, cx + 12, cy), fill=(255, 0, 200), width=3); d.line((cx, cy - 12, cx, cy + 12), fill=(255, 0, 200), width=3)
chk.save(path.with_name(path.stem + '-measured.jpg'), quality=88)
print('wrote', path.with_suffix('.json').name, 'and', path.stem + '-measured.jpg')
