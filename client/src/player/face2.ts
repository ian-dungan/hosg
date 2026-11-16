// Look v2's head, built from geometry into the adventurer's one skinned mesh (no decal, no texture): a skull whose
// surface is a function of direction (the cranium, temples, forehead, brow ridge, cheekbones, jaw, chin and the eye
// sockets are shaped into it), eyes in the sockets (white, iris, pupil and a glint; upper and lower lids shaped by
// EYE_SHAPES, openness and tilt, with a lash line, a crease and the make-up), brows as shaped ribbons (BROW_SHAPES,
// thickness, height, tilt), a nose swept from bridge to tip and nostril wings (length, width, bridge, tip), two lips
// (width, upper, lower, height), ears (size, angle, the people's style), age lines, freckles, moles, scars, blush and
// face paint; the Brindlekin get a muzzle and animal ears. Everything is in metres in the body's own space (body2.ts
// builds it at the frame's head). Detail: below 0.5 the lids, lips, lines and marks drop to cheap shapes.
// `HeadShape` is the surface the hair and beards (hair.ts) are offset from, so they hug every head.
import { Color3 } from '@babylonjs/core';
import { MOLE_SPOTS, type Look } from '@sg2/shared';
import type { ShapeKit, V3 } from './character';
import type { FaceParams, Frame, LookColours } from './look';
import { furPaint } from './faces';

const mix = (a: Color3, b: Color3, t: number) => Color3.Lerp(a, b, Math.max(0, Math.min(1, t)));
const shade = (c: Color3, f: number) => new Color3(Math.min(1, c.r * f), Math.min(1, c.g * f), Math.min(1, c.b * f));
const INK = new Color3(0.05, 0.04, 0.05);
const SCLERA = new Color3(0.9, 0.88, 0.84);
const ROSE = new Color3(0.74, 0.36, 0.38);
const G = (x: number, s: number) => Math.exp(-(x * x) / (s * s));
const sm = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };

/** The head's surface: `local(d)` is the point (m, round the head's centre) in unit direction d; `at` is in model space. */
export interface HeadShape {
  W: number; Hh: number; D: number; cy: number; cz: number;
  /** Eye centres (head units: x of W, y of Hh) and the eye's half opening (m). */
  eyeX: number; eyeY: number; ew: number; eh: number;
  local(dx: number, dy: number, dz: number): V3;
  /** A point on the face seen from the front at unit (lx, ly), lifted `out` m along the surface's normal; model space. */
  front(lx: number, ly: number, out?: number): V3;
  /** The surface normal (unit) in direction d. */
  normal(dx: number, dy: number, dz: number): V3;
}

export function headShape(f: Frame, fp: FaceParams): HeadShape {
  const W = f.headW, Hh = f.headH * 0.5, D = f.headD, cy = f.headY, cz = f.headZ;
  const kh = f.headH / 0.24;
  const eyeX = 0.4 * fp.eyeGap, eyeY = 0.02 + 0.06 * fp.eyeY;
  const ew = 0.0172 * kh * fp.eyeW, eh = 0.0172 * kh * fp.eyeH;
  const furred = fp.muzzle >= 0;
  const local = (dx: number, dy: number, dz: number): V3 => {
    const fr = sm((dz + 0.1) / 0.6);                  // 0 at the sides and back, 1 on the face
    const y = dy;
    // width by height: temples, cheekbones, jaw and chin (the face's front narrows to the chin)
    let wf = 1 - 0.05 * fr * G(y - 0.38, 0.18) + (0.05 + 0.06 * fp.cheek) * fr * G(y + 0.12, 0.18) + 0.09 * fp.fullness * G(y + 0.42, 0.3);
    if (y < -0.2) {
      const jaw = fp.jaw + 0.08 * Math.max(0, fp.fullness);
      const chin = Math.max(0.3, 0.42 * fp.chinW + 0.1 * Math.max(0, fp.fullness));
      wf *= y > -0.62 ? 1 + (jaw - 1) * sm((-y - 0.2) / 0.42) : jaw + (chin - jaw) * sm((-y - 0.62) / 0.38) * fr + (1 - fr) * (jaw * 0.85 - jaw) * sm((-y - 0.62) / 0.38);
    }
    let x = dx * W * wf;
    // depth: a flatter face plane, a fuller back of the skull, tucked in under it to the neck
    let z: number;
    if (dz >= 0) z = Math.pow(dz, 0.8) * D * (1 + 0.04 * fp.forehead * G(y - 0.55, 0.3));
    else z = dz * D * 1.07 * (y < -0.3 ? 1 - 0.5 * sm((-y - 0.3) / 0.7) : 1);
    let yy = y * Hh;
    // the chin: lower and forward; the jaw's angle under the ears
    if (y < -0.6) {
      yy -= (0.025 + 0.045 * fp.chinLen) * Hh * fr * sm((-y - 0.6) / 0.4);
      z += 0.06 * D * fr * sm((-y - 0.7) / 0.3) * (1 + 0.5 * fp.chinLen);
    }
    // the forehead: taller and fuller (it moves the hairline: hair.ts)
    if (y > 0.3) yy += 0.05 * fp.forehead * Hh * fr * (y - 0.3);
    // local relief along the direction (about the normal): brow ridge, eye sockets, cheekbones, the mouth's mound
    const ax = Math.abs(dx);
    let rel = 0;
    rel += fp.brow * 0.018 * fr * G(y - (eyeY + 0.22), 0.1) * G(ax - eyeX, 0.25);
    rel -= (0.025 + 0.04 * fp.depth) * fr * G(y - eyeY, 0.13) * G(ax - eyeX, 0.16);
    rel += (0.015 + 0.03 * fp.cheek) * fr * G(y + 0.18, 0.13) * G(ax - 0.62, 0.18);
    if (!furred) rel += 0.035 * fr * G(y + 0.56, 0.16) * G(dx, 0.32);
    rel += 0.012 * fr * G(dx, 0.12) * G(y + 0.05, 0.25);   // the nose's root rises out of the face
    const n = Math.hypot(x, yy, z) || 1;
    const k = rel * Hh * 1.3;
    x += (x / n) * k; yy += (yy / n) * k; z += (z / n) * k;
    // the jowls with age
    if (fp.age >= 3 && y < -0.35 && y > -0.85) yy -= 0.012 * Hh * (fp.age - 2) * G(ax - 0.65, 0.2);
    return [x, yy, z];
  };
  const normal = (dx: number, dy: number, dz: number): V3 => {
    // finite differences on the sphere of directions
    const e = 0.02;
    const t1 = Math.abs(dy) < 0.9 ? cross([dx, dy, dz], [0, 1, 0]) : cross([dx, dy, dz], [1, 0, 0]);
    const t2 = cross([dx, dy, dz], t1);
    const p = (v: V3) => local(...norm(v));
    const a = p(add([dx, dy, dz], t1, e)), b = p(add([dx, dy, dz], t1, -e)), c = p(add([dx, dy, dz], t2, e)), d = p(add([dx, dy, dz], t2, -e));
    let nrm = cross(sub(a, b), sub(c, d));
    if (nrm[0] * dx + nrm[1] * dy + nrm[2] * dz < 0) nrm = [-nrm[0], -nrm[1], -nrm[2]];
    return norm(nrm);
  };
  const front = (lx: number, ly: number, out = 0): V3 => {
    const d = norm([lx, ly, Math.sqrt(Math.max(0.02, 1 - lx * lx - ly * ly))]);
    const p = local(...d), n = out ? normal(...d) : [0, 0, 0] as V3;
    return [p[0] + n[0] * out, cy + p[1] + n[1] * out, cz + p[2] + n[2] * out];
  };
  return { W, Hh, D, cy, cz, eyeX, eyeY, ew, eh, local, front, normal };
}
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3, k: number): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
export const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** A unit direction on the sphere: polar angle th from +y, azimuth ph from +z towards +x. */
export const dirOf = (th: number, ph: number): V3 => [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];

