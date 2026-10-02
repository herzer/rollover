# Minka v2 (2026-10-01): the Toon Cats mesh — clean topology, a skeleton with 19 animations, and eyes that work —
# reshaped into Minka. Stefanie: "take the low poly mesh, change it to be exactly like the Minka mesh, but preserve
# the eye area … the eyes are solved perfectly here." Her texture, proportions and fur come from Minka; the toon's
# cartoon parts (the cheek ruff, the ear tufts) go.
#
#   1. landmarks on both cats (paws, leg sections, back/belly/flank stations, chest, rump, tail, eyes, nose, crown,
#      ears, chin), Minka's made mirror-symmetric;
#   2. a smooth warp (thin-plate spline) carries the toon onto Minka (scripts/blender/neutral_minka.py stands her
#      neutral first), then every vertex is projected onto her surface, with smoothing between rounds;
#   3. the eye area is not projected: each toon eye (opening, lids, eyeball) moves as one rigid, scaled piece into
#      Minka's eye opening, blended into the projected face around it;
#   4. the result is made exactly symmetric; the bones move with it (their orientations stay, so the clips still fit).
#   blender -b --python scripts/blender/fit_minka_v2.py            (STAGE=bake also bakes her texture and exports)
import bpy, bmesh, json, math, os, sys
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

ROOT = os.path.abspath('.'); P = lambda *a: os.path.join(ROOT, *a)
STAGE = os.environ.get('STAGE', 'shape')
OUT = P('art/minka/v2')
EYE_FULL, EYE_FADE = 0.3, 1.1       # eye area: rigid up to 0.3 opening radii beyond the rim, blended out to 1.1
EYE_SIZE = 1.15                     # the toon's visible eye is smaller than its opening; this matches Minka's eye size
TUFTS = (17, 18)                    # toon pieces dropped: the spiky tufts at the ear base (toon_parts listing)
EYE_PIECES = (13, 14, 21, 22)       # the eyeballs and the small lid pieces beside them: always rigid

# --- the two cats ------------------------------------------------------------------------------------------------
bpy.ops.wm.open_mainfile(filepath=P('art/minka/v2/minka-neutral.blend'))
mk_objs = {o.name: o for o in bpy.data.objects if o.type == 'MESH'}
with bpy.data.libraries.load(P('Toon Cats/Export/StylizedCat.blend')) as (src, dst):
    dst.objects = list(src.objects)
for o in dst.objects:
    if o: bpy.context.scene.collection.objects.link(o)
for a in bpy.data.armatures: a.pose_position = 'REST'
bpy.context.view_layer.update()
ob = bpy.data.objects['SKM_StylizedCat']; arm = bpy.data.objects['StylizedCat']
mw = ob.matrix_world.copy(); mwi = mw.inverted()
me = ob.data
TV = np.array([tuple(mw @ v.co) for v in me.vertices])          # toon, world (m), faces -Y, her left = +X

# pieces (connected parts), largest first — the same numbering as the toon_parts listing
bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
seen = np.full(len(me.vertices), -1); pieces = []
for v in bm.verts:
    if seen[v.index] >= 0: continue
    st = [v]; seen[v.index] = 0; vs = []
    while st:
        x = st.pop(); vs.append(x.index)
        for e in x.link_edges:
            o2 = e.other_vert(x)
            if seen[o2.index] < 0: seen[o2.index] = 0; st.append(o2)
    pieces.append(vs)
pieces.sort(key=lambda p: -len(p))
piece_of = np.zeros(len(me.vertices), int)
for i, p in enumerate(pieces): piece_of[p] = i
body_mask = ~np.isin(piece_of, TUFTS + EYE_PIECES)

# Minka, turned into the toon's axes (her +X forward → -Y)
mk = mk_objs['MinkaBody']
R90 = Matrix.Rotation(-math.pi / 2, 4, 'Z')
def mk_world(o): return np.array([tuple(R90 @ o.matrix_world @ v.co) for v in o.data.vertices])
MV = mk_world(mk)
joints = json.load(open(P('art/minka/v2/neutral-joints.json')))
mkj = {k: (np.array(tuple(R90 @ Vector(v[0]))), np.array(tuple(R90 @ Vector(v[1])))) for k, v in joints.items()}

def loops(bmesh_obj, idx_mask=None):
    """Boundary loops of a bmesh as lists of vertex indices."""
    bnd = [e for e in bmesh_obj.edges if e.is_boundary and (idx_mask is None or all(idx_mask[v.index] for v in e.verts))]
    adj = {}
    for e in bnd:
        a, b = e.verts[0].index, e.verts[1].index
        adj.setdefault(a, []).append(b); adj.setdefault(b, []).append(a)
    out, used = [], set()
    for s in adj:
        if s in used: continue
        loop = [s]; used.add(s); prev, cur = None, s
        while True:
            nxt = [n for n in adj[cur] if n != prev and n not in used]
            if not nxt: break
            prev, cur = cur, nxt[0]; loop.append(cur); used.add(cur)
        out.append(loop)
    return out

def frame(pts):
    """Center, mean radius, normal (smallest spread) and width axis (largest spread) of a ring of points."""
    c = pts.mean(0); d = pts - c
    w, v = np.linalg.eigh(d.T @ d)
    return c, np.linalg.norm(d, axis=1).mean(), v[:, 0], v[:, 2]

# --- eye openings ------------------------------------------------------------------------------------------------
eye_bone = {s: np.array(tuple(arm.matrix_world @ arm.data.bones[f'Eye_{s}'].head_local)) for s in 'LR'}
mask_loops = loops(bm, piece_of == 0)
toon_eye, eye_loop = {}, {}
for s in 'LR':
    lp = min(mask_loops, key=lambda l: np.linalg.norm(TV[l].mean(0) - eye_bone[s]))
    toon_eye[s] = frame(TV[lp]); eye_loop[s] = lp
