# Real eyeballs for Minka (2026-10-01, Stefanie: "put in the real eyeballs … and frame them properly").
# Runs on art/minka/blender/minka.blend (from build_minka.py). For each eye:
#  1. find it: the faces whose texture is the iris (boxes from scripts/minka/eyeball_textures.py),
#  2. size it: a sphere fitted to that old eye bulge gives the eyeball's centre and size (kept in a sane
#     range against the eye opening),
#  3. open the socket: those faces go; Tripo's dark lid line stays on the lids and frames the eye,
#  4. the eyeball: a sphere with her iris (Tripo's big pupil, gray-blue fibers) projected onto its front,
#  5. the cornea: a clear glass shell with a gentle bulge in front (glTF transmission → glossy in the game),
#  6. the lids: the opening's rim is pulled onto the eyeball and a thin inner lid edge tucks in behind it,
#  7. all of it rigid on her head bone.
# The version without eyeballs is kept as minka-before-eyeballs.blend / .glb.
#   blender -b --python scripts/blender/add_eyeballs.py
import bpy, bmesh, json, math, os, shutil
import numpy as np
from mathutils import Vector

ROOT = os.path.abspath('.')
# the eye texture: Stefanie's rendered eyeball, used unchanged; scripts/minka/measure_iris.py wrote its iris circle
EYE_IMAGE = 'cat_eyeball_texture_lblue_wide_open.jpg'
P = lambda *a: os.path.join(ROOT, *a)
_m = json.load(open(P('art/minka/eye-textures', os.path.splitext(EYE_IMAGE)[0] + '.json')))
IRIS, (TEX_W, TEX_H) = _m['iris'], _m['size']
for ext, folder in (('blend', 'art/minka/blender'), ('glb', 'art/minka/3d')):
    src, dst = P(folder, f'minka.{ext}'), P(folder, f'minka-before-eyeballs.{ext}')
    if not os.path.exists(dst): shutil.copy(src, dst)
# Measure the eyes on the HIGH-poly model: its irises are whole in its texture (the optimized model's re-bake
# broke each eye into pieces). Both models share one space, so the measurements carry over.
HIGH_IRIS = [(1624, 1852, 1804, 2056), (88, 248, 252, 404)]    # in the high-poly texture (4096, image y down)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=P('art/minka/3d/minka-high.glb'))
for a in bpy.data.armatures: a.pose_position = 'REST'
bpy.context.view_layer.update()
hb = next(o for o in bpy.data.objects if o.name.startswith('MinkaBody'))
hm = hb.matrix_world
hbm = bmesh.new(); hbm.from_mesh(hb.data); huv = hbm.loops.layers.uv.active
measured = []
for (x0, y0, x1, y1) in HIGH_IRIS:
    c = Vector(((x0 + x1) / 2 / 4096, 1 - (y0 + y1) / 2 / 4096)); rx, ry = (x1 - x0) / 2 / 4096, (y1 - y0) / 2 / 4096
    def fuv(f):
        q = Vector((0, 0))
        for l in f.loops: q += l[huv].uv
        return q / len(f.loops)
    iris = [f for f in hbm.faces if ((fuv(f) - c).x / rx) ** 2 + ((fuv(f) - c).y / ry) ** 2 < 1.0]
    iv = list({v for f in iris for v in f.verts})
    mid = sum((hm @ v.co for v in iv), Vector()) / len(iv)
    ax = sum((hm.to_3x3() @ f.normal for f in iris), Vector()).normalized()
    across = lambda q: ((q - mid) - ax * (q - mid).dot(ax)).length
    r_iris = max(across(hm @ v.co) for v in iv)
    bulge = [hm @ v.co for v in hbm.verts if across(hm @ v.co) < r_iris * 1.1 and (hm @ v.co - mid).dot(ax) > -0.5 * r_iris
             and (hm.to_3x3() @ v.normal).normalized().dot(ax) > 0.3]
    pts = np.array([list(q) for q in bulge])
    sol = np.linalg.lstsq(np.c_[2 * pts, np.ones(len(pts))], (pts ** 2).sum(1), rcond=None)[0]
    fc = Vector(sol[:3]); fr = math.sqrt(max(1e-9, sol[3] + fc.length_squared))
    apex = max(bulge, key=lambda q: (q - mid).dot(ax))
    print('HIGH EYE', len(iris), 'faces  mid', tuple(round(v, 4) for v in mid), 'r_iris %.4f fit_r %.4f' % (r_iris, fr))
    measured.append({'mid': mid, 'axis': ax, 'r_iris': r_iris, 'fit_c': fc, 'fit_r': fr, 'apex': apex})
