// Plan 4 Engine II: the boss script (phases, rotations, adds and wards, fields, enrage, party scaling,
// resets, the arena rule) on flat synthetic zones, with scripted adventurers placed by setPose.
import { describe, expect, it } from 'vitest';
import type { Loadout } from './abilities';
import { applyStagger, damageEnemy, hurtAdventurer } from './adventurer';
import { bossAiStateOf } from './bossAi';
import { enemyAiStateOf } from './enemyAi';
import { BOSSES } from './bosses';
import { DODGE_DISTANCE, DODGE_S } from './constants';
import { targetFor } from './effects';
import { ENEMY_ATTACKS, ENEMY_KINDS, type EnemyAttackId, type EnemyKindId } from './enemies';
import type { CampSpawn, EnemyState, TelegraphState, TickOut } from './engine';
import { enemyHit, STARTER_STATS, type Stats } from './stats';
import { Rig, camp } from './testRig';
import { RUN_SPEED, TICK_HZ } from '../constants';

const BIG: Stats = { power: 10, defence: 10, maxHp: 100000 };
const WARRIOR: Loadout = { job: 'warrior', picks: ['rallying_roar', 'mend'] }; // slash, sunder, parry, roar, mend
const DT = 1 / 15;

interface Tel { id: number; attack: EnemyAttackId; startedAt: number; endsAt: number; shape: TelegraphState['shape']; owner: number }
/** A rig that records every telegraph it sees and runs hooks before each tick. */
class BRig extends Rig {
  readonly tels: Tel[] = [];
  readonly hooks: (() => void)[] = [];
  private seen = new Set<number>();
  constructor(camps: CampSpawn[], seed = 1) { super(camps, { liveEnemies: true, seed }); }
  override tick(): TickOut {
    for (const h of this.hooks) h();
    const out = super.tick();
    for (const t of this.w.telegraphs.values()) {
      if (this.seen.has(t.id)) continue;
      this.seen.add(t.id);
      this.tels.push({ id: t.id, attack: t.attack, startedAt: t.startedAt, endsAt: t.endsAt, shape: t.shape, owner: t.owner });
    }
    return out;
  }
  adv(x: number, z: number, o: { stats?: Stats; loadout?: Loadout; hold?: boolean } = {}): number {
    const stats = o.stats ?? BIG;
    const id = this.c.addAdventurer({ x, z, y: 0, facing: 0, hp: stats.maxHp, loadout: o.loadout ?? WARRIOR, stats }, this.now);
    this.c.setParty(id, 'p');
    if (o.hold !== false) this.hooks.push(() => this.c.setPose(id, x, z, 0, 0));
    return id;
  }
  boss(kind: EnemyKindId = 'fallen_warden'): EnemyState { return this.w.enemies.get(this.enemy(kind))!; }
  bossEvents() { return this.outs.flatMap((o) => o.boss); }
  attacks(owner: number) { return this.tels.filter((t) => t.owner === owner); }
}
const hit = (r: Rig, src: number, e: EnemyState, amount: number) => damageEnemy(r.w, src, e, amount, 'auto', r.now);
const ai = (e: EnemyState) => bossAiStateOf(e)!;
/** Takes the boss through its transitions until phase k has begun. */
function toPhase(r: Rig, e: EnemyState, src: number, k: number) {
  const tS = e.data.boss!.transitionS;
  while (ai(e).phase < k || e.act === 'phase') {
    if (e.act !== 'phase') hit(r, src, e, 1e9);
    r.at(r.now + tS + 0.1);
  }
}
/** Waits until no rotation entry is in flight, then makes rotation entry `idx` start on the next tick. */
function force(r: Rig, e: EnemyState, idx: number) {
  for (let n = 0; (ai(e).busy !== null || e.act !== '') && n < 200; n++) r.tick();
  ai(e).next = idx; ai(e).nextAt = r.now; ai(e).waitSince = null;
}
const near = (a: number, b: number, tol = DT + 1e-6) => Math.abs(a - b) <= tol;
const ang = (a: number) => { const t = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); return t > Math.PI ? t - 2 * Math.PI : t; };

