// The people and places of the opening quest (online): Old Marrow, Bram and Tamsin in the grove, Nell on the Greenway
// road, Pim's talk spot under the tavern figurehead, the plaque, Gran's three waymarks and the crater's edge, each at its
// story spot (STORY_NPCS / STORY_PROPS, static shared data), with the quest markers over them.
//
// Everything is cosmetic and tappable only: no collision (the server's walkability is the truth). Every pickable mesh
// carries metadata { entityId: storyEid(id), story: id }, so the rig reports a tap on it as that entity.
// Budget (med): the NPC bodies (one draw call each, plus shadow passes), ONE props mesh (in the world's lit material)
// and ONE marker mesh (all markers and the plaque's rim, billboarded on the CPU into a preallocated buffer).
import {
  Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, VertexBuffer, VertexData, Vector3, type Scene,
} from '@babylonjs/core';
import {
  NPC_IDS, PROP_IDS, QUESTS, STORY_NPCS, STORY_PROPS, isQuestId, objectiveTarget,
  type Look, type NpcId, type Objective, type PropId, type QuestsView, type ZoneId,
} from '@sg2/shared';
import type { CharacterView, Quality, TapInfo, WorldApi, ZoneId as ClientZoneId } from '../core/contracts';
import { makeCharacter } from '../player/character';
import { Builder, hex, mix, tint, type RGB, type V3 } from './mesh';
import { PAL } from './parts';
import { WorldFxPlugin } from './shading';
import { GREENWAY_BEACON_DIR } from './storySky';
export { GREENWAY_BEACON_DIR };
import { TAVERN, TAVERN_YAW, groundHeight } from './layout';

export type StoryId = NpcId | PropId;

// ───────────────────────── entity ids ─────────────────────────
/** NPC eids are −100..−104 (marrow, pim, bram, tamsin, nell), props −110..−114 (no engine id is negative; the Guild Board is −2). */
export const STORY_EID_BASE = -100;
export function storyEid(id: StoryId): number {
  const n = (NPC_IDS as readonly string[]).indexOf(id);
  return n >= 0 ? STORY_EID_BASE - n : STORY_EID_BASE - 10 - (PROP_IDS as readonly string[]).indexOf(id);
}
export function storyIdOf(eid: number): StoryId | null {
  if (!Number.isInteger(eid)) return null;
  const n = STORY_EID_BASE - eid;
  if (n >= 0 && n < NPC_IDS.length) return NPC_IDS[n];
  if (n >= 10 && n < 10 + PROP_IDS.length) return PROP_IDS[n - 10];
  return null;
}

// ───────────────────────── markers ─────────────────────────
/** Gold "!" (an offer), gold "◆" (a current talk or use), gold "?" (a turn-in: back to someone), grey "◆" (they wait for you later), none. */
export type Marker = 'offer' | 'talk' | 'turnin' | 'busy' | null;
const RANK: Record<Exclude<Marker, null>, number> = { busy: 1, offer: 2, talk: 3, turnin: 4 };

const involves = (o: Objective, id: StoryId) => (o.k === 'talk' && o.npc === id) || (o.k === 'use' && o.prop === id);
const isNpc = (id: StoryId): id is NpcId => (NPC_IDS as readonly string[]).includes(id);

/**
 * Which marker shows over `id` for this quest view:
 * - a talk or use objective for it, open on an active quest's current step: "?" when it is someone the quest has already
 *   met (its giver, or a talk of an earlier step), else "◆" (props always "◆");
 * - else a quest it gives is on offer: "!";
 * - else an active quest has met this NPC and comes back to them at a later step: grey "◆".
 * The strongest wins (turn-in, talk, offer, busy).
 */
export function markerFor(id: StoryId, view: QuestsView | null): Marker {
  if (!view) return null;
  let best: Marker = null;
  const take = (m: Exclude<Marker, null>) => { if (!best || RANK[m] > RANK[best]) best = m; };
  const npc = isNpc(id);
  for (const a of view.active ?? []) {
    if (!a || !isQuestId(a.id)) continue;
    const q = QUESTS[a.id];
    const step = q.steps[a.step];
    if (!step) continue;
    const met = npc && (q.giver === id || q.steps.slice(0, a.step).some((s) => s.objectives.some((o) => involves(o, id))));
    const open = step.objectives.some((o, i) => involves(o, id) && (a.counts?.[i] ?? 0) < objectiveTarget(o));
    if (open) take(met ? 'turnin' : 'talk');
    else if (met && q.steps.slice(a.step + 1).some((s) => s.objectives.some((o) => involves(o, id)))) take('busy');
  }
  if (npc && (view.offers ?? []).some((q) => isQuestId(q) && QUESTS[q].giver === id)) take('offer');
  return best;
}

