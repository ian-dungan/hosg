// Low-poly helpers for gear and weapon models (Plan 5 Task 9), on top of character.ts's shape kit: flat polygons,
// star-shaped prisms (cogs, shields, discs), bevelled blades from slices, cones (thorns, spikes), and frames that
// place a model's own space (y along the blade or the staff, x across, z the thickness) onto a joint. Everything
// goes through the kit's geometry, so it is skinned, warped by the look and merged into the adventurer's one mesh;
// `glow` puts it in the emissive mesh. Positions are canonical human metres (character.ts humanPivots).
import { Color3, Vector3 } from '@babylonjs/core';
import { PALETTE } from '../core/contracts';
import type { ShapeGroup, ShapeKit, V3 } from './character';

// ───────── colours (PALETTE-derived) ─────────
export const hex = (h: string) => Color3.FromHexString(h);
export const mix = (a: Color3, b: Color3, t: number) => Color3.Lerp(a, b, t);
export const shade = (c: Color3, f: number) => new Color3(Math.min(1, c.r * f), Math.min(1, c.g * f), Math.min(1, c.b * f));
export const P = {
  skyDeep: hex(PALETTE.skyDeep), sky: hex(PALETTE.sky), horizon: hex(PALETTE.horizon), cloud: hex(PALETTE.cloud),
  stone: hex(PALETTE.stone), roof: hex(PALETTE.roof), teal: hex(PALETTE.teal), meadow: hex(PALETTE.meadow),
  cliff: hex(PALETTE.cliff), rock: hex(PALETTE.rock), gold: hex(PALETTE.gold),
};
/** Fixed materials (never dyed): metals, leather, wood, glass and the glows. */
export const M = {
  steel: mix(P.cloud, P.sky, 0.22),
  bright: mix(P.cloud, P.sky, 0.1),
  iron: shade(P.rock, 0.42),
  darkSteel: shade(mix(P.rock, P.sky, 0.25), 0.62),
  brass: shade(mix(P.gold, P.cliff, 0.18), 0.88),
  brassDark: shade(mix(P.gold, P.cliff, 0.3), 0.6),
  gold: P.gold,
  leather: shade(mix(P.cliff, P.gold, 0.2), 0.48),
  leatherLight: shade(mix(P.cliff, P.gold, 0.4), 0.72),
  wood: shade(mix(P.cliff, P.gold, 0.35), 0.62),
  woodPale: mix(P.stone, P.gold, 0.25),
  woodDark: shade(mix(P.rock, P.cliff, 0.3), 0.48),
  bark: shade(mix(P.cliff, P.rock, 0.45), 0.5),
  leaf: shade(P.meadow, 0.78),
  berry: shade(P.roof, 0.85),
  ember: mix(P.roof, P.gold, 0.45),
  emberDeep: shade(P.roof, 0.7),
  soot: shade(P.rock, 0.3),
  glass: mix(P.sky, P.cloud, 0.62),
  stoneGrey: mix(P.stone, P.cloud, 0.25),
  /** T3 rarity (violet), on unnamed T3 off-hands and the T3 sets' jewels. */
  violet: mix(P.rock, P.skyDeep, 0.25),
  violetLight: mix(P.rock, P.cloud, 0.35),
  // glows (emissive mesh: drawn at full brightness)
  glowWarm: mix(P.gold, P.cloud, 0.45),
  glowEmber: mix(P.roof, P.gold, 0.55),
  glowLens: mix(P.teal, P.cloud, 0.55),
  glowBeacon: mix(P.horizon, P.gold, 0.5),
  glowStar: mix(P.sky, P.cloud, 0.6),
};

// ───────── frames ─────────
/** A point in a model's own space mapped to canonical metres. */
export type F = (x: number, y: number, z: number) => V3;
/** A frame from an origin and two axes (x across, y along; z = x × y, the thickness or the face's normal). */
export function basis(o: V3, X: V3, Y: V3): F {
  const x = new Vector3(...X).normalize(), y = new Vector3(...Y).normalize();
  const z = Vector3.Cross(x, y).normalize();
  return (a, b, c) => [o[0] + x.x * a + y.x * b + z.x * c, o[1] + x.y * a + y.y * b + z.y * c, o[2] + x.z * a + y.z * b + z.z * c];
}
/** character.ts's frameAt: origin `o`, turned `rx` about X then `rz` about Z. */
export function frameAt(o: V3, rx: number, rz: number): F {
  const cx = Math.cos(rx), sx = Math.sin(rx), cz = Math.cos(rz), sz = Math.sin(rz);
  return (x, y, z) => {
    const y1 = y * cx - z * sx, z1 = y * sx + z * cx;
    const x2 = x * cz - y1 * sz, y2 = x * sz + y1 * cz;
    return [o[0] + x2, o[1] + y2, o[2] + z1];
  };
}
/** The same frame with a model-space offset (y shifted, z flipped, scaled). */
export const shifted = (f: F, dy: number, flipZ = false, sc = 1): F => (x, y, z) => f(x * sc, (y + dy) * sc, (flipZ ? -z : z) * sc);

