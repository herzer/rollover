# Headless: per-vertex thickness of Minka's mesh (ray from each point into the body, to the far side).
# Whiskers and guard hairs are thin strands; her head and body are thick. Prints a histogram for the head
# and renders the head colored by thickness (red = thin) to art/minka/blender/thickness.png.
import bpy, bmesh, sys, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree
args = sys.argv[sys.argv.index('--') + 1:]
path, out = args[0], args[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
ob = max((o for o in bpy.context.scene.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
for o in list(bpy.context.scene.objects):
    if o.type == 'MESH' and o != ob: bpy.data.objects.remove(o)
me = ob.data
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bm.normal_update()
bm.to_mesh(me); me.update()
bm.verts.ensure_lookup_table()
tree = BVHTree.FromBMesh(bm)
xs = [v.co.x for v in bm.verts]; zs = [v.co.z for v in bm.verts]
front = max(xs); top = max(zs)
thick = []
for v in bm.verts:
    o = v.co - v.normal * 1e-4
    hit = tree.ray_cast(o, -v.normal, 1.0)
    thick.append(hit[3] if hit[0] is not None else 1.0)
head = [i for i, v in enumerate(bm.verts) if v.co.x > front * 0.55]
hist = {}
for i in head:
    t = thick[i]; b = 0.001 if t < 0.001 else 0.002 if t < 0.002 else 0.004 if t < 0.004 else 0.008 if t < 0.008 else 0.016 if t < 0.016 else 0.032 if t < 0.032 else 1
    hist[b] = hist.get(b, 0) + 1
print('FRONT', front, 'TOP', top, 'HEAD', len(head))
print('HIST', sorted(hist.items()))
# color by thickness for a look
col = me.color_attributes.new('thick', 'FLOAT_COLOR', 'POINT')
for i, t in enumerate(thick):
    k = max(0.0, min(1.0, (t - 0.002) / 0.02))
    col.data[i].color = (1.0, k, k, 1.0)
me.color_attributes.active_color = col
# render: workbench, vertex colors, camera on her face
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'VERTEX'
sc.render.resolution_x, sc.render.resolution_y = 1400, 1100
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
target = Vector((front * 0.75, 0, top * 0.68))
cam.location = target + Vector((0.55, -0.42, 0.18))
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam.data.lens = 50
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print('WROTE', out)
