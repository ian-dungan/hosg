// D5, the synergy check (Task 4 review round 1): each pair on its duo picks against the same pair on its
// solo picks, both played normally by a sloppy careful brain (it misses a seeded 30% of the telegraphs)
// against the Mossback with two Thornlings, ten seeds. Rulings P3b-f/h. Separate file so Vitest runs it
// in parallel with the other bands.
import { describe, expect, it } from 'vitest';
import type { AbilityId } from './abilities';
import { JOB_IDS, JOBS, type JobId } from './jobs';
import { simulateParty, type PartyResult } from './sim';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const PAIRS: [JobId, JobId][] = [];
for (let i = 0; i < JOB_IDS.length; i++) for (let j = i; j < JOB_IDS.length; j++) PAIRS.push([JOB_IDS[i], JOB_IDS[j]]);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const h = s.length / 2; return s.length % 2 ? s[Math.floor(h)] : (s[h - 1] + s[h]) / 2; };
const picksOf = (job: JobId, duo: boolean): [AbilityId, AbilityId] => [...(duo ? JOBS[job].picks.duo : JOBS[job].picks.solo)] as [AbilityId, AbilityId];

const runs = new Map<string, PartyResult[]>();
const fights = (a: JobId, b: JobId, duo: boolean, sloppy: boolean) => {
  const k = `${a} ${b} ${duo} ${sloppy}`;
  if (!runs.has(k)) {
    runs.set(k, SEEDS.map((seed) => simulateParty(sloppy
      ? { seed, enemy: 'mossback', adds: ['thornling', 'thornling'], party: [a, b].map((job) => ({ job, careful: true, sloppy: true, picks: picksOf(job, duo) })) }
      : { seed, enemy: 'mossback', party: [a, b].map((job) => ({ job, careful: true, picks: picksOf(job, duo) })) })));
  }
  return runs.get(k)!;
};
const wins = (rs: PartyResult[]) => rs.filter((r) => r.killedAt !== null).length;
const deaths = (rs: PartyResult[]) => rs.reduce((s, r) => s + r.members.reduce((x, m) => x + m.deaths, 0), 0);

describe('D5: duo picks beat solo picks in a duo', { timeout: 60_000 }, () => {
  it('sloppy play against the Mossback and two Thornlings: over the 28 pairs, no more deaths, and no more than 3 fewer wins (ruling P3b-i)', () => {
    const duoWins = PAIRS.reduce((s, [a, b]) => s + wins(fights(a, b, true, true)), 0), soloWins = PAIRS.reduce((s, [a, b]) => s + wins(fights(a, b, false, true)), 0);
    const duoDeaths = PAIRS.reduce((s, [a, b]) => s + deaths(fights(a, b, true, true)), 0), soloDeaths = PAIRS.reduce((s, [a, b]) => s + deaths(fights(a, b, false, true)), 0);
    expect(duoDeaths, `deaths ${duoDeaths} vs ${soloDeaths}`).toBeLessThanOrEqual(soloDeaths);
    expect(duoWins, `wins ${duoWins} vs ${soloWins}`).toBeGreaterThanOrEqual(soloWins - 3);
  });
  it.each(PAIRS)('%s + %s lose at most 2 of 10 sloppy fights more on duo picks than on solo picks', (a, b) => {
    expect(wins(fights(a, b, true, true))).toBeGreaterThanOrEqual(wins(fights(a, b, false, true)) - 2);
  });
  it('careful play: on the median pair, duo picks kill the Mossback no slower than solo picks', () => {
    const ratios = PAIRS.map(([a, b]) => mean(fights(a, b, true, false).map((r) => r.ttk ?? 180)) / mean(fights(a, b, false, false).map((r) => r.ttk ?? 180)));
    expect(median(ratios)).toBeLessThanOrEqual(1);
  });
});
