// The Look v2 body's surfaces as functions of its frame (look.ts bodyFrame): the torso's rows of superellipse sections
// (bust, pectorals, belly, seat), the neck, the arms and legs (rings round their own axes), the hands and the feet.
// body2.ts draws the body from exactly these rows, and the gear (gearFit.ts) is offset from exactly the same surface,
// so a piece never clips through what the body draws and never floats off it (one source of truth). Pure: no scene.
//
// Coordinates: metres, feet at 0, facing +z, x = the adventurer's right. Angles round a section: 0 the front (+z),
// π/2 the right (+x) on the torso; on a limb π/2 is always the OUTER side (mirrored for the left limb), so a piece
// is designed once for both sides.
import { armAxis, legAxis, type Frame } from './look';

export type V3 = [number, number, number];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const G = (x: number, s: number) => Math.exp(-(x * x) / (s * s));
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** Ring sizes by detail: round the torso, round a limb (body2.ts and the gear use the same counts). */
export const ringRes = (d: number) => (d >= 0.9 ? { torso: 16, limb: 8 } : d >= 0.5 ? { torso: 10, limb: 6 } : d >= 0.3 ? { torso: 8, limb: 4 } : { torso: 6, limb: 4 });

// ───────── the torso ─────────
export interface TorsoRow { y: number; w: number; d: number; zc: number; bust: number; belly: number; glute: number; pec: number }
/** The torso's rows from the crotch up over the shoulders to the neck (the last row turns in to the neck: y dips). */
export function torsoRows(f: Frame): TorsoRow[] {
  const kk = f.H / 1.75, rows: TorsoRow[] = [];
  const add = (y: number, w: number, d: number, extra: Partial<TorsoRow> = {}) => rows.push({ y, w, d, zc: 0, bust: 0, belly: 0, glute: 0, pec: 0, ...extra });
  const ribsY = lerp(f.waistY, f.chestY, 0.5), upY = lerp(f.chestY, f.shY, 0.55);
  add(f.crotchY - 0.01 * kk, f.hipW * 0.5, f.hipD * 0.55);
  add(lerp(f.crotchY, f.hipY, 0.5), f.hipW * 0.94, f.hipD * 0.95, { glute: 1 });
  add(f.hipY, f.hipW, f.hipD, { glute: 0.7, belly: 0.25 });
  add(lerp(f.hipY, f.waistY, 0.5), lerp(f.hipW, f.waistW, 0.6), lerp(f.hipD, f.waistD, 0.5), { belly: 0.7 });
  add(f.waistY, f.waistW, f.waistD, { belly: 1 });
  add(ribsY, lerp(f.waistW, f.chestW, 0.62), lerp(f.waistD, f.chestD, 0.6), { belly: 0.45, bust: 0.45 });
  add(f.chestY, f.chestW, f.chestD, { bust: 1, pec: 1 });
  add(upY, f.chestW * 1.02, f.chestD * 0.94, { bust: 0.35, pec: 0.7 });
  // the shoulder's slope (trapezius) rounds over into the arm: no square corner at the top
  add(f.shY - 0.008 * kk, f.shX * 0.88, f.chestD * 0.84);
  add(f.shTopY, f.shX * 0.6, f.chestD * 0.62);
  // (the neck's ring stays inside the shoulders' top: a very thick neck would fold the roof over itself)
  add(f.neckBaseY + 0.012 * kk, Math.min(f.neckR * 1.3, f.shX * 0.57), Math.min(f.neckR * 1.2, f.chestD * 0.59));
  return rows;
}
/** A torso row's point at angle a (body2's section: a superellipse with the bust, pectorals, belly and seat). */
export function torsoPoint(f: Frame, r: TorsoRow, a: number): V3 {
  const kk = f.H / 1.75;
  const sa = Math.sin(a), ca = Math.cos(a);
  const px = Math.sign(sa) * Math.pow(Math.abs(sa), 0.82), pz = Math.sign(ca) * Math.pow(Math.abs(ca), 0.9);
  let x = px * r.w, z = pz * r.d + r.zc;
  const front = Math.max(0, ca), back = Math.max(0, -ca);
  z += r.bust * f.bust * 0.045 * kk * G(Math.abs(x) - r.w * 0.46, r.w * 0.36) * front;
  z += r.pec * f.muscle * 0.014 * kk * G(Math.abs(x) - r.w * 0.42, r.w * 0.45) * front * (f.female ? 0.3 : 1);
  z += r.belly * f.belly * 0.065 * kk * front * front;
  z -= r.glute * f.glute * 0.03 * kk * G(Math.abs(x) - r.w * 0.45, r.w * 0.4) * back;
  x *= 1 + r.belly * f.belly * 0.08 * Math.abs(sa);
  return [x, r.y, z];
}
export const mixRow = (a: TorsoRow, b: TorsoRow, t: number): TorsoRow => ({
  y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), d: lerp(a.d, b.d, t), zc: lerp(a.zc, b.zc, t), bust: lerp(a.bust, b.bust, t), belly: lerp(a.belly, b.belly, t), glute: lerp(a.glute, b.glute, t), pec: lerp(a.pec, b.pec, t),
});

