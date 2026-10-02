# Builds Minka's model (2026-10-01): Tripo's retopologized mesh (clean quads), with
#  - the leftover whisker stubs removed from her face,
#  - new whiskers modeled as clean, thin, tapered tubes, black, no texture (Stefanie: "follow the position of
#    the old ones"): each old whisker's path is traced from the earlier split (MinkaWhiskers in
#    art/minka/blender/minka-split.blend's export, art/minka/3d/minka-split.glb), muzzle and brow — the ears'
#    guard hairs are not whiskers and are left out,
#  - the eye texture with the enhanced irises (scripts/minka/enhance_eyes.py → art/minka/eyes/low-*-eyes.png).
#   blender -b --python scripts/blender/build_minka.py
# Writes art/minka/3d/minka.glb (the game's model), art/minka/blender/minka.blend (neutral pose),
# art/minka/blender/whisker-paths.json and a check render art/minka/blender/minka-check.png.
import bpy, bmesh, json, math, os
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

ROOT = os.path.abspath('.')
P = lambda *a: os.path.join(ROOT, *a)
ROOT_R, TIP_R, SIDES, SEGS = 0.0013, 0.00022, 6, 12     # whisker radius at root and tip (her height ≈ 0.82)


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    for a in bpy.data.armatures: a.pose_position = 'REST'
    bpy.context.view_layer.update()
    return new


# 1. the old whiskers' paths ---------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
old = import_glb(P('art/minka/3d/minka-split.glb'))
ow = next(o for o in old if o.name.startswith('MinkaWhiskers'))
bm = bmesh.new(); bm.from_mesh(ow.data); bm.transform(ow.matrix_world)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
old_whisker_pts = [v.co.copy() for v in bm.verts]
old_whisker_tree = BVHTree.FromBMesh(bm)                                   # world space: distance to their surface
bm.verts.ensure_lookup_table()
seen, parts = set(), []
for v in bm.verts:
    if v.index in seen: continue
    stack, part = [v], []
    seen.add(v.index)
    while stack:
        x = stack.pop(); part.append(x.co.copy())
        for e in x.link_edges:
            o = e.other_vert(x)
            if o.index not in seen: seen.add(o.index); stack.append(o)
    parts.append(part)
HEAD = Vector((0.33, 0.0, 0.58))


def principal(pts):
    c = sum(pts, Vector()) / len(pts)
    M = Matrix(((0, 0, 0), (0, 0, 0), (0, 0, 0)))
    for p in pts:
        d = p - c
        for i in range(3):
            for j in range(3): M[i][j] += d[i] * d[j]
    e = Vector((1, 0.3, 0.2))
    for _ in range(50): e = (M @ e).normalized()
    return c, e


paths = []
for pts in parts:
    if len(pts) < 6: continue
    c = sum(pts, Vector()) / len(pts)
    muzzle = c.z < 0.56
    brow = c.z >= 0.6 and c.x > 0.43
    if not muzzle: continue                     # muzzle whiskers only: the lone brow whisker was dropped (Stefanie, 2026-10-01)
    # Whiskers grow in bundles from one pad, so a part may hold several strands. Find the root (the point
    # nearest her head), then group the points by the direction they lie in, as seen from the root.
    root = min(pts, key=lambda p: (p - HEAD).length)
    reach = max((p - root).length for p in pts)
    if reach < 0.025: continue                                       # a tuft, not a whisker
    far = sorted((p for p in pts if (p - root).length > reach * 0.35), key=lambda p: -(p - root).length)
    dirs = []
    for p in far:                                                    # greedy: each new direction > 7° from the others
        d = (p - root).normalized()
        if all(d.angle(e) > math.radians(7) for e in dirs): dirs.append(d)
    for d in dirs:
        mine = [p for p in pts if (p - root).length > 0.004 and (p - root).normalized().angle(d) < math.radians(5)]
        if len(mine) < 3: continue
        L = max((p - root).length for p in mine)
        if L < 0.025: continue
        bins = [[] for _ in range(8)]
        for p in mine: bins[min(7, int((p - root).length / L * 8))].append(p)
        line = [root] + [sum(bb, Vector()) / len(bb) for bb in bins if bb]
        paths.append({'kind': 'muzzle' if muzzle else 'brow', 'points': [list(p) for p in line]})
print('WHISKERS', len(paths), {k: sum(1 for p in paths if p['kind'] == k) for k in ('muzzle', 'brow')})
json.dump(paths, open(P('art/minka/blender/whisker-paths.json'), 'w'), indent=1)

