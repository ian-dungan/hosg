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
  name: string;
  x: number;
  z: number;
  facing: number;
  zone: 'grove';
  level: number;
  xp: number;
  gold: number;
}

/** Thrown by createAccount when the name is already used (names are compared case-insensitively). */
export class NameTakenError extends Error {
  constructor(username: string) {
    super(`Name taken: ${username}`);
    this.name = 'NameTakenError';
  }
}

export interface Store {
  /** Throws NameTakenError if the name is taken, ignoring case. */
  createAccount(a: { username: string; passwordHash: string | null; isGuest: boolean }): Promise<Account>;
  /** Case-insensitive. */
  findAccountByUsername(username: string): Promise<Account | null>;
  /** One adventurer per account; a new one spawns at SPAWN with level 1, 0 xp and 0 gold. */
  getOrCreateAdventurer(accountId: string, name: string): Promise<Adventurer>;
  /** Saves position and facing; an unknown id is ignored. */
  saveAdventurer(a: Pick<Adventurer, 'id' | 'x' | 'z' | 'facing'>): Promise<void>;
  close(): Promise<void>;
}
