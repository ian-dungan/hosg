// PostgreSQL Store. Opening it applies any migrations/*.sql not yet recorded in schema_migrations.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { GOLD_MAX, MAX_HP, SPAWN, ZONE_IDS, isZoneId, newJobsSave, parseJobsSave, parseLook } from '@sg2/shared';
import {
  AlreadyNamedError, NameTakenError, checkedGmLog, checkedInvWrite, checkedKill, checkedSave, highestLevel, isUtcDay, jobsNeedRepair, readInvLook,
  testKitInventory, type Account, type Adventurer, type NewAdventurerOpts, type StartSpot, type Store,
} from './types';
import { grantByCas, type GrantStore } from '../gm/grant';

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
    // (a migration may take longer than the pool's per-statement limits: none inside this transaction)
    await client.query('SET LOCAL statement_timeout = 0');
    await client.query('SET LOCAL lock_timeout = 0');
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
  seals: number;
  /** The date column as 'YYYY-MM-DD' text (to_char in ADVENTURER_COLUMNS: never a Date in the server's time zone). */
  seal_day: string | null;
  titles: unknown;
  inventory: unknown;
  inv_version: number;
  look: unknown;
  look_free: boolean;
}

const ACCOUNT_COLUMNS = 'id, username, password_hash, is_guest, is_gm';
const ADVENTURER_COLUMNS = 'id, account_id, name, x, z, facing, zone, hp, jobs, loadout, level, xp, gold, seals, to_char(seal_day, \'YYYY-MM-DD\') AS seal_day, titles, inventory, inv_version, look, look_free';

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
    seals: r.seals ?? 0,
    sealDay: r.seal_day ?? null,
    titles: Array.isArray(r.titles) ? r.titles.filter((t): t is string => typeof t === 'string') : [],
    ...readInvLook(r.inventory, r.look, r.account_id),
    invVersion: r.inv_version ?? 0,
    lookFree: r.look_free ?? true,
  };
}


/**
 * A pool that survives losing idle connections (Postgres restart, idle kill): node-postgres emits
 * 'error' on the pool for those, and an unhandled 'error' event would crash the server. The broken
 * client is discarded and the next query opens a new connection.
 */
/** Every statement gives up after this (ms), and waits at most LOCK_TIMEOUT_MS for a row lock: a hung store call never holds a session's write lock for ever. */
export const STATEMENT_TIMEOUT_MS = 10_000;
export const LOCK_TIMEOUT_MS = 5000;

export function createPool(databaseUrl: string, opts: { statementTimeoutMs?: number; lockTimeoutMs?: number } = {}): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    statement_timeout: opts.statementTimeoutMs ?? STATEMENT_TIMEOUT_MS,
    lock_timeout: opts.lockTimeoutMs ?? LOCK_TIMEOUT_MS,
  });
  pool.on('error', (err) => {
    console.error('PostgreSQL idle connection error (continuing):', err.message);
  });
  return pool;
}

