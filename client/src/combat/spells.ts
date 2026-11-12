// Spell and support visuals, built in code and pooled. One language for the four elements, used the same way for
// casts, projectiles, impacts and marks:
//   fire       orange-red embers and orbs that rise                       (PALETTE roof)
//   water      teal droplets in ribbons, ripples                          (PALETTE teal)
//   lightning  pale gold-white jagged bolts from above, flashes           (PALETTE gold)
//   earth      brown-grey rock shards bursting from the ground, dust      (PALETTE rock / cliff)
//   light      white-gold beams and motes (the White Mage's Light school) (PALETTE cloud)
// The four reactions are the duo's reward and the loudest effects in the game: Blast (fire on Marked), Conduct
// (lightning on Soaked), Steam (water on Burning) and Bedrock (earth on Dazed).
//
// Drawing: six meshes, each drawn once with thin instances (matrix + colour per instance): unlit glows (orbs,
// ground rings, beams), a faceted shell (shields, the aegis dome), and lit, fading rocks and puffs. So every spell
// in view costs at most six draw calls, with no material or mesh per effect. A visual is a slot in a fixed pool
// of MAX_LIVE (the oldest is recycled); its particles are worked out each frame from its time and a seed, so
// nothing is allocated per frame. Every one is drawn before the ground telegraphs (alphaIndex), so danger decals
// always draw over it.
import { Color3, Constants, Mesh, MeshBuilder, StandardMaterial, VertexData, type Scene } from '@babylonjs/core';
import { ABILITIES, BUFF_BITS, DEBUFF_BITS, ENEMY_ATTACKS, MARK_BITS, type AbilityId, type ElementId, type FxEvent, type JobId } from '@sg2/shared';
import { PALETTE, type Quality } from '../core/contracts';

export const MAX_LIVE = 24;

export type Tone = ElementId | 'light' | 'arcane';
export type VisualKind =
  | ElementId | 'light' | 'heal' | 'shield' | 'roar' | 'aegis' | 'aegis_ally' | 'sheltered' | 'rain' | 'mist' | 'pact' | 'bloodbond'
  | 'blinded' | 'weakpoint' | 'gift' | 'revive' | 'blast' | 'conduct' | 'steam' | 'bedrock' | 'bedrockRing' | 'taunt' | 'ashcloud'
  | 'fizzle' | 'staffBolt' | 'generic';

export interface VisualSpec {
  kind: VisualKind;
  /** Engine ids: who it comes from and who it lands on (the same for a visual on one entity). */
  src: number;
  dst: number;
  /** Seconds. */
  dur: number;
  /** Louder: a finisher or signature, a reaction, a revive, a big heal. */
  big?: boolean;
  /** The ability, where its shape depends on it (Hearthfall falls from the sky, Lantern Flare is a wide beam). */
  ability?: AbilityId;
  /** A staff auto's tint. */
  tint?: 'white' | 'black';
}

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isElement = (e: unknown): e is ElementId => e === 'fire' || e === 'water' || e === 'lightning' || e === 'earth';

const DUR: Record<VisualKind, number> = {
  fire: 0.6, water: 0.6, lightning: 0.5, earth: 0.95, light: 0.55, heal: 1.1, shield: 0.45, roar: 0.75, aegis: 0.5, aegis_ally: 0.5,
  sheltered: 0.6, rain: 6, mist: 0.7, pact: 0.9, bloodbond: 0.9, blinded: 0.8, weakpoint: 0.5, gift: 0.95, revive: 1.6, blast: 1.05,
  conduct: 1.5, steam: 1.5, bedrock: 1.05, bedrockRing: 1.5, taunt: 0.65, ashcloud: 1.2, fizzle: 0.5, staffBolt: 0.3, generic: 0.5,
};
const spec = (kind: VisualKind, src: number, dst: number, extra?: Partial<VisualSpec>): VisualSpec => ({ kind, src, dst, dur: DUR[kind], ...extra });

/** The visual for one fx event, or null (Plan 3's arrows, slashes and numbers stay with effects.ts). Never throws. */
export function spellVisualFor(ev: FxEvent): VisualSpec | null {
  switch (ev.t) {
    case 'hit': {
      const by = ev.by as string;
      const ability = has(ABILITIES, by) ? ABILITIES[by as AbilityId] : null;
      const big = !!ability && (ability.role === 'finisher' || ability.role === 'signature');
      if (ev.element !== undefined) {
        if (!isElement(ev.element)) return spec('generic', ev.src, ev.dst);
        return spec(ev.element, ev.src, ev.dst, { big, ability: ability ? (by as AbilityId) : undefined });
      }
      if (ability) return ability.school === 'light' ? spec('light', ev.src, ev.dst, { big, ability: by as AbilityId }) : null;
      if (by === 'auto' || by === 'burning' || has(ENEMY_ATTACKS, by)) return null;
      return spec('generic', ev.src, ev.dst); // a field (Plan 4), or an id this client does not know
    }
    case 'react': {
      const r = ev.reaction as string;
      if (r === 'blast' || r === 'conduct' || r === 'steam' || r === 'bedrock') return spec(r, ev.src, ev.dst, { big: true });
      return spec('generic', ev.src, ev.dst, { big: true });
    }
    case 'buff': {
      if (!ev.on) return null;
      const b = ev.buff as string;
      // an ally's Soft Rain is a short flash over them: only the White Mage's own holds its slot for the buff's time
      if (b === 'rain' && ev.src !== ev.dst) return spec('rain', ev.src, ev.dst, { dur: 0.4 });
      if (has(BUFF_BITS, b) || has(DEBUFF_BITS, b)) return spec(b as VisualKind, ev.src, ev.dst);
      return spec('generic', ev.src, ev.dst);
    }
    case 'heal': return ev.amount > 0 ? spec('heal', ev.src, ev.dst, { big: ev.amount >= 20 }) : null;
    case 'shield': return ev.amount > 0 ? spec('shield', ev.src, ev.dst) : null;
    case 'gift': return spec('gift', ev.src, ev.dst);
    case 'revive': return spec('revive', ev.src, ev.dst, { big: true });
    case 'castEnd': return ev.ok ? null : spec('fizzle', ev.src, ev.src);
    case 'use': {
      const id = ev.ability as string;
      if (!has(ABILITIES, id)) return spec('generic', ev.src, ev.dst ?? ev.src);
      if (id === 'taunt' || id === 'dread_howl') return spec('taunt', ev.src, ev.dst ?? -1);
      if (id === 'ashcloud') return spec('ashcloud', ev.src, ev.src);
      return null;
    }
    default: return null;
  }
}

/** The colour family of a cast (its ground ring), from its ability: an element, Light, or 'arcane' for the rest. */
export function castTone(id: AbilityId | string): Tone {
  const a = has(ABILITIES, id) ? ABILITIES[id as AbilityId] : null;
  if (!a) return 'arcane';
  return a.element ?? (a.school === 'light' ? 'light' : 'arcane');
}

/** The staff's tint for a job (the two mages), else undefined. */
export function staffTint(job: JobId | string): 'white' | 'black' | undefined {
  return job === 'white_mage' ? 'white' : job === 'black_mage' ? 'black' : undefined;
}

type Cat = 'burst' | 'rain' | 'cage' | 'motes';
const CAPS: Record<Quality, Record<Cat, number>> = {
  low: { burst: 6, rain: 0, cage: 0, motes: 3 },
  med: { burst: 14, rain: 26, cage: 6, motes: 6 },
  high: { burst: 22, rain: 40, cage: 8, motes: 9 },
};
/** How many particles of a kind a visual may draw on a quality tier (low: no rain streaks, no crackle cage). */
export function particleCap(q: Quality, cat: Cat): number { return CAPS[q][cat]; }

/** One live visual: what it is, when it began and where its ends were last seen. */
export interface Visual extends VisualSpec {
  on: boolean;
  t: number;
  /** When it was added (the pool's clock): the oldest is recycled first. */
  born: number;
  seed: number;
  /** Last known feet position and height of src (a) and dst (b). */
  ax: number; ay: number; az: number; ah: number;
  bx: number; by: number; bz: number; bh: number;
}

