// Minka preview (dev, 2026-10-01): turn around her and watch her as she will render in the game — the
// game's lilac page and lavender felt under her, its lights, fur, whiskers and glossy eyes. ?lab=minka3d&preview

import * as THREE from 'three';
import { CatWalk } from './catwalk';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface Viewer {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
  mixer: THREE.AnimationMixer; clips: string[];
  standing: [THREE.Object3D, THREE.Vector3, THREE.Quaternion, THREE.Vector3][];
  onFrame: ((dt: number) => void)[]; model: THREE.Object3D;
}

export function installPreview(host: HTMLElement, v: Viewer, clips: THREE.AnimationClip[],
  versions: { id: string; date?: string; title: string; model: string }[] = [], file = '') {
  // the game's surroundings: lilac page behind, lavender felt under her (pal-lilac --felt1 / --felt2)
  host.style.background = 'radial-gradient(120% 90% at 50% 20%, #f6f2fa 0%, #e9e1f4 60%, #ddd2ee 100%)';
  const felt = new THREE.Mesh(new THREE.CircleGeometry(1.6, 96), new THREE.MeshStandardMaterial({ color: '#b9a8de', roughness: 1 }));
  felt.rotation.x = -Math.PI / 2; felt.position.y = -0.001;   // her shadow comes from the shadow plane above it
  v.scene.add(felt);
  v.controls.enableDamping = true;
  v.controls.autoRotateSpeed = 1.2;
  v.controls.minDistance = 0.35; v.controls.maxDistance = 6;
  v.controls.target.set(0, 0.5, 0); v.camera.position.set(2.1, 1.15, 2.8); v.controls.update();

  const standing = v.standing;
  const actions = clips.map((c) => v.mixer.clipAction(c));
  let walking = false, turning = false;
  // her own skeleton has no baked clip: the walk is made in code (catwalk.ts)
  const cat = clips.length ? null : new CatWalk(v.model);
  if (cat?.ok) { v.onFrame.push((dt) => cat.update(dt)); walking = false; (window as unknown as { catwalk: CatWalk }).catwalk = cat; }
  // a model with its own animations (the toon Minka): play one clip at a time, fading between them
  const byName = (part: string) => actions.find((a) => a.getClip().name.toLowerCase().includes(part));
  let current: THREE.AnimationAction | null = null;
  const play = (a: THREE.AnimationAction | null | undefined) => {
    if (!a || a === current) return;
    a.reset().setEffectiveWeight(1).play();
    if (current) current.crossFadeTo(a, 0.35, false);
    current = a;
  };
  const idle = byName('idle_01') ?? byName('idle');
  let panel: HTMLDivElement | null = null;
  const setWalk = (on: boolean) => {
    walking = on;
    if (cat?.ok) { cat.walking = on; return; }
    v.mixer.timeScale = 1;
    if (actions.length) {
      play(on ? byName('walk') : idle);
      const sel = panel?.querySelector('.mk-anim') as HTMLSelectElement | null;
      if (sel) sel.value = on ? 'walk' : 'idle_01';
      return;
    }
    // standing still means the pose she loaded in, not frozen mid-step
    if (!on) for (const [b, p, q, sc] of standing) { b.position.copy(p); b.quaternion.copy(q); b.scale.copy(sc); }
  };
  setWalk(false);   // she starts standing (idle, when she has one)

  panel = document.createElement('div');
  panel.className = 'mk-preview';
  panel.innerHTML = `
    <b class="mk-title">Minka</b>
    <button type="button" class="btn sm" data-act="turn" title="Slowly turn the view around her; drag still turns it by hand">Turntable</button>
    <button type="button" class="btn sm" data-act="walk" title="Play her walk in place; press again to go back to her idle">Walk</button>
    <button type="button" class="btn sm" data-act="face" title="Move in close to her face and eyes">Face</button>
    <button type="button" class="btn sm" data-act="reset" title="Back to the whole kitten, from the front-right">Whole kitten</button>
    ${versions.length ? `<select class="mk-version" title="Open another kept version of her (art/minka/versions)">${versions.some((x) => x.model === file) ? '' : `<option value="${file}" selected>${file.split('/').pop()} (not kept)</option>`}${versions.map((x) => `<option value="${x.model}"${x.model === file ? ' selected' : ''}>${x.date ?? ''} ${x.title}</option>`).join('')}</select>` : ''}
    ${clips.length ? `<select class="mk-anim" title="Play one of her animations">${clips.map((c) => `<option${/idle_01$/.test(c.name) ? ' selected' : ''}>${c.name.replace(/^AS_StylizedCat_/, '')}</option>`).join('')}</select>` : ''}
`;
  host.title = 'Drag to turn her · scroll or pinch to zoom · right-drag to move';
  host.appendChild(panel);
  const style = document.createElement('style');
  style.textContent = `
    .mk-preview { position: absolute; left: 12px; top: 12px; display: flex; gap: 6px; align-items: center;
      flex-wrap: wrap; padding: 8px 10px; background: rgba(255,255,255,.9); border: 1px solid #e5dcef;
      border-radius: 14px; box-shadow: 0 8px 24px rgba(70,50,110,.14); max-width: calc(100% - 32px); }
    .mk-preview .mk-title { font: 800 15px/1 "Baloo 2", "Nunito", sans-serif; color: #2b2d42; margin-right: 4px; }
    .mk-preview .btn[aria-pressed="true"] { background: var(--accent, #7a55d9); border-color: var(--accent, #7a55d9); color: #fff; }
    .mk-preview .mk-hint { font-size: 12px; color: #6e6a62; }
    .mk-preview .mk-version { height: var(--control-h-sm, 30px); border: 1.5px solid #e5dcef; border-radius: 10px; padding: 0 8px; font: 600 13px "Nunito", sans-serif; background: #fff; max-width: 280px; }
    .mk-preview .mk-anim { height: var(--control-h-sm, 30px); border: 1.5px solid #e5dcef; border-radius: 10px; padding: 0 8px; font: 600 13px "Nunito", sans-serif; background: #fff; }`;
  document.head.appendChild(style);
  const press = () => {
    panel.querySelector('[data-act="turn"]')!.setAttribute('aria-pressed', String(turning));
    panel.querySelector('[data-act="walk"]')!.setAttribute('aria-pressed', String(walking));
  };
  const fly = (pos: THREE.Vector3, at: THREE.Vector3) => {
    v.controls.target.copy(at); v.camera.position.copy(pos); v.controls.update();
  };
  // where her face is and which way it looks, read from the skeleton (models face different ways): the eyes'
  // midpoint, and the direction from the head bone to it, kept level
  const face = () => {
    v.model.updateMatrixWorld(true);
    const at = (n: string) => v.model.getObjectByName(n)?.getWorldPosition(new THREE.Vector3());
    const eyes = [at('Eye_L'), at('Eye_R')].filter(Boolean) as THREE.Vector3[];
    const head = at('Head') ?? at('head');
    if (eyes.length < 2 || !head) return null;
    const mid = eyes[0].clone().add(eyes[1]).multiplyScalar(0.5);
    const fwd = mid.clone().sub(head).setY(0).normalize();
    return { mid, fwd };
  };
  const front = face()?.fwd ?? new THREE.Vector3(1, 0, 0);   // the old models face +x
  const right = new THREE.Vector3().crossVectors(front, new THREE.Vector3(0, 1, 0));
  const wholeKitten = () => fly(front.clone().multiplyScalar(2.6).addScaledVector(right, 2.2).setY(1.15), new THREE.Vector3(0, 0.5, 0));
  const closeUp = () => {
    const f = face();
    if (!f) return fly(new THREE.Vector3(1.12, 0.74, 0.48), new THREE.Vector3(0.34, 0.64, 0));
    fly(f.mid.clone().addScaledVector(f.fwd, 0.95).addScaledVector(right, 0.35).add(new THREE.Vector3(0, 0.08, 0)), f.mid);
  };
  wholeKitten();
  panel.querySelector('.mk-version')?.addEventListener('change', (e) => {
    const q = new URLSearchParams(location.search); q.set('file', (e.target as HTMLSelectElement).value);
    location.search = q.toString();
  });
  panel.querySelector('.mk-anim')?.addEventListener('change', (e) => {
    const name = (e.target as HTMLSelectElement).value;
    play(actions.find((a) => a.getClip().name.endsWith(name)));
    walking = name.includes('walk'); press();
  });
  panel.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b) return;
    if (b.dataset.act === 'turn') { turning = !turning; v.controls.autoRotate = turning; }
    if (b.dataset.act === 'walk') setWalk(!walking);
    if (b.dataset.act === 'face') closeUp();
    if (b.dataset.act === 'reset') wholeKitten();
    press();
  });
  press();
  // damping and the turntable need the controls updated every frame
  const tick = () => { v.controls.update(); requestAnimationFrame(tick); };
  tick();
}
