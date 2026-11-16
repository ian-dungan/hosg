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
import { faceParams, lookColours, type Frame, type LookColours, type Warp } from './look';

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
}

/** Ring sizes by detail: around the torso, the limbs. */
const res = (d: number) => (d >= 0.9 ? { torso: 20, limb: 10, rows: 1 } : d >= 0.5 ? { torso: 14, limb: 8, rows: 1 } : d >= 0.3 ? { torso: 10, limb: 6, rows: 0 } : { torso: 8, limb: 5, rows: 0 });

/** Builds the look's body, face, hair and facial hair. Returns the head's shape (the hair, gear and dev pages use it). */
export function buildBody2(k: ShapeKit, o: Body2Opts): HeadShape {
  const { look, frame: f, warp, clothes: cl, detail } = o;
  const col = lookColours(look);
  const fp = faceParams(look);
  const hs = headShape(f, fp);
  const R = res(detail);
  const kk = f.H / 1.75;
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

  // ── the torso: rows of superellipse sections with the bust, belly, seat and pectorals shaped in ──
  type Row = { y: number; w: number; d: number; zc: number; bust: number; belly: number; glute: number; pec: number };
  const rows: Row[] = [];
  const add = (y: number, w: number, d: number, extra: Partial<Row> = {}) => rows.push({ y, w, d, zc: 0, bust: 0, belly: 0, glute: 0, pec: 0, ...extra });
  const ribsY = lerp(f.waistY, f.chestY, 0.5), upY = lerp(f.chestY, f.shY, 0.55);
  add(f.crotchY - 0.01 * kk, f.hipW * 0.5, f.hipD * 0.55);
  add(lerp(f.crotchY, f.hipY, 0.5), f.hipW * 0.94, f.hipD * 0.95, { glute: 1 });
  add(f.hipY, f.hipW, f.hipD, { glute: 0.7, belly: 0.25 });
  add(lerp(f.hipY, f.waistY, 0.5), lerp(f.hipW, f.waistW, 0.6), lerp(f.hipD, f.waistD, 0.5), { belly: 0.7 });
  add(f.waistY, f.waistW, f.waistD, { belly: 1 });
  add(ribsY, lerp(f.waistW, f.chestW, 0.62), lerp(f.waistD, f.chestD, 0.6), { belly: 0.45, bust: 0.45 });
  add(f.chestY, f.chestW, f.chestD, { bust: 1, pec: 1 });
  add(upY, f.chestW * 1.02, f.chestD * 0.94, { bust: 0.35, pec: 0.7 });
  add(f.shY, f.shX * 0.92, f.chestD * 0.84);
  add(f.shTopY, f.shX * 0.55, f.chestD * 0.6);
  add(f.neckBaseY + 0.012 * kk, f.neckR * 1.3, f.neckR * 1.2);
  // a short top's hem: two rows either side, so the shirt meets the trousers in a clean line
  if (hemY > f.crotchY + 0.01 && hemY < f.waistY) {
    for (const yy of [hemY + 0.003, hemY - 0.003]) {
      const i = rows.findIndex((r) => r.y > yy), a = rows[i - 1]!, b = rows[i]!, t = (yy - a.y) / (b.y - a.y);
      const mixRow: Row = { y: yy, w: lerp(a.w, b.w, t), d: lerp(a.d, b.d, t), zc: 0, bust: lerp(a.bust, b.bust, t), belly: lerp(a.belly, b.belly, t), glute: lerp(a.glute, b.glute, t), pec: lerp(a.pec, b.pec, t) };
      rows.splice(i, 0, mixRow);
    }
  }
  const seg = R.torso;
  const P: V3[][] = [];
  for (const r of rows) {
    const row: V3[] = [];
    for (let j = 0; j < seg; j++) {
      const a = (Math.PI * 2 * j) / seg;
      const sa = Math.sin(a), ca = Math.cos(a);
      const px = Math.sign(sa) * Math.pow(Math.abs(sa), 0.82), pz = Math.sign(ca) * Math.pow(Math.abs(ca), 0.9);
      let x = px * r.w, z = pz * r.d + r.zc;
      const front = Math.max(0, ca), back = Math.max(0, -ca);
      z += r.bust * f.bust * 0.045 * kk * G(Math.abs(x) - r.w * 0.46, r.w * 0.36) * front;
      z += r.pec * f.muscle * 0.014 * kk * G(Math.abs(x) - r.w * 0.42, r.w * 0.45) * front * (f.female ? 0.3 : 1);
      z += r.belly * f.belly * 0.065 * kk * front * front;
      z -= r.glute * f.glute * 0.03 * kk * G(Math.abs(x) - r.w * 0.45, r.w * 0.4) * back;
      x *= 1 + r.belly * f.belly * 0.08 * Math.abs(sa);
      row.push([x, r.y, z]);
    }
    P.push(row);
  }
  const torsoCol = (i: number, j: number) => {
    const [x, y, z] = P[i]![j]!;
    if (y < hemY && hemY > f.crotchY) return legsC;                      // a short top: trousers below its hem
    if (cl.vneck && z > 0 && y > f.chestY && Math.abs(x) < (f.neckBaseY - y) * 0.55 + 0.012) return cl.vneck;
    if (i === rows.length - 1 && !cl.vneck) return trim ?? shade(top, 0.85);
    if (i >= rows.length - 1) return skinAt(x, y, z);
    return top;
  };
  k.grid('body', P, torsoCol, { wrap: true });

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
    const nRows: V3[][] = [];
    const ys = [f.neckBaseY - 0.03 * kk, f.neckBaseY + 0.02 * kk, lerp(f.neckBaseY, f.chinY, 0.6), f.chinY + 0.02 * kk];
    const ns = Math.max(6, Math.round(R.limb * 1.1));
    for (let i = 0; i < ys.length; i++) {
      const y = ys[i]!, row: V3[] = [];
      const r = f.neckR * (i === 0 ? 1.2 : i === 1 ? 1.05 : 1);
      for (let j = 0; j < ns; j++) {
        const a = (Math.PI * 2 * j) / ns;
        row.push([Math.sin(a) * r, y, Math.cos(a) * r * 1.02 - 0.006 * kk + (i >= 2 ? f.headZ * 0.6 : 0)]);
      }
      nRows.push(row);
    }
    k.grid('neck', nRows, (i, j) => { const p = nRows[i]![j]!; return shade(skinAt(p[0], p[1], p[2]), 0.94); }, { wrap: true });
  }

  // ── arms and hands ──
  const ls = R.limb;
  for (const [g, sx] of [['armL', -1], ['armR', 1]] as const) {
    const axX = (y: number) => sx * (f.shX + (f.shY - y) * 0.04);
    const aRows0: { y: number; r: number; z?: number }[] = [
      { y: f.shY + f.uArmR * 0.62, r: f.uArmR * 0.25 },
      { y: f.shY + f.uArmR * 0.35, r: f.uArmR * 0.85 },
      { y: f.shY - f.uArmR * 0.35, r: f.uArmR * (1.22 + 0.15 * f.muscle) },
      { y: lerp(f.shY, f.elbowY, 0.5), r: f.uArmR * (1.02 + 0.12 * f.muscle), z: 0.003 * kk },
      { y: f.elbowY + 0.035 * kk, r: f.fArmR * 1.02 },
      { y: f.elbowY, r: f.fArmR * 0.96 },
      { y: lerp(f.elbowY, f.wristY, 0.3), r: f.fArmR * (1.08 + 0.08 * f.muscle), z: 0.002 * kk },
      { y: f.wristY + 0.012 * kk, r: f.wristR },
      { y: f.wristY - 0.012 * kk, r: f.wristR * 0.92 },
    ];
    const aRows = withCuts(aRows0, [cuffY, ...(cl.sleeves === 'rolled' ? [cuffY - 0.03 * kk] : cl.sleeves === 'long' && trim ? [cuffY + 0.02 * kk] : [])]);
    const AP: V3[][] = aRows.map((r) => {
      const row: V3[] = [];
      for (let j = 0; j < ls; j++) {
        const a = (Math.PI * 2 * j) / ls;
        row.push([axX(r.y) + Math.sin(a) * r.r, r.y, Math.cos(a) * r.r * 0.94 + (r.z ?? 0)]);
      }
      return row;
    });
    k.grid(g, AP, (i, j) => {
      const p = AP[i]![j]!;
      if (p[1] > cuffY) return cl.sleeves === 'long' && p[1] < cuffY + 0.02 * kk && trim ? trim : i === 0 ? shade(sleeve, 0.95) : sleeve;
      if (cl.sleeves === 'rolled' && p[1] > cuffY - 0.03 * kk) return shade(sleeve, 1.06);
      return skinAt(p[0], p[1], p[2]);
    }, { wrap: true });
    // the hand: palm side towards the thigh, the thumb forward, mitten fingers
    const hp = fur ? pawPaint(col.skin, fur2, fur.pattern, sx) : skinPaint ?? undefined;
    const hx = axX(f.wristY), hy = f.wristY, hl = f.handL, hw = f.handW;
    const hseg = detail >= 0.5 ? 8 : 6;
    k.ellip(g, [hx, hy - hl * 0.27, 0.003 * kk], [hw * 0.28, hl * 0.28, hw * 0.5], col.skin, { seg: hseg, lat: 5, power: 0.8, paint: hp });
    k.ellip(g, [hx - sx * hw * 0.05, hy - hl * 0.7, 0.006 * kk], [hw * 0.23, hl * 0.26, hw * 0.47], shade(col.skin, 0.98), { seg: hseg, lat: 5, power: 0.85, rot: [0.18, 0, sx * 0.08], noOcc: true, paint: hp });
    k.tube(g, [[hx - sx * hw * 0.1, hy - hl * 0.14, hw * 0.34], [hx - sx * hw * 0.2, hy - hl * 0.34, hw * 0.52], [hx - sx * hw * 0.22, hy - hl * 0.5, hw * 0.5]],
      [hw * 0.17, hw * 0.15, hw * 0.1], col.skin, { seg: detail >= 0.5 ? 6 : 4, noOcc: true, paint: hp });
  }

  // ── legs and feet ──
  for (const [g, sx] of [['legL', -1], ['legR', 1]] as const) {
    const axX = (y: number) => sx * (y > f.kneeY ? lerp(f.legX * 0.84, f.legX, (y - f.kneeY) / (f.hipY - f.kneeY)) : lerp(f.legX * 0.8, f.legX * 0.84, (y - f.ankleY) / (f.kneeY - f.ankleY)));
    const lRows0: { y: number; r: number; z?: number }[] = [
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
    const lRows = withCuts(lRows0, [bootTop]);
    const bootR = (y: number) => (y < bootTop ? 0.006 * kk : 0);
    const LP: V3[][] = lRows.map((r) => {
      const row: V3[] = [];
      for (let j = 0; j < ls; j++) {
        const a = (Math.PI * 2 * j) / ls, rr = r.r + bootR(r.y);
        row.push([axX(r.y) + Math.sin(a) * rr, r.y, Math.cos(a) * rr + (r.z ?? 0)]);
      }
      return row;
    });
    k.grid(g, LP, (_i, j) => { void j; const y = LP[_i]![0]![1]; return y < bootTop ? cl.boots : legsC; }, { wrap: true });
    if (detail >= 0.3 && bootTop > f.ankleY + 0.05) {
      // the boot's cuff
      const cy = bootTop, rr = lerp(f.ankleR * 1.35, f.calfR, Math.min(1, (cy - f.ankleY) / (f.kneeY - f.ankleY) * 2)) + 0.012 * kk;
      k.lathe(g, [axX(cy), 0, 0], [[cy - 0.02 * kk, rr], [cy + 0.012 * kk, rr]], shade(cl.boots, 1.08), { seg: ls, caps: false });
    }
    const fx = axX(f.ankleY);
    k.ellip(g, [fx, f.footH * 0.5, f.footL * 0.24 - 0.02 * kk], [f.footW, f.footH * 0.52, f.footL * 0.5], cl.boots, { seg: detail >= 0.5 ? 10 : 7, lat: detail >= 0.5 ? 6 : 4, power: 0.72,
      paint: (w) => (w.y < 0.016 * kk ? shade(cl.boots, 0.55) : undefined),
      deform: (l) => { if (l.z < 0 && l.y > 0) l.y *= 1 + 0.4 * -l.z; if (l.z > 0.3) l.y *= 1 - 0.35 * (l.z - 0.3); } });
  }

  // ── the head ──
  if (o.head !== false) {
    const info = look.hair.style;
    void info;
    buildFace(k, { look, frame: f, fp, col, hs, detail, scalp: scalpPaint(look), stubble: stubblePaint(look) });
    k.g.aoOffNow = false;
    buildHair(k, { look, frame: f, col, hs, detail, tie: o.tie });
    buildFacialHair(k, { look, frame: f, col, hs, detail, tie: o.tie });
  }
  return hs;
}

/** A canonical leg height (character.ts humanPivots) on this body. */
export function legY(w: Warp, y: number): number {
  const p = { x: 0.1, y, z: 0 };
  w.apply('leg', p);
  return p.y;
}

export type { LookColours };
