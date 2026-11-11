// Procedural low-poly characters. Each character is ONE skinned mesh (rigid one-bone-per-vertex
// skinning, vertex colours, flat facets) plus an optional glow mesh sharing the same skeleton,
// so a character costs 1-2 draw calls (+1 for the target ring while targeted).
// Bones are driven by a small TransformNode hierarchy that update(dt) poses procedurally.
import {
  Scene, TransformNode, Mesh, VertexData, Skeleton, Bone, Matrix, Vector3, Color3,
  StandardMaterial, MeshBuilder, BoundingInfo, Quaternion,
  CreateBoxVertexData, CreateCylinderVertexData, CreateIcoSphereVertexData,
} from '@babylonjs/core';
import type { CharacterOpts, CharacterView, MakeCharacter, Pose, WeaponId, EntityKind } from '../core/contracts';
import { PALETTE } from '../core/contracts';

// ───────────────────────── colours (all derived from PALETTE) ─────────────────────────
const hex = (h: string) => Color3.FromHexString(h);
const mix = (a: Color3, b: Color3, t: number) => Color3.Lerp(a, b, t);
const shade = (c: Color3, f: number) => new Color3(Math.min(1, c.r * f), Math.min(1, c.g * f), Math.min(1, c.b * f));
const P = {
  skyDeep: hex(PALETTE.skyDeep), sky: hex(PALETTE.sky), horizon: hex(PALETTE.horizon), cloud: hex(PALETTE.cloud),
  stone: hex(PALETTE.stone), roof: hex(PALETTE.roof), teal: hex(PALETTE.teal), meadow: hex(PALETTE.meadow),
  cliff: hex(PALETTE.cliff), rock: hex(PALETTE.rock), gold: hex(PALETTE.gold),
};
const C = {
  skin: mix(P.stone, P.horizon, 0.55),
  skinDark: mix(P.horizon, P.cliff, 0.45),
  chestnut: shade(mix(P.cliff, P.rock, 0.25), 0.82),
  blond: mix(P.gold, P.stone, 0.35),
  silver: mix(P.cloud, P.stone, 0.35),
  ink: shade(P.rock, 0.45),
  leather: shade(mix(P.cliff, P.rock, 0.55), 0.75),
  cloth: mix(P.stone, P.rock, 0.3),
  steel: mix(P.cloud, P.sky, 0.18),
  blush: mix(P.roof, P.horizon, 0.4),
};

// ───────────────────────── skeleton layout ─────────────────────────
const JOINTS = ['base', 'hips', 'torso', 'head', 'cape', 'armL', 'armR', 'legL', 'legR', 'blade', 'shield', 'bow', 'prop'] as const;
type Joint = typeof JOINTS[number];
const PARENT: Record<Joint, Joint | null> = {
  base: null, hips: 'base', torso: 'hips', head: 'torso', cape: 'torso', armL: 'torso', armR: 'torso',
  legL: 'hips', legR: 'hips', blade: 'armR', shield: 'armL', bow: 'armL', prop: 'armR',
};
type V3 = [number, number, number];
/** Model-space pivots for a 1.8 m humanoid; kinds scale/override. */
function humanPivots(): Record<Joint, V3> {
  return {
    base: [0, 0, 0], hips: [0, 0.62, 0], torso: [0, 0.66, 0], head: [0, 1.12, 0], cape: [0, 1.1, -0.17],
    armL: [-0.29, 1.03, 0], armR: [0.29, 1.03, 0], legL: [-0.12, 0.62, 0], legR: [0.12, 0.62, 0],
    blade: [0.3, 0.6, 0.02], shield: [-0.36, 0.78, 0], bow: [-0.3, 0.6, 0.02], prop: [0.3, 0.6, 0.02],
  };
}

// ───────────────────────── geometry builder ─────────────────────────
class Geo {
  pos: number[] = []; nrm: number[] = []; col: number[] = []; mi: number[] = [];
  private seed = 1;
  constructor(private jointIndex: Record<Joint, number>, private jitter = 0.07) {}
  /** Append vertex data transformed by m, unwelded into flat-shaded triangles. */
  add(vd: VertexData, m: Matrix, color: Color3, joint: Joint) {
    const p = vd.positions!, ind = vd.indices!;
    const bi = this.jointIndex[joint];
    const part = this.seed++;
    const a = new Vector3(), b = new Vector3(), c = new Vector3();
    for (let t = 0; t < ind.length; t += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(p[ind[t] * 3], p[ind[t] * 3 + 1], p[ind[t] * 3 + 2], m, a);
      Vector3.TransformCoordinatesFromFloatsToRef(p[ind[t + 1] * 3], p[ind[t + 1] * 3 + 1], p[ind[t + 1] * 3 + 2], m, b);
      Vector3.TransformCoordinatesFromFloatsToRef(p[ind[t + 2] * 3], p[ind[t + 2] * 3 + 1], p[ind[t + 2] * 3 + 2], m, c);
      // Babylon is left-handed with clockwise front faces: normal = (c-a) x (b-a)
      const n = Vector3.Cross(c.subtract(a), b.subtract(a));
      if (n.lengthSquared() < 1e-14) continue;
      n.normalize();
      // per-facet colour jitter keyed by facet orientation, so coplanar triangles match
      const h = Math.sin((Math.round(n.x * 8) * 12.9898 + Math.round(n.y * 8) * 78.233 + Math.round(n.z * 8) * 37.719 + part * 4.13)) * 43758.5453;
      const f = 1 + (h - Math.floor(h) - 0.5) * 2 * this.jitter;
      for (const v of [a, b, c]) {
        this.pos.push(v.x, v.y, v.z); this.nrm.push(n.x, n.y, n.z);
        this.col.push(Math.min(1, color.r * f), Math.min(1, color.g * f), Math.min(1, color.b * f), 1);
        this.mi.push(bi, 0, 0, 0);
      }
    }
  }
  get empty() { return this.pos.length === 0; }
  build(name: string, scene: Scene): Mesh {
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    const n = this.pos.length / 3;
    vd.positions = this.pos; vd.normals = this.nrm; vd.colors = this.col;
    vd.indices = Array.from({ length: n }, (_, i) => i);
    vd.matricesIndices = this.mi;
    vd.matricesWeights = Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0));
    vd.applyToMesh(mesh, false);
    return mesh;
  }
}