// ───────── limbs ─────────
export interface LimbRow { y: number; r: number; z?: number }
/** The arm's rows from the shoulder cap to below the wrist (body2: a soft deltoid, the elbow, the forearm). */
export function armRows(f: Frame, detail: number): LimbRow[] {
  const kk = f.H / 1.75;
  const rows: LimbRow[] = [
    { y: f.shY + f.uArmR * 0.5, r: f.uArmR * 0.4 },
    { y: f.shY + f.uArmR * 0.15, r: f.uArmR * 0.92 },
    { y: f.shY - f.uArmR * 0.45, r: f.uArmR * (1.12 + 0.14 * f.muscle) },
    { y: lerp(f.shY, f.elbowY, 0.5), r: f.uArmR * (1.02 + 0.12 * f.muscle), z: 0.003 * kk },
    { y: f.elbowY + 0.035 * kk, r: f.fArmR * 1.02 },
    { y: f.elbowY, r: f.fArmR * 0.96 },
    { y: lerp(f.elbowY, f.wristY, 0.3), r: f.fArmR * (1.08 + 0.08 * f.muscle), z: 0.002 * kk },
    { y: f.wristY + 0.012 * kk, r: f.wristR },
    { y: f.wristY - 0.012 * kk, r: f.wristR * 0.92 },
  ];
  return detail < 0.5 ? rows.filter((_, i) => i !== 3 && i !== 6) : rows;
}
/** The leg's rows from the hip to the ankle. */
export function legRows(f: Frame, detail: number): LimbRow[] {
  const kk = f.H / 1.75;
  const rows: LimbRow[] = [
    { y: f.hipY + 0.03 * kk, r: f.thighR * 0.92 },
    { y: f.crotchY, r: f.thighR },
    { y: lerp(f.kneeY, f.crotchY, 0.55), r: f.thighR * 0.86, z: 0.004 * kk },
    { y: f.kneeY + 0.06 * kk, r: f.kneeR * 1.14 },
    { y: f.kneeY, r: f.kneeR, z: 0.006 * kk },
    { y: f.kneeY - 0.05 * kk, r: f.calfR * 0.96 },
    { y: lerp(f.kneeY, f.ankleY, 0.3), r: f.calfR * (1.04 + 0.1 * f.muscle), z: -0.012 * kk },
    { y: lerp(f.ankleY, f.kneeY, 0.25), r: f.ankleR * 1.35 },
    { y: f.ankleY + 0.02 * kk, r: f.ankleR * 1.08 },
  ];
  return detail < 0.5 ? rows.filter((_, i) => i !== 2 && i !== 5 && i !== 7) : rows;
}
/** The neck's rows (ring radius and the forward lean of its top). */
export function neckRows(f: Frame): { y: number; r: number; dz: number }[] {
  const kk = f.H / 1.75;
  const ys = [f.neckBaseY - 0.03 * kk, f.neckBaseY + 0.02 * kk, lerp(f.neckBaseY, f.chinY, 0.6), f.chinY + 0.02 * kk];
  return ys.map((y, i) => ({ y, r: f.neckR * (i === 0 ? 1.2 : i === 1 ? 1.05 : 1), dz: -0.006 * kk + (i >= 2 ? f.headZ * 0.6 : 0) }));
}

