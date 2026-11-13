// Pure: an adventurer's `Look` (shared/src/look.ts) → what the model is built from: body proportions and the warp
// that fits the one canonical 1.8 m humanoid to them, face parts as numbers, part choices, colours (clamped so
// no character vanishes into the night or the sky), stance and walk. No Babylon scene: unit-tested on its own.
//
// The warp: the body is always built in the canonical human space (character.ts buildHuman, hair.ts, faces.ts and
// every weapon and job cue), then each vertex is moved by its region: the legs stretch with `limb`, the torso
// with `torso`, the head scales round the neck with `headScale`, arms ride out with the shoulders and thicken with
// `bulk`, hands and feet grow round the wrist and the ankle. Bones are the same points warped the same way, so the
// rig (and every animation) is shared by all four peoples. Then one uniform scale makes the skull's top the
// look's height. (`client/src/world/look.ts` is the render settings; this one is the adventurer's appearance.)
import { Color3 } from '@babylonjs/core';
import { ADVENTURER_RADIUS, PEOPLES, type Look as AdventurerLook, type PeopleId } from '@sg2/shared';

// ───────── the canonical humanoid (character.ts humanPivots) ─────────
/** Hip, neck, shoulder joint and wrist heights, the shoulder's half width and the skull's top, in m. */
export const CANON = Object.freeze({ hip: 0.88, neck: 1.33, shoulderY: 1.265, shoulderX: 0.235, wrist: 0.765, ankle: 0.1, top: 1.775, legX: 0.1, armR: 0.08 });
/** The widest half width an adventurer's body may take (inside the fixed gameplay hit radius, with a margin). */
export const MAX_HALF_WIDTH = ADVENTURER_RADIUS - 0.02;

export interface BodyParams {
  /** Standing height (skull top) in m. */
  height: number;
  /** Leg (and, less, arm) length factor over the canonical human. */
  limb: number;
  /** Shoulder width factor. */
  shoulder: number;
  /** Hip width factor. */
  hip: number;
  /** Head size factor (round the neck). */
  headScale: number;
  /** Girth of limbs and torso. */
  bulk: number;
  /** Ear length (Larchfolk: long and pointed) or size (the others). */
  earLen: number;
  /** Brindlekin: the tail (0..3: short, brush, long, ringed); null for the others. */
  tail: number | null;
  /** Brindlekin: the muzzle (face.nose 0..7); null for the others. */
  muzzle: number | null;
  /** Fur instead of skin. */
  fur: boolean;
  // ── beyond the brief's fields ──
  /** Torso length factor. */
  torso: number;
  /** Hand and foot size factors (the Knollfolk's broad hands and feet, the Brindlekin's pads). */
  hand: number;
  foot: number;
  /** The ear kind: 'round' (Humans, Knollfolk), 'pointed' (Larchfolk) or a Brindlekin ear (BRINDLE_EARS index). */
  ear: 'round' | 'pointed' | number;
  /** A width factor applied to every x and z so the widest build stays inside MAX_HALF_WIDTH (1: no squeeze). */
  fit: number;
}

interface PeopleShape { limb: number; torso: number; shoulder: number; hip: number; head: number; bulk: number; hand: number; foot: number }
/** Each people's proportions over the canonical human (the sliders move round these). */
export const PEOPLE_SHAPE: Readonly<Record<PeopleId, PeopleShape>> = Object.freeze({
  human: { limb: 1, torso: 1, shoulder: 1, hip: 1, head: 1, bulk: 1, hand: 1, foot: 1 },
  larchfolk: { limb: 1.13, torso: 1.05, shoulder: 0.86, hip: 0.88, head: 0.9, bulk: 0.82, hand: 1.02, foot: 1 },
  knollfolk: { limb: 0.78, torso: 0.9, shoulder: 1.16, hip: 1.14, head: 1.15, bulk: 1.2, hand: 1.32, foot: 1.34 },
  brindlekin: { limb: 0.98, torso: 1.0, shoulder: 1.06, hip: 0.96, head: 1.02, bulk: 1.04, hand: 1.18, foot: 1.12 },
});
const EAR_LEN: Readonly<Record<PeopleId, readonly number[]>> = Object.freeze({
  human: [0.82, 1, 1.16, 1.32], larchfolk: [1.7, 2.25, 2.8, 3.4], knollfolk: [1.25, 1.42, 1.6, 1.8], brindlekin: [1, 1, 1, 1, 1, 1],
});

