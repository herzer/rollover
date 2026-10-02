#!/usr/bin/env python3
"""Generates one Minka pose with Gemini (the AI Movie Maker's model and key), from her reference sheet.

  python3 scripts/minka/gen.py <pose>            # pose names: see POSES
The key is read from the Movie Maker's preferences and never printed. Output: art/minka/raw/<pose>-<n>.png
"""
import base64, json, pathlib, subprocess, sys, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
REFS = pathlib.Path('/Users/herzer/AI Reference Library/Sam & Minka')
REF_FILES = [REFS / 'Minka/Minka - Default front.jpg', REFS / 'Minka/Minka - face front.jpg',
             REFS / 'Minka/Gray_Blue_Eyed_Fluffy_Pixar_Kitten.png']
# the cartoon look: Minka as she appears in the film itself (2026-10-01: "more cartoonish")
CARTOON_REFS = [REFS / 'Minka/Minka - Default front.jpg', REFS / 'Minka/Gray_Blue_Eyed_Fluffy_Pixar_Kitten.png']
MODEL = 'gemini-3-pro-image'
PLIST = pathlib.Path.home() / 'Library/Containers/heART-Creative.AIMovieMaker/Data/Library/Preferences/heART-Creative.AIMovieMaker.plist'

CHARACTER = ('Minka: a tiny, fluffy tabby kitten with large, prominent blue eyes and distinct striped fur — '
             'the EXACT same character as in the reference images: same coat pattern, the same forehead stripes, '
             'the same blue eyes, the same proportions.')
STYLE = ('A still from a 3D animated feature film: feature-film quality CG render, individually simulated soft fur '
         'with fine flyaway hairs and rim light catching the fur edges, subsurface glow in the ears, wet, detailed '
         'eyes with real reflections, soft cinematic studio lighting, shallow depth of field on nothing but the kitten. '
         'An original character — appealing, expressive, believable, not anime, not a cartoon drawing.')
FRAME = ('The whole kitten in frame including tail and paws, centered, with generous empty margin on every side. '
         'Plain seamless very light lilac-gray studio background, a soft contact shadow under the kitten, '
         'no props, no text, no border.')

CARTOON = ('A character from a 3D animated feature film (stylized, appealing, Pixar-like character design — '
           'but an ORIGINAL character): simplified, rounded shapes, a slightly oversized head, big expressive eyes '
           'with a real iris (not anime), soft groomed fur in gentle clumps rather than photographic strands, '
           'clean readable silhouette. Rendered like a film character model.')
# the input Tripo needs for image-to-3D and a four-legged auto-rig: neutral, symmetric, nothing hidden
RIG = ('EXACTLY ONE kitten in the image — a single animal, one head, one tail. Minka stands squarely on all four legs in a neutral rigging pose: legs straight and slightly apart, all four '
       'paws flat on the ground and fully visible, tail held out straight behind her and slightly up, head level, '
       'mouth closed, eyes open looking forward. Seen from a three-quarter front view, slightly from above, so the '
       'face, chest, one full side and the tail are all visible. Plain pure white background, even soft lighting '
       'with no strong shadows, no ground shadow, nothing overlapping the body, no props, no text.')

POSES = {
    'rigpose': None,
    'sit': 'Minka sits upright on her haunches, front paws together, body turned slightly three-quarters, '
           'looking up at the viewer with bright, curious eyes, ears forward, tail curled around her paws.',
}

def key():
    return subprocess.run(['/usr/libexec/PlistBuddy', '-c', 'Print :geminiAPIKey', str(PLIST)],
                          capture_output=True, text=True, check=True).stdout.strip()

def main(pose):
    if pose == 'rigpose':
        text, refs = f'{CHARACTER}\n\n{CARTOON}\n\n{RIG}', CARTOON_REFS
    else:
        text, refs = f'{CHARACTER}\n\n{POSES[pose]}\n\n{STYLE}\n\n{FRAME}', REF_FILES
    parts = [{'text': text}]
    for f in refs:
        mime = 'image/png' if f.suffix == '.png' else 'image/jpeg'
        parts.append({'inline_data': {'mime_type': mime, 'data': base64.b64encode(f.read_bytes()).decode()}})
    body = {'contents': [{'parts': parts}],
            'generationConfig': {'responseModalities': ['TEXT', 'IMAGE'], 'imageConfig': {'aspectRatio': '1:1', 'imageSize': '2K'}}}
    req = urllib.request.Request(f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent',
                                 data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'x-goog-api-key': key()})
    with urllib.request.urlopen(req, timeout=240) as r:
        data = json.load(r)
    out = ROOT / 'art/minka/raw'
    n = len(list(out.glob(f'{pose}-*.png'))) + 1
    for part in data['candidates'][0]['content']['parts']:
        inline = part.get('inlineData') or part.get('inline_data')
        if inline:
            p = out / f'{pose}-{n}.png'
            p.write_bytes(base64.b64decode(inline['data']))
            print('wrote', p.relative_to(ROOT))
        elif 'text' in part:
            print('model:', part['text'][:300])
    print('usage:', data.get('usageMetadata'))

if __name__ == '__main__':
    main(sys.argv[1])