describe('the boss script', () => {
  it('the Wickhound wakes within 10 m, runs its rotation with 3.5 s gaps, and switches at 50% to phase 2 with Cinder Ring and 1.8 s autos', () => {
    const r = new BRig([camp('wickhound', 0, 0)]);
    const e = r.boss('wickhound');
    const a = r.adv(0, 12, { hold: false });
    r.at(1);
    expect(r.bossEvents()).toEqual([]);
    // from here on it stands 3 m from the hound, on the camp's side (so lunges dash back toward the camp)
    r.hooks.push(() => {
      const d = Math.hypot(e.x, e.z), ux = d > 0.5 ? -e.x / d : 0, uz = d > 0.5 ? -e.z / d : 1;
      r.c.setPose(a, e.x + 3 * ux, e.z + 3 * uz, 0, 0);
    });
    r.move(a, 0, 8);
    r.at(1.2);
    expect(r.bossEvents()).toEqual([{ enemy: e.id, kind: 'wickhound', event: 'wake', atS: expect.any(Number) }]);
    const woke = r.bossEvents()[0].atS;
    r.at(woke + 20);
    const p1 = r.attacks(e.id);
    expect(p1.map((t) => t.attack).slice(0, 4)).toEqual(['wick_lunge', 'ember_breath', 'wick_lunge', 'ember_breath']);
    expect(near(p1[0].startedAt, woke + 3.5)).toBe(true);
    for (let k = 1; k < 4; k++) expect(near(p1[k].startedAt, p1[k - 1].endsAt + 3.5)).toBe(true);
    expect(p1.some((t) => t.attack === 'cinder_ring')).toBe(false);
    const autos1 = r.hits(e.id).filter((h) => h.by === 'auto').map((h) => h.at);
    for (let k = 1; k < autos1.length; k++) expect(autos1[k] - autos1[k - 1]).toBeGreaterThan(2.2 - 1e-3);

    // 50%: the floor, a 2 s transition, then phase 2
    hit(r, a, e, 1e9);
    expect(e.hp).toBe(1300);
    expect(r.fx('phase')).toEqual([{ at: expect.any(Number), t: 'phase', src: e.id, phase: 1 }]);
    const t0 = r.now;
    r.at(t0 + 1.9);
    expect(e.act).toBe('phase');
    r.at(t0 + 2.1);
    expect(e.act).not.toBe('phase');
    expect(r.c.get(e.id)!.phase).toBe(1);
    const n0 = r.attacks(e.id).length, h0 = r.hits(e.id).length;
    r.at(t0 + 30);
    const p2 = r.attacks(e.id).slice(n0);
    expect(p2.map((t) => t.attack).slice(0, 4)).toEqual(['wick_lunge', 'cinder_ring', 'ember_breath', 'wick_lunge']);
    expect(near(p2[0].startedAt, t0 + 2 + 3.0, 2 * DT)).toBe(true);
    for (let k = 1; k < 4; k++) expect(near(p2[k].startedAt, p2[k - 1].endsAt + 3.0)).toBe(true);
    const ring = p2.find((t) => t.attack === 'cinder_ring')!.shape;
    expect(ring).toMatchObject({ kind: 'ring', inner: 3.5, r: 9 });
    // standing close (3 m, inside the hole), Cinder Ring misses
    expect(r.hits(e.id).filter((h) => h.by === 'cinder_ring')).toEqual([]);
    const autos2 = r.hits(e.id).slice(h0).filter((h) => h.by === 'auto').map((h) => h.at);
    const gaps = autos2.slice(1).map((t, k) => t - autos2[k]);
    expect(Math.min(...gaps)).toBeGreaterThan(1.8 - 1e-3);
    expect(gaps.some((g) => near(g, 1.8))).toBe(true);
  });

  it('a burst past 70% and 35% at once stops at 70%; damage during the transition does nothing; phase 2 starts after 4 s', () => {
    const r = new BRig([camp('fallen_warden', 0, 0)]);
    const e = r.boss();
    const a = r.adv(0, 3);
    r.at(0.5);
    expect(ai(e).wokeAt).not.toBeNull();
    hit(r, a, e, 1e9);
    expect(e.hp).toBe(4200);
    expect(e.act).toBe('phase');
    expect(r.c.get(e.id)!.act).toBe('phase');
    const t0 = r.now, hits = r.hits().filter((h) => h.dst === e.id).length;
    hit(r, a, e, 500);
    expect(e.hp).toBe(4200);
    expect(r.hits().filter((h) => h.dst === e.id).length).toBe(hits);
    expect(targetFor(r.w, r.w.adventurers.get(a)!, e.id, 40)).toBe('no-target');
    expect([...r.c.telegraphs()]).toEqual([]);
    r.at(t0 + 3.9);
    expect(e.act).toBe('phase');
    expect(e.hp).toBe(4200);
    r.at(t0 + 4.1);
    expect(e.act).not.toBe('phase');
    expect(r.c.get(e.id)!.phase).toBe(1);
    expect(r.bossEvents().map((b) => [b.event, b.phase])).toEqual([['wake', undefined], ['phase', 1]]);
  });

  it('phase 2 spawns two Lens Shards at ±10 m engaged with everyone; the Warden takes ×0.4 while one lives, ×1 after both die', () => {
    const r = new BRig([camp('fallen_warden', 0, 0)]);
    const e = r.boss();
    const a = r.adv(0, 3), b = r.adv(3, 0), c = r.adv(-3, 0);
    r.at(0.5);
    for (const id of [a, b, c]) hit(r, id, e, 1);
    r.tick();
    expect(e.maxHp).toBeCloseTo(6000 * 1.45, 9);
    toPhase(r, e, a, 1);
    const shards = [...r.w.enemies.values()].filter((o) => o.kind === 'lens_shard');
    expect(shards.map((s) => [s.camp.x, s.camp.z])).toEqual([[-10, 0], [10, 0]]);
    for (const s of shards) {
      expect(s.threat.ids().sort()).toEqual([a, b, c].sort());
      expect(s.maxHp).toBeCloseTo(420 * 1.45, 9);
    }
    expect(r.fx('spawn').map((s) => [s.dst, s.src])).toEqual(shards.map((s) => [s.id, e.id]));
    expect(r.c.get(e.id)!.warded).toBe(true);
    let hp = e.hp;
    hit(r, a, e, 100);
    expect(hp - e.hp).toBe(40);
    hit(r, a, shards[0], 1e6);
    r.tick();
    hp = e.hp; hit(r, a, e, 100);
    expect(hp - e.hp).toBe(40);
    hit(r, a, shards[1], 1e6);
    r.tick();
    expect(r.c.get(e.id)!.warded).toBe(false);
    hp = e.hp; hit(r, a, e, 100);
    expect(hp - e.hp).toBe(100);
  });

  it('the lampfire ring burns outside 15 m from phase 2, and outside 12 m in phase 3 only', () => {
    const r = new BRig([camp('fallen_warden', 0, 0)]);
    const e = r.boss();
    const close = r.adv(0, 3), mid = r.adv(0, 13.5), far = r.adv(0, -17);
    r.at(0.5);
    for (const id of [close, mid, far]) hit(r, id, e, 1);
    r.at(5);
    const fieldHits = () => r.fx('hit').filter((h) => h.by === 'field');
    expect(fieldHits()).toEqual([]);
    toPhase(r, e, close, 1);
    expect([...r.c.fields()].map((f) => [f.field, f.shape])).toEqual([['lampfire', { kind: 'ring', x: 0, z: 0, dir: 0, inner: 15, r: 40 }]]);
    let n = fieldHits().length;
    r.at(r.now + 3.05);
    expect(new Set(fieldHits().slice(n).map((h) => h.dst))).toEqual(new Set([far]));
    toPhase(r, e, close, 2);
    expect([...r.c.fields()].map((f) => [f.field, f.shape])).toEqual([['lampfire_deep', { kind: 'ring', x: 0, z: 0, dir: 0, inner: 12, r: 40 }]]);
    n = fieldHits().length;
    r.at(r.now + 3.05);
    expect(new Set(fieldHits().slice(n).map((h) => h.dst))).toEqual(new Set([mid, far]));
  });

  it('Brass Fall puts one circle on each engaged adventurer; two stacked adventurers take two hits each', () => {
    const r = new BRig([camp('fallen_warden', 0, 0)]);
    const e = r.boss();
    const a = r.adv(4, 4), b = r.adv(4, 4), c = r.adv(-6, 0);
    r.at(0.5);
    force(r, e, 1);
    r.tick();
    const falls = r.attacks(e.id).filter((t) => t.attack === 'brass_fall');
    expect(falls.map((t) => t.shape)).toEqual([
      { kind: 'circle', x: 4, z: 4, r: 3 }, { kind: 'circle', x: 4, z: 4, r: 3 }, { kind: 'circle', x: -6, z: 0, r: 3 },
    ]);
    expect(new Set(falls.map((t) => t.endsAt - t.startedAt))).toEqual(new Set([2]));
    r.at(r.now + 2.1);
    const n = (id: number) => r.hits(e.id).filter((h) => h.by === 'brass_fall' && h.dst === id).length;
    expect([n(a), n(b), n(c)]).toEqual([2, 2, 1]);
  });

  it("Keeper's Toll is interrupted by Sunder; a Break cancels it; otherwise it hits everyone in the arena", () => {
    const tolls = (r: BRig, e: EnemyState) => r.hits(e.id).filter((h) => h.by === 'keepers_toll');
    {
      const r = new BRig([camp('fallen_warden', 0, 0)]);
      const e = r.boss();
      const w = r.adv(0, 3);
      r.at(0.5);
      expect(r.i(w, { t: 'target', id: e.id })).toBeNull();
      force(r, e, 3);
      r.tick();
      expect(r.c.get(e.id)!.windup).toMatchObject({ attack: 'keepers_toll', interruptible: true });
      r.ready(w, 100);
      expect(r.press(w, 1)).toBeNull(); // Sunder
      r.tick();
      expect(r.fx('interrupt').map((i) => i.dst)).toEqual([e.id]);
      expect([...r.c.telegraphs()].filter((t) => t.attack === 'keepers_toll')).toEqual([]);
      const at = r.now;
      r.at(at + 4);
      expect(tolls(r, e)).toEqual([]);
      // the rotation moves on: the next entry (Lamp Sweep) starts a gap later
      const next = r.attacks(e.id).filter((t) => t.startedAt > at);
      expect(next[0].attack).toBe('lamp_sweep');
      expect(near(next[0].startedAt, at + 3.0, 2 * DT)).toBe(true);
    }
    {
      const r = new BRig([camp('fallen_warden', 0, 0)]);
      const e = r.boss();
      r.adv(0, 3);
      r.at(0.5);
      force(r, e, 3);
      r.tick();
      expect(applyStagger(r.w, e, 1000, r.now)).toBe(true);
      expect(e.act).toBe('stun');
      expect(e.actUntil).toBeCloseTo(r.now + 5, 9);
      expect(e.stagger.brokenUntil).toBeCloseTo(r.now + 5, 9);
      expect([...r.c.telegraphs()]).toEqual([]);
      r.at(r.now + 4);
      expect(tolls(r, e)).toEqual([]);
    }
    {
      const r = new BRig([camp('fallen_warden', 0, 0)]);
      const e = r.boss();
      const ids = [r.adv(0, 3), r.adv(0, 15), r.adv(12, -12)];
      r.at(0.5);
      for (const id of ids) hit(r, id, e, 1);
      force(r, e, 3);
      r.at(r.now + 3.2);
      expect(tolls(r, e).map((h) => h.dst).sort()).toEqual([...ids].sort());
    }
  });

  it('Turning Light places eight lines 0.6 s apart, 45° apart; a Break cancels the rest', () => {
    const r = new BRig([camp('fallen_warden', 0, 0)]);
    const e = r.boss();
    const a = r.adv(0, 3);
    r.at(0.5);
    toPhase(r, e, a, 2);
    force(r, e, 0);
    r.tick();
    const t0 = r.now, x0 = e.x, z0 = e.z;
    r.at(t0 + 5.4);
    expect(e.windup).not.toBeNull();
    expect([e.x, e.z]).toEqual([x0, z0]);
    r.at(t0 + 6);
    const lines = r.attacks(e.id).filter((t) => t.attack === 'turning_light');
    expect(lines.length).toBe(8);
    for (let k = 0; k < 8; k++) {
      const s = lines[k].shape, s0 = lines[0].shape;
      expect(lines[k].startedAt - lines[0].startedAt).toBeCloseTo(0.6 * k, 6);
      expect(lines[k].endsAt - lines[k].startedAt).toBeCloseTo(1.4, 9);
      if (s.kind !== 'line' || s0.kind !== 'line') throw new Error('not a line');
      expect(ang(s.dir - s0.dir - (k * Math.PI) / 4)).toBeCloseTo(0, 9);
      expect(s).toMatchObject({ length: 28, width: 3.5 });
    }
    // again, with a Break after the third line
    force(r, e, 0);
    for (let n = 0; n < 200 && r.attacks(e.id).filter((t) => t.attack === 'turning_light').length < 11; n++) r.tick();
    applyStagger(r.w, e, 1e6, r.now);
    expect([...r.c.telegraphs()]).toEqual([]);
    r.at(r.now + 6);
    expect(r.attacks(e.id).filter((t) => t.attack === 'turning_light').length).toBe(11);
  });

  it('phase 3 anchors the Warden at its camp spot', () => {
    const r = new BRig([camp('fallen_warden', 0, 0)]);
    const e = r.boss();
    const a = r.adv(0, 12);
    r.at(0.5);
    hit(r, a, e, 1);
    r.at(6);
    expect(Math.hypot(e.x, e.z)).toBeGreaterThan(3);
    toPhase(r, e, a, 2);
    expect(ai(e).anchored).toBe(true);
    const b = r.adv(2.5, 0);
    hit(r, b, e, 1);
    r.at(r.now + 10);
    expect(Math.hypot(e.x, e.z)).toBeLessThan(0.3);
    expect(e.act).not.toBe('return');
    expect(e.targetId).toBe(a);
    const n = r.hits(e.id).filter((h) => h.by === 'auto' && h.dst === b).length;
    const na = r.hits(e.id).filter((h) => h.by === 'auto' && h.dst === a).length;
    r.at(r.now + 10);
    expect(Math.hypot(e.x, e.z)).toBeLessThan(0.3);
    expect(r.hits(e.id).filter((h) => h.by === 'auto' && h.dst === b).length).toBeGreaterThan(n);
    expect(r.hits(e.id).filter((h) => h.by === 'auto' && h.dst === a).length).toBe(na);
  });

  it('enrage at 330 s: Last Light every 4 s, 15 then 20 then 25', () => {
    const r = new BRig([camp('fallen_warden', 0, 0)]);
    const e = r.boss();
    const a = r.adv(0, 3, { stats: { power: 1, defence: 0, maxHp: 1e6 } });
    r.hooks.push(() => r.w.adventurers.get(a)!.afflictions.clear()); // no Searing: raw arrives as is
    r.at(0.5);
    const woke = ai(e).wokeAt!;
    expect(r.c.get(e.id)!.enrageIn).toBeCloseTo(330 - (r.w.now - woke), 6);
    r.at(woke + 329.9);
    expect(r.fx('enrage')).toEqual([]);
    const n0 = r.attacks(e.id).length;
    r.at(woke + 330.1);
    expect(r.fx('enrage').map((x) => x.src)).toEqual([e.id]);
    expect(r.bossEvents().filter((b) => b.event === 'enrage').length).toBe(1);
    expect(r.c.get(e.id)!.enrageIn).toBe(0);
    r.at(woke + 343.5);
    const after = r.attacks(e.id).slice(n0);
    expect(after.map((t) => t.attack)).toEqual(['last_light', 'last_light', 'last_light', 'last_light']);
    for (let k = 0; k < 4; k++) expect(near(after[k].startedAt, woke + 330 + 4 * k, 2 * DT)).toBe(true);
    expect(r.hits(e.id).filter((h) => h.by === 'last_light').map((h) => h.amount)).toEqual([15, 20, 25, 30]);
  });

  it('Searing from Warden autos only', () => {
    for (const kind of ['fallen_warden', 'wickhound'] as const) {
      const r = new BRig([camp(kind, 0, 0)]);
      const e = r.boss(kind);
      const a = r.adv(0, 3);
      r.at(25);
      let autos = 0, tele = 0, adds = 0;
      for (const o of r.outs) {
        const landed = o.fx.filter((f) => f.t === 'hit' && f.src === e.id && f.dst === a);
        const auto = landed.some((f) => f.t === 'hit' && f.by === 'auto');
        autos += auto ? 1 : 0;
        tele += landed.some((f) => f.t === 'hit' && f.by !== 'auto') ? 1 : 0;
        const up = o.fx.filter((f) => f.t === 'afflict' && f.dst === a && f.stacks > 0);
        adds += up.length;
        if (up.length) expect(auto).toBe(true);
      }
      expect(autos).toBeGreaterThan(3);
      expect(tele).toBeGreaterThan(1);
      if (kind === 'fallen_warden') expect(adds).toBeGreaterThan(3);
      else expect(adds).toBe(0);
    }
  });

  it('scaling: a third adventurer joining raises max hp ×1.45 keeping the fraction; never down when one dies', () => {
    const r = new BRig([camp('fallen_warden', 0, 0)]);
    const e = r.boss();
    const a = r.adv(0, 3), b = r.adv(3, 0);
    r.at(0.5);
    hit(r, a, e, 1); hit(r, b, e, 599);
    r.tick();
    expect(e.maxHp).toBe(6000);
    expect(e.hp / e.maxHp).toBeCloseTo(0.9, 9);
    const c = r.adv(-3, 0);
    hit(r, c, e, 0);
    r.tick();
    expect(e.maxHp).toBeCloseTo(8700, 9);
    expect(e.stagger.max).toBeCloseTo(300 * 1.45, 9);
    expect(e.hp / e.maxHp).toBeCloseTo(0.9, 9);
    hurtAdventurer(r.w, r.w.adventurers.get(c)!, 1e9, e.id, 'auto', r.now);
    r.tick();
    expect(e.maxHp).toBeCloseTo(8700, 9);
    const d = r.adv(0, -3), f = r.adv(2, 2);
    hit(r, d, e, 0); hit(r, f, e, 0);
    r.tick();
    expect(e.maxHp).toBeCloseTo(6000 * 1.9, 9);
  });

  it('a wipe resets: phase 0, adds gone (despawned, no credit), fields gone, enrage clock cleared, full hp at home', () => {
    const r = new BRig([camp('fallen_warden', 0, 0)]);
    const e = r.boss();
    const a = r.adv(0, 3), b = r.adv(3, 0);
    r.at(0.5);
    toPhase(r, e, a, 1);
    const shards = [...r.w.enemies.values()].filter((o) => o.kind === 'lens_shard').map((s) => s.id);
    expect(shards.length).toBe(2);
    expect([...r.c.fields()].length).toBe(1);
    for (const id of [a, b]) hurtAdventurer(r.w, r.w.adventurers.get(id)!, 1e9, e.id, 'auto', r.now);
    r.at(r.now + 3.2);
    expect(enemyAiStateOf(e)!.returnSince).toBeGreaterThan(r.now - 3.2);
    expect(r.bossEvents().map((x) => x.event)).toEqual(['wake', 'phase', 'reset']);
    expect(r.outs.flatMap((o) => o.despawned).sort()).toEqual(shards.sort());
    expect(r.outs.flatMap((o) => o.kills)).toEqual([]);
    expect([...r.c.fields()]).toEqual([]);
    expect([...r.c.telegraphs()]).toEqual([]);
    const v = r.c.get(e.id)!;
    expect([v.phase, v.enrageIn, v.warded]).toEqual([0, null, false]);
    r.at(r.now + 15);
    expect(e.act).toBe('');
    expect([e.hp, e.maxHp, e.x, e.z]).toEqual([6000, 6000, 0, 0]);
    // a fresh fight starts at phase 0 with a fresh clock
    const c = r.adv(0, 4);
    r.at(r.now + 1);
    expect(ai(e).wokeAt).toBeCloseTo(r.bossEvents().filter((x) => x.event === 'wake')[1].atS, 9);
    expect(ai(e).phase).toBe(0);
    void c;
  });

  it('resetEnemy (the instance wipe path) sends an engaged boss home at once with everything cleared', () => {
    const r = new BRig([camp('fallen_warden', 0, 0)]);
    const e = r.boss();
    const a = r.adv(0, 3);
    r.at(0.5);
    toPhase(r, e, a, 1);
    force(r, e, 3);
    r.tick();
    expect([...r.c.telegraphs()].length).toBeGreaterThan(0);
    expect(r.c.resetEnemy(e.id, r.now)).toBe(true);
    expect(e.act).toBe('return');
    expect([...r.c.telegraphs()]).toEqual([]);
    expect([...r.c.fields()]).toEqual([]);
    expect([...r.w.enemies.values()].filter((o) => o.kind === 'lens_shard')).toEqual([]);
    expect(r.c.get(e.id)!.phase).toBe(0);
    expect(r.c.resetEnemy(e.id, r.now)).toBe(false); // already going home
    expect(r.c.resetEnemy(9999, r.now)).toBe(false);
  });

  it("the Warden's death despawns live shards with no credit and removes fields", () => {
    const r = new BRig([camp('fallen_warden', 0, 0)]);
    const e = r.boss();
    const a = r.adv(0, 3);
    r.at(0.5);
    toPhase(r, e, a, 2);
    const shards = [...r.w.enemies.values()].filter((o) => o.kind === 'lens_shard' && o.alive).map((s) => s.id);
    expect(shards.length).toBe(2);
    force(r, e, 1);
    r.tick();
    hit(r, a, e, 1e9);
    r.tick();
    expect(e.alive).toBe(false);
    expect(r.outs.flatMap((o) => o.kills).map((k) => k.kind)).toEqual(['fallen_warden']);
    expect(r.outs.flatMap((o) => o.despawned).sort()).toEqual(shards.sort());
    expect([...r.c.fields()]).toEqual([]);
    expect([...r.c.telegraphs()]).toEqual([]);
  });

  it('thorn_hail still aims at the farthest engaged adventurer (aimAt); farthest-aim attacks skip anyone beyond useRange', () => {
    {
      const r = new BRig([camp('mossback', 0, 0)]);
      const e = r.boss('mossback');
      const a = r.adv(0, 3), b = r.adv(0, -8), c = r.adv(0, 14);
      r.at(0.3);
      hit(r, a, e, 50); hit(r, b, e, 1); hit(r, c, e, 1);
      r.at(12);
      const hail = r.attacks(e.id).find((t) => t.attack === 'thorn_hail')!;
      expect(hail.shape.kind).toBe('cone');
      if (hail.shape.kind === 'cone') expect(ang(hail.shape.dir - Math.PI)).toBeCloseTo(0, 1);
    }
    {
      const r = new BRig([camp('fallen_warden', 0, 0)]);
      const e = r.boss();
      const a = r.adv(0, 3), b = r.adv(0, -20), c = r.adv(0, 38);
      r.at(0.5);
      hit(r, a, e, 50); hit(r, b, e, 1); hit(r, c, e, 1);
      toPhase(r, e, a, 1);
      force(r, e, 0);
      r.tick();
      const lance = r.attacks(e.id).filter((t) => t.attack === 'beacon_lance').at(-1)!;
      if (lance.shape.kind !== 'line') throw new Error('not a line');
      expect(ang(lance.shape.dir - Math.PI)).toBeCloseTo(0, 1);
    }
  });

  it('the arena rule: boss attacks and fields hit only adventurers inside; outside adventurers cannot damage it or hold its threat', () => {
    const arena = (x: number, z: number) => Math.hypot(x, z) <= 22;
    const r = new BRig([{ ...camp('fallen_warden', 0, 0), arena }]);
    const e = r.boss();
    const a = r.adv(0, 3), b = r.adv(0, 16, { hold: false }), out = r.adv(0, 30);
    r.at(0.5);
    hit(r, b, e, 1);
    const hp = e.hp, n = r.hits().filter((h) => h.dst === e.id).length;
    hit(r, out, e, 100);
    expect(e.hp).toBe(hp);
    expect(r.hits().filter((h) => h.dst === e.id).length).toBe(n);
    expect(e.threat.has(out)).toBe(false);
    force(r, e, 3);
    r.at(r.now + 3.2);
    expect(r.hits(e.id).filter((h) => h.by === 'keepers_toll').map((h) => h.dst).sort()).toEqual([a, b].sort());
    toPhase(r, e, a, 1);
    for (const s of [...r.w.enemies.values()].filter((o) => o.kind === 'lens_shard')) expect(s.camp.arena).toBe(arena);
    const f0 = r.fx('hit').filter((h) => h.by === 'field').length;
    r.at(r.now + 2.05);
    expect(new Set(r.fx('hit').filter((h) => h.by === 'field').slice(f0).map((h) => h.dst))).toEqual(new Set([b]));
    // b walks out: it leaves the threat table at once
    expect(e.threat.has(b)).toBe(true);
    r.c.setPose(b, 0, 26, 0, 0);
    r.tick();
    expect(e.threat.has(b)).toBe(false);
    // everyone out: the boss resets
    r.hooks.length = 0;
    r.c.setPose(a, 0, 25, 0, 0);
    r.at(r.now + 3.5);
    expect(r.bossEvents().at(-1)!.event).toBe('reset');
  });

  it('telegraphs are readable: every boss and add wind-up leaves at least 0.6 s to react at 150 ms latency, and every one can be escaped', () => {
    const latency = 0.15, tick = 1 / TICK_HZ;
    let minWindow = Infinity;
    for (const kind of ['wickhound', 'fallen_warden', 'lens_shard'] as const) {
      for (const id of ENEMY_KINDS[kind].attacks) {
        const atk = ENEMY_ATTACKS[id];
        expect(atk.windup).toBeGreaterThanOrEqual(1.0);
        // seen one tick and one latency after it is placed; the reply takes one more latency
        const window = atk.windup - tick - 2 * latency;
        minWindow = Math.min(minWindow, window);
        // worst-case distance to the edge, by shape; whole-arena attacks are answered by a dodge's i-frames
        const r = atk.r ?? 0;
        const escape = atk.shape === 'line' ? (atk.width ?? 0) / 2
          : atk.shape === 'ring-self' ? (r - (atk.inner ?? 0)) / 2
            : atk.shape === 'cone' ? r * Math.sin((atk.angle ?? 0) / 2)
              : r >= 40 ? 0 : r;
        expect(DODGE_DISTANCE + RUN_SPEED * Math.max(0, window - DODGE_S)).toBeGreaterThanOrEqual(escape);
      }
    }
    expect(minWindow).toBeGreaterThanOrEqual(0.63 - 1e-9);
    // live: a dodge landing 0.25 s before the end beats the whole-arena Toll and Last Light
    for (const idx of ['toll', 'last'] as const) {
      const r = new BRig([camp('fallen_warden', 0, 0)]);
      const e = r.boss();
      const a = r.adv(0, 3, { hold: false });
      r.at(0.5);
      if (idx === 'last') { ai(e).wokeAt = r.now - 330; }
      else force(r, e, 3);
      for (let n = 0; n < 100 && !e.windup; n++) r.tick();
      const end = e.windup!.endsAt;
      r.at(end - 0.25);
      expect(r.i(a, { t: 'dodge', dx: 1, dz: 0, from: { x: 0, z: 3, y: 0 }, grounded: true })).toBeNull();
      r.at(end + 0.1);
      const atk = idx === 'toll' ? 'keepers_toll' : 'last_light';
      expect(r.hits(e.id).filter((h) => h.by === atk)).toEqual([]);
      expect(r.fx('miss').filter((m) => m.src === e.id && m.dst === a && m.perfect).length).toBeGreaterThan(0);
    }
  });

  it('no unavoidable one-shot at full hp at Plan 3b power: the worst single telegraph, a field tick and an auto together, at 5 Searing stacks', () => {
    const def = STARTER_STATS.defence, sear = 1.5;
    for (const kind of ['wickhound', 'fallen_warden', 'lens_shard'] as const) {
      const k = ENEMY_KINDS[kind];
      const auto = k.auto ? enemyHit(k.auto.raw, def, sear) : 0;
      const field = Math.max(0, ...Object.values(BOSSES).flatMap((b) => b.phases.flatMap((p) => p.onEnter?.fields ?? []).map((f) => enemyHit(f.raw, def, sear))));
      for (const id of k.attacks) {
        const worst = enemyHit(ENEMY_ATTACKS[id].raw, def, sear) + field + auto;
        expect(worst, id).toBeLessThan(STARTER_STATS.maxHp);
      }
    }
  });

  it('determinism: two engines, same seed and intents, identical TickOut streams over a 400 s Warden fight', () => {
    const run = () => {
      const r = new BRig([camp('fallen_warden', 0, 0)], 7);
      const e = r.boss();
      const ids = [[0, 3.5], [3.5, 0], [-3.5, 0], [0, -3.5]].map(([x, z]) => r.adv(x, z, { stats: { power: 13, defence: 10, maxHp: 1e6 } }));
      r.hooks.push(() => {
        const shard = [...r.w.enemies.values()].find((o) => o.kind === 'lens_shard' && o.alive);
        for (const id of ids) {
          r.i(id, { t: 'target', id: shard ? shard.id : e.id });
          if (r.k % 15 === 0) r.press(id, 0);
        }
      });
      r.at(400);
      return r;
    };
    const one = run(), two = run();
    expect(JSON.stringify(one.outs)).toBe(JSON.stringify(two.outs));
    const ev = one.bossEvents().map((b) => b.event);
    expect(ev).toContain('wake');
    expect(ev.filter((x) => x === 'phase').length).toBe(2);
    expect(ev).toContain('enrage');
    expect(one.fx('spawn').filter((s) => s.src !== undefined).length).toBe(2);
  });

  it('budget: one tick of a Warden fight with 4 adventurers, 2 shards and 8 telegraphs averages under 1 ms', () => {
    const r = new BRig([camp('fallen_warden', 0, 0)]);
    const e = r.boss();
    const ids = [[0, 3.5], [3.5, 0], [-3.5, 0], [0, -3.5]].map(([x, z]) => r.adv(x, z));
    r.at(0.5);
    for (const id of ids) hit(r, id, e, 1);
    toPhase(r, e, ids[0], 2);
    force(r, e, 0);
    r.at(r.now + 4.3);
    expect([...r.w.enemies.values()].filter((o) => o.kind === 'lens_shard').length).toBe(2);
    expect([...r.c.telegraphs()].length).toBeGreaterThanOrEqual(2);
    const t0 = Date.now();
    const N = 600;
    for (let k = 0; k < N; k++) r.tick();
    expect((Date.now() - t0) / N).toBeLessThan(1);
  });
});
