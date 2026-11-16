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
    // planes that catch the light: the hollow under the cheekbone (less with weight), the jaw's angle (stronger on the
    // heavier brow), and the chin's pad
    rel -= 0.016 * (1 - Math.max(0, fp.fullness)) * fr * G(y + 0.36, 0.11) * G(ax - 0.52, 0.13);
    rel += 0.014 * (0.5 + 0.5 * fp.brow) * G(y + 0.64, 0.1) * G(ax - 0.8, 0.14);
    if (!furred) rel += 0.013 * fr * G(y + 0.86, 0.09) * G(dx, 0.22);
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
        c = mix(c, shade(c, 0.88), G(d[1] + 0.71, 0.06) * G(d[0], 0.2) * sm((d[2] - 0.5) / 0.3));  // the fold under the lower lip
        if (look.people === 'larchfolk' && d[2] < 0.65 && Math.sin(d[0] * 40 + d[1] * 6) > 0.88 && d[1] < 0.45) c = shade(c, 0.86);
      }
      if (o.scalp) c = mix(c, col.hair, o.scalp(d));
      if (o.stubble) c = mix(c, col.facial, o.stubble(d));
      // freckles below full detail: a warm speckled tint over the nose and cheeks (single dots are too small to see)
      if (!furred && look.skin.freckles > 0 && o.detail < 0.9 && d[2] > 0.3) {
        const zone = G(d[1] + 0.22, 0.14) * G(Math.abs(d[0]) - 0.3, 0.34);
        const speck = 0.5 + 0.5 * Math.sin(d[0] * 61 + d[1] * 37) * Math.sin(d[1] * 53 - d[0] * 29);
        c = mix(c, shade(c, 0.72), zone * speck * 0.12 * look.skin.freckles);
      }
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
      k.ellip('eyes', [ic[0], ic[1], ic[2]], [ir, ir, ir * 0.25], shade(iris, 0.95), { seg: detail >= 0.9 ? 8 : 6, lat: detail >= 0.9 ? 3 : 2, noOcc: true,
        paint: (_w, _uv, l) => (Math.hypot(l.x, l.y) > 0.82 ? shade(iris, 0.55) : Math.hypot(l.x, l.y) < 0.5 && l.y > 0 ? shade(iris, 1.15) : undefined) });
      const pc = onBall(0, 0, re * 1.012);
      k.ellip('eyes', pc, [ir * 0.42, ir * 0.42, ir * 0.15], INK, { seg: detail >= 0.9 ? 6 : 5, lat: detail >= 0.9 ? 3 : 2, noOcc: true });
      if (detail >= 0.9) {
        const gl = onBall(-0.25 * sx, 0.32, re * 1.03);
        k.ellip('eyes', gl, [ir * 0.2, ir * 0.2, ir * 0.08], new Color3(1, 1, 1), { seg: 4, lat: 2, noOcc: true });
      }
      // the lids: caps on a sphere just over the eyeball, the upper from its edge up, the lower from its edge down
      const rl = re * 1.07, nA = detail >= 0.9 ? 7 : 5, nEu = detail >= 0.9 ? 4 : 3, nEl = detail >= 0.9 ? 3 : 2;
      // the upper lid's rows: the lash line, the lid's bulge, then the crease folding in under the brow's skin
      const lidR = (upper: boolean, i: number) => {
        const nE = upper ? nEu : nEl;
        if (i === 0) return 1;
        const base = 1 + 0.06 * (i / nE);
        if (!upper) return base;
        if (fp.crease > 0.3 && i === nE - 1) return base - 0.04 * fp.crease;
        return base + (i === 1 ? 0.015 : 0);
      };
      const shadowC = col.shadow;
      const lidGrid = (upper: boolean) => {
        const P: V3[][] = [];
        const nE = upper ? nEu : nEl;
        for (let i = 0; i <= nE; i++) {
          const row: V3[] = [];
          for (let j = 0; j <= nA; j++) {
            const t = (j / nA) * 2 - 1, az = t * (A * 1.55);
            const edge = Math.abs(t) > 0.8 ? 0 : upper ? upEdge(t / 0.8) : loEdge(t / 0.8);
            const lim = upper ? 1.35 : -1.25;
            const el = edge + (lim - edge) * (i / nE);
            row.push(onBall(az, el, rl * lidR(upper, i)));
          }
          P.push(row);
        }
        k.grid('eyes', P, (i) => {
          if (!upper) return i === 0 ? shade(lidSkin, 0.92) : lidSkin;
          if (i === 0) return lash;
          if (shadowC) return mix(lidSkin, shadowC, i <= nE - 1 ? 0.8 : 0.3);
          if (fp.crease > 0.3 && i === nE - 1) return shade(lidSkin, 0.8);
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
      if (detail >= 0.35) k.ellip('eyes', [c[0] + sx * hs.ew * 0.55, c[1] + hs.eh * 0.1, c[2] - 0.001], [hs.ew * 0.32, hs.eh * 0.45, hs.ew * 0.2], SCLERA, { seg: 4, lat: 2, noOcc: true, rot: [0, sx * 0.3, 0] });
    }
  }
}

