// The Greenway's enemies, built in code: flat-shaded low-poly in PALETTE colours, each ONE rigid-skinned mesh
// (plus one emissive mesh for eyes, glowing tips and sparks) driven by a small bone hierarchy, so each enemy
// costs two draw calls. Animation is procedural: idle, run, a readable wind-up for every telegraphed attack
// (the anticipation pose is mostly in place within 0.15–0.2 s, and the body warms toward roof-orange while
// its glow parts flare), the strike that releases it, hit flinch and flash, stun and death.
//
// Server state drives it through net/enemies.ts: setMode follows the enemy's mode, strike() fires when a
// wind-up resolves (and, from Task 8, on auto attacks), hit() and flash() on damage.
import {
  Scene, TransformNode, Mesh, Skeleton, Bone, Matrix, Vector3, Color3, StandardMaterial, FresnelParameters,
  MeshBuilder, DynamicTexture, BoundingInfo, VertexBuffer, type InstancedMesh,
} from '@babylonjs/core';
import { ENEMY_ATTACKS, ENEMY_KINDS, type EnemyAttackId, type EnemyKindId } from '@sg2/shared';
import { Builder, hex, mix, tint, type RGB, type V3 } from '../world/mesh';
import { PAL } from '../world/parts';
import { PALETTE } from '../core/contracts';
import { WICKHOUND, FALLEN_WARDEN, LENS_SHARD, BOSS_DRAW, BOSS_CADENCE } from './bossModels';

/** 'phase': a boss's transition between phases (invulnerable, still; net/enemies.ts holds it for the boss's transitionS). */
export type EnemyMode = 'idle' | 'run' | 'windup' | 'stunned' | 'dead' | 'return' | 'phase';
export interface EnemyView {
  readonly root: TransformNode; readonly height: number; readonly radius: number;
  /** metadata { entityId } on every pickable mesh. */
  setEntityId(id: number): void;
  /** windup plays over `seconds` (default: the attack's wind-up). Setting the mode it already has does nothing. */
  setMode(mode: EnemyMode, attack?: EnemyAttackId, seconds?: number, elapsed?: number): void;
  /** The chase surge: a pulsing cold tint while it runs to catch up. */
  setSurging(on: boolean): void;
  /** Back to a fresh idle enemy (a pooled view about to be used for another enemy of its kind). */
  reset(): void;
  /** The attack lands: releases the wind-up in progress (or just ended), else a quick auto attack. */
  strike(): void;
  /** A flinch. */ hit(): void;
  /** A white flash (on damage). */ flash(): void;
  setTargeted(on: boolean): void;
  /** Bosses (Plan 4): the 0-based phase (its look changes with it), warded (a Lens Shard lives) and enraged. */
  setBoss(phase: number, warded: boolean, enraged: boolean): void;
  /** A beam from this enemy to a world point (the Lens Shard's ward on the Warden), or null for none. */
  setTether(p: { x: number; y: number; z: number } | null): void;
  update(dt: number): void;
  dispose(): void;
}

// ───────────────────────── colours ─────────────────────────
const P = {
  leaf1: PAL.leaf1, leaf2: PAL.leaf2, leafDeep: PAL.leafDeep, bramble: hex('#2f6e45'),
  roof: hex(PALETTE.roof), roof2: PAL.roof2, orange: PAL.roof4, gold: hex(PALETTE.gold),
  cliff: hex(PALETTE.cliff), rock: hex(PALETTE.rock), rock3: PAL.rock3, rock1: PAL.rock1,
  stone: hex(PALETTE.stone), stone2: PAL.stone2, plinth: PAL.plinth, plinthDark: PAL.plinthDark,
  teal: hex(PALETTE.teal), tealDark: hex('#2b867f'), meadow: hex(PALETTE.meadow), grass2: PAL.grass2,
  wood: PAL.wood, woodDark: PAL.woodDark, woodLight: PAL.woodLight, lamp: PAL.lamp, cream: hex('#f6ead6'),
  hollow: hex('#1d1426'), straw: hex('#e9c46a'), straw2: hex('#c99a4a'),
  // contrast against grass: the Thornling's bulb is dark plum with an ochre underside; the Archer's robe plum and cliff red
  thornBulb: hex('#5a3a5e'), thornBulb2: hex('#b77a3a'), archRobe: hex('#9a6a3e'), archRobe2: hex('#5e3b2a'), archHood: hex('#c0605a'),
};

// ───────────────────────── model building: parts on rigid bones ─────────────────────────
export interface JointDef { name: string; parent: number; pivot: V3 }

export class Model {
  readonly b: Builder; readonly g: Builder;
  readonly joints: JointDef[] = [];
  readonly bIdx: number[] = []; readonly gIdx: number[] = [];
  constructor(seed: number) { this.b = new Builder(seed); this.g = new Builder(seed + 1); this.b.cj = 0.05; this.g.cj = 0; }
  joint(name: string, parent: string | null, pivot: V3): void {
    this.joints.push({ name, parent: parent === null ? -1 : this.index(parent), pivot });
  }
  index(name: string): number { const i = this.joints.findIndex(j => j.name === name); if (i < 0) throw new Error(`no joint ${name}`); return i; }
  /** Builds geometry (model space, rest pose) that moves with joint `name`. */
  on(name: string, f: (b: Builder, g: Builder) => void): void {
    const j = this.index(name);
    f(this.b, this.g);
    while (this.bIdx.length < this.b.pos.length / 3) this.bIdx.push(j);
    while (this.gIdx.length < this.g.pos.length / 3) this.gIdx.push(j);
  }
}

/** Per-joint pose values, written every frame: rotation, offset from rest, scale. */
export type PoseVals = Float32Array; // [rx, ry, rz, px, py, pz, sx, sy, sz] × joints
const NV = 9;

export interface Anim {
  T: number; mode: EnemyMode; attack: EnemyAttackId | null;
  /** Bosses: the phase (0-based), time since the 'phase' mode began (−1 none), warded, enraged. */
  bossPhase: number; phaseT: number; warded: boolean; enraged: boolean;
  /** setTether's point in model space (tOn false: none). */
  tOn: boolean; tx: number; ty: number; tz: number;
  /** Time since the wind-up started, and its length. */ wT: number; wDur: number;
  /** Time since the strike started (−1 = none) and what it released (null = an auto). */ sT: number; sAttack: EnemyAttackId | null;
  hT: number; deadT: number; stunT: number; speed: number; phase: number;
}
export interface KindDef {
  height: number;
  build(m: Model): void;
  pose(o: Poser, a: Anim): void;
  /** The glow parts' brightness now (default: the shared pulse, brighter in wind-ups, flickering when stunned). */
  glow?(a: Anim, base: number): number;
}

