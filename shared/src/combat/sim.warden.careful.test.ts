// Plan 4 bands, the Fallen Warden (Task 5, ruling P4-h): careful strong duos as the sanity check (≥ 95%;
// measured 115 of 120), and G1 (gear has room to matter), on the same cached careful runs.
import { describe, expect, it } from 'vitest';
import { S20, STRONG_PAIRS, mean, runs, seeds, wins } from './bandRig';

describe('the Fallen Warden, careful duos and gear', { timeout: 180_000 }, () => {
  it('W1 (sanity): careful strong duos win at least 95%', () => {
    expect(STRONG_PAIRS.reduce((s, [a, b]) => s + wins(runs('warden', [a, b], 'careful', S20)), 0)).toBeGreaterThanOrEqual(0.95 * 120);
  });

  it('G1: gear has room to matter', () => {
    const geared = { power: 13, defence: 14, maxHp: 130 };
    const ttk = (rs: ReturnType<typeof runs>) => mean(rs.filter((r) => r.won).map((r) => r.ttk!));
    let g = 0;
    for (const pair of [STRONG_PAIRS[0], STRONG_PAIRS[1]]) {
      const base = runs('warden', pair, 'careful', S20), gear = runs('warden', pair, 'careful', seeds(1, 10), geared);
      expect(ttk(gear), pair.join(' + ')).toBeLessThanOrEqual(0.85 * ttk(base));
      g += wins(gear);
    }
    expect(g).toBeGreaterThanOrEqual(19);
    const top = { power: 20, defence: 24, maxHp: 180 };
    expect((['paladin', 'dark_knight'] as const).reduce((s, j) => s + wins(runs('warden', [j], 'careful', seeds(1, 5), top)), 0)).toBeGreaterThanOrEqual(3);
  });
});
