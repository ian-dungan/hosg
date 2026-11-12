import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { MAX_HP, SPAWN, isJobsSave, newJobsSave, type JobsSave } from '@sg2/shared';
import { NameTakenError, checkedSave, type Adventurer, type Store } from './types';
import { createMemoryStore, type LegacyRow } from './memory';
import { createPgStore, createPool } from './pg';
import type { StartSpot } from './types';

const databaseUrl = process.env.TEST_DATABASE_URL;

// Names get a random suffix so the suite can run repeatedly against the same database.
function uniqueName(base: string): string {
  return `${base}_${Math.floor(Math.random() * 1e9)}`;
}

/** Everything saveAdventurer takes, for `a`, with these changes. */
function saved(a: Adventurer, changes: Partial<Pick<Adventurer, 'x' | 'z' | 'facing' | 'zone' | 'hp' | 'jobs'>> = {}) {
  const { id, x, z, facing, zone, hp, jobs } = a;
  return { id, x, z, facing, zone, hp, jobs, ...changes };
}

/** Plan 3's default loadout, exactly as migration 003 wrote it. */
const PLAN3_DEFAULT = { weapon: 'blade', free: ['mend', 'bulwark'] };

/** A record as JobsSave holds it. */
const rec = (xp: number, picks: [string, string], level = 1 + Math.floor(xp / 100)) => ({ level, xp, picks, talents: [], outfit: null });

/**
 * Opens a store holding one adventurer per row, stored as a Plan 3 save would be: `loadout` in its
 * old column and `jobs` as given (absent: a row the migration missed). Returns the account ids.
 */
type SeedLegacy = (rows: readonly Omit<LegacyRow, 'accountId'>[]) => Promise<{ store: Store; accountIds: string[] }>;

/** Writes a zone this server does not know straight into the stored row (only a database can hold one). */
type SetRawZone = (adventurerId: string, zone: string) => Promise<void>;

