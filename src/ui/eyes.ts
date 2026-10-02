// Minka's eyes (2026-10-01, Stefanie: "the eyes are too watery, we can do better on the eye texture").
// Tripo painted reflections and wet streaks into the iris. Here the iris is drawn live instead: radial
// fibers in her blue, a warm ring round the pupil, a dark rim, and a round pupil that can widen or narrow
// for her reactions — under a clear cornea that catches one crisp highlight from the key light.
// The eye faces are split from the body (same skeleton), found from the texture's blue iris.

import * as THREE from 'three';

/** Shared by both eyes; the reactions change these. pupil: 0.25 sleepy/narrow … 0.65 wide with surprise. */
export const eyeLook = {
  pupil: { value: 0.44 },
  irisColor: { value: new THREE.Color('#4f8fd0') },
};

interface EyeFrame { center: THREE.Vector3; radius: number; axis: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3 }

function findEyes(geo: THREE.BufferGeometry, map: THREE.Texture): EyeFrame[] {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(map.image as CanvasImageSource, 0, 0, S, S);
  const px = g.getImageData(0, 0, S, S).data;
  const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
  const sides: Record<string, number[]> = { '1': [], '-1': [] };
  for (let i = 0; i < pos.count; i++) {
    const x = Math.min(S - 1, Math.floor(uv.getX(i) * S)), y = Math.min(S - 1, Math.floor(uv.getY(i) * S));
    const k = (y * S + x) * 4;
    if (px[k + 2] > px[k] + 25 && px[k + 2] > px[k + 1] + 8) sides[String(Math.sign(pos.getZ(i)) || 1)].push(i);
  }
  const out: EyeFrame[] = [];
  for (const ids of Object.values(sides)) {
    if (ids.length < 3) continue;
    const center = new THREE.Vector3(), axis = new THREE.Vector3(), p = new THREE.Vector3();
    for (const i of ids) { center.add(p.fromBufferAttribute(pos, i)); axis.add(p.fromBufferAttribute(nrm, i)); }
    center.divideScalar(ids.length); axis.normalize();
    const radius = Math.max(...ids.map((i) => p.fromBufferAttribute(pos, i).distanceTo(center)));
    // a basis across the eye: v roughly "up" (model +y), u across
    const up = new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(up, axis).normalize();
    const v = new THREE.Vector3().crossVectors(axis, u).normalize();
    out.push({ center, radius, axis, u, v });
  }
  return out;
}

const IRIS = /* glsl */ `
  float eh3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float en3(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(eh3(i), eh3(i + vec3(1,0,0)), f.x), mix(eh3(i + vec3(0,1,0)), eh3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(eh3(i + vec3(0,0,1)), eh3(i + vec3(1,0,1)), f.x), mix(eh3(i + vec3(0,1,1)), eh3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  vec3 irisColor(vec2 e, float pupil, vec3 hue) {
    float r = length(e), a = atan(e.y, e.x);
    vec2 ring = vec2(cos(a), sin(a));
    // fibers: fine streaks running out from the pupil, without a seam (noise on the circle, not the angle)
    float fib = en3(vec3(ring * 22.0, r * 2.5)) * 0.55 + en3(vec3(ring * 7.0, r * 1.2 + 4.0)) * 0.45;
    float t = smoothstep(pupil, 1.0, r);                         // 0 at the pupil's edge, 1 at the rim
    vec3 light = hue * 1.55 + vec3(0.06, 0.07, 0.08), deep = hue * 0.35;
    vec3 col = mix(light, hue, smoothstep(0.0, 0.45, t));
    col = mix(col, deep, smoothstep(0.55, 1.0, t));
    col *= 0.72 + 0.56 * fib;
    col += vec3(0.30, 0.22, 0.10) * (1.0 - smoothstep(0.0, 0.22, t)) * 0.45;   // warm ring round the pupil
    col *= 1.0 - 0.8 * smoothstep(0.84, 0.98, r);                                // dark rim
    float p = 1.0 - smoothstep(pupil - 0.015, pupil + 0.015, r);
    return mix(col, vec3(0.004, 0.004, 0.006), p);
  }`;

