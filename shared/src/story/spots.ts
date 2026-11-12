// Story landmarks: the quest NPCs and props of the opening quest, as authored data. Each spot starts from
// the grove's layout constants or the Greenway's generated layout, and is then moved (if it must be) by one
// deterministic placement rule: the first spot, ring by ring outward, that stands on walkable ground clear
// of obstacles, the town's stalls and board, the statue's plinth, the Greenway's camps and exits, and every
// other story spot. The chosen spots are pinned by a snapshot (spots.test.ts).
//
// Nothing here is in any room's state: every client draws them from this table, and the server checks talk
// and use against it. Built lazily (the Greenway is generated on first use) and deeply frozen.
// Exactly-rounded arithmetic only for positions (+ − × ÷ and sqrt); facings use yawOf (no Math.atan2).
import { SPAWN } from '../constants';
import { BEACON_DIR, DOCK_START, PLINTH_R, TAVERN, TAVERN_YAW, type Obstacle } from '../world/layout';
import { GROVE_OBSTACLES } from '../world/obstacles';
import { GUILD_BOARD, TOWN_STALLS, STALL_IDS, LAMPFALL_MOUTH, greenwayLayout, zoneDef, type SaveZoneId, type ZoneId } from '../world/zones';
import { yawOf } from '../world/dungeon';
import { ENEMY_KINDS } from '../combat/enemies';
import type { QuestId } from '../quests';

export type NpcId = 'marrow' | 'pim' | 'bram' | 'tamsin' | 'nell';
export type PropId = 'plaque' | 'waymark_1' | 'waymark_2' | 'waymark_3' | 'crater_edge';
export const NPC_IDS: readonly NpcId[] = Object.freeze(['marrow', 'pim', 'bram', 'tamsin', 'nell']);
export const PROP_IDS: readonly PropId[] = Object.freeze(['plaque', 'waymark_1', 'waymark_2', 'waymark_3', 'crater_edge']);
export function isNpcId(v: unknown): v is NpcId { return typeof v === 'string' && (NPC_IDS as readonly string[]).includes(v); }
export function isPropId(v: unknown): v is PropId { return typeof v === 'string' && (PROP_IDS as readonly string[]).includes(v); }

/** Talk needs the last accepted pose within this of the NPC (m; the offline demo's INTERACT_RANGE). */
export const NPC_REACH = 3.6;
/** Use needs the last accepted pose within this of the prop (m). */
export const PROP_REACH = 3.0;

export interface StoryNpc {
  readonly id: NpcId; readonly name: string; readonly zone: SaveZoneId;
  readonly x: number; readonly z: number; readonly facing: number;
  /** The quests this NPC offers (QUESTS[q].giver === id; a test keeps the two in step). */
  readonly giver: readonly QuestId[];
}
export interface StoryProp { readonly id: PropId; readonly name: string; readonly zone: SaveZoneId; readonly x: number; readonly z: number }

/** The placement rule's distances (m), rings and directions. */
export const STORY_RULE: { readonly npcClear: 1; readonly storyGap: 3; readonly plinthPad: 0.5; readonly campGap: 12; readonly exitPad: 4; readonly ring: 0.5; readonly maxR: 6; readonly dirs: 16 } =
  Object.freeze({ npcClear: 1, storyGap: 3, plinthPad: 0.5, campGap: 12, exitPad: 4, ring: 0.5, maxR: 6, dirs: 16 } as const);

/**
 * Greenway spots also stand at least this far (m) outside every camp spawn's aggro radius
 * (ENEMY_KINDS[kind].aggro), so nobody is pulled into a fight by reading a stone (campGap alone leaves
 * a spawn 9 m from its camp's centre only 3 m away).
 */
export const STORY_AGGRO_PAD = 2;

