// Look v2's body, built straight from look.ts `bodyFrame` (metres, feet at 0, facing +z) into the adventurer's one
// skinned mesh: a lofted torso (chest or bust, waist, belly, hips and seat, shoulders sloping to the neck), a neck,
// arms with the deltoid, elbow and forearm, hands with a thumb and mitten fingers, legs with the thigh, knee and calf,
// and booted feet. Clothes are painted onto the body (no skin under them, nothing to clip): the tunic, its sleeves
// to their cuff, a skirt or robe when the hem falls below the hips, trousers and boots. Then the face (face2.ts) and
// the hair and facial hair (hair.ts). Capes, scarves, tabards, belts, pouches, weapons, job cues and worn gear are
// authored on the old canonical humanoid and fitted on by look.ts makeAttachWarp (character.ts builds them).
//
// Attachment points (for the per-piece gear models): see ATTACH in character.ts, and `slotAnchors` below.
import { Color3 } from '@babylonjs/core';
import type { Look } from '@sg2/shared';
import type { Paint, ShapeKit, V3 } from './character';
import { armAxis, faceParams, legAxis, lookColours, type Frame, type LookColours, type Warp } from './look';

/** Rows (by height) with two rows added close either side of each cut, so painted edges (cuffs, boot tops, hems) are crisp. */
function withCuts<T extends { y: number; r: number; z?: number }>(rows: T[], cuts: number[]): T[] {
  let out = rows.slice();
  for (const c of cuts) {
    const next: T[] = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i]!, b = out[i + 1];
      next.push(a);
      if (!b) continue;
      const hi = Math.max(a.y, b.y), lo = Math.min(a.y, b.y);
      if (c - 0.004 > lo && c + 0.004 < hi) {
        for (const yy of a.y > b.y ? [c + 0.003, c - 0.003] : [c - 0.003, c + 0.003]) {
          const t = (yy - a.y) / (b.y - a.y);
          next.push({ ...a, y: yy, r: a.r + (b.r - a.r) * t, z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t });
        }
      }
    }
    out = next;
  }
  return out;
}
import { buildFace, headShape, type HeadShape } from './face2';
import { armRows, legRows, mixRow, neckRows, ringRes, torsoPoint, torsoRows, type TorsoRow } from './bodySurface';
import { buildFacialHair, buildHair, scalpPaint, stubblePaint } from './hair';
import { furPaint, pawPaint } from './faces';

const mix = (a: Color3, b: Color3, t: number) => Color3.Lerp(a, b, Math.max(0, Math.min(1, t)));
const shade = (c: Color3, f: number) => new Color3(Math.min(1, c.r * f), Math.min(1, c.g * f), Math.min(1, c.b * f));
const G = (x: number, s: number) => Math.exp(-(x * x) / (s * s));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** What the clothes painted on the body look like (character.ts maps its HumanSpec here; heights are the old canon's). */
export interface Clothes {
  top: Color3; topTrim?: Color3; hem: number; flare: number;
  sleeves: 'short' | 'long' | 'rolled'; sleeveColor?: Color3;
  legs: Color3 | null; boots: Color3; bootTop?: number; vneck?: Color3;
}

export interface Body2Opts {
  look: Look; frame: Frame; warp: Warp; clothes: Clothes; detail: number;
  /** The tie and bead colour of braids and tails. */
  tie: Color3;
  /** Draw the head, hair and face (false: a headless mannequin for gear dev pages). */
  head?: boolean;
  /** What worn gear covers (gearFit.ts): those bands are not built (no skin under a piece), hair and ears per head piece. */
  cover?: BodyCover;
}

/**
 * The parts of the body a worn piece covers. Bands are intervals: torso in row parameter s (bodySurface torsoRows
 * index), arms, legs and neck in heights (m). A band between two rows is left out only when both rows lie inside
 * one interval, so the piece always overlaps what is drawn (never a hole).
 */
export interface BodyCover {
  torso?: [number, number][]; arm?: [number, number][]; leg?: [number, number][]; neck?: [number, number][];
  hands?: boolean; feet?: boolean;
  /** Round ears under a hood or helm (Larchfolk and Brindlekin ears always show: their pieces leave openings). */
  ears?: boolean;
  /** 'cap': the hair's volume (the `hair` bone) is not built; 'tuck': only long hair hanging below (a hood, a cap); 'none': no hair at all (a closed helm). */
  hair?: 'full' | 'cap' | 'tuck' | 'none';
}
const NO_COVER: BodyCover = {};
const inside = (v: number, iv?: [number, number][]) => !!iv && iv.some(([a, b]) => v >= a && v <= b);
/** Runs of rows [first, last] to build: every band whose two rows both lie inside a covered interval is left out. */
export function shownRuns(vals: readonly number[], iv?: [number, number][]): [number, number][] {
  if (!iv || !iv.length) return [[0, vals.length - 1]];
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < vals.length - 1; i++) {
    const hidden = iv.some(([a, b]) => vals[i]! >= a && vals[i]! <= b && vals[i + 1]! >= a && vals[i + 1]! <= b);
    if (!hidden) { if (start < 0) start = i; }
    else if (start >= 0) { out.push([start, i]); start = -1; }
  }
  if (start >= 0) out.push([start, vals.length - 1]);
  return out;
}

