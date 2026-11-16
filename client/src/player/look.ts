// Pure: an adventurer's Look v2 (shared/src/look.ts) → what the model is built from. No Babylon scene beyond Color3:
// unit-tested on its own (look.test.ts checks that every field of a look changes something here).
//
//  · `bodyFrame(look)`: the body's landmarks in metres (feet at 0, facing +z, x = the adventurer's right is +x): the
//    skull, face, neck, shoulders, chest, waist, hips, limbs, hands and feet, with natural proportions (about seven
//    heads tall for Humans) and each people's own offsets (Larchfolk tall and slender, Knollfolk small and sturdy with
//    big heads, hands and feet, Brindlekin furred). Every body slider moves it; male and female are two base shapes.
//    The body2.ts builder draws the body straight from these numbers (no warp).
//  · `faceParams(look)`: the head and face as numbers (skull, jaw, chin, eyes, lids, brows, nose, lips, ears, age).
//  · `makeAttachWarp(frame)`: maps the old canonical 1.8 m humanoid (character.ts humanPivots: every weapon, job cue,
//    worn gear piece, cape, scarf and prop is authored there) onto this body, region by region, so all of them attach.
//  · `lookColours`, `renderColour` (the render clamp: nothing vanishes), stance and walk, `modelParams`.
// (`client/src/world/look.ts` is the render settings; this one is the adventurer's appearance.)
import { Color3 } from '@babylonjs/core';
import {
  ADVENTURER_RADIUS, BROW_SHAPES, EYE_SHAPES, HAIR_STYLE_INFO, LINER_COLOURS, LIP_COLOURS, PEOPLES, SHADOW_COLOURS,
  type HairStyleInfo, type Look, type PeopleId,
} from '@sg2/shared';

// ───────── the old canonical humanoid (character.ts humanPivots), where attachments are authored ─────────
/** Hip, neck, shoulder joint and wrist heights, the shoulder's half width and the skull's top, in m. */
export const CANON = Object.freeze({
  hip: 0.88, neck: 1.33, shoulderY: 1.265, shoulderX: 0.235, elbow: 1.02, wrist: 0.765, knee: 0.47, ankle: 0.1, top: 1.775, legX: 0.1, armR: 0.07,
  headY: 1.565, headR: [0.195, 0.205, 0.185] as const,
});
/** The widest half width an adventurer's body may take (inside the fixed gameplay hit radius, with a margin). */
export const MAX_HALF_WIDTH = ADVENTURER_RADIUS - 0.02;

const u20 = (v: number) => (Math.max(0, Math.min(20, v)) - 10) / 10;
const u10 = (v: number) => (Math.max(0, Math.min(10, v)) - 5) / 5;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ───────── the body ─────────
export interface Frame {
  people: PeopleId; female: boolean;
  /** Standing height (the skull's top), m. */
  H: number;
  // head (centre, half sizes) and neck
  headY: number; headZ: number; headH: number; headW: number; headD: number; chinY: number;
  neckR: number; neckBaseY: number;
  // torso
  shY: number; shX: number; shTopY: number; chestY: number; chestW: number; chestD: number; bust: number;
  waistY: number; waistW: number; waistD: number; belly: number;
  hipY: number; hipW: number; hipD: number; glute: number; crotchY: number;
  // legs (from the hip joint at ±legX)
  legX: number; thighR: number; kneeY: number; kneeR: number; calfR: number; ankleY: number; ankleR: number;
  footL: number; footW: number; footH: number;
  // arms (from the shoulder joint at ±shX)
  elbowY: number; wristY: number; uArmR: number; fArmR: number; wristR: number; handL: number; handW: number;
  /** 0 slight .. 1 built (limb definition), and the weight -1..1. */
  muscle: number; weight: number;
  /** The width factor every x was given to keep the widest build inside MAX_HALF_WIDTH (1: none). */
  fit: number;
}