hbm.free()
bpy.ops.wm.open_mainfile(filepath=P('art/minka/blender/minka-before-eyeballs.blend'))
for a in bpy.data.armatures: a.pose_position = 'REST'
bpy.context.view_layer.update()
body = bpy.data.objects['MinkaBody']
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
head_bone = next(b.name for b in arm.data.bones if 'Head' in b.name)
eyes = json.load(open(P('art/minka/eyes/eyeballs.json')))
TEX = 4096
mw, mwi = body.matrix_world, body.matrix_world.inverted()

bm = bmesh.new(); bm.from_mesh(body.data)
bm.faces.ensure_lookup_table(); bm.verts.ensure_lookup_table()
uv = bm.loops.layers.uv.active


def face_uv(f):
    s = Vector((0, 0))
    for l in f.loops: s += l[uv].uv
    return s / len(f.loops)


def rigid_on_head(ob):
    ob.data.transform(arm.matrix_world.inverted())          # world → armature space (glTF's Y-up rotation)
    ob.parent = arm
    vg = ob.vertex_groups.new(name=head_bone)
    vg.add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')
    m = ob.modifiers.new('Armature', 'ARMATURE'); m.object = arm


def material(name, image=None, glass=False):
    mat = bpy.data.materials.new(name); mat.use_nodes = True
    nt = mat.node_tree; b = nt.nodes['Principled BSDF']
    if glass:
        b.inputs['Base Color'].default_value = (1, 1, 1, 1)
        b.inputs['Transmission Weight'].default_value = 1.0
        b.inputs['Roughness'].default_value = 0.02
        b.inputs['IOR'].default_value = 1.376
    else:
        tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(image); tex.image.pack()
        nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
        b.inputs['Roughness'].default_value = 0.42
    return mat


made = []
# Approach (after cutting sockets distorted the lids): the face stays whole. Each eyeball is the sphere that
# best fits the old eye bulge; the old painted eye surface is pushed just inside it, so the new eyeball
# shows there; the lids, just outside the sphere, frame it as they are. Both eyes are made symmetric.
found = [{'n': n, 'C': m['fit_c'], 'R': m['fit_r'], 'axis': m['axis'], 'r_open': m['r_iris'] * 1.05, 'apex': m['apex'], 'mid': m['mid']}
         for n, m in enumerate(measured)]
# One size for both eyes (her head is turned a little in Tripo's pose, so the eyes are NOT mirrored across
# y = 0 — each keeps its own place). The sphere's front sits where the old eye's front was.
if found:
    R = sum(e['R'] for e in found) / len(found)
    r_open = sum(e['r_open'] for e in found) / len(found)
    R = min(max(R, r_open * 1.15), r_open * 1.7)
    for e in found:
        e['R'], e['r_open'] = R, r_open
        e['C'] = e['mid'] - e['axis'] * (R - 0.002)        # the sphere's front at the iris centre, a hair proud of it