/** Splits her eyes off the body mesh and gives them the drawn iris. Returns the eye mesh. */
export function addEyes(body: THREE.SkinnedMesh): THREE.SkinnedMesh | null {
  const geo = body.geometry, base = body.material as THREE.MeshStandardMaterial;
  if (!base.map || !geo.index) return null;
  const eyes = findEyes(geo, base.map);
  if (!eyes.length) return null;
  const pos = geo.attributes.position, nrm = geo.attributes.normal, n = pos.count;
  const eyeUV = new Float32Array(n * 2), inEye = new Uint8Array(n);
  const p = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    for (const e of eyes) {
      const d = q.copy(p).sub(e.center);
      if (d.length() > e.radius * 1.25 || q.fromBufferAttribute(nrm, i).dot(e.axis) < 0.15) continue;
      d.copy(p).sub(e.center);
      eyeUV[i * 2] = d.dot(e.u) / e.radius; eyeUV[i * 2 + 1] = d.dot(e.v) / e.radius;
      inEye[i] = 1;
    }
  }
  geo.setAttribute('eyeUV', new THREE.BufferAttribute(eyeUV, 2));
  const index = geo.index.array, keep: number[] = [], eye: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    (inEye[a] && inEye[b] && inEye[c] ? eye : keep).push(a, b, c);
  }
  geo.setIndex(keep);
  const eyeGeo = new THREE.BufferGeometry();
  for (const [k, attr] of Object.entries(geo.attributes)) eyeGeo.setAttribute(k, attr);
  eyeGeo.setIndex(eye);

  const mat = new THREE.MeshPhysicalMaterial({
    map: base.map, roughness: 0.3, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.035,      // a clear cornea: one crisp highlight
    envMapIntensity: 0.3,                          // no glassy, watery mirror
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPupil = eyeLook.pupil;
    sh.uniforms.uIris = eyeLook.irisColor;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 eyeUV; varying vec2 vEye;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEye = eyeUV;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uPupil; uniform vec3 uIris; varying vec2 vEye;\n${IRIS}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float er = length(vEye);
        diffuseColor.rgb = mix(diffuseColor.rgb, irisColor(vEye, uPupil, uIris), 1.0 - smoothstep(0.98, 1.08, er));`);
  };
  mat.customProgramCacheKey = () => 'minka-eyes';
  const mesh = new THREE.SkinnedMesh(eyeGeo, mat);
  mesh.name = 'MinkaEyes';
  mesh.bind(body.skeleton, body.bindMatrix);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  body.parent!.add(mesh);
  mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion); mesh.scale.copy(body.scale);
  return mesh;
}

/** A clear cornea over each eye: a glossy, see-through shell just in front of the painted iris, so the eye
 *  catches crisp highlights from the lights while the iris shows through (Stefanie: "not shiny enough"). */
export function addCornea(body: THREE.SkinnedMesh): THREE.SkinnedMesh | null {
  const geo = body.geometry, base = body.material as THREE.MeshStandardMaterial;
  if (!base.map || !geo.index) return null;
  const eyes = findEyes(geo, base.map);
  if (!eyes.length) return null;
  const pos = geo.attributes.position, nrm = geo.attributes.normal, n = pos.count;
  const inEye = new Uint8Array(n), p = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    for (const e of eyes) {
      if (p.distanceTo(e.center) <= e.radius * 1.2 && q.fromBufferAttribute(nrm, i).dot(e.axis) > 0.15) inEye[i] = 1;
    }
  }
  const index = geo.index.array, faces: number[] = [];
  for (let t = 0; t < index.length; t += 3) if (inEye[index[t]] && inEye[index[t + 1]] && inEye[index[t + 2]]) faces.push(index[t], index[t + 1], index[t + 2]);
  const cg = new THREE.BufferGeometry();
  for (const [k, attr] of Object.entries(geo.attributes)) cg.setAttribute(k, attr);
  cg.setIndex(faces);
  const mat = new THREE.MeshPhysicalMaterial({
    color: '#ffffff', metalness: 0, roughness: 0.02, transmission: 1, thickness: 0.002, ior: 1.376,
    clearcoat: 1, clearcoatRoughness: 0.01, envMapIntensity: 2.6, specularIntensity: 1,   // the film's deep, glossy reflection
  });
  const lift = eyes[0].radius * 0.04;            // just in front of the iris, never z-fighting it
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += normal * ${lift.toFixed(5)};`);
  };
  mat.customProgramCacheKey = () => 'minka-cornea';
  const mesh = new THREE.SkinnedMesh(cg, mat);
  mesh.name = 'MinkaCornea';
  mesh.bind(body.skeleton, body.bindMatrix);
  mesh.frustumCulled = false;
  mesh.renderOrder = 100;
  body.parent!.add(mesh);
  mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion); mesh.scale.copy(body.scale);
  return mesh;
}

/** Catchlights (2026-10-01, Stefanie: the reference kitten's eyes carry one big, soft window highlight). One soft
 *  white highlight per eye, sitting on the cornea up and to her left, attached to the head bone so it moves with
 *  her. Works on the model with real eyeballs (MinkaEye0/1, MinkaCornea0/1 from scripts/blender/add_eyeballs.py). */
export function addCatchlights(model: THREE.Object3D): THREE.Mesh[] {
  model.updateMatrixWorld(true);
  const head = model.getObjectByName('head') as THREE.Bone | undefined;
  if (!head) return [];
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.45, 'rgba(255,255,255,0.9)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const out: THREE.Mesh[] = [];
  for (const k of [0, 1]) {
    const cornea = model.getObjectByName(`MinkaCornea${k}`) as THREE.SkinnedMesh | undefined;
    if (!cornea) continue;
    const pos = cornea.geometry.attributes.position;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(cornea.matrixWorld));
    const center = pts.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(pts.length);
    const far = pts.reduce((a, b) => (b.distanceTo(center) > a.distanceTo(center) ? b : a));   // the bulge's tip
    const axis = far.clone().sub(center).normalize(), R = far.distanceTo(center);
    // up and to her left (+z is her left in Tripo's frame): the window light
    const up = new THREE.Vector3(0, 1, 0), left = new THREE.Vector3(0, 0, 1);
    const dir = axis.clone().add(up.clone().multiplyScalar(0.22)).add(left.clone().multiplyScalar(0.2)).normalize();   // below the lowered upper lid
    const spot = center.clone().add(dir.multiplyScalar(R * 1.004));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(R * 0.42, R * 0.32),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }));
    m.name = `MinkaCatchlight${k}`;
    m.position.copy(spot); m.lookAt(spot.clone().add(dir));
    m.renderOrder = 200;
    head.attach(m);                                          // keeps its world place, then follows the head
    out.push(m);
  }
  return out;
}

