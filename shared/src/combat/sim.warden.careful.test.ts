// Plan 4 bands, the Fallen Warden (Task 5): G1, gear has room to matter (careful play).
import { describe, expect, it } from 'vitest';
import { STRONG_PAIRS, mean, runs, seeds, wins } from './bandRig';

describe('the Fallen Warden, gear headroom', { timeout: 180_000 }, () => {
  it('G1: a geared careful duo kills at least 15% faster, and a top-tier solo can win', () => {
    const geared = { power: 13, defence: 14, maxHp: 130 };
    const ttk = (rs: ReturnType<typeof runs>) => mean(rs.filter((r) => r.won).map((r) => r.ttk!));
    let g = 0;
    for (const pair of [STRONG_PAIRS[0], STRONG_PAIRS[1]]) {
      const base = runs('warden', pair, 'careful', seeds(1, 10)), gear = runs('warden', pair, 'careful', seeds(1, 10), geared);
      expect(ttk(gear), pair.join(' + ')).toBeLessThanOrEqual(0.85 * ttk(base));
      g += wins(gear);
    }
    expect(g).toBeGreaterThanOrEqual(19);
    const top = { power: 20, defence: 24, maxHp: 180 };
    expect((['paladin', 'dark_knight'] as const).reduce((s, j) => s + wins(runs('warden', [j], 'careful', seeds(1, 5), top)), 0)).toBeGreaterThanOrEqual(3);
  });
});