const NPC_NAMES_T: Readonly<Record<NpcId, string>> = Object.freeze({
  marrow: 'Old Marrow', pim: 'Pim, the figurehead', bram: 'Bram, the tavern keeper', tamsin: 'Tamsin, the ferrywoman', nell: 'Nell Thistlewood, the road-keeper',
});
const PROP_NAMES_T: Readonly<Record<PropId, string>> = Object.freeze({
  plaque: 'The plaque', waymark_1: 'An old waymark', waymark_2: 'An old waymark', waymark_3: 'An old waymark', crater_edge: "The crater's edge",
});
const GIVERS: Readonly<Record<NpcId, readonly QuestId[]>> = Object.freeze({
  marrow: Object.freeze([]), pim: Object.freeze([]), bram: Object.freeze(['bristle_bounty'] as QuestId[]), tamsin: Object.freeze(['grans_waymarks'] as QuestId[]), nell: Object.freeze([]),
});

/**
 * The ground below the tavern door, where the offline town stands Pim's talk spot (client town.ts's
 * pimGround): TAVERN + fwd × (TAVERN.d / 2 + 2.6), fwd = (sin TAVERN_YAW, cos TAVERN_YAW). TAVERN_YAW is
 * atan2(BEACON_DIR.z, −BEACON_DIR.x) of a unit vector, so fwd = (BEACON_DIR.z, −BEACON_DIR.x) exactly.
 */
export function pimGround(): { x: number; z: number } {
  const k = TAVERN.d / 2 + 2.6;
  return { x: TAVERN.x + BEACON_DIR.z * k, z: TAVERN.z - BEACON_DIR.x * k };
}

// 16 unit directions from +x, turning anticlockwise (towards +z), in exact square roots.
const C8 = Math.sqrt(2 + Math.SQRT2) / 2, S8 = Math.sqrt(2 - Math.SQRT2) / 2, H = Math.SQRT1_2;
const DIRS: readonly (readonly [number, number])[] = Object.freeze(([
  [1, 0], [C8, S8], [H, H], [S8, C8], [0, 1], [-S8, C8], [-H, H], [-C8, S8],
  [-1, 0], [-C8, -S8], [-H, -H], [-S8, -C8], [0, -1], [S8, -C8], [H, -H], [C8, -S8],
] as [number, number][]).map(d => Object.freeze(d)));

/** How far (x, z) is from an obstacle's edge (negative inside). */
function clearance(o: Obstacle, x: number, z: number): number {
  const dx = x - o.x, dz = z - o.z;
  if (o.kind === 'c') return Math.sqrt(dx * dx + dz * dz) - o.r;
  const lx = Math.abs(dx * o.c - dz * o.s) - o.hw, lz = Math.abs(dx * o.s + dz * o.c) - o.hd;
  return lx <= 0 && lz <= 0 ? Math.max(lx, lz) : Math.sqrt(Math.max(lx, 0) ** 2 + Math.max(lz, 0) ** 2);
}
const dist = (ax: number, az: number, bx: number, bz: number) => Math.sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));

function obstaclesOf(zone: SaveZoneId): readonly Obstacle[] {
  return zone === 'grove' ? GROVE_OBSTACLES : greenwayLayout().obstacles;
}

/** Whether (x, z) in `zone` meets the placement rule against the story spots already placed there. */
export function storySpotOk(zone: SaveZoneId, x: number, z: number, placed: readonly { x: number; z: number }[]): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const def = zoneDef(zone), R = STORY_RULE;
  if (def.ground(x, z) === null) return false;
  for (const o of obstaclesOf(zone)) if (clearance(o, x, z) < R.npcClear) return false;
  for (const e of def.exits) if (dist(x, z, e.x, e.z) < e.r + R.exitPad) return false;
  for (const p of placed) if (dist(x, z, p.x, p.z) < R.storyGap) return false;
  if (zone === 'grove') {
    if (dist(x, z, GUILD_BOARD.x, GUILD_BOARD.z) < R.storyGap) return false;
    for (const id of STALL_IDS) if (dist(x, z, TOWN_STALLS[id].x, TOWN_STALLS[id].z) < R.storyGap) return false;
    if (Math.sqrt(x * x + z * z) < PLINTH_R + R.plinthPad) return false;
  } else {
    for (const c of greenwayLayout().camps) {
      if (dist(x, z, c.x, c.z) < R.campGap) return false;
      for (const sp of c.spawns) if (dist(x, z, sp.x, sp.z) < ENEMY_KINDS[sp.kind].aggro + STORY_AGGRO_PAD) return false;
    }
    if (dist(x, z, LAMPFALL_MOUTH.x, LAMPFALL_MOUTH.z) < LAMPFALL_MOUTH.r + R.exitPad) return false;
  }
  return true;
}

