// Starting the server process: a startup failure ends it with one clear line, not a stack trace.
import { spawn } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SECRET } from './rooms/testHelpers';

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
});