const u = (v: number) => (Math.max(0, Math.min(20, v)) - 10) / 10;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The model's proportions for a look (every body slider and the people). */
export function bodyParams(l: AdventurerLook): BodyParams {
  const p = PEOPLES[l.people], sh = PEOPLE_SHAPE[l.people], b = l.body;
  const bp: BodyParams = {
    height: p.heightM * (1 + p.span * u(b.height)),
    limb: sh.limb * (1 + 0.1 * u(b.legs)),
    torso: sh.torso * (1 - 0.05 * u(b.legs)),
    shoulder: sh.shoulder * (1 + 0.14 * u(b.shoulders)),
    hip: sh.hip * (1 + 0.16 * u(b.hips)),
    headScale: sh.head * (1 + 0.1 * u(b.head)),
    bulk: sh.bulk * (1 + 0.2 * u(b.build)),
    hand: sh.hand * (1 + 0.06 * u(b.build)),
    foot: sh.foot,
    earLen: EAR_LEN[l.people][Math.min(EAR_LEN[l.people].length - 1, Math.max(0, l.face.ears))]!,
    ear: l.people === 'brindlekin' ? l.face.ears : l.people === 'larchfolk' ? 'pointed' : 'round',
    tail: l.fur ? l.fur.tail : null,
    muzzle: p.furred ? l.face.nose : null,
    fur: p.furred,
    fit: 1,
  };
  const w = rawHalfWidth(bp);
  if (w > MAX_HALF_WIDTH) bp.fit = MAX_HALF_WIDTH / w;
  return bp;
}

// ───────── the warp ─────────
export type WarpRegion = 'leg' | 'torso' | 'arm' | 'head' | 'shoulder';
export interface Warp {
  /** The uniform scale after the warp that makes the skull's top `height`. */
  readonly s: number;
  /** Moves a canonical point (m) of a region in place (before the uniform scale). */
  apply(region: WarpRegion, p: { x: number; y: number; z: number }): void;
  /** The warped height (before `s`) of a canonical height, on the body's centre line. */
  y(y: number): number;
}

