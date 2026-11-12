// The ally rule (Plan 4): automatic picks and area effects reach party members only; an explicit tap
// may still help a stranger. Without a party an adventurer's only ally is itself.
import { describe, expect, it } from 'vitest';
import { BUFF_BITS, type Loadout } from './abilities';
import { hurtAdventurer } from './adventurer';
import { BEDROCK_SHIELD } from './constants';
import { allied } from './effects';
import { Rig, camp } from './testRig';

// slots: snap_shot, pitch_arrow, charged_shot, field_dressing, sprint
const RANGER: Loadout = { job: 'ranger', picks: ['field_dressing', 'sprint'] };
// slots: slash, sunder, parry, rallying_roar, mend
const WARRIOR: Loadout = { job: 'warrior', picks: ['rallying_roar', 'mend'] };
// slots: shield_rap, bright_verdict, aegis, dawn_ward | shelter, kindle
const PALADIN: Loadout = { job: 'paladin', picks: ['dawn_ward', 'shelter'] };
// slots: tidelash, lantern_flare, wellspring, soft_rain | second_dawn, mistveil
const WHITE: Loadout = { job: 'white_mage', picks: ['soft_rain', 'second_dawn'] };
// slots: cinder_dart, skyfall_arc, hearthfall, kindred_spark, rootbreak
const BLACK: Loadout = { job: 'black_mage', picks: ['kindred_spark', 'rootbreak'] };
// slots: grim_rend, nightfall, crimson_pact, bloodbond, umbral_brand
const DARK: Loadout = { job: 'dark_knight', picks: ['bloodbond', 'umbral_brand'] };

const hp = (r: Rig, id: number) => r.c.get(id)!.hp;
const has = (r: Rig, id: number, buff: keyof typeof BUFF_BITS) => ((r.c.get(id)!.buffs ?? 0) & BUFF_BITS[buff]) !== 0;
const kill = (r: Rig, id: number) => hurtAdventurer(r.w, r.w.adventurers.get(id)!, 1000, 0, 'auto', r.now);