/** Writes pose values by joint name (indices looked up once). */
export class Poser {
  v: PoseVals;
  private ix = new Map<string, number>();
  constructor(m: Model) { this.v = new Float32Array(m.joints.length * NV); m.joints.forEach((j, i) => this.ix.set(j.name, i)); }
  reset() { const v = this.v; v.fill(0); for (let i = 0; i < v.length; i += NV) { v[i + 6] = v[i + 7] = v[i + 8] = 1; } }
  private o(j: string) { const i = this.ix.get(j); if (i === undefined) throw new Error(`no joint ${j}`); return i * NV; }
  rot(j: string, x: number, y = 0, z = 0) { const o = this.o(j); this.v[o] += x; this.v[o + 1] += y; this.v[o + 2] += z; }
  pos(j: string, x: number, y = 0, z = 0) { const o = this.o(j); this.v[o + 3] += x; this.v[o + 4] += y; this.v[o + 5] += z; }
  scale(j: string, x: number, y = x, z = x) { const o = this.o(j); this.v[o + 6] *= x; this.v[o + 7] *= y; this.v[o + 8] *= z; }
  /** Sets the scale outright (for parts hidden at rest, scale 0, that a pose shows). */
  setScale(j: string, x: number, y = x, z = x) { const o = this.o(j); this.v[o + 6] = x; this.v[o + 7] = y; this.v[o + 8] = z; }
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
/** Fast ease-out: most of the way there by half of `d` (readable anticipation). */
const rise = (t: number, d: number) => { const k = 1 - clamp01(t / d); return 1 - k * k * k; };
/** A quick out-and-back pulse over d seconds, peaking at `peak` (0..1 of d). */
const pulse = (t: number, d: number, peak = 0.3) => (t < 0 || t > d ? 0 : t < d * peak ? ease(t / (d * peak)) : 1 - ease((t - d * peak) / (d * (1 - peak))));
/** Spring-like decaying wobble. */
const wobble = (t: number, f: number, decay: number) => (t < 0 ? 0 : Math.exp(-decay * t) * Math.sin(t * f));

const fib = (n: number, i: number): V3 => { // even directions on a sphere (Fibonacci)
  const y = 1 - (i + 0.5) / n * 2, r = Math.sqrt(1 - y * y), a = i * 2.39996;
  return [Math.cos(a) * r, y, Math.sin(a) * r];
};

// ───────────────────────── Thornling ─────────────────────────
const THORNLING: KindDef = {
  height: 0.95,
  build(m) {
    m.joint('body', null, [0, 0.5, 0]);
    m.joint('thorns', 'body', [0, 0.5, 0]);
    m.joint('burst', 'body', [0, 0.5, 0]);
    m.joint('crown', 'body', [0, 0.82, 0]);
    m.joint('legL', null, [-0.15, 0.24, 0]);
    m.joint('legR', null, [0.15, 0.24, 0]);
    const C: V3 = [0, 0.5, 0];
    m.on('body', (b, g) => {
      b.ball(C, 0.35, P.thornBulb, 1.05, 0.95, 1.05, 1, 0.38, P.thornBulb2);
      // bramble wraps round the bulb
      for (let k = 0; k < 5; k++) { const a = k * 1.25; b.prism([Math.cos(a) * 0.36, 0.3 + k * 0.08, Math.sin(a) * 0.36], [Math.cos(a + 1.6) * 0.36, 0.42 + k * 0.08, Math.sin(a + 1.6) * 0.36], 0.035, 0.035, 4, P.bramble, { caps: false }); }
      // a dark mouth and two gold eyes
      b.box(0, 0.42, 0.33, 0.16, 0.05, 0.04, P.hollow);
      for (const sx of [-1, 1]) { b.ball([sx * 0.12, 0.57, 0.3], 0.07, P.hollow, 1, 0.8, 0.6, 0); g.ball([sx * 0.12, 0.575, 0.335], 0.06, P.lamp, 1, 0.85, 0.6, 0); }
    });
    m.on('thorns', (b) => {
      for (let i = 0; i < 18; i++) {
        const d = fib(20, i); if (d[1] < -0.55) continue;
        const base: V3 = [C[0] + d[0] * 0.2, C[1] + d[1] * 0.2, C[2] + d[2] * 0.2], tip: V3 = [C[0] + d[0] * 0.56, C[1] + d[1] * 0.56, C[2] + d[2] * 0.56];
        b.prism(base, tip, 0.07, 0, 4, P.roof, { col2: P.roof2 });
      }
    });
    m.on('burst', (_b, g) => { // glowing thorn tips, shown while it winds up
      for (let i = 0; i < 18; i++) {
        const d = fib(20, i); if (d[1] < -0.55) continue;
        g.ball([C[0] + d[0] * 0.5, C[1] + d[1] * 0.5, C[2] + d[2] * 0.5], 0.04, P.orange, 1, 1, 1, 0);
      }
    });
    m.on('crown', (b) => {
      for (let k = 0; k < 3; k++) { const a = k * 2.09; b.ball([Math.cos(a) * 0.1, 0.9, Math.sin(a) * 0.1], 0.13, k === 1 ? hex('#5cbf86') : P.leaf2, 1.3, 0.35, 0.7, 0, 0.2); }
      b.prism([0, 0.8, 0], [0.02, 0.98, 0.0], 0.03, 0.02, 4, P.bramble);
      b.ball([0.02, 1.0, 0], 0.045, P.roof, 1, 1, 1, 0);
    });
    for (const [j, sx] of [['legL', -1], ['legR', 1]] as const) m.on(j, (b) => {
      b.prism([sx * 0.15, 0.3, 0], [sx * 0.17, 0.05, 0.03], 0.07, 0.06, 5, P.bramble);
      b.ball([sx * 0.17, 0.05, 0.07], 0.085, P.woodDark, 1, 0.6, 1.4, 0);
    });
  },
  pose(o, a) {
    const { T } = a;
    o.rot('body', 0, 0, 0.04 * Math.sin(T * 1.3)); o.pos('body', 0, 0.015 * Math.sin(T * 2.2));
    o.rot('crown', 0, 0, 0.15 * Math.sin(T * 2.7)); o.scale('thorns', 1 + 0.03 * Math.sin(T * 2.2));
    o.scale('burst', 0);
    if (a.mode === 'run' || a.mode === 'return') {
      const s = Math.sin(a.phase * Math.PI * 2);
      o.pos('body', 0, Math.abs(s) * 0.08); o.rot('body', 0.15);
      o.rot('legL', 0.7 * s); o.rot('legR', -0.7 * s);
    }
    if (a.mode === 'windup' && a.attack === 'thorn_burst') {
      const k = rise(a.wT, 0.15), g = 1 + 0.6 * rise(a.wT, 0.22) + 0.08 * clamp01(a.wT / a.wDur);
      o.pos('body', 0, -0.12 * k); o.scale('body', 1 + 0.1 * k, 1 - 0.16 * k, 1 + 0.1 * k);
      o.setScale('thorns', g); o.setScale('burst', g * (0.75 + 0.25 * Math.abs(Math.sin(T * 9))));
      o.rot('body', 0.07 * k * Math.sin(T * 47), 0, 0.07 * k * Math.sin(T * 53 + 1));
      o.rot('legL', 0, 0, -0.35 * k); o.rot('legR', 0, 0, 0.35 * k);
      o.rot('crown', -0.3 * k);
    }
    if (a.sT >= 0) {
      if (a.sAttack === 'thorn_burst') {
        const p = pulse(a.sT, 0.4, 0.15);
        o.setScale('thorns', 1 + 0.9 * p); o.setScale('burst', 2.2 * p); o.pos('body', 0, 0.12 * p);
      } else { const p = pulse(a.sT, 0.35, 0.3); o.pos('body', 0, 0, 0.28 * p); o.rot('body', 0.45 * p); }
    }
    if (a.hT >= 0) { o.rot('body', -0.4 * pulse(a.hT, 0.3, 0.2)); o.pos('body', 0, 0, -0.08 * pulse(a.hT, 0.3, 0.2)); }
    if (a.mode === 'stunned') { o.rot('body', 0.18 * Math.sin(T * 2.3 + 1), 0, 0.28 * Math.sin(T * 3)); o.rot('crown', 0.5); }
    if (a.mode === 'dead') { const k = ease(a.deadT / 0.5); o.rot('body', 0, 0, -1.45 * k); o.pos('body', 0.1 * k, -0.18 * k); o.scale('thorns', 1 - 0.35 * k); o.rot('legL', -0.8 * k); o.rot('legR', 0.4 * k); }
  },
};

// ───────────────────────── Bramble Boar ─────────────────────────
const BOAR: KindDef = {
  height: 1.3,
  build(m) {
    m.joint('body', null, [0, 0.78, 0]);
    m.joint('head', 'body', [0, 0.82, 0.72]);
    m.joint('mane', 'body', [0, 1.1, 0.05]);
    m.joint('tail', 'body', [0, 0.9, -0.88]);
    m.joint('legFL', 'body', [-0.3, 0.6, 0.48]); m.joint('legFR', 'body', [0.3, 0.6, 0.48]);
    m.joint('legBL', 'body', [-0.3, 0.6, -0.5]); m.joint('legBR', 'body', [0.3, 0.6, -0.5]);
    m.joint('dust', null, [0, 0.1, -0.8]);
    m.on('body', (b) => {
      b.ball([0, 0.8, 0], 0.6, P.cliff, 0.85, 0.72, 1.45, 1, 0.25, P.rock3);
      b.ball([0, 1.04, -0.12], 0.45, P.rock, 0.95, 0.38, 1.3, 1, 0.3, tint(P.rock, 0.8)); // the rock-purple saddle
      b.ball([0, 0.88, 0.5], 0.45, P.cliff, 0.95, 0.85, 0.7, 1, 0.25, P.rock3);            // shoulders
    });
    m.on('mane', (b) => {
      for (let k = 0; k < 8; k++) {
        const z = 0.62 - k * 0.15, y = 1.12 - Math.abs(z - 0.1) * 0.12, h = 0.24 + 0.12 * Math.sin(k * 1.7) ** 2;
        for (const sx of [-1, 1]) b.prism([sx * 0.06, y - 0.05, z], [sx * 0.15, y + h, z - 0.08], 0.06, 0.0, 4, k % 2 ? P.bramble : P.leafDeep);
        if (k % 2 === 0) b.prism([0, y, z], [0, y + h * 0.8, z + 0.05], 0.035, 0, 3, P.roof);
      }
    });
    m.on('head', (b, g) => {
      b.ball([0, 0.82, 0.98], 0.33, P.cliff, 0.95, 0.85, 1.05, 1, 0.25, P.rock3);
      b.prism([0, 0.76, 1.1], [0, 0.68, 1.45], 0.21, 0.15, 6, P.rock1, { col2: P.cliff });
      b.ball([0, 0.68, 1.46], 0.14, P.rock3, 1, 0.8, 0.45, 0);
      for (const sx of [-1, 1]) {
        b.ball([sx * 0.05, 0.69, 1.52], 0.03, P.hollow, 1, 1, 0.5, 0);
        b.prism([sx * 0.13, 0.62, 1.3], [sx * 0.22, 0.86, 1.46], 0.05, 0, 5, P.cream);           // tusks
        b.prism([sx * 0.16, 0.98, 0.88], [sx * 0.28, 1.16, 0.8], 0.08, 0, 4, P.rock3);           // ears
        b.ball([sx * 0.17, 0.88, 1.12], 0.055, P.hollow, 1, 1, 0.7, 0);
        g.ball([sx * 0.17, 0.885, 1.15], 0.035, hex('#ff8a3c'), 1, 1, 0.7, 0);                  // ember eyes
      }
    });
    m.on('tail', (b) => { b.prism([0, 0.9, -0.88], [0, 0.66, -1.05], 0.04, 0.03, 4, P.rock3); b.ball([0, 0.63, -1.07], 0.08, P.bramble, 1, 1.3, 1, 0); });
    for (const [j, x, z] of [['legFL', -0.3, 0.48], ['legFR', 0.3, 0.48], ['legBL', -0.3, -0.5], ['legBR', 0.3, -0.5]] as const) m.on(j, (b) => {
      b.prism([x, 0.62, z], [x * 1.05, 0.08, z + 0.03], 0.12, 0.09, 6, P.rock);
      b.ball([x * 1.05, 0.06, z + 0.06], 0.1, P.woodDark, 1, 0.7, 1.3, 0);
    });
    m.on('dust', (b) => {
      for (const [x, y, z, r] of [[-0.35, 0.15, -0.8, 0.2], [0.35, 0.12, -0.85, 0.22], [0, 0.25, -1.05, 0.26], [-0.2, 0.32, -1.2, 0.18], [0.25, 0.3, -1.15, 0.2]] as const) b.ball([x, y, z], r, mix(P.stone2, P.straw2, 0.3), 1, 0.8, 1, 0, 0.3);
    });
  },
  pose(o, a) {
    const { T } = a;
    o.pos('body', 0, 0.012 * Math.sin(T * 1.8)); o.rot('head', 0.08 * Math.sin(T * 0.9), 0.12 * Math.sin(T * 0.5)); o.rot('tail', 0, 0, 0.35 * Math.sin(T * 5));
    o.scale('dust', 0);
    if (a.mode === 'run' || a.mode === 'return') {
      const s = Math.sin(a.phase * Math.PI * 2);
      o.rot('legFL', 0.6 * s); o.rot('legBR', 0.6 * s); o.rot('legFR', -0.6 * s); o.rot('legBL', -0.6 * s);
      o.pos('body', 0, 0.05 * Math.abs(Math.sin(a.phase * Math.PI * 4))); o.rot('body', 0.05 * Math.sin(a.phase * Math.PI * 4)); o.rot('head', -0.05);
    }
    if (a.mode === 'windup' && a.attack === 'gore_charge') {
      const k = rise(a.wT, 0.15), paw = Math.sin(T * 13);
      o.rot('head', 0.5 * k); o.rot('body', 0.13 * k); o.pos('body', 0, -0.07 * k);
      o.rot('legFL', -0.25 * k); o.rot('legFR', -0.25 * k);
      o.rot('legBL', 0.65 * k * paw); o.rot('legBR', -0.65 * k * Math.sin(T * 13 + 1.6));
      o.setScale('dust', k * (0.65 + 0.35 * Math.abs(paw)), k * (0.6 + 0.6 * Math.abs(paw)), k * (0.65 + 0.35 * Math.abs(paw)));
      o.pos('dust', 0, 0.08 * Math.abs(paw));
      o.scale('mane', 1, 1 + 0.45 * k, 1); o.rot('mane', -0.12 * k);
      o.rot('body', 0, 0, 0.04 * k * Math.sin(T * 31));
    }
    if (a.sT >= 0) {
      if (a.sAttack === 'gore_charge') { const p = pulse(a.sT, 0.55, 0.25); o.pos('body', 0, 0.04 * p, 0.6 * p); o.rot('head', -0.4 * p); o.rot('legFL', -0.7 * p); o.rot('legFR', -0.7 * p); o.rot('legBL', 0.6 * p); o.rot('legBR', 0.6 * p); o.setScale('dust', 0.6 * p); }
      else { const p = pulse(a.sT, 0.4, 0.35); o.rot('head', 0.35 * p - 0.25 * pulse(a.sT - 0.14, 0.26)); o.pos('body', 0, 0, 0.25 * p); }
    }
    if (a.hT >= 0) { const p = pulse(a.hT, 0.3, 0.2); o.rot('body', 0, 0, 0.12 * p); o.pos('body', 0, 0, -0.1 * p); }
    if (a.mode === 'stunned') { o.rot('body', 0, 0, 0.1 * Math.sin(T * 3)); o.rot('head', 0.35 + 0.1 * Math.sin(T * 2)); o.rot('legFL', 0.15 * Math.sin(T * 4)); }
    if (a.mode === 'dead') { const k = ease(a.deadT / 0.55); o.rot('body', 0, 0, 1.45 * k); o.pos('body', 0, -0.32 * k); o.rot('head', 0.2 * k); for (const l of ['legFL', 'legFR', 'legBL', 'legBR']) o.rot(l, 0, 0, -0.3 * k); }
  },
};

// ───────────────────────── Hollow Archer ─────────────────────────
const ARCHER: KindDef = {
  height: 1.8,
  build(m) {
    m.joint('hips', null, [0, 0.9, 0]);
    m.joint('hem', 'hips', [0, 0.6, 0]);
    m.joint('torso', 'hips', [0, 1.0, 0]);
    m.joint('head', 'torso', [0, 1.42, 0]);
    m.joint('armL', 'torso', [-0.2, 1.32, 0.02]);
    m.joint('armR', 'torso', [0.2, 1.32, 0.02]);
    m.joint('bow', 'armL', [-0.25, 0.94, 0.2]);
    m.joint('arrow', 'bow', [-0.25, 0.94, 0.2]);
    m.joint('legL', null, [-0.09, 0.6, 0]); m.joint('legR', null, [0.09, 0.6, 0]);
    m.on('hips', (b) => {
      b.prism([0, 1.0, 0], [0, 0.6, 0], 0.17, 0.3, 8, P.archRobe, { caps: false, col2: P.archRobe2 });
      b.prism([0, 1.08, 0], [0, 0.96, 0], 0.16, 0.18, 7, P.woodDark, { caps: false });                 // a twisted belt
    });
    m.on('hem', (b) => {
      b.prism([0, 0.61, 0], [0, 0.3, -0.03], 0.3, 0.37, 8, P.archRobe2, { caps: false, col2: P.cliff });
      for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; b.ball([Math.cos(a) * 0.36, 0.31, Math.sin(a) * 0.36 - 0.03], 0.075, k % 2 ? P.meadow : P.grass2, 1.2, 0.7, 1, 0, 0.3); }
    });
    m.on('torso', (b) => {
      b.prism([0, 0.98, 0], [0, 1.36, 0], 0.13, 0.16, 6, P.woodDark);
      b.ball([0, 1.33, 0], 0.24, P.archRobe, 1.2, 0.5, 1, 1, 0.3, P.archRobe2);      // mantle
      for (let k = 0; k < 4; k++) b.ball([(k - 1.5) * 0.12, 1.43, -0.05 + (k % 2) * 0.06], 0.07, P.meadow, 1, 0.6, 1, 0, 0.3);
      b.prism([0.08, 1.0, -0.18], [0.15, 1.5, -0.2], 0.06, 0.07, 6, P.woodLight);      // quiver
      for (let k = 0; k < 3; k++) b.prism([0.12 + k * 0.02, 1.5, -0.2], [0.13 + k * 0.03, 1.65, -0.22], 0.03, 0.0, 3, P.roof);
    });
    m.on('head', (b, g) => {
      b.prism([0, 1.37, 0.0], [0, 1.86, -0.08], 0.19, 0.0, 7, P.archHood, { col2: P.archRobe2 }); // the hood
      b.ball([0, 1.53, 0.07], 0.12, P.hollow, 1, 1.1, 0.75, 0);                              // the hollow inside
      g.ball([0, 1.52, 0.115], 0.075, mix(P.lamp, P.orange, 0.5), 0.9, 1.2, 0.3, 0);           // its lamp glow
      for (const sx of [-1, 1]) g.ball([sx * 0.045, 1.56, 0.15], 0.026, P.lamp, 1, 0.8, 0.5, 0);
    });
    m.on('armL', (b) => { b.prism([-0.2, 1.32, 0.02], [-0.25, 0.94, 0.18], 0.04, 0.035, 5, P.woodDark); b.ball([-0.25, 0.94, 0.2], 0.05, P.woodDark, 1, 1, 1, 0); });
    m.on('armR', (b) => { b.prism([0.2, 1.32, 0.02], [0.24, 0.94, 0.14], 0.04, 0.035, 5, P.woodDark); b.ball([0.24, 0.94, 0.16], 0.05, P.woodDark, 1, 1, 1, 0); });
    m.on('bow', (b) => {
      const x = -0.25;
      b.chain([[x, 0.24, 0.13], [x, 0.56, 0.22], [x, 0.94, 0.26], [x, 1.32, 0.22], [x, 1.64, 0.13]], [0.022, 0.03, 0.036, 0.03, 0.022], P.woodLight, 5);
      b.prism([x, 0.86, 0.26], [x, 1.02, 0.26], 0.045, 0.045, 5, P.roof);              // the grip wrap
      b.prism([x, 0.24, 0.12], [x, 1.64, 0.12], 0.007, 0.007, 3, P.cream, { caps: false });
    });
    m.on('arrow', (b, g) => {
      const x = -0.23;
      b.prism([x, 0.94, -0.42], [x, 0.94, 0.62], 0.015, 0.015, 4, P.woodLight, { caps: false });
      for (const s of [-1, 1]) b.tri([x, 0.94, -0.42], [x, 0.94 + s * 0.06, -0.36], [x, 0.94, -0.26], P.roof);
      b.prism([x, 0.94, 0.6], [x, 0.94, 0.74], 0.035, 0, 4, P.bramble);
      g.ball([x, 0.94, 0.68], 0.05, P.orange, 1, 1, 1.4, 0);                             // the tip glows
    });
    for (const [j, sx] of [['legL', -1], ['legR', 1]] as const) m.on(j, (b) => {
      b.prism([sx * 0.09, 0.62, 0], [sx * 0.11, 0.04, 0.03], 0.04, 0.03, 4, P.woodDark);
      b.ball([sx * 0.11, 0.04, 0.07], 0.05, P.woodDark, 1, 0.6, 1.5, 0);
    });
  },
  pose(o, a) {
    const { T } = a;
    o.pos('hips', 0, 0.015 * Math.sin(T * 1.6)); o.rot('torso', 0, 0, 0.04 * Math.sin(T * 0.8)); o.rot('head', 0, 0.25 * Math.sin(T * 0.4));
    o.rot('hem', 0.05 * Math.sin(T * 2.3)); o.rot('armR', 0.05 * Math.sin(T * 1.1));
    o.scale('arrow', 0);
    if (a.mode === 'run' || a.mode === 'return') {
      const s = Math.sin(a.phase * Math.PI * 2);
      o.pos('hips', 0, 0.03 * Math.abs(s)); o.rot('torso', 0.18); o.rot('legL', 0.5 * s); o.rot('legR', -0.5 * s); o.rot('hem', -0.22); o.rot('armR', 0.3);
    }
    if (a.mode === 'windup' && a.attack === 'briar_volley') {
      const k = rise(a.wT, 0.16), draw = rise(a.wT, 0.6);
      o.rot('torso', -0.32 * k); o.rot('head', -0.35 * k);
      o.rot('armL', -2.15 * k, 0, 0.12 * k); o.rot('bow', 1.0 * k);
      o.rot('armR', -2.0 * k, 0, -0.25 * k - 0.25 * draw);
      o.setScale('arrow', 1); o.pos('arrow', 0, 0, -0.18 * draw);
      o.rot('hem', 0.08 * k);
    }
    if (a.sT >= 0) {
      if (a.sAttack === 'briar_volley') {
        const p = 1 - ease(a.sT / 0.45);
        o.rot('torso', -0.32 * p); o.rot('armL', -2.15 * p); o.rot('bow', 1.0 * p - 0.25 * pulse(a.sT, 0.25, 0.2)); o.rot('armR', -1.2 * p, 0, 0.3 * pulse(a.sT, 0.3, 0.15));
      } else { // a quick direct shot: bow level, a snap of the string hand
        const p = pulse(a.sT, 0.45, 0.4);
        o.rot('armL', -1.45 * p); o.rot('bow', 1.45 * p, 0, 0); o.rot('armR', -1.4 * p, 0, -0.45 * p); o.setScale('arrow', a.sT < 0.18 ? 1 : 0);
      }
    }
    if (a.hT >= 0) { const p = pulse(a.hT, 0.3, 0.2); o.rot('torso', -0.3 * p); o.rot('head', -0.2 * p); }
    if (a.mode === 'stunned') { o.rot('torso', 0.25, 0, 0.2 * Math.sin(T * 2.5)); o.rot('head', 0.4); o.rot('armL', 0.2); o.rot('armR', 0.2); }
    if (a.mode === 'dead') { const k = ease(a.deadT / 0.6); o.pos('hips', 0, -0.45 * k); o.rot('torso', 1.1 * k); o.rot('head', 0.4 * k); o.scale('hem', 1 + 0.3 * k, 1 - 0.4 * k, 1 + 0.3 * k); o.rot('legL', -1.2 * k); o.rot('legR', -1.2 * k); }
  },
};

