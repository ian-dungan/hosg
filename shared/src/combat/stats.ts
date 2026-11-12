// Stats and the damage formula.
import { DEFENCE_K } from './constants';

/**
 * An adventurer's stats. The specials come from armour (absent means 0, each capped at SPECIAL_CAP):
 * focus (cloth) +1% to ability damage coefficients, heal and shield amounts; flow (light) +1% to every
 * positive Momentum gain; guard (heavy) +1% to threat added and −1% to knockback speed taken.
 */
export interface Stats { power: number; defence: number; maxHp: number; focus?: number; flow?: number; guard?: number }
/** The stats of a level-10 adventurer in the starter kit (baseStats(10) plus the kit): no specials. */
export const STARTER_STATS: Stats = { power: 10, defence: 10, maxHp: 100 };

/** The share of a hit that gets through `defence`: DEFENCE_K / (DEFENCE_K + defence), with a defence not above 0 (or NaN) as none. */
export function mitigation(defence: number): number {
  return DEFENCE_K / (DEFENCE_K + (defence > 0 ? defence : 0));
}

/** A positive, finite factor. */
const real = (v: number) => v > 0 && Number.isFinite(v);

/**
 * An adventurer's hit: max(1, round(coef · power · mitigation(defence) · mult)). One rule for both
 * hit functions: a hit with any factor (coef, power, mult; raw) not above 0 or not finite is negated
 * and does 0; any real hit does at least 1, whatever the defence. Never NaN.
 */
export function hitDamage(coef: number, power: number, defence: number, mult = 1): number {
  if (!real(coef) || !real(power) || !real(mult)) return 0;
  return Math.max(1, Math.round(coef * power * mitigation(defence) * mult));
}

/** An enemy's hit of `raw` damage on an adventurer with `defence`: max(1, round(raw · mitigation · mult)); 0 if negated (see hitDamage). */
export function enemyHit(raw: number, defence: number, mult = 1): number {
  if (!real(raw) || !real(mult)) return 0;
  return Math.max(1, Math.round(raw * mitigation(defence) * mult));
}
