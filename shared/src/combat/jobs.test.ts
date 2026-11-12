import { describe, expect, it } from 'vitest';
import {
  ABILITIES, DEFAULT_LOADOUT, ENEMY_KINDS, FINISHER_COST, FREE_POOL, FUTURE_JOBS, JOBS, JOB_IDS, JOB_LEVEL_CAP, KILL_XP, MARK_BITS,
  MARK_S, REACTIONS, WEAPONS, WEAPON_BARS, XP_PER_LEVEL, addJobXp, applyFinisherMark, applyPrimerMark, elementMult, isJobId,
  isJobsSave, legacyLoadout, levelForXp, liveMarks, loadoutOf, newJobsSave, parseJobsSave, parseLoadout, reactionFor, recordFor,
  plan3LoadoutOf, slotsFor, xpToNext, type AbilityId, type ElementId, type FutureJobId, type JobId, type JobsSave, type Marks,
} from './index';

const jobs = () => JOB_IDS.map((id) => JOBS[id]);

describe('job data', () => {
  it('has the seven starting jobs in table order', () => {
    expect(JOB_IDS).toEqual(['warrior', 'ranger', 'paladin', 'dark_knight', 'ninja', 'white_mage', 'black_mage']);
    expect(Object.keys(JOBS).sort()).toEqual([...JOB_IDS].sort());
    for (const [k, j] of Object.entries(JOBS)) { expect(j.id).toBe(k); expect(j.unlock).toEqual({ kind: 'start' }); }
    expect(jobs().map((j) => j.name)).toEqual(['Warrior', 'Ranger', 'Paladin', 'Dark Knight', 'Ninja', 'White Mage', 'Black Mage']);
    expect(jobs().map((j) => j.role)).toEqual(['damage', 'damage', 'tank', 'hybrid', 'damage', 'healer', 'damage']);
    expect(jobs().map((j) => j.weapon)).toEqual(['blade', 'bow', 'sword', 'greatsword', 'daggers', 'staff', 'staff']);
    expect(jobs().map((j) => j.trait.id)).toEqual(['battle_rhythm', 'pinpoint', 'steadfast', 'blood_price', 'shadowstep', 'font', 'overflow']);
    for (const j of jobs()) { expect(j.trait.name.length).toBeGreaterThan(0); expect(j.trait.desc.length).toBeGreaterThan(0); }
    expect(jobs().filter((j) => j.brain.flank).map((j) => j.id)).toEqual(['ninja']);
    expect(isJobId('ninja')).toBe(true);
    for (const v of ['monk', 'toString', 'constructor', '', null, 3, {}]) expect(isJobId(v)).toBe(false);
    expect(JOBS.paladin.bar).toEqual(['shield_rap', 'bright_verdict', 'aegis']);
    expect(JOBS.white_mage.pool).toEqual(['second_dawn', 'soft_rain', 'mistveil', 'sun_mote']);
    expect(JOBS.black_mage.picks).toEqual({ solo: ['bastion_stone', 'rootbreak'], duo: ['kindred_spark', 'rootbreak'] });
  });
  it('every ability belongs to exactly one job, in its bar or its pool', () => {
    const all = jobs().flatMap((j) => [...j.bar, ...j.pool]);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(Object.keys(ABILITIES).sort());
    expect(all.length).toBe(49);
    for (const j of jobs()) for (const id of [...j.bar, ...j.pool]) expect(ABILITIES[id].job).toBe(j.id);
    for (const j of jobs()) for (const id of j.pool) expect(ABILITIES[id].role).toBe('pick');
    for (const [k, a] of Object.entries(ABILITIES)) {
      expect(a.id).toBe(k);
      expect(a.needsTarget).toBe(a.aim === 'enemy');
      expect(a.effects.length).toBeGreaterThan(0);
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.desc.length).toBeGreaterThan(0);
    }
  });
  it('every bar is quick, finisher, signature', () => {
    for (const j of jobs()) {
      expect(j.bar.map((id) => ABILITIES[id].role)).toEqual(['quick', 'finisher', 'signature']);
      const [quick, finisher] = j.bar.map((id) => ABILITIES[id]);
      expect(quick.momentum).toBeGreaterThan(0);
      expect(quick.cost).toBeUndefined();
      expect(finisher.cost).toBe(FINISHER_COST);
      expect(finisher.mark).toBeDefined();
      expect(finisher.primer).toBeUndefined();
    }
  });
  it('every job has a primer whose mark differs from its finisher mark, in its bar or its duo picks', () => {
    for (const j of jobs()) {
      const finisherMark = ABILITIES[j.bar[1]].mark;
      const primers = [...j.bar, ...j.picks.duo].map((id) => ABILITIES[id]).filter((a) => a.primer === true);
      expect(primers.some((a) => a.mark !== undefined && a.mark !== finisherMark), j.id).toBe(true);
    }
    for (const a of Object.values(ABILITIES)) {
      if (a.primer) { expect(a.mark).toBeDefined(); expect(a.role).not.toBe('finisher'); expect(a.cost).toBeUndefined(); }
    }
  });
  it('solo and duo picks are two distinct pool ids', () => {
    for (const j of jobs()) for (const p of [j.picks.solo, j.picks.duo]) {
      expect(p.length).toBe(2);
      expect(p[0]).not.toBe(p[1]);
      for (const id of p) expect(j.pool).toContain(id);
    }
  });
  it('each job has at least two support abilities, and its duo picks hold at least one', () => {
    for (const j of jobs()) {
      expect([...j.bar, ...j.pool].filter((id) => ABILITIES[id].support).length, j.id).toBeGreaterThanOrEqual(2);
      expect(j.picks.duo.some((id) => ABILITIES[id].support), j.id).toBe(true);
    }
  });
  it('glyphs are 1–2 characters, unique per namespace, never emoji', () => {
    const check = (glyphs: string[]) => {
      expect(new Set(glyphs).size).toBe(glyphs.length);
      for (const g of glyphs) {
        const cps = [...g].map((c) => c.codePointAt(0)!);
        expect(cps.length).toBeGreaterThanOrEqual(1);
        expect(cps.length).toBeLessThanOrEqual(2);
        for (const cp of cps) { expect(cp).toBeLessThan(0x1f000); expect(cp).not.toBe(0xfe0f); }
        expect(/\p{Emoji_Presentation}/u.test(g), g).toBe(false);
      }
    };
    check(Object.values(ABILITIES).map((a) => a.glyph));
    check(jobs().map((j) => j.glyph));
    expect(jobs().map((j) => j.glyph)).toEqual(['⚔', '➶', '⛨', '♆', '✕', '✙', '✺']);
  });
  it('only Staff jobs carry elements; every element has a reaction', () => {
    for (const a of Object.values(ABILITIES)) {
      if (a.element !== undefined) expect(JOBS[a.job].weapon, a.id).toBe('staff');
      if (a.school !== undefined) { expect(a.job).toBe('white_mage'); expect(a.element).toBeUndefined(); }
    }
    const elements: ElementId[] = ['fire', 'water', 'lightning', 'earth'];
    expect(Object.keys(REACTIONS).sort()).toEqual([...elements].sort());
    expect(REACTIONS).toEqual({
      fire: { mark: 'marked', reaction: 'blast' }, lightning: { mark: 'soaked', reaction: 'conduct' },
      water: { mark: 'burning', reaction: 'steam' }, earth: { mark: 'dazed', reaction: 'bedrock' },
    });
    for (const e of elements) expect(Object.values(ABILITIES).some((a) => a.element === e)).toBe(true);
  });
  it('Ninja has 3 dodge charges, all others 2', () => {
    for (const j of jobs()) expect(j.dodgeCharges, j.id).toBe(j.id === 'ninja' ? 3 : 2);
  });
  it('future jobs are data only', () => {
    const ids = Object.keys(FUTURE_JOBS) as FutureJobId[];
    expect(ids.sort()).toEqual(['bard', 'beastmaster', 'monk', 'sky_lancer']);
    for (const id of ids) {
      const f = FUTURE_JOBS[id];
      expect(f.id).toBe(id);
      expect((JOB_IDS as readonly string[]).includes(id)).toBe(false);
      expect(isJobId(id)).toBe(false);
      expect(f.unique.length).toBeGreaterThan(0);
      expect(f.unlock.kind).toBe('quest');
      expect(f.unlock.quest.length).toBeGreaterThan(0);
    }
    expect(FUTURE_JOBS.monk.unlock.quest).toBe('greenway_monk');
    expect(FUTURE_JOBS.sky_lancer.unlock.quest).toBe('reach_the_islands');
  });
  it('the table rows, spot-checked', () => {
    expect(ABILITIES.skyfall_arc).toMatchObject({ job: 'black_mage', role: 'finisher', cast: 1.2, cooldown: 6, range: 18, cost: 50, element: 'lightning', mark: 'dazed', stagger: 15, interrupts: true, ai: 'finisher' });
    expect(ABILITIES.skyfall_arc.effects).toEqual([{ k: 'damage', coef: 4.0 }]);
    expect(ABILITIES.hearthfall.effects).toEqual([{ k: 'damage', coef: 5.5, splash: { r: 4, frac: 0.5 } }]);
    expect(ABILITIES.barbed_rain.effects).toEqual([{ k: 'damage', coef: 1.4, splash: { r: 3, frac: 1 } }]);
    expect(ABILITIES.kindle.effects).toEqual([{ k: 'heal', amount: 25, on: 'aim' }, { k: 'heal', amount: 10, on: 'self' }]);
    expect(ABILITIES.aegis.effects).toEqual([{ k: 'buff', buff: 'aegis', s: 4, on: 'self' }, { k: 'buff', buff: 'aegis_ally', s: 4, on: 'others', r: 8 }]);
    expect(ABILITIES.ashcloud.effects).toEqual([{ k: 'threat-drop', r: 6 }, { k: 'debuff', debuff: 'blinded', s: 3, on: 'area', r: 6 }]);
    expect(ABILITIES.grave_ward.effects).toEqual([{ k: 'hp-cost', amount: 10 }, { k: 'shield', amount: 30, s: 6, on: 'self' }]);
    expect(ABILITIES.ghost_edge.effects).toEqual([{ k: 'damage', coef: 2.4, behind: true }]);
    expect(ABILITIES.second_dawn).toMatchObject({ aim: 'dead-ally', cast: 3.0, cooldown: 60, range: 12, school: 'light', support: true, ai: 'revive' });
    expect(ABILITIES.second_dawn.effects).toEqual([{ k: 'revive', frac: 0.4 }]);
    expect(ABILITIES.wellspring.effects).toEqual([{ k: 'heal', amount: 45, on: 'aim' }, { k: 'cleanse' }]);
    expect(ABILITIES.lantern_flare.effects).toEqual([{ k: 'damage', coef: 3.6 }, { k: 'heal', amount: 20, on: 'lowest' }]);
    expect(ABILITIES.kindred_spark).toMatchObject({ aim: 'other-ally', range: 15, cooldown: 20 });
    expect(ABILITIES.kindred_spark.effects).toEqual([{ k: 'momentum', amount: 30, on: 'aim' }, { k: 'momentum', amount: 10, on: 'self' }]);
    expect(ABILITIES.shelter).toMatchObject({ aim: 'other-ally', range: 12, ai: 'shelter' });
    expect(ABILITIES.twin_fang).toMatchObject({ cooldown: 3.5, momentum: 20, mark: 'marked', primer: true });
    expect(ABILITIES.sunder.effects).toEqual([{ k: 'damage', coef: 4.0 }]);
    expect(ABILITIES.parry.effects).toEqual([{ k: 'parry', s: 0.6 }]);
    expect(ABILITIES.sprint.effects).toEqual([{ k: 'sprint', scale: 1.4, s: 4 }]);
    expect(ABILITIES.charged_shot.effects).toEqual([{ k: 'charge' }]);
    expect(ABILITIES.taunt).toMatchObject({ job: 'paladin', role: 'pick', range: 15, aim: 'enemy', support: true });
    const casts = Object.values(ABILITIES).filter((a) => (a.cast ?? 0) > 0).map((a) => a.id).sort();
    expect(casts).toEqual(['bastion_stone', 'hearthfall', 'lantern_flare', 'rootbreak', 'second_dawn', 'skyfall_arc', 'sun_mote', 'wellspring']);
  });
});

