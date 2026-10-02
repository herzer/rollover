#!/usr/bin/env python3
"""An original iris texture for Minka's eyeballs (Stefanie, 2026-10-01: "the texture is really not that great …
blue cat eyes like this"): Gemini paints a flat, front-on texture from her film close-up's look. Writes
art/minka/eyes/iris-gen-<n>.png."""
import base64, json, pathlib, subprocess, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[2]
PLIST = pathlib.Path.home() / 'Library/Containers/heART-Creative.AIMovieMaker/Data/Library/Preferences/heART-Creative.AIMovieMaker.plist'
key = subprocess.run(['/usr/libexec/PlistBuddy', '-c', 'Print :geminiAPIKey', str(PLIST)], capture_output=True, text=True, check=True).stdout.strip()
PROMPT = ('A texture map for a 3D animated character\'s eye: ONE kitten iris seen perfectly head-on, flat, centred, '
          'filling the square image edge to edge. A large, perfectly round black pupil in the exact centre, about 55% '
          'of the iris diameter (a kitten at night, pupil wide open). The iris: soft blue-gray like the reference '
          'kitten\'s eyes, with very fine radial fibers and crypts, a slightly lighter, warmer ring right around the '
          'pupil, a darker blue-gray outer zone, and a crisp dark limbal ring at the edge. Outside the iris circle: '
          'solid very dark blue-black. Photoreal, high detail, evenly lit — NO reflections, NO highlights, NO '
          'catchlights, no eyelids, no fur, no text.')
ref = ROOT / 'art/minka/eyes/film-eyes-reference.webp'
parts = [{'text': PROMPT}]
if ref.exists():
    from PIL import Image; import io
    b = io.BytesIO(); Image.open(ref).convert('RGB').save(b, 'JPEG', quality=92)
    parts.append({'inline_data': {'mime_type': 'image/jpeg', 'data': base64.b64encode(b.getvalue()).decode()}})
body = {'contents': [{'parts': parts}], 'generationConfig': {'responseModalities': ['TEXT', 'IMAGE'], 'imageConfig': {'aspectRatio': '1:1', 'imageSize': '1K'}}}
req = urllib.request.Request('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent',
                             data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'x-goog-api-key': key})
with urllib.request.urlopen(req, timeout=240) as r: data = json.load(r)
out = ROOT / 'art/minka/eyes'
n = len(list(out.glob('iris-gen-*.png'))) + 1
for part in data['candidates'][0]['content']['parts']:
    inline = part.get('inlineData') or part.get('inline_data')
    if inline:
        (out / f'iris-gen-{n}.png').write_bytes(base64.b64decode(inline['data'])); print('wrote', f'iris-gen-{n}.png')