/** The Beacon stands in the sky once the main quest is past its plaque step, or done. */
export function beaconRaisedFor(view: QuestsView | null): boolean {
  if (!view) return false;
  if ((view.done ?? []).some((d) => d?.id === 'solstice_crossing')) return true;
  const plaque = QUESTS.solstice_crossing.steps.findIndex((s) => s.id === 'plaque');
  return (view.active ?? []).some((a) => a?.id === 'solstice_crossing' && a.step > plaque);
}

/** A marker's world height at distance d (m): constant on screen between 8 and 40 m (about 50 px of a 740 px phone). */
export const MARKER_K = 0.058;
export function markerHeight(d: number): number { return Math.min(40, Math.max(8, d)) * MARKER_K; }

// ───────────────────────── looks ─────────────────────────
/** The story NPCs' looks (Plan 5's Look), for when characters are built from a Look. */
export const STORY_LOOKS: Readonly<Record<'marrow' | 'bram' | 'tamsin' | 'nell', Look>> = Object.freeze({
  // an old human, stooped, white hair and beard, a long grey coat
  marrow: { v: 1, people: 'human', body: { height: 7, build: 8, shoulders: 8, hips: 10, legs: 9, head: 11 },
    face: { shape: 4, eyes: 1, brows: 6, nose: 5, mouth: 2, ears: 2, marks: 0 }, hair: { style: 3, facial: 3 },
    colours: { skin: 0xe8c4a4, hair: 0xe9e6df, facial: 0xe4e2dc, eyes: 0x4a6a8a, marks: 0x000000 }, fur: null,
    style: { stance: 0, walk: 1 }, outfit: { dye1: 0, dye2: 0 } },
  // a broad knollfolk with a leather apron
  bram: { v: 1, people: 'knollfolk', body: { height: 12, build: 18, shoulders: 17, hips: 14, legs: 8, head: 12 },
    face: { shape: 0, eyes: 2, brows: 4, nose: 6, mouth: 1, ears: 2, marks: 1 }, hair: { style: 1, facial: 5 },
    colours: { skin: 0xe9b494, hair: 0xb6652c, facial: 0xb6652c, eyes: 0x3b2617, marks: 0xc98a6a }, fur: null,
    style: { stance: 1, walk: 1 }, outfit: { dye1: 0, dye2: 0 } },
  // a tall larchfolk ferrywoman in an oilskin, a coiled rope at the hip
  tamsin: { v: 1, people: 'larchfolk', body: { height: 14, build: 9, shoulders: 10, hips: 9, legs: 13, head: 9 },
    face: { shape: 1, eyes: 4, brows: 2, nose: 3, mouth: 4, ears: 3, marks: 1 }, hair: { style: 8, facial: 0 },
    colours: { skin: 0xbba98d, hair: 0x7b3e25, facial: 0x7b3e25, eyes: 0x3d4a52, marks: 0x8e7c60 }, fur: null,
    style: { stance: 2, walk: 0 }, outfit: { dye1: 0, dye2: 0 } },
  // a brindlekin road-keeper in a green hooded cloak with a staff-length walking pole
  nell: { v: 1, people: 'brindlekin', body: { height: 10, build: 9, shoulders: 9, hips: 10, legs: 11, head: 10 },
    face: { shape: 1, eyes: 3, brows: 2, nose: 2, mouth: 0, ears: 4, marks: 0 }, hair: { style: 1, facial: 0 },
    colours: { skin: 0xb07848, hair: 0x4e3d31, facial: 0x4e3d31, eyes: 0x6f8a3a, marks: 0x000000 },
    fur: { pattern: 1, colour: 0x6c4b33, tail: 1 }, style: { stance: 2, walk: 3 }, outfit: { dye1: 0, dye2: 0 } },
} satisfies Record<string, Look>);
/** The NPC colours (the offline demo's): character.ts picks each one's costume from it (Marrow: none; Nell: her cloak). */
export const STORY_NPC_COLOR: Readonly<Record<'marrow' | 'bram' | 'tamsin' | 'nell', string | undefined>> =
  Object.freeze({ marrow: undefined, tamsin: '#3FB0A6', bram: '#EC6A4C', nell: '#6E8B3D' });

// ───────────────────────── props (pure geometry) ─────────────────────────
const MOSS = hex('#6f9a4a'), MOSS2 = hex('#8fb85a');
const STONE = mix(PAL.plinth, PAL.rock4, 0.18), STONE_D = mix(PAL.plinthDark, PAL.rock4, 0.25), CARVE = mix(PAL.stone, PAL.white, 0.25);

/**
 * A leaning standing stone (in world coordinates at its foot), its face toward the road (−z), with an arm carved as a
 * raised strip pointing up toward `toward` (a horizontal direction). ≤ 120 triangles (moss only above 'low').
 */
