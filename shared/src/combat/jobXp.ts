// Per-job XP. Each credited adventurer's current job gains a kill's XP (× catchUp, applied by the
// caller). The curve itself lives in progression.ts and is re-exported here.
import { deepFreeze } from './freeze';
import type { EnemyKindId } from './enemies';
import { recordFor, type JobId, type JobsSave } from './jobs';
import { JOB_LEVEL_CAP, XP_TO_NEXT, levelForXp, totalTo } from '../progression';

export { JOB_LEVEL_CAP, XP_TO_NEXT, levelForXp, xpToNext, totalTo } from '../progression';

/** @deprecated Plan 3b's stub curve had 100 xp per level; this is now XP_TO_NEXT[0] (the xp from level 1 to 2). */
export const XP_PER_LEVEL: number = XP_TO_NEXT[0]!;
export const KILL_XP: Readonly<Record<EnemyKindId, number>> = deepFreeze({
  thornling: 10, boar: 10, archer: 10, mossback: 40, dummy: 0, wickhound: 120, fallen_warden: 300, lens_shard: 0,
});

const clean = (xp: number) => (Number.isFinite(xp) && xp > 0 ? xp : 0);

/**
 * `job` gains `xp` (a bad or negative amount counts as 0, fractions are floored), capped at
 * totalTo(JOB_LEVEL_CAP). Pure: returns a copy of the save, on the current curve (curve: 2).
 */
export function addJobXp(s: JobsSave, job: JobId, xp: number): { save: JobsSave; level: number; levelUp: boolean } {
  const rec = recordFor(s, job);
  const before = levelForXp(rec.xp);
  const total = Math.min(totalTo(JOB_LEVEL_CAP), rec.xp + Math.floor(clean(xp)));
  const level = levelForXp(total);
  const jobs: JobsSave['jobs'] = {};
  for (const [k, r] of Object.entries(s.jobs) as [keyof JobsSave['jobs'], NonNullable<JobsSave['jobs'][JobId]>][]) {
    jobs[k] = copyRecord(r);
  }
  jobs[job] = { ...copyRecord(rec), level, xp: total };
  return { save: { current: s.current, jobs, curve: 2 }, level, levelUp: level > before };
}

const copyRecord = (r: NonNullable<JobsSave['jobs'][JobId]>) => ({
  ...r, picks: [r.picks[0], r.picks[1]] as [typeof r.picks[0], typeof r.picks[1]], talents: [...r.talents], outfit: r.outfit ? { ...r.outfit } : null,
});