const tmpQ = new Quaternion();
function xform(center: V3, rot?: V3, scale?: V3): Matrix {
  const q = rot ? Quaternion.RotationYawPitchRoll(rot[1], rot[0], rot[2]) : Quaternion.Identity();
  return Matrix.Compose(new Vector3(...(scale ?? [1, 1, 1])), q, new Vector3(...center));
}

/** Shape kit bound to a Geo and a uniform scale. */
class Kit {
  constructor(public g: Geo, public glow: Geo, public s: number) {}
  private sc(v: V3): V3 { return [v[0] * this.s, v[1] * this.s, v[2] * this.s]; }
  box(j: Joint, size: V3, at: V3, col: Color3, rot?: V3, glow = false) {
    const vd = CreateBoxVertexData({ width: size[0] * this.s, height: size[1] * this.s, depth: size[2] * this.s });
    (glow ? this.glow : this.g).add(vd, xform(this.sc(at), rot), col, j);
  }
  /** Cylinder / frustum / cone along local Y. */
  cyl(j: Joint, top: number, bottom: number, h: number, at: V3, col: Color3, tess = 8, rot?: V3, glow = false) {
    const vd = CreateCylinderVertexData({ diameterTop: top * this.s, diameterBottom: bottom * this.s, height: h * this.s, tessellation: tess });
    (glow ? this.glow : this.g).add(vd, xform(this.sc(at), rot), col, j);
  }
  ball(j: Joint, r: number, at: V3, col: Color3, scale: V3 = [1, 1, 1], rot?: V3, glow = false, sub = 1) {
    const vd = CreateIcoSphereVertexData({ radius: r * this.s, subdivisions: sub, flat: true });
    (glow ? this.glow : this.g).add(vd, xform(this.sc(at), rot, scale), col, j);
  }
  /** A square-section rod between two points. */
  rod(j: Joint, a: V3, b: V3, thick: number, col: Color3, glow = false, tess = 4) {
    const va = new Vector3(...a), vb = new Vector3(...b);
    const d = vb.subtract(va); const len = d.length(); d.normalize();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), d, tmpQ);
    const vd = CreateCylinderVertexData({ diameter: thick * this.s, height: len * this.s, tessellation: tess });
    const mid = va.add(vb).scale(0.5 * this.s);
    (glow ? this.glow : this.g).add(vd, Matrix.Compose(Vector3.One(), tmpQ.clone(), mid), col, j);
  }
}

// ───────────────────────── per-kind traits ─────────────────────────
interface Traits {
  scale: number;       // uniform scale of the 1.8 m humanoid layout
  height: number;
  cadence: number;     // run steps per second (per leg pair)
  stride: number;      // leg swing amplitude
  armSwing: number;
  bob: number;
  lean: number;        // run forward lean
  hunch: number;       // idle hunch (elderly)
  heavy: boolean;
  ringR: number;
}
const TRAITS: Record<EntityKind | 'npc', Traits> = {
  player:    { scale: 1, height: 1.8, cadence: 1.55, stride: 0.85, armSwing: 0.8, bob: 0.07, lean: 0.16, hunch: 0, heavy: false, ringR: 0.55 },
  companion: { scale: 0.96, height: 1.85, cadence: 1.6, stride: 0.8, armSwing: 0.7, bob: 0.07, lean: 0.14, hunch: 0, heavy: false, ringR: 0.55 },
  npc:       { scale: 1, height: 1.75, cadence: 1.2, stride: 0.6, armSwing: 0.5, bob: 0.04, lean: 0.08, hunch: 0, heavy: false, ringR: 0.55 },
  grunt:     { scale: 0.68, height: 1.2, cadence: 2.1, stride: 0.9, armSwing: 0.9, bob: 0.08, lean: 0.25, hunch: 0.1, heavy: false, ringR: 0.5 },
  archer:    { scale: 0.82, height: 1.5, cadence: 1.7, stride: 0.7, armSwing: 0.6, bob: 0.06, lean: 0.15, hunch: 0.05, heavy: false, ringR: 0.5 },
  brute:     { scale: 1.45, height: 2.6, cadence: 1.0, stride: 0.55, armSwing: 0.45, bob: 0.1, lean: 0.12, hunch: 0.15, heavy: true, ringR: 1.0 },
  warden:    { scale: 2.5, height: 4.5, cadence: 0.6, stride: 0.4, armSwing: 0.3, bob: 0.12, lean: 0.05, hunch: 0, heavy: true, ringR: 2.2 },
};

const DEFAULT_COLOR: Record<EntityKind | 'npc', string | null> = {
  player: PALETTE.teal, companion: PALETTE.roof, npc: null, grunt: PALETTE.rock, archer: PALETTE.rock, brute: PALETTE.rock, warden: PALETTE.stone,
};
const DEFAULT_WEAPON: Record<EntityKind | 'npc', WeaponId | 'none'> = {
  player: 'blade', companion: 'bow', npc: 'none', grunt: 'none', archer: 'bow', brute: 'none', warden: 'none',
};

function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

// ───────────────────────── models ─────────────────────────
function weapons(k: Kit, accent: Color3) {
  // Sword in the right hand, pointing forward and slightly down.
  k.box('blade', [0.07, 0.035, 0.72], [0.3, 0.58, 0.48], C.steel, [0.12, 0, 0]);
  k.box('blade', [0.24, 0.06, 0.06], [0.3, 0.61, 0.11], P.gold);
  k.box('blade', [0.05, 0.05, 0.16], [0.3, 0.6, 0.0], C.leather);
  k.ball('blade', 0.045, [0.3, 0.6, -0.09], P.gold);
  // Small round shield on the left forearm, facing outward.
  k.cyl('shield', 0.46, 0.46, 0.05, [-0.4, 0.76, 0.02], accent, 8, [0, 0, Math.PI / 2]);
  k.cyl('shield', 0.5, 0.5, 0.03, [-0.385, 0.76, 0.02], P.gold, 8, [0, 0, Math.PI / 2]);
  k.ball('shield', 0.07, [-0.43, 0.76, 0.02], P.gold, [0.6, 1, 1]);
  // Bow in the left hand: limbs arc forward, string at the back.
  const pts: V3[] = [];
  for (let i = 0; i <= 4; i++) { const a = -1.15 + (2.3 * i) / 4; pts.push([-0.3, 0.6 + 0.55 * Math.sin(a), 0.04 + 0.16 * Math.cos(a)]); }
  for (let i = 0; i < 4; i++) k.rod('bow', pts[i], pts[i + 1], 0.06, i === 1 || i === 2 ? C.leather : P.gold);
  k.rod('bow', pts[0], pts[4], 0.015, P.cloud);
}

