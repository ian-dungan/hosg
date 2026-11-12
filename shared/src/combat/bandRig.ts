// Test support only (no test of its own): the parties of the Plan 4 difficulty bands and a cache of
// encounter runs, for sim.dungeon.test.ts and the sim.warden.*.test.ts files.
import type { EncounterId } from './encounters';
import type { JobId } from './jobs';
import { simulateEncounter, type EncounterMember, type EncounterResult, type Skill } from './sim';
import type { Stats } from './stats';

export const STRONG_PAIRS: [JobId, JobId][] = [
  ['paladin', 'black_mage'], ['warrior', 'white_mage'], ['dark_knight', 'ranger'],
  ['ninja', 'white_mage'], ['paladin', 'ninja'], ['black_mage', 'ranger'],
];
export const TRIOS: [JobId, JobId, JobId][] = [
  ['paladin', 'white_mage', 'black_mage'], ['warrior', 'ranger', 'white_mage'], ['dark_knight', 'ninja', 'black_mage'],
];
export const QUADS: [JobId, JobId, JobId, JobId][] = [
  ['paladin', 'white_mage', 'black_mage', 'ninja'], ['warrior', 'dark_knight', 'ranger', 'white_mage'],
];
export const seeds = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const cache = new Map<string, EncounterResult[]>();
/** Runs (once per key) every seed of `jobs` at `skill` in `encounter`; `stats` for everyone when given. */
export function runs(encounter: EncounterId, jobs: readonly JobId[], skill: Skill, ss: number[], stats?: Stats): EncounterResult[] {
  const k = `${encounter} ${jobs.join('+')} ${skill} ${ss.join(',')} ${stats ? JSON.stringify(stats) : ''}`;
  let r = cache.get(k);
  if (!r) {
    const party: EncounterMember[] = jobs.map((job) => (stats ? { job, skill, stats } : { job, skill }));
    r = ss.map((seed) => simulateEncounter({ seed, encounter, party }));
    cache.set(k, r);
  }
  return r;
}
export const wins = (rs: EncounterResult[]) => rs.filter((r) => r.won).length;
export const deaths = (r: EncounterResult) => r.members.reduce((s, m) => s + m.deaths, 0);
export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
export const meanTtk = (rs: EncounterResult[]) => mean(rs.filter((r) => r.won).map((r) => r.ttk!));
