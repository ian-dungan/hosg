// The creator route tells an online room about a change only when one was made (Task 7 review round 1).
import { describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { defaultLook } from '@sg2/shared';
import { signToken } from '../auth/tokens';
import { createMemoryStore } from '../store/memory';
import { SECRET } from '../rooms/testHelpers';
import { lookRouter } from './look';

describe('/api/look onLookChanged', () => {
  it('is called once for the free visit, never for a refused one, and the dye write-back leaves jobs alone', async () => {
    const store = createMemoryStore();
    const account = await store.createAccount({ username: 'Fay', passwordHash: 'h', isGuest: false });
    await store.nameAdventurer(account.id, 'Fay');
    const changed = vi.fn();
    const app = express().use('/api/look', lookRouter(store, SECRET, { ratePerMinute: 1000, onLookChanged: changed }));
    const http = app.listen(0);
    await new Promise((r) => http.once('listening', r));
    const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/api/look`;
    const post = (body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${signToken(account.id, SECRET)}` }, body: JSON.stringify(body) });
    try {
      const writes = vi.spyOn(store, 'writeInventory');
      // the dye write-back loses its compare-and-set (a join wrote first): still one call, for the look itself
      const real = store.writeInventory.bind(store);
      writes.mockImplementationOnce(async (id, _v, w) => real(id, -1, w));
      expect((await post({ look: { v: 1 } })).status).toBe(400);
      expect(changed).not.toHaveBeenCalled();
      expect((await post({ look: defaultLook('x') })).status).toBe(200);
      expect(changed).toHaveBeenCalledTimes(1);
      expect(writes.mock.calls.every((c) => c[2].jobs === undefined)).toBe(true);
      expect((await post({ look: defaultLook('y') })).status).toBe(409);
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      http.close();
    }
  });
});