// ───────────────────────── Mossback (elite) ─────────────────────────
const MOSSBACK: KindDef = {
  height: 3.4,
  build(m) {
    m.joint('hips', null, [0, 1.25, -0.25]);
    m.joint('torso', 'hips', [0, 1.5, -0.15]);
    m.joint('head', 'torso', [0, 2.3, 0.95]);
    m.joint('armL', 'torso', [-1.05, 2.55, 0.35]); m.joint('armR', 'torso', [1.05, 2.55, 0.35]);
    m.joint('fistL', 'armL', [-1.25, 1.3, 0.72]); m.joint('fistR', 'armR', [1.25, 1.3, 0.72]);
    m.joint('legL', 'hips', [-0.55, 1.1, -0.3]); m.joint('legR', 'hips', [0.55, 1.1, -0.3]);
    m.joint('plateL', 'torso', [-0.2, 3.05, -0.35]); m.joint('plateR', 'torso', [0.2, 3.05, -0.35]);
    m.joint('quills', 'torso', [0, 3.0, -0.4]);
    m.joint('sparks', 'head', [0, 3.15, 1.0]);
    const shell = P.stone, shell2 = P.plinth;
    m.on('hips', (b) => { b.ball([0, 1.3, -0.3], 0.75, P.rock, 1.15, 0.8, 0.95, 1, 0.25, tint(P.rock, 0.75)); });
    m.on('torso', (b) => {
      b.ball([0, 2.25, 0.1], 1.08, P.rock, 1.12, 0.92, 1.0, 1, 0.22, tint(P.rock, 0.72));
      b.ball([0, 1.95, 0.62], 0.68, shell2, 1.05, 0.95, 0.55, 1, 0.2, P.plinthDark);        // pale chest
      for (let k = 0; k < 3; k++) b.ball([0, 2.8 - k * 0.45, -0.85 + k * 0.12], 0.22, P.plinthDark, 1, 0.8, 1, 0, 0.3); // spine knobs
      for (const sx of [-1, 1]) {
        b.ball([sx * 0.95, 2.62, 0.3], 0.42, P.meadow, 1.2, 0.55, 1.1, 1, 0.35, P.grass2);   // moss on the shoulders
        b.ball([sx * 0.65, 2.92, 0.1], 0.22, P.meadow, 1.1, 0.6, 1, 0, 0.35);
      }
    });
    for (const [j, sx] of [['plateL', -1], ['plateR', 1]] as const) m.on(j, (b) => {
      b.ball([sx * 0.62, 2.95, -0.35], 0.72, shell, 0.95, 0.42, 1.3, 1, 0.22, shell2);
      b.ball([sx * 0.75, 2.75, 0.3], 0.45, shell, 0.9, 0.4, 0.8, 1, 0.2, shell2);
      for (let k = 0; k < 5; k++) b.ball([sx * (0.45 + 0.12 * (k % 3)), 3.2 + 0.04 * (k % 2), -0.9 + k * 0.32], 0.2 + 0.05 * (k % 2), k % 2 ? P.meadow : P.grass2, 1.2, 0.5, 1.1, 0, 0.35);
      // gold bands across the plates
      b.prism([sx * 0.1, 3.05, -0.05], [sx * 1.15, 2.7, -0.05], 0.06, 0.06, 4, P.gold, { caps: false });
    });
    m.on('quills', (b, g) => {
      for (let k = 0; k < 11; k++) {
        const t = k / 10, x = (t - 0.5) * 1.3, z = -0.4 - 0.35 * Math.cos(t * 3.1) + 0.2, lean = (t - 0.5) * 0.7;
        const base: V3 = [x * 0.7, 2.85, z], tip: V3 = [x * 1.25 + lean, 4.25 + 0.4 * Math.sin(t * 3.14), z - 0.3];
        b.prism(base, tip, 0.1, 0.0, 5, k % 2 ? P.orange : P.roof, { col2: P.gold });
        g.prism([tip[0] - (tip[0] - base[0]) * 0.25, tip[1] - (tip[1] - base[1]) * 0.25, tip[2] - (tip[2] - base[2]) * 0.25], tip, 0.045, 0, 4, P.orange);
        g.ball(tip, 0.075, P.lamp, 1, 1.3, 1, 0);
      }
    });
    m.on('head', (b, g) => {
      b.ball([0, 2.3, 1.15], 0.42, P.rock, 1.1, 0.85, 1.0, 1, 0.25, tint(P.rock, 0.75));
      b.ball([0, 2.5, 1.32], 0.3, P.plinthDark, 1.35, 0.4, 0.6, 0, 0.2);                    // brow ridge
      b.ball([0, 2.1, 1.36], 0.3, P.rock3, 1.1, 0.55, 0.75, 0, 0.2);                       // jaw
      for (const sx of [-1, 1]) {
        b.prism([sx * 0.2, 2.06, 1.48], [sx * 0.28, 2.32, 1.6], 0.06, 0, 4, P.cream);          // tusks
        b.ball([sx * 0.17, 2.4, 1.5], 0.08, P.hollow, 1, 0.8, 0.6, 0);
        g.ball([sx * 0.17, 2.4, 1.54], 0.055, hex('#ffb347'), 1, 0.8, 0.6, 0);
      }
      for (let k = 0; k < 3; k++) b.ball([(k - 1) * 0.2, 2.68, 1.05], 0.14, P.meadow, 1, 0.6, 1, 0, 0.3);
    });
    m.on('sparks', (_b, g) => { for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283; g.ball([Math.cos(a) * 0.5, 3.15 + 0.08 * Math.sin(k * 2), 1.0 + Math.sin(a) * 0.5], 0.07, k % 2 ? P.gold : P.lamp, 1, 1, 1, 0); } });
    for (const [arm, fist, sx] of [['armL', 'fistL', -1], ['armR', 'fistR', 1]] as const) {
      m.on(arm, (b) => {
        b.prism([sx * 1.05, 2.55, 0.35], [sx * 1.25, 1.3, 0.72], 0.36, 0.3, 7, P.rock, { col2: tint(P.rock, 0.85) });
        b.prism([sx * 1.13, 2.05, 0.5], [sx * 1.18, 1.85, 0.56], 0.38, 0.37, 8, P.gold, { caps: false }); // gold band
      });
      m.on(fist, (b) => {
        b.prism([sx * 1.25, 1.3, 0.72], [sx * 1.3, 0.62, 0.98], 0.3, 0.33, 7, P.rock, { col2: tint(P.rock, 0.85) });
        b.prism([sx * 1.27, 0.95, 0.85], [sx * 1.29, 0.8, 0.9], 0.35, 0.36, 8, P.gold, { caps: false });
        b.ball([sx * 1.3, 0.5, 1.02], 0.52, P.plinth, 1.05, 0.92, 1.1, 1, 0.28, P.plinthDark);  // huge fists
        for (let k = 0; k < 3; k++) b.ball([sx * 1.3 + (k - 1) * 0.22, 0.75, 1.42], 0.13, P.plinthDark, 1, 0.8, 0.8, 0);
      });
    }
    for (const [j, sx] of [['legL', -1], ['legR', 1]] as const) m.on(j, (b) => {
      b.prism([sx * 0.55, 1.15, -0.3], [sx * 0.65, 0.2, -0.2], 0.4, 0.33, 7, P.rock);
      b.ball([sx * 0.65, 0.16, -0.08], 0.4, P.plinthDark, 1.1, 0.5, 1.3, 0, 0.25);
    });
  },
  pose(o, a) {
    const { T } = a;
    const br = Math.sin(T * 1.2);
    o.scale('torso', 1 + 0.015 * br); o.rot('torso', 0.03 * br); o.rot('head', 0, 0.2 * Math.sin(T * 0.35));
    o.rot('armL', 0.04 * Math.sin(T * 1.2 + 1)); o.rot('armR', 0.04 * Math.sin(T * 1.2 + 2));
    o.scale('quills', 0, 0, 0); o.scale('sparks', 0);
    if (a.mode === 'run' || a.mode === 'return') {
      const s = Math.sin(a.phase * Math.PI * 2);
      o.rot('armL', 0.45 * s); o.rot('armR', -0.45 * s); o.rot('legL', -0.35 * s); o.rot('legR', 0.35 * s);
      o.rot('torso', 0.08, 0, 0.06 * s); o.pos('hips', 0, 0.07 * Math.abs(Math.sin(a.phase * Math.PI * 4)));
    }
    if (a.mode === 'windup' && a.attack === 'ground_slam') {
      const k = rise(a.wT, 0.2), hold = clamp01(a.wT / a.wDur);
      o.rot('torso', -0.55 * k - 0.08 * hold); o.pos('hips', 0, 0.35 * k);
      o.rot('armL', -2.75 * k, 0, 0.3 * k); o.rot('armR', -2.75 * k, 0, -0.3 * k);
      o.rot('fistL', -0.5 * k); o.rot('fistR', -0.5 * k);
      o.rot('head', -0.35 * k); o.rot('legL', 0.15 * k); o.rot('legR', 0.15 * k);
      o.rot('torso', 0, 0, 0.03 * k * Math.sin(T * 29));
    }
    if (a.mode === 'windup' && a.attack === 'thorn_hail') {
      const k = rise(a.wT, 0.2), up = rise(a.wT, 0.5);
      o.rot('plateL', 0, 0, -0.95 * k); o.rot('plateR', 0, 0, 0.95 * k);
      o.setScale('quills', 1, 0.12 + 0.88 * up, 1);
      o.rot('torso', 0.28 * k); o.rot('head', 0.2 * k); o.rot('armL', -0.35 * k); o.rot('armR', -0.35 * k);
      o.rot('torso', 0, 0, 0.025 * k * Math.sin(T * 23));
    }
    if (a.sT >= 0) {
      if (a.sAttack === 'ground_slam') {
        const down = ease(a.sT / 0.16), back = ease((a.sT - 0.35) / 0.5);
        const v = down * (1 - back);
        o.rot('torso', -0.6 * (1 - down) * (1 - back) + 0.38 * v); o.pos('hips', 0, 0.35 * (1 - down) - 0.18 * v);
        o.rot('armL', -2.75 * (1 - down) + 0.35 * v); o.rot('armR', -2.75 * (1 - down) + 0.35 * v);
      } else if (a.sAttack === 'thorn_hail') {
        const p = pulse(a.sT, 0.35, 0.15), close = 1 - ease(a.sT / 0.4);
        o.setScale('quills', (1 + 0.4 * p) * close, (1 + 0.5 * p) * close, (1 + 0.4 * p) * close);
        o.rot('plateL', 0, 0, -0.95 * close); o.rot('plateR', 0, 0, 0.95 * close); o.rot('torso', 0.28 * close - 0.12 * p);
      } else { // an auto: a heavy right hook
        const p = pulse(a.sT, 0.5, 0.35);
        o.rot('armR', -1.25 * p, 0, -0.25 * p); o.rot('fistR', -0.4 * p); o.rot('torso', 0.1 * p, -0.25 * p);
      }
    }
    if (a.hT >= 0) { const p = pulse(a.hT, 0.35, 0.2); o.rot('torso', -0.12 * p); o.rot('head', -0.15 * p); }
    if (a.mode === 'stunned') {
      o.rot('torso', -0.34 + 0.05 * Math.sin(T * 1.7), 0, 0.08 * Math.sin(T * 1.3)); o.pos('hips', 0, -0.22);
      o.rot('armL', 0.35, 0, 0.2); o.rot('armR', 0.35, 0, -0.2); o.rot('head', -0.3 + 0.12 * Math.sin(T * 2.2));
      o.setScale('sparks', 1); o.rot('sparks', 0, T * 3.2);
    }
    if (a.mode === 'dead') { const k = ease(a.deadT / 0.8); o.rot('torso', 0.9 * k); o.pos('hips', 0, -0.75 * k); o.rot('armL', -0.9 * k, 0, 0.6 * k); o.rot('armR', -0.9 * k, 0, -0.6 * k); o.rot('head', 0.4 * k); }
  },
};

