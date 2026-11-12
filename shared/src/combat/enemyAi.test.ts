import { describe, expect, it } from 'vitest';
import { createCombat, worldOf, type CampSpawn, type Combat, type CombatZone, type EnemyState, type Intent, type TickOut } from './engine';
import { DEFAULT_LOADOUT, type Loadout } from './abilities';
import type { EnemyKindId } from './enemies';
import type { FxEvent } from './fx';
import { enemyAiStats, enemyPassable, NO_TARGET_S } from './enemyAi';
import { UNREACHABLE_S } from './constants';

// ───────── a synthetic zone: rects that are walls, hedges (no ground, see-through) or platforms ─────────
interface Rect { x0: number; x1: number; z0: number; z1: number }
interface Scene { walls?: Rect[]; hedges?: Rect[]; platforms?: (Rect & { h: number })[]; half?: number }
const inR = (r: Rect, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
function zone(camps: CampSpawn[], s: Scene = {}): CombatZone {
  const half = s.half ?? 50;
  const out = (x: number, z: number) => Math.abs(x) > half || Math.abs(z) > half;
  const wall = (x: number, z: number) => (s.walls ?? []).some((r) => inR(r, x, z));
  const hedge = (x: number, z: number) => (s.hedges ?? []).some((r) => inR(r, x, z));
  const plat = (x: number, z: number) => (s.platforms ?? []).find((r) => inR(r, x, z));
  return {
    surface: (x, z) => (out(x, z) || wall(x, z) || hedge(x, z) ? null : plat(x, z)?.h ?? 0),
    ground: (x, z) => (out(x, z) || wall(x, z) || hedge(x, z) || plat(x, z) ? null : 0),
    sight: (x, z) => !wall(x, z),
    camps,
  };
}
const camp = (kind: EnemyKindId, x = 0, z = 0, facing = 0): CampSpawn => ({ kind, x, z, facing });
const BOW: Loadout = { weapon: 'bow', free: ['mend', 'bulwark'] };
const TAUNTER: Loadout = { weapon: 'blade', free: ['taunt', 'mend'] };

class Rig {
  readonly c: Combat;
  readonly z: CombatZone;
  k = 0;
  readonly log: { t: number; ev: FxEvent }[] = [];
  readonly outs: TickOut[] = [];
  constructor(camps: CampSpawn[], scene: Scene = {}, seed = 1) {
    this.z = zone(camps, scene);
    this.c = createCombat(this.z, { seed, nowS: 0 });
  }
  get now() { return this.k / 15; }
  get w() { return worldOf(this.c); }
  enemy(kind: EnemyKindId, n = 0): EnemyState {
    const all = [...this.w.enemies.values()].filter((e) => e.kind === kind);
    return all[n];
  }
  add(x: number, z: number, loadout: Loadout = DEFAULT_LOADOUT, hp = 100, y = 0): number {
    return this.c.addAdventurer({ x, z, y, facing: 0, hp, loadout }, this.now);
  }
  tick(): TickOut {
    const out = this.c.tick(this.now);
    for (const ev of out.fx) this.log.push({ t: Math.round(this.now * 1000) / 1000, ev });
    this.outs.push(out);
    this.k++;
    return out;
  }
  at(s: number, each?: () => void): this {
    const end = Math.round(s * 15);
    while (this.k < end) { each?.(); this.tick(); }
    return this;
  }
  until(cond: () => boolean, maxS: number, each?: () => void): number {
    const end = this.k + Math.round(maxS * 15);
    while (this.k < end) { if (cond()) return this.now; each?.(); this.tick(); }
    if (cond()) return this.now;
    throw new Error('condition not met');
  }
  i(id: number, i: Intent) { return this.c.intent(id, i, this.now); }
  press(id: number, slot: number) { return this.i(id, { t: 'ability', slot, phase: 'press' }); }
  release(id: number, slot: number) { return this.i(id, { t: 'ability', slot, phase: 'release' }); }
  move(id: number, x: number, z: number, y = 0) { this.c.setPose(id, x, z, y, 0); }
  fx<T extends FxEvent['t']>(t: T) {
    return this.log.flatMap((l) => (l.ev.t === t ? [{ at: l.t, ...(l.ev as Extract<FxEvent, { t: T }>) }] : []));
  }
  hitsOn(dst: number) { return this.fx('hit').filter((h) => h.dst === dst); }
}
const dodge = (dx: number, dz: number, from: { x: number; z: number; y: number }): Intent => ({ t: 'dodge', dx, dz, from, grounded: true });
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
/** Engages an enemy at once and makes only `attack` ready now (the others never). */
function only(e: EnemyState, attack: string | null, at: number) {
  for (const id of e.data.attacks) e.attackReadyAt[id] = id === attack ? at : Infinity;
}

// ───────── aggro ─────────
describe('aggro', () => {
  it('notices an adventurer at 6.9 m, not at 7.1 m, and not through a wall', () => {
    const r1 = new Rig([camp('thornling')]);
    const a1 = r1.add(0, -6.9);
    r1.tick();
    expect(r1.enemy('thornling').threat.has(a1)).toBe(true);

    const r2 = new Rig([camp('thornling')]);
    const a2 = r2.add(0, -7.1);
    r2.at(1);
    expect(r2.enemy('thornling').threat.has(a2)).toBe(false);

    const r3 = new Rig([camp('thornling')], { walls: [{ x0: -3, x1: 3, z0: -3.5, z1: -3 }] });
    const a3 = r3.add(0, -6);
    r3.at(1);
    expect(r3.enemy('thornling').threat.has(a3)).toBe(false);
  });

  it('being hit from beyond aggro range engages it', () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling');
    const a = r.add(0, -15, BOW);
    r.i(a, { t: 'target', id: e.id });
    r.tick();
    expect(e.threat.has(a)).toBe(true);
    expect(e.targetId).toBe(a);
  });
});

