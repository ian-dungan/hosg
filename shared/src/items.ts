// Gear: the eight slots, the armour types, the ten sets and their bonuses, the 101 items (with the seven
// named Warden weapons), what each piece gives, and which job it fits. Every item of an id has fixed
// stats computed from the tables here (itemStats), so tuning a row retunes every piece; nothing is rolled.
// Costumes and dyes (appearance only) live in costumes.ts and are re-exported here.
// Runtime imports: deepFreeze, and JOBS read only inside functions (jobs.ts never imports this module).
import { deepFreeze } from './combat/freeze';
import { JOBS, type JobId } from './combat/jobs';
import type { WeaponId } from './combat/abilities';
import type { Stats } from './combat/stats';
import type { Mod } from './mods';

export * from './costumes';

export type GearSlot = 'head' | 'chest' | 'legs' | 'hands' | 'feet' | 'back' | 'weapon' | 'offhand';
export type ArmourSlot = Exclude<GearSlot, 'weapon' | 'offhand'>;
/** In code order (the same order as look.ts's GEAR_LOOK_SLOTS). */
export const GEAR_SLOTS: readonly GearSlot[] = Object.freeze(['head', 'chest', 'legs', 'hands', 'feet', 'back', 'weapon', 'offhand']);
export const ARMOUR_SLOTS: readonly ArmourSlot[] = Object.freeze(['head', 'chest', 'legs', 'hands', 'feet', 'back']);
export function isGearSlot(v: unknown): v is GearSlot { return typeof v === 'string' && (GEAR_SLOTS as readonly string[]).includes(v); }
export const isArmourSlot = (s: GearSlot): s is ArmourSlot => s !== 'weapon' && s !== 'offhand';

/** Plain is the starter kit only: no special stat, no set bonus. */
export type ArmourType = 'cloth' | 'light' | 'heavy' | 'plain';
export type OffhandKind = 'buckler' | 'quiver' | 'shield' | 'tome';
export type Tier = 0 | 1 | 2 | 3;

/** The off-hand each weapon takes (null: two-handed or a pair). */
export const OFFHAND_FOR: Readonly<Record<WeaponId, OffhandKind | null>> = deepFreeze({
  blade: 'buckler', bow: 'quiver', sword: 'shield', staff: 'tome', greatsword: null, daggers: null,
});
/** The weapon's share of a kit's power when an off-hand is worn (the off-hand gets the rest). */
export const WEAPON_POWER_SHARE = 0.75;

/** A full kit's bonus over baseStats(10), per tier, for light armour (the reference type). Tunable by Task 5 only. */
export const KIT_TABLE: Readonly<Record<Tier, { readonly power: number; readonly defence: number; readonly maxHp: number; readonly special: number }>> = deepFreeze({
  0: { power: 1, defence: 2, maxHp: 10, special: 0 },
  1: { power: 2.5, defence: 4, maxHp: 22, special: 6 },
  2: { power: 4, defence: 6, maxHp: 40, special: 12 },
  3: { power: 11, defence: 16, maxHp: 90, special: 20 },
});
/** Each armour type's multipliers on its pieces' defence and health. Tunable by Task 5 only. */
export const TYPE_MULT: Readonly<Record<ArmourType, { readonly defence: number; readonly maxHp: number }>> = deepFreeze({
  heavy: { defence: 1.5, maxHp: 1.2 },
  light: { defence: 1, maxHp: 1 },
  cloth: { defence: 0.6, maxHp: 0.85 },
  plain: { defence: 1, maxHp: 1 },
});
/** How a kit's defence, health and special split over the six armour pieces. */
export const SLOT_WEIGHT: Readonly<Record<ArmourSlot, number>> = deepFreeze({ chest: 0.25, legs: 0.2, head: 0.17, hands: 0.13, feet: 0.13, back: 0.12 });
/** The special stat each armour type gives. */
export const TYPE_SPECIAL: Readonly<Record<ArmourType, 'focus' | 'flow' | 'guard' | null>> = deepFreeze({ cloth: 'focus', light: 'flow', heavy: 'guard', plain: null });

/** The armour type each job's loot leans to (60%) and the simulation's kits use. */
export const JOB_ARMOUR: Readonly<Record<JobId, Exclude<ArmourType, 'plain'>>> = deepFreeze({
  warrior: 'light', ranger: 'light', ninja: 'light', paladin: 'heavy', dark_knight: 'heavy', white_mage: 'cloth', black_mage: 'cloth',
});

