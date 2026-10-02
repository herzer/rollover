# Checks a repainted coat (e.g. from Gemini) against the toon Minka's UV layout (2026-10-02).
# blender -b <minka-toon.blend> --python scripts/blender/check_coat_layout.py -- <new coat> <out dir>
# Writes uv-mask.png (where the model reads the texture), overlay.png (the new coat with the patch outlines in
# magenta and model-read pixels the new coat left as background in cyan) and prints how much is missing.
import bpy, sys, numpy as np
new, out = sys.argv[sys.argv.index('--') + 1:][:2]
N = 2048
ob = bpy.data.objects['MinkaToon']; me = ob.data
eye_i = next(i for i, m in enumerate(me.materials) if m and 'Eyes' in m.name)
uv = me.uv_layers['DiffuseUV'].data
mask = np.zeros((N, N), bool)
me.calc_loop_triangles()
for tri in me.loop_triangles:
    if tri.material_index == eye_i: continue
    p = np.array([uv[l].uv[:] for l in tri.loops]) * N
    x0, y0 = np.floor(p.min(0)).astype(int); x1, y1 = np.ceil(p.max(0)).astype(int)
    x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, N - 1), min(y1, N - 1)
    if x1 < x0 or y1 < y0: continue
    xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
    a, b, c = p
    d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(d) < 1e-9: continue
    w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
    w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
    inside = (w0 >= -1e-3) & (w1 >= -1e-3) & (1 - w0 - w1 >= -1e-3)
    mask[y0:y1 + 1, x0:x1 + 1] |= inside
img = bpy.data.images.load(new); img.scale(N, N)
px = np.array(img.pixels[:], np.float32).reshape(N, N, 4)          # bottom row first, like UV space
rgb = px[..., :3]
# the background: the color of the image corners (Gemini's flat gray)
bg = np.median(np.concatenate([rgb[:16, :16], rgb[:16, -16:], rgb[-16:, :16], rgb[-16:, -16:]]).reshape(-1, 3), 0)
isbg = np.abs(rgb - bg).max(-1) < 0.035
missing = mask & isbg
print('background', bg.round(3), 'model reads', mask.sum(), 'px; left as background', missing.sum(),
      f'({100 * missing.sum() / mask.sum():.2f}%)')
edge = mask ^ (np.roll(mask, 1, 0) & np.roll(mask, -1, 0) & np.roll(mask, 1, 1) & np.roll(mask, -1, 1))
edge = edge | np.roll(edge, 1, 0) | np.roll(edge, 1, 1)
ov = rgb.copy(); ov[~mask] *= 0.55
ov[missing] = [0, 1, 1]; ov[edge] = [1, 0, 1]
def save(a, name):
    im = bpy.data.images.new(name, N, N, alpha=True)
    im.pixels[:] = np.concatenate([a, np.ones((N, N, 1), np.float32)], -1).ravel()
    im.filepath_raw = f'{out}/{name}.png'; im.file_format = 'PNG'; im.save()
save(ov, 'overlay')
save(np.repeat(mask[..., None].astype(np.float32), 3, -1), 'uv-mask')
np.save(f'{out}/uv-mask.npy', mask)
