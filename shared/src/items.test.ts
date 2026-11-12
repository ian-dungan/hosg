import { describe, expect, it } from 'vitest';
import {
  ARMOUR_SLOTS, COSTUMES, COSTUME_IDS, DYES, GEAR_SLOTS, ITEMS, ITEM_IDS, JOB_ARMOUR, KIT_TABLE, OFFHAND_FOR, SETS, SET_IDS, SLOT_WEIGHT, TYPE_MULT,
  fits, isArmourSlot, isItemId, itemStats, kitItems, starterItems, tierSet, type ArmourType, type GearSlot, type ItemId,
} from './items';
import { kitFor, setCounts } from './kit';
import { parseMods } from './mods';
import { ABILITIES } from './combat/abilities';
import { JOBS, JOB_IDS, type JobId } from './combat/jobs';
import { STARTER_STATS } from './combat/stats';
import { baseStats } from './progression';
import { SIM_TALENTS, talentMods } from './talents';
import { SPECIAL_CAP } from './combat/constants';

const starterGear = (job: JobId): Partial<Record<GearSlot, ItemId>> => {
  const g: Partial<Record<GearSlot, ItemId>> = {};
  for (const id of starterItems()) if (fits(id, ITEMS[id]!.slot, job)) g[ITEMS[id]!.slot] = id;
  return g;
};
const full = (tier: 1 | 2 | 3, job: JobId) => {
  const k = kitItems(tier, job), g: Partial<Record<GearSlot, ItemId>> = {};
  for (const s of GEAR_SLOTS) if (k[s]) g[s] = k[s]!;
  return g;
};

