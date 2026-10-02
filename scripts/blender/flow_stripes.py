# Stripes that flow (2026-10-02, Stefanie: "the stripes do not flow"). Gemini paints each patch of the flat coat on its
# own, so a body band stops at the seam where the leg begins, the neck lines stop where the head patch ends, and so on.
# This keeps Gemini's coat (its colors, its light fur, the face and ears untouched) but lifts its dark stripes off the
# body, legs, neck and tail, and paints new ones from ONE pattern decided on the cat in 3D — so it runs across every
# seam:
#  - mackerel bands down the sides, a dark line along the spine, broken into dashes, turning to spots toward the belly;
#  - the bands bend into rings on the legs and the tail, blended by the skin weights (where the leg takes over, so do
#    its rings) — the bending is the flow;
#  - lengthwise lines over the back of the head and neck, starting exactly where Gemini's forehead lines meet the seam,
#    turning into the body's bands at the shoulders.
#   blender -b <minka-toon.blend> --python scripts/blender/flow_stripes.py -- <coat in> <coat out>
import bpy, bmesh, sys, numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree
src, dst = sys.argv[sys.argv.index('--') + 1:][:2]
SIZE = 2048
LAM_BODY, LAM_LEG, LAM_NECK, TAIL_RINGS = 0.0165, 0.015, 0.009, 7

ob = bpy.data.objects['MinkaToon']; me = ob.data; mw = ob.matrix_world
eye_i = next(i for i, m in enumerate(me.materials) if m and 'Eyes' in m.name)
V = np.array([tuple(mw @ v.co) for v in me.vertices])                 # the neutral pose (the mesh's own points)
names = [g.name for g in ob.vertex_groups]
def wsum(pred):
    out = np.zeros(len(V), np.float32)
    for v in me.vertices:
        out[v.index] = sum(g.weight for g in v.groups if pred(names[g.group]))
    return out
W_FRONT = wsum(lambda n: n.split('_')[0] in ('Shoulder', 'Elbow', 'Paw', 'PawEnd'))
W_HIND = wsum(lambda n: n.split('_')[0] in ('Thigh', 'Calf', 'Hock', 'HindPaw', 'HindPawEnd'))
W_TAIL = wsum(lambda n: n.startswith('Tail'))
W_NECK = wsum(lambda n: n in ('Neck', 'Head') or n.startswith('Ear') or n.startswith('Eye'))
# pieces (as in minka_toon_texture.py): 0 face, 1 torso, 2–5 legs, 6 back of head and neck, 7–8 tail
bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
seen = np.zeros(len(V), bool); pieces = []
for v in bm.verts:
    if seen[v.index]: continue
    st = [v]; seen[v.index] = True; vs = []
    while st:
        x = st.pop(); vs.append(x.index)
        for e in x.link_edges:
            o = e.other_vert(x)
            if not seen[o.index]: seen[o.index] = True; st.append(o)
    pieces.append(vs)
pieces.sort(key=lambda p_: -len(p_))
piece_of = np.zeros(len(V), int)
for i, p_ in enumerate(pieces): piece_of[p_] = i
print('pieces', [len(p) for p in pieces[:10]])

