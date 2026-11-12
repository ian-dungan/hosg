// Plan 4 bands, the Fallen Warden for two (Task 5): W1 (a strong duo) and W3 (an average duo).
import { describe, expect, it } from 'vitest';
import { ABILITIES } from './abilities';
import { JOBS, type JobId } from './jobs';
import { STRONG_PAIRS, mean, runs, seeds, wins } from './bandRig';

const S10 = seeds(1, 10);
/** An interrupt in the job's bar or duo picks (an `interrupts` ability, or Charged Shot at a full draw). */
const interrupts = (j: JobId) => [...JOBS[j].bar, ...JOBS[j].picks.duo].some((id) => ABILITIES[id].interrupts === true || id === 'charged_shot');

describe('the Fallen Warden, duos', { timeout: 120_000 }, () => {
  it('W1: a strong duo beats the Warden', () => {
    const all = STRONG_PAIRS.map(([a, b]) => runs('warden', [a, b], 'careful', S10));
    expect(all.reduce((s, rs) => s + wins(rs), 0)).toBeGreaterThanOrEqual(48);
    all.forEach((rs, i) => {
      const [a, b] = STRONG_PAIRS[i];
      expect(wins(rs), `${a} + ${b}`).toBeGreaterThanOrEqual(6);
      expect(mean(rs.map((r) => r.breaks)), `${a} + ${b}: breaks a run`).toBeGreaterThanOrEqual(2);
      if (interrupts(a) || interrupts(b)) expect(mean(rs.map((r) => r.interruptedBy.keepers_toll ?? 0)), `${a} + ${b}: Toll interrupts a run`).toBeGreaterThanOrEqual(1);
    });
    const t = mean(all.flatMap((rs) => rs.filter((r) => r.won).map((r) => r.ttk!)));
    expect(t).toBeGreaterThanOrEqual(220);
    expect(t).toBeLessThanOrEqual(330);
  });

  it('W3: an average duo usually loses or barely wins', () => {
    const w = STRONG_PAIRS.reduce((s, [a, b]) => s + wins(runs('warden', [a, b], 'sloppy', S10)), 0);
    expect(w).toBeGreaterThanOrEqual(3);
    expect(w).toBeLessThanOrEqual(30);
  });
});
