# The cartoon Minka for RummyCat (2026-10-02). Stefanie: "for RummyCat we can actually go cartoon cat … but it cannot
# look like the cat that we bought … a cat that looks like Minka, just a cartoon version. The eyes are working
# perfectly. We just have to stick the hair in a little bit. Give it a different texture … her own style and cuteness."
# The pack's files are never changed: this opens Toon Cats/Export/StylizedCat.blend and writes
#   art/minka/toon/minka-cartoon.blend   (quads, rest pose)
#   art/minka/3d/minka-cartoon.glb       (the game's model, all 19 animations)
# Steps:
#   1. the toon's shape is blended part of the way toward Minka's own (Minka v2 has the same vertices:
#      scripts/blender/export_v2_shape.py), bones with it;
#   2. kitten proportions on top (as build_toon_minka.py), her ears a little bigger;
#   3. the hair tucked in: the jagged ruff around the face is smoothed (Taubin, no shrinking), the ear tufts dropped;
#   4. her texture: her real markings (the v2 bake) turned painterly (scripts/blender/cartoon_texture.py, run first);
#   5. the toon's eyes with her eye texture; the pupil centered in the eye as seen from the front;
#   6. her whiskers, carried over from v2.
#   blender -b --python scripts/blender/cartoon_texture.py && blender -b --python scripts/blender/build_minka_cartoon.py
import bpy, bmesh, json, math, os
import numpy as np
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree

ROOT = os.path.abspath('.'); P = lambda *a: os.path.join(ROOT, *a)
ALPHA = 0.45                                        # how far toward Minka's own shape (0 = the box cat, 1 = v2)
HEAD, EYES, LEGS, TAIL, EARS = 1.18, 1.12, 0.92, 0.9, 1.12
TUCK = 14                                           # smoothing rounds on the ruff's outline
TUFTS = (17, 18)
OUT = P('art/minka/toon')

bpy.ops.wm.open_mainfile(filepath=P('Toon Cats/Export/StylizedCat.blend'))
for a in bpy.data.armatures: a.pose_position = 'REST'
bpy.context.view_layer.update()
arm = bpy.data.objects['StylizedCat']; ob = bpy.data.objects['SKM_StylizedCat']; me = ob.data
mw, mwi = ob.matrix_world.copy(), ob.matrix_world.inverted()
TV = np.array([tuple(mw @ v.co) for v in me.vertices])
n = len(TV)

# pieces, numbered as in the toon_parts listing (largest first)
bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
seen = np.zeros(n, bool); pieces = []
for v in bm.verts:
    if seen[v.index]: continue
    st = [v]; seen[v.index] = True; vs = []
    while st:
        x = st.pop(); vs.append(x.index)
        for e in x.link_edges:
            o = e.other_vert(x)
            if not seen[o.index]: seen[o.index] = True; st.append(o)
    pieces.append(vs)
pieces.sort(key=lambda p: -len(p))
piece_of = np.zeros(n, int)
for i, p in enumerate(pieces): piece_of[p] = i

# --- the UV layout her texture was baked in (fit_minka_v2.py, STAGE=bake): built the same way, on the untouched pack
eye_i = next(i for i, m in enumerate(me.materials) if m and 'Eyes' in m.name)
uv0 = me.uv_layers['DiffuseUV']
new = me.uv_layers.new(name='MinkaUV')
for i in range(len(new.data)): new.data[i].uv = uv0.data[i].uv
cents = [mw @ p.center for p in me.polygons]
kdf = KDTree(len(cents))
for i, c in enumerate(cents): kdf.insert(c, i)
kdf.balance()
uvc = lambda p: sum((uv0.data[l].uv for l in p.loop_indices), Vector((0, 0))) / p.loop_total
for p in me.polygons:
    c = cents[p.index]
    if c.x <= 1e-5 or p.material_index == eye_i: continue
    _, j, d = kdf.find(Vector((-c.x, c.y, c.z)))
    if d < 1e-4 and (uvc(p) - uvc(me.polygons[j])).length < 1e-3:
        for l in p.loop_indices: new.data[l].uv.x += 1.0
for l in new.data: l.uv.x /= 2