export function buildWaymark(b: Builder, x: number, y: number, z: number, seed: number, q: Quality): void {
  const r = (k: number) => { const s = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
  b.push(); b.T(x, y, z); b.RY(-0.25 + r(1) * 0.5); b.RX(-0.07 - r(2) * 0.05); b.RZ((r(3) - 0.5) * 0.18); b.SC(1.18);
  // rings of six round the stone, narrowing to a blunt top
  const rings: [number, number, number][] = [[-0.25, 0.34, 0.24], [0.45, 0.31, 0.22], [0.95, 0.24, 0.18], [1.18, 0.13, 0.11]];
  const ring = (i: number): V3[] => Array.from({ length: 6 }, (_, k) => {
    const a = (k / 6) * Math.PI * 2 + 0.3, j = 0.9 + 0.2 * r(10 + i * 6 + k);
    return [Math.cos(a) * rings[i][1] * j, rings[i][0], Math.sin(a) * rings[i][2] * j];
  });
  const R = rings.map((_, i) => ring(i));
  b.withHint([0, 0.5, 0], () => {
    for (let i = 0; i < R.length - 1; i++) for (let k = 0; k < 6; k++) {
      const k2 = (k + 1) % 6;
      const c = i === R.length - 2 ? mix(STONE, MOSS, 0.55) : tint(STONE, 0.94 + 0.12 * r(30 + i * 6 + k));
      b.quad(R[i][k], R[i][k2], R[i + 1][k2], R[i + 1][k], c, i === 0 ? STONE_D : c);
    }
    const top: V3 = [0, 1.26, 0];
    for (let k = 0; k < 6; k++) b.tri(R[3][k], R[3][(k + 1) % 6], top, mix(STONE, MOSS2, 0.7));
  });
  // the carved arm on the road face (−z): a raised strip up and toward the sky, a hand with a pointing finger
  // (up and to the left as the road sees it: where the Beacon stands from the Greenway)
  b.prism([0.05, 0.3, -0.226], [-0.045, 0.74, -0.206], 0.048, 0.042, 4, CARVE, { rot: 0.785 });          // forearm
  b.prism([-0.045, 0.72, -0.206], [-0.07, 0.86, -0.192], 0.068, 0.058, 4, CARVE, { rot: 0.785 });        // the fist
  b.prism([-0.07, 0.86, -0.19], [-0.1, 1.05, -0.165], 0.026, 0.016, 4, CARVE, { rot: 0.785 });          // the finger, pointing up
  if (q !== 'low') {
    // moss at the foot, and a lichen patch
    b.ball([0.18, 0.02, 0.06], 0.16, MOSS, 1.3, 0.45, 1, 0, 0.25);
    b.ball([-0.2, 0.0, -0.1], 0.12, MOSS2, 1.2, 0.4, 1, 0, 0.25);
  }
  b.pop();
}

/** The crater's edge: a ring of six short stakes with a frayed rope sagging between them, a rag on one. ≤ 200 triangles. */
export function buildCraterMarker(b: Builder, x: number, y: number, z: number, q: Quality, ground: (x: number, z: number) => number): void {
  const R = 1.15, n = 6;
  const wood = PAL.woodDark, rope = mix(PAL.stone2, PAL.wood, 0.35);
  const tops: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.25;
    const px = x + Math.cos(a) * R, pz = z + Math.sin(a) * R, py = ground(px, pz);
    const h = 0.72 + 0.12 * Math.sin(i * 2.7);
    const lean = i === 2 ? 0.35 : 0.08;   // one stake knocked askew
    const top: V3 = [px + Math.cos(a) * lean * h, py + h * Math.cos(lean), pz + Math.sin(a) * lean * h];
    b.prism([px, py - 0.1, pz], top, 0.055, 0.04, 4, i % 2 ? wood : tint(wood, 1.15), { rot: a, caps: false });
    b.prism(top, [top[0], top[1] + 0.09, top[2]], 0.04, 0.004, 3, tint(wood, 1.25), { rot: a, caps: false });
    tops.push([top[0], top[1] - 0.12, top[2]]);
  }
  const segs = q === 'low' ? 1 : 2;
  for (let i = 0; i < n; i++) {
    if (i === 3) continue;   // the rope has parted here: two frayed ends hang down
    const A = tops[i], B = tops[(i + 1) % n];
    let prev = A;
    for (let s = 1; s <= segs; s++) {
      const t = s / segs, sag = Math.sin(t * Math.PI) * 0.16;
      const P: V3 = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t - (segs === 1 ? 0.08 : sag), A[2] + (B[2] - A[2]) * t];
      b.prism(prev, P, 0.016, 0.016, 3, rope, { caps: false });
      prev = P;
    }
  }
  for (const [i, j] of [[3, 4], [4, 3]]) {
    const A = tops[i], B = tops[j];
    const end: V3 = [A[0] + (B[0] - A[0]) * 0.28, A[1] - 0.3, A[2] + (B[2] - A[2]) * 0.28];
    b.prism(A, end, 0.016, 0.006, 3, rope, { caps: false });
    b.prism(end, [end[0] + 0.03, end[1] - 0.07, end[2]], 0.012, 0.002, 3, rope, { caps: false });   // fraying
  }
  // a faded red rag tied to the first stake
  const T = tops[0];
  b.withHint(null, () => { b.quad(T, [T[0] + 0.02, T[1] + 0.06, T[2] + 0.12], [T[0] + 0.1, T[1] - 0.32, T[2] + 0.16], [T[0] + 0.04, T[1] - 0.36, T[2] - 0.02], tint(PAL.roof2, 0.95)); });
}