interface PeopleShape { heads: number; leg: number; width: number; hand: number; foot: number; limb: number }
/** Each people's proportions: heads tall, leg share of height, width over a human of its height, hands, feet, limb girth. */
export const PEOPLE_SHAPE: Readonly<Record<PeopleId, PeopleShape>> = Object.freeze({
  human: { heads: 7.2, leg: 0.515, width: 1, hand: 1, foot: 1, limb: 1 },
  larchfolk: { heads: 7.9, leg: 0.545, width: 0.88, hand: 1.04, foot: 1, limb: 0.84 },
  knollfolk: { heads: 5.1, leg: 0.43, width: 1.32, hand: 1.35, foot: 1.35, limb: 1.3 },
  brindlekin: { heads: 7.0, leg: 0.505, width: 1.04, hand: 1.15, foot: 1.12, limb: 1.05 },
});

/** The body's landmarks for a look (every body slider, the body and the people). */
export function bodyFrame(l: Look): Frame {
  const P = PEOPLES[l.people], S = PEOPLE_SHAPE[l.people], b = l.build, fem = l.body === 'female';
  const H = P.heightM * (fem ? 0.94 : 1) * (1 + P.span * u20(b.height));
  const k = H / 1.75;                       // length scale over a 1.75 m human
  const ws = k * S.width;                   // width scale
  const mu = u20(b.muscle), we = u20(b.weight);
  const muscle = Math.max(0, Math.min(1, (fem ? 0.32 : 0.5) + 0.5 * mu));
  const fat = (x: number) => 1 + x * (we > 0 ? 1 : 0.55) * we;  // weight: more out than in
  // head
  const headH = (H / S.heads) * (1 + 0.11 * u20(b.head)) * (1 + 0.1 * u10(l.face.length));
  const headW = headH * (fem ? 0.37 : 0.385) * (1 + 0.14 * u10(l.face.width)) * fat(0.06);
  const headD = headH * 0.43 * (1 + 0.03 * u10(l.face.width));
  const chinY = H - headH;
  const headY = H - headH * 0.5;
  // neck and shoulders
  const neckLen = headH * 0.36 * (1 + 0.22 * u20(b.neck));
  const shTopY = chinY - neckLen * 0.62;
  const shY = shTopY - 0.03 * k;
  const neckR = (fem ? 0.047 : 0.057) * ws * (1 + 0.24 * u20(b.neck)) * (1 + 0.15 * mu) * fat(0.12);
  // legs
  const hipY = H * S.leg * (fem ? 0.995 : 1) * (1 + 0.07 * u20(b.legs));
  const kneeY = hipY * 0.53, ankleY = hipY * 0.085;
  const crotchY = hipY - 0.075 * k;
  // torso heights
  const span = shY - hipY;
  const waistY = hipY + span * (fem ? 0.36 : 0.33);
  const chestY = hipY + span * 0.74;
  // widths
  const shX = (fem ? 0.163 : 0.188) * ws * (1 + 0.16 * u20(b.shoulders)) * (1 + 0.05 * mu) * fat(0.04);
  const chestW = (fem ? 0.138 : 0.158) * ws * (1 + 0.14 * u20(b.chest)) * (1 + 0.05 * mu) * fat(0.14);
  const chestD = (fem ? 0.1 : 0.112) * ws * (1 + 0.16 * u20(b.chest)) * (1 + 0.1 * mu) * fat(0.16);
  const bust = fem ? Math.max(0, 0.5 + 0.48 * u20(b.chest)) * fat(0.25) : Math.max(0, 0.08 * mu);
  const waistW = (fem ? 0.112 : 0.135) * ws * (1 + 0.2 * u20(b.waist)) * fat(0.34);
  const waistD = (fem ? 0.088 : 0.1) * ws * (1 + 0.15 * u20(b.waist)) * fat(0.4);
  const belly = Math.max(0, we) * (fem ? 0.5 : 0.7) + Math.max(0, u20(b.waist)) * 0.15;
  const hipW = (fem ? 0.168 : 0.152) * ws * (1 + 0.17 * u20(b.hips)) * fat(0.18);
  const hipD = (fem ? 0.11 : 0.1) * ws * (1 + 0.12 * u20(b.hips)) * fat(0.2);
  const glute = (fem ? 0.55 : 0.35) + 0.2 * u20(b.hips);
  const legX = hipW * 0.56;
  // limbs (radii), arms length
  const L = ws * S.limb;
  const limb = (x: number) => x * L * (1 + 0.17 * mu) * fat(0.22);
  const armK = 1 + 0.1 * u20(b.arms);
  const wristY = shY - (shY - H * 0.485) * armK;
  const elbowY = shY - (shY - wristY) * 0.54;
  const armMul = 1 + 0.06 * u20(b.arms);
  const f: Frame = {
    people: l.people, female: fem, H,
    headY, headZ: 0.012 * k, headH, headW, headD, chinY, neckR, neckBaseY: shTopY - 0.02 * k,
    shY, shX, shTopY, chestY, chestW, chestD, bust, waistY, waistW, waistD, belly, hipY, hipW, hipD, glute, crotchY,
    legX, thighR: limb(fem ? 0.083 : 0.08), kneeY, kneeR: limb(fem ? 0.047 : 0.05), calfR: limb(fem ? 0.05 : 0.055), ankleY, ankleR: limb(fem ? 0.026 : 0.03),
    footL: 0.25 * k * S.foot * (fem ? 0.92 : 1), footW: 0.048 * k * S.foot * (fem ? 0.9 : 1), footH: 0.075 * k * Math.sqrt(S.foot),
    elbowY, wristY, uArmR: limb(fem ? 0.04 : 0.046) * armMul, fArmR: limb(fem ? 0.034 : 0.039) * armMul, wristR: limb(fem ? 0.022 : 0.025),
    handL: 0.1 * k * S.hand * (fem ? 0.93 : 1), handW: 0.044 * k * S.hand * (fem ? 0.92 : 1) * (1 + 0.08 * mu),
    muscle, weight: we, fit: 1,
  };
  const w = rawHalfWidth(f);
  if (w > MAX_HALF_WIDTH) squeeze(f, MAX_HALF_WIDTH / w);
  return f;
}

