// Jobs: the seven starting jobs (bar, pick pool, picks, trait, dodges), the unlockable jobs' data
// hooks, and the per-job save. Job names come only from JOBS[id].name (they may be renamed).
import { ABILITIES, legacyLoadout, type AbilityId, type Loadout, type WeaponId } from './abilities';
import { levelForXp } from './jobXp';

export type JobId = 'warrior' | 'ranger' | 'paladin' | 'dark_knight' | 'ninja' | 'white_mage' | 'black_mage';
export type FutureJobId = 'monk' | 'bard' | 'beastmaster' | 'sky_lancer';
export type RoleTag = 'damage' | 'tank' | 'healer' | 'hybrid';
export type TraitId = 'battle_rhythm' | 'pinpoint' | 'steadfast' | 'blood_price' | 'shadowstep' | 'overflow' | 'font';

export interface JobData {
  id: JobId; name: string; glyph: string; role: RoleTag; weapon: WeaponId;
  /** Slots 1–3: quick, finisher, signature. */
  bar: readonly [AbilityId, AbilityId, AbilityId];
  /** The four abilities slots 4–5 are picked from. */
  pool: readonly [AbilityId, AbilityId, AbilityId, AbilityId];
  /** solo: a new job's default picks; duo: the simulation's picks with a partner. */
  picks: { solo: readonly [AbilityId, AbilityId]; duo: readonly [AbilityId, AbilityId] };
  trait: { id: TraitId; name: string; desc: string };
  /** flank: the brain moves behind a target that is attacking someone else (Ninja). */
  dodgeCharges: number; brain: { flank: boolean };
  unlock: { kind: 'start' } | { kind: 'quest'; quest: string };
}

export const JOBS: Record<JobId, JobData> = {
  warrior: {
    id: 'warrior', name: 'Warrior', glyph: '⚔', role: 'damage', weapon: 'blade',
    bar: ['slash', 'sunder', 'parry'], pool: ['rallying_roar', 'skullringer', 'mend', 'bulwark'],
    picks: { solo: ['mend', 'bulwark'], duo: ['rallying_roar', 'skullringer'] },
    trait: { id: 'battle_rhythm', name: 'Battle Rhythm', desc: 'Auto-attacks build 15 Momentum instead of 10.' },
    dodgeCharges: 2, brain: { flank: false }, unlock: { kind: 'start' },
  },
  ranger: {
    id: 'ranger', name: 'Ranger', glyph: '➶', role: 'damage', weapon: 'bow',
    bar: ['snap_shot', 'pitch_arrow', 'charged_shot'], pool: ['pinning_shot', 'field_dressing', 'sprint', 'barbed_rain'],
    picks: { solo: ['field_dressing', 'pinning_shot'], duo: ['pinning_shot', 'field_dressing'] },
    trait: { id: 'pinpoint', name: 'Pinpoint', desc: '10% more damage against a target that is attacking someone else.' },
    dodgeCharges: 2, brain: { flank: false }, unlock: { kind: 'start' },
  },
  paladin: {
    id: 'paladin', name: 'Paladin', glyph: '⛨', role: 'tank', weapon: 'sword',
    bar: ['shield_rap', 'bright_verdict', 'aegis'], pool: ['taunt', 'shelter', 'kindle', 'dawn_ward'],
    picks: { solo: ['kindle', 'dawn_ward'], duo: ['taunt', 'shelter'] },
    trait: { id: 'steadfast', name: 'Steadfast', desc: 'Takes 15% less damage, draws 50% more attention, and gains 5 Momentum from each hit it takes.' },
    dodgeCharges: 2, brain: { flank: false }, unlock: { kind: 'start' },
  },
  dark_knight: {
    id: 'dark_knight', name: 'Dark Knight', glyph: '♆', role: 'hybrid', weapon: 'greatsword',
    bar: ['grim_rend', 'nightfall', 'crimson_pact'], pool: ['bloodbond', 'dread_howl', 'umbral_brand', 'grave_ward'],
    picks: { solo: ['grave_ward', 'umbral_brand'], duo: ['bloodbond', 'umbral_brand'] },
    trait: { id: 'blood_price', name: 'Blood Price', desc: 'Ability damage heals for 20% of it; damage taken builds Momentum.' },
    dodgeCharges: 2, brain: { flank: false }, unlock: { kind: 'start' },
  },
  ninja: {
    id: 'ninja', name: 'Ninja', glyph: '✕', role: 'damage', weapon: 'daggers',
    bar: ['twin_fang', 'hamstring', 'ghost_edge'], pool: ['ashcloud', 'weak_point', 'quickstep', 'mist_form'],
    picks: { solo: ['mist_form', 'ashcloud'], duo: ['weak_point', 'ashcloud'] },
    trait: { id: 'shadowstep', name: 'Shadowstep', desc: 'A third dodge, 25% more damage from behind, and 25 Momentum per perfect dodge.' },
    dodgeCharges: 3, brain: { flank: true }, unlock: { kind: 'start' },
  },
  white_mage: {
    id: 'white_mage', name: 'White Mage', glyph: '✙', role: 'healer', weapon: 'staff',
    bar: ['tidelash', 'lantern_flare', 'wellspring'], pool: ['second_dawn', 'soft_rain', 'mistveil', 'sun_mote'],
    picks: { solo: ['soft_rain', 'sun_mote'], duo: ['second_dawn', 'soft_rain'] },
    trait: { id: 'font', name: 'Font', desc: 'Heals on others are 20% stronger and draw half the attention; healing builds Momentum.' },
    dodgeCharges: 2, brain: { flank: false }, unlock: { kind: 'start' },
  },
  black_mage: {
    id: 'black_mage', name: 'Black Mage', glyph: '✺', role: 'damage', weapon: 'staff',
    bar: ['cinder_dart', 'skyfall_arc', 'hearthfall'], pool: ['kindred_spark', 'bastion_stone', 'rootbreak', 'stormcage'],
    picks: { solo: ['bastion_stone', 'rootbreak'], duo: ['kindred_spark', 'rootbreak'] },
    trait: { id: 'overflow', name: 'Overflow', desc: 'Elemental damage is 10% stronger; each finished cast builds 10 Momentum.' },
    dodgeCharges: 2, brain: { flank: false }, unlock: { kind: 'start' },
  },
};

