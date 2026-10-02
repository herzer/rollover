# Exports the texture outlines (UV triangles) of Minka's paw pads: faces at the bottom of the paws (lowest 4%
# of her height) — scripts/minka/pink_pads.py recolours what is red inside them.
import bpy, json, os
bpy.ops.wm.open_mainfile(filepath=os.path.abspath('art/minka/blender/minka-before-eyeballs.blend'))
for a in bpy.data.armatures: a.pose_position = 'REST'
bpy.context.view_layer.update()
b = bpy.data.objects['MinkaBody']; mw = b.matrix_world; me = b.data; uv = me.uv_layers.active.data
zs = [(mw @ v.co).z for v in me.vertices]; zmin, zmax = min(zs), max(zs)
tris = []
for p in me.polygons:
    if max((mw @ me.vertices[i].co).z for i in p.vertices) < zmin + (zmax - zmin) * 0.045:
        tris.append([list(uv[li].uv) for li in p.loop_indices])
json.dump(tris, open('art/minka/eyes/pad-uvs.json', 'w'))
print('PAD FACES', len(tris))
