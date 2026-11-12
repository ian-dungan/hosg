// What the server keeps between sessions: accounts and their adventurers.
import { isJobsSave, isSaveZoneId, parseJobsSave, type JobsSave, type ZoneId } from '@sg2/shared';

export interface Account {
  id: string;
  username: string;
  passwordHash: string | null;
  isGuest: boolean;
  isGm: boolean;
}

export interface Adventurer {
  id: string;
  accountId: string;
  /** Chosen once by the player (guests get their Guest- name); null until then. Unique, ignoring case. */
  name: string | null;
  x: number;
  z: number;
  facing: number;
  /** The zone whose room the adventurer joins (x, z and facing are in it). */
  zone: ZoneId;
  /** Health when last saved: a whole number (a room brings it inside 1..maxHp when the adventurer joins). */
  hp: number;
  /**
   * The current job and every job's own record (level, xp, picks). Read with parseJobsSave(jobs, the old
   * loadout column), so bad parts are fixed and a Plan 3 save (Blade or Bow) reads as the Warrior or Ranger.
   */
  jobs: JobsSave;
  /**
   * Present (true) only when the stored jobs value had to be repaired to read (a Plan 3 save, garbage,
   * a pick from the wrong job): the room writes the repaired value back on the adventurer's first join.
   */
  jobsRepaired?: true;
  /**
   * The adventurer's own level and xp columns: untouched and unused until Plan 5 (the level curve).
   * Job xp lives in jobs (each job's record).
   */
  level: number;
  xp: number;
  gold: number;
  /** Warden's Seals held (one a UTC day, for a Warden kill; Plan 5 exchanges them). */
  seals: number;
  /** The UTC day ('YYYY-MM-DD') of the last Seal, or null. */
  sealDay: string | null;
  /** Titles held (for example 'Lampbreaker'), each once, in the order won. */
  titles: string[];
}

/** One boss kill for the leaderboard: the party size, seconds from the boss's wake to its death, the credited names. */
export interface BossKill { boss: 'wickhound' | 'fallen_warden'; partySize: number; seconds: number; names: string[]; at: Date }

/** The bosses the leaderboard keeps. */
export const BOSS_KILL_BOSSES: readonly BossKill['boss'][] = ['wickhound', 'fallen_warden'];

/** Checks a kill before it is recorded (both stores): a known boss, a party size of 1..4, seconds > 0, 1..4 names. */
export function checkedKill(k: BossKill): BossKill {
  if (!BOSS_KILL_BOSSES.includes(k.boss)) throw new TypeError(`recordBossKill: unknown boss ${String(k.boss)}`);
  if (!Number.isInteger(k.partySize) || k.partySize < 1 || k.partySize > 4) throw new TypeError('recordBossKill: party size must be 1..4');
  if (!Number.isFinite(k.seconds) || !(k.seconds > 0)) throw new TypeError('recordBossKill: seconds must be > 0');
  if (!Array.isArray(k.names) || k.names.length < 1 || k.names.length > 4 || !k.names.every((n) => typeof n === 'string')) throw new TypeError('recordBossKill: 1..4 names');
  if (!(k.at instanceof Date) || !Number.isFinite(k.at.getTime())) throw new TypeError('recordBossKill: at must be a date');
  return { boss: k.boss, partySize: k.partySize, seconds: k.seconds, names: [...k.names], at: new Date(k.at.getTime()) };
}

/** A UTC day as 'YYYY-MM-DD' (what awardSeal takes). */
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Whether `day` is a 'YYYY-MM-DD' string. */
export function isUtcDay(day: unknown): day is string {
  if (typeof day !== 'string' || !DAY_RE.test(day)) return false;
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(t) && utcDay(t) === day;
}

/** Whether a stored jobs value reads only after repair (isJobsSave refuses it as stored). */
export const jobsNeedRepair = (stored: unknown): boolean => !isJobsSave(stored);

/**
 * Thrown by createAccount, or by nameAdventurer, when the name is already used by another account or
 * adventurer (names are compared case-insensitively).
 */
export class NameTakenError extends Error {
  constructor(username: string) {
    super(`Name taken: ${username}`);
    this.name = 'NameTakenError';
  }
}

