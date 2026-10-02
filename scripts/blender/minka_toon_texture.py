# Minka's coat for the toon cat, made the pack's own way (2026-10-02). Stefanie, after her baked coat made the toon
# face creepy: "it has to be recreated using the existing texture as a guideline … a modification of the texture."
# The pack paints each cat as its neutral shading (T_StylizedCat_Albedo_Neutral) times one color per region of its
# ID map (T_StylizedCat_IDMap: blue = tabby stripes, yellow = the light muzzle/chest/belly, red = accent shading, black
# = base coat); its seven variants fit that within ~4%. So Minka's coat is the same painting with her colors: her
# golden tan, her dark stripes, her cream. Everything
# stays where the pack's artist put it — eyes, nose, mouth, symmetric — so nothing is distorted.
# Writes art/minka/toon/coat-minka.png (the pack's UV layout, 2048²).
#   blender -b --python scripts/blender/minka_toon_texture.py
import bpy, os
import numpy as np

P = lambda *a: os.path.join(os.path.abspath('.'), *a)
TEX = P('Toon Cats/Export/Textures')
SIZE = 2048
STRIPES, CREAM = 1.0, 1.0           # how strongly her stripes and her cream areas come through (1 = as measured)

def load(path, size=SIZE):
    im = bpy.data.images.load(path); im.scale(size, size // (im.size[0] // im.size[1]) if im.size[0] > im.size[1] else size)
    w, h = im.size
    a = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(a)
    return a.reshape(h, w, 4)[..., :3]

N = load(os.path.join(TEX, 'T_StylizedCat_Albedo_Neutral.png'))
I = load(os.path.join(TEX, 'T_StylizedCat_IDMap.png'))
R, G, B = I[..., 0], I[..., 1], I[..., 2]
light = np.minimum(R, G); red = np.clip(R - G, 0, 1); stripe = B

# --- her stripes and her eyes, painted (2026-10-02: "paint the stripes like Minka's, also paint the area around her
# eyes to match"). Copying her (Tripo) texture's marks read as camouflage (Toon Minka 6), so the pattern is painted
# from her film stills instead: a mackerel tabby — narrow bands down her sides, a darker line along the spine, rings on
# legs and tail (dark tail tip), lines back over the top of the head — and around each eye a thin dark rim, a pale
# cream ring (strongest below and at the inner corner) and a dark stripe sweeping back across the cheek from the outer
# corner, a second one below it. Each texel of the pack's layout finds its spot on the cat (rest pose), the pattern
# is decided there in 3D, and it is laid into the pack's ID layers, so the pack's painted shading still carries it.
# The face keeps the pack's forehead stripes (they sit right on this face).
def box(a, r):
    c = np.cumsum(np.cumsum(np.pad(a, ((r + 1, r), (r + 1, r)), mode='edge'), 0), 1)
    k = 2 * r + 1
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)
ss = lambda e0, e1, x: np.clip((x - e0) / (e1 - e0), 0, 1) ** 2 * (3 - 2 * np.clip((x - e0) / (e1 - e0), 0, 1))
def wobble(Pp, k=1.0):
    """Smooth hand-painted waviness: a few crossed sine waves through 3D."""
    x, y, z = Pp[..., 0] * 140 * k, Pp[..., 1] * 140 * k, Pp[..., 2] * 140 * k
    return (np.sin(x * 0.9 + y * 1.7) + np.sin(y * 1.3 - z * 2.1 + 1.7) + np.sin(z * 1.1 + x * 2.3 + 0.4)) / 3