function eyes(k: Kit, y: number, z: number, spread = 0.095, col = C.ink) {
  k.box('head', [0.055, 0.085, 0.04], [-spread, y, z], col);
  k.box('head', [0.055, 0.085, 0.04], [spread, y, z], col);
  k.box('head', [0.022, 0.022, 0.041], [-spread + 0.012, y + 0.022, z + 0.002], P.cloud); // eye glint
  k.box('head', [0.022, 0.022, 0.041], [spread + 0.012, y + 0.022, z + 0.002], P.cloud);
  k.box('head', [0.07, 0.022, 0.03], [0, y - 0.1, z - 0.004], shade(P.cliff, 0.8));   // smile
}

function buildPlayer(k: Kit, cloth: Color3) {
  const dark = shade(cloth, 0.72);
  for (const [j, x] of [['legL', -0.12], ['legR', 0.12]] as [Joint, number][]) {
    k.cyl(j, 0.17, 0.14, 0.42, [x, 0.41, 0], C.cloth, 6);
    k.box(j, [0.17, 0.2, 0.28], [x, 0.1, 0.04], C.leather);
  }
  k.cyl('torso', 0.38, 0.5, 0.48, [0, 0.88, 0], cloth, 8);
  k.cyl('torso', 0.5, 0.58, 0.14, [0, 0.62, 0], dark, 8);
  k.cyl('torso', 0.47, 0.47, 0.07, [0, 0.78, 0], C.leather, 8);
  k.box('torso', [0.1, 0.09, 0.05], [0, 0.78, 0.235], P.gold);
  k.cyl('torso', 0.27, 0.36, 0.11, [0, 1.11, 0], P.roof, 8);           // scarf
  k.box('torso', [0.1, 0.24, 0.05], [0.08, 0.98, 0.2], P.roof, [0.25, 0, 0.2]); // scarf tail
  k.box('cape', [0.5, 0.66, 0.05], [0, 0.79, -0.24], P.roof, [0.12, 0, 0]);
  k.box('cape', [0.52, 0.06, 0.06], [0, 0.47, -0.28], P.gold, [0.12, 0, 0]);
  // head
  k.ball('head', 0.27, [0, 1.4, 0], C.skin, [1, 0.95, 0.95]);
  k.ball('head', 0.285, [0, 1.5, -0.04], C.chestnut, [1.02, 0.72, 1.0]);
  k.ball('head', 0.2, [0, 1.42, -0.15], C.chestnut, [1.1, 1, 0.8]);
  k.cyl('head', 0, 0.16, 0.2, [0.07, 1.7, 0.02], C.chestnut, 4, [0.4, 0, -0.4]);
  k.cyl('head', 0, 0.15, 0.18, [-0.08, 1.69, 0.05], C.chestnut, 4, [0.5, 0, 0.5]);
  k.cyl('head', 0, 0.14, 0.18, [0.0, 1.62, 0.2], C.chestnut, 4, [1.2, 0, 0]);
  eyes(k, 1.38, 0.245);
  k.box('head', [0.06, 0.03, 0.02], [-0.15, 1.31, 0.22], C.blush);
  k.box('head', [0.06, 0.03, 0.02], [0.15, 1.31, 0.22], C.blush);
  // arms
  for (const [j, x] of [['armL', -0.3], ['armR', 0.3]] as [Joint, number][]) {
    k.ball(j, 0.105, [x, 1.0, 0], dark);
    k.cyl(j, 0.14, 0.12, 0.36, [x, 0.82, 0], cloth, 6);
    k.cyl(j, 0.13, 0.13, 0.06, [x, 0.66, 0], C.leather, 6);
    k.ball(j, 0.075, [x, 0.59, 0.01], C.skin);
  }
}

function buildCompanion(k: Kit, cloth: Color3) {
  const dark = shade(cloth, 0.75);
  const hat = P.rock;
  for (const [j, x] of [['legL', -0.11], ['legR', 0.11]] as [Joint, number][]) {
    k.cyl(j, 0.14, 0.12, 0.42, [x, 0.41, 0], shade(P.rock, 1.2), 6);
    k.box(j, [0.15, 0.22, 0.25], [x, 0.11, 0.03], C.leather);
  }
  k.cyl('torso', 0.36, 0.66, 0.62, [0, 0.82, 0], cloth, 8);         // flared coat
  k.cyl('torso', 0.4, 0.4, 0.06, [0, 0.86, 0], P.gold, 8);
  k.box('torso', [0.06, 0.55, 0.06], [0.0, 0.82, 0.25], P.cloud, [0.14, 0, 0]); // coat trim
  k.box('torso', [0.06, 0.62, 0.05], [0.12, 0.9, 0.0], C.leather, [0, 0, -0.75]); // satchel strap
  k.box('torso', [0.2, 0.17, 0.1], [-0.27, 0.7, 0.05], C.leather);
  k.cyl('torso', 0.28, 0.36, 0.1, [0, 1.1, 0], P.cloud, 8);          // collar
  // head + braid
  k.ball('head', 0.26, [0, 1.38, 0], C.skin, [1, 0.95, 0.95]);
  k.ball('head', 0.275, [0, 1.47, -0.05], C.blond, [1.04, 0.7, 1.0]);
  k.ball('head', 0.11, [0, 1.3, -0.24], C.blond);
  k.ball('cape', 0.085, [0, 0.95, -0.27], C.blond);
  k.ball('cape', 0.075, [0, 0.82, -0.27], C.blond);
  k.ball('cape', 0.07, [0, 0.7, -0.26], P.teal);
  eyes(k, 1.36, 0.235, 0.09);
  k.box('head', [0.06, 0.03, 0.02], [-0.14, 1.29, 0.215], C.blush);
  k.box('head', [0.06, 0.03, 0.02], [0.14, 1.29, 0.215], C.blush);
  // the hat: wide brim + tall bent cone — Wren's signature silhouette from above
  k.cyl('head', 0.92, 0.92, 0.04, [0, 1.6, -0.02], hat, 10);
  k.cyl('head', 0.32, 0.44, 0.24, [0, 1.73, -0.04], hat, 8);
  k.cyl('head', 0.44, 0.45, 0.06, [0, 1.65, -0.03], P.gold, 8);
  k.cyl('head', 0.0, 0.32, 0.36, [0, 1.98, -0.12], hat, 8, [-0.45, 0, 0]);
  k.ball('head', 0.05, [0, 2.12, -0.25], P.gold);
  k.cyl('head', 0.0, 0.12, 0.2, [0.27, 1.69, 0.0], P.teal, 4, [0, 0, -1.0]); // feather
  for (const [j, x] of [['armL', -0.29], ['armR', 0.29]] as [Joint, number][]) {
    k.ball(j, 0.11, [x, 1.0, 0], dark);
    k.cyl(j, 0.12, 0.17, 0.38, [x, 0.8, 0], cloth, 6);
    k.ball(j, 0.07, [x, 0.59, 0.01], C.skin);
  }
}

