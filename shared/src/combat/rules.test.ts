import { describe, expect, it } from 'vitest';
import {
  mitigation, hitDamage, enemyHit, STARTER_STATS,
  gainMomentum, decayMomentum,
  applyFinisherMark, liveMarks, markBits, MARK_BITS, type Marks,
  addStagger, tickStagger, isBroken, staggerImmuneLeft, STAGGER_IMMUNE_S, type StaggerBar,
  ThreatTable,
  inShape, escapeDir, type Shape,
  lineOfSight,
  ENEMY_ATTACKS, ENEMY_KINDS, type EnemyAttackData,
  MOMENTUM_MAX, MARK_S, BREAK_STUN_S, TAUNT_S, DODGE_DISTANCE,
} from './index';

describe('stats and damage', () => {
  it('mitigation is DEFENCE_K / (DEFENCE_K + defence)', () => {
    expect(mitigation(10)).toBe(0.8);
    expect(mitigation(15)).toBeCloseTo(0.7273, 4);
    expect(mitigation(0)).toBe(1);
    expect(mitigation(-5)).toBe(1);
  });
  it('hitDamage rounds, never goes below 1, and is 0 for no coefficient', () => {
    expect(hitDamage(1, 10, 10)).toBe(8);
    expect(hitDamage(4, 10, 6)).toBe(35);
    expect(hitDamage(0.01, 10, 10)).toBe(1);
    expect(hitDamage(0, 10, 10)).toBe(0);
    expect(hitDamage(1, 10, 10, 1.5)).toBe(12);
  });
  it('enemyHit applies the adventurer’s defence', () => {
    expect(enemyHit(40, 10)).toBe(32);
    expect(enemyHit(7, 10)).toBe(6);
    expect(enemyHit(0.1, 10)).toBe(1);
  });
  it('starter stats are fixed', () => {
    expect(STARTER_STATS).toEqual({ power: 10, defence: 10, maxHp: 100 });
  });
});

describe('momentum', () => {
  it('gains are clamped to 0..MOMENTUM_MAX', () => {
    expect(gainMomentum(95, 10)).toBe(100);
    expect(gainMomentum(40, 10)).toBe(50);
    expect(gainMomentum(20, -50)).toBe(0);
    expect(MOMENTUM_MAX).toBe(100);
  });
  it('does not decay before 6 s without damage, then 10/s, never below 0', () => {
    expect(decayMomentum(50, 5.9, 0.1)).toBe(50);
    expect(decayMomentum(50, 6, 0.1)).toBe(50); // the first instant of decay
    expect(decayMomentum(50, 7, 1)).toBeCloseTo(40, 9);
    expect(decayMomentum(50, 6.5, 1)).toBeCloseTo(45, 9); // only the half second past the delay counts
    expect(decayMomentum(5, 20, 1)).toBe(0);
    // ticking at 15 Hz for 10 s of no damage: 4 s of decay
    let m = 80;
    for (let i = 1; i <= 150; i++) m = decayMomentum(m, i / 15, 1 / 15);
    expect(m).toBeCloseTo(40, 6);
  });
});

describe('marks', () => {
  it('a finisher detonates other live marks, then applies or refreshes its own', () => {
    const marks: Marks = {};
    expect(applyFinisherMark(marks, 'marked', 0)).toEqual([]);
    expect(liveMarks(marks, 1)).toEqual(['marked']);
    expect(applyFinisherMark(marks, 'burning', 2)).toEqual(['marked']);
    expect(liveMarks(marks, 2)).toEqual(['burning']);
    expect(marks.marked).toBeUndefined();
    expect(applyFinisherMark(marks, 'burning', 4)).toEqual([]); // refresh
    expect(marks.burning).toBe(4 + MARK_S);
  });
  it('an expired mark is not detonated', () => {
    const marks: Marks = {};
    applyFinisherMark(marks, 'marked', 0);
    expect(liveMarks(marks, MARK_S)).toEqual([]);
    expect(applyFinisherMark(marks, 'burning', MARK_S + 1)).toEqual([]);
    expect(liveMarks(marks, MARK_S + 1)).toEqual(['burning']);
  });
  it('markBits packs live marks', () => {
    expect(MARK_BITS).toEqual({ soaked: 1, burning: 2, marked: 4, rooted: 8, dazed: 16 });
    const marks: Marks = { soaked: 10, burning: 3, marked: 10 };
    expect(markBits(marks, 5)).toBe(1 | 4);
    expect(markBits({}, 0)).toBe(0);
  });
});

