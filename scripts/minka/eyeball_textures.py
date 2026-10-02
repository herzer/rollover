#!/usr/bin/env python3
"""Cuts each iris (with Tripo's big pupil and the enhanced fibers) out of Minka's eye-enhanced texture into
its own square eyeball texture: art/minka/eyes/eyeball-<n>.png, plus eyeballs.json with the iris boxes
(texture pixels, image y down) the Blender script uses to find each eye. Outside the iris: the dark ring
that frames a cat's iris, so whatever the lids reveal reads as eye."""
import json, math, pathlib, sys
from PIL import Image, ImageDraw, ImageFilter
EYES = pathlib.Path(__file__).resolve().parents[2] / 'art/minka/eyes'
sys.argv = [sys.argv[0]]
src = Image.open(EYES / 'low-color-eyes.png').convert('RGB')
# The optimized model's re-baked irises are smeared across seams; the high-poly texture's are clean and round.
# Eye n in the optimized atlas takes its look from the high-poly iris HIGH[n].
high = Image.open(EYES / 'Color-new.png').convert('RGB')
HIGH = [(1624, 1852, 1804, 2056), (88, 248, 252, 404)]
# the same blob finder the eye script uses
spec = __import__('importlib.util').util.spec_from_file_location('ee', pathlib.Path(__file__).parent / 'enhance_eyes.py')
boxes = []
S = 1024; k = src.width / S
px = src.resize((S, S)).load()
blue = {(x, y) for y in range(S) for x in range(S) if px[x, y][2] > px[x, y][0] + 25 and px[x, y][2] > px[x, y][1] + 8}
# the enhanced iris is gray-blue now, so also accept cool, dark-ish pixels inside the original boxes
orig = json.loads((EYES / 'iris-boxes.json').read_text()) if (EYES / 'iris-boxes.json').exists() else None
if orig is None:
    raise SystemExit('run enhance first: iris-boxes.json missing')
out = []
for n, (x0, y0, x1, y1) in enumerate(orig):
    hx0, hy0, hx1, hy1 = HIGH[n]
    cx, cy, r = (hx0 + hx1) / 2, (hy0 + hy1) / 2, max(hx1 - hx0, hy1 - hy0) / 2
    R = int(r * 1.12)
    crop = high.crop((int(cx - R), int(cy - R), int(cx + R), int(cy + R))).resize((512, 512), Image.LANCZOS)
    mask = Image.new('L', (512, 512), 0)
    m = 512 / (2 * R) * r
    ImageDraw.Draw(mask).ellipse((256 - m, 256 - m, 256 + m, 256 + m), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(3))
    ring = Image.new('RGB', (512, 512), (26, 31, 38))
    eye = Image.composite(crop, ring, mask)
    eye.save(EYES / f'eyeball-{n}.png')
    out.append({'box': [x0, y0, x1, y1], 'texture': f'art/minka/eyes/eyeball-{n}.png', 'crop_half': R, 'iris_r': r})
    print('eyeball', n, 'iris box', (x0, y0, x1, y1))
(EYES / 'eyeballs.json').write_text(json.dumps(out, indent=1))
