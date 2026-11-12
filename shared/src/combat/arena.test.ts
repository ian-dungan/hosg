// Task 4 review round 1 (ruling P4-c, the other half): nothing crosses an awake arena boss's arena edge.
// An adventurer outside cannot target, strike, stagger, mark, interrupt or Break it, and no effect of
// one adventurer reaches another across the edge (heals, shields, buffs, revives, Shelter, steam,
// bedrock). And a boss in an arena leashes to its arena: a lunge near the wall neither carries it out
// nor resets the fight.
import { describe, expect, it } from 'vitest';
import type { Loadout } from './abilities';
import { damageEnemy, healAdventurer, killAdventurer, strikeFull } from './adventurer';
import { bossAiStateOf } from './bossAi';
import { applyBuff, applyShield, reviveAdventurer, targetFor } from './effects';
import { resolveHit } from './enemyAi';
import type { CampSpawn, EnemyState } from './engine';
import { Rig, camp } from './testRig';
import type { Stats } from './stats';

const BIG: Stats = { power: 10, defence: 10, maxHp: 100000 };
const WARRIOR: Loadout = { job: 'warrior', picks: ['rallying_roar', 'mend'] };
/** Inside: within 22 m of the camp and on the camp side of z = 2 (so "outside" can stand near the boss). */
const arena = (x: number, z: number) => Math.hypot(x, z) <= 22 && z <= 2;

function rig(kind: 'fallen_warden' | 'wickhound' = 'fallen_warden', a: CampSpawn['arena'] = arena) {
  const r = new Rig([{ ...camp(kind, 0, 0), arena: a }], { liveEnemies: true });
  const add = (x: number, z: number, hp = 100000) => {
    const id = r.c.addAdventurer({ x, z, y: 0, facing: 0, hp, loadout: WARRIOR, stats: BIG }, r.now);
    r.c.setParty(id, 'p');
    return r.w.adventurers.get(id)!;
  };
  const e = (): EnemyState => r.w.enemies.get(r.enemy(kind))!;
  return { r, add, e };
}
/** Wakes the boss with `inside` (on its table) and returns it. */
function awake(r: Rig, e: EnemyState, inside: number) {
  damageEnemy(r.w, inside, e, 1, 'auto', r.now);
  r.tick();
  expect(bossAiStateOf(e)!.wokeAt).not.toBeNull();
}