function buildNpc(k: Kit, colorHex: string | undefined): { hunch: number; cane: boolean } {
  if (!colorHex) {
    // Elderly townsperson: long robe, white beard, bald crown, cane.
    const robe = mix(P.teal, P.rock, 0.35), sash = P.gold;
    for (const [j, x] of [['legL', -0.11], ['legR', 0.11]] as [Joint, number][]) k.box(j, [0.15, 0.16, 0.24], [x, 0.08, 0.04], C.leather);
    k.cyl('torso', 0.4, 0.66, 0.52, [0, 0.86, 0], robe, 8);
    k.cyl('legL', 0.58, 0.68, 0.46, [0.11, 0.38, 0], robe, 8);   // robe skirt (moves with legs subtly)
    k.cyl('torso', 0.44, 0.44, 0.07, [0, 0.82, 0], sash, 8);
    k.cyl('torso', 0.32, 0.44, 0.14, [0, 1.08, 0], mix(P.stone, P.cloud, 0.4), 8); // shawl
    k.ball('head', 0.25, [0, 1.36, 0], C.skin, [1, 0.97, 0.95]);
    k.ball('head', 0.19, [0, 1.25, 0.13], C.silver, [1.1, 1.2, 0.8]);   // beard
    k.cyl('head', 0, 0.22, 0.3, [0, 1.07, 0.18], C.silver, 5, [-0.25, 0, 0]);
    k.box('head', [0.26, 0.05, 0.06], [0, 1.35, 0.225], C.silver);       // moustache/brows
    k.ball('head', 0.13, [-0.2, 1.42, -0.06], C.silver);
    k.ball('head', 0.13, [0.2, 1.42, -0.06], C.silver);
    k.box('head', [0.05, 0.04, 0.04], [-0.09, 1.42, 0.23], C.ink);
    k.box('head', [0.05, 0.04, 0.04], [0.09, 1.42, 0.23], C.ink);
    k.box('head', [0.22, 0.04, 0.05], [0, 1.47, 0.215], C.silver);
    k.ball('head', 0.06, [0, 1.36, 0.25], C.skinDark);
    for (const [j, x] of [['armL', -0.28], ['armR', 0.28]] as [Joint, number][]) {
      k.ball(j, 0.1, [x, 1.0, 0], robe);
      k.cyl(j, 0.12, 0.18, 0.38, [x, 0.8, 0], robe, 6);
      k.ball(j, 0.07, [x, 0.59, 0.01], C.skin);
    }
    k.rod('prop', [0.32, 0.65, 0.12], [0.36, -0.36, 0.2], 0.06, C.leather, false, 5);
    k.ball('prop', 0.06, [0.32, 0.67, 0.12], P.gold);
    return { hunch: 0.32, cane: true };
  }
  const h = strHash(colorHex);
  const cloth = hex(colorHex);
  const dark = shade(cloth, 0.72);
  const hairs = [C.chestnut, C.blond, shade(P.rock, 0.8), P.cliff, C.silver];
  const hair = hairs[h % hairs.length];
  const skin = (h >> 3) % 3 === 0 ? mix(C.skin, C.skinDark, 0.6) : C.skin;
  const dress = ((h >> 5) & 1) === 1;
  const hatType = (h >> 7) % 4; // 0 none, 1 straw hat, 2 headscarf, 3 cap
  for (const [j, x] of [['legL', -0.11], ['legR', 0.11]] as [Joint, number][]) {
    if (!dress) k.cyl(j, 0.16, 0.13, 0.42, [x, 0.41, 0], C.cloth, 6);
    k.box(j, [0.15, 0.18, 0.25], [x, 0.09, 0.04], C.leather);
  }
  if (dress) {
    k.cyl('torso', 0.36, 0.5, 0.42, [0, 0.9, 0], cloth, 8);
    k.cyl('hips', 0.5, 0.76, 0.5, [0, 0.42, 0], cloth, 8);
    k.box('hips', [0.36, 0.42, 0.03], [0, 0.48, 0.3], P.cloud, [0.22, 0, 0]);    // apron
  } else {
    k.cyl('torso', 0.38, 0.52, 0.5, [0, 0.87, 0], cloth, 8);
    k.cyl('torso', 0.53, 0.58, 0.12, [0, 0.62, 0], dark, 8);
    k.box('torso', [0.3, 0.36, 0.03], [0, 0.78, 0.25], P.cloud, [0.1, 0, 0]);    // apron
  }
  k.cyl('torso', 0.44, 0.46, 0.06, [0, 0.8, 0], C.leather, 8);
  k.ball('head', 0.25, [0, 1.36, 0], skin, [1, 0.97, 0.95]);
  k.ball('head', 0.265, [0, 1.45, -0.05], hair, [1.03, 0.72, 1]);
  if (dress) k.ball('head', 0.12, [0, 1.55, -0.2], hair);   // bun
  eyes(k, 1.35, 0.23, 0.09);
  k.box('head', [0.05, 0.03, 0.02], [-0.13, 1.28, 0.21], C.blush);
  k.box('head', [0.05, 0.03, 0.02], [0.13, 1.28, 0.21], C.blush);
  if (hatType === 1) {
    k.cyl('head', 0.8, 0.8, 0.04, [0, 1.6, 0], mix(P.gold, P.stone, 0.5), 10);
    k.cyl('head', 0.34, 0.42, 0.18, [0, 1.69, 0], mix(P.gold, P.stone, 0.5), 8);
    k.cyl('head', 0.43, 0.43, 0.05, [0, 1.63, 0], P.roof, 8);
  } else if (hatType === 2) {
    k.ball('head', 0.28, [0, 1.46, -0.04], P.teal, [1.03, 0.75, 1.02]);
    k.cyl('head', 0, 0.14, 0.22, [0, 1.34, -0.28], P.teal, 4, [-0.8, 0, 0]);
  } else if (hatType === 3) {
    k.ball('head', 0.27, [0, 1.5, -0.02], dark, [1.03, 0.6, 1.02]);
    k.box('head', [0.3, 0.03, 0.16], [0, 1.52, 0.26], dark);
  }
  for (const [j, x] of [['armL', -0.28], ['armR', 0.28]] as [Joint, number][]) {
    k.ball(j, 0.105, [x, 1.0, 0], dark);
    k.cyl(j, 0.13, 0.12, 0.36, [x, 0.82, 0], dress ? cloth : C.cloth, 6);
    k.ball(j, 0.07, [x, 0.59, 0.01], skin);
  }
  if (((h >> 9) & 3) === 0) { // carries a basket
    k.cyl('prop', 0.26, 0.2, 0.16, [0.3, 0.5, 0.05], mix(P.gold, P.cliff, 0.35), 6);
    k.ball('prop', 0.07, [0.27, 0.6, 0.05], P.roof);
    k.ball('prop', 0.06, [0.34, 0.6, 0.02], P.meadow);
  }
  return { hunch: 0, cane: false };
}