/** Catchlights for the toon Minka (Toon Cats skeleton): her eyes are one mesh with the material MinkaEyes,
 *  each eye turning on its bone Eye_L / Eye_R. The light sits on the eye's surface, up and to the side of where
 *  the face looks, and rides on the Head bone — a reflection stays put while the eye turns under it. */
export function addToonCatchlights(model: THREE.Object3D): THREE.Mesh[] {
  model.updateMatrixWorld(true);
  const head = model.getObjectByName('Head');
  let eyeMesh: THREE.Mesh | undefined;
  model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !Array.isArray(m.material) && /Eyes/.test(m.material.name)) eyeMesh = m; });
  const bones = ['Eye_L', 'Eye_R'].map((n) => model.getObjectByName(n));
  if (!head || !eyeMesh || bones.some((b) => !b)) return [];
  const centers = bones.map((b) => b!.getWorldPosition(new THREE.Vector3()));
  const pos = eyeMesh.geometry.attributes.position;
  const side = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    // a skinned mesh's raw positions are in bind space: getVertexPosition applies the skeleton
    const p = ((eyeMesh as THREE.SkinnedMesh).isSkinnedMesh ? (eyeMesh as THREE.SkinnedMesh).getVertexPosition(i, new THREE.Vector3())
      : new THREE.Vector3().fromBufferAttribute(pos, i)).applyMatrix4(eyeMesh.matrixWorld);
    side[i] = p.distanceTo(centers[0]) < p.distanceTo(centers[1]) ? 0 : 1;
  }
  const mid = centers[0].clone().add(centers[1]).multiplyScalar(0.5);
  const fwd = mid.clone().sub(head.getWorldPosition(new THREE.Vector3())).setY(0).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const across = new THREE.Vector3().crossVectors(up, fwd);   // the same side for both eyes: one window light
  const tex = glowTexture();
  const out: THREE.Mesh[] = [];
  // the pupil's center and the iris edge, found through the UVs: her eye texture's measured iris
  // (art/minka/eye-textures/cat_eyeball_texture_lblue_wide_open.json — center 510.8, 508.9, radius 322 of 1024)
  const IRIS = { u: 510.8 / 1024, v: 508.9 / 1024, r: 322 / 1024 };   // glTF UVs run top-down, like the image
  const uv = eyeMesh.geometry.attributes.uv;
  const world = (i: number) => ((eyeMesh as THREE.SkinnedMesh).isSkinnedMesh ? (eyeMesh as THREE.SkinnedMesh).getVertexPosition(i, new THREE.Vector3())
    : new THREE.Vector3().fromBufferAttribute(pos, i)).applyMatrix4(eyeMesh!.matrixWorld);
  const best: { apex: number; ad: number; edge: number; ed: number }[] = [0, 1].map(() => ({ apex: -1, ad: 1e9, edge: -1, ed: 1e9 }));
  for (let i = 0; i < pos.count; i++) {
    const k = side[i];
    const du = uv.getX(i) - IRIS.u, dv = uv.getY(i) - IRIS.v, d = Math.hypot(du, dv);
    if (d < best[k].ad) { best[k].ad = d; best[k].apex = i; }
    if (Math.abs(d - IRIS.r) < best[k].ed) { best[k].ed = Math.abs(d - IRIS.r); best[k].edge = i; }
  }
  best.forEach((b, k) => {
    if (b.apex < 0) return;
    const apex = world(b.apex), ri = apex.distanceTo(world(b.edge));     // the pupil's center, the iris radius
    const n = apex.clone().sub(centers[k]).normalize();
    // up and to one side of the pupil (the same side in both eyes: one window light), just in front of the lens
    const t1 = up.clone().addScaledVector(n, -up.dot(n)).normalize(), t2 = across.clone().addScaledVector(n, -across.dot(n)).normalize();
    const spot = apex.clone().addScaledVector(t1, ri * 0.32).addScaledVector(t2, ri * 0.3).addScaledVector(n, ri * 0.06);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(ri * 0.46, ri * 0.36),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.95 }));
    m.name = `MinkaCatchlight${k}`;
    m.position.copy(spot); m.lookAt(spot.clone().add(n));
    m.renderOrder = 200;
    head.attach(m);
    out.push(m);
  });
  return out;
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.45, 'rgba(255,255,255,0.9)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