/** Grid sizes of the skull by detail. */
const skullRes = (detail: number): [number, number] => (detail >= 0.9 ? [22, 15] : detail >= 0.5 ? [14, 10] : detail >= 0.3 ? [11, 7] : [8, 6]);

export interface FaceOpts {
  look: Look; frame: Frame; fp: FaceParams; col: LookColours; hs: HeadShape; detail: number;
  /** Stubble or a shaved scalp painted on the skin (hair.ts decides). */
  scalp: ((d: V3) => number) | null; stubble: ((d: V3) => number) | null;
}

/** The skull with its painted skin (blush, fur, bark, scalp, stubble, face paint, eye shadow), on the `head` bone. */
export function buildSkull(k: ShapeKit, o: FaceOpts): void {
  const { hs, col, look, fp } = o;
  const [seg, lat] = skullRes(o.detail);
  const furred = !!look.fur;
  const fur2 = col.fur2 ?? shade(col.skin, 0.6);
  const fur = furred ? furPaint(col.skin, fur2, look.fur!.pattern) : null;
  const blush = look.skin.blush;
  const paint = paintFn(o);
  const P: V3[][] = [];
  const cols: Color3[][] = [];
  for (let i = 0; i <= lat; i++) {
    const th = (Math.PI * i) / lat, row: V3[] = [], crow: Color3[] = [];
    for (let j = 0; j < seg; j++) {
      const ph = (Math.PI * 2 * j) / seg;
      const d = dirOf(th, ph);
      const p = hs.local(...d);
      const w: V3 = [p[0], hs.cy + p[1], hs.cz + p[2]];
      row.push(w);
      let c = col.skin;
      // the fur's stripes and spots stay off the middle of the face (round the eyes and muzzle), as on real coats
      if (fur && !(d[2] > 0.35 && Math.abs(d[0]) < 0.7 && d[1] < 0.45 && d[1] > -0.8)) c = fur(new VecLike(w[0], w[1], w[2]) as never, [0, 0], new VecLike(d[0], d[1], d[2]) as never) ?? c;
      if (furred && look.fur!.pattern === 3 && d[2] > 0.3 && Math.abs(d[1] - 0.08) < 0.22 && Math.abs(d[0]) < 0.85) c = mix(c, fur2, 0.92); // the mask
      if (!furred) {
        // a warmer flush on the cheeks, nose and ears; the blush slider deepens the cheeks
        const cheek = G(Math.abs(d[0]) - 0.55, 0.2) * G(d[1] + 0.2, 0.16) * sm((d[2] - 0.2) / 0.3);
        c = mix(c, mix(c, ROSE, 0.55), cheek * (0.12 + 0.2 * blush));
        c = mix(c, shade(c, 0.93), sm((-d[1] - 0.55) / 0.3) * 0.5 * sm((-d[2] + 0.2) / 0.5)); // under the jaw
        if (look.people === 'larchfolk' && d[2] < 0.65 && Math.sin(d[0] * 40 + d[1] * 6) > 0.88 && d[1] < 0.45) c = shade(c, 0.86);
      }
      if (o.scalp) c = mix(c, col.hair, o.scalp(d));
      if (o.stubble) c = mix(c, col.facial, o.stubble(d));
      c = paint(d, c);
      crow.push(c);
    }
    P.push(row); cols.push(crow);
  }
  k.grid('head', P, (i, j) => cols[i]![j]!, { wrap: true });
  void fp;
}
/** A tiny stand-in for Vector3 (furPaint reads x, y, z only). */
class VecLike { constructor(public x: number, public y: number, public z: number) {} }