// ───────── sets ─────────
export type SetId = 'plain' | 'mossweave' | 'thornrunner' | 'rootbound' | 'wickthread' | 'cinderstep' | 'brassbound' | 'lenslight' | 'tollwind' | 'beaconstone';
export interface SetData {
  readonly id: SetId; readonly name: string; readonly tier: Tier; readonly type: ArmourType;
  /** Active at 3 and at 5 pieces of the set (both at 5). */
  readonly bonus3: readonly Mod[]; readonly bonus5: readonly Mod[];
  readonly desc3: string; readonly desc5: string;
}

const S = (id: SetId, name: string, tier: Tier, type: ArmourType, bonus3: Mod[], desc3: string, bonus5: Mod[], desc5: string): SetData =>
  ({ id, name, tier, type, bonus3, bonus5, desc3, desc5 });

/** Bonus magnitudes are tunable ±30% by Task 5 only (never a kind). */
export const SETS: Readonly<Record<SetId, SetData>> = deepFreeze({
  plain: S('plain', 'Grove-Spun', 0, 'plain', [], '', [], ''),
  mossweave: S('mossweave', 'Mossweave', 1, 'cloth',
    [{ k: 'healShield', frac: 0.15, cap: 15 }], 'Your heals also shield the healed for 15% of the amount healed (up to 15, for 6 s).',
    [{ k: 'cast', ability: 'all', mult: 0.9 }], 'Your casts take 10% less time.'),
  thornrunner: S('thornrunner', 'Thornrunner', 1, 'light',
    [{ k: 'momentumOn', on: 'perfectDodge', amount: 10 }], 'A perfect dodge gives 10 Momentum.',
    [{ k: 'dodge', refillMult: 0.8 }], 'Dodge charges refill 20% faster.'),
  rootbound: S('rootbound', 'Rootbound', 1, 'heavy',
    [{ k: 'momentumOn', on: 'hitTaken', amount: 3, everyS: 1 }], 'An enemy hit landing on you gives 3 Momentum (at most once a second).',
    [{ k: 'lowHpShield', frac: 0.15, below: 0.35, everyS: 30 }], 'Falling below 35% health shields you for 15% of your max health (6 s; once every 30 s).'),
  wickthread: S('wickthread', 'Wickthread', 2, 'cloth',
    [{ k: 'cdOnCast', s: 0.5 }], 'A completed cast takes half a second off your other cooldowns.',
    [{ k: 'momentumOn', on: 'interrupt', amount: 20 }], 'Interrupting a wind-up gives 20 Momentum.'),
  cinderstep: S('cinderstep', 'Cinderstep', 2, 'light',
    [{ k: 'momentumOn', on: 'detonate', amount: 10 }], 'A finisher that detonates a mark refunds 10 Momentum.',
    [{ k: 'afterDodge', mult: 1.2, s: 2 }], 'For 2 s after a dodge, your next ability deals 20% more.'),
  brassbound: S('brassbound', 'Brassbound', 2, 'heavy',
    [{ k: 'shieldOn', on: 'taunt', amount: 15, s: 6 }], 'Your taunts also shield you for 15 (6 s).',
    [{ k: 'staggerMult', mult: 1.2 }], 'The stagger you deal is 20% greater.'),
  lenslight: S('lenslight', 'Lenslight', 3, 'cloth',
    [{ k: 'healShield', frac: 0.3, cap: 20, overhealOnly: true }], 'Overhealing you give becomes a shield: 30% of the overheal, up to 20, for 6 s.',
    [{ k: 'finisherCost', add: -10 }], 'Your finishers cost 10 less Momentum.'),
  tollwind: S('tollwind', 'Tollwind', 3, 'light',
    [{ k: 'dodge', charges: 1 }], 'One more dodge charge.',
    [{ k: 'resetOn', on: 'perfectDodge', slot: 'quick' }], "A perfect dodge resets your quick ability's cooldown."),
  beaconstone: S('beaconstone', 'Beaconstone', 3, 'heavy',
    [{ k: 'auraTaken', mult: 0.95, r: 8 }], 'Party members within 8 m take 5% less damage from enemies.',
    [{ k: 'lastStand', everyS: 90, iframesS: 2 }], 'Once every 90 s, a blow that would kill you leaves you at 1 health with 2 s of safety.'),
});
/** In table order. */
export const SET_IDS: readonly SetId[] = Object.freeze(Object.keys(SETS) as SetId[]);

