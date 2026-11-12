// Procedural stylised characters, built entirely in code.
//
// Each character is ONE skinned mesh (vertex colours, mostly smooth-shaded, up to 2 bone influences so
// elbows/knees/waist bend softly) + an optional emissive mesh for glowing bits (enemies) sharing the same
// skeleton, + a soft blob contact shadow (an InstancedMesh of one shared quad, so all blobs in the scene
// batch into a single draw call). The target ring is created lazily.
//
// Look: primitives (ellipsoids, lathes, swept tubes, thick sheets) are painted per vertex (trims, blush,
// gradients) and then shaded with a baked ambient-occlusion pass (analytic sphere occlusion between parts +
// ground/sky terms), so cloth folds, armpits, under-chin and between-legs darken naturally. A warm fresnel
// rim on the shared material lifts silhouettes ("gold rim" from the art target).
//
// Animation: a TransformNode hierarchy drives the bones. update(dt) evaluates the current pose procedurally,
// cross-fades from the previous pose, then layers: idle life (breathing, weight shift, look-around, blinks),
// spring-based secondary motion (cape, scarf, hair) driven by how the root actually moves, and an airborne
// tuck when the root rises fast (jump).
import {
  Scene, TransformNode, Mesh, InstancedMesh, VertexData, Skeleton, Bone, Matrix, Vector3, Color3,
  StandardMaterial, MeshBuilder, BoundingInfo, Quaternion, DynamicTexture, FresnelParameters,
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
  skin: mix(P.stone, P.horizon, 0.62),
  skinTan: shade(mix(P.horizon, P.cliff, 0.3), 0.95),
  skinDeep: shade(mix(P.cliff, P.horizon, 0.35), 0.78),
  chestnut: shade(mix(P.cliff, P.gold, 0.3), 0.58),
  auburn: shade(mix(P.roof, P.cliff, 0.5), 0.8),
  blond: mix(P.gold, P.stone, 0.4),
  ink: shade(P.rock, 0.42),
  silver: mix(P.cloud, P.stone, 0.3),
  leather: shade(mix(P.cliff, P.gold, 0.2), 0.48),
  leatherLight: shade(mix(P.cliff, P.gold, 0.4), 0.72),
  denim: shade(mix(P.rock, P.skyDeep, 0.45), 0.85),
  khaki: shade(mix(P.stone, P.cliff, 0.3), 0.72),
  cream: mix(P.cloud, P.stone, 0.55),
  steel: mix(P.cloud, P.sky, 0.22),
  blush: mix(P.roof, P.horizon, 0.35),
  lip: shade(P.cliff, 0.7),
  navy: shade(P.skyDeep, 0.78),
};

// ───────────────────────── skeleton layout ─────────────────────────
const JOINTS = ['base', 'hips', 'torso', 'head', 'eyes', 'hair', 'capeA', 'capeB', 'scarf',
  'uArmL', 'fArmL', 'uArmR', 'fArmR', 'thighL', 'shinL', 'thighR', 'shinR',
  'bladeHand', 'shieldArm', 'bowHand', 'prop', 'propL', 'bladeHip', 'shieldBack', 'bowBack'] as const;
type Joint = typeof JOINTS[number];
const PARENT: Record<Joint, Joint | null> = {
  base: null, hips: 'base', torso: 'hips', head: 'torso', eyes: 'head', hair: 'head',
  capeA: 'torso', capeB: 'capeA', scarf: 'torso',
  uArmL: 'torso', fArmL: 'uArmL', uArmR: 'torso', fArmR: 'uArmR',
  thighL: 'hips', shinL: 'thighL', thighR: 'hips', shinR: 'thighR',
  bladeHand: 'fArmR', shieldArm: 'fArmL', bowHand: 'fArmL', prop: 'fArmR', propL: 'fArmL',
  bladeHip: 'hips', shieldBack: 'capeA', bowBack: 'torso',
};
type V3 = [number, number, number];
type Pivots = Record<Joint, V3>;

/** Pivots of the 1.8 m stylised humanoid (about four heads tall). */
function humanPivots(sh = 0.235): Pivots {
  return {
    base: [0, 0, 0], hips: [0, 0.88, 0], torso: [0, 0.93, 0], head: [0, 1.33, 0], eyes: [0, 1.565, 0.17], hair: [0, 1.66, -0.12],
    capeA: [0, 1.3, -0.12], capeB: [0, 0.98, -0.2], scarf: [0, 1.33, -0.1],
    uArmL: [-sh, 1.265, 0], fArmL: [-sh - 0.015, 1.02, 0], uArmR: [sh, 1.265, 0], fArmR: [sh + 0.015, 1.02, 0],
    thighL: [-0.1, 0.86, 0], shinL: [-0.1, 0.47, 0], thighR: [0.1, 0.86, 0], shinR: [0.1, 0.47, 0],
    bladeHand: [sh + 0.025, 0.73, 0.02], shieldArm: [-sh - 0.06, 0.9, 0], bowHand: [-sh - 0.025, 0.73, 0.02],
    prop: [sh + 0.025, 0.73, 0.02], propL: [-sh - 0.025, 0.73, 0.02],
    bladeHip: [-0.19, 0.9, 0.06], shieldBack: [0, 1.12, -0.21], bowBack: [0, 1.1, -0.2],
  };
}
/** The old compact layout, kept for the (minimal) enemy models. */
function legacyPivots(): Pivots {
  return {
    base: [0, 0, 0], hips: [0, 0.62, 0], torso: [0, 0.66, 0], head: [0, 1.12, 0], eyes: [0, 1.4, 0.2], hair: [0, 1.5, -0.1],
    capeA: [0, 1.1, -0.17], capeB: [0, 0.8, -0.2], scarf: [0, 1.1, 0],
    uArmL: [-0.29, 1.03, 0], fArmL: [-0.29, 0.8, 0], uArmR: [0.29, 1.03, 0], fArmR: [0.29, 0.8, 0],
    thighL: [-0.12, 0.62, 0], shinL: [-0.12, 0.32, 0], thighR: [0.12, 0.62, 0], shinR: [0.12, 0.32, 0],
    bladeHand: [0.3, 0.6, 0.02], shieldArm: [-0.36, 0.78, 0], bowHand: [-0.3, 0.6, 0.02], prop: [0.3, 0.6, 0.02], propL: [-0.3, 0.6, 0.02],
    bladeHip: [-0.2, 0.65, 0.05], shieldBack: [0, 0.9, -0.2], bowBack: [0, 0.9, -0.2],
  };
}

// ───────────────────────── geometry ─────────────────────────
/** A skinning group: a fixed joint, or a limb/body region split between two bones by height. */
type Group = Joint | 'armL' | 'armR' | 'legL' | 'legR' | 'body' | 'cape';
type Paint = (w: Vector3, uv: [number, number], l: Vector3) => Color3 | undefined;
interface Occ { c: Vector3; r: number; prim: number }

class Geo {
  pos: number[] = []; nrm: number[] = []; col: number[] = []; mi: number[] = []; mw: number[] = []; idx: number[] = [];
  prim: number[] = [];
  occ: Occ[] = [];
  primCount = 0;
  heightScale = 1;
  constructor(private resolve: (g: Group, p: Vector3) => [number, number, number], private jitter = 0.035) {}

  /** Append a primitive. `out` gives each vertex's outward reference direction (fixes triangle winding). */
  add(P: Vector3[], out: Vector3[], tris: number[], cols: Color3[], group: Group, flat: boolean, occ: { c: Vector3; r: number }[]) {
    const prim = this.primCount++;
    for (const o of occ) this.occ.push({ c: o.c, r: o.r, prim });
    // orient each triangle so (c-a)x(b-a) points outward (renders front-facing in Babylon)
    const t = tris.slice();
    for (let i = 0; i < t.length; i += 3) {
      const a = P[t[i]], b = P[t[i + 1]], c = P[t[i + 2]];
      const n = Vector3.Cross(c.subtract(a), b.subtract(a));
      const o = out[t[i]].add(out[t[i + 1]]).add(out[t[i + 2]]);
      if (Vector3.Dot(n, o) < 0) { const k = t[i + 1]; t[i + 1] = t[i + 2]; t[i + 2] = k; }
    }
    const pushV = (p: Vector3, n: Vector3, c: Color3) => {
      const [b0, b1, w0] = this.resolve(group, p);
      this.pos.push(p.x, p.y, p.z); this.nrm.push(n.x, n.y, n.z); this.col.push(c.r, c.g, c.b, 1);
      this.mi.push(b0, b1, 0, 0); this.mw.push(w0, 1 - w0, 0, 0); this.prim.push(prim);
      return this.pos.length / 3 - 1;
    };
    if (flat) {
      for (let i = 0; i < t.length; i += 3) {
        const a = P[t[i]], b = P[t[i + 1]], c = P[t[i + 2]];
        const n = Vector3.Cross(c.subtract(a), b.subtract(a));
        if (n.lengthSquared() < 1e-16) continue;
        n.normalize();
        const h = Math.sin(Math.round(n.x * 6) * 12.9898 + Math.round(n.y * 6) * 78.233 + Math.round(n.z * 6) * 37.719 + prim * 4.13) * 43758.5453;
        const f = 1 + (h - Math.floor(h) - 0.5) * 2 * this.jitter;
        for (const k of [t[i], t[i + 1], t[i + 2]]) this.idx.push(pushV(P[k], n, shade(cols[k], f)));
      }
      return;
    }
    const N = P.map(() => new Vector3());
    for (let i = 0; i < t.length; i += 3) {
      const a = P[t[i]], b = P[t[i + 1]], c = P[t[i + 2]];
      const n = Vector3.Cross(c.subtract(a), b.subtract(a));
      N[t[i]].addInPlace(n); N[t[i + 1]].addInPlace(n); N[t[i + 2]].addInPlace(n);
    }
    const base = P.map((p, i) => { const n = N[i]; if (n.lengthSquared() < 1e-16) n.copyFrom(out[i]); n.normalize(); return pushV(p, n, cols[i]); });
    for (const k of t) this.idx.push(base[k]);
  }

  /** Bake ambient occlusion into vertex colours. */
  bakeAO(strength = 0.6, groundY = 0) {
    const n = this.pos.length / 3;
    const p = new Vector3(), nm = new Vector3(), d = new Vector3();
    for (let i = 0; i < n; i++) {
      p.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      nm.set(this.nrm[i * 3], this.nrm[i * 3 + 1], this.nrm[i * 3 + 2]);
      let occ = 0;
      for (const o of this.occ) {
        if (o.prim === this.prim[i]) continue;
        o.c.subtractToRef(p, d);
        const dist = d.length();
        if (dist < 1e-5) continue;
        const cosT = Vector3.Dot(nm, d) / dist;
        if (cosT <= 0) continue;
        occ += cosT * Math.min(1, (o.r * o.r) / (dist * dist));
      }
      let ao = 1 - strength * Math.min(1, occ * 0.85);
      ao *= 0.86 + 0.14 * Math.max(0, Math.min(1, (p.y - groundY) / (1.7 * this.heightScale))); // painterly top-light gradient
      const gy = Math.max(0, Math.min(1, (p.y - groundY) / 0.3));
      ao *= 0.78 + 0.22 * gy;                                  // contact with the ground
      ao *= 1 - 0.16 * Math.max(0, -nm.y) + 0.04 * Math.max(0, nm.y); // sky visibility
      this.col[i * 4] *= ao; this.col[i * 4 + 1] *= ao; this.col[i * 4 + 2] *= ao;
    }
  }
  get empty() { return this.pos.length === 0; }
  get triangles() { return this.idx.length / 3; }
  build(name: string, scene: Scene): Mesh {
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.pos; vd.normals = this.nrm; vd.colors = this.col; vd.indices = this.idx;
    vd.matricesIndices = this.mi; vd.matricesWeights = this.mw;
    vd.applyToMesh(mesh, false);
    return mesh;
  }
}

interface PrimOpts {
  rot?: V3;
  flat?: boolean;
  paint?: Paint;
  glow?: boolean;
  noOcc?: boolean;
  seg?: number;
}
interface EllipOpts extends PrimOpts { lat?: number; power?: number; deform?: (l: Vector3) => void }
interface LatheOpts extends PrimOpts { sx?: number; sz?: number; caps?: boolean; arc?: [number, number] }
interface TubeOpts extends PrimOpts { flatten?: number; caps?: boolean }

const rotQ = (rot?: V3) => (rot ? Quaternion.RotationYawPitchRoll(rot[1], rot[0], rot[2]) : Quaternion.Identity());

/** Shape kit: builds primitives into a Geo (uniform scale `s`). */
class Kit {
  constructor(public g: Geo, public glow: Geo, public s: number) {}
  private place(at: V3, rot?: V3) {
    const q = rotQ(rot), s = this.s, o = new Vector3(at[0], at[1], at[2]);
    return (v: Vector3) => { const r = new Vector3(); v.rotateByQuaternionToRef(q, r); return r.addInPlace(o).scaleInPlace(s); };
  }
  private dirOf(rot?: V3) { const q = rotQ(rot); return (v: Vector3) => { const r = new Vector3(); v.rotateByQuaternionToRef(q, r); return r; }; }
  private colorsFor(W: Vector3[], uv: [number, number][], L: Vector3[], col: Color3, paint?: Paint) {
    return W.map((w, i) => (paint ? paint(w.scale(1 / this.s), uv[i], L[i]) : undefined) ?? col);
  }

