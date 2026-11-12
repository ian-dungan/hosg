// Plan 4 bands, the Fallen Warden for three and four (Task 5, ruling P4-m C and E): sloppy trios win, the
// no-healer trio often enough; sloppy quads pay; careless parties lose.
import { describe, expect, it } from 'vitest';
import { QUADS, S20, TRIOS, deaths, mean, runs, seeds, wins } from './bandRig';

describe('the Fallen Warden, parties', { timeout: 180_000 }, () => {
  it('C: sloppy trios win at least 70% overall, the no-healer trio at least 35%', () => {
    const per = TRIOS.map((t) => wins(runs('warden', t, 'sloppy', S20)));
    expect(per.reduce((s, n) => s + n, 0)).toBeGreaterThanOrEqual(0.7 * 60);
    per.forEach((n, i) => expect(n, TRIOS[i].join(' + ')).toBeGreaterThanOrEqual(0.35 * 20));
  });

  it('E: sloppy quads pay (deaths ≥ 0.3 a run or ≥ 25% enraged); careless quads lose at least 80%', () => {
    const rs = QUADS.flatMap((q) => runs('warden', q, 'sloppy', S20));
    expect(mean(rs.map(deaths)) >= 0.3 || rs.filter((r) => r.enraged).length >= 0.25 * rs.length).toBe(true);
    expect(wins(QUADS.flatMap((q) => runs('warden', q, 'careless', seeds(1, 10))))).toBeLessThanOrEqual(0.2 * 20);
  });

  it('W6: careless trios lose', () => {
    expect(TRIOS.reduce((s, t) => s + wins(runs('warden', t, 'careless', seeds(1, 4))), 0)).toBeLessThanOrEqual(2);
  });
});