mbm = bmesh.new(); mbm.from_mesh(mk.data); mbm.verts.ensure_lookup_table()
mk_loops = sorted(loops(mbm), key=len, reverse=True)[:2]
mk_eye = {}
for lp in mk_loops:
    f = frame(MV[lp]); mk_eye['L' if f[0][0] > np.mean([MV[l].mean(0)[0] for l in mk_loops]) else 'R'] = f
print('EYE OPENINGS toon r %.4f / %.4f, minka r %.4f / %.4f' % (toon_eye['L'][1], toon_eye['R'][1], mk_eye['L'][1], mk_eye['R'][1]))

# --- landmarks ---------------------------------------------------------------------------------------------------
def landmarks(V, eyes, tail_mask):
    """Named landmark points on a cat standing on z≈0, facing roughly -Y. Returns {name: point}."""
    zmin = V[:, 2].min(); Hgt = V[:, 2].max() - zmin
    low = V[V[:, 2] < zmin + 0.05 * Hgt]
    c0 = low.mean(0)
    quad = {}
    for fb, sgn in (('front', -1), ('hind', 1)):
        for s, ss in (('L', 1), ('R', -1)):
            q = low[(np.sign(low[:, 1] - c0[1]) == sgn) & (np.sign(low[:, 0] - c0[0]) == ss)]
            quad[(fb, s)] = q.mean(0)
    fwd = (quad[('front', 'L')] + quad[('front', 'R')] - quad[('hind', 'L')] - quad[('hind', 'R')]) / 2
    fwd[2] = 0; fwd /= np.linalg.norm(fwd)
    left = np.cross([0, 0, 1], fwd)
    O = sum(quad.values()) / 4; O[2] = zmin
    U = (V - O) @ fwd; S = (V - O) @ left; Z = V[:, 2] - zmin
    uf = np.mean([(quad[('front', s)] - O) @ fwd for s in 'LR']); uh = np.mean([(quad[('hind', s)] - O) @ fwd for s in 'LR'])
    L = uf - uh
    W = np.percentile(np.abs(S), 98) * 2
    mid = np.abs(S) < 0.08 * W
    between = (U > uh + 0.2 * L) & (U < uf - 0.2 * L)
    belly = np.percentile(Z[mid & between & ~tail_mask], 2)
    pt = lambda u, s, z: O + fwd * u + left * s + np.array([0, 0, z])
    out = {}
    for (fb, s), q in quad.items():
        out[f'paw.{fb}.{s}'] = q
        qu, qs = (q - O) @ fwd, (q - O) @ left
        for k, fr in enumerate((0.25, 0.5, 0.75)):
            sel = (np.abs(Z - fr * belly) < 0.05 * Hgt) & (np.hypot(U - qu, S - qs) < 0.22 * L) & ~tail_mask
            if sel.sum() > 3: out[f'leg{k}.{fb}.{s}'] = V[sel].mean(0)
    for k, t in enumerate((0.0, 0.25, 0.5, 0.75)):
        u = uh + t * L
        band = (np.abs(U - u) < 0.07 * L) & ~tail_mask & (Z > belly * 0.85)   # wide enough for the toon's sparse vertices
        top_z = Z[band & mid].max()
        if k < 3: out[f'top{k}'] = pt(u, 0, top_z)       # above the front paws the top is the head: not a body point
        bot = band & mid & (Z < (belly + top_z) / 2)
        if bot.sum(): out[f'bottom{k}'] = pt(u, 0, Z[bot].min())
        side = band & (Z > belly) & (Z < (top_z if k < 3 else out['top2'][2] - zmin))
        out[f'flank{k}.L'] = pt(u, S[side].max(), Z[side][np.argmax(S[side])])
        out[f'flank{k}.R'] = pt(u, S[side].min(), Z[side][np.argmin(S[side])])
    top3 = out['top2'][2] - zmin
    # rump: the furthest-back midline point below the tail; chest: the furthest-forward one at chest height
    rz = (Z > belly) & (Z < belly + 0.45 * (top3 - belly)) & mid & ~tail_mask & (U < uh + 0.3 * L)
    out['rump'] = V[rz][np.argmin(U[rz])]
    eyes_c = {s: e[0] for s, e in eyes.items()}
    eye_mid = (eyes_c['L'] + eyes_c['R']) / 2; eye_d = np.linalg.norm(eyes_c['L'] - eyes_c['R'])
    cz = (Z > belly) & (Z < (eye_mid[2] - zmin) - 1.4 * eye_d) & mid & (U > uf - 0.3 * L)
    out['chest'] = V[cz][np.argmax(U[cz])]
    for s in 'LR': out[f'eye.{s}'] = eyes_c[s]
    eu = (eye_mid - O) @ fwd
    head = (Z > (eye_mid[2] - zmin) - 1.5 * eye_d) & (U > eu - 2.5 * eye_d) & ~tail_mask
    hm = head & (np.abs(S) < 0.12 * eye_d)
    out['nose'] = V[hm][np.argmax(U[hm])]
    crown = hm & (U < eu) & (U > eu - 1.6 * eye_d)
    out['crown'] = V[crown][np.argmax(Z[crown])]
    for s, ss in (('L', 1), ('R', -1)):
        e = head & (S * ss > 0.4 * eye_d)
        out[f'ear.{s}'] = V[e][np.argmax(Z[e])]
    # chin: the lowest point of the face's front, just behind the nose tip (the chest is further back)
    ch = mid & (U > (out['nose'] - O) @ fwd - 0.5 * eye_d) & (Z > (eye_mid[2] - zmin) - 2 * eye_d)
    out['chin'] = V[ch][np.argmin(Z[ch])]
    bh = mid & (Z > eye_mid[2] - zmin) & (Z < (out['crown'][2] - zmin)) & (U < eu)
    out['headback'] = V[bh][np.argmin(U[bh])]
    # tail: base = where it leaves the body (the tail's end nearest the body), then the center of the tail at a
    # third, two thirds, and its tip
    tv = V[tail_mask]; body_c = V[~tail_mask].mean(0)
    b0 = tv[np.argmin(np.linalg.norm(tv - body_c, axis=1))]
    tl = np.linalg.norm(tv - b0, axis=1).max()
    base = tv[np.linalg.norm(tv - b0, axis=1) < 0.08 * tl].mean(0)
    dist = np.linalg.norm(tv - base, axis=1); tl = dist.max()
    out['tail0'] = base
    for k, fr in enumerate((0.33, 0.66)):
        sel = np.abs(dist - fr * tl) < 0.06 * tl
        out[f'tail{k + 1}'] = tv[sel].mean(0)
    out['tail3'] = tv[dist > 0.94 * tl].mean(0)
    return out, dict(O=O, fwd=fwd, left=left, belly=belly, H=Hgt, L=L)

