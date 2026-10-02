// Fur for the Tripo Minka (2026-10-01, Stefanie: "can we make the fur … look furry").
// Shell fur: the skinned mesh is drawn again N times, each copy pushed out along its normals and
// cut down to thinner and fewer strands, so the coat gets real depth and a soft, fuzzy silhouette.
// The shells share her skeleton, so the fur walks with her. Bare: the eyes, nose and paw pads (found
// from the texture's colors), the whiskers and the guard hairs inside the ears. Nothing else.

import * as THREE from 'three';

export interface FurOptions {
  layers: number;      // shells — more is softer and costlier
  length: number;      // as a fraction of her height
  density: number;     // strands per UV unit
  gravity: number;     // droop toward the floor, 0..1
  comb: number;        // how far strands lie down toward the tail, 0..1
}

/** Which way the model faces and which way is up, in its geometry's own space. Tripo's Minka faces +x; the
 *  Minka built on the Toon Cats skeleton (scripts/blender/fit_minka_v2.py) faces +z. */
export interface FurFrame { fwd: THREE.Vector3; up: THREE.Vector3 }
export const TRIPO_FRAME: FurFrame = { fwd: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) };

/** Positions in the frame the rules are written in: x forward, y up, z sideways. */
function canonical(geo: THREE.BufferGeometry, frame: FurFrame): { pos: THREE.BufferAttribute; box: THREE.Box3 } {
  const src = geo.attributes.position, n = src.count;
  const side = new THREE.Vector3().crossVectors(frame.fwd, frame.up);
  const out = new Float32Array(n * 3), p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(src, i);
    out[i * 3] = p.dot(frame.fwd); out[i * 3 + 1] = p.dot(frame.up); out[i * 3 + 2] = p.dot(side);
  }
  const pos = new THREE.BufferAttribute(out, 3);
  return { pos, box: new THREE.Box3().setFromBufferAttribute(pos) };
}

/** Dev: 1 paints the fur loud magenta — the loud-colors trick, to see exactly where it grows. */
export const furDebug = { value: 0 };

export const FUR_DEFAULTS: FurOptions = { layers: 26, length: 0.032, density: 750, gravity: 0.3, comb: 0.75 };

/** A piece's shape from its spread: [off-line ÷ along-line, thickness ÷ along-line] — a hair is ~[0, 0],
 *  a flat ribbon is [>0, ~0], a patch of curved skin is clearly above both. */
function shape(v: number[], pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): [number, number] {
  const m = [0, 0, 0];
  for (const i of v) { m[0] += pos.getX(i) / v.length; m[1] += pos.getY(i) / v.length; m[2] += pos.getZ(i) / v.length; }
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const i of v) {
    const d = [pos.getX(i) - m[0], pos.getY(i) - m[1], pos.getZ(i) - m[2]];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[a][b] += d[a] * d[b];
  }
  const ev: number[] = [];
  for (let k = 0; k < 3; k++) {          // the three spreads, largest first (power iteration with deflation)
    let e = [1, 0.5, 0.3];
    for (let it = 0; it < 60; it++) {
      const w = [0, 1, 2].map((a) => M[a][0] * e[0] + M[a][1] * e[1] + M[a][2] * e[2]);
      const L = Math.hypot(...w) || 1;
      e = w.map((x) => x / L);
    }
    const l = [0, 1, 2].reduce((sum, a) => sum + e[a] * (M[a][0] * e[0] + M[a][1] * e[1] + M[a][2] * e[2]), 0);
    ev.push(l);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[a][b] -= l * e[a] * e[b];
  }
  const top = Math.max(ev[0], 1e-12);
  return [(ev[1] + ev[2]) / top, ev[2] / top];
}