/** Ring sizes by detail: around the torso, the limbs. */
const res = ringRes;

/** Triangles of the last body built, by part (budgets and dev pages). */
export const bodyTris: Record<string, number> = {};

/** Builds the look's body, face, hair and facial hair. Returns the head's shape (the hair, gear and dev pages use it). */
export function buildBody2(k: ShapeKit, o: Body2Opts): HeadShape {
  const { look, frame: f, warp, clothes: cl, detail } = o;
  const cover = o.cover ?? NO_COVER;
  const col = lookColours(look);
  const fp = faceParams(look);
  const hs = headShape(f, fp);
  const R = res(detail);
  const kk = f.H / 1.75;
  const tStart = k.g.triangles;
  const fur = look.fur;
  const fur2 = col.fur2 ?? shade(col.skin, 0.6);
  const skinPaint: Paint | null = fur ? furPaint(col.skin, fur2, fur.pattern)
    : look.people === 'larchfolk' ? (w) => (Math.sin(w.y * 64 + Math.sin(w.x * 30) * 2) > 0.88 ? shade(col.skin, 0.86) : undefined) : null;
  const skinAt = (x: number, y: number, z: number): Color3 => (skinPaint ? skinPaint({ x, y, z } as never, [0, 0], { x: 0, y: 0, z: 0 } as never) ?? col.skin : col.skin);
  const hemY = warp.y(cl.hem);
  const top = cl.top, trim = cl.topTrim, sleeve = cl.sleeveColor ?? top;
  const legsC = cl.legs ?? shade(mix(new Color3(0.36, 0.34, 0.4), new Color3(0.7, 0.66, 0.6), 0.35), 0.9);
  const bootTop = legY(warp, cl.bootTop ?? 0.38);
  const cuffY = cl.sleeves === 'long' ? f.wristY + 0.012 * kk : cl.sleeves === 'rolled' ? f.elbowY - 0.03 * kk : f.shY - (f.shY - f.elbowY) * 0.45;

  // ── the torso: rows of superellipse sections with the bust, belly, seat and pectorals shaped in (bodySurface.ts) ──
  type Row = TorsoRow & { s: number };
  const rows: Row[] = torsoRows(f).map((r, i) => ({ ...r, s: i }));
  // a short top's hem: two rows either side, so the shirt meets the trousers in a clean line
  if (hemY > f.crotchY + 0.01 && hemY < f.waistY) {
    for (const yy of [hemY + 0.003, hemY - 0.003]) {
      const i = rows.findIndex((r) => r.y > yy), a = rows[i - 1]!, b = rows[i]!, t = (yy - a.y) / (b.y - a.y);
      rows.splice(i, 0, { ...mixRow(a, b, t), s: a.s + (b.s - a.s) * t });
    }
  }
  const seg = R.torso;
  const P: V3[][] = rows.map((r) => Array.from({ length: seg }, (_, j) => torsoPoint(f, r, (Math.PI * 2 * j) / seg)));
  const torsoCol = (i: number, j: number) => {
    const [x, y, z] = P[i]![j]!;
    if (y < hemY && hemY > f.crotchY) return legsC;                      // a short top: trousers below its hem
    if (cl.vneck && z > 0 && y > f.chestY && Math.abs(x) < (f.neckBaseY - y) * 0.55 + 0.012) return cl.vneck;
    if (i === rows.length - 1 && !cl.vneck) return trim ?? shade(top, 0.85);
    if (i >= rows.length - 1) return skinAt(x, y, z);
    return top;
  };
  // (worn gear covers bands of it: those are left out, so no skin is drawn under a piece)
  for (const [i0, i1] of shownRuns(rows.map((r) => r.s), cover.torso)) k.grid('body', P.slice(i0, i1 + 1), (i, j) => torsoCol(i + i0, j), { wrap: true });

  // ── a skirt (a tunic's, a robe's or a dress's) from the hips to the hem ──
  if (hemY < f.crotchY - 0.02 * kk) {
    const sRows: V3[][] = [];
    const n = Math.max(3, Math.round((f.hipY - hemY) / (0.12 * kk)) + 2);
    const clear = f.legX + f.thighR + 0.012 * kk;
    // rows to just over the hem, then the trim band (two rows): its edge stays crisp
    const band = trim ? 0.024 * kk : 0;
    const ts = [...Array.from({ length: n }, (_, i) => i / (n - 1)), 1, 1];
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i]!, y = i === ts.length - 1 ? hemY : i === ts.length - 2 ? hemY + band : lerp(f.hipY + 0.02 * kk, hemY + band + 0.004 * kk, t);
      const w = Math.max(lerp(f.hipW * 1.04, f.hipW * 1.04 + cl.flare * 1.7 * kk + 0.02 * kk, t), i > 0 ? clear : 0);
      const d = Math.max(lerp(f.hipD * 1.06 + f.glute * 0.02 * kk, f.hipD + cl.flare * 1.4 * kk + 0.03 * kk, t), i > 0 ? f.thighR * 1.25 : 0);
      const row: V3[] = [];
      for (let j = 0; j < seg; j++) {
        const a = (Math.PI * 2 * j) / seg;
        const fold = 1 + 0.025 * Math.sin(a * 6) * t;
        row.push([Math.sin(a) * w * fold, y, Math.cos(a) * d * fold + f.belly * 0.02 * kk * Math.max(0, Math.cos(a)) * (1 - t)]);
      }
      sRows.push(row);
    }
    k.grid('body', sRows, (i, j) => (i >= sRows.length - 2 && trim ? trim : shade(top, 0.93 + 0.07 * Math.cos(((j / seg) * Math.PI * 2) * 6))), { wrap: true });
  }

  // ── the neck ──
  {
    const nr = neckRows(f);
    const ns = Math.max(6, Math.round(R.limb * 1.1));
    const nRows: V3[][] = nr.map((r) => Array.from({ length: ns }, (_, j) => { const a = (Math.PI * 2 * j) / ns; return [Math.sin(a) * r.r, r.y, Math.cos(a) * r.r * 1.02 + r.dz] as V3; }));
    for (const [i0, i1] of shownRuns(nr.map((r) => r.y), cover.neck)) k.grid('neck', nRows.slice(i0, i1 + 1), (i, j) => { const p = nRows[i + i0]![j]!; return shade(skinAt(p[0], p[1], p[2]), 0.94); }, { wrap: true });
  }

  // ── arms and hands ──
  const ls = R.limb;
  for (const [g, sx] of [['armL', -1], ['armR', 1]] as const) {
    const axX = (y: number) => sx * armAxis(f, y);
    // a soft shoulder cap (the deltoid) rounding into the torso's slope, the elbow, the forearm (bodySurface.ts)
    const aRows = withCuts(armRows(f, detail),[cuffY, ...(cl.sleeves === 'rolled' ? [cuffY - 0.03 * kk] : cl.sleeves === 'long' && trim ? [cuffY + 0.02 * kk] : [])]);
    const AP: V3[][] = aRows.map((r) => {
      const row: V3[] = [];
      for (let j = 0; j < ls; j++) {
        const a = (Math.PI * 2 * j) / ls;
        row.push([axX(r.y) + Math.sin(a) * r.r, r.y, Math.cos(a) * r.r * 0.94 + (r.z ?? 0)]);
      }
      return row;
    });
    const armCol = (i: number, j: number) => {
      const p = AP[i]![j]!;
      if (p[1] > cuffY) return cl.sleeves === 'long' && p[1] < cuffY + 0.02 * kk && trim ? trim : i === 0 ? shade(sleeve, 0.95) : sleeve;
      if (cl.sleeves === 'rolled' && p[1] > cuffY - 0.03 * kk) return shade(sleeve, 1.06);
      return skinAt(p[0], p[1], p[2]);
    };
    for (const [i0, i1] of shownRuns(aRows.map((r) => r.y), cover.arm)) k.grid(g, AP.slice(i0, i1 + 1), (i, j) => armCol(i + i0, j), { wrap: true });
    if (cover.hands) continue;
    // the hand: palm side towards the thigh, the thumb forward, mitten fingers
    const hp = fur ? pawPaint(col.skin, fur2, fur.pattern, sx) : skinPaint ?? undefined;
    const hx = axX(f.wristY), hy = f.wristY, hl = f.handL, hw = f.handW;
    const hseg = detail >= 0.9 ? 8 : detail >= 0.5 ? 6 : 5, hlat = detail >= 0.5 ? 5 : 3;
    k.ellip(g, [hx, hy - hl * 0.27, 0.003 * kk], [hw * 0.28, hl * 0.28, hw * 0.5], col.skin, { seg: hseg, lat: hlat, power: 0.8, paint: hp });
    k.ellip(g, [hx - sx * hw * 0.05, hy - hl * 0.7, 0.006 * kk], [hw * 0.23, hl * 0.26, hw * 0.47], shade(col.skin, 0.98), { seg: hseg, lat: hlat, power: 0.85, rot: [0.18, 0, sx * 0.08], noOcc: true, paint: hp });
    if (detail >= 0.5) k.tube(g, [[hx - sx * hw * 0.1, hy - hl * 0.14, hw * 0.34], [hx - sx * hw * 0.2, hy - hl * 0.34, hw * 0.52], [hx - sx * hw * 0.22, hy - hl * 0.5, hw * 0.5]],
      [hw * 0.17, hw * 0.15, hw * 0.1], col.skin, { seg: detail >= 0.5 ? 6 : 4, noOcc: true, paint: hp });
  }

  // ── legs and feet ──
  for (const [g, sx] of [['legL', -1], ['legR', 1]] as const) {
    // knees and ankles come in by the frame's kneeIn (the female base stands knees in, feet closer)
    const axX = (y: number) => sx * legAxis(f, y);
    const lRows = withCuts(legRows(f, detail), [bootTop]);
    const bootR = (y: number) => (y < bootTop ? 0.006 * kk : 0);
    const LP: V3[][] = lRows.map((r) => {
      const row: V3[] = [];
      for (let j = 0; j < ls; j++) {
        const a = (Math.PI * 2 * j) / ls, rr = r.r + bootR(r.y);
        row.push([axX(r.y) + Math.sin(a) * rr, r.y, Math.cos(a) * rr + (r.z ?? 0)]);
      }
      return row;
    });
    for (const [i0, i1] of shownRuns(lRows.map((r) => r.y), cover.leg)) k.grid(g, LP.slice(i0, i1 + 1), (i) => (LP[i + i0]![0]![1] < bootTop ? cl.boots : legsC), { wrap: true });
    if (cover.feet) continue;
    if (detail >= 0.5 && bootTop > f.ankleY + 0.05 && !inside(bootTop, cover.leg)) {
      // the boot's cuff
      const cy = bootTop, rr = lerp(f.ankleR * 1.35, f.calfR, Math.min(1, (cy - f.ankleY) / (f.kneeY - f.ankleY) * 2)) + 0.012 * kk;
      k.lathe(g, [axX(cy), 0, 0], [[cy - 0.02 * kk, rr], [cy + 0.012 * kk, rr]], shade(cl.boots, 1.08), { seg: ls, caps: false });
    }
    const fx = axX(f.ankleY);
    k.ellip(g, [fx, f.footH * 0.5, f.footL * 0.24 - 0.02 * kk], [f.footW, f.footH * 0.52, f.footL * 0.5], cl.boots, { seg: detail >= 0.9 ? 9 : detail >= 0.5 ? 7 : 5, lat: detail >= 0.5 ? 5 : 3, power: 0.72,
      paint: (w) => (w.y < 0.016 * kk ? shade(cl.boots, 0.55) : undefined),
      deform: (l) => { if (l.z < 0 && l.y > 0) l.y *= 1 + 0.4 * -l.z; if (l.z > 0.3) l.y *= 1 - 0.35 * (l.z - 0.3); } });
  }

  bodyTris.body = k.g.triangles - tStart;
  // ── the head ──
  if (o.head !== false) {
    const info = look.hair.style;
    void info;
    const noEars = cover.ears === true && look.people !== 'larchfolk' && look.people !== 'brindlekin';
    buildFace(k, { look, frame: f, fp, col, hs, detail, scalp: scalpPaint(look), stubble: stubblePaint(look), noEars });
    k.g.aoOffNow = false;
    let t0 = k.g.triangles;
    // under a head piece the hair is tucked (no volume) or not built at all (a closed helm: nothing pokes through)
    const hairMode = cover.hair ?? 'full';
    if (hairMode !== 'full') k.g.skip = k.glow.skip = new Set(hairMode === 'none' ? ['head', 'hair', 'hairB'] : hairMode === 'tuck' ? ['head', 'hair'] : ['hair']);
    const hv0 = k.g.pos.length;
    buildHair(k, { look, frame: f, col, hs, detail, tie: o.tie });
    k.g.skip = k.glow.skip = null;
    // (the envelope: the hair and the beard as built — a hat sits on the hair, a helm's cheek guards stand off the beard)
    bodyTris.hair = k.g.triangles - t0; t0 = k.g.triangles;
    buildFacialHair(k, { look, frame: f, col, hs, detail, tie: o.tie });
    bodyTris.facial = k.g.triangles - t0;
    lastHairEnvelope = hairEnvelope(k.g.pos, hv0, hs);
  }
  return hs;
}

