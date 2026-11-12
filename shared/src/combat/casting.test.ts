import { describe, expect, it } from 'vitest';
import type { Loadout } from './abilities';
import { hurtAdventurer, killEnemy, knockAdventurer } from './adventurer';
import { CAST_BREAK_LOCK_S, SPEED_GRACE_S } from './constants';
import type { Intent } from './engine';
import { Rig, camp } from './testRig';

const BLACK: Loadout = { job: 'black_mage', picks: ['rootbreak', 'bastion_stone'] };
const WHITE: Loadout = { job: 'white_mage', picks: ['second_dawn', 'soft_rain'] };
/** A Black Mage at (x, z) targeting a Thornling at the origin, with `momentum` that does not decay. */
function mage(momentum = 0, x = 0, z = -10.5) {
  const r = new Rig([camp('thornling', 0, 0)]);
  const e = r.enemy('thornling');
  const a = r.add(x, z, BLACK);
  Object.assign(r.w.adventurers.get(a)!, { momentum, lastDealtAt: 1e9 });
  r.i(a, { t: 'target', id: e });
  return { r, e, a };
}
const castEnds = (r: Rig) => r.fx('castEnd').map((c) => [c.ability, c.ok, c.reason]);

describe('casting', () => {
  it('Skyfall Arc: GCD at start, cost and cooldown at completion after 1.2 s, castEnd ok', () => {
    const { r, e, a } = mage();
    r.tick(); r.tick(); // the first auto at 0 (+10)
    r.w.adventurers.get(a)!.momentum = 60;
    const t0 = r.now;
    expect(r.press(a, 1)).toBeNull();
    let s = r.c.self(a)!;
    expect(s.gcd).toBeCloseTo(0.5, 6);
    expect(s.momentum).toBe(60);
    expect(s.cd[1]).toBe(0);
    expect(s.cast).toEqual({ ability: 'skyfall_arc', total: 1.2, left: 1.2 });
    expect(r.c.get(a)!.act).toBe('cast');
    expect(r.c.get(a)!.cast).toEqual({ ability: 'skyfall_arc', total: 1.2, left: 1.2 });
    expect(r.fx('cast').map((c) => [c.src, c.ability, c.dst, c.total])).toEqual([[a, 'skyfall_arc', e, 1.2]]);
    r.at(t0 + 1.1);
    expect(r.hits(a).filter((h) => h.by === 'skyfall_arc')).toEqual([]);
    expect(r.c.self(a)!.momentum).toBe(60);
    r.at(t0 + 1.3);
    const hit = r.hits(a).find((h) => h.by === 'skyfall_arc')!;
    expect(hit.at).toBeCloseTo(t0 + 1.2, 3);
    expect(hit.amount).toBe(35); // round(4.0 · 10 · 0.870)
    s = r.c.self(a)!;
    expect(s.momentum).toBe(10);
    expect(s.cd[1]).toBeGreaterThan(5.8);
    expect(s.cast).toBeNull();
    expect(r.c.get(a)!.act).toBe('');
    expect(castEnds(r)).toEqual([['skyfall_arc', true, undefined]]);
    expect(r.fx('use').map((u) => [u.ability, u.dst])).toEqual([['skyfall_arc', e]]);
  });

  it('autos pause while casting', () => {
    const { r, a } = mage();
    r.tick(); // the auto at 0
    expect(r.press(a, 2)).toBeNull(); // Hearthfall, 2.5 s, from 1/15
    r.at(4);
    const hits = r.hits(a).map((h) => [Math.round(h.at * 15), h.by]);
    // autos at 0; none at 1.6 (casting); Hearthfall at 39/15 and the auto on the same tick; then 1.6 s later
    expect(hits).toEqual([[0, 'auto'], [39, 'hearthfall'], [39, 'auto']]);
  });

  it('speedScale is 0.5 from 0.25 s into a cast and 1 after SPEED_GRACE_S', () => {
    const { r, a } = mage();
    expect(r.press(a, 2)).toBeNull(); // at 0, ends at 2.5
    expect(r.c.speedScale(a, 0)).toBe(1);
    expect(r.c.speedScale(a, 0.2)).toBe(1);
    expect(r.c.speedScale(a, 0.25)).toBe(0.5);
    expect(r.c.speedScale(a, 2.4)).toBe(0.5);
    r.at(2.6);
    expect(r.c.self(a)!.cast).toBeNull();
    // the slow never outlasts the cast (an honest client speeds up at castEnd), so it is 1 at once
    expect(r.c.speedScale(a, 2.6)).toBe(1);
    expect(r.c.speedScale(a, 2.5 + SPEED_GRACE_S + 0.01)).toBe(1);
  });

  it('pressing during a cast → busy; release → invalid', () => {
    const { r, a } = mage(60);
    expect(r.press(a, 2)).toBeNull();
    r.at(1);
    for (const slot of [0, 1, 2, 3, 4]) expect(r.press(a, slot)).toBe('busy');
    expect(r.release(a, 2)).toBe('invalid');
    expect(r.i(a, { t: 'loadout', picks: ['stormcage', 'kindred_spark'] })).toBe('busy');
    expect(r.i(a, { t: 'target', id: null })).toBeNull(); // accepted, and the cast keeps its target
    r.at(3);
    expect(castEnds(r)).toEqual([['hearthfall', true, undefined]]);
    expect(r.hits(a).filter((h) => h.by === 'hearthfall').length).toBe(1);
  });

  it('target dies mid-cast → fizzle: no cost, no cooldown', () => {
    const { r, e, a } = mage(60);
    expect(r.press(a, 1)).toBeNull();
    r.at(0.5);
    killEnemy(r.w, r.w.enemies.get(e)!, r.now);
    r.at(1.5);
    expect(castEnds(r)).toEqual([['skyfall_arc', false, 'fizzle']]);
    const s = r.c.self(a)!;
    expect([s.momentum, s.cd[1], s.cast]).toEqual([60, 0, null]);
    expect(r.fx('use')).toEqual([]);
  });

  it('walking 3.1 m beyond range+fuzz → fizzle; 1.9 m beyond → lands (CAST_RANGE_SLACK)', () => {
    for (const [beyond, ok] of [[3.1, false], [1.9, true]] as const) {
      const { r, a } = mage(60, 0, -18.5); // reach 18
      expect(r.press(a, 1)).toBeNull();
      r.at(0.6);
      r.move(a, 0, -(18 + 1 + beyond + 0.5));
      r.at(1.5);
      expect(castEnds(r)).toEqual([['skyfall_arc', ok, ok ? undefined : 'fizzle']]);
      expect(r.c.self(a)!.momentum).toBe(ok ? 10 : 60);
    }
  });

  it('a wall between at completion → fizzle', () => {
    const r = new Rig([camp('thornling', 0, 0)], { walls: [{ x: 5, z: -5, r: 1.5 }] });
    const e = r.enemy('thornling');
    const a = r.add(0, -10, BLACK);
    r.i(a, { t: 'target', id: e });
    expect(r.press(a, 2)).toBeNull();
    r.at(1);
    r.move(a, 10, -10);
    r.at(3);
    expect(castEnds(r)).toEqual([['hearthfall', false, 'fizzle']]);
    expect(r.c.self(a)!.cd[2]).toBe(0);
  });

  it('own dodge cancels with no cooldown', () => {
    const { r, a } = mage(60);
    expect(r.press(a, 1)).toBeNull();
    r.at(0.6);
    const v = r.c.get(a)!;
    const d: Intent = { t: 'dodge', dx: 1, dz: 0, from: { x: v.x, z: v.z, y: v.y }, grounded: true };
    expect(r.i(a, d)).toBeNull();
    expect(castEnds(r)).toEqual([['skyfall_arc', false, 'dodge']]);
    const s = r.c.self(a)!;
    expect([s.momentum, s.cd[1], s.cast]).toEqual([60, 0, null]);
    r.at(2);
    expect(r.hits(a).filter((h) => h.by === 'skyfall_arc')).toEqual([]);
  });

  it('knock interrupts: CAST_BREAK_LOCK_S cooldown, Momentum unspent', () => {
    const { r, a } = mage(60);
    expect(r.press(a, 1)).toBeNull();
    r.at(0.6);
    expect(knockAdventurer(r.w, r.w.adventurers.get(a)!, { vx: 0, vz: -10, vy: 4, seconds: 0.35 }, r.now)).not.toBeNull();
    expect(castEnds(r)).toEqual([['skyfall_arc', false, 'interrupt']]);
    const s = r.c.self(a)!;
    expect(s.momentum).toBe(60);
    expect(r.w.adventurers.get(a)!.readyAt.skyfall_arc).toBeCloseTo(r.now + CAST_BREAK_LOCK_S, 6);
    expect(s.cast).toBeNull();
  });

  it('death cancels', () => {
    const { r, a } = mage(60);
    expect(r.press(a, 1)).toBeNull();
    r.at(0.6);
    hurtAdventurer(r.w, r.w.adventurers.get(a)!, 1000, 0, 'auto', r.now);
    expect(castEnds(r)).toEqual([['skyfall_arc', false, 'cancel']]);
    expect(r.c.self(a)!.cast).toBeNull();
    expect(r.c.get(a)!.act).toBe('dead');
    r.at(2);
    expect(r.hits(a)).toEqual([]);
  });

  it('Second Dawn (3 s) on a dead ally revives at 40%', () => {
    const r = new Rig([]);
    const wm = r.add(0, 0, WHITE), b = r.add(0, 8);
    hurtAdventurer(r.w, r.w.adventurers.get(b)!, 1000, 0, 'auto', r.now);
    expect(r.press(wm, 3)).toBeNull();
    r.at(2.9);
    expect(r.c.get(b)!.alive).toBe(false);
    r.at(3.1);
    expect(r.c.get(b)).toMatchObject({ alive: true, hp: 40 });
    expect(castEnds(r)).toEqual([['second_dawn', true, undefined]]);
    expect(r.c.self(wm)!.cd[3]).toBeGreaterThan(59);
    // already up (or gone): the next one fizzles at completion
    const r2 = new Rig([]);
    const wm2 = r2.add(0, 0, WHITE), c = r2.add(0, 8);
    hurtAdventurer(r2.w, r2.w.adventurers.get(c)!, 1000, 0, 'auto', r2.now);
    expect(r2.press(wm2, 3)).toBeNull();
    r2.at(1);
    r2.c.removeAdventurer(c);
    r2.at(3.5);
    expect(castEnds(r2)).toEqual([['second_dawn', false, 'fizzle']]);
    expect(r2.c.self(wm2)!.cd[3]).toBe(0);
  });

  it('determinism: two engines, same intents, identical TickOut streams over 60 s with casts', () => {
    const run = () => {
      const r = new Rig([camp('thornling', 0, 0), camp('boar', 6, 0)], { liveEnemies: true, seed: 7 });
      const t = r.enemy('thornling');
      const bm = r.add(0, -12, BLACK), wm = r.add(3, -12, WHITE), wa = r.add(-2, -3, { job: 'warrior', picks: ['rallying_roar', 'skullringer'] });
      for (const id of [bm, wm, wa]) r.i(id, { t: 'target', id: t });
      while (r.now < 60) {
        for (const id of [bm, wm, wa]) for (let slot = 4; slot >= 0; slot--) if (r.press(id, slot, wa) === null) break;
        r.tick();
      }
      return JSON.stringify(r.outs);
    };
    const a = run();
    expect(a).toEqual(run());
    expect(a).toContain('"castEnd"');
  });
});
