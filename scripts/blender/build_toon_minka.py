# Minka from the Toon Cats pack (2026-10-01, Stefanie: "take one of the cats from that project and make it into a
# Minka"). The pack's files are never changed: this opens Toon Cats/Export/StylizedCat.blend and writes
#   art/minka/toon/minka-toon.blend  (quads for editing, neutral pose)
#   art/minka/3d/minka-toon.glb      (the game's model, with all 18 animations)
# Steps: Minka's coat (the pack's painting in her colors), then her body proportions: her legs take Minka's own
# joints (measured on her when the toon mesh was fitted to her, art/minka/v2/v2-shape.npz) and each bone carries
# its piece of skin along (stretched along the bone, turned with it), in the rest pose and the Blink shape key alike,
# so the animations still fit. Her head is scaled as a whole (Minka's is ~1.2× the toon's), her tail shortened (0.6×),
# and the eyes keep the toon's (approved) size within the head.
# Toon Minka 3 (2026-10-02): bare ear tufts (`_fur` attribute) and her modeled whiskers.
# Toon Minka 4 (2026-10-02): Minka's own coat (the v2 bake) instead of the pack's painted one; white whiskers.
# Toon Minka 8 (2026-10-02): only the ear tufts are bare (Toon 3–7 also bared the linings and the ear opening).
# Toon Minka 5 (2026-10-02): back to the pack's painting, recolored in Minka's colors (minka_toon_texture.py) — the
# baked coat made the face creepy; whiskers black again.
# Versions: Toon Minka 1 (2026-10-01, kitten proportions by eye) is kept in art/minka/versions/2026-10-01-toon-1;
# Toon Minka 2 (2026-10-02) has Minka's proportions — her ask: "make her look more like Minka, start with the body
# proportions".
#   blender -b --python scripts/blender/build_toon_minka.py
import bpy, bmesh, math, os
from mathutils import Vector, Matrix

ROOT = os.path.abspath('.')
P = lambda *a: os.path.join(ROOT, *a)
HEAD, EYES, TAIL = 1.20, 1.12, 0.60                       # Minka: head (ear spacing 1.23×), eyes as Toon 1, tail

bpy.ops.wm.open_mainfile(filepath=P('Toon Cats/Export/StylizedCat.blend'))
arm = bpy.data.objects['StylizedCat']; ob = bpy.data.objects['SKM_StylizedCat']
for a in bpy.data.armatures: a.pose_position = 'REST'
arm.animation_data_clear() if False else None
bpy.context.view_layer.update()

# --- her coat: the pack's own painting in Minka's colors (scripts/blender/minka_toon_texture.py, run first) ---------
# (2026-10-02: her baked texture, mapped onto this face, made it creepy and asymmetric — the pack's painting fits this
# mesh exactly, so it stays, recolored region by region through the pack's ID map.)
import json
me = ob.data
eye_i = next(i for i, m in enumerate(me.materials) if m and 'Eyes' in m.name)
for m in me.materials:
    for n in (m.node_tree.nodes if m and m.use_nodes else []):
        if n.type == 'TEX_IMAGE' and n.image and 'Albedo' in n.image.name:
            n.image = bpy.data.images.load(P(os.environ.get('COAT', 'art/minka/toon/coat-minka.png'))); n.image.pack()   # COAT= another painting

