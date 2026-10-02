# Puts a kept Minka version into the game (2026-10-02). The game loads public/minka/minka.glb; this exports it from
# a version's .blend (art/minka/versions/<id>/) with JPEG textures, so the download stays small. The game only changes
# when a version is published this way — iterating in the previewer never touches it.
#   blender -b --python scripts/blender/export_game_minka.py -- art/minka/versions/2026-10-02-toon-7/minka-toon.blend
import bpy, os, sys
blend = sys.argv[sys.argv.index('--') + 1]
P = lambda *a: os.path.join(os.path.abspath('.'), *a)
bpy.ops.wm.open_mainfile(filepath=P(blend))
for a in bpy.data.armatures: a.pose_position = 'POSE'
os.makedirs(P('public/minka'), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=P('public/minka/minka.glb'), export_format='GLB', export_animations=True,
                          export_animation_mode='ACTIONS', export_skins=True, export_morph=True, export_attributes=True,
                          export_image_format='JPEG', export_jpeg_quality=88)
open(P('public/minka/VERSION'), 'w').write(os.path.basename(os.path.dirname(blend)) + '\n')
print('PUBLISHED', blend, '→ public/minka/minka.glb', os.path.getsize(P('public/minka/minka.glb')) // 1024, 'KB')
