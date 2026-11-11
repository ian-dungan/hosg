// Tiny procedural low-poly mesh builder: flat-shaded triangles with per-vertex colour,
// a transform stack, and a few primitives. Ported in spirit from concepts/02-skybound/art.html.
import { Mesh, VertexData, type Scene, type Material } from '@babylonjs/core';

export type V3 = [number, number, number];
export type RGB = [number, number, number];

export const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
export const tint = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---------- rng / noise ----------
export class Rng {
  constructor(public s: number) {}
  next() { this.s = (this.s * 16807) % 2147483647; return (this.s - 1) / 2147483646; }
  r(a: number, b: number) { return a + (b - a) * this.next(); }
}
export function hash(x: number, y: number) { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }
export function vnoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

// ---------- 4x4 column-major ----------
type M4 = number[];
const mI = (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mMul(a: M4, b: M4): M4 { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
const mT = (x: number, y: number, z: number): M4 => { const m = mI(); m[12] = x; m[13] = y; m[14] = z; return m; };
const mS = (x: number, y: number, z: number): M4 => { const m = mI(); m[0] = x; m[5] = y; m[10] = z; return m; };
// yaw: local +Z maps to (sin a, 0, cos a)  (matches contracts "facing")
const mRY = (a: number): M4 => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };
const mRX = (a: number): M4 => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; };
const mRZ = (a: number): M4 => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };

const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  const v: V3[] = ([[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]] as V3[]).map(norm);
  const f: V3[] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const subd = (vv: V3[], ff: V3[]) => {
    const cache: Record<string, number> = {};
    const mid = (a: number, b: number) => { const k = a < b ? a + '_' + b : b + '_' + a; if (cache[k] !== undefined) return cache[k]; vv.push(norm(lerp3(vv[a], vv[b], 0.5))); return (cache[k] = vv.length - 1); };
    const nf: V3[] = [];
    for (const [a, b, c] of ff) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    return nf;
  };
  const v1 = v.slice(); const f1 = subd(v1, f);
  return [{ v: v.slice(), f }, { v: v1, f: f1 }];
})();

/** Hint used to orient a triangle's normal: a local-space point it should face away from,
 *  'up' (normal y >= 0), or null (double-sided: both faces emitted). */
type Hint = V3 | 'up' | null;

export class Builder {
  pos: number[] = []; nor: number[] = []; col: number[] = [];
  M: M4 = mI(); private stk: M4[] = [];
  cj = 0.035;
  hint: Hint = null;
  rng: Rng;
  constructor(seed = 7) { this.rng = new Rng(seed); }