# --- her eyes: Stefanie's eyeball texture, unchanged, fitted by the UVs (the mapping of Toon Minka 1) ---------------
EYE_IMAGE = 'cat_eyeball_texture_lblue_wide_open.jpg'      # Stefanie's eye, with its measured iris (measure_iris.py)
_m = json.load(open(P('art/minka/eye-textures', os.path.splitext(EYE_IMAGE)[0] + '.json')))
IRIS, (TEX_W, TEX_H) = _m['iris'], _m['size']
TI = json.load(open(P('art/minka/toon/toon-iris.json')))   # where the pack's iris sits in its atlas cell
uv = me.uv_layers['DiffuseUV'].data
for poly in me.polygons:
    if poly.material_index != eye_i: continue
    for li in poly.loop_indices:
        u, v = uv[li].uv
        # the pack's iris sits at TI in its atlas cell (pixels, y down), hers at IRIS — one mapped onto the other, a
        # touch larger so her iris fills the eye
        dx = (u * TI['cell'] - TI['cx']) / TI['r'] / 1.04
        dy = ((1 - v) * TI['cell'] - TI['cy']) / TI['r'] / 1.04
        uv[li].uv = ((IRIS['cx'] + dx * IRIS['r']) / TEX_W, 1 - (IRIS['cy'] + dy * IRIS['r']) / TEX_H)
em = bpy.data.materials.new('MinkaEyes'); em.use_nodes = True
bsdf = em.node_tree.nodes['Principled BSDF']
tex = em.node_tree.nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(P('art/minka/eye-textures', EYE_IMAGE)); tex.image.pack()
tex.extension = 'EXTEND'
em.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.12; bsdf.inputs['Coat Weight'].default_value = 1.0; bsdf.inputs['Coat Roughness'].default_value = 0.03
me.materials[eye_i] = em

# --- her proportions: the skeleton to Minka's joints ------------------------------------------------------------
import numpy as np
S = np.load(P('art/minka/v2/v2-shape.npz'))
MJ = {nm: Vector(S['H'][i]) for i, nm in enumerate(S['bone_names'])}
B = arm.data.bones
aw = arm.matrix_world
TJ = {b.name: aw @ b.head_local for b in B}
# her legs (lengths and set), attached at the toon's own shoulders and hips; body and neck stay the toon's — her
# measured neck came out long and upright from the fit and read as a stretched neck (2026-10-02)
for s_ in 'LR':
    for top, joints in ((f'Shoulder_{s_}', ('Elbow', 'Paw', 'PawEnd')), (f'Thigh_{s_}', ('Calf', 'Hock', 'HindPaw', 'HindPawEnd'))):
        base = MJ[top]
        for j in (top,) + tuple(f'{x}_{s_}' for x in joints):
            MJ[j] = TJ[top] + (MJ[j] - base)
for nm in ('Pelvis', 'Spine1', 'Spine2', 'Chest', 'Neck', 'Head', 'Tail1', 'Clavicle_L', 'Clavicle_R'):
    MJ[nm] = TJ[nm].copy()
# her head carriage (2026-10-02, "looks like a Bulldog"): the toon holds its head low and forward with no neck; hers
# sits 1.6 cm higher and a little back. NECK_UP of the way there (all of it read as a stretched neck in v2)
NECK_UP = float(os.environ.get('NECK_UP', '0.75'))
for nm in ('Neck', 'Head'):
    MJ[nm] = TJ[nm] + (Vector(S['H'][list(S['bone_names']).index(nm)]) - TJ[nm]) * NECK_UP
# each bone maps its segment (its joint to the next joint down the chain) onto Minka's: stretched along the bone,
# turned to her direction; bones at a chain's end only move
NEXT = {'Pelvis': 'Spine1', 'Spine1': 'Spine2', 'Spine2': 'Chest', 'Chest': 'Neck', 'Neck': 'Head'}
for s_ in 'LR':
    NEXT.update({f'Clavicle_{s_}': f'Shoulder_{s_}', f'Shoulder_{s_}': f'Elbow_{s_}', f'Elbow_{s_}': f'Paw_{s_}',
                 f'Paw_{s_}': f'PawEnd_{s_}', f'Thigh_{s_}': f'Calf_{s_}', f'Calf_{s_}': f'Hock_{s_}',
                 f'Hock_{s_}': f'HindPaw_{s_}', f'HindPaw_{s_}': f'HindPawEnd_{s_}'})
def chain(root):
    out = [root]; stack = [B[root]]
    while stack:
        b = stack.pop()
        for c in b.children: out.append(c.name); stack.append(c)
    return out