// Enemies & boss: minimal but readable (scope: town demo has no combat).
function buildGrunt(k: Kit, cloth: Color3) {
  for (const [j, x] of [['legL', -0.12], ['legR', 0.12]] as [Joint, number][]) {
    k.rod(j, [x, 0.62, 0], [x, 0.08, 0.02], 0.06, P.gold);
    k.box(j, [0.16, 0.05, 0.22], [x, 0.03, 0.06], P.gold);
  }
  k.ball('torso', 0.36, [0, 0.95, 0], cloth, [0.95, 0.85, 1.2]);
  k.ball('torso', 0.25, [0, 0.98, 0.18], P.cloud, [1, 1, 0.8]);
  k.cyl('torso', 0.12, 0.12, 0.08, [0, 1.12, -0.3], P.gold, 6, [Math.PI / 2, 0, 0]);
  k.ball('head', 0.24, [0, 1.38, 0.05], P.cloud);
  k.cyl('head', 0, 0.16, 0.34, [0, 1.34, 0.36], P.gold, 4, [Math.PI / 2, 0, 0]);
  k.box('head', [0.07, 0.07, 0.04], [-0.1, 1.44, 0.24], P.gold, undefined, true);
  k.box('head', [0.07, 0.07, 0.04], [0.1, 1.44, 0.24], P.gold, undefined, true);
  for (const [j, x, s] of [['armL', -0.3, -1], ['armR', 0.3, 1]] as [Joint, number, number][]) {
    k.box(j, [0.08, 0.5, 0.36], [x + s * 0.04, 0.8, -0.05], shade(cloth, 1.3), [0, 0, s * 0.2]);
  }
}
function buildArcher(k: Kit, cloth: Color3) {
  for (const [j, x] of [['legL', -0.12], ['legR', 0.12]] as [Joint, number][]) k.ball(j, 0.14, [x, 0.25, 0], P.cloud, [1, 1.6, 1]);
  k.ball('torso', 0.32, [0, 0.86, 0], P.cloud);
  k.ball('torso', 0.22, [0.2, 0.72, -0.1], P.cloud);
  k.ball('torso', 0.22, [-0.2, 0.72, -0.1], P.cloud);
  k.cyl('torso', 0.3, 0.6, 0.5, [0, 0.95, -0.05], cloth, 6);
  k.ball('head', 0.27, [0, 1.36, 0], cloth, [1, 1, 1]);
  k.cyl('head', 0, 0.2, 0.3, [0, 1.62, -0.12], cloth, 4, [-0.6, 0, 0]);
  k.ball('head', 0.18, [0, 1.33, 0.12], shade(P.rock, 0.5), [1, 0.9, 0.6]);
  k.box('head', [0.06, 0.04, 0.03], [-0.07, 1.35, 0.23], P.gold, undefined, true);
  k.box('head', [0.06, 0.04, 0.03], [0.07, 1.35, 0.23], P.gold, undefined, true);
  for (const [j, x] of [['armL', -0.29], ['armR', 0.29]] as [Joint, number][]) {
    k.cyl(j, 0.12, 0.14, 0.36, [x, 0.82, 0], cloth, 5);
    k.ball(j, 0.08, [x, 0.6, 0.01], P.cloud);
  }
}
function buildBrute(k: Kit, cloth: Color3) {
  for (const [j, x] of [['legL', -0.14], ['legR', 0.14]] as [Joint, number][]) {
    k.cyl(j, 0.22, 0.2, 0.46, [x, 0.38, 0], shade(cloth, 0.8), 6);
    k.box(j, [0.24, 0.16, 0.3], [x, 0.08, 0.04], P.gold);
  }
  k.ball('torso', 0.42, [0, 0.98, 0.02], cloth, [1.2, 0.95, 0.95]);
  k.box('torso', [0.6, 0.2, 0.4], [0, 1.2, -0.05], P.cliff);
  k.ball('head', 0.17, [0, 1.3, 0.16], C.skinDark);
  k.box('head', [0.06, 0.03, 0.03], [-0.06, 1.33, 0.32], P.gold, undefined, true);
  k.box('head', [0.06, 0.03, 0.03], [0.06, 1.33, 0.32], P.gold, undefined, true);
  k.cyl('head', 0, 0.08, 0.2, [-0.15, 1.45, 0.14], P.cloud, 4, [0, 0, 0.6]);
  k.cyl('head', 0, 0.08, 0.2, [0.15, 1.45, 0.14], P.cloud, 4, [0, 0, -0.6]);
  for (const [j, x] of [['armL', -0.42], ['armR', 0.42]] as [Joint, number][]) {
    k.ball(j, 0.2, [x, 1.0, 0], P.cliff);
    k.cyl(j, 0.24, 0.2, 0.42, [x, 0.72, 0.03], cloth, 6);
    k.ball(j, 0.2, [x, 0.45, 0.05], P.gold);
  }
}
function buildWarden(k: Kit) {
  const stone = P.stone, brass = P.gold;
  for (const [j, x] of [['legL', -0.13], ['legR', 0.13]] as [Joint, number][]) {
    k.cyl(j, 0.2, 0.26, 0.5, [x, 0.36, 0], shade(stone, 0.85), 6);
    k.box(j, [0.28, 0.12, 0.34], [x, 0.06, 0.04], brass);
  }
  // striped lighthouse tower body
  const bands = 4;
  for (let i = 0; i < bands; i++) {
    const y0 = 0.62 + (i * 0.52) / bands, h = 0.52 / bands;
    const w0 = 0.6 - (i * 0.16) / bands, w1 = 0.6 - ((i + 1) * 0.16) / bands;
    k.cyl('torso', w1, w0, h, [0, y0 + h / 2, 0], i % 2 === 0 ? P.cloud : P.roof, 8);
  }
  k.cyl('torso', 0.62, 0.62, 0.05, [0, 1.15, 0], brass, 10);      // gallery ring
  k.box('torso', [0.12, 0.2, 0.04], [0, 0.86, 0.3], shade(brass, 0.8)); // front door/keeper's badge
  // weak point: glowing furnace hatch on the back
  k.box('torso', [0.22, 0.2, 0.04], [0, 0.9, -0.27], mix(P.horizon, P.gold, 0.4), undefined, true);
  k.box('torso', [0.28, 0.04, 0.05], [0, 1.02, -0.27], brass);
  k.box('torso', [0.28, 0.04, 0.05], [0, 0.78, -0.27], brass);
  // lamp head
  k.cyl('head', 0.36, 0.36, 0.22, [0, 1.29, 0], mix(P.gold, P.cloud, 0.5), 8, undefined, true);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; k.box('head', [0.02, 0.24, 0.02], [Math.sin(a) * 0.18, 1.29, Math.cos(a) * 0.18], brass); }
  k.cyl('head', 0.42, 0.42, 0.03, [0, 1.18, 0], brass, 10);
  k.cyl('head', 0.04, 0.46, 0.2, [0, 1.5, 0], P.roof, 8);
  k.ball('head', 0.04, [0, 1.62, 0], brass);
  k.box('head', [0.16, 0.05, 0.05], [0, 1.25, 0.2], P.cloud, undefined, true); // forward lens bar
  for (const [j, x] of [['armL', -0.38], ['armR', 0.38]] as [Joint, number][]) {
    k.ball(j, 0.13, [x, 1.05, 0], brass);
    k.cyl(j, 0.16, 0.14, 0.38, [x, 0.8, 0], shade(stone, 0.9), 6);
    k.box(j, [0.2, 0.18, 0.2], [x, 0.54, 0.02], brass);
  }
}

