# Puts the refit eye texture (scripts/minka/fit_eyes.py) into Minka's model and re-exports it.
#   blender -b art/minka/blender/minka-split.blend --python scripts/blender/apply_eyes.py
import bpy, os
root = os.path.abspath(os.path.join(os.path.dirname(bpy.data.filepath), '..', '..', '..'))
for img in bpy.data.images:
    src = None
    if img.name.startswith('Color_'): src = 'art/minka/eyes/Color-new.png'
    if img.name.startswith('ORM_'): src = 'art/minka/eyes/ORM-new.png'
    if src:
        img.filepath = os.path.join(root, src); img.reload(); img.pack()
        print('replaced', img.name)
bpy.ops.wm.save_mainfile()
out = os.path.join(root, 'art/minka/3d/minka-split.glb')
for a in bpy.data.armatures: a.pose_position = 'POSE'      # export the walk, not the rest pose
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animations=True, export_skins=True)
for a in bpy.data.armatures: a.pose_position = 'REST'
print('WROTE', out)