toon_tail = np.isin(piece_of, (7, 8))
lt, ft = landmarks(TV, toon_eye, toon_tail)
# Minka's tail: the vertices her rig gives to the tail bones (above 0.8 — lower weights bleed into the hind legs)
gname = {g.index: g.name for g in mk.vertex_groups}
Mtail = np.array([sum(x.weight for x in v.groups if gname[x.group].startswith('tail')) > 0.8 for v in mk.data.vertices])
lm, fm = landmarks(MV, mk_eye, Mtail)
names = [k for k in lt if k in lm]
print('LANDMARKS', len(names), 'missing:', sorted(set(lt) ^ set(lm)))
for k in names: print('  LM %-14s toon %s  minka %s' % (k, np.round(lt[k], 3), np.round(lm[k], 3)))

# similarity Minka → toon (Umeyama)
A = np.array([lm[k] for k in names]); Bt = np.array([lt[k] for k in names])
ma, mb_ = A.mean(0), Bt.mean(0); Ac, Bc = A - ma, Bt - mb_
U_, S_, Vt = np.linalg.svd(Bc.T @ Ac)
D = np.eye(3); D[2, 2] = np.sign(np.linalg.det(U_ @ Vt))
Rs = U_ @ D @ Vt; sc = np.trace(np.diag(S_) @ D) / (Ac ** 2).sum()
ts = mb_ - sc * Rs @ ma
SIM = lambda X: (sc * (Rs @ np.asarray(X).T)).T + ts
print('SIMILARITY scale %.4f' % sc)
MVs = SIM(MV)
lms = {k: SIM(v) for k, v in lm.items()}
mk_eye_s = {s: (SIM(e[0]), e[1] * sc, Rs @ e[2], Rs @ e[3]) for s, e in mk_eye.items()}

# Minka's landmarks made mirror-symmetric about the toon's middle (x = 0)
mirror = lambda p: np.array([-p[0], p[1], p[2]])
sym = {}
for k, p in lms.items():
    if k.endswith('.L') or k.endswith('.R'):
        other = k[:-1] + ('R' if k.endswith('L') else 'L')
        if other in lms: sym[k] = (p + mirror(lms[other])) / 2; continue
    q = p.copy(); q[0] = 0; sym[k] = q
for s in 'LR':
    o = 'R' if s == 'L' else 'L'
    c = (mk_eye_s[s][0] + mirror(mk_eye_s[o][0])) / 2
    n = mk_eye_s[s][2] * np.sign(mk_eye_s[s][2][1] * -1 or 1)
    no = mk_eye_s[o][2] * np.sign(mk_eye_s[o][2][1] * -1 or 1)
    n = n + mirror(no); n /= np.linalg.norm(n)
    a = mk_eye_s[s][3]; ao = mirror(mk_eye_s[o][3]); ao = ao if ao @ a > 0 else -ao
    a = a + ao; a -= n * (a @ n); a /= np.linalg.norm(a)
    mk_eye_s[s] = (c, (mk_eye_s[s][1] + mk_eye_s[o][1]) / 2, n, a)

# --- thin-plate spline: toon landmarks → Minka's ----------------------------------------------------------------
src = np.array([lt[k] for k in names]); dst = np.array([sym[k] for k in names])
n = len(src)
K = np.linalg.norm(src[:, None] - src[None], axis=2)
Pm = np.hstack([np.ones((n, 1)), src])
Mt = np.zeros((n + 4, n + 4)); Mt[:n, :n] = K + 1e-4 * np.eye(n); Mt[:n, n:] = Pm; Mt[n:, :n] = Pm.T
coef = np.linalg.solve(Mt, np.vstack([dst, np.zeros((4, 3))]))
def TPS(X):
    X = np.atleast_2d(X)
    return np.linalg.norm(X[:, None] - src[None], axis=2) @ coef[:n] + np.hstack([np.ones((len(X), 1)), X]) @ coef[n:]
err = np.linalg.norm(TPS(src) - dst, axis=1).max()
print('TPS max landmark error %.5f' % err)

