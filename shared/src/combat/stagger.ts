// The stagger bar of elites (and later bosses): it fills, breaks (a stun), and decays when left alone.
import { BREAK_STUN_S, STAGGER_DECAY_DELAY_S, STAGGER_DECAY_PER_S } from './constants';

/** max 0 = no bar. */
export interface StaggerBar { value: number; max: number; brokenUntil: number; lastGainAt: number }

export function isBroken(bar: StaggerBar, nowS: number): boolean {
  return nowS < bar.brokenUntil;
}

/** After a break ends, the bar gains nothing for this long (the client shows it greyed). */
export const STAGGER_IMMUNE_S = 6;
/** Seconds until the bar can gain stagger again: the rest of a break plus STAGGER_IMMUNE_S after it; 0 = it can. */
export function staggerImmuneLeft(bar: StaggerBar, nowS: number): number {
  return Math.max(0, bar.brokenUntil + STAGGER_IMMUNE_S - nowS);
}

/**
 * Adds stagger. Returns true when it breaks the bar: value back to 0 and brokenUntil = nowS +
 * BREAK_STUN_S. Nothing is gained while broken or for STAGGER_IMMUNE_S after, by a bar with max 0, or
 * for amount <= 0.
 */
export function addStagger(bar: StaggerBar, amount: number, nowS: number): boolean {
  if (!(bar.max > 0) || !(amount > 0) || staggerImmuneLeft(bar, nowS) > 0) return false;
  bar.value += amount;
  bar.lastGainAt = nowS;
  if (bar.value < bar.max) return false;
  bar.value = 0;
  bar.brokenUntil = nowS + BREAK_STUN_S;
  return true;
}

/** A tick of `dt` ending at nowS: decays STAGGER_DECAY_PER_S for the part past STAGGER_DECAY_DELAY_S without gain. */
export function tickStagger(bar: StaggerBar, nowS: number, dt: number): void {
  if (!(bar.max > 0) || bar.value <= 0 || isBroken(bar, nowS)) return;
  const decaying = Math.min(Math.max(0, dt), nowS - bar.lastGainAt - STAGGER_DECAY_DELAY_S);
  if (decaying > 0) bar.value = Math.max(0, bar.value - STAGGER_DECAY_PER_S * decaying);
}