/** How far the built hair stands off the skull (m), by direction: hats and circlets sit on it (gearFit.ts). */
export type HairEnvelope = (d: V3) => number;
const ENV_T = 8, ENV_P = 12;
/** The hair envelope of the vertices pos[from..] (the hair just built) round the skull `hs`. */
export function hairEnvelope(pos: readonly number[], from: number, hs: HeadShape): HairEnvelope {
  const bins = new Float32Array(ENV_T * ENV_P);
  const binOf = (d: V3) => {
    const th = Math.acos(Math.max(-1, Math.min(1, d[1]))), ph = Math.atan2(d[0], d[2]);
    const i = Math.min(ENV_T - 1, Math.floor((th / Math.PI) * ENV_T)), j = ((Math.floor(((ph + Math.PI) / (Math.PI * 2)) * ENV_P) % ENV_P) + ENV_P) % ENV_P;
    return [i, j] as const;
  };
  const dirFor = (x: number, y: number, z: number): V3 => { const v: V3 = [x / hs.W, (y - hs.cy) / hs.Hh, (z - hs.cz) / hs.D]; const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  for (let v = from; v < pos.length; v += 3) {
    const x = pos[v]!, y = pos[v + 1]!, z = pos[v + 2]!;
    const d = dirFor(x, y, z), s = hs.local(...d);
    const out = Math.hypot(x, y - hs.cy, z - hs.cz) - Math.hypot(s[0], s[1], s[2]);
    // (only hair on the head counts: long hair hanging down the back is not a hat's business)
    if (out <= 0 || out > (d[1] > -0.4 ? 0.11 : 0.035) * (hs.Hh / 0.12)) continue;
    const [i, j] = binOf(d), b = i * ENV_P + j;
    if (out > bins[b]!) bins[b] = out;
  }
  return (d) => {
    const [i, j] = binOf(d);
    let m = 0;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const ii = i + di; if (ii < 0 || ii >= ENV_T) continue;
      m = Math.max(m, bins[ii * ENV_P + ((j + dj + ENV_P) % ENV_P)]!);
    }
    return m;
  };
}
/** The envelope of the hair of the last body built (character.ts hands it to the head piece). */
export let lastHairEnvelope: HairEnvelope = () => 0;

/** A canonical leg height (character.ts humanPivots) on this body. */
export function legY(w: Warp, y: number): number {
  const p = { x: 0.1, y, z: 0 };
  w.apply('leg', p);
  return p.y;
}

export type { LookColours };
