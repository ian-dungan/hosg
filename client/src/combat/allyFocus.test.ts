import { describe, expect, it } from 'vitest';
import { ABILITIES, JOBS, createCombat, prng, type AbilityId, type CombatZone, type FxEvent, type JobId } from '@sg2/shared';
import { FOCUS_IDLE_MS, FOCUS_RANGE, aimHint, createAllyFocus, type AllyPos } from './allyFocus';

const at = (id: number, x: number, z: number, hp = 100, maxHp = 100): AllyPos => ({ id, x, z, hp, maxHp, alive: hp > 0 });

describe('ally focus', () => {
  it('a tap sets the focus, a second tap on them clears it, a tap on someone else moves it', () => {
    const f = createAllyFocus();
    expect(f.id).toBeNull();
    expect(f.tap(7, 0)).toBe(7);
    expect(f.tap(7, 10)).toBeNull();
    f.tap(7, 20);
    expect(f.tap(9, 30)).toBe(9);
    f.clear();
    expect(f.id).toBeNull();
  });
  it('F cycles through adventurers within 18 m, nearest first, wrapping; nobody near clears it', () => {
    const f = createAllyFocus();
    const me = { x: 0, z: 0 };
    const others = [at(4, 10, 0), at(2, 3, 0), at(9, 0, FOCUS_RANGE + 0.5), at(5, 0, -17)];
    expect(f.cycle(me, others, 0)).toBe(2);
    expect(f.cycle(me, others, 0)).toBe(4);
    expect(f.cycle(me, others, 0)).toBe(5);
    expect(f.cycle(me, others, 0)).toBe(2); // 9 is out of reach
    expect(f.cycle(me, [at(9, 30, 0)], 0)).toBeNull();
    expect(f.id).toBeNull();
  });
  it('the focus expires after 30 s without use, and when they leave the view', () => {
    const f = createAllyFocus();
    f.tap(7, 1000);
    f.update(() => true, 1000 + FOCUS_IDLE_MS - 1);
    expect(f.id).toBe(7);
    f.use(1000 + FOCUS_IDLE_MS - 1); // an ability aimed with it
    f.update(() => true, 1000 + FOCUS_IDLE_MS + 5000);
    expect(f.id).toBe(7);
    f.update(() => true, 1000 + 2 * FOCUS_IDLE_MS);
    expect(f.id).toBeNull();
    f.tap(8, 0);
    f.update((id) => id !== 8, 1);
    expect(f.id).toBeNull();
  });
});

describe('aimHint', () => {
  const heal = ABILITIES.field_dressing; // aim 'ally'
  it('the focus when it qualifies, else the lowest health in range (ties: self, then the lower id)', () => {
    const me = at(1, 0, 0, 80);
    expect(aimHint(heal, 3, me, [at(3, 5, 0, 90), at(4, 5, 0, 20)])).toBe(3);
    expect(aimHint(heal, null, me, [at(3, 5, 0, 90), at(4, 5, 0, 20)])).toBe(4);
    expect(aimHint(heal, 3, me, [at(3, 40, 0, 10), at(4, 5, 0, 90)])).toBe(1); // the focus is too far
    expect(aimHint(heal, null, me, [at(3, 5, 0, 80)])).toBe(1); // a tie goes to self
    expect(aimHint(heal, null, at(9, 0, 0, 100), [at(5, 1, 0, 50), at(3, 1, 0, 50)])).toBe(3);
  });
  it('other-ally never picks self (null when nobody is near); dead-ally the focus or the nearest dead; self and enemy aims', () => {
    const me = at(1, 0, 0, 10);
    expect(aimHint(ABILITIES.shelter, null, me, [at(3, 5, 0, 90)])).toBe(3);
    expect(aimHint(ABILITIES.shelter, null, me, [at(3, 50, 0, 90)])).toBeNull();
    expect(aimHint(ABILITIES.second_dawn, null, me, [at(3, 5, 0, 0), at(4, 2, 0, 0), at(5, 1, 0, 50)])).toBe(4);
    expect(aimHint(ABILITIES.second_dawn, 3, me, [at(3, 5, 0, 0), at(4, 2, 0, 0)])).toBe(3);
    expect(aimHint(ABILITIES.second_dawn, null, me, [at(5, 1, 0, 50)])).toBeNull();
    expect(aimHint(ABILITIES.soft_rain, 3, me, [at(3, 5, 0, 10)])).toBe(1);
    expect(aimHint(ABILITIES.slash, 3, me, [at(3, 5, 0, 10)])).toBeNull();
  });

  // The engine's own aim rule (resolveAim) decides who an ally-aimed ability lands on: the hint must agree.
  const zone: CombatZone = { surface: () => 0, ground: () => 0, sight: () => true, camps: [], jobSwitch: () => true };
  const lands = (job: JobId, id: AbilityId, layout: { x: number; z: number; hp: number }[], focusIdx: number | null) => {
    const c = createCombat(zone, { seed: 1, nowS: 0 });
    const pool = JOBS[job].pool;
    const other = pool.find((p) => p !== id)!;
    const ids = layout.map((p, i) => c.addAdventurer({ x: p.x, z: p.z, y: 0, facing: 0, hp: p.hp, loadout: i === 0 ? { job, picks: [id, other] } : { job: 'warrior', picks: [...JOBS.warrior.picks.solo] } }, 0));
    // as the client sees everyone just before the press
    const views = ids.map((eid) => { const v = c.get(eid)!; return at(eid, v.x, v.z, v.hp, v.maxHp); });
    const ally = focusIdx === null ? undefined : ids[focusIdx];
    const r = c.intent(ids[0], ally === undefined ? { t: 'ability', slot: 3, phase: 'press' } : { t: 'ability', slot: 3, phase: 'press', ally }, 0);
    const out = c.tick(1 / 15);
    const fx = out.fx as FxEvent[];
    const hit = fx.find((e) => (e.t === 'heal' || e.t === 'buff') && e.src === ids[0]) as { dst: number } | undefined;
    return { landed: r === null ? hit?.dst ?? null : null, refused: r, views, ally: ally ?? null };
  };
  it('matches the engine on 50 seeded layouts (Field Dressing: ally; Shelter: other-ally)', () => {
    // Plan 4 limits the server's own pick to the caster's party (none here): probe which rule the engine runs
    const probe = lands('ranger', 'field_dressing', [{ x: 0, z: 0, hp: 90 }, { x: 3, z: 0, hp: 20 }], null);
    const allied = probe.landed === probe.views[0].id ? (id: number) => id === probe.views[0].id : undefined;
    const rnd = prng(20261112);
    for (let n = 0; n < 50; n++) {
      const count = 2 + Math.floor(rnd() * 4);
      const layout = Array.from({ length: count }, () => ({ x: (rnd() - 0.5) * 44, z: (rnd() - 0.5) * 44, hp: 20 + Math.floor(rnd() * 7) * 10 }));
      layout[0] = { x: 0, z: 0, hp: layout[0].hp };
      const focusIdx = rnd() < 0.5 ? null : 1 + Math.floor(rnd() * (count - 1));
      for (const [job, id] of [['ranger', 'field_dressing'], ['paladin', 'shelter']] as const) {
        const r = lands(job, id, layout, focusIdx);
        const hint = aimHint(ABILITIES[id], r.ally, r.views[0], r.views.slice(1), allied && ((x) => x === r.views[0].id));
        if (r.refused) { expect(r.refused).toBe('no-ally'); expect(hint).toBeNull(); } else expect(hint, `layout ${n} ${id}`).toBe(r.landed);
      }
    }
  });
});
