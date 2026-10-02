#!/usr/bin/env python3
"""Minka in full 3D, through Tripo: image → textured 3D model → four-legged auto-rig → walk animation.

  python3 scripts/minka/tripo.py [image]        # default: art/minka/raw/rigpose-2.png
  python3 scripts/minka/tripo.py --balance      # credits left, nothing spent

Uses the international API (api.tripo3d.ai/v2/openapi) — keys from platform.tripo3d.ai.
The key is read from $TRIPO_API_KEY or ~/.config/heartapps/tripo.key and never printed.
Each finished step is remembered in art/minka/3d/tasks.json, so a re-run resumes instead of paying twice.
Outputs: art/minka/3d/minka.glb (model), minka-rigged.glb, minka-walk.glb.
"""
import json, os, pathlib, sys, time, urllib.request, uuid

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'art/minka/3d'
BASE = 'https://api.tripo3d.ai/v2/openapi'   # the international API — platform.tripo3d.ai keys (the v3 docs host rejects them)
STATE = OUT / 'tasks.json'


def key() -> str:
    k = os.environ.get('TRIPO_API_KEY')
    if not k:
        f = pathlib.Path.home() / '.config/heartapps/tripo.key'
        if not f.exists():
            sys.exit('No Tripo key: put it in ~/.config/heartapps/tripo.key (or $TRIPO_API_KEY).')
        k = f.read_text().strip()
    return k


class TripoError(Exception):
    pass


def call(method: str, path: str, body=None, raw: bytes | None = None, ctype='application/json', soft=False):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={'Authorization': f'Bearer {key()}', 'Content-Type': ctype})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            out = json.load(r)
    except urllib.error.HTTPError as e:
        msg = f'{method} {path} → HTTP {e.code}: {e.read().decode()[:500]}'
        if soft:
            raise TripoError(msg)
        sys.exit(msg)
    if out.get('code') != 0:
        if soft:
            raise TripoError(f'{method} {path} → {out}')
        sys.exit(f'{method} {path} → {out}')
    return out['data']


def upload(path: pathlib.Path) -> str:
    boundary = uuid.uuid4().hex
    mime = 'image/png' if path.suffix == '.png' else 'image/jpeg'
    raw = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
           f'Content-Type: {mime}\r\n\r\n').encode() + path.read_bytes() + f'\r\n--{boundary}--\r\n'.encode()
    return call('POST', '/upload', raw=raw, ctype=f'multipart/form-data; boundary={boundary}')['image_token']


def task(body: dict, soft=False) -> str:
    return call('POST', '/task', body, soft=soft)['task_id']


def rig(model_task: str) -> str:
    # the four-legged rig needs a newer rig model; try the newest, then the one the SDK lists
    for version in ('v2.5-20260210', 'v2.0-20250506'):
        try:
            return task({'type': 'animate_rig', 'original_model_task_id': model_task, 'model_version': version,
                         'rig_type': 'quadruped', 'spec': 'tripo', 'out_format': 'glb'}, soft=True)
        except TripoError as e:
            print(f'  rig {version} refused: {e}')
    sys.exit('No rig model accepted a quadruped rig.')


def url(t: dict) -> str:
    o = t['output']
    return o.get('pbr_model') or o.get('model') or o.get('pbr_model_url') or o.get('model_url')


def wait(task_id: str, label: str) -> dict:
    while True:
        t = call('GET', f'/task/{task_id}')
        print(f'  {label}: {t["status"]} {t.get("progress", 0)}%', end='\r', flush=True)
        if t['status'] == 'success':
            print(f'  {label}: done — {t.get("credits_consumed", "?")} credits        ')
            return t
        if t['status'] in ('failed', 'cancelled', 'banned', 'expired'):
            sys.exit(f'\n{label} {t["status"]}: {t}')
        time.sleep(4)


def download(url: str, name: str):
    p = OUT / name
    with urllib.request.urlopen(url, timeout=300) as r:
        p.write_bytes(r.read())
    print('  wrote', p.relative_to(ROOT), f'({p.stat().st_size // 1024} KB)')


def step(state: dict, name: str, make) -> dict:
    """Run a task once; a re-run reuses the finished one."""
    if name not in state:
        state[name] = make()
        STATE.write_text(json.dumps(state, indent=2))
    return wait(state[name], name)


def main():
    if '--balance' in sys.argv:
        print(call('GET', '/user/balance'))
        return
    OUT.mkdir(parents=True, exist_ok=True)
    image = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'art/minka/raw/rigpose-2.png'
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    print('balance:', call('GET', '/user/balance'))

    model = step(state, 'model', lambda: task({
        'type': 'image_to_model', 'model_version': 'v3.1-20260211',
        'file': {'type': 'png' if image.suffix == '.png' else 'jpg', 'file_token': upload(image)},
        'texture': True, 'pbr': True, 'texture_quality': 'detailed',
        'geometry_quality': 'detailed',
        'face_limit': 40000,                     # web/mobile range in Tripo's guidance
        'texture_alignment': 'original_image',
    }))
    download(url(model), 'minka.glb')
    preview = model['output'].get('rendered_image') or model['output'].get('rendered_image_url')
    if preview:
        download(preview, 'minka-preview.webp')

    check = step(state, 'rig-check', lambda: task({'type': 'animate_prerigcheck', 'original_model_task_id': state['model']}))
    print('  rig check:', check.get('output'))

    download(url(step(state, 'rig', lambda: rig(state['model']))), 'minka-rigged.glb')

    walk = step(state, 'walk', lambda: task({
        'type': 'animate_retarget', 'original_model_task_id': state['rig'], 'animation': 'preset:quadruped:walk',
        'out_format': 'glb', 'bake_animation': True, 'export_with_geometry': True, 'animate_in_place': True,
    }))
    download(url(walk), 'minka-walk.glb')
    print('balance:', call('GET', '/user/balance'))


if __name__ == '__main__':
    main()
