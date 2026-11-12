import { describe, expect, it } from 'vitest';
import { createCombat, worldOf, type CampSpawn, type Combat, type CombatZone, type Intent, type TickOut } from './engine';
import { hurtAdventurer, isInCombat, isInvulnerable, knockAdventurer } from './adventurer';
import { DEFAULT_LOADOUT, type Loadout } from './abilities';
import { hitDamage } from './stats';
import type { FxEvent } from './fx';
import type { EnemyKindId } from './enemies';
import { COMBAT_TIMEOUT_S } from './constants';

// ───────── a flat synthetic zone and a 15 Hz test rig ─────────
interface Wall { x: number; z: number; r: number }
function zone(camps: CampSpawn[], walls: Wall[] = []): CombatZone {
  const inWall = (x: number, z: number) => walls.some((w) => Math.hypot(x - w.x, z - w.z) <= w.r);
  const surface = (x: number, z: number) => (Math.abs(x) <= 50 && Math.abs(z) <= 50 && !inWall(x, z) ? 0 : null);
  return { surface, ground: surface, sight: (x, z) => !inWall(x, z), camps };
}
const camp = (kind: EnemyKindId, x = 0, z = 0): CampSpawn => ({ kind, x, z, facing: 0 });
const BOW: Loadout = { job: 'ranger', picks: ['field_dressing', 'pinning_shot'] };
const r3 = (n: number) => Math.round(n * 1000) / 1000;

class Rig {
  readonly c: Combat;
  /** Index of the next tick, at k / 15 s. Intents sent now land just before that tick. */
  k = 0;
  readonly log: { t: number; ev: FxEvent }[] = [];
  readonly outs: TickOut[] = [];
  constructor(camps: CampSpawn[], walls: Wall[] = [], seed = 1) {
    this.c = createCombat(zone(camps, walls), { seed, nowS: 0 });
    // These are the adventurer-side rules: enemies are held still (stunned for good), so the enemy AI
    // (enemyAi.ts, tested in enemyAi.test.ts) neither moves them nor fights back.
    for (const e of worldOf(this.c).enemies.values()) { e.act = 'stun'; e.actUntil = Infinity; }
  }
  get now() { return this.k / 15; }
  enemy(kind: EnemyKindId): number {
    for (const v of this.c.all()) if (v.kind === kind) return v.id;
    throw new Error(`no ${kind}`);
  }
  add(x: number, z: number, loadout: Loadout = DEFAULT_LOADOUT, hp = 100, facing = 0): number {
    return this.c.addAdventurer({ x, z, y: 0, facing, hp, loadout }, this.now);
  }
  tick(): TickOut {
    const out = this.c.tick(this.now);
    for (const ev of out.fx) this.log.push({ t: r3(this.now), ev });
    this.outs.push(out);
    this.k++;
    return out;
  }
  /** Runs every tick before `s`, so the next tick is at s. */
  at(s: number): this {
    const end = Math.round(s * 15);
    while (this.k < end) this.tick();
    return this;
  }
  i(id: number, i: Intent) { return this.c.intent(id, i, this.now); }
  press(id: number, slot: number) { return this.i(id, { t: 'ability', slot, phase: 'press' }); }
  release(id: number, slot: number) { return this.i(id, { t: 'ability', slot, phase: 'release' }); }
  move(id: number, x: number, z: number) { this.c.setPose(id, x, z, 0, 0); }
  /** Logged fx, plus the ones intents queued for the next tick (stamped now). */
  entries() {
    return [...this.log, ...worldOf(this.c).out.fx.map((ev) => ({ t: r3(this.now), ev }))];
  }
  hits(src?: number) {
    return this.entries().flatMap((l) => (l.ev.t === 'hit' && (src === undefined || l.ev.src === src) ? [{ at: l.t, ...l.ev }] : []));
  }
  fx<T extends FxEvent['t']>(t: T) {
    return this.entries().flatMap((l) => (l.ev.t === t ? [{ at: l.t, ...(l.ev as Extract<FxEvent, { t: T }>) }] : []));
  }
}
const dodge = (dx: number, dz: number, from = { x: 0, z: 0, y: 0 }, grounded = true): Intent => ({ t: 'dodge', dx, dz, from, grounded });

