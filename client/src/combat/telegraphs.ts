// Ground telegraphs: one decal per telegraph in the room state, in the shared shape (circle, cone or line from
// @sg2/shared shapes), laid on the ground it covers (slopes, rock tops) and drawn over it on every quality tier.
// A translucent warm-red base, an inner fill that grows from the origin over (total − TELEGRAPH_LEAD_S) from when
// the decal was first seen (so it is full a little before the hit: what the player sees errs in their favour),
// a bright rim of constant width, and a flashing rim in the last 0.3 s.
import { Effect, Mesh, ShaderMaterial, VertexData, type Scene } from '@babylonjs/core';
import { inShape, type Shape } from '@sg2/shared';
import type { WorldApi } from '../core/contracts';
import type { TelegraphStateView, ZoneRoom } from '../net/session';
import { telegraphFill } from './controller';

/** Height of the decal above the ground, in m (with a depth offset it never sinks into the terrain's facets). */
const LIFT = 0.07;
/** Grid spacing of the decal mesh, in m (fine enough to follow slopes). */
const STEP = 0.35;
/** Width of the rim, in m. */
const RIM_M = 0.3;
/** The rim flashes for this long before the hit, in s. */
const LATE_S = 0.3;

Effect.ShadersStore.sgTelegraphVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;
void main() { vUV = uv; gl_Position = worldViewProjection * vec4(position, 1.0); }`;
Effect.ShadersStore.sgTelegraphFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform float fill;
uniform float late;
uniform float danger;
uniform float time;
void main() {
  float u = vUV.x;   // 0 at the origin .. 1 at the far edge (the fill grows along it)
  float e = vUV.y;   // 0 inside .. 1 on the outer edge (constant width in metres)
  vec3 warm = vec3(0.93, 0.29, 0.17);
  vec3 c = warm;
  float a = 0.24;
  float inFill = step(u, fill);
  c = mix(c, vec3(1.0, 0.42, 0.2), inFill);
  a = mix(a, 0.46, inFill);
  float front = (1.0 - smoothstep(0.0, 0.035, abs(u - fill))) * (1.0 - step(0.999, fill));
  c = mix(c, vec3(1.0, 0.86, 0.55), front);
  a = max(a, front * 0.9);
  float rim = smoothstep(0.25, 0.85, e);
  float pulse = 0.5 + 0.5 * sin(time * 26.0);
  vec3 rimC = mix(vec3(1.0, 0.36, 0.22), vec3(1.0, 0.95, 0.8), late * pulse);
  c = mix(c, rimC, rim);
  a = max(a, rim * mix(0.8, 1.0, late));
  a = min(1.0, a * (1.0 + 0.3 * danger * (0.5 + 0.5 * sin(time * 14.0))));
  gl_FragColor = vec4(c, a);
}`;

/** The shared Shape for a telegraph in the state. */
export function telegraphShape(t: TelegraphStateView): Shape {
  if (t.shape === 'cone') return { kind: 'cone', x: t.x, z: t.z, dir: t.dir, r: t.r, angle: t.angle };
  if (t.shape === 'line') return { kind: 'line', x: t.x, z: t.z, dir: t.dir, length: t.r, width: t.width };
  return { kind: 'circle', x: t.x, z: t.z, r: t.r };
}

/**
 * The decal's vertices in the ground plane (x, z) with uv (u: progress from the origin 0..1, v: 0 inside .. 1 on the
 * edge) and triangles. Pure: the heights come later.
 */