HEADS, TAILS = set(chain('Head')), set(chain('Tail1'))
def bone_map(name):
    """The bone's rest-to-Minka map, as a function of a world point."""
    if name in HEADS:                       # the head as a whole: moved to her head joint, scaled
        h, h2 = TJ['Head'], MJ['Head']
        return lambda p: h2 + (p - h) * HEAD
    if name in TAILS:                       # the toon's tail, at her tail base, shortened
        h, h2 = TJ['Tail1'], MJ['Tail1']
        return lambda p: h2 + (p - h) * TAIL
    if name == 'Root': name = 'Pelvis'
    h, h2 = TJ[name], MJ[name]
    if name not in NEXT:
        return lambda p: p + (h2 - h)
    c, c2 = TJ[NEXT[name]], MJ[NEXT[name]]
    a, a2 = (c - h).normalized(), (c2 - h2).normalized()
    k = (c2 - h2).length / max((c - h).length, 1e-9)
    q = a.rotation_difference(a2)
    def f(p):
        d = p - h
        d = d + a * (d.dot(a) * (k - 1))
        return h2 + q @ d
    return f
maps = {b.name: bone_map(b.name) for b in B if not b.name.startswith('StylizedCat')}
gname = {g.index: g.name for g in ob.vertex_groups}
mw, mwi = ob.matrix_world, ob.matrix_world.inverted()
def carry(pw, groups):
    tot, out = 0.0, Vector()
    for g in groups:
        nm = gname.get(g.group)
        if nm in maps and g.weight > 0: out += maps[nm](pw) * g.weight; tot += g.weight
    return out / tot if tot > 0 else pw
keys = ob.data.shape_keys.key_blocks if ob.data.shape_keys else []
vgroups = [list(v.groups) for v in ob.data.vertices]
for kb in keys:
    for i, d in enumerate(kb.data): d.co = mwi @ carry(mw @ d.co, vgroups[i])
for i, v in enumerate(ob.data.vertices): v.co = mwi @ carry(mw @ v.co, vgroups[i])
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
awi = aw.inverted()
for eb in arm.data.edit_bones:
    if eb.name.startswith('StylizedCat'): continue
    h, t = aw @ eb.head, aw @ eb.tail
    f = maps[eb.name]; nh = f(h); ln = (f(t) - nh).length
    d = (t - h).normalized(); roll = eb.roll
    eb.head = awi @ nh; eb.tail = awi @ (nh + d * max(ln, 1e-4)); eb.roll = roll
bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.view_layer.update()
# the eyes keep the size they had in Toon Minka 1 (1.12× in their sockets)
eyes = [(chain('Eye_R'), 'Eye_R'), (chain('Eye_L'), 'Eye_L')]
for kb_or_v in [kb.data for kb in keys] + [ob.data.vertices]:
    for i, d in enumerate(kb_or_v):
        p = mw @ d.co
        for names, eb_ in eyes:
            w = sum(g.weight for g in vgroups[i] if gname.get(g.group) in names)
            if w > 0:
                piv = aw @ B[eb_].head_local
                p = p + ((piv + (p - piv) * EYES) - p) * min(1.0, w)
        d.co = mwi @ p