// ───────── autos ─────────
describe('autos', () => {
  it('a Blade in reach of a Thornling hits 9 at 0, 1.2, 2.4 and 3.6 s and builds 40 Momentum', () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling'), a = r.add(0, -2.5);
    expect(r.i(a, { t: 'target', id: e })).toBeNull();
    r.at(4.5);
    expect(r.hits(a).map((h) => [h.at, h.amount, h.by])).toEqual([[0, 9, 'auto'], [1.2, 9, 'auto'], [2.4, 9, 'auto'], [3.6, 9, 'auto']]);
    expect(r.c.self(a)!.momentum).toBe(40);
    expect(r.c.get(e)!.hp).toBe(210 - 36);
    expect(r.c.get(a)!.targetId).toBe(e);
  });

  it('out of reach the timer waits; walking into reach swings on the next tick', () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling'), a = r.add(0, -3.2); // reach 2.7 > 2.5 (autos have no fuzz)
    expect(r.i(a, { t: 'target', id: e })).toBeNull();
    r.at(3);
    expect(r.hits(a)).toEqual([]);
    r.move(a, 0, -2.9);
    r.tick();
    expect(r.hits(a).map((h) => h.at)).toEqual([3]);
    r.at(5);
    expect(r.hits(a).map((h) => h.at)).toEqual([3, 4.2]);
  });

  it('a Bow auto reaches 18 m and hits 10 against defence 6', () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling'), a = r.add(0, -18.5, BOW), b = r.add(5, -19, BOW);
    r.i(a, { t: 'target', id: e });
    r.i(b, { t: 'target', id: e });
    r.at(3.1);
    // 1.5 s is between ticks: the swing lands on the next one, and the cadence stays on 1.5 s steps
    expect(r.hits(a).map((h) => [h.at, h.amount])).toEqual([[0, 10], [1.533, 10], [3, 10]]);
    expect(r.hits(b)).toEqual([]); // reach ≈ 19.1
  });
});

// ───────── targeting ─────────
describe('targeting', () => {
  it('needs a live enemy within TARGET_RANGE and is dropped past TARGET_DROP_RANGE', () => {
    const r = new Rig([camp('thornling'), camp('dummy', 30, 30)]);
    const e = r.enemy('thornling'), a = r.add(0, -20), b = r.add(0, -45);
    expect(r.i(a, { t: 'target', id: 9999 })).toBe('invalid');
    expect(r.i(a, { t: 'target', id: b })).toBe('invalid'); // an adventurer
    expect(r.i(a, { t: 'target', id: Number.NaN })).toBe('invalid');
    expect(r.i(b, { t: 'target', id: e })).toBe('range'); // reach 44.5
    expect(r.i(a, { t: 'target', id: e })).toBeNull();
    expect(r.i(a, { t: 'target', id: null })).toBeNull();
    expect(r.c.get(a)!.targetId).toBeNull();
    r.i(a, { t: 'target', id: e });
    r.move(a, 0, -45); // reach 44.5: kept
    r.tick();
    expect(r.c.get(a)!.targetId).toBe(e);
    r.move(a, 0, -50.6); // reach 50.1: dropped
    r.tick();
    expect(r.c.get(a)!.targetId).toBeNull();
  });
});