describe('weapons and the transitional shims', () => {
  it('six weapons, the table autos', () => {
    expect(Object.keys(WEAPONS).sort()).toEqual(['blade', 'bow', 'daggers', 'greatsword', 'staff', 'sword']);
    expect(WEAPONS.greatsword).toMatchObject({ name: 'Greatsword', autoEvery: 1.8, autoCoef: 1.2 });
    expect(WEAPONS.daggers).toMatchObject({ name: 'Twin Daggers', autoEvery: 0.9, autoCoef: 0.6 });
    expect(WEAPONS.staff).toMatchObject({ autoEvery: 1.6, autoCoef: 1.0, autoRange: 16 });
    expect(WEAPONS.sword).toMatchObject({ name: 'Sword and Shield', autoEvery: 1.4, autoCoef: 1.0 });
  });
  it('FREE_POOL and WEAPON_BARS mirror the Warrior and Ranger', () => {
    expect(FREE_POOL).toEqual(JOBS.warrior.pool);
    expect(WEAPON_BARS).toEqual({ blade: JOBS.warrior.bar, bow: JOBS.ranger.bar });
  });
  it('the engine keeps running Plan 3 loadouts until Task 2', () => {
    expect(plan3LoadoutOf({ weapon: 'bow', free: ['taunt', 'sprint'] })).toEqual({ weapon: 'bow', free: ['taunt', 'sprint'] });
    expect(plan3LoadoutOf(DEFAULT_LOADOUT)).toEqual({ weapon: 'blade', free: ['mend', 'bulwark'] });
    expect(plan3LoadoutOf({ job: 'ranger', picks: ['sprint', 'barbed_rain'] })).toEqual({ weapon: 'bow', free: ['mend', 'bulwark'] });
    expect(plan3LoadoutOf({ job: 'ninja', picks: ['ashcloud', 'mist_form'] })).toEqual({ weapon: 'blade', free: ['mend', 'bulwark'] });
    expect(plan3LoadoutOf('garbage')).toEqual({ weapon: 'blade', free: ['mend', 'bulwark'] });
  });
});