// ───────────────────────── pose / animation ─────────────────────────
const CH = ['base.py', 'base.rx', 'base.rz', 'hips.py', 'hips.ry', 'torso.rx', 'torso.ry', 'torso.rz', 'head.rx', 'head.ry', 'head.rz',
  'cape.rx', 'armL.rx', 'armL.ry', 'armL.rz', 'armR.rx', 'armR.ry', 'armR.rz', 'legL.rx', 'legR.rx', 'legL.rz', 'legR.rz'] as const;
type Ch = typeof CH[number];
type PoseVals = Record<Ch, number>;
const zeroPose = (): PoseVals => Object.fromEntries(CH.map((c) => [c, 0])) as PoseVals;
const LOOPING: Pose[] = ['idle', 'run', 'staggered', 'dead', 'charge'];
const ONE_SHOT_DUR = 0.42;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => x * x * (3 - 2 * x);

function computePose(o: PoseVals, pose: Pose, t: number, T: number, tr: Traits, weapon: WeaponId | 'none', hunch: number) {
  for (const c of CH) o[c] = 0;
  const breathe = Math.sin(T * 2.2);
  // shared idle base
  const idle = () => {
    o['hips.py'] = -0.012 * (1 + breathe);
    o['torso.rx'] = hunch + 0.025 * breathe;
    o['head.rx'] = -hunch * 0.6 - 0.02 * breathe;
    o['head.ry'] = 0.18 * Math.sin(T * 0.45) * Math.sin(T * 0.17);
    o['armL.rz'] = -0.1 - 0.03 * breathe; o['armR.rz'] = 0.1 + 0.03 * breathe;
    o['armL.rx'] = o['armR.rx'] = -0.05 - hunch * 0.5;
    o['cape.rx'] = -0.04 * breathe;
    if (weapon === 'blade') o['armR.rx'] -= 0.15;
    if (hunch > 0) o['armR.rx'] = -0.35; // leaning on the cane
  };
  switch (pose) {
    case 'idle': idle(); break;
    case 'run': {
      const ph = T * tr.cadence * Math.PI * 2;
      const s = Math.sin(ph);
      o['legL.rx'] = -s * tr.stride; o['legR.rx'] = s * tr.stride;
      o['armL.rx'] = s * tr.armSwing - 0.1; o['armR.rx'] = -s * tr.armSwing - 0.1;
      o['armL.rz'] = -0.15; o['armR.rz'] = 0.15;
      o['hips.py'] = Math.abs(Math.cos(ph)) * tr.bob - tr.bob * 0.5;
      o['hips.ry'] = s * 0.12;
      o['torso.rx'] = tr.lean + hunch * 0.6; o['torso.ry'] = -s * 0.18;
      o['head.rx'] = -tr.lean * 0.6; o['head.ry'] = s * 0.1;
      o['cape.rx'] = -0.5 - 0.12 * Math.abs(Math.sin(ph));
      if (tr.heavy) { o['base.rz'] = s * 0.05; }
      if (weapon === 'blade') o['armR.rx'] = -0.4 - s * tr.armSwing * 0.4;
      if (hunch > 0) { o['armR.rx'] = -0.45 - s * 0.25; }
      break;
    }
    case 'attack': {
      idle();
      const p = clamp01(t / ONE_SHOT_DUR);
      if (weapon === 'bow') {
        o['armL.rx'] = -1.5; o['armR.rx'] = -1.4 + 0.3 * ease(p); o['armR.rz'] = -0.35; o['torso.ry'] = -0.35;
      } else if (tr.heavy) {
        const up = p < 0.45 ? ease(p / 0.45) : 1 - ease((p - 0.45) / 0.35);
        o['armL.rx'] = o['armR.rx'] = -2.8 * up - 0.3 * (1 - up);
        o['torso.rx'] = -0.2 * up + 0.35 * (p > 0.45 ? 1 - up : 0);
        o['hips.py'] = p > 0.45 ? -0.08 : 0;
      } else {
        const r = p < 0.4 ? -2.6 * ease(p / 0.4) : -2.6 + 2.2 * ease(clamp01((p - 0.4) / 0.3));
        o['armR.rx'] = r; o['armR.rz'] = 0.2;
        o['torso.ry'] = p < 0.4 ? -0.35 * ease(p / 0.4) : -0.35 + 0.75 * ease(clamp01((p - 0.4) / 0.3));
        o['torso.rx'] = p > 0.4 ? 0.15 : -0.05;
        o['legL.rx'] = -0.35; o['legR.rx'] = 0.3;
      }
      break;
    }
    case 'cast': {
      idle();
      const up = Math.sin(Math.PI * clamp01(t / ONE_SHOT_DUR));
      o['armL.rx'] = o['armR.rx'] = -2.7 * Math.min(1, up * 1.5);
      o['armL.rz'] = -0.45; o['armR.rz'] = 0.45;
      o['head.rx'] = -0.3 * up; o['torso.rx'] = -0.12 * up;
      break;
    }
    case 'hit': {
      idle();
      const k = Math.sin(Math.PI * clamp01(t / ONE_SHOT_DUR)) * (1 - 0.5 * clamp01(t / ONE_SHOT_DUR));
      o['torso.rx'] = -0.4 * k; o['head.rx'] = -0.35 * k; o['torso.rz'] = 0.15 * k;
      o['armL.rz'] = -0.6 * k; o['armR.rz'] = 0.6 * k; o['hips.py'] = -0.05 * k;
      break;
    }
    case 'parry': {
      idle();
      const k = Math.min(1, Math.sin(Math.PI * clamp01(t / ONE_SHOT_DUR)) * 1.8);
      o['armL.rx'] = -1.45 * k; o['armL.rz'] = 0.35 * k;
      o['armR.rx'] = -1.9 * k; o['armR.rz'] = 0.2 * k;
      o['hips.py'] = -0.08 * k; o['torso.rx'] = 0.1 * k;
      o['legL.rx'] = -0.35 * k; o['legR.rx'] = 0.35 * k;
      break;
    }
    case 'charge': {
      idle();
      const q = 0.03 * Math.sin(T * 30);
      o['armL.rx'] = -1.55; o['armL.rz'] = 0.1;
      o['armR.rx'] = -1.45; o['armR.rz'] = -0.6 + q; o['torso.ry'] = -0.45;
      o['head.ry'] = 0.4; o['legL.rx'] = -0.3; o['legR.rx'] = 0.3; o['hips.py'] = -0.04;
      break;
    }
    case 'staggered': {
      const w = Math.sin(T * 3.1);
      o['base.rz'] = 0.1 * w; o['hips.py'] = -0.1;
      o['torso.rx'] = 0.5 + 0.05 * Math.sin(T * 2.3); o['head.rx'] = 0.35; o['head.rz'] = 0.2 * w;
      o['armL.rx'] = o['armR.rx'] = -0.25; o['armL.rz'] = -0.05; o['armR.rz'] = 0.05;
      o['legL.rx'] = -0.2; o['legR.rx'] = 0.25; o['cape.rx'] = -0.1;
      break;
    }
    case 'dead': {
      const p = clamp01(t / 0.7);
      const fall = p < 0.8 ? ease(p / 0.8) : 1 - 0.06 * Math.sin(((p - 0.8) / 0.2) * Math.PI);
      o['base.rx'] = -Math.PI / 2 * fall * 0.97;
      o['base.py'] = 0.12 * fall;
      o['armL.rz'] = -1.2 * fall; o['armR.rz'] = 1.2 * fall; o['head.rx'] = -0.3 * fall;
      o['legL.rx'] = -0.2 * fall; o['legR.rx'] = 0.1 * fall; o['cape.rx'] = -0.2;
      break;
    }
  }
}