/** The warp of the canonical body to these proportions (pure numbers: character.ts applies it per vertex and per bone). */
export function makeWarp(bp: BodyParams): Warp {
  const { hip: HIP, neck: NECK, shoulderY: SY, shoulderX: SX, wrist: WR, ankle: AN, legX: LX } = CANON;
  const legK = bp.limb, torsoK = bp.torso, headK = bp.headScale, fit = bp.fit;
  const bulkL = lerp(1, bp.bulk, 0.85), bulkA = lerp(1, bp.bulk, 0.8), bulkZ = Math.pow(bp.bulk, 0.85);
  const armK = lerp(1, bp.limb, 0.6) * Math.sqrt(torsoK);
  // the shoulder joints ride at least as far out as the chest is wide (so thick arms never sink into a broad torso)
  const shoulderX = Math.max(bp.shoulder * lerp(1, bp.bulk, 0.45), lerp(1, bp.shoulder, 0.85) * bp.bulk);
  const Y = (y: number) => (y < HIP ? y * legK : HIP * legK + (y - HIP) * torsoK);
  const neckY = Y(NECK);
  /** Torso width by height: the hips' up to the waist, blending to the shoulders' over the chest. */
  const torsoW = (y: number) => {
    const t = Math.max(0, Math.min(1, (y - 0.95) / 0.25));
    return lerp(bp.hip, lerp(1, bp.shoulder, 0.85), t) * bp.bulk;
  };
  const shoulderY = Y(SY);
  const top = neckY + (CANON.top - NECK) * headK;
  const s = bp.height / top;
  return {
    s,
    y: Y,
    apply(region, p) {
      switch (region) {
        case 'leg': {
          const side = p.x < 0 ? -1 : 1;
          let x = side * LX * bp.hip + (p.x - side * LX) * bulkL, z = p.z * bulkL, y = p.y * legK;
          if (p.y < AN + 0.08) { // the foot grows round the ankle (its sole stays on the ground), blended over 8 cm
            const t = Math.min(1, (AN + 0.08 - p.y) / 0.08), f = lerp(1, bp.foot, t), cx = side * LX * bp.hip, cz = 0.04 * bulkL;
            x = cx + (x - cx) * f; z = cz + (z - cz) * f; y = lerp(p.y * legK, p.y * Math.sqrt(bp.foot), t);
          }
          p.x = x * fit; p.y = y; p.z = z * fit;
          return;
        }
        case 'torso': case 'shoulder': {
          const w = region === 'shoulder' ? shoulderX : torsoW(p.y);
          p.x *= w * fit; p.z *= bulkZ * fit; p.y = Y(p.y);
          return;
        }
        case 'arm': {
          const side = p.x < 0 ? -1 : 1;
          let x = side * SX * shoulderX + (p.x - side * SX) * bulkA, y = shoulderY - (SY - p.y) * armK, z = p.z * bulkA;
          if (p.y < WR + 0.03) { // the hand grows round the wrist (blended over 3 cm)
            const f = lerp(1, bp.hand, Math.min(1, (WR + 0.03 - p.y) / 0.03)), cx = side * SX * shoulderX, cy = shoulderY - (SY - WR) * armK, cz = 0.01;
            x = cx + (x - cx) * f; y = cy + (y - cy) * f; z = cz + (z - cz) * f;
          }
          p.x = x * fit; p.y = y; p.z = z * fit;
          return;
        }
        case 'head': {
          p.x = p.x * headK * fit; p.y = neckY + (p.y - NECK) * headK; p.z = p.z * headK * fit;
          return;
        }
      }
    },
  };
}

/** The widest half width of the body (m, after the uniform scale), before any `fit`. */
function rawHalfWidth(bp: BodyParams): number {
  const w = makeWarp({ ...bp, fit: 1 });
  const arm = { x: CANON.shoulderX + CANON.armR, y: CANON.shoulderY - 0.05, z: 0 };
  w.apply('arm', arm);
  const hipP = { x: 0.24, y: 0.66, z: 0 }; // the tunic's flared hem
  w.apply('torso', hipP);
  const head = { x: 0.215, y: 1.6, z: 0 };
  w.apply('head', head);
  return w.s * Math.max(arm.x, hipP.x, head.x);
}

/** The widest half width of the built body (m): never over MAX_HALF_WIDTH. */
export const halfWidth = (bp: BodyParams): number => rawHalfWidth(bp) * bp.fit;

// ───────── colours ─────────
/** Rendered colours keep at least this much and at most this much lightness (HSL), so no character vanishes. */
export const LIGHTNESS = Object.freeze({ min: 0.06, max: 0.95 });