# --- 1. part of the way toward Minka's shape ------------------------------------------------------------------
S = np.load(P('art/minka/v2/v2-shape.npz'))
keep = np.where(~np.isin(piece_of, TUFTS))[0]
assert len(keep) == len(S['V']), (len(keep), len(S['V']))
gname = {g.index: g.name for g in ob.vertex_groups}
strong = np.array([gname.get(max(me.vertices[i].groups, key=lambda x: x.weight).group, '') if len(me.vertices[i].groups) else '' for i in keep])
print('VERTEX ORDER matches v2: %.1f%%' % (100 * (strong == S['strongest']).mean()))
X = TV.copy()
X[keep] = TV[keep] * (1 - ALPHA) + S['V'] * ALPHA
v2_of = {int(t): k for k, t in enumerate(keep)}        # toon vertex → v2 vertex

basis_old = np.array([tuple(v.co) for v in me.vertices])
keys = me.shape_keys.key_blocks if me.shape_keys else []
deltas = {kb.name: np.array([tuple(d.co) for d in kb.data]) - basis_old for kb in keys if kb.name != 'Basis'}
def write_shape(Xw):
    for i, v in enumerate(me.vertices): v.co = mwi @ Vector(Xw[i])
    for kb in keys:
        for i, d in enumerate(kb.data):
            d.co = me.vertices[i].co + (Vector(deltas[kb.name][i]) if kb.name != 'Basis' else Vector())
write_shape(X)

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
aw = arm.matrix_world; awi = aw.inverted()
bn = list(S['bone_names']); BH, BT = S['H'], S['T']
for eb in arm.data.edit_bones:
    if eb.name.startswith('StylizedCat') or eb.name not in bn: continue
    k = bn.index(eb.name)
    h, t = aw @ eb.head, aw @ eb.tail
    nh = h.lerp(Vector(BH[k]), ALPHA)
    ln = (t - h).length * (1 - ALPHA) + Vector(BT[k] - BH[k]).length * ALPHA
    d = (t - h).normalized(); roll = eb.roll
    eb.head = awi @ nh; eb.tail = awi @ (nh + d * max(ln, 1e-4)); eb.roll = roll
bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.view_layer.update()

# --- 2. kitten proportions (build_toon_minka.py), her ears a little bigger ------------------------------------
B = arm.data.bones
head_w = lambda nme: aw @ B[nme].head_local
def chain(root):
    out = [root]; stack = [B[root]]
    while stack:
        b = stack.pop()
        for c in b.children: out.append(c.name); stack.append(c)
    return out
regions = [(chain('Head'), head_w('Head'), HEAD),
           (chain('Shoulder_R'), head_w('Shoulder_R'), LEGS), (chain('Shoulder_L'), head_w('Shoulder_L'), LEGS),
           (chain('Thigh_R'), head_w('Thigh_R'), LEGS), (chain('Thigh_L'), head_w('Thigh_L'), LEGS),
           (chain('Tail1'), head_w('Tail1'), TAIL)]
eyes = [(chain('Eye_R'), 'Eye_R'), (chain('Eye_L'), 'Eye_L')]
ears = [(chain('Ear_R'), 'Ear_R'), (chain('Ear_L'), 'Ear_L')]
def move(pw, weights):
    out = pw.copy()
    for names, piv, s in regions:
        w = sum(weights.get(nm, 0.0) for nm in names)
        if w > 0: out += ((piv + (pw - piv) * s) - pw) * min(1.0, w)
    hp, hs = regions[0][1], regions[0][2]
    for group, scale in ((eyes, EYES), (ears, EARS)):
        for names, b in group:
            w = sum(weights.get(nm, 0.0) for nm in names)
            if w > 0:
                piv = hp + (head_w(b) - hp) * hs
                out += ((piv + (out - piv) * scale) - out) * min(1.0, w)
    return out
vweights = [{gname[g.group]: g.weight for g in v.groups if g.group in gname} for v in me.vertices]
for kb in keys:
    for i, d in enumerate(kb.data): d.co = mwi @ move(mw @ d.co, vweights[i])
for i, v in enumerate(me.vertices): v.co = mwi @ move(mw @ v.co, vweights[i])
bpy.ops.object.mode_set(mode='EDIT')
for eb in arm.data.edit_bones:
    if eb.name.startswith('StylizedCat'): continue
    h, t = aw @ eb.head, aw @ eb.tail
    eb.head = awi @ move(h, {eb.name: 1.0}); eb.tail = awi @ move(t, {eb.name: 1.0})
bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.view_layer.update()

# --- 3. the hair tucked in: the face's jagged outline smoothed without shrinking, then the band inside it relaxed --
X = np.array([tuple(mw @ v.co) for v in me.vertices])
bnd = {}
for e in bm.edges:
    if e.is_boundary and piece_of[e.verts[0].index] == 0:
        a, b_ = e.verts[0].index, e.verts[1].index
        bnd.setdefault(a, []).append(b_); bnd.setdefault(b_, []).append(a)
eye_bone = {s: np.array(tuple(aw @ B[f'Eye_{s}'].head_local)) for s in 'LR'}
loops, used = [], set()
for s0 in bnd:
    if s0 in used: continue
    lp = [s0]; used.add(s0); prev, cur = None, s0
    while True:
        nx = [m for m in bnd[cur] if m != prev and m not in used]
        if not nx: break
        prev, cur = cur, nx[0]; lp.append(cur); used.add(cur)
    loops.append(lp)
eye_loops = [min(loops, key=lambda l: np.linalg.norm(X[l].mean(0) - eye_bone[s])) for s in 'LR']
outline = [l for l in loops if not any(l is e for e in eye_loops) and len(l) > 8]
moved = np.zeros(n, bool)
for lp in outline:
    L = np.array(lp)
    for _ in range(TUCK):
        for f in (0.5, -0.53):                              # Taubin: smooth, then un-shrink
            avg = (X[np.roll(L, 1)] + X[np.roll(L, -1)]) / 2
            X[L] += f * (avg - X[L])
    moved[L] = True
ring = set()
for i in np.where(moved)[0]:
    for e in bm.verts[i].link_edges:
        o = e.other_vert(bm.verts[i]).index
        if not moved[o] and piece_of[o] == 0: ring.add(o)
ring = np.array(sorted(ring))
nb = {i: [e.other_vert(bm.verts[i]).index for e in bm.verts[i].link_edges] for i in ring}
for _ in range(3):
    X[ring] += 0.5 * (np.array([X[nb[i]].mean(0) for i in ring]) - X[ring])
for i in np.where(moved)[0].tolist() + ring.tolist():
    dl = mwi @ Vector(X[i]) - me.vertices[i].co
    me.vertices[i].co += dl
    for kb in keys: kb.data[i].co += dl
print('TUCKED outline points', int(moved.sum()), 'in', len(outline), 'loops')

# --- the eyes' dark rims, as the toon had: a color on the points around each opening, multiplied into her coat ---
LINER = (0.20, 0.14, 0.11)
rim = np.zeros(n)
for lp in eye_loops:
    pts = X[lp]; r = np.linalg.norm(pts - pts.mean(0), axis=1).mean()
    a_, ab = pts, np.roll(pts, -1, 0) - pts
    tt = np.clip(np.einsum('vsk,sk->vs', X[:, None] - a_[None], ab) / np.maximum((ab ** 2).sum(1), 1e-12), 0, 1)
    d = np.linalg.norm(X[:, None] - (a_[None] + tt[..., None] * ab[None]), axis=2).min(1) / r
    x = np.clip((d - 0.6) / (1.3 - 0.6), 0, 1)        # the opening edge sits deep in the socket: the rim reaches onto the lid
    rim = np.maximum(rim, 1 - x * x * (3 - 2 * x))
liner = me.color_attributes.new('liner', 'FLOAT_COLOR', 'POINT')
for i in range(n):
    w_ = rim[i]
    liner.data[i].color = (1 - w_ + w_ * LINER[0], 1 - w_ + w_ * LINER[1], 1 - w_ + w_ * LINER[2], 1)

# --- 6 (before the tufts go, while vertex numbers still match v2). Her whiskers ride along with her muzzle -----
with bpy.data.libraries.load(P('art/minka/v2/minka-v2.blend')) as (src, dst):
    dst.meshes = [m for m in src.meshes if 'hisker' in m]