/** The widest half width of the body (m): the arm's outer edge, the hips, the head (with a cape's and hem's room). */
function rawHalfWidth(f: Frame): number {
  return Math.max(f.shX + f.uArmR * 1.25 + 0.012, f.hipW + 0.07, f.chestW + 0.03, f.headW + 0.04);
}
function squeeze(f: Frame, k: number) {
  for (const key of ['shX', 'chestW', 'waistW', 'hipW', 'legX', 'thighR', 'kneeR', 'calfR', 'ankleR', 'uArmR', 'fArmR', 'wristR', 'headW', 'neckR', 'footW', 'handW'] as const) f[key] *= k;
  f.fit *= k;
}
/** The widest half width of the built body (m): never over MAX_HALF_WIDTH. */
export const halfWidth = (f: Frame): number => rawHalfWidth(f);

// ───────── the face as numbers (face2.ts builds them) ─────────
export interface FaceParams {
  // skull and jaw (factors round 1, offsets round 0)
  forehead: number; cheek: number; jaw: number; chinLen: number; chinW: number; fullness: number; brow: number;
  // eyes
  eyeW: number; eyeH: number; eyeTilt: number; lid: number; lower: number; crease: number; depth: number; eyeGap: number; eyeY: number;
  // brows: arch height, where the peak is (0 inner..1 outer), thickness (m-ish factor), taper, the S curve, lift, tilt (+ outer up)
  browArch: number; browPeak: number; browT: number; browTaper: number; browS: number; browY: number; browTilt: number; browAngle: number;
  // nose: length, width, bridge height, tip (+ up / − down)
  noseLen: number; noseW: number; bridge: number; tip: number;
  // mouth
  mouthW: number; upper: number; lower2: number; mouthY: number;
  // ears
  earSize: number; earAngle: number; earStyle: number;
  /** Age 0..4: lines' strength. */
  age: number;
  /** Muzzle 0..7 (furred peoples, else -1). */
  muzzle: number;
}

