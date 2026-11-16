// Look v2's hair (all 44 HAIR_STYLES), facial hair (all 14 FACIAL_HAIR, on any body) and the scalp, built in code
// over the face2.ts head surface so every style hugs every skull. Building blocks: a shell offset from the skull
// (its hairline from HAIRLINES, its volume and texture from HAIR_STYLE_INFO: straight, wavy, curly, tightly coiled),
// a curtain of hanging hair (to the jaw, the shoulders, the back or the waist, framing the face and draping the
// back), locks, tails, buns, braids, puffs, locs and twists. Colours: the hair colour with its grey, `colour2` on the
// tips and streaks.
// Bones: the close cap rides `head`; volume a hood or helm would swallow (an afro, crowns, buns, quiffs, crests, high
// tails) rides `hair` (character.ts hides it under headgear: the scalp keeps the hair's colour painted, so a hidden
// style still reads as hair at the hood's edge); long hanging hair and braids ride `hairB`, the spring at the nape.
import { Color3 } from '@babylonjs/core';
import { HAIR_STYLE_INFO, type HairTexture, type Look } from '@sg2/shared';
import type { ShapeKit, V3 } from './character';
import { GREY_HAIR, greyAmount, type Frame, type LookColours } from './look';
import { dirOf, norm, type HeadShape } from './face2';

const mix = (a: Color3, b: Color3, t: number) => Color3.Lerp(a, b, Math.max(0, Math.min(1, t)));
const shade = (c: Color3, f: number) => new Color3(Math.min(1, c.r * f), Math.min(1, c.g * f), Math.min(1, c.b * f));
const sm = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
const G = (x: number, s: number) => Math.exp(-(x * x) / (s * s));
type J = 'head' | 'hair' | 'hairB';

/** Styles whose long hair swings on the nape spring (character.ts). */
export const LONG_HAIR: ReadonlySet<number> = new Set(HAIR_STYLE_INFO.flatMap((h, i) => (h.length === 'long' ? [i] : [])));

export interface HairOpts { look: Look; frame: Frame; col: LookColours; hs: HeadShape; detail: number; tie: Color3 }

/** The front hairline's height (unit head y) at unit x, by HAIRLINES (natural, straight, widow's peak, receding, high) and the forehead. */
function hairlineY(hairline: number, x: number, forehead: number): number {
  const ax = Math.abs(x);
  const base = 0.5 + 0.07 * forehead;
  switch (hairline) {
    case 1: return base + 0.02;
    case 2: return base + 0.05 - 0.11 * Math.max(0, 1 - ax / 0.16) + 0.08 * Math.min(1, ax / 0.4);
    case 3: return base + 0.05 + 0.26 * Math.exp(-((ax - 0.42) ** 2) / 0.03) - 0.02 * Math.max(0, 1 - ax / 0.15);
    case 4: return base + 0.17;
    default: return base + 0.05 * ax * ax;
  }
}

/** How much a skull direction is under hair (0 bare .. 1 covered): the face window, the ears and the nape. */
export function coverage(look: Look, nape = -0.42, sides = 'ear' as 'ear' | 'low', fh = 0): (d: V3) => number {
  return (d) => {
    const [x, y, z] = d;
    if (z > 0.1) {
      // the face: under the hairline is bare; the temples curve down in front of the ears
      const edge = hairlineY(look.hair.hairline, x, fh) - (Math.abs(x) > 0.62 ? (Math.abs(x) - 0.62) * (sides === 'low' ? 2.2 : 1.6) : 0);
      const front = sm((z - 0.1) / 0.25);
      const bare = sm((edge - y) / 0.07) * front;
      if (bare > 0.999) return 0;
      const ear = sides === 'ear' ? sm((0.1 - y) / 0.08) * sm((Math.abs(x) - 0.7) / 0.1) * sm((z + 0.3) / 0.3) : 0;
      const n = sm((y - nape) / 0.08);
      return Math.max(0, Math.min(1 - bare, 1 - ear, n));
    }
    const ear = sides === 'ear' ? sm((0.1 - y) / 0.08) * sm((Math.abs(x) - 0.7) / 0.1) * sm((z + 0.35) / 0.3) : 0;
    return Math.max(0, Math.min(1 - ear, sm((y - nape) / 0.08)));
  };
}
const noise = (d: V3, f: number) => Math.sin(d[0] * f + 1.3) * Math.sin(d[1] * f * 1.13 + 0.7) * Math.sin(d[2] * f * 0.91 + 2.1);
const texAmp = (t: HairTexture) => (t === 'coiled' ? 1 : t === 'curly' ? 0.6 : t === 'wavy' ? 0.2 : 0);