// ───────── abilities ─────────
describe('abilities', () => {
  it('Slash: 16 and +20 Momentum, then cooldown 4 s', () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling'), a = r.add(0, -2.5);
    r.i(a, { t: 'target', id: e });
    expect(r.press(a, 0)).toBeNull();
    r.tick(); // the auto at 0 as well
    expect(r.hits(a).map((h) => [h.by, h.amount])).toEqual([['slash', 16], ['auto', 9]]);
    expect(r.c.self(a)!.momentum).toBe(30);
    expect(r.fx('use').map((u) => [u.ability, u.dst])).toEqual([['slash', e]]);
    r.at(3.8);
    expect(r.press(a, 0)).toBe('cooldown');
    expect(r.c.self(a)!.cd[0]).toBeCloseTo(0.2, 6);
    r.at(4);
    expect(r.press(a, 0)).toBeNull();
  });

  it('Slash range allows RANGE_FUZZ: refused at reach 3.6, accepted at 3.4', () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling'), a = r.add(0, -4.1);
    r.i(a, { t: 'target', id: e });
    expect(r.press(a, 0)).toBe('range');
    r.move(a, 0, -3.9);
    expect(r.press(a, 0)).toBeNull();
  });

  it('Slash is refused behind a wall', () => {
    const r = new Rig([camp('thornling')], [{ x: 0, z: -1.75, r: 0.3 }]);
    const e = r.enemy('thornling'), a = r.add(0, -3.5);
    r.i(a, { t: 'target', id: e });
    expect(r.press(a, 0)).toBe('sight');
    r.move(a, 3.5, 0);
    expect(r.press(a, 0)).toBeNull();
  });

  it('a second ability within the 0.5 s GCD is refused', () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling'), a = r.add(0, -2.5);
    r.i(a, { t: 'target', id: e });
    expect(r.press(a, 0)).toBeNull();
    r.at(0.4);
    expect(r.press(a, 2)).toBe('cooldown');
    expect(r.c.self(a)!.gcd).toBeCloseTo(0.1, 6);
    r.at(0.5);
    expect(r.press(a, 2)).toBeNull(); // Parry
  });

  it('bad slots and phases are invalid; no target is no-target', () => {
    const r = new Rig([camp('thornling')]);
    const a = r.add(0, -2.5);
    expect(r.press(a, 5)).toBe('invalid');
    expect(r.press(a, -1)).toBe('invalid');
    expect(r.press(a, 1.5)).toBe('invalid');
    expect(r.i(a, { t: 'ability', slot: 0, phase: 'hold' as 'press' })).toBe('invalid');
    expect(r.release(a, 0)).toBe('invalid'); // not a hold ability
    expect(r.i(a, { t: 'nonsense' } as unknown as Intent)).toBe('invalid');
    expect(r.press(a, 0)).toBe('no-target');
    expect(r.c.intent(12345, { t: 'job', job: 'ninja', picks: ['mist_form', 'ashcloud'] }, 0)).toBe('invalid'); // unknown adventurer
  });

  it('Sunder: refused below 50 Momentum; at 60 it deals 35, leaves 10 and marks', () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling'), a = r.add(0, -2.5);
    r.i(a, { t: 'target', id: e });
    r.at(3.6 + 1 / 15); // four autos
    expect(r.c.self(a)!.momentum).toBe(40);
    expect(r.press(a, 1)).toBe('momentum');
    expect(r.press(a, 0)).toBeNull(); // Slash: 60
    r.at(4.2);
    expect(r.press(a, 1)).toBeNull();
    const sunder = r.hits(a).at(-1);
    expect([sunder?.by, sunder?.amount, sunder?.combo]).toEqual(['sunder', 35, undefined]);
    expect(r.c.self(a)!.momentum).toBe(10);
    r.tick();
    expect(r.fx('mark').map((m) => [m.dst, m.mark, m.on])).toEqual([[e, 'marked', true]]);
    expect(r.c.get(e)!.marks).toBe(4);
    expect(r.c.get(e)!.hp).toBe(210 - 36 - 16 - 35);
  });

  it('Mend heals 30 but never above the maximum; Bulwark absorbs first, for 6 s', () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling'), a = r.add(0, -2.5);
    const w = worldOf(r.c), adv = w.adventurers.get(a)!;
    expect(r.c.damage(a, 20, r.now, 'fall')).toBe(20);
    expect(r.press(a, 3)).toBeNull(); // Mend
    r.tick();
    expect(r.c.get(a)!.hp).toBe(100);
    expect(r.fx('heal').map((h) => h.amount)).toEqual([20]);
    r.at(1);
    expect(r.press(a, 4)).toBeNull(); // Bulwark
    expect(r.c.get(a)!.shield).toBe(25);
    expect(hurtAdventurer(w, adv, 30, e, 'auto', r.now)).toEqual({ taken: 5, absorbed: 25 });
    expect(r.c.get(a)!.hp).toBe(95);
    expect(r.c.get(a)!.shield).toBe(0);
    r.at(20);
    expect(r.press(a, 4)).toBeNull();
    r.at(25.9);
    expect(r.c.get(a)!.shield).toBe(25);
    r.at(26.1);
    expect(r.c.get(a)!.shield).toBe(0);
  });

  it('Sprint: speedScale 1.4 for SPRINT_S + SPEED_GRACE_S (4.5 s)', () => {
    const r = new Rig([]);
    const a = r.add(0, 0, { job: 'ranger', picks: ['sprint', 'field_dressing'] });
    expect(r.c.speedScale(a, 0)).toBe(1);
    expect(r.press(a, 3)).toBeNull();
    expect(r.c.speedScale(a, 0)).toBe(1.4);
    expect(r.c.speedScale(a, 4.45)).toBe(1.4);
    expect(r.c.speedScale(a, 4.55)).toBe(1);
  });

  it('Taunt makes the taunter the forced target with top × 1.1 + 10 threat', () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling');
    const a = r.add(0, -2.5), b = r.add(0, -10, { job: 'paladin', picks: ['taunt', 'kindle'] });
    r.i(a, { t: 'target', id: e });
    r.at(1); // one auto: threat 9
    r.i(b, { t: 'target', id: e });
    expect(r.press(b, 3)).toBeNull();
    const t = worldOf(r.c).enemies.get(e)!.threat;
    expect(t.choose(a, r.now, () => true)).toBe(b);
    expect(t.has(b)).toBe(true);
    expect(r.c.self(b)!.inCombat).toBe(true);
  });
});