/** Thrown by nameAdventurer when the adventurer already has a name (names are permanent). */
export class AlreadyNamedError extends Error {
  constructor() {
    super('already named');
    this.name = 'AlreadyNamedError';
  }
}

/** Where new adventurers start (default: the grove's SPAWN). */
export interface StartSpot {
  zone: ZoneId;
  x: number;
  z: number;
  facing: number;
}

/** What saveAdventurer takes. */
export type AdventurerSave = Pick<Adventurer, 'id' | 'x' | 'z' | 'facing' | 'zone' | 'hp' | 'jobs'>;

/**
 * Checks a save before it is written, the same way for every store: throws a TypeError for an
 * unknown zone, a jobs value isJobsSave refuses, or a non-finite position or hp. Returns the values to
 * write, with hp rounded to a whole number and a deep copy of jobs.
 */
export function checkedSave(a: AdventurerSave): AdventurerSave {
  if (!isSaveZoneId(a.zone)) throw new TypeError(`saveAdventurer: unknown zone ${String(a.zone)}`);
  if (!isJobsSave(a.jobs)) throw new TypeError('saveAdventurer: not a jobs save');
  for (const k of ['x', 'z', 'facing', 'hp'] as const) {
    if (!Number.isFinite(a[k])) throw new TypeError(`saveAdventurer: ${k} is not a finite number`);
  }
  return { id: a.id, x: a.x, z: a.z, facing: a.facing, zone: a.zone, hp: Math.round(a.hp), jobs: parseJobsSave(a.jobs) };
}

export interface Store {
  /** Throws NameTakenError if the name is taken, ignoring case. */
  createAccount(a: { username: string; passwordHash: string | null; isGuest: boolean }): Promise<Account>;
  /** Case-insensitive. */
  findAccountByUsername(username: string): Promise<Account | null>;
  findAccountById(id: string): Promise<Account | null>;
  /**
   * One adventurer per account; a new one starts at the store's start spot (default the grove's SPAWN)
   * with no name, hp MAX_HP, newJobsSave() (a level 1 Warrior with mend and bulwark), level 1, 0 xp and 0 gold.
   */
  getOrCreateAdventurer(accountId: string): Promise<Adventurer>;
  /**
   * Gives the account's adventurer (created if needed) its permanent name. Throws NameTakenError if
   * another adventurer has it, ignoring case, and AlreadyNamedError ('already named') if this one has a name.
   * The name is stored as given: callers validate it first.
   */
  nameAdventurer(accountId: string, name: string): Promise<Adventurer>;
  /**
   * Saves position, facing, zone, hp and jobs together; resolves true if it was written. An unknown
   * id is ignored (false). With `expect`, it is written only while the stored zone is `expect.zone`
   * (false otherwise; a stored zone that is not a known ZoneId, which reads as 'grove', always
   * matches): a room saves only adventurers that are still its own, so a session left behind after
   * a travel can never pull the adventurer back. Throws a TypeError for values checkedSave refuses.
   */
  saveAdventurer(a: AdventurerSave, expect?: { zone: ZoneId }): Promise<boolean>;
  /**
   * One Warden's Seal for the adventurer, atomically, only when its sealDay is not `dayUtc` ('YYYY-MM-DD'):
   * awarded false (and nothing changed) when it already had that day's Seal, or for an unknown id. seals:
   * the count after. Never touched by saveAdventurer.
   */
  awardSeal(adventurerId: string, dayUtc: string): Promise<{ awarded: boolean; seals: number }>;
  /** Adds a title to the adventurer, atomically; false if it already holds it (or the id is unknown). */
  addTitle(adventurerId: string, title: string): Promise<boolean>;
  /** Records a boss kill; rank: 1 + the kills of the same boss and size that were faster (ties share the better rank). */
  recordBossKill(k: BossKill): Promise<{ rank: number }>;
  /** The fastest kills of a boss at a party size (at most `limit`, default 10, fastest first; ties by time). */
  bossLeaderboard(boss: BossKill['boss'], partySize: number, limit?: number): Promise<{ names: string[]; seconds: number; at: string }[]>;
  close(): Promise<void>;
}