/** The scalp's hair colour (0..1) for the skull's paint: shaved and buzzed heads show it, hair styles show it under their shell. */
export function scalpPaint(look: Look): ((d: V3) => number) | null {
  const info = HAIR_STYLE_INFO[look.hair.style]!;
  const s = look.hair.style;
  if (info.length === 'bald') return null;
  const cov = coverage(look, -0.42);
  const k = s === 21 ? 0.4 : s === 20 ? 0.72 : 0.95;           // shaved: a shadow; buzz: a short pile; under a style: its colour
  const sidesShaved = s === 16 || s === 17 || s === 23 || s === 42;
  return (d) => {
    let c = cov(d) * k;
    if (sidesShaved && Math.abs(d[0]) > 0.45 && d[1] < 0.6) c *= 0.4;
    return c;
  };
}
/** Stubble on the jaw and upper lip (FACIAL_HAIR 1), and the shadow under any beard. */
export function stubblePaint(look: Look): ((d: V3) => number) | null {
  const f = look.hair.facial;
  if (f === 0 || look.fur) return null;
  const amt = f === 1 ? 0.5 : 0.8;   // under a beard: nearly its colour, so its thin edges never show skin patches
  return (d) => {
    const [x, y, z] = d;
    if (z < -0.25 || y > -0.12) return 0;
    if (Math.abs(x) < 0.3 && y > -0.66 && y < -0.5) return 0;      // the lips
    // under a beard only just round its line (a broad grey band above a beard read as patches on the cheeks)
    const under = f >= 2 && f !== 6 ? sm((-0.1 - 0.36 * Math.max(0, 1 - Math.abs(x) / 0.85) + 0.04 - y) / 0.08) : 1;
    return amt * under * sm((-y - 0.12) / 0.12) * sm((z + 0.25) / 0.2) * (f === 6 ? (Math.abs(x) > 0.7 ? 1 : 0) : 1);
  };
}