// ───────── marks and combos (two adventurers: no swapping in combat) ─────────
describe('combos', () => {
  it('Bow’s Pitch Arrow detonates Blade’s Marked; then only Burning, ticking 2 a second', () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling');
    const a = r.add(0, -2.5), b = r.add(0, -10, BOW);
    r.i(a, { t: 'target', id: e });
    r.i(b, { t: 'target', id: e });
    expect(r.press(b, 0)).toBeNull(); // Snap Shot: 17, +20
    r.at(3.6 + 1 / 15);
    r.press(a, 0); // Slash: A at 60
    r.at(4.2);
    expect(r.press(a, 1)).toBeNull(); // Sunder: Marked
    r.at(4.4);
    expect(r.c.self(b)!.momentum).toBe(50);
    expect(r.press(b, 1)).toBeNull(); // Pitch Arrow
    r.i(a, { t: 'target', id: null });
    r.i(b, { t: 'target', id: null });
    const pitch = r.hits(b).at(-1)!;
    expect(pitch.by).toBe('pitch_arrow');
    expect(pitch.combo).toEqual(['marked']);
    expect(pitch.amount).toBe(hitDamage(3.2, 10, 6) + hitDamage(3, 10, 6));
    expect(pitch.amount).toBe(28 + 26);
    expect(r.c.self(b)!.momentum).toBe(0);
    r.tick();
    expect(r.c.get(e)!.marks).toBe(2); // burning only
    expect(r.fx('mark').map((m) => [m.mark, m.on])).toEqual([['marked', true], ['marked', false], ['burning', true]]);
    const hpAfter = r.c.get(e)!.hp;
    r.at(12.5);
    const burns = r.hits().filter((h) => h.by === 'burning');
    expect(burns.map((h) => [h.at, h.amount, h.src])).toEqual([5.4, 6.4, 7.4, 8.4, 9.4, 10.4, 11.4, 12.4].map((t) => [t, 2, b]));
    expect(r.c.get(e)!.hp).toBe(hpAfter - 16);
    expect(r.c.get(e)!.marks).toBe(0);
    expect(r.fx('mark').at(-1)).toMatchObject({ mark: 'burning', on: false });
  });

  it('Blade’s Sunder detonates Bow’s Burning, which then stops ticking', () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling');
    const a = r.add(0, -2.5), b = r.add(0, -10, BOW);
    r.i(a, { t: 'target', id: e });
    r.i(b, { t: 'target', id: e });
    r.press(b, 0);
    r.at(3);
    r.at(3 + 1 / 15);
    expect(r.press(b, 1)).toBeNull(); // Pitch Arrow at 50: Burning
    r.at(3.6 + 1 / 15);
    r.press(a, 0);
    r.at(4.2);
    expect(r.press(a, 1)).toBeNull(); // Sunder
    r.i(a, { t: 'target', id: null });
    r.i(b, { t: 'target', id: null });
    const sunder = r.hits(a).at(-1)!;
    expect([sunder.by, sunder.combo, sunder.amount]).toEqual(['sunder', ['burning'], 35 + 26]);
    r.at(10);
    expect(r.hits().filter((h) => h.by === 'burning').map((h) => h.at)).toEqual([4.067]); // only the one before the detonation
    expect(r.c.get(e)!.marks).toBe(4);
  });
});

// ───────── Charged Shot ─────────
describe('Charged Shot', () => {
  const setup = () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling'), a = r.add(0, -10, BOW);
    r.i(a, { t: 'target', id: e });
    return { r, e, a };
  };

  it('released after 0.75 s: frac 0.5, 26 damage, 7.5 Momentum; no autos while charging', () => {
    const { r, e, a } = setup();
    expect(r.press(a, 2)).toBeNull();
    expect(r.c.get(a)!.act).toBe('charge');
    expect(r.press(a, 2)).toBe('busy');
    r.at(0.6);
    expect(r.c.self(a)!.charge).toBeCloseTo(8 / 15, 6); // seconds held, at the last tick
    expect(r.hits(a)).toEqual([]);
    expect(r.c.intent(a, { t: 'ability', slot: 2, phase: 'release' }, 0.75)).toBeNull();
    expect(r.hits(a).map((h) => [h.by, h.amount])).toEqual([['charged_shot', hitDamage(3.0, 10, 6)]]);
    expect(hitDamage(3.0, 10, 6)).toBe(26);
    expect(r.fx('use').at(-1)).toMatchObject({ ability: 'charged_shot', dst: e, frac: 0.5 });
    expect(r.c.self(a)!.momentum).toBe(7.5);
    expect(r.c.self(a)!.charge).toBeNull();
    expect(r.c.self(a)!.cd[2]).toBe(7);
    expect(r.release(a, 2)).toBe('invalid'); // a release without a press
  });

  it('fires itself at 2.5 s with frac 1', () => {
    const { r, a } = setup();
    r.press(a, 2);
    r.at(2.6);
    expect(r.fx('use').map((u) => [u.at, u.frac])).toEqual([[2.533, 1]]);
    expect(r.hits(a)[0]).toMatchObject({ by: 'charged_shot', amount: hitDamage(4.5, 10, 6) });
  });

  it('a dodge cancels it with no cooldown', () => {
    const { r, a } = setup();
    r.press(a, 2);
    r.at(0.6);
    expect(r.i(a, dodge(1, 0, { x: 0, z: -10, y: 0 }))).toBeNull();
    expect(r.c.self(a)!.charge).toBeNull();
    expect(r.c.self(a)!.cd[2]).toBe(0);
    r.at(3);
    expect(r.fx('use')).toEqual([]);
    expect(r.press(a, 2)).toBeNull();
  });

  it('slows to 0.4 from 0.25 s into the charge', () => {
    const { r, a } = setup();
    r.press(a, 2);
    expect(r.c.speedScale(a, 0.2)).toBe(1);
    expect(r.c.speedScale(a, 0.25)).toBe(0.4);
    expect(r.c.speedScale(a, 1)).toBe(0.4);
    r.at(1);
    r.release(a, 2);
    expect(r.c.speedScale(a, 1)).toBe(1);
  });
});