/** The starting jobs, in table order. */
export const JOB_IDS: readonly JobId[] = ['warrior', 'ranger', 'paladin', 'dark_knight', 'ninja', 'white_mage', 'black_mage'];

const own = (o: object, k: unknown): k is string => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
export function isJobId(v: unknown): v is JobId {
  return own(JOBS, v);
}

// ───────── unlockable jobs: data hooks only ─────────
export interface FutureJobData { id: FutureJobId; name: string; role: RoleTag; weaponName: string; unique: string; unlock: { kind: 'quest'; quest: string } }
export const FUTURE_JOBS: Record<FutureJobId, FutureJobData> = {
  monk: { id: 'monk', name: 'Monk', role: 'damage', weaponName: 'Fists', unique: 'never disarmed; breaks stagger fastest', unlock: { kind: 'quest', quest: 'greenway_monk' } },
  bard: { id: 'bard', name: 'Bard', role: 'hybrid', weaponName: 'Lute', unique: 'songs boost the whole party and stack with everything', unlock: { kind: 'quest', quest: 'normandy_bard' } },
  beastmaster: {
    id: 'beastmaster', name: 'Beastmaster', role: 'damage', weaponName: 'Whip',
    unique: 'fights beside a tamed creature; the best solo job; taming is a collection game', unlock: { kind: 'quest', quest: 'first_taming' },
  },
  sky_lancer: { id: 'sky_lancer', name: 'Sky Lancer', role: 'damage', weaponName: 'Spear', unique: 'reaches flying enemies and crosses gaps', unlock: { kind: 'quest', quest: 'reach_the_islands' } },
};
const isFutureJobId = (v: unknown): v is FutureJobId => own(FUTURE_JOBS, v);

// ───────── the per-job save ─────────
/** level is derived from xp (levelForXp), never trusted. talents and outfit are Plan 5 hooks. */
export interface JobRecord { level: number; xp: number; picks: [AbilityId, AbilityId]; talents: string[]; outfit: null }
/** A record under a future job id is kept as it is, but such an id can never be `current`. */
export interface JobsSave { current: JobId; jobs: Partial<Record<JobId | FutureJobId, JobRecord>> }

const freshRecord = (job: JobId): JobRecord => ({ level: 1, xp: 0, picks: [JOBS[job].picks.solo[0], JOBS[job].picks.solo[1]], talents: [], outfit: null });

/** `job` (default the Warrior) as current, with a fresh record: level 1, 0 xp, the solo picks. */
export function newJobsSave(job: JobId = 'warrior'): JobsSave {
  return { current: job, jobs: { [job]: freshRecord(job) } };
}

