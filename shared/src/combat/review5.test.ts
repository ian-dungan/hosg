// Task 5 review round 1: the engine rulings and fixes behind the retuned Warden. Shelter's share takes the
// Paladin's own Searing only (P4-g); the blast splash skips an arena enemy the hitter stands outside of; an orphan
// Soft Rain stops inside an awake arena.
import { describe, expect, it } from 'vitest';
import type { Loadout } from './abilities';
import { applyStagger, damageEnemy, strikeFull } from './adventurer';
import { bossAiStateOf } from './bossAi';
import { BOSS_SURGE_AFTER_S } from './enemyAi';
import { STEADFAST_TAKEN, TOLL_STAGGER_MULT } from './constants';
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

  it('P4-k: a Warden winding up Keeper\'s Toll takes TOLL_STAGGER_MULT × stagger', () => {
    const { r, add } = rig([camp('fallen_warden', 0, 0)]);
    const e = r.w.enemies.get(r.enemy('fallen_warden'))!;
    const a = add(0, -3);
    damageEnemy(r.w, a.id, e, 1, 'auto', r.now);
    r.tick();
    const s0 = e.stagger.value;
    applyStagger(r.w, e, 10, r.now);
    expect(e.stagger.value - s0).toBeCloseTo(10, 9);
    e.windup = { attack: 'keepers_toll', startedAt: r.now, endsAt: r.now + 4, interruptible: true, telegraphId: null };
    const s1 = e.stagger.value;
    applyStagger(r.w, e, 10, r.now);
    expect(e.stagger.value - s1).toBeCloseTo(10 * TOLL_STAGGER_MULT, 9);
  });

  it('P4-l: an arena boss nobody stands in melee reach of surges after BOSS_SURGE_AFTER_S and starts no telegraph meanwhile', () => {
    const arena = (x: number, z: number) => Math.hypot(x, z) <= 22;
    const { r, add } = rig([{ ...camp('fallen_warden', 0, 0), arena }]);
    const e = r.w.enemies.get(r.enemy('fallen_warden'))!;
    const a = add(0, -9);
    damageEnemy(r.w, a.id, e, 1, 'auto', r.now);
    let surgedAt: number | null = null, telegraphsWhileSurging = 0;
    for (let k = 0; k < 15 * 12; k++) {
      // always 9 m away (never in its reach), running around the arena
      const ang = k / 30, x = e.x + Math.sin(ang) * 9, z = e.z + Math.cos(ang) * 9;
      const d = Math.hypot(x, z), f = d > 20 ? 20 / d : 1;
      r.c.setPose(a.id, x * f, z * f, 0, 0);
      const n = r.w.telegraphs.size;
      r.tick();
      if (surgedAt !== null && r.w.telegraphs.size > n) telegraphsWhileSurging++;
      if (surgedAt === null && e.surging) surgedAt = r.now;
    }
    expect(bossAiStateOf(e)!.wokeAt).not.toBeNull();
    expect(surgedAt).not.toBeNull();
    expect(surgedAt!).toBeGreaterThanOrEqual(BOSS_SURGE_AFTER_S - 0.2);
    expect(telegraphsWhileSurging).toBe(0);
  });
});