// ───────────────────────── Training Dummy ─────────────────────────
const DUMMY: KindDef = {
  height: 1.7,
  build(m) {
    m.joint('post', null, [0, 0, 0]);
    m.joint('head', 'post', [0, 1.38, 0]);
    m.on('post', (b) => {
      b.prism([0, -0.3, 0], [0, 1.55, 0], 0.075, 0.065, 6, P.woodDark);
      b.prism([-0.58, 1.15, 0], [0.58, 1.15, 0], 0.045, 0.045, 5, P.woodLight);
      b.ball([0, 1.0, 0], 0.3, P.straw, 0.95, 1.35, 0.8, 1, 0.4, P.straw2);
      for (const sx of [-1, 1]) b.ball([sx * 0.6, 1.13, 0], 0.11, P.straw, 1, 1.4, 1, 0, 0.5);
      b.prism([0, 0.86, 0], [0, 0.94, 0], 0.27, 0.27, 8, P.roof, { caps: false });
      b.prism([0, 1.24, 0], [0, 1.3, 0], 0.22, 0.22, 8, P.roof, { caps: false });
      for (let k = 0; k < 6; k++) { const a = k * 1.05; b.prism([Math.cos(a) * 0.18, 0.62, Math.sin(a) * 0.18], [Math.cos(a) * 0.26, 0.42, Math.sin(a) * 0.26], 0.05, 0.01, 3, P.straw2); }
    });
    m.on('head', (b) => {
      b.ball([0, 1.52, 0], 0.2, P.stone2, 1, 1.05, 0.95, 1, 0.2, P.plinth);
      for (const sx of [-1, 1]) { b.box(sx * 0.07, 1.56, 0.18, 0.09, 0.02, 0.02, P.hollow); b.box(sx * 0.07, 1.56, 0.18, 0.02, 0.09, 0.02, P.hollow); }
      b.box(0, 1.46, 0.185, 0.12, 0.02, 0.02, P.hollow);
      b.prism([0, 1.68, 0], [0.02, 1.78, 0.0], 0.06, 0.03, 4, P.straw2);
    });
  },
  pose(o, a) {
    o.rot('post', 0.02 * Math.sin(a.T * 0.9));
    if (a.hT >= 0) { o.rot('post', -0.28 * wobble(a.hT, 17, 4.5)); o.rot('head', 0.15 * wobble(a.hT, 21, 5)); }
    if (a.mode === 'dead') { o.rot('post', -1.25 * ease(a.deadT / 0.6)); }
  },
};