/** The mesh's separate pieces (UV islands): vertex lists, keyed by an arbitrary root. */
export function meshPieces(geo: THREE.BufferGeometry): Map<number, number[]> {
  const n = geo.attributes.position.count, index = geo.index!;
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let t = 0; t < index.count; t += 3) {
    const a = find(index.getX(t)), b = find(index.getX(t + 1)), c = find(index.getX(t + 2));
    parent[b] = a; parent[find(c)] = a;
  }
  const pieces = new Map<number, number[]>();
  for (let i = 0; i < n; i++) { const r = find(i); (pieces.get(r) ?? pieces.set(r, []).get(r)!).push(i); }
  return pieces;
}

/** On the head: the front ~45% (positions in the canonical frame: x forward, y up). */
function onHead(v: number[], pos: THREE.BufferAttribute, box: THREE.Box3): boolean {
  let cx = 0, cy = 0;
  for (const i of v) { cx += pos.getX(i) / v.length; cy += pos.getY(i) / v.length; }
  // the head: the front ~45% AND above the chin — the front of her chest is not head (bare patch, 2026-10-01)
  return cx > box.max.x * 0.55 && cy > box.max.y * 0.55;
}

/** The fine guard hairs inside the ears — whisker-like, never furry (Stefanie, 2026-10-01: "they're like
 *  whiskers … sensing air and objects that would otherwise intrude the ear"). Tripo paints them on the
 *  patches that line the inside of each ear (two per ear) — the only patches up at the ears that are mostly
 *  pink skin — and adds tiny hair pieces at the lining's edge. Both stay bare; nothing else on her does. */
function earGuardHairs(geo: THREE.BufferGeometry, pink: Uint8Array, pos: THREE.BufferAttribute, box: THREE.Box3): number[] {
  const top = box.max.y, front = box.max.x;
  const out: number[] = [];
  for (const v of meshPieces(geo).values()) {
    let x = 0, y = 0, z = 0, pk = 0;
    for (const i of v) { x += pos.getX(i); y += pos.getY(i); z += pos.getZ(i); pk += pink[i]; }
    x /= v.length; y /= v.length; z /= v.length;
    const atEars = y > top * 0.75 && Math.abs(z) > 0.07 * top && x > front * 0.4;
    if (atEars && pk / v.length >= 0.15) out.push(...v);
  }
  // the guard hairs at the ear opening are tiny separate pieces (4–30 points) sitting at the lining's edge
  const lining = out.map((i) => new THREE.Vector3().fromBufferAttribute(pos, i));
  const near = 0.04 * top, p = new THREE.Vector3();
  for (const v of meshPieces(geo).values()) {
    if (v.length >= 40) continue;
    const touches = v.some((i) => { p.fromBufferAttribute(pos, i); return lining.some((l) => l.distanceToSquared(p) < near * near); });
    if (touches) out.push(...v);
  }
  return out;
}