# --- the eye pieces: one rigid, scaled move per eye ------------------------------------------------------------
def eye_move(s):
    c0, r0, n0, a0 = toon_eye[s]; c1, r1, n1, a1 = mk_eye_s[s]
    out0 = c0 - eye_bone[s]; n0 = n0 if n0 @ out0 > 0 else -n0     # normals point out of the head
    o1 = c1 - TPS(eye_bone[s])[0]; n1 = n1 if n1 @ o1 > 0 else -n1
    a0 = a0 if a0[0] * (1 if s == 'L' else -1) > 0 else -a0
    a1 = a1 if a1[0] * (1 if s == 'L' else -1) > 0 else -a1
    F0 = np.stack([n0, a0, np.cross(n0, a0)], 1); F1 = np.stack([n1, a1, np.cross(n1, a1)], 1)
    # the eyes keep the toon's own angle: turning them to her openings' tilt sent the pupils toward the nose
    # (cross-eyed) — only the position and the size come from Minka
    R = np.eye(3); k = r1 / r0 * EYE_SIZE
    print('EYE %s scale %.3f turn %.1f°' % (s, k, math.degrees(math.acos(max(-1, min(1, (np.trace(R) - 1) / 2))))))
    return lambda X: (k * (R @ (np.atleast_2d(X) - c0).T)).T + c1, k, R
EM = {s: eye_move(s) for s in 'LR'}

# the eye area, measured from the rim of the opening (it is almond-shaped: measured from its center, the outer corner
# fell into the blend and was pulled open)
def rim_dist(Xp, pts):
    a_, ab = pts, np.roll(pts, -1, 0) - pts
    tt = np.clip(np.einsum('vsk,sk->vs', Xp[:, None] - a_[None], ab) / np.maximum((ab ** 2).sum(1), 1e-12), 0, 1)
    return np.linalg.norm(Xp[:, None] - (a_[None] + tt[..., None] * ab[None]), axis=2).min(1)
w_eye = np.zeros(len(TV))
for s in 'LR':
    on = (TV[:, 0] >= 0) == (s == 'L')
    dr = rim_dist(TV[on], TV[eye_loop[s]]) / toon_eye[s][1]
    inside = np.linalg.norm(TV[on] - toon_eye[s][0], axis=1) < toon_eye[s][1]
    t = np.clip((dr - EYE_FULL) / (EYE_FADE - EYE_FULL), 0, 1); w = 1 - t * t * (3 - 2 * t)
    w[inside] = 1
    w_eye[on] = w
w_eye[np.isin(piece_of, EYE_PIECES)] = 1

# --- welded graph (pieces share positions along their seams) ---------------------------------------------------
key = np.round(TV / 1e-5).astype(np.int64)
_, weld, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
inv = inv.ravel(); NW = len(weld)
nbr = [set() for _ in range(NW)]
for e in me.edges:
    a, b = inv[e.vertices[0]], inv[e.vertices[1]]
    if a != b: nbr[a].add(b); nbr[b].add(a)
nbr = [np.array(sorted(s)) for s in nbr]
wW = np.zeros(NW); np.maximum.at(wW, inv, w_eye)
keep = ~np.isin(piece_of, TUFTS)
active = np.zeros(NW, bool); active[inv[keep & (w_eye < 1)]] = True

# Minka's surface for projection
mk_tris = [tuple(p.vertices) for p in mk.data.polygons]
bvh = BVHTree.FromPolygons([Vector(v) for v in MVs], mk_tris)

def vnormals(Xw):
    """Vertex normals of the welded toon at positions Xw (area-weighted face normals)."""
    N = np.zeros((NW, 3))
    for p in me.polygons:
        ids = [inv[i] for i in p.vertices]
        pts = Xw[ids]
        nrm = np.zeros(3)
        for i in range(1, len(pts) - 1): nrm += np.cross(pts[i] - pts[0], pts[i + 1] - pts[0])
        for i in ids: N[i] += nrm
    return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)

def project(Xw, R=0.012):
    N = vnormals(Xw); out = Xw.copy()
    for i in np.where(active)[0]:
        co = Vector(Xw[i]); best = None
        for loc, nrm, idx, d in bvh.find_nearest_range(co, R):
            if nrm.dot(Vector(N[i])) > 0.2 and (best is None or d < best[1]): best = (loc, d)
        if best is None:
            loc, nrm, idx, d = bvh.find_nearest(co)
            if loc is None: continue
            best = (loc, d)
        out[i] = tuple(best[0])
    return out

def smooth(Xw, mask, a=0.5, it=1):
    for _ in range(it):
        L = np.array([Xw[nb].mean(0) if len(nb) else Xw[i] for i, nb in enumerate(nbr)])
        Xw = np.where(mask[:, None], Xw + a * (L - Xw), Xw)
    return Xw

X = TPS(TV[weld])
for r in range(4):
    X = project(X); X = smooth(X, active, 0.5, 2)
    print('ROUND', r)
X = project(X)
# the eye area: rigid move, blended into the projected face around it
E = np.where((TV[weld][:, 0] >= 0)[:, None], EM['L'][0](TV[weld]), EM['R'][0](TV[weld]))
X = wW[:, None] * E + (1 - wW[:, None]) * X
X = smooth(X, (wW > 0) & (wW < 1), 0.35, 4)

