// Personal loot: at a kill every credited adventurer rolls its own gold and item, server-side, with its
// own seeded generator keyed by (server seed, room id, enemy id, kill counter, account id), so the same
// kill always rolls the same thing for the same adventurer and nothing can be rolled twice. There are no
// ground drops, no random stats and nothing to pick up or steal. Item and gold numbers are economy
// numbers (not tuned by Task 5).
import { deepFreeze } from './combat/freeze';
import type { EncounterId } from './combat/encounters';
import type { EnemyKindId } from './combat/enemies';
import type { JobId } from './combat/jobs';
import { cyrb53 } from './hash';
import { ARMOUR_SLOTS, JOB_ARMOUR, OFFHAND_FOR, tierSet, tierWeapon, type ArmourType, type ItemId } from './items';
import { JOBS } from './combat/jobs';
import type { ZoneId } from './world/zones';

export { cyrb53 };

export type LootSource = { kind: EnemyKindId; zone: ZoneId } | { clear: EncounterId };
/** owned: every item id the adventurer holds (bag, bank or worn). day: today's UTC day (YYYY-MM-DD). */
export interface LootCtx {
  job: JobId; owned: ReadonlySet<ItemId>; day: string;
  lootDays: { readonly wickhound: string | null; readonly fallen_warden: string | null };
}
export type DailyKey = 'wickhound' | 'fallen_warden';
export interface LootRow { gold: [number, number]; chance: number; tier: 1 | 2 | 3 | null; daily?: DailyKey }

const ROWS = deepFreeze({
  greenOrdinary: { gold: [1, 3], chance: 0.06, tier: 1 },
  greenElite: { gold: [6, 10], chance: 0.3, tier: 1 },
  lampOrdinary: { gold: [2, 4], chance: 0.08, tier: 2 },
  lampElite: { gold: [8, 12], chance: 0.25, tier: 2 },
  wickhound: { gold: [25, 25], chance: 0.25, tier: 2, daily: 'wickhound' },
  warden: { gold: [60, 60], chance: 0.1, tier: 3, daily: 'fallen_warden' },
  clear: { gold: [10, 10], chance: 0, tier: null },
  none: { gold: [0, 0], chance: 0, tier: null },
} as const);
/** Gold for each Lampfall pack encounter cleared (plus CLEAR_XP). Boss rooms give nothing for the clear: the boss kill is the reward. */
export const PACK_ENCOUNTERS: readonly EncounterId[] = Object.freeze(['root_cellar', 'brass_gallery', 'cog_hall']);

const copy = (r: { gold: readonly [number, number]; chance: number; tier: 1 | 2 | 3 | null; daily?: DailyKey }): LootRow =>
  ({ gold: [r.gold[0], r.gold[1]], chance: r.chance, tier: r.tier, ...(r.daily ? { daily: r.daily } : {}) });

/** The source's row: a fresh object. Anything unknown gives nothing. */
export function lootTable(src: LootSource): LootRow {
  if (typeof src !== 'object' || src === null) return copy(ROWS.none);
  if ('clear' in src) return copy((PACK_ENCOUNTERS as readonly unknown[]).includes(src.clear) ? ROWS.clear : ROWS.none);
  const lamp = src.zone === 'lampfall';
  switch (src.kind) {
    case 'thornling': case 'boar': case 'archer': return copy(lamp ? ROWS.lampOrdinary : ROWS.greenOrdinary);
    case 'mossback': return copy(lamp ? ROWS.lampElite : ROWS.greenElite);
    case 'wickhound': return copy(ROWS.wickhound);
    case 'fallen_warden': return copy(ROWS.warden);
    default: return copy(ROWS.none);
  }
}

/** mulberry32 seeded with cyrb53 of the parts joined by '|': loot's own generator (never the engine's). */
export function lootRng(seedParts: readonly (string | number)[]): () => number {
  let a = cyrb53(seedParts.join('|')) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Re-rolls of the slot and type when the drawn item is already owned (after that the duplicate stands). */
export const LOOT_REROLLS = 3;
/** The chance a drop is the job's weapon or off-hand (an off-hand only when the weapon takes one: half of it). */
export const LOOT_WEAPON_CHANCE = 0.25;
/** The chance armour is the job's own JOB_ARMOUR type (else one of the other two, evenly). */
export const LOOT_OWN_TYPE = 0.6;

const TYPES: readonly Exclude<ArmourType, 'plain'>[] = ['cloth', 'light', 'heavy'];

function drawItem(tier: 1 | 2 | 3, job: JobId, rng: () => number): ItemId {
  if (rng() < LOOT_WEAPON_CHANCE) {
    const offhand = OFFHAND_FOR[JOBS[job].weapon] !== null && rng() < 0.5;
    return tierWeapon(tier, job, offhand ? 'offhand' : 'weapon')!;
  }
  const slot = ARMOUR_SLOTS[Math.floor(rng() * ARMOUR_SLOTS.length)]!;
  const mine = JOB_ARMOUR[job];
  const type = rng() < LOOT_OWN_TYPE ? mine : TYPES.filter(t => t !== mine)[rng() < 0.5 ? 0 : 1]!;
  return `${tierSet(tier, type)}_${slot}`;
}

/**
 * Which item of `tier` a drop is for `job`: the weapon or off-hand slot with LOOT_WEAPON_CHANCE, else an
 * armour slot chosen evenly with the type JOB_ARMOUR at LOOT_OWN_TYPE; an owned id is re-drawn up to
 * LOOT_REROLLS times. A T3 staff is the job's own named staff.
 */
export function pickLootItem(tier: 1 | 2 | 3, job: JobId, owned: ReadonlySet<ItemId>, rng: () => number): ItemId {
  let id = drawItem(tier, job, rng);
  for (let i = 0; i < LOOT_REROLLS && owned.has(id); i++) id = drawItem(tier, job, rng);
  return id;
}

/**
 * The adventurer's roll for one kill or clear: gold uniform in the row's range, then the item. `daily`:
 * the row's guaranteed first drop of the UTC day was used (lootDays[key] !== day); the server then records
 * the day with addLoot; a `day` that is not YYYY-MM-DD gives no daily drop. Never throws; an unknown source or job rolls nothing.
 */
/** A UTC day as rollLoot takes it: YYYY-MM-DD. */
const LOOT_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export function rollLoot(src: LootSource, ctx: LootCtx, seedParts: readonly (string | number)[]): { gold: number; item: ItemId | null; daily: boolean } {
  const row = lootTable(src);
  const rng = lootRng(seedParts);
  const [lo, hi] = row.gold;
  const gold = lo + Math.floor(rng() * (hi - lo + 1));
  if (row.tier === null || !Object.prototype.hasOwnProperty.call(JOBS, ctx.job)) return { gold, item: null, daily: false };
  // a malformed day never counts as a new day (else every kill would be the day's first)
  const daily = row.daily !== undefined && typeof ctx.day === 'string' && LOOT_DAY.test(ctx.day) && ctx.lootDays[row.daily] !== ctx.day;
  const drops = daily || rng() < row.chance;
  if (!drops) return { gold, item: null, daily: false };
  return { gold, item: pickLootItem(row.tier, ctx.job, ctx.owned, rng), daily };
}
