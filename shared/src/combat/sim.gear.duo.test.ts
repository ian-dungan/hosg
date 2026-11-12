// Plan 5 gear bands for two (Task 5): G2, G3, F2 and the T3 "usually wins" band, GEAR_PAIRS on the
// Fallen Warden at level 10 with SIM_TALENTS. Measured numbers (both seed sets) are in the Task 5 report.
import { describe, expect, it } from 'vitest';
import { GEAR_PAIRS, S20, table, wardenRuns, wins } from './gearRig';
import type { Skill } from './sim';
import type { SimGear } from './simKits';

const runs = (skill: Skill, gear: SimGear) => GEAR_PAIRS.map((p) => [p.join(' + '), wardenRuns(p, skill, S20, { gear, talents: 'sim' })] as [string, ReturnType<typeof wardenRuns>]);
const total = (rows: ReturnType<typeof runs>) => rows.reduce((s, [, rs]) => s + wins(rs), 0);

describe('the Fallen Warden in gear, duos', { timeout: 240_000 }, () => {
  it('G2: dungeon gear turns an average (sloppy) duo into a winner: T2 wins at least 48 of 80, every pair at least 10 of 20', () => {
    const t2 = runs('sloppy', 2);
    expect(total(t2), table(t2)).toBeGreaterThanOrEqual(48);
    for (const [label, rs] of t2) expect(wins(rs), label + table(t2)).toBeGreaterThanOrEqual(10);
  });
  it('G2b: T2 is clearly better than the starter kit for sloppy duos: more wins by over 3 SD of the difference', () => {
    const t2 = runs('sloppy', 2), st = runs('sloppy', 'starter');
    const n = 20 * GEAR_PAIRS.length, a = total(t2) / n, b = total(st) / n;
    expect(n * (a - b) - 3 * Math.sqrt(n * (a * (1 - a) + b * (1 - b))), table([...st, ...t2])).toBeGreaterThan(0);
  });
  // NOT MET (deferred to live tuning): the starter kit at level 10 is Plan 4's adventurer (P1), so sloppy
  // GEAR_PAIRS in starter gear win about what Plan 4 measured: 51 of 80 on seeds 1–20 and 55 on 1001–1020
  // with SIM_TALENTS (Plan 4, no talents: 40 of 80). A ceiling of 40 with 3 SD headroom cannot hold
  // beside P1; the coordinator's restated target ("starter ≈ Plan 4") holds.
  it.skip('G2: sloppy duos in the starter kit win at most 40 of 80 (deferred to live tuning)', () => {
    expect(total(runs('sloppy', 'starter'))).toBeLessThanOrEqual(40);
  });
  it('G3: T1 is a real but small step: starter ≤ T1 ≤ T2 (sloppy, the same seeds)', () => {
    const st = runs('sloppy', 'starter'), t1 = runs('sloppy', 1), t2 = runs('sloppy', 2);
    const msg = table([...st, ...t1, ...t2]);
    expect(total(t1), msg).toBeGreaterThanOrEqual(total(st));
    expect(total(t2), msg).toBeGreaterThanOrEqual(total(t1));
  });
  it('G7: top gear usually wins for an average duo: sloppy duos in T3 win at least 64 of 80', () => {
    const t3 = runs('sloppy', 3);
    expect(total(t3), table(t3)).toBeGreaterThanOrEqual(64);
  });
  it('F2: careless play still dies in top gear: careless duos in T3 win at most 64 of 80', () => {
    const t3 = runs('careless', 3);
    expect(total(t3), table(t3)).toBeLessThanOrEqual(64);
  });
});
