// Final review I3, measuring bands for the live server's real conditions: the epilogue sends players to the
// Lampfall right after the main quest, at level ~3–6 in T0/T1 gear, not at the level-10 kits every other
// Lampfall band runs. A level-4 duo and trio in full T1 (SIM_TALENTS, i.e. the talents level 4 has), sloppy
// (an average player), through the three packs and the Wickhound, 20 seeds each. Thresholds sit 3 SD below
// what was measured (headroom ≥ 1); no tuning. Measured (seeds 1–20, sloppy; careful the same): every run
// won, 0 deaths, for PLD+BLM, WAR+WHM, PLD+WHM+BLM and WAR+RNG+WHM; Wickhound TTK 85–110 s.
import { describe, expect, it } from 'vitest';
import type { EncounterId } from './encounters';
import type { JobId } from './jobs';
import { simulateEncounter, type EncounterResult } from './sim';
import { headroom } from './simKits';

const S20 = Array.from({ length: 20 }, (_, i) => i + 1);
const ENCOUNTERS: EncounterId[] = ['root_cellar', 'brass_gallery', 'cog_hall', 'wickhound'];
/** Per encounter, wins of 20 at least: 20 of 20 measured, 3 SD below (headroom(20, 20, 17) ≈ 1.4). */
const MIN_WINS = 17;

const cache = new Map<string, EncounterResult[]>();
function level4(jobs: JobId[], encounter: EncounterId): EncounterResult[] {
  const key = `${jobs.join('+')} ${encounter}`;
  let rs = cache.get(key);
  if (!rs) {
    const party = jobs.map((job) => ({ job, skill: 'sloppy' as const, level: 4, gear: 1 as const, talents: 'sim' as const }));
    rs = S20.map((seed) => simulateEncounter({ seed, encounter, party }));
    cache.set(key, rs);
  }
  return rs;
}
const line = (rs: EncounterResult[]) => `wins ${rs.filter((r) => r.won).length}/20, deaths ${rs.reduce((s, r) => s + r.members.reduce((a, m) => a + m.deaths, 0), 0)}`;

describe('the live Lampfall at level 4 in T1 (final review I3)', { timeout: 120_000 }, () => {
  it('the threshold keeps 3 SD of headroom below what was measured', () => {
    expect(headroom(20, 20, MIN_WINS, 'atLeast')).toBeGreaterThanOrEqual(1);
  });
  it.each([
    ['a duo (Paladin + Black Mage)', ['paladin', 'black_mage']],
    ['a trio (Paladin + White Mage + Black Mage)', ['paladin', 'white_mage', 'black_mage']],
  ] as [string, JobId[]][])('%s, sloppy, clears each pack and the Wickhound in at least 17 of 20 runs', (_label, jobs) => {
    for (const encounter of ENCOUNTERS) {
      const rs = level4(jobs, encounter);
      expect(rs.filter((r) => r.won).length, `${encounter}: ${line(rs)}`).toBeGreaterThanOrEqual(MIN_WINS);
    }
  });
});