/** The plaque's rim (it glows while reading the plaque is the current objective): a frame round the statue's plaque. */
const PLAQUE = { x: 0, y: 0.04 + 1.38, z: -2.505 - 0.015, w: 1.62, h: 0.76, tilt: -0.08 };
const RIM_TRIS = 16;

/** Triangles each prop adds at quality q (the plaque: its rim, in the marker mesh). */
export function propTriangles(id: PropId, q: Quality): number {
  if (id === 'plaque') return RIM_TRIS;
  const b = new Builder(1);
  if (id === 'crater_edge') buildCraterMarker(b, 0, 0, 0, q, () => 0);
  else buildWaymark(b, 0, 0, 0, 1, q);
  return b.tris;
}

// ───────────────────────── marker glyphs (pure) ─────────────────────────
type Glyph = { pos: number[]; col: number[] };   // x, y (0..1 tall), depth; r, g, b per vertex
const OUT_W = 0.06;
const GOLD = { hi: hex('#ffe9a6'), mid: hex('#f2b742'), lo: hex('#d58a26'), out: hex('#4a2a14') };
const GREY = { hi: hex('#e6e2ee'), mid: hex('#b9b4c8'), lo: hex('#8f8aa2'), out: hex('#37324a') };

/** A convex polygon (fan), grown by `grow` along each vertex's direction from the centroid. */
function poly(g: Glyph, pts: [number, number][], grow: number, depth: number, col: (x: number, y: number) => RGB) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const P = pts.map(([x, y]) => { const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy) || 1; return [x + (dx / l) * grow, y + (dy / l) * grow] as [number, number]; });
  for (let i = 1; i < P.length - 1; i++) for (const p of [P[0], P[i], P[i + 1]]) { g.pos.push(p[0], p[1], depth); g.col.push(...col(p[0], p[1])); }
}
/** A stroke along a polyline (quads), widened by `grow` on each side and at both ends. */
function stroke(g: Glyph, pts: [number, number][], w: number, grow: number, depth: number, col: (x: number, y: number) => RGB) {
  const hw = w / 2 + grow;
  const L: [number, number][] = [], Rr: [number, number][] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    let x = p[0], y = p[1];
    if (i === 0) { x -= tx * grow; y -= ty * grow; }
    if (i === pts.length - 1) { x += tx * grow; y += ty * grow; }
    L.push([x - ty * hw, y + tx * hw]); Rr.push([x + ty * hw, y - tx * hw]);
  });
  for (let i = 0; i < pts.length - 1; i++) {
    for (const p of [L[i], Rr[i], Rr[i + 1], L[i], Rr[i + 1], L[i + 1]]) { g.pos.push(p[0], p[1], depth); g.col.push(...col(p[0], p[1])); }
  }
}
const octagon = (cx: number, cy: number, r: number): [number, number][] => Array.from({ length: 8 }, (_, k) => [cx + Math.cos((k / 8) * Math.PI * 2 + Math.PI / 8) * r, cy + Math.sin((k / 8) * Math.PI * 2 + Math.PI / 8) * r]);

