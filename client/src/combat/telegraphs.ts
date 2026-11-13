// Ground telegraphs: one decal per telegraph in the room state, in the shared shape (circle, cone, line or ring from
// @sg2/shared shapes), laid on the ground it covers (slopes, rock tops) and drawn over it on every quality tier.
// A translucent warm-red base, an inner fill that grows from the origin over (total − TELEGRAPH_LEAD_S) from when
// the decal was first seen (so it is full a little before the hit: what the player sees errs in their favour),
// a bright rim of constant width, and a flashing rim in the last 0.3 s.
//
// Plan 4's telegraph language on top of that base (every look keeps the warm base, the fill and the rim flash):
//   - ring (Cinder Ring): the decal is the ring itself, its safe inner circle outlined in white;
//   - interruptible (Ember Breath, Keeper's Toll, Focus Beam): a teal-to-blue rim and a "!" glyph near the origin;
//   - "each" (Brass Fall): a purple tint on every circle and a falling-gear glyph in its centre ("spread out");
//   - repeat (Turning Light): the sequence's later lines show as faint dashed outlines until their own wind-up starts;
//   - whole-arena attacks (Keeper's Toll, Last Light: a circle reaching past the room's walls): a thin bright band
//     along the arena wall and a pulsing centre ring that closes on the boss as the hit nears, not a giant red disc;
//   - unavoidable (Keeper's Toll, Last Light: dodging does not help): hatched "warning tape" in the band, and a hint
//     "Can't be dodged — shield, heal or Break it" while you stand in one;
//   - enrage (a boss past its enrage clock): the screen edge pulses gold.
// The bosses' standing fields (state.fields: the Warden's fire rings) are drawn by fields.ts, driven from here.
// Decal materials are pooled; nothing is allocated per frame.
import { Effect, Mesh, ShaderMaterial, Vector3, VertexData, type Scene } from '@babylonjs/core';
import { ENEMY_ATTACKS, inShape, type EnemyAttackData, type EnemyAttackId, type Shape } from '@sg2/shared';
import type { WorldApi } from '../core/contracts';
import { telegraphElapsedS, type EnemyStateView, type TelegraphStateView, type ZoneRoom } from '../net/session';
import { telegraphFill } from './controller';
import { createFields, floorReach, type Fields } from './fields';

export { floorReach };

/** Height of the decal above the ground, in m (with a depth offset it never sinks into the terrain's facets). */
const LIFT = 0.07;
/** Grid spacing of the decal mesh, in m (fine enough to follow slopes). */
const STEP = 0.35;
/** Width of the rim, in m. */
const RIM_M = 0.3;
/** The rim flashes for this long before the hit, in s. */
const LATE_S = 0.3;
/** A circle at least this big covers a whole arena: drawn as the band along the wall and a centre pulse. */
export const ARENA_TELEGRAPH_R = 20;
/** A line at least this long is cut where the floor ends, in m. */
const LONG_LINE_M = 12;
/** The arena look's band along the wall, in m. */
const ARENA_BAND_M = 1.4;

/** How a telegraph is drawn (the shader's `style`). */
export const enum TStyle { Base = 0, Interrupt = 1, Each = 2, Ghost = 3 }
/** The glyph near its origin (the shader's `glyph`). */
export const enum TGlyph { None = 0, Bang = 1, Gear = 2 }

/** Everything about a telegraph's look that comes from its attack (pure). */
export interface TelegraphLook { style: TStyle; glyph: TGlyph; arena: boolean; unavoidable: boolean; ring: boolean }
export function telegraphLook(attack: string, shape: Shape): TelegraphLook {
  const a: EnemyAttackData | undefined = Object.prototype.hasOwnProperty.call(ENEMY_ATTACKS, attack) ? ENEMY_ATTACKS[attack as EnemyAttackId] : undefined;
  const arena = shape.kind === 'circle' && shape.r >= ARENA_TELEGRAPH_R;
  const each = a?.targets === 'each';
  const interrupt = !!a?.interruptible;
  return {
    style: each ? TStyle.Each : interrupt ? TStyle.Interrupt : TStyle.Base,
    glyph: each ? TGlyph.Gear : interrupt ? TGlyph.Bang : TGlyph.None,
    arena, unavoidable: !!a?.unavoidable, ring: shape.kind === 'ring',
  };
}