const KINDS: Record<EnemyKindId, KindDef> = {
  thornling: THORNLING, boar: BOAR, archer: ARCHER, mossback: MOSSBACK, dummy: DUMMY,
  // Plan 4's bosses and the Warden's add (combat/bossModels.ts)
  wickhound: WICKHOUND, fallen_warden: FALLEN_WARDEN, lens_shard: LENS_SHARD,
};

// ───────────────────────── shared per scene ─────────────────────────
interface Shared { blob: Mesh; ring: StandardMaterial }
const SHARED = new WeakMap<Scene, Shared>();
function shared(scene: Scene): Shared {
  let s = SHARED.get(scene);
  if (!s) {
    const tex = new DynamicTexture('enemyBlobTex', { width: 64, height: 64 }, scene, false);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(40,24,48,0.55)'); grd.addColorStop(0.55, 'rgba(40,24,48,0.3)'); grd.addColorStop(1, 'rgba(40,24,48,0)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, 64, 64); tex.update(); tex.hasAlpha = true;
    const bm = new StandardMaterial('enemyBlob', scene);
    bm.diffuseTexture = tex; bm.useAlphaFromDiffuseTexture = true; bm.disableLighting = true; bm.emissiveColor = Color3.White();
    bm.backFaceCulling = false; bm.zOffset = -2; bm.alpha = 0.999;
    const blob = MeshBuilder.CreateGround('enemyBlobSrc', { width: 1, height: 1 }, scene);
    blob.material = bm; blob.isPickable = false; blob.setEnabled(false);
    const ring = new StandardMaterial('enemyRing', scene);
    ring.disableLighting = true; ring.emissiveColor = Color3.FromHexString(PALETTE.roof); ring.alpha = 0.92;
    s = { blob, ring };
    SHARED.set(scene, s);
  }
  return s;
}

