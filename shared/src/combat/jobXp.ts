// Per-job XP: a stub curve (Plan 5 replaces it). Each credited adventurer's current job gains a kill's
// XP; in 3b a level changes nothing in combat.
import { deepFreeze } from './freeze';
import type { EnemyKindId } from './enemies';
import { recordFor, type JobId, type JobsSave } from './jobs';

export const XP_PER_LEVEL = 100;
export const JOB_LEVEL_CAP = 10;
export const KILL_XP: Readonly<Record<EnemyKindId, number>> = deepFreeze({ thornling: 10, boar: 10, archer: 10, mossback: 40, dummy: 0 });

const clean = (xp: number) => (Number.isFinite(xp) && xp > 0 ? xp : 0);

/** min(JOB_LEVEL_CAP, 1 + floor(xp / XP_PER_LEVEL)); a bad or negative xp is level 1. */
export function levelForXp(xp: number): number {
  return Math.min(JOB_LEVEL_CAP, 1 + Math.floor(clean(xp) / XP_PER_LEVEL));
}

/** The xp still needed for the next level (0 at the cap). */
export function xpToNext(xp: number): number {
  const level = levelForXp(xp);
  return level >= JOB_LEVEL_CAP ? 0 : level * XP_PER_LEVEL - clean(xp);
}

/** `job` gains `xp` (a bad or negative amount counts as 0, fractions are floored). Pure: returns a copy of the save. */
export function addJobXp(s: JobsSave, job: JobId, xp: number): { save: JobsSave; level: number; levelUp: boolean } {
  const rec = recordFor(s, job);
  const before = levelForXp(rec.xp);
  const total = rec.xp + Math.floor(clean(xp));
  const level = levelForXp(total);
  const jobs: JobsSave['jobs'] = {};
  for (const [k, r] of Object.entries(s.jobs) as [keyof JobsSave['jobs'], NonNullable<JobsSave['jobs'][JobId]>][]) {
    jobs[k] = { ...r, picks: [r.picks[0], r.picks[1]], talents: [...r.talents] };
  }
  jobs[job] = { ...rec, level, xp: total, picks: [rec.picks[0], rec.picks[1]], talents: [...rec.talents] };
  return { save: { current: s.current, jobs }, level, levelUp: level > before };
}
