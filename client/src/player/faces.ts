// The look-driven head, built in code into the adventurer's one skinned mesh: six head shapes, eight eyes (on the
// `eyes` bone, so they blink, with lids), eight brows, eight noses or Brindlekin muzzles, six mouths, the ears of
// each people (round, long and pointed, or one of six animal ears), eight marks, fur patterns painted per vertex,
// padded paws and the Brindlekin's tail on its own two bones. All in the canonical human space: the look's warp
// (look.ts makeWarp) fits it to the body. Colours come from look.ts lookColours (lightness-clamped).
import { Color3, Vector3 } from '@babylonjs/core';
import type { FaceParams, LookColours } from './look';
import type { Paint, ShapeKit, V3 } from './character';

const mix = (a: Color3, b: Color3, t: number) => Color3.Lerp(a, b, t);
const shade = (c: Color3, f: number) => new Color3(Math.min(1, c.r * f), Math.min(1, c.g * f), Math.min(1, c.b * f));
const INK = new Color3(0.07, 0.06, 0.09);
const WHITE = new Color3(0.98, 0.97, 0.94);
const PINK = new Color3(0.86, 0.55, 0.55);

/** The head's centre height and its radii (canonical, as character.ts buildHuman built it). */
export const HY = 1.565;
export const HEAD_R: V3 = [0.195, 0.205, 0.185];
const HEAD_C: V3 = [0, HY, 0.01];

const sp = (x: number, pw: number) => Math.sign(x) * Math.pow(Math.abs(x), pw);

/** The head shape's deformation in unit-sphere space (z forward). */
export function headDeform(fp: FaceParams): (l: Vector3) => void {
  return (l) => {
    if (l.y < 0) {
      const t = -l.y;
      l.x *= 1 - (1 - fp.jawW) * t;
      l.z *= 1 - 0.05 * t;
      l.z += 0.06 * t * Math.max(0, l.z);
      l.y -= fp.chin * t * t * Math.max(0, l.z);
    } else {
      l.x *= 1 + (fp.topW - 1) * l.y;
    }
    if (l.y > 0.2) l.z *= 1 - 0.06 * (l.y - 0.2);
    l.y *= fp.len;
  };
}

/** A point on the head's surface (canonical m) seen from the front at unit-sphere (lx, ly), lifted `out` m off it. */
export function headPoint(fp: FaceParams, lx: number, ly: number, out = 0.004): V3 {
  const lz = Math.sqrt(Math.max(0, 1 - lx * lx - ly * ly));
  const l = new Vector3(sp(lx, fp.power), sp(ly, fp.power), sp(lz, fp.power));
  headDeform(fp)(l);
  const n = new Vector3(lx, ly, lz).normalize();
  return [HEAD_C[0] + l.x * HEAD_R[0] + n.x * out, HEAD_C[1] + l.y * HEAD_R[1] + n.y * out, HEAD_C[2] + l.z * HEAD_R[2] + n.z * out];
}

/** Brindlekin fur: the pattern (FUR_PATTERNS: solid, striped, spotted, masked) painted per vertex by position. */
export function furPaint(base: Color3, fur2: Color3, pattern: number): Paint {
  return (w) => {
    if (pattern === 1) {
      const v = Math.sin(w.y * 36 + Math.sin(w.x * 11 + w.z * 7) * 1.6);
      return v > 0.5 ? mix(base, fur2, 0.9) : base;
    }
    if (pattern === 2) {
      const cx = Math.floor(w.x * 16), cy = Math.floor(w.y * 16), cz = Math.floor(w.z * 16);
      const h = Math.sin(cx * 12.9898 + cy * 78.233 + cz * 37.719) * 43758.5453;
      return h - Math.floor(h) < 0.24 ? mix(base, fur2, 0.92) : base;
    }
    return base;
  };
}

export interface HeadOpts {
  fp: FaceParams;
  col: LookColours;
  /** Brindlekin: the fur pattern; null for skin. */
  furPattern: number | null;
  /** 'round' | 'pointed' or a BRINDLE_EARS index, and the ear length. */
  ear: 'round' | 'pointed' | number;
  earLen: number;
  /** FACIAL_HAIR index (stubble and sideburns are painted here; the rest are hair.ts geometry). */
  facial: number;
  /** Larchfolk: bark flecks on the skin. */
  bark: boolean;
  /** Level of detail (1 high): small details are dropped below 0.5. */
  detail: number;
}