# exactly symmetric: each vertex and its mirror image meet halfway
kd = KDTree(NW)
for i, p in enumerate(TV[weld]): kd.insert(Vector(p), i)
kd.balance()
mir = np.array([kd.find(Vector((-p[0], p[1], p[2])))[1] for p in TV[weld]])
mdist = np.array([kd.find(Vector((-p[0], p[1], p[2])))[2] for p in TV[weld]])
ok = mdist < 1e-4
print('MIRROR pairs %d of %d' % (ok.sum(), NW))
Xm = X[mir] * np.array([-1, 1, 1])
X = np.where(ok[:, None], (X + Xm) / 2, X)
X[ok & (np.abs(TV[weld][:, 0]) < 1e-6), 0] = 0
Xall = X[inv]
for s_ in 'LR':
    dish = np.isin(piece_of, (13, 14)) & ((TV[:, 0] >= 0) == (s_ == 'L'))
    hole = eye_loop[s_]
    b0 = (TV[dish].mean(0) - TV[hole].mean(0)) / toon_eye[s_][1]
    b1 = (Xall[dish].mean(0) - Xall[hole].mean(0)) / (toon_eye[s_][1] * EM[s_][1])
    print('EYE CHECK %s dish-hole before %s after %s  hole r before %.4f after %.4f' % (s_, np.round(b0, 2), np.round(b1, 2),
          toon_eye[s_][1], np.linalg.norm(Xall[hole] - Xall[hole].mean(0), axis=1).mean()))

# --- write the shape -------------------------------------------------------------------------------------------
basis_old = np.array([tuple(v.co) for v in me.vertices])
keys = me.shape_keys.key_blocks if me.shape_keys else []
deltas = {kb.name: np.array([tuple(d.co) for d in kb.data]) - basis_old for kb in keys if kb.name != 'Basis'}
for i, v in enumerate(me.vertices): v.co = mwi @ Vector(Xall[i])
for kb in keys:
    if kb.name == 'Basis':
        for i, d in enumerate(kb.data): d.co = me.vertices[i].co
    else:
        for i, d in enumerate(kb.data):
            dl = Vector(deltas[kb.name][i])
            if dl.length > 0 and w_eye[i] > 0:
                s = 'L' if TV[i][0] >= 0 else 'R'; _, k, R = EM[s]
                dw = mw.to_3x3() @ dl
                dl = mwi.to_3x3() @ Vector(k * (R @ np.array(tuple(dw))))
            d.co = me.vertices[i].co + dl
# drop the tufts
bm2 = bmesh.new(); bm2.from_mesh(me); bm2.verts.ensure_lookup_table()
bmesh.ops.delete(bm2, geom=[bm2.verts[i] for i in np.where(np.isin(piece_of, TUFTS))[0]], context='VERTS')
bm2.to_mesh(me); bm2.free()

# bones: each joint goes where the warp takes it (eye bones with their eye); orientations stay
bpy.context.view_layer.objects.active = arm
for o in bpy.context.selected_objects: o.select_set(False)
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
aw = arm.matrix_world; awi = aw.inverted()
for eb in arm.data.edit_bones:
    if eb.name.startswith('StylizedCat'): continue           # the pack's socket bones at the origin
    h, tl = aw @ eb.head, aw @ eb.tail
    if eb.name.startswith('Eye'):
        s = eb.name[-1]; nh = Vector(EM[s][0](np.array(tuple(h)))[0]); length = (tl - h).length * EM[s][1]
    else:
        nh = Vector(TPS(np.array(tuple(h)))[0]); length = (Vector(TPS(np.array(tuple(tl)))[0]) - nh).length
    if eb.name.startswith(('Eye', 'Ear', 'Head')) is False and abs(h.x) < 1e-6: nh.x = 0
    dirn = (tl - h).normalized() if (tl - h).length > 1e-9 else Vector((0, 0, 1e-4))
    roll = eb.roll
    eb.head = awi @ nh; eb.tail = awi @ (nh + dirn * max(length, 1e-4)); eb.roll = roll
bpy.ops.object.mode_set(mode='OBJECT')
# stand on the ground
bpy.context.view_layer.update()
zmin = min((mw @ v.co).z for v in me.vertices)
root_obj = arm.parent or arm
root_obj.matrix_world = Matrix.Translation((0, 0, -zmin)) @ root_obj.matrix_world
for o in mk_objs.values():
    o.matrix_world = Matrix.Translation((0, 0, -zmin)) @ Matrix(((sc * Rs[0, 0], sc * Rs[0, 1], sc * Rs[0, 2], ts[0]),
        (sc * Rs[1, 0], sc * Rs[1, 1], sc * Rs[1, 2], ts[1]), (sc * Rs[2, 0], sc * Rs[2, 1], sc * Rs[2, 2], ts[2]), (0, 0, 0, 1))) @ R90 @ o.matrix_world
bpy.context.view_layer.update()
for o in mk_objs.values(): o.name = 'ref_' + o.name
ob.name = 'MinkaBody'; me.name = 'MinkaBody'
json.dump({'scale': sc, 'R': Rs.tolist(), 't': ts.tolist(), 'z': -zmin}, open(os.path.join(OUT, 'fit-transform.json'), 'w'))

# --- check renders: the fitted toon (loud pieces) beside Minka ----------------------------------------------------
def render_checks(tag):
    sc_ = bpy.context.scene; sc_.render.engine = 'BLENDER_EEVEE'; sc_.render.resolution_x = sc_.render.resolution_y = 600
    w = bpy.data.worlds.new('w'); sc_.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (.8, .8, .8, 1)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc_.collection.objects.link(sun); sun.data.energy = 3; sun.rotation_euler = (0.8, 0, 0.6)
    c = Vector((0, 0.0, 0.17))
    for name, off in (('front', Vector((0.0, -0.85, 0.07))), ('side', Vector((0.85, 0.0, 0.03))), ('three', Vector((0.45, -0.7, 0.2))), ('face', Vector((0.12, -0.42, 0.1)))):
        cm = bpy.data.objects.new(name, bpy.data.cameras.new(name)); sc_.collection.objects.link(cm); sc_.camera = cm
        tgt = c + (Vector((0, -0.12, 0.1)) if name == 'face' else Vector())
        cm.location = tgt + off; cm.data.lens = 50; cm.rotation_euler = (tgt - cm.location).to_track_quat('-Z', 'Y').to_euler()
        for show_toon in (True, False):
            ob.hide_render = not show_toon
            for o in mk_objs.values(): o.hide_render = show_toon
            sc_.render.filepath = os.path.join(OUT, f'{tag}-{name}-{"toon" if show_toon else "minka"}.png'); bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cm)
    ob.hide_render = False
    for o in mk_objs.values(): o.hide_render = True
    bpy.data.objects.remove(sun)

