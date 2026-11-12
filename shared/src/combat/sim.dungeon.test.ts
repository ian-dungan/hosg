// Plan 4 bands, the Lampfall's packs and the Wickhound (Task 5): rates over the seeds given, with
// headroom below what was measured (the measured numbers are in the Task 5 report). Prints nothing.
import { describe, expect, it } from 'vitest';
import { JOB_IDS, type JobId } from './jobs';
import { S20, STRONG_PAIRS, deaths, meanTtk, runs, seeds, wins } from './bandRig';

const S10 = seeds(1, 10), S2 = seeds(1, 2);
const PACKS = ['root_cellar', 'brass_gallery', 'cog_hall'] as const;
const PAIRS: [JobId, JobId][] = [];
for (let i = 0; i < JOB_IDS.length; i++) for (let j = i; j < JOB_IDS.length; j++) PAIRS.push([JOB_IDS[i], JOB_IDS[j]]);

describe('the Lampfall: packs and the Wickhound', { timeout: 120_000 }, () => {
  it.each(STRONG_PAIRS)('E1: %s + %s, careful, clear every pack', (a, b) => {
    let d = 0;
    for (const p of PACKS) {
      const rs = runs(p, [a, b], 'careful', S10);
      rs.forEach((r, i) => expect(r.won, `${p} seed ${S10[i]}`).toBe(true));
      d += rs.reduce((s, r) => s + deaths(r), 0);
    }
    expect(d, 'deaths over 30 pack runs').toBeLessThanOrEqual(2);
  });

  // H (ruling P4-m): careful ≥ 95%, sloppy ≥ 75%, careless ≤ 40%, strong pairs, 20 seeds each
  it('E2/H: careful duos beat the Wickhound at least 95% of runs, in 70–140 s', () => {
    const all = STRONG_PAIRS.map(([a, b]) => runs('wickhound', [a, b], 'careful', S20));
    expect(all.reduce((s, rs) => s + wins(rs), 0)).toBeGreaterThanOrEqual(0.95 * 120);
    for (const rs of all) { const t = meanTtk(rs); expect(t).toBeGreaterThanOrEqual(70); expect(t).toBeLessThanOrEqual(140); }
  });
  it('E3/H: sloppy duos beat the Wickhound at least 75% of runs', () => {
    expect(STRONG_PAIRS.reduce((s, [a, b]) => s + wins(runs('wickhound', [a, b], 'sloppy', S20)), 0)).toBeGreaterThanOrEqual(0.75 * 120);
  });
  it('E4/H: careless duos beat it at most 40% of runs', () => {
    expect(STRONG_PAIRS.reduce((s, [a, b]) => s + wins(runs('wickhound', [a, b], 'careless', S20)), 0)).toBeLessThanOrEqual(0.4 * 120);
  });

  it('E5: the Wickhound is duo content: careful solo wins at most half', () => {
    expect(JOB_IDS.reduce((s, j) => s + wins(runs('wickhound', [j], 'careful', S2)), 0)).toBeLessThanOrEqual(7);
  });
  it('E5: careful solo clears the Root Cellar at least half the time', () => {
    expect(JOB_IDS.reduce((s, j) => s + wins(runs('root_cellar', [j], 'careful', S2)), 0)).toBeGreaterThanOrEqual(7);
  });

  // H: every non-mirror pair of the seven can beat it careful (mirrors such as Ninja + Ninja are not gated;
  // the 10-seed table of all 28 is in the Task 5 report)
  it.each(PAIRS.filter(([a, b]) => a !== b))('E6/H: %s + %s, careful, can beat the Wickhound (seeds 1–2)', (a, b) => {
    expect(wins(runs('wickhound', [a, b], 'careful', seeds(1, 2)))).toBeGreaterThanOrEqual(1);
  });
});
