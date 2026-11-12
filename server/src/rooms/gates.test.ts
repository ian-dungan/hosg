// Ruling P4-b on its own: a shut lamp-gate is a wall in the instance's surface (gatedSurface over the
// shared frozen def), so nothing crosses it: a long walking pose stepping over the circle, a dodge across
// it, a Beacon Lance knock across it, in both directions, at every gate; and a shut gate blocks sight.
// With the gate open each of the same moves goes through (so the walls are what stops them).
import { describe, expect, it } from 'vitest';
import {
  ENEMY_ATTACKS, GATE_PIT, GATE_WICK, GATE_WICK_EXIT, checkPose, dodgeDisplacement, gatedSight, gatedSurface, knockDisplacement, lampfallArena,
  lampfallGates, makeAirTrack, roomSideOf, shutGateOnStep, simulateDisplacement, zoneDef, type LampGate,
} from '@sg2/shared';
import { lineOfSight } from '../../../shared/src/combat/sight';

const def = zoneDef('lampfall');
const ALL = GATE_WICK | GATE_WICK_EXIT | GATE_PIT;
const shut = gatedSurface(def.surface, () => ALL);
const open = gatedSurface(def.surface, () => 0);

/** A point beside gate g: `along` m from its centre toward its room (negative: the corridor side), `lat` m to the side. */
const at = (g: LampGate, along: number, lat: number) => ({ x: g.x + g.ux * along - g.uz * lat, z: g.z + g.uz * along + g.ux * lat });
const side = (g: LampGate, p: { x: number; z: number }) => Math.sign((p.x - g.x) * g.ux + (p.z - g.z) * g.uz);
/** Inside the circle (its edge, where a stopped body rests against the wall, is not). */
const inCircle = (g: LampGate, p: { x: number; z: number }) => Math.hypot(p.x - g.x, p.z - g.z) < g.r - 1e-6;

describe('lamp-gates as walls (P4-b)', () => {
  it('three gates (the Wick Den in and out, the Lens Pit in), each 3 m, on its corridor', () => {
    const gates = lampfallGates();
    expect(gates.map((g) => [g.bit, g.encounter, g.r])).toEqual([[GATE_WICK, 'wickhound', 3], [GATE_WICK_EXIT, 'wickhound', 3], [GATE_PIT, 'warden', 3]]);
    for (const g of gates) {
      expect(open(g.x, g.z)).not.toBeNull(); // the corridor floor
      expect(shut(g.x, g.z)).toBeNull();
      expect(shut(roomSideOf(g).x, roomSideOf(g).z)).not.toBeNull(); // where someone caught in it is put
      expect(lampfallArena(g.encounter)(roomSideOf(g).x, roomSideOf(g).z)).toBe(true);
    }
  });

  for (const g of lampfallGates()) {
    for (const dir of [1, -1]) {
      const name = `gate ${g.bit}, ${dir > 0 ? 'into the room' : 'out of the room'}`;
      it(`${name}: a walking pose over the circle (the 3.56 m chord at the corridor's edge, straight across) or into it is blocked`, () => {
        let tried = 0;
        // across the circle (a chord at the corridor's edge, straight across), or (where the floor steps a
        // metre inside the circle, the Wick Stair's first terrace) a step into it from this side
        const lines = [[2.4, -1.78, 1.78], [0, -3.3, 3.3], [-2.4, -1.78, 1.78], [1.5, -2.7, 2.7], [-1.5, -2.7, 2.7], [0, -3.4, -2.2], [1, -3.4, -1.9]] as const;
        for (const [lat, a0, a1] of lines) {
          const from = at(g, dir * a0, lat), to = at(g, dir * a1, lat);
          const pose = { ...to, y: open(to.x, to.z) ?? 0, facing: 0, moving: true, ack: 0 };
          const go = (s: typeof open) => checkPose(from, makeAirTrack(s(from.x, from.z) ?? 0), pose, 0, Infinity, s).result;
          // (a line that is not a walk even with the gate open: a corridor wall, or the Wick Stair's 1 m terraces)
          if (open(from.x, from.z) === null || go(open) !== 'ok') continue;
          tried++;
          expect(go(shut), `${name} lat ${lat} shut`).toBe('blocked');
          expect(shutGateOnStep(ALL, from, to)).toBe(g);
        }
        expect(tried).toBeGreaterThanOrEqual(2);
      });

      it(`${name}: a 4.5 m dodge and a Beacon Lance knock across stop at the wall`, () => {
        const knock = ENEMY_ATTACKS.beacon_lance.knock!;
        for (const lat of [-2.2, 0, 2.2]) {
          const from = at(g, -dir * (g.r + 0.3), lat);
          const start = { ...from, y: shut(from.x, from.z)! };
          const along = { x: g.ux * dir, z: g.uz * dir };
          const moves = [
            dodgeDisplacement(along.x, along.z),
            knockDisplacement({ x: from.x - along.x, z: from.z - along.z }, from, knock),
            // a knock along the corridor wall's line (the case the Task 2 review found)
            knockDisplacement({ x: from.x - along.x * 2, z: from.z - along.z * 2 }, from, { ...knock, seconds: knock.seconds * 1.5 }),
          ];
          for (const d of moves) {
            const through = simulateDisplacement(start, d, open);
            const stopped = simulateDisplacement(start, d, shut);
            expect(stopped.path.every((p) => !inCircle(g, p)), `${name} lat ${lat}`).toBe(true);
            expect(side(g, stopped), `${name} lat ${lat}`).toBe(-dir);
            // open, the same move goes into or past the circle
            expect(through.path.some((p) => inCircle(g, p) || side(g, p) === dir)).toBe(true);
          }
        }
      });
    }

    it(`gate ${g.bit}: a shut gate blocks sight across it (no explicit heal or revive through it)`, () => {
      const a = at(g, -(g.r + 1), 0), b = at(g, g.r + 1, 0);
      expect(lineOfSight(def.sight, a.x, a.z, b.x, b.z)).toBe(true);
      expect(lineOfSight(gatedSight(def.sight, () => g.bit), a.x, a.z, b.x, b.z)).toBe(false);
    });
  }
});