// ───────── brows ─────────
/** Both brows: ribbons lying on the brow ridge, their arch, peak, thickness, taper, height and tilt from the look. */
export function buildBrows(k: ShapeKit, o: FaceOpts): void {
  const { hs, fp, col, detail } = o;
  if (o.look.fur && detail < 0.5) return;
  const N = detail >= 0.9 ? 8 : detail >= 0.5 ? 5 : detail >= 0.35 ? 4 : 3;
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
      // a body of hair, not paint: lifted off the brow bone (thicker brows stand further out), feathered at the top
      const lift = 0.0012 + Math.min(0.004, h * hs.Hh * 0.3);
      P.push(detail >= 0.9 ? [hs.front(sx * x, y - h, 0.001), hs.front(sx * x, y - h * 0.35, lift), hs.front(sx * x, y + h * 0.4, lift * 0.85), hs.front(sx * x, y + h * 0.95, 0.0008)]
        : [hs.front(sx * x, y - h, 0.001), hs.front(sx * x, y, lift), hs.front(sx * x, y + h * 0.95, 0.0008)]);
    }
    if (sx < 0) P.reverse();
    const feather = mix(bc, col.skin, 0.3);
    const nb = P[0]!.length;
    k.grid('head', P, (i, j) => (j === 0 ? shade(bc, 0.85) : j === nb - 1 ? feather : j === 2 ? shade(bc, 1.06) : bc), { noOcc: true, out: (i, j) => hs.normal(...norm([sx * (hs.eyeX - 0.24 + (sx < 0 ? N - i : i) / N * 0.52), by, 0.8])) });
  }
}

// ───────── the nose ─────────
/** One station of the nose, root to base: height (head units), projection off the face (m), half width at the face (m), and
 *  the section's roundness (1: a sharp ridge with flat side walls, 2: round, as the tip). */
export interface NoseStation { y: number; proj: number; hw: number; round: number }
/**
 * The nose's stations (pure, unit-tested: each slider moves its part of the nose by a stated amount, in profile and
 * from the front): the root between the eyes, the nasion, the bridge (rhinion), the supratip, the tip, the columella
 * under it and the base over the lip. length: the tip lower and further out; width: the bridge, tip and wings wider;
 * bridge: the ridge higher and narrower (a hump at the rhinion); tip: up (shorter, the underside showing) or down
 * (drooping, longer). Wings (alae) sit either side of the tip and columella.
 */
