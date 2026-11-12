// Starts the Shady Grove 2 server from environment variables.
import { GOLD_MAX, LAMPFALL_MOUTH, SAVE_ZONE_IDS, isSaveZoneId, isZoneId, zoneDef, type CampSpawn, type CheckpointId, type ZoneId } from '@sg2/shared';
import { createApp } from './app';
import { createMemoryStore } from './store/memory';
import { createPgStore } from './store/pg';
import type { Store } from './store/types';

function fail(message: string): never {
  console.error(`Shady Grove 2 server: ${message}`);
  process.exit(1);
}

/** An error's message for a one-line report (a refused connection to "localhost" has none of its own). */
function reason(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const inner = err instanceof AggregateError ? err.errors.find((e) => e instanceof Error) : undefined;
  return err.message || inner?.message || (err as NodeJS.ErrnoException).code || err.name;
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) fail(`${name} must be a positive whole number (got "${raw}").`);
  return value;
}

/**
 * SG2_TRUST_PROXY: how many reverse proxies (e.g. Caddy) stand in front of the server, so a login's
 * address is read from X-Forwarded-For; unset, empty or `false` trusts none (the socket's address).
 */
function trustProxyHops(): number | undefined {
  const raw = process.env.SG2_TRUST_PROXY;
  if (raw === undefined || raw === '' || raw === 'false') return undefined;
  const hops = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(hops) || hops < 1) {
    fail(`SG2_TRUST_PROXY must be the number of proxies in front of the server (for example 1), or empty (got "${raw}").`);
  }
  return hops;
}

/** SG2_START_ZONE (for local test servers): the zone new adventurers start in, at its spawn; grove by default. */
function startZone(): ZoneId {
  const raw = process.env.SG2_START_ZONE;
  if (raw === undefined || raw === '') return 'grove';
  if (!isSaveZoneId(raw)) fail(`SG2_START_ZONE must be ${SAVE_ZONE_IDS.join(' or ')} (got "${raw}").`);
  return raw;
}

/**
 * SG2_OPEN_EXITS (for local test servers): exits to open beside those open by default, as
 * comma-separated from:to zone pairs, for example grove:greenway; unset or empty opens none.
 */
function openExits(): Partial<Record<ZoneId, ZoneId[]>> | undefined {
  const raw = process.env.SG2_OPEN_EXITS;
  if (raw === undefined || raw === '') return undefined;
  const open: Partial<Record<ZoneId, ZoneId[]>> = {};
  for (const pair of raw.split(',')) {
    const [from, to, extra] = pair.trim().split(':');
    if (!isZoneId(from) || !isZoneId(to) || extra !== undefined || from === to) {
      fail(`SG2_OPEN_EXITS must be a comma-separated list of from:to zone pairs, for example grove:greenway (got "${raw}").`);
    }
    (open[from] ??= []).push(to);
  }
  return open;
}

/**
 * SG2_TEST_DUMMY=1 (test servers only, never in Docker): a Training Dummy camp in the grove at (3, -11),
 * for job and ability checks against a server; unset, empty or 0 adds none.
 */
function testDummy(): Partial<Record<ZoneId, { camps: CampSpawn[] }>> | undefined {
  const raw = process.env.SG2_TEST_DUMMY;
  if (raw === undefined || raw === '' || raw === '0') return undefined;
  if (raw !== '1') fail(`SG2_TEST_DUMMY must be 1 or empty (got "${raw}").`);
  return { grove: { camps: [...zoneDef('grove').camps, { kind: 'dummy', x: 3, z: -11, facing: 0 }] } };
}

/**
 * SG2_START_AT=lampfall-mouth (test servers only, never in Docker): new adventurers start in the Greenway
 * at the crater mouth (LAMPFALL_MOUTH.arrive; it implies SG2_START_ZONE=greenway); unset or empty: the
 * start zone's spawn.
 */