// (Plan 3's weapon swap is gone: jobs change in towns, jobsEngine.test.ts.)

// ───────── dodge ─────────
describe('dodge', () => {
  it('moves 4.5 m on flat ground at once, with i-frames, and emits a dodge DisplaceOut', () => {
    const r = new Rig([]);
    const a = r.add(0, 0);
    expect(r.i(a, dodge(1, 0))).toBeNull();
    const v = r.c.get(a)!;
    expect(v.x).toBeCloseTo(4.5, 9);
    expect([v.z, v.act]).toEqual([0, 'dodge']);
    expect(isInvulnerable(worldOf(r.c).adventurers.get(a)!, 0.34)).toBe(true);
    expect(isInvulnerable(worldOf(r.c).adventurers.get(a)!, 0.36)).toBe(false);
    expect(r.press(a, 2)).toBe('busy');
    const out = r.tick();
    expect(out.displaced).toHaveLength(1);
    const d = out.displaced[0];
    expect([d.id, d.kind, d.from]).toEqual([a, 'dodge', { x: 0, z: 0, y: 0 }]);
    expect(Math.hypot(d.result.x, d.result.z)).toBeCloseTo(4.5, 9);
    expect(d.d.seconds).toBe(0.3);
    expect(out.fx).toContainEqual({ t: 'dodge', src: a });
    r.at(0.4);
    expect(r.c.get(a)!.act).toBe('');
  });

  it('has 2 charges refilling one at a time every 5 s, and a 0.4 s minimum gap', () => {
    const r = new Rig([]);
    const a = r.add(0, 0);
    expect(r.i(a, dodge(1, 0))).toBeNull();
    r.at(0.333);
    expect(r.i(a, dodge(1, 0, { x: 4.5, z: 0, y: 0 }))).toBe('cooldown');
    r.at(0.5);
    expect(r.i(a, dodge(1, 0, { x: 4.5, z: 0, y: 0 }))).toBeNull();
    r.at(1);
    expect(r.i(a, dodge(1, 0, { x: 9, z: 0, y: 0 }))).toBe('charges');
    expect(r.c.self(a)!.dodgeCharges).toBe(0);
    expect(r.c.self(a)!.dodgeNextIn).toBeCloseTo(4, 6);
    r.at(4.933);
    expect(r.c.self(a)!.dodgeCharges).toBe(0);
    r.at(5.067);
    expect(r.c.self(a)!.dodgeCharges).toBe(1);
    expect(r.c.self(a)!.dodgeNextIn).toBeCloseTo(5, 6); // as of the last tick, at 5.0
    r.at(10.067);
    expect(r.c.self(a)!.dodgeCharges).toBe(2);
    expect(r.c.self(a)!.dodgeNextIn).toBe(0);
  });

  it('needs the ground, uses the facing for a zero direction, and rejects nonsense', () => {
    const r = new Rig([]);
    const a = r.add(0, 0, DEFAULT_LOADOUT, 100, Math.PI / 2);
    expect(r.i(a, dodge(1, 0, { x: 0, z: 0, y: 1 }, false))).toBe('air');
    expect(r.i(a, dodge(Number.NaN, 0))).toBe('invalid');
    expect(r.i(a, dodge(1, 0, { x: Number.POSITIVE_INFINITY, z: 0, y: 0 }))).toBe('invalid');
    // a start with no surface: the simulation is not grounded, so nothing moves and nothing is spent
    expect(r.i(a, dodge(1, 0, { x: 60, z: 0, y: 0 }))).toBe('invalid');
    const w = worldOf(r.c);
    r.move(a, 70, 0);
    expect(knockAdventurer(w, w.adventurers.get(a)!, { vx: 10, vz: 0, vy: 4, seconds: 0.35 }, r.now)).toBeNull();
    expect([r.c.get(a)!.x, r.c.get(a)!.act]).toEqual([70, '']);
    r.c.setPose(a, 0, 0, 0, Math.PI / 2);
    expect(r.c.self(a)!.dodgeCharges).toBe(2);
    expect(r.i(a, dodge(0, 0))).toBeNull();
    expect(r.c.get(a)!.x).toBeCloseTo(4.5, 9);
    expect(r.c.get(a)!.z).toBeCloseTo(0, 9);
  });

  it('stops at a wall', () => {
    const r = new Rig([], [{ x: 3, z: 0, r: 1 }]);
    const a = r.add(0, 0);
    r.i(a, dodge(1, 0));
    expect(r.c.get(a)!.x).toBeLessThan(2.01);
    expect(r.c.get(a)!.x).toBeGreaterThan(1.85);
  });
});