/**
 * The placement rule's search: (x, z) itself if it passes, else rings of STORY_RULE.ring m out to
 * STORY_RULE.maxR, STORY_RULE.dirs directions per ring from +x turning anticlockwise; the first spot that
 * passes, or null (a spot with none is a ruling for the plan, never a silent move).
 */
export function searchStorySpot(zone: SaveZoneId, x: number, z: number, placed: readonly { x: number; z: number }[]): { x: number; z: number } | null {
  if (storySpotOk(zone, x, z, placed)) return { x, z };
  const rings = Math.round(STORY_RULE.maxR / STORY_RULE.ring);
  for (let k = 1; k <= rings; k++) {
    const r = k * STORY_RULE.ring;
    for (const [dx, dz] of DIRS) {
      const px = x + dx * r, pz = z + dz * r;
      if (storySpotOk(zone, px, pz, placed)) return { x: px, z: pz };
    }
  }
  return null;
}

/** Wraps a yaw into (−π, π]. */
const wrap = (a: number) => (a > Math.PI ? a - 2 * Math.PI : a <= -Math.PI ? a + 2 * Math.PI : a);

interface Spots { npcs: Readonly<Record<NpcId, StoryNpc>>; props: Readonly<Record<PropId, StoryProp>> }
let built: Spots | null = null;

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

function place(zone: SaveZoneId, id: string, x: number, z: number, placed: Record<SaveZoneId, { x: number; z: number }[]>): { x: number; z: number } {
  const s = searchStorySpot(zone, x, z, placed[zone]);
  if (!s) throw new Error(`Story spot '${id}' has no valid ground within ${STORY_RULE.maxR} m of (${x}, ${z}) in ${zone}`);
  placed[zone].push(s);
  return s;
}

function build(): Spots {
  const placed: Record<SaveZoneId, { x: number; z: number }[]> = { grove: [], greenway: [] };
  const gw = greenwayLayout();
  const pg = pimGround();
  const marrow = place('grove', 'marrow', -3.3, -6.4, placed);
  const pim = place('grove', 'pim', pg.x, pg.z, placed);
  const bram = place('grove', 'bram', pg.x + 2.2, pg.z + 1.2, placed);
  const t = DOCK_START - 2;
  const tamsin = place('grove', 'tamsin', BEACON_DIR.x * t - BEACON_DIR.z * 2, BEACON_DIR.z * t + BEACON_DIR.x * 2, placed);
  const e = gw.entry, fx = sinOf(e.facing), fz = cosOf(e.facing);
  const nell = place('greenway', 'nell', e.x + fx * 6 - fz * 2.5, e.z + fz * 6 + fx * 2.5, placed);
  const plaque = place('grove', 'plaque', 0, -5.3, placed);
  const wx = (f: number) => gw.westGate.x + f * (gw.mouth.x - gw.westGate.x);
  const way = (f: number, id: string) => { const x = wx(f); return place('greenway', id, x, gw.roadZ(x) + 4, placed); };
  const w1 = way(0.3, 'waymark_1'), w2 = way(0.55, 'waymark_2'), w3 = way(0.8, 'waymark_3');
  const cx = gw.mouth.x - 7;
  const crater = place('greenway', 'crater_edge', cx, gw.roadZ(cx) - 3.5, placed);

  const npc = (id: NpcId, zone: SaveZoneId, s: { x: number; z: number }, facing: number): StoryNpc =>
    ({ id, name: NPC_NAMES_T[id], zone, x: s.x, z: s.z, facing: wrap(facing), giver: GIVERS[id] });
  const prop = (id: PropId, zone: SaveZoneId, s: { x: number; z: number }): StoryProp => ({ id, name: PROP_NAMES_T[id], zone, x: s.x, z: s.z });
  return deepFreeze({
    npcs: {
      marrow: npc('marrow', 'grove', marrow, yawOf(SPAWN.x - marrow.x, SPAWN.z - marrow.z)),
      pim: npc('pim', 'grove', pim, TAVERN_YAW + Math.PI),
      bram: npc('bram', 'grove', bram, yawOf(pim.x - bram.x, pim.z - bram.z) + Math.PI),
      tamsin: npc('tamsin', 'grove', tamsin, yawOf(BEACON_DIR.x, BEACON_DIR.z)),
      nell: npc('nell', 'greenway', nell, yawOf(e.x - nell.x, e.z - nell.z)),
    },
    props: {
      plaque: prop('plaque', 'grove', plaque),
      waymark_1: prop('waymark_1', 'greenway', w1), waymark_2: prop('waymark_2', 'greenway', w2), waymark_3: prop('waymark_3', 'greenway', w3),
      crater_edge: prop('crater_edge', 'greenway', crater),
    },
  });
}
/** The entry's facing is one of the four axis yaws (the recipe's ±π/2, 0, π); exact for those, else 0-safe. */
function sinOf(f: number): number { return axis(f)[0]; }
function cosOf(f: number): number { return axis(f)[1]; }
function axis(f: number): [number, number] {
  const q = Math.round(f / (Math.PI / 2));
  if (Math.abs(f - q * (Math.PI / 2)) > 1e-9) throw new Error(`Story spots: the Greenway entry's facing ${f} is not an axis yaw`);
  return ([[0, 1], [1, 0], [0, -1], [-1, 0]] as [number, number][])[((q % 4) + 4) % 4]!;
}