function startAt(): 'lampfall-mouth' | undefined {
  const raw = process.env.SG2_START_AT;
  if (raw === undefined || raw === '') return undefined;
  if (raw !== 'lampfall-mouth') fail(`SG2_START_AT must be lampfall-mouth or empty (got "${raw}").`);
  const zone = process.env.SG2_START_ZONE;
  if (zone !== undefined && zone !== '' && zone !== 'greenway') fail(`SG2_START_AT=lampfall-mouth starts in the Greenway; SG2_START_ZONE must be greenway or empty (got "${zone}").`);
  return raw;
}

/**
 * SG2_TEST_INSTANCE_START=landing (test servers only, never in Docker): new Lampfall instances start with
 * the packs and the Wickhound already dead and the checkpoint at the Keeper's Landing (scripted Warden runs).
 */
function testInstanceStart(): CheckpointId | undefined {
  const raw = process.env.SG2_TEST_INSTANCE_START;
  if (raw === undefined || raw === '') return undefined;
  if (raw !== 'landing') fail(`SG2_TEST_INSTANCE_START must be landing or empty (got "${raw}").`);
  return raw;
}

/** SG2_TEST_START_GOLD=<n> (test servers only, never in Docker): new adventurers start with n gold. */
function testStartGold(): number | undefined {
  const raw = process.env.SG2_TEST_START_GOLD;
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n > GOLD_MAX) fail(`SG2_TEST_START_GOLD must be a whole number of gold from 0 to ${GOLD_MAX}, or empty (got "${raw}").`);
  return n;
}

/** SG2_TEST_LOOT=always (test servers only, never in Docker): every credited kill on a row with items drops one (the roll still picks which). */
function testLoot(): boolean {
  const raw = process.env.SG2_TEST_LOOT;
  if (raw === undefined || raw === '') return false;
  if (raw !== 'always') fail(`SG2_TEST_LOOT must be always or empty (got "${raw}").`);
  return true;
}

/** SG2_TEST_KIT=t1|t2|t3 (test servers only, never in Docker): new adventurers get that tier's full kit for every job, worn. */
function testKit(): 1 | 2 | 3 | undefined {
  const raw = process.env.SG2_TEST_KIT;
  if (raw === undefined || raw === '') return undefined;
  if (raw !== 't1' && raw !== 't2' && raw !== 't3') fail(`SG2_TEST_KIT must be t1, t2, t3 or empty (got "${raw}").`);
  return Number(raw.slice(1)) as 1 | 2 | 3;
}

/**
 * SG2_TEST_GMS=alice,bob (test servers only, never in Docker, off by default): with SG2_STORE=memory, accounts
 * registered with those usernames are game masters. Refused with a database: there the role is set only by the
 * role CLI (npm run gm -w server).
 */
function testGms(): string[] | undefined {
  const raw = process.env.SG2_TEST_GMS;
  if (raw === undefined || raw === '') return undefined;
  if (process.env.SG2_STORE !== 'memory') fail('SG2_TEST_GMS works only with SG2_STORE=memory; with a database, use the role CLI (npm run gm -w server -- grant <username>).');
  const names = raw.split(',').map((n) => n.trim());
  if (names.some((n) => !/^[A-Za-z0-9_-]{1,64}$/.test(n))) fail(`SG2_TEST_GMS must be a comma-separated list of usernames (got "${raw}").`);
  return names;
}

const port = positiveInt('SG2_PORT', 2570);
const gms = testGms();
const startGold = testStartGold();
const lootAlways = testLoot();
const startKit = testKit();
const newAdventurer = { ...(startGold !== undefined ? { gold: startGold } : {}), ...(startKit ? { kit: startKit } : {}) };
const mouthStart = startAt();
const instanceStart = testInstanceStart();
const start = (() => {
  if (mouthStart) return { zone: 'greenway' as const, ...LAMPFALL_MOUTH.arrive };
  const zone = startZone();
  const { x, z, facing } = zoneDef(zone).spawn;
  return { zone, x, z, facing };
})();
const exitsOpen = openExits();
const dummyZones = testDummy();
const trustProxy = trustProxyHops();
const authRatePerMinute = positiveInt('SG2_AUTH_RATE_PER_MIN', 10);
const jwtSecret = process.env.SG2_JWT_SECRET;
if (!jwtSecret) fail('SG2_JWT_SECRET is not set. Set it to a random string of at least 32 characters.');
if (jwtSecret.length < 32) fail(`SG2_JWT_SECRET is too short (${jwtSecret.length} characters); use at least 32.`);
const clientDir = process.env.SG2_CLIENT_DIR || undefined;