/** The head: skull, face, ears and marks, on the `head` and `eyes` bones. */
export function buildHead(k: ShapeKit, o: HeadOpts): void {
  const { fp, col } = o;
  const skin = col.skin, furred = o.furPattern !== null;
  const fur2 = col.fur2 ?? shade(skin, 0.6);
  const blush = mix(mix(skin, PINK, 0.5), new Color3(0.8, 0.4, 0.38), 0.25);
  const body = furred ? furPaint(skin, fur2, o.furPattern!) : null;
  const facial = col.facial;
  const paint: Paint = (w, uv, l) => {
    let c = skin;
    if (body) c = body(w, uv, l) ?? skin;
    if (furred && o.furPattern === 3 && l.z > 0.25 && Math.abs(l.y - 0.08) < 0.2 && Math.abs(l.x) < 0.85) c = mix(c, fur2, 0.92); // the mask
    if (!furred) {
      const cheek = Math.exp(-(((Math.abs(l.x) - 0.55) ** 2) / 0.03 + ((l.y + 0.28) ** 2) / 0.02)) * (l.z > 0.3 ? 1 : 0);
      c = mix(c, blush, Math.min(0.5, cheek));
      if (l.y > 0.4) c = mix(c, shade(c, 1.06), l.y - 0.4);
      if (o.bark && l.z < 0.6 && Math.sin(l.x * 40 + l.y * 6) > 0.86 && l.y < 0.45) c = shade(c, 0.86);
    }
    // stubble over the jaw and the upper lip; sideburns in front of the ears
    if (o.facial === 1 && l.y < -0.12 && l.z > -0.1) c = mix(c, facial, 0.45);
    if (o.facial === 6 && Math.abs(l.x) > 0.78 && l.y < 0.2 && l.y > -0.55 && l.z > -0.2) c = mix(c, facial, 0.9);
    // marks that are areas: cheek bands (4) and brow paint (7)
    if (fp.marks === 4 && l.z > 0.2 && Math.abs(l.x) > 0.42 && Math.abs(l.x) < 0.85 && (Math.abs(l.y + 0.12) < 0.05 || Math.abs(l.y + 0.27) < 0.05)) c = col.marks;
    if (fp.marks === 7 && l.z > 0.3 && l.y > 0.12 && l.y < 0.3) c = mix(c, col.marks, 0.9);
    return c;
  };
  const seg = 18, lat = 12;
  k.ellip('head', HEAD_C, HEAD_R, skin, { seg, lat, paint, power: fp.power, deform: headDeform(fp) });

  // ── ears ──
  const earCol = furred ? shade(skin, 0.97) : shade(skin, 0.96);
  const inner = furred ? mix(fur2, PINK, 0.35) : mix(skin, PINK, 0.3);
  if (o.ear === 'round') {
    const e = o.earLen;
    for (const sx of [-1, 1]) k.ellip('head', [sx * (0.19 + 0.008 * (e - 1)), HY - 0.02, -0.01], [0.03 * Math.sqrt(e), 0.05 * e, 0.036 * e], earCol,
      { seg: 8, lat: 5, rot: [0, sx * 0.3, sx * -0.15], noOcc: true, paint: (_w, _uv, l) => (l.x * sx < -0.3 && Math.abs(l.y) < 0.6 ? inner : undefined) });
  } else if (o.ear === 'pointed') {
    // Larchfolk: long leaf ears sweeping back and up from the side of the head (earLen picks the length)
    const L = 0.07 * o.earLen;
    for (const sx of [-1, 1]) {
      k.tube('head', [[sx * 0.18, HY - 0.035, 0.0], [sx * (0.2 + L * 0.35), HY + L * 0.22, -0.03 - L * 0.2], [sx * (0.2 + L * 0.7), HY + L * 0.5, -0.05 - L * 0.42], [sx * (0.2 + L * 0.95), HY + L * 0.78, -0.07 - L * 0.55]],
        [0.04, 0.034, 0.02, 0.003], earCol, { seg: 6, flatten: 0.42, noOcc: true });
    }
  } else {
    buildAnimalEars(k, o.ear, earCol, inner, fur2, col.hair, o.fp);
  }

  // ── eyes (on the eyes bone: they blink), with eye colour, a pupil, a glint and lids ──
  const eyeCol = shade(col.eyes, 0.9);
  for (const sx of [-1, 1]) {
    const [x, y, z] = headPoint(fp, (sx * fp.eyeGap) / HEAD_R[0], -0.02, -0.012);
    const rot: V3 = [-0.15, sx * 0.28, sx * fp.eyeTilt];
    k.ellip('eyes', [x, y, z], [fp.eyeW, fp.eyeH, 0.018], eyeCol, { seg: 10, lat: 6, noOcc: true, rot });
    if (o.detail >= 0.5) k.ellip('eyes', [x + sx * 0.002, y - 0.002, z + 0.012], [fp.eyeW * 0.5, Math.min(fp.eyeH, fp.eyeW) * 0.62, 0.008], INK, { seg: 6, lat: 4, noOcc: true, rot });
    k.ellip('eyes', [x + 0.011, y + Math.min(0.014, fp.eyeH * 0.3), z + 0.018], [0.009, 0.009, 0.005], WHITE, { seg: 4, lat: 3, noOcc: true });
    if (fp.lid > 0) {
      // the upper lid: skin closing over the top of the eye
      k.ellip('eyes', [x, y + fp.eyeH * (1.05 - fp.lid), z + 0.004], [fp.eyeW * 1.2, fp.eyeH * 0.75, 0.021], shade(skin, 0.92),
        { seg: 8, lat: 4, noOcc: true, rot, deform: (l) => { if (l.y < 0) l.y *= 0.35; } });
    }
    // brow: thickness, arch and tilt
    if (fp.browT > 0) {
      const by = HY + 0.062 + fp.eyeH - 0.046;
      const a = headPoint(fp, (sx * (fp.eyeGap - 0.034)) / HEAD_R[0], (by - HY + fp.browTilt * 0.03) / HEAD_R[1], 0.006);
      const m = headPoint(fp, (sx * fp.eyeGap) / HEAD_R[0], (by - HY + fp.browArch + 0.008) / HEAD_R[1], 0.006);
      const b = headPoint(fp, (sx * (fp.eyeGap + 0.034)) / HEAD_R[0], (by - HY - fp.browTilt * 0.02) / HEAD_R[1], 0.004);
      k.tube('head', [a, m, b], [fp.browT, fp.browT * 1.05, fp.browT * 0.7], col.facial, { seg: 5, noOcc: true, flatten: 0.6 });
    }
  }

  // ── nose or muzzle, mouth ──
  if (furred) buildMuzzle(k, o, fur2);
  else {
    const ns = fp.noseS, tip = headPoint(fp, 0, -0.22 + fp.noseUp * 0.04, 0.0);
    k.ellip('head', [0, tip[1], tip[2] + 0.004 + (fp.noseLen - 1) * 0.012], [0.03 * ns * fp.noseW, 0.026 * ns, 0.026 * ns * fp.noseLen], shade(skin, 0.97),
      { seg: 8, lat: 5, noOcc: true, deform: (l) => { if (l.z > 0.3) l.y -= fp.noseUp < 0 ? -fp.noseUp * 0.25 * l.z : 0; } });
    if (fp.noseLen > 1.2) {
      const top = headPoint(fp, 0, 0.0, 0.0);
      k.tube('head', [top, [0, tip[1] + 0.012, tip[2] + 0.01]], [0.012, 0.018], shade(skin, 0.97), { seg: 5, noOcc: true });
    }
    const lipC = mix(shade(skin, 0.72), new Color3(0.62, 0.28, 0.3), 0.35);
    const smile: V3[] = [];
    for (let i = 0; i <= 4; i++) {
      const t = i / 4 - 0.5;
      const p = headPoint(fp, (t * 2 * fp.mouthW) / HEAD_R[0], -0.5 + t * t * fp.mouthCurve * 4, -0.004);
      smile.push(p);
    }
    k.tube('head', smile, fp.lip, lipC, { seg: 5, noOcc: true });
  }

  // ── marks as small geometry ──
  buildMarks(k, o);
}