// ───────── the surfaces (point and outward normal at a place) ─────────
export type Region = 'torso' | 'arm' | 'leg' | 'neck';
export interface Surfaces {
  f: Frame; detail: number; kk: number;
  torso: TorsoRow[]; arm: LimbRow[]; leg: LimbRow[]; neck: { y: number; r: number; dz: number }[];
  /** The boot's extra girth below this height (body2 paints its boots a little proud of the leg). */
  bootTop: number;
  /** The torso at row parameter s (0 .. rows−1, fractional between rows: exactly body2's mesh at its ring angles). */
  torsoAt(s: number, a: number): V3;
  /** s for a height on the torso's rising part (crotch .. shoulder top); the roof to the neck is the last row. */
  torsoS(y: number): number;
  /** The arm of `side` (−1 left, 1 right) at height y, angle a (π/2 outward). */
  armAt(side: number, y: number, a: number): V3;
  legAt(side: number, y: number, a: number): V3;
  neckAt(y: number, a: number): V3;
  /** A surface's point and its outward unit normal. */
  at(region: Region, side: number, u: number, a: number): { p: V3; n: V3 };
}

function limbAt(rows: readonly LimbRow[], axis: (y: number) => number, side: number, y: number, a: number, zs: number, extra: (y: number) => number): V3 {
  // rows run downwards; below the last or above the first: held at the end row
  let i = 0;
  while (i < rows.length - 2 && y < rows[i + 1]!.y) i++;
  const A = rows[i]!, B = rows[i + 1]!;
  const t = clamp((y - A.y) / (B.y - A.y), 0, 1);
  const sa = side * Math.sin(a), ca = Math.cos(a);
  const pt = (R: LimbRow): V3 => { const r = R.r + extra(R.y); return [side * axis(R.y) + sa * r, R.y, ca * r * zs + (R.z ?? 0)]; };
  const p = pt(A), q = pt(B);
  return [lerp(p[0], q[0], t), lerp(p[1], q[1], t), lerp(p[2], q[2], t)];
}

