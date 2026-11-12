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
const snapshot = (r: Rig) => JSON.stringify({
  e: [...r.w.enemies.values()].map((e) => [e.id, e.x, e.z, e.y, e.facing, e.hp, e.act, e.actUntil, e.targetId, e.threat.ids(), e.stagger, e.marks, e.windup, e.attackReadyAt]),
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
