import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { SPAWN } from '@sg2/shared';
import { NameTakenError, type Store } from './types';
import { createMemoryStore } from './memory';
import { createPgStore, createPool } from './pg';

const databaseUrl = process.env.TEST_DATABASE_URL;

// Names get a random suffix so the suite can run repeatedly against the same database.
function uniqueName(base: string): string {
  return `${base}_${Math.floor(Math.random() * 1e9)}`;
}

function storeSuite(label: string, open: () => Promise<Store>) {
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
      });
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
      await store.saveAdventurer({ id: adventurer.id, x: 12.5, z: -3.25, facing: 1.75 });
      const loaded = await store.getOrCreateAdventurer(account.id);
      expect(loaded).toMatchObject({ id: adventurer.id, x: 12.5, z: -3.25, facing: 1.75 });
    });
  });
}

storeSuite('MemoryStore', async () => createMemoryStore());

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
  storeSuite('PgStore', () => createPgStore(databaseUrl));

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
        expect(rows).toEqual([{ name: '001_init.sql' }, { name: '002_adventurer_names.sql' }]);
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
  });
} else {
  describe.skip('PgStore (set TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
}