describe('stagger', () => {
  const bar = (max = 100): StaggerBar => ({ value: 0, max, brokenUntil: -Infinity, lastGainAt: -Infinity });
  it('breaks at max, then takes nothing while broken nor for STAGGER_IMMUNE_S after', () => {
    const b = bar();
    expect(addStagger(b, 60, 0)).toBe(false);
    expect(addStagger(b, 40, 1)).toBe(true);
    expect(b.value).toBe(0);
    expect(b.brokenUntil).toBe(1 + BREAK_STUN_S);
    expect(isBroken(b, 2)).toBe(true);
    expect(addStagger(b, 50, 2)).toBe(false);
    expect(b.value).toBe(0);
    expect(isBroken(b, 1 + BREAK_STUN_S)).toBe(false);
    expect(addStagger(b, 50, 1 + BREAK_STUN_S)).toBe(false);
    expect(b.value).toBe(0); // immune
    expect(staggerImmuneLeft(b, 1 + BREAK_STUN_S + 1)).toBeCloseTo(STAGGER_IMMUNE_S - 1, 9);
    expect(addStagger(b, 50, 1 + BREAK_STUN_S + STAGGER_IMMUNE_S)).toBe(false);
    expect(b.value).toBe(50);
  });
  it('decays 5/s only after 4 s without gain', () => {
    const b = bar();
    addStagger(b, 50, 0);
    for (let i = 1; i <= 60; i++) tickStagger(b, i / 15, 1 / 15); // to 4 s
    expect(b.value).toBe(50);
    for (let i = 61; i <= 90; i++) tickStagger(b, i / 15, 1 / 15); // 2 s more
    expect(b.value).toBeCloseTo(40, 6);
    for (let i = 91; i <= 400; i++) tickStagger(b, i / 15, 1 / 15);
    expect(b.value).toBe(0);
  });
  it('a bar with max 0 never breaks', () => {
    const b = bar(0);
    expect(addStagger(b, 1000, 0)).toBe(false);
    expect(isBroken(b, 0.1)).toBe(false);
  });
});

describe('ThreatTable', () => {
  const all = () => true;
  it('leaves the current target only for 1.1 × its threat', () => {
    const t = new ThreatTable();
    t.add(1, 100); t.add(2, 105);
    expect(t.choose(1, 0, all)).toBe(1);
    t.add(2, 6); // 111
    expect(t.choose(1, 0, all)).toBe(2);
    expect(t.choose(null, 0, all)).toBe(2);
  });
  it('skips invalid ids and returns null when none are valid', () => {
    const t = new ThreatTable();
    t.add(1, 100); t.add(2, 50);
    expect(t.choose(1, 0, (id) => id !== 1)).toBe(2);
    expect(t.choose(null, 0, () => false)).toBeNull();
    t.remove(2);
    expect(t.has(2)).toBe(false);
    expect(t.ids()).toEqual([1]);
    t.clear();
    expect(t.ids()).toEqual([]);
    expect(t.choose(null, 0, all)).toBeNull();
  });
  it('a taunt forces the target for exactly TAUNT_S, then the top is chosen again', () => {
    const t = new ThreatTable();
    t.add(1, 100); t.add(2, 10);
    t.taunt(2, 10);
    expect(t.choose(1, 10, all)).toBe(2);
    expect(t.choose(1, 10 + TAUNT_S - 0.01, all)).toBe(2);
    t.add(1, 1000); // more threat cannot break the taunt
    expect(t.choose(2, 10 + TAUNT_S - 0.01, all)).toBe(2);
    expect(t.choose(2, 10 + TAUNT_S, all)).toBe(1);
  });
  it('taunt sets threat to top × 1.1 + 10', () => {
    const t = new ThreatTable();
    t.add(1, 100); t.add(2, 10);
    t.taunt(2, 0);
    // after the taunt, 2 holds 120; 1 needs 132 to take it from 2
    expect(t.choose(2, TAUNT_S, all)).toBe(2);
    t.add(1, 31);
    expect(t.choose(2, TAUNT_S, all)).toBe(2);
    t.add(1, 1.5);
    expect(t.choose(2, TAUNT_S, all)).toBe(1);
  });
});