function dot(k: ShapeKit, fp: FaceParams, lx: number, ly: number, r: number, c: Color3) {
  k.ellip('head', headPoint(fp, lx, ly, 0.001), [r, r, r * 0.4], c, { seg: 4, lat: 3, noOcc: true, flat: true });
}

function buildMarks(k: ShapeKit, o: HeadOpts) {
  const { fp, col } = o, m = fp.marks;
  const mc = col.marks;
  if (m === 1) {
    // freckles across the nose and cheeks
    const spots: [number, number][] = [[-0.3, -0.2], [-0.42, -0.26], [-0.36, -0.33], [-0.52, -0.18], [0.3, -0.2], [0.42, -0.26], [0.36, -0.33], [0.52, -0.18], [-0.12, -0.12], [0.12, -0.12]];
    for (const [x, y] of spots.slice(0, o.detail >= 0.5 ? spots.length : 6)) dot(k, fp, x, y, 0.0085, mix(col.skin, mc, 0.8));
  } else if (m === 2 || m === 3) {
    // a scar over one eye, from the brow down onto the cheek (2: the left, 3: the right)
    const sx = m === 2 ? -1 : 1;
    const pts: V3[] = [headPoint(fp, sx * 0.24, 0.36, 0.004), headPoint(fp, sx * 0.36, 0.05, 0.005), headPoint(fp, sx * 0.46, -0.28, 0.004)];
    k.tube('head', pts, [0.005, 0.009, 0.004], mc, { seg: 4, noOcc: true, flatten: 0.5 });
  } else if (m === 5) {
    dot(k, fp, 0.3, -0.42, 0.011, mc);
  } else if (m === 6) {
    // dot tattoos: three down the forehead, two under each eye
    for (const y of [0.62, 0.52, 0.42]) dot(k, fp, 0, y, 0.01, mc);
    for (const sx of [-1, 1]) for (const x of [0.32, 0.44]) dot(k, fp, sx * x, -0.2, 0.009, mc);
  }
}

