import { describe, expect, it } from 'vitest';
import { ABILITIES, BUFF_BITS, DEBUFF_BITS, type AbilityId, type BuffId, type DebuffId, type ElementId, type FxEvent, type ReactionId } from '@sg2/shared';
import { MAX_LIVE, VisualPool, castTone, particleCap, spellVisualFor, staffTint, type VisualSpec } from './spells';

const ELEMENTS: ElementId[] = ['fire', 'water', 'lightning', 'earth'];
const REACTIONS: ReactionId[] = ['blast', 'conduct', 'steam', 'bedrock'];

describe('spellVisualFor', () => {
  it('maps every element to its own visual, for every element-carrying hit', () => {
    const kinds = new Set<string>();
    for (const element of ELEMENTS) {
      const v = spellVisualFor({ t: 'hit', src: 1, dst: 2, amount: 10, absorbed: 0, by: 'cinder_dart', element });
      expect(v, element).not.toBeNull();
      expect(v!.src).toBe(1); expect(v!.dst).toBe(2);
      kinds.add(v!.kind);
    }
    expect(kinds.size).toBe(4);
  });
  it('maps every reaction to its own visual (and an unknown one to the generic burst)', () => {
    const kinds = new Set<string>();
    for (const reaction of REACTIONS) {
      const v = spellVisualFor({ t: 'react', src: 1, dst: 2, reaction });
      expect(v, reaction).not.toBeNull();
      expect(v!.big).toBe(true);
      kinds.add(v!.kind);
    }
    expect(kinds.size).toBe(4);
    const odd = spellVisualFor({ t: 'react', src: 1, dst: 2, reaction: 'quake' as ReactionId });
    expect(odd?.kind).toBe('generic');
  });
  it("Soft Rain on an ally is a short flash, not a 6 s slot (only the White Mage's own rain lasts)", () => {
    expect(spellVisualFor({ t: 'buff', src: 1, dst: 2, buff: 'rain', on: true })?.dur).toBeLessThan(1);
    expect(spellVisualFor({ t: 'buff', src: 1, dst: 1, buff: 'rain', on: true })?.dur).toBe(6);
  });
  it('maps every support buff and every debuff when it starts, and nothing when it ends', () => {
    for (const buff of [...Object.keys(BUFF_BITS), ...Object.keys(DEBUFF_BITS)] as (BuffId | DebuffId)[]) {
      expect(spellVisualFor({ t: 'buff', src: 1, dst: 2, buff, on: true }), buff).not.toBeNull();
      expect(spellVisualFor({ t: 'buff', src: 1, dst: 2, buff, on: false }), buff).toBeNull();
    }
  });
  it('maps heals, shields, gifts, revives and taunts; a fizzle or interrupt puffs, a finished cast does not', () => {
    expect(spellVisualFor({ t: 'heal', src: 1, dst: 2, amount: 12 })?.kind).toBe('heal');
    expect(spellVisualFor({ t: 'heal', src: 1, dst: 2, amount: 0 })).toBeNull();
    expect(spellVisualFor({ t: 'shield', src: 1, dst: 2, amount: 20 })?.kind).toBe('shield');
    expect(spellVisualFor({ t: 'gift', src: 1, dst: 2, amount: 30 })?.kind).toBe('gift');
    const rv = spellVisualFor({ t: 'revive', src: 1, dst: 2, hp: 40 });
    expect(rv?.kind).toBe('revive'); expect(rv?.big).toBe(true);
    expect(spellVisualFor({ t: 'use', src: 1, ability: 'taunt', dst: 9 })?.kind).toBe('taunt');
    expect(spellVisualFor({ t: 'use', src: 1, ability: 'dread_howl' })?.kind).toBe('taunt');
    expect(spellVisualFor({ t: 'castEnd', src: 1, ability: 'hearthfall', ok: false, reason: 'interrupt' })?.kind).toBe('fizzle');
    expect(spellVisualFor({ t: 'castEnd', src: 1, ability: 'hearthfall', ok: true })).toBeNull();
  });
  it('the Light spells draw a beam; Plan 3 hits (no element, no ability visual) stay with effects.ts', () => {
    expect(spellVisualFor({ t: 'hit', src: 1, dst: 2, amount: 9, absorbed: 0, by: 'sun_mote' })?.kind).toBe('light');
    expect(spellVisualFor({ t: 'hit', src: 1, dst: 2, amount: 9, absorbed: 0, by: 'lantern_flare' })?.kind).toBe('light');
    for (const by of ['auto', 'slash', 'snap_shot', 'charged_shot', 'burning', 'sunder'] as const) {
      expect(spellVisualFor({ t: 'hit', src: 1, dst: 2, amount: 9, absorbed: 0, by }), by).toBeNull();
    }
  });
  it('never throws on ids it does not know: a field hit or an unknown ability falls back to the generic effect', () => {
    expect(spellVisualFor({ t: 'hit', src: 1, dst: 2, amount: 9, absorbed: 0, by: 'field' })?.kind).toBe('generic');
    expect(spellVisualFor({ t: 'hit', src: 1, dst: 2, amount: 9, absorbed: 0, by: 'lamp_lance' as AbilityId })?.kind).toBe('generic');
    expect(spellVisualFor({ t: 'use', src: 1, ability: 'mystery' as AbilityId })?.kind).toBe('generic');
    expect(spellVisualFor({ t: 'buff', src: 1, dst: 2, buff: 'odd' as BuffId, on: true })?.kind).toBe('generic');
    expect(spellVisualFor({ t: 'hit', src: 1, dst: 2, amount: 9, absorbed: 0, by: 'field', element: 'storm' as ElementId })?.kind).toBe('generic');
    expect(spellVisualFor({ t: 'enrage', src: 3 })).toBeNull();
    expect(spellVisualFor({ t: 'nonsense' } as unknown as FxEvent)).toBeNull();
  });
  it('every elemental ability has a cast tone; the staff tint follows the job', () => {
    // every cast spell, by name: its element, Light for the White Mage's Light school
    const tones: Partial<Record<AbilityId, string>> = {
      skyfall_arc: 'lightning', hearthfall: 'fire', bastion_stone: 'earth', rootbreak: 'earth',
      lantern_flare: 'light', wellspring: 'water', second_dawn: 'light', sun_mote: 'light',
    };
    const cast = (Object.keys(ABILITIES) as AbilityId[]).filter((id) => ABILITIES[id].cast);
    expect(cast.sort()).toEqual((Object.keys(tones) as AbilityId[]).sort());
    for (const id of cast) expect(castTone(id), id).toBe(tones[id]);
    expect(castTone('slash')).toBe('arcane');
    expect(castTone('nope' as AbilityId)).toBe('arcane');
    expect(staffTint('white_mage')).toBe('white');
    expect(staffTint('black_mage')).toBe('black');
    expect(staffTint('warrior')).toBeUndefined();
    expect(staffTint('')).toBeUndefined();
  });
});