/** `migrate: false` (the role CLI): opens the store on the schema as it is, running no migration. */
export async function createPgStore(databaseUrl: string, opts: { start?: StartSpot; newAdventurer?: NewAdventurerOpts; migrate?: boolean } = {}): Promise<Store> {
  const start: StartSpot = opts.start ?? { zone: 'grove', x: SPAWN.x, z: SPAWN.z, facing: SPAWN.facing };
  const pool = createPool(databaseUrl);
  try {
    if (opts.migrate !== false) await migrate(pool);
  } catch (err) {
    await pool.end();
    throw err;
  }

  /** Makes the account's adventurer if it has none; insert-or-nothing keeps one per account even if two calls race. */
  async function insertAdventurer(accountId: string): Promise<void> {
    await pool.query(
      `INSERT INTO adventurers (account_id, name, x, z, facing, zone, hp, jobs, level, xp, gold, inventory)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7::jsonb, 1, 0, $8, $9::jsonb)
       ON CONFLICT (account_id) DO NOTHING`,
      [
        accountId, start.x, start.z, start.facing, start.zone, MAX_HP, JSON.stringify(newJobsSave()), opts.newAdventurer?.gold ?? 0,
        opts.newAdventurer?.kit ? JSON.stringify(testKitInventory(opts.newAdventurer.kit)) : null,
      ],
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
        `UPDATE adventurers SET x = $2, z = $3, facing = $4, zone = $5, hp = $6, jobs = $7::jsonb, level = $10, updated_at = now()
         WHERE id = $1 AND ($8::text IS NULL OR zone = $8 OR NOT (zone = ANY($9::text[])))`,
        [id, x, z, facing, zone, hp, JSON.stringify(jobs), expect?.zone ?? null, ZONE_IDS, highestLevel(jobs)],
      );
      return (rowCount ?? 0) > 0;
    },

    async awardSeal(adventurerId, dayUtc) {
      if (!isUtcDay(dayUtc)) throw new TypeError(`awardSeal: not a day: ${String(dayUtc)}`);
      if (!UUID_RE.test(adventurerId)) return { awarded: false, seals: 0 };
      // One statement: only a row whose seal_day is before that day gains one (two kills, a retry, two
      // processes, a clock that steps back: at most one Seal a UTC day, never one for an older day).
      const { rows } = await pool.query<{ seals: number }>(
        `UPDATE adventurers SET seals = seals + 1, seal_day = $2::date, inv_version = inv_version + 1
         WHERE id = $1 AND (seal_day IS NULL OR seal_day < $2::date) RETURNING seals`,
        [adventurerId, dayUtc],
      );
      if (rows[0]) return { awarded: true, seals: rows[0].seals };
      const { rows: now } = await pool.query<{ seals: number }>('SELECT seals FROM adventurers WHERE id = $1', [adventurerId]);
      return { awarded: false, seals: now[0]?.seals ?? 0 };
    },

    async addTitle(adventurerId, title) {
      if (typeof title !== 'string' || title === '') throw new TypeError('addTitle: not a title');
      if (!UUID_RE.test(adventurerId)) return false;
      const { rowCount } = await pool.query(
        `UPDATE adventurers SET titles = titles || to_jsonb($2::text) WHERE id = $1 AND NOT (titles ? $2)`,
        [adventurerId, title],
      );
      return (rowCount ?? 0) > 0;
    },

    async recordBossKill(k) {
      const kill = checkedKill(k);
      const { rows } = await pool.query<{ rank: string }>(
        `WITH ins AS (INSERT INTO boss_kills (boss, party_size, seconds, names, at) VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING seconds)
         SELECT 1 + (SELECT count(*) FROM boss_kills WHERE boss = $1 AND party_size = $2 AND seconds < (SELECT seconds FROM ins)) AS rank`,
        [kill.boss, kill.partySize, kill.seconds, JSON.stringify(kill.names), kill.at],
      );
      return { rank: Number(rows[0]!.rank) };
    },

    async bossLeaderboard(boss, partySize, limit = 10) {
      const { rows } = await pool.query<{ names: unknown; seconds: number; at: Date }>(
        `SELECT names, seconds, at FROM boss_kills WHERE boss = $1 AND party_size = $2 ORDER BY seconds, at, id LIMIT $3`,
        [boss, partySize, Math.max(0, Math.floor(limit))],
      );
      return rows.map((r) => ({ names: Array.isArray(r.names) ? r.names.filter((n): n is string => typeof n === 'string') : [], seconds: r.seconds, at: r.at.toISOString() }));
    },

    async writeInventory(adventurerId, expect, w) {
      const v = checkedInvWrite(w);
      if (!UUID_RE.test(adventurerId) || !Number.isSafeInteger(expect)) return null;
      // One statement: the version and both balances are checked and changed together (a Seal awarded,
      // a GM grant or another write in between bumps inv_version, and this one writes nothing).
      const { rows } = await pool.query<{ inv_version: number; gold: number; seals: number }>(
        `UPDATE adventurers SET inventory = $3::jsonb, jobs = COALESCE($4::jsonb, jobs), level = COALESCE($5::integer, level), gold = LEAST($8::integer, gold + $6::integer), seals = seals + $7::integer,
           look = COALESCE($9::jsonb, look), look_free = CASE WHEN $10::boolean THEN false ELSE look_free END,
           inv_version = inv_version + 1, updated_at = now()
         WHERE id = $1 AND inv_version = $2 AND gold + $6::integer >= 0 AND seals + $7::integer >= 0
         RETURNING inv_version, gold, seals`,
        [
          adventurerId, expect, JSON.stringify(v.inventory), v.jobs ? JSON.stringify(v.jobs) : null, v.jobs ? highestLevel(v.jobs) : null, v.dGold, v.dSeals, GOLD_MAX,
          v.look ? JSON.stringify(v.look) : null, v.lookFree === false,
        ],
      );
      const r = rows[0];
      return r ? { version: r.inv_version, gold: r.gold, seals: r.seals } : null;
    },

    async useFreeLook(accountId, look) {
      const l = parseLook(look);
      if (!l) throw new TypeError('useFreeLook: not a look');
      if (!UUID_RE.test(accountId)) return false;
      const { rowCount } = await pool.query(
        `UPDATE adventurers SET look = $2::jsonb, look_free = false, inv_version = inv_version + 1, updated_at = now() WHERE account_id = $1 AND look_free`,
        [accountId, JSON.stringify(l)],
      );
      return (rowCount ?? 0) > 0;
    },

    async logGm(e) {
      const row = checkedGmLog(e);
      if (row.gmAccount !== null && !UUID_RE.test(row.gmAccount)) throw new TypeError('logGm: gmAccount is not an account id');
      await pool.query(
        `INSERT INTO gm_audit (gm_account, command, target, args, ok, result) VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
        [row.gmAccount, row.command, row.target, JSON.stringify(row.args), row.ok, row.result],
      );
    },

    async gmAudit(limit = 100) {
      const { rows } = await pool.query<{ at: Date; gm_account: string | null; command: string; target: string | null; args: unknown; ok: boolean; result: string }>(
        `SELECT at, gm_account, command, target, args, ok, result FROM gm_audit ORDER BY at DESC, id DESC LIMIT $1`,
        [Math.max(0, Math.floor(limit))],
      );
      return rows.map((r) => ({ at: r.at.toISOString(), gmAccount: r.gm_account, command: r.command, target: r.target, args: r.args, ok: r.ok, result: r.result }));
    },

    async setGm(username, on) {
      if (typeof username !== 'string' || typeof on !== 'boolean') return false;
      const { rowCount } = await pool.query(
        `UPDATE accounts SET is_gm = $2 WHERE lower(username) = lower($1) AND (NOT is_guest OR NOT $2)`, [username, on],
      );
      return (rowCount ?? 0) > 0;
    },

    async listGms() {
      const { rows } = await pool.query<{ username: string }>('SELECT username FROM accounts WHERE is_gm ORDER BY lower(username)');
      return rows.map((r) => r.username);
    },

    async grantOffline(name, g) {
      if (typeof name !== 'string') return 'unknown';
      const { rows } = await pool.query<{ account_id: string }>('SELECT account_id FROM adventurers WHERE lower(name) = lower($1)', [name]);
      if (!rows[0]) return 'unknown';
      return grantByCas(this as unknown as GrantStore, rows[0].account_id, g);
    },

    async gmGoldToday(gmAccount, dayUtc) {
      if (!UUID_RE.test(gmAccount) || !isUtcDay(dayUtc)) return 0;
      const { rows } = await pool.query<{ sum: string | null }>(
        `SELECT sum((args->>'counted')::bigint) AS sum FROM gm_audit
         WHERE gm_account = $1 AND jsonb_typeof(args->'counted') = 'number' AND (at AT TIME ZONE 'UTC')::date = $2::date`,
        [gmAccount, dayUtc],
      );
      return Number(rows[0]?.sum ?? 0);
    },

    async close() {
      await pool.end();
    },
  };
}