  /** Ellipsoid (optionally boxy via `power` < 1, and freely deformed in unit space). */
  ellip(g: Group, at: V3, rad: V3, col: Color3, o: EllipOpts = {}) {
    const seg = o.seg ?? 12, lat = o.lat ?? Math.max(4, Math.round(seg * 0.6));
    const L: Vector3[] = [], uv: [number, number][] = [];
    const pw = o.power ?? 1;
    const sp = (x: number) => Math.sign(x) * Math.pow(Math.abs(x), pw);
    L.push(new Vector3(0, 1, 0)); uv.push([0, 0]);
    for (let i = 1; i < lat; i++) {
      const th = (Math.PI * i) / lat;
      for (let j = 0; j < seg; j++) {
        const ph = (Math.PI * 2 * j) / seg;
        L.push(new Vector3(sp(Math.sin(th) * Math.sin(ph)), sp(Math.cos(th)), sp(Math.sin(th) * Math.cos(ph))));
        uv.push([j / seg, i / lat]);
      }
    }
    L.push(new Vector3(0, -1, 0)); uv.push([0, 1]);
    if (o.deform) for (const l of L) o.deform(l);
    const tr = this.place(at, o.rot), dr = this.dirOf(o.rot);
    const W = L.map((l) => tr(new Vector3(l.x * rad[0], l.y * rad[1], l.z * rad[2])));
    const OUT = L.map((l) => dr(new Vector3(l.x / rad[0], l.y / rad[1], l.z / rad[2])));
    const tris: number[] = [];
    const ring = (i: number, j: number) => 1 + (i - 1) * seg + (j % seg);
    for (let j = 0; j < seg; j++) tris.push(0, ring(1, j), ring(1, j + 1));
    for (let i = 1; i < lat - 1; i++) for (let j = 0; j < seg; j++) {
      tris.push(ring(i, j), ring(i + 1, j), ring(i + 1, j + 1), ring(i, j), ring(i + 1, j + 1), ring(i, j + 1));
    }
    const last = L.length - 1;
    for (let j = 0; j < seg; j++) tris.push(last, ring(lat - 1, j), ring(lat - 1, j + 1));
    const occ: { c: Vector3; r: number }[] = [];
    if (!o.noOcc) {
      const rs = rad.map((r) => r * this.s);
      const mn = Math.min(...rs), mx = Math.max(...rs);
      const axis = rs.indexOf(mx);
      const n = Math.min(4, Math.max(1, Math.round(mx / mn)));
      for (let k = 0; k < n; k++) {
        const f = n === 1 ? 0 : (k / (n - 1)) * 2 - 1;
        const v = new Vector3(axis === 0 ? f * (rad[0] - Math.min(...rad)) : 0, axis === 1 ? f * (rad[1] - Math.min(...rad)) : 0, axis === 2 ? f * (rad[2] - Math.min(...rad)) : 0);
        occ.push({ c: tr(v), r: mn });
      }
    }
    (o.glow ? this.glow : this.g).add(W, OUT, tris, this.colorsFor(W, uv, L, col, o.paint), g, !!o.flat, occ);
  }

  /** Surface of revolution around local Y. profile: [y, radius][] from bottom to top. */
  lathe(g: Group, at: V3, profile0: [number, number][], col: Color3, o: LatheOpts = {}) {
    const seg = o.seg ?? 12, sx = o.sx ?? 1, sz = o.sz ?? 1;
    // painted surfaces need rows close together so colour bands stay crisp
    const profile: [number, number][] = [];
    const step = o.paint ? 0.028 : 1e9;
    profile0.forEach((p, i) => {
      if (i > 0) {
        const q = profile0[i - 1];
        const n = Math.floor(Math.abs(p[0] - q[0]) / step);
        for (let k = 1; k <= n; k++) { const t = k / (n + 1); profile.push([q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t]); }
      }
      profile.push(p);
    });
    const arc = o.arc;
    const closed = !arc;
    const nCol = closed ? seg : seg + 1;
    const L: Vector3[] = [], OUTL: Vector3[] = [], uv: [number, number][] = [];
    const rows: number[][] = [];
    profile.forEach(([y, r], i) => {
      const row: number[] = [];
      for (let j = 0; j < nCol; j++) {
        const ph = arc ? arc[0] + ((arc[1] - arc[0]) * j) / seg : (Math.PI * 2 * j) / seg;
        const cx = Math.sin(ph), cz = Math.cos(ph);
        row.push(L.length);
        L.push(new Vector3(cx * r * sx, y, cz * r * sz));
        // outward: radial, tilted by the profile slope
        const prev = profile[Math.max(0, i - 1)], next = profile[Math.min(profile.length - 1, i + 1)];
        const dy = next[0] - prev[0], dr = next[1] - prev[1];
        OUTL.push(new Vector3(cx / sx * Math.abs(dy) + 1e-4 * cx, -dr * Math.sign(dy || 1), cz / sz * Math.abs(dy) + 1e-4 * cz));
        uv.push([j / seg, i / (profile.length - 1)]);
      }
      rows.push(row);
    });
    const tris: number[] = [];
    for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < seg; j++) {
      const a = rows[i][j], b = rows[i][(j + 1) % nCol], c = rows[i + 1][j], d = rows[i + 1][(j + 1) % nCol];
      tris.push(a, c, d, a, d, b);
    }
    if ((o.caps ?? true) && closed) {
      for (const [ri, dir] of [[0, -1], [rows.length - 1, 1]] as [number, number][]) {
        if (profile[ri][1] < 1e-4) continue;
        const ci = L.length; L.push(new Vector3(0, profile[ri][0], 0)); OUTL.push(new Vector3(0, dir, 0)); uv.push([0, ri === 0 ? 0 : 1]);
        for (let j = 0; j < seg; j++) tris.push(ci, rows[ri][j], rows[ri][(j + 1) % seg]);
        for (const k of rows[ri]) OUTL[k].addInPlace(new Vector3(0, dir * 0.6, 0));
      }
    }
    const tr = this.place(at, o.rot), dr = this.dirOf(o.rot);
    const W = L.map((l) => tr(l)), OUT = OUTL.map((v) => dr(v));
    const occ: { c: Vector3; r: number }[] = [];
    if (!o.noOcc) for (let i = 0; i < profile.length - 1; i++) {
      const h = Math.abs(profile[i + 1][0] - profile[i][0]);
      const r = ((profile[i][1] + profile[i + 1][1]) / 2) * Math.min(sx, sz);
      if (r < 0.01) continue;
      occ.push({ c: tr(new Vector3(0, (profile[i][0] + profile[i + 1][0]) / 2, 0)), r: Math.min(r, Math.max(h, r * 0.6)) * this.s * 0.9 });
    }
    (o.glow ? this.glow : this.g).add(W, OUT, tris, this.colorsFor(W, uv, L, col, o.paint), g, !!o.flat, occ);
  }

  /** Swept tube through points (model space) with per-point radius. */
  tube(g: Group, pts: V3[], radii: number | number[], col: Color3, o: TubeOpts = {}) {
    const seg = o.seg ?? 6;
    const R = (i: number) => (Array.isArray(radii) ? radii[i] : radii);
    const V = pts.map((p) => new Vector3(...p));
    const T = V.map((_, i) => V[Math.min(V.length - 1, i + 1)].subtract(V[Math.max(0, i - 1)]).normalize());
    // parallel-transport frames
    let nrm = Math.abs(T[0].y) < 0.9 ? Vector3.Cross(T[0], Vector3.Up()).normalize() : Vector3.Cross(T[0], Vector3.Right()).normalize();
    const NS: Vector3[] = [], BS: Vector3[] = [];
    for (let i = 0; i < V.length; i++) {
      if (i > 0) { const b = Vector3.Cross(T[i - 1], T[i]); if (b.length() > 1e-6) { const q = Quaternion.RotationAxis(b.normalize(), Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(T[i - 1], T[i]))))); nrm = nrm.applyRotationQuaternion(q); } }
      NS.push(nrm.clone()); BS.push(Vector3.Cross(T[i], nrm).normalize());
    }
    const fl = o.flatten ?? 1;
    const L: Vector3[] = [], OUT: Vector3[] = [], uv: [number, number][] = [];
    const rows: number[][] = [];
    V.forEach((c, i) => {
      const row: number[] = [];
      for (let j = 0; j < seg; j++) {
        const ph = (Math.PI * 2 * j) / seg;
        const dir = NS[i].scale(Math.cos(ph) * fl).add(BS[i].scale(Math.sin(ph)));
        row.push(L.length);
        L.push(c.add(dir.scale(R(i)))); OUT.push(NS[i].scale(Math.cos(ph) / fl).add(BS[i].scale(Math.sin(ph))));
        uv.push([j / seg, i / (V.length - 1)]);
      }
      rows.push(row);
    });
    const tris: number[] = [];
    for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < seg; j++) {
      const a = rows[i][j], b = rows[i][(j + 1) % seg], c = rows[i + 1][j], d = rows[i + 1][(j + 1) % seg];
      tris.push(a, c, d, a, d, b);
    }
    if (o.caps ?? true) for (const [ri, dir] of [[0, -1], [rows.length - 1, 1]] as [number, number][]) {
      if (R(ri) < 1e-4) continue;
      const ci = L.length; L.push(V[ri].clone()); OUT.push(T[ri].scale(dir)); uv.push([0, ri ? 1 : 0]);
      for (let j = 0; j < seg; j++) tris.push(ci, rows[ri][j], rows[ri][(j + 1) % seg]);
    }
    const W = L.map((l) => l.scale(this.s));
    const occ = o.noOcc ? [] : V.filter((_, i) => i % 2 === 0).map((c, k) => ({ c: c.scale(this.s), r: R(k * 2) * this.s * Math.min(1, fl) }));
    (o.glow ? this.glow : this.g).add(W, OUT, tris, this.colorsFor(W, uv, L, col, o.paint), g, !!o.flat, occ);
  }

  /** A thick cloth sheet from a grid of points (rows x cols, model space). */
  sheet(g: Group, grid: V3[][], thick: number, col: Color3, o: PrimOpts = {}) {
    const rN = grid.length, cN = grid[0].length;
    const G = grid.map((r) => r.map((p) => new Vector3(...p)));
    const nAt = (i: number, j: number) => {
      const du = G[i][Math.min(cN - 1, j + 1)].subtract(G[i][Math.max(0, j - 1)]);
      const dv = G[Math.min(rN - 1, i + 1)][j].subtract(G[Math.max(0, i - 1)][j]);
      return Vector3.Cross(du, dv).normalize();
    };
    const L: Vector3[] = [], OUT: Vector3[] = [], uv: [number, number][] = [];
    const id: number[][][] = [[], []];
    for (let side = 0; side < 2; side++) for (let i = 0; i < rN; i++) {
      id[side].push([]);
      for (let j = 0; j < cN; j++) {
        const n = nAt(i, j); const sgn = side === 0 ? 1 : -1;
        id[side][i].push(L.length);
        L.push(G[i][j].add(n.scale((sgn * thick) / 2))); OUT.push(n.scale(sgn)); uv.push([j / (cN - 1), i / (rN - 1)]);
      }
    }
    const tris: number[] = [];
    for (let s2 = 0; s2 < 2; s2++) for (let i = 0; i < rN - 1; i++) for (let j = 0; j < cN - 1; j++) {
      const a = id[s2][i][j], b = id[s2][i][j + 1], c = id[s2][i + 1][j], d = id[s2][i + 1][j + 1];
      tris.push(a, c, d, a, d, b);
    }
    // rims (edges) — their outward reference is the in-plane edge direction
    const rim = (a0: number, a1: number, b0: number, b1: number, outv: Vector3) => {
      const k = L.length;
      for (const q of [a0, a1, b0, b1]) { L.push(L[q].clone()); OUT.push(outv); uv.push(uv[q]); }
      tris.push(k, k + 2, k + 3, k, k + 3, k + 1);
    };
    for (let i = 0; i < rN - 1; i++) {
      for (const j of [0, cN - 1]) {
        const ov = G[i][j].subtract(G[i][j === 0 ? 1 : cN - 2]).normalize();
        rim(id[0][i][j], id[0][i + 1][j], id[1][i][j], id[1][i + 1][j], ov);
      }
    }
    for (let j = 0; j < cN - 1; j++) {
      for (const i of [0, rN - 1]) {
        const ov = G[i][j].subtract(G[i === 0 ? 1 : rN - 2][j]).normalize();
        rim(id[0][i][j], id[0][i][j + 1], id[1][i][j], id[1][i][j + 1], ov);
      }
    }
    const W = L.map((l) => l.scale(this.s));
    (o.glow ? this.glow : this.g).add(W, OUT, tris, this.colorsFor(W, uv, L, col, o.paint), g, !!o.flat, []);
  }

  // ── legacy flat helpers (enemies, weapons) ──
  private fromVD(g: Group, vd: VertexData, at: V3, col: Color3, rot?: V3, glow = false, scale?: V3) {
    const p = vd.positions!, ind = vd.indices!;
    const q = rotQ(rot);
    const m = Matrix.Compose(new Vector3(...(scale ?? [1, 1, 1])), q, new Vector3(...at).scale(this.s));
    const W: Vector3[] = [], OUT: Vector3[] = [];
    const c0 = Vector3.TransformCoordinates(Vector3.Zero(), m);
    for (let i = 0; i < p.length; i += 3) { const w = Vector3.TransformCoordinates(new Vector3(p[i] * this.s, p[i + 1] * this.s, p[i + 2] * this.s), m); W.push(w); OUT.push(w.subtract(c0)); }
    const cols = W.map(() => col);
    (glow ? this.glow : this.g).add(W, OUT, Array.from(ind), cols, g, true, glow ? [] : [{ c: c0, r: 0.05 * this.s }]);
  }
  box(g: Group, size: V3, at: V3, col: Color3, rot?: V3, glow = false) {
    this.fromVD(g, CreateBoxVertexData({ width: size[0], height: size[1], depth: size[2] }), at, col, rot, glow);
  }
  cyl(g: Group, top: number, bottom: number, h: number, at: V3, col: Color3, tess = 8, rot?: V3, glow = false) {
    this.fromVD(g, CreateCylinderVertexData({ diameterTop: top, diameterBottom: bottom, height: h, tessellation: tess }), at, col, rot, glow);
  }
  ball(g: Group, r: number, at: V3, col: Color3, scale: V3 = [1, 1, 1], rot?: V3, glow = false) {
    this.fromVD(g, CreateIcoSphereVertexData({ radius: r, subdivisions: 1, flat: true }), at, col, rot, glow, scale);
  }
  rod(g: Group, a: V3, b: V3, thick: number, col: Color3, glow = false, tess = 4) {
    const va = new Vector3(...a), vb = new Vector3(...b);
    const d = vb.subtract(va); const len = d.length(); d.normalize();
    const q = new Quaternion(); Quaternion.FromUnitVectorsToRef(Vector3.Up(), d, q);
    const e = q.toEulerAngles();
    this.fromVD(g, CreateCylinderVertexData({ diameter: thick, height: len, tessellation: tess }), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], col, [e.x, e.y, e.z], glow);
  }
}

