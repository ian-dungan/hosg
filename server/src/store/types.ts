// What the server keeps between sessions: accounts and their adventurers.
import { isZoneId, parseLoadout, type Loadout, type ZoneId } from '@sg2/shared';

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
  /** The equipped weapon and the two free picks. A stored one that parseLoadout refuses reads as DEFAULT_LOADOUT. */
  loadout: Loadout;
  level: number;
  xp: number;
  gold: number;
}

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
export type AdventurerSave = Pick<Adventurer, 'id' | 'x' | 'z' | 'facing' | 'zone' | 'hp' | 'loadout'>;

/**
 * Checks a save before it is written, the same way for every store: throws a TypeError for an
 * unknown zone, a loadout parseLoadout refuses, or a non-finite position or hp. Returns the values to
 * write, with hp rounded to a whole number and a fresh copy of the loadout.
 */
export function checkedSave(a: AdventurerSave): AdventurerSave {
  if (!isZoneId(a.zone)) throw new TypeError(`saveAdventurer: unknown zone ${String(a.zone)}`);
  const loadout = parseLoadout(a.loadout);
  if (!loadout) throw new TypeError('saveAdventurer: not a loadout');
  for (const k of ['x', 'z', 'facing', 'hp'] as const) {
    if (!Number.isFinite(a[k])) throw new TypeError(`saveAdventurer: ${k} is not a finite number`);
  }
  return { id: a.id, x: a.x, z: a.z, facing: a.facing, zone: a.zone, hp: Math.round(a.hp), loadout };
}

export interface Store {
  /** Throws NameTakenError if the name is taken, ignoring case. */
  createAccount(a: { username: string; passwordHash: string | null; isGuest: boolean }): Promise<Account>;
  /** Case-insensitive. */
  findAccountByUsername(username: string): Promise<Account | null>;
  findAccountById(id: string): Promise<Account | null>;
  /**
   * One adventurer per account; a new one starts at the store's start spot (default the grove's SPAWN)
   * with no name, hp MAX_HP, DEFAULT_LOADOUT, level 1, 0 xp and 0 gold.
   */
  getOrCreateAdventurer(accountId: string): Promise<Adventurer>;
  /**
   * Gives the account's adventurer (created if needed) its permanent name. Throws NameTakenError if
   * another adventurer has it, ignoring case, and AlreadyNamedError ('already named') if this one has a name.
   * The name is stored as given: callers validate it first.
   */
  nameAdventurer(accountId: string, name: string): Promise<Adventurer>;
  /**
   * Saves position, facing, zone, hp and loadout together; resolves true if it was written. An unknown
   * id is ignored (false). With `expect`, it is written only while the stored zone is `expect.zone`
   * (false otherwise): a room saves only adventurers that are still its own, so a session left behind
   * after a travel can never pull the adventurer back. Throws a TypeError for values checkedSave refuses.
   */
  saveAdventurer(a: AdventurerSave, expect?: { zone: ZoneId }): Promise<boolean>;
  close(): Promise<void>;
}