const spots = () => (built ??= build());

function lazyTable<K extends string, V>(ids: readonly K[], get: (id: K) => V): Readonly<Record<K, V>> {
  const o = {} as Record<K, V>;
  for (const id of ids) Object.defineProperty(o, id, { get: () => get(id), enumerable: true });
  return Object.freeze(o);
}
/** Every quest NPC: where it stands (after the placement rule), which way it faces, what it offers. */
export const STORY_NPCS: Readonly<Record<NpcId, StoryNpc>> = lazyTable(NPC_IDS, id => spots().npcs[id]);
/** Every quest prop: where it stands (after the placement rule). */
export const STORY_PROPS: Readonly<Record<PropId, StoryProp>> = lazyTable(PROP_IDS, id => spots().props[id]);

function nearest<K extends string>(ids: readonly K[], table: Readonly<Record<K, { zone: SaveZoneId; x: number; z: number }>>, reach: number, zone: ZoneId, x: number, z: number, fuzz: number): K | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const f = Number.isFinite(fuzz) && fuzz > 0 ? fuzz : 0;
  let best: K | null = null, bestD = reach + f;
  for (const id of ids) {
    const s = table[id];
    if (s.zone !== zone) continue;
    const d = dist(s.x, s.z, x, z);
    if (d <= bestD) { best = id; bestD = d; }
  }
  return best;
}
/** The nearest NPC in `zone` within NPC_REACH (+ fuzz) of (x, z), or null. */
export function npcAt(zone: ZoneId, x: number, z: number, fuzz = 0): NpcId | null { return nearest(NPC_IDS, STORY_NPCS, NPC_REACH, zone, x, z, fuzz); }
/** The nearest prop in `zone` within PROP_REACH (+ fuzz) of (x, z), or null. */
export function propAt(zone: ZoneId, x: number, z: number, fuzz = 0): PropId | null { return nearest(PROP_IDS, STORY_PROPS, PROP_REACH, zone, x, z, fuzz); }

/** Whether NPC `id` stands in `zone` within NPC_REACH (+ fuzz) of (x, z). */
export function npcInReach(id: NpcId, zone: ZoneId, x: number, z: number, fuzz = 0): boolean {
  const s = STORY_NPCS[id];
  return s.zone === zone && Number.isFinite(x) && Number.isFinite(z) && dist(s.x, s.z, x, z) <= NPC_REACH + (Number.isFinite(fuzz) && fuzz > 0 ? fuzz : 0);
}
/** Whether prop `id` stands in `zone` within PROP_REACH (+ fuzz) of (x, z). */
export function propInReach(id: PropId, zone: ZoneId, x: number, z: number, fuzz = 0): boolean {
  const s = STORY_PROPS[id];
  return s.zone === zone && Number.isFinite(x) && Number.isFinite(z) && dist(s.x, s.z, x, z) <= PROP_REACH + (Number.isFinite(fuzz) && fuzz > 0 ? fuzz : 0);
}
