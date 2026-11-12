import { describe, expect, it } from 'vitest';
import { JOB_IDS, JOBS, type JobId } from './jobs';
import { kitFor } from '../kit';
import type { Kit } from '../mods';
import { STARTER_STATS, hitDamage } from './stats';
import { ENEMY_KINDS } from './enemies';
import { BURNING_COEF_PER_S } from './constants';
import { RAIN_HEAL } from './effects';
import { damageEnemy, hurtAdventurer } from './adventurer';
import { resolveHit } from './enemyAi';
import { applyShield } from './effects';
import { knockForGuard } from './displace';
import { ABILITIES } from './abilities';
import { Rig, camp } from './testRig';
import { ENEMY, addKitted, picksWith, use } from './kitRig';
import type { TickOut } from './engine';

const DEF = ENEMY_KINDS[ENEMY].defence;
const withStats = (more: Partial<Kit['stats']>): Kit => ({ stats: { ...STARTER_STATS, ...more }, mods: [] });

describe('kits', () => {
  it('setKit raises max hp keeping the fraction, keeps cooldowns and Momentum, and clamps a shield', () => {
    const r = new Rig([camp(ENEMY, 0, 0)]);
    const e = r.enemy(ENEMY);
    const a = addKitted(r, 'warrior', picksWith('warrior'), null, 0, -1.8, 50);
    use(r, a, 'slash', e);
    const s = r.w.adventurers.get(a)!;
    s.momentum = 37;
    const cd = r.c.self(a)!.cd[0];
    applyShield(r.w, s, s, 1e6, 6, r.now);
    r.c.setKit(a, { stats: { power: 13, defence: 14, maxHp: 130 }, mods: [] }, 7);
    const v = r.c.get(a)!;
    expect([v.maxHp, v.hp]).toEqual([130, 65]);
    expect(v.level).toBe(7);
    expect(r.c.self(a)!.cd[0]).toBe(cd);
    expect(r.c.self(a)!.momentum).toBe(37);
    expect(v.shield).toBeLessThan(1e6);
    expect(v.shield).toBeGreaterThan(0);
    // rounded, at least 1 while alive; the dead stay dead
    s.hp = 0.2;
    r.c.setKit(a, { stats: { power: 10, defence: 10, maxHp: 100 }, mods: [] });
    expect(r.c.get(a)!.hp).toBe(1);
    hurtAdventurer(r.w, s, 1e6, e, 'auto', r.now);
    r.c.setKit(a, { stats: { power: 20, defence: 24, maxHp: 180 }, mods: [] });
    expect([r.c.get(a)!.alive, r.c.get(a)!.hp]).toEqual([false, 0]);
    // a kit's extra dodge charge refills toward the new maximum; the kit wins over stats on add
    const b = addKitted(r, 'ninja', picksWith('ninja'), null, 3, 0);
    r.c.setKit(b, { stats: STARTER_STATS, mods: [{ k: 'dodge', charges: 1 }] });
    expect(r.c.self(b)).toMatchObject({ dodgeMax: 4, dodgeCharges: 3 });
    r.at(r.now + 5.1);
    expect(r.c.self(b)!.dodgeCharges).toBe(4);
    const c = r.c.addAdventurer({ x: 5, z: 0, y: 0, facing: 0, hp: 500, loadout: { job: 'warrior', picks: ['mend', 'bulwark'] }, stats: { power: 1, defence: 1, maxHp: 50 }, kit: { stats: { power: 20, defence: 24, maxHp: 180 }, mods: [] } }, r.now);
    expect([r.c.get(c)!.maxHp, r.c.get(c)!.hp]).toEqual([180, 180]);
    // forged mods are parsed again: out of range ones are dropped
    r.c.setKit(c, { stats: STARTER_STATS, mods: [{ k: 'cd', ability: 'slash', add: -1e9 } as never, { k: 'dodge', charges: 99 } as never] });
    expect(r.w.adventurers.get(c)!.modIndex.empty).toBe(true);
    expect('level' in r.c.get(b)!).toBe(false);
  });

  it('Focus scales ability damage, heals and shields, not autos, Burning, reactions or Rain ticks', () => {
    const run = (job: JobId, ab: Parameters<typeof use>[2], focus: number, o: { mark?: 'marked' | 'burning'; hp?: number } = {}) => {
      const r = new Rig([camp(ENEMY, 0, 0)]);
      const e = r.enemy(ENEMY);
      const a = addKitted(r, job, picksWith(job, ab), withStats({ focus }), 0, -1.8, o.hp);
      if (o.mark) r.w.enemies.get(e)!.marks[o.mark] = r.now + 20;
      use(r, a, ab, e, { momentum: 100 });
      return { r, a, e };
    };
    // ability damage × 1.2 (the coef)
    const slash = (f: number) => run('warrior', 'slash', f).r.hits().filter((h) => h.by === 'slash')[0].amount;
    expect(slash(20)).toBe(hitDamage(1.8 * 1.2, 10, DEF));
    expect(slash(0)).toBe(hitDamage(1.8, 10, DEF));
    // the cap: 40
    expect(slash(90)).toBe(hitDamage(1.8 * 1.4, 10, DEF));
    // heals and shields
    expect(run('warrior', 'mend', 20, { hp: 10 }).r.fx('heal')[0].amount).toBe(36);
    expect(run('warrior', 'bulwark', 20).r.fx('shield')[0].amount).toBe(30);
    // autos: the auto that follows is unchanged
    const auto = (f: number) => run('warrior', 'slash', f).r.hits().filter((h) => h.by === 'auto')[0]?.amount;
    expect(auto(40)).toBe(auto(0));
    // Burning ticks: Pitch Arrow's Burning burns at the plain rate
    const burn = (f: number) => {
      const { r } = run('ranger', 'pitch_arrow', f);
      r.at(r.now + 1.2);
      return r.hits().filter((h) => h.by === 'burning').map((h) => h.amount);
    };
    expect(burn(40)).toEqual(burn(0));
    expect(burn(0)[0]).toBe(hitDamage(BURNING_COEF_PER_S, 10, DEF));
    // a reaction's extra is not scaled: Cinder Dart on Marked = its scaled hit + the plain blast
    const blast = (f: number) => run('black_mage', 'cinder_dart', f, { mark: 'marked' }).r.hits().filter((h) => h.by === 'cinder_dart')[0].amount;
    const plain0 = run('black_mage', 'cinder_dart', 0).r.hits().filter((h) => h.by === 'cinder_dart')[0].amount;
    const plain40 = run('black_mage', 'cinder_dart', 40).r.hits().filter((h) => h.by === 'cinder_dart')[0].amount;
    expect(blast(40) - plain40).toBe(blast(0) - plain0);
    expect(plain40).toBeGreaterThan(plain0);
    // Soft Rain ticks: RAIN_HEAL each, whatever the Focus
    const rain = (f: number) => {
      const { r } = run('white_mage', 'soft_rain', f, { hp: 20 });
      r.at(r.now + 2.1);
      return r.fx('heal').map((h) => h.amount);
    };
    expect(rain(40)).toEqual(rain(0));
    expect(rain(40)[0]).toBe(RAIN_HEAL);
  });

  it('Flow scales every positive Momentum gain, floored; spending is unchanged', () => {
    const r = new Rig([camp(ENEMY, 0, 0)]);
    const e = r.enemy(ENEMY);
    const a = addKitted(r, 'warrior', picksWith('warrior'), withStats({ flow: 25 }), 0, -1.8);
    const s = r.w.adventurers.get(a)!;
    use(r, a, 'slash', e, { momentum: 0, finish: false });
    expect(s.momentum).toBe(25); // 20 × 1.25
    s.momentum = 0;
    // autos: Battle Rhythm's 15 each → floor(18.75)
    r.ready(a); r.at(r.now + 3);
    const autos = r.hits(a).filter((h) => h.by === 'auto').length;
    expect(autos).toBeGreaterThan(0);
    expect(s.momentum).toBe(18 * autos);
    // spending: a finisher costs exactly 50
    s.momentum = 77;
    expect(use(r, a, 'sunder', e, { momentum: 77, finish: false })).toBeNull();
    expect(s.momentum).toBe(27);
    // a gift received goes through the receiver's Flow
    const bm = addKitted(r, 'black_mage', picksWith('black_mage', 'kindred_spark'), null, 3, -3);
    const ally = addKitted(r, 'warrior', ['mend', 'bulwark'], withStats({ flow: 10 }), 3, -2);
    use(r, bm, 'kindred_spark', e, { ally, momentum: 0, finish: false });
    expect(r.w.adventurers.get(ally)!.momentum).toBe(40); // floor(37 × 1.1)
    expect(r.w.adventurers.get(bm)!.momentum).toBe(10);
    // a perfect dodge (10 → 12) and a parry (20 → 25), floored
    const p = addKitted(r, 'paladin', picksWith('paladin'), withStats({ flow: 25 }), -3, -1.8);
    const ps = r.w.adventurers.get(p)!;
    ps.iframeUntil = r.now + 1;
    resolveHit(r.w, r.w.enemies.get(e)!, ps, 10, 'thorn_burst', false, null, r.now, { kind: 'circle', x: ps.x, z: ps.z, r: 3 });
    expect(ps.momentum).toBe(12);
  });

  it('Guard raises threat and cuts knockback speed, capped at 50%', () => {
    const threat = (guard: number) => {
      const r = new Rig([camp(ENEMY, 0, 0)]);
      const e = r.w.enemies.get(r.enemy(ENEMY))!;
      const a = addKitted(r, 'paladin', picksWith('paladin'), withStats({ guard }), 0, -1.8);
      damageEnemy(r.w, a, e, 50, 'auto', r.now);
      return e.threat.get(a)!;
    };
    // Steadfast's threatMult, then × (1 + guard/100)
    expect(threat(30) / threat(0)).toBeCloseTo(1.3, 9);
    const k = { speed: 10, seconds: 0.3, vy: 2 };
    expect(knockForGuard(k, 30)).toEqual({ speed: 7, seconds: 0.3, vy: 2 });
    expect(knockForGuard(k, 80).speed).toBe(5);
    expect(knockForGuard(k, 0)).toBe(k);
    expect(knockForGuard(k, undefined)).toBe(k);
    // in the engine: a knocked adventurer with Guard 40 flies 60% as fast
    const knocked = (guard: number) => {
      const r = new Rig([camp(ENEMY, 0, 0)]);
      const e = r.w.enemies.get(r.enemy(ENEMY))!;
      const a = addKitted(r, 'paladin', picksWith('paladin'), withStats({ guard }), 0, -3);
      resolveHit(r.w, e, r.w.adventurers.get(a)!, 5, 'auto', false, { speed: 8, seconds: 0.4, vy: 0 }, r.now);
      return r.w.out.displaced[0].d;
    };
    expect(knocked(40).vz).toBeCloseTo(knocked(0).vz * 0.6, 9);
  });

  it('P1 in the engine: addAdventurer with kitFor(level 10, starter) gives the same TickOut stream as with no kit over 120 s of a Mossback fight', () => {
    for (const job of JOB_IDS) {
      const stream = (withKit: boolean) => {
        const r = new Rig([camp(ENEMY, 0, 0)], { liveEnemies: true, seed: 7 });
        const e = r.enemy(ENEMY);
        const kit = kitFor({ job, level: 10, gear: {}, talents: [] });
        const a = r.c.addAdventurer({ x: 0, z: -3, y: 0, facing: 0, hp: 100, loadout: { job, picks: [JOBS[job].picks.solo[0], JOBS[job].picks.solo[1]] }, ...(withKit ? { kit } : {}) }, 0);
        r.i(a, { t: 'target', id: e });
        const outs: TickOut[] = [];
        for (let k = 0; k < 120 * 15; k++) {
          // a scripted player: presses a slot each tick in turn, dodges every 3 s, moves in
          const v = r.c.get(a)!;
          if (!v.alive) break;
          if (k % 45 === 0) r.i(a, { t: 'dodge', dx: 1, dz: 0, from: { x: v.x, z: v.z, y: v.y }, grounded: true });
          r.press(a, k % 5, a);
          if (ABILITIES[r.c.self(a)!.slots[k % 5]].effects.some((x) => x.k === 'charge')) r.release(a, k % 5);
          const ev = r.c.get(e)!;
          if (Math.hypot(ev.x - v.x, ev.z - v.z) > 3) r.move(a, v.x + (ev.x - v.x) * 0.05, v.z + (ev.z - v.z) * 0.05);
          r.i(a, { t: 'target', id: e });
          outs.push(r.tick());
        }
        return JSON.stringify(outs);
      };
      const plain = stream(false);
      expect(stream(true), job).toBe(plain);
      expect(plain.length).toBeGreaterThan(10_000);
    }
  });
});
