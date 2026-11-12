import { describe, expect, it } from 'vitest';
import {
  AFFLICTIONS, BOSSES, ELITE_SCALE_PER, ENCOUNTERS, ENCOUNTER_IDS, ENEMY_ATTACKS, ENEMY_KINDS, KILL_XP, ROTATION_SKIP_S,
  afflictionBits, escapeDir, inShape, scaleFactor, type EnemyKindId, type Shape,
} from './index';

describe('boss and add data', () => {
  it('the three new kinds have the Numbers table values', () => {
    expect(ENEMY_KINDS.wickhound).toMatchObject({
      id: 'wickhound', name: 'the Wickhound', tier: 'boss', elite: true, hp: 2600, defence: 15, radius: 1.4, speed: 4.5,
      aggro: 10, leash: 14, respawn: Infinity, stagger: 220, weak: 'water', resist: 'fire',
      auto: { reach: 3.0, every: 2.2, raw: 10, ranged: false }, attacks: ['wick_lunge', 'ember_breath', 'cinder_ring'],
    });
    expect(ENEMY_KINDS.wickhound.auto?.afflict).toBeUndefined();
    expect(ENEMY_KINDS.fallen_warden).toMatchObject({
      id: 'fallen_warden', name: 'the Fallen Warden', tier: 'mega', elite: true, hp: 6000, defence: 18, radius: 1.8, speed: 3.5,
      aggro: 10, leash: 20, respawn: Infinity, stagger: 300, weak: 'water', resist: 'fire',
      auto: { reach: 3.2, every: 2.8, raw: 9, ranged: false, afflict: 'searing' },
      attacks: ['lamp_sweep', 'brass_fall', 'keepers_toll', 'beacon_lance', 'turning_light', 'last_light'],
    });
    expect(ENEMY_KINDS.lens_shard).toMatchObject({
      id: 'lens_shard', name: 'Lens Shard', tier: 'ordinary', elite: false, hp: 420, defence: 5, radius: 0.8, speed: 0,
      aggro: 40, respawn: Infinity, stagger: 0, weak: 'lightning', auto: null, attacks: ['focus_beam'],
    });
    expect(ENEMY_KINDS.lens_shard.resist).toBeUndefined();
    expect(Object.fromEntries(Object.values(ENEMY_KINDS).map((k) => [k.id, k.tier]))).toEqual({
      thornling: 'ordinary', boar: 'ordinary', archer: 'ordinary', dummy: 'ordinary', mossback: 'elite',
      wickhound: 'boss', fallen_warden: 'mega', lens_shard: 'ordinary',
    });
    for (const k of Object.values(ENEMY_KINDS)) expect(k.boss !== undefined).toBe(k.tier === 'boss' || k.tier === 'mega');
    expect(ENEMY_KINDS.wickhound.boss).toBe(BOSSES.wickhound);
    expect(ENEMY_KINDS.fallen_warden.boss).toBe(BOSSES.fallen_warden);

    const A = ENEMY_ATTACKS;
    expect(A.wick_lunge).toMatchObject({ name: 'Wick Lunge', shape: 'line', length: 10, width: 2.2, windup: 1.3, raw: 28, knock: { speed: 10, seconds: 0.35, vy: 4 }, dashToEnd: true, useRange: 9 });
    expect(A.ember_breath).toMatchObject({ name: 'Ember Breath', shape: 'cone', r: 9, windup: 1.8, raw: 30, interruptible: true, useRange: 8 });
    expect(A.ember_breath.angle).toBeCloseTo(Math.PI / 3, 12);
    expect(A.cinder_ring).toMatchObject({ name: 'Cinder Ring', shape: 'ring-self', inner: 3.5, r: 9, windup: 1.6, raw: 26 });
    expect(A.lamp_sweep).toMatchObject({ name: 'Lamp Sweep', shape: 'cone', r: 12, windup: 1.6, raw: 28, useRange: 12 });
    expect(A.lamp_sweep.angle).toBeCloseTo((100 * Math.PI) / 180, 12);
    expect(A.brass_fall).toMatchObject({ name: 'Brass Fall', shape: 'circle-target', r: 3, windup: 2.0, raw: 24, targets: 'each' });
    expect(A.keepers_toll).toMatchObject({ name: "Keeper's Toll", shape: 'circle-self', r: 40, windup: 3.0, raw: 34, interruptible: true });
    expect(A.beacon_lance).toMatchObject({ name: 'Beacon Lance', shape: 'line', length: 30, width: 3, windup: 1.8, raw: 36, aimAt: 'farthest', knock: { speed: 12, seconds: 0.4, vy: 5 } });
    expect(A.turning_light).toMatchObject({ name: 'Turning Light', shape: 'line', length: 28, width: 3.5, windup: 1.4, raw: 30, repeat: { count: 8, every: 0.6 } });
    expect(A.last_light).toMatchObject({ name: 'Last Light', shape: 'circle-self', r: 40, windup: 1.0, raw: 15, ramp: 5 });
    expect(A.focus_beam).toMatchObject({ name: 'Focus Beam', shape: 'line', length: 20, width: 1.6, windup: 1.5, raw: 18, interruptible: true, cooldown: 7, firstAt: 3, aimAt: 'farthest' });
    expect(A.thorn_hail.aimAt).toBe('farthest');
    for (const a of Object.values(A)) if (a.id !== 'thorn_hail' && a.id !== 'beacon_lance' && a.id !== 'focus_beam') expect(a.aimAt).toBeUndefined();

    expect(AFFLICTIONS.searing).toEqual({ id: 'searing', name: 'Searing', maxStacks: 5, s: 8, takenPerStack: 0.10, bit: 1 });
    expect(afflictionBits({})).toBe(0);
    expect(afflictionBits({ searing: 3 })).toBe(1);
    expect(afflictionBits({ searing: 0 })).toBe(0);
    expect(ROTATION_SKIP_S).toBe(4);
  });

  it('rule tables are frozen all the way down', () => {
    expect(Object.isFrozen(ENEMY_KINDS.fallen_warden.boss!.phases[1].onEnter!.adds![0])).toBe(true);
    expect(Object.isFrozen(ENEMY_ATTACKS.turning_light.repeat)).toBe(true);
    expect(Object.isFrozen(ENCOUNTERS.cog_hall.spawns[0])).toBe(true);
    expect(Object.isFrozen(AFFLICTIONS.searing)).toBe(true);
    expect(Object.isFrozen(ENCOUNTER_IDS)).toBe(true);
  });

  it('every wind-up is at least 1.0 s', () => {
    for (const a of Object.values(ENEMY_ATTACKS)) expect(a.windup, a.id).toBeGreaterThanOrEqual(1.0);
  });

  it("every boss phase rotation names only its own kind's attacks, and untilFrac falls to 0", () => {
    const bosses = Object.values(ENEMY_KINDS).filter((k) => k.boss);
    expect(bosses.map((k) => k.id).sort()).toEqual(['fallen_warden', 'wickhound']);
    for (const k of bosses) {
      const b = k.boss!;
      expect(b.phases.length).toBeGreaterThan(1);
      expect(b.lore.phases.length).toBe(b.phases.length);
      expect(b.lore.victory.length).toBeGreaterThan(0);
      b.phases.forEach((p, i) => {
        expect(p.index).toBe(i);
        expect(p.rotation.length).toBeGreaterThan(0);
        expect(p.gap).toBeGreaterThan(0);
        for (const id of p.rotation) expect(k.attacks, `${k.id} ${id}`).toContain(id);
        if (i > 0) expect(p.untilFrac).toBeLessThan(b.phases[i - 1].untilFrac);
        for (const add of p.onEnter?.adds ?? []) expect(ENEMY_KINDS[add.kind].tier).toBe('ordinary');
      });
      expect(b.phases[0].untilFrac).toBeLessThan(1);
      expect(b.phases[b.phases.length - 1].untilFrac).toBe(0);
      if (b.enrage) expect(k.attacks).toContain(b.enrage.attack);
      // every attack of a boss is used somewhere: in a rotation or as its enrage
      for (const id of k.attacks) expect(b.phases.some((p) => p.rotation.includes(id)) || b.enrage?.attack === id, id).toBe(true);
    }
    const w = BOSSES.wickhound, f = BOSSES.fallen_warden;
    expect(w.phases.map((p) => [p.name, p.untilFrac, [...p.rotation], p.gap, p.autoEvery ?? null])).toEqual([
      ['Brass Hound', 0.5, ['wick_lunge', 'ember_breath'], 3.5, null],
      ['Wick Unbound', 0, ['wick_lunge', 'cinder_ring', 'ember_breath'], 3.0, 1.8],
    ]);
    expect([w.transitionS, w.breakS, w.enrage]).toEqual([2, undefined, undefined]);
    expect(f.phases.map((p) => [p.name, p.untilFrac, [...p.rotation], p.gap, p.autoEvery ?? null, p.anchor ?? false])).toEqual([
      ['The Keeper Wakes', 0.7, ['lamp_sweep', 'brass_fall', 'lamp_sweep', 'keepers_toll'], 3.0, null, false],
      ['The Lamp Kindles', 0.35, ['beacon_lance', 'lamp_sweep', 'keepers_toll', 'brass_fall'], 2.6, null, false],
      ['The Lens Falls', 0, ['turning_light', 'brass_fall', 'lamp_sweep', 'keepers_toll', 'beacon_lance'], 2.4, 2.4, true],
    ]);
    expect(f.phases[0].onEnter).toBeUndefined();
    expect(f.phases[1].onEnter).toEqual({
      fields: [{ id: 'lampfire', shape: { kind: 'ring', x: 0, z: 0, dir: 0, inner: 15, r: 40 }, raw: 8 }],
      adds: [{ kind: 'lens_shard', dx: -10, dz: 0 }, { kind: 'lens_shard', dx: 10, dz: 0 }],
      wardMult: 0.4,
    });
    expect(f.phases[2].onEnter).toEqual({ clearFields: true, fields: [{ id: 'lampfire_deep', shape: { kind: 'ring', x: 0, z: 0, dir: 0, inner: 12, r: 40 }, raw: 10 }] });
    expect([f.transitionS, f.breakS, f.enrage]).toEqual([4, 5, { s: 330, attack: 'last_light', every: 4 }]);
    expect(f.lore.victory).toBe("The Warden's lamp steadies, and for a moment its beam points the same way as Ellie's arm.");
    expect([...w.scale]).toEqual([1, 1, 1.5, 2.0]);
    expect([...f.scale]).toEqual([1, 1, 1.45, 1.9]);
  });

  it("scaleFactor: Plan 3 elites unchanged; the Warden 1, 1, 1.45, 1.9; never below 1; n above 4 counts as 4", () => {
    const K = ENEMY_KINDS;
    expect([1, 2, 3, 4, 5].map((n) => scaleFactor(K.mossback, n))).toEqual([1, 1 + ELITE_SCALE_PER, 1 + 2 * ELITE_SCALE_PER, 1 + 3 * ELITE_SCALE_PER, 1 + 3 * ELITE_SCALE_PER]);
    expect([1, 2, 3, 4, 5, 9].map((n) => scaleFactor(K.fallen_warden, n))).toEqual([1, 1, 1.45, 1.9, 1.9, 1.9]);
    expect([1, 2, 3, 4, 7].map((n) => scaleFactor(K.wickhound, n))).toEqual([1, 1, 1.5, 2.0, 2.0]);
    for (const n of [0, -3, NaN, 0.5]) {
      expect(scaleFactor(K.fallen_warden, n)).toBe(1);
      expect(scaleFactor(K.mossback, n)).toBe(1);
    }
    for (const id of ['thornling', 'boar', 'archer', 'dummy', 'lens_shard'] as EnemyKindId[]) {
      for (const n of [1, 2, 4, 8]) expect(scaleFactor(K[id], n)).toBe(1);
    }
    for (const k of Object.values(K)) for (let n = 1; n <= 6; n++) expect(scaleFactor(k, n)).toBeGreaterThanOrEqual(1);
    for (const b of Object.values(BOSSES)) for (let i = 1; i < 4; i++) expect(b.scale[i]).toBeGreaterThanOrEqual(b.scale[i - 1]);
  });

  it('turning_light covers a full turn (count × rotate = 2π) and last_light ramps', () => {
    const r = ENEMY_ATTACKS.turning_light.repeat!;
    expect(r.rotate).toBeCloseTo(Math.PI / 4, 12);
    expect(r.count * r.rotate).toBeCloseTo(2 * Math.PI, 12);
    expect(ENEMY_ATTACKS.last_light.ramp).toBe(5);
    expect([0, 1, 2].map((k) => ENEMY_ATTACKS.last_light.raw + k * ENEMY_ATTACKS.last_light.ramp!)).toEqual([15, 20, 25]);
    for (const a of Object.values(ENEMY_ATTACKS)) if (a.id !== 'turning_light') expect(a.repeat).toBeUndefined();
    for (const a of Object.values(ENEMY_ATTACKS)) if (a.id !== 'last_light') expect(a.ramp).toBeUndefined();
  });

  it("encounter spawns sit inside their room with the kind's radius + 1 m to spare, at least 3 m apart", () => {
    expect([...ENCOUNTER_IDS]).toEqual(['root_cellar', 'brass_gallery', 'cog_hall', 'wickhound', 'warden']);
    expect(Object.keys(ENCOUNTERS).sort()).toEqual([...ENCOUNTER_IDS].sort());
    expect(Object.fromEntries(ENCOUNTER_IDS.map((id) => [id, [ENCOUNTERS[id].room, ENCOUNTERS[id].roomR, ENCOUNTERS[id].boss ?? null]]))).toEqual({
      root_cellar: ['Root Cellar', 11, null], brass_gallery: ['Brass Gallery', 13, null], cog_hall: ['Cog Hall', 12, null],
      wickhound: ['Wick Den', 16, 'wickhound'], warden: ['Lens Pit', 22, 'fallen_warden'],
    });
    expect(ENCOUNTERS.root_cellar.spawns).toEqual([{ kind: 'thornling', dx: -3, dz: 2 }, { kind: 'thornling', dx: 3, dz: 2 }, { kind: 'archer', dx: 0, dz: 6 }]);
    expect(ENCOUNTERS.brass_gallery.spawns).toEqual([{ kind: 'mossback', dx: 0, dz: 2 }, { kind: 'thornling', dx: -4, dz: 5 }, { kind: 'thornling', dx: 4, dz: 5 }]);
    expect(ENCOUNTERS.cog_hall.spawns).toEqual([{ kind: 'boar', dx: -3, dz: 1 }, { kind: 'boar', dx: 3, dz: 1 }, { kind: 'archer', dx: -4, dz: 6 }, { kind: 'archer', dx: 4, dz: 6 }]);
    expect(ENCOUNTERS.wickhound.spawns).toEqual([{ kind: 'wickhound', dx: 0, dz: 0 }]);
    expect(ENCOUNTERS.warden.spawns).toEqual([{ kind: 'fallen_warden', dx: 0, dz: 0 }]);
    for (const id of ENCOUNTER_IDS) {
      const e = ENCOUNTERS[id];
      expect(e.id).toBe(id);
      if (e.boss) expect(e.spawns.map((s) => s.kind)).toContain(e.boss);
      for (const s of e.spawns) {
        expect(ENEMY_KINDS[s.kind].tier === 'boss' || ENEMY_KINDS[s.kind].tier === 'mega').toBe(s.kind === e.boss);
        expect(Math.hypot(s.dx, s.dz) + ENEMY_KINDS[s.kind].radius + 1, `${id} ${s.kind}`).toBeLessThanOrEqual(e.roomR);
      }
      for (let i = 0; i < e.spawns.length; i++) for (let j = i + 1; j < e.spawns.length; j++) {
        const a = e.spawns[i], b = e.spawns[j];
        expect(Math.hypot(a.dx - b.dx, a.dz - b.dz)).toBeGreaterThanOrEqual(3);
      }
    }
    // the Warden's shards sit inside phase 2's safe floor (r 15) and inside the Lens Pit
    const p2 = BOSSES.fallen_warden.phases[1];
    for (const a of p2.onEnter!.adds!) {
      const d = Math.hypot(a.dx, a.dz);
      expect(d + ENEMY_KINDS[a.kind].radius).toBeLessThan(15);
      expect(d + ENEMY_KINDS[a.kind].radius + 1).toBeLessThanOrEqual(ENCOUNTERS.warden.roomR);
    }
  });

  it('KILL_XP has the new kinds; lens_shard gives 0', () => {
    expect(KILL_XP).toMatchObject({ wickhound: 120, fallen_warden: 300, lens_shard: 0 });
    expect(Object.keys(KILL_XP).sort()).toEqual(Object.keys(ENEMY_KINDS).sort());
  });

  it('ring: inShape at inner, r and between; escapeDir points to the nearer edge', () => {
    const s: Shape = { kind: 'ring', x: 2, z: -1, dir: 0.7, inner: 3, r: 9 };
    expect(inShape(s, 2, -1)).toBe(false);
    expect(inShape(s, 2 + 2.99, -1)).toBe(false);
    expect(inShape(s, 2 + 3, -1)).toBe(true);
    expect(inShape(s, 2, -1 + 6)).toBe(true);
    expect(inShape(s, 2 - 9, -1)).toBe(true);
    expect(inShape(s, 2, -1 - 9.01)).toBe(false);
    expect(inShape(s, 2 + 30, -1)).toBe(false);
    const dirIs = (d: { x: number; z: number }, x: number, z: number) => { expect(d.x).toBeCloseTo(x, 12); expect(d.z).toBeCloseTo(z, 12); };
    // nearer the inner edge (d − inner < r − d): inward
    dirIs(escapeDir(s, 2 + 4, -1), -1, 0);
    dirIs(escapeDir(s, 2, -1 - 5), 0, 1);
    // nearer the outer edge: outward
    dirIs(escapeDir(s, 2 + 8, -1), 1, 0);
    dirIs(escapeDir(s, 2, -1 - 7), 0, -1);
    // exactly between: outward
    dirIs(escapeDir(s, 2, -1 + 6), 0, 1);
    // a unit vector on the diagonal
    const d = escapeDir(s, 2 + 3, -1 + 3);
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1, 12);
    expect(d.x).toBeLessThan(0); expect(d.z).toBeLessThan(0);
    // the very centre (outside, inside the hole): +Z, as a circle's
    dirIs(escapeDir(s, 2, -1), 0, 1);
    // a ring with no hole behaves like a circle
    const full: Shape = { kind: 'ring', x: 0, z: 0, dir: 0, inner: 0, r: 5 };
    expect(inShape(full, 0, 0)).toBe(true);
    expect(inShape(full, 0, 5)).toBe(true);
  });
});