describe('the arena edge (Task 4 review round 1)', () => {
  it('from outside, the boss cannot be targeted, and a strike lands nothing: no hp, marks, stagger, Momentum or interrupt', () => {
    const { r, add, e } = rig();
    const inside = add(0, -3), out = add(0, 4);
    const boss = e();
    awake(r, boss, inside.id);
    expect(targetFor(r.w, out, boss.id, 100)).toBe('no-target');
    expect(targetFor(r.w, inside, boss.id, 100)).toBe(boss);
    // an interruptible wind-up in flight
    boss.windup = { attack: 'keepers_toll', startedAt: r.now, endsAt: r.now + 3, interruptible: true, telegraphId: null };
    const hp = boss.hp, stagger = boss.stagger.value;
    out.momentum = 0;
    const res = strikeFull(r.w, out, boss, { coef: 5, by: 'sunder', mark: 'marked', stagger: 500, interrupts: true, momentum: 20 }, r.now);
    expect(res).toEqual({ plain: 0, total: 0 });
    expect(boss.hp).toBe(hp);
    expect(boss.stagger.value).toBe(stagger);
    expect(boss.marks).toEqual({});
    expect(out.momentum).toBe(0);
    expect(boss.windup).not.toBeNull();
    expect(r.w.out.fx.some((f) => f.t === 'interrupt' || f.t === 'break' || f.t === 'mark')).toBe(false);
    // the same strike from inside does land
    strikeFull(r.w, inside, boss, { coef: 1, by: 'sunder', interrupts: true }, r.now);
    expect(boss.windup).toBeNull();
  });

  it('heals, shields, buffs and revives do not cross the edge of an awake arena boss (they do while it sleeps)', () => {
    const { r, add, e } = rig();
    const inside = add(0, -3, 50000), out = add(0, 4);
    // asleep: the edge means nothing yet
    expect(healAdventurer(r.w, inside, 10, out.id, r.now)).toBe(10);
    awake(r, e(), inside.id);
    expect(healAdventurer(r.w, inside, 10, out.id, r.now)).toBe(0);
    expect(healAdventurer(r.w, inside, 10, inside.id, r.now)).toBe(10); // self is never across
    expect(applyShield(r.w, out, inside, 30, 6, r.now)).toBe(false);
    applyBuff(r.w, out, inside, 'roar', 8, r.now);
    expect(inside.buffs.roar).toBeUndefined();
    const other = add(0, -5);
    killAdventurer(r.w, other, r.now);
    reviveAdventurer(r.w, out, other, 0.4, r.now);
    expect(other.alive).toBe(false);
    reviveAdventurer(r.w, inside, other, 0.4, r.now);
    expect(other.alive).toBe(true);
  });

  it('Shelter shares nothing across the edge', () => {
    const { r, add, e } = rig();
    const inside = add(0, -3), pal = add(0, 4);
    pal.job = 'paladin';
    awake(r, e(), inside.id);
    inside.buffs.sheltered = { until: r.now + 10, src: pal.id, startedAt: r.now };
    const before = pal.hp;
    resolveHit(r.w, e(), inside, 30, 'auto', false, null, r.now);
    expect(pal.hp).toBe(before);
    expect(r.w.out.fx.filter((f) => f.t === 'hit' && f.dst === pal.id)).toEqual([]);
    // the same Paladin inside takes its share
    pal.z = -4;
    resolveHit(r.w, e(), inside, 30, 'auto', false, null, r.now);
    expect(pal.hp).toBeLessThan(before);
  });

  it('steam and bedrock reach only allies on the hitter\'s side of the edge', () => {
    for (const reaction of ['steam', 'bedrock'] as const) {
      const { r, add, e } = rig();
      const hitter = add(0, -3), near = add(-2, -2, 50000), out = add(0, 4, 50000);
      const boss = e();
      awake(r, boss, hitter.id);
      boss.marks = reaction === 'steam' ? { burning: r.now + 10 } : { dazed: r.now + 10 };
      strikeFull(r.w, hitter, boss, { coef: 1, by: 'tidelash', element: reaction === 'steam' ? 'water' : 'earth' }, r.now);
      const fxs = r.w.out.fx;
      expect(fxs.some((f) => f.t === 'react' && f.reaction === reaction)).toBe(true);
      const kind = reaction === 'steam' ? 'heal' : 'shield';
      expect(fxs.some((f) => f.t === kind && f.dst === near.id)).toBe(true);
      expect(fxs.some((f) => f.t === kind && f.dst === out.id)).toBe(false);
    }
  });

  it('an outsider leaves the threat table even while an entry is in flight', () => {
    const { r, add, e } = rig();
    const inside = add(0, -3), b = add(0, -6);
    const boss = e();
    awake(r, boss, inside.id);
    damageEnemy(r.w, b.id, boss, 1, 'auto', r.now);
    expect(boss.threat.has(b.id)).toBe(true);
    const s = bossAiStateOf(boss)!;
    s.next = 3; s.nextAt = r.now; // Keeper's Toll next
    for (let n = 0; n < 30 && s.busy === null; n++) r.tick();
    expect(s.busy).toBe('keepers_toll');
    r.c.setPose(b.id, 0, 6, 0, 0);
    r.tick();
    expect(s.busy).toBe('keepers_toll');
    expect(boss.threat.has(b.id)).toBe(false);
  });

  it('the Wickhound, tanked at (0, 13) by the den wall, never lunges out of its arena nor resets', () => {
    const den = (x: number, z: number) => Math.hypot(x, z) <= 16;
    const { r, add, e } = rig('wickhound', den);
    const tank = add(0, 13);
    const hound = e();
    damageEnemy(r.w, tank.id, hound, 1, 'auto', r.now);
    let lunges = 0;
    for (let k = 0; k < 15 * 60; k++) {
      r.c.setPose(tank.id, 0, 13, 0, 0);
      const out = r.tick();
      lunges += out.fx.filter((f) => f.t === 'hit' && f.by === 'wick_lunge').length;
      expect(out.boss.filter((b) => b.event === 'reset')).toEqual([]);
      expect(Math.hypot(hound.x, hound.z) + hound.data.radius).toBeLessThanOrEqual(16 + 1e-9);
      expect(hound.act).not.toBe('return');
    }
    expect(lunges).toBeGreaterThan(0);
  });
});
