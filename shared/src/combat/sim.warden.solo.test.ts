// Plan 4 bands, the Fallen Warden alone and with gear stand-ins (Task 5): W4 and G1.
import { describe, expect, it } from 'vitest';
import { JOB_IDS } from './jobs';
import { STRONG_PAIRS, mean, runs, seeds, wins } from './bandRig';

describe('the Fallen Warden, solo and gear', { timeout: 120_000 }, () => {
  it('W4: solo at Plan 3b power cannot realistically win', () => {
    const rs = JOB_IDS.flatMap((j) => runs('warden', [j], 'careful', seeds(1, 2)));
    expect(wins(rs)).toBe(0);
    expect(mean(rs.map((r) => r.bossHpFrac))).toBeGreaterThanOrEqual(0.35);
  });

  it('G1: gear has room to matter', () => {
    const geared = { power: 13, defence: 14, maxHp: 130 };
    for (const pair of [STRONG_PAIRS[0], STRONG_PAIRS[1]]) {
      const base = runs('warden', pair, 'careful', seeds(1, 10)), gear = runs('warden', pair, 'careful', seeds(1, 10), geared);
      const ttk = (rs: typeof base) => mean(rs.filter((r) => r.won).map((r) => r.ttk!));
      expect(ttk(gear), pair.join(' + ')).toBeLessThanOrEqual(0.85 * ttk(base));
    }
    const g = [STRONG_PAIRS[0], STRONG_PAIRS[1]].reduce((s, p) => s + wins(runs('warden', p, 'careful', seeds(1, 10), geared)), 0);
    expect(g).toBeGreaterThanOrEqual(19);
    const top = { power: 20, defence: 24, maxHp: 180 };
    expect((['paladin', 'dark_knight'] as const).reduce((s, j) => s + wins(runs('warden', [j], 'careful', seeds(1, 5), top)), 0)).toBeGreaterThanOrEqual(3);
  });
});