  get tris() { return this.pos.length / 9; }
  push() { this.stk.push(this.M); }
  pop() { this.M = this.stk.pop()!; }
  T(x: number, y: number, z: number) { this.M = mMul(this.M, mT(x, y, z)); }
  RY(a: number) { this.M = mMul(this.M, mRY(a)); }
  RX(a: number) { this.M = mMul(this.M, mRX(a)); }
  RZ(a: number) { this.M = mMul(this.M, mRZ(a)); }
  SC(x: number, y = x, z = x) { this.M = mMul(this.M, mS(x, y, z)); }
  tp(p: V3): V3 { const M = this.M; return [M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14]]; }

  private emit(a: V3, b: V3, c: V3, n: V3, ca: RGB, cb: RGB, cc: RGB, j: number) {
    const P = this.pos, N = this.nor, C = this.col;
    P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) N.push(n[0], n[1], n[2]);
    for (const k of [ca, cb, cc]) C.push(Math.min(1, k[0] * j), Math.min(1, k[1] * j), Math.min(1, k[2] * j), 1);
  }
  /** World-space triangle. */
  triW(a: V3, b: V3, c: V3, ca: RGB, cb?: RGB, cc?: RGB, hintW?: Hint) {
    let n = cross(sub(b, a), sub(c, a));
    const l = len(n); if (!(l > 1e-9)) return;
    n = [n[0] / l, n[1] / l, n[2] / l];
    const j = 1 + this.rng.r(-this.cj, this.cj);
    const cB = cb || ca, cC = cc || ca;
    const h = hintW === undefined ? null : hintW;
    if (h === null) {
      this.emit(a, b, c, n, ca, cB, cC, j);
      this.emit(a, c, b, [-n[0], -n[1], -n[2]], ca, cC, cB, j);
      return;
    }
    let flip: boolean;
    if (h === 'up') flip = n[1] < 0;
    else { const cen: V3 = [(a[0] + b[0] + c[0]) / 3 - h[0], (a[1] + b[1] + c[1]) / 3 - h[1], (a[2] + b[2] + c[2]) / 3 - h[2]]; flip = dot(n, cen) < 0; }
    if (flip) this.emit(a, c, b, [-n[0], -n[1], -n[2]], ca, cC, cB, j);
    else this.emit(a, b, c, n, ca, cB, cC, j);
  }
  tri(a: V3, b: V3, c: V3, ca: RGB, cb?: RGB, cc?: RGB) {
    const h = this.hint;
    this.triW(this.tp(a), this.tp(b), this.tp(c), ca, cb, cc, h === null || h === 'up' ? h : this.tp(h));
  }
  quad(a: V3, b: V3, c: V3, d: V3, col: RGB, col2?: RGB) { this.tri(a, b, c, col, col, col2 || col); this.tri(a, c, d, col, col2 || col, col2 || col); }
  withHint<T>(h: Hint, f: () => T): T { const o = this.hint; this.hint = h; const r = f(); this.hint = o; return r; }

  prism(a: V3, b: V3, ra: number, rb: number, sides: number, col: RGB, opt: { rot?: number; caps?: boolean; col2?: RGB; capA?: RGB; capB?: RGB } = {}) {
    const d = norm(sub(b, a)); const up: V3 = Math.abs(d[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(d, up)), v = cross(u, d);
    const rot = opt.rot || 0, A: V3[] = [], B: V3[] = [];
    for (let i = 0; i < sides; i++) {
      const t = rot + i / sides * Math.PI * 2, o = add(mul(u, Math.cos(t)), mul(v, Math.sin(t)));
      A.push(add(a, mul(o, ra))); B.push(add(b, mul(o, rb)));
    }
    this.withHint(lerp3(a, b, 0.5), () => {
      for (let i = 0; i < sides; i++) { const k = (i + 1) % sides; this.quad(A[i], A[k], B[k], B[i], col, opt.col2); }
      if (opt.caps !== false) for (let i = 1; i < sides - 1; i++) { this.tri(A[0], A[i + 1], A[i], opt.capA || col); if (rb > 0.0001) this.tri(B[0], B[i], B[i + 1], opt.capB || opt.col2 || col); }
    });
  }
  taperBox(b: V3, bw: number, bd: number, t: V3, tw: number, td: number, col: RGB, topCol?: RGB) {
    const p: V3[] = [[b[0] - bw / 2, b[1], b[2] - bd / 2], [b[0] + bw / 2, b[1], b[2] - bd / 2], [b[0] + bw / 2, b[1], b[2] + bd / 2], [b[0] - bw / 2, b[1], b[2] + bd / 2],
    [t[0] - tw / 2, t[1], t[2] - td / 2], [t[0] + tw / 2, t[1], t[2] - td / 2], [t[0] + tw / 2, t[1], t[2] + td / 2], [t[0] - tw / 2, t[1], t[2] + td / 2]];
    this.withHint(lerp3(b, t, 0.5), () => {
      this.quad(p[0], p[1], p[2], p[3], col); this.quad(p[4], p[7], p[6], p[5], topCol || col);
      this.quad(p[0], p[4], p[5], p[1], col); this.quad(p[1], p[5], p[6], p[2], col); this.quad(p[2], p[6], p[7], p[3], col); this.quad(p[3], p[7], p[4], p[0], col);
    });
  }
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, col: RGB, topCol?: RGB) { this.taperBox([cx, cy - sy / 2, cz], sx, sz, [cx, cy + sy / 2, cz], sx, sz, col, topCol); }
  ball(c: V3, r: number, col: RGB, sx = 1, sy = 1, sz = 1, detail = 1, jit = 0, col2: RGB | null = null) {
    const G = ICO[detail]; const s = this.rng.next() * 100;
    const pts = G.v.map((p, i): V3 => { const k = 1 + (hash(i * 1.7 + s, s * 0.3) - 0.5) * jit; return [c[0] + p[0] * r * sx * k, c[1] + p[1] * r * sy * k, c[2] + p[2] * r * sz * k]; });
    this.withHint(c, () => {
      for (const [a, b, d] of G.f) {
        if (col2) { const cy = (pts[a][1] + pts[b][1] + pts[d][1]) / 3; const t = Math.max(0, Math.min(1, (cy - (c[1] - r * sy)) / (2 * r * sy))); this.tri(pts[a], pts[b], pts[d], mix(col2, col, t)); }
        else this.tri(pts[a], pts[b], pts[d], col);
      }
    });
  }
  /** Double-sided parametric sheet. */
  sheet(fn: (u: number, v: number) => V3, nu: number, nv: number, colFn: (i: number, j: number) => RGB) {
    this.withHint(null, () => {
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const a = fn(i / nu, j / nv), b = fn((i + 1) / nu, j / nv), c = fn((i + 1) / nu, (j + 1) / nv), d = fn(i / nu, (j + 1) / nv);
        const col = colFn(i, j); this.tri(a, b, c, col); this.tri(a, c, d, col);
      }
    });
  }
  limb(a: V3, b: V3, ra: number, rb: number, col: RGB, sides = 6) { this.prism(a, b, ra, rb, sides, col); this.ball(a, ra * 1.02, col, 1, 1, 1, 0); }
  chain(pts: V3[], rads: number[], col: RGB, sides = 6) {
    for (let i = 0; i < pts.length - 1; i++) { this.prism(pts[i], pts[i + 1], rads[i], rads[i + 1], sides, col, { caps: false }); if (i > 0) this.ball(pts[i], rads[i], col, 1, 1, 1, 0); }
    this.ball(pts[pts.length - 1], rads[rads.length - 1] * 1.05, col, 1, 1, 1, 0);
  }

  build(scene: Scene, name: string, mat: Material): Mesh {
    const m = new Mesh(name, scene);
    const vd = new VertexData();
    const n = this.pos.length / 3;
    const idx = new Uint32Array(n);
    // Babylon's default front face is the reverse of our (a,b,c) cross-product order.
    for (let i = 0; i < n; i += 3) { idx[i] = i; idx[i + 1] = i + 2; idx[i + 2] = i + 1; }
    vd.positions = new Float32Array(this.pos); vd.normals = new Float32Array(this.nor); vd.colors = new Float32Array(this.col); vd.indices = idx;
    vd.applyToMesh(m, false);
    m.material = mat;
    m.isPickable = false;
    m.hasVertexAlpha = false;
    return m;
  }
}