for eye_rec in found:
    n, C, R, axis, r_open = eye_rec['n'], eye_rec['C'], eye_rec['R'], eye_rec['axis'], eye_rec['r_open']
    print('EYE', n, 'C', tuple(round(v, 4) for v in C), 'R %.4f r_open %.4f' % (R, r_open))
    # --- the socket: Tripo's own lids are kept; only the old painted eye goes.
    # (Automatic lid shaping was tried 2026-10-01 — tuck-and-push, a rebuilt lid ring, smoothing — and each made
    # it worse: Tripo's eye corners are long thin triangles. The best result keeps Tripo's lids untouched.)
    hide = math.asin(min(0.999, r_open * 0.98 / R))
    def inside(v):
        d = mw @ v.co - C
        return d.length < R * 1.3 and d.length > 1e-6 and d.normalized().angle(axis) < hide
    gone = [f for f in bm.faces if all(inside(v) for v in f.verts)]
    bmesh.ops.delete(bm, geom=gone, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    print('EYE', n, 'removed', len(gone), 'faces')
    bm.faces.ensure_lookup_table(); bm.verts.ensure_lookup_table(); bm.edges.ensure_lookup_table()
    # Size and place the ball from the lid edge itself (Stefanie: "the eyeballs are inside the head too much …
    # the lid is not complete"): its front sits where the old eye's front was, and its surface runs through the
    # lid edge, 3% proud of it — the edge tucks inside the ball (hidden wiggle room), so no gap can show.
    keyp = lambda v: (round(v.co.x, 6), round(v.co.y, 6), round(v.co.z, 6))
    pair = lambda e2: tuple(sorted((keyp(e2.verts[0]), keyp(e2.verts[1]))))
    faces_at = {}
    for e2 in bm.edges: faces_at[pair(e2)] = faces_at.get(pair(e2), 0) + len(e2.link_faces)
    apex = eye_rec['apex']
    rim_pts = {}
    for e2 in bm.edges:
        if e2.is_boundary and faces_at[pair(e2)] == 1:
            for v in e2.verts:
                q = mw @ v.co
                if (q - C).length < R * 1.6: rim_pts[keyp(v)] = q
    if len(rim_pts) >= 6:
        P_ = np.array([list(q) for q in rim_pts.values()])
        cen = P_.mean(0)
        # aim: straight out of the lid opening (the opening's plane), not the old painted iris
        w, vecs = np.linalg.eigh(np.cov((P_ - cen).T))
        ax_new = Vector(vecs[:, 0])
        if ax_new.dot(axis) < 0: ax_new = -ax_new
        axis = ax_new.normalized()
        cen = Vector(cen)
        r_rim = float(np.median([((Vector(q) - cen) - axis * (Vector(q) - cen).dot(axis)).length for q in P_]))
        # front: as far out as the old eye's front, measured along the new aim
        h = max(0.004, (apex - cen).dot(axis) - 0.0025)        # set into the face, not bulging (2026-10-01)
        R_new = (r_rim * r_rim + h * h) / (2 * h) * 1.03      # 3% proud of the lid edge: it tucks inside the ball
        R_new = min(max(R_new, R * 0.7), R * 1.6)
        C = cen + axis * h - axis * R_new
        R = R_new
        r_open = r_rim                                        # the iris fills the opening, as in a kitten
        r_m, h_m = r_rim, h
        print('EYE', n, 'lid edge', len(rim_pts), 'r %.4f h %.4f -> R %.4f' % (r_m, h_m, R))
    eye_rec.update(C=C, R=R, axis=axis, r_open=r_open, rim_pts=rim_pts)

# --- symmetry (Stefanie, 2026-10-01: "get the symmetry in this area a hundred percent"). Her head is turned
# ~16.5° in Tripo's pose; its true middle plane (scripts/blender/head_symmetry.py → head-plane.json) is the
# mirror. Both eyes become exact mirror images: averaged position, size and aim — no cross-eye.
plane = json.load(open(P('art/minka/blender/head-plane.json')))
pn, po = Vector(plane['normal']).normalized(), Vector(plane['origin'])
mirror_p = lambda q: q - 2 * (q - po).dot(pn) * pn
mirror_v = lambda a: a - 2 * a.dot(pn) * pn
if len(found) == 2:
    a, b = found
    Cm = (a['C'] + mirror_p(b['C'])) / 2
    Rm = (a['R'] + b['R']) / 2; rm = (a['r_open'] + b['r_open']) / 2
    # Anti-"bug eyes" (research, 2026-10-01: parallel or converging eyes read cross-eyed, real eyes diverge a few
    # degrees; a ball proud of the lids reads bulging):
    #  - aim: her head's forward direction (in its middle plane), each eye turned DIVERGE degrees outward;
    #  - size: SHRINK smaller, and set back so its front sits SETBACK behind where it was.
    DIVERGE, SHRINK, SETBACK = 6.0, 0.86, 0.004
    fwd = (a['axis'] + mirror_v(a['axis'])); fwd = (fwd - pn * fwd.dot(pn)).normalized()
    out = pn * (1 if (Cm - po).dot(pn) > 0 else -1)
    Am = (fwd * math.cos(math.radians(DIVERGE)) + out * math.sin(math.radians(DIVERGE))).normalized()
    Rn = Rm * SHRINK
    # Depth from her face, not from the old eye: the ring of face around the eye (brow, cheek, the bridge of the
    # nose) sets how far forward the face comes there; the eye's front sits FLUSH behind that (side view showed
    # the ball poking past her profile — the 'Marty Feldman' bulge).
    FLUSH = 0.002
    ring = []
    for v in bm.verts:
        q = mw @ v.co; d = q - Cm
        lat = (d - Am * d.dot(Am)).length
        if not (Rm * 1.15 < lat < Rm * 1.7 and d.dot(Am) > -Rm): continue
        # brow (above) and cheek (below) only — the nose bridge (toward her middle) stands far forward
        if abs((d - Am * d.dot(Am)).normalized().dot(pn)) > 0.5: continue
        ring.append(d.dot(Am))
    ring.sort()
    q = lambda f: ring[int(len(ring) * f)] if ring else Rm
    print('EYES brow/cheek ring along the aim: q10 %.4f q25 %.4f q50 %.4f q75 %.4f' % (q(.1), q(.25), q(.5), q(.75)))
    face_front = q(0.48)                                           # brow and cheek, along the aim (the eye sits even with them)
    front_d = min(Rm, face_front - FLUSH)                          # the eye's front: flush behind them, never further out
    Cn = Cm + Am * (front_d - Rn)
    print('EYES face ring %d pts: face %.4f, old front %.4f -> new front %.4f (from old centre)' % (len(ring), face_front, Rm, front_d))
    a.update(C=Cn, axis=Am, R=Rn, r_open=rm)
    b.update(C=mirror_p(Cn), axis=mirror_v(Am).normalized(), R=Rn, r_open=rm)
    print('EYES aim: %.1f deg apart (outward %.1f each), R %.4f -> %.4f' % (math.degrees(Am.angle(mirror_v(Am))), DIVERGE, Rm, Rn))
    print('SYMMETRIC eyes: distance from the middle %.4f / %.4f' % ((a['C'] - po).dot(pn), (b['C'] - po).dot(pn)))

iris_jobs = []
for eye_rec in found:
    n, C, R, axis, r_open, rim_pts = eye_rec['n'], eye_rec['C'], eye_rec['R'], eye_rec['axis'], eye_rec['r_open'], eye_rec.get('rim_pts', {})
    keyp = lambda v: (round(v.co.x, 6), round(v.co.y, 6), round(v.co.z, 6))
    # the lid edge, as vertices (found by position once, then tracked as they move)
    rim = [v for v in bm.verts if keyp(v) in rim_pts]
    rimset = set(rim)
    side_v = Vector((0, 0, 1)) - axis * axis.z; side_v.normalize()      # 'up' across the eye
    # Every lid edge point goes onto the ball, 2% inside — all the way round, including the inner corner — and
    # slides over it toward the eye's centre line: the upper lid by UPPER, the lower lid by LOWER (a soft look:
    # the upper lid rests over the iris's top).
    UPPER, LOWER = 0.86, 0.95
    shift = {}
    for v in rim:
        q = mw @ v.co; d = (q - C).normalized()
        th = d.angle(axis)
        perp = d - axis * d.dot(axis)
        if perp.length < 1e-6: continue
        perp.normalize()
        k = LOWER + (UPPER - LOWER) * (0.5 + 0.5 * perp.dot(side_v))
        new_q = C + (axis * math.cos(th * k) + perp * math.sin(th * k)) * R * 0.98
        shift[v] = new_q - q
        v.co = mwi @ new_q
    print('EYE', n, 'lid edge points tucked onto the ball', len(shift))
    # --- the lids wrap the eyeball (Stefanie, 2026-10-01: "get the mesh to fit perfectly"). Like a shrinkwrap
    # with a falloff: lid skin near the opening takes the ball's curve, just outside it, fading out over WRAP of the
    # ball's angle beyond the opening; nothing of her face may stay inside the ball's front half.
    open_ang = max((mw @ v.co - C).normalized().angle(axis) for v in rim) if rim else math.radians(40)
    WRAP = math.radians(18)
    wrapped = 0
    for v in bm.verts:
        if v in rimset: continue
        q = mw @ v.co; d = q - C
        if d.length < 1e-6 or d.length > R * 1.7: continue
        ang = d.normalized().angle(axis)
        if ang > open_ang + WRAP: continue
        if ang < open_ang:                                   # skin inside the opening: lies on the ball's surface? push out
            if d.dot(axis) > 0 and d.length < R * 1.01: v.co = mwi @ (C + d.normalized() * R * 1.01); wrapped += 1
            continue
        w = 1.0 - (ang - open_ang) / WRAP
        w = w * w * (3 - 2 * w)
        target = R * (1.02 + 0.12 * (ang - open_ang) / WRAP)              # thin at the rim, thicker further out
        new_len = d.length + (target - d.length) * w
        if d.dot(axis) > -0.2 * R: new_len = max(new_len, R * 1.01)       # never inside the ball
        v.co = mwi @ (C + d.normalized() * new_len); wrapped += 1
    print('EYE', n, 'lid skin wrapped onto the ball', wrapped, 'opening %.1f deg' % math.degrees(open_ang))
    # the iris must fill the opening (no white crescent): its radius is the opening's widest point across the eye
    lat = [((mw @ v.co - C) - axis * (mw @ v.co - C).dot(axis)).length for v in rim]
    r_fill = max(lat) * 1.04 if lat else r_open
    cone = math.asin(min(0.999, r_open / R))               # the cornea's bulge covers the opening
    # the eyeball, iris centred on its axis
    side = Vector((0, 0, 1)) - axis * axis.z
    V = side.normalized(); U = V.cross(axis).normalized()
    r_iris = max(r_open * 0.97, r_fill)                     # the iris fills the opening; the lids rest over its edge
    print('EYE', n, 'iris radius %.4f (opening widest %.4f)' % (r_iris, r_fill))
    eye_rec['C'], eye_rec['R'], eye_rec['axis'] = C, R, axis
    print('EYE', n, 'final C', tuple(round(v, 4) for v in C), 'R %.4f' % R)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=32, radius=R, location=C)
    ball = bpy.context.active_object; ball.name = f'MinkaEye.{n}'
    ball.rotation_mode = 'QUATERNION'; ball.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(axis)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    me = ball.data; luv = me.uv_layers.active.data
    mirror = 1 if C.y >= 0 else -1
    iris_jobs.append((ball, C.copy(), U.copy(), V.copy(), mirror, r_iris))
    for poly in me.polygons:
        poly.use_smooth = True
        for li in poly.loop_indices:
            d = me.vertices[me.loops[li].vertex_index].co - C
            # the texture image is used as it is; its measured iris circle maps onto the eyeball's iris
            du = d.dot(U) / r_iris * mirror; dv = (d.dot(V) + 0.06 * r_iris) / r_iris      # iris a touch low
            luv[li].uv = ((IRIS['cx'] + du * IRIS['r']) / TEX_W, 1 - (IRIS['cy'] - dv * IRIS['r']) / TEX_H)
    me.materials.append(material(f'Eye.{n}', P('art/minka/eye-textures', EYE_IMAGE)))
    # the cornea: a clear shell, gently bulged in front
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=32, radius=R * 1.015, location=C)
    cor = bpy.context.active_object; cor.name = f'MinkaCornea.{n}'
    cor.rotation_mode = 'QUATERNION'; cor.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(axis)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    cosc = math.cos(cone)
    for v in cor.data.vertices:
        d = v.co - C; k = d.normalized().dot(axis)
        if k > cosc: v.co = C + d * (1 + 0.06 * ((k - cosc) / (1 - cosc)) ** 2)
    for poly in cor.data.polygons: poly.use_smooth = True
    cor.data.materials.append(material(f'Cornea.{n}', glass=True))
    made += [ball, cor]

