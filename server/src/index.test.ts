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

describe('SG2_START_AT and SG2_TEST_INSTANCE_START (test servers only)', () => {
  it('are off by default (never set in Docker or docker-compose.yml) and exit with one line for anything else', async () => {
    const { readFile } = await import('node:fs/promises');
    for (const file of ['../../docker-compose.yml', '../../Dockerfile']) {
      const text = await readFile(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
      expect(text, file).not.toMatch(/SG2_START_AT|SG2_TEST_INSTANCE_START/);
    }
    const at = await runServer({ SG2_STORE: 'memory', SG2_START_AT: 'moon' });
    expect(at.code).toBe(1);
    expect(at.stderr.trim()).toBe('Shady Grove 2 server: SG2_START_AT must be lampfall-mouth or empty (got "moon").');
    const clash = await runServer({ SG2_STORE: 'memory', SG2_START_AT: 'lampfall-mouth', SG2_START_ZONE: 'grove' });
    expect(clash.code).toBe(1);
    expect(clash.stderr.trim()).toBe('Shady Grove 2 server: SG2_START_AT=lampfall-mouth starts in the Greenway; SG2_START_ZONE must be greenway or empty (got "grove").');
    const inst = await runServer({ SG2_STORE: 'memory', SG2_TEST_INSTANCE_START: 'rim' });
    expect(inst.code).toBe(1);
    expect(inst.stderr.trim()).toBe('Shady Grove 2 server: SG2_TEST_INSTANCE_START must be landing or empty (got "rim").');
  }, 60_000);
});

/** Runs src/index.ts with `env` until it listens; a guest's first `type` message (its inventory view) in the grove, then it is stopped. */
async function guestInventory(env: Record<string, string>, type = 'inventory'): Promise<any> {
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
    let view: any;
    room.onMessage('*', (t: string | number, message: any) => { if (t === type) view ??= message; });
    await waitFor(() => view, 5000);
    await room.leave();
    return view;
  } finally {
    child.kill('SIGTERM');
  }
}