describe('VisualPool', () => {
  const spec = (i: number): VisualSpec => ({ kind: 'fire', src: i, dst: i + 1, dur: 1 });
  it('never holds more than MAX_LIVE (24); the oldest is recycled', () => {
    expect(MAX_LIVE).toBe(24);
    const pool = new VisualPool();
    for (let i = 0; i < 100; i++) pool.add(spec(i), i * 0.001);
    expect(pool.live).toBe(MAX_LIVE);
    const srcs = pool.slots.filter((s) => s.on).map((s) => s.src).sort((a, b) => a - b);
    expect(srcs[0]).toBe(100 - MAX_LIVE);
    expect(srcs[srcs.length - 1]).toBe(99);
  });
  it('frees a visual when its time is up, and reuses its slot without allocating a new one', () => {
    const pool = new VisualPool();
    const a = pool.add(spec(1), 0);
    pool.step(0.5);
    expect(pool.live).toBe(1);
    pool.step(0.6);
    expect(pool.live).toBe(0);
    const b = pool.add(spec(2), 2);
    expect(b).toBe(a);
    expect(pool.slots).toHaveLength(MAX_LIVE);
  });
  it('never recycles a reaction or a revive (big) while a slot that is not big is live', () => {
    const pool = new VisualPool();
    const big: VisualSpec = { kind: 'blast', src: 500, dst: 501, dur: 1, big: true };
    pool.add(big, 0); // the oldest of all
    for (let i = 0; i < 100; i++) pool.add(spec(i), 1 + i * 0.001);
    expect(pool.slots.some((s) => s.on && s.kind === 'blast')).toBe(true);
    // a pool full of big visuals still recycles its oldest
    const full = new VisualPool();
    for (let i = 0; i < MAX_LIVE + 1; i++) full.add({ ...big, src: i }, i);
    expect(full.live).toBe(MAX_LIVE);
    expect(full.slots.some((s) => s.src === 0)).toBe(false);
  });
  it('clear() empties it (a zone change)', () => {
    const pool = new VisualPool();
    for (let i = 0; i < 5; i++) pool.add(spec(i), 0);
    pool.clear();
    expect(pool.live).toBe(0);
  });
});

describe('particleCap', () => {
  it('scales with the quality tier and drops rain streaks and the crackle cage on low', () => {
    expect(particleCap('low', 'rain')).toBe(0);
    expect(particleCap('low', 'cage')).toBe(0);
    expect(particleCap('low', 'burst')).toBeGreaterThan(0);
    expect(particleCap('med', 'burst')).toBeGreaterThan(particleCap('low', 'burst'));
    expect(particleCap('high', 'burst')).toBeGreaterThanOrEqual(particleCap('med', 'burst'));
    expect(particleCap('med', 'rain')).toBeGreaterThan(0);
    expect(particleCap('med', 'cage')).toBeGreaterThan(0);
  });
});
