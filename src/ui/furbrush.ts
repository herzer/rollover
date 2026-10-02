// The fur brush (dev only, 2026-10-01): paint where Minka's fur grows, by hand, on top of the automatic rules.
// Modes: Turn (drag turns her), Erase fur, Restore fur. Strokes undo one at a time; Save writes
// the model's fur-mask file (furMaskFile) through the dev server, which the game loads with her model.
// Why it exists: the guard hairs inside her ears sit right beside ordinary coat, and no automatic rule
// separated the two without leaving bald patches (Stefanie: "patches of fur missing around the ears").

import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { applyFurMask, furDebug, type FurMask } from './fur';
import { furMaskFile } from './minka3d';

type Mode = 'turn' | 'erase' | 'restore';

export function installFurBrush(opts: {
  host: HTMLElement; canvas: HTMLCanvasElement; camera: THREE.Camera; controls: OrbitControls;
  body: THREE.SkinnedMesh; mask: FurMask | null; file: string;
}) {
  const FUR_MASK_FILE = furMaskFile(opts.file);
  const { host, canvas, camera, controls, body } = opts;
  const geo = body.geometry, pos = geo.attributes.position, n = pos.count;
  const erase = new Set(opts.mask?.vertexCount === n ? opts.mask.erase : []);
  const restore = new Set(opts.mask?.vertexCount === n ? opts.mask.restore : []);
  const undo: string[] = [];
  let mode: Mode = 'turn', radius = 0.012, dirty = false;

  const current = (): FurMask => ({ vertexCount: n, erase: [...erase].sort((a, b) => a - b), restore: [...restore].sort((a, b) => a - b) });
  const apply = () => applyFurMask(geo, current());

  const panel = document.createElement('div');
  panel.className = 'furbrush';
  panel.innerHTML = `
    <div class="fb-row" role="group" aria-label="Brush mode">
      <button type="button" class="btn sm" data-mode="turn" title="Drag turns Minka; scroll zooms. The fur is not touched.">Turn</button>
      <button type="button" class="btn sm" data-mode="erase" title="Drag over her to remove fur there — for whisker-like hairs that must stay bare">Erase fur</button>
      <button type="button" class="btn sm" data-mode="restore" title="Drag over her to give fur back where a rule or an earlier stroke removed it">Restore fur</button>
    </div>
    <div class="fb-row">
      <span class="fb-label">Brush</span>
      <span class="fb-step" title="Brush size — scroll over it or use − and +">
        <button type="button" data-size="-1" title="Smaller brush">−</button><i data-ref="size"></i><button type="button" data-size="1" title="Larger brush">+</button>
      </span>
      <button type="button" class="btn sm" data-act="loud" title="Paint the fur loud magenta to see exactly where it grows (and where it doesn't)">Loud colors</button>
    </div>
    <div class="fb-row">
      <button type="button" class="btn sm" data-act="undo" title="Take back the last stroke">Undo</button>
      <button type="button" class="btn sm primary" data-act="save" title="Save the painted fur to ${FUR_MASK_FILE}; the game loads it with her model">Save fur</button>
      <span class="fb-said" data-ref="said" role="status"></span>
    </div>`;
  host.appendChild(panel);
  const style = document.createElement('style');
  style.textContent = `
    .furbrush { position: absolute; left: 16px; top: 16px; display: flex; flex-direction: column; gap: 8px; padding: 12px;
      background: rgba(255,255,255,.92); border: 1px solid var(--line, #e5dcef); border-radius: 12px; box-shadow: 0 6px 20px rgba(60,40,90,.12); }
    .furbrush .fb-row { display: flex; gap: 6px; align-items: center; }
    .furbrush .btn[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
    .furbrush .fb-label { font-size: 12px; color: var(--soft, #6e6a62); }
    .furbrush .fb-step { display: inline-flex; align-items: center; height: var(--control-h-sm, 30px); border: 1.5px solid var(--line, #e5dcef);
      border-radius: 10px; background: #fff; }
    .furbrush .fb-step button { width: 28px; height: 100%; border: 0; background: none; font: 700 15px/1 inherit; cursor: pointer; }
    .furbrush .fb-step i { min-width: 44px; text-align: center; font-size: 12.5px; border-inline: 1px solid var(--line, #e5dcef); }
    .furbrush .fb-said { font-size: 12px; color: var(--soft, #6e6a62); }
    .fb-cursor { position: absolute; pointer-events: none; border: 2px solid var(--accent, #7a55d9); border-radius: 50%; transform: translate(-50%, -50%); display: none; }`;
  document.head.appendChild(style);
  const cursor = document.createElement('div');
  cursor.className = 'fb-cursor';
  host.appendChild(cursor);

  const $ = (sel: string) => panel.querySelector(sel) as HTMLElement;
  const said = (t: string) => { $('[data-ref="said"]').textContent = t; };
  const paintMode = () => {
    panel.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    controls.enabled = mode === 'turn';
    canvas.style.cursor = mode === 'turn' ? '' : 'crosshair';
    $('[data-ref="size"]').textContent = `${Math.round(radius * 1000)}`;
  };
  panel.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b) return;
    if (b.dataset.mode) mode = b.dataset.mode as Mode;
    if (b.dataset.size) radius = Math.min(0.06, Math.max(0.003, radius + Number(b.dataset.size) * 0.003));
    if (b.dataset.act === 'loud') { furDebug.value = furDebug.value ? 0 : 1; b.setAttribute('aria-pressed', String(!!furDebug.value)); }
    if (b.dataset.act === 'undo') {
      const prev = undo.pop();
      if (prev) { const m = JSON.parse(prev) as FurMask; erase.clear(); restore.clear(); m.erase.forEach((i) => erase.add(i)); m.restore.forEach((i) => restore.add(i)); apply(); dirty = true; said('Took back one stroke.'); }
      else said('Nothing to take back.');
    }
    if (b.dataset.act === 'save') {
      try {
        const r = await fetch('/__dev/save?path=' + encodeURIComponent(FUR_MASK_FILE), { method: 'POST', body: JSON.stringify(current()) });
        if (!r.ok) throw new Error(await r.text());
        dirty = false; said(`Saved ${erase.size} bare and ${restore.size} restored points.`);
      } catch (err) { said('Saving did not go through: ' + (err as Error).message); }
    }
    paintMode();
  });
  $('.fb-step').addEventListener('wheel', (e) => { e.preventDefault(); radius = Math.min(0.06, Math.max(0.003, radius + ((e as WheelEvent).deltaY < 0 ? 0.001 : -0.001))); paintMode(); }, { passive: false });

  // painting
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), local = new THREE.Vector3(), v = new THREE.Vector3();
  let painting = false;
  const hit = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObject(body, false)[0] ?? null;
  };
  const stroke = (e: PointerEvent) => {
    const h = hit(e);
    if (!h) return;
    local.copy(h.point); body.worldToLocal(local);
    const r2 = radius * radius;
    for (let i = 0; i < n; i++) {
      if (v.fromBufferAttribute(pos, i).distanceToSquared(local) > r2) continue;
      if (mode === 'erase') { erase.add(i); restore.delete(i); } else { restore.add(i); erase.delete(i); }
    }
    apply(); dirty = true;
  };
  const moveCursor = (e: PointerEvent) => {
    if (mode === 'turn') { cursor.style.display = 'none'; return; }
    const h = hit(e);
    if (!h) { cursor.style.display = 'none'; return; }
    // the brush's size on screen, from the distance to the point under it
    const r = canvas.getBoundingClientRect();
    const a = h.point.clone().project(camera);
    const side = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(radius * body.getWorldScale(new THREE.Vector3()).x);
    const b = h.point.clone().add(side).project(camera);
    const px = Math.abs(b.x - a.x) * r.width / 2 * 2;
    cursor.style.display = 'block';
    cursor.style.left = `${e.clientX - host.getBoundingClientRect().left}px`;
    cursor.style.top = `${e.clientY - host.getBoundingClientRect().top}px`;
    cursor.style.width = cursor.style.height = `${Math.max(6, px)}px`;
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (mode === 'turn' || e.button !== 0) return;
    undo.push(JSON.stringify(current()));
    painting = true; canvas.setPointerCapture(e.pointerId); stroke(e);
  });
  canvas.addEventListener('pointermove', (e) => { moveCursor(e); if (painting) stroke(e); });
  canvas.addEventListener('pointerup', () => { if (painting) { painting = false; said(dirty ? 'Not saved yet.' : ''); } });
  addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
  paintMode();

  /** For scripted touch-ups: paint at a point given in the model's own coordinates. */
  return {
    paintAt(p: [number, number, number], r: number, how: 'erase' | 'restore') {
      undo.push(JSON.stringify(current()));
      const c = new THREE.Vector3(...p);
      for (let i = 0; i < n; i++) {
        if (v.fromBufferAttribute(pos, i).distanceToSquared(c) > r * r) continue;
        if (how === 'erase') { erase.add(i); restore.delete(i); } else { restore.add(i); erase.delete(i); }
      }
      apply(); dirty = true;
    },
    /** The model-space point under a screen position (-1..1 both ways), or null. */
    pick(x: number, y: number): { p: [number, number, number]; uv: [number, number] } | null {
      ndc.set(x, y); ray.setFromCamera(ndc, camera);
      const h = ray.intersectObject(body, false)[0];
      if (!h) return null;
      const l = body.worldToLocal(h.point.clone());
      return { p: [l.x, l.y, l.z], uv: h.uv ? [h.uv.x, h.uv.y] : [0, 0] };
    },
    save: () => (panel.querySelector('[data-act="save"]') as HTMLButtonElement).click(),
    get mask() { return current(); },
  };
}
