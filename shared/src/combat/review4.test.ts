// Task 3 review round 1 (Plan 4): engine hygiene around parties, fields, Soft Rain and adds.
import { describe, expect, it } from 'vitest';
import { BUFF_BITS, type Loadout } from './abilities';
import { spawnEnemy } from './adventurer';
import type { FieldDef } from './bosses';
import { addField } from './fields';
import { Rig, camp } from './testRig';

// slots: slash, sunder, parry, rallying_roar, mend
const WARRIOR: Loadout = { job: 'warrior', picks: ['rallying_roar', 'mend'] };
// slots: tidelash, lantern_flare, wellspring, soft_rain | second_dawn, mistveil
const WHITE: Loadout = { job: 'white_mage', picks: ['soft_rain', 'second_dawn'] };
const RING: FieldDef = { id: 'lampfire', shape: { kind: 'ring', x: 0, z: 0, dir: 0, inner: 15, r: 40 }, raw: 8 };
const has = (r: Rig, id: number, buff: keyof typeof BUFF_BITS) => ((r.c.get(id)!.buffs ?? 0) & BUFF_BITS[buff]) !== 0;

describe('Task 3 review round 1', () => {
  it('a party key on addAdventurer is dropped: only setParty sets a party', () => {
    const r = new Rig([]);
    const id = r.c.addAdventurer({ x: 0, z: 0, y: 0, facing: 0, hp: 100, loadout: WARRIOR, party: 'p1' } as never, r.now);
    expect(r.w.adventurers.get(id)!.party).toBeNull();
  });

  it("setParty(id, '') is no party", () => {
    const r = new Rig([]);
    const a = r.add(0, 0), b = r.add(2, 0);
    r.c.setParty(a, ''); r.c.setParty(b, '');
    expect(r.w.adventurers.get(a)!.party).toBeNull();
    expect(r.w.adventurers.get(b)!.party).toBeNull();
  });

  it('the caster receives its own area effect, in a party and without one', () => {
    for (const party of [null, 'p1']) {
      const r = new Rig([]);
      const war = r.add(0, 0, WARRIOR), wm = r.add(20, 0, WHITE, 50);
      if (party) r.party(party, war, wm);
      expect(r.press(war, 3)).toBeNull(); // Rallying Roar
      expect(r.press(wm, 3)).toBeNull(); // Soft Rain
      r.at(0.2);
      expect(has(r, war, 'roar')).toBe(true);
      expect(has(r, wm, 'rain')).toBe(true);
      expect(has(r, wm, 'roar')).toBe(false); // 20 m away
    }
  });

  it('addField with a stale time starts from the current time (no burst of ticks)', () => {
    const r = new Rig([camp('dummy', 0, 0)]);
    const owner = r.w.enemies.get(r.enemy('dummy'))!;
    const id = r.add(20, 0);
    r.at(5);
    addField(r.w, owner, RING, 0);
    r.at(5.5);
    expect(r.hits().filter((h) => h.by === 'field' && h.dst === id)).toEqual([]);
    r.at(6.1);
    expect(r.hits().filter((h) => h.by === 'field').length).toBe(1);
  });

  it('after a stall, a field and Soft Rain catch up at most 2 ticks per engine tick', () => {
    // the stalled tick itself: 2 field ticks and 2 rain heals at most
    const r = new Rig([camp('dummy', 0, 0)]);
    const owner = r.w.enemies.get(r.enemy('dummy'))!;
    const id = r.add(20, 0, WHITE, 10);
    addField(r.w, owner, RING, r.now);
    r.press(id, 3);
    r.tick();
    const stalled = r.c.tick(5.5);
    expect(stalled.fx.filter((f) => f.t === 'hit' && f.by === 'field').length).toBe(2);
    expect(stalled.fx.filter((f) => f.t === 'heal').length).toBe(2);
    expect(r.c.tick(5.6).fx.filter((f) => f.t === 'hit' || f.t === 'heal').length).toBe(0);
    expect(r.c.tick(6.05).fx.filter((f) => f.t === 'hit' && f.by === 'field').length).toBe(1);
  });

  it('an elite add keeps its spawn scale when it scales up with the adventurers engaged', () => {
    const r = new Rig([], {});
    const a = r.add(1, 0), b = r.add(-1, 0);
    const e = spawnEnemy(r.w, { kind: 'mossback', x: 0, z: 0, facing: 0 }, { engageWith: [a, b], scale: 1.5, nowS: r.now });
    r.tick();
    // two engaged: × (1 + 0.7) on top of the spawn's × 1.5
    expect(e.maxHp).toBeCloseTo(750 * 1.5 * 1.7, 9);
    expect(e.stagger.max).toBeCloseTo(100 * 1.5 * 1.7, 9);
  });
});