export function noseStations(fp: Pick<FaceParams, 'noseLen' | 'noseW' | 'bridge' | 'tip'>, eyeY: number, knoll = 1): { st: NoseStation[]; wing: { y: number; x: number; r: [number, number, number] } } {
  const L = 1 + 0.28 * fp.noseLen, Lp = 1 + 0.18 * fp.noseLen, W = 1 + 0.45 * fp.noseW, B = fp.bridge, T = fp.tip;
  const narrow = 1 - 0.14 * B;                       // a high bridge reads narrower from the front
  const st: NoseStation[] = [
    { y: eyeY + 0.03, proj: 0.001, hw: 0.0125, round: 1.1 },
    { y: eyeY - 0.06 * L, proj: 0.0056 + 0.0032 * B, hw: 0.0108 * narrow, round: 1.15 },
    { y: eyeY - 0.19 * L, proj: (0.0135 + 0.0065 * B) * Lp, hw: 0.0102 * narrow * (0.92 + 0.08 * W), round: 1.2 + 0.15 * Math.max(0, -B) },
    { y: eyeY - 0.29 * L, proj: (0.019 + 0.0022 * B) * Lp - 0.0015 * T, hw: 0.0118 * W, round: 1.55 },
    { y: eyeY - (0.355 - 0.04 * T) * L, proj: 0.0255 * Lp * knoll - 0.002 * T, hw: 0.0142 * W * knoll, round: 2.2 },
    { y: eyeY - (0.405 - 0.018 * T) * L, proj: (0.0172 - 0.0032 * T) * knoll, hw: 0.0108 * W * knoll, round: 1.9 },
    { y: eyeY - 0.43 * L, proj: 0.0016, hw: 0.0092 * W, round: 1.5 },
  ];
  const t = st[4]!, u = st[5]!;
  const wr = 0.0062 * W * knoll;
  return { st, wing: { y: (t.y * 0.35 + u.y * 0.65) + 0.004, x: t.hw * 0.86 + wr * 0.35, r: [wr, 0.0066 * Math.sqrt(L), 0.0092 * Math.sqrt(Lp)] } };
}

/** The nose: a lofted bridge-to-base form (sharp ridge and side walls up top, a rounded tip, the columella under it), the
 *  nostril wings with their openings, shaded so its length, width, bridge and tip read from the front as in profile. */
export function buildNose(k: ShapeKit, o: FaceOpts): void {
  const { hs, fp, col, detail } = o;
  if (o.look.fur) return buildMuzzle(k, o);
  const kh = hs.Hh / 0.12;
  const knoll = o.look.people === 'knollfolk' ? 1.25 : 1;
  const { st, wing } = noseStations(fp, hs.eyeY, knoll);
  const skin = shade(col.skin, 0.99);
  const ridge = mix(skin, new Color3(1, 0.97, 0.93), 0.1 + 0.06 * fp.bridge), wall = shade(skin, 0.93), under = shade(skin, 0.8);
  const nA = detail >= 0.9 ? 8 : detail >= 0.5 ? 5 : 4;
  const rows = detail >= 0.9 ? st : detail >= 0.5 ? [st[0]!, st[1]!, st[2]!, st[4]!, st[5]!, st[6]!] : [st[0]!, st[2]!, st[4]!, st[5]!, st[6]!];
  const P: V3[][] = [];
  for (const r of rows) {
    const row: V3[] = [];
    const base = hs.front(0, r.y, 0);
    for (let j = 0; j <= nA; j++) {
      const u = (j / nA) * 2 - 1, au = Math.abs(u);
      const x = u * r.hw * kh;
      const s = hs.front(x / hs.W, r.y, 0);
      const zz = s[2] + r.proj * kh * Math.pow(Math.max(0, 1 - Math.pow(au, r.round)), 1 / r.round) - 0.0012;
      row.push([x, base[1], Math.max(zz, s[2] - 0.0015)]);
    }
    P.push(row);
  }
  const nR = rows.length;
  k.grid('head', P, (i, j) => {
    const au = Math.abs((j / nA) * 2 - 1);
    if (i >= nR - 2) return i === nR - 1 ? under : au > 0.5 ? under : shade(skin, 0.88);   // the columella and the base
    if (i === nR - 3) return au < 0.5 ? mix(skin, ROSE, 0.08) : wall;                       // the tip
    return au < 0.3 && i > 0 ? ridge : au > 0.6 ? wall : skin;
  }, { noOcc: true, out: (i, j) => { const u = (j / nA) * 2 - 1; return [u * 1.2, i >= nR - 2 ? -0.8 : 0.1, 1 - 0.5 * Math.abs(u)]; } });
  // the nostril wings, the opening dark underneath and inside
  if (detail >= 0.35) {
    for (const sx of [-1, 1]) {
      const s = hs.front((sx * wing.x * kh) / hs.W, wing.y, 0);
      k.ellip('head', [s[0], s[1], s[2] + 0.0035 * kh], [wing.r[0] * kh, wing.r[1] * kh, wing.r[2] * kh], shade(skin, 0.96), { seg: detail >= 0.9 ? 8 : 6, lat: 4, noOcc: true, rot: [0.25, sx * 0.25, 0],
        paint: (_w, _uv, l) => (l.y < -0.45 && l.x * sx < 0.35 && l.z > -0.3 ? INK_SOFT : l.x * sx > 0.6 ? shade(skin, 0.86) : undefined) });
    }
  }
}
const INK_SOFT = new Color3(0.2, 0.11, 0.1);

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
/** The lips' measures (m, before the head's scale; pure, unit-tested): half width, the upper and lower lip's heights and
 *  how far each pushes out, the cupid's bow's peaks, and where the mouth line sits (head units). */