/** A limb's rows with two more either side of height c (body2's withCuts). */
function cutLimb(rows: LimbRow[], c: number): LimbRow[] {
  const out: LimbRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i]!, b = rows[i + 1];
    out.push(a);
    if (!b) continue;
    const hi = Math.max(a.y, b.y), lo = Math.min(a.y, b.y);
    if (c - 0.004 > lo && c + 0.004 < hi) for (const yy of a.y > b.y ? [c + 0.003, c - 0.003] : [c - 0.003, c + 0.003]) {
      const t = (yy - a.y) / (b.y - a.y);
      out.push({ y: yy, r: a.r + (b.r - a.r) * t, z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t });
    }
  }
  return out;
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function surfaces(f: Frame, detail: number, bootTop = 0): Surfaces {
  const kk = f.H / 1.75;
  // (the legs with body2's two rows either side of the boot's top, where it paints the boot a little proud)
  const torso = torsoRows(f), arm = armRows(f, detail), leg = cutLimb(legRows(f, detail), bootTop), neck = neckRows(f);
  const nT = torso.length;
  const torsoAt = (s: number, a: number): V3 => {
    const ss = clamp(s, 0, nT - 1), i = Math.min(nT - 2, Math.floor(ss)), t = ss - i;
    const p = torsoPoint(f, torso[i]!, a), q = torsoPoint(f, torso[i + 1]!, a);
    return [lerp(p[0], q[0], t), lerp(p[1], q[1], t), lerp(p[2], q[2], t)];
  };
  const torsoS = (y: number): number => {
    // the rising rows: 0 .. nT − 2 (the last row turns in to the neck)
    if (y <= torso[0]!.y) return 0;
    for (let i = 0; i < nT - 2; i++) {
      const a = torso[i]!.y, b = torso[i + 1]!.y;
      if (y <= b) return i + (y - a) / (b - a);
    }
    return nT - 2;
  };
  const bootR = (y: number) => (y < bootTop ? 0.006 * kk : 0);
  const armAt = (side: number, y: number, a: number) => limbAt(arm, (yy) => armAxis(f, yy), side, y, a, 0.94, () => 0);
  const legAt = (side: number, y: number, a: number) => limbAt(leg, (yy) => legAxis(f, yy), side, y, a, 1, bootR);
  const neckAt = (y: number, a: number): V3 => {
    let i = 0;
    while (i < neck.length - 2 && y > neck[i + 1]!.y) i++;
    const A = neck[i]!, B = neck[i + 1]!, t = clamp((y - A.y) / (B.y - A.y), 0, 1);
    const r = lerp(A.r, B.r, t), dz = lerp(A.dz, B.dz, t);
    return [Math.sin(a) * r, lerp(A.y, B.y, t), Math.cos(a) * r * 1.02 + dz];
  };
  const pointOf = (region: Region, side: number, u: number, a: number): V3 =>
    region === 'torso' ? torsoAt(u, a) : region === 'arm' ? armAt(side, u, a) : region === 'leg' ? legAt(side, u, a) : neckAt(u, a);
  const at = (region: Region, side: number, u: number, a: number) => {
    const p = pointOf(region, side, u, a);
    const da = 0.02, du = region === 'torso' ? 0.05 : 0.01 * kk;
    const pa = sub(pointOf(region, side, u, a + da), pointOf(region, side, u, a - da));
    let pu = sub(pointOf(region, side, u + du, a), pointOf(region, side, u - du, a));
    if (Math.hypot(...pu) < 1e-6) pu = [0, 1, 0];
    let n = unit(cross(pu, pa));
    // outward: away from the section's axis
    // (the torso's top turns in over the shoulders to the neck: there outward is up as well as out)
    const c: V3 = region === 'torso' ? [0, p[1] - (u > torso.length - 3.5 ? 0.3 : 0), 0] : region === 'neck' ? [0, p[1], 0] : region === 'arm' ? [side * armAxis(f, p[1]), p[1], 0] : [side * legAxis(f, p[1]), p[1], 0];
    const out = sub(p, c);
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = [-n[0], -n[1], -n[2]];
    return { p, n };
  };
  return { f, detail, kk, torso, arm, leg, neck, bootTop, torsoAt, torsoS, armAt, legAt, neckAt, at };
}

// ───────── landmarks: heights on the body by name, so a piece is placed the same on every body ─────────
/** Height stations (metres on this body): a piece says "from the hip to a third of the way to the knee". */
export const ST = Object.freeze({ GROUND: 0, ANKLE: 1, CALF: 2, KNEE: 3, THIGH: 4, CROTCH: 5, HIP: 6, WAIST: 7, RIBS: 8, CHEST: 9, SH: 10, SHTOP: 11, NECK: 12, CHIN: 13 });
export function stations(f: Frame): number[] {
  return [0, f.ankleY, lerp(f.ankleY, f.kneeY, 0.6), f.kneeY, lerp(f.kneeY, f.crotchY, 0.55), f.crotchY, f.hipY, f.waistY, lerp(f.waistY, f.chestY, 0.5), f.chestY, f.shY, f.shTopY, f.neckBaseY, f.chinY];
}
/** A landmark coordinate (a station index with a fraction towards the next) as a height on this body. */
export function stY(st: readonly number[], u: number): number {
  const i = clamp(Math.floor(u), 0, st.length - 2), t = u - i;
  return lerp(st[i]!, st[i + 1]!, t);
}
/** Arm stations (heights): the cap's top, the shoulder joint, mid upper arm, elbow, mid forearm, wrist, the hand's end. */
export const AST = Object.freeze({ CAP: 0, SH: 1, BICEP: 2, ELBOW: 3, FORE: 4, WRIST: 5, HAND: 6 });
export function armStations(f: Frame): number[] {
  return [f.shY + f.uArmR * 0.5, f.shY, lerp(f.shY, f.elbowY, 0.5), f.elbowY, lerp(f.elbowY, f.wristY, 0.5), f.wristY, f.wristY - f.handL];
}