bpy.ops.wm.open_mainfile(filepath=P('Toon Cats/Export/StylizedCat.blend'))
for a_ in bpy.data.armatures: a_.pose_position = 'REST'
bpy.context.view_layer.update()
ob = bpy.data.objects['SKM_StylizedCat']; me = ob.data; mw = ob.matrix_world
arm = bpy.data.objects['StylizedCat']; aw = arm.matrix_world
import bmesh
from mathutils import Vector
eye_i = next(i for i, m in enumerate(me.materials) if m and 'Eyes' in m.name)
uv0 = me.uv_layers['DiffuseUV'].data
V = np.array([tuple(mw @ v.co) for v in me.vertices])
bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
nv = len(V); seen = np.zeros(nv, bool); pieces = []
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
piece_of = np.zeros(nv, int)
for i, p_ in enumerate(pieces): piece_of[p_] = i
# the eye openings (the face mask's holes nearest the eye bones)
adj = {}
for e in bm.edges:
    if e.is_boundary and piece_of[e.verts[0].index] == 0:
        a_, b_ = e.verts[0].index, e.verts[1].index
        adj.setdefault(a_, []).append(b_); adj.setdefault(b_, []).append(a_)
loops, used = [], set()
for s0 in adj:
    if s0 in used: continue
    lp = [s0]; used.add(s0); prev, cur = None, s0
    while True:
        nx = [m for m in adj[cur] if m != prev and m not in used]
        if not nx: break
        prev, cur = cur, nx[0]; lp.append(cur); used.add(cur)
    loops.append(lp)
eyes = []
for s_ in 'LR':
    eb = np.array(tuple(aw @ arm.data.bones[f'Eye_{s_}'].head_local))
    lp = min(loops, key=lambda l: np.linalg.norm(V[l].mean(0) - eb))
    eyes.append((V[lp], V[lp].mean(0), np.linalg.norm(V[lp] - V[lp].mean(0), axis=1).mean()))

# texel → its spot on the cat
POS = np.zeros((SIZE, SIZE, 3), np.float32); PIECE = np.full((SIZE, SIZE), -1, np.int32)
for p_ in me.polygons:
    if p_.material_index == eye_i: continue
    L_ = list(p_.loop_indices); vs = list(p_.vertices)
    for t in range(1, len(L_) - 1):
        k3 = (0, t, t + 1)
        A = np.array([[uv0[L_[k]].uv.x * SIZE, (1 - uv0[L_[k]].uv.y) * SIZE] for k in k3])
        W3 = V[[vs[k] for k in k3]]
        x0, y0 = np.floor(A.min(0)).astype(int); x1, y1 = np.ceil(A.max(0)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, SIZE - 1), min(y1, SIZE - 1)
        if x1 < x0 or y1 < y0: continue
        X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        T = np.array([[A[1, 0] - A[0, 0], A[2, 0] - A[0, 0]], [A[1, 1] - A[0, 1], A[2, 1] - A[0, 1]]])
        if abs(np.linalg.det(T)) < 1e-12: continue
        Ti = np.linalg.inv(T)
        b1 = Ti[0, 0] * (X - A[0, 0]) + Ti[0, 1] * (Y - A[0, 1]); b2 = Ti[1, 0] * (X - A[0, 0]) + Ti[1, 1] * (Y - A[0, 1])
        inside = (b1 >= -0.02) & (b2 >= -0.02) & (b1 + b2 <= 1.02)
        if not inside.any(): continue
        Pt = W3[0] + b1[..., None] * (W3[1] - W3[0]) + b2[..., None] * (W3[2] - W3[0])
        ys, xs = (Y[inside] - 0.5).astype(int), (X[inside] - 0.5).astype(int)
        # mirrored UVs: her right side is the one painted; elsewhere the first face to reach a texel paints it
        keep_ = np.ones(len(ys), bool) if (mw @ p_.center).x < 0 else PIECE[ys, xs] < 0
        POS[ys[keep_], xs[keep_]] = Pt[inside][keep_]; PIECE[ys[keep_], xs[keep_]] = piece_of[vs[0]]
