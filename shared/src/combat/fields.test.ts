// Plan 4 engine pieces: ground fields, Searing, spawned adds and despawning, stats on addAdventurer.
import { describe, expect, it } from 'vitest';
import type { Loadout } from './abilities';
import { damageEnemy, hurtAdventurer } from './adventurer';
import { BOSSES, type FieldDef } from './bosses';
import { AGGRO_THREAT } from './constants';
import { AFFLICTIONS } from './afflictions';
import { createCombat, worldOf, type EnemyState } from './engine';
import { resolveHit } from './enemyAi';
import { ENEMY_KINDS } from './enemies';
import { addField, removeFieldsOf } from './fields';
import { spawnEnemy, despawnEnemy } from './adventurer';
import { enemyHit, hitDamage, STARTER_STATS } from './stats';
import { Rig, camp, flatZone } from './testRig';

const RING: FieldDef = { id: 'lampfire', shape: { kind: 'ring', x: 0, z: 0, dir: 0, inner: 15, r: 40 }, raw: 8 };
// slots: tidelash, lantern_flare, wellspring, soft_rain, mistveil
const WHITE: Loadout = { job: 'white_mage', picks: ['soft_rain', 'mistveil'] };
const DEF = STARTER_STATS.defence;

const fieldHits = (r: Rig) => r.fx('hit').filter((h) => h.by === 'field');