/** A fixed pool of MAX_LIVE visuals: adding to a full pool recycles the oldest. Allocates only when built. */
export class VisualPool {
  readonly slots: Visual[] = [];
  private seq = 0;
  constructor() {
    for (let i = 0; i < MAX_LIVE; i++) {
      this.slots.push({ kind: 'generic', src: -1, dst: -1, dur: 0, on: false, t: 0, born: 0, seed: 0, ax: 0, ay: 0, az: 0, ah: 1.8, bx: 0, by: 0, bz: 0, bh: 1.8 });
    }
  }
  get live(): number { let n = 0; for (const s of this.slots) if (s.on) n++; return n; }
  add(sp: VisualSpec, now: number): Visual {
    let v: Visual | null = null;
    for (const s of this.slots) if (!s.on) { v = s; break; }
    // full: the oldest that is not big (a reaction or a revive is the visual that must not be lost), or the
    // oldest of all when every slot is big
    if (!v) for (const s of this.slots) if (!s.big && (!v || s.born < v.born)) v = s;
    if (!v) { v = this.slots[0]; for (const s of this.slots) if (s.born < v.born) v = s; }
    v.kind = sp.kind; v.src = sp.src; v.dst = sp.dst; v.dur = sp.dur; v.big = sp.big; v.ability = sp.ability; v.tint = sp.tint;
    v.on = true; v.t = 0; v.born = now; v.seed = (this.seq = (this.seq + 1) % 9973) * 0.6180339 + 0.37;
    return v;
  }
  step(dt: number): void { for (const s of this.slots) if (s.on && (s.t += dt) >= s.dur) s.on = false; }
  clear(): void { for (const s of this.slots) s.on = false; }
}

// ───────────────────────── colours ─────────────────────────
type RGB = readonly [number, number, number];
const rgb = (h: string): RGB => { const c = Color3.FromHexString(h); return [c.r, c.g, c.b]; };
const lerpC = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const COL = {
  fire: rgb(PALETTE.roof), fireHot: rgb('#ffd27a'), fireCore: rgb('#fff3d6'),
  water: rgb(PALETTE.teal), waterLight: rgb('#9ff0e6'), waterCore: rgb('#e6fffb'),
  bolt: rgb(PALETTE.gold), boltCore: rgb('#fffbe6'), boltBlue: rgb('#bfe6ff'),
  earth: rgb('#6e4f3c'), earthLight: rgb('#a8876a'), dust: lerpC(rgb(PALETTE.stone), rgb(PALETTE.cliff), 0.25),
  light: rgb(PALETTE.cloud), lightGold: rgb('#ffe9a8'),
  heal: rgb(PALETTE.meadow), healGold: rgb('#ffe9a0'),
  shield: rgb('#7fd8ff'), gold: rgb(PALETTE.gold), crimson: rgb('#d0283c'), crimsonLight: rgb('#ff6a7a'),
  grey: rgb('#8a8796'), smoke: rgb('#4a4458'), white: rgb('#ffffff'), red: rgb('#ff3b2e'),
  violet: rgb('#b46cff'), ember: rgb('#ff7a3a'), tealWhite: rgb('#c8fff6'),
};
const TONE: Record<Tone, { c: RGB; hot: RGB }> = {
  fire: { c: COL.fire, hot: COL.fireHot }, water: { c: COL.water, hot: COL.waterLight }, lightning: { c: COL.bolt, hot: COL.boltCore },
  earth: { c: COL.earth, hot: COL.earthLight }, light: { c: COL.lightGold, hot: COL.light }, arcane: { c: COL.violet, hot: COL.tealWhite },
};

// ───────────────────────── helpers ─────────────────────────
const fract = (x: number) => x - Math.floor(x);
/** A stable pseudo-random number in [0, 1) for (seed, i). */
const rnd = (seed: number, i: number) => fract(Math.sin(seed * 127.1 + i * 311.7) * 43758.5453);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut = (x: number) => 1 - (1 - x) * (1 - x);
/** 0 → 1 over [a, b], then held. */
const ramp = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
/** Up over `fin`, down over the last `fout` of `dur`. */
const env = (t: number, dur: number, fin: number, fout: number) => Math.min(clamp01(t / fin), clamp01((dur - t) / fout));

/** One instanced mesh drawn in a single call: its matrices and colours are rewritten every frame. */
class Batch {
  readonly mats: Float32Array;
  readonly cols: Float32Array;
  n = 0;
  constructor(readonly mesh: Mesh, readonly cap: number) {
    this.mats = new Float32Array(cap * 16);
    this.cols = new Float32Array(cap * 4);
    mesh.thinInstanceSetBuffer('matrix', this.mats, 16, false);
    mesh.thinInstanceSetBuffer('color', this.cols, 4, false);
    mesh.thinInstanceCount = 0;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    mesh.hasVertexAlpha = true;
    mesh.alphaIndex = 500;      // before the telegraphs (1000): danger decals always draw over spells
    mesh.setEnabled(false);
  }
  /** A slot for one instance (its index), or -1 when full. */
  private take(r: number, g: number, b: number, a: number): number {
    if (this.n >= this.cap || a <= 0.004) return -1;
    const i = this.n++, c = i * 4;
    this.cols[c] = r; this.cols[c + 1] = g; this.cols[c + 2] = b; this.cols[c + 3] = a;
    return i * 16;
  }
  /** An instance with the axes X, Y, Z (scaled) at (x, y, z). */
  basis(xx: number, xy: number, xz: number, yx: number, yy: number, yz: number, zx: number, zy: number, zz: number, x: number, y: number, z: number, c: RGB, a: number): void {
    const o = this.take(c[0], c[1], c[2], a);
    if (o < 0) return;
    const m = this.mats;
    m[o] = xx; m[o + 1] = xy; m[o + 2] = xz; m[o + 3] = 0;
    m[o + 4] = yx; m[o + 5] = yy; m[o + 6] = yz; m[o + 7] = 0;
    m[o + 8] = zx; m[o + 9] = zy; m[o + 10] = zz; m[o + 11] = 0;
    m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
  }
  /** Scaled (sx, sy, sz), turned `yaw` about Y and tipped `tilt` toward its yaw, at (x, y, z). */
  put(x: number, y: number, z: number, sx: number, sy: number, sz: number, c: RGB, a: number, yaw = 0, tilt = 0): void {
    const cy = Math.cos(yaw), sy0 = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
    // Y tipped toward the yaw direction, X horizontal across it, Z = X × Y (keeps the winding)
    const ux = sy0 * st, uy = ct, uz = cy * st;
    const xx = cy, xz = -sy0;
    const zx = -xz * uy, zy = xz * ux - xx * uz, zz = xx * uy;
    this.basis(xx * sx, 0, xz * sx, ux * sy, uy * sy, uz * sy, zx * sz, zy * sz, zz * sz, x, y, z, c, a);
  }
  /** Uniformly scaled at (x, y, z). */
  dot(x: number, y: number, z: number, s: number, c: RGB, a: number): void {
    this.basis(s, 0, 0, 0, s, 0, 0, 0, s, x, y, z, c, a);
  }
  /** A segment from a to b, `w` wide (the mesh's Y runs 0 → 1 along it). */
  seg(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, c: RGB, a: number): void {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    dx /= len; dy /= len; dz /= len;
    // X = normalise(d × up) (or d × right when d is vertical); Z = X × d
    let xx = dy * 0 - dz * 1, xy = dz * 0 - dx * 0, xz = dx * 1 - dy * 0;
    let xl = Math.hypot(xx, xy, xz);
    if (xl < 1e-3) { xx = 0; xy = dz; xz = -dy; xl = Math.hypot(xx, xy, xz); }
    xx /= xl; xy /= xl; xz /= xl;
    const zx = xy * dz - xz * dy, zy = xz * dx - xx * dz, zz = xx * dy - xy * dx;
    this.basis(xx * w, xy * w, xz * w, dx * len, dy * len, dz * len, zx * w, zy * w, zz * w, ax, ay, az, c, a);
  }
  begin(): void { this.n = 0; }
  end(): void {
    this.mesh.thinInstanceCount = this.n;
    if (this.n > 0) {
      this.mesh.thinInstanceBufferUpdated('matrix');
      this.mesh.thinInstanceBufferUpdated('color');
    }
    if (this.mesh.isEnabled() !== this.n > 0) this.mesh.setEnabled(this.n > 0);
  }
}

