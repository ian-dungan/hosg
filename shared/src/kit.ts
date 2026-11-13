// kitFor: what the engine takes for an adventurer (stats plus mods), from its job, level, worn items and
// talents. Costumes, dyes and outfits are never an input: appearance cannot change a number.
import type { JobId } from './combat/jobs';
import { SPECIAL_CAP } from './combat/constants';
import type { Stats } from './combat/stats';
import { ARMOUR_SLOTS, GEAR_SLOTS, ITEMS, SETS, SET_IDS, fits, itemStats, starterFor, type GearSlot, type ItemId, type SetId } from './items';
import type { Kit, Mod } from './mods';
import { baseStats } from './progression';
import { talentMods } from './talents';

/** The item `job` really wears in each slot: the given one where it fits, else the starter piece (an off-hand slot stays empty for a weapon that takes none). */
export function resolveGear(job: JobId, gear: Partial<Record<GearSlot, ItemId>>): Partial<Record<GearSlot, ItemId>> {
  const out: Partial<Record<GearSlot, ItemId>> = {};
  for (const s of GEAR_SLOTS) {
    const id = gear[s];
    const use = id !== undefined && fits(id, s, job) ? id : starterFor(job, s);
    if (use) out[s] = use;
  }
  return out;
}

/** How many armour pieces of each set `gear` holds (weapons and off-hands belong to no set). */
export function setCounts(gear: Partial<Record<GearSlot, ItemId>>): Partial<Record<SetId, number>> {
  const out: Partial<Record<SetId, number>> = {};
  for (const s of ARMOUR_SLOTS) {
    const id = gear[s];
    const set = id !== undefined && Object.prototype.hasOwnProperty.call(ITEMS, id) && ITEMS[id]!.slot === s ? ITEMS[id]!.set : undefined;
    if (set) out[set] = (out[set] ?? 0) + 1;
  }
  return out;
}

const tenth = (v: number) => Math.round(v * 10) / 10;

/**
 * baseStats(level) plus every worn piece's itemStats (gear that is missing, unknown or does not fit the
 * job and slot counts as the starter piece, so an old save with no gear is the starter kit); power and
 * defence whole (every piece's stats are whole numbers), specials summed per type and capped at SPECIAL_CAP. Mods, in order: each set's 3-piece
 * bonus (≥ 3 pieces) and 5-piece bonus (≥ 5), in SET_IDS order; the named weapon's; then talentMods.
 * P1: level 10 in the starter kit with no talents is exactly STARTER_STATS (specials 0) and no mods.
 */
export function kitFor(o: { job: JobId; level: number; gear: Partial<Record<GearSlot, ItemId>>; talents: readonly string[] }): Kit {
  const worn = resolveGear(o.job, o.gear);
  const b = baseStats(o.level);
  const sum = { power: b.power, defence: b.defence, maxHp: b.maxHp, focus: 0, flow: 0, guard: 0 };
  for (const s of GEAR_SLOTS) {
    const id = worn[s];
    if (!id) continue;
    const st = itemStats(id);
    sum.power += st.power; sum.defence += st.defence; sum.maxHp += st.maxHp;
    sum.focus += st.focus; sum.flow += st.flow; sum.guard += st.guard;
  }
  const stats: Stats = {
    power: tenth(sum.power), defence: tenth(sum.defence), maxHp: Math.round(sum.maxHp),
    focus: Math.min(SPECIAL_CAP, sum.focus), flow: Math.min(SPECIAL_CAP, sum.flow), guard: Math.min(SPECIAL_CAP, sum.guard),
  };
  const mods: Mod[] = [];
  const counts = setCounts(worn);
  for (const set of SET_IDS) {
    const n = counts[set] ?? 0;
    if (n >= 3) mods.push(...SETS[set].bonus3);
    if (n >= 5) mods.push(...SETS[set].bonus5);
  }
  const weapon = worn.weapon ? ITEMS[worn.weapon] : undefined;
  if (weapon?.named) mods.push(...weapon.named.mods);
  mods.push(...talentMods(o.job, o.level, o.talents));
  return { stats, mods: Object.freeze(mods) };
}

