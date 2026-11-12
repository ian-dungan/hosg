import { describe, expect, it } from 'vitest';
import { Presence } from './presence';
import type { ZoneRoom } from './ZoneRoom';

const grove = { name: 'grove' } as unknown as ZoneRoom;
const greenway = { name: 'greenway' } as unknown as ZoneRoom;

describe('Presence', () => {
  it('claim returns the previous claim, across rooms, and get finds the newest', () => {
    const presence = new Presence();
    expect(presence.get('A')).toBeUndefined();
    expect(presence.claim('A', grove, 's1')).toBeUndefined();
    expect(presence.get('A')).toEqual({ room: grove, sessionId: 's1' });
    expect(presence.claim('A', greenway, 's2')).toEqual({ room: grove, sessionId: 's1' });
    expect(presence.get('A')).toEqual({ room: greenway, sessionId: 's2' });
    expect(presence.claim('B', grove, 's3')).toBeUndefined();
    expect(presence.size).toBe(2);
  });

  it('release by a stale session does nothing; by the holder it frees the account', () => {
    const presence = new Presence();
    presence.claim('A', grove, 's1');
    presence.claim('A', greenway, 's2');
    presence.release('A', 's1');
    expect(presence.get('A')).toEqual({ room: greenway, sessionId: 's2' });
    presence.release('B', 's2'); // another account: nothing
    expect(presence.size).toBe(1);
    presence.release('A', 's2');
    expect(presence.get('A')).toBeUndefined();
    expect(presence.size).toBe(0);
  });

  it('get returns a copy: changing it does not move the claim', () => {
    const presence = new Presence();
    presence.claim('A', grove, 's1');
    const got = presence.get('A')!;
    got.sessionId = 'forged';
    expect(presence.get('A')?.sessionId).toBe('s1');
  });

  it('names: findable while online, gone when the account goes offline everywhere; onOnline follows the claims', () => {
    const seen: [string, boolean][] = [];
    const presence = new Presence({ onOnline: (id, online) => seen.push([id, online]) });
    presence.named('A', 'Alice'); // not online: ignored
    expect(presence.names.size).toBe(0);
    presence.claim('A', grove, 's1');
    presence.named('A', 'Alice');
    expect(presence.names.get('alice')).toBe('A');
    expect(presence.nameOf('A')).toBe('Alice');
    presence.claim('A', greenway, 's2'); // a travel or a second tab: still online
    presence.release('A', 's1');
    expect(presence.names.get('alice')).toBe('A');
    presence.release('A', 's2');
    expect(presence.names.size).toBe(0);
    expect(presence.nameOf('A')).toBeUndefined();
    expect(seen).toEqual([['A', true], ['A', false]]);
  });
});