describe('fields', () => {
  it('every field shape in the boss scripts is a ring with 0 < inner < r', () => {
    let n = 0;
    for (const b of Object.values(BOSSES)) {
      for (const p of b.phases) {
        for (const f of p.onEnter?.fields ?? []) {
          n++;
          expect(f.shape.kind).toBe('ring');
          if (f.shape.kind !== 'ring') continue;
          expect(f.shape.inner).toBeGreaterThan(0);
          expect(f.shape.inner).toBeLessThan(f.shape.r);
        }
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it('a ring field hits at each whole second inside it, by ground x/z, through shields, ignoring i-frames', () => {
    const r = new Rig([camp('dummy', 5, 5)]);
    const owner = r.w.enemies.get(r.enemy('dummy'))!;
    const inside = r.add(25, 5), hole = r.add(10, 5), air = r.add(5, 25), shielded = r.add(-15, 5), dodging = r.add(5, -15);
    r.c.setPose(air, 5, 25, 6, 0);
    const sa = r.w.adventurers.get(shielded)!; sa.shield = 20; sa.shieldUntil = 100;
    const fid = addField(r.w, owner, RING, r.now);
    const view = [...r.c.fields()];
    expect(view).toEqual([{ id: fid, owner: owner.id, field: 'lampfire', shape: { kind: 'ring', x: 5, z: 5, dir: 0, inner: 15, r: 40 }, raw: 8, startedAt: 0 }]);
    r.at(0.9);
    expect(fieldHits(r)).toEqual([]);
    r.w.adventurers.get(dodging)!.iframeUntil = 100;
    r.at(1.05);
    const amount = enemyHit(8, DEF);
    expect(fieldHits(r).map((h) => [h.dst, h.amount, h.absorbed, h.src])).toEqual([
      [inside, amount, 0, owner.id], [air, amount, 0, owner.id], [shielded, 0, amount, owner.id], [dodging, amount, 0, owner.id],
    ]);
    r.at(2.05);
    expect(fieldHits(r).length).toBe(8);
    expect(r.c.get(hole)!.hp).toBe(100);
    expect(r.c.get(inside)!.hp).toBe(100 - 2 * amount);
  });

  it('a field never breaks a cast, never knocks, never adds Searing', () => {
    const r = new Rig([camp('fallen_warden', 0, 0)]);
    const owner = r.w.enemies.get(r.enemy('fallen_warden'))!;
    const wm = r.add(20, 0, WHITE, 60);
    addField(r.w, owner, RING, r.now);
    r.at(0.5);
    expect(r.press(wm, 2)).toBeNull(); // Wellspring: cast 1.5 s, across the tick at 1 s
    r.at(2.2);
    expect(fieldHits(r).length).toBe(2);
    expect(r.fx('castEnd').map((c) => c.ok)).toEqual([true]);
    expect(r.outs.flatMap((o) => o.displaced)).toEqual([]);
    expect(r.c.get(wm)!.searing).toBe(0);
    expect(r.fx('afflict')).toEqual([]);
  });

  it("removeFieldsOf removes only that owner's fields; an owner's death removes its fields", () => {
    const r = new Rig([camp('dummy', 0, 0), camp('dummy', 30, 0)]);
    const [a, b] = [...r.w.enemies.values()];
    addField(r.w, a, RING, 0);
    const keep = addField(r.w, b, RING, 0);
    addField(r.w, a, { ...RING, id: 'lampfire_deep' }, 0);
    removeFieldsOf(r.w, a.id);
    expect([...r.c.fields()].map((f) => f.id)).toEqual([keep]);
    const hitter = r.add(31, 0);
    damageEnemy(r.w, hitter, b, 1e6, 'auto', r.now);
    expect([...r.c.fields()]).toEqual([]);
    expect(r.w.fields.size).toBe(0);
  });

  it('Searing: +1 stack per landed auto up to 5, ×(1 + 0.1 × stacks) taken, expires 8 s after the last, gone on death', () => {
    const r = new Rig([camp('fallen_warden', 0, 0)]);
    const warden = r.w.enemies.get(r.enemy('fallen_warden'))!;
    const raw = ENEMY_KINDS.fallen_warden.auto!.raw;
    const a = r.add(0, -3, undefined, 100);
    const st = r.w.adventurers.get(a)!;
    st.stats = { ...st.stats, maxHp: 1000 }; st.hp = 1000;
    const amounts: number[] = [];
    for (let k = 0; k < 7; k++) {
      r.at(k * 0.5);
      const before = r.c.get(a)!.hp;
      resolveHit(r.w, warden, st, raw, 'auto', true, null, r.now);
      amounts.push(before - r.c.get(a)!.hp);
    }
    expect(amounts).toEqual([0, 1, 2, 3, 4, 5, 5].map((s) => enemyHit(raw, DEF, 1 + AFFLICTIONS.searing.takenPerStack * s)));
    expect(r.c.get(a)!.searing).toBe(5);
    expect(r.fx('afflict').map((f) => [f.src, f.dst, f.id, f.stacks])).toEqual([1, 2, 3, 4, 5].map((s) => [warden.id, a, 'searing', s]));
    // a miss adds nothing; a shield-absorbed auto counts as landed
    st.iframeUntil = r.now + 0.3;
    resolveHit(r.w, warden, st, raw, 'auto', true, null, r.now);
    // the field tick scales with Searing too
    addField(r.w, warden, { id: 'lampfire', shape: { kind: 'ring', x: 0, z: 0, dir: 0, inner: 1, r: 40 }, raw: 8 }, r.now);
    const last = r.now;
    r.at(last + 1.05);
    expect(fieldHits(r).map((h) => h.amount)).toEqual([enemyHit(8, DEF, 1.5)]);
    r.at(last + 7.9);
    expect(r.c.get(a)!.searing).toBe(5);
    r.at(last + 8.1);
    expect(r.c.get(a)!.searing).toBe(0);
    expect(r.fx('afflict').at(-1)).toMatchObject({ dst: a, stacks: 0 });
    // shields count; death clears
    st.shield = 50; st.shieldUntil = r.now + 10;
    resolveHit(r.w, warden, st, raw, 'auto', true, null, r.now);
    resolveHit(r.w, warden, st, raw, 'auto', true, null, r.now);
    expect(r.c.get(a)!.searing).toBe(2);
    hurtAdventurer(r.w, st, 1e6, warden.id, 'auto', r.now);
    expect(r.c.get(a)!.searing).toBe(0);
    expect(st.afflictions.size).toBe(0);
    // a revive starts with none, and carryOf carries none
    r.c.revive(a, { x: 0, z: -3, y: 0 }, r.now);
    expect(r.c.get(a)!.searing).toBe(0);
    expect(JSON.stringify(r.c.carryOf(a))).not.toContain('searing');
    // a Plan 3 auto (no afflict) adds nothing
    const t = new Rig([camp('thornling', 0, 0)]);
    const th = t.w.enemies.get(t.enemy('thornling'))!;
    const b = t.add(0, -1);
    resolveHit(t.w, th, t.w.adventurers.get(b)!, 5, 'auto', true, null, t.now);
    expect(t.c.get(b)!.searing).toBe(0);
  });

  it('Wellspring cleanses Searing', () => {
    const r = new Rig([camp('fallen_warden', 0, 0)]);
    const warden = r.w.enemies.get(r.enemy('fallen_warden'))!;
    const wm = r.add(0, -3, WHITE, 100);
    const st = r.w.adventurers.get(wm)!;
    for (let k = 0; k < 3; k++) resolveHit(r.w, warden, st, 9, 'auto', true, null, r.now);
    expect(r.c.get(wm)!.searing).toBe(3);
    expect(r.press(wm, 2)).toBeNull(); // Wellspring on self
    r.at(1.6);
    expect(r.c.get(wm)!.searing).toBe(0);
    expect(r.fx('afflict').at(-1)).toMatchObject({ src: wm, dst: wm, stacks: 0 });
  });
});

describe('spawning and despawning', () => {
  it('spawnEnemy: an add engaged with the given adventurers, never respawning; despawnEnemy drops it, its telegraphs and fields, with no credit, listed in despawned', () => {
    const r = new Rig([camp('dummy', 30, 30)], { liveEnemies: true });
    const boss = r.w.enemies.get(r.enemy('dummy'))!;
    const a = r.add(0, -6), b = r.add(3, -6), away = r.add(50, 50);
    const add = spawnEnemy(r.w, { kind: 'lens_shard', x: 0, z: 0, facing: 0 }, { engageWith: [a, b], scale: 1.45, nowS: r.now, src: boss.id });
    expect(r.w.enemies.get(add.id)).toBe(add);
    expect(add.maxHp).toBeCloseTo(420 * 1.45, 9);
    expect(add.hp).toBe(add.maxHp);
    expect(add.threat.ids()).toEqual([a, b]);
    expect(add.threat.get(a)).toBe(AGGRO_THREAT);
    expect(add.threat.has(away)).toBe(false);
    expect(r.fx('spawn')).toEqual([{ at: 0, t: 'spawn', dst: add.id, src: boss.id }]);
    r.at(1);
    // a stationary add never resets itself (unreachable rule, leash): it keeps its table for good
    r.at(20);
    expect(add.act).not.toBe('return');
    expect(add.threat.ids().length).toBeGreaterThan(0);
    // killed: credited as usual, never respawns, then pruned
    damageEnemy(r.w, a, add, 1e6, 'auto', r.now);
    const out = r.tick();
    expect(out.kills).toEqual([{ enemy: add.id, kind: 'lens_shard', credit: [a, b] }]);
    expect(out.despawned).toEqual([add.id]);
    r.at(r.now + 120);
    expect(r.fx('spawn').length).toBe(1);
    expect(r.w.enemies.has(add.id)).toBe(false);

    const add2 = spawnEnemy(r.w, { kind: 'lens_shard', x: 0, z: 0, facing: 0 }, { engageWith: [a], scale: 1, nowS: r.now });
    expect(r.c.intent(a, { t: 'target', id: add2.id }, r.now)).toBeNull();
    addField(r.w, add2, RING, r.now);
    const tid = r.w.nextTelegraphId++;
    r.w.telegraphs.set(tid, { id: tid, owner: add2.id, attack: 'focus_beam', shape: { kind: 'circle', x: 0, z: 0, r: 2 }, startedAt: r.now, endsAt: r.now + 5 });
    add2.windup = { attack: 'focus_beam', startedAt: r.now, endsAt: r.now + 5, interruptible: true, telegraphId: tid };
    const tid2 = r.w.nextTelegraphId++;
    r.w.telegraphs.set(tid2, { id: tid2, owner: add2.id, attack: 'focus_beam', shape: { kind: 'circle', x: 0, z: 0, r: 2 }, startedAt: r.now, endsAt: r.now + 5 });
    const deaths = r.fx('death').length;
    despawnEnemy(r.w, add2);
    despawnEnemy(r.w, add2); // idempotent
    const out2 = r.tick();
    expect(out2.despawned).toEqual([add2.id]);
    expect(out2.kills).toEqual([]);
    expect(r.fx('death').length).toBe(deaths);
    expect([...r.c.telegraphs()]).toEqual([]);
    expect([...r.c.fields()]).toEqual([]);
    expect(r.c.get(add2.id)).toBeUndefined();
    expect(r.c.get(a)!.targetId).toBeNull();
  });

  it('stats on addAdventurer set power, defence and maxHp', () => {
    const r = new Rig([camp('thornling', 0, 0)]);
    const e = r.w.enemies.get(r.enemy('thornling'))!;
    const id = r.c.addAdventurer({ x: 0, z: -1, y: 0, facing: 0, hp: 180, loadout: { job: 'warrior', picks: ['mend', 'bulwark'] }, stats: { power: 20, defence: 24, maxHp: 180 } }, 0);
    expect(r.c.get(id)).toMatchObject({ hp: 180, maxHp: 180 });
    r.i(id, { t: 'target', id: e.id });
    r.at(0.1);
    expect(r.hits(id)[0].amount).toBe(hitDamage(1.0, 20, e.data.defence));
    const before = r.c.get(id)!.hp;
    resolveHit(r.w, e, r.w.adventurers.get(id)!, 30, 'thorn_burst', false, null, r.now);
    expect(before - r.c.get(id)!.hp).toBe(enemyHit(30, 24));
    r.c.revive(id, { x: 0, z: -1, y: 0 }, r.now);
    expect(r.c.get(id)).toMatchObject({ hp: 180, maxHp: 180 });
    // junk stats fall back to the starter's, field by field
    const junk = r.c.addAdventurer({ x: 0, z: -1, y: 0, facing: 0, hp: 500, loadout: { job: 'warrior', picks: ['mend', 'bulwark'] }, stats: { power: NaN, defence: -3, maxHp: 0 } }, 0);
    expect(r.w.adventurers.get(junk)!.stats).toEqual(STARTER_STATS);
    expect(r.c.get(junk)!.hp).toBe(100);
  });

  it('determinism with parties, fields and adds: identical TickOut streams over 60 s', () => {
    const run = () => {
      const zone = flatZone([camp('thornling', 0, 6), camp('boar', 6, 6), camp('dummy', 0, 20)]);
      const c = createCombat(zone, { seed: 42, nowS: 0 });
      const w = worldOf(c);
      const ids = [
        c.addAdventurer({ x: -2, z: 0, y: 0, facing: 0, hp: 100, loadout: { job: 'warrior', picks: ['rallying_roar', 'mend'] } }, 0),
        c.addAdventurer({ x: 2, z: 0, y: 0, facing: 0, hp: 100, loadout: WHITE }, 0),
        c.addAdventurer({ x: 0, z: -2, y: 0, facing: 0, hp: 100, loadout: { job: 'paladin', picks: ['dawn_ward', 'shelter'] } }, 0),
        c.addAdventurer({ x: 4, z: -2, y: 0, facing: 0, hp: 100, loadout: { job: 'ranger', picks: ['field_dressing', 'sprint'] } }, 0),
      ];
      c.setParty(ids[0], 'p1'); c.setParty(ids[1], 'p1'); c.setParty(ids[2], 'p1');
      const dummy = [...w.enemies.values()].find((e) => e.kind === 'dummy')!;
      const outs: string[] = [];
      let add: EnemyState | null = null;
      for (let k = 0; k < 900; k++) {
        const t = k / 15;
        if (k === 30) addField(w, dummy, { id: 'lampfire', shape: { kind: 'ring', x: 0, z: 0, dir: 0, inner: 18, r: 40 }, raw: 8 }, t);
        if (k === 75) add = spawnEnemy(w, { kind: 'lens_shard', x: -6, z: 6, facing: 0 }, { engageWith: ids, scale: 1.45, nowS: t, src: dummy.id });
        if (k === 600 && add) despawnEnemy(w, add);
        if (k === 450) c.setParty(ids[2], null);
        if (k % 15 === 0) {
          for (const id of ids) {
            const v = c.get(id)!;
            if (!v.alive) continue;
            const live = [...c.all()].filter((x) => x.team === 'enemy' && x.alive && x.kind !== 'dummy');
            if (live.length && v.targetId === null) c.intent(id, { t: 'target', id: live[(id + k) % live.length].id }, t);
            c.intent(id, { t: 'ability', slot: (k / 15 + id) % 5, phase: 'press' }, t);
          }
        }
        const out = c.tick(t);
        outs.push(JSON.stringify(out));
        if (k % 15 === 0) for (const id of ids) { const v = c.get(id)!; c.setPose(id, v.x + 0.1, v.z + 0.05, 0, v.facing); }
      }
      return outs;
    };
    const a = run(), b = run();
    expect(a.length).toBe(900);
    expect(a).toEqual(b);
    const joined = a.join('');
    expect(joined).toContain('"by":"field"');
    expect(joined).toContain('"despawned":[');
  });
});
