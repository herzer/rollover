// Minka's walk, made in code (2026-10-01). Tripo's only four-legged animation was "ridiculously bad"
// (Stefanie) — its rig was broken — so her new skeleton (scripts/blender/build_rig.py) is walked here.
// The cat walk (references: Muybridge plate 716; lateral-sequence gait studies):
//  - footfall order hind-left, fore-left, hind-right, fore-right, a quarter cycle apart;
//  - each paw is on the ground ~65% of the cycle, pushing back; in the swing the leg folds and reaches forward;
//  - shoulders and hips rise and roll in turn, the back bobs twice per cycle;
//  - the head stays steadier than the body; the tail is held up (kitten) and follows a beat late.
// Every rotation is about a WORLD axis (her sideways axis for swinging legs), turned into each bone's own frame,
// so it does not matter how Blender oriented the bones.

import * as THREE from 'three';

export interface WalkTuning {
  cadence: number;      // steps (full cycles) per second
  swing: number;        // upper-leg swing, degrees either way
  lift: number;         // how much the legs fold in the swing, 0..1.5
  duty: number;         // share of the cycle each paw is down
  bob: number;          // body bob, in her heights
  tailUp: number;       // tail raised, degrees
}

export const KITTEN: WalkTuning = { cadence: 1.15, swing: 22, lift: 1.35, duty: 0.64, bob: 0.014, tailUp: 30 };

type Leg = { upper: THREE.Bone; lower: THREE.Bone; ankle: THREE.Bone; paw: THREE.Bone; phase: number; front: boolean };

export class CatWalk {
  private rest = new Map<THREE.Bone, THREE.Quaternion>();
  private restPos = new Map<THREE.Bone, THREE.Vector3>();
  private worldRest = new Map<THREE.Bone, THREE.Quaternion>();
  private legs: Leg[] = [];
  private bones: Record<string, THREE.Bone> = {};
  private t = 0;
  private tailLag: number[] = [];
  private weight = 0;                   // 0 standing … 1 walking, eased
  walking = false;
  tune: WalkTuning = { ...KITTEN };
  private side = new THREE.Vector3(0, 0, 1);    // her sideways axis (the model faces +x)
  private up = new THREE.Vector3(0, 1, 0);
  private fwd = new THREE.Vector3(1, 0, 0);
  private height = 1;

