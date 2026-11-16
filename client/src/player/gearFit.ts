// The gear-fitting engine: every armour and costume piece is built from the WEARER's own body (bodySurface.ts: the
// same rows body2.ts draws), so a piece made once fits a 1.2 m Knollfolk and a 2.1 m Larchfolk alike, male or female,
// thin or heavy (as gear does in FFXI or Warcraft). A piece is made of:
//  · shells: a surface over a region of the body (the torso, the arms, the legs, the neck) at an offset along the
//    body's normal (`off`, in metres at a 1.75 m body, scaled by the body's size), with lips turning back to the body
//    at its open edges (a hem, a cuff: never a see-through gap);
//  · hangs: cloth that hangs clear of the body (skirts round the legs, capes down the back, tabards down the front),
//    its clearance measured from the body and the pieces under it at every height;
//  · fitted shapes: pauldrons, gloves, boots and helmets sized to enclose the body points they cover;
//  · ornaments in a frame anchored to a place on the body (rivets, spikes, gems, buckles, crests), scaled with it.
// Layers: pieces are built legs → feet → chest → hands → back → head, and each shell is lifted over what is already
// there (a tunic over the trousers' waistband, boots over leg armour, gloves over a fitted sleeve — under a loose one,
// a cape over the pauldrons), so any mix of pieces from different sets stacks cleanly. Each piece reports which body
// bands it covers: body2.ts leaves them out (no skin under armour, and no triangles spent there).
// Every vertex's |x| is softly held inside the fixed hit radius (ADVENTURER_RADIUS).
import { Color3, Vector3 } from '@babylonjs/core';
import { ADVENTURER_RADIUS, type Look } from '@sg2/shared';
import { chunkKit, type GearChunk, type ShapeGroup, type ShapeKit, type V3 } from './character';
import type { Frame } from './look';
import { norm, type HeadShape } from './face2';
import type { BodyCover, HairEnvelope } from './body2';
import { AST, ST, armStations, ringRes, stY, stations, surfaces, unit, type Region, type Surfaces } from './bodySurface';
import type { F } from './gearKit';

/** The smallest gap between a piece and the body it covers (m at a 1.75 m body). */
export const MARGIN = 0.004;
/** The gap one layer keeps over the one under it. */
export const LAYER_GAP = 0.0035;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const TAU = Math.PI * 2;

/** What a vertex range of a piece is, for the fit test: tight shells hug the body, loose ones hang near it, free cloth hangs (capes, skirts), ornaments stand on it. */
export type FitClass = 'tight' | 'loose' | 'free' | 'orn';
export interface FitMeta { from: number; to: number; cls: FitClass; region: Region | 'head' | 'hand' | 'foot' | 'cape'; /** A limb's side (−1 left, 1 right). */ side?: number }
/** A fitted piece: its geometry, what it covers and the ranges the fit test reads. */
export interface FittedPiece { chunk: GearChunk; cover: BodyCover; meta: FitMeta[]; layer: LayerSnapshot }

/** The offsets already worn, per region and place (m), so the next piece goes over them. */
export interface LayerSnapshot { torso: Float32Array; arm: Float32Array; leg: Float32Array; neck: Float32Array; head: number; /** The pauldrons' inner edge (|x|, m): a cape starts inside it. */ paulIn: number; /** The right pauldron's centre and radii (the left mirrors it): ornaments stand on it. */ paul: { c: V3; r: V3 } | null }
const LAYER_N = { torso: 72, arm: 64, leg: 64, neck: 24 } as const;
const LAYER_U = { torso: [4.5, 12.5], arm: [0, 6.4], leg: [0, 7.5], neck: [11.5, 13.6] } as const;
export const emptyLayer = (): LayerSnapshot => ({ torso: new Float32Array(LAYER_N.torso), arm: new Float32Array(LAYER_N.arm), leg: new Float32Array(LAYER_N.leg), neck: new Float32Array(LAYER_N.neck), head: 0, paulIn: 1, paul: null });
const copyLayer = (l: LayerSnapshot): LayerSnapshot => ({ torso: l.torso.slice(), arm: l.arm.slice(), leg: l.leg.slice(), neck: l.neck.slice(), head: l.head, paulIn: l.paulIn, paul: l.paul });
const lidx = (r: Region, u: number) => { const [a, b] = LAYER_U[r]; return clamp(Math.round(((u - a) / (b - a)) * (LAYER_N[r] - 1)), 0, LAYER_N[r] - 1); };

/** The body a piece is fitted to. */
export interface FitBody { look: Look; f: Frame; hs: HeadShape; detail: number; bootTop: number; skin: Color3 }

/** Rows for a shell, with the cuts (colour edges) that must stay. */
export type RowList = number[] & { cuts?: number[] };
export interface ShellOpts {
  region: Region;
  /** Rows in landmark coordinates (ST for the torso, legs and neck; AST for the arms), in order along the region. */
  rows: number[];
  /** Offset from the body (m at 1.75 m), by place. */
  off: number | ((u: number, a: number) => number);
  col: Color3 | ((u: number, a: number, side: number) => Color3);
  /** An angular span (no wrap): e.g. a breastplate's front. */
  arc?: [number, number];
  /** Segments round: the body's ring count × mult (so the piece's vertices sit over the body's). */
  mult?: number;
  /** Lips at the first and last rows (default both). */
  lip?: 'first' | 'last' | 'both' | 'none';
  /** Lifted over what is already worn (default true). */
  over?: boolean;
  /** Leaves the body under it out (default: a full wrap does). */
  hide?: boolean;
  flat?: boolean; glow?: boolean;
  /** Rows may be thinned where the offset leaves room (default true). */
  prune?: boolean;
  /** Quads left out (by their first corner's row u and angle). */
  skip?: (u: number, a: number, side: number) => boolean;
  /** Limbs: which sides (default both). */
  sides?: number[];
  /** A per-angle u for row i (a jagged or curved edge). */
  rowU?: (i: number, a: number) => number;
  cls?: FitClass;
  /** The job cloth tag (character.ts setCape recolours it). */
  tag?: number;
}

/**
 * The fitter for one body. Templates (gearDefs.ts) call its primitives; `piece()` captures one piece's geometry
 * into a chunk with its cover, fit ranges and the layer it leaves for the next piece.
 */