// ───────────────────────── factory ─────────────────────────
let counter = 0;
/** Triangles of the last enemy built (for the dev viewer). */
export const enemyStats = { lastTriangles: 0 };
const BASE_EMISSIVE = new Color3(0.07, 0.055, 0.06);
/** Rim light per kind (emissive fresnel): kinds that sit on grass get a stronger warm rim so they read against it. */
const RIM: Partial<Record<EnemyKindId, Color3>> = { thornling: new Color3(0.62, 0.36, 0.18), archer: new Color3(0.5, 0.42, 0.24) };
const WINDUP_TINT = Color3.FromHexString(PALETTE.roof);
const BLEND_S = 0.1;
/** Drawn size per kind (the Thornling is drawn 1.3× so it fills its 0.5 m hit circle and reads at a distance). */
const DRAW_SCALE: Partial<Record<EnemyKindId, number>> = { thornling: 1.3, ...BOSS_DRAW };
const STRIKE_LINGER_S = 0.4;
/** A second strike() within this of the last one is the same swing (the hit fx and the wind-up end both report it), in s. */
const STRIKE_DEDUPE_S = 0.3;

/** Each kind's model (geometry in model space, rest pose, and its joints), built once and shared by every scene. */
const MODELS = new Map<EnemyKindId, Model>();
function modelOf(kind: EnemyKindId): Model {
  let m = MODELS.get(kind);
  if (!m) { m = new Model(1000 + Object.keys(KINDS).indexOf(kind) * 17); KINDS[kind].build(m); MODELS.set(kind, m); }
  return m;
}
/** Per scene and kind: the body and glow meshes every enemy of that kind clones (they share the GPU geometry). */
const TEMPLATES = new WeakMap<Scene, Map<EnemyKindId, { body: Mesh; glow: Mesh | null }>>();
function templateOf(scene: Scene, kind: EnemyKindId): { body: Mesh; glow: Mesh | null } {
  let byKind = TEMPLATES.get(scene);
  if (!byKind) { byKind = new Map(); TEMPLATES.set(scene, byKind); }
  let t = byKind.get(kind);
  if (!t) {
    const m = modelOf(kind);
    const skin = (b: Builder, idx: number[], name: string): Mesh => {
      const mesh = b.build(scene, name, null as unknown as StandardMaterial);
      mesh.material = null;
      const n = b.pos.length / 3;
      const mi = new Float32Array(n * 4), mw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { mi[i * 4] = idx[i]; mw[i * 4] = 1; }
      mesh.setVerticesData(VertexBuffer.MatricesIndicesKind, mi, false, 4);
      mesh.setVerticesData(VertexBuffer.MatricesWeightsKind, mw, false, 4);
      mesh.isPickable = false;
      mesh.setEnabled(false);
      return mesh;
    };
    t = { body: skin(m.b, m.bIdx, `enemyTpl_${kind}`), glow: m.g.tris > 0 ? skin(m.g, m.gIdx, `enemyTplGlow_${kind}`) : null };
    byKind.set(kind, t);
  }
  return t;
}