# --- her build: slim like Minka (2026-10-02, Stefanie: "the body is very very sturdy and muscular … looks like a
# Bulldog … slim her down … matching Minka's overall physique"). Measured, not guessed: Minka v2 is this same mesh fitted
# point for point onto Minka's own body (v2-shape.npz: V, with her joints H), so for every body and leg bone we compare
# how far its skin sits from the bone — sideways and across — on her and on the toon, and scale the toon's skin about
# the bone by that ratio (SLIM = how much of it: 1 = her measure). Head and tail keep the approved toon look; every
# point blends the scales of the bones it is skinned to, so joints stay smooth, and the skeleton (so every
# animation) is untouched.
SLIM = float(os.environ.get('SLIM', '1.0'))
H0 = {nm: Vector(S['H'][i]) for i, nm in enumerate(S['bone_names'])}          # her joints, as measured
BODY = [b for b in NEXT if b in H0 and NEXT[b] in H0]
import bmesh as _bm
_b = _bm.new(); _b.from_mesh(ob.data); _b.verts.ensure_lookup_table()
_n = len(ob.data.vertices); _seen = np.zeros(_n, bool); _pieces = []
for v in _b.verts:
    if _seen[v.index]: continue
    st = [v]; _seen[v.index] = True; vs = []
    while st:
        x = st.pop(); vs.append(x.index)
        for e in x.link_edges:
            o = e.other_vert(x)
            if not _seen[o.index]: _seen[o.index] = True; st.append(o)
    _pieces.append(vs)
_pieces.sort(key=lambda p_: -len(p_))
_piece = np.zeros(_n, int)
for i, p_ in enumerate(_pieces): _piece[p_] = i
_keep = np.where(~np.isin(_piece, (17, 18)))[0]                                 # v2 has every point but the ear tufts
V2s = S['V']; assert len(_keep) == len(V2s)
v2_of = {int(t): k for k, t in enumerate(_keep)}
Xs = np.array([tuple(mw @ v.co) for v in ob.data.vertices])
def frame(h, c):
    a = (c - h).normalized(); l = Vector((1, 0, 0)); l = (l - a * l.dot(a)).normalized()
    return a, l, a.cross(l)
dom = {}
for i, gs in enumerate(vgroups):
    g = max(gs, key=lambda g_: g_.weight, default=None)
    if g and g.weight > 0.6: dom.setdefault(gname.get(g.group), []).append(i)
scale = {}
for b in BODY:
    ids = [i for i in dom.get(b, []) if i in v2_of]
    if len(ids) < 12: continue
    def spread(P_, h, c):
        a, l, u = frame(h, c)
        D = P_ - np.array(h)
        perp = D - np.outer(D @ np.array(a), np.array(a))
        return (perp @ np.array(l)).std(), (perp @ np.array(u)).std()
    tl, tu = spread(Xs[ids], MJ[b], MJ[NEXT[b]])
    ml, mu = spread(V2s[[v2_of[i] for i in ids]], H0[b], H0[NEXT[b]])
    sl, su = np.clip(ml / tl, 0.55, 1.15), np.clip(mu / tu, 0.55, 1.15)
    scale[b] = (1 + (sl - 1) * SLIM, 1 + (su - 1) * SLIM)
    print(f'SLIM {b:12s} sideways {ml / tl:.2f} across {mu / tu:.2f} -> {scale[b][0]:.2f} {scale[b][1]:.2f}')
# Thickness alone keeps the bulldog: the toon's mass hangs low (deep boxy chest, low belly), so little leg shows.
# So each body and leg point takes Minka's own place relative to its bones (FIT = how far: 1 = hers): her offset from
# each bone it is skinned to — along the bone in proportion to the bone's length, across it as measured — rebuilt on
# the toon's skeleton and blended by the skin weights. The neck, head and tail stay the toon's.
FIT = float(os.environ.get('FIT', '1.0'))
FITBONES = set(BODY)                                           # the neck too: its base was the bulldog's chest
ENDS = {f'{e}_{s_}': f'{p_}_{s_}' for s_ in 'LR' for e, p_ in (('PawEnd', 'Paw'), ('HindPawEnd', 'HindPaw'))}
v2pos = {}
def fitted(i, pw, groups):
    if i not in v2_of: return pw
    q2 = Vector(V2s[v2_of[i]])
    tot, out = 0.0, Vector()
    for g in groups:
        nm = gname.get(g.group)
        if g.weight <= 0 or nm is None: continue
        if nm in FITBONES:
            a2, l2, u2 = frame(H0[nm], H0[NEXT[nm]]); d = q2 - H0[nm]
            a, l, u = frame(MJ[nm], MJ[NEXT[nm]])
            k = (MJ[NEXT[nm]] - MJ[nm]).length / max((H0[NEXT[nm]] - H0[nm]).length, 1e-9)
            q = MJ[nm] + a * (d.dot(a2) * k) + l * d.dot(l2) + u * d.dot(u2)
        elif nm in ENDS and nm in H0:                          # the toes: her offset from the toe joint, in the paw's frame
            pa = ENDS[nm]
            a2, l2, u2 = frame(H0[pa], H0[nm]); d = q2 - H0[nm]
            a, l, u = frame(MJ[pa], MJ[nm])
            q = MJ[nm] + a * d.dot(a2) + l * d.dot(l2) + u * d.dot(u2)
        else:
            q = pw
        out += q * g.weight; tot += g.weight
    return pw + (out / tot - pw) * FIT if tot > 0 else pw
