// The Momentum bar: built by attacks, spent by finishers, decaying when no damage is dealt.
import { MOMENTUM_DECAY_DELAY_S, MOMENTUM_DECAY_PER_S, MOMENTUM_MAX } from './constants';

/** m + amount, clamped to 0..MOMENTUM_MAX. */
export function gainMomentum(m: number, amount: number): number {
  return Math.min(MOMENTUM_MAX, Math.max(0, m + amount));
}

/**
 * Momentum after a tick of `dt` seconds that ends `sinceDamageS` seconds after the last damage dealt:
 * it loses MOMENTUM_DECAY_PER_S for the part of the tick past MOMENTUM_DECAY_DELAY_S, never below 0.
 */
export function decayMomentum(m: number, sinceDamageS: number, dt: number): number {
  const decaying = Math.min(Math.max(0, dt), sinceDamageS - MOMENTUM_DECAY_DELAY_S);
  if (!(decaying > 0)) return m;
  return Math.max(0, m - MOMENTUM_DECAY_PER_S * decaying);
}