// ───────── raw geometry ─────────
const v3 = (p: V3) => new Vector3(p[0], p[1], p[2]);
/** Adds triangles straight into the kit's geometry (flat-shaded). `out` per vertex orients each triangle outward. */
export function raw(k: ShapeKit, g: ShapeGroup, pos: V3[], out: V3[], tris: number[], cols: Color3[], glow = false): void {
  const s = k.s;
  (glow ? k.glow : k.g).add(pos.map((p) => v3(p).scaleInPlace(s)), out.map(v3), tris, cols, g, true, []);
}

/** A flat convex polygon, both faces (a leaf, a tab, a flame quad). */
export function poly(k: ShapeKit, g: ShapeGroup, pts: V3[], col: Color3 | Color3[], glow = false): void {
  const n = pts.length;
  const c = pts.reduce((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n, a[2] + p[2] / n] as V3, [0, 0, 0] as V3);
  const nv = Vector3.Cross(v3(pts[1]!).subtract(v3(pts[0]!)), v3(pts[2]!).subtract(v3(pts[0]!))).normalize();
  const N: V3 = [nv.x, nv.y, nv.z], NB: V3 = [-nv.x, -nv.y, -nv.z];
  const off = 0.0015;
  const pos: V3[] = [], out: V3[] = [], tris: number[] = [], cols: Color3[] = [];
  for (const [side, d] of [[N, 1], [NB, -1]] as [V3, number][]) {
    const b = pos.length;
    pts.forEach((p, i) => { pos.push([p[0] + N[0] * off * d, p[1] + N[1] * off * d, p[2] + N[2] * off * d]); out.push(side); cols.push(Array.isArray(col) ? col[i]! : col); });
    for (let i = 1; i < n - 1; i++) tris.push(b, b + i, b + i + 1);
  }
  void c;
  raw(k, g, pos, out, tris, cols, glow);
}

/**
 * A prism from a star-shaped outline in a frame's x,y plane, `depth` thick along z (centred). Fanned from the
 * outline's centre, so cogs and stars work. `col` per outline point (or one), `rim` for the side faces.
 */
export function prism(k: ShapeKit, g: ShapeGroup, f: F, outline: [number, number][], depth: number, col: Color3 | ((i: number) => Color3), o: { rim?: Color3; glow?: boolean; back?: Color3; bulge?: number } = {}): void {
  const n = outline.length;
  const cx = outline.reduce((a, p) => a + p[0], 0) / n, cy = outline.reduce((a, p) => a + p[1], 0) / n;
  const ctr = f(cx, cy, 0);
  const pos: V3[] = [], out: V3[] = [], tris: number[] = [], cols: Color3[] = [];
  const colAt = (i: number) => (typeof col === 'function' ? col(i) : col);
  const zf = depth / 2, bulge = o.bulge ?? 0;
  const dir = (p: V3): V3 => [p[0] - ctr[0], p[1] - ctr[1], p[2] - ctr[2]];
  for (const [sgn, faceCol] of [[1, null], [-1, o.back ?? null]] as [number, Color3 | null][]) {
    const c0 = pos.length;
    const cp = f(cx, cy, sgn * (zf + bulge));
    pos.push(cp); out.push(dir(cp)); cols.push(faceCol ?? colAt(-1));
    outline.forEach(([x, y], i) => { const p = f(x, y, sgn * zf); pos.push(p); out.push(dir(f(x, y, sgn * (zf + 0.3)))); cols.push(faceCol ?? colAt(i)); });
    for (let i = 0; i < n; i++) tris.push(c0, c0 + 1 + i, c0 + 1 + ((i + 1) % n));
  }
  // sides
  for (let i = 0; i < n; i++) {
    const [x0, y0] = outline[i]!, [x1, y1] = outline[(i + 1) % n]!;
    const b = pos.length, rc = o.rim ?? colAt(i);
    for (const [x, y, z] of [[x0, y0, zf], [x1, y1, zf], [x0, y0, -zf], [x1, y1, -zf]] as V3[]) { const p = f(x, y, z); pos.push(p); out.push(dir(f(x * 1.5 - cx * 0.5, y * 1.5 - cy * 0.5, 0))); cols.push(rc); }
    tris.push(b, b + 1, b + 3, b, b + 3, b + 2);
  }
  raw(k, g, pos, out, tris, cols, o.glow);
}