Effect.ShadersStore.sgTelegraphVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec2 uv2;
attribute vec2 uv3;
uniform mat4 worldViewProjection;
varying vec2 vUV;
varying vec2 vLoc;
varying vec2 vIn;
void main() { vUV = uv; vLoc = uv2; vIn = uv3; gl_Position = worldViewProjection * vec4(position, 1.0); }`;
Effect.ShadersStore.sgTelegraphFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUV;
varying vec2 vLoc;
varying vec2 vIn;
uniform float fill;
uniform float late;
uniform float danger;
uniform float time;
uniform float style;
uniform float glyph;
uniform vec3 glyphAt;
uniform float arena;
uniform float unavoid;
uniform float ring;
float bang(vec2 p) {
  float bar = step(abs(p.x), 0.17) * step(-0.12, p.y) * step(p.y, 0.95);
  float dotp = step(length(p - vec2(0.0, -0.42)), 0.19);
  return max(bar, dotp);
}
float gear(vec2 p) {
  float r = length(p), a = atan(p.y, p.x) + time * 1.5;
  float teeth = step(0.5, fract(a * 8.0 / 6.2831853));
  float outer = 0.62 + 0.2 * teeth;
  return step(r, outer) * step(0.24, r);
}
void main() {
  float u = vUV.x;   // 0 at the origin .. 1 at the far edge (the fill grows along it)
  float e = vUV.y;   // 0 inside .. 1 on the outer edge (constant width in metres)
  bool isInt = abs(style - 1.0) < 0.5, isEach = abs(style - 2.0) < 0.5, isGhost = abs(style - 3.0) < 0.5;
  vec3 warm = vec3(0.93, 0.29, 0.17);
  if (isEach) warm = vec3(0.72, 0.28, 0.62);
  vec3 c = warm;
  float a = 0.24;
  float pulse = 0.5 + 0.5 * sin(time * 26.0);
  if (arena > 0.5) {
    // the whole-arena look: a faint wash, a bright band along the wall, a centre ring closing on the boss
    float r = length(vLoc);
    float band = smoothstep(${(ARENA_BAND_M).toFixed(2)}, 0.0, vIn.y);
    float edgeLine = smoothstep(0.22, 0.0, vIn.y);
    float rc = mix(7.5, 2.4, fill);
    float cring = smoothstep(0.42, 0.0, abs(r - rc)) * (0.75 + 0.25 * sin(time * 9.0));
    float wash = 0.07 + 0.05 * sin(time * 5.0) + 0.1 * fill;
    vec3 bandC = vec3(1.0, 0.42, 0.22);
    if (isInt) bandC = vec3(0.32, 0.72, 1.0);
    if (unavoid > 0.5) {
      // hatched warning tape: dodging will not help
      float s = step(0.5, fract((vLoc.x + vLoc.y) * 0.9 + time * 0.8));
      bandC = mix(bandC, vec3(1.0, 0.93, 0.62), s * 0.85);
    }
    c = mix(warm, bandC, max(band, cring));
    c = mix(c, vec3(1.0, 0.97, 0.88), edgeLine * (0.6 + 0.4 * late * pulse));
    a = max(wash, max(band * 0.78, cring * 0.9));
    a = max(a, edgeLine);
    c = mix(c, vec3(1.0, 0.95, 0.8), late * pulse * band * 0.6);
  } else {
    float inFill = step(u, fill);
    c = mix(c, isEach ? vec3(0.88, 0.42, 0.85) : vec3(1.0, 0.42, 0.2), inFill);
    a = mix(a, 0.46, inFill);
    float front = (1.0 - smoothstep(0.0, 0.035, abs(u - fill))) * (1.0 - step(0.999, fill));
    c = mix(c, vec3(1.0, 0.86, 0.55), front);
    a = max(a, front * 0.9);
    float rim = smoothstep(0.25, 0.85, e);
    vec3 rimC = isInt ? mix(vec3(0.25, 0.82, 0.78), vec3(0.3, 0.55, 1.0), 0.5 + 0.5 * sin(time * 6.0))
              : isEach ? vec3(0.9, 0.5, 1.0) : vec3(1.0, 0.36, 0.22);
    rimC = mix(rimC, vec3(1.0, 0.95, 0.8), late * pulse);
    c = mix(c, rimC, rim);
    a = max(a, rim * mix(0.8, 1.0, late));
    // the outermost edge: a bright warm line, so the shape reads on dark and light floors alike (3:1 or better)
    float edgeL = smoothstep(0.72, 0.95, e);
    c = mix(c, isInt ? vec3(0.7, 0.93, 1.0) : isEach ? vec3(1.0, 0.8, 1.0) : vec3(1.0, 0.84, 0.64), edgeL * 0.95);
    a = max(a, edgeL);
    if (ring > 0.5) {
      // the safe middle's edge, in white
      float inner = smoothstep(0.2, 0.05, vIn.x);
      c = mix(c, vec3(1.0), inner); a = max(a, inner * 0.95);
    }
    if (isGhost) {
      // a later line of a sequence: a faint dashed outline, brightening as its own wind-up nears (fill)
      float dash = step(0.45, fract(vLoc.y / 1.4));
      c = vec3(1.0, 0.55, 0.35);
      a = rim * dash * (0.45 + 0.45 * fill) + 0.07 + 0.08 * fill;
    }
  }
  if (glyph > 0.5) {
    // the glyph reads upright for someone facing the caster (the camera behind them): its top toward the origin.
    // On the arena look it repeats round the centre ring, each one pointing at the boss.
    vec2 p = (vLoc - glyphAt.xy) / glyphAt.z;
    if (arena > 0.5) {
      float r = length(vLoc), ang = atan(vLoc.x, vLoc.y);
      float k = floor(ang / 1.5707963 + 0.5) * 1.5707963;
      float da = ang - k;
      p = vec2(r * sin(da), r * cos(da) - mix(7.5, 2.4, fill) - 1.6) / glyphAt.z;
    }
    p.y = -p.y;
    float disc = step(length(p), 1.12);
    float g = glyph < 1.5 ? bang(p) : gear(p);
    vec3 discC = glyph < 1.5 ? vec3(0.08, 0.2, 0.42) : vec3(0.3, 0.1, 0.32);
    vec3 gC = glyph < 1.5 ? vec3(1.0) : vec3(1.0, 0.82, 0.42);
    c = mix(c, discC, disc * 0.85); a = max(a, disc * 0.78);
    c = mix(c, gC, g); a = max(a, g);
  }
  a = min(1.0, a * (1.0 + 0.3 * danger * (0.5 + 0.5 * sin(time * 14.0))));
  gl_FragColor = vec4(c, a);
}`;

