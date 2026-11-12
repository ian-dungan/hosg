// Engine review round 1: dead sources and threat, a monotonic clock, carry across a relog,
// idempotent kills, the auto cadence under tick jitter, and a break restarting the attack cooldown.
import { describe, expect, it } from 'vitest';
import { createCombat, worldOf, type CampSpawn, type CombatZone } from './engine';
import { applyStagger, hurtAdventurer, killEnemy } from './adventurer';
import { DEFAULT_LOADOUT, type Loadout } from './abilities';
import { ENEMY_ATTACKS } from './enemies';

const flat = (camps: CampSpawn[]): CombatZone => {
  const s = (x: number, z: number) => (Math.abs(x) <= 60 && Math.abs(z) <= 60 ? 0 : null);
  return { surface: s, ground: s, sight: () => true, camps };
};
const BOW: Loadout = { job: 'ranger', picks: ['field_dressing', 'pinning_shot'] };
const enemyId = (c: ReturnType<typeof createCombat>) => [...c.all()].find((v) => v.team === 'enemy')!.id;

describe('engine review round 1', () => {
  it("a dead adventurer's Burning still burns but adds no threat, no combat time and no kill credit", () => {
    const c = createCombat(flat([{ kind: 'dummy', x: 0, z: 10, facing: 0 }]), { seed: 1, nowS: 0 });
    const a = c.addAdventurer({ x: 0, z: 0, y: 0, facing: 0, hp: 100, loadout: BOW }, 0);
    const w = worldOf(c), A = w.adventurers.get(a)!, e = w.enemies.get(enemyId(c))!;
    e.hp = e.maxHp = 1000;
    c.intent(a, { t: 'target', id: e.id }, 0);
    A.momentum = 60;
    expect(c.intent(a, { t: 'ability', slot: 1, phase: 'press' }, 0)).toBeNull();
    hurtAdventurer(w, A, 999, e.id, 'auto', 0.1);
    expect(e.threat.has(a)).toBe(false);
    const hpBefore = e.hp;
    let t = 0.1;
    for (let k = 0; k < 45; k++) c.tick((t += 1 / 15));
    expect(e.hp).toBeLessThan(hpBefore); // it still burns
    expect(e.threat.has(a)).toBe(false);
    c.revive(a, { x: 40, z: 40, y: 0 }, t);
    for (let k = 0; k < 30; k++) c.tick((t += 1 / 15));
    expect(e.threat.has(a)).toBe(false);
    t = 12;
    c.tick(t);
    expect(c.self(a)!.inCombat).toBe(false);
    expect(c.intent(a, { t: 'loadout', picks: ['sprint', 'barbed_rain'] }, t)).toBeNull(); // out of combat
  });

  it('a dead source gets no kill credit from its Burning', () => {
    const c = createCombat(flat([{ kind: 'dummy', x: 0, z: 10, facing: 0 }]), { seed: 1, nowS: 0 });
    const a = c.addAdventurer({ x: 0, z: 0, y: 0, facing: 0, hp: 100, loadout: BOW }, 0);
    const w = worldOf(c), A = w.adventurers.get(a)!, e = w.enemies.get(enemyId(c))!;
    c.intent(a, { t: 'target', id: e.id }, 0);
    A.momentum = 60;
    c.intent(a, { t: 'ability', slot: 1, phase: 'press' }, 0);
    e.hp = 1;
    hurtAdventurer(w, A, 999, e.id, 'auto', 0.1);
    const kills = [];
    for (let k = 1; k <= 20; k++) kills.push(...c.tick(0.1 + k / 15).kills);
    expect(kills).toHaveLength(1);
    expect(kills[0].credit).toEqual([]);
  });

  it('the clock is monotonic: a stale or backwards nowS cannot bypass a cooldown', () => {
    const c = createCombat(flat([{ kind: 'dummy', x: 0, z: 2, facing: 0 }]), { seed: 1, nowS: 0 });
    const a = c.addAdventurer({ x: 0, z: 0, y: 0, facing: 0, hp: 50, loadout: DEFAULT_LOADOUT }, 0);
    c.tick(100);
    expect(c.intent(a, { t: 'ability', slot: 3, phase: 'press' }, 100)).toBeNull(); // Mend
    expect(c.intent(a, { t: 'ability', slot: 3, phase: 'press' }, 0)).toBe('cooldown'); // stale
    expect(c.intent(a, { t: 'ability', slot: 3, phase: 'press' }, 80.6)).toBe('cooldown');
    // backwards ticks are ticks at the latest time seen (dt 0), and do not rewind anything
    for (let i = 1; i <= 30; i++) c.tick(50 + i / 15);
    expect(c.intent(a, { t: 'ability', slot: 3, phase: 'press' }, 60)).toBe('cooldown');
    expect(c.self(a)!.cd[3]).toBeCloseTo(20, 6);
    c.tick(120);
    expect(c.intent(a, { t: 'ability', slot: 3, phase: 'press' }, 120)).toBeNull();
  });

  it('a stale nowS is taken as the latest time seen: two Mends at once are impossible', () => {
    const c = createCombat(flat([]), { seed: 1, nowS: 0 });
    const a = c.addAdventurer({ x: 0, z: 0, y: 0, facing: 0, hp: 20, loadout: DEFAULT_LOADOUT }, 0);
    c.tick(100);
    expect(c.intent(a, { t: 'ability', slot: 3, phase: 'press' }, 0)).toBeNull(); // stamped long ago: counts as 100
    expect(c.self(a)!.cd[3]).toBeCloseTo(20, 6);
    expect(c.intent(a, { t: 'ability', slot: 3, phase: 'press' }, 100.6)).toBe('cooldown');
  });

  it('carry: remove → add with carry keeps cooldowns, the GCD, spent dodge charges and Momentum; without it, all fresh', () => {
    const c = createCombat(flat([]), { seed: 1, nowS: 0 });
    const a = c.addAdventurer({ x: 0, z: 0, y: 0, facing: 0, hp: 50, loadout: DEFAULT_LOADOUT }, 0);
    expect(c.intent(a, { t: 'ability', slot: 3, phase: 'press' }, 1)).toBeNull(); // Mend: 20 s
    expect(c.intent(a, { t: 'dodge', dx: 1, dz: 0, from: { x: 0, z: 0, y: 0 }, grounded: true }, 1)).toBeNull();
    expect(c.intent(a, { t: 'dodge', dx: -1, dz: 0, from: { x: 4.5, z: 0, y: 0 }, grounded: true }, 1.5)).toBeNull();
    worldOf(c).adventurers.get(a)!.momentum = 40;
    const carry = c.carryOf(a)!; // at 1.5 s, the latest time seen
    expect(carry.cooldowns.mend).toBeCloseTo(19.5, 6);
    expect(carry.dodgeCharges).toBe(0);
    expect(carry.dodgeRefillIn).toBeCloseTo(4.5, 6);
    expect(carry.momentum).toBe(40);
    c.removeAdventurer(a);
    expect(c.carryOf(a)).toBeUndefined();

    const b = c.addAdventurer({ x: 0, z: 0, y: 0, facing: 0, hp: 50, loadout: DEFAULT_LOADOUT, carry }, 500);
    expect(c.intent(b, { t: 'ability', slot: 3, phase: 'press' }, 500)).toBe('cooldown');
    expect(c.self(b)!.cd[3]).toBeCloseTo(19.5, 6);
    expect(c.self(b)!.dodgeCharges).toBe(0);
    expect(c.intent(b, { t: 'dodge', dx: 1, dz: 0, from: { x: 0, z: 0, y: 0 }, grounded: true }, 500)).toBe('charges');
    expect(c.self(b)!.momentum).toBe(40);
    expect(c.intent(b, { t: 'ability', slot: 3, phase: 'press' }, 519.51)).toBeNull();

    const fresh = c.addAdventurer({ x: 0, z: 0, y: 0, facing: 0, hp: 50, loadout: DEFAULT_LOADOUT }, 520);
    expect(c.self(fresh)!.dodgeCharges).toBe(2);
    expect(c.intent(fresh, { t: 'ability', slot: 3, phase: 'press' }, 520)).toBeNull();
  });

  it('carry values are clamped: nonsense cannot extend or shorten beyond the real numbers', () => {
    const c = createCombat(flat([]), { seed: 1, nowS: 0 });
    const b = c.addAdventurer({
      x: 0, z: 0, y: 0, facing: 0, hp: 50, loadout: DEFAULT_LOADOUT,
      carry: { cooldowns: { mend: 1e9, bulwark: Number.NaN, nope: 5 } as never, gcd: -3, dodgeCharges: 7.5, dodgeRefillIn: Infinity, momentum: 1e6 },
    }, 0);
    const s = c.self(b)!;
    expect(s.cd[3]).toBe(20);
    expect(s.cd[4]).toBe(0);
    expect(s.gcd).toBe(0);
    expect(s.dodgeCharges).toBe(2);
    expect(s.momentum).toBe(100);
  });

  it('killEnemy is idempotent', () => {
    const c = createCombat(flat([{ kind: 'thornling', x: 0, z: 2, facing: 0 }]), { seed: 1, nowS: 0 });
    const w = worldOf(c), e = w.enemies.get(enemyId(c))!;
    killEnemy(w, e, 102);
    const r1 = e.respawnAt;
    killEnemy(w, e, 110);
    expect(e.respawnAt).toBe(r1);
    expect(c.tick(102.01).kills).toHaveLength(1);
  });

  it('autos keep their cadence under ±10 ms tick jitter: 51 swings at 1.2 s in 60 s', () => {
    const c = createCombat(flat([{ kind: 'dummy', x: 0, z: 2, facing: 0 }]), { seed: 1, nowS: 0 });
    const w = worldOf(c), e = w.enemies.get(enemyId(c))!;
    e.hp = e.maxHp = 1e6;
    const a = c.addAdventurer({ x: 0, z: 0, y: 0, facing: 0, hp: 100, loadout: DEFAULT_LOADOUT }, 0);
    c.intent(a, { t: 'target', id: e.id }, 0);
    let t = 0, hits = 0, s = 7;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    hits += c.tick(0).fx.filter((f) => f.t === 'hit').length;
    while (t < 60 - 0.02) { t += 1 / 15 + (rnd() - 0.5) * 0.02; hits += c.tick(t).fx.filter((f) => f.t === 'hit').length; }
    expect(hits).toBe(51);
  });

  it("a stagger break restarts the cancelled attack's cooldown (as an interrupt does)", () => {
    const c = createCombat(flat([{ kind: 'mossback', x: 0, z: 0, facing: 0 }]), { seed: 1, nowS: 0 });
    const w = worldOf(c), e = w.enemies.get(enemyId(c))!;
    e.windup = { attack: 'ground_slam', startedAt: 10, endsAt: 11.6, interruptible: false, telegraphId: null };
    e.attackReadyAt.ground_slam = 19;
    expect(applyStagger(w, e, 100, 10.5)).toBe(true);
    expect(e.windup).toBeNull();
    expect(e.attackReadyAt.ground_slam).toBe(10.5 + ENEMY_ATTACKS.ground_slam.cooldown);
  });
});
