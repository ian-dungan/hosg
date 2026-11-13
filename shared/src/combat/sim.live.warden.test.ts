// Final review I3, measuring bands for the live server's real conditions: a party reaching the Fallen Warden
// on the live server is a mix of levels 6–8 in T1 and T2 pieces, not the level-10 kits of the other Warden
// bands. A mixed duo and trio (SIM_TALENTS, i.e. the talents each level has), sloppy (an average player),
// 20 seeds each. Thresholds sit 3 SD below what was measured (headroom ≥ 1); no tuning. Measured (seeds 1–20):
// see MEASURED below and the final review report.
import { describe, expect, it } from 'vitest';
import type { JobId } from './jobs';
import { simulateEncounter, type EncounterResult } from './sim';
import { headroom } from './simKits';

const S20 = Array.from({ length: 20 }, (_, i) => i + 1);
type Member = { job: JobId; level: number; gear: 1 | 2 };
const PARTIES: [string, Member[], number][] = [
  // [label, members, wins of 20 at least (3 SD below the measured count)]
  ['duo: Paladin 8 in T2 + Black Mage 6 in T1', [{ job: 'paladin', level: 8, gear: 2 }, { job: 'black_mage', level: 6, gear: 1 }], 9],
  ['trio: Paladin 8 in T2 + White Mage 6 in T1 + Black Mage 7 in T2', [{ job: 'paladin', level: 8, gear: 2 }, { job: 'white_mage', level: 6, gear: 1 }, { job: 'black_mage', level: 7, gear: 2 }], 17],
];
/** Wins of 20 measured, sloppy, seeds 1–20. */
const MEASURED: Record<string, number> = { duo: 15, trio: 20 };

const wardenRuns = (members: Member[]): EncounterResult[] =>
  S20.map((seed) => simulateEncounter({ seed, encounter: 'warden', party: members.map((m) => ({ ...m, skill: 'sloppy' as const, talents: 'sim' as const })) }));
const line = (rs: EncounterResult[]) => `wins ${rs.filter((r) => r.won).length}/20, deaths ${rs.reduce((s, r) => s + r.members.reduce((a, m) => a + m.deaths, 0), 0)}, enraged ${rs.filter((r) => r.enraged).length}`;

describe('the live Fallen Warden at levels 6–8 in T1/T2 (final review I3)', { timeout: 120_000 }, () => {
  it('each threshold keeps 3 SD of headroom below what was measured', () => {
    for (const [label, , min] of PARTIES) expect(headroom(MEASURED[label.split(':')[0]!]!, 20, min, 'atLeast'), label).toBeGreaterThanOrEqual(1);
  });
  it.each(PARTIES)('%s, sloppy, beats the Warden in at least the threshold of 20 runs', (_label, members, min) => {
    const rs = wardenRuns(members);
    expect(rs.filter((r) => r.won).length, line(rs)).toBeGreaterThanOrEqual(min);
  });
});