# --- texel → its spot on the cat, and the skin weights there ------------------------------------------------------
uv = me.uv_layers['DiffuseUV'].data
POS = np.zeros((SIZE, SIZE, 3), np.float32); PIECE = np.full((SIZE, SIZE), -1, np.int32)
WTS = np.zeros((SIZE, SIZE, 7), np.float32)
me.calc_normals_split() if hasattr(me, 'calc_normals_split') else None
NRM = np.array([tuple((mw.to_3x3() @ v.normal).normalized()) for v in me.vertices], np.float32)
VW = np.stack([W_FRONT, W_HIND, W_TAIL, W_NECK, NRM[:, 0], NRM[:, 1], NRM[:, 2]], 1)
for p_ in me.polygons:
    if p_.material_index == eye_i: continue
    L_ = list(p_.loop_indices); vs = list(p_.vertices)
    for t in range(1, len(L_) - 1):
        k3 = (0, t, t + 1)
        A = np.array([[uv[L_[k]].uv.x * SIZE, (1 - uv[L_[k]].uv.y) * SIZE] for k in k3])
        idx = [vs[k] for k in k3]
        x0, y0 = np.maximum(np.floor(A.min(0)).astype(int) - 1, 0); x1, y1 = np.minimum(np.ceil(A.max(0)).astype(int) + 1, SIZE - 1)
        if x1 < x0 or y1 < y0: continue
        X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        T = np.array([[A[1, 0] - A[0, 0], A[2, 0] - A[0, 0]], [A[1, 1] - A[0, 1], A[2, 1] - A[0, 1]]])
        if abs(np.linalg.det(T)) < 1e-12: continue
        Ti = np.linalg.inv(T)
        b1 = Ti[0, 0] * (X - A[0, 0]) + Ti[0, 1] * (Y - A[0, 1]); b2 = Ti[1, 0] * (X - A[0, 0]) + Ti[1, 1] * (Y - A[0, 1])
        ins = (b1 >= -0.03) & (b2 >= -0.03) & (b1 + b2 <= 1.03)
        if not ins.any(): continue
        b0 = 1 - b1 - b2
        ys, xs = (Y[ins] - 0.5).astype(int), (X[ins] - 0.5).astype(int)
        Pt = b0[ins, None] * V[idx[0]] + b1[ins, None] * V[idx[1]] + b2[ins, None] * V[idx[2]]
        Wt = b0[ins, None] * VW[idx[0]] + b1[ins, None] * VW[idx[1]] + b2[ins, None] * VW[idx[2]]
        # mirrored UVs: her right side (x < 0) paints; elsewhere the first face to reach a texel
        keep = np.ones(len(ys), bool) if (mw @ p_.center).x < 0 else PIECE[ys, xs] < 0
        POS[ys[keep], xs[keep]] = Pt[keep]; WTS[ys[keep], xs[keep]] = Wt[keep]; PIECE[ys[keep], xs[keep]] = piece_of[idx[0]]
Pp = POS.copy(); Pp[..., 0] = np.abs(Pp[..., 0])
Xa, Ya, Za = Pp[..., 0], Pp[..., 1], Pp[..., 2]
wF, wH, wT, wN = [np.clip(WTS[..., k], 0, 1) for k in range(4)]
NY, NZ = WTS[..., 5], WTS[..., 6]

# --- helpers ------------------------------------------------------------------------------------------------------
ss = lambda e0, e1, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - e0) / (e1 - e0), 0, 1))
def vnoise(P, f, seed=0):
    """Smooth value noise through 3D, -1..1."""
    Q = P * f; I = np.floor(Q); t = Q - I; t = t * t * (3 - 2 * t)
    def h(dx, dy, dz):
        n = (I[..., 0] + dx) * 127.1 + (I[..., 1] + dy) * 311.7 + (I[..., 2] + dz) * 74.7 + seed * 19.19
        return (np.sin(n) * 43758.5453) % 1.0 * 2 - 1
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (t[..., 0] if dx else 1 - t[..., 0]) * (t[..., 1] if dy else 1 - t[..., 1]) * (t[..., 2] if dz else 1 - t[..., 2])
                out = out + w * h(dx, dy, dz)
    return out
def box(a, r):
    c = np.cumsum(np.cumsum(np.pad(a, ((r + 1, r), (r + 1, r)), mode='edge'), 0), 1)
    k = 2 * r + 1
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)
def blur(a):
    k = lambda x, ax: (np.roll(x, 1, ax) + 2 * x + np.roll(x, -1, ax)) / 4
    return k(k(a, 0), 1)
