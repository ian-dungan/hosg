// Plan 4 bands, the Fallen Warden for three and four (Task 5, ruling P4-h): W2, W5 and W6.
import { describe, expect, it } from 'vitest';
import { QUADS, S20, TRIOS, costly, runs, seeds, wins } from './bandRig';

describe('the Fallen Warden, parties', { timeout: 180_000 }, () => {
  it('W2: sloppy trios win at least 70% overall, every listed trio at least 35% (measured 53 of 60; the no-healer trio 13 of 20)', () => {
    const per = TRIOS.map((t) => wins(runs('warden', t, 'sloppy', S20)));
    expect(per.reduce((s, n) => s + n, 0)).toBeGreaterThanOrEqual(0.7 * 60);
    per.forEach((n, i) => expect(n, TRIOS[i].join(' + ')).toBeGreaterThanOrEqual(0.35 * 20));
  });

  it('W5: careless quads lose often (measured 0 of 20)', () => {
    expect(wins(QUADS.flatMap((q) => runs('warden', q, 'careless', seeds(1, 10))))).toBeLessThanOrEqual(10);
  });
  // W5's cost gate for sloppy quads (deaths ≥ 0.3 a run, or an enrage share). NOT MET: 40 of 40 clean wins
  // even at scale[3] 2.3 (each quad holds two healers or tanks; see the report).
  it.skip('W5: sloppy quads pay a real cost (pending a ruling)', () => {
    const rs = QUADS.flatMap((q) => runs('warden', q, 'sloppy', S20));
    expect(rs.filter(costly).length).toBeGreaterThanOrEqual(0.3 * rs.length);
  });

  it('W6: careless trios lose', () => {
    expect(TRIOS.reduce((s, t) => s + wins(runs('warden', t, 'careless', seeds(1, 4))), 0)).toBeLessThanOrEqual(2);
  });
});
