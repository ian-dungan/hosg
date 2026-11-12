// The stagger bar of elites (and later bosses): it fills, breaks (a stun), and decays when left alone.
import { BREAK_STUN_S, STAGGER_DECAY_DELAY_S, STAGGER_DECAY_PER_S } from './constants';

/** max 0 = no bar. */
export interface StaggerBar { value: number; max: number; brokenUntil: number; lastGainAt: number }

export function isBroken(bar: StaggerBar, nowS: number): boolean {
  return nowS < bar.brokenUntil;
}

/**
 * Adds stagger. Returns true when it breaks the bar: value back to 0 and brokenUntil = nowS +
 * BREAK_STUN_S. Nothing is gained while broken, by a bar with max 0, or for amount <= 0.
 */
export function addStagger(bar: StaggerBar, amount: number, nowS: number): boolean {
  if (!(bar.max > 0) || !(amount > 0) || isBroken(bar, nowS)) return false;
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