// ───────────────────────── humanoid design spec ─────────────────────────
type HairStyle = 'hero' | 'braid' | 'bun' | 'pony' | 'short' | 'bald' | 'bob' | 'none';
type Hat = 'none' | 'cap' | 'straw' | 'kerchief' | 'witch';
type IdleStyle = 'hero' | 'cane' | 'hips' | 'wipe' | 'relaxed' | 'behind' | 'basket';
interface HumanSpec {
  skin: Color3; hair: Color3; hairStyle: HairStyle; brows?: Color3;
  eyes?: 'open' | 'kind';
  top: Color3; topTrim?: Color3; hem: number; flare: number; girth: number; belly?: number;
  vneck?: Color3;
  sleeves: 'short' | 'long' | 'rolled'; sleeveColor?: Color3;
  legs: Color3 | null;   // null: long robe/dress covers the legs
  boots: Color3; bootTop?: number;
  belt?: Color3; buckle?: Color3;
  apron?: Color3; apronLong?: boolean;
  vest?: Color3;
  shawl?: Color3;
  cape?: { color: Color3; trim: Color3; len: number };
  scarf?: Color3;
  hat: Hat; hatColor?: Color3; hatBand?: Color3;
  beard?: 'full' | 'moustache' | 'stubble';
  glasses?: boolean;
  pouch?: boolean;
}

function headPaint(skin: Color3, blush: number): Paint {
  return (_w, _uv, l) => {
    // l is in unit-sphere space (z forward). Cheeks blush, gentle lighter forehead.
    const cheek = Math.exp(-(((Math.abs(l.x) - 0.55) ** 2) / 0.03 + ((l.y + 0.28) ** 2) / 0.02)) * (l.z > 0.3 ? 1 : 0);
    let c = mix(skin, C.blush, Math.min(0.55, cheek * blush));
    if (l.y > 0.4) c = mix(c, shade(skin, 1.06), (l.y - 0.4));
    return c;
  };
}