/** A 0xRRGGBB colour as a Color3 with its HSL lightness clamped to LIGHTNESS (exact when already inside). */
export function renderColour(rgb: number): Color3 {
  const r = ((rgb >> 16) & 255) / 255, g = ((rgb >> 8) & 255) / 255, b = (rgb & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), L = (mx + mn) / 2;
  if (L >= LIGHTNESS.min && L <= LIGHTNESS.max) return new Color3(r, g, b);
  // move lightness only, keeping hue and saturation
  const target = L < LIGHTNESS.min ? LIGHTNESS.min : LIGHTNESS.max;
  const d = mx - mn;
  const S = d === 0 ? 0 : d / (1 - Math.abs(2 * L - 1));
  let H = 0;
  if (d !== 0) {
    if (mx === r) H = ((g - b) / d) % 6; else if (mx === g) H = (b - r) / d + 2; else H = (r - g) / d + 4;
    H *= 60; if (H < 0) H += 360;
  }
  return hslToColor3(H, S, target);
}
export function hslToColor3(h: number, s: number, l: number): Color3 {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return new Color3(r + m, g + m, b + m);
}

export interface LookColours { skin: Color3; hair: Color3; facial: Color3; eyes: Color3; marks: Color3; fur2: Color3 | null }
/** The look's free colours as rendered (skin is the fur's base for the Brindlekin; fur2 is the pattern's colour). */
export function lookColours(l: AdventurerLook): LookColours {
  const c = l.colours;
  return {
    skin: renderColour(c.skin), hair: renderColour(c.hair), facial: renderColour(c.facial), eyes: renderColour(c.eyes),
    marks: renderColour(c.marks), fur2: l.fur ? renderColour(l.fur.colour) : null,
  };
}