/** The shared Shape for a telegraph in the state. */
export function telegraphShape(t: TelegraphStateView): Shape {
  if (t.shape === 'cone') return { kind: 'cone', x: t.x, z: t.z, dir: t.dir, r: t.r, angle: t.angle };
  if (t.shape === 'line') return { kind: 'line', x: t.x, z: t.z, dir: t.dir, length: t.r, width: t.width };
  // a ring (the Cinder Ring): drawn as the ring itself, its safe middle left clear
  const inner = Math.max(0, Math.min(t.r, (t as TelegraphStateView & { inner?: number }).inner ?? 0));
  if (t.shape === 'ring') return { kind: 'ring', x: t.x, z: t.z, dir: 0, inner, r: t.r };
  return { kind: 'circle', x: t.x, z: t.z, r: t.r };
}

export interface DecalGrid {
  xz: number[];
  /** u: progress from the origin 0..1; v: 0 inside .. 1 on the edge. */
  uv: number[];
  /** Metres from the origin, rotated: x to the right of the attack's direction, y along it. */
  loc: number[];
  /** x: metres from a ring's inner edge (99 elsewhere); y: metres from the outer edge. */
  inn: number[];
  idx: number[];
}

/**
 * The decal's vertices in the ground plane (x, z) with uv (u: progress from the origin 0..1, v: 0 inside .. 1 on the
 * edge), local coordinates and triangles. Pure: the heights come later. `clip(a)` (circles and rings) gives the
 * farthest the decal may reach in direction a (x = sin a, z = cos a): the arena look stops at the walls.
 */