/** Face paint, eye shadow and the blush over the skin colour, by direction on the skull. */
function paintFn(o: FaceOpts): (d: V3, c: Color3) => Color3 {
  const { look, col, hs } = o;
  const st = look.paint.style, pc = col.paint;
  const shadow = col.shadow;
  return (d, c) => {
    const ax = Math.abs(d[0]), y = d[1], front = d[2] > 0.25;
    if (shadow && front && G(ax - hs.eyeX, 0.16) * G(y - hs.eyeY - 0.1, 0.09) > 0.35) c = mix(c, shadow, 0.6);
    if (!front || st === 0) return c;
    switch (st) {
      case 1: if (ax > 0.4 && ax < 0.85 && (Math.abs(y + 0.12) < 0.045 || Math.abs(y + 0.25) < 0.045)) return pc; break;          // cheek bands
      case 3: if (y > hs.eyeY + 0.16 && y < hs.eyeY + 0.32 && ax < 0.8) return mix(c, pc, 0.9); break;                               // brow paint
      case 4: if (ax < 0.1 && y < -0.55) return pc; break;                                                                         // chin stripe
      case 5: if (y > hs.eyeY - 0.16 && y < hs.eyeY + 0.14 && ax < 0.9) return mix(c, pc, 0.92); break;                             // eye mask
      case 6: if (ax < 0.12 && y > 0.42 && y < 0.66) return pc; break;                                                              // forehead mark
      case 7: if (Math.abs(ax - hs.eyeX) < 0.05 && y < hs.eyeY - 0.1 && y > -0.42) return pc; break;                                 // tear lines
    }
    return c;
  };
}