interface EyeShape { w: number; h: number; tilt: number; lid: number; lower: number; crease: number; depth: number }
/** EYE_SHAPES (12): opening half size (rel.), tilt (rad, + = outer corner up), upper lid cover, lower lid rise, crease, socket depth. */
export const EYE_PRESETS: readonly EyeShape[] = Object.freeze([
  { w: 1, h: 0.44, tilt: 0.06, lid: 0.3, lower: 0.12, crease: 1, depth: 0.5 },       // Almond
  { w: 0.94, h: 0.58, tilt: 0, lid: 0.18, lower: 0.06, crease: 1, depth: 0.4 },      // Round
  { w: 1, h: 0.42, tilt: -0.02, lid: 0.46, lower: 0.1, crease: 0.25, depth: 0.55 },  // Hooded
  { w: 1.04, h: 0.36, tilt: 0.1, lid: 0.4, lower: 0.14, crease: 0, depth: 0.22 },    // Monolid
  { w: 1, h: 0.44, tilt: 0.2, lid: 0.28, lower: 0.12, crease: 1, depth: 0.45 },      // Upturned
  { w: 1, h: 0.44, tilt: -0.17, lid: 0.32, lower: 0.08, crease: 1, depth: 0.45 },    // Downturned
  { w: 0.96, h: 0.42, tilt: 0.02, lid: 0.34, lower: 0.1, crease: 0.7, depth: 1 },    // Deep set
  { w: 0.98, h: 0.54, tilt: 0.05, lid: 0.14, lower: 0.05, crease: 1, depth: 0.35 },  // Bright
  { w: 1, h: 0.46, tilt: 0, lid: 0.56, lower: 0.1, crease: 0.6, depth: 0.5 },        // Heavy lid
  { w: 1.06, h: 0.3, tilt: 0.04, lid: 0.34, lower: 0.16, crease: 0.6, depth: 0.45 }, // Narrow
  { w: 1, h: 0.46, tilt: -0.06, lid: 0.62, lower: 0.12, crease: 0.8, depth: 0.45 },  // Sleepy
  { w: 1.1, h: 0.36, tilt: 0.3, lid: 0.3, lower: 0.2, crease: 0.8, depth: 0.42 },    // Cat
]);
interface BrowShape { arch: number; peak: number; t: number; taper: number; s: number; angle: number }
/** BROW_SHAPES (10). */
export const BROW_PRESETS: readonly BrowShape[] = Object.freeze([
  { arch: 0.1, peak: 0.6, t: 1, taper: 0.4, s: 0, angle: 0 },       // Straight
  { arch: 0.45, peak: 0.62, t: 0.95, taper: 0.55, s: 0, angle: 0 }, // Soft arch
  { arch: 0.85, peak: 0.6, t: 0.85, taper: 0.6, s: 0, angle: 0.2 }, // High arch
  { arch: 0.6, peak: 0.66, t: 1, taper: 0.5, s: 0, angle: 1 },      // Angled
  { arch: 0.6, peak: 0.5, t: 1, taper: 0.35, s: 0, angle: 0 },      // Rounded
  { arch: 0, peak: 0.5, t: 1.05, taper: 0.2, s: 0, angle: 0 },      // Flat
  { arch: 0.3, peak: 0.55, t: 1.55, taper: 0.15, s: 0, angle: 0 },  // Bushy
  { arch: 0.45, peak: 0.6, t: 0.55, taper: 0.5, s: 0, angle: 0 },   // Thin
  { arch: 0.4, peak: 0.55, t: 0.95, taper: 0.5, s: 1, angle: 0 },   // S-curve
  { arch: 0.4, peak: 0.45, t: 1.1, taper: 0.85, s: 0, angle: 0.3 }, // Tapered
]);
if (EYE_PRESETS.length !== EYE_SHAPES.length || BROW_PRESETS.length !== BROW_SHAPES.length) throw new Error('look.ts: eye or brow presets out of step');

