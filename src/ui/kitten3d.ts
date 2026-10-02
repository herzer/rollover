// The 3D kitten (2026-10-01, Stefanie: "more of a Pixar style … a 3D rendered look" → "way too anime,
// let's go fully 3d rendered" → "fun reactions of the animated kittens").
// A real-time three.js render: shell-rendered fur (many offset layers, strands cut per layer), cat eyes
// with an iris, a slit pupil, a wet cornea and real eyelids, studio light, a contact shadow.
// Reactions: happy, roll, surprise, pout, party, pet; moods awake / asleep. Prototype — ?lab=kitten.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface KittenLook {
  fur: string;      // base coat
  stripe: string;   // tabby stripes
  cream: string;    // muzzle, chest, paws
  iris: string;     // eye color
  nose: string;
}

export const LOOKS: Record<string, KittenLook> = {
  ginger: { fur: '#e8893f', stripe: '#b2561c', cream: '#fbeedd', iris: '#9bbf3a', nose: '#e48a8a' },
  gray: { fur: '#8f949e', stripe: '#565a63', cream: '#efece8', iris: '#e0a43a', nose: '#c98587' },
  black: { fur: '#2a272e', stripe: '#1c1a20', cream: '#3a3640', iris: '#e8b630', nose: '#4a3a3e' },
  calico: { fur: '#f6efe4', stripe: '#d9822f', cream: '#ffffff', iris: '#4f9fd0', nose: '#eb9b9b' },
};

export type Reaction = 'happy' | 'roll' | 'surprise' | 'pout' | 'party' | 'pet';

const FUR_LAYERS = 22;