if STAGE == 'shape':
    render_checks('fit')
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'minka-v2-shape.blend'))
    print('WROTE shape stage')

# ==================================================================================================================
# STAGE=bake: her texture, her eye texture, her whiskers, and the files
# ==================================================================================================================
if STAGE == 'bake':
    ctx = bpy.context
    eye_i = next(i for i, m in enumerate(me.materials) if m and 'Eyes' in m.name)
    # 1. a UV layout of its own: the pack mirrors half its UVs (left and right share texture), but Minka's stripes
    #    differ side to side — so mirrored faces on her left move out of the shared space, then all islands are packed
    uv0 = me.uv_layers['DiffuseUV']
    new = me.uv_layers.new(name='MinkaUV'); me.uv_layers.active = new
    for i in range(len(new.data)): new.data[i].uv = uv0.data[i].uv
    cents = [p.center.copy() for p in me.polygons]
    kdf = KDTree(len(cents))
    for i, c in enumerate(cents): kdf.insert(c, i)
    kdf.balance()
    uvc = lambda p: sum((new.data[l].uv for l in p.loop_indices), Vector((0, 0))) / p.loop_total
    moved = 0
    for p in me.polygons:
        c = p.center
        if c.x <= 1e-5 or p.material_index == eye_i: continue
        _, j, d = kdf.find(Vector((-c.x, c.y, c.z)))
        if d < 1e-4 and (uvc(p) - uvc(me.polygons[j])).length < 1e-3:
            for l in p.loop_indices: new.data[l].uv.x += 1.0
            moved += 1
    print('UV mirrored faces moved', moved)
    # two side-by-side halves: the pack's layout on the left, the moved (her-left) faces on the right; a 2:1
    # texture keeps the texels square
    for l in new.data: l.uv.x /= 2
    us = [l.uv for l in new.data]
    print('UV range u %.3f..%.3f v %.3f..%.3f' % (min(u.x for u in us), max(u.x for u in us), min(u.y for u in us), max(u.y for u in us)))

    # 2. her colors, baked from Minka's surface (Cycles, diffuse color only) onto that layout
    SIZE = 4096
    img = bpy.data.images.new('MinkaColor', SIZE, SIZE // 2, alpha=False)
    fur = bpy.data.materials.new('MinkaFur'); fur.use_nodes = True
    nt = fur.node_tree; bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
    uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'MinkaUV'
    nt.links.new(uvn.outputs['UV'], tex.inputs['Vector']); nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.85
    nt.nodes.active = tex
    body_i = 1 - eye_i
    me.materials[body_i] = fur
    # bake onto a copy without the eye faces (their own texture must not land in this one)
    bk = ob.copy(); bk.data = me.copy(); bk.name = 'bake_target'; ctx.scene.collection.objects.link(bk)
    bk.modifiers.clear(); bk.shape_key_clear() if bk.data.shape_keys else None
    # bake distances are measured in the object's own units — the pack's are centimetres (scale 0.01), so the
    # copy gets its transform applied and works in metres
    bmw = bk.matrix_world.copy(); bk.parent = None; bk.data.transform(bmw); bk.matrix_world = Matrix()
    b3 = bmesh.new(); b3.from_mesh(bk.data)
    bmesh.ops.delete(b3, geom=[f for f in b3.faces if f.material_index == eye_i], context='FACES')
    b3.to_mesh(bk.data); b3.free()
    bk.data.materials.clear(); bk.data.materials.append(fur)
    for f in bk.data.polygons: f.material_index = 0
    # distance of every vertex to the rim of its eye opening, in opening radii
    rims = []
    for s_ in 'LR':
        pts = EM[s_][0](TV[eye_loop[s_]]); pts[:, 2] -= zmin
        rims.append((pts, mk_eye_s[s_][1], pts.mean(0), mk_eye_s[s_][2]))
    BV = np.array([tuple(v.co) for v in bk.data.vertices])
    rim_d = np.full(len(BV), 99.0); rim_k = np.zeros(len(BV), int)
    for k_, (pts, r, c_, n_) in enumerate(rims):
        a_, b_ = pts, np.roll(pts, -1, 0); ab = b_ - a_
        tt = np.clip(np.einsum('vsk,sk->vs', BV[:, None] - a_[None], ab) / np.maximum((ab ** 2).sum(1), 1e-12), 0, 1)
        d = np.linalg.norm(BV[:, None] - (a_[None] + tt[..., None] * ab[None]), axis=2).min(1) / r
        closer = d < rim_d; rim_d[closer] = d[closer]; rim_k[closer] = k_
    # the lids would bake from her old eye openings (old pupil, iris, painted sclera); for the bake only, the lid ring
    # is pushed outward onto her fur just beyond them, so her stripes run on up to the rim
    msrc = bpy.data.objects['ref_MinkaBody']
    MW = np.array([tuple(msrc.matrix_world @ v.co) for v in msrc.data.vertices])
    mbvh = BVHTree.FromPolygons([Vector(v) for v in MW], [tuple(p.vertices) for p in msrc.data.polygons])
    PUSH, REACH = 1.2, 2.2
    for i in np.where(rim_d < REACH)[0]:
        pts, r, c_, n_ = rims[rim_k[i]]
        u = BV[i] - c_; u -= n_ * (u @ n_); ln_ = np.linalg.norm(u)
        if ln_ < 1e-9: continue
        x_ = rim_d[i] / REACH; s_ = x_ * x_ * (3 - 2 * x_)
        q = BV[i] + u / ln_ * PUSH * r * (1 - s_)
        loc = mbvh.find_nearest(Vector(q))[0]
        if loc is not None: bk.data.vertices[i].co = loc
    srcm = bpy.data.objects['ref_MinkaBody']
    srcm.hide_render = False
    ctx.scene.render.engine = 'CYCLES'; ctx.scene.cycles.samples = 1; ctx.scene.cycles.device = 'CPU'
    for o in ctx.selected_objects: o.select_set(False)
    srcm.select_set(True); bk.select_set(True); ctx.view_layer.objects.active = bk
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_selected_to_active=True,
                        cage_extrusion=0.008, max_ray_distance=0.03, margin=12)
    # fill what the bake missed (inside the eye openings, deep folds) from the nearest baked colors
    px = np.array(img.pixels[:]).reshape(SIZE // 2, SIZE, 4)
    miss = px[..., :3].max(-1) < 0.004                     # Cycles leaves a missed ray black
    print('BAKE missed %.2f%% of the texture' % (100 * miss.mean()))
    good = ~miss; col = px[..., :3].copy()
    for _ in range(64):
        if not miss.any(): break
        acc = np.zeros_like(col); cnt = np.zeros(miss.shape)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            g = np.roll(good, (dy, dx), (0, 1)); c = np.roll(col, (dy, dx), (0, 1))
            acc += c * g[..., None]; cnt += g
        grow = miss & (cnt > 0)
        col[grow] = acc[grow] / cnt[grow][:, None]; good = good | grow; miss = miss & ~grow
    # the lids: a dark rim at each eye opening, as cats have, fading into her fur — painted through a baked mask
    x = np.clip((rim_d - 0.06) / (0.30 - 0.06), 0, 1)
    lin = 1 - x * x * (3 - 2 * x)
    zone = np.zeros(len(lin))
    ca = bk.data.color_attributes.new('liner', 'FLOAT_COLOR', 'POINT')
    for i, v in enumerate(lin): ca.data[i].color = (v, zone[i], 0, 1)
    lm_ = bpy.data.materials.new('linerbake'); lm_.use_nodes = True; ln = lm_.node_tree
    at = ln.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'liner'
    emn = ln.nodes.new('ShaderNodeEmission'); ln.links.new(at.outputs['Color'], emn.inputs['Color'])
    ln.links.new(emn.outputs[0], ln.nodes['Material Output'].inputs['Surface'])
    limg = bpy.data.images.new('liner', SIZE, SIZE // 2, alpha=False)
    ti = ln.nodes.new('ShaderNodeTexImage'); ti.image = limg; ln.nodes.active = ti
    ui = ln.nodes.new('ShaderNodeUVMap'); ui.uv_map = 'MinkaUV'; ln.links.new(ui.outputs['UV'], ti.inputs['Vector'])
    bk.data.materials.clear(); bk.data.materials.append(lm_)
    for o in ctx.selected_objects: o.select_set(False)
    bk.select_set(True); ctx.view_layer.objects.active = bk
    bpy.ops.object.bake(type='EMIT', use_selected_to_active=False, margin=12)
    mk_ = np.array(limg.pixels[:]).reshape(SIZE // 2, SIZE, 4)
    m = mk_[..., 0:1]
    LINER = np.array([0.045, 0.032, 0.026])                 # near-black brown, linear
    col = col * (1 - m) + LINER * m
    px[..., :3] = col; img.pixels[:] = px.ravel()
    img.filepath_raw = os.path.join(OUT, 'minka-color.png'); img.file_format = 'PNG'; img.save()
    bpy.data.objects.remove(bk)

    # 3. her eyes: Stefanie's eyeball texture, unchanged, fitted by the UVs (as in build_toon_minka.py)
    new, uv0 = me.uv_layers['MinkaUV'], me.uv_layers['DiffuseUV']
    EYE_IMAGE = 'cat_eyeball_texture_lblue_wide_open.jpg'
    _m = json.load(open(P('art/minka/eye-textures', os.path.splitext(EYE_IMAGE)[0] + '.json')))
    IRIS, (TEX_W, TEX_H) = _m['iris'], _m['size']
    TI = json.load(open(P('art/minka/toon/toon-iris.json')))
    # her pupil is centered in the part of each eyeball a viewer actually sees from the front, and sized like the
    # toon Minka she approved (the pupil fills ~65% of the visible eye). Rays from in front of her find that part.
    PUPIL_FILL = 0.65
    eye_polys = [p for p in me.polygons if p.material_index == eye_i]
    mwn = ob.matrix_world                                   # after the ground move
    tris, tuv, teye = [], [], []
    for p in me.polygons:
        ids = list(p.vertices); lis = list(p.loop_indices)
        for t in range(1, len(ids) - 1):
            tris.append([mwn @ me.vertices[ids[k]].co for k in (0, t, t + 1)])
            tuv.append([uv0.data[lis[k]].uv.copy() for k in (0, t, t + 1)])
            teye.append(p.material_index == eye_i)
    fbvh = BVHTree.FromPolygons([v for tri in tris for v in tri], [(3 * k, 3 * k + 1, 3 * k + 2) for k in range(len(tris))])
    from mathutils.geometry import barycentric_transform
    center_uv, scale_uv = {}, {}
    for s_ in 'LR':
        c_ = EM[s_][0](toon_eye[s_][0])[0]; c_[2] -= zmin
        R_ = mk_eye_s[s_][1] * 2.0
        hits = []
        for gx in np.linspace(-R_, R_, 61):
            for gz in np.linspace(-R_, R_, 61):
                o = Vector((c_[0] + gx, c_[1] - 0.2, c_[2] + gz))
                loc, nrm, fi, d = fbvh.ray_cast(o, Vector((0, 1, 0)))
                if loc is None or not teye[fi]: continue
                A, B_, C = tris[fi]; U = tuv[fi]
                q = barycentric_transform(loc, A, B_, C, Vector((*U[0], 0)), Vector((*U[1], 0)), Vector((*U[2], 0)))
                hits.append((q.x, q.y, gx, gz))
        h = np.array(hits)
        cu, cv = h[:, 0].mean(), h[:, 1].mean()
        r_uv = 2 * math.sqrt((h[:, 0].var() + h[:, 1].var()) / 2)       # a filled disk's radius from its spread
        center_uv[s_] = (cu, cv); scale_uv[s_] = r_uv
        print('EYE %s visible: %d rays, center uv %.3f %.3f radius %.3f (pack iris %.3f %.3f r %.3f)' % (
            s_, len(h), cu, cv, r_uv, TI['cx'] / TI['cell'], 1 - TI['cy'] / TI['cell'], TI['r'] / TI['cell']))
    pupil = json.load(open(P('art/minka/eye-textures', os.path.splitext(EYE_IMAGE)[0] + '.json')))['pupil']['r'] / IRIS['r']
    for poly in eye_polys:
        sd = 'L' if poly.center.x >= 0 else 'R'
        cu, cv = center_uv[sd]
        iris_uv = scale_uv[sd] * PUPIL_FILL / pupil            # her iris radius on this eye, in its UVs
        for li in poly.loop_indices:
            u, v = uv0.data[li].uv
            dx = (u - cu) / iris_uv
            dy = (cv - v) / iris_uv
            new.data[li].uv = ((IRIS['cx'] + dx * IRIS['r']) / TEX_W, 1 - (IRIS['cy'] + dy * IRIS['r']) / TEX_H)
    em = bpy.data.materials.new('MinkaEyes'); em.use_nodes = True
    eb_ = em.node_tree.nodes['Principled BSDF']
    et = em.node_tree.nodes.new('ShaderNodeTexImage'); et.image = bpy.data.images.load(P('art/minka/eye-textures', EYE_IMAGE)); et.extension = 'EXTEND'
    em.node_tree.links.new(et.outputs['Color'], eb_.inputs['Base Color'])
    eb_.inputs['Roughness'].default_value = 0.12; eb_.inputs['Coat Weight'].default_value = 1.0; eb_.inputs['Coat Roughness'].default_value = 0.03
    me.materials[eye_i] = em
    me.uv_layers.remove(me.uv_layers['DiffuseUV'])

    # 4. her whiskers (modeled, black), riding on the head bone
    wh = bpy.data.objects['ref_MinkaWhiskers']; wh.name = 'MinkaWhiskers'
    mwh = wh.matrix_world.copy(); wh.parent = arm; wh.matrix_world = mwh
    wh.vertex_groups.clear(); g = wh.vertex_groups.new(name='Head'); g.add(range(len(wh.data.vertices)), 1.0, 'REPLACE')
    wh.modifiers.clear(); mod = wh.modifiers.new('Armature', 'ARMATURE'); mod.object = arm
    for o in list(bpy.data.objects):
        if o.name.startswith('ref_'): bpy.data.objects.remove(o)

    # 5. quads for editing, check renders, files
    for o in ctx.selected_objects: o.select_set(False)
    ctx.view_layer.objects.active = ob; ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.tris_convert_to_quads(face_threshold=math.pi, shape_threshold=math.pi, uvs=True, materials=True, seam=True, sharp=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    ctx.scene.render.engine = 'BLENDER_EEVEE'
    sc_ = ctx.scene; sc_.render.resolution_x = sc_.render.resolution_y = 600
    w = bpy.data.worlds.new('w'); sc_.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (.56, .56, .58, 1)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc_.collection.objects.link(sun); sun.data.energy = 3; sun.rotation_euler = (0.8, 0, 0.6)
    c = Vector((0, 0.0, 0.17))
    for name, off in (('front', Vector((0.0, -0.85, 0.07))), ('side', Vector((0.85, 0.0, 0.03))), ('three', Vector((0.45, -0.7, 0.2))), ('face', Vector((0.12, -0.42, 0.1)))):
        cm = bpy.data.objects.new(name, bpy.data.cameras.new(name)); sc_.collection.objects.link(cm); sc_.camera = cm
        tgt = c + (Vector((0, -0.12, 0.1)) if name == 'face' else Vector())
        cm.location = tgt + off; cm.data.lens = 50; cm.rotation_euler = (tgt - cm.location).to_track_quat('-Z', 'Y').to_euler()
        sc_.render.filepath = os.path.join(OUT, f'baked-{name}.png'); bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cm)
    bpy.data.objects.remove(sun)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'minka-v2.blend'))
    for a in bpy.data.armatures: a.pose_position = 'POSE'
    bpy.ops.export_scene.gltf(filepath=P('art/minka/3d/minka-v2.glb'), export_format='GLB', export_animations=True,
                              export_animation_mode='ACTIONS', export_skins=True, export_morph=True,
                              export_image_format='JPEG', export_jpeg_quality=90)
    print('WROTE minka-v2.blend, minka-v2.glb')
