# A proper quadruped skeleton for Minka (2026-10-01). Tripo's rig on the optimized mesh has 23 bones and is
# broken — the right hind leg is one bone ending at the hip, the left hind leg stops above the ground, the tail
# is one bone, the spine hangs off a hip bone — which is why its walk looked "ridiculously bad".
# This builds a clean skeleton fitted to her body (legs traced along their real centrelines), skins her with
# Blender's automatic weights, moves eyes, corneas and whiskers onto the new head bone, and exports her in
# her neutral standing pose (no baked animation — the game animates her procedurally).
#   blender -b --python scripts/blender/build_rig.py
# Reads art/minka/blender/minka.blend; writes art/minka/blender/minka-rig.blend and art/minka/3d/minka-rig.glb.
import bpy, bmesh, math, os
import numpy as np
from mathutils import Vector

ROOT = os.path.abspath('.')
P = lambda *a: os.path.join(ROOT, *a)
bpy.ops.wm.open_mainfile(filepath=P('art/minka/blender/minka.blend'))
old_arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for a in bpy.data.armatures: a.pose_position = 'REST'
bpy.context.view_layer.update()
body = bpy.data.objects['MinkaBody']
rigid = [o for o in bpy.data.objects if o.type == 'MESH' and o is not body]      # eyes, corneas, whiskers
old_bone_w = {b.name: old_arm.matrix_world @ b.head_local for b in old_arm.data.bones}

# --- her shape, in world space -----------------------------------------------------------------------------
# apply the old armature in rest pose so the mesh sits as seen, then free it from the old rig
for o in [body] + rigid:
    for m in list(o.modifiers):
        if m.type == 'ARMATURE': o.modifiers.remove(m)
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
    o.vertex_groups.clear()
V = np.array([list(body.matrix_world @ v.co) for v in body.data.vertices])
xmin, xmax = V[:, 0].min(), V[:, 0].max()
zmin, zmax = V[:, 2].min(), V[:, 2].max()
H = zmax - zmin
print('BODY x %.3f..%.3f  z %.3f..%.3f' % (xmin, xmax, zmin, zmax))

def centroid(mask):
    s = V[mask]
    return Vector(s.mean(0)) if len(s) else None

# --- the four paws: the lowest points, split front/back and left/right --------------------------------------
low = V[:, 2] < zmin + H * 0.06
xmid = (V[low, 0].min() + V[low, 0].max()) / 2
paws = {}
for fb, xs in (('front', V[:, 0] > xmid), ('hind', V[:, 0] <= xmid)):
    for side, ys in (('L', V[:, 1] > 0), ('R', V[:, 1] <= 0)):
        m = low & xs & ys
        c = centroid(m)
        paws[(fb, side)] = c
        print('PAW', fb, side, tuple(round(x, 3) for x in c))

# --- leg centrelines: slice each leg by height and take the middle of the slice near that paw's column -------
def centreline(paw, top_z, radius):
    pts = []
    for z in np.linspace(paw.z + H * 0.03, top_z, 9):
        col = (np.abs(V[:, 2] - z) < H * 0.025) & (np.hypot(V[:, 0] - paw.x, V[:, 1] - paw.y) < radius)
        c = centroid(col)
        if c is not None:
            pts.append(c); paw = Vector((paw.x * 0.5 + c.x * 0.5, paw.y * 0.5 + c.y * 0.5, paw.z))   # follow the leg
    return pts

def at_height(line, z):
    for a, b in zip(line, line[1:]):
        if a.z <= z <= b.z:
            t = (z - a.z) / max(1e-6, b.z - a.z); return a.lerp(b, t)
    return line[-1] if z > line[-1].z else line[0]

shoulder_z = zmin + H * 0.62
hip_z = zmin + H * 0.62
legs = {}
for (fb, side), paw in paws.items():
    top = shoulder_z if fb == 'front' else hip_z
    line = centreline(paw, top, 0.075)
    g = lambda f: at_height(line, zmin + (top - zmin) * f)
    if fb == 'front':          # shoulder → elbow (bends back) → wrist → paw → toe tip
        j = [g(1.0), g(0.58), g(0.2), Vector((paw.x, paw.y, zmin + H * 0.045))]
        j[1].x -= H * 0.02
    else:                      # hip → knee (bends forward) → hock (bends back) → paw → toe tip
        j = [g(1.0), g(0.6), g(0.28), Vector((paw.x, paw.y, zmin + H * 0.045))]
        j[1].x += H * 0.03; j[2].x -= H * 0.03
    j.append(Vector((paw.x + H * 0.06, paw.y, zmin + H * 0.03)))
    legs[(fb, side)] = j