describe('inShape', () => {
  it('circle edge', () => {
    const c: Shape = { kind: 'circle', x: 2, z: -1, r: 3 };
    expect(inShape(c, 2 + 3 - 0.01, -1)).toBe(true);
    expect(inShape(c, 2 + 3 + 0.01, -1)).toBe(false);
    expect(inShape(c, 2, -1 - 2.99)).toBe(true);
  });
  it('cone 70°, r 11 toward +X', () => {
    const dir = Math.PI / 2; // +X
    const c: Shape = { kind: 'cone', x: 0, z: 0, dir, r: 11, angle: (70 * Math.PI) / 180 };
    const p = (deg: number, d: number) => {
      const a = dir + (deg * Math.PI) / 180;
      return [Math.sin(a) * d, Math.cos(a) * d] as const;
    };
    expect(inShape(c, ...p(0, 5))).toBe(true);
    expect(inShape(c, ...p(30, 8))).toBe(true);
    expect(inShape(c, ...p(-30, 8))).toBe(true);
    expect(inShape(c, ...p(40, 8))).toBe(false);
    expect(inShape(c, ...p(-40, 8))).toBe(false);
    expect(inShape(c, ...p(0, 11.1))).toBe(false);
    expect(inShape(c, ...p(180, 1))).toBe(false);
    expect(inShape(c, 1, 0)).toBe(true);
  });
  it('line 9 × 1.8 along +Z', () => {
    const l: Shape = { kind: 'line', x: 0, z: 0, dir: 0, length: 9, width: 1.8 };
    expect(inShape(l, 0.85, 4)).toBe(true);
    expect(inShape(l, -0.85, 4)).toBe(true);
    expect(inShape(l, 0.95, 4)).toBe(false);
    expect(inShape(l, 0, 9.1)).toBe(false);
    expect(inShape(l, 0, -0.1)).toBe(false);
    expect(inShape(l, 0, 8.9)).toBe(true);
  });
  it('dir follows facing: 0 is +Z, positive turns toward +X', () => {
    const l: Shape = { kind: 'line', x: 0, z: 0, dir: Math.PI / 2, length: 9, width: 1.8 };
    expect(inShape(l, 4, 0)).toBe(true);
    expect(inShape(l, 0, 4)).toBe(false);
    expect(inShape(l, -4, 0)).toBe(false);
  });
});

/** The shape an attack makes, with its owner at (ox, oz) facing `dir` and the target at (tx, tz). */
function attackShape(a: EnemyAttackData, ox: number, oz: number, dir: number, tx: number, tz: number): Shape {
  switch (a.shape) {
    case 'circle-self': return { kind: 'circle', x: ox, z: oz, r: a.r! };
    case 'circle-target': return { kind: 'circle', x: tx, z: tz, r: a.r! };
    case 'cone': return { kind: 'cone', x: ox, z: oz, dir, r: a.r!, angle: a.angle! };
    case 'line': return { kind: 'line', x: ox, z: oz, dir, length: a.length!, width: a.width! };
    case 'ring-self': return { kind: 'ring', x: ox, z: oz, dir, inner: a.inner!, r: a.r! };
  }
}