// ───────── chase ─────────
describe('chase', () => {
  it('walks round a hedge through its gap into melee, only ever on passable ground', () => {
    // a see-through hedge (no ground) from x −20 to 4 and 7 to 20 at z −3..−2: the gap is x 4..7
    const scene: Scene = { hedges: [{ x0: -20, x1: 4, z0: -3, z1: -2 }, { x0: 7, x1: 20, z0: -3, z1: -2 }] };
    const r = new Rig([camp('thornling')], scene);
    const e = r.enemy('thornling');
    const a = r.add(0, -6);
    r.tick();
    expect(e.threat.has(a)).toBe(true);
    const pass = enemyPassable(r.z, e.data.radius);
    let maxSearches = 0;
    const t = r.until(() => dist(e, r.c.get(a)!) - e.data.radius <= 1.8, 8, () => {
      expect(pass(e.x, e.z)).toBe(true);
      maxSearches = Math.max(maxSearches, enemyAiStats(r.w).searches);
    });
    expect(t).toBeLessThan(6);
    expect(maxSearches).toBeGreaterThan(0);
    r.at(r.now + 2.1);
    expect(r.hitsOn(a).some((h) => h.by === 'auto')).toBe(true);
  });

  it('an archer stops at keepRange (12 m) and shoots from there', () => {
    const r = new Rig([camp('archer')]);
    const e = r.enemy('archer');
    const a = r.add(0, -8.9);
    r.at(0.2);
    r.move(a, 0, -20);
    r.at(4);
    expect(dist(e, r.c.get(a)!) - e.data.radius).toBeCloseTo(12, 0);
    expect(r.hitsOn(a).filter((h) => h.by === 'auto').length).toBeGreaterThan(0);
  });

  it('enemies are pushed apart by their radii', () => {
    const r = new Rig([camp('thornling', 0, 0), camp('thornling', 0.2, 0), camp('boar', -0.3, 0.1)]);
    r.at(0.5);
    const es = [...r.w.enemies.values()];
    for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
      expect(dist(es[i], es[j])).toBeGreaterThanOrEqual(es[i].data.radius + es[j].data.radius - 0.01);
    }
  });
});

// ───────── leash and unreachable ─────────
describe('leash and unreachable', () => {
  it('kited past 25 m from its camp it walks home invulnerable, and arrives with full hp and no threat', () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling');
    const a = r.add(0, -10, BOW);
    r.i(a, { t: 'target', id: e.id });
    let z = -10;
    r.until(() => e.act === 'return', 15, () => { z -= 4 / 15; r.move(a, 0, z); });
    expect(dist(e, e.camp)).toBeGreaterThan(25);
    expect(e.hp).toBeLessThan(e.maxHp);
    expect(e.threat.ids()).toEqual([]);
    const hpAtReturn = e.hp, from = r.log.length;
    r.move(a, 0, z + 20); // follows it home, still shooting
    r.until(() => e.act !== 'return', 10, () => { expect(e.hp).toBe(hpAtReturn); });
    expect(r.log.slice(from).filter((l) => l.ev.t === 'hit' && l.ev.dst === e.id)).toEqual([]);
    expect([e.x, e.z, e.hp]).toEqual([0, 0, e.maxHp]);
    expect(e.threat.ids()).toEqual([]);
  });

  it('with no way home at all it is put back at its camp, healed', () => {
    let closed = false;
    const base = zone([camp('thornling')]);
    const blocked = (x: number, z: number) => closed && z <= -4 && z >= -5;
    const g = (x: number, z: number) => (blocked(x, z) ? null : base.ground(x, z));
    const c = createCombat({ surface: g, ground: g, sight: base.sight, camps: [camp('thornling')] }, { seed: 1, nowS: 0 });
    const w = worldOf(c), e = [...w.enemies.values()][0];
    const a = c.addAdventurer({ x: 0, z: -6, y: 0, facing: 0, hp: 100, loadout: BOW }, 0);
    c.intent(a, { t: 'target', id: e.id }, 0);
    let k = 0;
    while (e.z > -7 && k < 60) c.tick(k++ / 15);
    closed = true; // the way back is cut off behind it
    let z = -6;
    while (e.act !== 'return' && k < 600) { z -= 4 / 15; c.setPose(a, 0, z, 0, 0); c.tick(k++ / 15); }
    expect(e.act).toBe('return');
    const from = k;
    while (e.act === 'return' && k < from + 15 * 25) c.tick(k++ / 15);
    expect([e.x, e.z, e.hp, e.act]).toEqual([0, 0, e.maxHp, '']);
  });

  describe('an adventurer on a platform the enemy cannot walk onto (Review Focus 5)', () => {
    const scene: Scene = { platforms: [{ x0: 3, x1: 9, z0: -3, z1: 3, h: 1.2 }] };
    it('within horizontal reach it is attacked, whatever its height', () => {
      const r = new Rig([camp('thornling', -2, 0)], scene);
      const e = r.enemy('thornling');
      const a = r.add(3.4, 0, DEFAULT_LOADOUT, 100, 1.2);
      r.at(4);
      expect(r.hitsOn(a).filter((h) => h.by === 'auto').length).toBeGreaterThan(1);
      expect(e.act).not.toBe('return');
    });

    it('4 m in, the enemy goes home within UNREACHABLE_S + 1 s, cannot be hurt on the way, and never stands with a target > 3 s', () => {
      const r = new Rig([camp('thornling', -2, 0)], scene);
      const e = r.enemy('thornling');
      const a = r.add(7, 0, BOW, 100, 1.2);
      r.i(a, { t: 'target', id: e.id });
      let still = 0, maxStill = 0, lastX = e.x, lastZ = e.z, stoppedAt: number | null = null, firstReturn: number | null = null;
      let returningHits = 0, wasReturning = false;
      r.at(40, () => {
        const prev = r.outs[r.outs.length - 1];
        if (wasReturning && prev) returningHits += prev.fx.filter((f) => f.t === 'hit' && f.dst === e.id).length;
        wasReturning = e.act === 'return';
        const moved = e.x !== lastX || e.z !== lastZ;
        if (e.targetId !== null && !moved && e.act === '') still += 1 / 15; else still = 0;
        maxStill = Math.max(maxStill, still);
        if (e.targetId !== null && !moved && stoppedAt === null) stoppedAt = r.now;
        if (e.act === 'return' && firstReturn === null) firstReturn = r.now;
        lastX = e.x; lastZ = e.z;
      });
      expect(stoppedAt).not.toBeNull();
      expect(firstReturn).not.toBeNull();
      expect(firstReturn! - stoppedAt!).toBeLessThanOrEqual(UNREACHABLE_S + 1);
      expect(maxStill).toBeLessThanOrEqual(UNREACHABLE_S + 2 / 15);
      expect(returningHits).toBe(0);
      expect(e.alive).toBe(true); // it heals at home every time: the ledge is no free kill
      expect(e.x).toBeLessThanOrEqual(2.5 + 1e-9); // never on the platform
    });
  });
});

