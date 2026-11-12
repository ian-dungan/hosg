// Mods: the one vocabulary for set bonuses, named weapons and talents, and the Kit the engine takes
// (stats plus mods). The engine applies them (Plan 5 Task 4); this module only describes and checks them.
import { ABILITIES, type AbilityId } from './combat/abilities';
import type { Stats } from './combat/stats';
// abilities.ts is read only inside parseMods, never at the top level.

export type ModSlot = 'quick' | 'finisher' | 'signature';
export type MomentumEvent = 'parry' | 'perfectDodge' | 'interrupt' | 'hitTaken' | 'detonate' | 'react' | 'castDone';

/**
 * One effect of a set bonus, named weapon or talent. Stacking: `mult`s of the same kind and ability
 * multiply and `add`s sum; momentumOn entries for one event sum (smallest everyS wins); healShield
 * entries sum frac (largest cap wins); auraTaken uses the strongest single aura on the receiver;
 * resetOn is idempotent; lastStand and lowHpShield use the shortest everyS.
 */
export type Mod =
  /** Its damage effects' coef. */
  | { readonly k: 'coef'; readonly ability: AbilityId; readonly mult: number }
  /** Its heal and shield amounts. */
  | { readonly k: 'amount'; readonly ability: AbilityId; readonly mult: number }
  /** Its cooldown, never below 1 s. */
  | { readonly k: 'cd'; readonly ability: AbilityId; readonly add: number }
  /** Cast time, never below 0.3 s (instants stay instant). */
  | { readonly k: 'cast'; readonly ability: AbilityId | 'all'; readonly mult: number }
  /** Its buff, debuff, shield (and sprint) durations. */
  | { readonly k: 'buffS'; readonly ability: AbilityId; readonly add: number }
  /** Its hp-cost (0 allowed). */
  | { readonly k: 'hpCost'; readonly ability: AbilityId; readonly mult: number }
  | { readonly k: 'stagger'; readonly ability: AbilityId; readonly add: number }
  /** Finishers' cost, never below 30. */
  | { readonly k: 'finisherCost'; readonly add: number }
  | { readonly k: 'momentumOn'; readonly on: MomentumEvent; readonly amount: number; readonly everyS?: number }
  /** charges: at most +1 in total over the job's own. refillMult multiplies the time a charge takes to refill (0.8 = 20% faster). */
  | { readonly k: 'dodge'; readonly charges?: number; readonly refillMult?: number }
  /** Heals given also shield the healed for frac of the amount (overhealOnly: of the overheal), at most cap, for 6 s. */
  | { readonly k: 'healShield'; readonly frac: number; readonly cap: number; readonly overhealOnly?: true }
  /** A completed cast takes s seconds off the caster's other cooldowns. */
  | { readonly k: 'cdOnCast'; readonly s: number }
  /** The next ability within s of a dodge's start deals × mult. */
  | { readonly k: 'afterDodge'; readonly mult: number; readonly s: number }
  | { readonly k: 'staggerMult'; readonly mult: number }
  | { readonly k: 'lowHpShield'; readonly frac: number; readonly below: number; readonly everyS: number }
  /** Allied adventurers (not self) within r take × mult enemy damage. */
  | { readonly k: 'auraTaken'; readonly mult: number; readonly r: number }
  | { readonly k: 'lastStand'; readonly everyS: number; readonly iframesS: number }
  | { readonly k: 'resetOn'; readonly on: 'perfectDodge'; readonly slot: 'quick' }
  | { readonly k: 'shieldOn'; readonly on: 'taunt'; readonly amount: number; readonly s: number };

export type ModKind = Mod['k'];

/** What the engine takes for an adventurer: its stats (level plus gear) and every active mod. */
export interface Kit { readonly stats: Stats; readonly mods: readonly Mod[] }

export const MOMENTUM_EVENTS: readonly MomentumEvent[] = Object.freeze(['parry', 'perfectDodge', 'interrupt', 'hitTaken', 'detonate', 'react', 'castDone']);

