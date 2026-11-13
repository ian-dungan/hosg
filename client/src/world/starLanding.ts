// The falling star's landing on the east horizon, as numbers over time (pure; storySky.ts draws it, scenes.ts shakes the
// camera with `rumble`): a white impact, the warm flash with a pillar of light rising out of it, a rumble a beat later
// (sound is slower than light), and an afterglow that lingers on the horizon long after the camera has gone home.
/** The impact's white core (s). */
export const IMPACT_S = 0.45;
/** The warm flash and the warm band along the horizon (s). */
export const FLASH_S = 2.4;
/** The pillar of light (s). */
export const PILLAR_S = 3;
/** The rumble starts this long after the impact and lasts RUMBLE_S (s). */
export const RUMBLE_DELAY_S = 0.35;
export const RUMBLE_S = 1.4;
/** The afterglow (s): the whole landing is over then. */
export const AFTERGLOW_S = 9;
export const LANDING_S = AFTERGLOW_S;

export interface LandingLight { impact: number; flash: number; pillar: number; rumble: number; afterglow: number }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Every part's strength 0..1 at `t` s after the star came down. */
export function landingAt(t: number): LandingLight {
  if (!(t >= 0)) return { impact: 0, flash: 0, pillar: 0, rumble: 0, afterglow: 0 };
  const impact = t < IMPACT_S ? clamp01(Math.min(1, t / 0.04) * (1 - t / IMPACT_S) ** 2) : 0;
  const f = t / FLASH_S;
  const flash = f < 1 ? clamp01(Math.min(1, t / 0.18) * (1 - f) ** 1.5) : 0;
  const p = t / PILLAR_S;
  const pillar = p < 1 ? clamp01(Math.min(1, t / 0.4) * (1 - p) ** 1.2) : 0;
  const r = (t - RUMBLE_DELAY_S) / RUMBLE_S;
  const rumble = r >= 0 && r < 1 ? clamp01(Math.min(1, r * 8) * (1 - r) ** 2) : 0;
  const g = t / AFTERGLOW_S;
  const afterglow = g < 1 ? clamp01(0.6 * Math.min(1, t / 1.2) * (1 - g) ** 0.8) : 0;
  return { impact, flash, pillar, rumble, afterglow };
}