/**
 * Attacks too big for one dodge to leave from every point inside, answered otherwise (Plan 4): Keeper's Toll
 * and Last Light cover the whole arena (interrupt, Break or heal through them); Lamp Sweep's wide cone is
 * walked out of during its wind-up.
 */
const NOT_ONE_DODGE: ReadonlySet<string> = new Set(['keepers_toll', 'last_light', 'lamp_sweep']);

describe('escapeDir', () => {
  const ownerOf = (id: string) => Object.values(ENEMY_KINDS).find((k) => k.attacks.includes(id as never))!;
  for (const a of Object.values(ENEMY_ATTACKS)) {
    if (NOT_ONE_DODGE.has(a.id)) continue;
    for (const dir of [0, 1.0, -2.3]) {
      it(`a dodge along it leaves ${a.id} (dir ${dir}) from every grid point inside`, () => {
        const ownerR = ownerOf(a.id).radius;
        const s = attackShape(a, 1.3, -0.7, dir, 1.3, -0.7);
        let checked = 0;
        for (let x = -15; x <= 15; x += 0.25) {
          for (let z = -15; z <= 15; z += 0.25) {
            if (!inShape(s, x, z)) continue;
            if ((a.shape === 'circle-self' || a.shape === 'ring-self') && Math.hypot(x - 1.3, z + 0.7) < ownerR) continue;
            const e = escapeDir(s, x, z);
            expect(Math.hypot(e.x, e.z)).toBeCloseTo(1, 9);
            expect(inShape(s, x + e.x * DODGE_DISTANCE, z + e.z * DODGE_DISTANCE)).toBe(false);
            checked++;
          }
        }
        expect(checked).toBeGreaterThan(20);
      });
    }
  }
  it('circle: radial; line: sideways', () => {
    const e = escapeDir({ kind: 'circle', x: 0, z: 0, r: 3 }, 0, 1);
    expect(e.x).toBeCloseTo(0, 9); expect(e.z).toBeCloseTo(1, 9);
    const l = escapeDir({ kind: 'line', x: 0, z: 0, dir: 0, length: 9, width: 1.8 }, -0.3, 4);
    expect(l.x).toBeCloseTo(-1, 9); expect(l.z).toBeCloseTo(0, 9);
  });
});

describe('lineOfSight', () => {
  // a wall circle at (5, 0) r 1, and a platform (standable, so it does not block) at (5, 5) r 1
  const wall = { x: 5, z: 0, r: 1 };
  const sight = (x: number, z: number) => Math.hypot(x - wall.x, z - wall.z) > wall.r;
  const surfaceWithPlatform = (x: number, z: number) => (Math.hypot(x - 5, z - 5) <= 1 ? 1.2 : 0);
  const sightOverSurface = (x: number, z: number) => sight(x, z) && surfaceWithPlatform(x, z) !== null;
  it('a wall circle between two points blocks', () => {
    expect(lineOfSight(sight, 0, 0, 10, 0)).toBe(false);
    expect(lineOfSight(sight, 0, 0, 10, 0.5)).toBe(false);
    expect(lineOfSight(sight, 0, 2, 10, 2)).toBe(true);
  });
  it('a platform does not', () => {
    expect(lineOfSight(sightOverSurface, 0, 5, 10, 5)).toBe(true);
  });
  it('obstacles within 1 m of either end are ignored', () => {
    expect(lineOfSight(sight, 4.5, 0, 4.5, 10)).toBe(true); // starts inside the wall's edge
    expect(lineOfSight(sight, 5, 10, 5, 0.5)).toBe(true); // ends just inside it
    expect(lineOfSight(sight, 5, 10, 5, -10)).toBe(false);
  });
  it('the same point, and points closer than the end skips, are in sight', () => {
    expect(lineOfSight(() => false, 1, 1, 1, 1)).toBe(true);
    expect(lineOfSight(() => false, 0, 0, 1.5, 0)).toBe(true);
    expect(lineOfSight(() => false, 0, 0, 3, 0)).toBe(false);
  });
});

