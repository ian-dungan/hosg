// Stats and the damage formula.
import { DEFENCE_K } from './constants';

export interface Stats { power: number; defence: number; maxHp: number }
/** Every adventurer's stats until gear arrives (Plan 5). */
export const STARTER_STATS: Stats = { power: 10, defence: 10, maxHp: 100 };

/** The share of a hit that gets through `defence`: DEFENCE_K / (DEFENCE_K + max(0, defence)). */
export function mitigation(defence: number): number {
  return DEFENCE_K / (DEFENCE_K + Math.max(0, defence));
}

/** An adventurer's hit: 0 if coef <= 0, else max(1, round(coef · power · mitigation(defence) · mult)). */
export function hitDamage(coef: number, power: number, defence: number, mult = 1): number {
  if (!(coef > 0)) return 0;
  return Math.max(1, Math.round(coef * power * mitigation(defence) * mult));
}

/** An enemy's hit of `raw` damage on an adventurer with `defence`: max(1, round(raw · mitigation · mult)). */
export function enemyHit(raw: number, defence: number, mult = 1): number {
  return Math.max(1, Math.round(raw * mitigation(defence) * mult));
}