describe('items', () => {
  it('101 items: 60 armour (10 sets × 6), 25 weapons, 16 off-hands; ids unique; models unique except where the table allows sharing', () => {
    expect(ITEM_IDS).toHaveLength(101);
    expect(new Set(ITEM_IDS).size).toBe(101);
    const all = ITEM_IDS.map(id => ITEMS[id]!);
    expect(all.filter(i => isArmourSlot(i.slot))).toHaveLength(60);
    expect(all.filter(i => i.slot === 'weapon')).toHaveLength(25);
    expect(all.filter(i => i.slot === 'offhand')).toHaveLength(16);
    for (const s of SET_IDS) {
      const pieces = all.filter(i => i.set === s);
      expect(pieces.map(p => p.slot).sort()).toEqual([...ARMOUR_SLOTS].sort());
      for (const p of pieces) {
        expect(p.id).toBe(`${s}_${p.slot}`);
        expect(p.name.startsWith(SETS[s].name + ' ')).toBe(true);
        expect(p.type).toBe(SETS[s].type);
        expect(p.tier).toBe(SETS[s].tier);
      }
    }
    // models: 0..199, unique (none shared at all)
    const models = all.map(i => i.model);
    expect(new Set(models).size).toBe(101);
    for (const m of models) { expect(Number.isInteger(m)).toBe(true); expect(m).toBeGreaterThanOrEqual(0); expect(m).toBeLessThan(200); }
    for (const i of all) {
      expect(i.ilvl).toBe(([1, 4, 7, 10] as const)[i.tier]);
      expect(ITEMS[i.id]).toBe(i);
    }
    expect(isItemId('last_bell')).toBe(true);
    for (const v of ['', 'toString', '__proto__', 'LAST_BELL', 3, null, {}]) expect(isItemId(v)).toBe(false);
    expect(Object.isFrozen(ITEMS)).toBe(true); expect(Object.isFrozen(ITEMS.last_bell!.named!.mods)).toBe(true);
    // the seven named weapons, one per job
    const named = all.filter(i => i.named);
    expect(named.map(i => i.id).sort()).toEqual(['dawnlantern', 'ember_lens', 'grief_of_brass', 'lampwardens_oath', 'last_bell', 'longwatch', 'twin_wicks']);
    for (const n of named) { expect(n.rarity).toBe('named'); expect(n.tier).toBe(3); expect(n.named!.line.length).toBeGreaterThan(10); }
  });

  it('full kits sum to the KIT_TABLE within rounding, per tier and armour type', () => {
    for (const tier of [0, 1, 2, 3] as const) {
      const types: ArmourType[] = tier === 0 ? ['plain'] : ['cloth', 'light', 'heavy'];
      for (const type of types) {
        const set = tierSet(tier, type);
        let def = 0, hp = 0, sp = 0;
        for (const s of ARMOUR_SLOTS) {
          const st = itemStats(`${set}_${s}`);
          def += st.defence; hp += st.maxHp; sp += st.focus + st.flow + st.guard;
          expect(st.power).toBe(0);
          expect(Number.isInteger(st.maxHp)).toBe(true);
          expect(Math.round(st.defence * 10)).toBeCloseTo(st.defence * 10, 9);
        }
        const k = KIT_TABLE[tier];
        expect(Math.abs(def - k.defence * TYPE_MULT[type].defence), `${set} defence`).toBeLessThanOrEqual(0.3 + 1e-9);
        expect(Math.abs(hp - k.maxHp * TYPE_MULT[type].maxHp), `${set} hp`).toBeLessThanOrEqual(2);
        expect(Math.abs(sp - k.special), `${set} special`).toBeLessThanOrEqual(2);
        if (type === 'light' || type === 'plain') { expect(def).toBeCloseTo(k.defence, 9); expect(hp).toBe(k.maxHp); expect(sp).toBe(k.special); }
      }
      for (const job of JOB_IDS) {
        const w = tier === 0 ? starterGear(job).weapon! : kitItems(tier, job).weapon!;
        const o = tier === 0 ? starterGear(job).offhand : kitItems(tier, job).offhand ?? undefined;
        const p = itemStats(w).power + (o ? itemStats(o).power : 0);
        expect(p, `${job} T${tier}`).toBeCloseTo(KIT_TABLE[tier].power, 9);
        if (o) expect(itemStats(w).power).toBeCloseTo(Math.round(KIT_TABLE[tier].power * 7.5) / 10, 9);
      }
    }
    expect(SLOT_WEIGHT.chest + SLOT_WEIGHT.legs + SLOT_WEIGHT.head + SLOT_WEIGHT.hands + SLOT_WEIGHT.feet + SLOT_WEIGHT.back).toBeCloseTo(1, 9);
  });

  it('fits: a staff on both mages, a shield only on the Paladin, nothing in the off-hand for greatsword or daggers', () => {
    expect(fits('rowan_staff', 'weapon', 'white_mage')).toBe(true);
    expect(fits('rowan_staff', 'weapon', 'black_mage')).toBe(true);
    expect(fits('dawnlantern', 'weapon', 'black_mage')).toBe(true);
    expect(fits('rowan_staff', 'weapon', 'warrior')).toBe(false);
    expect(fits('rowan_staff', 'offhand', 'white_mage')).toBe(false);
    for (const job of JOB_IDS) expect(fits('brass_kite', 'offhand', job), job).toBe(job === 'paladin');
    for (const job of ['dark_knight', 'ninja'] as const) {
      expect(OFFHAND_FOR[JOBS[job].weapon]).toBeNull();
      for (const id of ITEM_IDS) if (ITEMS[id]!.slot === 'offhand') expect(fits(id, 'offhand', job)).toBe(false);
    }
    expect(fits('grove_bow', 'weapon', 'paladin')).toBe(false);
    for (const job of JOB_IDS) for (const s of ARMOUR_SLOTS) {
      expect(fits(`beaconstone_${s}`, s, job)).toBe(true);
      expect(fits(`beaconstone_${s}`, s === 'head' ? 'chest' : 'head', job)).toBe(false);
    }
    expect(fits('nope', 'head', 'warrior')).toBe(false);
    expect(fits('plain_head', 'head', 'monk' as JobId)).toBe(false);
  });

  it('Smithy prices only on T1, Seals only on T3, starter sells for 0, named for 150', () => {
    const price: Record<string, number> = { weapon: 120, offhand: 50, chest: 80, legs: 65, head: 55, hands: 40, feet: 40, back: 35 };
    const seals: Record<string, number> = { chest: 4, legs: 3, head: 3, hands: 2, feet: 2, back: 2, weapon: 5, offhand: 2 };
    for (const id of ITEM_IDS) {
      const i = ITEMS[id]!;
      if (i.tier === 1) { expect(i.price).toBe(price[i.slot]); expect(i.sell).toBe(Math.floor(price[i.slot]! * 0.2)); } else expect(i.price).toBeUndefined();
      if (i.tier === 3) expect(i.seals).toBe(seals[i.slot]); else expect(i.seals).toBeUndefined();
      if (i.tier === 0) { expect(i.sell).toBe(0); expect(i.rarity).toBe('starter'); }
      if (i.tier === 2) expect(i.sell).toBe(isArmourSlot(i.slot) ? 40 : 60);
      if (i.tier === 3) expect(i.sell).toBe(i.named ? 150 : isArmourSlot(i.slot) ? 80 : 100);
      // nothing sells for as much as it costs
      if (i.price !== undefined) expect(i.sell).toBeLessThan(i.price);
    }
    // a full T3 kit is 23 Seals for a job with an off-hand
    for (const job of JOB_IDS) {
      const k = kitItems(3, job);
      const sum = GEAR_SLOTS.reduce((n, s) => n + (k[s] ? ITEMS[k[s]!]!.seals! : 0), 0);
      expect(sum).toBe(OFFHAND_FOR[JOBS[job].weapon] ? 23 : 21);
    }
  });

  it('every set and named weapon mod passes parseMods and names abilities that exist', () => {
    const check = (mods: readonly unknown[]) => {
      expect(mods.length).toBeGreaterThan(0);
      expect(parseMods(mods)).toEqual(mods);
      for (const m of mods as readonly { ability?: string }[]) if (m.ability && m.ability !== 'all') expect(ABILITIES).toHaveProperty(m.ability);
    };
    for (const s of SET_IDS) {
      if (s === 'plain') { expect(SETS[s].bonus3).toEqual([]); expect(SETS[s].bonus5).toEqual([]); continue; }
      check(SETS[s].bonus3); check(SETS[s].bonus5);
      expect(SETS[s].desc3.length).toBeGreaterThan(10); expect(SETS[s].desc5.length).toBeGreaterThan(10);
    }
    for (const id of ITEM_IDS) if (ITEMS[id]!.named) check(ITEMS[id]!.named!.mods);
    // Each named weapon's ability mods name its own job's abilities.
    const owner: Record<string, JobId> = { last_bell: 'warrior', longwatch: 'ranger', lampwardens_oath: 'paladin', grief_of_brass: 'dark_knight', twin_wicks: 'ninja', dawnlantern: 'white_mage', ember_lens: 'black_mage' };
    for (const [id, job] of Object.entries(owner)) {
      expect(fits(id, 'weapon', job)).toBe(true);
      for (const m of ITEMS[id]!.named!.mods as readonly { ability?: string }[]) if (m.ability) expect(ABILITIES[m.ability as keyof typeof ABILITIES].job).toBe(job);
    }
  });

  it('costumes: twelve priced, two event-only, models in 200..255; 32 dyes, [0] Undyed', () => {
    expect(COSTUME_IDS).toHaveLength(14);
    expect(COSTUME_IDS.filter(c => COSTUMES[c].price !== null)).toHaveLength(12);
    expect(COSTUME_IDS.filter(c => COSTUMES[c].price === null).sort()).toEqual(['beacon_halo', 'starfall_regalia']);
    const models = COSTUME_IDS.map(c => COSTUMES[c].model);
    expect(new Set(models).size).toBe(14);
    for (const m of models) { expect(m).toBeGreaterThanOrEqual(200); expect(m).toBeLessThanOrEqual(255); }
    for (const c of COSTUME_IDS) { const p = COSTUMES[c].price; if (p !== null) { expect(p).toBeGreaterThanOrEqual(150); expect(p).toBeLessThanOrEqual(1200); } }
    expect(DYES).toHaveLength(32);
    expect(DYES[0]!.name).toBe('Undyed');
    expect(new Set(DYES.map(d => d.name)).size).toBe(32);
    for (const d of DYES) expect(d.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(DYES.slice(25).map(d => d.name)).toEqual(['Chalk', 'Ash', 'Soot', 'Pewter', 'Brass', 'Copper', 'Beacon Gold']);
  });
});

describe('kitFor', () => {
  it('P1: kitFor at level 10 in starter gear with no talents is STARTER_STATS and no mods, for every job', () => {
    for (const job of JOB_IDS) {
      const want = { ...STARTER_STATS, focus: 0, flow: 0, guard: 0 };
      expect(kitFor({ job, level: 10, gear: starterGear(job), talents: [] })).toEqual({ stats: want, mods: [] });
      // no gear data at all (an old save) is the starter kit
      expect(kitFor({ job, level: 10, gear: {}, talents: [] })).toEqual({ stats: want, mods: [] });
      // gear that does not fit, or unknown ids, falls back to the starter piece
      expect(kitFor({ job, level: 10, gear: { head: 'nope', chest: 'last_bell', weapon: job === 'warrior' ? 'grove_bow' : 'grove_blade' }, talents: [] })).toEqual({ stats: want, mods: [] });
    }
    // levels below 10 in starter gear are baseStats plus the starter kit
    const l1 = kitFor({ job: 'warrior', level: 1, gear: {}, talents: [] }).stats;
    expect(l1).toEqual({ power: baseStats(1).power + 1, defence: baseStats(1).defence + 2, maxHp: baseStats(1).maxHp + 10, focus: 0, flow: 0, guard: 0 });
  });

  it('T2 at level 10 is 13 / 14 / 130 for light; heavy and cloth follow TYPE_MULT; 5 Mossweave pieces give both bonuses', () => {
    const warrior = kitFor({ job: 'warrior', level: 10, gear: full(2, 'warrior'), talents: [] });
    expect(warrior.stats).toEqual({ power: 13, defence: 14, maxHp: 130, focus: 0, flow: 12, guard: 0 });
    expect(warrior.mods).toEqual([...SETS.cinderstep.bonus3, ...SETS.cinderstep.bonus5]);
    const t3 = kitFor({ job: 'warrior', level: 10, gear: full(3, 'warrior'), talents: [] });
    expect(t3.stats).toMatchObject({ power: 20, defence: 24, maxHp: 180, flow: 20 });
    expect(t3.mods).toEqual([...SETS.tollwind.bonus3, ...SETS.tollwind.bonus5, ...ITEMS.last_bell!.named!.mods]);
    const pal = kitFor({ job: 'paladin', level: 10, gear: full(2, 'paladin'), talents: [] }).stats;
    expect(pal.defence).toBeCloseTo(8 + 6 * TYPE_MULT.heavy.defence, 9);
    expect(pal.maxHp).toBe(90 + Math.round(40 * TYPE_MULT.heavy.maxHp));
    expect(pal.guard).toBe(12);
    const wm = kitFor({ job: 'white_mage', level: 10, gear: full(2, 'white_mage'), talents: [] }).stats;
    expect(wm.defence).toBeCloseTo(8 + 6 * TYPE_MULT.cloth.defence, 9);
    expect(wm.maxHp).toBe(90 + Math.round(40 * TYPE_MULT.cloth.maxHp));
    expect(wm.focus).toBe(12);
    // 5 Mossweave pieces (and a starter back): both bonuses, in order
    const moss: Partial<Record<GearSlot, ItemId>> = { head: 'mossweave_head', chest: 'mossweave_chest', legs: 'mossweave_legs', hands: 'mossweave_hands', feet: 'mossweave_feet' };
    expect(setCounts(moss)).toEqual({ mossweave: 5 });
    const k5 = kitFor({ job: 'white_mage', level: 10, gear: moss, talents: [] });
    expect(k5.mods).toEqual([...SETS.mossweave.bonus3, ...SETS.mossweave.bonus5]);
    const k3 = kitFor({ job: 'white_mage', level: 10, gear: { head: 'mossweave_head', chest: 'mossweave_chest', legs: 'mossweave_legs', hands: 'wickthread_hands' }, talents: [] });
    expect(k3.mods).toEqual([...SETS.mossweave.bonus3]);
    expect(kitFor({ job: 'white_mage', level: 10, gear: { head: 'mossweave_head', chest: 'mossweave_chest' }, talents: [] }).mods).toEqual([]);
    // talents come last
    const kt = kitFor({ job: 'white_mage', level: 10, gear: moss, talents: SIM_TALENTS.white_mage });
    expect(kt.mods).toEqual([...SETS.mossweave.bonus3, ...SETS.mossweave.bonus5, ...talentMods('white_mage', 10, SIM_TALENTS.white_mage)]);
    expect(Object.isFrozen(kt.mods)).toBe(true);
  });

  it("specials are capped at 40; mixing types sums each type's own special", () => {
    const mixed: Partial<Record<GearSlot, ItemId>> = { head: 'lenslight_head', chest: 'tollwind_chest', legs: 'beaconstone_legs', hands: 'lenslight_hands', feet: 'tollwind_feet', back: 'beaconstone_back' };
    const st = kitFor({ job: 'warrior', level: 10, gear: mixed, talents: [] }).stats;
    expect(st.focus).toBe(itemStats('lenslight_head').focus + itemStats('lenslight_hands').focus);
    expect(st.flow).toBe(itemStats('tollwind_chest').flow + itemStats('tollwind_feet').flow);
    expect(st.guard).toBe(itemStats('beaconstone_legs').guard + itemStats('beaconstone_back').guard);
    expect(setCounts(mixed)).toEqual({ lenslight: 2, tollwind: 2, beaconstone: 2 });
    // The kit table never reaches the cap with one type; the cap is enforced all the same.
    expect(SPECIAL_CAP).toBe(40);
    for (const job of JOB_IDS) for (const t of [1, 2, 3] as const) {
      const s = kitFor({ job, level: 10, gear: full(t, job), talents: [] }).stats;
      for (const v of [s.focus, s.flow, s.guard]) expect(v).toBeLessThanOrEqual(40);
      expect(s[({ cloth: 'focus', light: 'flow', heavy: 'guard' } as const)[JOB_ARMOUR[job]]]).toBe(KIT_TABLE[t].special);
    }
  });

  it('costumes and dyes never reach kitFor: it takes no outfit, wardrobe or dye at all', () => {
    // kitFor's input has only job, level, gear (item ids) and talents; extra fields are ignored.
    const base = kitFor({ job: 'ranger', level: 7, gear: full(1, 'ranger'), talents: [] });
    const dressed = kitFor({ job: 'ranger', level: 7, gear: full(1, 'ranger'), talents: [], ...{ outfit: { body: 'solstice_finery', head: 'beacon_halo', back: 'kitewing_mantle', hideHead: true }, dyes: [5, 31] } } as Parameters<typeof kitFor>[0]);
    expect(dressed).toEqual(base);
  });
});