function glyph(kind: Exclude<Marker, null>): Glyph {
  const g: Glyph = { pos: [], col: [] };
  const pal = kind === 'busy' ? GREY : GOLD;
  const out = () => pal.out;
  const grad = (x: number, y: number) => mix(pal.lo, pal.hi, Math.max(0, Math.min(1, y * 0.9 + x * 0.15 + 0.05)));
  if (kind === 'offer') {
    const bar: [number, number][] = [[-0.07, 0.34], [0.07, 0.34], [0.135, 0.94], [0.09, 1.0], [-0.09, 1.0], [-0.135, 0.94]];
    const dotP = octagon(0, 0.12, 0.105);
    poly(g, bar, OUT_W, 0.02, out); poly(g, dotP, OUT_W, 0.02, out);
    poly(g, bar, 0, 0, grad); poly(g, dotP, 0, 0, grad);
  } else if (kind === 'turnin') {
    const hook: [number, number][] = [];
    for (let i = 0; i <= 8; i++) { const a = Math.PI * (0.95 - i * 0.17); hook.push([Math.cos(a) * 0.2, 0.74 + Math.sin(a) * 0.2]); }
    hook.push([0.02, 0.48], [0.0, 0.36]);
    const dotP = octagon(0, 0.12, 0.105);
    stroke(g, hook, 0.13, OUT_W, 0.02, out); poly(g, dotP, OUT_W, 0.02, out);
    stroke(g, hook, 0.13, 0, 0, grad); poly(g, dotP, 0, 0, grad);
  } else {
    // a faceted gem: four facets round its centre, lit from the upper left
    const top: [number, number] = [0, 1], rt: [number, number] = [0.36, 0.52], bot: [number, number] = [0, 0.04], lf: [number, number] = [-0.36, 0.52], c: [number, number] = [0, 0.54];
    poly(g, [top, rt, bot, lf], OUT_W, 0.02, out);
    const face = (a: [number, number], b2: [number, number], col: RGB) => { for (const p of [a, b2, c]) { g.pos.push(p[0], p[1], 0); g.col.push(...col); } };
    face(lf, top, pal.hi); face(top, rt, mix(pal.hi, pal.mid, 0.55)); face(rt, bot, pal.lo); face(bot, lf, pal.mid);
  }
  return g;
}
const GLYPHS: Record<Exclude<Marker, null>, Glyph> = { offer: glyph('offer'), talk: glyph('talk'), turnin: glyph('turnin'), busy: glyph('busy') };
/** Vertices one marker slot holds (the largest glyph). */
const SLOT_V = Math.max(...Object.values(GLYPHS).map((g) => g.pos.length / 3));
/** Triangles of the marker mesh per marker slot. */
export const MARKER_TRIANGLES = SLOT_V / 3;

/** Story spots in a zone. */
const spotsIn = (zone: ZoneId | ClientZoneId): StoryId[] => [
  ...NPC_IDS.filter((id) => STORY_NPCS[id].zone === zone), ...PROP_IDS.filter((id) => STORY_PROPS[id].zone === zone),
];
/** Every triangle the zone's markers and props draw (the NPC bodies are characters, counted apart). */
export function zoneStoryTriangles(zone: ZoneId, q: Quality): number {
  const ids = spotsIn(zone);
  let n = ids.length * MARKER_TRIANGLES;
  for (const id of ids) if (!isNpc(id)) n += propTriangles(id, q);
  return n;
}

// ───────────────────────── the world part ─────────────────────────
export interface StorySpot { id: StoryId; x: number; y: number; z: number; eid: number }
export interface StoryWorldOpts {
  /** Prop detail (default 'med'; 'low' drops the moss). */
  quality?: Quality;
  /** Called by `handleTap` with the story spot tapped (talk to it, or walk over first: the caller's choice). */
  onTap?: (id: StoryId, spot: StorySpot) => void;
}
export interface StoryWorld {
  /** Markers (and the plaque's rim) follow the quest view; null hides them all. */
  setView(view: QuestsView | null): void;
  /** Shows these markers instead of the view's (dev pages, scripted scenes); null goes back to the view. */
  setMarkers(markers: Partial<Record<StoryId, Marker>> | null): void;
  /** The marker over `id` now. */
  markerOf(id: StoryId): Marker;
  /** The zone's story spots (ground height at each), with their entity ids. */
  readonly spots: readonly StorySpot[];
  /** The story spot a tap hit (its first story entity), or null; calls opts.onTap when there is one. */
  handleTap(tap: TapInfo): StoryId | null;
  /** Turns an NPC to face (x, z) (while talking); null turns it back to its own facing. */
  face(id: NpcId, at: { x: number; z: number } | null): void;
  /** In a fight the markers shrink and the grey ones hide, so nothing distracts from the telegraphs. */
  setInCombat(on: boolean): void;
  /** For budget checks: meshes drawn, and the marker and prop triangles. */
  readonly stats: { readonly meshes: number; readonly triangles: number };
  update(dt: number): void;
  dispose(): void;
}

/** Where the marker over a spot sits (its glyph grows upward from here), and the tap proxy's size. */
interface Spot extends StorySpot { anchor: Vector3; marker: Marker; phase: number }

const PIM_TOP = (() => {
  // the figurehead's head: above the tavern door, leaning out over the street (town.ts)
  const tv = TAVERN, H = groundHeight;
  const ty = Math.min(H(tv.x, tv.z), H(tv.x + 4, tv.z + 4), H(tv.x - 4, tv.z - 4), H(tv.x + 4, tv.z - 4), H(tv.x - 4, tv.z + 4));
  const fwd = { x: Math.sin(TAVERN_YAW), z: Math.cos(TAVERN_YAW) };
  const k = tv.d / 2 + 1.55;
  return { x: tv.x + fwd.x * k, y: ty + 5.35, z: tv.z + fwd.z * k };
})();

