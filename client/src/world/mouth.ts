// The crater mouth in the Greenway: where the road ends, the ground has fallen in over the Lampfall. A crater
// 14 m across of scorched, broken earth with upturned slabs at its lip, brass debris from the Beacon (gears, a bent
// rail, lens fragments that glint), and in the middle a shaft with a stone stair going down into the dark, a faint
// warm glow far below. The exit circle (LAMPFALL_MOUTH, r 2.5) sits on the stair's top step: anyone who walks
// over the opening is already travelling.
//
// The walk is not changed (the shared ZoneWalk keeps the ground flat here), so the opening is cut out of the drawn
// terrain only: a stencil mask drawn before everything else in its rendering group marks the opening, and the
// terrain and road materials skip those pixels; the shaft, drawn below ground, shows through. Four draw calls
// (the mask, the lit crater, its glow, the scorch decal), under 4k triangles.
import { Constants, Mesh, StandardMaterial, Color3, type Material, type Scene, type SubMesh } from '@babylonjs/core';
import { LAMPFALL_MOUTH, type ZoneLayout } from '@sg2/shared';
import { PALETTE } from '../core/contracts';
import { Builder, hex, mix, tint, type RGB, type V3 } from './mesh';
import { PAL } from './parts';

/** The opening (an ellipse along the road) and the crater round it, in m. */
export const MOUTH_PIT = { along: 3.2, across: 2.2, depth: 9 };
export const MOUTH_CRATER_R = 7;
/** Budget (the brief): the mouth adds at most this to the Greenway. */
export const MOUTH_BUDGET = { tris: 4000, draws: 4 };
const STENCIL_REF = 1;

const C = {
  earth: hex('#8a5a3c'), earthDark: hex('#4e3326'), scorch: hex('#2a1d18'), rock: hex(PALETTE.rock), slate: hex('#8d8498'), stone: hex(PALETTE.stone),
  brass: hex('#d49a3a'), brassDark: hex('#8f6328'), lamp: PAL.lamp, crystal: hex('#9ff2ea'), cream: hex('#f6ead6'), ember: hex('#ff8a3c'), deep: hex('#140f1e'),
};

export interface MouthPlan {
  x: number; z: number; y: number;
  /** The road's direction at the mouth (yaw, x = sin, z = cos): the stair goes down this way. */
  yaw: number;
  /** Unit vectors along the road and across it. */
  ux: number; uz: number; vx: number; vz: number;
}

export function mouthPlan(layout: ZoneLayout): MouthPlan {
  const { x, z } = layout.mouth;
  const dz = layout.roadZ(x + 0.5) - layout.roadZ(x - 0.5);
  const l = Math.hypot(1, dz), ux = 1 / l, uz = dz / l;
  return { x, z, y: layout.height(x, z), yaw: Math.atan2(ux, uz), ux, uz, vx: uz, vz: -ux };
}

