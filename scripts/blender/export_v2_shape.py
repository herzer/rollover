# Writes Minka v2's rest shape (vertex and bone positions, world) to art/minka/v2/v2-shape.npz, for the cartoon
# Minka (build_minka_cartoon.py), which blends the toon mesh toward it. v2 has the toon's vertices minus the ear tufts.
#   blender -b --python scripts/blender/export_v2_shape.py
import bpy, numpy as np, os
P = lambda *a: os.path.join(os.path.abspath('.'), *a)
bpy.ops.wm.open_mainfile(filepath=P('art/minka/v2/minka-v2.blend'))
for a in bpy.data.armatures: a.pose_position = 'REST'
bpy.context.view_layer.update()
ob = next(o for o in bpy.data.objects if o.type == 'MESH' and any(m and m.name == 'MinkaFur' for m in o.data.materials))
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
wh = bpy.data.objects['MinkaWhiskers']
V = np.array([tuple(ob.matrix_world @ v.co) for v in ob.data.vertices])
W = np.array([tuple(wh.matrix_world @ v.co) for v in wh.data.vertices])
names = [b.name for b in arm.data.bones]
H = np.array([tuple(arm.matrix_world @ b.head_local) for b in arm.data.bones])
T = np.array([tuple(arm.matrix_world @ b.tail_local) for b in arm.data.bones])
g = {x.index: x.name for x in ob.vertex_groups}
# a fingerprint per vertex (its strongest bone) to check the vertex order matches the toon's
strongest = np.array([max(v.groups, key=lambda x: x.weight).group if len(v.groups) else -1 for v in ob.data.vertices])
np.savez(P('art/minka/v2/v2-shape.npz'), V=V, W=W, bone_names=np.array(names), H=H, T=T,
         strongest=np.array([g.get(i, '') for i in strongest]))
print('WROTE v2-shape.npz', V.shape, W.shape)