# 2. her new model ---------------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
new = import_glb(P('art/minka/3d/minka-low8000-walk.glb'))
for o in new:
    if o.type == 'MESH' and len(o.data.vertices) < 100: bpy.data.objects.remove(o)    # Tripo's stray icosphere
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
glb_body = max((o for o in bpy.data.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
head_bone = next(b.name for b in arm.data.bones if 'Head' in b.name)

# Her body is Tripo's retopology as true QUADS (Stefanie, 2026-10-01: "we need quads to do a proper job"). The
# GLB above stores only triangles, so the body comes from the FBX of the same retopology (all 9,176 faces quads),
# with its own texture. The GLB is kept only for its skeleton (scripts/blender/build_rig.py replaces that too).
def bbox(o):
    pts = [o.matrix_world @ v.co for v in o.data.vertices]
    return Vector([min(q[i] for q in pts) for i in range(3)]), Vector([max(q[i] for q in pts) for i in range(3)])
before = set(bpy.data.objects)
bpy.ops.import_scene.fbx(filepath=P('art/minka/3d/minka-low8000.fbx'))
fbx = [o for o in bpy.data.objects if o not in before]
body = max((o for o in fbx if o.type == 'MESH'), key=lambda o: len(o.data.polygons))
for o in fbx:
    if o is not body: bpy.data.objects.remove(o)
bpy.context.view_layer.update()
# bake its transform into the mesh, then line it up with the GLB body (same shape; the FBX is centred on itself)
body.data.transform(body.matrix_world); body.matrix_world = Matrix.Identity(4)
(g0, g1), (f0, f1) = bbox(glb_body), bbox(body)
off = (g0 + g1) / 2 - (f0 + f1) / 2; off.z = g0.z - f0.z
body.data.transform(Matrix.Translation(off))
bpy.data.objects.remove(glb_body)
body.name = 'MinkaBody'
p_ = body.data.polygons
print('BODY quads', sum(1 for f in p_ if len(f.vertices) == 4), 'of', len(p_), 'offset', tuple(round(x, 4) for x in off))
# her paw pads pink (scripts/minka/pink_pads.py), on this texture
import json, subprocess
img = next((n.image for m in body.data.materials if m and m.use_nodes for n in m.node_tree.nodes
            if n.type == 'TEX_IMAGE' and n.image and any(l.to_socket.name == 'Base Color' for l in n.outputs[0].links)), None)
if img:
    zs = [v.co.z for v in body.data.vertices]; zmin, zmax = min(zs), max(zs)
    uvd = body.data.uv_layers.active.data
    tris = [[list(uvd[li].uv) for li in poly.loop_indices] for poly in body.data.polygons
            if max(body.data.vertices[i].co.z for i in poly.vertices) < zmin + (zmax - zmin) * 0.045]
    json.dump(tris, open(P('art/minka/eyes/pad-uvs.json'), 'w'))
    tex = P('art/minka/eyes/quad-color.png')
    img.filepath_raw = tex; img.file_format = 'PNG'; img.save()
    subprocess.run(['python3', P('scripts/minka/pink_pads.py'), tex], check=True)
    img.filepath = tex; img.reload(); img.pack()
    print('PADS pink on', img.name, img.size[:])

# 3. remove the whisker stubs. Tripo's retopology left each old whisker as a tiny loose quad floating in front
#    of her face. Welded at the UV seams, her mesh is one big piece plus those (8, of 2 triangles each), so
#    the stubs are exactly the pieces under 20 faces — nothing else is touched. (Pieces are found through
#    shared vertex positions, so the mesh itself is not welded and keeps its seams and normals.)
me = body.data
bm = bmesh.new(); bm.from_mesh(me)
bm.faces.ensure_lookup_table()
key = lambda v: (round(v.co.x, 6), round(v.co.y, 6), round(v.co.z, 6))
parent = list(range(len(bm.faces)))
def find(i):
    while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
    return i
owner = {}
for f in bm.faces:
    for v in f.verts:
        k = key(v)
        if k in owner: parent[find(f.index)] = find(owner[k])
        else: owner[k] = f.index
size = {}
for f in bm.faces: size[find(f.index)] = size.get(find(f.index), 0) + 1
stubs = [f for f in bm.faces if size[find(f.index)] < 20]
print('STUB FACES', len(stubs), 'in', len({find(f.index) for f in stubs}), 'pieces')
bmesh.ops.delete(bm, geom=stubs, context='FACES')
loose = [v for v in bm.verts if not v.link_faces]
bmesh.ops.delete(bm, geom=loose, context='VERTS')
bm.to_mesh(me); me.update(); bm.free()

# 4. the new whiskers ----------------------------------------------------------------------------------
wm = bmesh.new()
for path in paths:
    pts = [Vector(p) for p in path['points']]
    # a smooth path: Catmull-Rom through the traced points, SEGS segments, root pushed a little into the face
    pts.insert(0, pts[0] + (pts[0] - pts[1]).normalized() * 0.004)
    def at(u):
        n = len(pts) - 1; f = u * n; i = min(int(f), n - 1); t = f - i
        p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, n)]
        return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)
    centers = [at(k / SEGS) for k in range(SEGS + 1)]
    rings = []
    up = Vector((0, 0, 1))
    for k, c in enumerate(centers):
        tng = (centers[min(k + 1, SEGS)] - centers[max(k - 1, 0)]).normalized()
        side = tng.cross(up)
        if side.length < 1e-6: side = tng.cross(Vector((0, 1, 0)))
        side.normalize(); nrm = side.cross(tng).normalized()
        r = ROOT_R + (TIP_R - ROOT_R) * (k / SEGS) ** 0.8
        if k == SEGS:
            rings.append([wm.verts.new(c)]); continue
        rings.append([wm.verts.new(c + (side * math.cos(a) + nrm * math.sin(a)) * r)
                      for a in (2 * math.pi * s / SIDES for s in range(SIDES))])
    for k in range(SEGS - 1):
        A, B = rings[k], rings[k + 1]
        for s in range(SIDES): wm.faces.new((A[s], A[(s + 1) % SIDES], B[(s + 1) % SIDES], B[s]))
    A, tip = rings[SEGS - 1], rings[SEGS][0]
    for s in range(SIDES): wm.faces.new((A[s], A[(s + 1) % SIDES], tip))
    wm.faces.new(list(reversed(rings[0])))                                   # close the root
