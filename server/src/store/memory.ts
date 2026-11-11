// In-memory Store for tests and for running without a database. Data is lost on restart.
import { randomUUID } from 'node:crypto';
import { SPAWN } from '@sg2/shared';
import { NameTakenError, type Account, type Adventurer, type Store } from './types';

export function createMemoryStore(): Store {
  const accountsByName = new Map<string, Account>(); // key: lower-cased username
  const accountsById = new Map<string, Account>();
  const adventurersByAccount = new Map<string, Adventurer>();
  const adventurersById = new Map<string, Adventurer>();

  return {
    async createAccount({ username, passwordHash, isGuest }) {
      const key = username.toLowerCase();
      if (accountsByName.has(key)) throw new NameTakenError(username);
      const account: Account = { id: randomUUID(), username, passwordHash, isGuest, isGm: false };
      accountsByName.set(key, account);
      accountsById.set(account.id, account);
      return { ...account };
    },

    async findAccountByUsername(username) {
      const account = accountsByName.get(username.toLowerCase());
      return account ? { ...account } : null;
    },

    async findAccountById(id) {
      const account = accountsById.get(id);
      return account ? { ...account } : null;
    },

    async getOrCreateAdventurer(accountId, name) {
      let adventurer = adventurersByAccount.get(accountId);
      if (!adventurer) {
        adventurer = {
          id: randomUUID(),
          accountId,
          name,
          x: SPAWN.x,
          z: SPAWN.z,
          facing: SPAWN.facing,
          zone: 'grove',
          level: 1,
          xp: 0,
          gold: 0,
        };
        adventurersByAccount.set(accountId, adventurer);
        adventurersById.set(adventurer.id, adventurer);
      }
      return { ...adventurer };
    },

    async saveAdventurer({ id, x, z, facing }) {
      const adventurer = adventurersById.get(id);
      if (!adventurer) return;
      adventurer.x = x;
      adventurer.z = z;
      adventurer.facing = facing;
    },

    async close() {},
  };
}
