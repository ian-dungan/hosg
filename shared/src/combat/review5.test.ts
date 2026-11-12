// Task 5 review round 1: the engine rulings and fixes behind the retuned Warden. Shelter's share takes the
// Paladin's own Searing only (P4-g); the blast splash skips an arena enemy the hitter stands outside of; an orphan
// Soft Rain stops inside an awake arena.
import { describe, expect, it } from 'vitest';
import type { Loadout } from './abilities';
import { damageEnemy, strikeFull } from './adventurer';
import { STEADFAST_TAKEN } from './constants';
import { applyAffliction, searingMult } from './effects';
import { resolveHit } from './enemyAi';
import type { CampSpawn, EnemyState } from './engine';
import { enemyHit, type Stats } from './stats';
import { Rig, camp } from './testRig';

const BIG: Stats = { power: 10, defence: 10, maxHp: 100000 };
const WARRIOR: Loadout = { job: 'warrior', picks: ['rallying_roar', 'mend'] };

function rig(camps: CampSpawn[]) {
  const r = new Rig(camps, { liveEnemies: true });
  const add = (x: number, z: number) => {
    const id = r.c.addAdventurer({ x, z, y: 0, facing: 0, hp: BIG.maxHp, loadout: WARRIOR, stats: BIG }, r.now);
    r.c.setParty(id, 'p');
    return r.w.adventurers.get(id)!;
  };
  return { r, add };
}
const sear = (r: Rig, a: ReturnType<ReturnType<typeof rig>['add']>, e: EnemyState, n: number) => { for (let k = 0; k < n; k++) applyAffliction(r.w, a, 'searing', e.id, r.now); };

describe('Task 5 review round 1', () => {
  it("Shelter's share carries the Paladin's own Searing, never the sheltered one's as well", () => {
    for (const palStacks of [0, 5]) {
      const { r, add } = rig([camp('fallen_warden', 0, 0)]);
      const e = r.w.enemies.get(r.enemy('fallen_warden'))!;
      const a = add(0, -3), pal = add(1, -3);
      pal.job = 'paladin';
      a.buffs.sheltered = { until: r.now + 10, src: pal.id, startedAt: r.now };
      sear(r, a, e, 5); sear(r, pal, e, palStacks);
      const before = pal.hp;
      resolveHit(r.w, e, a, 40, 'lamp_sweep', false, null, r.now);
      const final = enemyHit(40, BIG.defence, searingMult(a, r.now));
      const moved = Math.floor(final * 0.5);
      expect(before - pal.hp).toBe(Math.round((moved / searingMult(a, r.now)) * STEADFAST_TAKEN * searingMult(pal, r.now)));
    }
  });

  it('the blast splash skips an arena enemy the hitter stands outside of', () => {
    const arena = (_x: number, z: number) => z <= 2;
    const { r, add } = rig([camp('thornling', 0, 3), { ...camp('lens_shard', 1, 2), arena }]);
    const t = r.w.enemies.get(r.enemy('thornling'))!, shard = r.w.enemies.get(r.enemy('lens_shard'))!;
    const a = add(0, 6);
    t.marks = { marked: r.now + 10 };
    const hp = shard.hp;
    strikeFull(r.w, a, t, { coef: 1, by: 'cinder_dart', element: 'fire' }, r.now);
    expect(r.w.out.fx.some((f) => f.t === 'react' && f.reaction === 'blast')).toBe(true);
    expect(shard.hp).toBe(hp);
  });

  it('an orphan Soft Rain (its caster gone) stops inside an awake arena', () => {
    const arena = (x: number, z: number) => Math.hypot(x, z) <= 22;
    const { r, add } = rig([{ ...camp('fallen_warden', 0, 0), arena }]);
    const e = r.w.enemies.get(r.enemy('fallen_warden'))!;
    const a = add(0, -3);
    damageEnemy(r.w, a.id, e, 1, 'auto', r.now);
    r.tick();
    a.hp = 50000;
    a.buffs.rain = { until: r.now + 6, src: 9999, startedAt: r.now };
    r.at(r.now + 2.1);
    expect(r.fx('heal').filter((h) => h.dst === a.id).length).toBe(0);
    expect(a.buffs.rain === undefined || a.buffs.rain.until <= r.now).toBe(true);
  });
});