# --- spine, neck, head, ears, tail ---------------------------------------------------------------------------
hipL, hipR = legs[('hind', 'L')][0], legs[('hind', 'R')][0]
shL, shR = legs[('front', 'L')][0], legs[('front', 'R')][0]
pelvis = (hipL + hipR) / 2 + Vector((0, 0, H * 0.04))
chest = (shL + shR) / 2 + Vector((0, 0, H * 0.06))
head_old = old_bone_w.get('tripo::Head_0') or old_bone_w.get('tripoHead_0')
skull = next((old_bone_w[k] for k in old_bone_w if k.endswith('bone_20')), None)
ears = [old_bone_w[k] for k in old_bone_w if k.endswith('bone_21') or k.endswith('bone_22')]
print('OLD head', head_old, 'skull', skull, 'ears', ears)
neck = head_old if head_old is not None else chest + Vector((H * 0.12, 0, H * 0.08))
skull = skull if skull is not None else neck + Vector((H * 0.12, 0, H * 0.18))
# the tail: everything behind the pelvis, ordered from its root outward
tail_mask = V[:, 0] < pelvis.x - H * 0.12
T = V[tail_mask]
tail = [pelvis + Vector((-H * 0.08, 0, H * 0.02))]
if len(T):
    root = Vector(tail[0])
    d = np.linalg.norm(T - np.array(root), axis=1)
    for k in range(1, 6):
        band = T[(d > d.max() * (k - 0.5) / 5.5) & (d <= d.max() * (k + 0.5) / 5.5)]
        if len(band): tail.append(Vector(band.mean(0)))
print('TAIL points', len(tail))

# --- the armature --------------------------------------------------------------------------------------------
arm_data = bpy.data.armatures.new('MinkaRig')
arm = bpy.data.objects.new('MinkaRig', arm_data)
bpy.context.scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
def bone(name, head, tail_, parent=None, deform=True):
    b = eb.new(name); b.head, b.tail = head, tail_
    if (b.tail - b.head).length < 1e-4: b.tail = b.head + Vector((0, 0, 0.01))
    if parent: b.parent = eb[parent]; b.use_connect = False
    b.use_deform = deform
    return b
mid1 = pelvis.lerp(chest, 0.5) + Vector((0, 0, H * 0.02))
bone('root', Vector((pelvis.x, 0, zmin)), Vector((pelvis.x + 0.05, 0, zmin)), deform=False)
bone('pelvis', pelvis, mid1, 'root')
bone('spine', mid1, chest, 'pelvis')
bone('chest', chest, neck, 'spine')
bone('neck', neck, neck.lerp(skull, 0.5), 'chest')
bone('head', neck.lerp(skull, 0.5), skull + (skull - neck) * 0.5, 'neck')
for i, e in enumerate(ears):
    side = 'L' if e.y > 0 else 'R'
    bone(f'ear.{side}', e, e + Vector((0, 0, H * 0.08)), 'head')
prev = 'pelvis'
for i, (a, b) in enumerate(zip(tail, tail[1:])):
    bone(f'tail.{i}', a, b, prev); prev = f'tail.{i}'
for (fb, side), j in legs.items():
    names = ['upper', 'lower', 'ankle', 'paw']
    parent = 'chest' if fb == 'front' else 'pelvis'
    for k, nm in enumerate(names):
        bone(f'{fb}_{nm}.{side}', j[k], j[k + 1], parent); parent = f'{fb}_{nm}.{side}'
bpy.ops.object.mode_set(mode='OBJECT')
print('BONES', len(arm_data.bones), sorted(b.name for b in arm_data.bones))

