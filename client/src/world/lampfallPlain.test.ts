import { describe, expect, it } from 'vitest';
import { GATE_PIT, GATE_WICK, GATE_WICK_EXIT, dodgeDisplacement, lampfallGates, lampfallLayout, roomSideOf, simulateDisplacement } from '@sg2/shared';
import { lampfallRoomAt, lampfallSurfaces } from './lampfallPlain';

describe('the Lampfall placeholder: its walk and the lamp-gates', () => {
  it('a shut gate is a wall for the client exactly as for the server; an open one is floor', () => {
    let mask = 0;
    const { surface, ground } = lampfallSurfaces(() => mask);
    for (const g of lampfallGates()) {
      mask = 0;
      expect(surface(g.x, g.z), `gate ${g.bit} open`).not.toBeNull();
      mask = g.bit;
      expect(surface(g.x, g.z)).toBeNull();
      expect(ground(g.x, g.z)).toBeNull();
      // the other gates' bits leave this one open
      mask = (GATE_WICK | GATE_WICK_EXIT | GATE_PIT) & ~g.bit;
      expect(surface(g.x, g.z)).not.toBeNull();
    }
  });

  it('a dodge into a shut gate stops at its edge (the server stops it there too: no correction)', () => {
    const g = lampfallGates().find((x) => x.bit === GATE_WICK)!;
    let mask = GATE_WICK;
    const { surface } = lampfallSurfaces(() => mask);
    // from inside the den, rolling straight back out through the gate
    const from = roomSideOf(g), y = surface(from.x, from.z)!;
    const end = simulateDisplacement({ x: from.x, z: from.z, y }, dodgeDisplacement(-g.ux, -g.uz), surface);
    const d = Math.hypot(end.x - g.x, end.z - g.z);
    expect(d).toBeGreaterThanOrEqual(g.r - 1e-6);
    mask = 0;
    const free = simulateDisplacement({ x: from.x, z: from.z, y }, dodgeDisplacement(-g.ux, -g.uz), surface);
    expect(Math.hypot(free.x - from.x, free.z - from.z)).toBeGreaterThan(Math.hypot(end.x - from.x, end.z - from.z));
  });

  it('names the room a point is in (the banner as an adventurer walks in)', () => {
    const l = lampfallLayout();
    for (const r of l.rooms) expect(lampfallRoomAt(r.x, r.z)?.name).toBe(r.name);
    const c = l.corridors[0];
    expect(lampfallRoomAt((c.ax + c.bx) / 2, (c.az + c.bz) / 2)).toBeNull();
  });
});