// ───────── knock (the helper Task 3 calls) ─────────
describe('knock', () => {
  it('displaces, cancels a charge, and makes the adventurer busy for the push plus KNOCK_RECOVER_S', () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling'), a = r.add(0, -10, BOW);
    r.i(a, { t: 'target', id: e });
    r.press(a, 2);
    const w = worldOf(r.c);
    const out = knockAdventurer(w, w.adventurers.get(a)!, { vx: 0, vz: -10, vy: 4, seconds: 0.35 }, r.now);
    expect(out?.kind).toBe('knock');
    expect(r.c.self(a)!.charge).toBeNull();
    expect(r.c.get(a)!.act).toBe('knock');
    expect(r.c.get(a)!.z).toBeCloseTo(-13.5, 6);
    expect(r.press(a, 0)).toBe('busy');
    const t = r.tick();
    expect(t.displaced.map((d) => d.kind)).toEqual(['knock']);
    r.at(1);
    expect(r.c.get(a)!.act).toBe('');
  });
});

// ───────── death and revive ─────────
describe('death', () => {
  it('lethal combat damage: died, act dead, every intent refused, no autos; revive resets', () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling'), a = r.add(0, -2.5);
    const w = worldOf(r.c);
    r.i(a, { t: 'target', id: e });
    r.press(a, 0);
    r.tick();
    expect(w.enemies.get(e)!.threat.has(a)).toBe(true);
    hurtAdventurer(w, w.adventurers.get(a)!, 150, e, 'thorn_burst', r.now);
    const out = r.tick();
    expect(out.died).toEqual([a]);
    expect(out.fx).toContainEqual({ t: 'death', dst: a });
    const v = r.c.get(a)!;
    expect([v.alive, v.act, v.hp, v.targetId]).toEqual([false, 'dead', 0, null]);
    expect(w.enemies.get(e)!.threat.has(a)).toBe(false);
    for (const i of [
      { t: 'target', id: e }, { t: 'ability', slot: 0, phase: 'press' }, { t: 'job', job: 'ninja', picks: ['mist_form', 'ashcloud'] },
      dodge(1, 0, { x: 0, z: -2.5, y: 0 }), { t: 'loadout', picks: ['rallying_roar', 'skullringer'] },
    ] as Intent[]) expect(r.i(a, i)).toBe('dead');
    const before = r.hits(a).length;
    r.at(5);
    expect(r.hits(a)).toHaveLength(before);
    expect(r.c.damage(a, 10, r.now, 'fall')).toBe(0);

    r.c.revive(a, { x: 5, z: 6, y: 0 }, r.now);
    const s = r.c.self(a)!, g = r.c.get(a)!;
    expect([g.alive, g.act, g.hp, g.x, g.z]).toEqual([true, '', 100, 5, 6]);
    expect([s.momentum, s.dodgeCharges, s.gcd, s.charge, s.inCombat]).toEqual([0, 2, 0, null, false]);
    expect(s.cd).toEqual([0, 0, 0, 0, 0]);
  });

  it('fall damage never takes the last hp and ignores i-frames and shields', () => {
    const r = new Rig([]);
    const a = r.add(0, 0);
    r.press(a, 4); // Bulwark
    r.i(a, dodge(1, 0));
    expect(r.c.damage(a, 30, r.now, 'fall')).toBe(30);
    expect(r.c.get(a)!.shield).toBe(25);
    expect(r.c.damage(a, 500, r.now, 'fall')).toBe(69);
    expect(r.c.get(a)!.hp).toBe(1);
    expect(r.c.damage(a, 5, r.now, 'fall')).toBe(0);
    expect(r.c.damage(a, Number.NaN, r.now, 'fall')).toBe(0);
    const out = r.tick();
    expect(out.died).toEqual([]);
    expect(r.c.get(a)!.alive).toBe(true);
  });
});