/** Builds the crater: lit (slabs, stair, shaft), glow (lens fragments, the glow below), scorch (alpha) and the mask. */
export function mouthGeometry(layout: ZoneLayout): { lit: Builder; glow: Builder; scorch: Builder; mask: Builder; plan: MouthPlan } {
  const p = mouthPlan(layout), H = layout.height;
  const lit = new Builder(1501), glow = new Builder(1502), scorch = new Builder(1503), mask = new Builder(1504);
  glow.cj = 0; scorch.cj = 0; mask.cj = 0;
  const W = (u: number, v: number): [number, number] => [p.x + p.ux * u + p.vx * v, p.z + p.uz * u + p.vz * v];
  const G = (u: number, v: number, dy = 0): V3 => { const [x, z] = W(u, v); return [x, H(x, z) + dy, z]; };
  const A = MOUTH_PIT.along, B = MOUTH_PIT.across, D = MOUTH_PIT.depth;
  const N = 28;
  const rim = (k: number, s = 1): [number, number] => { const t = (k / N) * Math.PI * 2; return [Math.cos(t) * A * s, Math.sin(t) * B * s]; };
  const hash = (a: number, b: number) => { const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return h - Math.floor(h); };

  // the mask: the opening, a hair above the ground
  for (let k = 0; k < N; k++) { const [u0, v0] = rim(k), [u1, v1] = rim(k + 1); mask.triW(G(0, 0, 0.05), G(u0, v0, 0.05), G(u1, v1, 0.05), C.deep, C.deep, C.deep, 'up'); }

  // the shaft: rough walls going down into the dark, a faint warm glow from far below
  const bands = [0, -0.6, -2.4, -5, -D];
  const bandC: RGB[] = [C.earth, C.earthDark, tint(C.rock, 0.55), tint(mix(C.rock, C.ember, 0.18), 0.32), tint(mix(C.deep, C.ember, 0.35), 0.8)];
  for (let k = 0; k < N; k++) {
    const [u0, v0] = rim(k), [u1, v1] = rim(k + 1);
    const y0 = H(...W(u0, v0)), y1 = H(...W(u1, v1));
    const out: V3 = G(((u0 + u1) / 2) * 3, ((v0 + v1) / 2) * 3, -2);
    for (let j = 0; j < bands.length - 1; j++) {
      const j0 = 1 + 0.06 * (hash(k, j) - 0.5) * (j ? 1 : 0), j1 = 1 + 0.06 * (hash(k + 1, j) - 0.5) * (j ? 1 : 0);
      const [a0x, a0z] = W(u0 * j0, v0 * j0), [a1x, a1z] = W(u1 * j1, v1 * j1);
      const ja = 1 + 0.06 * (hash(k, j + 1) - 0.5), jb = 1 + 0.06 * (hash(k + 1, j + 1) - 0.5);
      const [b0x, b0z] = W(u0 * ja, v0 * ja), [b1x, b1z] = W(u1 * jb, v1 * jb);
      const t0: V3 = [a0x, y0 + bands[j], a0z], t1: V3 = [a1x, y1 + bands[j], a1z], d0: V3 = [b0x, y0 + bands[j + 1], b0z], d1: V3 = [b1x, y1 + bands[j + 1], b1z];
      lit.triW(t0, t1, d1, bandC[j], bandC[j], bandC[j + 1], out); lit.triW(t0, d1, d0, bandC[j], bandC[j + 1], bandC[j + 1], out);
    }
  }
  for (let k = 0; k < N; k++) { const [u0, v0] = rim(k), [u1, v1] = rim(k + 1); glow.triW(G(0, 0, -D + 0.02), G(u0, v0, -D + 0.02), G(u1, v1, -D + 0.02), mix(C.ember, C.lamp, 0.4), tint(C.ember, 0.25), tint(C.ember, 0.25), 'up'); }

  // the stair: a stone landing at the opening's west end, its top step flush with the ground, and down it goes
  const sw = 0.85, top = p.y;
  const stepC = tint(C.stone, 0.78), lipC = tint(mix(C.stone, C.cream, 0.4), 0.92), riser = tint(C.stone, 0.42);
  const S = (u: number, v: number, y: number): V3 => { const [x, z] = W(u, v); return [x, y, z]; };
  lit.triW(S(-A - 0.2, -sw, top - 0.02), S(-2.7, -sw, top - 0.02), S(-2.7, sw, top - 0.02), lipC, lipC, lipC, 'up');
  lit.triW(S(-A - 0.2, -sw, top - 0.02), S(-2.7, sw, top - 0.02), S(-A - 0.2, sw, top - 0.02), lipC, lipC, lipC, 'up');
  for (let k = 0; k < 13; k++) {
    const u0 = -2.7 + k * 0.45, u1 = u0 + 0.45, y = top - 0.02 - k * 0.34, depthK = Math.min(1, k / 12);
    const sc = tint(stepC, 1 - 0.5 * depthK), lc = tint(lipC, 1 - 0.45 * depthK), rc = tint(riser, 1 - 0.6 * depthK);
    lit.triW(S(u0, -sw, y), S(u1, -sw, y), S(u1, sw, y), lc, sc, sc, 'up'); lit.triW(S(u0, -sw, y), S(u1, sw, y), S(u0, sw, y), lc, sc, lc, 'up');
    const hint = S(u1 + 2, 0, y - 0.17);
    lit.triW(S(u1, -sw, y), S(u1, sw, y), S(u1, sw, y - 0.34), rc, rc, rc, S(u1 - 2, 0, y - 0.17)); lit.triW(S(u1, -sw, y), S(u1, sw, y - 0.34), S(u1, -sw, y - 0.34), rc, rc, rc, S(u1 - 2, 0, y - 0.17));
    void hint;
    // the stair's side: a block under each step (so it reads as built, not floating)
    for (const sg of [1, -1]) lit.triW(S(u0, sg * sw, y), S(u1, sg * sw, y), S(u1, sg * sw, y - 1.2), rc, rc, tint(rc, 0.5), S((u0 + u1) / 2, sg * 4, y));
  }

  // the lip: upturned slabs of earth and stone, leaving the stair's end clear
  for (let k = 0; k < 22; k++) {
    const t = (k / 22) * Math.PI * 2 + 0.07 * hash(k, 1), cu = Math.cos(t), cv = Math.sin(t);
    if (cu < -0.82) continue; // the stair's landing
    const r = 1.04 + 0.12 * hash(k, 2), u = cu * A * r, v = cv * B * r;
    const [x, z] = W(u, v), y = H(x, z);
    const outU = cu / A, outV = cv / B, ol = Math.hypot(outU, outV), ou = outU / ol, ov = outV / ol;
    const [ox, oz] = [p.ux * ou + p.vx * ov, p.uz * ou + p.vz * ov];
    const w = 0.55 + 0.4 * hash(k, 3), h = 0.25 + 0.35 * hash(k, 4), tilt = 0.5 + 0.3 * hash(k, 5);
    const tx = -oz, tz = ox;
    const base0: V3 = [x - tx * w, y - 0.1, z - tz * w], base1: V3 = [x + tx * w, y - 0.1, z + tz * w];
    const top0: V3 = [x - tx * w * 0.8 + ox * tilt * h, y + h, z - tz * w * 0.8 + oz * tilt * h], top1: V3 = [x + tx * w * 0.8 + ox * tilt * h, y + h * 0.8, z + tz * w * 0.8 + oz * tilt * h];
    const back0: V3 = [base0[0] + ox * 0.5, y - 0.05, base0[2] + oz * 0.5], back1: V3 = [base1[0] + ox * 0.5, y - 0.05, base1[2] + oz * 0.5];
    const face = hash(k, 6) < 0.4 ? tint(C.slate, 0.8) : tint(C.earth, 0.85), dark = tint(face, 0.6);
    lit.triW(base0, base1, top1, face, face, tint(face, 1.1), [x - ox * 3, y, z - oz * 3]); lit.triW(base0, top1, top0, face, tint(face, 1.1), tint(face, 1.1), [x - ox * 3, y, z - oz * 3]);
    lit.triW(top0, top1, back1, dark, dark, dark, 'up'); lit.triW(top0, back1, back0, dark, dark, dark, 'up');
  }

  // scorched, broken earth round it (alpha: fades out at the crater's edge), and cracks running out
  const RN = 36;
  for (let k = 0; k < RN; k++) {
    const t0 = (k / RN) * Math.PI * 2, t1 = ((k + 1) / RN) * Math.PI * 2;
    const ring = [1.0, 1.55, 2.2, MOUTH_CRATER_R / A + 0.1] as const;
    for (let j = 0; j < ring.length - 1; j++) {
      const ra = ring[j], rb = ring[j + 1];
      // the ellipse widens toward a circle further out
      const P2 = (t: number, rr: number): V3 => { const f = Math.min(1, (rr - 1) / 1.2); const su = A * rr, sv = (B + (A - B) * f) * rr; return G(Math.cos(t) * su, Math.sin(t) * sv, 0.05); };
      const ca: RGB = C.scorch, cb: RGB = tint(C.earthDark, 0.8);
      scorch.triW(P2(t0, ra), P2(t1, ra), P2(t1, rb), ca, ca, cb, 'up');
      scorch.triW(P2(t0, ra), P2(t1, rb), P2(t0, rb), ca, cb, cb, 'up');
    }
  }
  // per-vertex alpha (the colour array's 4th channel): strong at the lip, none at the crater's edge
  for (let i = 0; i < scorch.pos.length / 3; i++) {
    const dx = scorch.pos[i * 3] - p.x, dz = scorch.pos[i * 3 + 2] - p.z, d = Math.hypot(dx, dz);
    const f = Math.max(0, Math.min(1, (d - Math.min(A, B)) / (MOUTH_CRATER_R - Math.min(A, B))));
    scorch.col[i * 4 + 3] = Math.max(0, 0.95 * (1 - f * f) * (0.75 + 0.25 * hash(Math.round(dx * 4), Math.round(dz * 4))));
  }
  for (let k = 0; k < 9; k++) {
    const t = hash(k, 9) * Math.PI * 2, r0 = 1.05, r1 = 1.6 + 0.6 * hash(k, 10);
    const a0 = G(Math.cos(t) * A * r0, Math.sin(t) * B * r0, 0.07), a1 = G(Math.cos(t + 0.08) * A * r1, Math.sin(t + 0.08) * B * r1 * 1.3, 0.07);
    const [nx, nz] = [-(a1[2] - a0[2]), a1[0] - a0[0]], nl = Math.hypot(nx, nz) || 1, w = 0.07;
    lit.triW([a0[0] + nx / nl * w, a0[1], a0[2] + nz / nl * w], [a1[0], a1[1], a1[2]], [a0[0] - nx / nl * w, a0[1], a0[2] - nz / nl * w], C.deep, C.deep, C.deep, 'up');
  }

  // brass debris from the Beacon, and scorched tufts
  for (let k = 0; k < 9; k++) {
    const t = hash(k, 20) * Math.PI * 2, r = 1.25 + 0.75 * hash(k, 21);
    const [x, z] = W(Math.cos(t) * A * r, Math.sin(t) * B * r * 1.4), y = H(x, z);
    lit.push(); lit.T(x, y, z); lit.RY(hash(k, 22) * 6.28);
    if (k % 3 === 0) {
      lit.RX(0.15); lit.prism([0, 0, 0], [0, 0.1, 0], 0.42, 0.42, 9, C.brassDark, { capB: C.brass });
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; lit.box(Math.sin(a) * 0.48, 0.05, Math.cos(a) * 0.48, 0.11, 0.09, 0.11, C.brass); }
    } else if (k % 3 === 1) {
      lit.prism([-0.7, 0.05, 0], [0.05, 0.2, 0.25], 0.045, 0.045, 4, C.brass); lit.prism([0.05, 0.2, 0.25], [0.7, 0.06, 0.1], 0.045, 0.045, 4, C.brass);
    } else {
      glow.push(); glow.M = lit.M;
      glow.tri([-0.15, 0.03, 0], [0.04, 0.32, 0.06], [0.2, 0.03, -0.08], C.crystal, C.cream, C.crystal);
      glow.tri([0.1, 0.03, 0.2], [0.22, 0.2, 0.28], [0.34, 0.03, 0.12], C.crystal, C.cream, C.crystal);
      glow.pop();
    }
    lit.pop();
  }
  for (let k = 0; k < 26; k++) {
    const t = hash(k, 30) * Math.PI * 2, r = 1.2 + 1.0 * hash(k, 31);
    const [x, z] = W(Math.cos(t) * A * r, Math.sin(t) * B * r * 1.5), y = H(x, z), h = 0.25 + 0.25 * hash(k, 32);
    const tuft = mix(C.scorch, C.earthDark, hash(k, 33));
    for (let i = 0; i < 3; i++) { const a = i * 2.1 + t; lit.triW([x - Math.cos(a) * 0.12, y, z - Math.sin(a) * 0.12], [x + Math.cos(a) * 0.12, y, z + Math.sin(a) * 0.12], [x + Math.cos(a + 1) * 0.06, y + h, z + Math.sin(a + 1) * 0.06], tuft, tuft, tint(tuft, 1.4), null); }
  }
  return { lit, glow, scorch, mask, plan: p };
}