if FIT > 0:
    P0 = [mw @ v.co for v in ob.data.vertices]
    P1 = [fitted(i, P0[i], vgroups[i]) for i in range(len(P0))]
    for kb in keys:                                            # shape keys move by the same offset
        for i, d in enumerate(kb.data): d.co = mwi @ (mw @ d.co + (P1[i] - P0[i]))
    for i, v in enumerate(ob.data.vertices): v.co = mwi @ P1[i]
    bpy.context.view_layer.update()

# --- the cheek ruff tucked in (2026-10-02, Stefanie: "tuck in the cheek ruff"): the toon's face patch ends in a jagged
# fringe that sticks out past the cheeks; Minka's face is round. The fringe is smoothed (Taubin: no shrinking), then
# the head's outline is fitted to hers (below).
RUFF_SMOOTH = 10
_b = _bm.new(); _b.from_mesh(ob.data); _b.verts.ensure_lookup_table(); _b.edges.ensure_lookup_table()
adj = {}
for e in _b.edges:
    if e.is_boundary and _piece[e.verts[0].index] == 0:
        a_, b_ = e.verts[0].index, e.verts[1].index
        adj.setdefault(a_, []).append(b_); adj.setdefault(b_, []).append(a_)
loops, used = [], set()
for s0 in adj:
    if s0 in used: continue
    lp = [s0]; used.add(s0); prev, cur = None, s0
    while True:
        nx = [m_ for m_ in adj[cur] if m_ != prev and m_ not in used]
        if not nx: break
        prev, cur = cur, nx[0]; lp.append(cur); used.add(cur)
    loops.append(lp)
X = np.array([tuple(mw @ v.co) for v in ob.data.vertices])
outer = max(loops, key=len)                                   # the face's outer edge (the eye openings are small)
L = np.array(outer)
X0 = X.copy()
for _ in range(RUFF_SMOOTH):
    for f in (0.5, -0.53):
        X[L] += f * ((X[np.roll(L, 1)] + X[np.roll(L, -1)]) / 2 - X[L])
# then the head's outline, height by height, onto hers: measured on the head (Head-weighted points; ears and eyes
# excluded), the toon is up to 2 cm wider at the lower cheeks (9.9 vs 7.6 cm from her middle at 0.24 m) and its ruff
# spikes stick out ~0.7 cm at eye height. Only the outer band moves (beyond CORE of her width), compressed so the toon's
# widest point lands on hers; the face inside is untouched
# the tufts themselves: the cheek’s outline zigzags 0.5–1 cm (sculpted fur spikes in the face mask AND the head shell behind it (piece 6), between the jaw
# and eye height). Smoothing the face mesh there, more the further out a point sits, melts them into a round cheek
CHEEK_SMOOTH = 30
nbr = [[e.other_vert(v).index for e in v.link_edges] for v in _b.verts]
cheek = [i for i in range(len(X)) if _piece[i] in (0, 6) and abs(X[i, 0]) > 0.062 and 0.225 < X[i, 2] < 0.338]
wSk = np.array([sum(g.weight for g in gs if (gname.get(g.group) or '').startswith(('Ear', 'Eye'))) for gs in vgroups])
cw = {i: float(np.clip((abs(X[i, 0]) - 0.062) / 0.015, 0, 1)) * (wSk[i] < 0.05) for i in cheek}
for _ in range(CHEEK_SMOOTH):
    Xn_ = X.copy()
    for i, w in cw.items():
        if w <= 0: continue
        Xn_[i] = X[i] + 0.5 * w * (X[nbr[i]].mean(0) - X[i])
    X = Xn_