// ───────── eyes ─────────
/** Both eyes on the `eyes` bone (they blink by its scale): eyeballs, irises, pupils, glints, lids and lashes. */
export function buildEyes(k: ShapeKit, o: FaceOpts): void {
  const { hs, fp, col, detail } = o;
  const skin = col.skin;
  const lidSkin = shade(skin, 0.95);
  const lash = col.liner ?? (o.look.fur ? shade(col.fur2 ?? skin, 0.5) : mix(INK, col.brows, 0.25));
  const linerW = col.liner ? 1.9 : 1;
  for (const sx of [-1, 1]) {
    const iris = sx < 0 ? col.eyes2 : col.eyes;                      // eyes.colour2 is the other (left, −x) eye
    const c = hs.front(sx * hs.eyeX, hs.eyeY, 0);
    const n = hs.normal(...norm([sx * hs.eyeX, hs.eyeY, 0.9]));
    const re = hs.ew * 1.12;                                         // the eyeball's radius
    const ctr: V3 = [c[0] - n[0] * re * 0.78, c[1] - n[1] * re * 0.5, c[2] - n[2] * re * 0.78];
    const tilt = sx * fp.eyeTilt;                                    // + lifts the outer corner (x away from the nose)
    // the frame of the eye: forward (a little outward), right, up (tilted)
    const yaw = sx * 0.12;
    const fwd: V3 = [Math.sin(yaw), 0, Math.cos(yaw)];
    const rgt0: V3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const rgt: V3 = [rgt0[0] * ct, st, rgt0[2] * ct], up: V3 = [-rgt0[0] * st, ct, -rgt0[2] * st];
    const onBall = (az: number, el: number, r: number): V3 => {
      const ca = Math.cos(el);
      return [ctr[0] + (fwd[0] * Math.cos(az) * ca + rgt[0] * Math.sin(az) * ca + up[0] * Math.sin(el)) * r,
        ctr[1] + (fwd[1] * Math.cos(az) * ca + rgt[1] * Math.sin(az) * ca + up[1] * Math.sin(el)) * r,
        ctr[2] + (fwd[2] * Math.cos(az) * ca + rgt[2] * Math.sin(az) * ca + up[2] * Math.sin(el)) * r];
    };
    const A = Math.asin(Math.min(0.97, hs.ew / re));               // half the opening's angle across
    const Eu = Math.asin(Math.min(0.95, hs.eh / re));                // the opening's half height (angle)
    const upEdge = (t: number) => Eu * (1 - fp.lid * 0.85) * Math.pow(Math.max(0, 1 - t * t), 0.6) + 0.04 * t * sx * 0;
    const loEdge = (t: number) => -Eu * (0.75 - fp.lower * 1.2) * Math.pow(Math.max(0, 1 - t * t), 0.8);
    if (detail >= 0.5) {
      // the eyeball (white), set into the socket
      const bs = detail >= 0.9 ? 8 : 6;
      k.ellip('eyes', ctr, [re, re, re], SCLERA, { seg: bs, lat: Math.round(bs * 0.6), noOcc: true });
      // the iris and pupil, looking straight ahead, on the eyeball's front
      const ir = Math.min(hs.ew * 0.56, re * 0.6), ic = onBall(0, 0, re * 0.985);
      k.ellip('eyes', [ic[0], ic[1], ic[2]], [ir, ir, ir * 0.25], shade(iris, 0.95), { seg: detail >= 0.9 ? 8 : 6, lat: 3, noOcc: true,
        paint: (_w, _uv, l) => (Math.hypot(l.x, l.y) > 0.82 ? shade(iris, 0.55) : Math.hypot(l.x, l.y) < 0.5 && l.y > 0 ? shade(iris, 1.15) : undefined) });
      const pc = onBall(0, 0, re * 1.012);
      k.ellip('eyes', pc, [ir * 0.42, ir * 0.42, ir * 0.15], INK, { seg: 6, lat: 3, noOcc: true });
      if (detail >= 0.9) {
        const gl = onBall(-0.25 * sx, 0.32, re * 1.03);
        k.ellip('eyes', gl, [ir * 0.2, ir * 0.2, ir * 0.08], new Color3(1, 1, 1), { seg: 4, lat: 2, noOcc: true });
      }
      // the lids: caps on a sphere just over the eyeball, the upper from its edge up, the lower from its edge down
      const rl = re * 1.07, nA = detail >= 0.9 ? 7 : 5, nE = detail >= 0.9 ? 3 : 2;
      const shadowC = col.shadow;
      const lidGrid = (upper: boolean) => {
        const P: V3[][] = [];
        for (let i = 0; i <= nE; i++) {
          const row: V3[] = [];
          for (let j = 0; j <= nA; j++) {
            const t = (j / nA) * 2 - 1, az = t * (A * 1.55);
            const edge = Math.abs(t) > 0.8 ? 0 : upper ? upEdge(t / 0.8) : loEdge(t / 0.8);
            const lim = upper ? 1.35 : -1.25;
            const el = edge + (lim - edge) * (i / nE);
            row.push(onBall(az, el, rl * (i === 0 ? 1 : 1 + 0.06 * (i / nE))));
          }
          P.push(row);
        }
        k.grid('eyes', P, (i) => {
          if (!upper) return i === 0 ? shade(lidSkin, 0.92) : lidSkin;
          if (i === 0) return lash;
          if (shadowC) return mix(lidSkin, shadowC, i <= nE - 1 ? 0.8 : 0.3);
          if (fp.crease > 0.3 && i === nE - 1) return shade(lidSkin, 0.86);
          return lidSkin;
        }, { noOcc: true, out: (i, j) => sub(P[i]![j]!, ctr) });
      };
      lidGrid(true); lidGrid(false);
      // the lash line (thicker with eyeliner), along the upper lid's edge, flicking out at the outer corner
      const pts: V3[] = [], rad: number[] = [];
      for (let j = 0; j <= 6; j++) {
        const t = (j / 6) * 2 - 1, az = t * A;
        pts.push(onBall(az, upEdge(t) + 0.04, rl * 1.03));
        rad.push((0.0011 + 0.0009 * (1 - Math.abs(t))) * (hs.Hh / 0.12) * linerW);
      }
      if (col.liner) { const e = pts[sx > 0 ? 6 : 0]!; pts[sx > 0 ? 6 : 0] = [e[0] + sx * hs.ew * 0.25, e[1] + hs.eh * 0.3, e[2] - hs.ew * 0.1]; }
      if (sx < 0) { pts.reverse(); rad.reverse(); }
      k.tube('eyes', pts, rad, lash, { seg: 3, noOcc: true });
    } else {
      // far and low detail: a dark almond with the iris colour, lidded by the skull
      k.ellip('eyes', [c[0], c[1], c[2] - 0.002], [hs.ew * 0.95, Math.max(hs.eh * (1 - fp.lid * 0.7), hs.ew * 0.32), hs.ew * 0.35], mix(shade(iris, 0.6), INK, 0.35),
        { seg: 6, lat: 3, noOcc: true, rot: [-0.1, sx * 0.2, sx * fp.eyeTilt] });
      if (detail >= 0.3) k.ellip('eyes', [c[0] + sx * hs.ew * 0.55, c[1] + hs.eh * 0.1, c[2] - 0.001], [hs.ew * 0.32, hs.eh * 0.45, hs.ew * 0.2], SCLERA, { seg: 4, lat: 2, noOcc: true, rot: [0, sx * 0.3, 0] });
    }
  }
}

// ───────── brows ─────────
/** Both brows: ribbons lying on the brow ridge, their arch, peak, thickness, taper, height and tilt from the look. */
export function buildBrows(k: ShapeKit, o: FaceOpts): void {
  const { hs, fp, col, detail } = o;
  if (o.look.fur && detail < 0.5) return;
  const N = detail >= 0.9 ? 8 : detail >= 0.5 ? 6 : 4;
  const thick = 0.07 * fp.browT;                     // half height in head units
  const by = hs.eyeY + 0.2 + 0.07 * fp.browY;
  const bc = o.look.fur ? mix(col.skin, col.fur2 ?? col.skin, 0.6) : col.brows;
  for (const sx of [-1, 1]) {
    const P: V3[][] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;                                // 0 at the nose, 1 at the temple
      const x = hs.eyeX - 0.24 + t * 0.52;
      const peak = fp.browPeak;
      const rise = fp.browAngle > 0.5
        ? fp.browArch * 0.11 * Math.max(0, 1 - Math.abs(t - peak) / Math.max(peak, 1 - peak))
        : fp.browArch * 0.11 * Math.sin(Math.PI * Math.min(1, t / (peak * 2)) * (t <= peak ? 1 : 1)) * (t <= peak ? 1 : Math.max(0, 1 - (t - peak) / (1 - peak) * 0.9));
      const sCurve = fp.browS * (t < 0.3 ? -0.03 * Math.sin((t / 0.3) * Math.PI) : 0);
      const y = by + rise + sCurve + fp.browTilt * (t - 0.4) * 0.3 - 0.04 * t * t;
      const h = thick * (t < 0.15 ? 0.75 + t * 1.6 : 1 - fp.browTaper * Math.max(0, t - 0.4) / 0.6) * (1 - 0.3 * (t < 0.08 ? 1 - t / 0.08 : 0));
      const lo = hs.front(sx * x, y - h, 0.0012), mid = hs.front(sx * x, y, 0.0012 + h * hs.Hh * 0.12), hi = hs.front(sx * x, y + h * 0.9, 0.0012);
      P.push([lo, mid, hi]);
    }
    if (sx < 0) P.reverse();
    k.grid('head', P, (i, j) => (j === 1 ? bc : shade(bc, 1.08)), { noOcc: true, out: (i, j) => hs.normal(...norm([sx * (hs.eyeX - 0.24 + (sx < 0 ? N - i : i) / N * 0.52), by, 0.8])) });
  }
}

