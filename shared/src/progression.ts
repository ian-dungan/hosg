// Progression: the job level curve (and the one-time migration of Plan 3b's stub xp), base stats by
// level, catch-up xp and the talent row levels. Pure data and arithmetic: no runtime imports but
// deepFreeze, so any module may import this one at the top level.
import { deepFreeze } from './combat/freeze';
import type { JobId, JobsSave } from './combat/jobs';
import type { Stats } from './combat/stats';

/** Job levels run from 1 to this. */
export const JOB_LEVEL_CAP = 10;
/** The xp from level L to L + 1 (index L − 1): 3180 xp from level 1 to the cap. */
export const XP_TO_NEXT: readonly number[] = deepFreeze([100, 140, 190, 250, 320, 400, 490, 590, 700]);
/** JobsSave.curve: a save without it holds Plan 3b's stub xp (100 a level), converted once on read. */
export const XP_CURVE_VERSION = 2;
/** Kill and clear xp for a job below the adventurer's highest job level is multiplied by this (then floored). */
export const CATCH_UP_MULT = 1.5;
/** Xp for each Lampfall pack encounter cleared, to every credited adventurer (each pack enemy's KILL_XP still counts). */
export const CLEAR_XP = 30;
/** Talent rows 1, 2 and 3 unlock at these job levels. */
export const TALENT_LEVELS: readonly [4, 7, 10] = deepFreeze([4, 7, 10] as [4, 7, 10]);

/** The stub curve of Plan 3b: 100 xp a level. Only migrateStubXp reads it. */
const STUB_XP_PER_LEVEL = 100;

const cleanXp = (xp: number) => (Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0);
const clampLevel = (level: number) => (Number.isFinite(level) ? Math.min(JOB_LEVEL_CAP, Math.max(1, Math.floor(level))) : 1);

/** The xp from level 1 to `level` (clamped to 1..JOB_LEVEL_CAP): totalTo(1) = 0, totalTo(10) = 3180. */
export function totalTo(level: number): number {
  const l = clampLevel(level);
  let sum = 0;
  for (let i = 0; i < l - 1; i++) sum += XP_TO_NEXT[i]!;
  return sum;
}

/** The highest level whose totalTo is at most `xp`, capped at JOB_LEVEL_CAP; a bad or negative xp is level 1. */
export function levelForXp(xp: number): number {
  const x = cleanXp(xp);
  let level = 1;
  while (level < JOB_LEVEL_CAP && totalTo(level + 1) <= x) level++;
  return level;
}

/** The xp still needed for the next level (0 at the cap). */
export function xpToNext(xp: number): number {
  const level = levelForXp(xp);
  return level >= JOB_LEVEL_CAP ? 0 : totalTo(level + 1) - cleanXp(xp);
}

/**
 * Plan 3b's stub xp on the new curve, keeping the level and its share of progress: the old level is
 * Lo = min(10, 1 + floor(xp / 100)) and the progress p = (xp mod 100) / 100; the result is
 * totalTo(Lo) + floor(p · XP_TO_NEXT[Lo − 1]), or totalTo(10) at the cap. A bad or negative xp is 0.
 */
export function migrateStubXp(xp: number): number {
  const x = cleanXp(xp);
  const lo = Math.min(JOB_LEVEL_CAP, 1 + Math.floor(x / STUB_XP_PER_LEVEL));
  if (lo >= JOB_LEVEL_CAP) return totalTo(JOB_LEVEL_CAP);
  const p = (x % STUB_XP_PER_LEVEL) / STUB_XP_PER_LEVEL;
  return totalTo(lo) + Math.floor(p * XP_TO_NEXT[lo - 1]!);
}

// ───────── base stats by level ─────────
/** Base stats at level 1 (tunable: power 5–7, defence 4–6, maxHp 64–80) and at the cap (fixed: with the starter kit's 1 / 2 / 10 they make STARTER_STATS). */
export const BASE_STATS_L1: Readonly<Stats> = deepFreeze({ power: 6, defence: 5, maxHp: 72 });
export const BASE_STATS_L10: Readonly<Stats> = deepFreeze({ power: 9, defence: 8, maxHp: 90 });

/**
 * The stats a job level gives before gear: power and defence rise evenly from BASE_STATS_L1 to
 * BASE_STATS_L10, maxHp evenly rounded down per level. Levels outside 1..10 clamp. A fresh object.
 */
export function baseStats(level: number): Stats {
  const steps = clampLevel(level) - 1, n = JOB_LEVEL_CAP - 1;
  const lerp = (a: number, b: number) => a + ((b - a) * steps) / n;
  return {
    power: lerp(BASE_STATS_L1.power, BASE_STATS_L10.power),
    defence: lerp(BASE_STATS_L1.defence, BASE_STATS_L10.defence),
    maxHp: BASE_STATS_L1.maxHp + Math.floor(((BASE_STATS_L10.maxHp - BASE_STATS_L1.maxHp) * steps) / n),
  };
}

/** The starting jobs (JOB_IDS, restated, and a test holds them equal: jobs.ts imports this module, so it cannot be read here at the top level). */
export const JOB_IDS_LOCAL: readonly JobId[] = Object.freeze(['warrior', 'ranger', 'paladin', 'dark_knight', 'ninja', 'white_mage', 'black_mage']);

/** CATCH_UP_MULT when `job`'s level is below the highest level of any starting job in the save (future-job records are ignored), else 1. Levels come from xp. */
export function catchUp(s: JobsSave, job: JobId): number {
  let highest = 1;
  for (const id of JOB_IDS_LOCAL) { const r = s.jobs[id]; if (r) highest = Math.max(highest, levelForXp(r.xp)); }
  const own = s.jobs[job];
  return (own ? levelForXp(own.xp) : 1) < highest ? CATCH_UP_MULT : 1;
}
