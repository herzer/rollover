#!/usr/bin/env python3
"""Minka's coat in ArmorPaint (2026-10-03, Stefanie: "We have a version of armor paint running … can you use it to fix
Minka's texture perfectly?"). ArmorPaint (~/Developer/ArmorPaint, built from source) paints on the model in 3D, so
strokes run across the texture's seams; this moves the coat in and out of it, both ways scripted and headless.

   python3 scripts/minka/armorpaint.py setup [--version 2026-10-02-toon-14] [--force]
       → art/minka/armorpaint/minka.arm: her fur (the eyes are a separate texture and are left out), her coat on the
         first layer. Open it in ArmorPaint and paint on new layers above it. Never overwrites a painted project
         unless --force.
   python3 scripts/minka/armorpaint.py adopt [--title "…"]
       → exports the painted coat (all visible layers), bleeds it past the patch edges (bleed_coat.py), builds Minka
         with it (build_toon_minka.py, COAT=) and keeps it as the next toon version (the previewer opens it). The game
         is not touched: publish with export_game_minka.py when she says so.

Round trip measured 2026-10-03: inside the patches the coat comes back within 0.5/255 on average (p99 2/255).
ArmorPaint quirks handled here: with --background it quits before an export runs (a no-op --script keeps it alive),
and imports/fills only complete on later frames (the setup script steps through frames)."""
import argparse, json, pathlib, shutil, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
D = ROOT / 'art/minka/armorpaint'
APP = pathlib.Path.home() / 'Developer/ArmorPaint/paint/build/DerivedData/Build/Products/Release/ArmorPaint.app/Contents/MacOS/ArmorPaint'
APP_CWD = pathlib.Path.home() / 'Developer/ArmorPaint/paint'
BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'
VERS = ROOT / 'art/minka/versions'

def run(cmd, cwd=ROOT, env=None):
    import os
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env={**os.environ, **(env or {})})
    if r.returncode not in (0, 1) or 'Traceback' in r.stdout + r.stderr:
        sys.exit(f'failed: {" ".join(map(str, cmd))}\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}')
    return r.stdout + r.stderr

SETUP_C = r'''// Minka for painting in ArmorPaint (written by scripts/minka/armorpaint.py): her fur mesh, her coat on the first layer.
// ArmorPaint finishes imports and draws fills on later frames, so each step waits a few frames (the per-frame
// function also keeps a background run alive), and the app quits by itself at the end.
int frames = 0;
void tick() {
	frames = frames + 1;
	if (frames == 3) {
		slot_material_t *m = script_material_create("Minka coat");
		script_material_set(m);
		ui_node_t *img = script_material_create_node_at("TEX_IMAGE", -400.0, 0.0);
		script_material_set_button(img, 0, 0.0);
		script_material_connect(img, 0, script_material_get_node("OUTPUT_MATERIAL_PBR"), 0);
		script_material_update();
	}
	if (frames == 6) {
		script_fill_layer();
	}
	if (frames == 10) {
		project_filepath_set("@D@/minka.arm");
		project_save(0);
		console_info("SETUP SAVED");
	}
	if (frames == 14) {
		script_quit();
	}
}
void main() {
	script_import_asset("@D@/minka-fur.obj", 0);
	script_import_asset("@D@/coat-base.png", 0);
	script_notify_on_update(tick);
}
'''

EXPORT_FUR = r'''
import bpy, bmesh
ob = bpy.data.objects['MinkaToon']
me = ob.data.copy(); fur = bpy.data.objects.new('MinkaFur', me); bpy.context.scene.collection.objects.link(fur)
fur.matrix_world = ob.matrix_world.copy()
eye_i = next(i for i, m in enumerate(me.materials) if m and 'Eyes' in m.name)
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == eye_i], context='FACES_ONLY')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(me); bm.free()
for k in list(me.uv_layers):
    if k.name != 'DiffuseUV': me.uv_layers.remove(k)
if me.shape_keys: fur.shape_key_clear()
for o in bpy.data.objects: o.select_set(False)
fur.select_set(True); bpy.context.view_layer.objects.active = fur
bpy.ops.wm.obj_export(filepath='@D@/minka-fur.obj', export_selected_objects=True, export_materials=False,
                      export_normals=True, export_uv=True, apply_modifiers=False, forward_axis='NEGATIVE_Y', up_axis='Z')
'''

