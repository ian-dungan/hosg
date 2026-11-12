// Plan 4 bands, the Fallen Warden alone (Task 5): W4.
import { describe, expect, it } from 'vitest';
import { JOB_IDS } from './jobs';
import { mean, runs, seeds, wins } from './bandRig';

describe('the Fallen Warden, solo', { timeout: 120_000 }, () => {
  it('W4: solo at Plan 3b power cannot realistically win', () => {
    const rs = JOB_IDS.flatMap((j) => runs('warden', [j], 'careful', seeds(1, 2)));
    expect(wins(rs)).toBe(0);
    expect(mean(rs.map((r) => r.bossHpFrac))).toBeGreaterThanOrEqual(0.35);
  });
});