// ───────── telegraphs ─────────
describe('telegraphs', () => {
  it('a Briar Volley stays where it was placed; walking out before the end avoids it', () => {
    const r = new Rig([camp('archer')]);
    const e = r.enemy('archer');
    const a = r.add(0, -8);
    r.tick();
    only(e, 'briar_volley', r.now);
    r.tick();
    const tg = [...r.c.telegraphs()][0];
    expect(tg.attack).toBe('briar_volley');
    expect(tg.shape).toMatchObject({ kind: 'circle', x: 0, z: -8, r: 2.5 });
    r.move(a, 0, -9);
    r.at(r.now + 0.5);
    expect([...r.c.telegraphs()][0].shape).toEqual(tg.shape);
    r.move(a, 0, -11);
    r.until(() => e.windup === null, 2);
    expect(r.c.telegraphs()[Symbol.iterator]().next().done).toBe(true);
    expect(r.hitsOn(a).filter((h) => h.by === 'briar_volley')).toEqual([]);
  });

  it('a Thorn Burst roots the enemy and hits an adventurer 1.6 m up inside it (no air dodge): 14', () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling');
    const a = r.add(0, -2);
    r.tick();
    only(e, 'thorn_burst', r.now);
    r.tick();
    const at = { x: e.x, z: e.z, f: e.facing };
    r.move(a, 0.5, -2.2, 1.6);
    r.until(() => e.windup === null, 2, () => expect({ x: e.x, z: e.z, f: e.facing }).toEqual(at));
    expect(r.hitsOn(a).filter((h) => h.by === 'thorn_burst').map((h) => h.amount)).toEqual([14]);
  });

  it('a dodge accepted one tick before a Ground Slam resolves avoids it: perfect miss, +15 stagger, +10 Momentum (Review Focus 4)', () => {
    const r = new Rig([camp('mossback')]);
    const e = r.enemy('mossback');
    const a = r.add(0, -3);
    r.tick();
    only(e, 'ground_slam', r.now);
    r.tick();
    const end = e.windup!.endsAt;
    r.at(end); // the next tick resolves it; a dodge now is accepted just before that tick
    const p = r.c.get(a)!;
    expect(r.i(a, dodge(0, -1, { x: p.x, z: p.z, y: 0 }))).toBeNull();
    r.tick();
    expect(e.windup).toBeNull();
    expect(r.fx('miss')).toEqual([expect.objectContaining({ src: e.id, dst: a, perfect: true })]);
    expect(r.hitsOn(a).filter((h) => h.by === 'ground_slam')).toEqual([]);
    expect(e.stagger.value).toBe(15);
    expect(r.c.self(a)!.momentum).toBe(10);
  });
});

// ───────── parry ─────────
describe('parry', () => {
  it('inside the window it negates a Ground Slam: +35 stagger, +20 Momentum, nothing taken', () => {
    const r = new Rig([camp('mossback')]);
    const e = r.enemy('mossback');
    const a = r.add(0, -3);
    r.tick();
    only(e, 'ground_slam', r.now);
    r.tick();
    r.at(e.windup!.endsAt - 0.3);
    const hp = r.c.get(a)!.hp; // (an auto may have landed before the wind-up)
    expect(r.press(a, 2)).toBeNull();
    r.until(() => e.windup === null, 1);
    expect(r.fx('parry')).toEqual([expect.objectContaining({ src: a, dst: e.id })]);
    expect(r.hitsOn(a).filter((h) => h.by === 'ground_slam')).toEqual([]);
    expect(e.stagger.value).toBe(35);
    expect(r.c.self(a)!.momentum).toBe(20);
    expect(r.c.get(a)!.hp).toBe(hp);
  });

  it('against a Thornling auto it stuns the Thornling for 1 s', () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling');
    const a = r.add(0, -2);
    r.tick();
    only(e, null, 0);
    r.at(1.5); // autos at 0.067, 1.667, ...
    expect(r.press(a, 2)).toBeNull();
    r.at(1.8);
    expect(r.fx('parry')).toHaveLength(1);
    expect(e.act).toBe('stun');
    const stunAt = r.fx('parry')[0].at;
    r.until(() => e.act === '', 2);
    expect(r.now - 1 / 15 - stunAt).toBeCloseTo(1, 6); // the tick it ends on
    expect(r.hitsOn(a).filter((h) => h.at > stunAt && h.at < stunAt + 1)).toEqual([]);
  });

  it('does not negate a Gore Charge', () => {
    const r = new Rig([camp('boar')]);
    const e = r.enemy('boar');
    const a = r.add(0, -3);
    r.tick();
    only(e, 'gore_charge', r.now);
    r.tick();
    r.at(e.windup!.endsAt - 0.3);
    expect(r.press(a, 2)).toBeNull();
    r.until(() => e.windup === null, 1);
    expect(r.fx('parry')).toEqual([]);
    expect(r.hitsOn(a).filter((h) => h.by === 'gore_charge').map((h) => h.amount)).toEqual([18]);
  });
});

// ───────── Gore Charge ─────────
describe('Gore Charge', () => {
  it('knocks about 3.5 m along the line with vy 4, and the boar ends at the line’s end', () => {
    const r = new Rig([camp('boar')]);
    const e = r.enemy('boar');
    const a = r.add(0, -4);
    r.tick();
    only(e, 'gore_charge', r.now);
    r.tick();
    const tg = [...r.c.telegraphs()][0];
    expect(tg.shape.kind).toBe('line');
    const s = tg.shape as Extract<typeof tg.shape, { kind: 'line' }>;
    r.until(() => e.windup === null, 2);
    const knock = r.outs.flatMap((o) => o.displaced).find((d) => d.kind === 'knock')!;
    expect(knock.id).toBe(a);
    expect(knock.d.vy).toBe(4);
    const moved = Math.hypot(knock.result.x - knock.from.x, knock.result.z - knock.from.z);
    expect(moved).toBeGreaterThan(3.2);
    expect(moved).toBeLessThan(3.8);
    const along = ((knock.result.x - knock.from.x) * Math.sin(s.dir) + (knock.result.z - knock.from.z) * Math.cos(s.dir)) / moved;
    expect(along).toBeGreaterThan(0.999);
    const endX = s.x + Math.sin(s.dir) * s.length, endZ = s.z + Math.cos(s.dir) * s.length;
    expect(Math.hypot(e.x - endX, e.z - endZ)).toBeLessThan(1e-9 + 0.25);
  });

  it('the dash stops early where the ground ends', () => {
    const r = new Rig([camp('boar')], { walls: [{ x0: -5, x1: 5, z0: -6.5, z1: -6 }] });
    const e = r.enemy('boar');
    const a = r.add(0, -3);
    r.tick();
    only(e, 'gore_charge', r.now);
    r.tick();
    r.until(() => e.windup === null, 2);
    expect(e.z).toBeGreaterThan(-6 + e.data.radius - 1e-9);
    expect(r.z.ground(e.x, e.z)).not.toBeNull();
    void a;
  });
});