CORE = 0.8
PROF_Z = np.array([0.20, 0.24, 0.25, 0.26, 0.27, 0.30]); PROF_X = np.array([0.074, 0.076, 0.081, 0.085, 0.087, 0.087])
wHead = np.array([sum(g.weight for g in gs if gname.get(g.group) == 'Head') for gs in vgroups])
wSkip = np.array([sum(g.weight for g in gs if (gname.get(g.group) or '').startswith(('Ear', 'Eye'))) for gs in vgroups])
sel = (wHead > 0.05) & (wSkip < 0.05) & (X[:, 2] < 0.30)
zb = np.arange(0.19, 0.31, 0.005)
mz = np.array([np.abs(X[sel & (X[:, 2] >= z) & (X[:, 2] < z + 0.005), 0]).max(initial=0) for z in zb])
mz = np.maximum.accumulate(mz[::-1])[::-1] * 0 + np.convolve(np.pad(mz, 2, mode='edge'), np.ones(5) / 5, 'valid')
for i in np.nonzero(sel)[0]:
    z = X[i, 2]; T = np.interp(z, PROF_Z, PROF_X); M = max(np.interp(z, zb + 0.0025, mz), T)
    R0 = T * CORE; ax = abs(X[i, 0])
    if ax <= R0 or M <= T: continue
    nx = R0 + (ax - R0) * (T - R0) / (M - R0)
    X[i, 0] = np.sign(X[i, 0]) * (ax + (nx - ax) * min(1.0, wHead[i] * 1.2))
# and the fringe laid flat: the face patch is a mask over the head, and its edge stands off the head like a mane. Each
# point near the edge (FLAT_RINGS edge rings in) moves onto the head surface under it (the head's other pieces), a hair
# above it, fully at the edge and less inward
from mathutils.bvhtree import BVHTree
FLAT_RINGS, LIFT = 5, 0.0015
under = [f for f in ob.data.polygons if _piece[f.vertices[0]] != 0 and f.material_index != eye_i
         and any(gname.get(g.group) == 'Head' and g.weight > 0.3 for g in vgroups[f.vertices[0]])]
uverts = sorted({v for f in under for v in f.vertices}); ui = {v: k for k, v in enumerate(uverts)}
bvh = BVHTree.FromPolygons([tuple(X[v]) for v in uverts], [[ui[v] for v in f.vertices] for f in under])
ring = {int(i): 0 for i in L}; front = list(ring)
for k in range(1, FLAT_RINGS + 1):
    nxt = []
    for i in front:
        for e in _b.verts[i].link_edges:
            o = e.other_vert(_b.verts[i]).index
            if o not in ring and _piece[o] == 0: ring[o] = k; nxt.append(o)
    front = nxt
flat = 0
for i, k in (ring.items() if os.environ.get('RUFF_FLAT', '1') == '1' else []):
    if wSkip[i] > 0.05: continue
    hit = bvh.find_nearest(Vector(X[i]))
    if hit[0] is None or hit[3] > 0.03: continue
    target = np.array(hit[0]) + np.array(hit[1]) * LIFT
    w = (1 - k / (FLAT_RINGS + 1)) ** 1.5
    X[i] += (target - X[i]) * w; flat += 1