/** The set of a tier and armour type (tier 0 is the plain starter set, whatever the type). */
export function tierSet(tier: Tier, type: ArmourType): SetId {
  if (tier === 0 || type === 'plain') return 'plain';
  for (const id of SET_IDS) if (SETS[id].tier === tier && SETS[id].type === type) return id;
  return 'plain';
}

/** Piece nouns per armour type. */
const NOUNS: Readonly<Record<ArmourType, Readonly<Record<ArmourSlot, string>>>> = deepFreeze({
  cloth: { head: 'Hood', chest: 'Robe', legs: 'Breeches', hands: 'Wraps', feet: 'Slippers', back: 'Shawl' },
  light: { head: 'Cap', chest: 'Jerkin', legs: 'Leggings', hands: 'Gloves', feet: 'Boots', back: 'Cloak' },
  heavy: { head: 'Helm', chest: 'Hauberk', legs: 'Greaves', hands: 'Gauntlets', feet: 'Sabatons', back: 'Mantle' },
  plain: { head: 'Cap', chest: 'Tunic', legs: 'Trousers', hands: 'Mitts', feet: 'Shoes', back: 'Scarf' },
});

// ───────── items ─────────
export type ItemId = string;
export interface ItemData {
  readonly id: ItemId; readonly name: string; readonly slot: GearSlot; readonly tier: Tier; readonly ilvl: 1 | 4 | 7 | 10;
  readonly type?: ArmourType; readonly set?: SetId; readonly weapon?: WeaponId; readonly offhand?: OffhandKind;
  /** A named weapon's line (shown on the item) and its mods. */
  readonly named?: { readonly line: string; readonly mods: readonly Mod[] };
  /** 0..199: the visual the client builds (unique per item). */
  readonly model: number;
  /** Gold at the Smithy (T1 and only T1). */
  readonly price?: number;
  /** Warden's Seals at the Lampwright (T3 and only T3). */
  readonly seals?: number;
  /** Gold the Smithy pays; 0 = cannot be sold (starter). */
  readonly sell: number;
  /** Colours: grey, white, green (T1) / blue (T2) / violet (T3) for sets, gold for named. */
  readonly rarity: 'starter' | 'common' | 'set' | 'named';
}

const ILVL = [1, 4, 7, 10] as const;
/** Smithy prices (T1), by slot. */
export const SMITHY_PRICE: Readonly<Record<GearSlot, number>> = deepFreeze({ weapon: 120, offhand: 50, chest: 80, legs: 65, head: 55, hands: 40, feet: 40, back: 35 });
/** Lampwright prices in Warden's Seals (T3), by slot: a full kit is 23. */
export const LAMPWRIGHT_SEALS: Readonly<Record<GearSlot, number>> = deepFreeze({ chest: 4, legs: 3, head: 3, hands: 2, feet: 2, back: 2, weapon: 5, offhand: 2 });
/** T1 sells for this share of its price (rounded down). */
export const T1_SELL_FRAC = 0.2;

function sellValue(tier: Tier, slot: GearSlot, named: boolean): number {
  if (tier === 0) return 0;
  if (tier === 1) return Math.floor(SMITHY_PRICE[slot] * T1_SELL_FRAC);
  const armour = isArmourSlot(slot);
  if (tier === 2) return armour ? 40 : 60;
  return named ? 150 : armour ? 80 : 100;
}

function shop(tier: Tier, slot: GearSlot): { price?: number; seals?: number } {
  if (tier === 1) return { price: SMITHY_PRICE[slot] };
  if (tier === 3) return { seals: LAMPWRIGHT_SEALS[slot] };
  return {};
}

const WEAPON_ORDER: readonly WeaponId[] = ['blade', 'bow', 'sword', 'greatsword', 'daggers', 'staff'];
const OFFHAND_ORDER: readonly OffhandKind[] = ['buckler', 'quiver', 'shield', 'tome'];