// ───────── interrupts and breaks ─────────
describe('interrupts and breaks', () => {
  function hail(loadout: Loadout) {
    const r = new Rig([camp('mossback')]);
    const e = r.enemy('mossback');
    const a = r.add(0, -4, loadout);
    r.tick();
    r.i(a, { t: 'target', id: e.id });
    only(e, 'thorn_hail', r.now);
    r.tick();
    expect(e.windup?.attack).toBe('thorn_hail');
    return { r, e, a };
  }

  it('Thorn Hail is interrupted by Sunder', () => {
    const { r, e, a } = hail(DEFAULT_LOADOUT);
    r.w.adventurers.get(a)!.momentum = 60;
    expect(r.press(a, 1)).toBeNull();
    r.tick();
    expect(r.fx('interrupt')).toHaveLength(1);
    expect(e.windup).toBeNull();
    expect([...r.c.telegraphs()]).toEqual([]);
    expect(e.attackReadyAt.thorn_hail).toBeCloseTo(r.now - 1 / 15 + 14, 6);
  });

  it('Thorn Hail is interrupted by Charged Shot at frac 0.8 but not at 0.5', () => {
    const a8 = hail(BOW);
    expect(a8.r.press(a8.a, 2)).toBeNull();
    a8.r.at(a8.r.now + 1.2);
    expect(a8.r.release(a8.a, 2)).toBeNull();
    a8.r.tick();
    expect(a8.r.fx('interrupt')).toHaveLength(1);
    expect(a8.e.windup).toBeNull();

    const a5 = hail(BOW);
    expect(a5.r.press(a5.a, 2)).toBeNull();
    a5.r.at(a5.r.now + 0.75);
    expect(a5.r.release(a5.a, 2)).toBeNull();
    a5.r.tick();
    expect(a5.r.fx('interrupt')).toEqual([]);
    expect(a5.e.windup?.attack).toBe('thorn_hail');
  });

  it('Ground Slam is never interrupted', () => {
    const r = new Rig([camp('mossback')]);
    const e = r.enemy('mossback');
    const a = r.add(0, -3);
    r.tick();
    r.i(a, { t: 'target', id: e.id });
    only(e, 'ground_slam', r.now);
    r.tick();
    r.w.adventurers.get(a)!.momentum = 60;
    expect(r.press(a, 1)).toBeNull();
    r.tick();
    expect(r.fx('interrupt')).toEqual([]);
    expect(e.windup?.attack).toBe('ground_slam');
  });

  it('100 stagger breaks it: no attacks for 4 s, and a Blade auto deals 11', () => {
    const r = new Rig([camp('mossback')]);
    const e = r.enemy('mossback');
    const a = r.add(0, -3.5);
    r.tick();
    r.i(a, { t: 'target', id: e.id });
    r.at(1);
    e.stagger.value = 90;
    r.w.adventurers.get(a)!.momentum = 60;
    expect(r.press(a, 1)).toBeNull(); // Sunder: +10 stagger
    r.tick();
    expect(r.fx('break')).toHaveLength(1);
    const at = r.fx('break')[0].at;
    r.at(at + 4 - 0.01);
    expect(r.hitsOn(a).filter((h) => h.at > at)).toEqual([]);
    expect(r.log.some((l) => l.t > at && l.ev.t === 'miss')).toBe(false);
    expect(r.fx('hit').filter((h) => h.src === a && h.by === 'auto' && h.at > at).map((h) => h.amount)).toContain(11);
  });
});

// ───────── threat ─────────
describe('threat', () => {
  it('switches only past 110%, and a taunt holds it for exactly 4 s', () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling');
    const a = r.add(0, -2), b = r.add(1.5, -1.5, TAUNTER);
    r.tick();
    only(e, null, 0);
    e.threat.clear();
    e.threat.add(a, 100);
    e.threat.add(b, 105);
    e.targetId = a;
    r.at(1);
    expect(e.targetId).toBe(a);
    e.threat.add(b, 6); // 111
    r.at(1.6);
    expect(e.targetId).toBe(b);
    e.threat.add(a, 200); // a: 300, way past
    r.at(2.2);
    expect(e.targetId).toBe(a);
    r.i(b, { t: 'target', id: e.id });
    const t0 = r.now;
    expect(r.press(b, 3)).toBeNull(); // Taunt
    // the target each tick leaves it with, while a keeps piling on threat
    const held: number[] = [];
    while (r.now < t0 + 5) { e.threat.add(a, 100); const t = r.now; r.tick(); if (e.targetId === b) held.push(t); }
    const heldB = held;
    expect(heldB[0]).toBeCloseTo(t0, 6);
    expect(heldB[heldB.length - 1]).toBeCloseTo(t0 + 4 - 1 / 15, 6);
    expect(heldB.length).toBe(60);
  });
});

// ───────── death and removal ─────────
describe('death and removal', () => {
  it('a dead adventurer is dropped from threat, and an enemy left with no target goes home', () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling');
    const a = r.add(0, -2, DEFAULT_LOADOUT, 1);
    r.until(() => !r.c.get(a)!.alive, 5);
    expect(e.threat.has(a)).toBe(false);
    const died = r.now;
    r.until(() => e.act === 'return', NO_TARGET_S + 0.5);
    expect(r.now - died).toBeGreaterThanOrEqual(NO_TARGET_S - 0.1);
    r.until(() => e.act === '', 5);
    expect(e.hp).toBe(e.maxHp);
  });

  it('an adventurer removed mid-wind-up and mid-chase leaves no trace: no throw, the enemy goes home', () => {
    const r = new Rig([camp('mossback'), camp('boar', 6, 0)]);
    const m = r.enemy('mossback'), b = r.enemy('boar');
    const a = r.add(2, -3);
    r.tick();
    only(m, 'ground_slam', r.now);
    only(b, 'gore_charge', r.now);
    r.tick();
    expect(m.windup).not.toBeNull();
    r.c.removeAdventurer(a);
    r.until(() => m.act === 'return' && b.act === 'return', NO_TARGET_S + 2);
    r.until(() => m.act === '' && b.act === '', 10);
    expect([m.x, m.z, b.x, b.z]).toEqual([0, 0, 6, 0]);
  });
});

// ───────── budget, ground and determinism ─────────
function crowd(seed: number) {
  // 21 thornlings and boars behind a long hedge with gaps; 6 adventurers on the far side shoot them
  const camps: CampSpawn[] = [];
  for (let i = 0; i < 21; i++) camps.push(camp(i % 3 === 0 ? 'boar' : 'thornling', -20 + i * 2, 4 + (i % 2) * 2));
  const r = new Rig(camps, { hedges: [{ x0: -30, x1: -12, z0: -1, z1: 0 }, { x0: -9, x1: 9, z0: -1, z1: 0 }, { x0: 12, x1: 30, z0: -1, z1: 0 }], walls: [{ x0: -2, x1: 2, z0: -8, z1: -7 }] }, seed);
  const adv: number[] = [];
  for (let i = 0; i < 6; i++) adv.push(r.add(-15 + i * 6, -6, BOW));
  const es = [...r.w.enemies.values()];
  adv.forEach((id, i) => r.i(id, { t: 'target', id: es[(i * 3) % es.length].id }));
  return { r, adv, es };
}
const threatValues = (e: EnemyState) => [...((e.threat as unknown as { threat: Map<number, number> }).threat)];
const snapshot = (r: Rig) => JSON.stringify({
  e: [...r.w.enemies.values()].map((e) => [e.id, e.x, e.z, e.y, e.facing, e.hp, e.maxHp, e.act, e.actUntil, e.targetId, threatValues(e), e.stagger, e.marks, e.windup, e.attackReadyAt, e.surging, enemyAiStateOf(e) ?? null]),
  a: [...r.w.adventurers.values()].map((a) => [a.id, a.x, a.z, a.hp, a.alive, a.act, a.momentum, a.targetId, a.dodgeCharges]),
  t: [...r.w.telegraphs.values()],
});