wmesh = bpy.data.meshes.new('MinkaWhiskers')
wm.normal_update(); wm.to_mesh(wmesh); wm.free()
for p in wmesh.polygons: p.use_smooth = True
whiskers = bpy.data.objects.new('MinkaWhiskers', wmesh)
bpy.context.scene.collection.objects.link(whiskers)
mat = bpy.data.materials.new('Whisker'); mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
bsdf.inputs['Base Color'].default_value = (0.012, 0.011, 0.012, 1); bsdf.inputs['Roughness'].default_value = 0.38
wmesh.materials.append(mat)
# rigid on her head: one bone, full weight. The points were made in world space; the armature is rotated
# (glTF's Y-up), so move them into its space before parenting, or they land somewhere else.
wmesh.transform(arm.matrix_world.inverted())
whiskers.parent = arm
vg = whiskers.vertex_groups.new(name=head_bone)
vg.add(list(range(len(wmesh.vertices))), 1.0, 'REPLACE')
mod = whiskers.modifiers.new('Armature', 'ARMATURE'); mod.object = arm
print('WHISKER MESH verts', len(wmesh.vertices), 'faces', len(wmesh.polygons), 'bone', head_bone)

# 5. a check render, the neutral-pose .blend and the game's model -----------------------------------------
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'TEXTURE'
whiskers.color = (0.01, 0.01, 0.01, 1)
sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.97, 0.96, 0.98)
sc.render.resolution_x, sc.render.resolution_y = 1400, 1100
cam = bpy.data.objects.new('check', bpy.data.cameras.new('check')); sc.collection.objects.link(cam); sc.camera = cam
head = Vector((0.40, 0.0, 0.56))
cam.location = head + Vector((0.42, -0.28, 0.06)); cam.data.lens = 50
cam.rotation_euler = (head - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc.render.filepath = P('art/minka/blender/minka-check.png')
bpy.ops.render.render(write_still=True)
bpy.data.objects.remove(cam)
bpy.ops.wm.save_as_mainfile(filepath=P('art/minka/blender/minka.blend'))
for a in bpy.data.armatures: a.pose_position = 'POSE'
bpy.ops.export_scene.gltf(filepath=P('art/minka/3d/minka.glb'), export_format='GLB', export_animations=True, export_skins=True)
print('WROTE minka.glb, minka.blend, whisker-paths.json, minka-check.png')
