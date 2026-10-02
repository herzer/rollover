# Adopts a repainted coat (Gemini, 2026-10-02: Stefanie's first render "looks promising") onto the toon Minka's UVs.
#   blender -b <minka-toon.blend> --python scripts/blender/adopt_coat.py -- <painted image> <out.png>
# Gemini keeps the layout but not the meaning of every patch, so this
#  - fills what the model reads but the painting left as background (the shoulder corners),
#  - removes the "tail" it drew across the legs' patches (the real tail is the patch at the bottom left),
#  - gives the tiny ear-tuft pieces the ears' fur color (a paw pad landed there),
#  - darkens the real tail's tip (Minka's tail ends dark),
#  - and bleeds the colors out past every patch edge, so no gray seam shows on the model.
import bpy, sys, numpy as np
src, dst = sys.argv[sys.argv.index('--') + 1:][:2]
N = 2048
ob = bpy.data.objects['MinkaToon']; me = ob.data
eye_i = next(i for i, m in enumerate(me.materials) if m and 'Eyes' in m.name)
names = [g.name for g in ob.vertex_groups]
TAIL = {f'Tail{k}': k for k in range(1, 5)}
def part(n):
    n = n.lower()
    if 'ear' in n: return 1
    if 'tail' in n: return 2
    if 'head' in n or 'eye' in n or 'neck' in n: return 3
    if 'hind' in n or 'thigh' in n or 'calf' in n or 'hock' in n: return 4
    if 'paw' in n or 'shoulder' in n or 'clav' in n or 'elbow' in n: return 5
    return 6                                                # body
vpart, vt = [], []
for v in me.vertices:
    g = max(v.groups, key=lambda g: g.weight, default=None)
    vpart.append(part(names[g.group]) if g else 6)
    tw = [(TAIL[names[x.group]], x.weight) for x in v.groups if names[x.group] in TAIL]
    s = sum(w for _, w in tw)
    vt.append(sum(k * w for k, w in tw) / s if s else 0.0)
vt = np.array(vt)
uv = me.uv_layers['DiffuseUV'].data
label = np.zeros((N, N), np.int8); tpar = np.zeros((N, N), np.float32)
me.calc_loop_triangles()
for tri in me.loop_triangles:
    if tri.material_index == eye_i: continue
    p = np.array([uv[l].uv[:] for l in tri.loops]) * N
    vs = [me.loops[l].vertex_index for l in tri.loops]
    x0, y0 = np.maximum(np.floor(p.min(0)).astype(int) - 1, 0); x1, y1 = np.minimum(np.ceil(p.max(0)).astype(int) + 1, N - 1)
    if x1 < x0 or y1 < y0: continue
    xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
    a, b, c = p
    d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(d) < 1e-9: continue
    w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
    w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
    w2 = 1 - w0 - w1
    ins = (w0 >= -.02) & (w1 >= -.02) & (w2 >= -.02)
    lab = label[y0:y1 + 1, x0:x1 + 1]; tp = tpar[y0:y1 + 1, x0:x1 + 1]
    lab[ins] = vpart[vs[0]]
    tp[ins] = (w0 * vt[vs[0]] + w1 * vt[vs[1]] + w2 * vt[vs[2]])[ins]
# image space from here on: row 0 = top (flip Blender's bottom-up rows)
label = label[::-1]; tpar = tpar[::-1]
img = bpy.data.images.load(src); img.scale(N, N)
rgb = np.array(img.pixels[:], np.float32).reshape(N, N, 4)[::-1, :, :3].copy()
mask = label > 0
bg = np.median(np.concatenate([rgb[:16, :16], rgb[:16, -16:], rgb[-16:, :16], rgb[-16:, -16:]]).reshape(-1, 3), 0)
isbg = np.abs(rgb - bg).max(-1) < 0.035
ys, xs = np.mgrid[:N, :N]
bad = mask & isbg
# Gemini's tail strip down the right edge, painted over the legs' patches
legs = (label == 4) | (label == 5)
bad |= legs & (xs >= 1872) & (ys >= 930) & (ys <= 1690)
# the ear-tuft pieces (ear labels away from the ear patches at the right edge): the ears' outer fur color
tufts = (label == 1) & (xs < 1500)
outer = (label == 1) & (xs > 1660) & (ys > 280) & (ys < 860) & ~isbg
tufts |= mask & (label != 3) & (xs >= 1230) & (xs <= 1420) & (ys >= 1240) & (ys <= 1420)   # the pad Gemini drew there
rgb[tufts] = np.median(rgb[outer], 0)
# the real tail: which way does it run, and its tip goes dark
tail = label == 2
print('tail t range', tpar[tail].min().round(2), tpar[tail].max().round(2),
      'top rows t', tpar[tail & (ys < 1300)].mean().round(2), 'bottom rows t', tpar[tail & (ys > 1900)].mean().round(2),
      'left t', tpar[tail & (xs < 150)].mean().round(2), 'right t', tpar[tail & (xs > 400)].mean().round(2))
