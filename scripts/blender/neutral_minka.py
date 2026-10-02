# Minka in a neutral stance (2026-10-01), the shape the toon cat's clean mesh is fitted to (fit_minka_v2.py).
# Tripo's Minka is mid-stride with her head turned; fitted as she is, the stride and the turn would become the
# rest pose and every animation would carry them. Her own rig (build_rig.py) poses her:
#  - the head turns straight onto the body's axis (head-plane.json, from head_symmetry.py);
#  - each leg swings at the shoulder / hip so the paws stand in mirror pairs, side by side.
# Reads art/minka/blender/minka-rig.blend (unchanged); writes art/minka/v2/minka-neutral.blend (+ check renders).
#   blender -b --python scripts/blender/neutral_minka.py
import bpy, json, math, os
from mathutils import Vector, Matrix

ROOT = os.path.abspath('.'); P = lambda *a: os.path.join(ROOT, *a)
bpy.ops.wm.open_mainfile(filepath=P('art/minka/blender/minka-rig.blend'))
arm = bpy.data.objects['MinkaRig']; B = arm.data.bones; PB = arm.pose.bones
aw = arm.matrix_world
for a in bpy.data.armatures: a.pose_position = 'POSE'
for pb in PB: pb.matrix_basis = Matrix()
bpy.context.view_layer.update()
H = lambda n: aw @ PB[n].head
T = lambda n: aw @ PB[n].tail

def turn(name, R, pivot):
    """Turns a pose bone (and so its children) by world rotation R about a world pivot."""
    pb = PB[name]
    M = aw @ pb.matrix
    M = Matrix.Translation(pivot) @ R.to_4x4() @ Matrix.Translation(-pivot) @ M
    pb.matrix = aw.inverted() @ M
    bpy.context.view_layer.update()

# the body's axis: from between the hips to between the shoulders, seen from above
hips = (H('hind_upper.L') + H('hind_upper.R')) / 2; shoulders = (H('front_upper.L') + H('front_upper.R')) / 2
body_ang = math.atan2(shoulders.y - hips.y, shoulders.x - hips.x)
hp = json.load(open(P('art/minka/blender/head-plane.json')))
n = Vector(hp['normal']); head_ang = math.atan2(-n.x, n.y)        # the head's forward = the plane normal turned -90°
yaw = body_ang - head_ang
print('BODY %.1f° HEAD %.1f° → turn head %.1f°' % (math.degrees(body_ang), math.degrees(head_ang), math.degrees(yaw)))
turn('head', Matrix.Rotation(yaw, 3, 'Z'), H('head'))

# paws in mirror pairs: in the body's frame (forward u, sideways v), each pair stands at its mean forward
# position and mean spread; each leg swings at its top joint to get there
fwd = Vector((math.cos(body_ang), math.sin(body_ang), 0)); side = Vector((-fwd.y, fwd.x, 0))
center = (hips + shoulders) / 2
paw = lambda leg, s: T(f'{leg}_paw.{s}') * 0.5 + H(f'{leg}_paw.{s}') * 0.5
for leg in ('front', 'hind'):
    pL, pR = paw(leg, 'L'), paw(leg, 'R')
    u = ((pL - center).dot(fwd) + (pR - center).dot(fwd)) / 2
    v = (abs((pL - center).dot(side)) + abs((pR - center).dot(side))) / 2
    for s, sign in (('L', 1), ('R', -1)):
        top = H(f'{leg}_upper.{s}'); p = paw(leg, s)
        target = center + fwd * u + side * (sign * v); target.z = p.z
        R = (p - top).normalized().rotation_difference((target - top).normalized()).to_matrix()
        turn(f'{leg}_upper.{s}', R, top)
        print('LEG %s.%s moved %.1f mm' % (leg, s, (paw(leg, s) - p).length * 1000))

# her posed joints, for the fit (tail base etc.); z is shifted with the meshes below
joints = {pb.name: [list(aw @ pb.head), list(aw @ pb.tail)] for pb in PB}

# bake the pose into the meshes, drop the rig
for ob in [o for o in bpy.data.objects if o.type == 'MESH']:
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        if m.type == 'ARMATURE': bpy.ops.object.modifier_apply(modifier=m.name)
    mw = ob.matrix_world.copy(); ob.parent = None; ob.matrix_world = mw
bpy.data.objects.remove(arm)
zmin = min((o.matrix_world @ v.co).z for o in bpy.data.objects if o.type == 'MESH' for v in o.data.vertices)
for o in bpy.data.objects:
    if o.type == 'MESH': o.location.z -= zmin
for k in joints:
    for pt in joints[k]: pt[2] -= zmin
json.dump(joints, open(P('art/minka/v2/neutral-joints.json'), 'w'), indent=1)

sc = bpy.context.scene; sc.render.engine = 'BLENDER_EEVEE'; sc.render.resolution_x = sc.render.resolution_y = 600
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (.8, .8, .8, 1)
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun); sun.data.energy = 3; sun.rotation_euler = (0.8, 0, 0.6)
c = Vector((0.05, 0.02, 0.4))
for name, off in (('front', Vector((1.9, 0.0, 0.15))), ('side', Vector((0.0, -1.9, 0.05))), ('top', Vector((0.0, 0.01, 1.9)))):
    cm = bpy.data.objects.new(name, bpy.data.cameras.new(name)); sc.collection.objects.link(cm); sc.camera = cm
    cm.location = c + off; cm.data.lens = 50; cm.rotation_euler = (c - cm.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = P(f'art/minka/v2/neutral-{name}.png'); bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cm)
bpy.data.objects.remove(sun)
bpy.ops.wm.save_as_mainfile(filepath=P('art/minka/v2/minka-neutral.blend'))
print('WROTE minka-neutral.blend')