def fill(c, w):
    """Push-pull: fills where w == 0 from the colors around."""
    if c.shape[0] <= 4: return np.broadcast_to(c.sum((0, 1)) / max(w.sum(), 1e-6), c.shape).copy()
    h = c.shape[0] // 2
    f2 = fill(c.reshape(h, 2, h, 2, 3).sum((1, 3)), w.reshape(h, 2, h, 2).sum((1, 3)))
    out = blur(blur(np.repeat(np.repeat(f2, 2, 0), 2, 1)))
    k = w > 0; out[k] = c[k] / w[k][:, None]
    return out

# --- Gemini's coat, its stripes lifted off the body ---------------------------------------------------------------
img = bpy.data.images.load(src); img.scale(SIZE, SIZE)
rgb = np.array(img.pixels[:], np.float32).reshape(SIZE, SIZE, 4)[::-1, :, :3].copy()     # row 0 = top
luma = rgb @ np.array([.3, .59, .11], np.float32)
body = np.isin(PIECE, [1, 2, 3, 4, 5, 6, 7, 8])
pink = (rgb[..., 0] - rgb[..., 1] > 0.12) & (rgb[..., 0] - rgb[..., 2] > 0.1)            # paw pads stay
ref = box(np.where(body, luma, 0), 24) / np.maximum(box(body.astype(np.float32), 24), 1e-3)
dark = body & ~pink & (luma < np.minimum(ref - 0.06, 0.55))
dark = box(dark.astype(np.float32), 2) > 0.05                                             # with their soft edges
stripe_rgb = np.median(rgb[dark & body & (luma < 0.35)], 0)
print('Gemini stripes: %.1f%% of the body, color %s' % (100 * (dark & body).sum() / body.sum(), stripe_rgb.round(3)))
good = (~dark).astype(np.float32)
base = fill(rgb * good[..., None], good)
# the filled places get a little of the fur's grain back (fine hair-like noise along the body)
grain = vnoise(Pp * np.array([1, 0.35, 1.6], np.float32), 900, 3) * 0.05 + vnoise(Pp, 300, 4) * 0.03
base = np.where((dark & body)[..., None], base * (1 + grain[..., None]), base)

# --- one stripe pattern on the cat --------------------------------------------------------------------------------
tor = np.isin(piece_of, [1]); ztop = V[tor, 2].max()
zspine = float(np.percentile(V[tor, 2], 60))
tail_pts = V[np.isin(piece_of, [7, 8])]; t0, t1 = tail_pts[:, 1].min(), tail_pts[:, 1].max()
arm = ob.parent if ob.parent and ob.parent.type == 'ARMATURE' else next(o for o in bpy.data.objects if o.type == 'ARMATURE')
J = lambda n: np.array(tuple(arm.matrix_world @ arm.data.bones[n].head_local))
SH, HP = J('Shoulder_L'), J('Thigh_L')
# ONE phase: the body's bands. On a leg its own bones take over and bend the same bands into rings — the band keeps its
# number, its ring tilts level and tightens (from the body's 0.35 lean to RING), measured from where the leg leaves
# the body, so nothing is squeezed at the joint
RING = 1.1
def bend(w, y_at, z_at):
    return w * (y_at - Ya), w * (RING - 0.35) * (z_at - Za)
