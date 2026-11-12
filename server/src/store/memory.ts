// In-memory Store for tests and for running without a database. Data is lost on restart.
import { randomUUID } from 'node:crypto';
import { DEFAULT_LOADOUT, MAX_HP, SPAWN, isZoneId } from '@sg2/shared';
import { AlreadyNamedError, NameTakenError, checkedSave, type Account, type Adventurer, type StartSpot, type Store } from './types';

/** A copy that shares nothing with the stored adventurer (its loadout is copied too). */
const copy = (a: Adventurer): Adventurer => ({ ...a, loadout: { weapon: a.loadout.weapon, free: [a.loadout.free[0], a.loadout.free[1]] } });

export function createMemoryStore(opts: { start?: StartSpot } = {}): Store {
  const start: StartSpot = opts.start ?? { zone: 'grove', x: SPAWN.x, z: SPAWN.z, facing: SPAWN.facing };
  const accountsByName = new Map<string, Account>(); // key: lower-cased username
  const accountsById = new Map<string, Account>();
  const adventurersByAccount = new Map<string, Adventurer>();
  const adventurersById = new Map<string, Adventurer>();
  const adventurerNames = new Set<string>(); // lower-cased

  function adventurerFor(accountId: string): Adventurer {
    let adventurer = adventurersByAccount.get(accountId);
    if (!adventurer) {
      adventurer = {
        id: randomUUID(),
        accountId,
        name: null,
        x: start.x,
        z: start.z,
        facing: start.facing,
        zone: start.zone,
        hp: MAX_HP,
        loadout: { weapon: DEFAULT_LOADOUT.weapon, free: [DEFAULT_LOADOUT.free[0], DEFAULT_LOADOUT.free[1]] },
        level: 1,
        xp: 0,
        gold: 0,
      };
      adventurersByAccount.set(accountId, adventurer);
      adventurersById.set(adventurer.id, adventurer);
    }
    return adventurer;
  }

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

    async getOrCreateAdventurer(accountId) {
      return copy(adventurerFor(accountId));
    },

    async nameAdventurer(accountId, name) {
      const adventurer = adventurerFor(accountId);
      if (adventurer.name !== null) throw new AlreadyNamedError();
      const key = name.toLowerCase();
      if (adventurerNames.has(key)) throw new NameTakenError(name);
      adventurerNames.add(key);
      adventurer.name = name;
      return copy(adventurer);
    },

    async saveAdventurer(a, expect) {
      const { id, ...values } = checkedSave(a);
      const adventurer = adventurersById.get(id);
      // As in PgStore: a stored zone that is not a known one (never written here) matches any `expect`.
      if (!adventurer || (expect && adventurer.zone !== expect.zone && isZoneId(adventurer.zone))) return false;
      Object.assign(adventurer, values);
      return true;
    },

    async close() {},
  };
}
