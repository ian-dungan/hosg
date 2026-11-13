// Standing fields (state.fields: the Warden's lampfire rings): ground decals, not telegraphs. An animated ember
// shimmer in PALETTE.roof / horizon on the floor inside the field (no rim flash: nothing is about to land, it burns
// every second), a soft warm haze lifting at its edge, and a fade-in as it kindles. On the low tier a flat tinted
// decal only. A ring reaching past the room is cut at the walls (the floor's own reach, as the arena telegraphs).
// It also hands the instance's arena state to a Lampfall world: state.gates (its portcullises) and state.lift.
// Built once per field when it appears and disposed when it goes; per frame only uniforms change.
import { Effect, Mesh, ShaderMaterial, VertexData, type Scene } from '@babylonjs/core';
import type { Shape } from '@sg2/shared';
import type { WorldApi } from '../core/contracts';
import type { ZoneRoom } from '../net/session';
import { TICK_HZ } from '@sg2/shared';

/** The quality the fields draw for (set by the world's setQuality: low → a flat decal). */
export const FIELD_LOOK = { low: false };

/** A field as the state carries it (ZoneState.fields). */
export interface FieldStateView {
  readonly id: number; readonly owner: number; readonly field: string; readonly shape: string;
  readonly x: number; readonly z: number; readonly r: number; readonly inner: number; readonly raw: number; readonly at: number;
}

const LIFT = 0.06;
const STEP = 0.6;
/** The haze at the field's inner edge, in m. */
const HAZE_H = 1.8;
/** A field kindles over this long, in s. */
const KINDLE_S = 1.2;

Effect.ShadersStore.sgFieldVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;
varying vec2 vW;
void main() { vUV = uv; vW = position.xz; gl_Position = worldViewProjection * vec4(position, 1.0); }`;
Effect.ShadersStore.sgFieldFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUV;
varying vec2 vW;
uniform float time;
uniform float low;
uniform float kindle;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {
  vec3 roof = vec3(0.925, 0.416, 0.298), horizon = vec3(0.988, 0.702, 0.502), ember = vec3(1.0, 0.86, 0.5);
  float edgeIn = smoothstep(1.2, 0.0, vUV.x);
  float edgeOut = smoothstep(0.8, 0.0, vUV.y);
  vec3 c; float a;
  if (low > 0.5) {
    c = mix(roof, horizon, 0.35 + 0.4 * edgeIn); a = 0.46 + 0.34 * edgeIn;
  } else {
    float s = n(vW * 0.55 + vec2(time * 0.35, -time * 0.22)) * 0.6 + n(vW * 1.7 - vec2(time * 0.6, time * 0.4)) * 0.4;
    float sparks = pow(n(vW * 2.2 + vec2(0.0, time * 1.4)), 6.0) * 2.0;
    c = mix(roof, horizon, s * 0.6); c = mix(c, ember, clamp(sparks, 0.0, 1.0) * 0.7);
    c = mix(c, ember, edgeIn * (0.55 + 0.2 * sin(time * 3.0 + vW.x)));
    a = 0.2 + 0.18 * s + 0.4 * edgeIn + 0.18 * clamp(sparks, 0.0, 1.0);
  }
  a *= 1.0 - 0.6 * edgeOut;
  gl_FragColor = vec4(c, min(0.92, a) * kindle);
}`;
Effect.ShadersStore.sgFieldHazeVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
uniform float time;
varying vec2 vUV;
void main() { vUV = uv; vec3 p = position; p.y += uv.y * 0.25 * sin(time * 1.3 + uv.x * 40.0); gl_Position = worldViewProjection * vec4(p, 1.0); }`;
Effect.ShadersStore.sgFieldHazeFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform float time;
uniform float kindle;
void main() {
  float w = 0.55 + 0.45 * sin(vUV.x * 75.0 + time * 1.1) * sin(vUV.x * 31.0 - time * 0.7);
  float a = (1.0 - vUV.y) * (1.0 - vUV.y) * 0.42 * w;
  gl_FragColor = vec4(vec3(1.0, 0.62, 0.38) * a, a) * kindle;
}`;