# both irises the same size: the larger of the two openings sets it (her lids are not quite symmetric)
if iris_jobs:
    r_common = max(j[5] for j in iris_jobs)
    for ball, Cj, Uj, Vj, mir, _ in iris_jobs:
        me = ball.data; luv = me.uv_layers.active.data
        for poly in me.polygons:
            for li in poly.loop_indices:
                d = me.vertices[me.loops[li].vertex_index].co - Cj
                du = d.dot(Uj) / r_common * mir; dv = (d.dot(Vj) + 0.06 * r_common) / r_common
                luv[li].uv = ((IRIS['cx'] + du * IRIS['r']) / TEX_W, 1 - (IRIS['cy'] - dv * IRIS['r']) / TEX_H)
    print('IRIS common radius %.4f' % r_common)

# --- paint the old painted eye out of her body texture (Stefanie, 2026-10-01): on the skin around each socket,
# pixels that are iris-blue, pupil-black or highlight-white are filled in from the fur around them (onion-peel fill).
def paint_out_old_eyes(eyes_done):
    img = next((n.image for m in body.data.materials if m and m.use_nodes for n in m.node_tree.nodes
                if n.type == 'TEX_IMAGE' and n.image and any(l.to_socket.name == 'Base Color' for l in n.outputs[0].links)), None)
    if img is None: print('PAINT no body texture'); return
    W, H = img.size
    px = np.empty(W * H * 4, dtype=np.float32); img.pixels.foreach_get(px); px = px.reshape(H, W, 4)
    zone = np.zeros((H, W), bool)
    uvl = bm.loops.layers.uv.active
    for (C, R, axis) in eyes_done:
        for f in bm.faces:
            d = mw @ f.calc_center_median() - C
            if d.length > R * 1.9 or d.dot(axis) < -0.3 * R: continue
            uvs = [(l[uvl].uv.x * W, l[uvl].uv.y * H) for l in f.loops]
            for i in range(1, len(uvs) - 1):                       # fan triangles
                (x0, y0), (x1, y1), (x2, y2) = uvs[0], uvs[i], uvs[i + 1]
                xa, xb = int(max(0, min(x0, x1, x2))), int(min(W - 1, max(x0, x1, x2)) + 1)
                ya, yb = int(max(0, min(y0, y1, y2))), int(min(H - 1, max(y0, y1, y2)) + 1)
                if xb <= xa or yb <= ya: continue
                X, Y = np.meshgrid(np.arange(xa, xb) + 0.5, np.arange(ya, yb) + 0.5)
                den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
                if abs(den) < 1e-9: continue
                a = ((y1 - y2) * (X - x2) + (x2 - x1) * (Y - y2)) / den
                b = ((y2 - y0) * (X - x2) + (x0 - x2) * (Y - y2)) / den
                inside = (a >= -0.02) & (b >= -0.02) & (a + b <= 1.04)
                zone[ya:yb, xa:xb] |= inside
    r, g, b_ = px[..., 0], px[..., 1], px[..., 2]
    mx, mn = np.maximum(np.maximum(r, g), b_), np.minimum(np.minimum(r, g), b_)
    eyeish = (b_ > r + 0.05) & (b_ > g - 0.02) | (mx < 0.16) | ((mn > 0.78) & (mx - mn < 0.12))
    mask = zone & eyeish
    # grow the mask a little, so no fringe of the old eye remains
    for _ in range(3):
        m2 = mask.copy(); m2[1:] |= mask[:-1]; m2[:-1] |= mask[1:]; m2[:, 1:] |= mask[:, :-1]; m2[:, :-1] |= mask[:, 1:]
        mask = m2 & zone | mask
    n_paint = int(mask.sum())
    rgb = px[..., :3].copy()
    known = ~mask
    for _ in range(400):
        if not mask.any(): break
        acc = np.zeros_like(rgb); cnt = np.zeros((H, W), np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1)):
            k = np.roll(np.roll(known, dy, 0), dx, 1); v = np.roll(np.roll(rgb, dy, 0), dx, 1)
            acc += v * k[..., None]; cnt += k
        edge = mask & (cnt > 0)
        rgb[edge] = acc[edge] / cnt[edge][:, None]
        known |= edge; mask &= ~edge
    px[..., :3] = rgb
    img.pixels.foreach_set(px.ravel()); img.update(); img.pack()
    print('PAINT old eye pixels filled', n_paint, 'in', img.name)

