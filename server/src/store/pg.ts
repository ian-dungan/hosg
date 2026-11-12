// PostgreSQL Store. Opening it applies any migrations/*.sql not yet recorded in schema_migrations.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { MAX_HP, SPAWN, ZONE_IDS, isZoneId, newJobsSave, parseJobsSave } from '@sg2/shared';
import { AlreadyNamedError, NameTakenError, checkedSave, jobsNeedRepair, type Account, type Adventurer, type StartSpot, type Store } from './types';

const UNIQUE_VIOLATION = '23505';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Any constant shared by all server processes: serialises concurrent migration runs.
const MIGRATION_LOCK_ID = 2570_0001;

// server/migrations, seen from this file in src/store/ or from a bundle in dist/.
function migrationsDir(): string {
  const candidates = ['../../migrations/', '../migrations/'].map((p) => fileURLToPath(new URL(p, import.meta.url)));
  const found = candidates.find((dir) => existsSync(`${dir}001_init.sql`));
  if (!found) throw new Error(`migrations folder not found (looked in ${candidates.join(', ')})`);
  return found;
}

async function migrate(pool: pg.Pool): Promise<void> {
  const dir = migrationsDir();
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    for (const file of files) {
      if (applied.has(file)) continue;
      await client.query(await readFile(`${dir}${file}`, 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

interface AccountRow {
  id: string;
  username: string;
  password_hash: string | null;
  is_guest: boolean;
  is_gm: boolean;
}

interface AdventurerRow {
  id: string;
  account_id: string;
  name: string | null;
  x: number;
  z: number;
  facing: number;
  zone: string;
  hp: number;
  jobs: unknown;
  /** Plan 3's weapon and free picks: read only for a row whose jobs 004 missed, never written. */
  loadout: unknown;
  level: number;
  xp: number;
  gold: number;
}

const ACCOUNT_COLUMNS = 'id, username, password_hash, is_guest, is_gm';
const ADVENTURER_COLUMNS = 'id, account_id, name, x, z, facing, zone, hp, jobs, loadout, level, xp, gold';

function toAccount(r: AccountRow): Account {
  return { id: r.id, username: r.username, passwordHash: r.password_hash, isGuest: r.is_guest, isGm: r.is_gm };
}

function toAdventurer(r: AdventurerRow): Adventurer {
  return {
    id: r.id,
    accountId: r.account_id,
    name: r.name,
    x: r.x,
    z: r.z,
    facing: r.facing,
    // A zone this server does not know (only possible by hand) reads as the grove: the join then
    // stands at its spawn if the spot is not walkable there.
    zone: isZoneId(r.zone) ? r.zone : 'grove',
    hp: r.hp,
    jobs: parseJobsSave(r.jobs, r.loadout),
    ...(jobsNeedRepair(r.jobs) ? { jobsRepaired: true as const } : {}),
    level: r.level,
    xp: r.xp,
    gold: r.gold,
  };
}

/**
 * A pool that survives losing idle connections (Postgres restart, idle kill): node-postgres emits
 * 'error' on the pool for those, and an unhandled 'error' event would crash the server. The broken
 * client is discarded and the next query opens a new connection.
 */
export function createPool(databaseUrl: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  pool.on('error', (err) => {
    console.error('PostgreSQL idle connection error (continuing):', err.message);
  });
  return pool;
}

export async function createPgStore(databaseUrl: string, opts: { start?: StartSpot } = {}): Promise<Store> {
  const start: StartSpot = opts.start ?? { zone: 'grove', x: SPAWN.x, z: SPAWN.z, facing: SPAWN.facing };
  const pool = createPool(databaseUrl);
  try {
    await migrate(pool);
  } catch (err) {
    await pool.end();
    throw err;
  }

  /** Makes the account's adventurer if it has none; insert-or-nothing keeps one per account even if two calls race. */
  async function insertAdventurer(accountId: string): Promise<void> {
    await pool.query(
      `INSERT INTO adventurers (account_id, name, x, z, facing, zone, hp, jobs, level, xp, gold)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7::jsonb, 1, 0, 0)
       ON CONFLICT (account_id) DO NOTHING`,
      [accountId, start.x, start.z, start.facing, start.zone, MAX_HP, JSON.stringify(newJobsSave())],
    );
  }

  return {
    async createAccount({ username, passwordHash, isGuest }) {
      try {
        const { rows } = await pool.query<AccountRow>(
          `INSERT INTO accounts (username, password_hash, is_guest) VALUES ($1, $2, $3) RETURNING ${ACCOUNT_COLUMNS}`,
          [username, passwordHash, isGuest],
        );
        return toAccount(rows[0]!);
      } catch (err) {
        if ((err as { code?: string }).code === UNIQUE_VIOLATION) throw new NameTakenError(username);
        throw err;
      }
    },

    async findAccountByUsername(username) {
      const { rows } = await pool.query<AccountRow>(
        `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE lower(username) = lower($1)`,
        [username],
      );
      return rows[0] ? toAccount(rows[0]) : null;
    },

    async findAccountById(id) {
      // Ids come from verified tokens, but a malformed one must read as unknown, not as a SQL error.
      if (!UUID_RE.test(id)) return null;
      const { rows } = await pool.query<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = $1`, [id]);
      return rows[0] ? toAccount(rows[0]) : null;
    },

    async getOrCreateAdventurer(accountId) {
      await insertAdventurer(accountId);
      const { rows } = await pool.query<AdventurerRow>(
        `SELECT ${ADVENTURER_COLUMNS} FROM adventurers WHERE account_id = $1`,
        [accountId],
      );
      return toAdventurer(rows[0]!);
    },

    async nameAdventurer(accountId, name) {
      await insertAdventurer(accountId);
      let rows: AdventurerRow[];
      try {
        // Only an unnamed adventurer takes a name; the unique index on lower(name) settles races.
        ({ rows } = await pool.query<AdventurerRow>(
          `UPDATE adventurers SET name = $2, updated_at = now() WHERE account_id = $1 AND name IS NULL
           RETURNING ${ADVENTURER_COLUMNS}`,
          [accountId, name],
        ));
      } catch (err) {
        if ((err as { code?: string }).code === UNIQUE_VIOLATION) throw new NameTakenError(name);
        throw err;
      }
      if (!rows[0]) throw new AlreadyNamedError();
      return toAdventurer(rows[0]);
    },

    async saveAdventurer(a, expect) {
      const { id, x, z, facing, zone, hp, jobs } = checkedSave(a);
      // Like findAccountById: an id that is not a uuid is unknown, not a SQL error.
      if (!UUID_RE.test(id)) return false;
      // A stored zone this server does not know reads as the grove (toAdventurer), so it counts as any
      // expected zone here: whoever holds that adventurer may save it into a real one.
      const { rowCount } = await pool.query(
        `UPDATE adventurers SET x = $2, z = $3, facing = $4, zone = $5, hp = $6, jobs = $7::jsonb, updated_at = now()
         WHERE id = $1 AND ($8::text IS NULL OR zone = $8 OR NOT (zone = ANY($9::text[])))`,
        [id, x, z, facing, zone, hp, JSON.stringify(jobs), expect?.zone ?? null, ZONE_IDS],
      );
      return (rowCount ?? 0) > 0;
    },

    async close() {
      await pool.end();
    },
  };
}
