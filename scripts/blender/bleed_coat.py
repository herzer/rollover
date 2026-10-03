# Bleeds a painted coat past the edges of Minka's patches (2026-10-03). ArmorPaint exports black outside the patches;
# the model samples a little beyond them (texture filtering, mipmaps), so black would show as dark seams. Inside the
# patches nothing changes; outside, every pixel takes the colors around it (push-pull).
#   blender -b <minka-toon.blend> --python scripts/blender/bleed_coat.py -- <painted.png> <out.png>
import bpy, sys, numpy as np
src, dst = sys.argv[sys.argv.index('--') + 1:][:2]
ob = bpy.data.objects['MinkaToon']; me = ob.data
eye_i = next(i for i, m in enumerate(me.materials) if m and 'Eyes' in m.name)
img = bpy.data.images.load(src)
N = img.size[0]
rgb = np.array(img.pixels[:], np.float32).reshape(N, N, 4)[..., :3].copy()          # bottom row first, as UVs
uv = me.uv_layers['DiffuseUV'].data
mask = np.zeros((N, N), bool)
me.calc_loop_triangles()
for tri in me.loop_triangles:
    if tri.material_index == eye_i: continue
    p = np.array([uv[l].uv[:] for l in tri.loops]) * N
    x0, y0 = np.maximum(np.floor(p.min(0)).astype(int), 0); x1, y1 = np.minimum(np.ceil(p.max(0)).astype(int), N - 1)
    if x1 < x0 or y1 < y0: continue
    xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
    a, b, c = p
    d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(d) < 1e-9: continue
    w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
    w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
    mask[y0:y1 + 1, x0:x1 + 1] |= (w0 >= 0) & (w1 >= 0) & (1 - w0 - w1 >= 0)
# the painter's own outline is the truth where it painted: shrink the mask by a pixel so its antialiased edge is redone
inner = mask & np.roll(mask, 1, 0) & np.roll(mask, -1, 0) & np.roll(mask, 1, 1) & np.roll(mask, -1, 1)
def blur(a):
    k = lambda x, ax: (np.roll(x, 1, ax) + 2 * x + np.roll(x, -1, ax)) / 4
    return k(k(a, 0), 1)
def fill(c, w):
    if c.shape[0] <= 4: return np.broadcast_to(c.sum((0, 1)) / max(w.sum(), 1e-6), c.shape).copy()
    h = c.shape[0] // 2
    f2 = fill(c.reshape(h, 2, h, 2, 3).sum((1, 3)), w.reshape(h, 2, h, 2).sum((1, 3)))
    out = blur(blur(np.repeat(np.repeat(f2, 2, 0), 2, 1)))
    k = w > 0; out[k] = c[k] / w[k][:, None]
    return out
good = inner.astype(np.float32)
out = fill(rgb * good[..., None], good)
print('BLED %.0f%% of the texture (outside the patches)' % (100 * (1 - inner.mean())))
im = bpy.data.images.new('coat', N, N)
im.pixels[:] = np.concatenate([out, np.ones((N, N, 1), np.float32)], -1).ravel()
im.filepath_raw = dst; im.file_format = 'PNG'; im.save()