def current():
    return json.load(open(VERS / 'index.json'))['current']

def setup(a):
    D.mkdir(parents=True, exist_ok=True)
    arm = D / 'minka.arm'
    if arm.exists() and not a.force:
        sys.exit(f'{arm} exists — it may hold your painting. Run adopt first, or setup --force to start over.')
    v = a.version or current()
    blend = VERS / v / 'minka-toon.blend'
    coat = pathlib.Path(a.coat) if a.coat else None
    if coat is None:
        coat = ROOT / 'art/minka/toon/coat-minka-flow.png'                 # the coat the current versions are built from
    (D / 'export_fur.py').write_text(EXPORT_FUR.replace('@D@', str(D)))
    run([BLENDER, '-b', str(blend), '--python', str(D / 'export_fur.py')])
    shutil.copy2(coat, D / 'coat-base.png')
    (D / 'setup.c').write_text(SETUP_C.replace('@D@', str(D)))
    if arm.exists(): arm.unlink()
    out = run([str(APP), '--background', '--script', str(D / 'setup.c')], cwd=APP_CWD)
    if 'SETUP SAVED' not in out or not arm.exists():
        sys.exit('ArmorPaint did not save the project:\n' + out[-2000:])
    (D / 'SOURCE').write_text(f'{v}\n{coat}\n')
    print(f'ready: {arm} (from {v}) — open it in ArmorPaint and paint on new layers above "Minka coat"')

def adopt(a):
    arm = D / 'minka.arm'
    if not arm.exists(): sys.exit('no project: run setup first')
    exp = D / 'export'
    shutil.rmtree(exp, ignore_errors=True); exp.mkdir()
    (D / 'noop.c').write_text('void main() {}\n')
    run([str(APP), str(arm), '--background', '--export-textures', 'png', 'base_color', str(exp), '--script', str(D / 'noop.c')], cwd=APP_CWD)
    painted = next(exp.glob('*_base.png'), None)
    if not painted: sys.exit('ArmorPaint exported nothing')
    v = (D / 'SOURCE').read_text().split('\n')[0] if (D / 'SOURCE').exists() else current()
    coat = ROOT / 'art/minka/toon/coat-minka-armorpaint.png'
    print(run([BLENDER, '-b', str(VERS / v / 'minka-toon.blend'), '--python', str(ROOT / 'scripts/blender/bleed_coat.py'), '--', str(painted), str(coat)]).split('BLED')[-1].split('\n')[0].join(['BLED', '']))
    run([BLENDER, '-b', '--python', str(ROOT / 'scripts/blender/build_toon_minka.py')], env={'COAT': str(coat.relative_to(ROOT))})
    ids = [x['id'] for x in json.load(open(VERS / 'index.json'))['versions'] if '-toon-' in x['id']]
    n = max(int(i.rsplit('-', 1)[-1]) for i in ids) + 1
    shutil.copy2(painted, ROOT / 'art/minka/toon/armorpaint-export.png')
    print(run([sys.executable, str(ROOT / 'scripts/minka/snapshot.py'), f'toon-{n}', 'art/minka/3d/minka-toon.glb',
               '--blend', 'art/minka/toon/minka-toon.blend', '--preview', 'art/minka/toon/compare-front-toon.png',
               '--preview', 'art/minka/toon/compare-side-toon.png', '--preview', str(coat.relative_to(ROOT)),
               '--script', 'scripts/blender/build_toon_minka.py', '--script', 'scripts/minka/armorpaint.py',
               '--title', a.title or f'Toon Minka {n} (painted in ArmorPaint)',
               '--notes', f'Coat painted in ArmorPaint on {v} (art/minka/armorpaint/minka.arm), bled past the patch edges.',
               '--current']).strip())

ap = argparse.ArgumentParser()
sub = ap.add_subparsers(dest='cmd', required=True)
s = sub.add_parser('setup'); s.add_argument('--version'); s.add_argument('--coat'); s.add_argument('--force', action='store_true')
d = sub.add_parser('adopt'); d.add_argument('--title')
a = ap.parse_args()
setup(a) if a.cmd == 'setup' else adopt(a)