/** The Brindlekin's muzzle (face.nose picks its length, width and the nose's tilt), its nose and mouth. */
function buildMuzzle(k: ShapeKit, o: HeadOpts, fur2: Color3) {
  const { fp, col } = o;
  const light = o.furPattern === 3 ? mix(col.skin, WHITE, 0.5) : mix(col.skin, WHITE, 0.3);
  const len = 0.07 + 0.05 * fp.noseLen, wid = 0.09 * fp.noseW * (0.9 + 0.1 * fp.noseS), hgt = 0.07 * fp.noseS;
  const base = headPoint(fp, 0, -0.3, -0.03);
  const c: V3 = [0, base[1] + fp.noseUp * 0.01, base[2] + len * 0.55];
  k.ellip('head', c, [wid, hgt, len], light, { seg: 12, lat: 7, deform: (l) => { if (l.y < 0) l.y *= 0.8; if (l.z > 0) l.y += 0.12 * l.z * fp.noseUp; } });
  // the nose pad at the tip, and the mouth under it
  k.ellip('head', [0, c[1] + hgt * 0.45, c[2] + len * 0.92], [0.032 * fp.noseW, 0.022, 0.02], shade(mix(fur2, INK, 0.6), 0.8), { seg: 8, lat: 4, noOcc: true });
  const m: V3[] = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4 - 0.5;
    m.push([t * wid * 1.3, c[1] - hgt * 0.42 + Math.abs(t) * 0.02 + t * t * fp.mouthCurve * 0.2, c[2] + len * 0.72 - t * t * 0.08]);
  }
  k.tube('head', m, Math.max(0.005, fp.lip * 0.8), shade(fur2, 0.5), { seg: 4, noOcc: true });
  // whisker pads
  if (o.detail >= 0.5) for (const sx of [-1, 1]) k.ellip('head', [sx * wid * 0.5, c[1] - hgt * 0.1, c[2] + len * 0.5], [wid * 0.42, hgt * 0.5, len * 0.5], light, { seg: 6, lat: 4, noOcc: true });
}