Pp = POS.copy(); Pp[..., 0] = np.abs(Pp[..., 0])                     # symmetric: |x| is the distance from her middle
X_, Y_, Z_ = Pp[..., 0], Pp[..., 1], Pp[..., 2]
pc = lambda *ids: np.isin(PIECE, ids)
paint = np.zeros((SIZE, SIZE), np.float32)
# torso (1) and the back of the head and neck (6): mackerel bands down the sides, leaning back toward the belly
ztop = V[np.isin(piece_of, [1])][:, 2].max()
phase = (Y_ + 0.35 * (ztop - Z_)) / 0.019 + 0.25 * wobble(Pp)
band = ss(0.62, 0.78, 0.5 + 0.5 * np.cos(2 * np.pi * phase))
side = ss(0.004, 0.012, X_) * ss(0.08, 0.13, Z_)                    # not on the spine line itself, fading to the belly
spine = (1 - ss(0.004, 0.009, X_ + 0.002 * wobble(Pp, 2))) * ss(ztop - 0.05, ztop - 0.02, Z_)
torso = np.maximum(band * side, spine)
neck_lines = ss(0.62, 0.8, 0.5 + 0.5 * np.cos(2 * np.pi * (X_ / 0.011 + 0.2 * wobble(Pp)))) * ss(0.24, 0.27, Z_)
paint = np.where(pc(1), torso, paint)
paint = np.where(pc(6), np.maximum(neck_lines, spine * 0.8), paint)
# legs (2–5): rings, fading out toward the light toes
legs = ss(0.6, 0.78, 0.5 + 0.5 * np.cos(2 * np.pi * (Z_ / 0.017 + 0.2 * wobble(Pp)))) * ss(0.025, 0.05, Z_)
paint = np.where(pc(2, 3, 4, 5), legs, paint)
# tail (7–8): rings and a dark tip
tail_base, tail_tip = V[np.isin(piece_of, [7, 8])][:, 1].min(), V[np.isin(piece_of, [7, 8])][:, 1].max()
tt = (Y_ - tail_base) / max(tail_tip - tail_base, 1e-6)
tail = np.maximum(ss(0.55, 0.72, 0.5 + 0.5 * np.cos(2 * np.pi * (tt * 7 + 0.15 * wobble(Pp)))), ss(0.86, 0.94, tt))
paint = np.where(pc(7, 8), tail, paint)
# the face (0): the pack's forehead stripes stay; her eyes get their rim, pale ring and cheek stripes
face = pc(0)
rim = np.zeros((SIZE, SIZE), np.float32); ring = np.zeros_like(rim); cheek = np.zeros_like(rim)
fy, fx = np.where(face)
F = Pp[fy, fx]
for pts, c_, r in eyes:
    if c_[0] < 0: continue                                          # one eye is enough: the face is symmetric
    a_, ab = pts, np.roll(pts, -1, 0) - pts
    d = np.full(len(F), 9.0)
    for k in range(0, len(F), 20000):
        Q = F[k:k + 20000]
        tq = np.clip(np.einsum('vsk,sk->vs', Q[:, None] - a_[None], ab) / np.maximum((ab ** 2).sum(1), 1e-12), 0, 1)
        d[k:k + 20000] = np.linalg.norm(Q[:, None] - (a_[None] + tq[..., None] * ab[None]), axis=2).min(1) / r
    rel = F - c_
    below = ss(-0.2, 0.6, -rel[:, 2] / r)                           # stronger below the eye
    inner = ss(0.0, 0.8, -(rel[:, 0]) / r)                          # and toward the nose
    rim[fy, fx] = 1 - ss(0.10, 0.22, d)
    ring[fy, fx] = (1 - ss(0.35, 0.75, d)) * ss(0.12, 0.24, d) * np.clip(0.35 + 0.65 * np.maximum(below, inner), 0, 1)
    # the cheek stripes: from the outer corner back and a little down, a second one parallel below
    outer = c_ + np.array([r * 1.0, r * 0.15, -r * 0.1])
    dirn = np.array([0.55, 0.75, -0.35]); dirn /= np.linalg.norm(dirn)
    for off, length in ((0.0, 2.6), (-0.75, 2.2)):
        o_ = outer + np.array([0, 0, off * r])
        rq = F - o_; along = rq @ dirn
        across = np.linalg.norm(rq - along[:, None] * dirn, axis=1) / r
        w_ = 0.16 + 0.1 * np.clip(1 - along / (length * r), 0, 1)
        cheek[fy, fx] = np.maximum(cheek[fy, fx], (1 - ss(w_, w_ + 0.12, across)) * ss(-0.1 * r, 0.2 * r, along) * (1 - ss(0.7, 1.0, along / (length * r))))