/** Builds the look's hair style. */
export function buildHair(k: ShapeKit, o: HairOpts): void {
  const { look, hs, col, detail, frame } = o;
  const s = look.hair.style, info = HAIR_STYLE_INFO[s]!;
  if (info.length === 'bald' || info.length === 'shaved') return;
  const kh = hs.Hh / 0.12;
  const hc = col.hair, h2 = col.hair2;
  const grey = greyAmount(look.hair.grey);
  const tex = info.texture;
  const fh = 0;
  const lo = detail < 0.5, mid = detail < 0.9;   // (mid: med and below — the heaviest styles thin out to stay near the mean)
  const R = (n: number, min: number) => Math.max(min, Math.round(n * (detail >= 0.9 ? 0.7 : detail >= 0.5 ? 0.46 : detail >= 0.3 ? 0.38 : 0.3)));
  // ── building blocks ──
  /** A point on the skull in direction d, `out` m off it along the normal (model space). */
  const at = (d: V3, out: number): V3 => { const dd = norm(d), p = hs.local(...dd), n = hs.normal(...dd); return [p[0] + n[0] * out, hs.cy + p[1] + n[1] * out, hs.cz + p[2] + n[2] * out]; };
  /** A shell over the skull: `vol(d)` m of hair where covered (inside the skull elsewhere). */
  const shell = (j: J, vol: (d: V3) => number, cov: (d: V3) => number, thMax = 2.2, amp = texAmp(tex), seg = R(26, 10), lat = R(13, 6)) => {
    const P: V3[][] = [];
    const C: Color3[][] = [];
    for (let i = 0; i <= lat; i++) {
      const th = (thMax * i) / lat, row: V3[] = [], cr: Color3[] = [];
      for (let jj = 0; jj < seg; jj++) {
        const d = dirOf(Math.max(0.001, th), (Math.PI * 2 * jj) / seg);
        const c = cov(d);
        const bump = amp > 0 ? (0.5 + 0.5 * noise(d, tex === 'coiled' ? 23 : 15)) * amp * 0.008 * kh : 0;
        // the edge slopes into the skull over a band (a step between neighbours left a torn, patchy hairline)
        const out = (c > 0.02 ? (vol(d) + bump) * Math.pow(c, 0.6) : 0) + (-0.004 + 0.0052 * sm(c / 0.2)) * kh;
        row.push(at(d, out));
        // the shine on the crown and the strands' texture (quieter as the hair greys: grey hair has less contrast)
        let cc = shade(hc, 0.94 + 0.12 * Math.max(0, d[1]) + (1 - 0.7 * grey) * (amp > 0 ? 0.08 * noise(d, 31) : 0.03 * Math.sin(dirAng(d) * 22)));
        if (grey > 0) cc = mix(cc, GREY_HAIR, grey * 0.35 * G(Math.abs(d[0]) - 0.85, 0.22) * G(d[1] - 0.05, 0.35));   // the temples turn first
        if (h2 && Math.sin(dirAng(d) * 5 + d[1] * 2) > 0.62 && d[1] > -0.2) cc = mix(cc, h2, 0.8);
        cr.push(cc);
      }
      P.push(row); C.push(cr);
    }
    k.grid(j, P, (i, jj) => C[i]![jj]!, { wrap: true, noOcc: true });
  };
  const capCov = (nape: number, sides: 'ear' | 'low' = 'ear') => coverage(look, nape, sides, fh);
  /** A close cap: `top` m of volume on the crown, `side` m at the sides and back. */
  const cap = (top: number, side: number, nape = -0.42, j: J = 'head', sides: 'ear' | 'low' = 'ear', back = side) =>
    shell(j, (d) => (side + (top - side) * sm((d[1] - 0.1) / 0.6)) * kh * (d[2] < 0 ? lerpN(1, back / Math.max(1e-4, side), -d[2]) : 1), capCov(nape, sides));
  /** A tapering lock through head-space points [dir x, dir y, dir z, out (m at kh 1)]. */
  const lock = (pts: [number, number, number, number][], r: number, j: J = 'head', tipCol = true) => {
    const P = pts.map(([x, y, z, out]) => at([x, y, z], out * kh));
    const rad = P.map((_, i) => (i === P.length - 1 ? 0.0012 * kh : r * kh * (1 - (i / P.length) * 0.5)));
    k.tube(j, P, rad, h2 && tipCol ? hc : hc, { seg: lo ? 4 : 6, noOcc: true, paint: h2 && tipCol ? (_w, uv) => (uv[1] > 0.6 ? h2 : undefined) : undefined });
  };
  /** A round mass at head direction d (a bun, a puff, a knot). */
  const ball = (d: V3, out: number, r: V3, j: J = 'hair', amp = 0) => {
    const c = at(d, out * kh);
    k.ellip(j, c, [r[0] * kh, r[1] * kh, r[2] * kh], hc, { seg: R(10, 6), lat: R(7, 4), noOcc: true,
      deform: amp > 0 ? (l) => { const n = 1 + amp * 0.12 * Math.sin(l.x * 9 + 1) * Math.sin(l.y * 8) * Math.sin(l.z * 10 + 2); l.x *= n; l.y *= n; l.z *= n; } : undefined,
      paint: h2 ? (_w, _uv, l) => (l.y < -0.3 ? h2 : undefined) : undefined });
  };
  /** A braid: beads down a path, alternately shaded so the plaits read, with a tie. */
  const braid = (pts: V3[], r: number, j: J = 'hairB') => {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(1, n - 1), rr = r * kh * (1 - t * 0.35);
      if (lo && i % 2 === 1 && i < n - 1) continue; // half the plaits far off: the braid still reads
      k.ellip(j, pts[i]!, [rr, rr * (lo ? 1.6 : 1.2), rr * 0.9], i % 2 ? shade(hc, 0.84) : h2 && t > 0.6 ? h2 : hc, { seg: lo ? 4 : 6, lat: lo ? 2 : 3, noOcc: true });
    }
    const end = pts[n - 1]!;
    k.ellip(j, [end[0], end[1] - r * kh, end[2]], [r * 0.45 * kh, r * 0.45 * kh, r * 0.45 * kh], o.tie, { seg: 5, lat: 3, noOcc: true });
    k.tube(j, [[end[0], end[1] - r * 1.1 * kh, end[2]], [end[0], end[1] - r * 2.8 * kh, end[2] - 0.004]], [r * 0.55 * kh, 0.0015], hc, { seg: 4, noOcc: true });
  };
  const line = (a: V3, b: V3, n: number): V3[] => Array.from({ length: n }, (_, i) => { const t = i / (n - 1); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; });
  /** Hair hanging from the head to `endY` (m): framing the face (span: how far round to the front) and draping the back. */
  const curtain = (endY: number, opts: { span?: number; vol?: number; t?: HairTexture; front?: boolean; flare?: number } = {}) => {
    const span = opts.span ?? 0.6, vol = (opts.vol ?? 0.012) * kh, t = opts.t ?? tex, flare = opts.flare ?? 0;
    const amp = texAmp(t);
    const top = hs.cy + 0.15 * hs.Hh, chin = hs.cy - 0.85 * hs.Hh;
    const rows = lo || !mid ? R(9, 5) : 4, cols = R(13, 7);
    const ringX = Math.min(frame.chestW + 0.022, frame.shX - frame.uArmR * 1.25), ringZ = frame.chestD + 0.075 * (frame.H / 1.75) + frame.bust * 0.02;
    const outer: V3[][] = [], inner: V3[][] = [];
    for (let i = 0; i <= rows; i++) {
      const tt = i / rows;
      const y = top + (endY - top) * tt;
      const ro: V3[] = [], ri: V3[] = [];
      for (let j = 0; j <= cols; j++) {
        const u = (j / cols) * 2 - 1;                          // −1 .. 1 round the back
        let ph = Math.PI + u * Math.PI * span;
        const below = y < chin ? sm((chin - y) / Math.max(0.05, chin - frame.shTopY)) : 0;
        ph = Math.PI + (ph - Math.PI) * (1 - 0.25 * below);
        const wave = amp > 0 ? Math.sin(tt * Math.PI * (t === 'wavy' ? 5 : 9) + u * 4) * amp * 0.012 * kh * (0.3 + tt) : 0;
        const lump = t === 'curly' || t === 'coiled' ? (0.5 + 0.5 * noise([u * 3, tt * 6, 1], 5)) * 0.012 * kh * amp : 0;
        const grow = vol + lump + wave + flare * tt * 0.06 * kh;
        let p: V3;
        if (y >= chin) {
          const ly = Math.max(-0.97, Math.min(0.97, (y - hs.cy) / hs.Hh));
          const th = Math.acos(ly);
          const d = dirOf(th, ph), q = hs.local(...d), n = hs.normal(...d);
          const off = grow + 0.004 * kh;
          p = [q[0] + n[0] * off, hs.cy + q[1] + n[1] * off, hs.cz + q[2] + n[2] * off];
          p[1] = y;
        } else {
          const th = Math.acos(-0.97);
          const d = dirOf(th, ph), q = hs.local(...d), n = hs.normal(...d);
          const c0: V3 = [q[0] + n[0] * (grow + 0.004 * kh), y, hs.cz + q[2] + n[2] * (grow + 0.004 * kh)];
          const sx = Math.sin(ph), cz = Math.cos(ph);
          const body: V3 = [sx * (ringX + grow), y, cz < 0 ? cz * (ringZ + grow) : cz * (frame.chestD * 0.35 + grow)];
          const b = sm((chin - y) / Math.max(0.04, chin - frame.shY));
          p = [c0[0] + (body[0] - c0[0]) * b, y, c0[2] + (body[2] - c0[2]) * b];
        }
        ro.push(p);
        const inw = 0.006 * kh + vol * 0.4;
        const rr = Math.hypot(p[0], p[2] - hs.cz) || 1;
        ri.push([p[0] - (p[0] / rr) * inw, p[1], p[2] - ((p[2] - hs.cz) / rr) * inw]);
      }
      outer.push(ro); inner.push(ri);
    }
    const colAt = (i: number, j: number) => {
      const tt = i / rows;
      let c = shade(hc, 0.9 + 0.1 * Math.cos(j * 1.7) * (amp > 0 ? 1 : 0.5) + 0.08 * (1 - tt));
      if (h2 && tt > 0.62) c = mix(c, h2, sm((tt - 0.62) / 0.2));
      return c;
    };
    k.grid('hairB', outer, colAt, { noOcc: true, out: (i, j) => { const p = outer[i]![j]!; return [p[0], 0, p[2] - hs.cz]; } });
    // the curtain's inside: only where it can be seen up close (far off, its back faces are rarely in view)
    if (!lo) k.grid('hairB', inner, (i, j) => shade(colAt(i, j), 0.72), { noOcc: true, out: (i, j) => { const p = inner[i]![j]!; return [-p[0], 0, -(p[2] - hs.cz)]; } });
    if (opts.front && !lo) {
      // locks over the shoulders, in front
      for (const sx of [-1, 1]) {
        const a = at([sx * 0.85, 0.05, 0.15], 0.012 * kh);
        const b: V3 = [sx * (frame.headW * 1.02 + 0.01), hs.cy - 0.9 * hs.Hh, hs.cz - 0.01];
        const c: V3 = [sx * frame.shX * 0.62, frame.shTopY + 0.03, frame.chestD * 0.35];
        const d: V3 = [sx * Math.min(frame.chestW * 0.72, frame.shX * 0.6), Math.max(endY, frame.chestY - 0.06), frame.chestD + 0.025 + frame.bust * 0.035];
        k.tube('hairB', [a, b, c, d], [0.022 * kh, 0.026 * kh, 0.028 * kh, 0.014 * kh], hc, { seg: mid ? 4 : 6, flatten: 0.5, noOcc: true, paint: h2 ? (_w, uv) => (uv[1] > 0.6 ? h2 : undefined) : undefined });
      }
    }
  };
  const nape = hs.cy - 0.75 * hs.Hh;
  const backY = (t: number) => frame.shY + (frame.waistY - frame.shY) * t;   // 0 the shoulders … 1 the waist
  // ── the styles ──
  switch (s) {
    case 1: cap(0.007, 0.005); break;                                                                   // Close crop
    case 2: cap(0.012, 0.008, -0.45);                                                                   // Tousled
      for (let i = 0; i < (lo ? 4 : 8); i++) { const a = (i / 8) * Math.PI * 2; lock([[Math.sin(a) * 0.2, 0.96, Math.cos(a) * 0.2, 0.008], [Math.sin(a) * 0.5, 0.82, Math.cos(a) * 0.5 + 0.1, 0.02], [Math.sin(a) * 0.72, 0.6 - (i % 2) * 0.1, Math.cos(a) * 0.72 + 0.15, 0.016]], 0.012, 'hair'); }
      break;
    case 3: cap(0.012, 0.007);                                                                          // Side part
      lock([[-0.3, 0.9, 0.3, 0.012], [0.05, 0.86, 0.5, 0.02], [0.4, 0.72, 0.55, 0.016], [0.7, 0.5, 0.45, 0.008]], 0.016);
      break;
    case 4: cap(0.02, 0.01, -0.5, 'head', 'ear', 0.014);                                                // Swept back
      for (const x of [-0.3, -0.1, 0.1, 0.3]) lock([[x, 0.6, 0.75, 0.012], [x, 0.95, 0.25, 0.024], [x * 1.1, 0.7, -0.6, 0.02], [x, 0.2, -0.95, 0.01]], 0.014, 'hair');
      break;
    case 5: cap(0.02, 0.014, -0.55); curtain(hs.cy - 0.75 * hs.Hh, { span: 0.62, t: 'wavy', vol: 0.016 });   // Shaggy
      lock([[-0.4, 0.85, 0.35, 0.016], [0, 0.72, 0.65, 0.022], [0.35, 0.52, 0.72, 0.012]], 0.016); break;
    case 6: cap(0.012, 0.01, -0.6, 'head', 'low'); curtain(backY(0.45), { span: 0.62, front: true }); break;   // Long loose
    case 7: cap(0.01, 0.008, -0.5, 'head', 'low');                                                      // Low tail
      { const a = at([0, -0.5, -1], 0.01 * kh); ball([0, -0.5, -1], 0.012, [0.022, 0.022, 0.02], 'head');
        k.tube('hairB', [a, [0, a[1] - 0.05 * kh, a[2] - 0.02 * kh], [0, backY(0.3), -(frame.chestD + 0.04)]], [0.024 * kh, 0.022 * kh, 0.006 * kh], hc, { seg: 7, noOcc: true, paint: h2 ? (_w, uv) => (uv[1] > 0.6 ? h2 : undefined) : undefined }); }
      break;
    case 8: cap(0.012, 0.008, -0.45, 'head', 'low');                                                    // High tail
      { const a = at([0, 0.55, -0.85], 0.014 * kh); ball([0, 0.55, -0.85], 0.014, [0.024, 0.024, 0.022], 'hair');
        k.tube('hair', [a, [0, a[1] + 0.02 * kh, a[2] - 0.05 * kh], [0, hs.cy - 0.4 * hs.Hh, hs.cz - hs.D * 1.45], [0, frame.shY - 0.02, -(frame.chestD + 0.05)]], [0.026 * kh, 0.03 * kh, 0.024 * kh, 0.006 * kh], hc, { seg: 7, noOcc: true, paint: h2 ? (_w, uv) => (uv[1] > 0.6 ? h2 : undefined) : undefined }); }
      break;
    case 9: cap(0.012, 0.008, -0.45); ball([0, 1, -0.1], 0.03, [0.035, 0.03, 0.035]); break;            // Topknot
    case 10: cap(0.012, 0.008, -0.45); for (const sx of [-1, 1]) ball([sx * 0.62, 0.72, -0.15], 0.026, [0.032, 0.03, 0.032]); break;  // Twin buns
    case 11: cap(0.011, 0.009, -0.5, 'head', 'low');                                                    // Single braid
      braid(line(at([0, -0.55, -0.95], 0.012 * kh), [0, backY(0.55), -(frame.chestD + 0.035)], lo ? 5 : 8), 0.02); break;
    case 12: cap(0.011, 0.009, -0.5, 'head', 'low');                                                    // Twin braids, in front of the shoulders
      for (const sx of [-1, 1]) { const a = at([sx * 0.85, -0.35, -0.15], 0.01 * kh); braid(line(a, [sx * Math.min(frame.chestW * 0.8, frame.shX * 0.72), frame.chestY - 0.06, frame.chestD * 0.7 + 0.02 + frame.bust * 0.03], lo ? 5 : 7), 0.017); }
      break;
    case 13: cap(0.012, 0.01, -0.5);                                                                     // Braid hood: two braids over the crown
      for (const sx of [-1, 1]) { const pts: V3[] = []; for (let i = 0; i <= 7; i++) { const t = i / 7; pts.push(at(dirOf(0.25 + t * 1.6, sx * 1.15 - sx * t * 0.6), 0.016 * kh)); } braid(pts, 0.016, 'head'); }
      break;
    case 14: cap(0.026, 0.02, -0.55, 'hair'); if (!mid) cap(0.006, 0.006, -0.5); curtain(hs.cy - 1.15 * hs.Hh, { span: 0.62, vol: 0.022, t: 'curly' }); break;  // Curls
    case 15: cap(0.008, 0.006, -0.45); cap(0.045, 0.035, -0.5, 'hair'); break;                                                // Coils
    case 16: cap(0.02, 0.0, -0.1, 'head'); break;                                                                             // Shaved sides
    case 17: for (let i = 0; i < (lo ? 4 : 7); i++) { const t = i / 6, a = 0.7 - t * 2.3;                                     // Crest
      lock([[0, Math.cos(a), Math.sin(a), 0.004], [0, Math.cos(a - 0.12), Math.sin(a - 0.12), 0.055 - Math.abs(t - 0.35) * 0.04]], 0.018, 'hair', true); }
      shell('head', () => 0.004 * kh, (d) => (Math.abs(d[0]) < 0.22 ? coverage(look, -0.3)(d) : 0)); break;
    case 18: cap(0.014, 0.012, -0.6, 'head', 'low'); curtain(hs.cy - 0.95 * hs.Hh, { span: 0.72, vol: 0.016 });                // Bob, with a fringe
      fringe(0.012); break;
    case 19: cap(0.018, 0.012, -0.55, 'head', 'ear');                                                                         // Windswept
      for (let i = 0; i < (lo ? 3 : 6); i++) { const z = 0.6 - i * 0.28; lock([[-0.5, 0.75, z, 0.012], [0.1, 0.92, z - 0.05, 0.03], [0.65, 0.65, z - 0.15, 0.028], [0.95, 0.35, z - 0.25, 0.012]], 0.016, 'hair'); }
      curtain(hs.cy - 0.8 * hs.Hh, { span: 0.5, t: 'wavy', vol: 0.014 }); break;
    case 22: cap(0.012, 0.006, -0.45); break;                                                                                // Crew cut
    case 23: cap(0.024, 0.0, -0.05, 'head');                                                                                 // Undercut
      lock([[-0.25, 0.85, 0.45, 0.02], [0.1, 0.82, 0.6, 0.03], [0.45, 0.62, 0.62, 0.018]], 0.018, 'hair'); break;
    case 24: cap(0.01, 0.006, -0.45);                                                                                        // Pompadour
      for (const x of [-0.25, 0, 0.25]) lock([[x, 0.55, 0.8, 0.02], [x * 0.9, 0.85, 0.65, 0.06], [x * 0.8, 1, 0.1, 0.04], [x * 0.7, 0.85, -0.5, 0.014]], 0.026, 'hair');
      break;
    case 25: cap(0.014, 0.012, -0.6, 'head', 'low'); curtain(hs.cy - 1.05 * hs.Hh, { span: 0.66, vol: 0.016 });                 // Curtains: a middle part
      for (const sx of [-1, 1]) lock([[sx * 0.05, 0.9, 0.42, 0.012], [sx * 0.35, 0.72, 0.65, 0.02], [sx * 0.68, 0.3, 0.68, 0.016], [sx * 0.85, -0.1, 0.45, 0.008]], 0.016);
      break;
    case 26: cap(0.014, 0.007, -0.42);                                                                                       // Pixie
      lock([[-0.35, 0.92, 0.2, 0.014], [0.05, 0.78, 0.62, 0.02], [0.45, 0.58, 0.72, 0.012]], 0.017); break;
    case 27: cap(0.014, 0.012, -0.6, 'head', 'low'); curtain(frame.shTopY + 0.01, { span: 0.68, t: 'wavy', vol: 0.016 });     // Long bob
      lock([[-0.25, 0.92, 0.25, 0.014], [0.2, 0.8, 0.55, 0.02], [0.6, 0.55, 0.65, 0.014]], 0.016); break;
    case 28: cap(0.016, 0.013, -0.6, 'head', 'low'); curtain(frame.shY - 0.05, { span: 0.66, t: 'wavy', vol: 0.018, front: true }); break; // Shoulder waves
    case 29: cap(0.012, 0.01, -0.6, 'head', 'low'); curtain(backY(1), { span: 0.62, front: true }); break;                    // Very long
    case 30: cap(0.016, 0.013, -0.6, 'head', 'low'); curtain(backY(0.55), { span: 0.64, t: 'wavy', vol: 0.018, front: true }); break; // Long waves
    case 31: cap(0.03, 0.024, -0.6, 'hair', 'low'); curtain(backY(0.5), { span: 0.66, t: 'curly', vol: 0.03, flare: 0.6 }); break; // Long curls
    case 32: cap(0.016, 0.012, -0.5, 'head', 'low');                                                                         // Curly tail
      ball([0, -0.35, -1], 0.04, [0.05, 0.06, 0.045], 'hairB', 1); break;
    case 33: cap(0.012, 0.01, -0.5, 'head', 'low');                                                                           // Crown braid
      { const pts: V3[] = []; for (let i = 0; i <= (lo ? 10 : 16); i++) { const ph = (i / (lo ? 10 : 16)) * Math.PI * 2; pts.push(at(dirOf(0.95, ph), 0.018 * kh)); } braid(pts, 0.017, 'head'); }
      break;
    case 34: cap(0.004, 0.004, -0.45);                                                                                       // Cornrows
      for (let i = 0; i < (lo ? 4 : 7); i++) { const x = (i / 6) * 2 - 1; const pts: V3[] = []; for (let t = 0; t <= 6; t++) { const a = 0.72 - (t / 6) * 2.9; pts.push(at([x * 0.55, Math.cos(a), Math.sin(a)], 0.006 * kh)); }
        k.tube('head', pts, 0.0055 * kh, shade(hc, i % 2 ? 0.9 : 1.05), { seg: 4, noOcc: true }); }
      break;
    case 35: cap(0.012, 0.01, -0.5, 'head', 'low');                                                                           // Box braids
      for (let i = 0, nb = lo ? 6 : mid ? 8 : 12; i < nb; i++) { const a = Math.PI * (0.45 + (i / (nb - 1)) * 1.1); const st = at(dirOf(1.75, a), 0.01 * kh);
        const sx = Math.sin(a), cz = Math.cos(a); const end: V3 = [sx * Math.min(frame.chestW + 0.03, frame.shX - frame.uArmR * 1.3), backY(0.5) - (i % 3) * 0.03, cz < 0 ? cz * (frame.chestD + 0.04) : cz * 0.05];
        k.tube('hairB', [st, [st[0] * 1.08, nape - 0.02, st[2] * 1.12 - 0.01], end], [0.008 * kh, 0.0075 * kh, 0.006 * kh], i % 2 ? hc : shade(hc, 0.85), { seg: 4, noOcc: true, paint: h2 ? (_w, uv) => (uv[1] > 0.7 ? h2 : undefined) : undefined }); }
      break;
    case 36: cap(0.008, 0.006, -0.45); shell('hair', (d) => (0.085 + 0.02 * d[1] - (d[2] > 0.2 ? 0.02 : 0)) * kh, coverage(look, -0.55, 'ear'), 2.2, 1.1); break; // Rounded afro
    case 37: cap(0.007, 0.006, -0.45); for (const sx of [-1, 1]) ball([sx * 0.6, 0.75, -0.1], 0.045, [0.05, 0.048, 0.05], 'hair', 1); break; // Twin puffs
    case 38: cap(0.014, 0.012, -0.5, 'head', 'low');                                                                          // Locs
      for (let i = 0, nl = lo ? 6 : mid ? 8 : 11; i < nl; i++) { const a = Math.PI * (0.4 + (i / (nl - 1)) * 1.2); const st = at(dirOf(1.6, a), 0.012 * kh);
        const sx = Math.sin(a), cz = Math.cos(a); const end: V3 = [sx * Math.min(frame.chestW + 0.03, frame.shX - frame.uArmR * 1.3), frame.shY - 0.08 - (i % 3) * 0.03, cz < 0 ? cz * (frame.chestD + 0.04) : cz * 0.05];
        k.tube('hairB', [st, [st[0] * 1.1, nape, st[2] * 1.12], end], [0.012 * kh, 0.011 * kh, 0.008 * kh], i % 2 ? hc : shade(hc, 0.86), { seg: 5, noOcc: true, paint: h2 ? (_w, uv) => (uv[1] > 0.7 ? h2 : undefined) : undefined }); }
      break;
    case 39: cap(0.008, 0.006, -0.45);                                                                                       // Short twists
      for (let i = 0; i < (lo ? 10 : 22); i++) { const a = Math.sin(i * 12.9898) * 43758.5453, b = Math.sin(i * 78.233) * 9631.7; const th = 0.15 + (a - Math.floor(a)) * 1.25, ph = (b - Math.floor(b)) * Math.PI * 2;
        const d = dirOf(th, ph); const cv = coverage(look, -0.4)(d); if (cv < 0.6) continue; const p0 = at(d, 0.004 * kh), p1 = at(d, 0.03 * kh);
        k.tube('hair', [p0, p1], [0.008 * kh, 0.004 * kh], i % 2 ? hc : shade(hc, 0.85), { seg: 4, noOcc: true }); }
      break;
    case 40: cap(0.004, 0.004, -0.45);                                                                                       // Knot crown (Bantu knots)
      for (const [th, ph] of [[0.15, 0], [0.75, 0.6], [0.75, -0.6], [0.8, Math.PI * 0.75], [0.8, -Math.PI * 0.75], [1.1, Math.PI]] as [number, number][]) ball(dirOf(th, ph), 0.02, [0.022, 0.02, 0.022], 'hair', 0.6);
      break;
    case 41: cap(0.006, 0.004, -0.45); cap(0.034, 0.004, -0.2, 'hair'); break;                                             // Tapered coils
    case 42: cap(0.012, 0.004, -0.42);                                                                                       // Ridge cut: a flat top over short sides
      shell('hair', (d) => (d[1] > 0.55 ? 0.028 : 0.006) * kh, (d) => (d[1] > 0.4 ? coverage(look, -0.3)(d) : 0), 1.2, 0); break;
    case 43: cap(0.016, 0.013, -0.6, 'head', 'low'); curtain(backY(0.35), { span: 0.62, t: 'wavy', vol: 0.016 });            // Half up
      ball([0, 0.35, -0.95], 0.018, [0.026, 0.024, 0.022], 'hair'); break;
    default: cap(0.01, 0.008); break;
  }

  /** A full fringe across the forehead down to the brows (the Bob). */
  function fringe(v: number) {
    const P: V3[][] = [];
    const n = R(9, 5);
    for (let i = 0; i <= 2; i++) {
      const row: V3[] = [];
      for (let j = 0; j <= n; j++) {
        const x = ((j / n) * 2 - 1) * 0.72;
        const y = [0.85, 0.6, hs.eyeY + 0.3][i]!;
        row.push(at([x, y, Math.sqrt(Math.max(0.05, 1 - x * x - y * y))], (v + (i === 2 ? 0.002 : 0.006)) * kh));
      }
      P.push(row);
    }
    k.grid('head', P, (i) => shade(hc, 1.02 - i * 0.04), { noOcc: true, out: (i, j) => hs.normal(...norm([((j / n) * 2 - 1) * 0.72, [0.85, 0.6, hs.eyeY + 0.3][i]!, 0.8])) });
  }
}
function lerpN(a: number, b: number, t: number) { return a + (b - a) * Math.max(0, Math.min(1, t)); }
const dirAng = (d: V3) => Math.atan2(d[0], d[2]);