export interface LipShape { hw: number; upperH: number; lowerH: number; upperProj: number; lowerProj: number; bow: number; y: number }
export function lipShape(fp: Pick<FaceParams, 'mouthW' | 'upper' | 'lower2' | 'mouthY' | 'lipFull'>): LipShape {
  const full = fp.lipFull;
  return {
    hw: 0.0235 + 0.0078 * fp.mouthW,
    upperH: (0.0066 + 0.0032 * fp.upper) * full, lowerH: (0.0084 + 0.0038 * fp.lower2) * full,
    upperProj: (0.0034 + 0.0019 * fp.upper) * full, lowerProj: (0.004 + 0.0022 * fp.lower2) * full,
    bow: 0.2 + 0.08 * fp.upper, y: -0.565 + 0.05 * fp.mouthY,
  };
}

/** The two lips (natural or the lip colour): each a lofted form (the line, the pout, the vermilion border) blending into
 *  the skin, the cupid's bow, tucked corners, and a dark mouth line between them; on the `head` bone. */
export function buildMouth(k: ShapeKit, o: FaceOpts): void {
  const { hs, fp, col, detail } = o;
  if (o.look.fur) return;
  const kh = hs.Hh / 0.12;
  const L = lipShape(fp);
  const my = L.y, hw = L.hw * kh;
  const natural = mix(shade(col.skin, 0.84), ROSE, 0.34);
  const lip = col.lips ?? natural;
  const lineC = mix(lip, INK, 0.62);
  const upperH = L.upperH * kh, lowerH = L.lowerH * kh;
  const curve = (at: number) => at * at * 0.014;                 // the mouth's line curves back round the face
  if (detail < 0.5) {
    const pts: V3[] = [];
    const n = detail >= 0.35 ? 4 : 2;   // (far: three points)
    for (let i = 0; i <= n; i++) { const t = (i / n) * 2 - 1; pts.push(hs.front((t * hw) / hs.W, my + curve(Math.abs(t)), 0.0006)); }
    k.tube('head', pts, n === 4 ? [0.0012 * kh, upperH * 0.6, lowerH * 0.62, upperH * 0.6, 0.0012 * kh] : [0.0015 * kh, (upperH + lowerH) * 0.5, 0.0015 * kh], mix(lip, INK, 0.2), { seg: 3, noOcc: true });
    return;
  }
  const N = detail >= 0.9 ? 8 : 5;
  const lipGrid = (upper: boolean) => {
    const P: V3[][] = [];
    const proj = (upper ? L.upperProj : L.lowerProj) * kh;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * 2 - 1, at = Math.abs(t);
      const prof = Math.pow(Math.max(0, 1 - at * at), 0.5);
      // the cupid's bow: a dip in the middle of the upper lip, peaks either side; the lower lip fullest in the middle
      const h = (upper ? upperH * (1 - 0.24 * G(t, 0.1) + 0.1 * G(at - L.bow, 0.1)) : lowerH * (0.88 + 0.12 * G(t, 0.5))) * Math.max(0.08, prof);
      const lx = (t * hw) / hs.W, c = curve(at), sg = upper ? 1 : -1;
      const pout = proj * Math.pow(prof, 0.7);
      const tuck = -0.0012 * kh * sm((at - 0.75) / 0.25);           // the corners turn in
      const rowsAt: [number, number][] = upper
        ? [[0, -0.0004 + tuck], [0.32, pout * 0.95 + tuck], [0.72, pout * 0.82], [1, pout * 0.42], [1.35, 0.0003]]
        : [[0, -0.0004 + tuck], [0.4, pout + tuck], [0.8, pout * 0.7], [1, pout * 0.3], [1.3, -0.0002]];
      P.push((detail >= 0.9 ? rowsAt : [rowsAt[0]!, rowsAt[1]!, rowsAt[3]!, rowsAt[4]!]).map(([f, lift]) => hs.front(lx, my + sg * (h * f / hs.Hh) + c, lift)));
    }
    const skinLip = mix(lip, col.skin, 0.55);
    const nr = P[0]!.length;
    k.grid('head', P, (i, j0) => {
      const at = Math.abs((i / N) * 2 - 1);
      const j = nr === 5 ? j0 : [0, 1, 3, 4][j0]!;
      if (j === 0) return lineC;
      if (j === 4) return upper ? shade(col.skin, 0.97) : shade(col.skin, 0.88);   // the lower lip's shadow under it
      if (j === 3) return skinLip;
      const c = j === 1 ? (upper ? shade(lip, 0.88) : shade(lip, 1.06)) : lip;
      return at > 0.85 ? mix(c, lineC, 0.4) : c;
    }, { noOcc: true, out: (i, j) => { const t = (i / N) * 2 - 1; const n = hs.normal(...norm([(t * hw) / hs.W, my, 0.9])); return [n[0], n[1] + (upper ? 0.3 : -0.3) * (j / (nr - 1)), n[2]]; } });
  };
  lipGrid(true); lipGrid(false);
  if (detail >= 0.9) {
    // the mouth line: a thin dark crease from corner to corner, deeper at the corners
    const pts: V3[] = [], rad: number[] = [];
    for (let i = 0; i <= 6; i++) { const t = (i / 6) * 2 - 1, at = Math.abs(t); pts.push(hs.front((t * hw * 1.04) / hs.W, my + curve(at) - 0.002, 0.0002)); rad.push((0.0007 + 0.0004 * at) * kh); }
    k.tube('head', pts, rad, mix(lineC, INK, 0.4), { seg: 3, noOcc: true });
  }
}