export class Fit {
  readonly S: Surfaces; readonly st: number[]; readonly ast: number[]; readonly kk: number; readonly detail: number;
  readonly f: Frame; readonly hs: HeadShape; readonly look: Look; readonly skin: Color3;
  k!: ShapeKit;
  /** The hair's standing-off (head pieces sit on it); set after the body is built. */
  env: HairEnvelope = () => 0;
  lay: LayerSnapshot = emptyLayer();
  private cover: BodyCover = {};
  private meta: FitMeta[] = [];
  /** Small ornaments at this detail (med and up); the smallest (rivets, studs, bells, stitches) only at high; the far build (silhouette only). */
  readonly fine: boolean; readonly rich: boolean; readonly far: boolean;
  /** Ring segments round the torso and a limb (the body's). */
  readonly segT: number; readonly segL: number;

  constructor(b: FitBody) {
    this.look = b.look; this.f = b.f; this.hs = b.hs; this.detail = b.detail; this.skin = b.skin;
    this.S = surfaces(b.f, b.detail, b.bootTop);
    this.st = stations(b.f); this.ast = armStations(b.f); this.kk = b.f.H / 1.75;
    this.fine = b.detail >= 0.5; this.rich = b.detail >= 0.9; this.far = b.detail < 0.35;
    const r = ringRes(b.detail); this.segT = r.torso; this.segL = r.limb;
  }

  /** Builds one piece (into a fresh chunk) over the layers so far; returns it with its cover and fit ranges. */
  piece(detail: number, build: () => void, layerIn?: LayerSnapshot): FittedPiece {
    const ck = chunkKit(detail);
    this.k = ck.k;
    if (layerIn) this.lay = copyLayer(layerIn);
    this.cover = {}; this.meta = [];
    build();
    const chunk = ck.done();
    softClampX(chunk);
    return { chunk, cover: this.cover, meta: this.meta, layer: copyLayer(this.lay) };
  }
  /** Records what the primitives built in `fn` are (for the fit test). */
  mark(cls: FitClass, region: FitMeta['region'], fn: () => void, side?: number): void {
    const from = this.k.g.pos.length / 3;
    fn();
    const to = this.k.g.pos.length / 3;
    if (to > from) this.meta.push({ from, to, cls, region, side });
  }
  coverAlso(c: BodyCover): void {
    for (const key of ['torso', 'arm', 'leg', 'neck'] as const) if (c[key]) (this.cover[key] ??= []).push(...c[key]!);
    if (c.hands) this.cover.hands = true;
    if (c.feet) this.cover.feet = true;
    if (c.ears) this.cover.ears = true;
    if (c.hair) this.cover.hair = c.hair;
  }

