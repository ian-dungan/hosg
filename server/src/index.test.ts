// Starting the server process: a startup failure ends it with one clear line, not a stack trace.
import { spawn } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Client } from '@colyseus/sdk';
import { describe, expect, it } from 'vitest';
import { SECRET, waitFor } from './rooms/testHelpers';

const entry = fileURLToPath(new URL('./index.ts', import.meta.url));

/** Runs src/index.ts with `env` until it exits (within 15 s); its exit code and stderr. */
function runServer(env: Record<string, string>): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', entry], {
      env: { PATH: process.env.PATH ?? '', SG2_JWT_SECRET: SECRET, ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`the server did not exit; stderr: ${stderr}`));
    }, 15_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

/** A port on 127.0.0.1 held open by a plain TCP server until `release` is called. */
async function heldPort(): Promise<{ port: number; release: () => Promise<void> }> {
  const holder = createServer();
  await new Promise<void>((resolve) => holder.listen(0, resolve));
  const { port } = holder.address() as AddressInfo;
  return { port, release: () => new Promise((resolve) => holder.close(() => resolve())) };
}

/** Runs src/index.ts with `env` on a free port until it listens; the enemies a guest sees in the grove, then it is stopped. */
async function groveEnemies(env: Record<string, string>): Promise<string[]> {
  const { port, release } = await heldPort();
  await release();
  const child = spawn(process.execPath, ['--import', 'tsx', entry], {
    env: { PATH: process.env.PATH ?? '', SG2_JWT_SECRET: SECRET, SG2_STORE: 'memory', SG2_PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', () => {});
    await waitFor(() => out.includes('listening'), 15_000);
    const url = `http://127.0.0.1:${port}`;
    const { token } = (await (await fetch(`${url}/api/guest`, { method: 'POST' })).json()) as { token: string };
    const room = await new Client(url).joinOrCreate('grove', { token });
    room.onMessage('*', () => {});
    await waitFor(() => room.state.players?.get(room.sessionId), 5000);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const kinds = [...room.state.enemies.values()].map((e: any) => `${e.kind}@${e.x},${e.z}`);
    await room.leave();
    return kinds;
  } finally {
    child.kill('SIGTERM');
  }
}

describe('SG2_TEST_DUMMY', () => {
  it('is off by default: the grove has no enemies; =1 adds one Training Dummy at (3, -11)', async () => {
    expect(await groveEnemies({})).toEqual([]);
    expect(await groveEnemies({ SG2_TEST_DUMMY: '1' })).toEqual(['dummy@3,-11']);
  }, 40_000);

  it('exits with one line for anything but 1, 0 or empty', async () => {
    const { code, stderr } = await runServer({ SG2_STORE: 'memory', SG2_TEST_DUMMY: 'yes' });
    expect(code).toBe(1);
    expect(stderr.trim()).toBe('Shady Grove 2 server: SG2_TEST_DUMMY must be 1 or empty (got "yes").');
  }, 20_000);
});

describe('server startup', () => {
  it('exits with one line when the port is already in use', async () => {
    const { port, release } = await heldPort();
    try {
      const { code, stderr } = await runServer({ SG2_STORE: 'memory', SG2_PORT: String(port) });
      expect(code).toBe(1);
      expect(stderr).toContain(`Shady Grove 2 server: port ${port} is already in use;`);
      expect(stderr).not.toMatch(/^\s+at /m);
    } finally {
      await release();
    }
  }, 20_000);

  it('exits with one line when the database cannot be reached', async () => {
    const { port, release } = await heldPort();
    await release(); // nothing listens there now
    const { code, stderr } = await runServer({ DATABASE_URL: `postgres://sg2:pw-not-shown@127.0.0.1:${port}/sg2` });
    expect(code).toBe(1);
    expect(stderr.trim()).toBe(`Shady Grove 2 server: cannot open the database at DATABASE_URL: connect ECONNREFUSED 127.0.0.1:${port}.`);
  }, 20_000);

  it('exits with one line when SG2_TRUST_PROXY is not a hop count', async () => {
    for (const value of ['loopback', '0', '-1', '1.5', 'true']) {
      const { code, stderr } = await runServer({ SG2_STORE: 'memory', SG2_TRUST_PROXY: value });
      expect(code).toBe(1);
      expect(stderr.trim()).toBe(
        `Shady Grove 2 server: SG2_TRUST_PROXY must be the number of proxies in front of the server (for example 1), or empty (got "${value}").`,
      );
    }
  }, 60_000);

  it('exits with one line when SG2_START_ZONE or SG2_OPEN_EXITS names no zone', async () => {
    const start = await runServer({ SG2_STORE: 'memory', SG2_START_ZONE: 'moon' });
    expect(start.code).toBe(1);
    expect(start.stderr.trim()).toBe('Shady Grove 2 server: SG2_START_ZONE must be grove or greenway (got "moon").');
    for (const value of ['grove', 'grove:moon', 'grove:greenway,greenway']) {
      const exits = await runServer({ SG2_STORE: 'memory', SG2_OPEN_EXITS: value });
      expect(exits.code).toBe(1);
      expect(exits.stderr.trim()).toBe(
        `Shady Grove 2 server: SG2_OPEN_EXITS must be a comma-separated list of from:to zone pairs, for example grove:greenway (got "${value}").`,
      );
    }
  }, 60_000);
});