function storeSuite(label: string, open: (opts?: { start?: StartSpot }) => Promise<Store>, seedLegacy: SeedLegacy, setRawZone?: SetRawZone) {
  describe(label, () => {
    let store: Store;
    beforeAll(async () => {
      store = await open();
    });
    afterAll(async () => {
      await store?.close();
    });

    it('finds a created account by name, ignoring case', async () => {
      const username = uniqueName('Ellie');
      const created = await store.createAccount({ username, passwordHash: 'hash', isGuest: false });
      expect(created).toMatchObject({ username, passwordHash: 'hash', isGuest: false, isGm: false });
      expect(typeof created.id).toBe('string');

      const found = await store.findAccountByUsername(username.toUpperCase());
      expect(found).toEqual(created);
    });

    it('finds a created account by id, and returns null for an unknown id', async () => {
      const created = await store.createAccount({ username: uniqueName('Ellie'), passwordHash: 'hash', isGuest: false });
      expect(await store.findAccountById(created.id)).toEqual(created);
      expect(await store.findAccountById('00000000-0000-4000-8000-000000000000')).toBeNull();
      expect(await store.findAccountById('not-an-id')).toBeNull();
    });

    it('returns null for an unknown name', async () => {
      expect(await store.findAccountByUsername(uniqueName('Nobody'))).toBeNull();
    });

    it('stores guests without a password', async () => {
      const username = uniqueName('Guest');
      await store.createAccount({ username, passwordHash: null, isGuest: true });
      expect(await store.findAccountByUsername(username)).toMatchObject({ passwordHash: null, isGuest: true });
    });

    it('rejects a second account with the same name in another case', async () => {
      const username = uniqueName('Ellie');
      await store.createAccount({ username, passwordHash: 'a', isGuest: false });
      await expect(
        store.createAccount({ username: username.toLowerCase(), passwordHash: 'b', isGuest: false }),
      ).rejects.toBeInstanceOf(NameTakenError);
    });

    it('lets exactly one of 20 concurrent creates with the same name succeed', async () => {
      const username = uniqueName('Race');
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => store.createAccount({ username, passwordHash: 'h', isGuest: false })),
      );
      const ok = results.filter((r) => r.status === 'fulfilled');
      const taken = results.filter(
        (r) => r.status === 'rejected' && (r as PromiseRejectedResult).reason instanceof NameTakenError,
      );
      expect(ok).toHaveLength(1);
      expect(taken).toHaveLength(19);
    });

    it('creates one adventurer per account, at the spawn point', async () => {
      const account = await store.createAccount({ username: uniqueName('Ellie'), passwordHash: 'h', isGuest: false });
      const first = await store.getOrCreateAdventurer(account.id);
      const second = await store.getOrCreateAdventurer(account.id);
      expect(second.id).toBe(first.id);
      expect(first).toMatchObject({
        accountId: account.id,
        name: null,
        x: SPAWN.x,
        z: SPAWN.z,
        facing: SPAWN.facing,
        zone: 'grove',
        level: 1,
        xp: 0,
        gold: 0,
        hp: MAX_HP,
        jobs: newJobsSave(),
      });
      expect(first).not.toHaveProperty('loadout');
      expect(first).not.toHaveProperty('jobsRepaired');
      expect(first.hp).toBe(100);
    });

    it('names an adventurer once, and keeps the name', async () => {
      const account = await store.createAccount({ username: uniqueName('Ellie'), passwordHash: 'h', isGuest: false });
      const name = uniqueName('Elowen');
      const named = await store.nameAdventurer(account.id, name);
      expect(named).toMatchObject({ accountId: account.id, name, x: SPAWN.x, z: SPAWN.z, level: 1 });
      expect((await store.getOrCreateAdventurer(account.id)).name).toBe(name);
      await expect(store.nameAdventurer(account.id, uniqueName('Rowan'))).rejects.toThrow('already named');
      expect((await store.getOrCreateAdventurer(account.id)).name).toBe(name);
    });

    it('refuses a name another adventurer has, ignoring case', async () => {
      const name = uniqueName('Elowen');
      const first = await store.createAccount({ username: uniqueName('Ellie'), passwordHash: 'h', isGuest: false });
      const second = await store.createAccount({ username: uniqueName('Ellie'), passwordHash: 'h', isGuest: false });
      await store.nameAdventurer(first.id, name);
      await expect(store.nameAdventurer(second.id, name.toUpperCase())).rejects.toBeInstanceOf(NameTakenError);
      expect((await store.getOrCreateAdventurer(second.id)).name).toBeNull();
      // The refused account can still pick another name.
      const other = uniqueName('Rowan');
      expect((await store.nameAdventurer(second.id, other)).name).toBe(other);
    });

    it('lets exactly one of 20 accounts racing for a name have it', async () => {
      const name = uniqueName('Race');
      const accounts = await Promise.all(
        Array.from({ length: 20 }, () => store.createAccount({ username: uniqueName('Racer'), passwordHash: 'h', isGuest: false })),
      );
      const results = await Promise.allSettled(accounts.map((a) => store.nameAdventurer(a.id, name)));
      const ok = results.filter((r) => r.status === 'fulfilled');
      const taken = results.filter(
        (r) => r.status === 'rejected' && (r as PromiseRejectedResult).reason instanceof NameTakenError,
      );
      expect(ok).toHaveLength(1);
      expect(taken).toHaveLength(19);
    });

    it('returns the saved position and facing', async () => {
      const account = await store.createAccount({ username: uniqueName('Ellie'), passwordHash: 'h', isGuest: false });
      const adventurer = await store.getOrCreateAdventurer(account.id);
      await store.saveAdventurer(saved(adventurer, { x: 12.5, z: -3.25, facing: 1.75 }));
      const loaded = await store.getOrCreateAdventurer(account.id);
      expect(loaded).toMatchObject({ id: adventurer.id, x: 12.5, z: -3.25, facing: 1.75 });
    });

    it('round-trips zone and hp', async () => {
      const account = await store.createAccount({ username: uniqueName('Ellie'), passwordHash: 'h', isGuest: false });
      const adventurer = await store.getOrCreateAdventurer(account.id);
      expect(await store.saveAdventurer(saved(adventurer, { zone: 'greenway', hp: 37, x: 40, z: 2.5 }))).toBe(true);
      expect(await store.getOrCreateAdventurer(account.id)).toMatchObject({ zone: 'greenway', hp: 37, x: 40, z: 2.5 });
    });

    it('a new adventurer is a level 1 Warrior with mend and bulwark', async () => {
      const account = await store.createAccount({ username: uniqueName('Ellie'), passwordHash: 'h', isGuest: false });
      const { jobs } = await store.getOrCreateAdventurer(account.id);
      expect(jobs).toEqual({ current: 'warrior', jobs: { warrior: rec(0, ['mend', 'bulwark']) } });
      expect(isJobsSave(jobs)).toBe(true);
    });

    it('jobs round-trip, with per-job xp and picks', async () => {
      const account = await store.createAccount({ username: uniqueName('Ellie'), passwordHash: 'h', isGuest: false });
      const adventurer = await store.getOrCreateAdventurer(account.id);
      const jobs = {
        current: 'black_mage',
        jobs: {
          warrior: rec(230, ['bulwark', 'rallying_roar']),
          black_mage: rec(40, ['kindred_spark', 'stormcage']),
          ranger: rec(999, ['sprint', 'barbed_rain'], 10),
          monk: rec(0, ['mend', 'taunt']), // a future job's record is kept as it is
        },
      } as JobsSave;
      expect(isJobsSave(jobs)).toBe(true);
      expect(await store.saveAdventurer(saved(adventurer, { jobs, hp: 61 }))).toBe(true);
      expect(await store.getOrCreateAdventurer(account.id)).toMatchObject({ jobs, hp: 61 });
      // What is handed out is a copy: changing it changes nothing stored.
      const loaded = await store.getOrCreateAdventurer(account.id);
      loaded.jobs.current = 'warrior';
      loaded.jobs.jobs.warrior!.picks[0] = 'mend';
      loaded.jobs.jobs.warrior!.xp = 5;
      delete loaded.jobs.jobs.ranger;
      expect((await store.getOrCreateAdventurer(account.id)).jobs).toEqual(jobs);
      // And so is what was saved: changing the value passed in afterwards changes nothing either.
      const mine = structuredClone(jobs);
      await store.saveAdventurer(saved(adventurer, { jobs: mine }));
      mine.jobs.black_mage!.xp = 0;
      expect((await store.getOrCreateAdventurer(account.id)).jobs).toEqual(jobs);
    });

    it('checkedSave refuses a jobs value isJobsSave refuses', async () => {
      const account = await store.createAccount({ username: uniqueName('Ellie'), passwordHash: 'h', isGuest: false });
      const adventurer = await store.getOrCreateAdventurer(account.id);
      const bad: unknown[] = [
        undefined,
        null,
        'warrior',
        [],
        { current: 'warrior', jobs: {} }, // the current job has no record
        { current: 'monk', jobs: { monk: rec(0, ['mend', 'taunt']) } }, // a future job is never current
        { current: 'wizard', jobs: { warrior: rec(0, ['mend', 'bulwark']) } },
        { current: 'warrior', jobs: { warrior: rec(0, ['mend', 'mend']) } },
        { current: 'warrior', jobs: { warrior: rec(0, ['mend', 'taunt']) } }, // taunt is the Paladin's
        { current: 'warrior', jobs: { warrior: rec(0, ['slash', 'mend']) } }, // a bar ability
        { current: 'warrior', jobs: { warrior: rec(150, ['mend', 'bulwark'], 1) } }, // level not from xp
        { current: 'warrior', jobs: { warrior: rec(-1, ['mend', 'bulwark'], 1) } },
        { current: 'warrior', jobs: { warrior: rec(0, ['mend', 'bulwark']) }, extra: 1 },
        { current: 'warrior', jobs: { warrior: rec(0, ['mend', 'bulwark']), wizard: rec(0, ['mend', 'bulwark']) } },
      ];
      for (const jobs of bad) {
        expect(isJobsSave(jobs)).toBe(false);
        const values = { ...saved(adventurer), jobs: jobs as JobsSave, x: 99 };
        expect(() => checkedSave(values)).toThrow(TypeError);
        await expect(store.saveAdventurer(values)).rejects.toThrow(TypeError);
      }
      expect(await store.getOrCreateAdventurer(account.id)).toEqual(adventurer);
      // What it returns is a deep copy.
      const jobs = newJobsSave('ninja');
      const checked = checkedSave(saved(adventurer, { jobs }));
      expect(checked.jobs).toEqual(jobs);
      expect(checked.jobs).not.toBe(jobs);
      expect(checked.jobs.jobs.ninja).not.toBe(jobs.jobs.ninja);
      expect(checked.jobs.jobs.ninja!.picks).not.toBe(jobs.jobs.ninja!.picks);
    });

    it('legacy rows load: blade → warrior with picks kept, bow with taunt and sprint → ranger with its solo picks, garbage → new', async () => {
      const wrongJob = { current: 'paladin', jobs: { paladin: rec(150, ['mend', 'taunt']), warrior: rec(30, ['mend', 'bulwark']) } };
      const { store: s, accountIds } = await seedLegacy([
        { loadout: PLAN3_DEFAULT },
        { loadout: { weapon: 'blade', free: ['bulwark', 'mend'] } },
        { loadout: { weapon: 'blade', free: ['taunt', 'sprint'] } },
        { loadout: { weapon: 'bow', free: ['taunt', 'sprint'] } },
        { loadout: { weapon: 'bow', free: ['mend', 'bulwark'] } },
        { loadout: '"blade"' },
        { loadout: [] },
        { loadout: { weapon: 'staff', free: ['mend', 'bulwark'] } },
        { jobs: 'garbage', loadout: null },
        { jobs: wrongJob, loadout: { weapon: 'bow', free: ['taunt', 'sprint'] } }, // jobs wins over the old column
      ]);
      try {
        const jobsOf = async (i: number) => (await s.getOrCreateAdventurer(accountIds[i]!)).jobs;
        const warrior = (picks: [string, string]) => ({ current: 'warrior', jobs: { warrior: rec(0, picks) } });
        const ranger = { current: 'ranger', jobs: { ranger: rec(0, ['field_dressing', 'pinning_shot']) } };
        expect(await jobsOf(0)).toEqual(warrior(['mend', 'bulwark']));
        expect(await jobsOf(1)).toEqual(warrior(['bulwark', 'mend']));
        expect(await jobsOf(2)).toEqual(warrior(['mend', 'bulwark'])); // not the Warrior's picks: its solo picks
        expect(await jobsOf(3)).toEqual(ranger);
        expect(await jobsOf(4)).toEqual(ranger);
        for (const i of [5, 6, 7, 8]) expect(await jobsOf(i)).toEqual(newJobsSave());
        // A picked ability from the wrong job reads as that job's solo picks; xp and the other record are kept.
        expect(await jobsOf(9)).toEqual({ current: 'paladin', jobs: { paladin: rec(150, ['kindle', 'dawn_ward']), warrior: rec(30, ['mend', 'bulwark']) } });
        for (let i = 0; i < accountIds.length; i++) expect(isJobsSave(await jobsOf(i))).toBe(true);
        // Each was repaired to read, and says so (the room writes it back on the first join).
        for (let i = 0; i < accountIds.length; i++) expect((await s.getOrCreateAdventurer(accountIds[i]!)).jobsRepaired).toBe(true);
        // A legacy adventurer saves (and then reads) as any other.
        const a = await s.getOrCreateAdventurer(accountIds[3]!);
        const jobs = { current: 'ranger', jobs: { ranger: rec(10, ['sprint', 'barbed_rain']) } } as JobsSave;
        expect(await s.saveAdventurer(saved(a, { jobs }))).toBe(true);
        expect(await jobsOf(3)).toEqual(jobs);
        expect(await s.getOrCreateAdventurer(accountIds[3]!)).not.toHaveProperty('jobsRepaired');
      } finally {
        await s.close();
      }
    });

    it('stores hp as a whole number', async () => {
      const account = await store.createAccount({ username: uniqueName('Ellie'), passwordHash: 'h', isGuest: false });
      const adventurer = await store.getOrCreateAdventurer(account.id);
      await store.saveAdventurer(saved(adventurer, { hp: 41.6 }));
      expect((await store.getOrCreateAdventurer(account.id)).hp).toBe(42);
    });

    it('refuses to save an unknown zone, a bad jobs value or a non-finite hp, and keeps what was stored', async () => {
      const account = await store.createAccount({ username: uniqueName('Ellie'), passwordHash: 'h', isGuest: false });
      const adventurer = await store.getOrCreateAdventurer(account.id);
      const bad: unknown[] = [
        { zone: 'moon' },
        { zone: 'lampfall' }, // an instance is never a saved zone (saved at the crater mouth instead)
        { hp: Number.NaN },
        { hp: Infinity },
        { jobs: PLAN3_DEFAULT }, // a Plan 3 loadout is no longer saved
        { jobs: { current: 'warrior', jobs: { warrior: rec(0, ['mend', 'mend']) } } },
        { jobs: { current: 'warrior', jobs: { warrior: rec(0, ['slash', 'mend']) } } },
      ];
      for (const change of bad) {
        await expect(store.saveAdventurer({ ...saved(adventurer), ...(change as object), x: 99 })).rejects.toThrow(TypeError);
      }
      expect(await store.getOrCreateAdventurer(account.id)).toEqual(adventurer);
    });

    it('saves only while the stored zone is the expected one, and says whether it did', async () => {
      const account = await store.createAccount({ username: uniqueName('Ellie'), passwordHash: 'h', isGuest: false });
      const adventurer = await store.getOrCreateAdventurer(account.id);
      expect(await store.saveAdventurer(saved(adventurer, { zone: 'greenway', x: 8 }), { zone: 'grove' })).toBe(true);
      // The grove no longer holds this adventurer: a late save from it changes nothing.
      expect(await store.saveAdventurer(saved(adventurer, { zone: 'grove', x: 1 }), { zone: 'grove' })).toBe(false);
      expect(await store.getOrCreateAdventurer(account.id)).toMatchObject({ zone: 'greenway', x: 8 });
      expect(await store.saveAdventurer(saved(adventurer, { zone: 'greenway', x: 9 }), { zone: 'greenway' })).toBe(true);
      expect((await store.getOrCreateAdventurer(account.id)).x).toBe(9);
      // An unknown id is ignored.
      expect(await store.saveAdventurer({ ...saved(adventurer), id: '00000000-0000-4000-8000-000000000000' })).toBe(false);
    });

    if (setRawZone) {
      it('an adventurer stored in an unknown zone reads as the grove, and the grove can save it', async () => {
        const account = await store.createAccount({ username: uniqueName('Ellie'), passwordHash: 'h', isGuest: false });
        const adventurer = await store.getOrCreateAdventurer(account.id);
        await setRawZone(adventurer.id, 'moon');
        expect((await store.getOrCreateAdventurer(account.id)).zone).toBe('grove');
        expect(await store.saveAdventurer(saved(adventurer, { x: 3 }), { zone: 'grove' })).toBe(true);
        expect(await store.getOrCreateAdventurer(account.id)).toMatchObject({ zone: 'grove', x: 3 });
        // Once it is in a known zone, the zone check applies again.
        expect(await store.saveAdventurer(saved(adventurer, { x: 4 }), { zone: 'greenway' })).toBe(false);
      });
    }

    it('puts new adventurers at the start spot it was opened with', async () => {
      const start: StartSpot = { zone: 'greenway', x: 8, z: 3.5, facing: 1.5 };
      const other = await open({ start });
      try {
        const account = await other.createAccount({ username: uniqueName('Ellie'), passwordHash: 'h', isGuest: false });
        expect(await other.getOrCreateAdventurer(account.id)).toMatchObject({ ...start, hp: 100, jobs: newJobsSave(), name: null });
        expect(await other.nameAdventurer(account.id, uniqueName('Elowen'))).toMatchObject(start);
      } finally {
        await other.close();
      }
    });
  });
}