/** Build a stylised humanoid into the kit. Returns the head centre (for accessories). */
function buildHuman(k: Kit, sp: HumanSpec, pv: Pivots) {
  const sh = pv.uArmR[0];
  const girth = sp.girth;
  const belly = sp.belly ?? 0;
  const brows = sp.brows ?? shade(sp.hair, 0.8);
  const HY = 1.565; // head centre y
  // ── legs ──
  for (const [g, x] of [['legL', pv.thighL[0]], ['legR', pv.thighR[0]]] as [Group, number][]) {
    const bt = sp.bootTop ?? 0.38;
    if (sp.legs) k.lathe(g, [x, 0, 0], [[bt - 0.04, 0.062], [0.47, 0.072], [0.62, 0.083], [0.86, 0.092], [0.92, 0.07]], sp.legs, { seg: 10, sz: 1.05 });
    else k.lathe(g, [x, 0, 0], [[bt - 0.04, 0.056], [0.62, 0.066]], mix(P.rock, P.stone, 0.35), { seg: 8 });
    // boot shaft with cuff
    k.lathe(g, [x, 0, 0.0], [[0.03, 0.07], [0.12, 0.072], [bt - 0.03, 0.068], [bt, 0.084], [bt + 0.035, 0.084], [bt + 0.04, 0.06]], sp.boots, { seg: 10, sz: 1.08 });
    // foot (boxy rounded), with a darker sole
    k.ellip(g, [x, 0.055, 0.06], [0.072, 0.058, 0.125], sp.boots, { seg: 10, lat: 6, power: 0.7,
      paint: (w) => (w.y < 0.018 ? shade(sp.boots, 0.55) : undefined) });
  }
  // pelvis / seat
  if (sp.legs) k.lathe('body', [0, 0, 0], [[0.74, 0.12], [0.8, 0.17 * girth], [0.94, 0.175 * girth], [0.98, 0.15]], sp.legs, { seg: 12, sz: 0.85 });

  // ── torso / tunic / coat ──
  const hem = sp.hem, fl = sp.flare;
  const top = sp.top, trim = sp.topTrim;
  const W = 0.19 * girth;
  const prof: [number, number][] = [
    [hem, W + fl], [hem + 0.03, W + fl * 0.95], [0.86, W + fl * 0.35], [0.95, W * 0.92],
    [1.04, W * (1.0 + belly * 0.6)], [1.12, W * (1.03 + belly * 0.3)], [1.22, W * 1.02], [1.28, W * 0.86], [1.32, 0.11], [1.345, 0.065],
  ];
  if (hem > 0.86) prof.splice(0, 3, [hem, W * 0.92]);
  k.lathe('body', [0, 0, 0], prof, top, { seg: 16, sz: 0.78 + belly * 0.25, paint: (w, uv) => {
    if (trim && w.y < hem + 0.035) return trim;
    // soft vertical fold shading on the skirt
    if (w.y < 0.9) return shade(top, 0.93 + 0.07 * Math.cos(uv[0] * Math.PI * 2 * 6));
    return undefined;
  } });
  if (sp.vneck) {
    // shirt front showing at the open collar, with lacing
    const zf = W * 1.02 * (0.78 + belly * 0.25);
    k.ellip('body', [0, 1.235, zf - 0.012], [0.052, 0.085, 0.02], sp.vneck, { seg: 8, lat: 6, power: 0.8, noOcc: true });
    k.tube('body', [[-0.02, 1.27, zf + 0.004], [0.02, 1.23, zf + 0.006], [-0.02, 1.19, zf + 0.004]], 0.006, C.leather, { seg: 3, noOcc: true });
  }
  if (sp.vest) {
    k.lathe('body', [0, 0, 0], [[0.9, W * 0.99 + 0.012], [1.04, W * (1.0 + belly * 0.6) + 0.014], [1.2, W * 1.03 + 0.014], [1.28, W * 0.88 + 0.012], [1.31, 0.115]], sp.vest,
      { seg: 16, sz: 0.8 + belly * 0.25, arc: [0.35, Math.PI * 2 - 0.35], caps: false });
  }
  if (sp.belt) {
    k.lathe('body', [0, 0, 0], [[0.9, W * 0.95 + 0.012], [0.94, W * 0.95 + 0.016], [0.98, W * 0.95 + 0.012]], sp.belt, { seg: 16, sz: 0.8 + belly * 0.2 });
    if (sp.buckle) k.ellip('body', [0, 0.94, (W * 0.95 + 0.016) * (0.8 + belly * 0.2) + 0.008], [0.04, 0.032, 0.012], sp.buckle, { seg: 8, lat: 4, power: 0.5, flat: true });
  }
  if (sp.pouch) {
    k.ellip('body', [0.15, 0.88, 0.07], [0.05, 0.055, 0.035], C.leatherLight, { seg: 8, lat: 5, power: 0.75 });
    k.ellip('body', [0.08, 0.86, -0.14], [0.06, 0.05, 0.035], C.leather, { seg: 8, lat: 5, power: 0.75 });
  }
  if (sp.apron) {
    const z0 = W * 0.8 + 0.01 + belly * 0.05;
    const bottom = sp.apronLong ? 0.5 : 0.7;
    const grid: V3[][] = [];
    const topY = 0.97;
    for (let i = 0; i <= 5; i++) {
      const y = topY - (i / 5) * (topY - bottom);
      const row: V3[] = [];
      for (let j = 0; j <= 4; j++) {
        const u = j / 4 - 0.5;
        const wid = y > 0.96 ? 0.13 : 0.19 + (0.96 - y) * 0.15;
        const bulge = y > 0.9 && y < 1.15 ? belly * 0.07 * Math.sin(((y - 0.9) / 0.25) * Math.PI) : 0;
        const zz = (y > 0.95 ? z0 - 0.01 + bulge : z0 + (0.95 - y) * 0.18) - Math.abs(u) * 0.07 + 0.012;
        row.push([u * wid * 2, y, zz]);
      }
      grid.push(row);
    }
    k.sheet('body', grid, 0.014, sp.apron, { paint: (w) => (w.y < bottom + 0.03 ? shade(sp.apron!, 0.88) : undefined) });
    // apron strings tied at the back
    k.tube('body', [[-0.14, 0.95, z0 - 0.02], [-0.2, 0.95, -0.05], [0, 0.96, -0.16], [0.2, 0.95, -0.05], [0.14, 0.95, z0 - 0.02]], 0.012, sp.apron, { seg: 4, noOcc: true });
  }
  // neck
  k.lathe('head', [0, 0, 0], [[1.3, 0.058], [1.42, 0.054]], shade(sp.skin, 0.93), { seg: 8, caps: false, noOcc: true });

  // ── arms ──
  for (const [g, side] of [['armL', -1], ['armR', 1]] as [Group, number][]) {
    const ax = side * (sh + 0.012);
    const sleeve = sp.sleeveColor ?? top;
    k.ellip(g, [side * (sh - 0.012), 1.255, 0], [0.08, 0.072, 0.074], sleeve, { seg: 10, lat: 6 });
    if (sp.sleeves === 'long') {
      k.lathe(g, [ax, 0, 0], [[0.79, 0.056], [0.82, 0.068], [1.02, 0.064], [1.26, 0.072]], sleeve, { seg: 9, caps: false,
        paint: (w) => (w.y < 0.825 && trim ? trim : undefined) });
    } else {
      const cuffY = sp.sleeves === 'short' ? 1.1 : 0.99;
      k.lathe(g, [ax, 0, 0], [[cuffY - 0.02, 0.066], [cuffY, 0.072], [1.26, 0.074]], sleeve, { seg: 9, caps: false });
      if (sp.sleeves === 'rolled') k.lathe(g, [ax, 0, 0], [[0.965, 0.07], [0.99, 0.078], [1.03, 0.07]], shade(sleeve, 1.06), { seg: 9 });
      k.lathe(g, [ax, 0, 0], [[0.77, 0.043], [0.88, 0.048], [1.02, 0.05], [cuffY + 0.01, 0.056]], sp.skin, { seg: 8, caps: false });
      if (sp.sleeves === 'short' && sp.cape) k.lathe(g, [ax, 0, 0], [[0.79, 0.052], [0.8, 0.056], [0.93, 0.056], [0.94, 0.052]], C.leatherLight, { seg: 8 }); // bracer
    }
    // hand: palm + thumb
    const hy = 0.715;
    k.ellip(g, [side * (sh + 0.028), hy, 0.01], [0.042, 0.06, 0.05], sp.skin, { seg: 8, lat: 6, power: 0.85 });
    k.ellip(g, [side * (sh + 0.01), hy + 0.02, 0.045], [0.018, 0.034, 0.018], sp.skin, { seg: 6, lat: 4, rot: [0.4, 0, side * 0.3], noOcc: true });
  }

  // ── head ──
  k.ellip('head', [0, HY, 0.01], [0.195, 0.205, 0.185], sp.skin, { seg: 18, lat: 12, paint: headPaint(sp.skin, sp.beard === 'full' ? 0.4 : 1),
    deform: (l) => {
      if (l.y < 0) { const t = -l.y; l.x *= 1 - 0.16 * t; l.z *= 1 - 0.05 * t; l.z += 0.06 * t * Math.max(0, l.z); } // softer jaw
      if (l.y > 0.2) l.z *= 1 - 0.06 * (l.y - 0.2);
    } });
  // ears
  for (const sx of [-1, 1]) k.ellip('head', [sx * 0.19, HY - 0.02, -0.01], [0.03, 0.05, 0.036], shade(sp.skin, 0.96), { seg: 8, lat: 5, rot: [0, sx * 0.3, sx * -0.15], noOcc: true });
  // nose
  k.ellip('head', [0, HY - 0.045, 0.19], [0.03, 0.026, 0.026], shade(sp.skin, 0.97), { seg: 8, lat: 5, noOcc: true });
  // mouth (a soft smile)
  const smile: V3[] = [];
  for (let i = 0; i <= 4; i++) { const u = i / 4 - 0.5; smile.push([u * 0.075, HY - 0.105 + u * u * 0.07, 0.167 - u * u * 0.05]); }
  k.tube('head', smile, 0.0075, C.lip, { seg: 5, noOcc: true });
  // eyes on the 'eyes' bone (blinks)
  for (const sx of [-1, 1]) {
    if (sp.eyes === 'kind') {
      const arc: V3[] = [];
      for (let i = 0; i <= 4; i++) { const u = i / 4 - 0.5; arc.push([sx * 0.072 + u * 0.05, HY + 0.0 + (0.25 - u * u) * 0.04, 0.172 - Math.abs(u) * 0.02]); }
      k.tube('eyes', arc, 0.009, C.ink, { seg: 5, noOcc: true });
    } else {
      k.ellip('eyes', [sx * 0.072, HY - 0.005, 0.163], [0.032, 0.046, 0.018], C.ink, { seg: 10, lat: 6, noOcc: true, rot: [-0.15, sx * 0.28, 0] });
      k.ellip('eyes', [sx * 0.072 + 0.011, HY + 0.012, 0.18], [0.011, 0.011, 0.006], P.cloud, { seg: 6, lat: 4, noOcc: true });
    }
    // brow
    k.tube('head', [[sx * 0.04, HY + 0.062, 0.176], [sx * 0.072, HY + 0.07, 0.172], [sx * 0.104, HY + 0.062, 0.158]], sp.beard === 'full' ? 0.016 : 0.01, brows, { seg: 5, noOcc: true, flatten: 0.7 });
  }
  if (sp.glasses) {
    for (const sx of [-1, 1]) {
      const ring: V3[] = [];
      for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI * 2; ring.push([sx * 0.07 + Math.cos(a) * 0.04, HY + Math.sin(a) * 0.038, 0.188]); }
      k.tube('head', ring, 0.0055, P.gold, { seg: 4, noOcc: true, caps: false });
    }
    k.tube('head', [[-0.03, HY + 0.005, 0.19], [0, HY + 0.012, 0.2], [0.03, HY + 0.005, 0.19]], 0.005, P.gold, { seg: 4, noOcc: true });
  }
  // beard / moustache
  if (sp.beard === 'full') {
    k.ellip('head', [0, HY - 0.14, 0.09], [0.15, 0.15, 0.11], sp.hair, { seg: 12, lat: 8,
      deform: (l) => { if (l.y < 0) { l.z += -l.y * 0.35; l.x *= 1 - 0.35 * -l.y; } if (l.y > 0.3 && l.z > 0.2) { l.z -= 0.35; } } });
  }
  if (sp.beard === 'full' || sp.beard === 'moustache') {
    for (const sx of [-1, 1]) k.tube('head', [[0, HY - 0.072, 0.205], [sx * 0.055, HY - 0.08, 0.195], [sx * 0.11, HY - 0.1, 0.165], [sx * 0.15, HY - 0.07, 0.13]], [0.03, 0.034, 0.024, 0.01], sp.hair, { seg: 6, noOcc: true });
  }

  // ── hair ──
  const hc = sp.hair, hs = sp.hairStyle;
  const cap = (z0 = 0.33, yFace = 0.22, back = -0.55) => k.ellip('head', [0, HY + 0.03, -0.012], [0.212, 0.215, 0.205], hc, { seg: 16, lat: 10,
    deform: (l) => {
      // pull the face window and the underside inside the skull, leaving a hairline
      const face = l.z > z0 && l.y < yFace + (Math.abs(l.x) > 0.55 ? -0.3 : 0);
      if (face || l.y < back) { l.x *= 0.8; l.y *= 0.8; l.z *= 0.8; }
      else if (l.y < -0.1 && l.z < 0) { l.y -= 0.08; }   // fuller at the nape
    } });
  if (hs === 'hero') {
    cap(0.3, 0.3, -0.62);
    // wind-swept hero hair: fringe sweeping to one side, a quiff swept back, spiky nape
    const lock = (pts: V3[], r: number, j: Group = 'head') => k.tube(j, pts, pts.map((_, i) => (i === pts.length - 1 ? 0.004 : r * (1 - (i / pts.length) * 0.45))), hc, { seg: 7, noOcc: true });
    lock([[0.0, HY + 0.21, 0.02], [0.06, HY + 0.19, 0.14], [0.13, HY + 0.12, 0.2], [0.18, HY + 0.02, 0.19]], 0.065);
    lock([[-0.07, HY + 0.2, 0.03], [-0.03, HY + 0.17, 0.16], [0.02, HY + 0.11, 0.21], [0.06, HY + 0.05, 0.215]], 0.06);
    lock([[-0.12, HY + 0.17, 0.02], [-0.15, HY + 0.12, 0.13], [-0.17, HY + 0.04, 0.17], [-0.16, HY - 0.04, 0.165]], 0.055);
    lock([[0.0, HY + 0.19, 0.08], [0.0, HY + 0.28, -0.01], [0.0, HY + 0.28, -0.12], [0.0, HY + 0.21, -0.24]], 0.085);
    lock([[0.08, HY + 0.18, 0.02], [0.13, HY + 0.25, -0.07], [0.16, HY + 0.21, -0.18], [0.19, HY + 0.12, -0.25]], 0.065, 'hair');
    lock([[-0.08, HY + 0.18, 0.02], [-0.13, HY + 0.25, -0.07], [-0.16, HY + 0.21, -0.18], [-0.19, HY + 0.12, -0.25]], 0.065, 'hair');
    lock([[0.0, HY + 0.08, -0.17], [0.0, HY - 0.05, -0.24], [0.02, HY - 0.16, -0.25]], 0.07, 'hair');
    lock([[0.1, HY + 0.07, -0.15], [0.13, HY - 0.04, -0.21], [0.16, HY - 0.13, -0.2]], 0.055, 'hair');
    lock([[-0.1, HY + 0.07, -0.15], [-0.13, HY - 0.04, -0.21], [-0.16, HY - 0.13, -0.2]], 0.055, 'hair');
    for (const sx of [-1, 1]) lock([[sx * 0.16, HY + 0.13, 0.03], [sx * 0.2, HY + 0.02, 0.07], [sx * 0.19, HY - 0.09, 0.07]], 0.042);
  } else if (hs === 'braid' || hs === 'pony') {
    cap(0.3, 0.26, -0.5);
    k.ellip('head', [0, HY + 0.08, -0.17], [0.07, 0.07, 0.06], hc, { seg: 8, lat: 5 });
    if (hs === 'pony') {
      k.tube('hair', [[0, HY + 0.08, -0.2], [0, HY + 0.02, -0.28], [0, HY - 0.12, -0.3], [0.01, HY - 0.26, -0.26]], [0.05, 0.06, 0.045, 0.01], hc, { seg: 8 });
      k.lathe('hair', [0, HY + 0.08, -0.2], [[-0.02, 0.045], [0.02, 0.045]], P.roof, { seg: 8, rot: [Math.PI / 2, 0, 0] });
    } else {
      for (let i = 0; i < 4; i++) k.ellip('hair', [0, HY - 0.02 - i * 0.1, -0.24 - i * 0.012], [0.05 - i * 0.006, 0.06, 0.045 - i * 0.004], hc, { seg: 8, lat: 5 });
      k.ellip('hair', [0, HY - 0.43, -0.27], [0.03, 0.03, 0.03], P.teal, { seg: 6, lat: 4 });
    }
    // side fringe
    k.tube('head', [[-0.12, HY + 0.18, 0.08], [-0.05, HY + 0.15, 0.19], [0.08, HY + 0.1, 0.205]], [0.06, 0.04, 0.005], hc, { seg: 6, noOcc: true });
  } else if (hs === 'bun') {
    cap(0.3, 0.27, -0.5);
    k.ellip('hair', [0, HY + 0.2, -0.12], [0.1, 0.09, 0.09], hc, { seg: 10, lat: 7 });
    k.tube('head', [[0.13, HY + 0.17, 0.06], [0.04, HY + 0.17, 0.18], [-0.08, HY + 0.12, 0.2]], [0.05, 0.035, 0.005], hc, { seg: 6, noOcc: true });
  } else if (hs === 'short') {
    cap(0.3, 0.32, -0.6);
    k.tube('head', [[-0.1, HY + 0.18, 0.07], [0.0, HY + 0.2, 0.17], [0.12, HY + 0.15, 0.18]], [0.05, 0.05, 0.01], hc, { seg: 6, noOcc: true });
  } else if (hs === 'bob') {
    cap(0.32, 0.25, -0.75);
    k.lathe('hair', [0, HY - 0.05, -0.01], [[-0.06, 0.2], [0.0, 0.225], [0.12, 0.22]], hc, { seg: 14, arc: [Math.PI * 0.32, Math.PI * 1.68], sz: 1.02 });
  } else if (hs === 'bald') {
    for (const sx of [-1, 1]) k.ellip('head', [sx * 0.17, HY + 0.02, -0.07], [0.07, 0.09, 0.11], hc, { seg: 9, lat: 6 });
    k.ellip('head', [0, HY + 0.0, -0.15], [0.15, 0.1, 0.07], hc, { seg: 10, lat: 6 });
  }

  // ── hats ──
  const hcol = sp.hatColor ?? C.leather;
  if (sp.hat === 'cap') {
    k.ellip('head', [0, HY + 0.13, -0.01], [0.225, 0.13, 0.222], hcol, { seg: 14, lat: 8, deform: (l) => { if (l.y < 0) { l.y = 0; } } });
    k.lathe('head', [0, HY + 0.12, 0.17], [[-0.008, 0.11], [0.008, 0.1]], shade(hcol, 0.85), { seg: 12, sz: 0.75, rot: [0.25, 0, 0] });
    k.ellip('head', [0, HY + 0.26, -0.01], [0.025, 0.018, 0.025], sp.hatBand ?? P.gold, { seg: 6, lat: 4, noOcc: true });
    if (sp.hatBand) k.lathe('head', [0, HY + 0.13, -0.01], [[0, 0.226], [0.035, 0.226]], sp.hatBand, { seg: 14, caps: false, sz: 0.99 });
  } else if (sp.hat === 'straw') {
    const straw = mix(P.gold, P.stone, 0.5);
    k.lathe('head', [0, HY + 0.13, -0.01], [[0, 0.4], [0.02, 0.36], [0.03, 0.22], [0.15, 0.18], [0.17, 0.0]], straw, { seg: 16,
      paint: (w) => (w.y > HY + 0.15 && w.y < HY + 0.19 ? (sp.hatBand ?? P.roof) : undefined) });
  } else if (sp.hat === 'kerchief') {
    k.ellip('head', [0, HY + 0.05, -0.02], [0.222, 0.215, 0.215], hcol, { seg: 14, lat: 9,
      deform: (l) => { if ((l.z > 0.3 && l.y < 0.4) || l.y < -0.35) { l.x *= 0.85; l.y *= 0.85; l.z *= 0.85; } } });
    k.tube('head', [[0, HY - 0.04, -0.2], [0.03, HY - 0.12, -0.23], [0.02, HY - 0.2, -0.22]], [0.04, 0.03, 0.006], hcol, { seg: 5, noOcc: true });
  } else if (sp.hat === 'witch') {
    k.lathe('head', [0, HY + 0.15, -0.02], [[0, 0.46], [0.025, 0.44], [0.03, 0.2], [0.22, 0.16]], hcol, { seg: 18,
      paint: (w) => (w.y > HY + 0.19 && w.y < HY + 0.24 ? P.gold : undefined) });
    k.tube('head', [[0, HY + 0.37, -0.03], [0, HY + 0.5, -0.07], [0, HY + 0.58, -0.17], [0, HY + 0.58, -0.25]], [0.16, 0.11, 0.06, 0.012], hcol, { seg: 10 });
    k.ellip('head', [0, HY + 0.57, -0.27], [0.03, 0.03, 0.03], P.gold, { seg: 6, lat: 4 });
    k.tube('head', [[0.15, HY + 0.22, 0.02], [0.24, HY + 0.32, -0.02], [0.28, HY + 0.42, -0.08]], [0.02, 0.03, 0.004], P.teal, { seg: 5, flatten: 0.4, noOcc: true });
  }

  // ── shawl / collar ──
  if (sp.shawl) {
    k.lathe('torso', [0, 0, 0], [[1.12, W * 1.12], [1.2, W * 1.12], [1.28, W * 0.98], [1.33, 0.12], [1.35, 0.1]], sp.shawl, { seg: 16, sz: 0.85,
      paint: (w, uv) => (w.y < 1.135 ? shade(sp.shawl!, 0.82) : shade(sp.shawl!, 0.95 + 0.05 * Math.cos(uv[0] * Math.PI * 16))) });
  }
  // ── scarf ──
  if (sp.scarf) {
    const sc = sp.scarf;
    k.lathe('torso', [0, 0, 0.0], [[1.26, 0.13], [1.29, 0.145], [1.35, 0.125], [1.38, 0.1]], sc, { seg: 14, sz: 0.95, paint: (w) => (Math.abs(w.y - 1.315) < 0.012 ? shade(sc, 0.82) : undefined) });
    const tail = (x0: number, len: number, wid: number) => {
      const grid: V3[][] = [];
      for (let i = 0; i <= 5; i++) {
        const t = i / 5;
        const y = 1.31 - t * len, z = -0.13 - t * 0.06 - Math.sin(t * 2.5) * 0.02;
        grid.push([[x0 - wid / 2, y, z], [x0 + wid / 2, y, z]]);
      }
      k.sheet('scarf', grid, 0.018, sc, { paint: (_w, uv) => (uv[1] > 0.86 ? shade(sc, 0.8) : undefined) });
    };
    tail(0.07, 0.42, 0.085); tail(0.13, 0.32, 0.08);
  }
  // ── cape (with folded hood at the shoulders) ──
  if (sp.cape) {
    const cp = sp.cape;
    const grid: V3[][] = [];
    const cols = 9;
    for (const t of [0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.82, 0.9, 0.925, 0.935, 1]) {
      const y = 1.31 - t * cp.len;
      const r = 0.16 + t * 0.15;
      const spread = 1.05 + t * 0.25;
      const row: V3[] = [];
      for (let j = 0; j <= cols; j++) {
        const u = j / cols - 0.5;
        const a = Math.PI + u * spread * 2;
        const fold = 0.012 * Math.sin(u * Math.PI * 6) * t;
        row.push([Math.sin(a) * (r + fold) * 1.05, y, Math.cos(a) * (r + fold) * 0.7 - 0.07 - t * 0.04]);
      }
      grid.push(row);
    }
    k.sheet('cape', grid, 0.022, cp.color, { paint: (w, uv) => (w.y < 1.31 - 0.93 * cp.len ? cp.trim : shade(cp.color, 0.96 + 0.04 * Math.cos(uv[0] * Math.PI * 6))) });
    // hood folded over the shoulders
    k.lathe('torso', [0, 0, -0.015], [[1.22, 0.2], [1.27, 0.215], [1.33, 0.17], [1.37, 0.12]], cp.color, { seg: 16, sz: 0.88, arc: [Math.PI * 0.42, Math.PI * 1.58],
      paint: (w) => (w.y < 1.235 ? cp.trim : undefined) });
    // shield strap across the chest
    k.tube('body', [[0.13, 1.3, 0.04], [0.06, 1.2, 0.155], [-0.06, 1.06, 0.165], [-0.16, 0.95, 0.13], [-0.2, 0.93, 0.0]], 0.018, C.leather, { seg: 4, noOcc: true, flatten: 0.45 });
    k.tube('body', [[0.13, 1.3, 0.04], [0.15, 1.28, -0.1], [0.06, 1.15, -0.18], [-0.12, 0.98, -0.16], [-0.2, 0.93, 0.0]], 0.018, C.leather, { seg: 4, noOcc: true, flatten: 0.45 });
    k.ellip('body', [0.0, 1.13, 0.168], [0.022, 0.022, 0.01], P.gold, { seg: 6, lat: 4, noOcc: true });
    // clasp
    for (const sx of [-1, 1]) k.ellip('torso', [sx * 0.09, 1.25, 0.14], [0.026, 0.026, 0.014], P.gold, { seg: 8, lat: 5, noOcc: true });
  }
}