// ───────── the nose ─────────
/** The nose swept from the bridge to the tip and under it, with the nostril wings (human, Larchfolk, Knollfolk). */
export function buildNose(k: ShapeKit, o: FaceOpts): void {
  const { hs, fp, col, detail } = o;
  if (o.look.fur) return buildMuzzle(k, o);
  const kh = hs.Hh / 0.12;
  const len = 1 + 0.24 * fp.noseLen, wid = 1 + 0.42 * fp.noseW, br = 1 + 0.6 * fp.bridge, tip = fp.tip;
  const knoll = o.look.people === 'knollfolk' ? 1.25 : 1;
  const skin = shade(col.skin, 0.99);
  // stations: [y (head units), projection (m), half width (m)] from the root between the eyes to the base over the lip
  const st: [number, number, number][] = [
    [hs.eyeY + 0.01, 0.0004, 0.012],
    [hs.eyeY - 0.1 * len, 0.0055 * br, 0.0085],
    [hs.eyeY - 0.24 * len, (0.0105 + 0.003 * fp.bridge) * len, 0.0095 * wid],
    [hs.eyeY - (0.35 - 0.025 * tip) * len, (0.0175 + 0.002 * fp.noseLen) * knoll, 0.0125 * wid * knoll],
    [hs.eyeY - (0.4 - 0.01 * tip) * len, (0.012 - 0.004 * tip) * knoll, 0.0135 * wid * knoll],
    [hs.eyeY - 0.43 * len, 0.0015, 0.0095 * wid],
  ];
  const nA = detail >= 0.9 ? 8 : detail >= 0.5 ? 6 : 3;
  const P: V3[][] = [];
  for (const [y, proj, hw] of st) {
    const row: V3[] = [];
    for (let j = 0; j <= nA; j++) {
      const a = -Math.PI / 2 + (Math.PI * j) / nA;
      const base = hs.front(0, y, 0);
      const x = Math.sin(a) * hw * kh;
      const s = hs.front(x / hs.W, y, 0);           // the face's surface under this point
      const zz = s[2] + Math.cos(a) * proj * kh * (Math.abs(Math.sin(a)) < 0.99 ? 1 : 0) - 0.0015;
      row.push([x, base[1], Math.max(zz, s[2] - 0.002)]);
    }
    P.push(row);
  }
  k.grid('head', P, (i, j) => (i === P.length - 2 && (j === 0 || j === nA) ? shade(skin, 0.9) : i === 3 ? mix(skin, ROSE, 0.06) : skin), { noOcc: true,
    out: (i, j) => { const a = -Math.PI / 2 + (Math.PI * j) / nA; return [Math.sin(a), i >= 4 ? -0.6 : 0.1, Math.cos(a)]; } });
  // the nostril wings
  if (detail >= 0.3) {
    const [y, , hw] = st[4]!;
    for (const sx of [-1, 1]) {
      const s = hs.front((sx * hw * kh * 1.02) / hs.W, y + 0.02, 0);
      k.ellip('head', [s[0], s[1], s[2] + 0.004 * kh], [0.0055 * kh * wid, 0.0058 * kh, 0.0072 * kh], shade(skin, 0.97), { seg: 6, lat: 4, noOcc: true,
        paint: (_w, _uv, l) => (l.y < -0.55 && l.x * sx < 0.2 ? shade(skin, 0.55) : undefined) });
    }
  }
}

/** The Brindlekin's muzzle (fur.muzzle 0..7: snub to grand), the nose pad and the mouth. */
function buildMuzzle(k: ShapeKit, o: FaceOpts): void {
  const { hs, col, fp, detail } = o;
  const m = Math.max(0, fp.muzzle);
  const kh = hs.Hh / 0.12;
  const MZ: [number, number, number][] = [[0.6, 1.0, 0.95], [0.8, 0.95, 0.9], [1, 0.9, 0.9], [1, 1.2, 1.05], [1.35, 0.85, 0.9], [1, 1.05, 1.15], [1.25, 0.8, 0.95], [1.5, 1.05, 1.1]];
  const [L, Wm, Hm] = MZ[m]!;
  const len = (0.032 + 0.012 * fp.noseLen) * L * kh, wid = 0.034 * Wm * kh * (1 + 0.2 * fp.noseW), hgt = 0.026 * Hm * kh;
  const base = hs.front(0, -0.36, 0);
  const light = o.look.fur!.pattern === 3 ? mix(col.skin, new Color3(1, 1, 1), 0.5) : mix(col.skin, new Color3(1, 1, 1), 0.28);
  const c: V3 = [0, base[1] + 0.004 * kh * fp.tip, base[2] - len * 0.25];
  k.ellip('head', c, [wid, hgt, len], light, { seg: detail >= 0.5 ? 12 : 8, lat: detail >= 0.5 ? 7 : 5, deform: (l) => { if (l.y < 0) l.y *= 0.8; if (l.z > 0) l.y += 0.1 * l.z * (fp.bridge + 0.3); } });
  const pad = shade(mix(col.fur2 ?? col.skin, INK, 0.65), 0.8);
  k.ellip('head', [0, c[1] + hgt * 0.5, c[2] + len * 0.93], [0.013 * kh * Wm, 0.009 * kh, 0.008 * kh], pad, { seg: 8, lat: 4, noOcc: true });
  const mouth: V3[] = [];
  const mw = 1 + 0.25 * fp.mouthW;
  for (let i = 0; i <= 4; i++) { const t = i / 4 - 0.5; mouth.push([t * wid * 1.3 * mw, c[1] - hgt * 0.45 + Math.abs(t) * 0.006 * kh, c[2] + len * 0.72 - t * t * len * 0.8]); }
  k.tube('head', mouth, 0.0016 * kh, shade(col.fur2 ?? col.skin, 0.45), { seg: 3, noOcc: true });
}