let store: Store;
if (process.env.SG2_STORE === 'memory') {
  console.warn('Shady Grove 2 server: SG2_STORE=memory, nothing is saved across restarts.');
  store = createMemoryStore({ start, newAdventurer, ...(gms ? { testGms: gms } : {}) });
} else {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail('DATABASE_URL is not set (or set SG2_STORE=memory to run without a database).');
  try {
    store = await createPgStore(databaseUrl, { start, newAdventurer });
  } catch (err) {
    fail(`cannot open the database at DATABASE_URL: ${reason(err)}.`);
  }
}

const app = createApp({
  store, jwtSecret, clientDir, authRatePerMinute, trustProxy, openExits: exitsOpen, zones: dummyZones, lootAlways,
  ...(instanceStart ? { instances: { startAt: instanceStart } } : {}),
});
try {
  await app.listen(port);
} catch (err) {
  const inUse = (err as NodeJS.ErrnoException).code === 'EADDRINUSE';
  fail(inUse ? `port ${port} is already in use; stop whatever uses it or set SG2_PORT to another port.` : `cannot listen on port ${port}: ${reason(err)}.`);
}
console.log(`Shady Grove 2 server listening on port ${port}${clientDir ? `, serving ${clientDir}` : ''}.`);
if (mouthStart) console.log('Shady Grove 2 server: SG2_START_AT=lampfall-mouth; new adventurers start at the crater mouth (test servers only).');
else if (start.zone !== 'grove') console.log(`Shady Grove 2 server: SG2_START_ZONE=${start.zone}; new adventurers start there.`);
if (instanceStart) console.log('Shady Grove 2 server: SG2_TEST_INSTANCE_START=landing; new instances start at the landing (test servers only).');
if (dummyZones) console.log('Shady Grove 2 server: SG2_TEST_DUMMY=1; a Training Dummy stands in the grove (test servers only).');
if (startGold !== undefined) console.log(`Shady Grove 2 server: SG2_TEST_START_GOLD=${startGold}; new adventurers start with that gold (test servers only).`);
if (lootAlways) console.log('Shady Grove 2 server: SG2_TEST_LOOT=always; every credited kill drops an item (test servers only).');
if (startKit) console.log(`Shady Grove 2 server: SG2_TEST_KIT=t${startKit}; new adventurers wear that tier's kit (test servers only).`);
if (gms) console.log(`Shady Grove 2 server: SG2_TEST_GMS=${gms.join(',')}; those usernames are game masters when they register (test servers only).`);
if (exitsOpen) console.log(`Shady Grove 2 server: SG2_OPEN_EXITS=${process.env.SG2_OPEN_EXITS}; those exits are open.`);
console.log(
  trustProxy === undefined
    ? 'Shady Grove 2 server: SG2_TRUST_PROXY is off; login limits count each connection\'s own address.'
    : `Shady Grove 2 server: SG2_TRUST_PROXY=${trustProxy}; login limits count the address the proxy forwards.`,
);

let stopping = false;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`Shady Grove 2 server: ${signal}, saving adventurers and shutting down.`);
  try {
    await app.close();
    await store.close();
  } catch (err) {
    console.error('Shady Grove 2 server: error while shutting down:', err);
    process.exit(1);
  }
  process.exit(0);
}
process.on('SIGINT', () => void stop('SIGINT'));
process.on('SIGTERM', () => void stop('SIGTERM'));