export function faceParams(l: Look): FaceParams {
  const f = l.face, e = l.eyes, b = l.brows, n = l.nose, m = l.mouth;
  const es = EYE_PRESETS[e.shape] ?? EYE_PRESETS[0]!, bs = BROW_PRESETS[b.shape] ?? BROW_PRESETS[0]!;
  const fem = l.body === 'female';
  const size = 1 + 0.26 * u10(e.size);
  const open = u10(e.openness);
  return {
    forehead: u10(f.forehead), cheek: u10(f.cheekbones), jaw: (fem ? 0.84 : 0.95) * (1 + 0.22 * u10(f.jawWidth)),
    chinLen: u10(f.chinLength), chinW: (fem ? 0.9 : 1) * (1 + 0.3 * u10(f.chinWidth)), fullness: u20(l.build.weight), brow: fem ? 0.25 : 0.7,
    eyeW: es.w * size, eyeH: es.h * size * (1 + 0.22 * open), eyeTilt: es.tilt + 0.16 * u10(e.tilt),
    lid: Math.max(0, Math.min(0.85, es.lid - 0.26 * open)), lower: es.lower, crease: es.crease, depth: es.depth,
    eyeGap: 1 + 0.14 * u10(e.spacing), eyeY: u10(e.height),
    browArch: bs.arch, browPeak: bs.peak, browT: bs.t * (1 + 0.45 * u10(b.thickness)) * (fem ? 0.85 : 1.1), browTaper: bs.taper, browS: bs.s,
    browY: u10(b.height), browTilt: 0.2 * u10(b.tilt), browAngle: bs.angle,
    noseLen: u10(n.length), noseW: u10(n.width), bridge: u10(n.bridge), tip: u10(n.tip),
    mouthW: u10(m.width), upper: u10(m.upperLip), lower2: u10(m.lowerLip), mouthY: u10(m.height),
    earSize: u10(l.ears.size), earAngle: u10(l.ears.angle), earStyle: l.ears.style,
    age: l.face.age, muzzle: l.fur ? l.fur.muzzle : -1,
  };
}

// ───────── the attachment warp: the old canonical humanoid → this body ─────────
export type WarpRegion = 'leg' | 'torso' | 'arm' | 'head' | 'shoulder';
export interface Warp {
  /** Moves a canonical point (m) of a region in place, onto this body. */
  apply(region: WarpRegion, p: { x: number; y: number; z: number }): void;
  /** The body height a canonical torso height maps to. */
  y(y: number): number;
}
/** Piecewise linear through (xs[i], ys[i]) (xs ascending), extended at both ends. */
function pw(xs: readonly number[], ys: readonly number[], x: number): number {
  let i = 0;
  while (i < xs.length - 2 && x > xs[i + 1]!) i++;
  const t = (x - xs[i]!) / (xs[i + 1]! - xs[i]!);
  return ys[i]! + (ys[i + 1]! - ys[i]!) * t;
}
/** As pw, held flat beyond both ends. */
const pwc = (xs: readonly number[], ys: readonly number[], x: number) => pw(xs, ys, Math.max(xs[0]!, Math.min(xs[xs.length - 1]!, x)));
/** The old torso's half width and depth by canonical height (character.ts buildHuman's tunic profile, sz 0.78). */
const OLD_T_Y = [0.62, 0.86, 0.95, 1.04, 1.12, 1.22, 1.28, 1.32, 1.36];
const OLD_T_W = [0.21, 0.205, 0.175, 0.19, 0.196, 0.194, 0.163, 0.11, 0.065];
/**
 * The warp that fits everything authored on the old canonical humanoid (weapons, job cues, gear pieces, the cape,
 * scarf, tabard and belt, props, the tail) onto this body: heights by landmarks (ankle, knee, hip, waist, chest,
 * shoulder, neck, head), widths and depths by the ratio of the old body's to this one's at that height, the head
 * round its centre by the ratio of the two skulls, arms and legs round their own axes.
 */
