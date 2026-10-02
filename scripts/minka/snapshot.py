#!/usr/bin/env python3
"""Keeps every Minka version (Stefanie, 2026-10-02: "keep the versions at least for a few iterations, and definitely
whenever we make major decisions — it's too much work to recreate these").

Copies a model and what belongs to it into art/minka/versions/<date>-<id>/ and records it in
art/minka/versions/index.json, which the preview's Version menu reads (?lab=minka).

   python3 scripts/minka/snapshot.py <id> <model.glb> [--blend f.blend] [--preview img] [--script build.py]
          [--title "…"] [--notes "…"] [--date 2026-10-02] [--current]

--current makes it the version the preview opens by default. Nothing is ever overwritten: an existing folder stops it."""
import argparse, datetime, json, pathlib, shutil, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
VERS = ROOT / 'art/minka/versions'

ap = argparse.ArgumentParser()
ap.add_argument('id'); ap.add_argument('model')
ap.add_argument('--blend'); ap.add_argument('--preview', action='append', default=[]); ap.add_argument('--script', action='append', default=[])
ap.add_argument('--title', default=''); ap.add_argument('--notes', default='')
ap.add_argument('--date', default=datetime.date.today().isoformat()); ap.add_argument('--current', action='store_true')
a = ap.parse_args()

folder = VERS / f'{a.date}-{a.id}'
if folder.exists(): sys.exit(f'{folder} exists already: versions are never overwritten')
folder.mkdir(parents=True)
rel = lambda p: str(p.relative_to(ROOT))
entry = {'id': f'{a.date}-{a.id}', 'date': a.date, 'title': a.title or a.id, 'notes': a.notes}
m = folder / pathlib.Path(a.model).name; shutil.copy2(ROOT / a.model, m); entry['model'] = rel(m)
if a.blend: b = folder / pathlib.Path(a.blend).name; shutil.copy2(ROOT / a.blend, b); entry['blend'] = rel(b)
entry['previews'] = []
for p in a.preview: d = folder / pathlib.Path(p).name; shutil.copy2(ROOT / p, d); entry['previews'].append(rel(d))
entry['scripts'] = []
for p in a.script: d = folder / pathlib.Path(p).name; shutil.copy2(ROOT / p, d); entry['scripts'].append(rel(d))

idx_file = VERS / 'index.json'
idx = json.loads(idx_file.read_text()) if idx_file.exists() else {'current': None, 'versions': []}
idx['versions'].append(entry)
if a.current or not idx['current']: idx['current'] = entry['id']
idx_file.write_text(json.dumps(idx, indent=1))
print('kept', entry['id'], '→', rel(folder), '(current)' if idx['current'] == entry['id'] else '')
