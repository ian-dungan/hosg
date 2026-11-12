import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { PLAN3_DEFAULT_LOADOUT, MAX_HP, SPAWN } from '@sg2/shared';
import { NameTakenError, type Adventurer, type Store } from './types';
import { createMemoryStore } from './memory';
import { createPgStore, createPool } from './pg';
import type { StartSpot } from './types';

const databaseUrl = process.env.TEST_DATABASE_URL;

// Names get a random suffix so the suite can run repeatedly against the same database.
function uniqueName(base: string): string {
  return `${base}_${Math.floor(Math.random() * 1e9)}`;
}

/** Everything saveAdventurer takes, for `a`, with these changes. */
function saved(a: Adventurer, changes: Partial<Pick<Adventurer, 'x' | 'z' | 'facing' | 'zone' | 'hp' | 'loadout'>> = {}) {
  const { id, x, z, facing, zone, hp, loadout } = a;
  return { id, x, z, facing, zone, hp, loadout, ...changes };
}

/** Writes a zone this server does not know straight into the stored row (only a database can hold one). */
type SetRawZone = (adventurerId: string, zone: string) => Promise<void>;

function storeSuite(label: string, open: (opts?: { start?: StartSpot }) => Promise<Store>, setRawZone?: SetRawZone) {
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
        loadout: PLAN3_DEFAULT_LOADOUT,
      });
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

    it('round-trips zone, hp and loadout', async () => {
      const account = await store.createAccount({ username: uniqueName('Ellie'), passwordHash: 'h', isGuest: false });
      const adventurer = await store.getOrCreateAdventurer(account.id);
      const loadout = { weapon: 'bow' as const, free: ['sprint', 'taunt'] as ['sprint', 'taunt'] };
      expect(await store.saveAdventurer(saved(adventurer, { zone: 'greenway', hp: 37, loadout, x: 40, z: 2.5 }))).toBe(true);
      expect(await store.getOrCreateAdventurer(account.id)).toMatchObject({ zone: 'greenway', hp: 37, loadout, x: 40, z: 2.5 });
      // The loadout handed out is a copy: changing it changes nothing stored.
      const loaded = await store.getOrCreateAdventurer(account.id);
      loaded.loadout.free[0] = 'mend';
      expect((await store.getOrCreateAdventurer(account.id)).loadout).toEqual(loadout);
    });

    it('stores hp as a whole number', async () => {
      const account = await store.createAccount({ username: uniqueName('Ellie'), passwordHash: 'h', isGuest: false });
      const adventurer = await store.getOrCreateAdventurer(account.id);
      await store.saveAdventurer(saved(adventurer, { hp: 41.6 }));
      expect((await store.getOrCreateAdventurer(account.id)).hp).toBe(42);
    });

    it('refuses to save an unknown zone, a bad loadout or a non-finite hp, and keeps what was stored', async () => {
      const account = await store.createAccount({ username: uniqueName('Ellie'), passwordHash: 'h', isGuest: false });
      const adventurer = await store.getOrCreateAdventurer(account.id);
      const bad: unknown[] = [
        { zone: 'moon' },
        { hp: Number.NaN },
        { hp: Infinity },
        { loadout: { weapon: 'staff', free: ['mend', 'bulwark'] } },
        { loadout: { weapon: 'blade', free: ['mend', 'mend'] } },
        { loadout: { weapon: 'blade', free: ['slash', 'mend'] } },
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
        expect(await other.getOrCreateAdventurer(account.id)).toMatchObject({ ...start, hp: 100, loadout: PLAN3_DEFAULT_LOADOUT, name: null });
        expect(await other.nameAdventurer(account.id, uniqueName('Elowen'))).toMatchObject(start);
      } finally {
        await other.close();
      }
    });
  });
}

storeSuite('MemoryStore', async (opts) => createMemoryStore(opts));

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
  storeSuite('PgStore', (opts) => createPgStore(databaseUrl, opts), async (id, zone) => {
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
        expect(rows).toEqual([{ name: '001_init.sql' }, { name: '002_adventurer_names.sql' }, { name: '003_combat.sql' }]);
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

    it('003 gives existing adventurers full health and the default loadout, keeps their zone, and can run again', async () => {
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
            name: 'Hazel', x: 1.5, z: -9, facing: 0.5, zone: 'grove', hp: 100, loadout: PLAN3_DEFAULT_LOADOUT,
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
          expect(rows).toEqual([{ hp: 55, loadout: PLAN3_DEFAULT_LOADOUT, zone: 'grove' }]);
        } finally {
          await again.end();
        }
      } finally {
        await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
        await admin.end();
      }
    });

    it('reads a stored loadout it cannot use as the default, and an unknown zone as the grove', async () => {
      const store = await createPgStore(databaseUrl);
      const db = new pg.Client({ connectionString: databaseUrl });
      await db.connect();
      try {
        const account = await store.createAccount({ username: uniqueName('Ellie'), passwordHash: 'h', isGuest: false });
        const adventurer = await store.getOrCreateAdventurer(account.id);
        for (const bad of ['{"weapon":"staff","free":["mend","bulwark"]}', '{"weapon":"blade","free":["mend","mend"]}', '[]', 'null', '"blade"']) {
          await db.query(`UPDATE adventurers SET loadout = $2::jsonb, zone = 'moon' WHERE id = $1`, [adventurer.id, bad]);
          expect(await store.getOrCreateAdventurer(account.id)).toMatchObject({ loadout: PLAN3_DEFAULT_LOADOUT, zone: 'grove' });
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