/** The stored record for `job`, or a fresh one (not stored). */
export function recordFor(s: JobsSave, job: JobId): JobRecord {
  return s.jobs[job] ?? freshRecord(job);
}

/** The current job and its picks. */
export function loadoutOf(s: JobsSave): Loadout {
  const r = recordFor(s, s.current);
  return { job: s.current, picks: [r.picks[0], r.picks[1]] };
}

/** Two distinct ids of `job`'s pool; for a future job (no pool yet), two distinct ability ids. */
function validPicks(job: JobId | FutureJobId, v: unknown): v is [AbilityId, AbilityId] {
  if (!Array.isArray(v) || v.length !== 2 || v[0] === v[1]) return false;
  const ok = (id: unknown) => (isJobId(job) ? (JOBS[job].pool as readonly unknown[]).includes(id) : own(ABILITIES, id));
  return ok(v[0]) && ok(v[1]);
}
const validXp = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const plainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A clean record for `job` from `v`, or null when it cannot be read (not an object, or a future job's picks unusable). */
function parseRecord(job: JobId | FutureJobId, v: unknown): JobRecord | null {
  if (!plainObject(v)) return null;
  const xp = validXp(v.xp) ? v.xp : 0;
  let picks: [AbilityId, AbilityId];
  if (validPicks(job, v.picks)) picks = [v.picks[0], v.picks[1]];
  else if (isJobId(job)) picks = [JOBS[job].picks.solo[0], JOBS[job].picks.solo[1]];
  else return null;
  const talents = Array.isArray(v.talents) ? v.talents.filter((t): t is string => typeof t === 'string') : [];
  return { level: levelForXp(xp), xp, picks, talents, outfit: null };
}

/**
 * A JobsSave from stored data; never throws. With an object `v`, each readable record is kept and its
 * bad parts fixed (xp → 0 unless a non-negative integer, level = levelForXp(xp), picks invalid for the
 * job → its solo picks, talents → strings only, outfit → null); unknown keys are dropped, future-job
 * keys kept. An invalid `current` reads as the Warrior. When `v` is not an object or has no valid
 * current, and `legacy` (a Plan 3 loadout) passes legacyLoadout, its job becomes current with its
 * picks. Otherwise a new save. The current job always has a stored record.
 */
export function parseJobsSave(v: unknown, legacy?: unknown): JobsSave {
  const jobs: JobsSave['jobs'] = {};
  if (plainObject(v) && plainObject(v.jobs)) {
    for (const k of Object.keys(v.jobs)) {
      if (!isJobId(k) && !isFutureJobId(k)) continue;
      const r = parseRecord(k, v.jobs[k]);
      if (r) jobs[k] = r;
    }
  }
  let current: JobId;
  if (plainObject(v) && isJobId(v.current)) current = v.current;
  else {
    const l = legacyLoadout(legacy);
    if (l) {
      current = l.job;
      if (!jobs[l.job]) jobs[l.job] = { ...freshRecord(l.job), picks: [l.picks[0], l.picks[1]] };
    } else if (!plainObject(v)) return newJobsSave();
    else current = 'warrior';
  }
  if (!jobs[current]) jobs[current] = freshRecord(current);
  return { current, jobs };
}

const RECORD_KEYS = ['level', 'outfit', 'picks', 'talents', 'xp'];
const sameKeys = (o: object, keys: readonly string[]) => {
  const k = Object.keys(o).sort();
  return k.length === keys.length && k.every((x, i) => x === keys[i]);
};
function isRecord(job: JobId | FutureJobId, v: unknown): v is JobRecord {
  return plainObject(v) && sameKeys(v, RECORD_KEYS) && validXp(v.xp) && v.level === levelForXp(v.xp) && validPicks(job, v.picks)
    && Array.isArray(v.talents) && v.talents.every((t) => typeof t === 'string') && v.outfit === null;
}

/** Strict: exactly what parseJobsSave returns unchanged (what saves must pass). */
export function isJobsSave(v: unknown): v is JobsSave {
  if (!plainObject(v) || !sameKeys(v, ['current', 'jobs']) || !isJobId(v.current) || !plainObject(v.jobs)) return false;
  const jobs = v.jobs;
  if (!own(jobs, v.current)) return false;
  return Object.keys(jobs).every((k) => (isJobId(k) || isFutureJobId(k)) && isRecord(k, jobs[k]));
}
