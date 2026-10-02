// Minka in the game (2026-10-02, Stefanie: "put Minka into the game"). She takes the kitten's place on the corner of
// the rack and its reactions, played with her own animations: idles while it is your turn (a different one now and
// then), her sleep clip while others play, a hop for a good meld, a playful pounce for a rollover run, jumps for a win,
// a calm moment (with purring and hearts, from kitty.ts) when petted. Her coat is shell fur, her eyes catch the light.
// The model is a kept version published with scripts/blender/export_game_minka.py → public/minka/minka.glb.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { addFur } from './fur';
import { addToonCatchlights } from './eyes';

const MODEL = 'minka/minka.glb';
const IDLES = ['idle_01', 'idle_02', 'idle_03', 'idle_04', 'idle_06'];
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

export class MinkaCat {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(26, 1, 0.05, 20);
  private mixer!: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private awake = true;
  private busy = false;                 // a one-off reaction is playing
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private clock = new THREE.Clock();

  /** Builds her into `host` (the kitten's button). Resolves null when 3D is not available, so the kitten stays. */
  static async create(host: HTMLElement): Promise<MinkaCat | null> {
    try {
      const cat = new MinkaCat(host);
      await cat.load();
      return cat;
    } catch (e) {
      console.warn('Minka could not load; the drawn kitten stays', e);
      return null;
    }
  }

  private constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'k-3d';
    this.scene.environment = new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.6;
    const key = new THREE.DirectionalLight('#fff1dc', 2.4);
    key.position.set(2, 4, 3); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 5;
    const rim = new THREE.DirectionalLight('#d6e4ff', 2.0);
    rim.position.set(-3, 2.5, -3);
    this.scene.add(key, rim);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.ShadowMaterial({ opacity: 0.2 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    this.scene.add(ground);
    // a three-quarter view from the player's side, as if she sat at the corner of the rack facing you
    this.camera.position.set(1.15, 1.05, 2.9);
    this.camera.lookAt(0, 0.46, 0);
  }

  private async load() {
    const gltf = await new GLTFLoader().loadAsync(MODEL);
    const cat = gltf.scene;
    cat.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const box = new THREE.Box3().setFromObject(cat);
    cat.scale.setScalar(1 / (box.max.y - box.min.y));
    const b2 = new THREE.Box3().setFromObject(cat);
    cat.position.sub(new THREE.Vector3((b2.min.x + b2.max.x) / 2, b2.min.y, (b2.min.z + b2.max.z) / 2));
    cat.rotation.y = 0.35;                              // turned a little toward the table
    this.scene.add(cat);
    // the body is the biggest skinned mesh; her eyeballs tell the fur where to stop
    let body: THREE.SkinnedMesh | null = null;
    const eyePts: THREE.Vector3[] = [];
    cat.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh && (!body || m.geometry.attributes.position.count > body.geometry.attributes.position.count)) body = m;
      if ((o as THREE.Mesh).isMesh && !Array.isArray((o as THREE.Mesh).material) && /Eyes/.test(((o as THREE.Mesh).material as THREE.Material).name)) {
        const p = (o as THREE.Mesh).geometry.attributes.position;
        for (let i = 0; i < p.count; i += 2) eyePts.push(new THREE.Vector3().fromBufferAttribute(p, i));
      }
    });
    if (body) addFur(body, { layers: 14, length: 0.022 }, null, true, { fwd: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) }, eyePts);
    addToonCatchlights(cat);
    this.mixer = new THREE.AnimationMixer(cat);
    for (const clip of gltf.animations) this.actions.set(clip.name.replace(/^AS_StylizedCat_/, ''), this.mixer.clipAction(clip));
    this.mixer.addEventListener('finished', () => { this.busy = false; this.base(); });

    this.host.prepend(this.renderer.domElement);
    new ResizeObserver(() => this.resize()).observe(this.host);
    this.resize();
    this.base();
    this.renderer.setAnimationLoop(() => {
      this.mixer.update(Math.min(this.clock.getDelta(), 0.1));
      this.renderer.render(this.scene, this.camera);
    });
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  private play(name: string, once = false, fade = 0.35) {
    const a = this.actions.get(name);
    if (!a || a === this.current) return;
    a.reset().setEffectiveWeight(1);
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    a.play();
    if (this.current) this.current.crossFadeTo(a, fade, false);
    this.current = a;
  }

  /** What she does when nothing happens: idles (a different one now and then) or sleeps. */
  private base() {
    if (this.busy) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (!this.awake) { this.play('idle_sleep', false, 0.8); return; }
    this.play('idle_01');
    if (calm) return;
    this.idleTimer = setTimeout(() => {
      if (this.busy || !this.awake) return;
      this.play(IDLES[1 + Math.floor(Math.random() * (IDLES.length - 1))]);
      this.idleTimer = setTimeout(() => this.base(), 2300);
    }, 6000 + Math.random() * 6000);
  }

  private react(name: string, times = 1) {
    if (calm) return;
    const a = this.actions.get(name);
    if (!a) return;
    this.busy = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.play(name, times === 1, 0.2);
    if (times > 1) setTimeout(() => { this.busy = false; this.base(); }, a.getClip().duration * 1000 * times);
  }

  setAwake(awake: boolean) { if (awake !== this.awake) { this.awake = awake; this.busy = false; this.base(); } }
  happy() { this.react('jump'); }
  rollover() { this.react('idle_attack'); }
  party() { this.react('jump_loop', 3); }
  pet() { this.awake = true; this.react('idle_05'); }
}