// ───────── the mouth ─────────
/** The two lips (natural or the lip colour), the line between them, on the `head` bone. */
export function buildMouth(k: ShapeKit, o: FaceOpts): void {
  const { hs, fp, col, detail } = o;
  if (o.look.fur) return;
  const kh = hs.Hh / 0.12;
  const my = -0.565 + 0.05 * fp.mouthY;
  const hw = (0.022 + 0.0075 * fp.mouthW) * kh;             // half width (m)
  const natural = mix(shade(col.skin, 0.84), ROSE, 0.32);
  const lip = col.lips ?? natural;
  const upperH = (0.0046 + 0.0018 * fp.upper) * kh, lowerH = (0.0058 + 0.0024 * fp.lower2) * kh;
  if (detail < 0.5) {
    const pts: V3[] = [];
    for (let i = 0; i <= 4; i++) { const t = (i / 4) * 2 - 1; pts.push(hs.front((t * hw) / hs.W, my + Math.abs(t) * 0.01, 0.0004)); }
    k.tube('head', pts, [0.0015 * kh, upperH * 0.55, lowerH * 0.6, upperH * 0.55, 0.0015 * kh], mix(lip, INK, 0.25), { seg: 3, noOcc: true });
    return;
  }
  const N = detail >= 0.9 ? 8 : 6;
  const lipGrid = (upper: boolean) => {
    const P: V3[][] = [];
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * 2 - 1, at = Math.abs(t);
      const prof = Math.pow(Math.max(0, 1 - at * at), 0.55);
      const h = (upper ? upperH * (1 - 0.18 * G(t, 0.12)) : lowerH) * prof;   // the cupid's bow: a dip in the middle of the upper lip
      const lx = (t * hw) / hs.W;
      const line = hs.front(lx, my + at * at * 0.012, -0.0008);
      const sgn = upper ? 1 : -1;
      const edge = hs.front(lx, my + sgn * (h / hs.Hh) + at * at * 0.012, 0.0004);
      const mid = hs.front(lx, my + sgn * (h * 0.5 / hs.Hh) + at * at * 0.012, 0.0004 + h * (upper ? 0.42 : 0.62) * prof);
      P.push([line, mid, edge]);
    }
    k.grid('head', P, (_i, j) => (j === 0 ? mix(lip, INK, 0.55) : j === 1 ? lip : mix(lip, shade(col.skin, 0.92), 0.35)), { noOcc: true,
      out: (i) => { const t = (i / N) * 2 - 1; return hs.normal(...norm([(t * hw) / hs.W, my, 0.9])); } });
  };
  lipGrid(true); lipGrid(false);
}