function noisy(g: CanvasRenderingContext2D, w: number, h: number, amount: number) {
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

function tex(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function coatTexture(look: KittenLook, kind: 'head' | 'body' | 'plain' | 'cream'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = kind === 'cream' ? look.cream : look.fur;
  g.fillRect(0, 0, 512, 256);
  g.filter = 'blur(5px)';
  g.fillStyle = look.stripe;
  if (kind === 'head') {
    // the tabby "M" on the forehead — u = .25 is the front of a three.js sphere, the top of the canvas the crown
    const cx = 128;
    for (const [dx, w, h] of [[-20, 8, 62], [0, 10, 74], [20, 8, 62], [-48, 7, 40], [48, 7, 40]]) {
      g.beginPath(); g.ellipse(cx + dx, 10, w, h, 0, 0, Math.PI * 2); g.fill();
    }
    // cheek stripes
    for (const x of [60, 196]) for (const y of [120, 140]) {
      g.beginPath(); g.ellipse(x, y, 22, 4, 0, 0, Math.PI * 2); g.fill();
    }
  } else if (kind === 'body') {
    for (let i = 0; i < 8; i++) {
      g.beginPath(); g.ellipse((300 + i * 30) % 512, 100, 9, 80, 0.2, 0, Math.PI * 2); g.fill();
    }
  }
  g.filter = 'none';
  noisy(g, 512, 256, 18);
  return tex(c);
}

function irisTexture(color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  // the front of the eye is u = .25, v = .5 of the sphere
  const cx = 128, cy = 256, R = 120;
  g.fillStyle = '#2a2015'; g.fillRect(0, 0, 512, 512);
  const base = g.createRadialGradient(cx, cy, 0, cx, cy, R);
  const col = new THREE.Color(color);
  const light = '#' + col.clone().lerp(new THREE.Color('#fff4c0'), 0.45).getHexString();
  const dark = '#' + col.clone().multiplyScalar(0.45).getHexString();
  base.addColorStop(0, light);
  base.addColorStop(0.35, light);
  base.addColorStop(0.6, color);
  base.addColorStop(0.9, dark);
  base.addColorStop(1, '#1d150d');
  g.fillStyle = base;
  g.beginPath(); g.ellipse(cx, cy, R, R, 0, 0, Math.PI * 2); g.fill();
  // radial fibers
  for (let i = 0; i < 260; i++) {
    const a = Math.random() * Math.PI * 2, r0 = 10 + Math.random() * 30, r1 = R * (0.6 + Math.random() * 0.38);
    g.strokeStyle = Math.random() < 0.5 ? 'rgba(255,250,210,.18)' : 'rgba(40,30,10,.2)';
    g.lineWidth = 1 + Math.random() * 1.5;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.stroke();
  }
  return tex(c);
}

/** Fur by shells: the same surface drawn FUR_LAYERS times, each pushed out along its normal, strands cut away per layer. */
function furShellMaterial(map: THREE.Texture, density: number, length: number) {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.92 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLayers = { value: FUR_LAYERS };
    sh.uniforms.uLen = { value: length };
    sh.uniforms.uDensity = { value: density };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uLayers; uniform float uLen; varying float vH;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float h = float(gl_InstanceID + 1) / uLayers;
        vH = h;
        transformed += normal * uLen * h;
        transformed.y -= uLen * 0.5 * h * h;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uDensity; varying float vH;
        float strand(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 cuv = vMapUv * vec2(uDensity * 2.0, uDensity);
        vec2 cell = floor(cuv);
        vec2 f = fract(cuv) - 0.5;
        float r = 0.35 + 0.65 * strand(cell);
        if (r < vH) discard;
        if (length(f) > 0.55 * (1.0 - vH / r) + 0.08) discard;
        diffuseColor.rgb *= mix(0.55, 1.08, vH);`);
  };
  m.customProgramCacheKey = () => 'fur-shell';
  return m;
}

interface Part { base: THREE.Mesh; }

export class Kitten3D {
  readonly el: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private rig = new THREE.Group();   // hops, rolls, squash
  private root = new THREE.Group();
  private head = new THREE.Group();
  private body!: THREE.Object3D;
  private eyes: { group: THREE.Group; upper: THREE.Mesh; lower: THREE.Mesh; pupil: THREE.Mesh }[] = [];
  private ears: THREE.Group[] = [];
  private tail!: THREE.Mesh;
  private tailShell!: THREE.InstancedMesh;
  private clock = new THREE.Clock();
  private nextBlink = 2;
  private look = new THREE.Vector2();
  private asleep = false;
  private action: Reaction | null = null;
  private actionAt = 0;
  private lid = { up: 0, low: 0 };
  private earBack = 0;
  private raf = 0;

  constructor(width: number, height: number, lookName: keyof typeof LOOKS = 'ginger') {
    const look = LOOKS[lookName];
    this.el = document.createElement('div');
    this.el.className = 'k3d';
    this.el.style.width = `${width}px`; this.el.style.height = `${height}px`;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas = this.renderer.domElement;
    this.el.appendChild(this.canvas);
    injectStyle();

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.7;

    this.camera = new THREE.PerspectiveCamera(26, width / height, 0.1, 50);
    this.camera.position.set(0, 1.7, 8.2);
    this.camera.lookAt(0, 1.35, 0);

    // studio light: warm key with a soft shadow, cool rim from behind, gentle fill
    const key = new THREE.DirectionalLight('#fff1dc', 2.6);
    key.position.set(2.5, 5, 4.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 8;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.03;
    Object.assign(key.shadow.camera, { left: -3, right: 3, top: 4, bottom: -2 });
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#d6e4ff', 3.2);
    rim.position.set(-3.5, 3.5, -4);
    this.scene.add(rim);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#cbb8a0', 0.5));

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({ opacity: 0.3 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.build(look);
    this.rig.add(this.root);
    this.scene.add(this.rig);
    this.canvas.addEventListener('pointerdown', () => this.react('pet'));
    this.canvas.title = 'Pet the kitten';
    addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.look.set(
        THREE.MathUtils.clamp((e.clientX - (r.left + r.width / 2)) / 500, -1, 1),
        THREE.MathUtils.clamp((e.clientY - (r.top + r.height * 0.35)) / 500, -1, 1),
      );
    });
    this.loop();
  }

  private build(look: KittenLook) {
    const headMap = coatTexture(look, 'head');
    const bodyMap = coatTexture(look, 'body');
    const creamMap = coatTexture(look, 'cream');
    const mats = {
      head: new THREE.MeshStandardMaterial({ map: headMap, roughness: 0.95 }),
      body: new THREE.MeshStandardMaterial({ map: bodyMap, roughness: 0.95 }),
      cream: new THREE.MeshStandardMaterial({ map: creamMap, roughness: 0.95 }),
    };
    const shells = {
      head: furShellMaterial(headMap, 70, 0.07),
      body: furShellMaterial(bodyMap, 70, 0.08),
      cream: furShellMaterial(creamMap, 70, 0.06),
    };
    const ball = new THREE.SphereGeometry(1, 56, 36);

    const furry = (parent: THREE.Object3D, kind: keyof typeof mats, p: [number, number, number], s: [number, number, number]): Part => {
      const base = new THREE.Mesh(ball, mats[kind]);
      base.position.set(...p); base.scale.set(...s);
      base.castShadow = true; base.receiveShadow = true;
      const shell = new THREE.InstancedMesh(ball, shells[kind], FUR_LAYERS);
      shell.receiveShadow = true;
      shell.frustumCulled = false;
      base.add(shell);
      parent.add(base);
      return { base };
    };
    const solid = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, p: [number, number, number], s: [number, number, number] = [1, 1, 1]) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(...p); m.scale.set(...s);
      m.castShadow = true; m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    // body: a soft pear, sitting
    this.body = furry(this.root, 'body', [0, 0.8, -0.15], [0.82, 0.8, 0.74]).base;
    furry(this.root, 'cream', [0, 0.86, 0.36], [0.44, 0.56, 0.32]);                  // chest
    furry(this.root, 'cream', [-0.3, 0.15, 0.42], [0.2, 0.15, 0.3]);                 // front paws
    furry(this.root, 'cream', [0.3, 0.15, 0.42], [0.2, 0.15, 0.3]);
    furry(this.root, 'body', [-0.6, 0.3, 0.0], [0.32, 0.28, 0.46]);                  // haunches
    furry(this.root, 'body', [0.6, 0.3, 0.0], [0.32, 0.28, 0.46]);

    // head: large (it is a kitten), but the face reads as a cat
    this.head.position.set(0, 1.9, 0.12);
    this.root.add(this.head);
    furry(this.head, 'head', [0, 0, 0], [0.98, 0.86, 0.86]);
    furry(this.head, 'head', [-0.56, -0.24, 0.16], [0.4, 0.34, 0.48]);               // cheeks
    furry(this.head, 'head', [0.56, -0.24, 0.16], [0.4, 0.34, 0.48]);
    furry(this.head, 'cream', [-0.15, -0.33, 0.64], [0.2, 0.16, 0.17]);              // whisker pads
    furry(this.head, 'cream', [0.15, -0.33, 0.64], [0.2, 0.16, 0.17]);
    furry(this.head, 'cream', [0, -0.47, 0.56], [0.13, 0.09, 0.11]);                 // chin

    // nose leather: a soft rounded triangle
    const noseMat = new THREE.MeshPhysicalMaterial({ color: look.nose, roughness: 0.42, clearcoat: 0.3 });
    const nose = new THREE.Shape();
    nose.moveTo(-0.075, 0.03); nose.quadraticCurveTo(0, 0.055, 0.075, 0.03);
    nose.quadraticCurveTo(0.03, -0.03, 0, -0.05); nose.quadraticCurveTo(-0.03, -0.03, -0.075, 0.03);
    const noseGeo = new THREE.ExtrudeGeometry(nose, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 5, curveSegments: 16 });
    solid(this.head, noseGeo, noseMat, [0, -0.2, 0.78]).rotation.x = -0.25;
    // mouth: a short philtrum and two shallow curves, half hidden in the fur
    const lineMat = new THREE.MeshStandardMaterial({ color: '#3a2620', roughness: 0.7 });
    const mouth = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.12, -0.39, 0.76), new THREE.Vector3(-0.05, -0.405, 0.8), new THREE.Vector3(0, -0.37, 0.81),
      new THREE.Vector3(0.05, -0.405, 0.8), new THREE.Vector3(0.12, -0.39, 0.76),
    ]);
    solid(this.head, new THREE.TubeGeometry(mouth, 24, 0.008, 6), lineMat, [0, 0, 0]);
    solid(this.head, new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(0, -0.27, 0.81), new THREE.Vector3(0, -0.37, 0.815)), 2, 0.007, 6), lineMat, [0, 0, 0]);

    // eyes: iris + slit pupil under a clear wet cornea, a dark rim, fur eyelids above and below
    const irisMat = new THREE.MeshStandardMaterial({ map: irisTexture(look.iris), roughness: 0.4 });
    const pupilMat = new THREE.MeshStandardMaterial({ color: '#050403', roughness: 0.3 });
    const cornea = new THREE.MeshPhysicalMaterial({ transmission: 1, thickness: 0.05, roughness: 0.02, ior: 1.38, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true });
    const rimMat = new THREE.MeshStandardMaterial({ color: '#2b1d16', roughness: 0.6 });
    const lidMat = new THREE.MeshStandardMaterial({ map: headMap, roughness: 0.95 });
    const half = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(side * 0.33, 0.02, 0.56);
      g.rotation.y = side * 0.3;
      this.head.add(g);
      const R = 0.24;
      solid(g, ball, irisMat, [0, 0, 0], [R, R, R]);
      const pupil = solid(g, ball, pupilMat, [0, 0, R * 0.9], [0.045, 0.15, 0.04]);
      solid(g, ball, cornea, [0, 0, 0.012], [R * 1.04, R * 1.04, R * 1.06]);
      solid(g, new THREE.TorusGeometry(R * 0.98, 0.022, 12, 48), rimMat, [0, 0, R * 0.18]);
      const upper = solid(g, half, lidMat, [0, 0, 0], [R * 1.1, R * 1.1, R * 1.1]);
      const lower = solid(g, half, lidMat, [0, 0, 0], [R * 1.09, R * 1.09, R * 1.09]);
      lower.rotation.z = Math.PI;
      this.eyes.push({ group: g, upper, lower, pupil });
    }

    // ears: furry outside, pink and softly lit inside
    const earShape = new THREE.ConeGeometry(1, 1, 48, 6, true);
    earShape.translate(0, 0.5, 0);
    const earMat = new THREE.MeshStandardMaterial({ map: headMap, roughness: 0.95, side: THREE.DoubleSide });
    const innerMat = new THREE.MeshStandardMaterial({ color: '#f2a7a2', roughness: 0.7, emissive: '#7a2a20', emissiveIntensity: 0.15 });
    for (const side of [-1, 1]) {
      const ear = new THREE.Group();
      ear.position.set(side * 0.56, 0.52, -0.02);
      ear.rotation.set(0.05, side * -0.3, side * -0.38);
      this.head.add(ear);
      solid(ear, earShape, earMat, [0, 0, 0], [0.34, 0.52, 0.2]);
      solid(ear, earShape, innerMat, [0, 0.02, 0.07], [0.24, 0.42, 0.1]);
      this.ears.push(ear);
    }

    // whiskers: thin, translucent, slightly drooping
    const whiskerMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7 });
    for (const side of [-1, 1]) for (const dy of [0, -0.06, -0.12]) {
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(side * 0.24, -0.3 + dy, 0.74),
        new THREE.Vector3(side * 0.75, -0.25 + dy * 1.6, 0.7),
        new THREE.Vector3(side * 1.15, -0.35 + dy * 3, 0.45),
      );
      solid(this.head, new THREE.TubeGeometry(curve, 16, 0.005, 4), whiskerMat, [0, 0, 0]).castShadow = false;
    }

    // tail: a furry tube, re-shaped every frame
    this.tail = solid(this.root, new THREE.BufferGeometry(), mats.body, [0, 0, 0]);
    this.tailShell = new THREE.InstancedMesh(new THREE.BufferGeometry(), shells.body, FUR_LAYERS);
    this.tailShell.frustumCulled = false;
    this.tail.add(this.tailShell);
    this.root.rotation.y = -0.15;
  }

  private tailGeometry(t: number, droop: number) {
    const sway = Math.sin(t * 1.4) * 0.3 * (1 - droop);
    const up = 1 - droop;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.3, 0.35, -0.75),
      new THREE.Vector3(0.95, 0.22, -0.6),
      new THREE.Vector3(1.3 + sway * 0.2, 0.25 + 0.5 * up, -0.3),
      new THREE.Vector3(1.2 + sway, 0.25 + 1.0 * up, -0.1),
      new THREE.Vector3(0.95 + sway * 1.3, 0.25 + 1.3 * up, 0),
    ]);
    const geo = new THREE.TubeGeometry(curve, 40, 0.12, 14);
    // taper toward the tip
    const p = geo.attributes.position, n = geo.attributes.normal;
    const ring = 15;
    for (let i = 0; i < p.count; i++) {
      const seg = Math.floor(i / ring) / 40;
      const k = 1 - Math.max(0, seg - 0.6) * 0.9;
      const c = curve.getPointAt(Math.min(1, seg));
      p.setXYZ(i, c.x + (p.getX(i) - c.x) * k, c.y + (p.getY(i) - c.y) * k, c.z + (p.getZ(i) - c.z) * k);
    }
    p.needsUpdate = true; void n;
    return geo;
  }

  /** Others' turn: the kitten naps. */
  setAsleep(asleep: boolean) {
    if (asleep === this.asleep) return;
    this.asleep = asleep;
    this.el.classList.toggle('asleep', asleep);
  }

  react(kind: Reaction) {
    this.action = kind;
    this.actionAt = this.clock.elapsedTime;
    if (kind !== 'pout') this.setAsleep(false);
    if (kind === 'happy') this.burst('♥', 3);
    if (kind === 'pet') this.burst('♥', 4);
    if (kind === 'roll') this.burst('♥', 2);
    if (kind === 'party') this.burst('✦', 14);
    if (kind === 'surprise') this.burst('!', 1);
  }

  private burst(ch: string, n: number) {
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.className = 'k3d-fx';
      s.textContent = ch;
      s.style.left = `${25 + Math.random() * 50}%`;
      s.style.animationDelay = `${i * 0.09}s`;
      s.style.fontSize = `${16 + Math.random() * 14}px`;
      if (ch === '✦') s.style.color = ['#f2b134', '#7a55d9', '#e5484d', '#2f6fde'][i % 4];
      this.el.appendChild(s);
      setTimeout(() => s.remove(), 1600 + i * 90);
    }
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const t = this.clock.getElapsedTime();
    const a = this.action, at = t - this.actionAt;
    const dur: Record<Reaction, number> = { happy: 1.4, roll: 1.2, surprise: 1.1, pout: 2.2, party: 3, pet: 2 };
    if (a && at > dur[a]) this.action = null;
    const on = (k: Reaction) => this.action === k;

    // targets
    let up = -0.25, low = 0.0, hop = 0, roll = 0, squash = 0, headDown = 0, tilt = 0, ears = 0, droop = 0, pupil = 1, spin = 0;
    if (this.asleep) { up = 1.45; low = 0.15; headDown = 0.35; tilt = 0.18; ears = 0.25; droop = 0.6; }
    if (t > this.nextBlink) this.nextBlink = t + 2.5 + Math.random() * 3;
    if (!this.asleep && this.nextBlink - t < 0.12) up = 1.5;
    if (on('happy')) { up = 0.75; low = 0.75; hop = Math.abs(Math.sin(at * 9)) * 0.22 * (1 - at / 1.4); tilt = Math.sin(at * 10) * 0.12; }
    if (on('pet')) { up = 1.25; low = 0.4; tilt = 0.25 + Math.sin(at * 3) * 0.05; headDown = -0.08; }
    if (on('roll')) { const k = Math.min(1, at / 1.0); roll = easeInOut(k) * Math.PI * 2; hop = Math.sin(k * Math.PI) * 0.5; up = 0.6; low = 0.6; }
    if (on('surprise')) { up = -0.75; pupil = 1.9; hop = Math.max(0, Math.sin(Math.min(1, at / 0.45) * Math.PI)) * 0.45; squash = at < 0.12 ? -0.12 : 0; ears = -0.25; }
    if (on('pout')) { up = 0.55; low = 0.2; headDown = 0.25; ears = 0.9; droop = 0.85; tilt = -0.1; }
    if (on('party')) { const k = at / 3; hop = Math.abs(Math.sin(at * 7)) * 0.4 * (1 - k * 0.5); spin = Math.sin(at * 3.5) * 0.6; up = 0.7; low = 0.7; tilt = Math.sin(at * 7) * 0.15; }

    // ease the eyelids, ears and pupils toward their targets
    const ease = (cur: number, to: number, k = 0.25) => cur + (to - cur) * k;
    this.lid.up = ease(this.lid.up, up, up > 1 ? 0.45 : 0.25);
    this.lid.low = ease(this.lid.low, low);
    this.earBack = ease(this.earBack, ears, 0.15);
    for (const e of this.eyes) {
      // the upper lid is a hemisphere tipped back (open) or forward over the eye (closed)
      e.upper.rotation.x = -1.35 + this.lid.up;
      e.lower.rotation.x = 1.45 - this.lid.low;
      e.pupil.scale.x = ease(e.pupil.scale.x, 0.045 * pupil, 0.2);
      e.group.rotation.x = this.look.y * 0.15;
    }
    for (const [i, ear] of this.ears.entries()) {
      const side = i ? 1 : -1;
      ear.rotation.x = 0.05 - this.earBack * 0.7;
      ear.rotation.z = side * (-0.38 - this.earBack * 0.5);
    }
    if (!this.asleep && Math.sin(t * 0.8) > 0.985) this.ears[0].rotation.x += Math.sin(t * 50) * 0.15;   // twitch

    // body
    const breath = this.asleep ? Math.sin(t * 1.3) * 0.03 : Math.sin(t * 2.2) * 0.016;
    this.body.scale.y = 0.8 * (1 + breath);
    this.rig.position.y = hop;
    this.rig.scale.set(1 - squash * 0.5, 1 + squash, 1 - squash * 0.5);
    this.root.rotation.z = roll;
    this.root.rotation.y = -0.15 + spin;
    const purr = on('pet') ? Math.sin(t * 60) * 0.004 : 0;
    this.head.position.y = 1.9 + breath * 0.5 - headDown * 0.3 + purr;
    const lookX = this.asleep ? 0 : this.look.x, lookY = this.asleep ? 0 : this.look.y;
    this.head.rotation.y = ease(this.head.rotation.y, lookX * 0.5, 0.08);
    this.head.rotation.x = ease(this.head.rotation.x, lookY * 0.22 + headDown, 0.08);
    this.head.rotation.z = ease(this.head.rotation.z, tilt + Math.sin(t * 0.6) * 0.04, 0.12);

    // tail
    this.tail.geometry.dispose();
    this.tail.geometry = this.tailGeometry(t, droop);
    this.tailShell.geometry = this.tail.geometry;

    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
  }
}

function easeInOut(k: number) { return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; }

let styled = false;
function injectStyle() {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = `
  .k3d { position: relative; }
  .k3d canvas { display: block; cursor: pointer; }
  .k3d-fx { position: absolute; top: 30%; pointer-events: none; color: #e5484d; font-weight: 800;
    animation: k3d-rise 1.4s ease-out both; text-shadow: 0 2px 6px rgba(0,0,0,.18); }
  @keyframes k3d-rise { from { transform: translateY(0) scale(.6); opacity: 0; } 15% { opacity: 1; }
    to { transform: translateY(-120px) scale(1.15); opacity: 0; } }
  .k3d.asleep::after { content: 'z z z'; position: absolute; right: 22%; top: 12%; font: 800 20px/1 "Baloo 2", sans-serif;
    color: rgba(80,60,120,.55); letter-spacing: 4px; animation: k3d-zzz 2.6s ease-in-out infinite; }
  @keyframes k3d-zzz { 0%,100% { transform: translateY(0); opacity: .4; } 50% { transform: translateY(-10px); opacity: 1; } }
  `;
  document.head.appendChild(s);
}