/**
 * Applies a mode change to an enemy's animation state (pure; makeEnemy's setMode). A wind-up starts `elapsed`
 * seconds in (an enemy first seen part way through one) and lasts `seconds` (default: the attack's wind-up).
 * Returns false when nothing changed (the same mode, or the same wind-up, again).
 */
export function applyMode(a: Pick<Anim, 'mode' | 'attack' | 'wT' | 'wDur'> & Partial<Pick<Anim, 'phaseT'>>, mode: EnemyMode, attack?: EnemyAttackId, seconds?: number, elapsed = 0): boolean {
  if (mode === 'windup') {
    const atk = attack ?? a.attack ?? null;
    if (a.mode === 'windup' && atk === a.attack) return false;
    a.attack = atk;
    a.wDur = seconds ?? (atk ? ENEMY_ATTACKS[atk].windup : 1);
    a.wT = Math.max(0, Math.min(a.wDur, Number.isFinite(elapsed) ? elapsed : 0));
  } else {
    if (mode === a.mode) return false;
    a.attack = null;
    if (mode === 'phase') (a as Partial<Anim>).phaseT = 0;
  }
  a.mode = mode;
  return true;
}

export function makeEnemy(scene: Scene, kind: EnemyKindId): EnemyView {
  const def = KINDS[kind];
  const id = ++counter;
  const sh = shared(scene);
  const m = modelOf(kind);
  const tpl = templateOf(scene, kind);
  enemyStats.lastTriangles = m.b.tris + m.g.tris;

  const root = new TransformNode(`enemy_${kind}_${id}`, scene);
  const rigRoot = new TransformNode(`enemyRig_${id}`, scene);
  rigRoot.parent = root;
  const skeleton = new Skeleton(`enemySkel_${id}`, `enemySkel_${id}`, scene);
  const nodes: TransformNode[] = [], rest: Vector3[] = [], bones: Bone[] = [];
  m.joints.forEach((j, i) => {
    const pp: V3 = j.parent >= 0 ? m.joints[j.parent].pivot : [0, 0, 0];
    const local = new Vector3(j.pivot[0] - pp[0], j.pivot[1] - pp[1], j.pivot[2] - pp[2]);
    const node = new TransformNode(`${j.name}_${id}`, scene);
    node.parent = j.parent >= 0 ? nodes[j.parent] : rigRoot;
    node.position.copyFrom(local);
    nodes.push(node); rest.push(local);
    const bone = new Bone(j.name, skeleton, j.parent >= 0 ? bones[j.parent] : null, Matrix.Translation(local.x, local.y, local.z));
    bone.linkTransformNode(node);
    bones.push(bone);
  });

  const mat = new StandardMaterial(`enemyMat_${id}`, scene);
  mat.diffuseColor = Color3.White(); mat.specularColor = Color3.Black();
  mat.emissiveColor = BASE_EMISSIVE.clone(); mat.ambientColor = new Color3(0.25, 0.23, 0.26);
  const fr = new FresnelParameters();
  fr.leftColor = RIM[kind] ?? new Color3(0.36, 0.27, 0.2); fr.rightColor = new Color3(0, 0, 0); fr.bias = 0.12; fr.power = 2.6;
  mat.emissiveFresnelParameters = fr;
  const gmat = new StandardMaterial(`enemyGlow_${id}`, scene);
  gmat.disableLighting = true; gmat.emissiveColor = Color3.White();

  const DS = DRAW_SCALE[kind] ?? 1;
  const H = def.height * DS, R = ENEMY_KINDS[kind].radius;
  const bounds = () => new BoundingInfo(new Vector3(-H, -0.3, -H), new Vector3(H, H * 1.35, H));
  const skin = (t: Mesh, name: string, material: StandardMaterial): Mesh => {
    const mesh = t.clone(name, rigRoot, true) as Mesh; // shares the template's geometry
    mesh.setEnabled(true);
    mesh.material = material;
    mesh.skeleton = skeleton; mesh.numBoneInfluencers = 1;
    mesh.isPickable = true;
    mesh.setBoundingInfo(bounds());
    mesh.receiveShadows = true;
    return mesh;
  };
  const body = skin(tpl.body, `enemyBody_${id}`, mat);
  const glow = tpl.glow ? skin(tpl.glow, `enemyGlowMesh_${id}`, gmat) : null;
  if (glow) glow.receiveShadows = false;
  const pickables = glow ? [body, glow] : [body];

  const blob: InstancedMesh = sh.blob.createInstance(`enemyBlob_${id}`);
  blob.parent = root; blob.isPickable = false; blob.position.y = 0.03;
  const blobS = Math.max(0.9, R * 2.3);
  blob.scaling.set(blobS, 1, blobS * (kind === 'boar' ? 1.6 : 0.95));

  let ring: Mesh | null = null, targeted = false;
  const poser = new Poser(m), from = new Float32Array(poser.v.length), out = new Float32Array(poser.v.length);
  poser.reset(); out.set(poser.v); from.set(out);
  let blend = 1;
  const a: Anim = {
    T: Math.random() * 10, mode: 'idle', attack: null, wT: 0, wDur: 1, sT: -1, sAttack: null, hT: -1, deadT: 0, stunT: 0, speed: 0, phase: Math.random(),
    bossPhase: 0, phaseT: -1, warded: false, enraged: false, tOn: false, tx: 0, ty: 0, tz: 0,
  };
  const tetherAt = { x: 0, y: 0, z: 0 };
  let tether: { x: number; y: number; z: number } | null = null;
  let surging = false;
  let flashT = -1, lastWindup: { attack: EnemyAttackId; endedAt: number } | null = null, spawnT = 1;
  const prev = new Vector3(NaN, 0, 0);
  const startBlend = () => { from.set(out); blend = 0; };

  const view: EnemyView = {
    root, height: H, radius: R,
    setEntityId(eid) {
      for (const p of pickables) p.metadata = { ...(p.metadata ?? {}), entityId: eid };
      root.metadata = { ...(root.metadata ?? {}), entityId: eid };
    },
    setMode(mode, attack, seconds, elapsed) {
      const wasMode = a.mode, wasAttack = a.attack;
      if (!applyMode(a, mode, attack, seconds, elapsed)) return;
      if (wasMode === 'windup' && wasAttack) lastWindup = { attack: wasAttack, endedAt: a.T };
      if (wasMode === 'dead' && mode !== 'dead') { spawnT = 0; a.hT = -1; a.sT = -1; root.setEnabled(true); }
      if (mode === 'dead') { a.deadT = Number.isFinite(elapsed) ? Math.max(0, elapsed as number) : 0; a.sT = -1; }
      startBlend();
    },
    strike() {
      if (a.mode === 'dead') return;
      // one swing, however many reports of it arrive (the hit fx and the wind-up's end)
      if (a.sT >= 0 && a.sT < STRIKE_DEDUPE_S) return;
      let atk: EnemyAttackId | null = null;
      if (a.mode === 'windup' && a.attack) { atk = a.attack; lastWindup = { attack: atk, endedAt: a.T }; a.mode = 'idle'; a.attack = null; }
      else if (lastWindup && a.T - lastWindup.endedAt < STRIKE_LINGER_S) atk = lastWindup.attack;
      lastWindup = null;
      a.sAttack = atk; a.sT = 0;
      startBlend();
    },
    setSurging(on) { surging = on; },
    setBoss(phase, warded, enraged) { a.bossPhase = phase; a.warded = warded; a.enraged = enraged; },
    setTether(p) {
      if (p) { tetherAt.x = p.x; tetherAt.y = p.y; tetherAt.z = p.z; tether = tetherAt; } else { tether = null; a.tOn = false; }
    },
    reset() {
      surging = false;
      a.bossPhase = 0; a.phaseT = -1; a.warded = false; a.enraged = false; a.tOn = false; tether = null;
      a.mode = 'idle'; a.attack = null; a.wT = 0; a.sT = -1; a.sAttack = null; a.hT = -1; a.deadT = 0; a.stunT = 0; a.speed = 0;
      flashT = -1; lastWindup = null; spawnT = 1; blend = 1;
      poser.reset(); out.set(poser.v); from.set(out);
      prev.set(NaN, 0, 0);
      rigRoot.scaling.setAll(DS); rigRoot.position.y = 0;
      root.setEnabled(true);
      view.setTargeted(false);
      view.update(0);
    },
    hit() { if (a.mode !== 'dead') a.hT = 0; },
    flash() { flashT = 0; },
    setTargeted(on) {
      targeted = on;
      if (on && !ring) {
        ring = MeshBuilder.CreateTorus(`enemyRing_${id}`, { diameter: R * 2 + 0.5, thickness: 0.07 * Math.max(1, R), tessellation: 36 }, scene);
        ring.scaling.y = 0.25; ring.position.y = 0.06; ring.parent = root; ring.material = sh.ring; ring.isPickable = false;
      }
      ring?.setEnabled(on);
    },
    update(rawDt) {
      const dt = Math.min(0.1, Math.max(0, rawDt));
      a.T += dt;
      if (a.mode === 'windup') a.wT += dt;
      if (a.sT >= 0) { a.sT += dt; if (a.sT > 0.9) a.sT = -1; }
      if (a.hT >= 0) { a.hT += dt; if (a.hT > 0.8) a.hT = -1; }
      if (a.mode === 'dead') a.deadT += dt;
      if (a.phaseT >= 0) a.phaseT += dt;
      // root motion → speed and gait phase
      root.computeWorldMatrix(true);
      const wp = root.getAbsolutePosition();
      if (Number.isNaN(prev.x) || dt <= 0) prev.copyFrom(wp);
      else {
        const d = Math.hypot(wp.x - prev.x, wp.z - prev.z);
        const sp = d > 3 ? 0 : d / dt;
        a.speed += (sp - a.speed) * Math.min(1, dt * 8);
        prev.copyFrom(wp);
      }
      const cadence = BOSS_CADENCE[kind] ?? (kind === 'mossback' ? 0.32 : kind === 'boar' ? 0.42 : kind === 'archer' ? 0.48 : 0.6);
      // the tether point in model space (the root turns with facing; the rig is scaled by DS)
      if (tether) {
        const dx = tether.x - wp.x, dy = tether.y - wp.y, dz = tether.z - wp.z, ry = root.rotation.y, c = Math.cos(ry), sn = Math.sin(ry);
        a.tOn = true; a.tx = (dx * c - dz * sn) / DS; a.ty = dy / DS; a.tz = (dx * sn + dz * c) / DS;
      }
      a.phase += dt * (a.mode === 'run' || a.mode === 'return' ? Math.max(1.2, a.speed * cadence + 0.6) : 0);
      // pose
      poser.reset();
      def.pose(poser, a);
      blend = Math.min(1, blend + dt / BLEND_S);
      const k = ease(blend), v = poser.v;
      for (let i = 0; i < v.length; i++) out[i] = from[i] + (v[i] - from[i]) * k;
      for (let j = 0; j < nodes.length; j++) {
        const o = j * NV, n = nodes[j];
        n.rotation.set(out[o], out[o + 1], out[o + 2]);
        n.position.set(rest[j].x + out[o + 3], rest[j].y + out[o + 4], rest[j].z + out[o + 5]);
        n.scaling.set(out[o + 6], out[o + 7], out[o + 8]);
      }
      // respawn pop, and a corpse sinks away after a while
      if (spawnT < 1) { spawnT = Math.min(1, spawnT + dt / 0.45); const s = 0.2 + 0.8 * ease(spawnT); rigRoot.scaling.setAll(s * DS); } else rigRoot.scaling.setAll(DS);
      rigRoot.position.y = a.mode === 'dead' ? -0.9 * ease((a.deadT - 3) / 1.5) : 0;
      if (a.mode === 'dead' && a.deadT > 4.6) root.setEnabled(false);
      blob.setEnabled(!(a.mode === 'dead' && a.deadT > 2.5));
      // colour: a warm wind-up glow that pulses, a white flash on damage, a dim glow when dead
      const e = mat.emissiveColor;
      e.copyFrom(BASE_EMISSIVE);
      let glowK = kind === 'dummy' ? 0 : 0.85 + 0.15 * Math.sin(a.T * 4);
      if (a.mode === 'windup') {
        const w = rise(a.wT, 0.12) * (0.7 + 0.3 * Math.sin(a.T * 14)), late = clamp01((a.wT - a.wDur + 0.35) / 0.35);
        e.r += WINDUP_TINT.r * 0.36 * w + 0.15 * late; e.g += WINDUP_TINT.g * 0.36 * w + 0.08 * late; e.b += WINDUP_TINT.b * 0.36 * w;
        glowK = 1.1 + 0.35 * Math.sin(a.T * 18) * rise(a.wT, 0.12);
      }
      if (a.mode === 'stunned') glowK = 0.5 + 0.3 * Math.abs(Math.sin(a.T * 9));
      if (surging && a.mode !== 'dead') { const p = 0.5 + 0.5 * Math.sin(a.T * 16); e.r += 0.04 * p; e.g += 0.22 * p; e.b += 0.3 * p; }
      if (a.mode === 'dead') glowK = 0.2;
      if (def.glow) glowK = def.glow(a, glowK);
      if (flashT >= 0) {
        flashT += dt;
        const f = Math.max(0, 1 - flashT / 0.16) * 0.85;
        e.r += f; e.g += f; e.b += f;
        if (flashT > 0.16) flashT = -1;
      }
      gmat.emissiveColor.set(glowK, glowK, glowK);
      if (ring && targeted) { ring.rotation.y += dt * 1.2; const sc = 1 + 0.05 * Math.sin(a.T * 5); ring.scaling.x = ring.scaling.z = sc; }
    },
    dispose() {
      root.dispose(false, false);
      skeleton.dispose();
      mat.dispose(); gmat.dispose();
    },
  };
  view.update(0);
  return view;
}