// ───────────────────────── weapons ─────────────────────────
function buildWeapons(k: Kit, shieldFace: Color3, legacy: boolean) {
  const hand = (j: Joint) => (legacy ? 'bladeHand' : j) as Joint;
  // drawn sword in the right hand (points forward, a little down)
  const hx = legacy ? 0.3 : 0.26, hy = legacy ? 0.6 : 0.725;
  k.box(hand('bladeHand'), [0.065, 0.02, 0.62], [hx, hy - 0.03, 0.43], C.steel, [0.12, 0, 0]);
  k.box(hand('bladeHand'), [0.022, 0.026, 0.6], [hx, hy - 0.022, 0.43], shade(C.steel, 1.12), [0.12, 0, 0]);
  k.box(hand('bladeHand'), [0.2, 0.04, 0.045], [hx, hy, 0.1], P.gold);
  k.box(hand('bladeHand'), [0.04, 0.04, 0.14], [hx, hy, 0.0], C.leather);
  k.ball(hand('bladeHand'), 0.035, [hx, hy, -0.08], P.gold);
  // shield on the left forearm (facing outward)
  const sx = legacy ? -0.4 : -0.305, sy = legacy ? 0.76 : 0.89;
  k.lathe('shieldArm', [sx, sy, 0.02], [[0, 0.2], [0.02, 0.2], [0.045, 0.16], [0.06, 0.0]], shieldFace, { seg: 14, rot: [0, 0, Math.PI / 2],
    paint: (_w, uv) => (uv[1] < 0.3 ? P.gold : undefined) });
  k.ellip('shieldArm', [sx - 0.065, sy, 0.02], [0.03, 0.05, 0.05], P.gold, { seg: 8, lat: 5 });
  if (!legacy) {
    // sword sheathed at the left hip (hilt forward-up) and shield on the back
    const hip = (a: V3, b: V3, r: number, c: Color3) => k.tube('bladeHip', [a, b], r, c, { seg: 6, flatten: 0.55 });
    hip([-0.225, 0.92, 0.12], [-0.27, 0.5, -0.22], 0.034, C.leather);
    k.ellip('bladeHip', [-0.27, 0.5, -0.225], [0.03, 0.03, 0.03], P.gold, { seg: 6, lat: 4, noOcc: true });
    k.tube('bladeHip', [[-0.205, 0.94, 0.14], [-0.195, 0.99, 0.2]], 0.04, P.gold, { seg: 6, flatten: 0.4 });  // guard
    k.tube('bladeHip', [[-0.2, 0.965, 0.17], [-0.185, 1.06, 0.28]], 0.02, C.leather, { seg: 6 });         // grip
    k.ellip('bladeHip', [-0.183, 1.07, 0.295], [0.026, 0.026, 0.026], P.gold, { seg: 6, lat: 4 });
    k.lathe('shieldBack', [0, 1.12, -0.215], [[0, 0.2], [0.02, 0.2], [0.045, 0.16], [0.06, 0.0]], shieldFace, { seg: 16, rot: [-Math.PI / 2, 0, 0],
      paint: (_w, uv) => (uv[1] < 0.3 ? P.gold : undefined) });
    k.ellip('shieldBack', [0, 1.12, -0.275], [0.055, 0.055, 0.03], P.gold, { seg: 10, lat: 6 });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; k.ellip('shieldBack', [Math.sin(a) * 0.1, 1.12 + Math.cos(a) * 0.1, -0.262], [0.014, 0.014, 0.01], P.gold, { seg: 6, lat: 4, noOcc: true }); }
  }
  // bow in the left hand
  const bx = legacy ? -0.3 : -0.26, by = legacy ? 0.6 : 0.725;
  const pts: V3[] = [];
  for (let i = 0; i <= 6; i++) { const a = -1.15 + (2.3 * i) / 6; pts.push([bx, by + 0.55 * Math.sin(a), 0.04 + 0.16 * Math.cos(a)]); }
  k.tube('bowHand', pts, [0.012, 0.02, 0.026, 0.03, 0.026, 0.02, 0.012], P.gold, { seg: 5, paint: (w) => (Math.abs(w.y - by) < 0.06 ? C.leather : undefined) });
  k.tube('bowHand', [pts[0], pts[6]], 0.006, P.cloud, { seg: 3, noOcc: true });
  if (!legacy) {
    const bp: V3[] = [];
    for (let i = 0; i <= 6; i++) { const a = -1.15 + (2.3 * i) / 6; bp.push([0.5 * Math.sin(a) * 0.9, 1.08 + 0.5 * Math.sin(a) * 0.45, -0.22 - 0.1 * Math.cos(a)]); }
    k.tube('bowBack', bp, [0.012, 0.02, 0.026, 0.03, 0.026, 0.02, 0.012], P.gold, { seg: 5 });
    k.tube('bowBack', [bp[0], bp[6]], 0.006, P.cloud, { seg: 3, noOcc: true });
  }
}

// ───────────────────────── enemies & boss (minimal, legacy layout) ─────────────────────────
function buildGrunt(k: Kit, cloth: Color3) {
  for (const [j, x] of [['legL', -0.12], ['legR', 0.12]] as [Group, number][]) {
    k.rod(j, [x, 0.62, 0], [x, 0.08, 0.02], 0.06, P.gold);
    k.box(j, [0.16, 0.05, 0.22], [x, 0.03, 0.06], P.gold);
  }
  k.ball('torso', 0.36, [0, 0.95, 0], cloth, [0.95, 0.85, 1.2]);
  k.ball('torso', 0.25, [0, 0.98, 0.18], P.cloud, [1, 1, 0.8]);
  k.ball('head', 0.24, [0, 1.38, 0.05], P.cloud);
  k.cyl('head', 0, 0.16, 0.34, [0, 1.34, 0.36], P.gold, 4, [Math.PI / 2, 0, 0]);
  k.box('head', [0.07, 0.07, 0.04], [-0.1, 1.44, 0.24], P.gold, undefined, true);
  k.box('head', [0.07, 0.07, 0.04], [0.1, 1.44, 0.24], P.gold, undefined, true);
  for (const [j, x, s] of [['uArmL', -0.3, -1], ['uArmR', 0.3, 1]] as [Joint, number, number][]) k.box(j, [0.08, 0.5, 0.36], [x + s * 0.04, 0.8, -0.05], shade(cloth, 1.3), [0, 0, s * 0.2]);
}
function buildArcher(k: Kit, cloth: Color3) {
  for (const [j, x] of [['legL', -0.12], ['legR', 0.12]] as [Group, number][]) k.ball(j, 0.14, [x, 0.25, 0], P.cloud, [1, 1.6, 1]);
  k.ball('torso', 0.32, [0, 0.86, 0], P.cloud);
  k.cyl('torso', 0.3, 0.6, 0.5, [0, 0.95, -0.05], cloth, 6);
  k.ball('head', 0.27, [0, 1.36, 0], cloth);
  k.cyl('head', 0, 0.2, 0.3, [0, 1.62, -0.12], cloth, 4, [-0.6, 0, 0]);
  k.ball('head', 0.18, [0, 1.33, 0.12], shade(P.rock, 0.5), [1, 0.9, 0.6]);
  k.box('head', [0.06, 0.04, 0.03], [-0.07, 1.35, 0.23], P.gold, undefined, true);
  k.box('head', [0.06, 0.04, 0.03], [0.07, 1.35, 0.23], P.gold, undefined, true);
  for (const [j, x] of [['armL', -0.29], ['armR', 0.29]] as [Group, number][]) {
    k.cyl(j, 0.12, 0.14, 0.36, [x, 0.82, 0], cloth, 5);
    k.ball(j, 0.08, [x, 0.6, 0.01], P.cloud);
  }
}
function buildBrute(k: Kit, cloth: Color3) {
  for (const [j, x] of [['legL', -0.14], ['legR', 0.14]] as [Group, number][]) {
    k.cyl(j, 0.22, 0.2, 0.46, [x, 0.38, 0], shade(cloth, 0.8), 6);
    k.box(j, [0.24, 0.16, 0.3], [x, 0.08, 0.04], P.gold);
  }
  k.ball('torso', 0.42, [0, 0.98, 0.02], cloth, [1.2, 0.95, 0.95]);
  k.box('torso', [0.6, 0.2, 0.4], [0, 1.2, -0.05], P.cliff);
  k.ball('head', 0.17, [0, 1.3, 0.16], C.skinDeep);
  k.box('head', [0.06, 0.03, 0.03], [-0.06, 1.33, 0.32], P.gold, undefined, true);
  k.box('head', [0.06, 0.03, 0.03], [0.06, 1.33, 0.32], P.gold, undefined, true);
  for (const [j, x] of [['armL', -0.42], ['armR', 0.42]] as [Group, number][]) {
    k.ball(j, 0.2, [x, 1.0, 0], P.cliff);
    k.cyl(j, 0.24, 0.2, 0.42, [x, 0.72, 0.03], cloth, 6);
    k.ball(j, 0.2, [x, 0.45, 0.05], P.gold);
  }
}
function buildWarden(k: Kit) {
  const stone = P.stone, brass = P.gold;
  for (const [j, x] of [['legL', -0.13], ['legR', 0.13]] as [Group, number][]) {
    k.cyl(j, 0.2, 0.26, 0.5, [x, 0.36, 0], shade(stone, 0.85), 6);
    k.box(j, [0.28, 0.12, 0.34], [x, 0.06, 0.04], brass);
  }
  for (let i = 0; i < 4; i++) {
    const y0 = 0.62 + (i * 0.52) / 4, h = 0.13;
    k.cyl('torso', 0.6 - ((i + 1) * 0.16) / 4, 0.6 - (i * 0.16) / 4, h, [0, y0 + h / 2, 0], i % 2 === 0 ? P.cloud : P.roof, 8);
  }
  k.cyl('torso', 0.62, 0.62, 0.05, [0, 1.15, 0], brass, 10);
  k.box('torso', [0.22, 0.2, 0.04], [0, 0.9, -0.27], mix(P.horizon, P.gold, 0.4), undefined, true);
  k.cyl('head', 0.36, 0.36, 0.22, [0, 1.29, 0], mix(P.gold, P.cloud, 0.5), 8, undefined, true);
  k.cyl('head', 0.42, 0.42, 0.03, [0, 1.18, 0], brass, 10);
  k.cyl('head', 0.04, 0.46, 0.2, [0, 1.5, 0], P.roof, 8);
  k.box('head', [0.16, 0.05, 0.05], [0, 1.25, 0.2], P.cloud, undefined, true);
  for (const [j, x] of [['armL', -0.38], ['armR', 0.38]] as [Group, number][]) {
    k.ball(j, 0.13, [x, 1.05, 0], brass);
    k.cyl(j, 0.16, 0.14, 0.38, [x, 0.8, 0], shade(stone, 0.9), 6);
    k.box(j, [0.2, 0.18, 0.2], [x, 0.54, 0.02], brass);
  }
}

// ───────────────────────── character designs ─────────────────────────
interface Design { spec: HumanSpec | null; idle: IdleStyle; hunch: number; scale: number; shoulder: number; prop: 'cane' | 'rag' | 'basket' | null; stride: number }

function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