/** The field's Shape (a ring or a circle, in world coordinates). */
export function fieldShape(f: FieldStateView): Shape {
  return f.shape === 'ring' ? { kind: 'ring', x: f.x, z: f.z, dir: 0, inner: f.inner, r: f.r } : { kind: 'circle', x: f.x, z: f.z, r: f.r };
}

/** The floor grid of a field: from its inner radius out to `reach(a)` per spoke. uv: m from the inner edge, m from the outer. */
export function fieldGrid(s: Shape, reach: (a: number) => number): { xz: number[]; uv: number[]; idx: number[] } {
  const inner = s.kind === 'ring' ? s.inner : 0, R = s.kind === 'ring' || s.kind === 'circle' ? s.r : 0;
  const nS = 96;
  const spokes: number[] = [];
  let maxR = inner + 0.5;
  for (let j = 0; j < nS; j++) { const r = Math.max(inner + 0.3, Math.min(R, reach((j / nS) * Math.PI * 2))); spokes.push(r); maxR = Math.max(maxR, r); }
  const nR = Math.max(2, Math.ceil((maxR - inner) / STEP));
  const xz: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= nR; i++) for (let j = 0; j < nS; j++) {
    const a = (j / nS) * Math.PI * 2, Rj = spokes[j], r = inner + (i / nR) * (Rj - inner);
    xz.push(s.x + Math.sin(a) * r, s.z + Math.cos(a) * r);
    uv.push(r - inner, Rj - r);
  }
  for (let i = 0; i < nR; i++) for (let j = 0; j < nS; j++) {
    const a = i * nS + j, b = i * nS + ((j + 1) % nS), c = a + nS, d = b + nS;
    idx.push(a, c, b, b, c, d);
  }
  return { xz, uv, idx };
}

/** Floor this much higher or lower than the origin's ends a decal that reaches for the walls (it stops at ramps). */
const CLIP_DY = 0.35;

/**
 * The farthest the floor reaches from (x, z) in direction a, on the origin's own level (sampled every 0.5 m up to
 * `max`): where an arena-wide decal stops.
 */
export function floorReach(world: Pick<WorldApi, 'surfaceAt' | 'groundAt'>, x: number, z: number, a: number, max: number): number {
  const y0 = world.groundAt(x, z) ?? world.surfaceAt(x, z) ?? 0;
  const sx = Math.sin(a), sz = Math.cos(a);
  let last = 0;
  for (let d = 0.5; d <= max; d += 0.5) {
    const px = x + sx * d, pz = z + sz * d;
    const y = world.groundAt(px, pz) ?? world.surfaceAt(px, pz);
    if (y === null) {
      // an obstacle (a pillar, a rubble block) is not a wall: look a little past it
      let past = false;
      for (let k = 1; k <= 6 && !past; k++) { const q = d + k * 0.5; const yy = world.surfaceAt(x + sx * q, z + sz * q); if (yy !== null && Math.abs(yy - y0) < CLIP_DY) past = true; }
      if (!past) break;
      continue;
    }
    if (Math.abs(y - y0) > CLIP_DY) break;
    last = d;
  }
  return last;
}

export interface Fields {
  update(nowMs: number): void;
  readonly count: number;
  dispose(): void;
}

interface LiveField { floor: Mesh; haze: Mesh | null; born: number }