// ───────── ears ─────────
/** The people's ears: round (Humans, Knollfolk), long and pointed (Larchfolk), or an animal ear (BRINDLE_EARS). */
export function buildEars(k: ShapeKit, o: FaceOpts): void {
  const { hs, fp, col, look, detail } = o;
  const kh = hs.Hh / 0.12;
  const sz = 1 + 0.22 * fp.earSize, out = 0.28 + 0.32 * fp.earAngle;
  const skin = shade(col.skin, 0.97), inner = mix(col.skin, ROSE, 0.3);
  const seg = detail >= 0.5 ? 8 : 6;
  if (look.people === 'brindlekin') return animalEars(k, o, sz);
  for (const sx of [-1, 1]) {
    const root = hs.front(sx * 0.98, -0.1, 0);
    const side: V3 = [sx * hs.W * 0.98, hs.cy - 0.1 * hs.Hh, hs.cz - 0.06 * hs.D];
    if (look.people === 'larchfolk') {
      const L = 0.05 * kh * [1.4, 1.9, 2.4, 3][fp.earStyle]! * sz;
      const a = side, b: V3 = [a[0] + sx * L * (0.32 + out * 0.3), a[1] + L * 0.25, a[2] - L * 0.22];
      const c: V3 = [a[0] + sx * L * (0.62 + out * 0.4), a[1] + L * 0.52, a[2] - L * 0.45], d: V3 = [a[0] + sx * L * (0.85 + out * 0.45), a[1] + L * 0.78, a[2] - L * 0.6];
      k.tube('head', [a, b, c, d], [0.016 * kh, 0.014 * kh, 0.009 * kh, 0.0015], skin, { seg: 6, flatten: 0.4, noOcc: true });
    } else {
      const e = [0.85, 1, 1.12, 1.25][fp.earStyle]! * sz * (look.people === 'knollfolk' ? 1.2 : 1);
      k.ellip('head', [side[0] + sx * 0.004 * kh, side[1], side[2]], [0.0075 * kh * e, 0.03 * kh * e, 0.018 * kh * e], skin,
        { seg, lat: 5, rot: [0.1, sx * out, sx * -0.12], noOcc: true, paint: (_w, _uv, l) => (l.x * sx < -0.2 && Math.abs(l.y) < 0.55 && l.z > -0.2 ? inner : undefined) });
    }
    void root;
  }
}
function animalEars(k: ShapeKit, o: FaceOpts, sz: number) {
  const { hs, col, fp } = o;
  const kh = hs.Hh / 0.12;
  const fur2 = col.fur2 ?? shade(col.skin, 0.6), inner = mix(fur2, ROSE, 0.35), ear = shade(col.skin, 0.97);
  const E = 1.15 * sz * kh;
  const tilt = 0.2 + 0.4 * fp.earAngle;
  for (const sx of [-1, 1]) {
    const r = hs.local(...norm([sx * 0.55, 0.75, -0.05]));
    const [x, y, z] = [r[0], hs.cy + r[1] - 0.006 * kh, hs.cz + r[2]];
    const innerPaint = (_w: unknown, uv: [number, number]) => (uv[0] > 0.3 && uv[0] < 0.7 ? inner : undefined);
    switch (fp.earStyle) {
      case 0: k.tube('head', [[x, y, z], [x + sx * 0.012 * E * (1 + tilt), y + 0.03 * E, z - 0.003], [x + sx * 0.02 * E * (1 + tilt), y + 0.062 * E, z - 0.006]], [0.024 * E, 0.014 * E, 0.001], ear, { seg: 6, flatten: 0.45, noOcc: true, paint: innerPaint }); break;
      case 1: k.ellip('head', [x + sx * 0.01 * E, y + 0.016 * E, z], [0.024 * E, 0.022 * E, 0.012 * E], ear, { seg: 10, lat: 6, noOcc: true, paint: (_w, _uv, l) => (l.z > 0.4 ? inner : undefined) }); break;
      case 2: k.tube('head', [[x, y, z], [x + sx * 0.008 * E, y + 0.05 * E, z - 0.008], [x + sx * 0.016 * E * (1 + tilt), y + 0.1 * E, z - 0.016], [x + sx * 0.02 * E * (1 + tilt), y + 0.13 * E, z - 0.02]], [0.016 * E, 0.018 * E, 0.014 * E, 0.002], ear, { seg: 6, flatten: 0.45, noOcc: true, paint: innerPaint }); break;
      case 3: k.tube('head', [[x, y, z], [x + sx * 0.012 * E, y + 0.036 * E, z - 0.002], [x + sx * 0.02 * E, y + 0.044 * E, z + 0.02 * E], [x + sx * 0.024 * E, y + 0.024 * E, z + 0.04 * E]], [0.022 * E, 0.017 * E, 0.012 * E, 0.002], ear, { seg: 6, flatten: 0.45, noOcc: true }); break;
      case 4:
        k.tube('head', [[x, y, z], [x + sx * 0.016 * E * (1 + tilt), y + 0.032 * E, z - 0.002], [x + sx * 0.024 * E * (1 + tilt), y + 0.064 * E, z - 0.004]], [0.023 * E, 0.012 * E, 0.002], ear, { seg: 6, flatten: 0.45, noOcc: true, paint: innerPaint });
        k.tube('head', [[x + sx * 0.024 * E * (1 + tilt), y + 0.06 * E, z - 0.004], [x + sx * 0.028 * E * (1 + tilt), y + 0.1 * E, z - 0.006]], [0.005 * E, 0.001], mix(col.hair, fur2, 0.5), { seg: 4, noOcc: true });
        break;
      default: {
        const s = hs.local(...norm([sx * 0.9, 0.35, -0.05]));
        const a: V3 = [s[0], hs.cy + s[1], hs.cz + s[2]];
        k.tube('head', [a, [a[0] + sx * 0.02 * E, a[1] - 0.024 * E, a[2]], [a[0] + sx * 0.024 * E, a[1] - 0.072 * E, a[2] + 0.004], [a[0] + sx * 0.02 * E, a[1] - 0.1 * E, a[2] + 0.008]], [0.018 * E, 0.022 * E, 0.02 * E, 0.008 * E], ear, { seg: 6, flatten: 0.4, noOcc: true });
      }
    }
  }
}