storeSuite('MemoryStore', async (opts) => createMemoryStore(opts), async (rows) => {
  const legacyRows = rows.map((r) => ({ ...r, accountId: randomUUID() }));
  return { store: createMemoryStore({ legacyRows }), accountIds: legacyRows.map((r) => r.accountId) };
});

describe('PgStore pool', () => {
  it('logs idle-connection errors instead of crashing', async () => {
    // No connection is opened until a query, so this needs no database.
    const pool = createPool('postgres://nobody@127.0.0.1:1/none');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => pool.emit('error', new Error('terminating connection due to administrator command'))).not.toThrow();
      expect(logged).toHaveBeenCalledTimes(1);
      expect(String(logged.mock.calls[0])).toContain('terminating connection');
    } finally {
      logged.mockRestore();
      await pool.end();
    }
  });
});

if (databaseUrl) {
  const seedPg: SeedLegacy = async (rows) => {
    const store = await createPgStore(databaseUrl);
    const db = new pg.Client({ connectionString: databaseUrl });
    await db.connect();
    const accountIds: string[] = [];
    try {
      for (const r of rows) {
        const account = await store.createAccount({ username: uniqueName('Legacy'), passwordHash: 'h', isGuest: false });
        const { id } = await store.getOrCreateAdventurer(account.id);
        // The jobs column is NOT NULL after 004: a row it missed is stood in for by a JSON null.
        await db.query('UPDATE adventurers SET loadout = $2::jsonb, jobs = $3::jsonb WHERE id = $1', [
          id, JSON.stringify(r.loadout), r.jobs === undefined ? 'null' : JSON.stringify(r.jobs),
        ]);
        accountIds.push(account.id);
      }
    } finally {
      await db.end();
    }
    return { store, accountIds };
  };
  storeSuite('PgStore', (opts) => createPgStore(databaseUrl, opts), seedPg, async (id, zone) => {
    const db = new pg.Client({ connectionString: databaseUrl });
    await db.connect();
    try {
      await db.query('UPDATE adventurers SET zone = $2 WHERE id = $1', [id, zone]);
    } finally {
      await db.end();
    }
  });

  describe('PgStore migrations', () => {
    it('runs each migration once, even when stores open at the same time', async () => {
      const stores = await Promise.all([createPgStore(databaseUrl), createPgStore(databaseUrl)]);
      await Promise.all(stores.map((s) => s.close()));
      const again = await createPgStore(databaseUrl);
      await again.close();

      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        const { rows } = await client.query('SELECT name FROM schema_migrations ORDER BY name');
        expect(rows).toEqual([{ name: '001_init.sql' }, { name: '002_adventurer_names.sql' }, { name: '003_combat.sql' }, { name: '004_jobs.sql' }]);
      } finally {
        await client.end();
      }
    });

    it('002 keeps existing names, and clears the later of two that clash ignoring case', async () => {
      // A throwaway database at schema 001 holding adventurers from before names were chosen.
      const dbName = `sg2_migrate_${Math.floor(Math.random() * 1e9)}`;
      const admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      await admin.query(`CREATE DATABASE ${dbName}`);
      const url = new URL(databaseUrl);
      url.pathname = `/${dbName}`;
      let older = '';
      let newer = '';
      let guest = '';
      try {
        const legacy = new pg.Client({ connectionString: url.href });
        await legacy.connect();
        try {
          await legacy.query(await readFile(new URL('../../migrations/001_init.sql', import.meta.url), 'utf8'));
          await legacy.query(
            'CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
          );
          await legacy.query(`INSERT INTO schema_migrations (name) VALUES ('001_init.sql')`);
          const add = async (username: string, name: string, createdAt: string) => {
            const { rows } = await legacy.query(
              `INSERT INTO accounts (username, password_hash, is_guest, created_at) VALUES ($1, 'h', false, $2) RETURNING id`,
              [username, createdAt],
            );
            await legacy.query(
              `INSERT INTO adventurers (account_id, name, x, z, facing, zone, level, xp, gold) VALUES ($1, $2, 0, 0, 0, 'grove', 1, 0, 0)`,
              [rows[0].id, name],
            );
            return rows[0].id as string;
          };
          older = await add('Hazel', 'Hazel', '2026-11-01T00:00:00Z');
          newer = await add('Hazel_2', 'HAZEL', '2026-11-02T00:00:00Z');
          guest = await add('Guest-123456', 'Guest-123456', '2026-11-03T00:00:00Z');
        } finally {
          await legacy.end();
        }

        const store = await createPgStore(url.href);
        try {
          expect((await store.getOrCreateAdventurer(older)).name).toBe('Hazel');
          expect((await store.getOrCreateAdventurer(guest)).name).toBe('Guest-123456');
          expect((await store.getOrCreateAdventurer(newer)).name).toBeNull(); // asked to choose a name
          await expect(store.nameAdventurer(newer, 'hazel')).rejects.toBeInstanceOf(NameTakenError);
          expect((await store.nameAdventurer(newer, 'Hazelnut')).name).toBe('Hazelnut');
        } finally {
          await store.close();
        }
      } finally {
        await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
        await admin.end();
      }
    });

    it('003 gives existing adventurers full health and the default loadout (004 makes it the Warrior), keeps their zone, and can run again', async () => {
      // A throwaway database at schema 002 with an adventurer from before combat.
      const dbName = `sg2_migrate_${Math.floor(Math.random() * 1e9)}`;
      const admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      await admin.query(`CREATE DATABASE ${dbName}`);
      const url = new URL(databaseUrl);
      url.pathname = `/${dbName}`;
      const sql = async (file: string) => readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
      try {
        const legacy = new pg.Client({ connectionString: url.href });
        await legacy.connect();
        let accountId = '';
        try {
          await legacy.query(await sql('001_init.sql'));
          await legacy.query(await sql('002_adventurer_names.sql'));
          await legacy.query('CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
          await legacy.query(`INSERT INTO schema_migrations (name) VALUES ('001_init.sql'), ('002_adventurer_names.sql')`);
          const { rows } = await legacy.query(`INSERT INTO accounts (username, password_hash, is_guest) VALUES ('Hazel', 'h', false) RETURNING id`);
          accountId = rows[0].id;
          await legacy.query(
            `INSERT INTO adventurers (account_id, name, x, z, facing, zone, level, xp, gold) VALUES ($1, 'Hazel', 1.5, -9, 0.5, 'grove', 1, 0, 0)`,
            [accountId],
          );
        } finally {
          await legacy.end();
        }

        const store = await createPgStore(url.href);
        try {
          expect(await store.getOrCreateAdventurer(accountId)).toMatchObject({
            name: 'Hazel', x: 1.5, z: -9, facing: 0.5, zone: 'grove', hp: 100, jobs: newJobsSave(),
          });
        } finally {
          await store.close();
        }

        // Running 003 a second time (say by hand) changes nothing and does not fail.
        const again = new pg.Client({ connectionString: url.href });
        await again.connect();
        try {
          await again.query(`UPDATE adventurers SET hp = 55 WHERE account_id = $1`, [accountId]);
          await again.query(await sql('003_combat.sql'));
          const { rows } = await again.query(`SELECT hp, loadout, zone FROM adventurers WHERE account_id = $1`, [accountId]);
          expect(rows).toEqual([{ hp: 55, loadout: PLAN3_DEFAULT, zone: 'grove' }]);
        } finally {
          await again.end();
        }
      } finally {
        await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
        await admin.end();
      }
    });

    it('migration 004 converts Plan 3 rows and is safe to run twice', async () => {
      // A throwaway database at schema 003, with adventurers saved by Plan 3.
      const dbName = `sg2_migrate_${Math.floor(Math.random() * 1e9)}`;
      const admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      await admin.query(`CREATE DATABASE ${dbName}`);
      const url = new URL(databaseUrl);
      url.pathname = `/${dbName}`;
      const sql = async (file: string) => readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
      // Exactly as Plan 3 stored them: 003's column default, or JSON.stringify of a saved loadout.
      const loadouts: (string | null)[] = [
        null,
        '{"weapon":"blade","free":["bulwark","mend"]}',
        '{"weapon":"blade","free":["taunt","sprint"]}',
        '{"weapon":"bow","free":["taunt","sprint"]}',
        '{"weapon":"bow","free":["mend","bulwark"]}',
        '[]',
        '"blade"',
        '{"weapon":"blade"}',
      ];
      const accountIds: string[] = [];
      try {
        const legacy = new pg.Client({ connectionString: url.href });
        await legacy.connect();
        try {
          for (const f of ['001_init.sql', '002_adventurer_names.sql', '003_combat.sql']) await legacy.query(await sql(f));
          await legacy.query('CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
          await legacy.query(`INSERT INTO schema_migrations (name) VALUES ('001_init.sql'), ('002_adventurer_names.sql'), ('003_combat.sql')`);
          for (const [i, loadout] of loadouts.entries()) {
            const { rows } = await legacy.query(`INSERT INTO accounts (username, password_hash, is_guest) VALUES ($1, 'h', false) RETURNING id`, [`Old${i}`]);
            accountIds.push(rows[0].id);
            if (loadout === null) {
              await legacy.query(`INSERT INTO adventurers (account_id, name, x, z, facing, zone, level, xp, gold, hp) VALUES ($1, $2, 1, 2, 0, 'grove', 1, 0, 0, 70)`, [rows[0].id, `Old${i}`]);
            } else {
              await legacy.query(
                `INSERT INTO adventurers (account_id, name, x, z, facing, zone, level, xp, gold, hp, loadout) VALUES ($1, $2, 1, 2, 0, 'grove', 1, 0, 0, 70, $3::jsonb)`,
                [rows[0].id, `Old${i}`, loadout],
              );
            }
          }
        } finally {
          await legacy.end();
        }

        const warrior = (picks: [string, string]) => ({ current: 'warrior', jobs: { warrior: rec(0, picks) } });
        const ranger = { current: 'ranger', jobs: { ranger: rec(0, ['field_dressing', 'pinning_shot']) } };
        const expected = [
          warrior(['mend', 'bulwark']),
          warrior(['bulwark', 'mend']),
          warrior(['mend', 'bulwark']), // taunt and sprint are not the Warrior's: the reader gives its solo picks
          ranger,
          ranger,
          newJobsSave(),
          newJobsSave(),
          newJobsSave(),
        ];
        const readAll = async () => {
          const store = await createPgStore(url.href); // applies 004 (once)
          try {
            for (const [i, id] of accountIds.entries()) {
              expect(await store.getOrCreateAdventurer(id), `row ${i}`).toMatchObject({ jobs: expected[i], hp: 70, x: 1, z: 2, name: `Old${i}` });
            }
          } finally {
            await store.close();
          }
        };
        await readAll();
        await readAll(); // a second open runs nothing again

        const db = new pg.Client({ connectionString: url.href });
        await db.connect();
        try {
          const raw = async () => (await db.query(`SELECT jobs, loadout FROM adventurers ORDER BY name`)).rows;
          const first = await raw();
          // What 004 wrote: the Warrior keeps the stored picks as they were; the old column is kept for rollback.
          expect(first[0].jobs).toEqual(warrior(['mend', 'bulwark']));
          expect(first[2].jobs).toEqual(warrior(['taunt', 'sprint']));
          expect(first[3].jobs).toEqual(ranger);
          expect(first[0].loadout).toEqual(PLAN3_DEFAULT);
          expect(first[3].loadout).toEqual({ weapon: 'bow', free: ['taunt', 'sprint'] });
          for (const i of [0, 1, 3, 4]) expect(isJobsSave(first[i].jobs), `row ${i}`).toBe(true);
          // Running 003 and 004 again by hand changes nothing and does not fail.
          await db.query(await sql('003_combat.sql'));
          await db.query(await sql('004_jobs.sql'));
          await db.query(await sql('004_jobs.sql'));
          expect(await raw()).toEqual(first);
          const { rows } = await db.query('SELECT name FROM schema_migrations ORDER BY name');
          expect(rows.map((r) => r.name)).toEqual(['001_init.sql', '002_adventurer_names.sql', '003_combat.sql', '004_jobs.sql']);
          // A row made after 004 without jobs gets the column default (a new Warrior), and NULL is refused.
          const { rows: acc } = await db.query(`INSERT INTO accounts (username, password_hash, is_guest) VALUES ('New', 'h', false) RETURNING id`);
          const { rows: made } = await db.query(
            `INSERT INTO adventurers (account_id, name, x, z, facing, zone, level, xp, gold) VALUES ($1, 'New', 0, 0, 0, 'grove', 1, 0, 0) RETURNING jobs`,
            [acc[0].id],
          );
          expect(made[0].jobs).toEqual(newJobsSave());
          await expect(db.query(`UPDATE adventurers SET jobs = NULL WHERE name = 'New'`)).rejects.toThrow();
        } finally {
          await db.end();
        }
      } finally {
        await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
        await admin.end();
      }
    });

    it('reads stored jobs and an old loadout it cannot use as a new save, and an unknown zone as the grove', async () => {
      const store = await createPgStore(databaseUrl);
      const db = new pg.Client({ connectionString: databaseUrl });
      await db.connect();
      try {
        const account = await store.createAccount({ username: uniqueName('Ellie'), passwordHash: 'h', isGuest: false });
        const adventurer = await store.getOrCreateAdventurer(account.id);
        for (const bad of ['{"weapon":"staff","free":["mend","bulwark"]}', '{"weapon":"blade","free":"x"}', '[]', 'null', '"blade"']) {
          await db.query(`UPDATE adventurers SET jobs = $2::jsonb, loadout = $2::jsonb, zone = 'moon' WHERE id = $1`, [adventurer.id, bad]);
          expect(await store.getOrCreateAdventurer(account.id)).toMatchObject({ jobs: newJobsSave(), zone: 'grove' });
        }
      } finally {
        await db.end();
        await store.close();
      }
    });
  });
} else {
  describe.skip('PgStore (set TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
}
