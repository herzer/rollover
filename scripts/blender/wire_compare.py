# Renders a mesh's wireframe on her head and prints its face counts — to judge topology.
#   blender -b --python scripts/blender/wire_compare.py -- <in.glb> <out.png>
import bpy, sys, bmesh
from mathutils import Vector
inp, out = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
(bpy.ops.import_scene.fbx if inp.lower().endswith('.fbx') else bpy.ops.import_scene.gltf)(filepath=inp)
for a in bpy.data.armatures: a.pose_position = 'REST'
obs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
ob = max(obs, key=lambda o: len(o.data.polygons))
for o in obs:
    if o != ob: o.hide_render = True
p = ob.data.polygons
print('FACES', len(p), 'quads', sum(1 for f in p if len(f.vertices) == 4), 'tris', sum(1 for f in p if len(f.vertices) == 3), 'verts', len(ob.data.vertices))
mod = ob.modifiers.new('wire', 'WIREFRAME'); mod.thickness = 0.0012; mod.use_replace = False; mod.use_relative_offset = False
mat = bpy.data.materials.new('w'); mat.diffuse_color = (0.1, 0.1, 0.14, 1)
ob.data.materials.append(mat); mod.material_offset = len(ob.data.materials) - 1
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'MATERIAL'
sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.97, 0.96, 0.98)
sc.render.resolution_x, sc.render.resolution_y = 1200, 1000
pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
lo = Vector((min(q.x for q in pts), min(q.y for q in pts), min(q.z for q in pts))); hi = Vector((max(q.x for q in pts), max(q.y for q in pts), max(q.z for q in pts)))
size = hi - lo
along_x = size.x >= size.y
head = Vector((hi.x - size.x * 0.18, (lo.y + hi.y) / 2, lo.z + size.z * 0.72)) if along_x else Vector(((lo.x + hi.x) / 2, hi.y - size.y * 0.18, lo.z + size.z * 0.72))
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera = cam
offset = Vector((size.x * 0.75, -size.x * 0.55, size.z * 0.1)) if along_x else Vector((size.y * 0.55, size.y * 0.75, size.z * 0.1))
cam.location = head + offset
cam.rotation_euler = (head - cam.location).to_track_quat('-Z', 'Y').to_euler(); cam.data.lens = 60
for m in ob.data.materials[:-1]:
    if m and m.use_nodes:
        bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    m.diffuse_color = (0.86, 0.84, 0.88, 1)
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