# --- skin: automatic weights for her body, the head bone for eyes and whiskers ------------------------------
# Automatic weights need one connected surface; her mesh is split at every texture seam. So: weld a copy,
# skin the copy (scaled up — bone-heat solving is unreliable at this tiny size), then copy the weights back.
proxy = body.copy(); proxy.data = body.data.copy(); proxy.name = 'SkinProxy'
bpy.context.scene.collection.objects.link(proxy)
for m in list(proxy.modifiers): proxy.modifiers.remove(m)
pb = bmesh.new(); pb.from_mesh(proxy.data)
bmesh.ops.remove_doubles(pb, verts=pb.verts, dist=1e-5)
pb.to_mesh(proxy.data); pb.free()
SCALE = 10.0
for o in (proxy, arm): o.scale = (SCALE,) * 3; o.location = o.location * SCALE
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT')
proxy.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
print('PROXY unweighted', sum(1 for v in proxy.data.vertices if not v.groups), 'of', len(proxy.data.vertices))
for o in (proxy, arm): o.scale = (1, 1, 1); o.location = o.location / SCALE
proxy.parent = None
bpy.context.view_layer.update()
# copy weights to her real mesh, point by nearest point
for g in proxy.vertex_groups: body.vertex_groups.new(name=g.name)
dt = body.modifiers.new('weights', 'DATA_TRANSFER')
dt.object = proxy; dt.use_vert_data = True; dt.data_types_verts = {'VGROUP_WEIGHTS'}
dt.vert_mapping = 'NEAREST'; dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'
bpy.context.view_layer.objects.active = body
bpy.ops.object.modifier_apply(modifier=dt.name)
bpy.data.objects.remove(proxy)
# The face must move as one piece with the head bone: the eyes, corneas and whiskers are fixed to it, and any
# face skin left on the neck or chest lags behind them when she turns her head (the 'spooky' floating eyes,
# 2026-10-01). Past the neck joint her skin blends fully onto the head; ear skin keeps its ear bones.
hb = arm.data.bones['head']; nb = arm.data.bones['neck']
n0 = arm.matrix_world @ nb.head_local; h0 = arm.matrix_world @ hb.head_local
axis = (h0 - n0); L = axis.length; axis.normalize()
gid = {g.name: g.index for g in body.vertex_groups}
ear_ids = {gid[n] for n in gid if n.startswith('ear')}
head_g = body.vertex_groups['head']
moved = 0
for v in body.data.vertices:
    p = body.matrix_world @ v.co
    t = (p - n0).dot(axis) / L                     # 0 at the neck joint, 1 at the head joint
    k = min(1.0, max(0.0, (t - 0.15) / 0.6))
    k = k * k * (3 - 2 * k)
    if k <= 0: continue
    ws = {g.group: g.weight for g in v.groups}
    ear = sum(w for gi, w in ws.items() if gi in ear_ids)
    keep = ear                                      # ear skin stays on the ears
    rest = 1.0 - keep
    total = sum(w for gi, w in ws.items() if gi not in ear_ids) or 1.0
    for g in list(v.groups):
        if g.group in ear_ids: continue
        body.vertex_groups[g.group].add([v.index], g.weight / total * rest * (1 - k), 'REPLACE')
    head_g.add([v.index], (ws.get(head_g.index, 0) / total * rest) * (1 - k) + rest * k, 'REPLACE')
    moved += 1
print('HEAD SKIN blended', moved)
mw = body.matrix_world.copy(); body.parent = arm; body.matrix_world = mw
m = body.modifiers.new('Armature', 'ARMATURE'); m.object = arm
unweighted = sum(1 for v in body.data.vertices if not v.groups)
print('SKIN groups', len(body.vertex_groups), 'unweighted verts', unweighted)
for o in rigid:
    mw = o.matrix_world.copy()
    o.parent = arm; o.matrix_world = mw
    g = o.vertex_groups.new(name='head'); g.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
    m = o.modifiers.new('Armature', 'ARMATURE'); m.object = arm
bpy.data.objects.remove(old_arm)

# --- a check render and the files ---------------------------------------------------------------------------
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x, sc.render.resolution_y = 1200, 900
arm.show_in_front = True; arm.data.display_type = 'STICK'
cam = bpy.data.objects.new('check', bpy.data.cameras.new('check')); sc.collection.objects.link(cam); sc.camera = cam
c = Vector(((xmin + xmax) / 2, 0, zmin + H * 0.45))
cam.location = c + Vector((0.2, -1.9, 0.25)); cam.data.lens = 50
cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc.render.filepath = P('art/minka/blender/rig-check.png')
bpy.ops.render.render(write_still=True)
bpy.data.objects.remove(cam)
bpy.ops.wm.save_as_mainfile(filepath=P('art/minka/blender/minka-rig.blend'))
bpy.ops.export_scene.gltf(filepath=P('art/minka/3d/minka-rig.glb'), export_format='GLB', export_animations=False, export_skins=True)
print('WROTE minka-rig.glb')
