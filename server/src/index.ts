// Starts the Shady Grove 2 server from environment variables.
import { createApp } from './app';
import { createMemoryStore } from './store/memory';
import { createPgStore } from './store/pg';
import type { Store } from './store/types';

function fail(message: string): never {
  console.error(`Shady Grove 2 server: ${message}`);
  process.exit(1);
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) fail(`${name} must be a positive whole number (got "${raw}").`);
  return value;
}

const port = positiveInt('SG2_PORT', 2570);
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
  store = await createPgStore(databaseUrl);
}

const app = createApp({ store, jwtSecret, clientDir, authRatePerMinute });
await app.listen(port);
console.log(`Shady Grove 2 server listening on port ${port}${clientDir ? `, serving ${clientDir}` : ''}.`);

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
