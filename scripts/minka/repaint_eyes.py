#!/usr/bin/env python3
"""Repaints Minka's irises in her Tripo texture (2026-10-01, Stefanie: "too watery … not cat-like enough").
Gemini repaints only the iris of each eye crop, from her reference sheet; the result is pasted back strictly
inside the existing iris outline, so the eye keeps its exact place and fit on the model.
  python3 scripts/minka/repaint_eyes.py            → art/minka/eyes/eye<A|B>-new.png + preview
"""
import base64, io, json, pathlib, subprocess, urllib.request
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
EYES = ROOT / 'art/minka/eyes'
REFS = pathlib.Path('/Users/herzer/AI Reference Library/Sam & Minka/Minka')
PLIST = pathlib.Path.home() / 'Library/Containers/heART-Creative.AIMovieMaker/Data/Library/Preferences/heART-Creative.AIMovieMaker.plist'
CROPS = {'eyeA': (1554, 1870, 1782, 2122), 'eyeB': (18, 318, 178, 470)}   # left, top, right, bottom in the 4K texture

PROMPT = ('This is a close crop of a texture map for a 3D kitten character: one eye, flattened into the texture. '
          'Repaint ONLY the iris and the pupil. Keep everything else pixel-for-pixel: the dark eyelid rim, the '
          'surrounding fur, the outline, size and position of the iris. The iris: a kitten’s blue-gray iris like the '
          'reference kitten Minka, with fine radial fibers, a slightly darker outer ring at its edge and a lighter, '
          'warmer zone around the pupil, crisp and detailed. The pupil: a CAT pupil, a vertical oval, clearly taller '
          'than wide, centered, about as tall as the current pupil. No painted reflections, no highlights, no wet '
          'look — the shine comes from the 3D lighting later. Same framing, same image size, nothing added.')

def key():
    return subprocess.run(['/usr/libexec/PlistBuddy', '-c', 'Print :geminiAPIKey', str(PLIST)], capture_output=True, text=True, check=True).stdout.strip()

def b64(im: Image.Image, fmt='PNG'):
    b = io.BytesIO(); im.save(b, fmt); return base64.b64encode(b.getvalue()).decode()

def repaint(crop: Image.Image) -> Image.Image:
    side = max(crop.size)
    sq = Image.new('RGB', (side, side), (128, 110, 95)); sq.paste(crop, (0, 0))
    big = sq.resize((1024, 1024), Image.LANCZOS)
    parts = [{'text': PROMPT}, {'inline_data': {'mime_type': 'image/png', 'data': b64(big)}},
             {'inline_data': {'mime_type': 'image/jpeg', 'data': base64.b64encode((REFS / 'Minka - face front.jpg').read_bytes()).decode()}}]
    body = {'contents': [{'parts': parts}], 'generationConfig': {'responseModalities': ['TEXT', 'IMAGE'], 'imageConfig': {'aspectRatio': '1:1', 'imageSize': '1K'}}}
    req = urllib.request.Request('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent',
                                 data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'x-goog-api-key': key()})
    with urllib.request.urlopen(req, timeout=240) as r:
        data = json.load(r)
    for part in data['candidates'][0]['content']['parts']:
        inline = part.get('inlineData') or part.get('inline_data')
        if inline:
            out = Image.open(io.BytesIO(base64.b64decode(inline['data']))).convert('RGB').resize((side, side), Image.LANCZOS)
            return out.crop((0, 0) + crop.size)
    raise SystemExit('no image returned')

if __name__ == '__main__':
    tex = Image.open(next(EYES.glob('tex-Color_*.png'))).convert('RGB')
    for name, box in CROPS.items():
        crop = tex.crop(box); crop.save(EYES / f'{name}-crop.png')
        new = repaint(crop); new.save(EYES / f'{name}-new.png')
        print('wrote', name)