tip = np.clip((tpar - 3.25) / 0.5, 0, 1)[..., None] * tail[..., None]
dark = np.array([0.10, 0.075, 0.06], np.float32)
rgb = rgb * (1 - 0.85 * tip) + dark * 0.85 * tip
# painted whiskers on the face (Stefanie, 2026-10-02: "remove the painted whiskers from the face" — she has 3D ones).
# A whisker is a thin bright stroke (white top-hat over 7 px) that is also LONG and STRAIGHT: averaged along a 41-px
# line in its own direction it stays bright. Whisker-pad dots, short fur strokes and the broad white lid rims do not,
# so they stay. Face patch only.
face = label == 3
fy, fx = np.nonzero(face); y0, y1, x0, x1 = fy.min(), fy.max() + 1, fx.min(), fx.max() + 1
luma = (rgb[y0:y1, x0:x1] @ np.array([.3, .59, .11], np.float32))
def morph(a, f, r):
    out = a.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1): out = f(out, np.roll(np.roll(a, dy, 0), dx, 1))
    return out
top = np.clip(luma - morph(morph(luma, np.minimum, 3), np.maximum, 3), 0, None)
L = 20
line = np.zeros_like(top)
for k in range(16):
    ang = np.pi * k / 16; dy, dx = np.sin(ang), np.cos(ang)
    acc = np.zeros_like(top)
    for t in range(-L, L + 1):
        acc += np.roll(np.roll(top, int(round(t * dy)), 0), int(round(t * dx)), 1)
    line = np.maximum(line, acc / (2 * L + 1))
wh = (line > 0.034) & (top > 0.04) & face[y0:y1, x0:x1]
wh = morph(wh.astype(np.float32), np.maximum, 2) > 0                   # and their soft edges
whiskers = np.zeros_like(bad); whiskers[y0:y1, x0:x1] = wh & face[y0:y1, x0:x1]
print('painted whiskers removed:', int(whiskers.sum()), 'px; line score p50/p99', np.percentile(line[face[y0:y1, x0:x1]], [50, 99]).round(3))
if '--show' in sys.argv:                                               # red = what would be repainted
    dbg = rgb.copy(); dbg[whiskers] = [1, 0, 0]
    im = bpy.data.images.new('dbg', N, N); im.pixels[:] = np.concatenate([dbg[::-1], np.ones((N, N, 1), np.float32)], -1).ravel()
    im.filepath_raw = dst.replace('.png', '-whiskers.png'); im.file_format = 'PNG'; im.save()
bad |= whiskers
# fill: keep good pixels, push-pull everything else (holes and the area outside the patches) from around them
good = (mask & ~bad).astype(np.float32)
def blur(a):
    k = lambda x, ax: (np.roll(x, 1, ax) + 2 * x + np.roll(x, -1, ax)) / 4
    return k(k(a, 0), 1)
def fill(c, w):
    if c.shape[0] <= 4: return np.broadcast_to((c.sum((0, 1)) / max(w.sum(), 1e-6)), c.shape).copy()
    h = c.shape[0] // 2
    c2 = c.reshape(h, 2, h, 2, 3).sum((1, 3)); w2 = w.reshape(h, 2, h, 2).sum((1, 3))
    f2 = fill(c2, w2)
    up = blur(blur(np.repeat(np.repeat(f2, 2, 0), 2, 1)))
    known = w > 0
    out = up.copy(); out[known] = c[known] / w[known][:, None]
    return out
out = fill(rgb * good[..., None], good)
print('filled inside the patches:', int(bad.sum()), 'px', f'({100 * bad.sum() / mask.sum():.1f}%)')
im = bpy.data.images.new('coat', N, N)
im.pixels[:] = np.concatenate([out[::-1], np.ones((N, N, 1), np.float32)], -1).ravel()
im.filepath_raw = dst; im.file_format = 'PNG'; im.save()