describe('budget, ground and determinism', () => {
  it('21 chasing enemies run at most 4 path searches in any tick, and never leave passable ground', () => {
    const { r, adv } = crowd(3);
    let max = 0, total = 0;
    r.at(20, () => {
      const s = enemyAiStats(r.w).searches;
      max = Math.max(max, s); total += s;
      for (const e of r.w.enemies.values()) {
        if (!e.alive) continue;
        expect(r.z.ground(e.x, e.z)).not.toBeNull();
        expect(enemyPassable(r.z, e.data.radius)(e.x, e.z)).toBe(true);
      }
    });
    expect(max).toBeLessThanOrEqual(4);
    expect(total).toBeGreaterThan(4);
    void adv;
  });

  it('the same seed gives the same world, tick for tick', () => {
    for (const seed of [1, 7, 42]) {
      const x = crowd(seed), y = crowd(seed);
      for (let k = 0; k < 15 * 12; k++) {
        if (k === 60) { x.r.c.removeAdventurer(x.adv[2]); y.r.c.removeAdventurer(y.adv[2]); }
        const ox = x.r.tick(), oy = y.r.tick();
        expect(JSON.stringify(ox)).toBe(JSON.stringify(oy));
        if (k % 15 === 0) expect(snapshot(x.r)).toBe(snapshot(y.r));
      }
      expect(snapshot(x.r)).toBe(snapshot(y.r));
    }
  });
});

// ═════════ fix round 1 ═════════
import { findPath, withClearance } from '../path';
import { ENEMY_PATH_BUDGET, enemyAiStateOf, enemyPathPassable, SURGE_AFTER_S, SURGE_SCALE, PARRY_STUN_IMMUNE_S } from './enemyAi';
import { STAGGER_IMMUNE_S } from './stagger';
import { RUN_SPEED } from '../constants';
import { adventurerBrain, newBrainMemory } from './brain';
import { brainInputFor } from './sim';
import { COMBAT_TIMEOUT_S, SWAP_COOLDOWN_S } from './constants';
import { hurtAdventurer } from './adventurer';

describe('path cost (I1)', () => {
  it('findPath can skip the goal-pocket check and reports the nodes it expanded', () => {
    // the goal sits in a small walled pocket: the default search refuses it after the pocket check;
    // pockets: false just runs A* to its node limit
    const wallRing = (x: number, z: number) => Math.abs(Math.hypot(x - 10, z) - 2) < 0.4;
    const pass = (x: number, z: number) => !wallRing(x, z);
    const stats = { expanded: 0, exhausted: false };
    expect(findPath({ x: 0, z: 0 }, { x: 10, z: 0 }, pass, { maxNodes: 300, pockets: false, stats })).toBeNull();
    expect(stats.expanded).toBe(300);
    expect(stats.exhausted).toBe(true);
    const s2 = { expanded: 0, exhausted: false };
    expect(findPath({ x: 0, z: 0 }, { x: 5, z: 3 }, pass, { stats: s2 })).not.toBeNull();
    expect(s2.exhausted).toBe(false);
    expect(s2.expanded).toBeGreaterThan(0);
  });

  it('enemy path passability is cached per zone and radius: a repeated search makes no ground calls, and it is conservative', () => {
    let calls = 0;
    const base = zone([], { walls: [{ x0: -3, x1: 3, z0: 2, z1: 2.6 }, { x0: 6, x1: 6.4, z0: -9, z1: 9 }] });
    const z: CombatZone = { ...base, ground: (x, zz) => { calls++; return base.ground(x, zz); } };
    const pass = enemyPathPassable(z, 0.8);
    expect(enemyPathPassable(z, 0.8)).toBe(pass);
    const p1 = findPath({ x: 0, z: 0 }, { x: 0, z: 6 }, pass, { cell: 1, pockets: false });
    expect(p1).not.toBeNull();
    const before = calls;
    findPath({ x: 0, z: 0 }, { x: 0, z: 6 }, pass, { cell: 1, pockets: false });
    expect(calls).toBe(before);
    const exact = withClearance((x, zz) => base.ground(x, zz) !== null, 0.8);
    for (let i = 0; i < 4000; i++) {
      const x = -8 + ((i * 7919) % 32) / 2, zz = -8 + ((i * 104729) % 32) / 2; // grid points
      if (pass(x, zz)) expect(exact(x, zz)).toBe(true);
    }
  });

  it('a tick never expands more than ENEMY_PATH_BUDGET nodes, and every enemy that needs a path gets one within 3 s', () => {
    const { r } = crowd(5);
    const lastSearch = new Map<number, number>();
    let maxNodes = 0;
    r.at(12, () => {
      maxNodes = Math.max(maxNodes, enemyAiStats(r.w).nodes);
      for (const e of r.w.enemies.values()) {
        const s = enemyAiStateOf(e);
        if (s && s.searchedAt > -Infinity) lastSearch.set(e.id, s.searchedAt);
      }
    });
    expect(maxNodes).toBeLessThanOrEqual(ENEMY_PATH_BUDGET);
    // every enemy that ever waited for a search was served within 3 s of asking
    for (const e of r.w.enemies.values()) {
      const s = enemyAiStateOf(e);
      if (s) expect(s.longestWaitS).toBeLessThanOrEqual(3);
    }
    expect(lastSearch.size).toBeGreaterThan(5);
  });

  it('a blocked enemy does not re-check its straight line every tick (gated by planAt)', () => {
    const r = new Rig([camp('thornling', -2, 0)], { platforms: [{ x0: 3, x1: 9, z0: -3, z1: 3, h: 1.2 }] });
    r.add(7, 0, BOW, 100, 1.2);
    r.i(1 + r.w.enemies.size, { t: 'target', id: r.enemy('thornling').id });
    let checks = 0;
    r.at(3, () => { checks += enemyAiStats(r.w).lineChecks; });
    expect(checks).toBeLessThanOrEqual(3 * 5);
  });
});