// ───────── in combat and regen ─────────
describe('in combat and regen', () => {
  it('isInCombat: on a threat table, or combat damage within COMBAT_TIMEOUT_S', () => {
    expect(isInCombat(-Infinity, true, 0)).toBe(true);
    expect(isInCombat(10, false, 10 + COMBAT_TIMEOUT_S - 0.01)).toBe(true);
    expect(isInCombat(10, false, 10 + COMBAT_TIMEOUT_S)).toBe(false);
    expect(isInCombat(-Infinity, false, 0)).toBe(false);
  });

  it('no regen in combat; HP_REGEN_PER_S once out of combat and HP_REGEN_DELAY_S after damage', () => {
    const r = new Rig([camp('dummy'), camp('thornling', 30, 0)]);
    const d = r.enemy('dummy'), a = r.add(0, -2.5), b = r.add(30, -2.5);
    r.c.damage(a, 40, r.now, 'fall');
    r.c.damage(b, 40, r.now, 'fall');
    r.i(a, { t: 'target', id: d });
    r.i(b, { t: 'target', id: r.enemy('thornling') });
    r.at(8.6); // the dummy died at 3.6; a is in combat until 8.6
    expect(r.c.get(a)!.hp).toBe(60);
    r.at(10.6);
    expect(r.c.get(a)!.hp).toBeCloseTo(64, 0);
    r.at(20);
    expect(r.c.get(b)!.hp).toBe(60); // still on the passive Thornling's threat table
    expect(r.c.self(b)!.inCombat).toBe(true);

    const r2 = new Rig([]);
    const c = r2.add(0, 0);
    r2.c.damage(c, 50, 0, 'fall');
    r2.at(6);
    expect(r2.c.get(c)!.hp).toBe(50);
    r2.at(8 + 1 / 15);
    expect(r2.c.get(c)!.hp).toBeCloseTo(54, 6);
    r2.at(40);
    expect(r2.c.get(c)!.hp).toBe(100);
  });

  it('loadout is refused in combat and accepted 5 s after it', () => {
    const r = new Rig([camp('dummy')]);
    const d = r.enemy('dummy'), a = r.add(0, -2.5);
    r.i(a, { t: 'target', id: d });
    r.tick();
    expect(r.i(a, { t: 'loadout', picks: ['skullringer', 'rallying_roar'] })).toBe('in-combat');
    r.at(8.6 - 1 / 15);
    expect(r.i(a, { t: 'loadout', picks: ['skullringer', 'rallying_roar'] })).toBe('in-combat');
    expect(r.i(a, { t: 'loadout', picks: ['skullringer', 'skullringer'] })).toBe('invalid');
    expect(r.i(a, { t: 'loadout', picks: ['slash', 'skullringer'] })).toBe('invalid');
    r.at(8.6);
    expect(r.i(a, { t: 'loadout', picks: ['skullringer', 'rallying_roar'] })).toBeNull();
    expect(r.c.jobLoadout(a)).toEqual({ job: 'warrior', picks: ['skullringer', 'rallying_roar'] });
    expect(r.c.self(a)!.slots).toEqual(['slash', 'sunder', 'parry', 'skullringer', 'rallying_roar']);
  });
});

// ───────── kills and respawns ─────────
describe('kills', () => {
  it('a dummy killed: kills with credit, target dropped, respawn after 5 s but not with an adventurer within 6 m', () => {
    const r = new Rig([camp('dummy')]);
    const d = r.enemy('dummy'), a = r.add(0, -2.5), far = r.add(0, -20);
    r.i(a, { t: 'target', id: d });
    r.i(far, { t: 'target', id: d });
    r.at(3.6);
    const out = r.tick();
    expect(out.kills).toEqual([{ enemy: d, kind: 'dummy', credit: [a] }]);
    expect(r.c.get(d)!).toMatchObject({ alive: false, act: 'dead', hp: 0 });
    expect(r.c.get(a)!.targetId).toBeNull();
    expect(r.c.get(far)!.targetId).toBeNull();
    expect(r.i(a, { t: 'target', id: d })).toBe('no-target');
    r.at(12);
    expect(r.c.get(d)!.alive).toBe(false);
    r.move(a, 0, -7);
    r.at(13);
    expect(r.c.get(d)!).toMatchObject({ alive: true, hp: 40, act: '', x: 0, z: 0 });
    expect(r.fx('spawn')).toHaveLength(1);
    expect(r.fx('spawn')[0].at).toBeGreaterThan(12);
  });

  it('with nobody near, it is back exactly respawn s after dying', () => {
    const r = new Rig([camp('dummy')]);
    const d = r.enemy('dummy'), a = r.add(0, -2.5);
    r.i(a, { t: 'target', id: d });
    r.at(3.6 + 1 / 15);
    r.move(a, 0, -10);
    r.at(9);
    expect(r.fx('spawn').map((s) => [s.at, s.dst])).toEqual([[8.6, d]]);
  });

  it('removeAdventurer drops it from every threat table', () => {
    const r = new Rig([camp('thornling')]);
    const e = r.enemy('thornling'), a = r.add(0, -2.5);
    r.i(a, { t: 'target', id: e });
    r.tick();
    expect(worldOf(r.c).enemies.get(e)!.threat.has(a)).toBe(true);
    r.c.removeAdventurer(a);
    expect(worldOf(r.c).enemies.get(e)!.threat.has(a)).toBe(false);
    expect(r.c.get(a)).toBeUndefined();
    expect(r.c.self(a)).toBeUndefined();
    expect(r.i(a, { t: 'job', job: 'ninja', picks: ['mist_form', 'ashcloud'] })).toBe('invalid');
    r.tick();
  });
});

