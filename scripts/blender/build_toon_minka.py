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
            n.image = bpy.data.images.load(P('art/minka/toon/coat-minka.png')); n.image.pack()

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
INNER_EARS = (19, 20)                # the inner-ear linings, with the hair strokes the pack paints on them
BARE = TUFTS + INNER_EARS
# and the ear opening around them: the outer ear's rim and the forehead fur next to the tufts grew strands into it.
# Bare within NEAR of a tuft or lining point, full fur again by FAR (ear tips and backs keep theirs)
NEAR, FAR = 0.004, 0.009
PW = np.array([tuple(mw @ v.co) for v in ob.data.vertices])
from mathutils.kdtree import KDTree
kb_ = KDTree(int(np.isin(piece_of, BARE).sum()))
for i in np.where(np.isin(piece_of, BARE))[0]: kb_.insert(Vector(PW[i]), int(i))
kb_.balance()
furattr = ob.data.attributes.new('_fur', 'FLOAT', 'POINT')
for i in range(nv):
    if piece_of[i] in BARE: furattr.data[i].value = 0.0; continue
    d = kb_.find(Vector(PW[i]))[2]
    t = min(1.0, max(0.0, (d - NEAR) / (FAR - NEAR)))
    furattr.data[i].value = t * t * (3 - 2 * t)
vals = np.array([furattr.data[i].value for i in range(nv)])
print('BARE ear tufts and linings', int(np.isin(piece_of, BARE).sum()), 'points; ear opening', int(((vals < 0.99) & ~np.isin(piece_of, BARE)).sum()), 'more')

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