paint_out_old_eyes([(e['C'], e['R'], e['axis']) for e in found])
bm.to_mesh(body.data); body.data.update(); bm.free()
for ob in made: rigid_on_head(ob)

# a check render, the blend, the game's model
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x, sc.render.resolution_y = 1400, 1100
cam = bpy.data.objects.new('check', bpy.data.cameras.new('check')); sc.collection.objects.link(cam); sc.camera = cam
headp = Vector((0.40, 0.0, 0.58))
cam.location = headp + Vector((0.42, -0.28, 0.05)); cam.data.lens = 55
cam.rotation_euler = (headp - cam.location).to_track_quat('-Z', 'Y').to_euler()
for ob in made:
    if ob.name.startswith('MinkaCornea'): ob.hide_render = True          # workbench can't show glass
sc.render.filepath = P('art/minka/blender/eyeballs-check.png')
bpy.ops.render.render(write_still=True)
for ob in made: ob.hide_render = False
bpy.data.objects.remove(cam)
bpy.ops.wm.save_as_mainfile(filepath=P('art/minka/blender/minka.blend'))
for a in bpy.data.armatures: a.pose_position = 'POSE'
bpy.ops.export_scene.gltf(filepath=P('art/minka/3d/minka.glb'), export_format='GLB', export_animations=True, export_skins=True)
for a in bpy.data.armatures: a.pose_position = 'REST'
bpy.ops.wm.save_mainfile()
print('WROTE minka.glb with eyeballs')
