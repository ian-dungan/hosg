// The Momentum bar: built by attacks, spent by finishers, decaying when no damage is dealt.
import { MOMENTUM_DECAY_DELAY_S, MOMENTUM_DECAY_PER_S, MOMENTUM_MAX } from './constants';

/** m + amount, clamped to 0..MOMENTUM_MAX. A non-finite m counts as 0 and a non-finite amount adds nothing. */
export function gainMomentum(m: number, amount: number): number {
  const base = Number.isFinite(m) ? m : 0;
  return Math.min(MOMENTUM_MAX, Math.max(0, base + (Number.isFinite(amount) ? amount : 0)));
}

/**
 * Momentum after a tick of `dt` seconds that ends `sinceDamageS` seconds after the last damage dealt:
 * it loses MOMENTUM_DECAY_PER_S for the part of the tick past MOMENTUM_DECAY_DELAY_S, never below 0.
 * A non-finite m gives 0; a NaN time decays nothing.
 */
export function decayMomentum(m: number, sinceDamageS: number, dt: number): number {
  if (!Number.isFinite(m)) return 0;
  const decaying = Math.min(Math.max(0, dt), sinceDamageS - MOMENTUM_DECAY_DELAY_S);
  if (!(decaying > 0)) return m;
  return Math.max(0, m - MOMENTUM_DECAY_PER_S * decaying);
}