/** The mouth's meshes in the Greenway, the opening cut out of `cut` (the terrain and road materials). */
export function buildMouth(scene: Scene, layout: ZoneLayout, o: { cut: StandardMaterial[]; lit: Material; glow: Material }): { meshes: Mesh[]; tris: number } {
  const g = mouthGeometry(layout);
  // the mask: no colour, no depth, stencil := 1, drawn before every other opaque mesh
  const maskMat = new StandardMaterial('gw_mouth_mask', scene);
  maskMat.disableColorWrite = true; maskMat.disableDepthWrite = true; maskMat.backFaceCulling = false;
  maskMat.stencil.enabled = true; maskMat.stencil.func = Constants.ALWAYS; maskMat.stencil.funcRef = STENCIL_REF; maskMat.stencil.opStencilDepthPass = Constants.REPLACE; maskMat.stencil.mask = 0xff;
  for (const m of o.cut) { m.stencil.enabled = true; m.stencil.func = Constants.NOTEQUAL; m.stencil.funcRef = STENCIL_REF; m.stencil.funcMask = 0xff; m.stencil.mask = 0x00; }
  const scorchMat = new StandardMaterial('gw_mouth_scorch', scene);
  scorchMat.diffuseColor = new Color3(1, 1, 1); scorchMat.specularColor = new Color3(0, 0, 0); scorchMat.disableDepthWrite = true; scorchMat.zOffset = -3;
  const mask = g.mask.build(scene, 'gw_mouth_mask', maskMat);
  mask.metadata = { drawFirst: true };
  const lit = g.lit.build(scene, 'gw_mouth', o.lit as StandardMaterial);
  const glow = g.glow.build(scene, 'gw_mouth_glow', o.glow as StandardMaterial);
  const scorch = g.scorch.build(scene, 'gw_mouth_scorch', scorchMat);
  scorch.hasVertexAlpha = true; scorch.alphaIndex = 5;
  scorchMat.alpha = 0.999; scorchMat.useLogarithmicDepth = false;
  // the opaque queue: the mask first, then Babylon's own order (by material)
  const first = (s: SubMesh) => ((s.getMesh().metadata as { drawFirst?: boolean } | null)?.drawFirst ? 0 : 1);
  scene.setRenderingOrder(0, (a, b) => first(a) - first(b) || (a.getMesh().material && b.getMesh().material ? a.getMesh().material!.uniqueId - b.getMesh().material!.uniqueId : a.getMesh().uniqueId - b.getMesh().uniqueId));
  const meshes = [mask, lit, glow, scorch];
  for (const m of meshes) { m.isPickable = false; }
  return { meshes, tris: g.lit.tris + g.glow.tris + g.scorch.tris + g.mask.tris };
}

/** The exit circle the stair's top step carries (for the dev viewer and tests). */
export const mouthExit = () => ({ x: LAMPFALL_MOUTH.x, z: LAMPFALL_MOUTH.z, r: LAMPFALL_MOUTH.r });