type W = readonly [id: string, name: string];
/** Weapons per type, starter to T2; T3 is the named table. */
const WEAPON_NAMES: Readonly<Record<WeaponId, readonly [W, W, W]>> = {
  blade: [['grove_blade', 'Grove Blade'], ['hedgecutter', 'Hedgecutter'], ['wickfang_sabre', 'Wickfang Sabre']],
  bow: [['grove_bow', 'Grove Bow'], ['ashwood_longbow', 'Ashwood Longbow'], ['cinderstring', 'Cinderstring']],
  sword: [['grove_sword', 'Grove Sword'], ['millward_sword', 'Millward Sword'], ['cogtooth_blade', 'Cogtooth Blade']],
  greatsword: [['grove_greatsword', 'Grove Greatsword'], ['woodsmans_cleaver', "Woodsman's Cleaver"], ['furnace_edge', 'Furnace Edge']],
  daggers: [['grove_knives', 'Grove Knives'], ['thornpick_pair', 'Thornpick Pair'], ['twin_sparks', 'Twin Sparks']],
  staff: [['grove_staff', 'Grove Staff'], ['rowan_staff', 'Rowan Staff'], ['lampglass_rod', 'Lampglass Rod']],
};
const OFFHAND_NAMES: Readonly<Record<OffhandKind, readonly [W, W, W, W]>> = {
  buckler: [['grove_buckler', 'Grove Buckler'], ['hedge_buckler', 'Hedge Buckler'], ['cog_buckler', 'Cog Buckler'], ['toll_buckler', 'Toll Buckler']],
  quiver: [['grove_quiver', 'Grove Quiver'], ['fletchers_quiver', "Fletcher's Quiver"], ['ember_quiver', 'Ember Quiver'], ['lens_quiver', 'Lens Quiver']],
  shield: [['grove_shield', 'Grove Shield'], ['millward_shield', 'Millward Shield'], ['brass_kite', 'Brass Kite Shield'], ['beacon_shield', 'Beacon Shield']],
  tome: [['grove_tome', 'Grove Tome'], ['herbal_tome', 'Herbal Tome'], ['wickbound_tome', 'Wick-Bound Tome'], ['keepers_logbook', "Keeper's Logbook"]],
};

/**
 * The seven named Warden weapons (T3): each one bends its job's play. Effects are tunable ±30% by Task 5
 * only. Lines are what the item card shows.
 */
const NAMED: readonly { id: string; name: string; weapon: WeaponId; line: string; mods: Mod[] }[] = [
  { id: 'last_bell', name: 'Last Bell', weapon: 'blade', line: 'Rung when the lamps went out. A parry gives 25 Momentum, and Sunder comes back a second sooner.',
    mods: [{ k: 'momentumOn', on: 'parry', amount: 25 }, { k: 'cd', ability: 'sunder', add: -1 }] },
  { id: 'longwatch', name: 'Longwatch', weapon: 'bow', line: "Strung from the Beacon's watch-line. Charged Shot hits 20% harder, and interrupting gives 15 Momentum.",
    mods: [{ k: 'coef', ability: 'charged_shot', mult: 1.2 }, { k: 'momentumOn', on: 'interrupt', amount: 15 }] },
  { id: 'lampwardens_oath', name: "Lampwarden's Oath", weapon: 'sword', line: 'Sworn before the Warden fell. Your taunts shield you for 25 (6 s), and Dawn Ward absorbs 20% more.',
    mods: [{ k: 'shieldOn', on: 'taunt', amount: 25, s: 6 }, { k: 'amount', ability: 'dawn_ward', mult: 1.2 }] },
  { id: 'grief_of_brass', name: 'Grief of Brass', weapon: 'greatsword', line: "The Warden's own sorrow, cast in brass. Crimson Pact costs no health, and Nightfall hits 10% harder.",
    mods: [{ k: 'hpCost', ability: 'crimson_pact', mult: 0 }, { k: 'coef', ability: 'nightfall', mult: 1.1 }] },
  { id: 'twin_wicks', name: 'Twin Wicks', weapon: 'daggers', line: 'Two flames that never quite go out. A perfect dodge resets your quick ability, and for 2 s after a dodge your next ability hits 15% harder.',
    mods: [{ k: 'resetOn', on: 'perfectDodge', slot: 'quick' }, { k: 'afterDodge', mult: 1.15, s: 2 }] },
  { id: 'dawnlantern', name: 'Dawnlantern', weapon: 'staff', line: "Ellie's light, carried down into the dark. Second Dawn casts 40% faster, and your heals also shield 15% (up to 15).",
    mods: [{ k: 'cast', ability: 'second_dawn', mult: 0.6 }, { k: 'healShield', frac: 0.15, cap: 15 }] },
  { id: 'ember_lens', name: 'Ember Lens', weapon: 'staff', line: "Felix's lens, still warm from the Lampfall. Hearthfall casts 25% faster, and each reaction you trigger gives 10 Momentum.",
    mods: [{ k: 'cast', ability: 'hearthfall', mult: 0.75 }, { k: 'momentumOn', on: 'react', amount: 10 }] },
];

