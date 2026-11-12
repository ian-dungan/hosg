// A kit's mods, indexed once (setKit, addAdventurer) so a tick never scans a mod list, and the small
// helpers that read the index where an ability is used. Stacking (Numbers → Mods, and ruling P5-a for the
// kinds the Numbers leave open): mults of one kind and ability multiply, adds sum; momentumOn entries of
// one event sum (smallest everyS); healShield fracs sum within each of its two kinds (normal, overheal
// only), the largest cap wins; dodge charges sum (at most +1), refill mults multiply; staggerMult
// multiplies; given, auraTaken, cdOnCast, afterDodge, shieldOn, lowHpShield and lastStand: the larger applies
// (lastStand and lowHpShield with the shortest everyS); resetOn is idempotent. Every combined value is
// clamped to MOD_LIMITS.
import { ABILITIES, type AbilityData, type AbilityId } from './abilities';
import { CAST_FLOOR_S, CD_FLOOR_S, FINISHER_COST_FLOOR, MOD_LIMITS, SPECIAL_CAP } from './constants';
import type { Mod, MomentumEvent } from '../mods';
import type { Stats } from './stats';

export interface HealShieldMod { frac: number; cap: number; overhealOnly: boolean }
/**
 * Every mod of a kit, combined per kind (and per ability or event) and clamped. `healShield` is the normal
 * kind and `overhealShield` the overheal-only one (a deviation from a single entry: both apply, ruling P5-a).
 * `empty`: no mod at all (an adventurer without a kit).
 */
export interface ModIndex {
  coef: Map<AbilityId, number>; amount: Map<AbilityId, number>; cd: Map<AbilityId, number>; cast: Map<AbilityId | 'all', number>;
  /** × on every ability heal and shield amount given (ruling P5-b; two sources: the larger, ruling P5-a). */
  given: number;
  buffS: Map<AbilityId, number>; hpCost: Map<AbilityId, number>; stagger: Map<AbilityId, number>; finisherCost: number;
  momentumOn: Map<MomentumEvent, { amount: number; everyS: number }>; dodgeCharges: number; dodgeRefillMult: number;
  healShield: HealShieldMod | null; overhealShield: HealShieldMod | null;
  cdOnCast: number; afterDodge: { mult: number; s: number } | null;
  staggerMult: number; lowHpShield: { frac: number; below: number; everyS: number } | null; aura: { mult: number; r: number } | null;
  lastStand: { everyS: number; iframesS: number } | null; resetQuickOnPerfect: boolean; shieldOnTaunt: { amount: number; s: number } | null;
  empty: boolean;
}

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

/** The index of no mods (frozen maps would still be Maps: callers never write to an index). */
export function emptyModIndex(): ModIndex {
  return {
    coef: new Map(), amount: new Map(), cd: new Map(), cast: new Map(), given: 1, buffS: new Map(), hpCost: new Map(), stagger: new Map(),
    finisherCost: 0, momentumOn: new Map(), dodgeCharges: 0, dodgeRefillMult: 1, healShield: null, overhealShield: null,
    cdOnCast: 0, afterDodge: null, staggerMult: 1, lowHpShield: null, aura: null, lastStand: null, resetQuickOnPerfect: false,
    shieldOnTaunt: null, empty: true,
  };
}
/** One shared empty index for adventurers without a kit. */
export const NO_MODS: ModIndex = emptyModIndex();

const mulInto = <K>(m: Map<K, number>, k: K, v: number) => m.set(k, (m.get(k) ?? 1) * v);
const addInto = <K>(m: Map<K, number>, k: K, v: number) => m.set(k, (m.get(k) ?? 0) + v);