wm = dst.meshes[0]
wh = bpy.data.objects.new('MinkaWhiskers', wm); bpy.context.scene.collection.objects.link(wh)
W = S['W'].copy()
Xn = np.array([tuple(mw @ v.co) for v in me.vertices])
V2 = S['V']
kv = KDTree(len(V2))
for k, p in enumerate(V2): kv.insert(Vector(p), k)
kv.balance()
wbm = bmesh.new(); wbm.from_mesh(wm); wbm.verts.ensure_lookup_table()
wseen = np.zeros(len(W), bool)
toon_of = {k: t for t, k in v2_of.items()}
for v in wbm.verts:                                      # each strand moves with the muzzle point at its root
    if wseen[v.index]: continue
    st = [v]; wseen[v.index] = True; strand = []
    while st:
        x = st.pop(); strand.append(x.index)
        for e in x.link_edges:
            o = e.other_vert(x)
            if not wseen[o.index]: wseen[o.index] = True; st.append(o)
    root = min(strand, key=lambda i: kv.find(Vector(W[i]))[2])
    k = kv.find(Vector(W[root]))[1]
    W[strand] += Xn[toon_of[k]] - V2[k]
for i, v in enumerate(wm.vertices): v.co = Vector(W[i])
wh.parent = arm; wh.matrix_parent_inverse = arm.matrix_world.inverted()
wh.vertex_groups.clear(); g = wh.vertex_groups.new(name='Head'); g.add(range(len(wm.vertices)), 1.0, 'REPLACE')
mod = wh.modifiers.new('Armature', 'ARMATURE'); mod.object = arm

bm2 = bmesh.new(); bm2.from_mesh(me); bm2.verts.ensure_lookup_table()
bmesh.ops.delete(bm2, geom=[bm2.verts[i] for i in np.where(np.isin(piece_of, TUFTS))[0]], context='VERTS')
bm2.to_mesh(me); bm2.free()

