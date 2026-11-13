import { describe, expect, it } from 'vitest';
import { routeTap } from './tapOrder';
import { STALL_EID } from '../world/stallIds';
import { equipHook } from './equipHook';

const is = {
  enemy: (e: number) => e >= 100 && e < 200,
  story: (e: number) => e <= -100,
  booth: (e: number) => Object.values(STALL_EID).includes(e),
};
const tap = (...ids: number[]) => ({ entityId: ids[0] ?? null, point: null, entityIds: ids });

describe('tap order: enemy > story NPC or prop > booth > adventurer > ground', () => {
  it('an enemy wins over everything behind it', () => {
    expect(routeTap(tap(STALL_EID.smithy, -101, 150), is)).toBe('enemy');
  });
  it('a story spot wins over a booth, a booth over an adventurer', () => {
    expect(routeTap(tap(STALL_EID.tailor, -101), is)).toBe('story');
    expect(routeTap(tap(7, STALL_EID.vault), is)).toBe('booth');
    expect(routeTap(tap(7), is)).toBe('rest');
    expect(routeTap({ entityId: null, point: null }, is)).toBe('rest');
  });
});

describe('equipHook', () => {
  it('is a no-op until a room installs it', async () => {
    expect(equipHook.open).toBeNull();
    let opened = 0;
    equipHook.open = () => { opened++; };
    equipHook.open();
    expect(opened).toBe(1);
    equipHook.open = null;
  });
});