/** Combines `mods` (already parsed: known kinds, ids and ranges) into a ModIndex, every value clamped. */
export function indexMods(mods: readonly Mod[]): ModIndex {
  const x = emptyModIndex();
  if (!mods.length) return x;
  x.empty = false;
  let charges = 0;
  const heal = { frac: 0, cap: 0, n: 0 }, over = { frac: 0, cap: 0, n: 0 };
  for (const m of mods) {
    switch (m.k) {
      case 'coef': mulInto(x.coef, m.ability, m.mult); break;
      case 'amount': mulInto(x.amount, m.ability, m.mult); break;
      case 'cd': addInto(x.cd, m.ability, m.add); break;
      case 'cast': mulInto(x.cast, m.ability, m.mult); break;
      case 'buffS': addInto(x.buffS, m.ability, m.add); break;
      case 'given': x.given = Math.max(x.given, m.mult); break;
      case 'hpCost': mulInto(x.hpCost, m.ability, m.mult); break;
      case 'stagger': addInto(x.stagger, m.ability, m.add); break;
      case 'finisherCost': x.finisherCost += m.add; break;
      case 'momentumOn': {
        const cur = x.momentumOn.get(m.on);
        const every = m.everyS ?? 0;
        x.momentumOn.set(m.on, cur ? { amount: cur.amount + m.amount, everyS: Math.min(cur.everyS, every) } : { amount: m.amount, everyS: every });
        break;
      }
      case 'dodge':
        if (m.charges !== undefined) charges += m.charges;
        if (m.refillMult !== undefined) x.dodgeRefillMult *= m.refillMult;
        break;
      case 'healShield': {
        const h = m.overhealOnly ? over : heal;
        h.frac += m.frac; h.cap = Math.max(h.cap, m.cap); h.n++;
        break;
      }
      case 'cdOnCast': x.cdOnCast = Math.max(x.cdOnCast, m.s); break;
      case 'afterDodge': if (!x.afterDodge || m.mult > x.afterDodge.mult) x.afterDodge = { mult: m.mult, s: m.s }; break;
      case 'staggerMult': x.staggerMult *= m.mult; break;
      case 'lowHpShield': {
        const c = x.lowHpShield;
        x.lowHpShield = c ? { frac: Math.max(c.frac, m.frac), below: Math.max(c.below, m.below), everyS: Math.min(c.everyS, m.everyS) } : { frac: m.frac, below: m.below, everyS: m.everyS };
        break;
      }
      case 'auraTaken': if (!x.aura || m.mult < x.aura.mult) x.aura = { mult: m.mult, r: m.r }; break;
      case 'lastStand': {
        const c = x.lastStand;
        x.lastStand = c ? { everyS: Math.min(c.everyS, m.everyS), iframesS: Math.max(c.iframesS, m.iframesS) } : { everyS: m.everyS, iframesS: m.iframesS };
        break;
      }
      case 'resetOn': x.resetQuickOnPerfect = true; break;
      case 'shieldOn': if (!x.shieldOnTaunt || m.amount > x.shieldOnTaunt.amount) x.shieldOnTaunt = { amount: m.amount, s: m.s }; break;
    }
  }
  // the clamps
  for (const k of [x.coef, x.amount]) for (const [id, v] of k) k.set(id, clamp(v, MOD_LIMITS.mult));
  for (const [id, v] of x.cast) x.cast.set(id, Math.max(0, v));
  for (const [id, v] of x.hpCost) x.hpCost.set(id, clamp(v, MOD_LIMITS.hpCost));
  for (const [id, v] of x.stagger) x.stagger.set(id, clamp(v, MOD_LIMITS.staggerAdd));
  for (const [ev, v] of x.momentumOn) {
    const min = ev === 'hitTaken' ? MOD_LIMITS.hitTakenMinEveryS : ev === 'behind' ? MOD_LIMITS.behindMinEveryS : 0;
    x.momentumOn.set(ev, { amount: clamp(v.amount, MOD_LIMITS.momentumOn), everyS: Math.max(min, clamp(v.everyS, MOD_LIMITS.momentumOnEveryS)) });
  }
  x.dodgeCharges = Math.min(1, Math.max(0, Math.floor(charges)));
  x.dodgeRefillMult = clamp(x.dodgeRefillMult, MOD_LIMITS.refillMult);
  const hs = (h: typeof heal, overhealOnly: boolean): HealShieldMod | null =>
    h.n ? { frac: clamp(h.frac, MOD_LIMITS.healShieldFrac), cap: clamp(h.cap, MOD_LIMITS.healShieldCap), overhealOnly } : null;
  x.healShield = hs(heal, false); x.overhealShield = hs(over, true);
  x.cdOnCast = clamp(x.cdOnCast, MOD_LIMITS.cdOnCast);
  x.given = clamp(x.given, MOD_LIMITS.given);
  if (x.afterDodge) x.afterDodge = { mult: clamp(x.afterDodge.mult, MOD_LIMITS.afterDodgeMult), s: clamp(x.afterDodge.s, MOD_LIMITS.afterDodgeS) };
  x.staggerMult = clamp(x.staggerMult, MOD_LIMITS.staggerMult);
  if (x.lowHpShield) {
    const l = x.lowHpShield;
    x.lowHpShield = { frac: clamp(l.frac, MOD_LIMITS.lowHpFrac), below: clamp(l.below, MOD_LIMITS.lowHpBelow), everyS: clamp(l.everyS, MOD_LIMITS.lowHpEveryS) };
  }
  if (x.aura) x.aura = { mult: clamp(x.aura.mult, MOD_LIMITS.auraMult), r: clamp(x.aura.r, MOD_LIMITS.auraR) };
  if (x.lastStand) x.lastStand = { everyS: clamp(x.lastStand.everyS, MOD_LIMITS.lastStandEveryS), iframesS: clamp(x.lastStand.iframesS, MOD_LIMITS.lastStandIframesS) };
  if (x.shieldOnTaunt) x.shieldOnTaunt = { amount: clamp(x.shieldOnTaunt.amount, MOD_LIMITS.shieldOnAmount), s: clamp(x.shieldOnTaunt.s, MOD_LIMITS.shieldOnS) };
  return x;
}