  constructor(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const b = o as THREE.Bone;
      if (!b.isBone) return;
      this.bones[b.name] = b;
      this.rest.set(b, b.quaternion.clone());
      this.restPos.set(b, b.position.clone());
      this.worldRest.set(b, b.getWorldQuaternion(new THREE.Quaternion()));
    });
    const B = (n: string) => this.bones[n];
    const leg = (fb: 'front' | 'hind', s: 'L' | 'R', phase: number): Leg | null =>
      B(`${fb}_upper${s}`) || B(`${fb}_upper.${s}`)
        ? { upper: B(`${fb}_upper.${s}`) ?? B(`${fb}_upper${s}`), lower: B(`${fb}_lower.${s}`) ?? B(`${fb}_lower${s}`),
            ankle: B(`${fb}_ankle.${s}`) ?? B(`${fb}_ankle${s}`), paw: B(`${fb}_paw.${s}`) ?? B(`${fb}_paw${s}`), phase, front: fb === 'front' }
        : null;
    // lateral sequence: hind-L 0, fore-L .25, hind-R .5, fore-R .75
    for (const l of [leg('hind', 'L', 0), leg('front', 'L', 0.25), leg('hind', 'R', 0.5), leg('front', 'R', 0.75)]) if (l) this.legs.push(l);
    const box = new THREE.Box3().setFromObject(root);
    this.height = box.max.y - box.min.y || 1;
    this.tailLag = new Array(6).fill(0);
  }

  get ok() { return this.legs.length === 4; }

  private b(name: string): THREE.Bone | undefined {
    return this.bones[name] ?? this.bones[name.replace('.', '')];
  }

  /** Sets a bone to its rest pose turned by `angle` about a world axis (plus an optional extra world turn). */
  private turn(bone: THREE.Bone | undefined, axis: THREE.Vector3, angleDeg: number, extraWorld?: THREE.Quaternion) {
    if (!bone) return;
    const wr = this.worldRest.get(bone)!;
    const world = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(angleDeg));
    if (extraWorld) world.premultiply(extraWorld);
    // a world rotation, seen from the bone's own frame: wr⁻¹ · world · wr
    const local = wr.clone().invert().multiply(world).multiply(wr);
    bone.quaternion.copy(this.rest.get(bone)!).multiply(local);
  }

  /** Leaves every bone in its rest pose. */
  stand() {
    for (const [b, q] of this.rest) b.quaternion.copy(q);
    for (const [b, p] of this.restPos) b.position.copy(p);
  }

  update(dt: number) {
    this.weight += ((this.walking ? 1 : 0) - this.weight) * Math.min(1, dt * 5);
    if (this.weight < 0.001 && !this.walking) { this.stand(); return; }
    const w = this.weight, T = this.tune;
    this.t += dt * T.cadence * (0.35 + 0.65 * w);
    const cyc = this.t % 1;

    // legs
    for (const L of this.legs) {
      const p = (cyc - L.phase + 1) % 1;
      let swingAng: number, fold: number;
      if (p < T.duty) {                       // stance: paw on the ground, sweeping back
        const u = p / T.duty;
        swingAng = THREE.MathUtils.lerp(T.swing, -T.swing, u);
        fold = 0;
      } else {                                // swing: folds, lifts and reaches forward
        const u = (p - T.duty) / (1 - T.duty);
        const e = 0.5 - 0.5 * Math.cos(Math.PI * u);
        swingAng = THREE.MathUtils.lerp(-T.swing, T.swing * 1.1, e);
        fold = Math.sin(Math.PI * u) * T.lift;
      }
      swingAng *= w; fold *= w;
      this.turn(L.upper, this.side, swingAng);
      if (L.front) {                          // elbow back, wrist curls, paw tips down
        this.turn(L.lower, this.side, -38 * fold);
        this.turn(L.ankle, this.side, -30 * fold);
        this.turn(L.paw, this.side, 20 * fold);
      } else {                                // knee and hock fold, foot flicks
        this.turn(L.lower, this.side, 30 * fold);
        this.turn(L.ankle, this.side, -42 * fold);
        this.turn(L.paw, this.side, 25 * fold);
      }
    }

    // body: bob twice a cycle, shoulders and hips roll in turn, a little side-to-side
    const a = cyc * Math.PI * 2;
    const root = this.b('root');
    if (root) {
      root.position.copy(this.restPos.get(root)!);
      root.position.y += Math.abs(Math.sin(a)) * T.bob * this.height * 0.5 * w - T.bob * this.height * 0.25 * w;
    }
    this.turn(this.b('pelvis'), this.fwd, 4 * Math.sin(a) * w);
    this.turn(this.b('spine'), this.up, 3 * Math.sin(a + 0.6) * w);
    this.turn(this.b('chest'), this.fwd, -4 * Math.sin(a + Math.PI / 2) * w);
    // head: steadier than the body — a small counter-sway and a nod at each step
    this.turn(this.b('neck'), this.fwd, 2.5 * Math.sin(a + Math.PI / 2) * w);
    this.turn(this.b('head'), this.side, -2.5 * Math.sin(a * 2) * w);
    // tail: held up, swaying a beat late, each segment later than the last
    const lagTarget = Math.sin(a - 1.2);
    for (let i = 0; i < 5; i++) {
      this.tailLag[i] += ((i ? this.tailLag[i - 1] : lagTarget) - this.tailLag[i]) * Math.min(1, dt * 6);
      const up = i === 0 ? T.tailUp * (0.4 + 0.6 * w) : -6;
      const q = new THREE.Quaternion().setFromAxisAngle(this.up, THREE.MathUtils.degToRad(14 * this.tailLag[i] * w));
      this.turn(this.b(`tail.${i}`), this.side, up, q);
    }
  }
}
