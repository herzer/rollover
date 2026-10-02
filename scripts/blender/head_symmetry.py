# Finds Minka's head's true middle plane (her head is turned in Tripo's pose: the picture it was made from
# was a three-quarter view). The eyes' perpendicular bisector is the candidate; the nose tip, the chin and a
# mirror-match of the whole head (a round region, so a turned head is not cut unevenly) check it.
#   blender -b --python scripts/blender/head_symmetry.py -- <model.glb>
import bpy, sys, math, json
import numpy as np
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree
path = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
for a in bpy.data.armatures: a.pose_position = 'REST'
bpy.context.view_layer.update()
body = max((o for o in bpy.data.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
pts = np.array([list(body.matrix_world @ v.co) for v in body.data.vertices])
E0, E1 = Vector((0.4456, 0.0495, 0.6004)), Vector((0.4058, -0.0845, 0.5988))   # iris centres (high-poly, measured)
mid = (E0 + E1) / 2
n_eye = (E0 - E1).normalized()
# a round region around the head: centred a little behind the eyes
hc = mid - Vector((0.10, 0, 0.0))
head = np.array([p for p in pts if (Vector(p) - hc).length < 0.22])
head = head[::max(1, len(head) // 2500)]
kd = KDTree(len(head))
for i, p in enumerate(head): kd.insert(p, i)
kd.balance()
def err(n, o):
    tot = 0.0
    for p in head:
        q = Vector(p); d = (q - o).dot(n); tot += kd.find(q - 2 * d * n)[2]
    return tot / len(head)
print('HEAD points', len(head))
print('EYE-BISECTOR plane: yaw %.1f deg  mirror error %.4f' % (math.degrees(math.atan2(-n_eye.x, n_eye.y)), err(n_eye, mid)))
print('BODY y=0 plane: mirror error %.4f' % err(Vector((0, 1, 0)), Vector((mid.x, 0, mid.z))))
# best plane: search yaw/roll/offset around the eye bisector
best = (err(n_eye, mid), n_eye, mid)
base_yaw = math.atan2(-n_eye.x, n_eye.y)
for dy in np.radians(np.arange(-8, 8.1, 2)):
    for roll in np.radians(np.arange(-8, 8.1, 2)):
        n = (Matrix.Rotation(roll, 3, 'X') @ Matrix.Rotation(base_yaw + dy, 3, 'Z') @ Vector((0, 1, 0))).normalized()
        for off in np.arange(-0.02, 0.021, 0.005):
            o = mid + n * off
            e_ = err(n, o)
            if e_ < best[0]: best = (e_, n, o)
e_, n, o = best
yaw = math.degrees(math.atan2(-n.x, n.y)); roll = math.degrees(math.asin(max(-1, min(1, n.z))))
print('BEST plane: yaw %.1f deg  roll %.1f deg  mirror error %.4f' % (yaw, roll, e_))
# the nose tip (most forward point of the head, along the plane's forward direction) — how far off the plane?
fwd = Vector((1, 0, 0)) - n * n.x; fwd.normalize()
nose = max((Vector(p) for p in head), key=lambda q: (q - o).dot(fwd))
print('NOSE TIP off the plane: %.4f   eyes off it: %.4f / %.4f' % ((nose - o).dot(n), (E0 - o).dot(n), (E1 - o).dot(n)))
json.dump({'normal': list(n), 'origin': list(o), 'yaw_deg': yaw, 'roll_deg': roll, 'error': e_},
          open('art/minka/blender/head-plane.json', 'w'), indent=1)