describe('the ally rule', () => {
  it('Field Dressing with no party heals self, never a hurt stranger 5 m away', () => {
    const r = new Rig([]);
    const me = r.add(0, 0, RANGER, 60), stranger = r.add(5, 0, RANGER, 30);
    expect(r.press(me, 3)).toBeNull();
    expect([hp(r, me), hp(r, stranger)]).toEqual([85, 30]);
    expect(r.fx('heal').map((h) => h.dst)).toEqual([me]);
  });

  it('Field Dressing with an explicit stranger id heals the stranger', () => {
    const r = new Rig([]);
    const me = r.add(0, 0, RANGER, 60), stranger = r.add(5, 0, RANGER, 30);
    expect(r.press(me, 3, stranger)).toBeNull();
    expect([hp(r, me), hp(r, stranger)]).toEqual([60, 55]);
  });

  it('in a party, Field Dressing auto-picks the lowest party member, not a lower stranger', () => {
    const r = new Rig([]);
    const me = r.add(0, 0, RANGER, 90), friend = r.add(4, 0, RANGER, 50), stranger = r.add(3, 0, RANGER, 20);
    r.party('p1', me, friend);
    expect(allied(r.w.adventurers.get(me)!, r.w.adventurers.get(friend)!)).toBe(true);
    expect(allied(r.w.adventurers.get(me)!, r.w.adventurers.get(stranger)!)).toBe(false);
    expect(r.press(me, 3)).toBeNull();
    expect([hp(r, me), hp(r, friend), hp(r, stranger)]).toEqual([90, 75, 20]);
  });

  it('Rallying Roar, Dawn Ward, Soft Rain and Aegis reach party members within range, never strangers', () => {
    // Roar (10 m), Dawn Ward (8 m), Soft Rain (10 m), Aegis's ally share (8 m)
    const cases: { load: Loadout; slot: number; check: (r: Rig, id: number) => boolean }[] = [
      { load: WARRIOR, slot: 3, check: (r, id) => has(r, id, 'roar') },
      { load: PALADIN, slot: 3, check: (r, id) => r.c.get(id)!.shield === 20 },
      { load: WHITE, slot: 3, check: (r, id) => has(r, id, 'rain') },
      { load: PALADIN, slot: 2, check: (r, id) => has(r, id, 'aegis_ally') },
    ];
    for (const { load, slot, check } of cases) {
      const r = new Rig([]);
      const me = r.add(0, 0, load), friend = r.add(3, 0), far = r.add(30, 0), stranger = r.add(0, 3);
      r.party('p1', me, friend, far);
      expect(r.press(me, slot)).toBeNull();
      expect([check(r, friend), check(r, far), check(r, stranger)], `${load.job} slot ${slot}`).toEqual([true, false, false]);
    }
  });

  it('Second Dawn auto-picks the nearest dead party member; an explicit dead stranger is revived', () => {
    const r = new Rig([]);
    const wm = r.add(0, 0, WHITE), friend = r.add(6, 0), stranger = r.add(3, 0);
    r.party('p1', wm, friend);
    kill(r, friend); kill(r, stranger);
    expect(r.press(wm, 4)).toBeNull(); // Second Dawn: cast 3 s
    expect(r.fx('cast').map((c) => c.dst)).toEqual([friend]);
    r.at(3.2);
    expect([r.c.get(friend)!.alive, r.c.get(stranger)!.alive]).toEqual([true, false]);
    r.ready(wm);
    expect(r.press(wm, 4, stranger)).toBeNull();
    r.at(6.5);
    expect(r.c.get(stranger)!.alive).toBe(true);
    // a lone white mage with only a dead stranger near: no-ally
    const s = new Rig([]);
    const lone = s.add(0, 0, WHITE), other = s.add(3, 0);
    kill(s, other);
    expect(s.press(lone, 4)).toBe('no-ally');
  });

  it('Shelter and Kindred Spark refuse no-ally with only strangers near, accept an explicit stranger', () => {
    for (const [load, slot] of [[{ job: 'paladin', picks: ['shelter', 'kindle'] } as Loadout, 3], [BLACK, 3]] as const) {
      const r = new Rig([]);
      const me = r.add(0, 0, load), stranger = r.add(3, 0);
      expect(r.press(me, slot), load.job).toBe('no-ally');
      expect(r.press(me, slot, stranger), load.job).toBeNull();
    }
    const r = new Rig([]);
    const pal = r.add(0, 0, { job: 'paladin', picks: ['shelter', 'kindle'] }), stranger = r.add(3, 0);
    expect(r.press(pal, 3, stranger)).toBeNull();
    expect(has(r, stranger, 'sheltered')).toBe(true);
  });

  it("Bloodbond and Lantern Flare's heal skip strangers", () => {
    const r = new Rig([camp('thornling', 0, 0)]);
    const e = r.enemy('thornling');
    const dk = r.add(0, -1.5, DARK), stranger = r.add(2, -2, undefined, 30);
    expect(r.i(dk, { t: 'target', id: e })).toBeNull();
    expect(r.press(dk, 3)).toBeNull(); // Bloodbond
    r.ready(dk);
    expect(r.press(dk, 0)).toBeNull(); // Grim Rend
    expect(r.fx('heal').filter((h) => h.dst === stranger)).toEqual([]);
    const friend = r.add(-2, -2, undefined, 30);
    r.party('p1', dk, friend);
    r.ready(dk);
    expect(r.press(dk, 0)).toBeNull();
    expect(r.fx('heal').filter((h) => h.dst === friend).length).toBe(1);
    expect(r.fx('heal').filter((h) => h.dst === stranger)).toEqual([]);

    const s = new Rig([camp('thornling', 0, 0)]);
    const te = s.enemy('thornling');
    const wm = s.add(0, -8, WHITE), lowStranger = s.add(1, -8, undefined, 20);
    expect(s.i(wm, { t: 'target', id: te })).toBeNull();
    s.ready(wm, 50);
    expect(s.press(wm, 1)).toBeNull(); // Lantern Flare: cast 1 s
    s.at(1.2);
    expect(s.fx('castEnd').map((c) => c.ok)).toEqual([true]);
    expect(s.fx('heal').filter((h) => h.dst === lowStranger)).toEqual([]);
  });

  it('steam and bedrock reach party members only', () => {
    {
      const r = new Rig([camp('thornling', 0, 0)]);
      const e = r.enemy('thornling'), en = r.w.enemies.get(e)!;
      const wm = r.add(0, -10, WHITE, 50), friend = r.add(0, -3, undefined, 50), stranger = r.add(3, 0, undefined, 50);
      r.party('p1', wm, friend);
      expect(r.i(wm, { t: 'target', id: e })).toBeNull();
      en.marks.burning = r.now + 8;
      en.burning = { src: friend, power: 10, nextAt: r.now + 1 };
      expect(r.press(wm, 0)).toBeNull(); // Tidelash
      expect(r.fx('react').map((x) => x.reaction)).toEqual(['steam']);
      expect(r.fx('heal').map((h) => h.dst)).toEqual([friend]);
      expect(hp(r, stranger)).toBe(50);
    }
    {
      const r = new Rig([camp('thornling', 0, 0)]);
      const e = r.enemy('thornling'), en = r.w.enemies.get(e)!;
      const bm = r.add(0, -10, BLACK), friend = r.add(0, -3), stranger = r.add(3, 0);
      r.party('p1', bm, friend);
      expect(r.i(bm, { t: 'target', id: e })).toBeNull();
      en.marks.dazed = r.now + 8;
      expect(r.press(bm, 4)).toBeNull(); // Rootbreak, cast 1 s
      r.until('react');
      expect(r.fx('shield').map((s) => [s.dst, s.amount])).toEqual([[friend, BEDROCK_SHIELD]]);
      expect(r.c.get(stranger)!.shield).toBe(0);
    }
  });

  it('setParty(null) makes a member a stranger at once', () => {
    const r = new Rig([]);
    const me = r.add(0, 0, RANGER, 90), friend = r.add(4, 0, RANGER, 50);
    r.party('p1', me, friend);
    r.c.setParty(friend, null);
    expect(r.press(me, 3)).toBeNull();
    expect([hp(r, me), hp(r, friend)]).toEqual([100, 50]);
    // parties are only what the room says: a junk party value is no party
    r.c.setParty(me, 7 as unknown as string);
    r.c.setParty(friend, 7 as unknown as string);
    expect(allied(r.w.adventurers.get(me)!, r.w.adventurers.get(friend)!)).toBe(false);
    // a revive keeps the party
    r.party('p2', me, friend);
    r.c.revive(friend, { x: 4, z: 0, y: 0 }, r.now);
    expect(r.w.adventurers.get(friend)!.party).toBe('p2');
  });
});