function design(kind: EntityKind | 'npc', color: string | undefined): Design {
  const base = { hunch: 0, scale: 1, shoulder: 0.235, prop: null, stride: 1 } as const;
  if (kind === 'player') {
    const tunic = color ? hex(color) : P.teal;
    return { ...base, idle: 'hero', spec: {
      skin: C.skin, hair: C.chestnut, hairStyle: 'hero', top: tunic, topTrim: P.gold, hem: 0.66, flare: 0.05, girth: 1,
      sleeves: 'short', legs: C.cream, boots: C.leather, belt: C.leather, buckle: P.gold, pouch: true,
      cape: { color: P.skyDeep, trim: P.gold, len: 0.66 }, scarf: P.roof, hat: 'none',
    } };
  }
  if (kind === 'companion') {
    const coat = color ? hex(color) : P.roof;
    return { ...base, scale: 0.96, idle: 'relaxed', spec: {
      skin: C.skin, hair: C.blond, hairStyle: 'braid', top: coat, topTrim: P.cloud, hem: 0.58, flare: 0.13, girth: 0.95,
      vneck: P.cloud, sleeves: 'long', sleeveColor: shade(coat, 0.92), legs: C.denim, boots: C.leather, belt: P.gold, pouch: true,
      hat: 'witch', hatColor: P.rock,
    } };
  }
  if (kind !== 'npc') return { ...base, spec: null, idle: 'relaxed' };
  if (!color) {
    // Old Marrow: kindly elder with a white beard, spectacles and a cane.
    return { ...base, idle: 'cane', hunch: 0.3, scale: 0.94, prop: 'cane', stride: 0.55, spec: {
      skin: C.skin, hair: C.silver, hairStyle: 'bald', eyes: 'kind', beard: 'full', glasses: true,
      top: mix(P.teal, P.rock, 0.42), topTrim: P.gold, hem: 0.1, flare: 0.13, girth: 1.02,
      sleeves: 'long', sleeveColor: mix(P.teal, P.rock, 0.5), legs: null, boots: C.leather,
      belt: P.gold, shawl: mix(P.stone, P.cloud, 0.35), hat: 'none',
    } };
  }
  const c = hex(color);
  const up = color.toUpperCase();
  if (up === PALETTE.teal.toUpperCase()) {
    // Tamsin the ferrywoman: weathered, rolled sleeves, flat cap, ponytail, hands on hips.
    return { ...base, idle: 'hips', scale: 0.98, spec: {
      skin: C.skinTan, hair: C.auburn, hairStyle: 'pony', top: C.cream, hem: 0.86, flare: 0, girth: 0.96,
      vest: c, sleeves: 'rolled', legs: C.denim, boots: C.leather, bootTop: 0.44,
      belt: C.leather, buckle: shade(P.gold, 0.85), hat: 'cap', hatColor: shade(P.skyDeep, 0.7), scarf: undefined,
    } };
  }
  if (up === PALETTE.roof.toUpperCase()) {
    // Bram the tavern keeper: stout, big moustache, rolled sleeves, long apron, wiping his hands.
    return { ...base, idle: 'wipe', shoulder: 0.27, prop: 'rag', spec: {
      skin: mix(C.skin, C.blush, 0.25), hair: C.auburn, hairStyle: 'bald', beard: 'moustache',
      top: c, hem: 0.86, flare: 0, girth: 1.28, belly: 0.6, sleeves: 'rolled',
      legs: C.khaki, boots: C.leather, belt: C.leather, apron: P.cloud, apronLong: true, hat: 'none',
    } };
  }
  // generic townsfolk: variety from the colour
  const h = strHash(color);
  const hairs = [C.chestnut, C.blond, shade(P.rock, 0.85), C.auburn, C.silver];
  const skins = [C.skin, C.skinTan, C.skinDeep, C.skin];
  const dress = (h & 1) === 1;
  const hats: Hat[] = ['none', 'straw', 'kerchief', 'cap', 'none'];
  const hat = hats[(h >>> 3) % hats.length];
  const styles: HairStyle[] = dress ? ['bun', 'bob', 'braid', 'pony'] : ['short', 'short', 'bald', 'pony'];
  const idles: IdleStyle[] = ['relaxed', 'behind', 'hips', 'basket'];
  const idle = idles[(h >>> 7) % idles.length];
  return { ...base, idle, prop: idle === 'basket' ? 'basket' : null, scale: 0.94 + ((h >>> 11) % 8) * 0.01, spec: {
    skin: skins[(h >>> 13) % skins.length], hair: hairs[(h >>> 15) % hairs.length], hairStyle: styles[(h >>> 17) % styles.length],
    top: c, topTrim: dress ? shade(c, 0.8) : undefined, hem: dress ? 0.16 : 0.68, flare: dress ? 0.16 : 0.04, girth: dress ? 0.95 : 1.05,
    vneck: dress ? undefined : C.cream, sleeves: (h >>> 19) % 2 ? 'long' : 'short', sleeveColor: dress ? undefined : C.cream,
    legs: dress ? null : mix(P.stone, P.rock, 0.4), boots: C.leather,
    belt: dress ? undefined : C.leather, apron: (h >>> 21) % 3 === 0 ? P.cloud : undefined, hat,
    hatColor: hat === 'kerchief' ? ((h >>> 23) % 2 ? P.teal : P.gold) : shade(c, 0.7),
  } };
}

function buildProps(k: Kit, prop: Design['prop']) {
  if (prop === 'cane') {
    // gnarled walking stick, held in the right hand, tip on the ground in front
    k.tube('prop', [[0.27, 0.78, 0.03], [0.275, 0.73, 0.04], [0.29, 0.4, 0.07], [0.3, 0.0, 0.09]], [0.024, 0.022, 0.02, 0.017], C.leather, { seg: 6 });
    k.tube('prop', [[0.22, 0.79, 0.03], [0.27, 0.8, 0.03], [0.31, 0.77, 0.03]], 0.026, C.leatherLight, { seg: 6 });
  } else if (prop === 'rag') {
    k.ellip('propL', [-0.24, 0.69, 0.06], [0.06, 0.08, 0.04], P.cloud, { seg: 8, lat: 5, deform: (l) => { l.x += Math.sin(l.y * 6) * 0.15; } });
  } else if (prop === 'basket') {
    k.lathe('prop', [0.27, 0.56, 0.06], [[0, 0.09], [0.05, 0.12], [0.12, 0.13]], mix(P.gold, P.cliff, 0.35), { seg: 12, caps: true,
      paint: (w) => (Math.round(w.y * 80) % 2 ? mix(P.gold, P.cliff, 0.45) : undefined) });
    k.tube('prop', [[0.17, 0.67, 0.06], [0.27, 0.78, 0.06], [0.37, 0.67, 0.06]], 0.012, C.leatherLight, { seg: 4, noOcc: true });
    k.ellip('prop', [0.24, 0.69, 0.07], [0.05, 0.045, 0.05], P.roof, { seg: 8, lat: 5 });
    k.ellip('prop', [0.31, 0.69, 0.04], [0.045, 0.04, 0.045], P.meadow, { seg: 8, lat: 5 });
    k.ellip('prop', [0.27, 0.7, 0.11], [0.04, 0.035, 0.04], P.gold, { seg: 8, lat: 5 });
  }
}

// ───────────────────────── per-kind traits ─────────────────────────
interface Traits { height: number; cadence: number; stride: number; armSwing: number; bob: number; lean: number; heavy: boolean; ringR: number; legacyScale: number }
const TRAITS: Record<EntityKind | 'npc', Traits> = {
  player:    { height: 1.88, cadence: 1.55, stride: 0.8, armSwing: 0.62, bob: 0.075, lean: 0.2, heavy: false, ringR: 0.55, legacyScale: 1 },
  companion: { height: 2.05, cadence: 1.6, stride: 0.75, armSwing: 0.7, bob: 0.07, lean: 0.16, heavy: false, ringR: 0.55, legacyScale: 1 },
  npc:       { height: 1.8, cadence: 1.25, stride: 0.6, armSwing: 0.5, bob: 0.045, lean: 0.1, heavy: false, ringR: 0.55, legacyScale: 1 },
  grunt:     { height: 1.2, cadence: 2.1, stride: 0.9, armSwing: 0.9, bob: 0.08, lean: 0.25, heavy: false, ringR: 0.5, legacyScale: 0.68 },
  archer:    { height: 1.5, cadence: 1.7, stride: 0.7, armSwing: 0.6, bob: 0.06, lean: 0.15, heavy: false, ringR: 0.5, legacyScale: 0.82 },
  brute:     { height: 2.6, cadence: 1.0, stride: 0.55, armSwing: 0.45, bob: 0.1, lean: 0.12, heavy: true, ringR: 1.0, legacyScale: 1.45 },
  warden:    { height: 4.5, cadence: 0.6, stride: 0.4, armSwing: 0.3, bob: 0.12, lean: 0.05, heavy: true, ringR: 2.2, legacyScale: 2.5 },
};
const DEFAULT_WEAPON: Record<EntityKind | 'npc', WeaponId | 'none'> = {
  player: 'blade', companion: 'bow', npc: 'none', grunt: 'none', archer: 'bow', brute: 'none', warden: 'none',
};

// ───────────────────────── pose / animation ─────────────────────────
const ANIM: Joint[] = ['base', 'hips', 'torso', 'head', 'hair', 'capeA', 'capeB', 'scarf', 'uArmL', 'fArmL', 'uArmR', 'fArmR', 'thighL', 'shinL', 'thighR', 'shinR', 'prop', 'propL'];
type Ch = string;
const CH: Ch[] = [...ANIM.flatMap((j) => [`${j}.rx`, `${j}.ry`, `${j}.rz`]), 'base.py', 'hips.py', 'hips.px'];
type PoseVals = Record<Ch, number>;
const zeroPose = (): PoseVals => Object.fromEntries(CH.map((c) => [c, 0])) as PoseVals;
const LOOPING: Pose[] = ['idle', 'run', 'staggered', 'dead', 'charge'];
const COMBAT: Pose[] = ['attack', 'cast', 'parry', 'charge', 'hit'];
const ONE_SHOT_DUR = 0.42;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => x * x * (3 - 2 * x);

interface AnimCtx { T: number; t: number; phase: number; speed: number; tr: Traits; d: Design; weapon: WeaponId | 'none'; drawn: boolean; shift: number; humanoid: boolean }

/** Arms at rest, per idle style. */
function idleArms(o: PoseVals, c: AnimCtx, br: number) {
  const s = c.d.idle;
  const sway = Math.sin(c.T * 0.9) * 0.03;
  o['uArmL.rz'] = -0.1 - 0.025 * br; o['uArmR.rz'] = 0.1 + 0.025 * br;
  o['uArmL.rx'] = 0.02 + sway; o['uArmR.rx'] = 0.02 - sway;
  o['fArmL.rx'] = -0.18; o['fArmR.rx'] = -0.18;
  if (s === 'hero') {
    // left hand resting on the sword hilt, right arm relaxed
    o['uArmL.rx'] = -0.12; o['uArmL.rz'] = -0.18; o['fArmL.rx'] = -0.95; o['fArmL.ry'] = 0.5; o['fArmL.rz'] = 0.35;
  } else if (s === 'hips') {
    for (const [sd, a] of [[-1, 'L'], [1, 'R']] as [number, string][]) {
      o[`uArm${a}.rz`] = sd * (0.62 + 0.02 * br); o[`uArm${a}.rx`] = 0.22; o[`fArm${a}.rz`] = -sd * 1.55; o[`fArm${a}.rx`] = -0.25; o[`fArm${a}.ry`] = sd * -0.3;
    }
  } else if (s === 'behind') {
    o['uArmL.rx'] = 0.32; o['uArmR.rx'] = 0.32; o['uArmL.rz'] = -0.12; o['uArmR.rz'] = 0.12;
    o['fArmL.rx'] = 0.0; o['fArmR.rx'] = 0.0; o['fArmL.rz'] = 0.9; o['fArmR.rz'] = -0.9;
  } else if (s === 'wipe') {
    // hands together in front of the belly, rubbing with the rag; every few seconds a pause
    const cyc = c.T % 7, active = cyc < 4.5 ? 1 : 0;
    const rub = Math.sin(c.T * 7.5) * 0.12 * active;
    o['uArmL.rx'] = -0.3; o['uArmR.rx'] = -0.3; o['uArmL.rz'] = -0.22; o['uArmR.rz'] = 0.22;
    o['fArmL.rx'] = -1.25 + rub * 0.3; o['fArmR.rx'] = -1.25 - rub * 0.3;
    o['fArmL.ry'] = 0.85 + rub; o['fArmR.ry'] = -0.85 + rub;
    o['torso.rx'] += 0.04;
  } else if (s === 'basket') {
    o['uArmR.rx'] = -0.1; o['fArmR.rx'] = -1.3; o['uArmR.rz'] = 0.12; o['fArmR.ry'] = 0.2;
  } else if (s === 'cane') {
    o['uArmR.rx'] = -0.32; o['fArmR.rx'] = -0.42; o['uArmR.rz'] = 0.08;
    o['prop.rx'] = 0.74;   // keep the stick planted on the ground
    o['uArmL.rx'] = 0.25; o['uArmL.rz'] = -0.05; o['fArmL.rz'] = 0.7; o['fArmL.rx'] = -0.2; // left hand at the small of the back
  } else if (s === 'relaxed') {
    o['fArmL.rx'] = -0.3; o['fArmR.rx'] = -0.3;
  }
}