export function makeAttachWarp(f: Frame): Warp {
  const C = CANON;
  const ty = [0, C.ankle, C.knee, 0.66, C.hip, 1.04, 1.12, C.shoulderY, 1.3, C.neck, C.headY];
  const ny = [0, f.ankleY, f.kneeY, lerp(f.kneeY, f.hipY, 0.45), f.hipY, f.waistY, f.chestY, f.shY, f.shTopY, f.neckBaseY + 0.045 * (f.H / 1.75), f.headY];
  const Y = (y: number) => pw(ty, ny, y);
  const newW = (y: number) => pwc([f.crotchY, f.hipY, f.waistY, f.chestY, f.shY, f.shTopY, f.neckBaseY + 0.03], [f.hipW, f.hipW * 0.98, f.waistW, f.chestW, f.chestW * 0.98, f.shX * 0.72, f.neckR], y);
  const newD = (y: number) => pwc([f.crotchY, f.hipY, f.waistY, f.chestY, f.shY, f.shTopY], [f.hipD, f.hipD, f.waistD + f.belly * 0.03, f.chestD + f.bust * 0.025, f.chestD * 0.85, f.neckR * 1.4], y);
  const oldD = (y: number) => pwc(OLD_T_Y, OLD_T_W, y) * 0.78;
  const hr = C.headR;
  const hx = f.headW / hr[0], hy = (f.headH * 0.5) / hr[1], hz = f.headD / hr[2];
  const armY = (y: number) => pw([C.wrist - 0.12, C.wrist, C.elbow, C.shoulderY, C.shoulderY + 0.1], [f.wristY - 0.12 * (f.handL / 0.1), f.wristY, f.elbowY, f.shY, f.shY + 0.1 * (f.uArmR / C.armR)], y);
  const armR = (y: number) => (y > C.elbow ? lerp(f.fArmR, f.uArmR, Math.min(1, (y - C.elbow) / (C.shoulderY - C.elbow))) : y > C.wrist ? lerp(f.wristR, f.fArmR, (y - C.wrist) / (C.elbow - C.wrist)) : f.handW) / (y > C.wrist ? 0.066 : 0.045);
  const legY = (y: number) => pw([0, C.ankle, C.knee, C.hip, C.hip + 0.1], [0, f.ankleY, f.kneeY, f.hipY, f.hipY + 0.1], y);
  const legR = (y: number) => (y > C.knee ? lerp(f.kneeR, f.thighR, (y - C.knee) / (C.hip - C.knee)) / pw([C.knee, C.hip], [0.07, 0.09], y)
    : y > C.ankle ? lerp(f.ankleR, f.calfR, Math.min(1, (y - C.ankle) / 0.25)) / 0.068 : f.footW / 0.072);
  return {
    y: Y,
    apply(region, p) {
      switch (region) {
        case 'leg': {
          const side = p.x < 0 ? -1 : 1, r = legR(p.y);
          const ny2 = legY(p.y);
          let z = p.z * r;
          if (p.y < C.ankle + 0.06) z = (p.z - 0.04) * (f.footL / 0.25) + 0.04 * (f.footL / 0.25); // the foot's length
          p.x = side * f.legX + (p.x - side * C.legX) * r; p.y = ny2; p.z = z;
          return;
        }
        case 'torso': case 'shoulder': {
          const yy = Math.min(p.y, C.neck + 0.03);
          const wx = region === 'shoulder' ? (f.shX + f.uArmR * 0.6) / (C.shoulderX + 0.02) : newW(Y(yy)) / pwc(OLD_T_Y, OLD_T_W, yy);
          const wz = region === 'shoulder' ? Math.max(f.chestD, f.uArmR * 2.2) / 0.15 : newD(Y(yy)) / oldD(yy);
          p.x *= wx; p.z *= wz; p.y = Y(p.y);
          return;
        }
        case 'arm': {
          const side = p.x < 0 ? -1 : 1, r = armR(p.y);
          const cx = side * C.shoulderX;
          p.x = side * f.shX + (p.x - cx) * r; p.z = p.z * r; p.y = armY(p.y);
          return;
        }
        case 'head': {
          p.x = p.x * hx; p.y = f.headY + (p.y - C.headY) * hy; p.z = f.headZ + (p.z - 0.01) * hz;
          return;
        }
      }
    },
  };
}