dyF, dzF = bend(wF, SH[1], SH[2] - 0.05)
dyH, dzH = bend(wH, HP[1], HP[2] - 0.05)
phi = (Ya + dyF + dyH + 0.35 * (ztop - Za) + dzF + dzH) / LAM_BODY
# the neck lines start where Gemini's forehead lines cross into the back-of-head patch
face = PIECE == 0; neckp = PIECE == 6
ny, nx = np.nonzero(neckp)
kd = KDTree(len(ny) // 7 + 1)
for k, (a, b) in enumerate(zip(ny[::7], nx[::7])): kd.insert(Vector(POS[a, b]), k)
kd.balance()
fy, fx = np.nonzero(face & (luma > 0))
near = np.array([kd.find(Vector(POS[a, b]))[2] < 0.004 for a, b in zip(fy, fx)])
seam_x = Xa[fy[near], fx[near]]; seam_dark = np.clip(0.6 - luma[fy[near], fx[near]], 0, 1)
bins = np.arange(0, 0.05, 0.001)
hist = np.array([seam_dark[(seam_x >= b) & (seam_x < b + 0.001)].mean() if ((seam_x >= b) & (seam_x < b + 0.001)).any() else 0 for b in bins])
hist = np.convolve(hist, [0.25, 0.5, 0.25], 'same')
peaks = [bins[i] + 0.0005 for i in range(1, len(hist) - 1) if hist[i] > hist[i - 1] and hist[i] >= hist[i + 1] and hist[i] > 0.12]
print('forehead lines at the seam (|x|, cm):', [round(p * 100, 2) for p in peaks])
seam_y = float(np.median(Ya[fy[near], fx[near]])) if near.any() else 0.0
# lengthwise lines: each forehead line continues back, spreading a little toward the shoulders
spread = 1 + np.clip((Ya - seam_y) / 0.05, 0, None) * 0.6
neck_lines = np.zeros_like(Xa)
for p in (peaks or [0.0, 0.008]):
    w_ = 0.0016 if p < 0.002 else 0.0022
    neck_lines = np.maximum(neck_lines, np.exp(-((Xa - p * spread) / w_) ** 2))

wb = np.clip(1 - wF - wH - wT, 0, 1); tot = np.ones_like(wb)
ragged = 0.22 * vnoise(Pp, 140, 1) + 0.06 * vnoise(Pp * np.array([1, 2.5, 1], np.float32), 700, 2)
bands = ss(0.6, 0.72, 0.5 + 0.5 * np.cos(2 * np.pi * (phi + ragged)))
broken = ss(-0.25, 0.15, vnoise(Pp, 75, 5) + 0.35)                                         # gaps: dashes, not hoops
bands = bands * broken
# toward the belly the bands break up into spots; the legs' rings fade toward the light toes
belly = 1 - ss(0.10, 0.15, Za)
spots = ss(0.15, 0.45, vnoise(Pp, 160, 6))
bands = bands * (1 - belly * wb / tot) + spots * bands.clip(0.3, 1) * belly * (wb / tot) * 0.9
bands = bands * ss(0.022, 0.045, Za) ** (1 - wb / tot)                                    # light toes (legs only)
spine = (1 - ss(0.0035, 0.0075, Xa + 0.0015 * vnoise(Pp, 200, 7))) * ss(zspine, zspine + 0.02, Za) * (wb / tot)
# the head and neck: their lengthwise lines; toward the shoulders they hand over to the bands
wn = ss(0.15, 0.65, wN) * (1 - ss(0.018, 0.028, Xa))      # lengthwise lines on top only; the sides carry the bands
tail_tip = ss(0.86, 0.94, (Ya - t0) / max(t1 - t0, 1e-6)) * (wT > 0.5)
m = np.maximum(bands * (1 - wn), neck_lines * wn)
m = np.maximum(m, np.maximum(spine * (1 - wn * 0.5), tail_tip))
bib = ss(0.35, 0.75, -NY) * (1 - ss(SH[2] - 0.02, SH[2] + 0.03, Za)) * (1 - ss(0.3, 0.6, wF + wH))
m = m * (1 - 0.85 * bib)                                                                   # her light chest
m = box(m, 1) * body * ~pink
# the stripe color: Gemini's, with a little life in it
col = stripe_rgb * (0.9 + 0.2 * (0.5 + 0.5 * vnoise(Pp, 60, 8)))[..., None]
out = np.where(body[..., None], base * (1 - m[..., None] * 0.92) + col * m[..., None] * 0.92, rgb)

# bleed past every patch edge so no seam shows (push-pull from the patches outward)
mask = (PIECE >= 0).astype(np.float32)
out = fill(out * mask[..., None], mask)
im = bpy.data.images.new('coat', SIZE, SIZE)
im.pixels[:] = np.concatenate([out[::-1], np.ones((SIZE, SIZE, 1), np.float32)], -1).ravel()
im.filepath_raw = dst; im.file_format = 'PNG'; im.save()
print('WROTE', dst)