describe('SG2_TEST_START_GOLD, SG2_TEST_LOOT and SG2_TEST_KIT (test servers only)', () => {
  it('are off by default (never set in Docker or docker-compose.yml), give gold and a worn kit when set, and exit with one line for anything else', async () => {
    const { readFile } = await import('node:fs/promises');
    for (const file of ['../../docker-compose.yml', '../../Dockerfile']) {
      const text = await readFile(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
      expect(text, file).not.toMatch(/SG2_TEST_START_GOLD|SG2_TEST_LOOT|SG2_TEST_KIT/);
    }
    const plain = await guestInventory({});
    expect(plain.gold).toBe(0);
    expect(plain.bag).toHaveLength(16);
    const kitted = await guestInventory({ SG2_TEST_START_GOLD: '777', SG2_TEST_KIT: 't1', SG2_TEST_LOOT: 'always' });
    expect(kitted.gold).toBe(777);
    expect(kitted.bag.find((i: any) => i.item === 'thornrunner_chest')?.worn).toEqual(['warrior', 'ranger', 'ninja']);
    for (const [name, value, line] of [
      ['SG2_TEST_START_GOLD', '-5', 'SG2_TEST_START_GOLD must be a whole number of gold from 0 to 1000000, or empty (got "-5").'],
      ['SG2_TEST_LOOT', 'sometimes', 'SG2_TEST_LOOT must be always or empty (got "sometimes").'],
      ['SG2_TEST_KIT', 't4', 'SG2_TEST_KIT must be t1, t2, t3 or empty (got "t4").'],
    ] as const) {
      const r = await runServer({ SG2_STORE: 'memory', [name]: value });
      expect(r.code, name).toBe(1);
      expect(r.stderr.trim()).toBe(`Shady Grove 2 server: ${line}`);
    }
  }, 60_000);
});

/** Runs src/index.ts with `env` (memory store): registers alice, names her, joins and says "/gm help"; what came back. */
async function gmHelpAnswer(env: Record<string, string>): Promise<'chat' | 'notice'> {
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
    const post = async (path: string, body: object, token?: string) => (await fetch(`${url}/api${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    })).json() as Promise<any>;
    const { token } = await post('/register', { username: 'alice', password: 'a-long-password-1' });
    await post('/name', { name: 'Alice' }, token);
    const room = await new Client(url).joinOrCreate('grove', { token });
    let answer: 'chat' | 'notice' | undefined;
    room.onMessage('*', (type: string | number) => { if (type === 'chat' || type === 'notice') answer ??= type; });
    await waitFor(() => room.state.players?.get(room.sessionId), 5000);
    room.send('chat', { text: '/gm help' });
    await waitFor(() => answer, 5000);
    await room.leave();
    return answer!;
  } finally {
    child.kill('SIGTERM');
  }
}

describe('SG2_TEST_GMS (test servers only)', () => {
  it('is off by default (never set in Docker or docker-compose.yml), works only with the memory store, and exits with one line for anything else', async () => {
    const { readFile } = await import('node:fs/promises');
    for (const file of ['../../docker-compose.yml', '../../Dockerfile']) {
      const text = await readFile(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
      expect(text, file).not.toMatch(/SG2_TEST_GMS/);
    }
    expect(await gmHelpAnswer({})).toBe('chat'); // nobody is a game master: an ordinary chat line
    expect(await gmHelpAnswer({ SG2_TEST_GMS: 'bob,alice' })).toBe('notice');
    const bad = await runServer({ SG2_STORE: 'memory', SG2_TEST_GMS: 'a b' });
    expect(bad.code).toBe(1);
    expect(bad.stderr.trim()).toBe('Shady Grove 2 server: SG2_TEST_GMS must be a comma-separated list of usernames (got "a b").');
    const prod = await runServer({ SG2_STORE: 'memory', SG2_TEST_GMS: 'alice', NODE_ENV: 'production' });
    expect(prod.code).toBe(1);
    expect(prod.stderr.trim()).toBe('Shady Grove 2 server: SG2_TEST_GMS is refused when NODE_ENV=production.');
    const pg = await runServer({ SG2_TEST_GMS: 'alice', DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none' });
    expect(pg.code).toBe(1);
    expect(pg.stderr.trim()).toBe('Shady Grove 2 server: SG2_TEST_GMS works only with SG2_STORE=memory; with a database, use the role CLI (npm run gm -w server -- grant <username>).');
  }, 60_000);
});

/** Runs src/index.ts with `env` (memory store) until it listens; a guest's first `quests` view in the grove, then it is stopped. */
async function guestQuests(env: Record<string, string>): Promise<any> {
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
    const zone = (await (await fetch(`${url}/api/zone`, { headers: { authorization: `Bearer ${token}` } })).json()) as { zone: string };
    const room = await new Client(url).joinOrCreate(zone.zone ?? 'grove', { token });
    let view: any;
    room.onMessage('*', (type: string | number, message: any) => { if (type === 'quests') view ??= message; });
    await waitFor(() => view, 5000);
    await room.leave();
    return view;
  } finally {
    child.kill('SIGTERM');
  }
}

describe('SG2_TEST_QUEST (test servers only)', () => {
  it('is off by default (never set in Docker or docker-compose.yml), sets the start step, and exits with one line for anything else', async () => {
    const { readFile } = await import('node:fs/promises');
    for (const file of ['../../docker-compose.yml', '../../Dockerfile']) {
      const text = await readFile(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
      expect(text, file).not.toMatch(/SG2_TEST_QUEST/);
    }
    expect((await guestQuests({})).active).toEqual([{ id: 'solstice_crossing', step: 0, counts: [0] }]);
    const at = await guestQuests({ SG2_TEST_QUEST: 'solstice_crossing:first_fight', SG2_START_ZONE: 'greenway' });
    expect(at.active).toEqual([{ id: 'solstice_crossing', step: 8, counts: [0, 0, 0, 0] }]);
    expect(at.done).toEqual([]);
    const lamp = await guestQuests({ SG2_TEST_QUEST: 'keepers_lamp:hound' });
    expect(lamp.active).toEqual([{ id: 'keepers_lamp', step: 1, counts: [0] }]);
    expect(lamp.done.map((d: any) => d.id)).toEqual(['solstice_crossing']);
    for (const [value, line] of [
      ['solstice_crossing', 'SG2_TEST_QUEST must be <quest>:<step id>, for example solstice_crossing:first_fight, or empty (got "solstice_crossing").'],
      ['solstice_crossing:nowhere', 'SG2_TEST_QUEST must be <quest>:<step id>, for example solstice_crossing:first_fight, or empty (got "solstice_crossing:nowhere").'],
      ['dragons:lair', 'SG2_TEST_QUEST must be <quest>:<step id>, for example solstice_crossing:first_fight, or empty (got "dragons:lair").'],
    ] as const) {
      const r = await runServer({ SG2_STORE: 'memory', SG2_TEST_QUEST: value });
      expect(r.code, value).toBe(1);
      expect(r.stderr.trim()).toBe(`Shady Grove 2 server: ${line}`);
    }
    const prod = await runServer({ SG2_STORE: 'memory', SG2_TEST_QUEST: 'solstice_crossing:gate', NODE_ENV: 'production' });
    expect(prod.code).toBe(1);
    expect(prod.stderr.trim()).toBe('Shady Grove 2 server: SG2_TEST_QUEST is refused when NODE_ENV=production.');
    const pg = await runServer({ SG2_TEST_QUEST: 'solstice_crossing:gate', DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none' });
    expect(pg.code).toBe(1);
    expect(pg.stderr.trim()).toBe('Shady Grove 2 server: SG2_TEST_QUEST works only with SG2_STORE=memory.');
  }, 90_000);
});

describe('SG2_TEST_START_XP (test servers only)', () => {
  it("is off by default, starts a new adventurer's Warrior at that xp (and its level) when set, and exits with one line for anything else", async () => {
    const { readFile } = await import('node:fs/promises');
    for (const file of ['../../docker-compose.yml', '../../Dockerfile']) {
      const text = await readFile(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
      expect(text, file).not.toMatch(/SG2_TEST_START_XP/);
    }
    expect((await guestInventory({}, 'jobs')).jobs.warrior).toMatchObject({ level: 1 });
    // 429 xp: level 3, one xp short of level 4 (the first talent row)
    expect((await guestInventory({ SG2_TEST_START_XP: '429' }, 'jobs')).jobs.warrior).toMatchObject({ level: 3 });
    for (const value of ['-1', '3181', 'lots']) {
      const r = await runServer({ SG2_STORE: 'memory', SG2_TEST_START_XP: value });
      expect(r.code, value).toBe(1);
      expect(r.stderr.trim()).toBe(`Shady Grove 2 server: SG2_TEST_START_XP must be a whole number of xp from 0 to 3180, or empty (got "${value}").`);
    }
  }, 60_000);
});

describe('test switches in production (final review I4)', () => {
  const switches: Record<string, string> = {
    SG2_TEST_KIT: 't2', SG2_TEST_START_GOLD: '1000', SG2_TEST_START_XP: '429', SG2_TEST_LOOT: 'always', SG2_TEST_DUMMY: '1', SG2_TEST_INSTANCE_START: 'landing',
    SG2_START_AT: 'lampfall-mouth', SG2_START_ZONE: 'greenway', SG2_OPEN_EXITS: 'grove:greenway',
  };
  it('each is refused with one line when NODE_ENV=production', async () => {
    for (const [name, value] of Object.entries(switches)) {
      const { code, stderr } = await runServer({ SG2_STORE: 'memory', NODE_ENV: 'production', [name]: value });
      expect(code, name).toBe(1);
      expect(stderr.trim(), name).toBe(`Shady Grove 2 server: ${name} is refused when NODE_ENV=production.`);
    }
  }, 120_000);

  it('empty switches are fine in production (docker compose passes unset ones through as empty)', async () => {
    const { port, release } = await heldPort();
    await release();
    const child = spawn(process.execPath, ['--import', 'tsx', entry], {
      env: { PATH: process.env.PATH ?? '', SG2_JWT_SECRET: SECRET, SG2_STORE: 'memory', SG2_PORT: String(port), NODE_ENV: 'production', ...Object.fromEntries(Object.keys(switches).map((k) => [k, ''])) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      let out = '';
      child.stdout.on('data', (chunk) => (out += chunk));
      child.stderr.on('data', () => {});
      await waitFor(() => out.includes('listening'), 15_000);
    } finally {
      child.kill('SIGTERM');
    }
  }, 30_000);
});
