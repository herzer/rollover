# After hand-fixing art/minka/blender/minka-split.blend in Blender (move any hair the script missed from
# MinkaBody into MinkaWhiskers: Edit Mode on MinkaBody → select → P → Selection, then Ctrl-J into
# MinkaWhiskers), this writes the game's model again:
#   blender -b art/minka/blender/minka-split.blend --python scripts/blender/export_split.py
import bpy, os
out = os.path.join(os.path.dirname(bpy.data.filepath), '..', '3d', 'minka-split.glb')
for a in bpy.data.armatures: a.pose_position = 'POSE'      # export the walk, not the rest pose
bpy.ops.export_scene.gltf(filepath=os.path.abspath(out), export_format='GLB', export_animations=True, export_skins=True)
for a in bpy.data.armatures: a.pose_position = 'REST'
print('WROTE', os.path.abspath(out))