// ───────────────────────── shared materials ─────────────────────────
interface SharedMats { body: StandardMaterial; ring: StandardMaterial }
const SHARED = new WeakMap<Scene, SharedMats>();
function shared(scene: Scene): SharedMats {
  let m = SHARED.get(scene);
  if (!m) {
    const body = new StandardMaterial('charBody', scene);
    body.diffuseColor = Color3.White();
    body.specularColor = Color3.Black();
    body.emissiveColor = new Color3(0.16, 0.13, 0.15);
    body.ambientColor = new Color3(0.3, 0.3, 0.32);
    const ring = new StandardMaterial('charRing', scene);
    ring.disableLighting = true;
    ring.emissiveColor = P.gold;
    ring.alpha = 0.9;
    m = { body, ring };
    SHARED.set(scene, m);
  }
  return m;
}

// ───────────────────────── factory ─────────────────────────
let charCounter = 0;
export const makeCharacter: MakeCharacter = (scene: Scene, opts: CharacterOpts): CharacterView => {
  const kind = opts.kind;
  const tr = TRAITS[kind];
  const id = ++charCounter;
  const mats = shared(scene);
  const root = new TransformNode(`char_${kind}_${id}`, scene);
  const rigRoot = new TransformNode(`rig_${id}`, scene);
  rigRoot.parent = root;

  // pivots
  const piv = humanPivots();
  if (kind === 'brute') { piv.armL = [-0.42, 1.03, 0]; piv.armR = [0.42, 1.03, 0]; piv.legL = [-0.14, 0.62, 0]; piv.legR = [0.14, 0.62, 0]; piv.blade = [0.42, 0.45, 0.05]; piv.bow = [-0.42, 0.45, 0.05]; piv.prop = piv.blade; }
  if (kind === 'warden') { piv.armL = [-0.38, 1.05, 0]; piv.armR = [0.38, 1.05, 0]; piv.legL = [-0.13, 0.62, 0]; piv.legR = [0.13, 0.62, 0]; piv.head = [0, 1.16, 0]; }
  const s = tr.scale;

  const skeleton = new Skeleton(`skel_${id}`, `skel_${id}`, scene);
  const nodes = {} as Record<Joint, TransformNode>;
  const jointIndex = {} as Record<Joint, number>;
  const rest = {} as Record<Joint, Vector3>;
  const bones = {} as Record<Joint, Bone>;
  JOINTS.forEach((j, i) => {
    const par = PARENT[j];
    const p = piv[j], pp = par ? piv[par] : [0, 0, 0];
    const local = new Vector3((p[0] - pp[0]) * s, (p[1] - pp[1]) * s, (p[2] - pp[2]) * s);
    rest[j] = local;
    const node = new TransformNode(`${j}_${id}`, scene);
    node.parent = par ? nodes[par] : rigRoot;
    node.position.copyFrom(local);
    nodes[j] = node;
    const bone = new Bone(j, skeleton, par ? bones[par] : null, Matrix.Translation(local.x, local.y, local.z));
    bone.linkTransformNode(node);
    bones[j] = bone;
    jointIndex[j] = i;
  });

  const geo = new Geo(jointIndex);
  const glowGeo = new Geo(jointIndex, 0);
  const kit = new Kit(geo, glowGeo, s);
  const colorHex = opts.color ?? DEFAULT_COLOR[kind] ?? undefined;
  const cloth = colorHex ? hex(colorHex) : P.teal;
  let hunch = tr.hunch;
  let hasProp = false;
  switch (kind) {
    case 'player': buildPlayer(kit, cloth); break;
    case 'companion': buildCompanion(kit, cloth); break;
    case 'npc': { const r = buildNpc(kit, opts.color); hunch = r.hunch; hasProp = true; break; }
    case 'grunt': buildGrunt(kit, cloth); break;
    case 'archer': buildArcher(kit, cloth); break;
    case 'brute': buildBrute(kit, cloth); break;
    case 'warden': buildWarden(kit); break;
  }
  const humanoid = kind === 'player' || kind === 'companion' || kind === 'npc' || kind === 'archer';
  if (kind !== 'warden') weapons(kit, kind === 'player' ? P.skyDeep : kind === 'companion' ? P.teal : shade(P.rock, 1.2));

  const pickables: Mesh[] = [];
  const body = geo.build(`body_${id}`, scene);
  body.parent = rigRoot;
  body.material = mats.body;
  body.skeleton = skeleton;
  body.numBoneInfluencers = 1;
  const R = Math.max(tr.height, 1.2);
  const bounds = new BoundingInfo(new Vector3(-R, -0.2, -R), new Vector3(R, tr.height * 1.25, R));
  body.setBoundingInfo(bounds);
  pickables.push(body);

  let glowMat: StandardMaterial | null = null;
  let glow: Mesh | null = null;
  if (!glowGeo.empty) {
    glow = glowGeo.build(`glow_${id}`, scene);
    glow.parent = rigRoot;
    glow.skeleton = skeleton;
    glow.numBoneInfluencers = 1;
    glow.setBoundingInfo(new BoundingInfo(bounds.minimum.clone(), bounds.maximum.clone()));
    glowMat = new StandardMaterial(`glowMat_${id}`, scene);
    glowMat.disableLighting = true;
    glowMat.emissiveColor = Color3.White();
    glow.material = glowMat;
    pickables.push(glow);
  }

  // target ring (lazy)
  let ring: Mesh | null = null;
  let targeted = false;

  // weapon visibility via bone scaling (keeps 1 draw call)
  let weapon: WeaponId | 'none' = opts.weapon ?? DEFAULT_WEAPON[kind];
  const applyWeapon = () => {
    const show = (j: Joint, on: boolean) => nodes[j].scaling.setAll(on ? 1 : 0);
    show('blade', weapon === 'blade');
    show('shield', weapon === 'blade' && humanoid);
    show('bow', weapon === 'bow');
    show('prop', hasProp && weapon === 'none');
  };
  applyWeapon();

  // animation state
  let looping: Pose = 'idle';
  let pose: Pose = 'idle';
  let poseT = 0;
  let T = Math.random() * 10;
  const cur = zeroPose(), from = zeroPose(), out = zeroPose();
  let blend = 1;
  const BLEND_TIME = 0.14;

  const startPose = (p: Pose) => {
    // freeze current output as the blend source
    for (const c of CH) from[c] = out[c];
    blend = 0; pose = p; poseT = 0;
  };

  const view: CharacterView = {
    root,
    height: tr.height,
    setEntityId(eid: number) {
      for (const m of pickables) m.metadata = { ...(m.metadata ?? {}), entityId: eid };
      root.metadata = { ...(root.metadata ?? {}), entityId: eid };
    },
    setPose(p: Pose) {
      if (LOOPING.includes(p)) {
        if (p === looping) return;
        looping = p;
        const oneShotPlaying = !LOOPING.includes(pose);
        if (!oneShotPlaying || p === 'dead' || p === 'staggered') startPose(p);
      } else {
        if (looping === 'dead') return;
        startPose(p);
      }
    },
    setWeapon(w) { weapon = w; applyWeapon(); },
    setTargeted(on: boolean) {
      targeted = on;
      if (on && !ring) {
        ring = MeshBuilder.CreateTorus(`ring_${id}`, { diameter: tr.ringR * 2, thickness: 0.07 * Math.max(1, tr.ringR), tessellation: 28 }, scene);
        ring.scaling.y = 0.25;
        ring.position.y = 0.04;
        ring.parent = root;
        ring.material = mats.ring;
        ring.isPickable = false;
      }
      if (ring) ring.setEnabled(on);
    },
    update(dt: number) {
      T += dt; poseT += dt;
      if (!LOOPING.includes(pose) && poseT >= ONE_SHOT_DUR) startPose(looping);
      blend = Math.min(1, blend + dt / BLEND_TIME);
      computePose(cur, pose, poseT, T, tr, weapon, hunch);
      const b = ease(blend);
      for (const c of CH) out[c] = from[c] + (cur[c] - from[c]) * b;
      nodes.base.position.y = rest.base.y + out['base.py'] * s;
      nodes.base.rotation.set(out['base.rx'], 0, out['base.rz']);
      nodes.hips.position.y = rest.hips.y + out['hips.py'] * s;
      nodes.hips.rotation.set(0, out['hips.ry'], 0);
      nodes.torso.rotation.set(out['torso.rx'], out['torso.ry'], out['torso.rz']);
      nodes.head.rotation.set(out['head.rx'], out['head.ry'], out['head.rz']);
      nodes.cape.rotation.set(out['cape.rx'], 0, 0);
      nodes.armL.rotation.set(out['armL.rx'], out['armL.ry'], out['armL.rz']);
      nodes.armR.rotation.set(out['armR.rx'], out['armR.ry'], out['armR.rz']);
      nodes.legL.rotation.set(out['legL.rx'], 0, out['legL.rz']);
      nodes.legR.rotation.set(out['legR.rx'], 0, out['legR.rz']);
      if (glowMat) {
        const dead = looping === 'dead';
        const k = dead ? 0.25 : pose === 'staggered' ? 0.55 + 0.3 * Math.abs(Math.sin(T * 9)) : 0.82 + 0.18 * Math.sin(T * 4);
        glowMat.emissiveColor.set(k, k, k);
      }
      if (ring && targeted) {
        ring.rotation.y += dt * 1.2;
        const sc = 1 + 0.05 * Math.sin(T * 5);
        ring.scaling.x = ring.scaling.z = sc;
      }
    },
    dispose() {
      root.dispose(false, false);
      skeleton.dispose();
      glowMat?.dispose();
    },
  };
  view.update(0);
  return view;
};