  // ── places ──
  /** A landmark coordinate as the region's own parameter: torso row s, else a height (m). */
  native(region: Region, u: number): number {
    if (region === 'arm') return stY(this.ast, u);
    if (region === 'torso') return u >= ST.SHTOP ? this.S.torso.length - 2 + Math.min(1, u - ST.SHTOP) : this.S.torsoS(stY(this.st, u));
    return stY(this.st, u);
  }
  /** The surface point and normal at a landmark coordinate. */
  at(region: Region, side: number, u: number, a: number): { p: V3; n: V3 } { return this.S.at(region, side, this.native(region, u), a); }
  /** What is already worn at a place (m). */
  under(region: Region, u: number): number {
    const arr = this.lay[region], i = lidx(region, u);
    return Math.max(arr[i]!, arr[Math.max(0, i - 1)]!, arr[Math.min(arr.length - 1, i + 1)]!);
  }
  /** Records an offset as worn from u0 to u1 (m). */
  wear(region: Region, u0: number, u1: number, off: number): void {
    const arr = this.lay[region], a = lidx(region, Math.min(u0, u1)), b = lidx(region, Math.max(u0, u1));
    for (let i = a; i <= b; i++) arr[i] = Math.max(arr[i]!, off);
  }
  /**
   * Rows for a shell from u0 to u1 (landmark coordinates): both ends, every body row between (so the shell's
   * chords never cut inside the body's own) and any cuts (crisp colour edges), ascending.
   */
  rowsFor(region: Region, u0: number, u1: number, cuts: number[] = []): RowList {
    const lo = Math.min(u0, u1), hi = Math.max(u0, u1), out = [lo, hi];
    const S = this.S, nT = S.torso.length;
    const body: number[] = region === 'torso' ? S.torso.map((r, i) => (i === nT - 1 ? ST.NECK : i === nT - 2 ? ST.SHTOP : this.uOfY(r.y)))
      : region === 'arm' ? S.arm.map((r) => this.armU(r.y)) : region === 'leg' ? S.leg.map((r) => this.uOfY(r.y)) : S.neck.map((r) => this.uOfY(r.y));
    for (const u of [...body, ...cuts]) if (u > lo + 0.02 && u < hi - 0.02) out.push(u);
    out.sort((a, b) => a - b);
    return Object.assign(out.filter((u, i) => i === 0 || u - out[i - 1]! > 0.015), { cuts: cuts.filter((c) => c > lo && c < hi) });
  }
  /**
   * Leaves out the body rows a shell `allow` m off the body does not need: a row whose bulge over the chord between
   * its neighbours is under the room the offset leaves (the shell's straight span then still clears the body).
   */
  prune(region: Region, us: RowList, allow: number, angs: readonly number[] = [0, 0.9, 1.6, 2.3, 3.14, 3.9, 4.7, 5.4]): number[] {
    if (us.length <= 2 || allow <= 0) return us.slice();
    const keep = new Set([...(us.cuts ?? [])]);
    const out = [us[0]!];
    for (let i = 1; i < us.length - 1; i++) {
      const u = us[i]!;
      if (keep.has(u)) { out.push(u); continue; }
      const ua = out[out.length - 1]!, ub = us[i + 1]!, t = (u - ua) / (ub - ua);
      let bulge = -1;
      for (const a of angs) {
        const P = this.at(region, 1, u, a), A = this.at(region, 1, ua, a).p, B = this.at(region, 1, ub, a).p;
        const c: V3 = [lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)];
        bulge = Math.max(bulge, (P.p[0] - c[0]) * P.n[0] + (P.p[1] - c[1]) * P.n[1] + (P.p[2] - c[2]) * P.n[2]);
      }
      if (bulge > allow) out.push(u);
    }
    out.push(us[us.length - 1]!);
    return out;
  }

  /** The ring's angles: the body's own (× mult), or an arc. */
  angles(region: Region, mult = 1, arc?: [number, number]): number[] {
    const n = (region === 'torso' ? this.segT : region === 'neck' ? Math.max(6, Math.round(this.segL * 1.1)) : this.segL) * mult;
    if (!arc) return Array.from({ length: n }, (_, j) => (TAU * j) / n);
    const m = Math.max(2, Math.ceil(((arc[1] - arc[0]) / TAU) * n));
    return Array.from({ length: m + 1 }, (_, j) => arc[0] + ((arc[1] - arc[0]) * j) / m);
  }
  group(region: Region, side: number): ShapeGroup { return region === 'torso' ? 'body' : region === 'neck' ? 'neck' : region === 'arm' ? (side < 0 ? 'armL' : 'armR') : side < 0 ? 'legL' : 'legR'; }

  // ── shells ──
  shell(o: ShellOpts): void {
    const sides = o.region === 'arm' || o.region === 'leg' ? o.sides ?? [-1, 1] : [1];
    const angs = this.angles(o.region, o.mult ?? 1, o.arc), wrap = !o.arc;
    const offF = typeof o.off === 'number' ? (() => o.off as number) : o.off;
    const colF = typeof o.col === 'function' ? o.col : (() => o.col as Color3);
    const lip = o.lip ?? 'both', over = o.over ?? true, kk = this.kk;
    const lipOff = (MARGIN + 0.0008) * kk;
    // (rows the offset makes unneeded are left out: the body's own rows stay wherever the body bulges past the room)
    let minOff = Infinity;
    for (const u of o.rows) for (const a of [0, 1.6, 3.14, 4.7]) minOff = Math.min(minOff, offF(u, a));
    let rows0 = o.rows as RowList;
    if (o.region === 'torso' && rows0.some((u) => u > ST.NECK - 0.12)) {
      // (a torso shell ends on the shoulders' roof just short of the neck's ring, its lip turning up into the neck)
      rows0 = Object.assign([...new Set(rows0.map((u) => Math.min(u, ST.NECK - 0.12)))].sort((x, y) => x - y), { cuts: rows0.cuts });
    }
    if (o.region === 'leg') {
      // (a leg shell starts above the foot: on a Knollfolk the big feet reach over its low ankles)
      const lo = this.footTopU();
      if (rows0.some((u) => u < lo)) rows0 = Object.assign([...new Set(rows0.map((u) => Math.max(u, lo)))].sort((a, b) => a - b), { cuts: rows0.cuts });
      if (rows0.length < 2) return;
    }
    const us = o.rowU || o.prune === false ? rows0 : this.prune(o.region, rows0, (Math.max(minOff, MARGIN) - MARGIN * 0.9) * kk, angs);
    type RowSpec = { i: number; lip: boolean };
    const spec: RowSpec[] = us.map((_, i) => ({ i, lip: false }));
    if (lip === 'first' || lip === 'both') spec.unshift({ i: 0, lip: true });
    if (lip === 'last' || lip === 'both') spec.push({ i: us.length - 1, lip: true });
    let maxOff = 0;
    for (const side of sides) {
      const P: V3[][] = [], N: V3[][] = [], U: number[][] = [];
      for (const r of spec) {
        const row: V3[] = [], nrow: V3[] = [], urow: number[] = [];
        for (const a of angs) {
          const u = o.rowU ? o.rowU(r.i, a) : us[r.i]!;
          const { p, n } = this.at(o.region, side, u, a);
          let off = offF(u, a) * kk;
          if (over) off = Math.max(off, this.under(o.region, u) + LAYER_GAP * kk);
          off = Math.max(off, MARGIN * kk);
          if (r.lip) off = lipOff;
          else maxOff = Math.max(maxOff, off);
          row.push([p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off]); nrow.push(n); urow.push(u);
        }
        P.push(row); N.push(nrow); U.push(urow);
      }
      const g = this.group(o.region, side);
      if (o.tag) this.k.g.tagNow = o.tag;
      this.mark(o.cls ?? 'tight', o.region, () => this.k.grid(g, P, (i, j) => colF(U[i]![j]!, angs[j]!, side), {
        wrap, flat: o.flat, glow: o.glow, noOcc: false, out: (i, j) => N[i]![j]!,
        skip: o.skip ? (i, j) => o.skip!(U[i]![j]!, angs[j]!, side) : undefined,
      }), sides.length > 1 ? side : undefined);
      if (o.tag) this.k.g.tagNow = 0;
    }
    // what it leaves worn, and the body it covers (a full wrap)
    const u0 = Math.min(...us), u1 = Math.max(...us);
    this.wear(o.region, u0, u1, maxOff);
    if ((o.hide ?? wrap) && !o.skip) {
      const a = this.native(o.region, u0), b = this.native(o.region, u1), lo = Math.min(a, b), hi = Math.max(a, b);
      const eps = o.region === 'torso' ? 0.02 : 0.002;
      this.coverAlso({ [o.region]: [[lo - eps, hi + eps]] } as BodyCover);
    }
  }

  /** A band round the region (a belt, a cuff, a bracer, a lame) over everything worn there: one ring of quads. */
  band(region: Region, u: number, h: number, thick: number, col: Color3 | ((u: number, a: number, side: number) => Color3), o: Partial<ShellOpts> = {}): void {
    this.shell({ region, rows: [u - h / 2, u + h / 2], off: (uu) => Math.max(this.under(region, uu) / this.kk, 0) + thick, col, lip: 'none', hide: false, prune: false, ...o });
  }

  // ── ornaments ──
  /** A frame anchored on the body: x round the section, y along the region, z out of it; units scaled with the body. */
  frame(region: Region, side: number, u: number, a: number, off = 0, scale = this.kk): F {
    const { p, n } = this.at(region, side, u, a);
    const q = this.at(region, side, u, a + 0.05).p;
    let x = unit([q[0] - p[0], q[1] - p[1], q[2] - p[2]]);
    const y = unit(cross(n, x));
    x = unit(cross(y, n));
    const o = off * this.kk + Math.max(this.under(region, u), 0);
    const c: V3 = [p[0] + n[0] * o, p[1] + n[1] * o, p[2] + n[2] * o];
    return (X, Y, Z) => [c[0] + (x[0] * X + y[0] * Y + n[0] * Z) * scale, c[1] + (x[1] * X + y[1] * Y + n[1] * Z) * scale, c[2] + (x[2] * X + y[2] * Y + n[2] * Z) * scale];
  }

  /** A strap along the surface through (u, a) waypoints, over everything worn: a flattened tube. */
  strap(region: Region, side: number, path: [number, number][], r: number, col: Color3, lift = 0.004): void {
    const pts: V3[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const [u0, a0] = path[i]!, [u1, a1] = path[i + 1]!;
      const n = 3;
      for (let k = 0; k < n; k++) {
        const t = k / n, u = lerp(u0, u1, t), a = lerp(a0, a1, t);
        const { p, n: nn } = this.at(region, side, u, a), off = this.under(region, u) + (lift + r) * this.kk;
        pts.push([p[0] + nn[0] * off, p[1] + nn[1] * off, p[2] + nn[2] * off]);
      }
    }
    const [ue, ae] = path[path.length - 1]!, e = this.at(region, side, ue, ae), oe = this.under(region, ue) + (lift + r) * this.kk;
    pts.push([e.p[0] + e.n[0] * oe, e.p[1] + e.n[1] * oe, e.p[2] + e.n[2] * oe]);
    this.mark('orn', region, () => this.k.tube(this.group(region, side), pts, r * this.kk, col, { seg: this.fine ? 4 : 3, flatten: 0.45, noOcc: true }));
  }

  // ── hanging cloth ──
  /** The lower body's section at height y (points, m), with what is worn on it: torso, both legs (and boots). */
  private section(y: number, nA = 16): V3[] {
    const pts: V3[] = [], f = this.f, kk = this.kk;
    if (y > f.crotchY - 0.01 * kk) {
      const s = this.S.torsoS(y), u = this.uOfY(y), w = this.under('torso', u);
      for (let j = 0; j < nA; j++) { const a = (TAU * j) / nA, { p, n } = this.S.at('torso', 1, s, a); pts.push([p[0] + n[0] * w, y, p[2] + n[2] * w]); }
    }
    if (y < f.hipY + 0.03 * kk) for (const side of [-1, 1]) {
      const u = this.uOfY(y), w = this.under('leg', u);
      for (let j = 0; j < 8; j++) { const a = (TAU * j) / 8, p = this.S.legAt(side, y, a), c = side * legAxisOf(this.S, y); const d = unit([p[0] - c, 0, p[2]]); pts.push([p[0] + d[0] * w, y, p[2] + d[2] * w]); }
    }
    return pts;
  }
  /** A height as a landmark coordinate (ST). */
  uOfY(y: number): number {
    const st = this.st;
    for (let i = 0; i < st.length - 1; i++) if (y <= st[i + 1]!) return i + clamp((y - st[i]!) / Math.max(1e-6, st[i + 1]! - st[i]!), 0, 1);
    return st.length - 1;
  }

  /**
   * A skirt from the hips (u `top`) to its hem (u `hem`, or by angle): at every height its radius by direction is the
   * lower body's support there (legs, seat, what is worn on them) plus `clear`, flaring by `flare` towards the hem.
   */
  skirt(o: { top: number; hem: number | ((a: number) => number); clear?: number; flare?: number; col: (t: number, a: number) => Color3; rows?: number; arc?: [number, number]; mult?: number; flat?: boolean; lip?: boolean; tag?: number; cls?: FitClass }): void {
    const kk = this.kk, angs = this.angles('torso', o.mult ?? 1, o.arc), wrap = !o.arc;
    const hemOf = typeof o.hem === 'number' ? (() => o.hem as number) : o.hem;
    const nR = Math.max(2, o.rows ?? (this.far ? 2 : this.rich ? 6 : this.fine ? 4 : 3));
    const clear = (o.clear ?? 0.012) * kk, flare = (o.flare ?? 0.04) * kk;
    const P: V3[][] = [], T: number[] = [];
    const yTop = stY(this.st, o.top);
    let maxDrop = 0;
    for (let i = 0; i <= nR; i++) {
      const t = i / nR, row: V3[] = [];
      for (const a of angs) {
        const yHem = Math.max(stY(this.st, hemOf(a)), this.f.footH * 1.15 + 0.02 * kk), y = lerp(yTop, yHem, t);
        const sec = this.section(y);
        const ux = Math.sin(a), uz = Math.cos(a);
        let h = 0;
        for (const p of sec) h = Math.max(h, p[0] * ux + p[2] * uz);
        const rr = h + (i === 0 ? LAYER_GAP * kk : clear + flare * t * t);
        row.push([ux * rr, y, uz * rr]);
        maxDrop = Math.max(maxDrop, yTop - yHem);
      }
      P.push(row); T.push(t);
    }
    if (o.lip !== false) {
      // the hem's inside edge: a narrow band turned in, so the cloth has a thickness from below
      const last = P[P.length - 1]!;
      P.push(last.map((p) => [p[0] * 0.94, p[1] + 0.012 * kk, p[2] * 0.94] as V3)); T.push(1.01);
    }
    if (o.tag) this.k.g.tagNow = o.tag;
    this.mark(o.cls ?? 'free', 'torso', () => this.k.grid('body', P, (i, j) => o.col(Math.min(1, T[i]!), angs[j]!), { wrap, flat: o.flat, out: (i, j) => { const p = P[i]![j]!; return i === P.length - 1 && o.lip !== false ? [-p[0], -0.3, -p[2]] : [p[0], 0, p[2]]; } }));
    if (o.tag) this.k.g.tagNow = 0;
    // a skirt leaves its clearance worn on the torso band it starts on (a cape or a tabard hangs over it)
    this.wear('torso', o.top - 0.6, o.top, LAYER_GAP * kk);
    void maxDrop;
  }

  /** The back's depth (min z, m) at height y near x (|x − x0| < w), with what is worn there. */
  backZ(y: number, x0: number, w = 0.08): number {
    let z = 0, any = false;
    const sec = this.section(y, 20);
    for (const p of sec) if (Math.abs(p[0] - x0) < w * this.kk) { z = any ? Math.min(z, p[2]) : p[2]; any = true; }
    if (!any) for (const p of sec) z = Math.min(z, p[2]);
    return z;
  }
  private frontZ(y: number, x0: number, w = 0.05): number {
    let z = 0, any = false;
    const sec = this.section(y, 20);
    for (const p of sec) if (Math.abs(p[0] - x0) < w * this.kk) { z = any ? Math.max(z, p[2]) : p[2]; any = true; }
    if (!any) for (const p of sec) z = Math.max(z, p[2]);
    return z;
  }

  /**
   * A cape down the back: its top on the upper back (u `top`) over what is worn, `width` 0..1 of the back's half
   * round, `len` m (at 1.75 m) long, clear of the back, seat and legs all the way down; a Brindlekin's tail leaves
   * through a slit.
   */
  cape(o: { top: number; len: number; width?: number; flare?: number; hem?: (v: number) => number; col: (v: number, t: number) => Color3; cols?: number; rows?: number; clear?: number; thick?: number; tag?: number; tagSkip?: Color3 }): void {
    const kk = this.kk, f = this.f;
    const cols = (o.cols ?? (this.far ? 4 : this.fine ? 8 : 6));
    const rows = o.rows ?? (this.far ? 4 : this.fine ? 9 : 6);
    const spread = (o.width ?? 0.8) * 1.25, clear = (o.clear ?? 0.02) * kk;
    const sTop = this.native('torso', o.top), wTop = this.under('torso', o.top) + LAYER_GAP * kk + (o.thick ?? 0.016) * kk * 0.6;
    const tailY = this.look.fur ? f.hipY + 0.02 * kk : -1;
    const grid: V3[][] = [];
    const xs: number[] = [], zTop: number[] = [];
    for (let j = 0; j <= cols; j++) {
      const v = j / cols * 2 - 1, a = Math.PI + v * spread;
      const { p, n } = this.S.at('torso', 1, sTop, a);
      // (inside the pauldrons' inner edge: the cape hangs between them, not through them)
      const xMax = this.lay.paulIn - 0.012 * kk;
      xs.push(clamp(p[0] + n[0] * wTop, -xMax, xMax)); zTop.push(p[2] + n[2] * wTop);
    }
    const yTop = this.S.torsoAt(sTop, Math.PI)[1];
    const prevZ = zTop.slice();
    for (let i = 0; i <= rows; i++) {
      const t = i / rows, row: V3[] = [];
      for (let j = 0; j <= cols; j++) {
        const v = j / cols * 2 - 1;
        const len = o.len * kk * (1 + (o.hem ? o.hem(v) : 0));
        const y = yTop - t * len;
        const x = xs[j]! * (1 + (o.flare ?? 0.25) * t);
        let z = zTop[j]!;
        if (i > 0) z = Math.min(prevZ[j]! - 0.004 * kk, this.backZ(y, x) - clear - 0.01 * kk * t);
        prevZ[j] = z;
        row.push([x, y, z]);
      }
      grid.push(row);
    }
    const paint = (_w: Vector3, uv: [number, number]) => o.col(uv[0] * 2 - 1, uv[1]);
    const sheet = (g: V3[][]) => this.mark('free', 'cape', () => this.k.sheet('cape', g, (o.thick ?? 0.016) * kk, o.col(0, 0), { paint }));
    if (o.tag) { this.k.g.tagNow = o.tag; this.k.g.tagSkip = o.tagSkip ?? null; }
    if (tailY > 0 && grid.some((r) => r[0]![1] < tailY)) {
      // the tail's slit: the cape parts below the small of the back
      const cut = grid.findIndex((r) => r[0]![1] < tailY);
      const mid = Math.floor(cols / 2);
      const upper = grid.slice(0, Math.max(2, cut + 1));
      if (upper.length >= 2) sheet(upper);
      const lower = grid.slice(Math.max(0, cut));
      if (lower.length >= 2) {
        sheet(lower.map((r) => r.slice(0, mid)));
        sheet(lower.map((r) => r.slice(mid + 1)));
      }
    } else sheet(grid);
    if (o.tag) { this.k.g.tagNow = 0; this.k.g.tagSkip = null; }
    this.wear('torso', o.top - 2.5, o.top, wTop + (o.thick ?? 0.016) * kk);
  }

  /**
   * A panel down the front (a tabard, an apron, a robe's front): `half` m wide either side of the middle, from u
   * `top` on the chest over what is worn there, hanging clear of the legs below the hips to u `bottom`.
   */
  panel(o: { top: number; bottom: number; half: number | ((t: number) => number); col: (v: number, t: number) => Color3; rows?: number; clear?: number; thick?: number; back?: boolean; tag?: number; tagSkip?: Color3 }): void {
    const kk = this.kk, rows = o.rows ?? (this.far ? 3 : this.fine ? 7 : 5), cols = this.fine ? 4 : 2;
    const yTop = stY(this.st, o.top), yBot = stY(this.st, o.bottom);
    const halfF = typeof o.half === 'number' ? (() => o.half as number) : o.half;
    const grid: V3[][] = [];
    let prev: number[] = [];
    for (let i = 0; i <= rows; i++) {
      const t = i / rows, y = lerp(yTop, yBot, t), row: V3[] = [];
      // the row's depth: the farthest point under its whole width (it bridges a bust or a belly, never dips between)
      let zr = o.back ? Infinity : -Infinity;
      for (let j = 0; j <= cols; j++) { const x = (j / cols * 2 - 1) * halfF(t) * kk; zr = o.back ? Math.min(zr, this.backZ(y, x, 0.05)) : Math.max(zr, this.frontZ(y, x, 0.05)); }
      for (let j = 0; j <= cols; j++) {
        const v = j / cols * 2 - 1, x = v * halfF(t) * kk;
        const zb = zr;
        let z = zb + (o.back ? -1 : 1) * ((o.clear ?? 0.006) * kk + LAYER_GAP * kk);
        if (i > 0) z = o.back ? Math.min(z, prev[j]!) : Math.max(z, prev[j]! - (y < this.f.crotchY ? 0 : 1));
        prev[j] = z;
        row.push([x, y, z]);
      }
      grid.push(row);
    }
    if (o.tag) { this.k.g.tagNow = o.tag; this.k.g.tagSkip = o.tagSkip ?? null; }
    // one-sided (it lies on the body or hangs in front of it): its outside faces away from the body
    const sgn = o.back ? -1 : 1;
    this.mark('free', 'torso', () => this.k.grid('body', grid, (i, j) => o.col(j / cols * 2 - 1, i / rows), { out: () => [0, 0, sgn], noOcc: true }));
    if (o.tag) { this.k.g.tagNow = 0; this.k.g.tagSkip = null; }
  }

  // ── fitted shapes ──
  /**
   * A pauldron: a dome over the shoulder joint sized to enclose the shoulder (the arm's cap and the torso's slope)
   * and what is worn there, in the proportions `aspect` (x out, y up, z front-back), its bottom cut at `cut` (−1..1).
   */
  pauldron(o: { aspect: V3; lift?: number; out?: number; cut?: number; lames?: number; col: Color3; paint?: (l: Vector3) => Color3 | undefined; scale?: number; seg?: number; flat?: boolean; power?: number; drop?: number }): void {
    const f = this.f, kk = this.kk;
    for (const side of [-1, 1]) {
      const c: V3 = [side * (f.shX + (o.out ?? 0) * kk), f.shY + f.uArmR * 0.25 + (o.lift ?? 0) * kk - (o.drop ?? 0) * kk, 0];
      const pts: V3[] = [];
      const armTop = stY(this.ast, 0), armLo = f.shY - f.uArmR * 0.6;
      for (const y of [armTop, lerp(armTop, f.shY, 0.5), f.shY, lerp(f.shY, armLo, 0.5), armLo]) for (let j = 0; j < 8; j++) {
        const a = (TAU * j) / 8;
        const { p, n } = this.S.at('arm', side, y, a), w = this.under('arm', this.armU(y));
        pts.push([p[0] + n[0] * w, p[1] + n[1] * w, p[2] + n[2] * w]);
      }
      for (const u of [ST.SH - 0.3, ST.SH, ST.SHTOP]) for (let j = 0; j < 12; j++) {
        const a = (TAU * j) / 12;
        const { p, n } = this.at('torso', 1, u, a), w = this.under('torso', u);
        if (p[0] * side < f.shX * 0.55) continue;
        pts.push([p[0] + n[0] * w, p[1] + n[1] * w, p[2] + n[2] * w]);
      }
      const asp = o.aspect;
      let lam = 0;
      const cut = o.cut ?? -0.35;
      for (const p of pts) {
        const dx = (p[0] - c[0]) / asp[0], dy = (p[1] - c[1]) / asp[1], dz = (p[2] - c[2]) / asp[2];
        if (dy < cut * Math.hypot(dx, dy, dz)) continue;   // below the cut: the sleeve's business
        lam = Math.max(lam, Math.hypot(dx, dy, dz));
      }
      const sc = (o.scale ?? 1);
      const rad: V3 = [asp[0] * lam * sc + MARGIN * kk * 1.5, asp[1] * lam * sc + MARGIN * kk * 1.5, asp[2] * lam * sc + MARGIN * kk * 1.5];
      const g: ShapeGroup = side < 0 ? 'armL' : 'armR';
      // the dome (a lathe from its cut up to its crown: no hidden underside), then its lames: bands lower down the
      // arm, each a little wider (overlapping like a lobster's tail)
      const pw = o.power ?? 0.85, seg = o.seg ?? (this.fine ? 9 : 7);
      const prof = (t0: number, t1: number, n: number): [number, number][] => Array.from({ length: n + 1 }, (_, i) => {
        const t = t0 + ((t1 - t0) * i) / n;
        return [t, Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), 2 / pw)), pw / 2)] as [number, number];
      });
      const nL = this.far ? 0 : Math.min(o.lames ?? 0, this.fine ? 3 : 1);
      for (let i = 0; i <= nL; i++) {
        const ci: V3 = [c[0] + side * i * 0.01 * kk, c[1] - i * rad[1] * 0.45, c[2]];
        const ri: V3 = [rad[0] * (1 + 0.07 * i), rad[1], rad[2] * (1 + 0.05 * i)];
        const pr = i ? prof(cut + 0.05, cut + 0.5, 2) : prof(cut, 1, this.far ? 2 : this.fine ? 4 : 3);
        const col = i ? shadeC(o.col, 1 - 0.07 * i) : o.col;
        this.mark('orn', 'arm', () => this.k.lathe(g, ci, pr.map(([t, r]) => [t * ri[1], r * ri[0]] as [number, number]), col, { seg, sz: ri[2] / ri[0], flat: o.flat, noOcc: true, caps: false,
          paint: o.paint ? (_w, _uv, l) => o.paint!(new Vector3(l.x / ri[0], l.y / ri[1], l.z / ri[2])) : undefined }), side);
      }
      this.lay.paulIn = Math.min(this.lay.paulIn, Math.abs(c[0]) - 0.55 * rad[0]);
      if (side > 0) this.lay.paul = { c: [c[0], c[1], c[2]], r: rad };
    }
  }
  /**
   * A frame standing on the pauldron of `side` at direction d (unit, x outward, y up, z forward), `out` m off it
   * (null: no pauldron worn). Fins, cogs, spikes and lenses on the shoulder stand here, never in the air.
   */
  paulFrame(side: number, d: V3, out = 0, scale = this.kk): F | null {
    const pa = this.lay.paul;
    if (!pa) return null;
    const dd = unit(d), r = pa.r;
    const p: V3 = [side * (pa.c[0] + dd[0] * r[0]), pa.c[1] + dd[1] * r[1], pa.c[2] + dd[2] * r[2]];
    const n = unit([side * dd[0] / r[0], dd[1] / r[1], dd[2] / r[2]]);
    let x = unit(cross([0, 1, 0], n));
    if (Math.hypot(...x) < 0.5) x = [side, 0, 0];
    const y = unit(cross(n, x)), o = out * this.kk;
    const c: V3 = [p[0] + n[0] * o, p[1] + n[1] * o, p[2] + n[2] * o];
    return (X, Y, Z) => [c[0] + (x[0] * X + y[0] * Y + n[0] * Z) * scale, c[1] + (x[1] * X + y[1] * Y + n[1] * Z) * scale, c[2] + (x[2] * X + y[2] * Y + n[2] * Z) * scale];
  }
  /** The foot's top (its instep, with a boot's room) as a landmark coordinate: leg shells start above it. */
  footTopU(): number { return this.uOfY(this.f.footH * 1.12 + 0.014 * this.kk); }
  /** A height on the arm as an arm landmark coordinate (AST). */
  armU(y: number): number {
    const a = this.ast;
    for (let i = 0; i < a.length - 1; i++) if (y >= a[i + 1]!) return i + clamp((a[i]! - y) / Math.max(1e-6, a[i]! - a[i + 1]!), 0, 1);
    return a.length - 1;
  }

  /** Hands: the body's palm and fingers grown by `off`, a thumb, the fingers in `fingers` (skin: fingerless). */
  hands(o: { off: number; col: Color3; fingers?: Color3; knuckle?: Color3; paint?: (l: Vector3, part: 'palm' | 'fingers') => Color3 | undefined; flat?: boolean; mitten?: boolean }): void {
    const f = this.f, kk = this.kk, off = o.off * kk;
    for (const sx of [-1, 1]) {
      const g: ShapeGroup = sx < 0 ? 'armL' : 'armR';
      const axX = (y: number) => sx * armAxisOf(this.S, y);
      const hx = axX(f.wristY), hy = f.wristY, hl = f.handL, hw = f.handW;
      const hseg = this.detail >= 0.9 ? 8 : this.detail >= 0.5 ? 6 : 5, hlat = this.detail >= 0.5 ? 5 : 3;
      const fc = o.fingers ?? o.col;
      this.mark('tight', 'hand', () => {
        this.k.ellip(g, [hx, hy - hl * 0.27, 0.003 * kk], [hw * 0.28 + off, hl * 0.28 + off, hw * 0.5 + off], o.col, { seg: hseg, lat: hlat, power: 0.8, flat: o.flat, noOcc: true, paint: o.paint ? (_w, _uv, l) => o.paint!(l, 'palm') : undefined });
        this.k.ellip(g, [hx - sx * hw * 0.05, hy - hl * 0.7, 0.006 * kk], [hw * 0.23 + off * (o.mitten ? 1.2 : 0.8), hl * 0.26 + off * 0.8, hw * 0.47 + off * 0.8], fc, { seg: hseg, lat: hlat, power: 0.85, flat: o.flat, rot: [0.18, 0, sx * 0.08], noOcc: true, paint: o.paint ? (_w, _uv, l) => o.paint!(l, 'fingers') : undefined });
        if (this.detail >= 0.5) this.k.tube(g, [[hx - sx * hw * 0.1, hy - hl * 0.14, hw * 0.34], [hx - sx * hw * 0.2, hy - hl * 0.34, hw * 0.52], [hx - sx * hw * 0.22, hy - hl * 0.5, hw * 0.5]],
          [hw * 0.17 + off * 0.8, hw * 0.15 + off * 0.8, hw * 0.1 + off * 0.6], fc, { seg: this.detail >= 0.5 ? 6 : 4, noOcc: true });
      });
    }
    this.coverAlso({ hands: true });
  }

  /** Feet: the body's foot grown by `off`, its toe pointed, curled or squared, a sole, a heel. */
  feet(o: { off: number; col: Color3; sole?: Color3; toe?: 'round' | 'point' | 'curl' | 'square'; heel?: number; paint?: (l: Vector3, w: Vector3) => Color3 | undefined; flat?: boolean; power?: number; long?: number }): void {
    const f = this.f, kk = this.kk, off = o.off * kk;
    for (const sx of [-1, 1]) {
      const g: ShapeGroup = sx < 0 ? 'legL' : 'legR';
      const fx = sx * legAxisOf(this.S, f.ankleY);
      const sole = o.sole ?? new Color3(o.col.r * 0.55, o.col.g * 0.55, o.col.b * 0.55);
      const toe = o.toe ?? 'round', long = o.long ?? 0;
      this.mark('tight', 'foot', () => this.k.ellip(g, [fx, f.footH * 0.5 + off * 0.3, f.footL * 0.24 - 0.02 * kk + long * kk * 0.5], [f.footW + off, f.footH * 0.52 + off * 0.9, f.footL * 0.5 + off + long * kk], o.col, {
        seg: this.detail >= 0.9 ? 9 : this.detail >= 0.5 ? 7 : 5, lat: this.detail >= 0.5 ? 5 : 3, power: o.power ?? 0.72, flat: o.flat, noOcc: true,
        paint: (w, _uv, l) => (w.y < 0.018 * kk + off * 0.3 ? sole : o.paint?.(l, w)),
        deform: (l) => {
          if (l.z < 0 && l.y > 0) l.y *= 1 + 0.4 * -l.z;
          if (l.z > 0.3) l.y *= 1 - 0.35 * (l.z - 0.3);
          if (toe === 'point' && l.z > 0.35) { const t = (l.z - 0.35) / 0.65; l.x *= 1 - 0.7 * t; l.y *= 1 - 0.3 * t; }
          if (toe === 'curl' && l.z > 0.45) { const t = (l.z - 0.45) / 0.55; l.x *= 1 - 0.75 * t; l.y += 0.9 * t * t; }
          if (toe === 'square' && l.z > 0.2) { l.x = Math.sign(l.x) * Math.min(1, Math.abs(l.x) * 1.15); l.z = Math.min(l.z, 0.86); }
          if (o.heel && l.z < -0.4 && l.y < -0.3) l.y -= o.heel;
        },
      }));
    }
    this.coverAlso({ feet: true });
  }

  // ── the head ──
  /** A point over the skull in direction d, `out` m along the normal (model space), and the normal. */
  headAt(d: V3, out: number): { p: V3; n: V3 } {
    const dd = norm(d), p = this.hs.local(...dd), n = this.hs.normal(...dd);
    return { p: [p[0] + n[0] * out, this.hs.cy + p[1] + n[1] * out, this.hs.cz + p[2] + n[2] * out], n };
  }
  /** A frame on the skull: x to the head's right, y up the skull, z out. */
  headFrame(d: V3, out: number, scale = this.kk): F {
    const { p, n } = this.headAt(d, out);
    let x = unit(cross([0, 1, 0], n));
    if (Math.hypot(...x) < 0.5) x = [1, 0, 0];
    const y = unit(cross(n, x));
    return (X, Y, Z) => [p[0] + (x[0] * X + y[0] * Y + n[0] * Z) * scale, p[1] + (x[1] * X + y[1] * Y + n[1] * Z) * scale, p[2] + (x[2] * X + y[2] * Y + n[2] * Z) * scale];
  }
  /** Where the ears come through a head piece (Larchfolk's long ears, the Brindlekin's on top): directions and sizes. */
  earHoles(): { d: V3; r: number }[] {
    const l = this.look;
    if (l.people === 'brindlekin') {
      const lop = l.ears.style === 5;
      return [-1, 1].map((sx) => ({ d: norm(lop ? [sx * 0.9, 0.35, -0.05] : [sx * 0.56, 0.8, -0.08]), r: lop ? 0.46 : 0.66 }));
    }
    if (l.people === 'larchfolk') return [-1, 1].map((sx) => ({ d: norm([sx * 0.95, 0.18, -0.2]), r: 0.5 }));
    return [];
  }
  /**
   * A shell over the skull from the crown down to its edge `thMax(ph)` (polar angle from the crown, by azimuth ph:
   * the face's opening, cheek guards, the nape), `off` m off the skull — and off the hair where it sits on hair.
   */
  headShell(o: { thMax: (ph: number) => number; off: number | ((d: V3) => number); col: (d: V3) => Color3; overHair?: boolean; rows?: number; seg?: number; holes?: { d: V3; r: number }[]; lip?: boolean; flat?: boolean; glow?: boolean; cls?: FitClass }): void {
    const kk = this.kk;
    const seg = o.seg ?? (this.far ? 8 : this.detail >= 0.9 ? 16 : this.fine ? 12 : 10), lat = o.rows ?? (this.far ? 4 : this.detail >= 0.9 ? 8 : this.fine ? 6 : 5);
    const offF = typeof o.off === 'number' ? (() => o.off as number) : o.off;
    const P: V3[][] = [], N: V3[][] = [], D: V3[][] = [];
    const rows = Array.from({ length: lat + 1 }, (_, i) => i / lat);
    if (o.lip !== false) rows.push(1.0001);
    for (const t of rows) {
      const row: V3[] = [], nr: V3[] = [], dr: V3[] = [];
      for (let j = 0; j < seg; j++) {
        const ph = (TAU * j) / seg, th = Math.max(0.02, Math.min(1, t) * o.thMax(ph));
        const d: V3 = [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
        let out = offF(d) * kk + ((o.overHair ?? true) ? this.env(d) : 0);
        if (t > 1) out = (MARGIN + 0.001) * kk + ((o.overHair ?? true) ? this.env(d) : 0);   // (the lip turns back to the hair or beard under it)
        out = Math.max(out, MARGIN * kk);
        const { p, n } = this.headAt(d, out);
        row.push(p); nr.push(n); dr.push(d);
      }
      P.push(row); N.push(nr); D.push(dr);
    }
    const holes = o.holes ?? [];
    const inHole = (d: V3) => holes.some((h) => Math.acos(clamp(d[0] * h.d[0] + d[1] * h.d[1] + d[2] * h.d[2], -1, 1)) < h.r);
    this.mark(o.cls ?? 'tight', 'head', () => this.k.grid('head', P, (i, j) => o.col(D[i]![j]!), { wrap: true, flat: o.flat, glow: o.glow, noOcc: true, out: (i, j) => N[i]![j]!,
      skip: holes.length ? (i, j) => inHole(D[i]![j]!) || inHole(D[Math.min(P.length - 1, i + 1)]![(j + 1) % seg]!) : undefined }));
    let mx = 0;
    for (const r of P) for (const p of r) mx = Math.max(mx, Math.hypot(p[0], p[1] - this.hs.cy, p[2] - this.hs.cz));
    this.lay.head = Math.max(this.lay.head, mx);
    // rims round the openings the ears come through
    if (this.fine) for (const h of holes) {
      const ring: V3[] = [];
      const ax = h.d, t1 = unit(cross(ax, Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), t2 = cross(ax, t1);
      for (let i = 0; i <= 8; i++) {
        const q = (i / 8) * TAU, d = norm([ax[0] * Math.cos(h.r) + (t1[0] * Math.cos(q) + t2[0] * Math.sin(q)) * Math.sin(h.r), ax[1] * Math.cos(h.r) + (t1[1] * Math.cos(q) + t2[1] * Math.sin(q)) * Math.sin(h.r), ax[2] * Math.cos(h.r) + (t1[2] * Math.cos(q) + t2[2] * Math.sin(q)) * Math.sin(h.r)]);
        ring.push(this.headAt(d, offF(d) * kk + this.env(d) + 0.002 * kk).p);
      }
      this.mark('orn', 'head', () => this.k.tube('head', ring, 0.006 * kk, o.col(h.d), { seg: 4, noOcc: true, caps: false }));
    }
  }
  /** A ring round the head at polar angle th (a circlet, a hat's band, a brim's root), over hair. */
  headRing(th: number, out: number, r: number, col: Color3, o: { tilt?: number; seg?: number; glow?: boolean; flatten?: number } = {}): V3[] {
    const seg = o.seg ?? (this.fine ? 14 : 10), pts: V3[] = [];
    for (let j = 0; j <= seg; j++) {
      const ph = (TAU * j) / seg, tt = th + (o.tilt ?? 0) * Math.cos(ph);
      const d: V3 = [Math.sin(tt) * Math.sin(ph), Math.cos(tt), Math.sin(tt) * Math.cos(ph)];
      pts.push(this.headAt(d, out * this.kk + this.env(d) + r * this.kk).p);
    }
    this.mark('orn', 'head', () => this.k.tube('head', pts, r * this.kk, col, { seg: 4, noOcc: true, caps: false, glow: o.glow, flatten: o.flatten }));
    return pts;
  }
  /** A brim round the head at polar angle th: `width` m out from the crown's edge, drooping or turned up. */
  brim(th: number, out: number, width: number, col: Color3, o: { droop?: number; tilt?: number; up?: number; paint?: (ph: number, t: number) => Color3 | undefined } = {}): void {
    const kk = this.kk, seg = this.fine ? 16 : 10;
    // ears that stand up through the hat (the Brindlekin's) part the brim: it is built in runs between them
    const gaps = this.earHoles().filter((h) => h.d[1] > 0.5).map((h) => Math.atan2(h.d[0], h.d[2]));
    const inGap = (ph: number) => gaps.some((g) => Math.abs(Math.atan2(Math.sin(ph - g), Math.cos(ph - g))) < 0.42);
    const runs: number[][] = [];
    let cur: number[] = [];
    for (let j = 0; j <= seg; j++) { const ph = (TAU * j) / seg; if (inGap(ph)) { if (cur.length > 1) runs.push(cur); cur = []; } else cur.push(ph); }
    if (cur.length > 1) runs.push(cur);
    for (const run of runs) {
      const P: V3[][] = [];
      for (const t of [0, 0.5, 1]) {
        const row: V3[] = [];
        for (const ph of run) {
          const tt = th + (o.tilt ?? 0) * Math.cos(ph);
          const d: V3 = [Math.sin(tt) * Math.sin(ph), Math.cos(tt), Math.sin(tt) * Math.cos(ph)];
          const base = this.headAt(d, out * kk + this.env(d)).p;
          const hx = Math.sin(ph), hz = Math.cos(ph), w = width * kk * t;
          const up = (o.up ?? 0) * Math.max(0, Math.sin(ph)) * t * t * kk;
          row.push([base[0] + hx * w, base[1] - (o.droop ?? 0) * kk * t * t + up, base[2] + hz * w]);
        }
        P.push(row);
      }
      this.mark('orn', 'head', () => this.k.sheet('head', P, 0.01 * kk, col, { paint: o.paint ? (_w, uv) => o.paint!(uv[0] * TAU, uv[1]) : undefined }));
    }
  }
}

const shadeC = (c: Color3, f: number) => new Color3(Math.min(1, c.r * f), Math.min(1, c.g * f), Math.min(1, c.b * f));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const armAxisOf = (S: Surfaces, y: number) => { const f = S.f; return f.shX + (f.shY - y) * 0.04 + Math.max(0, f.elbowY - y) * f.carry; };
const legAxisOf = (S: Surfaces, y: number) => { const f = S.f, kIn = 1 - f.kneeIn, aIn = kIn - 0.04; return y > f.kneeY ? lerp(f.legX * kIn, f.legX, Math.min(1, (y - f.kneeY) / (f.hipY - f.kneeY))) : lerp(f.legX * aIn, f.legX * kIn, Math.max(0, (y - f.ankleY) / (f.kneeY - f.ankleY))); };

/** Where the soft hold on |x| starts, and the most it allows (inside ADVENTURER_RADIUS). */
export const X_SOFT = ADVENTURER_RADIUS - 0.04, X_MAX = ADVENTURER_RADIUS - 0.004;
/** Holds every vertex's |x| inside the hit radius, softly: nothing changes below X_SOFT. */
export function softClampX(c: GearChunk): void {
  const span = X_MAX - X_SOFT;
  for (const g of [c.g, c.glow]) for (let i = 0; i < g.pos.length; i += 3) {
    const x = g.pos[i]!, ax = Math.abs(x);
    if (ax > X_SOFT) g.pos[i] = Math.sign(x) * (X_SOFT + span * Math.tanh((ax - X_SOFT) / span));
  }
}
export { AST, ST };