print('RUFF flattened', flat, 'fringe points')
# one smooth field, not a move per shell: the face and the head are separate shells lying over each other and over the
# neck, and moving each by its own amount opened holes between them behind the cheeks (Toon 13, 2026-10-03: "two big
# holes on both sides of the neck head transition"). Every point near the cheeks, whatever shell it belongs to, moves
# by the weighted average of the moves around it (within FIELD_R), so shells that overlap move together.
from mathutils.kdtree import KDTree as _KD
FIELD_R = 0.012
D = X - X0
zone = [i for i in range(len(X0)) if 0.17 < X0[i, 2] < 0.36 and abs(X0[i, 0]) > 0.03 and wSk[i] < 0.05]
kdz = _KD(len(zone))
for k, i in enumerate(zone): kdz.insert(Vector(X0[i]), k)
kdz.balance()
Dn = D.copy()
for i in zone:
    near = kdz.find_range(Vector(X0[i]), FIELD_R)
    w = np.array([np.exp(-(d_ / (FIELD_R * 0.5)) ** 2) for _, _, d_ in near])
    idx = [zone[k] for _, k, _ in near]
    Dn[i] = (D[idx] * w[:, None]).sum(0) / w.sum()
X = X0 + Dn
moved = np.abs(X - X0).max(1) > 1e-7
for kb in keys:
    for i in np.nonzero(moved)[0]: kb.data[i].co = mwi @ (mw @ kb.data[i].co + Vector(X[i] - X0[i]))
for i in np.nonzero(moved)[0]: ob.data.vertices[i].co = mwi @ Vector(X[i])
bpy.context.view_layer.update()
print('RUFF tucked', int(moved.sum()), 'points; outline', len(outer))

# --- the ear tufts carry no fur: the pack makes them separate small pieces (17 and 18 in the toon_parts listing, and
# the inner-ear linings 19 and 20 they sit on), so they are marked in the model itself — a point attribute `_fur` (0 = bare) that the game's fur reads
import bmesh
bmp = bmesh.new(); bmp.from_mesh(ob.data); bmp.verts.ensure_lookup_table()
nv = len(ob.data.vertices); seen = np.zeros(nv, bool); pieces = []
for v in bmp.verts:
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
TUFTS = (17, 18)
INNER_EARS = (19, 20)                # the inner-ear linings the tufts sit on (bare in Toon Minka 3–7; furry again since 8)
BARE = TUFTS                         # 2026-10-02: "shrink the bare zone on her ears to just the tufts"
furattr = ob.data.attributes.new('_fur', 'FLOAT', 'POINT')
for i in range(nv): furattr.data[i].value = 0.0 if piece_of[i] in BARE else 1.0
print('BARE ear tufts', int(np.isin(piece_of, BARE).sum()), 'points')

# --- her whiskers: the modeled black ones (build_minka.py), carried over from Minka v2 — each strand rides with the
# muzzle point it grows from (v2 has the toon's points, minus the tufts, in the same order)
with bpy.data.libraries.load(P('art/minka/v2/minka-v2.blend')) as (src, dst):
    dst.meshes = [m for m in src.meshes if 'hisker' in m]
wm = dst.meshes[0]
wh = bpy.data.objects.new('MinkaWhiskers', wm); bpy.context.scene.collection.objects.link(wh)
W, V2 = S['W'].copy(), S['V']
keep = np.where(~np.isin(piece_of, TUFTS))[0]
assert len(keep) == len(V2)
Xn = np.array([tuple(mw @ v.co) for v in ob.data.vertices])
from mathutils.kdtree import KDTree
kv = KDTree(len(V2))
for k, p_ in enumerate(V2): kv.insert(Vector(p_), k)
kv.balance()
wbm = bmesh.new(); wbm.from_mesh(wm); wbm.verts.ensure_lookup_table()
wseen = np.zeros(len(W), bool)
for v in wbm.verts:
    if wseen[v.index]: continue
    st = [v]; wseen[v.index] = True; strand = []
    while st:
        x = st.pop(); strand.append(x.index)
        for e in x.link_edges:
            o = e.other_vert(x)
            if not wseen[o.index]: wseen[o.index] = True; st.append(o)
    root = min(strand, key=lambda i: kv.find(Vector(W[i]))[2])
    k = kv.find(Vector(W[root]))[1]
    W[strand] += Xn[keep[k]] - V2[k]
