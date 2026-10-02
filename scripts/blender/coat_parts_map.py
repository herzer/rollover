# Colors each UV patch of the toon Minka by the body part that carries it (its strongest bone), 2026-10-02:
# head = red, ears = orange, tail = blue, front legs = green, hind legs = yellow, body = gray. → <out>/parts.png
import bpy, sys, numpy as np
out = sys.argv[sys.argv.index('--') + 1]
N = 1024
ob = bpy.data.objects['MinkaToon']; me = ob.data
eye_i = next(i for i, m in enumerate(me.materials) if m and 'Eyes' in m.name)
names = [g.name for g in ob.vertex_groups]
print('BONES', names)
def part(n):
    n = n.lower()
    if 'ear' in n: return (1, .55, 0)
    if 'tail' in n: return (0, .3, 1)
    if 'head' in n or 'jaw' in n or 'eye' in n or 'neck' in n: return (1, 0, 0)
    if 'hind' in n or 'thigh' in n or 'calf' in n or 'back_leg' in n or 'hock' in n: return (1, .9, 0)
    if 'paw' in n or 'arm' in n or 'leg' in n or 'hand' in n or 'shoulder' in n or 'clav' in n or 'elbow' in n: return (0, .8, .2)
    return (.6, .6, .6)
vcol = []
for v in me.vertices:
    g = max(v.groups, key=lambda g: g.weight, default=None)
    vcol.append(part(names[g.group]) if g else (.6, .6, .6))
uv = me.uv_layers['DiffuseUV'].data
img = np.zeros((N, N, 3), np.float32)
me.calc_loop_triangles()
for tri in me.loop_triangles:
    if tri.material_index == eye_i: continue
    col = vcol[me.loops[tri.loops[0]].vertex_index]
    p = np.array([uv[l].uv[:] for l in tri.loops]) * N
    x0, y0 = np.maximum(np.floor(p.min(0)).astype(int), 0); x1, y1 = np.minimum(np.ceil(p.max(0)).astype(int), N - 1)
    if x1 < x0 or y1 < y0: continue
    xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
    a, b, c = p
    d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(d) < 1e-9: continue
    w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
    w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
    ins = (w0 >= 0) & (w1 >= 0) & (1 - w0 - w1 >= 0)
    img[y0:y1 + 1, x0:x1 + 1][ins] = col
im = bpy.data.images.new('parts', N, N)
im.pixels[:] = np.concatenate([img, np.ones((N, N, 1), np.float32)], -1).ravel()
im.filepath_raw = f'{out}/parts.png'; im.file_format = 'PNG'; im.save()
