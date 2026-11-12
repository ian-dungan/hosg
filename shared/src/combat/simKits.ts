// The simulation's kits (Plan 5): a member's Kit from its job, level, gear tier and talents, through the
// real kitFor and kitItems, and the band helpers (the duo set and the 3 SD headroom rule). Pure.
import { kitFor } from '../kit';
import { kitItems, type GearSlot, type ItemId } from '../items';
import type { Kit } from '../mods';
import { SIM_TALENTS } from '../talents';
import type { JobId } from './jobs';

/** A sim kit tier: the starter kit, or a full T1–T3 kit in the job's JOB_ARMOUR set (5-piece bonus on) with that tier's weapon and off-hand. */
export type SimGear = 'starter' | 1 | 2 | 3;
export const SIM_GEAR: readonly SimGear[] = Object.freeze(['starter', 1, 2, 3] as SimGear[]);

/**
 * `job` at `level` (default 10) in `gear` (default the starter kit) with `talents` ('sim': SIM_TALENTS[job];
 * default none), through kitFor. `items` replaces single slots of that kit (a set or weapon comparison);
 * a slot set to null is the starter piece. At level 10, starter, no talents: STARTER_STATS and no mods (P1).
 */
export function simKit(o: {
  job: JobId; level?: number; gear?: SimGear; talents?: readonly string[] | 'sim';
  items?: Partial<Record<GearSlot, ItemId | null>>;
}): Kit {
  const worn: Partial<Record<GearSlot, ItemId>> = {};
  const put = (g: Partial<Record<GearSlot, ItemId | null>>) => {
    for (const [s, id] of Object.entries(g) as [GearSlot, ItemId | null][]) { if (id) worn[s] = id; else delete worn[s]; }
  };
  if (o.gear !== undefined && o.gear !== 'starter') put(kitItems(o.gear, o.job));
  if (o.items) put(o.items);
  const talents = o.talents === 'sim' ? SIM_TALENTS[o.job] : o.talents ?? [];
  return kitFor({ job: o.job, level: o.level ?? 10, gear: worn, talents });
}
/** The same, by name: SIM_KITS[tier](job, level, talents). */
export const SIM_KITS: Readonly<Record<SimGear, (job: JobId, level?: number, talents?: readonly string[] | 'sim') => Kit>> = Object.freeze({
  starter: (job: JobId, level?: number, talents?: readonly string[] | 'sim') => simKit({ job, level, gear: 'starter', talents }),
  1: (job: JobId, level?: number, talents?: readonly string[] | 'sim') => simKit({ job, level, gear: 1, talents }),
  2: (job: JobId, level?: number, talents?: readonly string[] | 'sim') => simKit({ job, level, gear: 2, talents }),
  3: (job: JobId, level?: number, talents?: readonly string[] | 'sim') => simKit({ job, level, gear: 3, talents }),
});

/** The gear bands' duos: four of Plan 4's STRONG_PAIRS (80 runs over 20 seeds). */
export const GEAR_PAIRS: readonly (readonly [JobId, JobId])[] = Object.freeze([
  Object.freeze(['paladin', 'black_mage'] as const), Object.freeze(['warrior', 'white_mage'] as const),
  Object.freeze(['ninja', 'white_mage'] as const), Object.freeze(['dark_knight', 'ranger'] as const),
]);

/**
 * The band rule's headroom of a count k of n against a threshold t: (k − t) for 'atLeast', (t − k) for
 * 'atMost', over 3·√(n·p̂·(1 − p̂)) with p̂ = k / n (0 → 0.5 / n, 1 → 1 − 0.5 / n). At least 1 passes.
 */
export function headroom(k: number, n: number, t: number, dir: 'atLeast' | 'atMost'): number {
  let p = k / n;
  if (p <= 0) p = 0.5 / n; else if (p >= 1) p = 1 - 0.5 / n;
  const sd3 = 3 * Math.sqrt(n * p * (1 - p));
  return (dir === 'atLeast' ? k - t : t - k) / sd3;
}
