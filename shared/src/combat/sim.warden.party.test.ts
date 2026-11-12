// Plan 4 bands, the Fallen Warden for three and four (Task 5): W2, W5 and W6.
import { describe, expect, it } from 'vitest';
import { QUADS, TRIOS, deaths, mean, meanTtk, runs, seeds, wins } from './bandRig';

describe('the Fallen Warden, parties', { timeout: 120_000 }, () => {
  it('W2: three average adventurers beat the Warden', () => {
    const per = TRIOS.map((t) => wins(runs('warden', t, 'sloppy', seeds(1, 10))));
    expect(per.reduce((s, n) => s + n, 0)).toBeGreaterThanOrEqual(21);
    per.forEach((n, i) => expect(n, TRIOS[i].join(' + ')).toBeGreaterThanOrEqual(6));
  });

  it('W5: four is not trivial', () => {
    const sloppy = QUADS.flatMap((q) => runs('warden', q, 'sloppy', seeds(1, 10)));
    expect(wins(sloppy)).toBeGreaterThanOrEqual(16);
    expect(mean(sloppy.map(deaths)) >= 0.5 || meanTtk(sloppy) >= 180).toBe(true);
    const careless = QUADS.flatMap((q) => runs('warden', q, 'careless', seeds(1, 5)));
    expect(wins(careless)).toBeLessThanOrEqual(5);
  });

  it('W6: careless trios lose', () => {
    expect(TRIOS.reduce((s, t) => s + wins(runs('warden', t, 'careless', seeds(1, 4))), 0)).toBeLessThanOrEqual(2);
  });
});