function buildItems(): Record<ItemId, ItemData> {
  const out: Record<ItemId, ItemData> = {};
  // armour: model = set index · 6 + slot index + 1 (1..60)
  SET_IDS.forEach((set, si) => {
    const d = SETS[set];
    ARMOUR_SLOTS.forEach((slot, ki) => {
      const id = `${set}_${slot}`;
      out[id] = {
        id, name: `${d.name} ${NOUNS[d.type][slot]}`, slot, tier: d.tier, ilvl: ILVL[d.tier], type: d.type, set,
        model: si * 6 + ki + 1, ...shop(d.tier, slot), sell: sellValue(d.tier, slot, false), rarity: d.tier === 0 ? 'starter' : 'set',
      };
    });
  });
  // weapons: model = 64 + type index · 4 + tier (64..87), the second named staff 88
  WEAPON_ORDER.forEach((weapon, wi) => {
    WEAPON_NAMES[weapon].forEach(([id, name], tier) => {
      const t = tier as Tier;
      out[id] = { id, name, slot: 'weapon', tier: t, ilvl: ILVL[t], weapon, model: 64 + wi * 4 + t, ...shop(t, 'weapon'), sell: sellValue(t, 'weapon', false), rarity: t === 0 ? 'starter' : 'common' };
    });
    NAMED.filter(n => n.weapon === weapon).forEach((n, k) => {
      out[n.id] = {
        id: n.id, name: n.name, slot: 'weapon', tier: 3, ilvl: 10, weapon, named: { line: n.line, mods: n.mods },
        model: k === 0 ? 64 + wi * 4 + 3 : 88, ...shop(3, 'weapon'), sell: sellValue(3, 'weapon', true), rarity: 'named',
      };
    });
  });
  // off-hands: model = 96 + kind index · 4 + tier (96..111)
  OFFHAND_ORDER.forEach((offhand, oi) => {
    OFFHAND_NAMES[offhand].forEach(([id, name], tier) => {
      const t = tier as Tier;
      out[id] = { id, name, slot: 'offhand', tier: t, ilvl: ILVL[t], offhand, model: 96 + oi * 4 + t, ...shop(t, 'offhand'), sell: sellValue(t, 'offhand', false), rarity: t === 0 ? 'starter' : 'common' };
    });
  });
  return out;
}

export const ITEMS: Readonly<Record<ItemId, ItemData>> = deepFreeze(buildItems());
/** Every item id: armour by set, then weapons, then off-hands. */
export const ITEM_IDS: readonly ItemId[] = Object.freeze(Object.keys(ITEMS));

const own = (o: object, k: unknown): k is string => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
export function isItemId(v: unknown): v is ItemId { return own(ITEMS, v); }

// ───────── stats ─────────
/** Splits `total` integer units over the armour slots by SLOT_WEIGHT (largest remainder; ties in slot order), so a full kit sums exactly. */
function apportion(total: number): Record<ArmourSlot, number> {
  const raw = ARMOUR_SLOTS.map(s => total * SLOT_WEIGHT[s]);
  const base = raw.map(r => Math.floor(r + 1e-9));
  let left = total - base.reduce((a, b) => a + b, 0);
  const order = ARMOUR_SLOTS.map((_, i) => i).sort((a, b) => (raw[b]! - base[b]!) - (raw[a]! - base[a]!) || a - b);
  for (const i of order) { if (left <= 0) break; base[i]!++; left--; }
  return Object.fromEntries(ARMOUR_SLOTS.map((s, i) => [s, base[i]!])) as Record<ArmourSlot, number>;
}

const statCache = new Map<ItemId, Readonly<Required<Stats>>>();
const ZERO: Readonly<Required<Stats>> = Object.freeze({ power: 0, defence: 0, maxHp: 0, focus: 0, flow: 0, guard: 0 });

/**
 * A piece's own contribution (no base stats), computed from KIT_TABLE, TYPE_MULT and SLOT_WEIGHT:
 * power splits between the weapon (WEAPON_POWER_SHARE, to 0.1) and the off-hand (the rest), or all to a
 * weapon that takes none; defence (to 0.1), health and the type's special split over the six armour
 * pieces by slot weight after the type's multipliers. An unknown id gives zeros. Frozen.
 */