// ───────── hooks for Task 3: wind-ups, interrupts, breaks ─────────
describe('wind-ups, interrupts and breaks', () => {
  const windup = (r: Rig, e: number, interruptible: boolean) => {
    const w = worldOf(r.c), en = w.enemies.get(e)!;
    const id = w.nextTelegraphId++;
    w.telegraphs.set(id, { id, owner: e, attack: 'thorn_hail', shape: { kind: 'circle', x: 0, z: 0, r: 3 }, startedAt: r.now, endsAt: r.now + 2.2 });
    en.windup = { attack: 'thorn_hail', startedAt: r.now, endsAt: r.now + 2.2, interruptible, telegraphId: id };
    return en;
  };

  it('Sunder cancels an interruptible wind-up; a non-interruptible one stays', () => {
    const r = new Rig([camp('mossback')]);
    const e = r.enemy('mossback'), a = r.add(0, -3.5);
    const en = windup(r, e, true);
    expect(r.c.get(e)!.windup).toMatchObject({ attack: 'thorn_hail', interruptible: true });
    expect([...r.c.telegraphs()]).toHaveLength(1);
    expect([...r.c.telegraphs()][0]).toMatchObject({ owner: e, attack: 'thorn_hail', left: 2.2 });
    r.i(a, { t: 'target', id: e });
    worldOf(r.c).adventurers.get(a)!.momentum = 50;
    expect(r.press(a, 1)).toBeNull();
    expect(en.windup).toBeNull();
    expect([...r.c.telegraphs()]).toHaveLength(0);
    expect(r.c.get(e)!.stagger).toBe(10 + 25);
    r.tick();
    expect(r.fx('interrupt')).toEqual([{ at: 0, t: 'interrupt', dst: e }]);

    const r2 = new Rig([camp('mossback')]);
    const e2 = r2.enemy('mossback'), a2 = r2.add(0, -3.5);
    const en2 = windup(r2, e2, false);
    r2.i(a2, { t: 'target', id: e2 });
    worldOf(r2.c).adventurers.get(a2)!.momentum = 50;
    r2.press(a2, 1);
    expect(en2.windup).not.toBeNull();
    expect(r2.c.get(e2)!.stagger).toBe(10);
  });

  it('a Charged Shot interrupts at frac 0.8 but not at 0.5', () => {
    for (const [held, cut] of [[1.2, true], [0.75, false]] as const) {
      const r = new Rig([camp('mossback')]);
      const e = r.enemy('mossback'), a = r.add(0, -10, BOW);
      r.i(a, { t: 'target', id: e });
      r.press(a, 2);
      r.at(held);
      const en = windup(r, e, true);
      r.release(a, 2);
      expect(en.windup === null).toBe(cut);
    }
  });

  it('a broken target takes ×1.5: a Blade auto on a Mossback deals 11 instead of 7', () => {
    const r = new Rig([camp('mossback')]);
    const e = r.enemy('mossback'), a = r.add(0, -3.5);
    r.i(a, { t: 'target', id: e });
    r.tick();
    const en = worldOf(r.c).enemies.get(e)!;
    en.stagger.value = 95;
    en.stagger.lastGainAt = r.now; // no decay for 4 s
    r.at(1.2);
    r.press(a, 0); // Slash 13 and 0 stagger: no break
    expect(en.stagger.value).toBe(95);
    worldOf(r.c).adventurers.get(a)!.momentum = 50;
    r.at(1.8);
    r.press(a, 1); // Sunder: 10 stagger breaks the bar
    r.at(2.4 + 1 / 15);
    expect(r.fx('break')).toEqual([{ at: 1.8, t: 'break', dst: e }]);
    expect(r.c.get(e)!.act).toBe('stun');
    expect(r.hits(a).map((h) => [h.by, h.amount])).toEqual([['auto', 7], ['slash', 13], ['auto', 7], ['sunder', 29], ['auto', 11]]);
    r.at(6);
    expect(r.c.get(e)!.act).toBe('');
  });
});

// ───────── determinism ─────────
describe('determinism', () => {
  const script = (seed: number) => {
    const r = new Rig([camp('thornling'), camp('boar', 10, 0), camp('mossback', -10, 10), camp('dummy', 20, 20)], [{ x: 5, z: 5, r: 1 }], seed);
    const a = r.add(0, -2.5), b = r.add(0, -12, BOW);
    const e = r.enemy('thornling'), m = r.enemy('mossback');
    r.i(a, { t: 'target', id: e });
    r.i(b, { t: 'target', id: e });
    for (let k = 0; k < 900; k++) {
      if (k % 7 === 0) for (let s = 0; s < 5; s++) { r.press(a, s); r.press(b, s); }
      if (k % 23 === 0) r.release(b, 2);
      if (k === 300) { r.i(a, { t: 'target', id: m }); r.move(a, -10, 7.5); }
      if (k === 450) r.i(a, dodge(0, 1, { x: -10, z: 7.5, y: 0 }));
      r.tick();
    }
    return JSON.stringify(r.outs);
  };
  it('the same seed and intents give identical TickOut streams over 60 s', () => {
    const one = script(7);
    expect(script(7)).toBe(one);
    expect(one.length).toBeGreaterThan(1000);
  });
});