/** The reviewer's kite: circling the camp at run speed, closing slowly, Bow autos all the way. */
function kite(kind: EnemyKindId, step: number, RE: number, D0: number) {
  const r = new Rig([camp(kind)], { half: 200 });
  const e = r.enemy(kind);
  const id = r.add(0, -D0, BOW);
  const mem = newBrainMemory();
  let px = 0, pz = -D0, took = 0, minGap = 99, surged = false, killedAt: number | null = null, returned = false;
  const dt = 1 / 15;
  for (let k = 1; k < 15 * 60; k++) {
    r.k = k;
    const t = r.now;
    const act = adventurerBrain(brainInputFor(r.c, id, e.id, t, true)!, mem);
    const D = Math.max(4, D0 - Math.floor(t / 2.5) * step);
    const d = Math.hypot(px - e.x, pz - e.z) || 1e-6;
    const ux = (px - e.x) / d, uz = (pz - e.z) / d;
    const rr = Math.hypot(e.x, e.z);
    let hx: number, hz: number;
    if (rr < 2) { hx = ux; hz = uz; } else { const rx = e.x / rr, rz = e.z / rr; const kk = ((RE - rr) / RE) * 1.5; hx = -rz + rx * kk; hz = rx + rz * kk; }
    const cross = ux * hz - uz * hx;
    const a = Math.max(0, Math.min(RUN_SPEED, e.data.speed + 3 * (D - d)));
    const b = Math.sqrt(Math.max(0, 36 - a * a)) * Math.max(-1, Math.min(1, cross * 3));
    const vx = ux * a - uz * b, vz = uz * a + ux * b;
    const sp = Math.hypot(vx, vz), sc = sp > RUN_SPEED ? RUN_SPEED / sp : 1;
    px += vx * sc * dt; pz += vz * sc * dt;
    r.c.setPose(id, px, pz, 0, 0);
    for (const i of act.intents) { if ((i.t === 'ability' && i.slot === 2) || i.t === 'dodge') continue; r.c.intent(id, i, t); }
    const out = r.c.tick(t);
    for (const f of out.fx) if (f.t === 'hit' && f.dst === id) took += f.amount;
    if (r.c.get(e.id)!.surging) surged = true;
    if (t > 3) minGap = Math.min(minGap, Math.hypot(px - e.x, pz - e.z));
    if (out.kills.length) { killedAt = t; break; }
    if (e.act === 'return') returned = true;
    if (!r.c.get(id)!.alive || (returned && e.act === '')) break;
  }
  return { took, minGap, surged, killedAt, returned, hpAtEnd: e.hp, maxHp: e.maxHp };
}

describe('the chase surge (I2)', () => {
  it("the reviewer's slow-closing Bow kite never kills: the enemy surges, and is either caught up or leashed home healed", () => {
    for (const kind of ['boar', 'thornling'] as const) for (const [step, re, d0] of [[0.7, 12, 12], [0.45, 15, 14], [0.7, 8, 10], [1.5, 20, 12]]) {
      const k = kite(kind, step, re, d0);
      const tag = `${kind} ${step} ${re} ${d0}`;
      expect(k.killedAt, tag).toBeNull();
      expect(k.surged, tag).toBe(true);
      if (k.took === 0) expect([k.returned, k.hpAtEnd], tag).toEqual([true, k.maxHp]);
    }
  });

  it(`surges at ${SURGE_SCALE} × RUN_SPEED after ${SURGE_AFTER_S} s out of range of every attack, until it next attacks`, () => {
    const r = new Rig([camp('thornling')], { half: 200 });
    const e = r.enemy('thornling');
    const a = r.add(0, -6.5);
    r.tick();
    let z = -6.5;
    const speeds: number[] = [];
    let last = { x: e.x, z: e.z };
    // a runner a little faster than the Thornling (5 m/s): out of range the whole time
    r.until(() => r.c.get(e.id)!.surging === true, SURGE_AFTER_S + 0.5, () => { z -= 5.5 / 15; r.move(a, 0, z); });
    expect(r.now).toBeGreaterThan(SURGE_AFTER_S);
    for (let k = 0; k < 5; k++) {
      z -= 5.5 / 15; r.move(a, 0, z);
      last = { x: e.x, z: e.z };
      r.tick();
      speeds.push(dist(e, last) * 15);
    }
    expect(Math.max(...speeds)).toBeCloseTo(SURGE_SCALE * RUN_SPEED, 5);
    // stop: it catches up, starts an attack, and the surge ends
    r.until(() => r.c.get(e.id)!.surging === false, 5);
    expect(e.windup !== null || r.hitsOn(a).length > 0).toBe(true);
  });

  it('an honest melee fight never surges', () => {
    const r = new Rig([camp('boar')]);
    const e = r.enemy('boar');
    const a = r.add(0, -2.5);
    r.i(a, { t: 'target', id: e.id });
    let surged = false;
    r.at(12, () => { if (r.c.get(e.id)!.surging) surged = true; });
    expect(surged).toBe(false);
  });
});

describe('path progress (I3)', () => {
  for (const half of [8, 12, 16, 20]) {
    it(`a Thornling walks round a ${half} m half-length hedge and hits`, () => {
      const r = new Rig([camp('thornling', 0, 3)], { hedges: [{ x0: -half, x1: half, z0: -1, z1: 0 }], half: 60 });
      const e = r.enemy('thornling');
      const a = r.add(0, -3);
      r.i(a, { t: 'target', id: e.id });
      let returned = false;
      r.at(20, () => { if (e.act === 'return') returned = true; });
      expect(returned).toBe(false);
      expect(r.hitsOn(a).length).toBeGreaterThan(0);
    });
  }
  it('beyond its leash (a 30 m half-length hedge) it goes home instead of freezing', () => {
    const r = new Rig([camp('thornling', 0, 3)], { hedges: [{ x0: -30, x1: 30, z0: -1, z1: 0 }], half: 60 });
    const e = r.enemy('thornling');
    const a = r.add(0, -3);
    r.i(a, { t: 'target', id: e.id });
    r.until(() => e.act === 'return', 15);
  });
});