/** FACIAL_HAIR on any body: shells over the jaw, chin and lip by mask, moustaches as locks, braids and long beards. */
export function buildFacialHair(k: ShapeKit, o: HairOpts): void {
  const { look, hs, col, detail } = o;
  const f = look.hair.facial;
  if (f <= 1) return;                       // none, or stubble (painted on the skull)
  const kh = hs.Hh / 0.12, fc = col.facial, lo = detail < 0.5;
  const at = (d: V3, out: number): V3 => { const dd = norm(d), p = hs.local(...dd), n = hs.normal(...dd); return [p[0] + n[0] * out, hs.cy + p[1] + n[1] * out, hs.cz + p[2] + n[2] * out]; };
  const lips = (d: V3) => Math.abs(d[0]) < 0.3 && d[1] > -0.68 && d[1] < -0.47 && d[2] > 0.5;
  /** Under the beard line: from the sideburn (y −0.1 by the ear) down the cheek to the mouth's corners. */
  const jawBand = (d: V3) => d[2] > -0.3 && d[1] < -0.1 - 0.36 * Math.max(0, 1 - Math.abs(d[0]) / 0.85);
  type Mask = (d: V3) => number;
  const masks: Record<number, Mask> = {
    2: (d) => (jawBand(d) && !lips(d) ? 1 : 0),                                                     // short beard
    3: (d) => (jawBand(d) && !lips(d) ? 1 : 0),                                                     // full beard
    4: (d) => (jawBand(d) && !lips(d) ? 1 : 0),                                                     // braided beard
    7: (d) => ((Math.abs(d[0]) < 0.34 && d[1] < -0.66 && d[2] > 0.2) ? 1 : 0),                      // goatee
    8: (d) => (d[2] > -0.3 && d[1] < -0.12 && Math.abs(d[1] + 0.75 - 0.3 * (1 - Math.abs(d[0]))) < 0.13 && !lips(d) ? 1 : 0), // chin strap
    9: (d) => (jawBand(d) && Math.abs(d[0]) > 0.42 && d[1] > -0.8 ? 1 : 0),                         // mutton chops
    11: (d) => (Math.abs(d[0]) < 0.09 && d[1] < -0.66 && d[1] > -0.78 && d[2] > 0.5 ? 1 : 0),       // soul patch
    12: (d) => (jawBand(d) && !lips(d) ? 1 : 0),                                                    // long beard
    13: (d) => (jawBand(d) && !lips(d) ? 1 : 0),                                                    // forked beard
    6: (d) => (Math.abs(d[0]) > 0.72 && d[1] < 0.12 && d[1] > -0.5 && d[2] > -0.3 ? 1 : 0),          // sideburns
  };
  const vol: Record<number, number> = { 2: 0.008, 3: 0.018, 4: 0.016, 6: 0.008, 7: 0.012, 8: 0.006, 9: 0.014, 11: 0.006, 12: 0.02, 13: 0.02 };
  const drop: Record<number, number> = { 3: 0.014, 4: 0.006, 7: 0.014, 12: 0.11, 13: 0.1 };
  const m = masks[f];
  if (m) {
    const seg = detail >= 0.9 ? 13 : detail >= 0.5 ? 9 : 7, lat = detail >= 0.9 ? 8 : detail >= 0.5 ? 6 : 4;
    const P: V3[][] = [];
    for (let i = 0; i <= lat; i++) {
      const th = 1.55 + (Math.PI - 1.55) * (i / lat) * 0.985, row: V3[] = [];
      for (let j = 0; j <= seg; j++) {
        const ph = -1.95 + (3.9 * j) / seg;
        const d = dirOf(th, ph);
        // the mask blurred over its neighbours: the beard's edge thins out instead of stepping
        let c = 0;
        for (const [ex, ey] of [[0, 0], [0.06, 0], [-0.06, 0], [0, 0.05], [0, -0.05]] as const) c += m([d[0] + ex, d[1] + ey, d[2]]) / 5;
        const v = (vol[f] ?? 0.01) * kh * Math.min(1, c * 1.4);
        // (the edge slopes into the skin over a band: a step left a torn edge with skin showing in patches)
        const e = sm((c - 0.05) / 0.35);
        let p = at(d, -0.004 * kh * (1 - e) + e * Math.max(0.0025 * kh, v * (0.55 + 0.45 * Math.min(1, (-d[1] - 0.12) / 0.3))));
        // long beards fall from the chin
        const dr = (drop[f] ?? 0) * kh;
        if (c > 0 && dr > 0 && d[1] < -0.55) {
          const t = sm((-d[1] - 0.55) / 0.4) * sm((d[2] + 0.1) / 0.6);
          let dy = dr * t;
          if (f === 13) dy *= 0.5 + 0.5 * Math.abs(Math.sin(ph * 2.2));
          p = [p[0] * (1 - 0.3 * t), p[1] - dy, p[2] + dy * 0.25];
        }
        row.push(p);
      }
      P.push(row);
    }
    // smooth shading down the beard (no per-vertex noise: on a greyed beard it read as blotches), and the chin a
    // little greyer than the cheeks, as beards grey there first
    const grey = greyAmount(look.hair.grey);
    k.grid('head', P, (i, j) => {
      const d = dirOf(1.55 + (Math.PI - 1.55) * (i / lat) * 0.985, -1.95 + (3.9 * j) / seg);
      const c = shade(fc, 0.98 - 0.1 * sm((-d[1] - 0.55) / 0.4) + 0.03 * Math.cos(j * 0.9));
      return grey > 0 ? mix(c, GREY_HAIR, grey * 0.3 * G(d[0], 0.35) * sm((-d[1] - 0.55) / 0.3)) : c;
    }, { noOcc: true,
      out: (i, j) => hs.normal(...dirOf(1.55 + (Math.PI - 1.55) * (i / lat) * 0.985, -1.95 + (3.9 * j) / seg)) });
  }
  // moustaches
  const stache = (thick: number, curl = false) => {
    for (const sx of [-1, 1]) {
      const pts: V3[] = [at([0, -0.47, 1], 0.003 * kh), at([sx * 0.18, -0.5, 0.95], 0.004 * kh), at([sx * 0.34, -0.6, 0.85], 0.003 * kh)];
      if (curl) pts.push(at([sx * 0.5, -0.5, 0.75], 0.012 * kh), at([sx * 0.52, -0.36, 0.72], 0.016 * kh));
      k.tube('head', pts, pts.map((_, i) => (i === pts.length - 1 ? 0.0015 * kh : (0.0065 - i * 0.0008) * kh * thick)), fc, { seg: lo ? 4 : 6, noOcc: true });
    }
  };
  if (f === 3 || f === 4 || f === 12 || f === 13) stache(1.1);
  if (f === 5) stache(1.15);
  if (f === 10) stache(1, true);
  if (f === 7 || f === 9) stache(0.8);
  if (f === 4) {
    const top = at([0, -0.95, 0.4], 0.01 * kh);
    const n = lo ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      k.ellip('head', [0, top[1] - t * 0.05 * kh, top[2] + 0.004 * kh], [0.008 * kh * (1 - t * 0.3), 0.009 * kh, 0.007 * kh], i % 2 ? shade(fc, 0.84) : fc, { seg: 5, lat: 3, noOcc: true });
    }
    k.ellip('head', [0, top[1] - 0.06 * kh, top[2] + 0.004 * kh], [0.004 * kh, 0.004 * kh, 0.004 * kh], o.tie, { seg: 4, lat: 2, noOcc: true });
  }
}