/** A regular polygon outline (n points, radius r, centre cx, cy), optionally a cog (every other point at r2). */
export function ring2d(n: number, r: number, r2 = r, cx = 0, cy = 0, rot = 0): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) { const a = rot + (i / n) * Math.PI * 2, rr = i % 2 ? r2 : r; out.push([cx + Math.sin(a) * rr, cy + Math.cos(a) * rr]); }
  return out;
}

/**
 * A bevelled blade from slices along y: [y, left x, right x] (left < right), a ridge `thick` at the centre line
 * thinning to the edges. Faceted (flat-shaded); the edges take `edge`.
 */
export function blade(k: ShapeKit, g: ShapeGroup, f: F, slices: [number, number, number][], thick: number, col: Color3, o: { edge?: Color3; glow?: boolean; ridge?: number } = {}): void {
  const pos: V3[] = [], out: V3[] = [], tris: number[] = [], cols: Color3[] = [];
  const edge = o.edge ?? shade(col, 1.12);
  const rows = slices.map(([y, l, r]) => {
    const c = l + (r - l) * (o.ridge ?? 0.5), t = Math.min(thick, (r - l) * 0.45);
    return { pts: [f(l, y, 0), f(c, y, t), f(r, y, 0), f(c, y, -t)], ctr: f(c, y, 0) };
  });
  const add = (p: V3, ref: V3, c: Color3) => { pos.push(p); out.push([p[0] - ref[0], p[1] - ref[1], p[2] - ref[2]]); cols.push(c); return pos.length - 1; };
  const colOf = (q: number) => (q === 0 || q === 2 ? edge : col);
  for (let i = 0; i < rows.length - 1; i++) {
    const A = rows[i]!, B = rows[i + 1]!;
    for (let q = 0; q < 4; q++) {
      const q1 = (q + 1) % 4;
      const a0 = add(A.pts[q]!, A.ctr, colOf(q)), a1 = add(A.pts[q1]!, A.ctr, colOf(q1));
      const b0 = add(B.pts[q]!, B.ctr, colOf(q)), b1 = add(B.pts[q1]!, B.ctr, colOf(q1));
      tris.push(a0, b0, b1, a0, b1, a1);
    }
  }
  // end caps: outward along the blade's own axis
  const o0 = f(0, 0, 0), y1 = f(0, 1, 0), ax: V3 = [y1[0] - o0[0], y1[1] - o0[1], y1[2] - o0[2]];
  for (const [R, sgn] of [[rows[0]!, -1], [rows[rows.length - 1]!, 1]] as const) {
    const b = pos.length;
    for (const p of R.pts) { pos.push(p); out.push([ax[0] * sgn, ax[1] * sgn, ax[2] * sgn]); cols.push(edge); }
    tris.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  raw(k, g, pos, out, tris, cols, o.glow);
}

/** A cone from a base centre to a tip, `sides` faces (3: a thorn). */
export function cone(k: ShapeKit, g: ShapeGroup, base: V3, tip: V3, r: number, col: Color3, sides = 3, glow = false, tipCol?: Color3): void {
  const b = v3(base), t = v3(tip), ax = t.subtract(b).normalize();
  const u = Math.abs(ax.y) < 0.9 ? Vector3.Cross(ax, Vector3.Up()).normalize() : Vector3.Cross(ax, Vector3.Right()).normalize();
  const w = Vector3.Cross(ax, u).normalize();
  const ring: V3[] = [];
  for (let i = 0; i < sides; i++) { const a = (i / sides) * Math.PI * 2; const p = b.add(u.scale(Math.cos(a) * r)).add(w.scale(Math.sin(a) * r)); ring.push([p.x, p.y, p.z]); }
  const pos: V3[] = [], out: V3[] = [], tris: number[] = [], cols: Color3[] = [];
  const mid = b.add(t).scale(0.5);
  const o = (p: V3): V3 => [p[0] - mid.x, p[1] - mid.y, p[2] - mid.z];
  for (let i = 0; i < sides; i++) {
    const p0 = ring[i]!, p1 = ring[(i + 1) % sides]!, k0 = pos.length;
    pos.push(p0, p1, [t.x, t.y, t.z]); out.push(o(p0), o(p1), o([t.x, t.y, t.z])); cols.push(col, col, tipCol ?? col);
    tris.push(k0, k0 + 1, k0 + 2);
  }
  const k0 = pos.length;
  ring.forEach((p) => { pos.push(p); out.push([-ax.x, -ax.y, -ax.z]); cols.push(col); });
  for (let i = 1; i < sides - 1; i++) tris.push(k0, k0 + i, k0 + i + 1);
  raw(k, g, pos, out, tris, cols, glow);
}

/** Lower detail drops the smallest ornaments (studs, rivets, charms) first. */
export const fine = (k: ShapeKit) => k.detail >= 0.5;

/**
 * A surface of revolution in a frame: `profile` is [t, r] along the frame axis `axis` through `c` (model space),
 * `seg` sides, flat-shaded. `col` may vary by profile row. Caps close the ends when their radius is not zero.
 */
export function revolve(k: ShapeKit, g: ShapeGroup, f: F, c: V3, axis: 'x' | 'y' | 'z', profile: [number, number][], seg: number, col: Color3 | ((row: number) => Color3), glow = false): void {
  const n = Math.max(3, seg);
  const at = (t: number, a: number, r: number): V3 => {
    const u = Math.cos(a) * r, v = Math.sin(a) * r;
    return axis === 'y' ? f(c[0] + u, c[1] + t, c[2] + v) : axis === 'x' ? f(c[0] + t, c[1] + u, c[2] + v) : f(c[0] + u, c[1] + v, c[2] + t);
  };
  const pos: V3[] = [], out: V3[] = [], tris: number[] = [], cols: Color3[] = [];
  const colAt = (i: number) => (typeof col === 'function' ? col(i) : col);
  const rows: number[][] = [];
  profile.forEach(([t, r], i) => {
    const ctr = at(t, 0, 0), row: number[] = [];
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2;
      const p = at(t, a, Math.max(r, 1e-4)), q = at(t, a, Math.max(r, 1e-4) + 1);
      row.push(pos.length); pos.push(p); out.push([q[0] - ctr[0], q[1] - ctr[1], q[2] - ctr[2]]); cols.push(colAt(i));
    }
    rows.push(row);
  });
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < n; j++) {
    const a = rows[i]![j]!, b = rows[i]![(j + 1) % n]!, cc = rows[i + 1]![j]!, d = rows[i + 1]![(j + 1) % n]!;
    tris.push(a, cc, d, a, d, b);
  }
  for (const [ri, sgn] of [[0, -1], [profile.length - 1, 1]] as const) {
    if (profile[ri]![1] < 1e-3) continue;
    const ctr = at(profile[ri]![0], 0, 0), ax = at(profile[ri]![0] + sgn, 0, 0), dir: V3 = [ax[0] - ctr[0], ax[1] - ctr[1], ax[2] - ctr[2]];
    const b = pos.length;
    pos.push(ctr); out.push(dir); cols.push(colAt(ri));
    for (const v of rows[ri]!) { pos.push(pos[v]!); out.push(dir); cols.push(colAt(ri)); }
    for (let j = 0; j < n; j++) tris.push(b, b + 1 + j, b + 1 + ((j + 1) % n));
  }
  raw(k, g, pos, out, tris, cols, glow);
}

/** A small rounded knob (a pommel, a rivet, a berry): a revolve of a few rows. */
export function knob(k: ShapeKit, g: ShapeGroup, f: F, c: V3, r: number, col: Color3, glow = false, seg = 6): void {
  revolve(k, g, f, c, 'y', [[-r, 0], [-r * 0.5, r * 0.87], [r * 0.5, r * 0.87], [r, 0]], fine(k) ? Math.min(seg, 6) : 4, col, glow);
}

/** Segment counts for the kit's level of detail (never under `min`). */
export const segs = (k: ShapeKit, n: number, min = 4) => Math.max(min, Math.round(n * k.detail));

/** A tube through model-space points of a frame (round, `seg` sides). */
export function rod(k: ShapeKit, g: ShapeGroup, f: F, pts: V3[], r: number | number[], col: Color3, seg = 5, glow = false): void {
  k.tube(g, pts.map((p) => f(p[0], p[1], p[2])), r, col, { seg, noOcc: true, glow });
}