for i, v in enumerate(wm.vertices): v.co = Vector(W[i])
wh.parent = arm; wh.matrix_parent_inverse = arm.matrix_world.inverted()
g = wh.vertex_groups.new(name='Head'); g.add(range(len(wm.vertices)), 1.0, 'REPLACE')
wmod = wh.modifiers.new('Armature', 'ARMATURE'); wmod.object = arm

# stand on the ground again (shorter legs lift the paws)
zmin = min((mw @ v.co).z for v in ob.data.vertices)
print('GROUND offset', round(zmin, 4))
lift = Matrix.Translation((0, 0, -zmin))
root_obj = arm.parent or arm
root_obj.matrix_world = lift @ root_obj.matrix_world
bpy.context.view_layer.update()

# --- quads for editing in the .blend --------------------------------------------------------------------------
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.tris_convert_to_quads(face_threshold=math.pi, shape_threshold=math.pi, uvs=True, materials=True, seam=True, sharp=True)
bpy.ops.object.mode_set(mode='OBJECT')
p = ob.data.polygons
print('QUADS', sum(len(f.vertices) == 4 for f in p), 'TRIS', sum(len(f.vertices) == 3 for f in p))
ob.name = 'MinkaToon'

# --- check render (neutral pose), files ------------------------------------------------------------------------
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 800, 800
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.75, 0.75, 0.77, 1)
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun); sun.data.energy = 3
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
c = Vector((0, 0.05, 0.17))
for name, off in (('front', Vector((0.25, -0.85, 0.12))), ('side', Vector((0.9, 0.05, 0.08)))):
    cm = bpy.data.objects.new(name, bpy.data.cameras.new(name)); sc.collection.objects.link(cm); sc.camera = cm
    cm.location = c + off; cm.data.lens = 50
    cm.rotation_euler = (c - cm.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = P(f'art/minka/toon/check-{name}.png'); bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cm)
# beside Minka herself, same camera (her neutral model, placed where the v2 fit put her)
with bpy.data.libraries.load(P('art/minka/v2/minka-v2-shape.blend')) as (src, dst):
    dst.objects = [n for n in src.objects if n == 'ref_MinkaBody']
ref = dst.objects[0]; sc.collection.objects.link(ref)
bpy.context.view_layer.update()
ref.location.z -= min((ref.matrix_world @ v.co).z for v in ref.data.vertices)   # on the ground too, for a fair comparison
for name, off in (('side', Vector((0.9, 0.05, 0.08))), ('front', Vector((0.25, -0.85, 0.12)))):
    cm = bpy.data.objects.new(name, bpy.data.cameras.new(name)); sc.collection.objects.link(cm); sc.camera = cm
    cm.location = c + off; cm.data.lens = 50
    cm.rotation_euler = (c - cm.location).to_track_quat('-Z', 'Y').to_euler()
    for who, show in (('toon', True), ('minka', False)):
        ob.hide_render = not show; ref.hide_render = show
        sc.render.filepath = P(f'art/minka/toon/compare-{name}-{who}.png'); bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cm)
ob.hide_render = False; bpy.data.objects.remove(ref)
bpy.data.objects.remove(sun)
bpy.ops.wm.save_as_mainfile(filepath=P('art/minka/toon/minka-toon.blend'))
for a in bpy.data.armatures: a.pose_position = 'POSE'
bpy.ops.export_scene.gltf(filepath=P('art/minka/3d/minka-toon.glb'), export_format='GLB', export_animations=True,
                          export_animation_mode='ACTIONS', export_skins=True, export_morph=True, export_attributes=True)
print('WROTE minka-toon.blend, minka-toon.glb')
