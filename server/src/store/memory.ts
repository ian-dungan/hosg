// In-memory Store for tests and for running without a database. Data is lost on restart.
import { randomUUID } from 'node:crypto';
import { MAX_HP, SPAWN, isZoneId, newJobsSave, parseJobsSave, parseLook } from '@sg2/shared';
import {
  AlreadyNamedError, NameTakenError, checkedGmLog, checkedInvWrite, checkedKill, checkedSave, goldAfter, highestLevel, isUtcDay, jobsNeedRepair, readInvLook,
  testKitInventory, type Account, type Adventurer, type BossKill, type GmAuditRow, type NewAdventurerOpts, type StartSpot, type Store,
} from './types';
import { grantByCas } from '../gm/grant';

/**
 * A stored adventurer, kept as a database row would be: jobs, inventory and look as stored (as JSON text, so
 * nothing is shared with a caller), and Plan 3's loadout column (legacy rows only).
 */
type Row = Omit<Adventurer, 'jobs' | 'inventory' | 'look' | 'inventoryRepaired'> & { jobs: unknown; inventory: string | null; look: string | null; legacyLoadout?: unknown };

/** Test-only: an adventurer stored by Plan 3 (its old loadout; jobs absent when the migration missed it), or with any stored inventory or look. */
export interface LegacyRow { accountId: string; jobs?: unknown; loadout?: unknown; inventory?: unknown; look?: unknown }

const json = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));
const unjson = (s: string | null): unknown => (s === null ? null : JSON.parse(s));

/** A copy that shares nothing with the stored row, read as PgStore reads one (parseJobsSave(jobs, loadout), readInvLook). */
const copy = ({ legacyLoadout, jobs, titles, inventory, look, ...a }: Row): Adventurer => ({
  ...a, titles: [...titles], jobs: parseJobsSave(jobs, legacyLoadout), ...(jobsNeedRepair(jobs) ? { jobsRepaired: true as const } : {}),
  ...readInvLook(unjson(inventory), unjson(look), a.accountId),
});

/**
 * testGms (test-only, SG2_TEST_GMS with the memory store; never with a database): accounts created with one of
 * these usernames (any case) are GMs.
 */
export function createMemoryStore(opts: { start?: StartSpot; legacyRows?: readonly LegacyRow[]; newAdventurer?: NewAdventurerOpts; testGms?: readonly string[] } = {}): Store {
  const testGms = new Set((opts.testGms ?? []).map((n) => n.toLowerCase()));
  const start: StartSpot = opts.start ?? { zone: 'grove', x: SPAWN.x, z: SPAWN.z, facing: SPAWN.facing };
  const accountsByName = new Map<string, Account>(); // key: lower-cased username
  const accountsById = new Map<string, Account>();
  const adventurersByAccount = new Map<string, Row>();
  const adventurersById = new Map<string, Row>();
  const adventurerNames = new Set<string>(); // lower-cased
  const kills: (BossKill & { seq: number })[] = [];
  const audit: (GmAuditRow & { seq: number })[] = [];

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
        gold: opts.newAdventurer?.gold ?? 0,
        seals: 0,
        sealDay: null,
        titles: [],
        // NULL until first written: the reader gives the starter kit (a test kit is stored at once)
        inventory: opts.newAdventurer?.kit ? json(testKitInventory(opts.newAdventurer.kit)) : null,
        invVersion: 0,
        look: null,
        lookFree: true,
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
    if (r.inventory !== undefined) row.inventory = json(r.inventory);
    if (r.look !== undefined) row.look = json(r.look);
  }

  return {
    async createAccount({ username, passwordHash, isGuest }) {
      const key = username.toLowerCase();
      if (accountsByName.has(key)) throw new NameTakenError(username);
      const account: Account = { id: randomUUID(), username, passwordHash, isGuest, isGm: testGms.has(key) };
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
      Object.assign(adventurer, values, { level: highestLevel(values.jobs) });
      return true;
    },

    async writeInventory(adventurerId, expect, w) {
      const v = checkedInvWrite(w);
      const adventurer = adventurersById.get(adventurerId);
      if (!adventurer || adventurer.invVersion !== expect) return null;
      if (adventurer.gold + v.dGold < 0 || adventurer.seals + v.dSeals < 0) return null;
      adventurer.inventory = json(v.inventory);
      if (v.jobs) {
        adventurer.jobs = v.jobs;
        adventurer.level = highestLevel(v.jobs);
      }
      adventurer.gold = goldAfter(adventurer.gold, v.dGold);
      adventurer.seals += v.dSeals;
      if (v.look) adventurer.look = json(v.look);
      if (v.lookFree === false) adventurer.lookFree = false;
      adventurer.invVersion += 1;
      return { version: adventurer.invVersion, gold: adventurer.gold, seals: adventurer.seals };
    },

    async useFreeLook(accountId, look) {
      const l = parseLook(look);
      if (!l) throw new TypeError('useFreeLook: not a look');
      const adventurer = adventurersByAccount.get(accountId);
      if (!adventurer || !adventurer.lookFree) return false;
      adventurer.look = json(l);
      adventurer.lookFree = false;
      adventurer.invVersion += 1;
      return true;
    },

    async logGm(e) {
      const row = checkedGmLog(e);
      audit.push({ at: new Date().toISOString(), gmAccount: row.gmAccount, command: row.command, target: row.target, args: row.args, ok: row.ok, result: row.result, seq: audit.length });
      if (audit.length > 10_000) audit.splice(0, audit.length - 10_000); // memory only: the newest rows are enough
    },

    async gmAudit(limit = 100) {
      return audit.slice().reverse().slice(0, Math.max(0, Math.floor(limit))).map(({ seq: _seq, ...r }) => ({ ...r, args: JSON.parse(JSON.stringify(r.args)) as unknown }));
    },

    async setGm(username, on) {
      const account = accountsByName.get(String(username).toLowerCase());
      if (!account || typeof on !== 'boolean' || (on && account.isGuest)) return false;
      account.isGm = on;
      return true;
    },

    async listGms() {
      return [...accountsById.values()].filter((a) => a.isGm).map((a) => a.username).sort((a, b) => a.localeCompare(b));
    },

    async grantOffline(name, g) {
      if (typeof name !== 'string') return 'unknown';
      const key = name.toLowerCase();
      const row = [...adventurersByAccount.values()].find((r) => r.name !== null && r.name.toLowerCase() === key);
      if (!row) return 'unknown';
      return grantByCas(this, row.accountId, g);
    },

    async gmGoldToday(gmAccount, dayUtc) {
      let sum = 0;
      for (const r of audit) {
        const amount = (r.args as { amount?: unknown } | null)?.amount;
        if (r.gmAccount === gmAccount && r.command === 'grant gold' && r.ok && r.at.slice(0, 10) === dayUtc && Number.isSafeInteger(amount)) sum += amount as number;
      }
      return sum;
    },

    async awardSeal(adventurerId, dayUtc) {
      if (!isUtcDay(dayUtc)) throw new TypeError(`awardSeal: not a day: ${String(dayUtc)}`);
      const adventurer = adventurersById.get(adventurerId);
      if (!adventurer) return { awarded: false, seals: 0 };
      if (adventurer.sealDay !== null && adventurer.sealDay >= dayUtc) return { awarded: false, seals: adventurer.seals }; // ('YYYY-MM-DD' sorts as dates)
      adventurer.seals += 1;
      adventurer.sealDay = dayUtc;
      adventurer.invVersion += 1; // a write computed before the Seal retries from the new truth
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