describe('fix round 1: guards', () => {
  it('a negated hit is 0 (a factor not above 0, or not finite); a real hit is at least 1; never NaN', () => {
    for (const [raw, mult] of [[0, 1], [-5, 1], [NaN, 1], [Infinity, 1], [7, 0], [7, -1], [7, NaN], [7, Infinity]]) expect(enemyHit(raw, 10, mult)).toBe(0);
    for (const [coef, power, mult] of [[0, 10, 1], [1, 0, 1], [1, NaN, 1], [NaN, 10, 1], [1, 10, 0], [1, 10, NaN], [Infinity, 10, 1], [1, -10, 1]]) {
      expect(hitDamage(coef, power, 10, mult)).toBe(0);
    }
    expect(enemyHit(0.1, 10)).toBe(1);
    expect(hitDamage(0.01, 10, 10)).toBe(1);
    // a nonsense defence counts as none; an infinite one still lets the floor of 1 through
    expect(mitigation(NaN)).toBe(1);
    expect(enemyHit(7, NaN)).toBe(7);
    expect(mitigation(Infinity)).toBe(0);
    expect(enemyHit(7, Infinity)).toBe(1);
    expect(hitDamage(1, 10, Infinity)).toBe(1);
  });
  it('momentum never becomes NaN', () => {
    expect(gainMomentum(NaN, 10)).toBe(10);
    expect(gainMomentum(50, NaN)).toBe(50);
    expect(gainMomentum(50, Infinity)).toBe(50);
    expect(decayMomentum(NaN, 10, 1)).toBe(0);
    expect(decayMomentum(50, NaN, 1)).toBe(50);
    expect(decayMomentum(50, 10, NaN)).toBe(50);
    expect(decayMomentum(50, Infinity, Infinity)).toBe(0);
  });
  it('lineOfSight is false for non-finite points, and never loops on huge ones', () => {
    for (const p of [[NaN, 0, 10, 0], [0, Infinity, 10, 0], [0, 0, -Infinity, 0], [0, 0, 10, NaN]]) {
      expect(lineOfSight(() => true, p[0], p[1], p[2], p[3])).toBe(false);
    }
    const t0 = Date.now();
    expect(lineOfSight(() => true, 0, 0, 1e15, 0)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(100);
  });
  it('a cone pointing at ±π (−Z) and at any wrapped angle', () => {
    for (const dir of [Math.PI, -Math.PI, 3 * Math.PI, -5 * Math.PI]) {
      const c: Shape = { kind: 'cone', x: 0, z: 0, dir, r: 11, angle: 1.2 };
      expect(inShape(c, 0, -5)).toBe(true);
      expect(inShape(c, Math.sin(Math.PI + 0.5) * 5, Math.cos(Math.PI + 0.5) * 5)).toBe(true);
      expect(inShape(c, Math.sin(Math.PI - 0.5) * 5, Math.cos(Math.PI - 0.5) * 5)).toBe(true);
      expect(inShape(c, Math.sin(Math.PI + 0.7) * 5, Math.cos(Math.PI + 0.7) * 5)).toBe(false);
      expect(inShape(c, 0, 5)).toBe(false);
      for (const side of [-1, 1]) {
        const x = Math.sin(Math.PI + side * 0.5) * 5, z = Math.cos(Math.PI + side * 0.5) * 5;
        const e = escapeDir(c, x, z);
        expect(inShape(c, x + e.x * DODGE_DISTANCE, z + e.z * DODGE_DISTANCE)).toBe(false);
      }
    }
  });
});
