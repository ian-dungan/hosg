// Plan 3b bands, duos: all 28 pairs of the seven jobs (21 distinct plus 7 mirrors), duo picks, careful, seeds 1–3.
import { describe, expect, it } from 'vitest';
import { JOB_IDS, type JobId } from './jobs';
import { simulateParty, type PartyResult } from './sim';

const SEEDS = [1, 2, 3];
const PAIRS: [JobId, JobId][] = [];
for (let i = 0; i < JOB_IDS.length; i++) for (let j = i; j < JOB_IDS.length; j++) PAIRS.push([JOB_IDS[i], JOB_IDS[j]]);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

const runs = new Map<string, PartyResult[]>();
const duo = (a: JobId, b: JobId, enemy: 'thornling' | 'mossback', o: { careful?: boolean; ignoreTeam?: boolean } = {}) => {
  const careful = o.careful ?? true, ignoreTeam = o.ignoreTeam ?? false;
  const k = `${a} ${b} ${enemy} ${careful} ${ignoreTeam}`;
  if (!runs.has(k)) runs.set(k, SEEDS.map((seed) => simulateParty({ seed, party: [{ job: a, careful, ignoreTeam }, { job: b, careful, ignoreTeam }], enemy })));
  return runs.get(k)!;
};
const alive = (r: PartyResult) => r.killedAt !== null && r.members.some((m) => m.hpLeft > 0);

describe('duo bands', () => {
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

  it.each(PAIRS)('D3: %s + %s are a real team', (a, b) => {
    const rs = duo(a, b, 'mossback');
    expect(rs.reduce((s, r) => s + r.crossCombos, 0)).toBeGreaterThanOrEqual(2);
    for (const k of [0, 1]) expect(rs.reduce((s, r) => s + r.members[k].assists, 0), `member ${k}`).toBeGreaterThanOrEqual(1);
  });

  it('D4: mages react', () => {
    const sum = (a: JobId, b: JobId, re: 'conduct' | 'blast' | 'steam' | 'bedrock') => duo(a, b, 'mossback').reduce((s, r) => s + r.reactions[re], 0);
    expect(sum('white_mage', 'black_mage', 'conduct')).toBeGreaterThanOrEqual(1);
    expect(sum('warrior', 'black_mage', 'blast')).toBeGreaterThanOrEqual(1);
    expect(sum('ranger', 'white_mage', 'steam')).toBeGreaterThanOrEqual(1);
    expect(sum('paladin', 'black_mage', 'bedrock')).toBeGreaterThanOrEqual(1);
  });

  // The synergy check (coordinator): the same pair playing as if alone (ignoreTeam: no support abilities,
  // no primer laid for its finisher, no formation, no revive) must do clearly worse.
  it('D5: support picks and combos matter: a pair that uses them beats the same pair ignoring them', () => {
    const ttk = (rs: PartyResult[]) => mean(rs.map((r) => r.ttk ?? 180));
    const team = PAIRS.map(([a, b]) => ttk(duo(a, b, 'mossback'))), alone = PAIRS.map(([a, b]) => ttk(duo(a, b, 'mossback', { ignoreTeam: true })));
    // careful: ≥ 8% faster over all 28 pairs, and no pair worse: at most 6% slower, or ending with ≥ 15 more hp between them
    expect(mean(team) / mean(alone)).toBeLessThanOrEqual(0.92);
    const hp = (rs: PartyResult[]) => mean(rs.map((r) => r.members.reduce((x, m) => x + m.hpLeft, 0)));
    PAIRS.forEach(([a, b], i) => {
      const healthier = hp(duo(a, b, 'mossback')) - hp(duo(a, b, 'mossback', { ignoreTeam: true }));
      expect(team[i] / alone[i] <= 1.06 || healthier >= 15, `${a} + ${b}: ${team[i].toFixed(1)} s vs ${alone[i].toFixed(1)} s, ${healthier.toFixed(0)} hp`).toBe(true);
    });
    // careless: teamwork wins at least half again as many Mossback fights
    const wins = (ignoreTeam: boolean) => PAIRS.reduce((s, [a, b]) => s + duo(a, b, 'mossback', { careful: false, ignoreTeam }).filter((r) => r.killedAt !== null).length, 0);
    const withTeam = wins(false), without = wins(true);
    expect(withTeam).toBeGreaterThanOrEqual(1.5 * without);
  });

  it('D6: the Mossback stays dangerous for a careless duo: it loses at least 40% of the fights, and someone dies in at least half', () => {
    const all = PAIRS.flatMap(([a, b]) => duo(a, b, 'mossback', { careful: false }));
    expect(all.filter((r) => r.killedAt === null).length).toBeGreaterThanOrEqual(0.4 * all.length);
    expect(all.filter((r) => r.members.some((m) => m.deaths > 0)).length).toBeGreaterThanOrEqual(0.5 * all.length);
  });
});
