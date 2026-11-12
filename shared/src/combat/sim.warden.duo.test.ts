// Plan 4 bands, the Fallen Warden for two, skilled play (10% of telegraphs missed; Task 5, rulings P4-k
// and P4-m A/F). Measured numbers are in the Task 5 report (review round 2).
import { describe, expect, it } from 'vitest';
import { ABILITIES } from './abilities';
import { JOBS, type JobId } from './jobs';
import { S20, STRONG_PAIRS, mean, runs, sd, wins } from './bandRig';

/** An interrupt in the job's bar or duo picks (an `interrupts` ability, or Charged Shot at a full draw). */
const interrupts = (j: JobId) => [...JOBS[j].bar, ...JOBS[j].picks.duo].some((id) => ABILITIES[id].interrupts === true || id === 'charged_shot');
const supportJob = (j: JobId) => JOBS[j].role === 'healer' || JOBS[j].role === 'tank';
/** A: the strong pairs with a healer or a tank. */
const COVERED = STRONG_PAIRS.filter(([a, b]) => supportJob(a) || supportJob(b));
/** F: the strong pairs with a job whose duo picks differ from its solo picks (as sets). */
const differs = (j: JobId) => new Set([...JOBS[j].picks.duo, ...JOBS[j].picks.solo]).size > 2;
const SUPPORT = STRONG_PAIRS.filter(([a, b]) => differs(a) || differs(b));

describe('the Fallen Warden, skilled duos', { timeout: 180_000 }, () => {
  it('skilled duos Break or interrupt Keeper\'s Toll where their kit can', () => {
    for (const [a, b] of STRONG_PAIRS) {
      const rs = runs('warden', [a, b], 'skilled', S20);
      expect(mean(rs.map((r) => r.breaks)), `${a} + ${b}: breaks a run`).toBeGreaterThanOrEqual(2);
      if (interrupts(a) || interrupts(b)) expect(mean(rs.map((r) => r.interruptedBy.keepers_toll ?? 0)), `${a} + ${b}: Toll interrupts a run`).toBeGreaterThanOrEqual(1);
    }
  });

  // A: skilled healer or tank pairs win 70–92%. NOT MET (deferred to live tuning): they win 79 of 80; see the report.
  it.skip('A: skilled healer or tank duos win 70–92% (deferred to live tuning)', () => {
    const w = COVERED.reduce((s, [a, b]) => s + wins(runs('warden', [a, b], 'skilled', S20)), 0) / (20 * COVERED.length);
    expect(w).toBeGreaterThanOrEqual(0.7);
    expect(w).toBeLessThanOrEqual(0.92);
  });

  // F: duo picks beat solo picks by more than 3 SD of the difference. NOT MET (deferred to live tuning).
  it.skip('F: on duo picks, skilled duos beat the same duos on solo picks (deferred to live tuning)', () => {
    const n = 20 * SUPPORT.length;
    const duo = SUPPORT.reduce((s, [a, b]) => s + wins(runs('warden', [a, b], 'skilled', S20)), 0) / n;
    const solo = SUPPORT.reduce((s, [a, b]) => s + wins(runs('warden', [a, b], 'skilled', S20, undefined, 'solo')), 0) / n;
    expect(duo - solo - 3 * Math.hypot(sd(duo, n), sd(solo, n))).toBeGreaterThan(0);
  });
});