export function decalGrid(s: Shape): { xz: number[]; uv: number[]; idx: number[] } {
  const xz: number[] = [], uv: number[] = [], idx: number[] = [];
  const edge = (dEdge: number) => Math.max(0, Math.min(1, 1 - dEdge / RIM_M));
  if (s.kind === 'line') {
    const fx = Math.sin(s.dir), fz = Math.cos(s.dir), rx = fz, rz = -fx;
    const nA = Math.max(2, Math.ceil(s.length / STEP)), nW = Math.max(2, Math.ceil(s.width / STEP)), hw = s.width / 2;
    for (let i = 0; i <= nA; i++) for (let j = 0; j <= nW; j++) {
      const along = (i / nA) * s.length, aside = -hw + (j / nW) * s.width;
      xz.push(s.x + fx * along + rx * aside, s.z + fz * along + rz * aside);
      uv.push(i / nA, edge(Math.min(hw - Math.abs(aside), along, s.length - along)));
    }
    for (let i = 0; i < nA; i++) for (let j = 0; j < nW; j++) { const a = i * (nW + 1) + j, b = a + nW + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    return { xz, uv, idx };
  }
  // circle or cone: rings out from the origin
  const R = s.r, nR = Math.max(2, Math.ceil(R / STEP));
  const cone = s.kind === 'cone';
  const half = cone ? s.angle / 2 : Math.PI;
  const nS = cone ? Math.max(4, Math.ceil((s.angle * R) / STEP)) : Math.max(24, Math.min(64, Math.ceil((2 * Math.PI * R) / STEP)));
  const dir = cone ? s.dir : 0;
  // the origin
  xz.push(s.x, s.z); uv.push(0, cone ? 1 : edge(R));
  for (let i = 1; i <= nR; i++) {
    const r = (i / nR) * R;
    for (let j = 0; j <= nS; j++) {
      if (!cone && j === nS) break;
      const a = cone ? dir - half + (j / nS) * s.angle : (j / nS) * Math.PI * 2;
      xz.push(s.x + Math.sin(a) * r, s.z + Math.cos(a) * r);
      const toSide = cone ? r * Math.sin(Math.max(0, Math.min(Math.PI / 2, half - Math.abs(a - dir)))) : Infinity;
      uv.push(r / R, edge(Math.min(R - r, toSide)));
    }
  }
  const ringN = cone ? nS + 1 : nS;
  const at = (i: number, j: number) => (i === 0 ? 0 : 1 + (i - 1) * ringN + (cone ? j : j % nS));
  for (let j = 0; j < nS; j++) idx.push(0, at(1, j), at(1, j + 1));
  for (let i = 1; i < nR; i++) for (let j = 0; j < nS; j++) {
    const a = at(i, j), b = at(i, j + 1), c = at(i + 1, j), d = at(i + 1, j + 1);
    idx.push(a, c, b, b, c, d);
  }
  return { xz, uv, idx };
}

export interface Telegraphs {
  /** Builds, fills and removes decals; true when (x, z) stands inside any of them. */
  update(nowMs: number, x: number, z: number): boolean;
  readonly count: number;
  dispose(): void;
}

export function createTelegraphs(scene: Scene, world: WorldApi, room: ZoneRoom): Telegraphs {
  const live = new Map<number, { mesh: Mesh; mat: ShaderMaterial; shape: Shape; seen: number; total: number }>();
  let time = 0, last = performance.now();

  const make = (t: TelegraphStateView, now: number) => {
    const shape = telegraphShape(t);
    const g = decalGrid(shape);
    const pos: number[] = [];
    for (let i = 0; i < g.xz.length; i += 2) {
      const x = g.xz[i], z = g.xz[i + 1];
      const y = world.surfaceAt(x, z) ?? world.groundAt(x, z) ?? world.surfaceAt(t.x, t.z) ?? 0;
      pos.push(x, y + LIFT, z);
    }
    const mesh = new Mesh(`telegraph_${t.id}`, scene);
    const vd = new VertexData();
    vd.positions = pos; vd.uvs = g.uv; vd.indices = g.idx;
    vd.applyToMesh(mesh, false);
    mesh.isPickable = false;
    mesh.alphaIndex = 1000;
    const mat = new ShaderMaterial(`telegraphMat_${t.id}`, scene, { vertex: 'sgTelegraph', fragment: 'sgTelegraph' }, {
      attributes: ['position', 'uv'], uniforms: ['worldViewProjection', 'fill', 'late', 'danger', 'time'], needAlphaBlending: true,
    });
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    mat.zOffset = -6;
    mesh.material = mat;
    live.set(t.id, { mesh, mat, shape, seen: now, total: t.total > 0 ? t.total : 1 });
  };

  let count = 0;
  const seen = new Set<number>();
  return {
    get count() { return count; },
    update(now, x, z) {
      time += Math.min(0.1, (now - last) / 1000); last = now;
      seen.clear();
      room.state.telegraphs?.forEach((t) => { seen.add(t.id); if (!live.has(t.id)) make(t, now); });
      let inside = false;
      for (const [id, d] of live) {
        if (!seen.has(id)) { d.mesh.dispose(); d.mat.dispose(); live.delete(id); continue; }
        const el = (now - d.seen) / 1000;
        const mine = inShape(d.shape, x, z);
        if (mine) inside = true;
        d.mat.setFloat('fill', telegraphFill(d.seen, now, d.total));
        d.mat.setFloat('late', el >= d.total - LATE_S ? 1 : 0);
        d.mat.setFloat('danger', mine ? 1 : 0);
        d.mat.setFloat('time', time);
      }
      count = live.size;
      return inside;
    },
    dispose() {
      for (const d of live.values()) { d.mesh.dispose(); d.mat.dispose(); }
      live.clear();
    },
  };
}