/** Focus, Flow and Guard as used: finite, 0 to SPECIAL_CAP (absent = 0). */
export function special(stats: Stats, k: 'focus' | 'flow' | 'guard'): number {
  const v = stats[k];
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(SPECIAL_CAP, Math.max(0, v)) : 0;
}

/** What the use-time helpers read: the adventurer's stats and its index. */
export interface Kitted { stats: Stats; modIndex: ModIndex }

/** × on an ability's heal and shield amounts: Focus × its amount mods × `given` (those two clamped together). */
export function amountMultOf(a: Kitted, id: AbilityId): number {
  const f = special(a.stats, 'focus');
  const m = a.modIndex.amount.get(id);
  const mods = m === undefined && a.modIndex.given === 1 ? 1 : clamp((m ?? 1) * a.modIndex.given, MOD_LIMITS.mult);
  return (f > 0 ? 1 + f / 100 : 1) * mods;
}
/** × on an ability's damage coefs: Focus × its coef mods (× afterDodge's `extra`, clamped with them). */
export function coefMultOf(a: Kitted, id: AbilityId, extra = 1): number {
  const f = special(a.stats, 'focus');
  const m = a.modIndex.coef.get(id);
  const mods = m === undefined && extra === 1 ? 1 : clamp((m ?? 1) * extra, MOD_LIMITS.mult);
  return (f > 0 ? 1 + f / 100 : 1) * mods;
}
/** The cooldown an ability starts: max(CD_FLOOR_S, cooldown + add) under a cd mod, else its own. */
export function effectiveCooldown(a: Kitted, ab: AbilityData): number {
  const add = a.modIndex.cd.get(ab.id);
  return add === undefined || add === 0 ? ab.cooldown : Math.max(CD_FLOOR_S, ab.cooldown + add);
}
/** A spell's cast time: max(CAST_FLOOR_S, cast × its and 'all' mults); an instant stays undefined. */
export function effectiveCast(a: Kitted, ab: AbilityData): number | undefined {
  if (!ab.cast) return ab.cast;
  const m = (a.modIndex.cast.get(ab.id) ?? 1) * (a.modIndex.cast.get('all') ?? 1);
  return m === 1 ? ab.cast : Math.max(CAST_FLOOR_S, ab.cast * m);
}
/** A buff, debuff, shield or sprint duration `s` of ability `id` under its buffS mods: 0 to buffSMaxMult × s. */
export function effectiveDuration(a: Kitted, id: AbilityId, s: number): number {
  const add = a.modIndex.buffS.get(id);
  return add === undefined || add === 0 ? s : Math.min(s * MOD_LIMITS.buffSMaxMult, Math.max(0, s + add));
}
/** An hp cost under hpCost mods: round(amount × mult) (0 allowed). */
export function effectiveHpCost(a: Kitted, id: AbilityId, amount: number): number {
  const m = a.modIndex.hpCost.get(id);
  return m === undefined ? amount : Math.round(amount * m);
}
/** The ability's own stagger plus its stagger mods (never below 0); undefined stays undefined without a mod. */
export function effectiveStagger(a: Kitted, id: AbilityId, base: number | undefined): number | undefined {
  const add = a.modIndex.stagger.get(id);
  return add === undefined || add === 0 ? base : Math.max(0, (base ?? 0) + add);
}
/** × on all stagger the adventurer adds. */
export function staggerMultOf(a: { modIndex: ModIndex }): number {
  return a.modIndex.staggerMult;
}

/**
 * The Momentum cost of `ab` for `a`: a finisher's max(FINISHER_COST_FLOOR, cost + finisherCost); any other
 * its own. `a` is the engine's state or a SelfView (whose `finisherCost`, when present, is the effective cost).
 */
export function effectiveCost(a: { modIndex: ModIndex } | { finisherCost?: number }, ab: AbilityData): number | undefined {
  if (ab.cost === undefined || ab.role !== 'finisher') return ab.cost;
  if ('modIndex' in a) {
    const add = a.modIndex.finisherCost;
    return add === 0 ? ab.cost : Math.max(FINISHER_COST_FLOOR, ab.cost + add);
  }
  return a.finisherCost ?? ab.cost;
}

/** Whether the ability does damage (a damage effect or a charge): afterDodge rides on it. */
const DAMAGES = new Map<AbilityId, boolean>();
export function dealsDamage(id: AbilityId): boolean {
  let v = DAMAGES.get(id);
  if (v === undefined) { v = ABILITIES[id].effects.some((e) => e.k === 'damage' || e.k === 'charge'); DAMAGES.set(id, v); }
  return v;
}
const TAUNTS = new Map<AbilityId, boolean>();
export function hasTaunt(id: AbilityId): boolean {
  let v = TAUNTS.get(id);
  if (v === undefined) { v = ABILITIES[id].effects.some((e) => e.k === 'taunt'); TAUNTS.set(id, v); }
  return v;
}
