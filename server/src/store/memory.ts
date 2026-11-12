// In-memory Store for tests and for running without a database. Data is lost on restart.
import { randomUUID } from 'node:crypto';
import { MAX_HP, SPAWN, isZoneId, newJobsSave, parseJobsSave } from '@sg2/shared';
import { AlreadyNamedError, NameTakenError, checkedKill, checkedSave, isUtcDay, jobsNeedRepair, type Account, type Adventurer, type BossKill, type StartSpot, type Store } from './types';

/** A stored adventurer, kept as a database row would be: jobs as stored, and Plan 3's loadout column (legacy rows only). */
type Row = Omit<Adventurer, 'jobs'> & { jobs: unknown; legacyLoadout?: unknown };

/** Test-only: an adventurer stored by Plan 3 (its old loadout; jobs absent when the migration missed it). */
export interface LegacyRow { accountId: string; jobs?: unknown; loadout?: unknown }

/** A copy that shares nothing with the stored row, read as PgStore reads one (parseJobsSave(jobs, loadout)). */
const copy = ({ legacyLoadout, jobs, titles, ...a }: Row): Adventurer => ({
  ...a, titles: [...titles], jobs: parseJobsSave(jobs, legacyLoadout), ...(jobsNeedRepair(jobs) ? { jobsRepaired: true as const } : {}),
});

export function createMemoryStore(opts: { start?: StartSpot; legacyRows?: readonly LegacyRow[] } = {}): Store {
  const start: StartSpot = opts.start ?? { zone: 'grove', x: SPAWN.x, z: SPAWN.z, facing: SPAWN.facing };
  const accountsByName = new Map<string, Account>(); // key: lower-cased username
  const accountsById = new Map<string, Account>();
  const adventurersByAccount = new Map<string, Row>();
  const adventurersById = new Map<string, Row>();
  const adventurerNames = new Set<string>(); // lower-cased
  const kills: (BossKill & { seq: number })[] = [];

  function adventurerFor(accountId: string): Row {
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
        jobs: newJobsSave(),
        level: 1,
        xp: 0,
        gold: 0,
        seals: 0,
        sealDay: null,
        titles: [],
      };
      adventurersByAccount.set(accountId, adventurer);
      adventurersById.set(adventurer.id, adventurer);
    }
    return adventurer;
  }

  for (const r of opts.legacyRows ?? []) {
    const row = adventurerFor(r.accountId);
    row.jobs = r.jobs;
    row.legacyLoadout = r.loadout;
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

    async awardSeal(adventurerId, dayUtc) {
      if (!isUtcDay(dayUtc)) throw new TypeError(`awardSeal: not a day: ${String(dayUtc)}`);
      const adventurer = adventurersById.get(adventurerId);
      if (!adventurer) return { awarded: false, seals: 0 };
      if (adventurer.sealDay !== null && adventurer.sealDay >= dayUtc) return { awarded: false, seals: adventurer.seals }; // ('YYYY-MM-DD' sorts as dates)
      adventurer.seals += 1;
      adventurer.sealDay = dayUtc;
      return { awarded: true, seals: adventurer.seals };
    },

    async addTitle(adventurerId, title) {
      if (typeof title !== 'string' || title === '') throw new TypeError('addTitle: not a title');
      const adventurer = adventurersById.get(adventurerId);
      if (!adventurer || adventurer.titles.includes(title)) return false;
      adventurer.titles.push(title);
      return true;
    },

    async recordBossKill(k) {
      const kill = checkedKill(k);
      const rank = 1 + kills.filter((o) => o.boss === kill.boss && o.partySize === kill.partySize && o.seconds < kill.seconds).length;
      kills.push({ ...kill, seq: kills.length });
      return { rank };
    },

    async bossLeaderboard(boss, partySize, limit = 10) {
      return kills
        .filter((k) => k.boss === boss && k.partySize === partySize)
        .sort((a, b) => a.seconds - b.seconds || a.at.getTime() - b.at.getTime() || a.seq - b.seq)
        .slice(0, Math.max(0, Math.floor(limit)))
        .map((k) => ({ names: [...k.names], seconds: k.seconds, at: k.at.toISOString() }));
    },

    async close() {},
  };
}
