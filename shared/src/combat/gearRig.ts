// Test support only (no test of its own): cached runs for the Plan 5 gear, level and talent bands
// (sim.gear.*, sim.levels, sim.talents), and the one-line-per-party table a failing band prints.
import { JOBS, JOB_IDS, type JobId } from './jobs';
import type { AbilityId } from './abilities';
import { simulateEncounter, simulateFight, type EncounterResult, type Skill } from './sim';
import type { SimGear } from './simKits';
import { TALENTS, type TalentId } from '../talents';

export { GEAR_PAIRS, headroom } from './simKits';
export { S20 } from './bandRig';
export const SOLO_JOBS: readonly JobId[] = JOB_IDS;

export interface Kitting { gear?: SimGear; level?: number; talents?: readonly string[] | 'sim'; picks?: 'solo' | [AbilityId, AbilityId] }
const key = (o: object) => JSON.stringify(o);
const cache = new Map<string, EncounterResult[]>();
/** The Warden (or another encounter) for `jobs`, every seed, each member kitted the same way; cached per argument set. */
export function wardenRuns(jobs: readonly JobId[], skill: Skill, ss: readonly number[], k: Kitting, encounter: 'warden' = 'warden'): EncounterResult[] {
  const id = key({ jobs, skill, ss, k, encounter });
  let r = cache.get(id);
  if (!r) {
    const party = jobs.map((job) => ({
      job, skill, gear: k.gear ?? 'starter', level: k.level ?? 10, talents: k.talents ?? [],
      ...(k.picks === 'solo' ? { picks: [JOBS[job].picks.solo[0], JOBS[job].picks.solo[1]] as [AbilityId, AbilityId] } : k.picks ? { picks: k.picks } : {}),
    }));
    r = ss.map((seed) => simulateEncounter({ seed, encounter, party }));
    cache.set(id, r);
  }
  return r;
}

/** One Greenway fight's result in the encounter shape (won: killed and never died). */
export interface Fight { won: boolean; ttk: number | null; died: boolean }
const fights = new Map<string, Fight[]>();
/** `job` solo, careful, against `enemy`, every seed; cached. */
export function fightRuns(job: JobId, enemy: 'thornling' | 'mossback', ss: readonly number[], k: Kitting): Fight[] {
  const id = key({ job, enemy, ss, k });
  let r = fights.get(id);
  if (!r) {
    const picks = k.picks === 'solo' || k.picks === undefined ? undefined : k.picks;
    r = ss.map((seed) => {
      const f = simulateFight({ seed, enemy, careful: true, job, gear: k.gear ?? 'starter', level: k.level ?? 10, talents: k.talents ?? [], ...(picks ? { picks } : {}) });
      return { won: f.killedAt !== null && !f.died, ttk: f.ttk, died: f.died };
    });
    fights.set(id, r);
  }
  return r;
}

export const wins = (rs: readonly { won: boolean }[]) => rs.filter((r) => r.won).length;
export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
export const meanTtk = (rs: readonly { won: boolean; ttk: number | null }[]) => mean(rs.filter((r) => r.won && r.ttk !== null).map((r) => r.ttk!));

/** One line per party: wins, mean TTK, deaths a run, phase reached, enrage share (the band's failure message). */
export function table(rows: [string, EncounterResult[]][]): string {
  return '\n' + rows.map(([label, rs]) => {
    const deaths = mean(rs.map((r) => r.members.reduce((s, m) => s + m.deaths, 0)));
    return `${label.padEnd(32)} wins ${wins(rs)}/${rs.length}  ttk ${meanTtk(rs).toFixed(0)}  deaths ${deaths.toFixed(2)}  phase ${mean(rs.map((r) => r.phaseReached)).toFixed(2)}  enraged ${(rs.filter((r) => r.enraged).length / rs.length).toFixed(2)}`;
  }).join('\n');
}
/** The same for Greenway fights. */
export function fightTable(rows: [string, Fight[]][]): string {
  return '\n' + rows.map(([label, rs]) => `${label.padEnd(32)} wins ${wins(rs)}/${rs.length}  ttk ${meanTtk(rs).toFixed(1)}  deaths ${rs.filter((r) => r.died).length}`).join('\n');
}

/** The abilities a talent's mods name. */
export function talentAbilities(id: TalentId): AbilityId[] {
  const out: AbilityId[] = [];
  for (const m of TALENTS[id].mods) if ('ability' in m && m.ability !== 'all' && !out.includes(m.ability)) out.push(m.ability);
  return out;
}
/**
 * The picks to try a talent on (P3 must not pass trivially), in order: `base` when the talent's
 * abilities are on the bar or in it; else the duo picks when they hold the ability; else `base` with the
 * ability in place of the second pick, then of the first.
 */
export function picksFor(id: TalentId, base: readonly [AbilityId, AbilityId]): [AbilityId, AbilityId][] {
  const job = TALENTS[id].job;
  const need = talentAbilities(id).find((a) => !JOBS[job].bar.includes(a) && !base.includes(a));
  if (!need) return [[base[0], base[1]]];
  const duo = JOBS[job].picks.duo;
  return [...(duo.includes(need) ? [[duo[0], duo[1]] as [AbilityId, AbilityId]] : []), [base[0], need], [need, base[1]]];
}