describe('loadouts', () => {
  it('parseLoadout takes the new shape only', () => {
    expect(parseLoadout({ job: 'ninja', picks: ['ashcloud', 'mist_form'], extra: 1 })).toEqual({ job: 'ninja', picks: ['ashcloud', 'mist_form'] });
    const bad: unknown[] = [
      null, 'ninja', {}, { job: 'ninja' },
      { job: 'ninja', picks: ['ashcloud', 'mend'] },          // another job's pick
      { job: 'ninja', picks: ['twin_fang', 'ashcloud'] },     // a bar ability
      { job: 'ninja', picks: ['ashcloud', 'ashcloud'] },      // duplicate
      { job: 'monk', picks: ['ashcloud', 'mist_form'] },      // unknown job
      { job: 'toString', picks: ['ashcloud', 'mist_form'] },
      { job: 'ninja', picks: ['ashcloud'] }, { job: 'ninja', picks: ['ashcloud', 'mist_form', 'quickstep'] },
      { job: 'ninja', picks: 'ashcloud,mist_form' }, { job: 'ninja', picks: ['constructor', 'ashcloud'] },
      { weapon: 'blade', free: ['mend', 'bulwark'] },          // the old shape
    ];
    for (const v of bad) expect(parseLoadout(v), JSON.stringify(v)).toBeNull();
    const src = { job: 'warrior', picks: ['mend', 'bulwark'] as AbilityId[] };
    const out = parseLoadout(src)!;
    src.picks[0] = 'skullringer';
    expect(out.picks).toEqual(['mend', 'bulwark']);
  });
  it('legacyLoadout maps Plan 3 weapons to jobs', () => {
    expect(legacyLoadout({ weapon: 'blade', free: ['mend', 'bulwark'] })).toEqual({ job: 'warrior', picks: ['mend', 'bulwark'] });
    expect(legacyLoadout({ weapon: 'bow', free: ['taunt', 'sprint'] })).toEqual({ job: 'ranger', picks: ['field_dressing', 'pinning_shot'] });
    expect(legacyLoadout({ weapon: 'blade', free: ['taunt', 'mend'] })).toEqual({ job: 'warrior', picks: ['mend', 'bulwark'] });
    expect(legacyLoadout({ weapon: 'bow', free: ['sprint', 'barbed_rain'] })).toEqual({ job: 'ranger', picks: ['sprint', 'barbed_rain'] });
    for (const v of [null, 'blade', {}, { weapon: 'staff', free: ['mend', 'bulwark'] }, { weapon: 'toString' }, { job: 'warrior', picks: ['mend', 'bulwark'] }]) {
      expect(legacyLoadout(v)).toBeNull();
    }
  });
  it('slots: the job bar, then the picks', () => {
    expect(DEFAULT_LOADOUT).toEqual({ job: 'warrior', picks: ['mend', 'bulwark'] });
    expect(slotsFor(DEFAULT_LOADOUT)).toEqual(['slash', 'sunder', 'parry', 'mend', 'bulwark']);
    expect(slotsFor({ job: 'white_mage', picks: ['soft_rain', 'sun_mote'] })).toEqual(['tidelash', 'lantern_flare', 'wellspring', 'soft_rain', 'sun_mote']);
  });
});

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('jobs save', () => {
  it('garbage reads as a new save', () => {
    for (const v of [undefined, null, 'x', 3, [], [1, 2], true]) expect(parseJobsSave(v)).toEqual(newJobsSave());
    expect(parseJobsSave('x', { weapon: 'nope' })).toEqual(newJobsSave());
    expect(newJobsSave()).toEqual({ current: 'warrior', jobs: { warrior: { level: 1, xp: 0, picks: ['mend', 'bulwark'], talents: [], outfit: null } } });
    expect(newJobsSave('ninja').jobs.ninja!.picks).toEqual(['mist_form', 'ashcloud']);
  });
  it('a legacy Plan 3 loadout becomes the matching job', () => {
    const s = parseJobsSave(undefined, { weapon: 'bow', free: ['taunt', 'sprint'] });
    expect(s.current).toBe('ranger');
    expect(recordFor(s, 'ranger').picks).toEqual(['field_dressing', 'pinning_shot']);
    expect(loadoutOf(s)).toEqual({ job: 'ranger', picks: ['field_dressing', 'pinning_shot'] });
    const b = parseJobsSave('garbage', { weapon: 'blade', free: ['mend', 'bulwark'] });
    expect(loadoutOf(b)).toEqual({ job: 'warrior', picks: ['mend', 'bulwark'] });
    // a valid save wins over the legacy loadout
    expect(parseJobsSave(newJobsSave('ninja'), { weapon: 'bow', free: ['mend', 'bulwark'] }).current).toBe('ninja');
  });
  it('level is derived from xp, and bad parts are fixed per record', () => {
    const s = parseJobsSave({
      current: 'paladin',
      jobs: {
        paladin: { level: 1, xp: 250, picks: ['taunt', 'shelter'], talents: ['a'], outfit: 'hat', extra: 1 },
        ninja: { level: 9, xp: -5, picks: ['mend', 'bulwark'], talents: 'x' },   // wrong-job picks
        ranger: { xp: 12.5, picks: ['sprint'] },
        warrior: 'broken',
        wizard: { level: 1, xp: 0, picks: ['mend', 'bulwark'], talents: [], outfit: null },
      },
    });
    expect(s.current).toBe('paladin');
    expect(s.jobs.paladin).toEqual({ level: 3, xp: 250, picks: ['taunt', 'shelter'], talents: ['a'], outfit: null });
    expect(s.jobs.ninja).toEqual({ level: 1, xp: 0, picks: ['mist_form', 'ashcloud'], talents: [], outfit: null });
    expect(s.jobs.ranger).toEqual({ level: 1, xp: 0, picks: ['field_dressing', 'pinning_shot'], talents: [], outfit: null });
    expect(s.jobs.warrior).toBeUndefined();
    expect(Object.keys(s.jobs).sort()).toEqual(['ninja', 'paladin', 'ranger']);
    expect(isJobsSave(s)).toBe(true);
  });
  it('a future-job record is kept, but it can never be current', () => {
    const monk = { level: 2, xp: 140, picks: ['mend', 'bulwark'] as [AbilityId, AbilityId], talents: [], outfit: null };
    const s = parseJobsSave({ current: 'monk', jobs: { monk } });
    expect(s.current).toBe('warrior');
    expect(s.jobs.monk).toEqual(monk);
    expect(s.jobs.warrior).toEqual(newJobsSave().jobs.warrior);
    expect(isJobsSave(s)).toBe(true);
    expect(isJobsSave({ ...s, current: 'monk' })).toBe(false);
  });
  it('recordFor gives a fresh record without storing it', () => {
    const s = newJobsSave();
    const r = recordFor(s, 'black_mage');
    expect(r).toEqual({ level: 1, xp: 0, picks: ['bastion_stone', 'rootbreak'], talents: [], outfit: null });
    expect(s.jobs.black_mage).toBeUndefined();
  });
  it('isJobsSave is strict', () => {
    const ok = newJobsSave('ranger');
    expect(isJobsSave(ok)).toBe(true);
    const bad: unknown[] = [
      null, {}, { current: 'ranger' }, { current: 'ranger', jobs: {} },              // no record for current
      { ...ok, extra: 1 },
      { current: 'ranger', jobs: { ranger: { ...ok.jobs.ranger!, level: 2 } } },     // level not derived
      { current: 'ranger', jobs: { ranger: { ...ok.jobs.ranger!, xp: 1.5 } } },
      { current: 'ranger', jobs: { ranger: { ...ok.jobs.ranger!, picks: ['mend', 'bulwark'] } } },
      { current: 'ranger', jobs: { ranger: { ...ok.jobs.ranger!, outfit: 'hat' } } },
      { current: 'ranger', jobs: { ranger: { ...ok.jobs.ranger!, talents: [1] } } },
      { current: 'ranger', jobs: { ranger: { ...ok.jobs.ranger!, more: 1 } } },
      { current: 'ranger', jobs: { ...ok.jobs, wizard: ok.jobs.ranger } },
    ];
    for (const v of bad) expect(isJobsSave(v), JSON.stringify(v)).toBe(false);
  });
  it('isJobsSave(parseJobsSave(x)) for 200 seeded random inputs, and parse keeps a valid save unchanged', () => {
    const r = rng(12345);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
    const ids = [...JOB_IDS, 'monk', 'bard', 'wizard', 'toString', '__proto__'];
    const abilityIds = [...Object.keys(ABILITIES), 'fireball', 'constructor'];
    const junk = (): unknown => pick([null, undefined, 3, -1, 2.5, NaN, Infinity, 'x', true, [], {}, [1, 'a']]);
    const record = (): unknown => r() < 0.15 ? junk() : {
      level: r() < 0.5 ? Math.floor(r() * 20) : junk(),
      xp: r() < 0.7 ? Math.floor(r() * 2000) - (r() < 0.1 ? 3000 : 0) : junk(),
      picks: r() < 0.8 ? [pick(abilityIds), pick(abilityIds)] : junk(),
      talents: r() < 0.7 ? [] : r() < 0.5 ? ['t', 1] : junk(),
      outfit: r() < 0.8 ? null : junk(),
    };
    for (let n = 0; n < 200; n++) {
      let v: unknown;
      if (r() < 0.15) v = junk();
      else {
        const jobsObj: Record<string, unknown> = {};
        const k = Math.floor(r() * 5);
        for (let i = 0; i < k; i++) jobsObj[pick(ids)] = record();
        v = { current: r() < 0.8 ? pick(ids) : junk(), jobs: r() < 0.9 ? jobsObj : junk() };
      }
      const legacy = r() < 0.3 ? { weapon: pick(['blade', 'bow', 'staff']), free: [pick(abilityIds), pick(abilityIds)] } : undefined;
      const s = parseJobsSave(v, legacy);
      expect(isJobsSave(s), JSON.stringify(v)).toBe(true);
      expect(parseJobsSave(s)).toEqual(s);
      if (isJobsSave(v)) expect(s).toEqual(v);
    }
  });
});

