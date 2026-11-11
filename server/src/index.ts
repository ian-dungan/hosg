// Starts the Shady Grove 2 server from environment variables.
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

const port = positiveInt('SG2_PORT', 2570);
const trustProxy = trustProxyHops();
const authRatePerMinute = positiveInt('SG2_AUTH_RATE_PER_MIN', 10);
const jwtSecret = process.env.SG2_JWT_SECRET;
if (!jwtSecret) fail('SG2_JWT_SECRET is not set. Set it to a random string of at least 32 characters.');
if (jwtSecret.length < 32) fail(`SG2_JWT_SECRET is too short (${jwtSecret.length} characters); use at least 32.`);
const clientDir = process.env.SG2_CLIENT_DIR || undefined;

let store: Store;
if (process.env.SG2_STORE === 'memory') {
  console.warn('Shady Grove 2 server: SG2_STORE=memory, nothing is saved across restarts.');
  store = createMemoryStore();
} else {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail('DATABASE_URL is not set (or set SG2_STORE=memory to run without a database).');
  try {
    store = await createPgStore(databaseUrl);
  } catch (err) {
    fail(`cannot open the database at DATABASE_URL: ${reason(err)}.`);
  }
}

const app = createApp({ store, jwtSecret, clientDir, authRatePerMinute, trustProxy });
try {
  await app.listen(port);
} catch (err) {
  const inUse = (err as NodeJS.ErrnoException).code === 'EADDRINUSE';
  fail(inUse ? `port ${port} is already in use; stop whatever uses it or set SG2_PORT to another port.` : `cannot listen on port ${port}: ${reason(err)}.`);
}
console.log(`Shady Grove 2 server listening on port ${port}${clientDir ? `, serving ${clientDir}` : ''}.`);
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