// ───────────────────────── meshes ─────────────────────────
function ringMesh(scene: Scene): Mesh {
  // a flat annulus (inner 0.82, outer 1) on the ground, brighter at its outer edge
  const pos: number[] = [], col: number[] = [], idx: number[] = [], N = 40;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    pos.push(c * 0.86, 0, s * 0.86, c, 0, s);
    col.push(1, 1, 1, 0.25, 1, 1, 1, 1);
    if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const m = new Mesh('spellRing', scene);
  const vd = new VertexData(); vd.positions = pos; vd.colors = col; vd.indices = idx; vd.applyToMesh(m);
  return m;
}
function shellMesh(scene: Scene): Mesh {
  // a faceted bubble: each face of an icosphere is a fan to its centre, bright at the edges and faint inside, so the
  // shield reads as a lattice of facets
  const src = MeshBuilder.CreateIcoSphere('shellSrc', { radius: 1, subdivisions: 2, flat: true }, scene);
  const p = src.getVerticesData('position')!, ind = src.getIndices()!;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (let f = 0; f < ind.length; f += 3) {
    const a = ind[f] * 3, b = ind[f + 1] * 3, c = ind[f + 2] * 3;
    const cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    const k = pos.length / 3;
    pos.push(p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2], cx, cy, cz);
    col.push(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.12);
    idx.push(k, k + 1, k + 3, k + 1, k + 2, k + 3, k + 2, k, k + 3);
  }
  src.dispose();
  const m = new Mesh('spellShell', scene);
  const vd = new VertexData(); vd.positions = pos; vd.colors = col; vd.indices = idx; vd.applyToMesh(m);
  return m;
}

const glowMat = (scene: Scene, name: string): StandardMaterial => {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true; m.emissiveColor = Color3.White(); m.diffuseColor = Color3.Black(); m.specularColor = Color3.Black();
  // plain alpha blending, not additive: added light turns reds and blues yellow-white over the bright grass, and the
  // element colours must stay true
  m.alphaMode = Constants.ALPHA_COMBINE; m.disableDepthWrite = true; m.backFaceCulling = false; m.fogEnabled = false;
  return m;
};
const solidMat = (scene: Scene, name: string, glow: number): StandardMaterial => {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.White(); m.specularColor = Color3.Black(); m.emissiveColor = new Color3(glow, glow, glow);
  // no depth writes: rocks and puffs draw before the telegraphs (alphaIndex 500 < 1000), and a depth write would
  // punch their shape out of a danger decal drawn after them
  m.disableDepthWrite = true; m.backFaceCulling = true;
  return m;
};

/** Where an entity stands now (feet) and how tall it is, written into `out`; false when it is not in view. */
export type Locate = (eid: number, out: { x: number; y: number; z: number; h: number }) => boolean;

export interface Spells {
  /** Starts a visual from a spec (a fx event's, or one effects.ts makes). */
  play(sp: VisualSpec): void;
  /** Call once per frame before the state-driven draws below. */
  begin(): void;
  /** The ground ring and motes under someone casting (t: seconds into the cast). */
  caster(x: number, y: number, z: number, tone: Tone, t: number): void;
  /** A shield's faceted bubble around someone. */
  shield(x: number, y: number, z: number, h: number, t: number): void;
  /** Aegis: the gold half-dome on the Paladin (dome) or a sigil at an ally's feet. */
  aegis(x: number, y: number, z: number, dome: boolean, t: number): void;
  /** Shelter's gold tether from the Paladin to the ally. */
  tether(ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number): void;
  /** Lasting buffs on an adventurer (BUFF_BITS): roar, pact, bloodbond. */
  aura(x: number, y: number, z: number, h: number, bits: number, t: number): void;
  /** Marks (MARK_BITS) and debuffs (DEBUFF_BITS) on an enemy, drawn on its body in the element's look. */
  enemy(x: number, y: number, z: number, h: number, marks: number, debuffs: number, t: number): void;
  /** Steps and draws the pooled visuals, then uploads everything (call after the state-driven draws). */
  update(dt: number): void;
  /** Drops every live visual (a zone change). */
  clear(): void;
  readonly live: number;
  /** Instances drawn last frame (diagnostics). */
  readonly drawn: number;
  /** The kinds of the live visuals (diagnostics for browser checks; allocates). */
  kinds(): string[];
  /**
   * How fast pooled visuals play (1: as designed). Browser checks at about 1 fps set it low so that a reaction or a
   * revive is still on screen for a screenshot; nothing in the game changes it.
   */
  timeScale: number;
  dispose(): void;
}

