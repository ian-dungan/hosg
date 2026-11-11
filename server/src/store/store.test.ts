import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
      const first = await store.getOrCreateAdventurer(account.id, 'Ellie');
      const second = await store.getOrCreateAdventurer(account.id, 'Ellie');
      expect(second.id).toBe(first.id);
      expect(first).toMatchObject({
        accountId: account.id,
        name: 'Ellie',
        x: SPAWN.x,
        z: SPAWN.z,
        facing: SPAWN.facing,
        zone: 'grove',
        level: 1,
        xp: 0,
        gold: 0,
      });
    });

    it('returns the saved position and facing', async () => {
      const account = await store.createAccount({ username: uniqueName('Ellie'), passwordHash: 'h', isGuest: false });
      const adventurer = await store.getOrCreateAdventurer(account.id, 'Ellie');
      await store.saveAdventurer({ id: adventurer.id, x: 12.5, z: -3.25, facing: 1.75 });
      const loaded = await store.getOrCreateAdventurer(account.id, 'Ellie');
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
        expect(rows).toEqual([{ name: '001_init.sql' }]);
      } finally {
        await client.end();
      }
    });
  });
} else {
  describe.skip('PgStore (set TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
}