describe('elites scale with the adventurers engaged', () => {
  it('two engaged: max hp ×1.7 with the hp fraction kept, stagger capacity ×1.7; never down in the fight; base again at home', () => {
    const r = new Rig([camp('mossback')]);
    const e = r.enemy('mossback');
    const a = r.add(0, -3), b = r.add(0, -15, BOW);
    r.tick();
    expect(e.maxHp).toBe(750);
    e.hp = 600;
    r.i(b, { t: 'target', id: e.id });
    r.tick();
    expect(e.maxHp).toBeCloseTo(1275, 6);
    expect(e.hp / e.maxHp).toBeCloseTo(600 / 750 - 0, 1);
    expect(e.stagger.max).toBeCloseTo(170, 6);
    expect(r.c.get(e.id)!.maxHp).toBeCloseTo(1275, 6);
    hurtAdventurer(r.w, r.w.adventurers.get(b)!, 999, e.id, 'auto', r.now);
    r.tick();
    expect(e.maxHp).toBeCloseTo(1275, 6);
    r.c.removeAdventurer(a);
    r.until(() => e.act === 'return', 5);
    r.until(() => e.act === '', 10);
    expect([e.maxHp, e.hp, e.stagger.max]).toEqual([750, 750, 100]);
  });

  it('caps at 4 engaged (×3.1) and ordinary enemies never scale', () => {
    const r = new Rig([camp('mossback'), camp('thornling', 8, 0)]);
    const m = r.enemy('mossback'), t = r.enemy('thornling');
    for (let i = 0; i < 6; i++) r.add(4 * Math.sin(i), 4 * Math.cos(i));
    for (let i = 0; i < 6; i++) r.add(8 + 2 * Math.sin(i), 2 * Math.cos(i));
    r.tick();
    expect(m.maxHp).toBeCloseTo(750 * 3.1, 6);
    expect(t.maxHp).toBe(210);
  });
});

describe('stagger and parry immunity (M3)', () => {
  it(`after a break ends, ${STAGGER_IMMUNE_S} s of no stagger gain, shown in the view`, () => {
    const r = new Rig([camp('mossback')]);
    const e = r.enemy('mossback');
    r.add(0, -3);
    r.tick();
    applyStaggerNow(r, e, 100);
    const until = e.stagger.brokenUntil;
    r.at(until + 1);
    expect(r.c.get(e.id)!.staggerImmune).toBeCloseTo(STAGGER_IMMUNE_S - 1 + (Math.round(until * 15) / 15 - until) + 1 / 15 * 0, 0);
    applyStaggerNow(r, e, 30);
    expect(e.stagger.value).toBe(0);
    r.at(until + STAGGER_IMMUNE_S + 0.1);
    expect(r.c.get(e.id)!.staggerImmune ?? 0).toBe(0);
    applyStaggerNow(r, e, 30);
    expect(e.stagger.value).toBe(30);
  });

  it(`a parry-stunned ordinary enemy cannot be parry-stunned again for ${PARRY_STUN_IMMUNE_S} s (the parry still negates)`, () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling');
    const a = r.add(0, -2);
    r.tick();
    only(e, null, 0);
    const parryNext = () => { const at = enemyAiStateOf(e)!.nextAutoAt; r.at(at - 0.2); expect(r.press(a, 2)).toBeNull(); r.at(at + 0.1); };
    parryNext();
    expect(r.fx('parry')).toHaveLength(1);
    const first = r.fx('parry')[0].at;
    r.until(() => e.act === '', 2);
    r.w.adventurers.get(a)!.readyAt.parry = -Infinity;
    parryNext(); // within 3 s of the first stun
    expect(r.fx('parry')).toHaveLength(2);
    expect(r.fx('parry')[1].at - first).toBeLessThan(PARRY_STUN_IMMUNE_S);
    expect(e.act).toBe('');
  });
});
function applyStaggerNow(r: Rig, e: EnemyState, n: number) { applyStaggerFn(r.w, e, n, r.now); }
import { applyStagger as applyStaggerFn } from './adventurer';

describe('carry keeps combat state across a relog (M1)', () => {
  it('in combat, regen delay, swap cooldown, shield and sprint survive a relog', () => {
    const c = createCombat(zone([]), { seed: 1, nowS: 0 });
    const a = c.addAdventurer({ x: 0, z: 0, y: 0, facing: 0, hp: 50, loadout: DEFAULT_LOADOUT }, 0);
    const A = worldOf(c).adventurers.get(a)!;
    A.lastCombatAt = 9; A.lastHurtAt = 9; A.swapReadyAt = 11; A.shield = 20; A.shieldUntil = 13; A.sprintUntil = 12;
    c.tick(10);
    const carry = c.carryOf(a)!;
    expect(carry).toMatchObject({ sinceCombat: 1, sinceHurt: 1, swapCd: 1, shield: 20, shieldLeft: 3, sprintLeft: 2 });
    c.removeAdventurer(a);
    const b = c.addAdventurer({ x: 0, z: 0, y: 0, facing: 0, hp: 50, loadout: DEFAULT_LOADOUT, carry }, 100);
    expect(c.self(b)!.inCombat).toBe(true);
    expect(c.intent(b, { t: 'swap' }, 100)).toBe('in-combat');
    expect(c.get(b)!.shield).toBe(20);
    expect(c.speedScale(b, 100)).toBeCloseTo(1.4, 6);
    c.tick(100 + COMBAT_TIMEOUT_S - 1 + 0.01);
    expect(c.self(b)!.inCombat).toBe(false);
    expect(c.self(b)!.swapCd).toBe(0);
    void SWAP_COOLDOWN_S;
  });
  it('carry extras are clamped', () => {
    const c = createCombat(zone([]), { seed: 1, nowS: 0 });
    const b = c.addAdventurer({ x: 0, z: 0, y: 0, facing: 0, hp: 50, loadout: DEFAULT_LOADOUT, carry: {
      cooldowns: {}, gcd: 0, dodgeCharges: 2, dodgeRefillIn: 0, momentum: 0, sinceCombat: -50, sinceHurt: Number.NaN, swapCd: 1e9, shield: 1e9, shieldLeft: 1e9, sprintLeft: 1e9,
    } }, 10);
    expect(c.self(b)!.inCombat).toBe(true);
    expect(c.self(b)!.swapCd).toBe(SWAP_COOLDOWN_S);
    expect(c.get(b)!.shield).toBe(25);
  });
});

describe('separation (M2)', () => {
  it('pushes at most DISPLACE_SUBSTEP_M a tick', () => {
    const r = new Rig([camp('mossback', 0, 0), camp('boar', 0.1, 0)]);
    const es = [...r.w.enemies.values()];
    for (let k = 0; k < 20; k++) {
      const before = es.map((e) => ({ x: e.x, z: e.z }));
      r.tick();
      es.forEach((e, i) => expect(dist(e, before[i])).toBeLessThanOrEqual(0.1 + 1e-9));
    }
    expect(dist(es[0], es[1])).toBeGreaterThan(1.5);
  });
});