// ───────── colours ─────────
/** Rendered colours keep at least this much and at most this much lightness (HSL), so no character vanishes. */
export const LIGHTNESS = Object.freeze({ min: 0.06, max: 0.95 });

/** A 0xRRGGBB colour as a Color3 with its HSL lightness clamped to LIGHTNESS (exact when already inside). */
export function renderColour(rgb: number): Color3 {
  const r = ((rgb >> 16) & 255) / 255, g = ((rgb >> 8) & 255) / 255, b = (rgb & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), L = (mx + mn) / 2;
  if (L >= LIGHTNESS.min && L <= LIGHTNESS.max) return new Color3(r, g, b);
  const target = L < LIGHTNESS.min ? LIGHTNESS.min : LIGHTNESS.max;
  const d = mx - mn;
  const S = d === 0 ? 0 : d / (1 - Math.abs(2 * L - 1));
  let Hh = 0;
  if (d !== 0) {
    if (mx === r) Hh = ((g - b) / d) % 6; else if (mx === g) Hh = (b - r) / d + 2; else Hh = (r - g) / d + 4;
    Hh *= 60; if (Hh < 0) Hh += 360;
  }
  return hslToColor3(Hh, S, target);
}
export function hslToColor3(h: number, s: number, l: number): Color3 {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return new Color3(r + m, g + m, b + m);
}

export interface LookColours {
  skin: Color3; hair: Color3; hair2: Color3 | null; facial: Color3; brows: Color3; eyes: Color3; eyes2: Color3;
  paint: Color3; fur2: Color3 | null; lips: Color3 | null; shadow: Color3 | null; liner: Color3 | null;
}
const GREY_HAIR = new Color3(0.78, 0.77, 0.75);
/** The hair colour with its grey (0..4) mixed in. */
const greyed = (c: Color3, grey: number) => Color3.Lerp(c, GREY_HAIR, [0, 0.22, 0.45, 0.7, 0.92][grey] ?? 0);
/** The look's colours as rendered (skin is the fur's base colour for the Brindlekin; fur2 is the pattern's colour). */
export function lookColours(l: Look): LookColours {
  const h = l.hair, pal = (list: readonly { colour: number }[], i: number) => (i > 0 && list[i - 1] ? renderColour(list[i - 1]!.colour) : null);
  const hair = greyed(renderColour(h.colour), h.grey);
  const eyes = renderColour(l.eyes.colour);
  return {
    skin: renderColour(l.skin.colour), hair, hair2: h.colour2 === null ? null : greyed(renderColour(h.colour2), h.grey),
    facial: greyed(renderColour(h.facialColour), h.grey), brows: l.brows.colour === null ? hair : greyed(renderColour(l.brows.colour), Math.max(0, h.grey - 1)),
    eyes, eyes2: l.eyes.colour2 === null ? eyes : renderColour(l.eyes.colour2), paint: renderColour(l.paint.colour),
    fur2: l.fur ? renderColour(l.fur.colour) : null,
    lips: pal(LIP_COLOURS, l.makeup.lips), shadow: pal(SHADOW_COLOURS, l.makeup.shadow), liner: pal(LINER_COLOURS, l.makeup.liner),
  };
}