export function createSpells(scene: Scene, o: { quality: () => Quality; locate: Locate }): Spells {
  const pool = new VisualPool();
  // ── the six batches ──
  const add = glowMat(scene, 'spellGlowMat');
  const gemSrc = MeshBuilder.CreateIcoSphere('spellGem', { radius: 0.5, subdivisions: 1, flat: true }, scene);
  gemSrc.material = add;
  const ringSrc = ringMesh(scene); ringSrc.material = add;
  const beamSrc = MeshBuilder.CreateCylinder('spellBeam', { height: 1, diameter: 1, tessellation: 8, cap: Mesh.NO_CAP }, scene);
  beamSrc.position.y = 0.5; beamSrc.bakeCurrentTransformIntoVertices(); beamSrc.material = add;
  const shellSrc = shellMesh(scene); shellSrc.material = add;
  const rockMat = solidMat(scene, 'spellRockMat', 0.12);
  const rockSrc = MeshBuilder.CreateCylinder('spellRock', { height: 1, diameterTop: 0.08, diameterBottom: 0.75, tessellation: 5 }, scene);
  rockSrc.position.y = 0.5; rockSrc.bakeCurrentTransformIntoVertices(); rockSrc.convertToFlatShadedMesh(); rockSrc.material = rockMat;
  const puffMat = solidMat(scene, 'spellPuffMat', 0.45);
  const puffSrc = MeshBuilder.CreateIcoSphere('spellPuff', { radius: 0.5, subdivisions: 1, flat: true }, scene);
  puffSrc.material = puffMat;
  const gem = new Batch(gemSrc, 480), ring = new Batch(ringSrc, 96), beam = new Batch(beamSrc, 320);
  const shell = new Batch(shellSrc, 32), rock = new Batch(rockSrc, 128), puff = new Batch(puffSrc, 128);
  const batches = [gem, ring, beam, shell, rock, puff];
  let drawn = 0;

  const A = { x: 0, y: 0, z: 0, h: 1.8 }, B = { x: 0, y: 0, z: 0, h: 1.8 };
  /** Updates a visual's ends from where they stand now (kept as last seen when they leave the view). */
  const track = (v: Visual) => {
    if (v.src >= 0 && o.locate(v.src, A)) { v.ax = A.x; v.ay = A.y; v.az = A.z; v.ah = A.h; }
    if (v.dst >= 0 && o.locate(v.dst, B)) { v.bx = B.x; v.by = B.y; v.bz = B.z; v.bh = B.h; }
  };

  // ── building blocks ──
  /** An expanding ground ring. */
  const shock = (x: number, y: number, z: number, r: number, c: RGB, a: number) => ring.put(x, y + 0.08, z, r, 1, r, c, a);
  /** A burst of `n` sparks flying out of (x, y, z) at `speed`, falling, over `life` s from t0. */
  const sparks = (v: Visual, x: number, y: number, z: number, t: number, n: number, speed: number, up: number, size: number, c: RGB, hot: RGB, life: number, salt: number) => {
    if (t < 0 || t > life) return;
    const k = t / life;
    for (let i = 0; i < n; i++) {
      const r1 = rnd(v.seed + salt, i), r2 = rnd(v.seed + salt, i + 50), r3 = rnd(v.seed + salt, i + 100);
      const ang = r1 * Math.PI * 2, sp = speed * (0.55 + 0.45 * r2), vy = up * (0.4 + 0.8 * r3);
      const px = x + Math.cos(ang) * sp * t, pz = z + Math.sin(ang) * sp * t, py = y + vy * t - 4.5 * t * t;
      gem.dot(px, Math.max(y - 0.3, py), pz, size * (1 - 0.6 * k), lerpC(hot, c, k), 1 - k * k);
    }
  };
  /** A flash: a bright orb growing and fading fast. */
  const flash = (x: number, y: number, z: number, t: number, size: number, life: number, c: RGB, a = 1) => {
    if (t < 0 || t > life) return;
    const k = t / life;
    gem.dot(x, y, z, size * (0.4 + 0.8 * easeOut(k)), c, a * (1 - k));
  };
  /** A jagged bolt from a to b in `n` segments, re-drawn every 1/15 s. */
  const bolt = (seed: number, t: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, n: number, jag: number, w: number, c: RGB, core: RGB, a: number) => {
    const step = Math.floor(t * 15);
    let px = ax, py = ay, pz = az;
    for (let i = 1; i <= n; i++) {
      const k = i / n, j = i === n ? 0 : jag;
      const qx = ax + (bx - ax) * k + (rnd(seed + step, i) - 0.5) * 2 * j;
      const qy = ay + (by - ay) * k + (rnd(seed + step, i + 20) - 0.5) * j;
      const qz = az + (bz - az) * k + (rnd(seed + step, i + 40) - 0.5) * 2 * j;
      beam.seg(px, py, pz, qx, qy, qz, w * 3, c, a * 0.35);
      beam.seg(px, py, pz, qx, qy, qz, w, core, a);
      px = qx; py = qy; pz = qz;
    }
  };
  /** A projectile from the caster's hand to the target's chest at `speed`; returns its flight time. */
  const flight = (v: Visual, speed: number) => Math.max(0.08, Math.hypot(v.bx - v.ax, v.bz - v.az, (v.by + v.bh * 0.55) - (v.ay + v.ah * 0.75)) / speed);

  // ── one visual, at time v.t ──
  const draw = (v: Visual, q: Quality) => {
    const t = v.t, big = !!v.big, s = big ? 1.35 : 1;
    const burst = particleCap(q, 'burst'), motes = particleCap(q, 'motes');
    const hx = v.ax, hy = v.ay + v.ah * 0.75, hz = v.az;            // the caster's hands
    const cx = v.bx, cy = v.by + v.bh * 0.55, cz = v.bz;            // the target's chest
    switch (v.kind) {
      case 'fire': {
        if (v.ability === 'hearthfall') {
          // a falling star of fire onto the target, then a wide burst
          const fall = 0.45;
          if (t < fall) {
            const k = easeOut(t / fall), sx = cx - 3, sy = cy + 11, sz = cz - 2;
            const px = sx + (cx - sx) * k, py = sy + (cy - sy) * k, pz = sz + (cz - sz) * k;
            gem.dot(px, py, pz, 0.9, COL.fireCore, 1); gem.dot(px, py, pz, 1.5, COL.fire, 0.75);
            for (let i = 1; i <= 6; i++) { const kk = Math.max(0, k - i * 0.05); gem.dot(sx + (cx - sx) * kk, sy + (cy - sy) * kk, sz + (cz - sz) * kk, 1.1 - i * 0.14, COL.ember, 0.6 - i * 0.08); }
          } else {
            const u = t - fall;
            flash(cx, cy, cz, u, 2.6, 0.4, COL.fireHot);
            shock(v.bx, v.by, v.bz, 0.5 + 4 * easeOut(clamp01(u / 0.5)), COL.fire, 1 - clamp01(u / 0.6));
            sparks(v, cx, cy - 0.4, cz, u, burst, 6, 5, 0.32, COL.fire, COL.fireHot, 0.6, 1);
          }
          v.dur = Math.max(v.dur, fall + 0.65);
          break;
        }
        const fl = flight(v, 20);
        v.dur = Math.max(v.dur, fl + 0.5);
        if (t < fl) {
          const k = t / fl, lift = Math.sin(k * Math.PI) * 0.6;
          const px = hx + (cx - hx) * k, py = hy + (cy - hy) * k + lift, pz = hz + (cz - hz) * k;
          gem.dot(px, py, pz, 0.32 * s, COL.fireCore, 1);
          gem.dot(px, py, pz, 0.6 * s, COL.fire, 0.7);
          for (let i = 1; i <= 4; i++) {   // the short trail
            const kk = Math.max(0, k - i * 0.06);
            gem.dot(hx + (cx - hx) * kk, hy + (cy - hy) * kk + Math.sin(kk * Math.PI) * 0.6, hz + (cz - hz) * kk, (0.42 - i * 0.07) * s, COL.ember, 0.55 - i * 0.11);
          }
        } else {
          const u = t - fl;
          flash(cx, cy, cz, u, 1.1 * s, 0.3, COL.fireHot);
          sparks(v, cx, cy, cz, u, Math.round(burst * 0.6), 3.2 * s, 3, 0.18 * s, COL.fire, COL.fireHot, 0.45, 2);
          shock(v.bx, v.by, v.bz, 0.3 + 1.2 * s * easeOut(clamp01(u / 0.35)), COL.fire, 0.8 * (1 - clamp01(u / 0.45)));
        }
        break;
      }
      case 'water': {
        const fl = flight(v, 22);
        v.dur = Math.max(v.dur, fl + 0.55);
        if (t < fl) {
          // a ribbon of three droplets, weaving, stretched along their flight
          const dx = cx - hx, dy = cy - hy, dz = cz - hz, L = Math.max(0.01, Math.hypot(dx, dy, dz));
          for (let i = 0; i < 3; i++) {
            const k = clamp01(t / fl - i * 0.09);
            if (k <= 0) continue;
            const w = Math.sin(k * Math.PI * 2 + i * 2.1) * 0.25 * (1 - k);
            const px = hx + dx * k - (dz / L) * w, py = hy + dy * k + Math.sin(k * Math.PI) * 0.4, pz = hz + dz * k + (dx / L) * w;
            beam.seg(px - dx / L * 0.35 * s, py - dy / L * 0.35 * s, pz - dz / L * 0.35 * s, px, py, pz, 0.16 * s, COL.water, 0.6);
            gem.dot(px, py, pz, (0.3 - i * 0.05) * s, i === 0 ? COL.waterCore : COL.waterLight, 0.95);
          }
        } else {
          const u = t - fl;
          flash(cx, cy, cz, u, 0.9 * s, 0.25, COL.waterCore, 0.8);
          shock(v.bx, v.by, v.bz, 0.4 + 1.3 * s * easeOut(clamp01(u / 0.45)), COL.water, 0.9 * (1 - clamp01(u / 0.5)));
          shock(v.bx, v.by, v.bz, 0.2 + 0.8 * s * easeOut(clamp01((u - 0.12) / 0.4)), COL.waterLight, 0.7 * (1 - clamp01((u - 0.1) / 0.45)));
          sparks(v, cx, cy, cz, u, Math.round(burst * 0.6), 2.4 * s, 4, 0.15 * s, COL.water, COL.waterCore, 0.5, 3);
        }
        break;
      }
      case 'lightning': {
        // a jagged six-segment bolt from the sky onto the target, then a flash
        const top = v.by + v.bh + 7;
        if (t < 0.15) {
          const ox = (rnd(v.seed, 1) - 0.5) * 3, oz = (rnd(v.seed, 2) - 0.5) * 3;
          bolt(v.seed, t, cx + ox, top, cz + oz, cx, cy, cz, 6, 0.55, 0.07 * s, COL.bolt, COL.boltCore, 1);
          if (big) bolt(v.seed + 7, t, cx - ox * 0.7, top + 1, cz - oz * 0.7, cx, cy, cz, 6, 0.6, 0.05, COL.bolt, COL.boltCore, 0.8);
        }
        flash(cx, cy, cz, t - 0.1, 1.8 * s, 0.32, COL.boltCore);
        shock(v.bx, v.by, v.bz, 0.4 + 1.4 * s * easeOut(clamp01((t - 0.1) / 0.3)), COL.bolt, 1 - clamp01((t - 0.1) / 0.38));
        sparks(v, cx, cy, cz, t - 0.12, Math.round(burst * 0.5), 4 * s, 2, 0.1, COL.bolt, COL.boltCore, 0.3, 4);
        break;
      }
      case 'earth': {
        // three rock shards bursting up under the target, and dust
        for (let i = 0; i < 3; i++) {
          const a = v.seed * 6 + i * 2.09, r = 0.45 + 0.25 * rnd(v.seed, i);
          const up = easeOut(ramp(t, i * 0.05, i * 0.05 + 0.16)), down = ramp(t, 0.55, 0.9);
          const hgt = (0.9 + 0.5 * rnd(v.seed, i + 9)) * s * up * (1 - down);
          if (hgt > 0.02) rock.put(v.bx + Math.cos(a) * r, v.by - 0.15, v.bz + Math.sin(a) * r, 0.75 * s, hgt, 0.75 * s, i === 1 ? COL.earthLight : COL.earth, 1, a, 0.35);
        }
        for (let i = 0; i < Math.min(5, burst); i++) {
          const a = i * 1.26 + v.seed, k = clamp01(t / 0.8);
          puff.dot(v.bx + Math.cos(a) * (0.6 + 1.1 * k), v.by + 0.2 + 0.5 * k, v.bz + Math.sin(a) * (0.6 + 1.1 * k), (0.35 + 0.5 * k) * s, COL.dust, 0.7 * (1 - k));
        }
        shock(v.bx, v.by, v.bz, 0.5 + 1.2 * s * easeOut(clamp01(t / 0.4)), COL.earthLight, 0.6 * (1 - clamp01(t / 0.5)));
        break;
      }
      case 'light': {
        // a white-gold beam from the staff head to the target
        const sx = hx, sy = v.ay + v.ah + 0.15, sz = hz, a = 1 - clamp01((t - 0.12) / 0.3);
        const w = (v.ability === 'lantern_flare' ? 0.22 : 0.12) * s;
        beam.seg(sx, sy, sz, cx, cy, cz, w * 3.2, COL.lightGold, 0.35 * a);
        beam.seg(sx, sy, sz, cx, cy, cz, w, COL.light, a);
        flash(sx, sy, sz, t, 0.7, 0.25, COL.light);
        flash(cx, cy, cz, t - 0.05, 1.3 * s, 0.4, COL.lightGold);
        shock(v.bx, v.by, v.bz, 0.4 + 1.1 * s * easeOut(clamp01(t / 0.4)), COL.lightGold, 0.8 * (1 - clamp01(t / 0.5)));
        for (let i = 0; i < motes; i++) {
          const k = clamp01((t - 0.05) / 0.5), a2 = i * 2.4 + v.seed;
          gem.dot(cx + Math.cos(a2) * 0.7 * k, cy + 1.2 * k, cz + Math.sin(a2) * 0.7 * k, 0.1, COL.light, 1 - k);
        }
        break;
      }
      case 'staffBolt': {
        const fl = flight(v, 24);
        v.dur = Math.max(v.dur, fl + 0.2);
        const c = v.tint === 'black' ? COL.violet : COL.tealWhite, hot = v.tint === 'black' ? COL.fireHot : COL.white;
        if (t < fl) {
          const k = t / fl, px = hx + (cx - hx) * k, py = v.ay + v.ah + (cy - v.ay - v.ah) * k, pz = hz + (cz - hz) * k;
          gem.dot(px, py, pz, 0.2, hot, 1); gem.dot(px, py, pz, 0.38, c, 0.6);
          const kk = Math.max(0, k - 0.08);
          gem.dot(hx + (cx - hx) * kk, v.ay + v.ah + (cy - v.ay - v.ah) * kk, hz + (cz - hz) * kk, 0.22, c, 0.4);
        } else flash(cx, cy, cz, t - fl, 0.7, 0.2, c);
        break;
      }
      case 'heal': {
        // green-gold motes rising round the healed, and a soft ring at their feet
        const n = big ? motes + 3 : Math.max(2, Math.round(motes * 0.6));
        for (let i = 0; i < n; i++) {
          const d = rnd(v.seed, i) * 0.35, k = clamp01((t - d) / 0.85);
          if (k <= 0 || k >= 1) continue;
          const a = i * 2.39996 + k * 3, r = 0.45 + 0.15 * rnd(v.seed, i + 5);
          gem.dot(v.bx + Math.cos(a) * r, v.by + 0.2 + k * (v.bh + 0.4), v.bz + Math.sin(a) * r, (big ? 0.26 : 0.18) * (1 - k * 0.4), i % 2 ? COL.healGold : COL.heal, Math.min(1, 1.4 * Math.sin(k * Math.PI)));
        }
        if (big) {
          // a soft green column round the healed, and a ring at their feet
          const a = env(t, v.dur, 0.12, 0.6);
          beam.put(v.bx, v.by, v.bz, 1.3, v.bh + 0.8, 1.3, COL.heal, 0.3 * a);
          shock(v.bx, v.by, v.bz, 0.6 + 0.6 * easeOut(clamp01(t / 0.5)), COL.heal, 0.9 * (1 - clamp01(t / 0.9)));
        }
        break;
      }
      case 'shield': {
        const k = clamp01(t / 0.3), sc = 1.15 * (0.4 + 0.6 * easeOut(k)) + 0.1 * Math.sin(k * Math.PI);
        shell.dot(v.bx, v.by + v.bh * 0.5, v.bz, sc * v.bh * 0.62, COL.shield, 0.9 * (1 - clamp01((t - 0.15) / 0.3)));
        break;
      }
      case 'roar': {
        if (v.src === v.dst) {
          // a ring shockwave out to 10 m from the Warrior
          for (let i = 0; i < 2; i++) {
            const u = t - i * 0.12, k = clamp01(u / 0.6);
            if (u > 0) shock(v.ax, v.ay, v.az, 0.5 + 9.5 * easeOut(k), i ? COL.gold : COL.ember, (i ? 0.7 : 1) * (1 - k));
          }
          flash(v.ax, v.ay + v.ah * 0.8, v.az, t, 1.6, 0.3, COL.fireHot);
          sparks(v, v.ax, v.ay + v.ah, v.az, t, Math.round(burst * 0.6), 2, 5, 0.16, COL.ember, COL.fireHot, 0.6, 5);
        } else for (let i = 0; i < 3; i++) {
          const k = clamp01((t - i * 0.08) / 0.5);
          if (k > 0 && k < 1) gem.put(v.bx + (i - 1) * 0.25, v.by + v.bh * 0.6 + k * 1.2, v.bz, 0.14, 0.3, 0.14, COL.fireHot, 1 - k);
        }
        break;
      }
      case 'aegis': {
        const k = clamp01(t / 0.35);
        shell.dot(v.bx, v.by, v.bz, 1.7 * (0.5 + 0.5 * easeOut(k)), COL.gold, 1 - clamp01((t - 0.2) / 0.3));
        shock(v.bx, v.by, v.bz, 0.5 + 7.5 * easeOut(k), COL.gold, 0.6 * (1 - k));
        break;
      }
      case 'aegis_ally': {
        const k = clamp01(t / 0.4);
        shock(v.bx, v.by, v.bz, 1.2 - 0.5 * easeOut(k), COL.gold, 1 - clamp01((t - 0.25) / 0.25));
        flash(v.bx, v.by + v.bh + 0.3, v.bz, t, 0.6, 0.4, COL.gold);
        break;
      }
      case 'sheltered': {
        const a = 1 - clamp01(t / v.dur);
        beam.seg(v.ax, v.ay + v.ah * 0.6, v.az, v.bx, v.by + v.bh * 0.6, v.bz, 0.22, COL.gold, 0.8 * a);
        flash(v.bx, v.by + v.bh * 0.6, v.bz, t, 1.0, 0.4, COL.gold);
        break;
      }
      case 'rain': {
        if (v.src !== v.dst) { flash(v.bx, v.by + v.bh + 0.2, v.bz, t, 0.4, 0.4, COL.waterLight); break; }
        // soft falling streaks within 10 m of the White Mage, for the buff's time
        const n = particleCap(q, 'rain'), fade = env(t, v.dur, 0.5, 0.8);
        for (let i = 0; i < n; i++) {
          const a = rnd(v.seed, i) * Math.PI * 2, r = Math.sqrt(rnd(v.seed, i + 77)) * 10;
          const per = 0.7 + 0.3 * rnd(v.seed, i + 33), ph = fract(t / per + rnd(v.seed, i + 11));
          const x = v.ax + Math.cos(a) * r, z = v.az + Math.sin(a) * r, y = v.ay + 6 - ph * 6;
          beam.seg(x, y, z, x + 0.05, y + 0.7, z, 0.035, COL.waterLight, 0.55 * fade);
          if (ph > 0.92) shock(x, v.ay, z, 0.15 + (ph - 0.92) * 3, COL.water, 0.6 * fade);
        }
        if (t < 0.8) shock(v.ax, v.ay, v.az, 1 + 9 * easeOut(t / 0.8), COL.water, 0.5 * (1 - t / 0.8));
        break;
      }
      case 'mist': {
        for (let i = 0; i < 5; i++) {
          const a = i * 1.26 + v.seed, k = clamp01(t / v.dur);
          puff.dot(v.bx + Math.cos(a) * (0.4 + 0.6 * k), v.by + 0.4 + i * 0.25, v.bz + Math.sin(a) * (0.4 + 0.6 * k), 0.5 + 0.5 * k, COL.grey, 0.6 * (1 - k));
        }
        break;
      }
      case 'pact': case 'bloodbond': {
        const k = clamp01(t / v.dur);
        for (let i = 0; i < 8; i++) {
          const a = i * 0.785 + k * 4, r = 1.1 * (1 - k) + 0.3;
          gem.dot(v.bx + Math.cos(a) * r, v.by + 0.3 + k * v.bh, v.bz + Math.sin(a) * r, 0.14, i % 2 ? COL.crimsonLight : COL.crimson, 1 - k);
        }
        shock(v.bx, v.by, v.bz, 0.5 + 0.8 * easeOut(k), COL.crimson, 0.9 * (1 - k));
        break;
      }
      case 'blinded': {
        for (let i = 0; i < 6; i++) {
          const a = i * 1.05 + v.seed, k = clamp01(t / v.dur);
          puff.dot(v.bx + Math.cos(a) * 0.5 * (1 + k), v.by + v.bh * 0.85 + 0.3 * k, v.bz + Math.sin(a) * 0.5 * (1 + k), 0.45 + 0.4 * k, COL.smoke, 0.75 * (1 - k));
        }
        break;
      }
      case 'weakpoint': {
        const k = clamp01(t / v.dur);
        gem.put(v.bx, v.by + v.bh + 0.6, v.bz, 0.7 * (1 - k) + 0.3, 1.1 * (1 - k) + 0.45, 0.7 * (1 - k) + 0.3, COL.red, 1 - k, t * 6);
        break;
      }
      case 'gift': {
        // a spark arcing from the caster to the ally
        const fl = 0.6;
        if (t < fl) {
          const k = t / fl;
          for (let i = 0; i < 5; i++) {
            const kk = Math.max(0, k - i * 0.05);
            gem.dot(hx + (v.bx - hx) * kk, hy + (v.by + v.bh * 0.6 - hy) * kk + Math.sin(kk * Math.PI) * 2.5, hz + (v.bz - hz) * kk, (0.42 - i * 0.07), i ? COL.gold : COL.white, 1 - i * 0.18);
          }
        } else {
          const u = t - fl;
          flash(v.bx, v.by + v.bh * 0.6, v.bz, u, 1.2, 0.3, COL.gold);
          sparks(v, v.bx, v.by + v.bh * 0.6, v.bz, u, Math.round(burst * 0.5), 2.5, 3, 0.13, COL.gold, COL.white, 0.35, 6);
        }
        break;
      }
      case 'revive': {
        // an event: a column of light, a sigil ring coming down, motes rising round the fallen, and a final flash
        const a = env(t, v.dur, 0.15, 0.45);
        beam.put(v.bx, v.by, v.bz, 2.6, 10, 2.6, COL.gold, 0.42 * a);
        beam.put(v.bx, v.by, v.bz, 1.5, 11, 1.5, COL.lightGold, 0.6 * a);
        beam.put(v.bx, v.by, v.bz, 0.7, 12, 0.7, COL.white, 0.9 * a);
        const dk = easeOut(clamp01(t / 0.7));
        ring.put(v.bx, v.by + 8 * (1 - dk) + 0.1, v.bz, 1.8 - 0.4 * dk, 1, 1.8 - 0.4 * dk, COL.gold, a);
        shock(v.bx, v.by, v.bz, 0.6 + 2.4 * easeOut(clamp01(t / 0.9)), COL.lightGold, 0.9 * (1 - clamp01(t / 1.2)));
        shock(v.bx, v.by, v.bz, 1.4 + 0.3 * Math.sin(t * 9), COL.gold, 0.8 * a);
        for (let i = 0; i < motes + 4; i++) {
          const k = fract(t * 0.9 + rnd(v.seed, i)), ang = i * 2.4 + t * 2.5;
          gem.dot(v.bx + Math.cos(ang) * 0.9, v.by + k * 4.5, v.bz + Math.sin(ang) * 0.9, 0.16, i % 2 ? COL.gold : COL.white, a * Math.sin(k * Math.PI));
        }
        flash(v.bx, v.by + 1.0, v.bz, t - 1.0, 2.6, 0.5, COL.white);
        break;
      }
      case 'blast': {
        // fire on Marked: a white-hot core, a fireball, two shock rings out to 3 m, a pillar of flame and a storm of
        // embers: the loudest moment in the game
        flash(cx, cy, cz, t, 3.6, 0.3, COL.fireCore);
        // a burst of fire round the target (a ring of flame balls flying out), never a dome over it: it stays in sight
        if (t < 0.6) {
          const k = t / 0.6;
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2 + v.seed, r = 0.6 + 2.6 * easeOut(k);
            gem.dot(v.bx + Math.cos(a) * r, cy + 0.3 * Math.sin(k * Math.PI), v.bz + Math.sin(a) * r, 0.9 * (1 - 0.5 * k), k < 0.3 ? COL.fireHot : COL.fire, 0.95 * (1 - k));
          }
        }
        for (let i = 0; i < 3; i++) {
          const u = t - i * 0.08, k = clamp01(u / 0.5);
          if (u > 0) shock(v.bx, v.by, v.bz, 0.4 + 2.8 * easeOut(k) + i * 0.15, i === 1 ? COL.fireHot : i ? COL.gold : COL.fire, (1 - 0.15 * i) * (1 - k));
        }
        for (let i = 0; i < 7; i++) {   // a column of fireballs boiling up out of it
          const k = clamp01(t / 0.65 - i * 0.04);
          if (k <= 0 || k >= 1) continue;
          // up from behind and beside it, not out of its middle
          const a = i * 0.9 + v.seed, sw = 1.1 + 0.3 * Math.sin(i * 2.3 + t * 9);
          gem.dot(v.bx + Math.cos(a) * sw, v.by + 0.6 + k * (2.2 + i * 0.75), v.bz + Math.sin(a) * sw, (0.9 - i * 0.08) * (1 - 0.5 * k), k < 0.3 ? COL.fireHot : i > 4 ? COL.ember : COL.fire, 0.9 * (1 - k));
        }
        sparks(v, cx, cy, cz, t, burst + 10, 8, 7, 0.38, COL.fire, COL.fireHot, 0.8, 7);
        for (let i = 0; i < 8; i++) {   // flame tongues
          const a = i * 0.785 + v.seed, k = 0.25 + 0.75 * clamp01(t / 0.45), r0 = 0.5 * k;
          beam.seg(v.bx + Math.cos(a) * r0, v.by + 0.3, v.bz + Math.sin(a) * r0, v.bx + Math.cos(a) * 2.6 * k, v.by + 1.2 + 1.8 * k, v.bz + Math.sin(a) * 2.6 * k, 0.3 * (1.2 - k), i % 2 ? COL.fireHot : COL.ember, 0.95 * (1.25 - k));
        }
        for (let i = 0; i < 5; i++) {   // smoke after
          const u = t - 0.45, k = clamp01(u / 0.6);
          if (u > 0) puff.dot(cx + (rnd(v.seed, i) - 0.5) * 1.6, cy + 0.6 + 1.8 * k, cz + (rnd(v.seed, i + 4) - 0.5) * 1.6, 0.7 + 0.8 * k, COL.smoke, 0.6 * (1 - k));
        }
        break;
      }
      case 'conduct': {
        // lightning on Soaked: a strike from the sky, then a blue-white crackle cage for 1.5 s
        if (t < 0.18) bolt(v.seed, t, cx + 0.8, v.by + v.bh + 8, cz - 0.6, cx, cy, cz, 7, 0.7, 0.1, COL.boltBlue, COL.white, 1);
        flash(cx, cy, cz, t - 0.08, 3, 0.4, COL.boltBlue);
        const r = 1.0 + v.bh * 0.15, n = particleCap(q, 'cage'), a = env(t, v.dur, 0.12, 0.35);
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2 + t * 1.5;
          const x0 = v.bx + Math.cos(ang) * r, z0 = v.bz + Math.sin(ang) * r;
          bolt(v.seed + i * 13, t, x0, v.by + 0.05, z0, x0, v.by + v.bh + 0.5, z0, 4, 0.22, 0.05, COL.boltBlue, COL.white, a * (0.6 + 0.4 * rnd(v.seed + Math.floor(t * 15), i)));
          if (i % 2 === 0) {
            const ang2 = ((i + 1) / n) * Math.PI * 2 + t * 1.5, hy2 = v.by + v.bh * (0.3 + 0.5 * rnd(v.seed + Math.floor(t * 15), i + 3));
            bolt(v.seed + i * 7, t, x0, hy2, z0, v.bx + Math.cos(ang2) * r, hy2, v.bz + Math.sin(ang2) * r, 3, 0.18, 0.035, COL.boltBlue, COL.white, a * 0.8);
          }
        }
        shock(v.bx, v.by, v.bz, r + 0.1 * Math.sin(t * 30), COL.boltBlue, 0.9 * a);
        ring.put(v.bx, v.by + v.bh + 0.5, v.bz, r * 0.9, 1, r * 0.9, COL.boltBlue, 0.7 * a);
        shock(v.bx, v.by, v.bz, 0.5 + 3 * easeOut(clamp01(t / 0.4)), COL.white, 0.8 * (1 - clamp01(t / 0.45)));
        sparks(v, cx, cy, cz, t - 0.08, burst, 5, 3, 0.12, COL.boltBlue, COL.white, 0.4, 8);
        break;
      }
      case 'steam': {
        // water on Burning: a white puff column, a ripple, a hiss of droplets (its heals float as numbers)
        const n = Math.max(6, burst);
        for (let i = 0; i < n; i++) {
          const d = (i / n) * 0.6, k = clamp01((t - d) / 0.9);
          if (k <= 0 || k >= 1) continue;
          // a column of small, half-clear puffs rising round the target (never one opaque blob over it)
          const a = rnd(v.seed, i) * Math.PI * 2, r = 0.7 + 0.5 * k;
          puff.dot(v.bx + Math.cos(a) * r, v.by + 0.5 + k * 4.5, v.bz + Math.sin(a) * r, 0.35 + 0.6 * k, COL.white, 0.5 * Math.sin(k * Math.PI));
        }
        flash(cx, cy, cz, t, 2.4, 0.35, COL.waterCore);
        shock(v.bx, v.by, v.bz, 0.5 + 5.5 * easeOut(clamp01(t / 0.7)), COL.water, 0.9 * (1 - clamp01(t / 0.8)));
        shock(v.bx, v.by, v.bz, 0.3 + 3 * easeOut(clamp01((t - 0.15) / 0.6)), COL.healGold, 0.6 * (1 - clamp01((t - 0.1) / 0.7)));
        sparks(v, cx, cy, cz, t, burst, 3.5, 5, 0.14, COL.water, COL.waterCore, 0.55, 9);
        break;
      }
      case 'bedrock': {
        // earth on Dazed: a ring of shards erupting round the target, a dust ring (the shields rise round the adventurers)
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2 + v.seed, r = 1.0 + 0.3 * rnd(v.seed, i);
          const up = easeOut(ramp(t, i * 0.025, i * 0.025 + 0.18)), down = ramp(t, 0.6, 1.0);
          const hgt = (1.3 + 0.8 * rnd(v.seed, i + 3)) * up * (1 - down);
          if (hgt > 0.02) rock.put(v.bx + Math.cos(a) * r, v.by - 0.2, v.bz + Math.sin(a) * r, 0.9, hgt, 0.9, i % 3 ? COL.earth : COL.earthLight, 1, a + Math.PI / 2, -0.45);
        }
        flash(cx, cy, cz, t, 2.0, 0.3, COL.gold);
        shock(v.bx, v.by, v.bz, 0.6 + 5.4 * easeOut(clamp01(t / 0.6)), COL.gold, 0.9 * (1 - clamp01(t / 0.7)));
        for (let i = 0; i < 8; i++) {
          const a = i * 0.785, k = clamp01(t / 0.9);
          puff.dot(v.bx + Math.cos(a) * (1.2 + 2 * k), v.by + 0.25, v.bz + Math.sin(a) * (1.2 + 2 * k), 0.5 + 0.6 * k, COL.dust, 0.7 * (1 - k));
        }
        break;
      }
      case 'bedrockRing': {
        // a stone ring rising round an adventurer it shields
        const up = easeOut(ramp(t, 0, 0.35)), down = ramp(t, 1.0, 1.45);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const hgt = (0.8 + 0.25 * rnd(v.seed, i)) * up * (1 - down);
          if (hgt > 0.02) rock.put(v.bx + Math.cos(a) * 1.0, v.by - 0.1, v.bz + Math.sin(a) * 1.0, 0.55, hgt, 0.55, i % 2 ? COL.earth : COL.earthLight, 1, a, 0.12);
        }
        shock(v.bx, v.by, v.bz, 1.25, COL.gold, 0.8 * up * (1 - down));
        break;
      }
      case 'taunt': {
        if (v.dst >= 0) {
          const a = 1 - clamp01(t / 0.45);
          beam.seg(hx, hy, hz, cx, cy + 0.3, cz, 0.12, COL.red, 0.8 * a);
          flash(v.bx, v.by + v.bh + 0.5, v.bz, t, 1.1, 0.5, COL.red);
          gem.put(v.bx, v.by + v.bh + 0.7 + 0.3 * easeOut(clamp01(t / 0.3)), v.bz, 0.18, 0.55, 0.18, COL.red, 1 - clamp01((t - 0.3) / 0.3));
        } else {
          shock(v.ax, v.ay, v.az, 0.5 + 7.5 * easeOut(clamp01(t / 0.5)), COL.red, 1 - clamp01(t / 0.6));
          flash(v.ax, v.ay + v.ah * 0.8, v.az, t, 1.4, 0.35, COL.red);
        }
        break;
      }
      case 'ashcloud': {
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2 + v.seed, k = clamp01(t / v.dur);
          puff.dot(v.ax + Math.cos(a) * (0.5 + 5 * easeOut(k)), v.ay + 0.5 + 0.6 * k, v.az + Math.sin(a) * (0.5 + 5 * easeOut(k)), 0.7 + 0.8 * k, COL.smoke, 0.8 * (1 - k));
        }
        break;
      }
      case 'fizzle': {
        for (let i = 0; i < 4; i++) {
          const a = i * 1.57 + v.seed, k = clamp01(t / v.dur);
          puff.dot(hx + Math.cos(a) * 0.3 * (1 + k), hy + 0.3 * k, hz + Math.sin(a) * 0.3 * (1 + k), 0.25 + 0.25 * k, COL.grey, 0.7 * (1 - k));
        }
        sparks(v, hx, hy, hz, t, 4, 1.2, 1.5, 0.08, COL.grey, COL.white, 0.35, 10);
        break;
      }
      default: { // generic: a small sparkle burst where it landed
        flash(cx, cy, cz, t, 0.9 * s, 0.3, COL.lightGold);
        sparks(v, cx, cy, cz, t, Math.round(burst * 0.4), 2, 2, 0.1, COL.gold, COL.white, 0.4, 11);
        shock(v.bx, v.by, v.bz, 0.3 + 0.9 * easeOut(clamp01(t / 0.35)), COL.gold, 0.6 * (1 - clamp01(t / 0.45)));
      }
    }
  };

  const api: Spells = {
    timeScale: 1,
    kinds() { return pool.slots.filter((v) => v.on).map((v) => v.kind); },
    play(sp) {
      // both ends where they stand now (an end out of view starts at the other, so nothing flies from the origin);
      // with neither in view there is nothing to draw, and no slot is taken (nor a live one recycled)
      const okA = sp.src >= 0 && o.locate(sp.src, A), okB = sp.dst >= 0 && o.locate(sp.dst, B);
      if (!okA && !okB) return;
      const v = pool.add(sp, performance.now());
      if (okA) { v.ax = A.x; v.ay = A.y; v.az = A.z; v.ah = A.h; }
      if (okB) { v.bx = B.x; v.by = B.y; v.bz = B.z; v.bh = B.h; }
      if (okA && !okB) { v.bx = v.ax; v.by = v.ay; v.bz = v.az; v.bh = v.ah; }
      if (okB && !okA) { v.ax = v.bx; v.ay = v.by; v.az = v.bz; v.ah = v.bh; }
    },
    begin() { for (const b of batches) b.begin(); },
    caster(x, y, z, tone, t) {
      const c = TONE[tone];
      const p = 0.5 + 0.5 * Math.sin(t * 7);
      ring.put(x, y + 0.07, z, 1.0 + 0.08 * p, 1, 1.0 + 0.08 * p, c.c, 0.65 + 0.3 * p);
      ring.put(x, y + 0.07, z, 0.62 - 0.05 * p, 1, 0.62 - 0.05 * p, c.hot, 0.45);
      for (let i = 0; i < 4; i++) {
        const a = t * 2.6 + i * 1.5708, k = fract(t * 0.8 + i * 0.25);
        gem.dot(x + Math.cos(a) * 0.85, y + 0.15 + k * 1.6, z + Math.sin(a) * 0.85, 0.14, i % 2 ? c.hot : c.c, Math.sin(k * Math.PI));
      }
    },
    shield(x, y, z, h, t) {
      const p = 0.5 + 0.5 * Math.sin(t * 2.4);
      shell.dot(x, y + h * 0.5, z, h * 0.62, COL.shield, 0.55 + 0.15 * p);
    },
    aegis(x, y, z, dome, t) {
      if (dome) { shell.dot(x, y, z, 1.6, COL.gold, 0.4 + 0.1 * Math.sin(t * 3)); return; }
      ring.put(x, y + 0.09, z, 0.7, 1, 0.7, COL.gold, 0.7);
      for (let i = 0; i < 3; i++) { const a = t * 1.8 + i * 2.094; gem.put(x + Math.cos(a) * 0.7, y + 0.25, z + Math.sin(a) * 0.7, 0.1, 0.18, 0.1, COL.gold, 0.9, a); }
    },
    tether(ax, ay, az, bx, by, bz, t) {
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, my = (ay + by) / 2 + 0.6 + 1.2 * 0.6 - 0.25;
      const a = 0.55 + 0.2 * Math.sin(t * 4);
      beam.seg(ax, ay + 1.2, az, mx, my, mz, 0.06, COL.gold, a);
      beam.seg(mx, my, mz, bx, by + 1.2, bz, 0.06, COL.gold, a);
      const k = fract(t * 0.7);
      gem.dot(ax + (bx - ax) * k, ay + 1.2 + (by - ay) * k + Math.sin(k * Math.PI) * 0.35, az + (bz - az) * k, 0.12, COL.white, 0.9);
    },
    aura(x, y, z, h, bits, t) {
      if (bits & BUFF_BITS.roar) ring.put(x, y + 0.08, z, 0.8 + 0.05 * Math.sin(t * 8), 1, 0.8 + 0.05 * Math.sin(t * 8), COL.ember, 0.45);
      if (bits & (BUFF_BITS.pact | BUFF_BITS.bloodbond)) {
        const n = bits & BUFF_BITS.pact ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const a = t * 2 + i * (Math.PI * 2 / n), k = fract(t * 0.6 + i / n);
          gem.dot(x + Math.cos(a) * 0.55, y + 0.3 + k * h, z + Math.sin(a) * 0.55, 0.11, COL.crimsonLight, 0.85 * Math.sin(k * Math.PI));
        }
        if (bits & BUFF_BITS.bloodbond) ring.put(x, y + 0.08, z, 0.75, 1, 0.75, COL.crimson, 0.5);
      }
    },
    enemy(x, y, z, h, marks, debuffs, t) {
      if (marks & MARK_BITS.soaked) {         // water: droplets falling off it
        for (let i = 0; i < 2; i++) { const k = fract(t * 1.3 + i * 0.5), a = i * 2.6 + 1; gem.put(x + Math.cos(a) * 0.4, y + h * 0.9 - k * h * 0.8, z + Math.sin(a) * 0.4, 0.09, 0.16, 0.09, COL.waterLight, 0.9 * (1 - k)); }
        ring.put(x, y + 0.06, z, 0.75 + 0.1 * fract(t), 1, 0.75 + 0.1 * fract(t), COL.water, 0.5);
      }
      if (marks & MARK_BITS.burning) {        // fire: embers rising
        for (let i = 0; i < 3; i++) { const k = fract(t * 1.1 + i / 3), a = i * 2.1 + t; gem.dot(x + Math.cos(a) * 0.35, y + h * 0.3 + k * h, z + Math.sin(a) * 0.35, 0.16 * (1 - k * 0.6), i ? COL.ember : COL.fireHot, 1 - k); }
      }
      if (marks & MARK_BITS.rooted) {         // earth: stones round its feet
        for (let i = 0; i < 4; i++) { const a = i * 1.5708 + 0.4; rock.put(x + Math.cos(a) * 0.8, y - 0.05, z + Math.sin(a) * 0.8, 0.35, 0.45, 0.35, COL.earth, 1, a, 0.3); }
        ring.put(x, y + 0.06, z, 0.85, 1, 0.85, COL.heal, 0.5);
      }
      if (marks & MARK_BITS.dazed) {          // gold stars circling its head
        for (let i = 0; i < 3; i++) { const a = t * 3 + i * 2.094; gem.put(x + Math.cos(a) * 0.45, y + h + 0.15, z + Math.sin(a) * 0.45, 0.13, 0.13, 0.13, COL.gold, 0.95, a * 2); }
      }
      if (debuffs & DEBUFF_BITS.blinded) {    // grey puffs over its eyes
        for (let i = 0; i < 2; i++) puff.dot(x + (i - 0.5) * 0.45, y + h * 0.85 + 0.1 * Math.sin(t * 2 + i), z, 0.45, COL.smoke, 0.6);
      }
      if (debuffs & DEBUFF_BITS.weakpoint) {  // a red diamond over it
        gem.put(x, y + h + 0.75 + 0.08 * Math.sin(t * 3), z, 0.3, 0.48, 0.3, COL.red, 0.9, t * 1.5);
      }
    },
    update(dt) {
      pool.step(dt * api.timeScale);
      const q = o.quality();
      for (const v of pool.slots) if (v.on) { track(v); draw(v, q); }
      drawn = 0;
      for (const b of batches) { b.end(); drawn += b.n; }
    },
    clear() { pool.clear(); },
    get live() { return pool.live; },
    get drawn() { return drawn; },
    dispose() {
      pool.clear();
      for (const b of batches) b.mesh.dispose();
      add.dispose(); rockMat.dispose(); puffMat.dispose();
    },
  };
  return api;
}