export function createFields(scene: Scene, world: WorldApi, room: ZoneRoom): Fields {
  const live = new Map<number, LiveField>();
  const floorMat = new ShaderMaterial('fieldMat', scene, { vertex: 'sgField', fragment: 'sgField' }, {
    attributes: ['position', 'uv'], uniforms: ['worldViewProjection', 'time', 'low', 'kindle'], needAlphaBlending: true,
  });
  floorMat.backFaceCulling = false; floorMat.disableDepthWrite = true; floorMat.zOffset = -4;
  const hazeMat = new ShaderMaterial('fieldHazeMat', scene, { vertex: 'sgFieldHaze', fragment: 'sgFieldHaze' }, {
    attributes: ['position', 'uv'], uniforms: ['worldViewProjection', 'time', 'kindle'], needAlphaBlending: true,
  });
  hazeMat.backFaceCulling = false; hazeMat.disableDepthWrite = true; hazeMat.alphaMode = 1; // additive
  // each field fades in on its own: one material per live field would cost a draw state each; instead the newest
  // field's kindle drives both (fields start one at a time, a phase apart)
  let time = 0, last = performance.now(), newest = 0;

  const make = (f: FieldStateView, now: number) => {
    const s = fieldShape(f);
    const y0 = world.groundAt(f.x, f.z) ?? world.surfaceAt(f.x, f.z) ?? 0;
    const g = fieldGrid(s, (a) => floorReach(world, f.x, f.z, a, f.r));
    const pos: number[] = [];
    for (let i = 0; i < g.xz.length; i += 2) { const x = g.xz[i], z = g.xz[i + 1]; pos.push(x, (world.surfaceAt(x, z) ?? world.groundAt(x, z) ?? y0) + LIFT, z); }
    const floor = new Mesh(`field_${f.id}`, scene);
    const vd = new VertexData(); vd.positions = pos; vd.uvs = g.uv; vd.indices = g.idx; vd.applyToMesh(floor, false);
    floor.material = floorMat; floor.isPickable = false; floor.alphaIndex = 900;
    let haze: Mesh | null = null;
    if (s.kind === 'ring' && s.inner > 0.5) {
      const n = 96, hp: number[] = [], huv: number[] = [], hi: number[] = [];
      for (let j = 0; j <= n; j++) {
        const a = (j / n) * Math.PI * 2, x = f.x + Math.sin(a) * s.inner, z = f.z + Math.cos(a) * s.inner;
        const y = world.groundAt(x, z) ?? y0;
        hp.push(x, y, z, x, y + HAZE_H, z); huv.push(j / n, 0, j / n, 1);
      }
      for (let j = 0; j < n; j++) { const a = j * 2; hi.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
      haze = new Mesh(`fieldHaze_${f.id}`, scene);
      const hv = new VertexData(); hv.positions = hp; hv.uvs = huv; hv.indices = hi; hv.applyToMesh(haze, false);
      haze.material = hazeMat; haze.isPickable = false; haze.alphaIndex = 901;
    }
    const at = typeof f.at === 'number' && typeof room.state.clock === 'number' ? Math.max(0, (room.state.clock - f.at) / TICK_HZ) : 0;
    const born = now - at * 1000;
    newest = Math.max(newest, born);
    live.set(f.id, { floor, haze, born });
  };

  const seen = new Set<number>();
  let nowMs = 0;
  const arena = world as WorldApi & { setGates?(mask: number): void; setLift?(open: boolean): void };
  let gatesSeen = 0, liftSeen = false;
  const visit = (f: FieldStateView) => { seen.add(f.id); if (!live.has(f.id)) make(f, nowMs); };
  const fieldsOf = () => (room.state as unknown as { fields?: { forEach(cb: (f: FieldStateView) => void): void } }).fields;
  return {
    get count() { return live.size; },
    update(now) {
      time += Math.min(0.1, (now - last) / 1000); last = now; nowMs = now;
      seen.clear();
      fieldsOf()?.forEach(visit);
      // the arena's state: a Lampfall world draws its lamp-gates (state.gates) and the lamp-lift (state.lift)
      const st = room.state as unknown as { gates?: number; lift?: boolean };
      if (arena.setGates && (st.gates ?? 0) !== gatesSeen) { gatesSeen = st.gates ?? 0; arena.setGates(gatesSeen); }
      if (arena.setLift && !!st.lift !== liftSeen) { liftSeen = !!st.lift; arena.setLift(liftSeen); }
      for (const [id, d] of live) if (!seen.has(id)) { d.floor.dispose(); d.haze?.dispose(); live.delete(id); }
      if (live.size === 0) return;
      const kindle = Math.max(0, Math.min(1, (now - newest) / 1000 / KINDLE_S));
      floorMat.setFloat('time', time); floorMat.setFloat('low', FIELD_LOOK.low ? 1 : 0); floorMat.setFloat('kindle', kindle);
      hazeMat.setFloat('time', time); hazeMat.setFloat('kindle', kindle);
      for (const d of live.values()) d.haze?.setEnabled(!FIELD_LOOK.low);
    },
    dispose() {
      for (const d of live.values()) { d.floor.dispose(); d.haze?.dispose(); }
      live.clear();
      floorMat.dispose(); hazeMat.dispose();
    },
  };
}
