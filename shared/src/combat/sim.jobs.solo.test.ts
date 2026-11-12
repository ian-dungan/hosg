// Plan 3b bands, solo: every job with its solo picks (careful unless stated), seeds 1–5.
import { describe, expect, it } from 'vitest';
import { JOB_IDS, type JobId } from './jobs';
import { simulateFight, type FightResult } from './sim';

const SEEDS = [1, 2, 3, 4, 5];
/**
 * Ruling P3b-e: the Ranger's solo floor is 8.5 s, not 9. Its Pinning Shot primer gives Pitch Arrow a Plan 3
 * combo that no allowed number can remove (the Bow bar, its autoCoef and COMBO_COEF are fixed); the
 * 25%-of-median rule binds it instead.
 */
const RANGER_FLOOR = 8.5;
const ORDINARY = ['thornling', 'boar', 'archer'] as const;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[(s.length - 1) / 2]; };

const runs = new Map<string, FightResult[]>();
const fights = (job: JobId, enemy: (typeof ORDINARY)[number] | 'mossback', careful = true) => {
  const k = `${job} ${enemy} ${careful}`;
  if (!runs.has(k)) runs.set(k, SEEDS.map((seed) => simulateFight({ seed, job, enemy, careful })));
  return runs.get(k)!;
};
const wins = (rs: FightResult[]) => rs.filter((r) => r.ttk !== null && !r.died);

describe('S1: every job solo beats every ordinary kind', () => {
  it.each(JOB_IDS)('%s solo beats every ordinary kind', (job) => {
    for (const enemy of ORDINARY) {
      const rs = fights(job, enemy);
      rs.forEach((r, i) => {
        expect(r.died, `${enemy} seed ${SEEDS[i]}`).toBe(false);
        expect(r.ttk, `${enemy} seed ${SEEDS[i]}`).not.toBeNull();
      });
      const m = mean(rs.map((r) => r.ttk!));
      expect(m, enemy).toBeGreaterThanOrEqual(job === 'ranger' ? RANGER_FLOOR : 9);
      expect(m, enemy).toBeLessThanOrEqual(16);
    }
  });
  it('no job is more than 25% off the median, per ordinary kind', () => {
    for (const enemy of ORDINARY) {
      const means = JOB_IDS.map((job) => mean(fights(job, enemy).map((r) => r.ttk ?? Infinity)));
      const md = median(means);
      JOB_IDS.forEach((job, i) => expect(Math.abs(means[i] - md) / md, `${job} vs ${enemy}: ${means[i].toFixed(1)} (median ${md.toFixed(1)})`).toBeLessThanOrEqual(0.25));
    }
  });
});

describe('S2: every job solo beats the Mossback with care', () => {
  it.each(JOB_IDS)('%s solo beats the Mossback with care', (job) => {
    const w = wins(fights(job, 'mossback'));
    expect(w.length).toBeGreaterThanOrEqual(4);
    for (const r of w) expect(r.hpLeft).toBeGreaterThanOrEqual(10);
    const m = mean(w.map((r) => r.ttk!));
    expect(m).toBeGreaterThanOrEqual(30);
    expect(m).toBeLessThanOrEqual(80);
  });
  it('no job is more than 25% off the median against the Mossback', () => {
    const means = JOB_IDS.map((job) => mean(wins(fights(job, 'mossback')).map((r) => r.ttk!)));
    const md = median(means);
    JOB_IDS.forEach((job, i) => expect(Math.abs(means[i] - md) / md, `${job}: ${means[i].toFixed(1)} (median ${md.toFixed(1)})`).toBeLessThanOrEqual(0.25));
  });
});

describe('S3: carelessness', () => {
  it('careless Mossback is deadly for damage jobs and costly for the sturdy', () => {
    for (const job of ['warrior', 'ranger', 'ninja', 'black_mage'] as const) {
      expect(fights(job, 'mossback', false).filter((r) => r.died).length, job).toBeGreaterThanOrEqual(3);
    }
    for (const job of ['paladin', 'dark_knight', 'white_mage'] as const) {
      const rs = fights(job, 'mossback', false);
      const dies = rs.some((r) => r.died), hp = mean(rs.map((r) => r.hpLeft));
      expect(dies || hp <= 50, `${job}: mean hp ${hp}`).toBe(true);
    }
  });
});