// ───────── age, marks ─────────
/** Lines with age (forehead, crow's feet, smile lines, under the eyes), freckles, moles and scars. */
export function buildMarks(k: ShapeKit, o: FaceOpts): void {
  const { hs, look, col, detail, fp } = o;
  if (detail < 0.5) return;
  const kh = hs.Hh / 0.12;
  const line = (pts: [number, number][], r: number, c: Color3, lift = 0.0006) => {
    const P = pts.map(([x, y]) => hs.front(x, y, lift));
    k.tube('head', P, P.map((_, i) => (i === 0 || i === P.length - 1 ? r * 0.35 : r)), c, { seg: 3, noOcc: true });
  };
  const age = fp.age;
  if (age > 0 && !look.fur) {
    const lc = shade(col.skin, 0.8 - 0.03 * age), r = (0.0006 + 0.00025 * age) * kh;
    // smile lines from the nostril wings past the mouth's corners
    for (const sx of [-1, 1]) line([[sx * 0.2, -0.33], [sx * 0.29, -0.47], [sx * 0.31, -0.6]], r, lc);
    if (age >= 2) {
      for (const sx of [-1, 1]) { // crow's feet
        line([[sx * (hs.eyeX + 0.24), hs.eyeY + 0.05], [sx * (hs.eyeX + 0.33), hs.eyeY + 0.09]], r * 0.8, lc);
        line([[sx * (hs.eyeX + 0.24), hs.eyeY - 0.02], [sx * (hs.eyeX + 0.33), hs.eyeY - 0.06]], r * 0.8, lc);
      }
      line([[-0.3, 0.6], [0, 0.63], [0.3, 0.6]], r, lc);   // the forehead
    }
    if (age >= 3) {
      line([[-0.26, 0.7], [0, 0.73], [0.26, 0.7]], r * 0.9, lc);
      for (const sx of [-1, 1]) line([[sx * (hs.eyeX - 0.15), hs.eyeY - 0.13], [sx * hs.eyeX, hs.eyeY - 0.17], [sx * (hs.eyeX + 0.14), hs.eyeY - 0.13]], r * 0.8, lc); // under the eyes
    }
    if (age >= 4) for (const sx of [-1, 1]) line([[sx * 0.32, -0.66], [sx * 0.36, -0.8]], r, lc); // the jowls
  }
  // freckles: dots over the nose and cheeks, more with the slider (a fixed scatter, so they never crawl)
  const fr = look.skin.freckles;
  if (fr > 0) {
    const n = Math.round([0, 9, 16, 26, 38][fr]! * (detail >= 0.9 ? 1 : 0.4));
    const fc = mix(col.skin, shade(col.skin, 0.55), 0.85);
    for (let i = 0; i < n; i++) {
      const a = Math.sin(i * 12.9898) * 43758.5453, b = Math.sin(i * 78.233) * 12543.123;
      const u = a - Math.floor(a), v = b - Math.floor(b);
      const x = (u * 2 - 1) * 0.62, y = -0.12 - v * 0.26 + Math.abs(x) * 0.12;
      if (Math.abs(x) < 0.07 && y < -0.2) continue;
      k.ellip('head', hs.front(x, y, 0.0004), [0.0017 * kh, 0.0017 * kh, 0.0006 * kh], fc, { seg: 3, lat: 2, flat: true, noOcc: true });
    }
  }
  // moles at MOLE_SPOTS (spot x +1 is the adventurer's left, which is −x here)
  for (let i = 0; i < MOLE_SPOTS.length; i++) {
    if (!(look.skin.moles & (1 << i))) continue;
    const s = MOLE_SPOTS[i]!;
    k.ellip('head', hs.front(-s.x * 0.85, s.y * 0.78, 0.0006), [0.0026 * kh, 0.0026 * kh, 0.0016 * kh], shade(mix(col.skin, new Color3(0.25, 0.15, 0.1), 0.75), 0.9), { seg: 5, lat: 3, noOcc: true });
  }
  // scars: a raised pale line (SCARS: left cheek, right cheek, brow nick, lip nick, nose bridge, jaw line, eye slash)
  const sc = mix(col.skin, new Color3(0.93, 0.78, 0.76), 0.55), sr = 0.0016 * kh;
  const L = -1; // the adventurer's left is −x
  switch (look.skin.scar) {
    case 1: line([[L * 0.36, -0.02], [L * 0.45, -0.18], [L * 0.52, -0.34]], sr, sc, 0.001); break;
    case 2: line([[-L * 0.36, -0.02], [-L * 0.45, -0.18], [-L * 0.52, -0.34]], sr, sc, 0.001); break;
    case 3: line([[L * (hs.eyeX + 0.02), hs.eyeY + 0.16], [L * (hs.eyeX + 0.06), hs.eyeY + 0.3]], sr * 1.2, sc, 0.003); break;
    case 4: line([[-L * 0.1, -0.5], [-L * 0.13, -0.66]], sr, sc, 0.001); break;
    case 5: line([[-0.08, hs.eyeY - 0.06], [0.08, hs.eyeY - 0.14]], sr, sc, 0.009 * kh); break;
    case 6: line([[L * 0.52, -0.55], [L * 0.32, -0.8], [L * 0.1, -0.9]], sr, sc, 0.001); break;
    case 7: line([[L * (hs.eyeX - 0.05), hs.eyeY + 0.34], [L * hs.eyeX, hs.eyeY + 0.02], [L * (hs.eyeX + 0.06), hs.eyeY - 0.3]], sr * 1.1, sc, 0.004); break;
  }
  // face paint as dots (FACE_PAINTS 2: dot tattoos; the others are painted on the skull)
  if (look.paint.style === 2) {
    for (const y of [0.62, 0.52, 0.42]) k.ellip('head', hs.front(0, y, 0.0005), [0.0028 * kh, 0.0028 * kh, 0.001 * kh], col.paint, { seg: 5, lat: 2, flat: true, noOcc: true });
    for (const sx of [-1, 1]) for (const x of [0.32, 0.44]) k.ellip('head', hs.front(sx * x, -0.2, 0.0005), [0.0024 * kh, 0.0024 * kh, 0.001 * kh], col.paint, { seg: 5, lat: 2, flat: true, noOcc: true });
  }
}

/** Triangles of the last face built, by part (budgets and dev pages). */
export const faceTris: Record<string, number> = {};
/** The whole face: skull, eyes, brows, nose or muzzle, mouth, ears and marks. */
export function buildFace(k: ShapeKit, o: FaceOpts): void {
  // the head keeps its own colours (no baked occlusion: the shoulders and the skull would darken the face's parts unevenly)
  k.g.aoOffNow = true;
  const parts = [['skull', buildSkull], ['eyes', buildEyes], ['brows', buildBrows], ['nose', buildNose], ['mouth', buildMouth], ['ears', buildEars], ['marks', buildMarks]] as const;
  for (const [name, fn] of parts) { const t0 = k.g.triangles; fn(k, o); faceTris[name] = k.g.triangles - t0; }
}