/** BRINDLE_EARS: pointed, round, long, folded, tufted, lop. On top of the head (the lop hangs at the sides). */
function buildAnimalEars(k: ShapeKit, kind: number, col: Color3, inner: Color3, fur2: Color3, tuft: Color3, fp: FaceParams) {
  for (const sx of [-1, 1]) {
    const root = headPoint(fp, sx * 0.55, 0.72, -0.01);
    const [x, y, z] = [root[0], root[1], root[2] - 0.05];
    const E = 1.35; // animal ears are big: they are what reads first at a distance
    const innerPaint: Paint = (_w, uv) => (uv[0] > 0.3 && uv[0] < 0.7 ? inner : undefined);
    switch (kind) {
      case 0: // pointed (fox, cat)
        k.tube('head', [[x, y - 0.02, z], [x + sx * 0.035 * E, y + 0.07 * E, z - 0.005], [x + sx * 0.05 * E, y + 0.15 * E, z - 0.01]], [0.06 * E, 0.035 * E, 0.002], col, { seg: 6, flatten: 0.45, noOcc: true, paint: innerPaint });
        break;
      case 1: // round (bear)
        k.ellip('head', [x + sx * 0.03, y + 0.04, z], [0.06 * E, 0.055 * E, 0.032], col, { seg: 10, lat: 6, noOcc: true, paint: (_w, _uv, l) => (l.z > 0.4 ? inner : undefined) });
        break;
      case 2: // long (hare)
        k.tube('head', [[x, y - 0.02, z], [x + sx * 0.02, y + 0.12, z - 0.02], [x + sx * 0.04, y + 0.25, z - 0.04], [x + sx * 0.05, y + 0.32, z - 0.05]], [0.04, 0.045, 0.035, 0.006], col, { seg: 6, flatten: 0.45, noOcc: true, paint: innerPaint });
        break;
      case 3: // folded (the tips fall forward)
        k.tube('head', [[x, y - 0.02, z], [x + sx * 0.03 * E, y + 0.09 * E, z - 0.005], [x + sx * 0.05 * E, y + 0.11 * E, z + 0.05], [x + sx * 0.06 * E, y + 0.06 * E, z + 0.1]], [0.055 * E, 0.042 * E, 0.03 * E, 0.006], col, { seg: 6, flatten: 0.45, noOcc: true });
        break;
      case 4: // tufted (lynx): pointed, with a dark tuft
        k.tube('head', [[x, y - 0.02, z], [x + sx * 0.04 * E, y + 0.08 * E, z - 0.005], [x + sx * 0.06 * E, y + 0.16 * E, z - 0.01]], [0.058 * E, 0.03 * E, 0.006], col, { seg: 6, flatten: 0.45, noOcc: true, paint: innerPaint });
        k.tube('head', [[x + sx * 0.06 * E, y + 0.15 * E, z - 0.01], [x + sx * 0.07 * E, y + 0.25 * E, z - 0.015]], [0.012, 0.002], mix(tuft, fur2, 0.5), { seg: 4, noOcc: true });
        break;
      default: { // lop: long ears hanging down the sides
        const s = headPoint(fp, sx * 0.85, 0.35, 0.0);
        k.tube('head', [[s[0], s[1], s[2] - 0.04], [s[0] + sx * 0.05, s[1] - 0.06, s[2] - 0.04], [s[0] + sx * 0.06, s[1] - 0.18, s[2] - 0.03], [s[0] + sx * 0.05, s[1] - 0.26, s[2] - 0.02]], [0.045, 0.055, 0.05, 0.02], col, { seg: 6, flatten: 0.4, noOcc: true });
      }
    }
  }
}

/** TAILS: short, brush, long, ringed; on the tailA and tailB bones (spring-driven), from the small of the back. */
export function buildTail(k: ShapeKit, tail: number, base: Color3, fur2: Color3, pattern: number): void {
  const body = furPaint(base, fur2, pattern);
  if (tail === 0) {
    // a bobtail peeking out under the cape's hem
    k.ellip('tailA', [0, 0.68, -0.36], [0.075, 0.075, 0.08], base, { seg: 8, lat: 5, paint: body });
    return;
  }
  const ring: Paint = (_w, uv) => (Math.floor(uv[1] * 9) % 2 ? fur2 : base);
  const tipLight: Paint = (w, uv, l) => (uv[1] > 0.8 ? mix(fur2, WHITE, 0.45) : body(w, uv, l));
  // from the small of the back, down past the cape's hem, then curling up beside the right leg (it shows from the front too)
  const rA = tail === 2 ? [0.035, 0.03, 0.028] : tail === 1 ? [0.045, 0.065, 0.08] : [0.045, 0.05, 0.052];
  k.tube('tailA', [[0, 0.9, -0.13], [0.03, 0.74, -0.33], [0.1, 0.58, -0.44]], rA, base, { seg: 7, paint: tail === 3 ? ring : body });
  if (tail === 1) k.tube('tailB', [[0.1, 0.58, -0.44], [0.2, 0.58, -0.56], [0.3, 0.75, -0.6], [0.34, 0.95, -0.52], [0.33, 1.06, -0.45]], [0.08, 0.1, 0.1, 0.075, 0.012], base, { seg: 8, paint: tipLight });
  else if (tail === 2) k.tube('tailB', [[0.1, 0.58, -0.44], [0.18, 0.48, -0.62], [0.32, 0.6, -0.76], [0.42, 0.84, -0.72], [0.44, 0.98, -0.62]], [0.028, 0.026, 0.024, 0.02, 0.008], base, { seg: 6, paint: body });
  else k.tube('tailB', [[0.1, 0.58, -0.44], [0.2, 0.56, -0.58], [0.3, 0.72, -0.66], [0.34, 0.92, -0.6], [0.33, 1.02, -0.52]], [0.052, 0.058, 0.055, 0.045, 0.02], base, { seg: 7, paint: ring });
}

/** Padded hands for the Brindlekin: the palm side in the darker pad colour. */
export function pawPaint(base: Color3, fur2: Color3, pattern: number, side: number): Paint {
  const body = furPaint(base, fur2, pattern), pad = shade(mix(fur2, INK, 0.5), 0.9);
  return (w, uv, l) => (l.x * side < -0.35 || l.y < -0.6 ? pad : body(w, uv, l));
}