describe('more AI rules (M6)', () => {
  it('a walk home longer than RETURN_MAX_S ends at the camp', () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling');
    const a = r.add(0, -10, BOW);
    r.i(a, { t: 'target', id: e.id });
    let z = -10;
    r.until(() => e.act === 'return', 15, () => { z -= 4 / 15; r.move(a, 0, z); });
    enemyAiStateOf(e)!.returnSince = r.now - 25;
    r.tick();
    expect([e.x, e.z, e.act, e.hp]).toEqual([0, 0, '', e.maxHp]);
  });

  it('going home clears marks, Burning and stagger at once', () => {
    const r = new Rig([camp('mossback')]);
    const e = r.enemy('mossback');
    const a = r.add(0, -3);
    r.tick();
    e.marks = { burning: r.now + 8, marked: r.now + 8 };
    e.burning = { src: a, power: 10, nextAt: r.now + 1 };
    e.stagger.value = 50;
    r.c.removeAdventurer(a);
    r.until(() => e.act === 'return', 4);
    expect([e.marks, e.burning, e.stagger.value]).toEqual([{}, null, 0]);
  });

  it('ranged autos are not parryable', () => {
    const r = new Rig([camp('archer')]);
    const e = r.enemy('archer');
    const a = r.add(0, -8);
    r.tick();
    only(e, null, 0);
    const at = enemyAiStateOf(e)!.nextAutoAt;
    r.at(at - 0.2);
    expect(r.press(a, 2)).toBeNull();
    r.at(at + 0.1);
    expect(r.fx('parry')).toEqual([]);
    expect(r.hitsOn(a).filter((h) => h.by === 'auto').length).toBeGreaterThan(0);
  });

  it('an archer walks until it can see its target, then stops', () => {
    const r = new Rig([camp('archer')], { walls: [{ x0: -2, x1: 2, z0: -4, z1: -3.5 }] });
    const e = r.enemy('archer');
    const a = r.add(0, -8, BOW);
    r.i(a, { t: 'target', id: e.id }); // engaged by Snap? no: engage it through threat directly
    e.threat.add(a, 1);
    r.until(() => r.hitsOn(a).some((h) => h.by === 'auto'), 8);
    const at = { x: e.x, z: e.z };
    r.at(r.now + 1);
    expect(dist(e, at)).toBeLessThan(0.5);
  });

  it('a Gore Charge that ends past the leash sends the boar home', () => {
    const r = new Rig([camp('boar')], { half: 100 });
    const e = r.enemy('boar');
    const a = r.add(0, -2);
    r.tick();
    only(e, null, 0);
    // lead it out to 19 m, then let it charge outward
    let z = -2;
    r.until(() => e.z < -18, 10, () => { z = Math.max(z - 4 / 15, -21); r.move(a, 0, z); });
    only(e, 'gore_charge', r.now);
    r.until(() => e.windup !== null, 1);
    r.until(() => e.windup === null, 2);
    expect(dist(e, e.camp)).toBeGreaterThan(25);
    r.tick();
    expect(e.act).toBe('return');
  });
});

// ═════════ fix round 2 ═════════
describe('the chase surge ends only on a landed hit (fix round 2)', () => {
  function ring(kind: EnemyKindId) {
    const r = new Rig([camp(kind)]);
    const e = r.enemy(kind);
    const a = r.add(0, -10, BOW);
    r.i(a, { t: 'target', id: e.id });
    let ang = Math.PI;
    r.at(20, () => { ang += RUN_SPEED / 10 / 15; r.move(a, 10 * Math.sin(ang), 10 * Math.cos(ang)); });
    const taken = r.hitsOn(a).reduce((s, h) => s + h.amount + h.absorbed, 0);
    const dealt = r.fx('hit').filter((h) => h.src === a).reduce((s, h) => s + h.amount, 0);
    return { taken, dealt, hits: r.hitsOn(a).length };
  }
  it('a Bow running 10 m circles round the camp at full speed is caught and hit by a Boar and a Thornling', () => {
    // measured over 20 s: Boar 2 hits (12 taken, 112 dealt), Thornling 2 hits (10 taken, 140 dealt); their
    // telegraphs (useRange beyond auto reach) still root them while surging, so the kite is taxed, not stopped
    for (const kind of ['boar', 'thornling'] as const) {
      const k = ring(kind);
      expect(k.hits, kind).toBeGreaterThanOrEqual(2);
      expect(k.taken, kind).toBeGreaterThanOrEqual(10);
    }
  });

  it('a surging enemy with its target in auto reach autos instead of starting a telegraph, and a dodged swing does not end the surge', () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling');
    const a = r.add(0, -2);
    r.tick();
    e.surging = true;
    only(e, 'thorn_burst', r.now); // ready, and the target is within its useRange
    const ai = enemyAiStateOf(e)!;
    ai.nextAutoAt = r.now;
    const A = r.w.adventurers.get(a)!;
    A.iframeUntil = r.now + 0.2; // the swing will be dodged
    r.tick();
    expect(e.windup).toBeNull();
    expect(r.fx('miss')).toHaveLength(1);
    expect(e.surging).toBe(true);
  });

  it('a player who stops and fights sees the surge end on the first landed hit', () => {
    const r = new Rig([camp('thornling')], { half: 200 });
    const e = r.enemy('thornling');
    const a = r.add(0, -6.5);
    r.tick();
    let z = -6.5;
    r.until(() => e.surging, SURGE_AFTER_S + 0.5, () => { z -= 5.5 / 15; r.move(a, 0, z); });
    let endedAt: number | null = null;
    r.until(() => !e.surging, 6, () => { endedAt = r.now; });
    const first = r.hitsOn(a).filter((h) => h.amount + h.absorbed > 0)[0];
    expect(first).toBeDefined();
    expect(first.at).toBeCloseTo(endedAt!, 6);
  });
});

describe('Thorn Hail is aimed at the farthest engaged adventurer in range (fix round 2)', () => {
  it('the cone points at the far player, not the threat target in melee', () => {
    const r = new Rig([camp('mossback')]);
    const e = r.enemy('mossback');
    const near = r.add(0, -3), far = r.add(9, 0, BOW);
    r.tick();
    e.threat.add(near, 500);
    e.threat.add(far, 1);
    only(e, 'thorn_hail', r.now);
    r.tick();
    expect(e.targetId).toBe(near);
    const tg = [...r.c.telegraphs()][0];
    expect(tg.attack).toBe('thorn_hail');
    expect((tg.shape as { dir: number }).dir).toBeCloseTo(Math.atan2(9 - e.x, 0 - e.z), 6);
  });
  it('out of its range the far player is ignored: aimed at the nearer one', () => {
    const r = new Rig([camp('mossback')]);
    const e = r.enemy('mossback');
    const near = r.add(0, -3), far = r.add(30, 0, BOW);
    r.tick();
    e.threat.add(near, 500);
    e.threat.add(far, 1);
    only(e, 'thorn_hail', r.now);
    r.tick();
    const tg = [...r.c.telegraphs()][0];
    expect((tg.shape as { dir: number }).dir).toBeCloseTo(Math.atan2(0 - e.x, -3 - e.z), 6);
  });
});
