// GET and POST /api/look: the creator's free visit (with the name, for an adventurer that has none), then the Barber only.
import { afterEach, describe, expect, it } from 'vitest';
import { defaultLook, encodeLook, randomLook, prng } from '@sg2/shared';
import { signToken } from '../auth/tokens';
import { createMemoryStore } from '../store/memory';
import { SECRET, startServer, type TestServer } from '../rooms/testHelpers';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.app.close();
  server = undefined;
});

async function start() {
  server = await startServer({ store: createMemoryStore(), authRatePerMinute: 1000 });
  return server;
}

const call = async (url: string, method: 'GET' | 'POST', token: string | null, body?: unknown) => {
  const res = await fetch(`${url}/api/look`, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};

describe('/api/look', () => {
  it('GET, the free POST with and without a name, the second POST → 409, a bad look → 400, no token → 401', async () => {
    const { url, store } = await start();
    const unnamed = await store.createAccount({ username: 'Hazel', passwordHash: 'h', isGuest: false });
    const token = signToken(unnamed.id, SECRET);
    expect(await call(url, 'GET', token)).toEqual({ status: 200, body: { look: null, free: true, name: null, guest: false } });
    expect((await call(url, 'GET', null)).status).toBe(401);
    expect((await call(url, 'POST', 'not-a-token', { look: defaultLook('x') })).status).toBe(401);
    // a bad look, and a bad name, change nothing
    const brindle = { ...defaultLook('x'), people: 'human', fur: { pattern: 0, colour: 0, tail: 0 } };
    for (const bad of [{ look: brindle }, { look: { v: 1 } }, {}, { look: defaultLook('x'), name: 'x' }, { look: defaultLook('x'), name: 7 }]) {
      expect((await call(url, 'POST', token, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await store.getOrCreateAdventurer(unnamed.id))).toMatchObject({ lookFree: true, name: null });
    // the free visit with a name: both taken, the starter kit dyed with the outfit's dyes
    const look = { ...randomLook(prng(5)), outfit: { dye1: 3, dye2: 9 } };
    expect(await call(url, 'POST', token, { look, name: 'Hazelwick' })).toEqual({ status: 200, body: { look, free: false, name: 'Hazelwick', guest: false } });
    const a = await store.getOrCreateAdventurer(unnamed.id);
    expect(a).toMatchObject({ name: 'Hazelwick', lookFree: false });
    expect(encodeLook(a.look!)).toBe(encodeLook(look));
    expect(a.inventory.bag.every((i) => i.dye[0] === 3 && i.dye[1] === 9)).toBe(true);
    expect((await call(url, 'POST', token, { look: defaultLook('y') }))).toEqual({ status: 409, body: { error: 'Visit the Barber in Shady Grove to change your look' } });
    expect(await call(url, 'GET', token)).toMatchObject({ status: 200, body: { free: false, name: 'Hazelwick' } });
    // without a name: a guest (named already)
    const guest = await store.createAccount({ username: 'Guest-000042', passwordHash: null, isGuest: true });
    await store.nameAdventurer(guest.id, 'Guest-000042');
    const gt = signToken(guest.id, SECRET);
    expect(await call(url, 'GET', gt)).toEqual({ status: 200, body: { look: null, free: true, name: 'Guest-000042', guest: true } });
    expect((await call(url, 'POST', gt, { look })).status).toBe(200);
    expect((await store.getOrCreateAdventurer(guest.id))).toMatchObject({ name: 'Guest-000042', lookFree: false });
    // a name that is taken: 409, and the free visit is not spent
    const third = await store.createAccount({ username: 'Third', passwordHash: 'h', isGuest: false });
    const tt = signToken(third.id, SECRET);
    expect(await call(url, 'POST', tt, { look, name: 'hazelwick' })).toEqual({ status: 409, body: { error: 'That name is taken' } });
    expect((await store.getOrCreateAdventurer(third.id)).lookFree).toBe(true);
  });
});
