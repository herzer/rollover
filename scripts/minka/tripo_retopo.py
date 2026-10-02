#!/usr/bin/env python3
"""Tripo's smart retopology for Minka (2026-10-01): her original Tripo model → clean low-poly quads with her
texture baked on → four-legged rig → walk. Resumes like tripo.py (art/minka/3d/tasks.json).
  python3 scripts/minka/tripo_retopo.py [face_limit]      (default 8000)"""
import json, sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
from tripo import OUT, STATE, call, task, wait, step, download, url, rig  # noqa: E402

def main():
    faces = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    state = json.loads(STATE.read_text())
    print('balance:', call('GET', '/user/balance'))
    key = f'lowpoly-{faces}'
    low = step(state, key, lambda: task({
        'type': 'highpoly_to_lowpoly', 'original_model_task_id': state['model'],
        'quad': True, 'face_limit': faces, 'bake': True,
    }))
    print('  output keys:', list(low['output'].keys()))
    download(url(low), f'minka-low{faces}.glb')
    step(state, key + '-rig', lambda: rig(state[key]))
    download(url(wait(state[key + '-rig'], 'rig')), f'minka-low{faces}-rigged.glb')
    walk = step(state, key + '-walk', lambda: task({
        'type': 'animate_retarget', 'original_model_task_id': state[key + '-rig'], 'animation': 'preset:quadruped:walk',
        'out_format': 'glb', 'bake_animation': True, 'export_with_geometry': True, 'animate_in_place': True,
    }))
    download(url(walk), f'minka-low{faces}-walk.glb')
    print('balance:', call('GET', '/user/balance'))

if __name__ == '__main__':
    main()