export function itemStats(id: ItemId): Required<Stats> {
  const hit = statCache.get(id);
  if (hit) return hit as Required<Stats>;
  if (!isItemId(id)) return ZERO as Required<Stats>;
  const it = ITEMS[id]!, k = KIT_TABLE[it.tier];
  const out = { power: 0, defence: 0, maxHp: 0, focus: 0, flow: 0, guard: 0 };
  const powerTenths = Math.round(k.power * 10);
  const weaponTenths = Math.round(powerTenths * WEAPON_POWER_SHARE);
  if (it.slot === 'weapon') out.power = (OFFHAND_FOR[it.weapon!] ? weaponTenths : powerTenths) / 10;
  else if (it.slot === 'offhand') out.power = (powerTenths - weaponTenths) / 10;
  else {
    const slot = it.slot as ArmourSlot, m = TYPE_MULT[it.type!];
    out.defence = apportion(Math.round(k.defence * m.defence * 10))[slot] / 10;
    out.maxHp = apportion(Math.round(k.maxHp * m.maxHp))[slot];
    const sp = TYPE_SPECIAL[it.type!];
    if (sp) out[sp] = apportion(k.special)[slot];
  }
  const frozen = Object.freeze(out);
  statCache.set(id, frozen);
  return frozen;
}

/**
 * Whether item `id` can be worn in `slot` by `job`: armour in its own slot by every job; a weapon by every
 * job whose JOBS[job].weapon is its weapon; an off-hand by the jobs whose weapon takes its kind.
 */
export function fits(id: ItemId, slot: GearSlot, job: JobId): boolean {
  if (!isItemId(id) || !own(JOBS, job)) return false;
  const it = ITEMS[id]!;
  if (it.slot !== slot) return false;
  if (slot === 'weapon') return it.weapon === JOBS[job].weapon;
  if (slot === 'offhand') return it.offhand !== undefined && OFFHAND_FOR[JOBS[job].weapon] === it.offhand;
  return true;
}

/** The item a tier gives `job` in a weapon or off-hand slot (null: no off-hand). T3 staves: Dawnlantern for the White Mage, Ember Lens for the Black Mage. */
export function tierWeapon(tier: Tier, job: JobId, slot: 'weapon' | 'offhand'): ItemId | null {
  const weapon = JOBS[job].weapon;
  if (slot === 'offhand') {
    const kind = OFFHAND_FOR[weapon];
    return kind ? OFFHAND_NAMES[kind][tier][0] : null;
  }
  if (tier < 3) return WEAPON_NAMES[weapon][tier as 0 | 1 | 2][0];
  if (weapon === 'staff') return job === 'black_mage' ? 'ember_lens' : 'dawnlantern';
  return NAMED.find(n => n.weapon === weapon)!.id;
}

/** The 16 starter items, in uid order: the six plain pieces, a weapon per type, the four off-hands. */
export function starterItems(): readonly ItemId[] {
  return STARTER_ITEMS;
}
const STARTER_ITEMS: readonly ItemId[] = Object.freeze([
  ...ARMOUR_SLOTS.map(s => `plain_${s}`),
  ...WEAPON_ORDER.map(w => WEAPON_NAMES[w][0][0]),
  ...OFFHAND_ORDER.map(o => OFFHAND_NAMES[o][0][0]),
]);
/** The starter piece `job` wears in `slot` (null: an off-hand slot for a weapon that takes none). */
export function starterFor(job: JobId, slot: GearSlot): ItemId | null {
  return isArmourSlot(slot) ? `plain_${slot}` : tierWeapon(0, job, slot);
}

/** The simulation's full kit for a tier: the job's JOB_ARMOUR set (all six pieces), and the tier's weapon and off-hand. */
export function kitItems(tier: 1 | 2 | 3, job: JobId): Record<GearSlot, ItemId | null> {
  const set = tierSet(tier, JOB_ARMOUR[job]);
  const out = {} as Record<GearSlot, ItemId | null>;
  for (const s of ARMOUR_SLOTS) out[s] = `${set}_${s}`;
  out.weapon = tierWeapon(tier, job, 'weapon');
  out.offhand = tierWeapon(tier, job, 'offhand');
  return out;
}