// ───────── ears ─────────
/** The people's ears: round (Humans, Knollfolk), long and pointed (Larchfolk), or an animal ear (BRINDLE_EARS). */
export function buildEars(k: ShapeKit, o: FaceOpts): void {
  const { hs, fp, col, look, detail } = o;
  const kh = hs.Hh / 0.12;
  const sz = 1 + 0.22 * fp.earSize, out = 0.28 + 0.32 * fp.earAngle;
  const skin = shade(col.skin, 0.97), inner = mix(col.skin, ROSE, 0.3), bowl = shade(mix(col.skin, ROSE, 0.25), 0.72);
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
      const ec: V3 = [side[0] + sx * 0.004 * kh, side[1], side[2]];
      k.ellip('head', ec, [0.0075 * kh * e, 0.03 * kh * e, 0.018 * kh * e], skin,
        { seg, lat: 5, rot: [0.1, sx * out, sx * -0.12], noOcc: true, paint: (_w, _uv, l) => (l.x * sx > 0.2 && Math.abs(l.y) < 0.6 && l.z > -0.45 && l.z < 0.6 ? bowl : undefined) });
      if (detail >= 0.9) {
        // the helix: a rolled rim from the top front, over the back, down to the lobe
        const pts: V3[] = [];
        for (let i = 0; i <= 5; i++) {
          const th = (70 + (i / 5) * 200) * (Math.PI / 180), cz = Math.cos(th), sy = Math.sin(th);
          pts.push([ec[0] + sx * (0.0072 * kh * e + Math.max(0, -cz) * 0.018 * kh * e * Math.sin(out)), ec[1] + 0.028 * kh * e * sy, ec[2] + 0.0165 * kh * e * cz]);
        }
        k.tube('head', pts, [0.0012 * kh, 0.0024 * kh * e, 0.0026 * kh * e, 0.0026 * kh * e, 0.0028 * kh * e, 0.003 * kh * e], skin, { seg: 4, noOcc: true });
      }
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
  const full = detail >= 0.9;   // at med only the lines that read at that size (smile lines, the forehead's)
  if (age > 0 && !look.fur) {
    const lc = shade(col.skin, 0.8 - 0.03 * age), r = (0.0006 + 0.00025 * age) * kh;
    // smile lines from the nostril wings past the mouth's corners
    for (const sx of [-1, 1]) line([[sx * 0.2, -0.33], [sx * 0.29, -0.47], [sx * 0.31, -0.6]], r, lc);
    if (age >= 2) {
      if (full) for (const sx of [-1, 1]) { // crow's feet
        line([[sx * (hs.eyeX + 0.24), hs.eyeY + 0.05], [sx * (hs.eyeX + 0.33), hs.eyeY + 0.09]], r * 0.8, lc);
        line([[sx * (hs.eyeX + 0.24), hs.eyeY - 0.02], [sx * (hs.eyeX + 0.33), hs.eyeY - 0.06]], r * 0.8, lc);
      }
      line([[-0.3, 0.6], [0, 0.63], [0.3, 0.6]], r, lc);   // the forehead
    }
    if (age >= 3) {
      line([[-0.26, 0.7], [0, 0.73], [0.26, 0.7]], r * 0.9, lc);
      if (full) for (const sx of [-1, 1]) line([[sx * (hs.eyeX - 0.15), hs.eyeY - 0.13], [sx * hs.eyeX, hs.eyeY - 0.17], [sx * (hs.eyeX + 0.14), hs.eyeY - 0.13]], r * 0.8, lc); // under the eyes
    }
    if (age >= 4 && full) for (const sx of [-1, 1]) line([[sx * 0.32, -0.66], [sx * 0.36, -0.8]], r, lc); // the jowls
  }
  // freckles: dots over the nose and cheeks, more with the slider (a fixed scatter, so they never crawl)
  const fr = look.skin.freckles;
  if (fr > 0) {
    const n = full ? [0, 8, 13, 19, 25][fr]! : 0;   // (med: painted on the skull instead)
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
    k.ellip('head', hs.front(-s.x * 0.85, s.y * 0.78, 0.0006), [0.0026 * kh, 0.0026 * kh, 0.0016 * kh], shade(mix(col.skin, new Color3(0.25, 0.15, 0.1), 0.75), 0.9), { seg: full ? 5 : 3, lat: full ? 3 : 2, noOcc: true });
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