// ───────── the face as numbers (faces.ts builds them) ─────────
export interface FaceParams {
  /** Head shape: widths at the brow and jaw, the chin's point, the head's length, the boxiness. */
  topW: number; jawW: number; chin: number; len: number; power: number;
  /** Eyes: half sizes, tilt (rad), the lid's cover (0 none, 1 half closed), the gap between them. */
  eyeW: number; eyeH: number; eyeTilt: number; lid: number; eyeGap: number;
  /** Brows: thickness (0 none), arch, tilt (rad, + = inner end up). */
  browT: number; browArch: number; browTilt: number;
  /** Nose (or the muzzle): size, length forward, width, the tip turned up. */
  noseS: number; noseLen: number; noseW: number; noseUp: number;
  /** Mouth: half width, curve (+ smile, − frown), lip fullness. */
  mouthW: number; mouthCurve: number; lip: number;
  /** Marks: FACE_MARKS index (0 none). */
  marks: number;
}
const SHAPES = [ // round, oval, square, heart, long, soft
  { topW: 1.04, jawW: 1.0, chin: 0.02, len: 0.95, power: 1 },
  { topW: 1.0, jawW: 0.86, chin: 0.06, len: 1.03, power: 1 },
  { topW: 1.02, jawW: 1.04, chin: 0.0, len: 1.0, power: 0.72 },
  { topW: 1.08, jawW: 0.74, chin: 0.12, len: 1.0, power: 1 },
  { topW: 0.94, jawW: 0.84, chin: 0.07, len: 1.13, power: 0.92 },
  { topW: 1.02, jawW: 0.96, chin: 0.0, len: 0.98, power: 1.12 },
];
const EYES = [ // round … narrow, with lids
  { eyeW: 0.034, eyeH: 0.05, eyeTilt: 0, lid: 0, eyeGap: 0.072 },
  { eyeW: 0.032, eyeH: 0.044, eyeTilt: 0.12, lid: 0, eyeGap: 0.074 },
  { eyeW: 0.036, eyeH: 0.04, eyeTilt: -0.1, lid: 0.25, eyeGap: 0.07 },
  { eyeW: 0.038, eyeH: 0.034, eyeTilt: 0.22, lid: 0.15, eyeGap: 0.075 },
  { eyeW: 0.03, eyeH: 0.046, eyeTilt: 0, lid: 0.45, eyeGap: 0.068 },
  { eyeW: 0.04, eyeH: 0.028, eyeTilt: 0.05, lid: 0.3, eyeGap: 0.078 },
  { eyeW: 0.042, eyeH: 0.022, eyeTilt: 0.3, lid: 0.2, eyeGap: 0.076 },
  { eyeW: 0.04, eyeH: 0.02, eyeTilt: -0.05, lid: 0.55, eyeGap: 0.074 },
];
const BROWS = [ // none … heavy, flat … arched
  { browT: 0, browArch: 0, browTilt: 0 },
  { browT: 0.006, browArch: 0.006, browTilt: 0 },
  { browT: 0.009, browArch: 0.0, browTilt: 0.12 },
  { browT: 0.01, browArch: 0.016, browTilt: 0 },
  { browT: 0.013, browArch: 0.004, browTilt: -0.15 },
  { browT: 0.014, browArch: 0.022, browTilt: 0.05 },
  { browT: 0.018, browArch: 0.002, browTilt: 0 },
  { browT: 0.022, browArch: 0.012, browTilt: -0.08 },
];
const NOSES = [ // button … long (the Brindlekin: the muzzle's shape)
  { noseS: 0.75, noseLen: 0.7, noseW: 1.0, noseUp: 0.5 },
  { noseS: 0.9, noseLen: 0.85, noseW: 1.0, noseUp: 0.2 },
  { noseS: 1.0, noseLen: 1.0, noseW: 0.9, noseUp: 0 },
  { noseS: 1.05, noseLen: 1.1, noseW: 1.25, noseUp: -0.1 },
  { noseS: 1.0, noseLen: 1.3, noseW: 0.85, noseUp: -0.25 },
  { noseS: 1.2, noseLen: 1.15, noseW: 1.1, noseUp: 0.1 },
  { noseS: 1.1, noseLen: 1.5, noseW: 0.8, noseUp: -0.4 },
  { noseS: 1.3, noseLen: 1.7, noseW: 1.0, noseUp: -0.15 },
];
const MOUTHS = [
  { mouthW: 0.037, mouthCurve: 0.07, lip: 0.0075 },
  { mouthW: 0.045, mouthCurve: 0.02, lip: 0.007 },
  { mouthW: 0.03, mouthCurve: 0.0, lip: 0.011 },
  { mouthW: 0.05, mouthCurve: 0.12, lip: 0.008 },
  { mouthW: 0.04, mouthCurve: -0.05, lip: 0.009 },
  { mouthW: 0.034, mouthCurve: 0.04, lip: 0.014 },
];
const pick = <T>(list: readonly T[], i: number): T => list[Math.max(0, Math.min(list.length - 1, i | 0))]!;
export function faceParams(l: AdventurerLook): FaceParams {
  const f = l.face;
  return { ...pick(SHAPES, f.shape), ...pick(EYES, f.eyes), ...pick(BROWS, f.brows), ...pick(NOSES, f.nose), ...pick(MOUTHS, f.mouth), marks: f.marks };
}

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
export const stanceParams = (l: AdventurerLook): StanceParams => pick(STANCE, l.style.stance);
export const walkParams = (l: AdventurerLook): WalkParams => pick(WALK, l.style.walk);

// ───────── everything the model is built from, as one comparable record ─────────
/** All the numbers and choices the model reads from a look (tests: every look field changes something here). */
export function modelParams(l: AdventurerLook): Record<string, number | string | null | boolean> {
  const out: Record<string, number | string | null | boolean> = {};
  const put = (prefix: string, o: object) => { for (const [k, v] of Object.entries(o)) out[`${prefix}.${k}`] = v instanceof Color3 ? v.toHexString() : (v as number); };
  put('body', bodyParams(l)); put('face', faceParams(l)); put('colour', lookColours(l));
  put('stance', stanceParams(l)); put('walk', walkParams(l));
  out['hair.style'] = l.hair.style; out['hair.facial'] = l.hair.facial;
  out['fur.pattern'] = l.fur ? l.fur.pattern : null;
  out['outfit.dye1'] = l.outfit.dye1; out['outfit.dye2'] = l.outfit.dye2;
  return out;
}
