// Plan 4 bands, the Fallen Warden (Task 5, ruling P4-m B and G): sloppy duos (30% of telegraphs missed).
import { describe, expect, it } from 'vitest';
import { S20, STRONG_PAIRS, runs, seeds, wins } from './bandRig';

const rate = (skill: 'sloppy', ss: number[], stats?: { power: number; defence: number; maxHp: number }) =>
  STRONG_PAIRS.reduce((s, [a, b]) => s + wins(runs('warden', [a, b], skill, ss, stats)), 0) / (STRONG_PAIRS.length * ss.length);

describe('the Fallen Warden, sloppy duos', { timeout: 180_000 }, () => {
  it('B: an average duo usually loses or barely wins: 25–55% of runs won', () => {
    const w = rate('sloppy', S20);
    expect(w).toBeGreaterThanOrEqual(0.25);
    expect(w).toBeLessThanOrEqual(0.55);
  });
  it('G: +20% gear lifts sloppy duos by at least 15 points', () => {
    const ss = seeds(1, 10);
    expect(rate('sloppy', ss, { power: 12, defence: 12, maxHp: 120 }) - rate('sloppy', ss)).toBeGreaterThanOrEqual(0.15);
  });
});