/** The hair style's model hints. */
export const hairInfo = (l: Look): HairStyleInfo => HAIR_STYLE_INFO[l.hair.style] ?? HAIR_STYLE_INFO[0]!;

// ───────── stance and walk (the pose layer) ─────────
export interface StanceParams { spine: number; chest: number; armOut: number; armFwd: number; shift: number; head: number; feet: number; bounce: number }
/** Easy, proud, guarded, sprightly: offsets on spine and arms and the weight shift, over the idle pose. */
export const STANCE: readonly StanceParams[] = Object.freeze([
  { spine: 0.02, chest: 0, armOut: 0, armFwd: 0, shift: 1, head: 0, feet: 0, bounce: 0 },
  { spine: -0.09, chest: -0.06, armOut: 0.06, armFwd: 0.12, shift: 0.4, head: -0.1, feet: 0.06, bounce: 0 },
  { spine: 0.12, chest: 0.06, armOut: -0.02, armFwd: -0.35, shift: 0.25, head: 0.08, feet: 0.12, bounce: 0 },
  { spine: -0.03, chest: 0, armOut: 0.12, armFwd: -0.05, shift: 0.7, head: -0.04, feet: 0.02, bounce: 1 },
]);
export interface WalkParams { stride: number; bounce: number; armSwing: number; cadence: number; lean: number; sway: number }
/** Stride, stroll, bounce, prowl: stride length, bounce and arm swing, over the run cycle. */
export const WALK: readonly WalkParams[] = Object.freeze([
  { stride: 1.1, bounce: 1, armSwing: 1, cadence: 1, lean: 1, sway: 1 },
  { stride: 0.82, bounce: 0.6, armSwing: 0.6, cadence: 0.9, lean: 0.5, sway: 1.6 },
  { stride: 0.95, bounce: 1.9, armSwing: 1.25, cadence: 1.12, lean: 0.8, sway: 0.7 },
  { stride: 1.0, bounce: 0.35, armSwing: 0.45, cadence: 0.95, lean: 1.9, sway: 0.4 },
]);
const pick = <T>(list: readonly T[], i: number): T => list[Math.max(0, Math.min(list.length - 1, i | 0))]!;
export const stanceParams = (l: Look): StanceParams => pick(STANCE, l.style.stance);
export const walkParams = (l: Look): WalkParams => pick(WALK, l.style.walk);

// ───────── everything the model is built from, as one comparable record ─────────
/** All the numbers and choices the model reads from a look (tests: every look field changes something here). */
export function modelParams(l: Look): Record<string, number | string | boolean | null> {
  const out: Record<string, number | string | boolean | null> = {};
  const put = (prefix: string, o: object) => {
    for (const [k, v] of Object.entries(o)) out[`${prefix}.${k}`] = v instanceof Color3 ? v.toHexString() : v === null ? null : (v as number);
  };
  put('body', bodyFrame(l)); put('face', faceParams(l)); put('colour', lookColours(l));
  put('stance', stanceParams(l)); put('walk', walkParams(l));
  out['hair.style'] = l.hair.style; out['hair.hairline'] = l.hair.hairline; out['hair.facial'] = l.hair.facial;
  out['skin.freckles'] = l.skin.freckles; out['skin.moles'] = l.skin.moles; out['skin.scar'] = l.skin.scar; out['skin.blush'] = l.skin.blush;
  out['paint.style'] = l.paint.style;
  out['fur.pattern'] = l.fur ? l.fur.pattern : null; out['fur.tail'] = l.fur ? l.fur.tail : null;
  out['outfit.dye1'] = l.outfit.dye1; out['outfit.dye2'] = l.outfit.dye2;
  return out;
}
