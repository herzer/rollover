# Headless: import Minka, weld the UV-seam splits, and list the mesh's truly separate parts (loose parts).
# blender -b --python scripts/blender/analyze_minka.py -- art/minka/3d/minka-rigged.glb
import bpy, bmesh, sys
from mathutils import Vector
path = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
print('MESHES', [(o.name, len(o.data.vertices), len(o.data.polygons)) for o in meshes])
ob = meshes[0]
bm = bmesh.new(); bm.from_mesh(ob.data)
before = len(bm.verts)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
print('WELD', before, '->', len(bm.verts))
bm.verts.ensure_lookup_table()
seen = set(); parts = []
for v in bm.verts:
    if v.index in seen: continue
    stack = [v]; part = []
    seen.add(v.index)
    while stack:
        x = stack.pop(); part.append(x)
        for e in x.link_edges:
            o = e.other_vert(x)
            if o.index not in seen: seen.add(o.index); stack.append(o)
    parts.append(part)
parts.sort(key=len, reverse=True)
print('PARTS', len(parts), 'sizes', [len(p) for p in parts[:12]], '...')
for p in parts[1:40]:
    c = sum((v.co for v in p), Vector()) / len(p)
    xs = [v.co for v in p]
    ext = [max(a[i] for a in xs) - min(a[i] for a in xs) for i in range(3)]
    print('  part n=%d centre=(%.3f %.3f %.3f) extent=(%.3f %.3f %.3f)' % (len(p), c.x, c.y, c.z, *ext))
