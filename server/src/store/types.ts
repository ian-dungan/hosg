// What the server keeps between sessions: accounts and their adventurers.

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
  zone: 'grove';
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

export interface Store {
  /** Throws NameTakenError if the name is taken, ignoring case. */
  createAccount(a: { username: string; passwordHash: string | null; isGuest: boolean }): Promise<Account>;
  /** Case-insensitive. */
  findAccountByUsername(username: string): Promise<Account | null>;
  findAccountById(id: string): Promise<Account | null>;
  /** One adventurer per account; a new one spawns at SPAWN with no name, level 1, 0 xp and 0 gold. */
  getOrCreateAdventurer(accountId: string): Promise<Adventurer>;
  /**
   * Gives the account's adventurer (created if needed) its permanent name. Throws NameTakenError if
   * another adventurer has it, ignoring case, and AlreadyNamedError ('already named') if this one has a name.
   * The name is stored as given: callers validate it first.
   */
  nameAdventurer(accountId: string, name: string): Promise<Adventurer>;
  /** Saves position and facing; an unknown id is ignored. */
  saveAdventurer(a: Pick<Adventurer, 'id' | 'x' | 'z' | 'facing'>): Promise<void>;
  close(): Promise<void>;
}