describe('xp', () => {
  it('levels and the xp to the next one', () => {
    expect(XP_PER_LEVEL).toBe(100);
    expect(JOB_LEVEL_CAP).toBe(10);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(5000)).toBe(10);
    expect(xpToNext(0)).toBe(100);
    expect(xpToNext(130)).toBe(70);
    expect(xpToNext(950)).toBe(0);
    expect(KILL_XP).toEqual({ thornling: 10, boar: 10, archer: 10, mossback: 40, dummy: 0 });
  });
  it('addJobXp is pure and reports a level-up', () => {
    const s: JobsSave = { current: 'ranger', jobs: { ranger: { level: 1, xp: 95, picks: ['sprint', 'barbed_rain'], talents: [], outfit: null } } };
    const before = JSON.stringify(s);
    const r1 = addJobXp(s, 'ranger', 10);
    expect(r1).toEqual({ save: { current: 'ranger', jobs: { ranger: { level: 2, xp: 105, picks: ['sprint', 'barbed_rain'], talents: [], outfit: null } } }, level: 2, levelUp: true });
    expect(JSON.stringify(s)).toBe(before);
    const r2 = addJobXp(r1.save, 'ranger', 10);
    expect(r2.levelUp).toBe(false);
    expect(r2.level).toBe(2);
    // a job with no stored record starts one
    const r3 = addJobXp(s, 'ninja', 40);
    expect(r3.save.jobs.ninja).toEqual({ level: 1, xp: 40, picks: ['mist_form', 'ashcloud'], talents: [], outfit: null });
    expect(s.jobs.ninja).toBeUndefined();
    expect(isJobsSave(r3.save)).toBe(true);
    // the cap
    const r4 = addJobXp(s, 'ranger', 10_000);
    expect(r4.level).toBe(JOB_LEVEL_CAP);
    expect(addJobXp(r4.save, 'ranger', 10).levelUp).toBe(false);
    expect(addJobXp(s, 'ranger', -50).save.jobs.ranger!.xp).toBe(95);
  });
});

