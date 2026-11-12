// Plan 3b bands, duos: all 28 pairs of the seven jobs (21 distinct plus 7 mirrors), duo picks, careful, seeds 1–3.
import { describe, expect, it } from 'vitest';
import { JOB_IDS, type JobId } from './jobs';
import { simulateParty, type PartyResult } from './sim';

const SEEDS = [1, 2, 3];
const PAIRS: [JobId, JobId][] = [];
for (let i = 0; i < JOB_IDS.length; i++) for (let j = i; j < JOB_IDS.length; j++) PAIRS.push([JOB_IDS[i], JOB_IDS[j]]);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

/** D3 (and D5) use ten seeds, with rates as thresholds (review round 1). */
const SEEDS10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const runs = new Map<string, PartyResult[]>();
const duo = (a: JobId, b: JobId, enemy: 'thornling' | 'mossback', o: { careful?: boolean; seeds?: number[] } = {}) => {
  const careful = o.careful ?? true, seeds = o.seeds ?? SEEDS;
  const k = `${a} ${b} ${enemy} ${careful} ${seeds.length}`;
  if (!runs.has(k)) runs.set(k, seeds.map((seed) => simulateParty({ seed, party: [{ job: a, careful }, { job: b, careful }], enemy })));
  return runs.get(k)!;
};
const alive = (r: PartyResult) => r.killedAt !== null && r.members.some((m) => m.hpLeft > 0);

describe('duo bands', { timeout: 60_000 }, () => {
  it('there are 28 pairs', () => expect(PAIRS.length).toBe(28));

  it.each(PAIRS)('D1: %s + %s kill a Thornling fast', (a, b) => {
    duo(a, b, 'thornling').forEach((r, i) => {
      expect(r.ttk, `seed ${SEEDS[i]}`).not.toBeNull();
      expect(r.ttk!, `seed ${SEEDS[i]}`).toBeLessThanOrEqual(10);
    });
  });

  it.each(PAIRS)('D2: %s + %s beat the Mossback', (a, b) => {
    const rs = duo(a, b, 'mossback');
    rs.forEach((r, i) => expect(alive(r), `seed ${SEEDS[i]}`).toBe(true));
    const m = mean(rs.map((r) => r.ttk!));
    expect(m).toBeGreaterThanOrEqual(18);
    expect(m).toBeLessThanOrEqual(a === 'white_mage' && b === 'white_mage' ? 70 : 55);
    expect(rs.reduce((s, r) => s + r.members.reduce((x, mm) => x + mm.deaths, 0), 0)).toBeLessThanOrEqual(1);
  });

  // Rates over ten Mossback seeds, about 25% under the lowest pair measured (crossCombos 0.4 a fight for
  // Ranger + Ranger; support assists 0.7 a fight for the Paladin beside a White Mage). Assists count only
  // effects of `support` abilities.
  it.each(PAIRS)('D3: %s + %s are a real team', (a, b) => {
    const rs = duo(a, b, 'mossback', { seeds: SEEDS10 });
    expect(mean(rs.map((r) => r.crossCombos)), 'cross-combos a fight').toBeGreaterThanOrEqual(0.3);
    for (const k of [0, 1]) expect(mean(rs.map((r) => r.members[k].assists)), `member ${k}: support assists a fight`).toBeGreaterThanOrEqual(0.5);
  });

  it('D4: mages react', () => {
    const sum = (a: JobId, b: JobId, re: 'conduct' | 'blast' | 'steam' | 'bedrock') => duo(a, b, 'mossback').reduce((s, r) => s + r.reactions[re], 0);
    expect(sum('white_mage', 'black_mage', 'conduct')).toBeGreaterThanOrEqual(1);
    expect(sum('warrior', 'black_mage', 'blast')).toBeGreaterThanOrEqual(1);
    expect(sum('ranger', 'white_mage', 'steam')).toBeGreaterThanOrEqual(1);
    expect(sum('paladin', 'black_mage', 'bedrock')).toBeGreaterThanOrEqual(1);
  });

  // measured (review round 1): 26 of 84 careless fights lost, someone dead in 32; thresholds with ~25% headroom
  it('D6: the Mossback stays dangerous for a careless duo: it loses at least 20% of the fights, and someone dies in at least 28%', () => {
    const all = PAIRS.flatMap(([a, b]) => duo(a, b, 'mossback', { careful: false }));
    expect(all.filter((r) => r.killedAt === null).length).toBeGreaterThanOrEqual(0.2 * all.length);
    expect(all.filter((r) => r.members.some((m) => m.deaths > 0)).length).toBeGreaterThanOrEqual(0.28 * all.length);
  });
});