function computePose(o: PoseVals, pose: Pose, c: AnimCtx) {
  for (const k of CH) o[k] = 0;
  const { T, t, tr, d } = c;
  const br = Math.sin(T * 2.1);
  const hunch = d.hunch;
  const idle = () => {
    // breathing + slow weight shift onto one leg
    const w = c.shift;
    o['hips.py'] = -0.008 * (1 + br) - Math.abs(w) * 0.012;
    o['hips.px'] = w * 0.035;
    o['hips.rz'] = -w * 0.06;
    o['thighL.rz'] = w * 0.06; o['thighR.rz'] = w * 0.06;
    o['thighL.rx'] = w > 0 ? -0.06 * w : 0; o['thighR.rx'] = w < 0 ? 0.06 * w : 0;
    o['shinL.rx'] = Math.max(0, -w) * 0.12; o['shinR.rx'] = Math.max(0, w) * 0.12;
    o['torso.rz'] = w * 0.05; o['torso.rx'] = hunch + 0.02 * br;
    o['head.rx'] = -hunch * 0.75 - 0.015 * br; o['head.rz'] = -w * 0.04;
    idleArms(o, c, br);
    if (c.weapon === 'blade' && c.drawn) { o['uArmR.rx'] = -0.2; o['fArmR.rx'] = -0.5; }
  };
  switch (pose) {
    case 'idle': idle(); break;
    case 'run': {
      const ph = c.phase * Math.PI * 2;
      const sn = Math.sin(ph), cs = Math.cos(ph);
      const amp = Math.min(1, 0.45 + c.speed / 6 * 0.55) * tr.stride * d.stride;
      o['thighL.rx'] = -sn * amp; o['thighR.rx'] = sn * amp;
      o['shinL.rx'] = 0.15 + 1.2 * amp * Math.max(0, cs) ** 1.5; o['shinR.rx'] = 0.15 + 1.2 * amp * Math.max(0, -cs) ** 1.5;
      o['hips.py'] = -tr.bob * Math.cos(2 * ph) * 0.5 - tr.bob * 0.3;
      o['hips.ry'] = sn * 0.16; o['hips.rz'] = cs * 0.04;
      o['torso.rx'] = tr.lean + hunch * 0.6 + 0.03 * Math.cos(2 * ph); o['torso.ry'] = -sn * 0.24;
      o['head.rx'] = -tr.lean * 0.7 - hunch * 0.5; o['head.ry'] = sn * 0.12;
      const as = tr.armSwing * Math.min(1, 0.5 + amp);
      o['uArmL.rx'] = sn * as; o['uArmR.rx'] = -sn * as;
      o['uArmL.rz'] = -0.2; o['uArmR.rz'] = 0.2;
      o['fArmL.rx'] = -1.25 - 0.3 * Math.max(0, sn); o['fArmR.rx'] = -1.25 - 0.3 * Math.max(0, -sn);
      if (d.idle === 'cane') { o['uArmR.rx'] = -0.35 - sn * 0.2; o['fArmR.rx'] = -0.45; o['prop.rx'] = 0.6 + sn * 0.2; }
      if (d.idle === 'basket') { o['uArmR.rx'] = -0.1; o['fArmR.rx'] = -1.3; }
      if (tr.heavy) o['base.rz'] = sn * 0.05;
      if (c.weapon === 'blade' && c.drawn) { o['uArmR.rx'] = -0.4 - sn * 0.3; o['fArmR.rx'] = -0.6; }
      break;
    }
    case 'attack': {
      idle();
      const p = clamp01(t / ONE_SHOT_DUR);
      if (c.weapon === 'bow') {
        o['uArmL.rx'] = -1.5; o['fArmL.rx'] = 0; o['uArmR.rx'] = -1.4 + 0.3 * ease(p); o['fArmR.rx'] = -1.2; o['uArmR.rz'] = -0.35; o['torso.ry'] = -0.35;
      } else if (tr.heavy) {
        const up = p < 0.45 ? ease(p / 0.45) : 1 - ease((p - 0.45) / 0.35);
        o['uArmL.rx'] = o['uArmR.rx'] = -2.8 * up - 0.3 * (1 - up);
        o['torso.rx'] = -0.2 * up + 0.35 * (p > 0.45 ? 1 - up : 0);
      } else {
        const r = p < 0.4 ? -2.6 * ease(p / 0.4) : -2.6 + 2.2 * ease(clamp01((p - 0.4) / 0.3));
        o['uArmR.rx'] = r; o['uArmR.rz'] = 0.2; o['fArmR.rx'] = p < 0.4 ? -0.6 : -0.15;
        o['torso.ry'] = p < 0.4 ? -0.35 * ease(p / 0.4) : -0.35 + 0.75 * ease(clamp01((p - 0.4) / 0.3));
        o['torso.rx'] = p > 0.4 ? 0.15 : -0.05;
        o['thighL.rx'] = -0.4; o['shinL.rx'] = 0.3; o['thighR.rx'] = 0.3; o['shinR.rx'] = 0.2;
      }
      break;
    }
    case 'cast': {
      idle();
      const up = Math.min(1, Math.sin(Math.PI * clamp01(t / ONE_SHOT_DUR)) * 1.5);
      o['uArmL.rx'] = o['uArmR.rx'] = -2.6 * up; o['fArmL.rx'] = o['fArmR.rx'] = -0.3 * up;
      o['uArmL.rz'] = -0.45; o['uArmR.rz'] = 0.45; o['head.rx'] = -0.3 * up; o['torso.rx'] = -0.12 * up;
      break;
    }
    case 'hit': {
      idle();
      const q = clamp01(t / ONE_SHOT_DUR), k = Math.sin(Math.PI * q) * (1 - 0.5 * q);
      o['torso.rx'] = -0.4 * k; o['head.rx'] = -0.35 * k; o['torso.rz'] = 0.15 * k;
      o['uArmL.rz'] = -0.6 * k; o['uArmR.rz'] = 0.6 * k; o['fArmL.rx'] = o['fArmR.rx'] = -0.8 * k; o['hips.py'] = -0.05 * k;
      break;
    }
    case 'parry': {
      idle();
      const k = Math.min(1, Math.sin(Math.PI * clamp01(t / ONE_SHOT_DUR)) * 1.8);
      o['uArmL.rx'] = -1.2 * k; o['fArmL.rx'] = -0.6 * k; o['uArmL.rz'] = 0.2 * k;
      o['uArmR.rx'] = -1.9 * k; o['uArmR.rz'] = 0.2 * k;
      o['hips.py'] = -0.08 * k; o['torso.rx'] = 0.1 * k;
      o['thighL.rx'] = -0.4 * k; o['shinL.rx'] = 0.4 * k; o['thighR.rx'] = 0.35 * k; o['shinR.rx'] = 0.3 * k;
      break;
    }
    case 'charge': {
      idle();
      o['uArmL.rx'] = -1.55; o['fArmL.rx'] = 0; o['uArmL.rz'] = 0.1;
      o['uArmR.rx'] = -1.45; o['fArmR.rx'] = -1.3; o['uArmR.rz'] = -0.4 + 0.03 * Math.sin(T * 30); o['torso.ry'] = -0.45;
      o['head.ry'] = 0.4; o['thighL.rx'] = -0.3; o['thighR.rx'] = 0.3; o['shinR.rx'] = 0.2; o['hips.py'] = -0.04;
      break;
    }
    case 'staggered': {
      const w = Math.sin(T * 3.1);
      o['base.rz'] = 0.1 * w; o['hips.py'] = -0.1;
      o['torso.rx'] = 0.5 + 0.05 * Math.sin(T * 2.3); o['head.rx'] = 0.35; o['head.rz'] = 0.2 * w;
      o['uArmL.rx'] = o['uArmR.rx'] = -0.25; o['fArmL.rx'] = o['fArmR.rx'] = -0.4;
      o['thighL.rx'] = -0.25; o['shinL.rx'] = 0.4; o['thighR.rx'] = 0.25; o['shinR.rx'] = 0.3;
      break;
    }
    case 'dead': {
      const p = clamp01(t / 0.7);
      const fall = p < 0.8 ? ease(p / 0.8) : 1 - 0.06 * Math.sin(((p - 0.8) / 0.2) * Math.PI);
      o['base.rx'] = -Math.PI / 2 * fall * 0.97; o['base.py'] = 0.14 * fall;
      o['uArmL.rz'] = -1.2 * fall; o['uArmR.rz'] = 1.2 * fall; o['fArmL.rx'] = o['fArmR.rx'] = -0.5 * fall; o['head.rx'] = -0.3 * fall;
      o['thighL.rx'] = -0.25 * fall; o['shinL.rx'] = 0.4 * fall; o['thighR.rx'] = 0.1 * fall;
      break;
    }
  }
}

// ───────────────────────── springs (secondary motion) ─────────────────────────
class Spring {
  x = 0; v = 0;
  constructor(private k = 70, private c = 9) {}
  step(target: number, dt: number) {
    const n = Math.max(1, Math.ceil(dt / 0.016)), h = dt / n;
    for (let i = 0; i < n; i++) { this.v += (this.k * (target - this.x) - this.c * this.v) * h; this.x += this.v * h; }
    return this.x;
  }
}

// ───────────────────────── shared materials & blob shadow ─────────────────────────
interface Shared { body: StandardMaterial; ring: StandardMaterial; blob: Mesh }
const SHARED = new WeakMap<Scene, Shared>();
let blobsEnabled = true;
/** Optional: hide the soft blob contact shadows (e.g. when real shadow maps are on). */
export function setCharacterBlobShadows(on: boolean): void {
  blobsEnabled = on;
  for (const v of liveViews) v.blob.setEnabled(on);
}
const liveViews = new Set<{ blob: InstancedMesh }>();

function shared(scene: Scene): Shared {
  let m = SHARED.get(scene);
  if (!m) {
    const body = new StandardMaterial('charBody', scene);
    body.diffuseColor = Color3.White();
    body.specularColor = Color3.Black();
    body.emissiveColor = new Color3(0.07, 0.055, 0.06);
    body.ambientColor = new Color3(0.25, 0.23, 0.26);
    // warm rim on silhouettes
    const f = new FresnelParameters();
    f.leftColor = new Color3(0.36, 0.27, 0.2);
    f.rightColor = new Color3(0, 0, 0);
    f.bias = 0.12; f.power = 2.6;
    body.emissiveFresnelParameters = f;
    const ring = new StandardMaterial('charRing', scene);
    ring.disableLighting = true;
    ring.emissiveColor = P.gold;
    ring.alpha = 0.9;
    // blob shadow: one quad + radial-gradient texture, instanced per character (1 draw call for all)
    const tex = new DynamicTexture('charBlobTex', { width: 64, height: 64 }, scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(40,24,48,0.55)'); grd.addColorStop(0.55, 'rgba(40,24,48,0.32)'); grd.addColorStop(1, 'rgba(40,24,48,0)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, 64, 64);
    tex.update(); tex.hasAlpha = true;
    const bm = new StandardMaterial('charBlob', scene);
    bm.diffuseTexture = tex; bm.useAlphaFromDiffuseTexture = true; bm.disableLighting = true; bm.emissiveColor = Color3.White();
    bm.backFaceCulling = false; bm.zOffset = -2; bm.alpha = 0.999;
    const blob = MeshBuilder.CreateGround('charBlobSrc', { width: 1, height: 1 }, scene);
    blob.material = bm; blob.isPickable = false; blob.setEnabled(false);
    blob.receiveShadows = false;
    m = { body, ring, blob };
    SHARED.set(scene, m);
  }
  return m;
}

// ───────────────────────── factory ─────────────────────────
let charCounter = 0;
/** Triangle count of the most recently built character body (diagnostics / dev harness). */
export const characterStats = { lastTriangles: 0 };

