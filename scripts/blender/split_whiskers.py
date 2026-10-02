# Separates Minka's whiskers (and other thin strands: the ears' guard hairs) from her body, so the fur
# never grows on them (Stefanie, 2026-10-01: "we have to identify the whisker in Blender").
#   blender -b --python scripts/blender/split_whiskers.py -- <in.glb> <out.glb> <check.png> <out.blend>
# How: Tripo fused the whiskers to the face, so they cannot be picked as loose parts. Instead each point's
# thickness is measured (a ray from the point into the body, to the far side): a whisker is a strand a
# hair thick, the head is centimeters thick. Thin points on the head seed the selection, which then follows
# each strand inward while it stays thin and stops where the thick face begins. Those faces become their
# own object, "MinkaWhiskers", still skinned to the same skeleton; the body is "MinkaBody".
import bpy, bmesh, sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree

inp, out_glb, out_png, out_blend = sys.argv[sys.argv.index('--') + 1:][:4]
SEED, FOLLOW = 0.004, 0.02          # thickness in the model's own units (her height ≈ 0.82)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=inp)
body = max((o for o in bpy.context.scene.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
for o in list(bpy.context.scene.objects):
    if o.type == 'MESH' and o != body: bpy.data.objects.remove(o)       # Tripo's stray icosphere
me = body.data

def find_strands(ob, weld):
    """One pass: mark the faces of thin strands on the head; returns how many."""
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    if weld: bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)   # weld the UV-seam splits
    bm.normal_update(); bm.verts.ensure_lookup_table()
    tree = BVHTree.FromBMesh(bm)
    front = max(v.co.x for v in bm.verts)
    zs = [v.co.z for v in bm.verts]; ztop, zlow = max(zs), min(zs)
    tips = ztop - (ztop - zlow) * 0.07          # the ear tips keep their fur (Stefanie, 2026-10-01)
    on_head = lambda v: v.co.x > front * 0.55 and v.co.z < tips
    thick = {}
    for v in bm.verts:
        # both ways: Tripo's whisker blades sometimes face inward
        a = tree.ray_cast(v.co - v.normal * 1e-4, -v.normal, 1.0)
        c = tree.ray_cast(v.co + v.normal * 1e-4, v.normal, 1.0)
        thick[v.index] = min(a[3] if a[0] is not None else 1.0, c[3] if c[0] is not None else 1.0)
    open_edge = set()
    for e in bm.edges:
        if len(e.link_faces) < 2: open_edge.update(v.index for v in e.verts)
    strand = set(i for i, t in thick.items() if on_head(bm.verts[i]) and (t < SEED or i in open_edge))
    stack = list(strand)
    while stack:
        v = bm.verts[stack.pop()]
        for e in v.link_edges:
            o = e.other_vert(v)
            if o.index not in strand and (thick[o.index] < FOLLOW or o.index in open_edge) and on_head(o):
                strand.add(o.index); stack.append(o.index)
    n = 0
    for f in bm.faces:
        sel = sum(v.index in strand for v in f.verts) >= max(2, len(f.verts) - 1)   # most of its corners
        f.select_set(sel); n += sel
    bm.to_mesh(me); me.update(); bm.free()
    return n

pieces = []
for k in range(int(sys.argv[sys.argv.index("--") + 5]) if len(sys.argv) > sys.argv.index("--") + 5 else 2):                     # cutting part of a blade exposes the rest to the next measurement
    n = find_strands(body, weld=(k == 0))
    print('PASS', k, 'FACES', n)
    if not n: break
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = body; body.select_set(True)
    before = set(bpy.context.scene.objects)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    pieces += [o for o in bpy.context.scene.objects if o not in before]
bpy.ops.object.select_all(action='DESELECT')
for o in pieces: o.select_set(True)
bpy.context.view_layer.objects.active = pieces[0]
if len(pieces) > 1: bpy.ops.object.join()
whiskers = bpy.context.view_layer.objects.active
whiskers.name, body.name = 'MinkaWhiskers', 'MinkaBody'
print('BODY', len(body.data.vertices), 'WHISKERS', len(whiskers.data.vertices))

# a check render: whiskers red, body gray, framed on her head (world coordinates)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'OBJECT'
sc.display.shading.show_shadows = False
whiskers.color = (0.95, 0.05, 0.1, 1); body.color = (0.8, 0.8, 0.82, 1)
sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.97, 0.96, 0.98)
sc.render.resolution_x, sc.render.resolution_y = 1400, 1100
pts = [body.matrix_world @ Vector(c) for c in body.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
size = hi - lo
cam = bpy.data.objects.new('check', bpy.data.cameras.new('check')); sc.collection.objects.link(cam); sc.camera = cam
# the head is the front ~40% of her length, upper ~45% of her height; the long axis is whichever of x/y is longer
along_x = size.x >= size.y
head = Vector((hi.x - size.x * 0.18, (lo.y + hi.y) / 2, lo.z + size.z * 0.72)) if along_x else Vector(((lo.x + hi.x) / 2, lo.y + size.y * 0.18, lo.z + size.z * 0.72))
offset = Vector((size.x * 0.9, -size.x * 0.75, size.z * 0.15)) if along_x else Vector((size.y * 0.75, -size.y * 0.9, size.z * 0.15))
cam.location = head + offset
cam.rotation_euler = (head - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam.data.lens = 55
sc.render.filepath = out_png
bpy.ops.render.render(write_still=True)

bpy.ops.wm.save_as_mainfile(filepath=out_blend)
bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', export_animations=True, export_skins=True)
print('WROTE', out_glb, out_png, out_blend)