# --- 4. her texture, painterly ---------------------------------------------------------------------------------
# made by scripts/blender/cartoon_texture.py
img = bpy.data.images.load(os.path.join(OUT, 'minka-cartoon-color.png'))
body_i = 1 - eye_i
mat = bpy.data.materials.new('MinkaCartoon'); mat.use_nodes = True
nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'MinkaUV'
nt.links.new(uvn.outputs['UV'], tex.inputs['Vector'])
ca = nt.nodes.new('ShaderNodeVertexColor'); ca.layer_name = 'liner'
mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1.0
sock = lambda socks, nm: next(x for x in socks if x.name == nm and x.type == 'RGBA')   # the Mix node repeats names per type
nt.links.new(tex.outputs['Color'], sock(mix.inputs, 'A')); nt.links.new(ca.outputs['Color'], sock(mix.inputs, 'B'))
nt.links.new(sock(mix.outputs, 'Result'), bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.72
me.materials[body_i] = mat

# --- 5. the eyes: the toon's, with her eye texture ------------------------------------------------------------------
EYE_IMAGE = 'cat_eyeball_texture_lblue_wide_open.jpg'
_m = json.load(open(P('art/minka/eye-textures', os.path.splitext(EYE_IMAGE)[0] + '.json')))
IRIS, (TEX_W, TEX_H) = _m['iris'], _m['size']
TI = json.load(open(P('art/minka/toon/toon-iris.json')))
uv0, new = me.uv_layers['DiffuseUV'], me.uv_layers['MinkaUV']
# the pupil is centered in the part of each eye a viewer sees from the front (the pack puts it toward the nose,
# which reads cross-eyed — fit_minka_v2.py found this), and fills as much of it as in the toon version she approved
PUPIL_FILL = 0.72
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform
mwn = ob.matrix_world
tris, tuv, teye = [], [], []
for p_ in me.polygons:
    ids = list(p_.vertices); lis = list(p_.loop_indices)
    for t in range(1, len(ids) - 1):
        tris.append([mwn @ me.vertices[ids[k]].co for k in (0, t, t + 1)])
        tuv.append([uv0.data[lis[k]].uv.copy() for k in (0, t, t + 1)])
        teye.append(p_.material_index == eye_i)
fbvh = BVHTree.FromPolygons([v for tri in tris for v in tri], [(3 * k, 3 * k + 1, 3 * k + 2) for k in range(len(tris))])
pupil = _m['pupil']['r'] / IRIS['r']
center = {}
for s_ in 'LR':
    pts = [mwn @ me.vertices[i].co for p_ in me.polygons if p_.material_index == eye_i for i in p_.vertices]
    pts = [q for q in pts if (q.x >= 0) == (s_ == 'L')]
    c_ = sum(pts, Vector()) / len(pts); R_ = max((q - c_).length for q in pts) * 1.3
    hits = []
    for gx in np.linspace(-R_, R_, 61):
        for gz in np.linspace(-R_, R_, 61):
            loc, nrm, fi, d = fbvh.ray_cast(Vector((c_.x + gx, c_.y - 0.3, c_.z + gz)), Vector((0, 1, 0)))
            if loc is None or not teye[fi]: continue
            A, B_, C = tris[fi]; U = tuv[fi]
            q = barycentric_transform(loc, A, B_, C, Vector((*U[0], 0)), Vector((*U[1], 0)), Vector((*U[2], 0)))
            hits.append((q.x, q.y))
    h = np.array(hits)
    center[s_] = (h[:, 0].mean(), h[:, 1].mean(), 2 * math.sqrt((h[:, 0].var() + h[:, 1].var()) / 2))
    print('EYE %s visible from the front: center uv %.3f %.3f radius %.3f' % (s_, *center[s_]))
for poly in me.polygons:
    if poly.material_index != eye_i: continue
    cu, cv, r_uv = center['L' if (mwn @ poly.center).x >= 0 else 'R']
    iris_uv = r_uv * PUPIL_FILL / pupil
    for li in poly.loop_indices:
        u, v = uv0.data[li].uv
        dx = (u - cu) / iris_uv; dy = (cv - v) / iris_uv
        new.data[li].uv = ((IRIS['cx'] + dx * IRIS['r']) / TEX_W, 1 - (IRIS['cy'] + dy * IRIS['r']) / TEX_H)
em = bpy.data.materials.new('MinkaEyes'); em.use_nodes = True
eb_ = em.node_tree.nodes['Principled BSDF']
et = em.node_tree.nodes.new('ShaderNodeTexImage'); et.image = bpy.data.images.load(P('art/minka/eye-textures', EYE_IMAGE)); et.extension = 'EXTEND'
em.node_tree.links.new(et.outputs['Color'], eb_.inputs['Base Color'])
eb_.inputs['Roughness'].default_value = 0.12; eb_.inputs['Coat Weight'].default_value = 1.0; eb_.inputs['Coat Roughness'].default_value = 0.03
me.materials[eye_i] = em
me.uv_layers.remove(me.uv_layers['DiffuseUV'])

# --- stand on the ground, quads, check renders, files -----------------------------------------------------------
zmin = min((mw @ v.co).z for v in me.vertices)
root_obj = arm.parent or arm
root_obj.matrix_world = Matrix.Translation((0, 0, -zmin)) @ root_obj.matrix_world
bpy.context.view_layer.update()
for o in bpy.context.selected_objects: o.select_set(False)
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.tris_convert_to_quads(face_threshold=math.pi, shape_threshold=math.pi, uvs=True, materials=True, seam=True, sharp=True)
bpy.ops.object.mode_set(mode='OBJECT')
ob.name = 'MinkaCartoon'; me.name = 'MinkaCartoon'

sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'; sc.render.resolution_x = sc.render.resolution_y = 700
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (.62, .62, .64, 1)
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun); sun.data.energy = 3; sun.rotation_euler = (0.8, 0, 0.5)
c = Vector((0, -0.01, 0.17))
for name, off, tgt in (('front', Vector((0.0, -0.8, 0.06)), c), ('three', Vector((0.45, -0.65, 0.18)), c),
                       ('face', Vector((0.08, -0.4, 0.04)), c + Vector((0, -0.1, 0.11)))):
    cm = bpy.data.objects.new(name, bpy.data.cameras.new(name)); sc.collection.objects.link(cm); sc.camera = cm
    cm.location = tgt + off; cm.data.lens = 50; cm.rotation_euler = (tgt - cm.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(OUT, f'cartoon-{name}.png'); bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cm)
bpy.data.objects.remove(sun)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'minka-cartoon.blend'))
for a in bpy.data.armatures: a.pose_position = 'POSE'
bpy.ops.export_scene.gltf(filepath=P('art/minka/3d/minka-cartoon.glb'), export_format='GLB', export_animations=True,
                          export_animation_mode='ACTIONS', export_skins=True, export_morph=True,
                          export_image_format='JPEG', export_jpeg_quality=90, export_vertex_color='MATERIAL')
print('WROTE minka-cartoon.blend, minka-cartoon.glb')
