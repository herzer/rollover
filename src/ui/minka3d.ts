// Minka in full 3D (2026-10-01): the Tripo model — image → textured mesh → four-legged rig → walk.
// Dev viewer for now: ?lab=minka3d (drag to turn her, scroll to zoom).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { addFur, furDebug, TRIPO_FRAME, type FurFrame, type FurMask } from './fur';
import { addCatchlights, addCornea, addEyes, addToonCatchlights, eyeLook } from './eyes';

export const FUR_MASK_FILE = 'art/minka/3d/fur-mask.json';
/** Painted fur corrections are per model (they name its vertices): the Tripo Minka's file, or one beside the model. */
export const furMaskFile = (file: string) => /art\/minka\/3d\/minka(-rig|-walk|-high)?\.glb$/.test(file) ? FUR_MASK_FILE : file.replace(/\.glb$/, '-fur-mask.json');

export async function minkaViewer(host: HTMLElement, file = 'art/minka/3d/minka-walk.glb', fur = true, furLength?: number) {
  const W = host.clientWidth, H = host.clientHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W, H);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;
  const key = new THREE.DirectionalLight('#fff1dc', 2.4);
  key.position.set(2, 4, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 6;
  scene.add(key);
  const rim = new THREE.DirectionalLight('#d6e4ff', 2.2);
  rim.position.set(-3, 2.5, -3);
  scene.add(rim);

  const gltf = await new GLTFLoader().loadAsync(file);
  const minka = gltf.scene;
  minka.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // stand her on the floor, centered, about one unit tall
  const box = new THREE.Box3().setFromObject(minka);
  const size = box.getSize(new THREE.Vector3());
  const s = 1 / size.y;
  minka.scale.setScalar(s);
  const b2 = new THREE.Box3().setFromObject(minka);
  minka.position.sub(new THREE.Vector3((b2.min.x + b2.max.x) / 2, b2.min.y, (b2.min.z + b2.max.z) / 2));
  scene.add(minka);

  let furGroup: THREE.Group | null = null, body: THREE.SkinnedMesh | null = null;
  let mask: FurMask | null = null;
  try { const r = await fetch(furMaskFile(file), { cache: 'no-store' }); if (r.ok) mask = await r.json(); } catch { /* no painted corrections yet */ }
  // the body is the biggest skinned mesh; a separate whisker mesh (split in Blender: scripts/blender/split_whiskers.py) gets no fur
  minka.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh && (!body || m.geometry.attributes.position.count > body.geometry.attributes.position.count)) body = m;
  });
  // her own whisker mesh and eyeballs (built in Blender) mean the fur needs no guessing about either
  const realParts = !!minka.getObjectByName('MinkaWhiskers') || !!minka.getObjectByName('MinkaEye0') || !!minka.getObjectByName('MinkaEye.0');
  // every Minka is furry now (Stefanie, 2026-10-02: "change it to be furry"); &fur=0 shows the bare model
  // a Minka on the Toon Cats skeleton (minka-toon, minka-v2) faces +z, with eyes on their own bones
  const toonRig = !!minka.getObjectByName('Eye_L');
  const frame: FurFrame = toonRig ? { fwd: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) } : TRIPO_FRAME;
  const eyePts: THREE.Vector3[] = [];
  minka.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !Array.isArray(m.material) && /Eyes/.test(m.material.name)) {
      const p = m.geometry.attributes.position;
      for (let i = 0; i < p.count; i += 2) eyePts.push(new THREE.Vector3().fromBufferAttribute(p, i));
    }
  });
  // the toon-rig Minka's coat read shaggy at the Tripo length
  const len = furLength ?? (toonRig ? 0.022 : undefined);
  if (fur && body) furGroup = addFur(body, len ? { length: len } : {}, mask, realParts, frame, eyePts);
  const eyes = body && new URLSearchParams(location.search).get('eyes') === 'drawn' ? addEyes(body) : null;   // drawn iris: opt-in, rejected 2026-10-01
  const cornea = body && !realParts && !toonRig && new URLSearchParams(location.search).get('cornea') !== '0' ? addCornea(body) : null;
  const catchlights = toonRig ? addToonCatchlights(minka) : realParts ? addCatchlights(minka) : [];

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.ShadowMaterial({ opacity: 0.22 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const camera = new THREE.PerspectiveCamera(30, W / H, 0.01, 50);
  camera.position.set(1.6, 0.9, 2.2);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.45, 0);
  controls.update();

  new ResizeObserver(() => {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }).observe(host);

  // her standing pose as the file has it, before any animation touches a bone
  const standing: [THREE.Object3D, THREE.Vector3, THREE.Quaternion, THREE.Vector3][] = [];
  minka.traverse((o) => { if ((o as THREE.Bone).isBone) standing.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]); });

  const mixer = new THREE.AnimationMixer(minka);
  const clips = gltf.animations;
  if (clips[0] && !toonRig) mixer.clipAction(clips[0]).play();   // a toon-rig model has many: the preview picks
  const clock = new THREE.Clock();
  const onFrame: ((dt: number) => void)[] = [];
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    mixer.update(dt);
    for (const f of onFrame) f(dt);
    renderer.render(scene, camera);
  });

  const bones: string[] = [];
  minka.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o.name); });
  return { file, renderer, scene, camera, controls, mixer, animations: clips, standing, onFrame, model: minka, furDebug, eyes, cornea, catchlights, eyeLook, body: body as THREE.SkinnedMesh | null, mask, get fur() { return furGroup; }, clips: clips.map((c) => `${c.name} ${c.duration.toFixed(2)}s`), bones, size: size.toArray() };
}