type Field = 'ability' | 'abilityOrAll' | 'num' | 'event' | 'perfectDodge' | 'quick' | 'taunt' | 'true';
/** Each kind's required and optional fields. */
const SHAPES: Readonly<Record<ModKind, { readonly req: Readonly<Record<string, Field>>; readonly opt?: Readonly<Record<string, Field>>; readonly oneOf?: true }>> = Object.freeze({
  coef: { req: { ability: 'ability', mult: 'num' } },
  amount: { req: { ability: 'ability', mult: 'num' } },
  cd: { req: { ability: 'ability', add: 'num' } },
  cast: { req: { ability: 'abilityOrAll', mult: 'num' } },
  buffS: { req: { ability: 'ability', add: 'num' } },
  hpCost: { req: { ability: 'ability', mult: 'num' } },
  stagger: { req: { ability: 'ability', add: 'num' } },
  finisherCost: { req: { add: 'num' } },
  momentumOn: { req: { on: 'event', amount: 'num' }, opt: { everyS: 'num' } },
  dodge: { req: {}, opt: { charges: 'num', refillMult: 'num' }, oneOf: true },
  healShield: { req: { frac: 'num', cap: 'num' }, opt: { overhealOnly: 'true' } },
  cdOnCast: { req: { s: 'num' } },
  afterDodge: { req: { mult: 'num', s: 'num' } },
  staggerMult: { req: { mult: 'num' } },
  lowHpShield: { req: { frac: 'num', below: 'num', everyS: 'num' } },
  auraTaken: { req: { mult: 'num', r: 'num' } },
  lastStand: { req: { everyS: 'num', iframesS: 'num' } },
  resetOn: { req: { on: 'perfectDodge', slot: 'quick' } },
  shieldOn: { req: { on: 'taunt', amount: 'num', s: 'num' } },
});

/** parseMods reads at most this many entries (the rest are dropped). */
export const MAX_MODS = 64;
/**
 * The sane range of each numeric field, `kind.field` → [lo, hi] inclusive (a number outside it refuses the
 * mod). Wide enough for every tuning range (±30%), narrow enough that no stored or forged mod can make a
 * cooldown or cost absurd. `dodge.charges` must also be an integer.
 */
const RANGES: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  'coef.mult': [0.1, 3], 'amount.mult': [0.1, 3], 'cd.add': [-30, 30], 'cast.mult': [0.1, 2], 'buffS.add': [-30, 30],
  'hpCost.mult': [0, 3], 'stagger.add': [-50, 100], 'finisherCost.add': [-30, 30],
  'momentumOn.amount': [0, 100], 'momentumOn.everyS': [0, 600],
  'dodge.charges': [0, 1], 'dodge.refillMult': [0.1, 2],
  'healShield.frac': [0, 1], 'healShield.cap': [0, 1000], 'cdOnCast.s': [0, 10],
  'afterDodge.mult': [0.1, 3], 'afterDodge.s': [0, 10], 'staggerMult.mult': [0.1, 3],
  'lowHpShield.frac': [0, 1], 'lowHpShield.below': [0, 1], 'lowHpShield.everyS': [1, 3600],
  'auraTaken.mult': [0.1, 2], 'auraTaken.r': [0, 50], 'lastStand.everyS': [1, 3600], 'lastStand.iframesS': [0, 10],
  'shieldOn.amount': [0, 1000], 'shieldOn.s': [0, 60],
});
const inRange = (kind: string, key: string, v: number) => {
  const r = RANGES[`${kind}.${key}`];
  if (!r || v < r[0] || v > r[1]) return false;
  return !(kind === 'dodge' && key === 'charges' && !Number.isInteger(v));
};

const own = (o: object, k: unknown): k is string => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

function fieldOk(f: Field, v: unknown): boolean {
  switch (f) {
    case 'ability': return own(ABILITIES, v);
    case 'abilityOrAll': return v === 'all' || own(ABILITIES, v);
    case 'num': return typeof v === 'number' && Number.isFinite(v);
    case 'event': return (MOMENTUM_EVENTS as readonly unknown[]).includes(v);
    case 'perfectDodge': return v === 'perfectDodge';
    case 'quick': return v === 'quick';
    case 'taunt': return v === 'taunt';
    case 'true': return v === true;
  }
}

/** One mod from `v`, or null: a known kind with exactly its fields, known ids and finite numbers. */
export function parseMod(v: unknown): Mod | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!own(SHAPES, o.k)) return null;
  const shape = SHAPES[o.k as ModKind];
  const out: Record<string, unknown> = { k: o.k };
  for (const key of Object.keys(o)) {
    if (key === 'k') continue;
    const f = shape.req[key] ?? shape.opt?.[key];
    if (!f || !fieldOk(f, o[key])) return null;
    if (f === 'num' && !inRange(o.k as string, key, o[key] as number)) return null;
    out[key] = o[key];
  }
  for (const key of Object.keys(shape.req)) if (!(key in out)) return null;
  if (shape.oneOf && Object.keys(out).length < 2) return null;
  return out as Mod;
}

/**
 * Strict: the readable mods of `v` (an array), as fresh objects; unknown kinds, bad ids, extra fields,
 * non-finite numbers and numbers outside their field's range are dropped. At most MAX_MODS entries are read.
 */
export function parseMods(v: unknown): Mod[] {
  if (!Array.isArray(v)) return [];
  const out: Mod[] = [];
  for (const m of v.slice(0, MAX_MODS)) {
    const p = parseMod(m);
    if (p) out.push(p);
  }
  return out;
}