/** Per-vertex fur length 0..1 — 0 on the eyes, nose and pads. */
function furMask(mesh: THREE.SkinnedMesh, height: number, realParts = false, frame: FurFrame = TRIPO_FRAME, eyePts: THREE.Vector3[] = []): Float32Array {
  const geo = mesh.geometry;
  const { pos, box } = canonical(geo, frame);
  const map = (mesh.material as THREE.MeshStandardMaterial).map!;
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(map.image as CanvasImageSource, 0, 0, S, S);
  const px = g.getImageData(0, 0, S, S).data;
  const uv = geo.attributes.uv;
  const n = pos.count;
  const len = new Float32Array(n).fill(1);
  const eye: number[] = [], bare: number[] = [];
  const pink = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    // glTF textures are not flipped: uv (0,0) is the image's top-left
    const x = Math.min(S - 1, Math.max(0, Math.floor(uv.getX(i) * S)));
    const y = Math.min(S - 1, Math.max(0, Math.floor(uv.getY(i) * S)));
    const k = (y * S + x) * 4, r = px[k], gg = px[k + 1], b = px[k + 2];
    if (r > 90 && r - gg > 35 && r - b > 25) pink[i] = 1;
    if (b > r + 25 && b > gg + 8) eye.push(i);                       // blue iris
    else if (r > 90 && r - gg > 45 && r - b > 25) bare.push(i);       // pink nose, ear skin, red pads
  }
  let nose0 = -1;
  for (const i of bare) if (nose0 < 0 || pos.getX(i) > pos.getX(nose0)) nose0 = i;
  const nosePt = nose0 >= 0 ? new THREE.Vector3().fromBufferAttribute(pos, nose0) : null;
  const p = new THREE.Vector3(), q = new THREE.Vector3();
  const widen = (set: number[], inner: number, outer: number) => {
    const pts = set.map((i) => new THREE.Vector3().fromBufferAttribute(pos, i));
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i);
      let d = Infinity;
      for (const s of pts) { const dd = q.copy(s).sub(p).lengthSq(); if (dd < d) d = dd; }
      d = Math.sqrt(d);
      len[i] = Math.min(len[i], THREE.MathUtils.smoothstep(d, inner, outer));
    }
  };
  // the eyes: each eye is the circle its blue iris draws; iris and pupil inside it stay bare, nothing around it
  if (!realParts) for (const side of [1, -1]) {      // painted eyes only — a model with real eyeballs skips this
    const pts = eye.filter((i) => Math.sign(pos.getZ(i)) === side).map((i) => new THREE.Vector3().fromBufferAttribute(pos, i));
    if (pts.length < 3) continue;
    const c = pts.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(pts.length);
    const r = Math.max(...pts.map((v) => v.distanceTo(c)));
    for (let i = 0; i < n; i++) if (p.fromBufferAttribute(pos, i).distanceTo(c) < r * 1.02) len[i] = 0;
  }
  widen(bare, 0.003 * height, 0.008 * height);   // nose leather, paw pads
  // Whiskers (at the muzzle and above the eyes) are small separate pieces of the mesh, long and thin.
  // They never carry fur (Stefanie, 2026-10-01).
  // (a model with its own whisker mesh skips this: on it, these 'pieces' are texture islands of her face)
  if (!realParts) for (const v of meshPieces(geo).values()) {
    if (v.length >= 200 || !onHead(v, pos, box)) continue;
    const line = shape(v, pos)[0];
    // a whisker runs along one line; a short curved one, of a few points, may bend a little
    if (line < 0.06 || (v.length < 20 && line < 0.15)) for (const i of v) len[i] = 0;
  }
  // eye openings (real eyeballs sit in them, 2026-10-01): the lid edges are the mesh's open borders. Fur stops
  // short of them, so no strand grows over an eyeball.
  {
    const keyOf = (i: number) => `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`;
    const id = new Map<string, number>(), canon = new Int32Array(n);
    for (let i = 0; i < n; i++) { const k = keyOf(i); if (!id.has(k)) id.set(k, i); canon[i] = id.get(k)!; }
    const edges = new Map<string, number>();
    const idx = geo.index!.array;
    for (let t = 0; t < idx.length; t += 3) for (const [a, b] of [[idx[t], idx[t + 1]], [idx[t + 1], idx[t + 2]], [idx[t + 2], idx[t]]]) {
      const x = canon[a], y = canon[b], k = x < y ? `${x}_${y}` : `${y}_${x}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
    const border = new Set<number>();
    for (const [k, c] of edges) if (c === 1) for (const v of k.split('_')) border.add(Number(v));
    // only the borders at her eyes: with her eyeballs' points given (a model built of pieces has open seams
    // elsewhere too), the borders beside them; otherwise the borders on her head (Tripo's body is otherwise closed)
    const near = 0.025 * height, e = new THREE.Vector3();
    const eyeC = eyePts.map((q2) => new THREE.Vector3(q2.dot(frame.fwd), q2.dot(frame.up), q2.dot(new THREE.Vector3().crossVectors(frame.fwd, frame.up))));
    const eyeBorder = eyeC.length
      ? [...border].filter((i) => { e.fromBufferAttribute(pos, i); return eyeC.some((q2) => q2.distanceToSquared(e) < near * near); })
      : [...border].filter((i) => pos.getX(i) > box.max.x * 0.55 && pos.getY(i) > box.max.y * 0.6);
    if (eyeBorder.length) widen(eyeBorder, 0.012 * height, 0.03 * height);
    // with her eyeballs known, the fur also shortens by the distance to them: lid fur stands out in front of
    // the eye and would cover it
    if (eyeC.length) {
      for (let i = 0; i < n; i++) {
        e.fromBufferAttribute(pos, i);
        let d = Infinity;
        for (const q2 of eyeC) { const dd = q2.distanceToSquared(e); if (dd < d) d = dd; }
        len[i] = Math.min(len[i], THREE.MathUtils.smoothstep(Math.sqrt(d), 0.012 * height, 0.05 * height));
      }
    }
  }
  // what the model itself marks bare (a `_fur` point attribute, 0 = no fur; the toon Minka's ear tufts)
  const own = geo.attributes._fur;
  if (own) for (let i = 0; i < n; i++) len[i] = Math.min(len[i], own.getX(i));
  // the inner-ear lining (pink skin with the guard hairs painted on it)
  const lining = earGuardHairs(geo, pink, pos, box);
  for (const i of lining) len[i] = 0;
  // and its rim: the guard hairs are painted on past the lining's edge, finer than the mesh's points, so the
  // shader drops strands on their pale pixels — only here, within a hair's length of the lining
  const rim = lining.map((i) => new THREE.Vector3().fromBufferAttribute(pos, i));
  const nearEar = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    let d = Infinity;
    for (const r of rim) { const dd = r.distanceToSquared(p); if (dd < d) d = dd; }
    nearEar[i] = 1 - THREE.MathUtils.smoothstep(Math.sqrt(d), 0.022 * height, 0.034 * height);
  }
  geo.setAttribute('furEarRim', new THREE.BufferAttribute(nearEar, 1));
  // short fur on the muzzle (a kitten's face is velvet): around the nose, found from the pink only
  if (nosePt) {
    for (let i = 0; i < n; i++) {
      const d = p.fromBufferAttribute(pos, i).distanceTo(nosePt);
      len[i] *= 0.3 + 0.7 * THREE.MathUtils.smoothstep(d, 0.05 * height, 0.13 * height);
    }
  }
  return len;
}

/** Hand-painted corrections on top of the automatic rules, made with the fur brush (dev: ?lab=minka3d,
 *  mode Erase / Restore) and saved as art/minka/3d/fur-mask.json. Vertex numbers belong to one model. */
export interface FurMask { vertexCount: number; erase: number[]; restore: number[] }

/** Re-applies the automatic fur lengths, then the painted corrections. */
export function applyFurMask(geo: THREE.BufferGeometry, mask: FurMask | null) {
  const attr = geo.attributes.furLen as THREE.BufferAttribute, auto = geo.userData.furAuto as Float32Array;
  const len = attr.array as Float32Array;
  len.set(auto);
  if (mask && mask.vertexCount === len.length) {
    for (const i of mask.restore) len[i] = 1;
    for (const i of mask.erase) len[i] = 0;
  }
  attr.needsUpdate = true;
}

export function addFur(mesh: THREE.SkinnedMesh, opts: Partial<FurOptions> = {}, mask: FurMask | null = null, realParts = false,
  frame: FurFrame = TRIPO_FRAME, eyePts: THREE.Vector3[] = []): THREE.Group {
  const o = { ...FUR_DEFAULTS, ...opts };
  const geo = mesh.geometry;
  geo.computeBoundingBox();
  const height = geo.boundingBox!.getSize(new THREE.Vector3()).length() / 1.6;
  if (!geo.attributes.furLen) {
    const auto = furMask(mesh, height, realParts, frame, eyePts);
    geo.userData.furAuto = auto.slice();
    geo.setAttribute('furLen', new THREE.BufferAttribute(auto, 1));
  }
  applyFurMask(geo, mask);
  const base = mesh.material as THREE.MeshStandardMaterial;
  // strands are square in the texture's pixels: a 2:1 texture gets twice the cells across
  const img = base.map?.image as { width?: number; height?: number } | undefined;
  const aspect = img?.width && img?.height ? img.width / img.height : 1;
  const combDir = frame.fwd.clone().multiplyScalar(-1).addScaledVector(frame.up, -0.55).normalize();
  const group = new THREE.Group();
  group.name = 'fur';
  for (let l = 1; l <= o.layers; l++) {
    const h = l / o.layers;
    const m = new THREE.MeshStandardMaterial({
      map: base.map, normalMap: base.normalMap, roughness: 0.95, metalness: 0,
      alphaToCoverage: true, transparent: false,
    });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uH = { value: h };
      sh.uniforms.uLen = { value: o.length * height };
      sh.uniforms.uGrav = { value: o.gravity };
      sh.uniforms.uDensity = { value: new THREE.Vector2(o.density * aspect, o.density) };
      sh.uniforms.uCombDir = { value: combDir };
      sh.uniforms.uUp = { value: frame.up };
      sh.uniforms.uComb = { value: o.comb };
      sh.uniforms.uDebug = furDebug;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float furLen; attribute float furEarRim; varying float vEarRim; uniform float uH; uniform float uLen; uniform float uGrav; uniform float uComb; uniform vec3 uCombDir; uniform vec3 uUp; varying float vH; varying float vFur;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // strands grow out, then lie down along the body toward the tail and droop a little
          vec3 combDir = uCombDir;
          combDir = normalize(combDir - normal * dot(combDir, normal) + 1e-4);
          float grow = uLen * furLen;
          transformed += normal * grow * uH * (1.0 - 0.45 * uComb * uH);
          transformed += combDir * grow * uComb * pow(uH, 1.4);
          transformed -= uUp * grow * uGrav * uH * uH;
          vH = uH; vFur = furLen; vEarRim = furEarRim;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec2 uDensity; uniform float uDebug; varying float vH; varying float vFur; varying float vEarRim;
          float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          if (vFur < 0.08) discard;
          if (vEarRim > 0.5) {                                   // at the ear opening: no strands on the pale guard hairs
            vec3 t = diffuseColor.rgb;
            float hi = max(t.r, max(t.g, t.b)), lo = min(t.r, min(t.g, t.b));
            if (dot(t, vec3(0.299, 0.587, 0.114)) > 0.3 && hi - lo < 0.42) discard;   // cream to beige hair, not the brown coat
          }
          vec2 c = vMapUv * uDensity;
          vec2 cell = floor(c);
          vec2 f = fract(c) - 0.5 - (vec2(h21(cell + 1.3), h21(cell + 7.1)) - 0.5) * 0.35;
          float r = (0.45 + 0.55 * h21(cell)) * vFur;          // this strand's length
          if (vH > r) discard;
          float rad = 0.48 * (1.0 - vH / r);                     // tapers to a tip
          float a = 1.0 - smoothstep(rad - 0.12, rad, length(f));
          if (a < 0.02) discard;
          diffuseColor.a = a;
          diffuseColor.rgb *= mix(0.72, 1.02, vH);              // shadowed roots, tips true to her coat
          if (uDebug > 1.5) diffuseColor.rgb = vEarRim > 0.5 ? vec3(0.0, 1.0, 0.2) : vec3(1.0, 0.0, 1.0);  // loud: ear-opening zone green
          else if (uDebug > 0.5) diffuseColor.rgb = vec3(1.0, 0.0, 1.0);  // loud: where fur grows`);
    };
    m.customProgramCacheKey = () => 'minka-fur';
    const shell = new THREE.SkinnedMesh(geo, m);
    shell.bind(mesh.skeleton, mesh.bindMatrix);
    shell.castShadow = false;
    shell.receiveShadow = true;
    shell.frustumCulled = false;
    shell.renderOrder = l;
    group.add(shell);
  }
  // the shells sit beside the body mesh, under the same parent, so they inherit the same transform
  mesh.parent!.add(group);
  group.position.copy(mesh.position); group.quaternion.copy(mesh.quaternion); group.scale.copy(mesh.scale);
  return group;
}