export function createStoryWorld(scene: Scene, world: WorldApi, zone: ZoneId | ClientZoneId, opts: StoryWorldOpts = {}): StoryWorld {
  const q = opts.quality ?? 'med';
  const ids = zone === 'grove' || zone === 'greenway' ? spotsIn(zone) : [];
  const ground = (x: number, z: number) => world.groundAt(x, z) ?? world.surfaceAt(x, z) ?? groundHeight(x, z);
  const root = new TransformNode(`story_${zone}`, scene);
  const disposables: { dispose(): void }[] = [];
  const views = new Map<NpcId, { view: CharacterView; facing: number; turn: number | null }>();
  const spots: Spot[] = [];
  const meta = (id: StoryId) => ({ entityId: storyEid(id), story: id });
  const proxies: Mesh[] = [];
  const proxy = (id: StoryId, kind: 'cyl' | 'box' | 'ball', x: number, y: number, z: number, size: { r?: number; w?: number; h: number; d?: number }, yaw = 0, tilt = 0) => {
    const m = kind === 'cyl' ? MeshBuilder.CreateCylinder(`story_hit_${id}`, { diameter: size.r! * 2, height: size.h, tessellation: 8 }, scene)
      : kind === 'ball' ? MeshBuilder.CreateSphere(`story_hit_${id}`, { diameter: size.h, segments: 4 }, scene)
        : MeshBuilder.CreateBox(`story_hit_${id}`, { width: size.w!, height: size.h, depth: size.d! }, scene);
    m.parent = root; m.position.set(x, y + (kind === 'cyl' ? size.h / 2 : 0), z); m.rotation.y = yaw; m.rotation.x = tilt;
    m.visibility = 0; m.isPickable = true; m.metadata = meta(id);
    m.freezeWorldMatrix(); m.doNotSyncBoundingInfo = true;
    proxies.push(m);
  };
  // the world's painted look, but no occlusion fade: the adventurer stands right by a stone to read it
  const lit = new StandardMaterial(`story_lit_${zone}`, scene);
  lit.diffuseColor = new Color3(1, 1, 1); lit.specularColor = Color3.Black(); lit.emissiveColor = Color3.Black();
  new WorldFxPlugin(lit, { noise: 0.2, rim: 0.22, cloudShadow: 0.16 });
  disposables.push(lit);

  // ── the NPCs ──
  for (const id of ids) {
    if (!isNpc(id)) continue;
    const s = STORY_NPCS[id];
    const y = ground(s.x, s.z);
    if (id === 'pim') {
      // Pim is the town's figurehead: a talk spot on the ground under it, and the carving itself, both tappable
      proxy(id, 'cyl', s.x, y, s.z, { r: 0.8, h: 2.2 });
      proxy(id, 'ball', PIM_TOP.x, PIM_TOP.y - 0.6, PIM_TOP.z, { h: 2.0 });
      spots.push({ id, x: s.x, y, z: s.z, eid: storyEid(id), anchor: new Vector3(PIM_TOP.x, PIM_TOP.y + 0.75, PIM_TOP.z), marker: null, phase: spots.length * 1.7 });
      continue;
    }
    // Marrow and Nell are built from their authored looks (people, body, face, hair, fur) with their own costume and
    // prop; Bram and Tamsin keep the offline demo's colour designs for now
    const look = id === 'marrow' || id === 'nell' ? STORY_LOOKS[id] : undefined;
    const view = makeCharacter(scene, { kind: 'npc', color: STORY_NPC_COLOR[id], weapon: 'none', ...(look ? { look } : {}) });
    view.root.position.set(s.x, y, s.z);
    view.root.rotation.y = s.facing;
    view.setEntityId(storyEid(id));
    view.setPose('idle');
    world.addShadowCaster(view.root);
    views.set(id, { view, facing: s.facing, turn: null });
    // a body is thin on a phone: a wider invisible column takes the tap (≥ 48 px at play distance)
    proxy(id, 'cyl', s.x, y, s.z, { r: 0.6, h: view.height + 0.2 });
    spots.push({ id, x: s.x, y, z: s.z, eid: storyEid(id), anchor: new Vector3(s.x, y + view.height + 0.42, s.z), marker: null, phase: spots.length * 1.7 });
  }

  // ── the props: one mesh in the world's lit material ──
  const pb = new Builder(77);
  let propTris = 0;
  for (const id of ids) {
    if (isNpc(id)) continue;
    const s = STORY_PROPS[id];
    const y = ground(s.x, s.z);
    if (id === 'plaque') {
      proxy(id, 'box', PLAQUE.x, PLAQUE.y, PLAQUE.z - 0.1, { w: 2.1, h: 1.3, d: 0.3 }, 0, PLAQUE.tilt);
      spots.push({ id, x: s.x, y, z: s.z, eid: storyEid(id), anchor: new Vector3(PLAQUE.x, PLAQUE.y + 0.62, PLAQUE.z - 1.15), marker: null, phase: spots.length * 1.7 });
      continue;
    }
    if (id === 'crater_edge') {
      buildCraterMarker(pb, s.x, y, s.z, q, ground);
      proxy(id, 'cyl', s.x, y - 0.1, s.z, { r: 1.6, h: 1.6 });
      spots.push({ id, x: s.x, y, z: s.z, eid: storyEid(id), anchor: new Vector3(s.x, y + 1.35, s.z), marker: null, phase: spots.length * 1.7 });
    } else {
      buildWaymark(pb, s.x, y, s.z, PROP_IDS.indexOf(id), q);
      proxy(id, 'box', s.x, y + 0.75, s.z, { w: 1.3, h: 1.8, d: 1.0 });
      spots.push({ id, x: s.x, y, z: s.z, eid: storyEid(id), anchor: new Vector3(s.x, y + 1.62, s.z), marker: null, phase: spots.length * 1.7 });
    }
  }
  const meshes: Mesh[] = [];
  if (pb.tris > 0) {
    propTris = pb.tris;
    pb.smoothNormals(35);
    const pm = pb.build(scene, `story_props_${zone}`, lit);
    // its own node, at the first prop's foot (the world puts a blob shadow under a caster's node on 'low')
    const first = spots.find((s) => !isNpc(s.id) && s.id !== 'plaque')!;
    const holder = new TransformNode(`story_props_node_${zone}`, scene);
    holder.parent = root; holder.position.set(first.x, first.y, first.z);
    pm.parent = holder; pm.position.set(-first.x, -first.y, -first.z); pm.isPickable = false;
    pm.receiveShadows = true;
    meshes.push(pm);
    world.addShadowCaster(holder);
  }

  // ── the markers and the plaque's rim: one mesh, positions written each frame ──
  const hasRim = ids.includes('plaque');
  const slotV = SLOT_V, nSlots = spots.length, rimV = hasRim ? RIM_TRIS * 3 : 0;
  const nV = nSlots * slotV + rimV;
  const mPos = new Float32Array(nV * 3), mCol = new Float32Array(nV * 4).fill(1);
  const mk = new Mesh(`story_markers_${zone}`, scene);
  const mvd = new VertexData();
  mvd.positions = mPos; mvd.colors = mCol;
  mvd.indices = Array.from({ length: nV }, (_, i) => i);
  mvd.applyToMesh(mk, true);
  const mMat = new StandardMaterial(`story_markermat_${zone}`, scene);
  mMat.disableLighting = true; mMat.emissiveColor = new Color3(1, 1, 1); mMat.specularColor = Color3.Black();
  mMat.backFaceCulling = false; mMat.fogEnabled = false;
  mk.material = mMat; mk.parent = root; mk.isPickable = false; mk.alwaysSelectAsActiveMesh = true;
  mk.receiveShadows = false; mk.hasVertexAlpha = false;
  disposables.push(mMat);
  meshes.push(mk);
  // the rim's corners (static): a frame 5 cm wide round the plaque, in its tilted plane
  const rimPts: number[] = [];
  if (hasRim) {
    const { x, y, z, w, h, tilt } = PLAQUE, ct = Math.cos(tilt), st = Math.sin(tilt);
    const at = (u: number, v: number): V3 => [x + u, y + v * ct, z - 0.006 + v * st];
    const e = 0.06, W = w / 2, Hh = h / 2;
    const quad = (a: V3, b: V3, c: V3, d: V3) => rimPts.push(...a, ...b, ...c, ...a, ...c, ...d);
    const frame = (o: number, t: number) => {
      quad(at(-W - o - t, Hh + o), at(W + o + t, Hh + o), at(W + o + t, Hh + o + t), at(-W - o - t, Hh + o + t));
      quad(at(-W - o - t, -Hh - o - t), at(W + o + t, -Hh - o - t), at(W + o + t, -Hh - o), at(-W - o - t, -Hh - o));
      quad(at(-W - o - t, -Hh - o), at(-W - o, -Hh - o), at(-W - o, Hh + o), at(-W - o - t, Hh + o));
      quad(at(W + o, -Hh - o), at(W + o + t, -Hh - o), at(W + o + t, Hh + o), at(W + o, Hh + o));
    };
    frame(0, e); frame(e, e * 0.7);
  }
  const rimBase = nSlots * slotV;
  let rimOn = false;
  const writeRim = (on: boolean, glow: number) => {
    if (!hasRim) return;
    for (let i = 0; i < rimV; i++) {
      const src = i * 3, dst = (rimBase + i) * 3;
      if (on) { mPos[dst] = rimPts[src]; mPos[dst + 1] = rimPts[src + 1]; mPos[dst + 2] = rimPts[src + 2]; } else { mPos[dst] = mPos[dst + 1] = mPos[dst + 2] = 0; }
      const outer = i >= rimV / 2;
      const k = outer ? 0.55 + 0.45 * glow : 0.8 + 0.2 * glow;
      mCol[(rimBase + i) * 4] = Math.min(1, 1.0 * k + 0.1); mCol[(rimBase + i) * 4 + 1] = Math.min(1, 0.78 * k + 0.08); mCol[(rimBase + i) * 4 + 2] = Math.min(1, 0.36 * k);
    }
  };
  const writeColours = () => {
    for (let s = 0; s < nSlots; s++) {
      const m = spots[s].marker;
      const g = m ? GLYPHS[m] : null;
      for (let v = 0; v < slotV; v++) {
        const o = (s * slotV + v) * 4;
        if (g && v * 3 < g.col.length) { mCol[o] = g.col[v * 3]; mCol[o + 1] = g.col[v * 3 + 1]; mCol[o + 2] = g.col[v * 3 + 2]; }
      }
    }
  };

  let view: QuestsView | null = null;
  let forced: Partial<Record<StoryId, Marker>> | null = null;
  let combat = false;
  const apply = () => {
    for (const s of spots) s.marker = forced ? (forced[s.id] ?? null) : markerFor(s.id, view);
    const plaque = spots.find((s) => s.id === 'plaque');
    rimOn = !!plaque && plaque.marker === 'talk';
    writeColours();
    writeRim(rimOn, 1);
    mk.updateVerticesData(VertexBuffer.ColorKind, mCol);
  };

  let T = 0;
  const camPos = new Vector3();
  const update = (dt: number) => {
    T += dt;
    for (const n of views.values()) {
      n.view.update(dt);
      const goal = n.turn ?? n.facing, r = n.view.root.rotation;
      let d = goal - r.y; d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) > 1e-3) r.y += d * Math.min(1, dt * 6);
    }
    const cam = scene.activeCamera;
    if (!cam || nSlots === 0) return;
    camPos.copyFrom(cam.globalPosition);
    const v = cam.getViewMatrix().m;
    const rx = v[0], ry = v[4], rz = v[8], ux = v[1], uy = v[5], uz = v[9], fx = v[2], fy = v[6], fz = v[10];
    for (let s = 0; s < nSlots; s++) {
      const sp = spots[s];
      const g = sp.marker && !(combat && sp.marker === 'busy') ? GLYPHS[sp.marker] : null;
      const a = sp.anchor;
      const d = Math.hypot(a.x - camPos.x, a.y - camPos.y, a.z - camPos.z);
      const show = g && d < 95;
      const sc = markerHeight(d) * (combat ? 0.7 : 1) * (sp.marker === 'busy' ? 0.8 : 1);
      const bob = 0.08 * Math.sin(T * 2.3 + sp.phase);
      const spin = sp.marker === 'talk' ? 0.8 + 0.2 * Math.cos(T * 1.7 + sp.phase) : 1;
      const ay = a.y + bob;
      for (let i = 0; i < slotV; i++) {
        const o = (s * slotV + i) * 3;
        if (!show || i * 3 >= g!.pos.length) { mPos[o] = mPos[o + 1] = mPos[o + 2] = 0; continue; }
        const x = g!.pos[i * 3] * sc * spin, y = g!.pos[i * 3 + 1] * sc, z = g!.pos[i * 3 + 2] * sc;
        mPos[o] = a.x + rx * x + ux * y + fx * z;
        mPos[o + 1] = ay + ry * x + uy * y + fy * z;
        mPos[o + 2] = a.z + rz * x + uz * y + fz * z;
      }
    }
    if (rimOn) { writeRim(true, 0.5 + 0.5 * Math.sin(T * 3.2)); mk.updateVerticesData(VertexBuffer.ColorKind, mCol); }
    mk.updateVerticesData(VertexBuffer.PositionKind, mPos);
  };
  apply();

  const pub: StorySpot[] = spots.map(({ id, x, y, z, eid }) => Object.freeze({ id, x, y, z, eid }));
  return {
    spots: pub,
    setView(v) { view = v; if (!forced) apply(); },
    setMarkers(m) { forced = m; apply(); },
    markerOf(id) { return spots.find((s) => s.id === id)?.marker ?? null; },
    handleTap(tap) {
      const all = tap.entityIds ?? (tap.entityId === null ? [] : [tap.entityId]);
      for (const e of all) {
        const id = storyIdOf(e);
        const spot = id && pub.find((s) => s.id === id);
        if (id && spot) { opts.onTap?.(id, spot); return id; }
      }
      return null;
    },
    face(id, at) {
      const n = views.get(id);
      if (!n) return;
      n.turn = at ? Math.atan2(at.x - n.view.root.position.x, at.z - n.view.root.position.z) : null;
    },
    setInCombat(on) { combat = on; },
    get stats() { return { meshes: meshes.length + views.size, triangles: propTris + nSlots * MARKER_TRIANGLES + (hasRim ? RIM_TRIS : 0) }; },
    update,
    dispose() {
      for (const n of views.values()) n.view.dispose();
      views.clear();
      for (const m of [...meshes, ...proxies]) m.dispose();
      for (const d of disposables) d.dispose();
      root.dispose();
    },
  };
}