export function decalGrid(s: Shape, clip?: (a: number) => number): DecalGrid {
  const xz: number[] = [], uv: number[] = [], loc: number[] = [], inn: number[] = [], idx: number[] = [];
  const edge = (dEdge: number) => Math.max(0, Math.min(1, 1 - dEdge / RIM_M));
  if (s.kind === 'line') {
    const fx = Math.sin(s.dir), fz = Math.cos(s.dir), rx = fz, rz = -fx;
    const nA = Math.max(2, Math.ceil(s.length / STEP)), nW = Math.max(2, Math.ceil(s.width / STEP)), hw = s.width / 2;
    for (let i = 0; i <= nA; i++) for (let j = 0; j <= nW; j++) {
      const along = (i / nA) * s.length, aside = -hw + (j / nW) * s.width;
      xz.push(s.x + fx * along + rx * aside, s.z + fz * along + rz * aside);
      const dEdge = Math.min(hw - Math.abs(aside), along, s.length - along);
      uv.push(i / nA, edge(dEdge)); loc.push(aside, along); inn.push(99, dEdge);
    }
    for (let i = 0; i < nA; i++) for (let j = 0; j < nW; j++) { const a = i * (nW + 1) + j, b = a + nW + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    return { xz, uv, loc, inn, idx };
  }
  const R = s.r, cone = s.kind === 'cone', ring = s.kind === 'ring';
  const r0 = ring ? s.inner : 0;
  const dir = s.kind === 'cone' || s.kind === 'ring' ? s.dir : 0;
  const cd = Math.cos(dir), sd = Math.sin(dir);
  const put = (x: number, z: number) => { const dx = x - s.x, dz = z - s.z; loc.push(dx * cd - dz * sd, dx * sd + dz * cd); };
  const half = cone ? s.angle / 2 : Math.PI;
  const nS = cone ? Math.max(4, Math.ceil((s.angle * R) / STEP)) : Math.max(24, Math.min(cone ? 64 : 96, Math.ceil((2 * Math.PI * (clip ? Math.min(R, 24) : R)) / STEP)));
  const nR = Math.max(2, Math.ceil((clip ? Math.min(R, 24) : R - r0) / STEP));
  // per spoke: its reach (clipped)
  const reach: number[] = [];
  for (let j = 0; j <= nS; j++) {
    const a = cone ? s.dir - half + (j / nS) * s.angle : (j / nS) * Math.PI * 2;
    reach.push(clip ? Math.max(r0 + 0.5, Math.min(R, clip(a))) : R);
  }
  if (!ring) { xz.push(s.x, s.z); uv.push(0, cone ? 1 : edge(reach[0])); loc.push(0, 0); inn.push(99, reach[0]); }
  const ringN = cone ? nS + 1 : nS;
  const first = ring ? 0 : 1;
  for (let i = first; i <= nR; i++) {
    for (let j = 0; j <= nS; j++) {
      if (!cone && j === nS) break;
      const a = cone ? s.dir - half + (j / nS) * s.angle : (j / nS) * Math.PI * 2;
      const Rj = reach[j], r = r0 + (i / nR) * (Rj - r0);
      const x = s.x + Math.sin(a) * r, z = s.z + Math.cos(a) * r;
      xz.push(x, z); put(x, z);
      const toSide = cone ? r * Math.sin(Math.max(0, Math.min(Math.PI / 2, half - Math.abs(a - s.dir)))) : Infinity;
      const dOut = Rj - r, dIn = ring ? r - r0 : 99;
      uv.push((r - r0) / Math.max(1e-6, Rj - r0), edge(Math.min(dOut, toSide, dIn)));
      inn.push(dIn, Math.min(dOut, toSide));
    }
  }
  const at = (i: number, j: number) => (ring ? i * ringN + (cone ? j : j % nS) : i === 0 ? 0 : 1 + (i - 1) * ringN + (cone ? j : j % nS));
  if (!ring) for (let j = 0; j < nS; j++) idx.push(0, at(1, j), at(1, j + 1));
  for (let i = first === 0 ? 0 : 1; i < nR; i++) for (let j = 0; j < nS; j++) {
    const a = at(i, j), b = at(i, j + 1), c = at(i + 1, j), d = at(i + 1, j + 1);
    idx.push(a, c, b, b, c, d);
  }
  return { xz, uv, loc, inn, idx };
}

/** Where a telegraph's glyph sits (in decal-local metres) and how big it is: beyond the caster for cones and lines. */
export function glyphPlace(s: Shape): [number, number, number] {
  if (s.kind === 'line') return [0, Math.min(s.length * 0.5, Math.max(2.6, s.length * 0.3)), 0.75];
  if (s.kind === 'cone') return [0, Math.min(s.r * 0.6, Math.max(2.8, s.r * 0.4)), 0.8];
  if (s.kind === 'circle' && s.r >= ARENA_TELEGRAPH_R) return [0, 0, 0.75];
  return [0, 0, Math.min(1, s.kind === 'circle' ? s.r * 0.3 : 1)];
}

export interface Telegraphs {
  /** Builds, fills and removes decals; true when (x, z) stands inside any of them. */
  update(nowMs: number, x: number, z: number): boolean;
  readonly count: number;
  dispose(): void;
}

interface Live { mesh: Mesh; mat: ShaderMaterial; shape: Shape; seen: number; total: number; look: TelegraphLook }
interface Seq { owner: number; attack: EnemyAttackId; k: number; count: number; every: number; startMs: number; ghosts: { mesh: Mesh; mat: ShaderMaterial }[] }

const CSS = /* css */ `
.sg-tg-enrage{position:absolute;inset:0;pointer-events:none;opacity:0;box-shadow:inset 0 0 70px 26px rgba(242,183,66,.85),inset 0 0 18px 6px rgba(255,236,170,.7);transition:opacity .3s}
.sg-tg-enrage.on{animation:sg-tg-enrage .8s ease-in-out infinite alternate}
@keyframes sg-tg-enrage{from{opacity:.35}to{opacity:1}}
.sg-tg-hint{position:absolute;left:50%;top:22%;transform:translateX(-50%);pointer-events:none;display:none;padding:6px 12px;border-radius:14px;
  background:rgba(28,16,48,.82);box-shadow:0 0 0 2px rgba(255,236,170,.75);color:#fff6e0;font:700 14px/1.2 var(--sans,system-ui);white-space:nowrap;text-align:center}
.sg-tg-hint.on{display:block}
@media (max-width:480px){.sg-tg-hint{font-size:12px;top:19%}}
`;

export function createTelegraphs(scene: Scene, world: WorldApi, room: ZoneRoom): Telegraphs {
  const live = new Map<number, Live>();
  const seqs = new Map<number, Seq>();
  const pool: ShaderMaterial[] = [];
  let made = 0;
  let time = 0, last = performance.now();
  const fields: Fields = createFields(scene, world, room);

  // DOM: the gold enrage edge and the "cannot be dodged" hint
  if (typeof document !== 'undefined' && !document.getElementById('sg-tg-css')) {
    const st = document.createElement('style'); st.id = 'sg-tg-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const hudRoot = typeof document !== 'undefined' ? document.getElementById('hud') ?? document.body : null;
  const enrageEl = hudRoot ? document.createElement('div') : null;
  const hintEl = hudRoot ? document.createElement('div') : null;
  if (hudRoot && enrageEl && hintEl) {
    enrageEl.className = 'sg-tg-enrage'; hintEl.className = 'sg-tg-hint';
    hintEl.textContent = 'Can’t be dodged — shield, heal or Break it';
    hudRoot.prepend(enrageEl); hudRoot.appendChild(hintEl);
  }
  let enrageOn = false, hintOn = false;

  const takeMat = (): ShaderMaterial => {
    const m = pool.pop();
    if (m) return m;
    const mat = new ShaderMaterial(`telegraphMat_${made++}`, scene, { vertex: 'sgTelegraph', fragment: 'sgTelegraph' }, {
      attributes: ['position', 'uv', 'uv2', 'uv3'],
      uniforms: ['worldViewProjection', 'fill', 'late', 'danger', 'time', 'style', 'glyph', 'glyphAt', 'arena', 'unavoid', 'ring'], needAlphaBlending: true,
    });
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    mat.zOffset = -6;
    return mat;
  };
  const giveMat = (m: ShaderMaterial) => { pool.push(m); };

  const buildMesh = (name: string, shape0: Shape, look: TelegraphLook, mat: ShaderMaterial): Mesh => {
    // a long line stops at the walls (Beacon Lance and Turning Light reach past the Lens Pit's edge)
    const shape: Shape = shape0.kind === 'line' && shape0.length > LONG_LINE_M
      ? { ...shape0, length: Math.max(1, Math.min(shape0.length, floorReach(world, shape0.x, shape0.z, shape0.dir, shape0.length))) } : shape0;
    const clip = look.arena ? (a: number) => floorReach(world, shape.x, shape.z, a, Math.min((shape as { r: number }).r, 40)) : undefined;
    const g = decalGrid(shape, clip);
    const pos: number[] = [];
    const y0 = world.surfaceAt(shape.x, shape.z) ?? world.groundAt(shape.x, shape.z) ?? 0;
    for (let i = 0; i < g.xz.length; i += 2) {
      const x = g.xz[i], z = g.xz[i + 1];
      const y = world.surfaceAt(x, z) ?? world.groundAt(x, z) ?? y0;
      pos.push(x, y + LIFT, z);
    }
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = pos; vd.uvs = g.uv; vd.uvs2 = g.loc; vd.uvs3 = g.inn; vd.indices = g.idx;
    vd.applyToMesh(mesh, false);
    mesh.isPickable = false;
    mesh.alphaIndex = 1000;
    mesh.material = mat;
    const [gx, gy, gs] = glyphPlace(shape);
    mat.setFloat('style', look.style); mat.setFloat('glyph', look.glyph); mat.setVector3('glyphAt', new Vector3(gx, gy, gs));
    mat.setFloat('arena', look.arena ? 1 : 0); mat.setFloat('unavoid', look.unavoidable ? 1 : 0); mat.setFloat('ring', look.ring ? 1 : 0);
    mat.setFloat('fill', 0); mat.setFloat('late', 0); mat.setFloat('danger', 0); mat.setFloat('time', time);
    return mesh;
  };

  const make = (t: TelegraphStateView, now: number) => {
    const shape = telegraphShape(t);
    const look = telegraphLook(t.attack, shape);
    const mat = takeMat();
    const mesh = buildMesh(`telegraph_${t.id}`, shape, look, mat);
    // first seen part way through (it came into view mid-wind-up): fill from where the server's clock says it is
    const seen = now - telegraphElapsedS(t, room.state.clock) * 1000;
    live.set(t.id, { mesh, mat, shape, seen, total: t.total > 0 ? t.total : 1, look });
    // a repeat sequence (Turning Light): the first line shows the rest as faint outlines
    const atk = Object.prototype.hasOwnProperty.call(ENEMY_ATTACKS, t.attack) ? ENEMY_ATTACKS[t.attack as EnemyAttackId] : undefined;
    const rep = atk?.repeat;
    if (rep && rep.count > 1 && shape.kind === 'line') {
      const sq = seqs.get(t.owner);
      if (sq && sq.attack === atk.id && sq.k < sq.count && now - sq.startMs < (sq.count * sq.every + atk.windup + 1) * 1000) {
        const g = sq.ghosts[sq.k - 1];
        if (g) g.mesh.setEnabled(false);
        sq.k++;
      } else {
        if (sq) dropSeq(sq);
        const ghosts: Seq['ghosts'] = [];
        for (let k = 1; k < rep.count; k++) {
          const gs: Shape = { kind: 'line', x: shape.x, z: shape.z, dir: shape.dir + k * rep.rotate, length: shape.length, width: shape.width };
          const gm = takeMat();
          const mesh2 = buildMesh(`telegraphGhost_${t.id}_${k}`, gs, { style: TStyle.Ghost, glyph: TGlyph.None, arena: false, unavoidable: false, ring: false }, gm);
          mesh2.alphaIndex = 999;
          ghosts.push({ mesh: mesh2, mat: gm });
        }
        seqs.set(t.owner, { owner: t.owner, attack: atk.id, k: 1, count: rep.count, every: rep.every, startMs: seen, ghosts });
      }
    }
  };
  const dropSeq = (sq: Seq) => {
    for (const g of sq.ghosts) { g.mesh.dispose(); giveMat(g.mat); }
    sq.ghosts.length = 0;
    seqs.delete(sq.owner);
  };

  let count = 0;
  let nowMs = 0;
  const seen = new Set<number>();
  const owners = new Set<number>();
  const visit = (t: TelegraphStateView) => { seen.add(t.id); owners.add(t.owner); if (!live.has(t.id)) make(t, nowMs); };
  let enraged = false, clock = 0;
  const visitEnemy = (e: EnemyStateView) => {
    const at = (e as EnemyStateView & { enrageAt?: number }).enrageAt ?? 0;
    if (at > 0 && clock >= at && e.mode !== 'dead') enraged = true;
  };
  return {
    get count() { return count; },
    update(now, x, z) {
      time += Math.min(0.1, (now - last) / 1000); last = now; nowMs = now;
      seen.clear(); owners.clear();
      room.state.telegraphs?.forEach(visit);
      let inside = false, unavoidHere = false;
      for (const [id, d] of live) {
        if (!seen.has(id)) { d.mesh.dispose(); giveMat(d.mat); live.delete(id); continue; }
        const el = (now - d.seen) / 1000;
        const mine = inShape(d.shape, x, z);
        if (mine) { inside = true; if (d.look.unavoidable) unavoidHere = true; }
        d.mat.setFloat('fill', telegraphFill(d.seen, now, d.total));
        d.mat.setFloat('late', el >= d.total - LATE_S ? 1 : 0);
        d.mat.setFloat('danger', mine ? 1 : 0);
        d.mat.setFloat('time', time);
      }
      for (const sq of seqs.values()) {
        const over = (now - sq.startMs) / 1000 > sq.count * sq.every + 2.5;
        if (over || (!owners.has(sq.owner) && sq.k >= sq.count)) { dropSeq(sq); continue; }
        for (let j = 0; j < sq.ghosts.length; j++) {
          const due = (j + 1) * sq.every, toGo = due - (now - sq.startMs) / 1000;
          const m = sq.ghosts[j].mat;
          m.setFloat('fill', Math.max(0, Math.min(1, 1 - toGo / (sq.every * 3))));
          m.setFloat('time', time);
        }
      }
      count = live.size;
      // the gold edge while a boss in view is enraged; the hint while standing in an undodgeable telegraph
      enraged = false; clock = room.state.clock ?? 0;
      room.state.enemies?.forEach(visitEnemy);
      if (enrageEl && enraged !== enrageOn) { enrageOn = enraged; enrageEl.classList.toggle('on', enraged); }
      if (hintEl && unavoidHere !== hintOn) { hintOn = unavoidHere; hintEl.classList.toggle('on', unavoidHere); }
      fields.update(now);
      return inside;
    },
    dispose() {
      for (const d of live.values()) { d.mesh.dispose(); d.mat.dispose(); }
      live.clear();
      for (const sq of [...seqs.values()]) dropSeq(sq);
      for (const m of pool) m.dispose();
      pool.length = 0;
      fields.dispose();
      enrageEl?.remove(); hintEl?.remove();
    },
  };
}