bodymask = pc(1, 2, 3, 4, 5, 6, 7, 8)
# soft painted edges, a little past each island so seams do not show
paint = box(paint, 2); rim = box(rim, 1); ring = box(ring, 3); cheek = box(cheek, 2)
grow = lambda m: np.clip(box(m.astype(np.float32), 3) * 2, 0, 1)
w_body = grow(bodymask)[::-1]; w_face = grow(face)[::-1]
paint, rim, ring, cheek = paint[::-1], rim[::-1], ring[::-1], cheek[::-1]   # to Blender's bottom-up rows
stripe = stripe * (1 - w_body) + paint * (1 - light) * w_body
stripe = np.maximum(stripe, np.maximum(rim * 0.95, cheek * 0.9) * w_face)
light = np.maximum(light * (1 - np.maximum(rim, cheek) * w_face), ring * w_face * 0.9)
red = red * (1 - np.maximum(rim, cheek) * w_face)
stripe = stripe * (1 - ring * w_face * 0.8)
print('PAINTED body %.0f%%, face %.0f%% of the texture' % (100 * w_body.mean(), 100 * w_face.mean()))

# her palette, from her renders and film stills: a warm golden tan coat, dark brown-black stripes, a white-cream muzzle
# and chest (measured from the v2 bake it came out too dark and gray: that bake carries the Tripo model's shading)
mid = np.array([0.58, 0.48, 0.38], np.float32)                       # a gray-leaning tan, as in her stills
dark = np.array([0.16, 0.115, 0.085], np.float32)
cream = np.array([0.93, 0.89, 0.82], np.float32)
accent = mid * 0.8 + dark * 0.2                              # the accent shading: her base a shade darker
base = np.clip(1 - light - red - stripe, 0, 1)
# one multiplier per region: her color ÷ the neutral shading's average there
def factor(mask, target):
    w = mask[..., None]
    return target / np.maximum((N * w).sum((0, 1)) / max(w.sum(), 1e-6), 1e-3)
f_base, f_light, f_red, f_stripe = factor(base, mid), factor(light, cream), factor(red, accent), factor(stripe, dark)
f_light = 1 + (f_light - 1) * CREAM
f_stripe = f_base + (f_stripe - f_base) * STRIPES
tint = (base[..., None] * f_base + light[..., None] * f_light + red[..., None] * f_red + stripe[..., None] * f_stripe)
tint /= np.maximum((base + light + red + stripe)[..., None], 1e-3)
C = np.clip(N * tint, 0, 1)
# her pink skin (nose leather, inside the ears, paw pads) stays the pack's pink
# only clear pink: red well above both green and blue (warm fur is red-leaning too, and was being caught)
pink = (np.clip(((N[..., 0] - N[..., 1]) - 0.11) / 0.06, 0, 1) * np.clip(((N[..., 0] - N[..., 2]) - 0.06) / 0.06, 0, 1))[..., None]
NOSE = np.array([0.88, 0.55, 0.47], np.float32)                     # her salmon-pink nose (and ear skin, pads)
pinkN = N * (NOSE / np.maximum((N * pink).sum((0, 1)) / max(pink.sum(), 1e-6), 1e-3))
C = C * (1 - pink) + np.clip(pinkN, 0, 1) * pink
out = bpy.data.images.new('coat-minka', SIZE, SIZE, alpha=False)
o4 = np.ones((SIZE, SIZE, 4), np.float32); o4[..., :3] = C
out.pixels.foreach_set(o4.ravel())
out.filepath_raw = P('art/minka/toon/coat-minka.png'); out.file_format = 'PNG'; out.save()
print('WROTE coat-minka.png')