describe('elements', () => {
  it('reactions', () => {
    expect(reactionFor('fire', ['marked'])).toBe('blast');
    expect(reactionFor('fire', ['marked'], 'marked')).toBeNull();
    expect(reactionFor(undefined, ['soaked'])).toBeNull();
    expect(reactionFor('lightning', ['burning', 'soaked'], 'dazed')).toBe('conduct');
    expect(reactionFor('water', ['burning'])).toBe('steam');
    expect(reactionFor('earth', ['dazed'], 'rooted')).toBe('bedrock');
    expect(reactionFor('earth', ['soaked', 'marked'])).toBeNull();
  });
  it('weakness and resistance', () => {
    expect(elementMult('fire', ENEMY_KINDS.thornling)).toBe(1.25);
    expect(elementMult('water', ENEMY_KINDS.thornling)).toBe(0.75);
    expect(elementMult('fire', ENEMY_KINDS.dummy)).toBe(1);
    expect(elementMult(undefined, ENEMY_KINDS.thornling)).toBe(1);
    expect(elementMult('lightning', ENEMY_KINDS.archer)).toBe(1.25);
    expect(elementMult('earth', ENEMY_KINDS.mossback)).toBe(0.75);
  });
  it('marks: rooted and dazed; a primer never removes another mark', () => {
    expect(MARK_BITS).toEqual({ soaked: 1, burning: 2, marked: 4, rooted: 8, dazed: 16 });
    const marks: Marks = {};
    applyFinisherMark(marks, 'burning', 0);
    applyPrimerMark(marks, 'soaked', 1);
    applyPrimerMark(marks, 'dazed', 2);
    expect(liveMarks(marks, 3)).toEqual(['soaked', 'burning', 'dazed']);
    applyPrimerMark(marks, 'soaked', 5); // refresh
    expect(marks.soaked).toBe(5 + MARK_S);
    expect(marks.burning).toBe(MARK_S);
    expect(applyFinisherMark(marks, 'rooted', 6)).toEqual(['soaked', 'burning', 'dazed']);
    expect(liveMarks(marks, 6)).toEqual(['rooted']);
  });
});

// type-level: JobId and the future ids stay apart
const _j: JobId = 'warrior';
void _j;