export const makeCharacter: MakeCharacter = (scene: Scene, opts: CharacterOpts): CharacterView => {
  const kind = opts.kind;
  const tr = TRAITS[kind];
  const id = ++charCounter;
  const mats = shared(scene);
  const des = design(kind, opts.color);
  const humanoid = !!des.spec;
  const root = new TransformNode(`char_${kind}_${id}`, scene);
  const rigRoot = new TransformNode(`rig_${id}`, scene);
  rigRoot.parent = root;

  const piv = humanoid ? humanPivots(des.shoulder) : legacyPivots();
  if (kind === 'brute') { piv.uArmL = [-0.42, 1.03, 0]; piv.uArmR = [0.42, 1.03, 0]; piv.fArmL = [-0.42, 0.8, 0]; piv.fArmR = [0.42, 0.8, 0]; piv.thighL = [-0.14, 0.62, 0]; piv.thighR = [0.14, 0.62, 0]; piv.bladeHand = [0.42, 0.45, 0.05]; piv.bowHand = [-0.42, 0.45, 0.05]; }
  if (kind === 'warden') { piv.uArmL = [-0.38, 1.05, 0]; piv.uArmR = [0.38, 1.05, 0]; piv.fArmL = [-0.38, 0.8, 0]; piv.fArmR = [0.38, 0.8, 0]; piv.thighL = [-0.13, 0.62, 0]; piv.thighR = [0.13, 0.62, 0]; piv.head = [0, 1.16, 0]; }
  const s = humanoid ? des.scale : tr.legacyScale;
  const height = humanoid ? tr.height * des.scale : tr.height;

  const skeleton = new Skeleton(`skel_${id}`, `skel_${id}`, scene);
  const nodes = {} as Record<Joint, TransformNode>;
  const jIdx = {} as Record<Joint, number>;
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
    bones[j] = new Bone(j, skeleton, par ? bones[par] : null, Matrix.Translation(local.x, local.y, local.z));
    bones[j].linkTransformNode(node);
    jIdx[j] = i;
  });

  // skinning groups: split limbs by height with a soft blend band at the joint
  const split = (upper: Joint, lower: Joint, jointY: number, band: number, y: number): [number, number, number] => {
    const t = clamp01((y - (jointY - band)) / (2 * band));
    const w = ease(t);
    return [jIdx[upper], jIdx[lower], w];
  };
  const resolve = (g: Group, p: Vector3): [number, number, number] => {
    const y = p.y / s;
    switch (g) {
      case 'armL': return split('uArmL', 'fArmL', piv.fArmL[1], 0.05, y);
      case 'armR': return split('uArmR', 'fArmR', piv.fArmR[1], 0.05, y);
      case 'legL': return split('thighL', 'shinL', piv.shinL[1], 0.05, y);
      case 'legR': return split('thighR', 'shinR', piv.shinR[1], 0.05, y);
      case 'body': return split('torso', 'hips', piv.torso[1], 0.06, y);
      case 'cape': return split('capeA', 'capeB', piv.capeB[1], 0.12, y);
      default: return [jIdx[g], jIdx[g], 1];
    }
  };
  const geo = new Geo(resolve);
  const glowGeo = new Geo(resolve, 0);
  const kit = new Kit(geo, glowGeo, s);
  const cloth = opts.color ? hex(opts.color) : P.rock;
  if (des.spec) {
    buildHuman(kit, des.spec, piv);
    if (kind !== 'npc') buildWeapons(kit, kind === 'player' ? P.skyDeep : P.teal, false);
    buildProps(kit, des.prop);
  } else {
    switch (kind) {
      case 'grunt': buildGrunt(kit, cloth); break;
      case 'archer': buildArcher(kit, cloth); break;
      case 'brute': buildBrute(kit, cloth); break;
      case 'warden': buildWarden(kit); break;
    }
    if (kind !== 'warden') buildWeapons(kit, shade(P.rock, 1.2), true);
  }
  geo.heightScale = s;
  geo.bakeAO(humanoid ? 0.7 : 0.4);
  characterStats.lastTriangles = geo.triangles + glowGeo.triangles;

  const pickables: Mesh[] = [];
  const body = geo.build(`body_${id}`, scene);
  body.parent = rigRoot;
  body.material = mats.body;
  body.skeleton = skeleton;
  body.numBoneInfluencers = 2;
  body.receiveShadows = true;
  const R = Math.max(height, 1.2);
  const bounds = new BoundingInfo(new Vector3(-R, -0.2, -R), new Vector3(R, height * 1.3, R));
  body.setBoundingInfo(bounds);
  // Adventurers are picked by a body-sized capsule, never by their skinned mesh: picking reads the bind pose, where the
  // sheathed and drawn weapons all stand full size (an invisible bow or greatsword would catch taps meant for others).
  if (kind === 'player') {
    body.isPickable = false;
    const pick = MeshBuilder.CreateCylinder(`pick_${id}`, { height: height * 0.95, diameter: 0.7 * s, tessellation: 8 }, scene);
    pick.parent = root; pick.position.y = height * 0.475; pick.visibility = 0; pick.isPickable = true;
    pick.doNotSyncBoundingInfo = true;
    pickables.push(pick);
  } else pickables.push(body);

  let glowMat: StandardMaterial | null = null;
  if (!glowGeo.empty) {
    const glow = glowGeo.build(`glow_${id}`, scene);
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

  // blob contact shadow (instanced => batched; transparent => never rendered into shadow maps)
  const blob = mats.blob.createInstance(`blob_${id}`);
  blob.parent = root;
  blob.isPickable = false;
  const blobBase = (humanoid ? 0.95 : tr.ringR * 1.7) * (humanoid ? s : 1);
  blob.scaling.set(blobBase, 1, blobBase * 0.9);
  blob.position.y = 0.02;
  blob.setEnabled(blobsEnabled);
  const live = { blob };
  liveViews.add(live);

  let ring: Mesh | null = null;
  let targeted = false;
  /** Time into a hit flash (−1 = none): a white overlay on the body (the body material is shared by everyone). */
  let flashT = -1;
  body.overlayColor = new Color3(1, 1, 1);

  // weapon visibility via bone scaling (keeps one draw call)
  let weapon: WeaponId | 'none' = opts.weapon ?? DEFAULT_WEAPON[kind];
  let drawn = !humanoid;
  let lastCombat = -1e9;
  const applyWeapon = () => {
    const show = (j: Joint, on: boolean) => nodes[j].scaling.setAll(on ? 1 : 0);
    show('bladeHand', weapon === 'blade' && drawn);
    show('shieldArm', weapon === 'blade' && drawn && humanoid);
    show('bladeHip', weapon === 'blade' && !drawn);
    show('shieldBack', weapon === 'blade' && !drawn);
    show('bowHand', weapon === 'bow' && drawn);
    show('bowBack', weapon === 'bow' && !drawn);
    show('prop', des.prop !== null && des.prop !== 'rag' && !(drawn && weapon !== 'none'));
    show('propL', des.prop === 'rag');
  };
  applyWeapon();

  // animation state
  let looping: Pose = 'idle';
  let pose: Pose = 'idle';
  let poseT = 0;
  let T = Math.random() * 10;
  const cur = zeroPose(), from = zeroPose(), out = zeroPose();
  let blend = 1;
  const BLEND_TIME = 0.2;
  let phase = Math.random();
  // idle life
  let shiftTarget = 0, shift = 0, shiftTimer = 2 + Math.random() * 3;
  let lookTarget = 0, look = 0, lookTimer = 1 + Math.random() * 3, lookPitch = 0;
  let blinkTimer = 1 + Math.random() * 3, blinkT = -1;
  // root motion tracking
  const prevPos = new Vector3(NaN, 0, 0);
  let prevYaw = 0, speed = 0, yawRate = 0, vy = 0;
  let airborne = false, groundY = 0, airW = 0;
  const springs = { capeA: new Spring(55, 8), capeB: new Spring(45, 6), capeZ: new Spring(40, 6), scarf: new Spring(60, 6), scarfZ: new Spring(50, 6), hair: new Spring(90, 9), hairZ: new Spring(80, 8) };

  const startPose = (p: Pose) => {
    for (const c of CH) from[c] = out[c];
    blend = 0; pose = p; poseT = 0;
  };

  const view: CharacterView = {
    root,
    height,
    setEntityId(eid: number) {
      for (const m of pickables) m.metadata = { ...(m.metadata ?? {}), entityId: eid };
      root.metadata = { ...(root.metadata ?? {}), entityId: eid };
    },
    setPose(p: Pose) {
      if (COMBAT.includes(p)) { lastCombat = T; if (!drawn) { drawn = true; applyWeapon(); } }
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
    flash() { flashT = 0; body.renderOverlay = true; body.overlayAlpha = 0.85; },
    setTargeted(on: boolean) {
      targeted = on;
      if (on && !ring) {
        ring = MeshBuilder.CreateTorus(`ring_${id}`, { diameter: tr.ringR * 2, thickness: 0.06 * Math.max(1, tr.ringR), tessellation: 32 }, scene);
        ring.scaling.y = 0.25; ring.position.y = 0.05; ring.parent = root; ring.material = mats.ring; ring.isPickable = false;
      }
      if (ring) ring.setEnabled(on);
    },
    update(rawDt: number) {
      const dt = Math.min(0.1, Math.max(0, rawDt));
      T += dt; poseT += dt;
      // ── root motion → speed, turn rate, vertical velocity, airborne ──
      root.computeWorldMatrix(true);
      const wp = root.getAbsolutePosition();
      const yaw = root.rotation.y;
      if (Number.isNaN(prevPos.x) || dt <= 0) { prevPos.copyFrom(wp); prevYaw = yaw; groundY = wp.y; }
      else {
        const dx = wp.x - prevPos.x, dz = wp.z - prevPos.z, dy = wp.y - prevPos.y;
        if (Math.hypot(dx, dz) > 3 || Math.abs(dy) > 1.5) { airborne = false; groundY = wp.y; }   // teleport
        else {
          const fwd = (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / dt;
          speed += (Math.max(0, fwd) - speed) * Math.min(1, dt * 10);
          let dyaw = yaw - prevYaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
          yawRate += (dyaw / dt - yawRate) * Math.min(1, dt * 8);
          vy = dy / dt;
          if (!airborne && vy > 3.5) airborne = true;
          if (airborne && wp.y <= groundY + 0.03 && vy <= 0.5) airborne = false;
          if (!airborne) groundY = wp.y;
        }
        prevPos.copyFrom(wp); prevYaw = yaw;
      }
      airW += ((airborne ? 1 : 0) - airW) * Math.min(1, dt * (airborne ? 14 : 18));
      // ── weapon sheathing ──
      if (drawn && humanoid && T - lastCombat > 4) { drawn = false; applyWeapon(); }
      // ── idle life timers ──
      shiftTimer -= dt;
      if (shiftTimer <= 0) { shiftTimer = 3 + Math.random() * 4; shiftTarget = shiftTarget > 0 ? -(0.6 + Math.random() * 0.4) : 0.6 + Math.random() * 0.4; }
      shift += (shiftTarget - shift) * Math.min(1, dt * 1.6);
      lookTimer -= dt;
      if (lookTimer <= 0) {
        lookTimer = 2 + Math.random() * 4;
        lookTarget = Math.random() < 0.35 ? 0 : (Math.random() * 2 - 1) * (kind === 'npc' ? 0.7 : 0.55);
        lookPitch = (Math.random() - 0.4) * 0.15;
      }
      look += (lookTarget - look) * Math.min(1, dt * 4);
      blinkTimer -= dt;
      if (blinkTimer <= 0) { blinkT = 0; blinkTimer = 2 + Math.random() * 3.5; if (Math.random() < 0.2) blinkTimer = 0.25; }
      let eyeY = 1;
      if (blinkT >= 0) { blinkT += dt; const q = blinkT / 0.14; eyeY = q < 1 ? 1 - 0.9 * Math.sin(q * Math.PI) : 1; if (q >= 1) blinkT = -1; }
      if (looping === 'dead') eyeY = 0.12;
      // ── pose ──
      if (pose === 'run') phase += dt * (speed > 0.5 ? 0.9 + speed * 0.13 : tr.cadence);
      if (!LOOPING.includes(pose) && poseT >= ONE_SHOT_DUR) startPose(looping);
      blend = Math.min(1, blend + dt / BLEND_TIME);
      computePose(cur, pose, { T, t: poseT, phase, speed, tr, d: des, weapon, drawn, shift, humanoid });
      const b = ease(blend);
      for (const c of CH) out[c] = from[c] + (cur[c] - from[c]) * b;
      // ── additive layers ──
      const idleW = pose === 'idle' ? b : 0;
      out['head.ry'] += look * idleW;
      out['head.rx'] += lookPitch * idleW;
      if (airW > 0.001) {
        const a = airW, up = vy > 0 ? 1 : 0;
        out['thighL.rx'] += (-0.75 - out['thighL.rx']) * a; out['shinL.rx'] += (1.2 - out['shinL.rx']) * a;
        out['thighR.rx'] += (-0.2 - out['thighR.rx']) * a; out['shinR.rx'] += (0.55 - out['shinR.rx']) * a;
        out['uArmL.rz'] += (-0.7 - out['uArmL.rz']) * a; out['uArmR.rz'] += (0.7 - out['uArmR.rz']) * a;
        out['uArmL.rx'] += (-0.5 * up - out['uArmL.rx']) * a; out['uArmR.rx'] += (-0.3 - out['uArmR.rx']) * a;
        out['fArmL.rx'] += (-0.6 - out['fArmL.rx']) * a; out['fArmR.rx'] += (-0.6 - out['fArmR.rx']) * a;
        out['torso.rx'] += 0.08 * a; out['head.rx'] -= 0.1 * a;
      }
      // ── secondary motion (cape, scarf, hair) from actual root motion ──
      const runPh = pose === 'run' ? Math.cos(phase * Math.PI * 4) : 0;
      const sp = Math.min(1.4, speed / 6);
      const fall = airborne ? Math.max(-1, Math.min(1, -vy / 8)) : 0;
      const breathe = Math.sin(T * 2.1) * 0.015;
      const capeA = springs.capeA.step(0.04 + sp * 0.2 + runPh * 0.05 * sp - fall * 0.25 + breathe - out['torso.rx'] * 0.6, dt);
      const capeB = springs.capeB.step(sp * 0.42 + Math.sin(T * 7.3) * 0.09 * sp - fall * 0.5, dt);
      const capeZ = springs.capeZ.step(-yawRate * 0.08 + Math.sin(T * 1.3) * 0.02, dt);
      out['capeA.rx'] += capeA; out['capeB.rx'] += capeB; out['capeA.rz'] += capeZ;
      out['scarf.rx'] += springs.scarf.step(0.08 + sp * 1.0 + Math.sin(T * 9.1) * 0.12 * sp + runPh * 0.1 * sp - fall * 0.6, dt);
      out['scarf.rz'] += springs.scarfZ.step(-yawRate * 0.12 + Math.sin(T * 5.7) * 0.06 * sp, dt);
      out['hair.rx'] += springs.hair.step(sp * 0.35 + runPh * 0.1 * sp - fall * 0.3 - out['head.rx'] * 0.5, dt);
      out['hair.rz'] += springs.hairZ.step(-yawRate * 0.06 - out['head.rz'] * 0.5, dt);
      // ── apply ──
      for (const j of ANIM) nodes[j].rotation.set(out[`${j}.rx`], out[`${j}.ry`], out[`${j}.rz`]);
      nodes.base.position.y = rest.base.y + out['base.py'] * s;
      nodes.hips.position.set(rest.hips.x + out['hips.px'] * s, rest.hips.y + out['hips.py'] * s, rest.hips.z);
      nodes.eyes.scaling.set(1, eyeY, 1);
      // blob stays on the ground while airborne and fades/shrinks with height
      const hAbove = Math.max(0, wp.y - groundY);
      blob.position.y = 0.02 - hAbove;
      const bs = blobBase * (1 - Math.min(0.5, hAbove * 0.3));
      blob.scaling.set(bs, 1, bs * 0.9);
      if (glowMat) {
        const k = looping === 'dead' ? 0.25 : pose === 'staggered' ? 0.55 + 0.3 * Math.abs(Math.sin(T * 9)) : 0.82 + 0.18 * Math.sin(T * 4);
        glowMat.emissiveColor.set(k, k, k);
      }
      if (flashT >= 0) {
        flashT += dt;
        body.overlayAlpha = Math.max(0, 1 - flashT / 0.18) * 0.85;
        if (flashT > 0.18) { flashT = -1; body.renderOverlay = false; }
      }
      if (ring && targeted) {
        ring.rotation.y += dt * 1.2;
        const sc = 1 + 0.05 * Math.sin(T * 5);
        ring.scaling.x = ring.scaling.z = sc;
      }
    },
    dispose() {
      liveViews.delete(live);
      root.dispose(false, false);
      skeleton.dispose();
      glowMat?.dispose();
    },
  };
  view.update(0);
  return view;
};
