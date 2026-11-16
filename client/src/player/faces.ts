// The Brindlekin's fur patterns (painted per vertex), padded paws and tail (on its own two spring bones), shared by
// Look v2's body (body2.ts) and face (face2.ts). The tail is authored in the old canonical human space; character.ts
// fits it to the body with look.ts makeAttachWarp.
import { Color3 } from '@babylonjs/core';
import type { Paint, ShapeKit } from './character';

const mix = (a: Color3, b: Color3, t: number) => Color3.Lerp(a, b, t);
const shade = (c: Color3, f: number) => new Color3(Math.min(1, c.r * f), Math.min(1, c.g * f), Math.min(1, c.b * f));
const INK = new Color3(0.07, 0.06, 0.09);
const WHITE = new Color3(0.98, 0.97, 0.94);

/** Brindlekin fur: the pattern (FUR_PATTERNS: solid, striped, spotted, masked) painted per vertex by position. */
export function furPaint(base: Color3, fur2: Color3, pattern: number): Paint {
  return (w) => {
    if (pattern === 1) {
      const v = Math.sin(w.y * 36 + Math.sin(w.x * 11 + w.z * 7) * 1.6);
      return v > 0.5 ? mix(base, fur2, 0.9) : base;
    }
    if (pattern === 2) {
      const cx = Math.floor(w.x * 16), cy = Math.floor(w.y * 16), cz = Math.floor(w.z * 16);
      const h = Math.sin(cx * 12.9898 + cy * 78.233 + cz * 37.719) * 43758.5453;
      return h - Math.floor(h) < 0.24 ? mix(base, fur2, 0.92) : base;
    }
    return base;
  };
}

/** TAILS: short, brush, long, ringed; on the tailA and tailB bones (spring-driven), from the small of the back. */
export function buildTail(k: ShapeKit, tail: number, base: Color3, fur2: Color3, pattern: number): void {
  const body = furPaint(base, fur2, pattern);
  if (tail === 0) {
    // a bobtail peeking out under the cape's hem
    k.ellip('tailA', [0, 0.68, -0.36], [0.075, 0.075, 0.08], base, { seg: 8, lat: 5, paint: body });
    return;
  }
  const ring: Paint = (_w, uv) => (Math.floor(uv[1] * 9) % 2 ? fur2 : base);
  const tipLight: Paint = (w, uv, l) => (uv[1] > 0.8 ? mix(fur2, WHITE, 0.45) : body(w, uv, l));
  // from the small of the back, down past the cape's hem, then curling up beside the right leg (it shows from the front too)
  const rA = tail === 2 ? [0.035, 0.03, 0.028] : tail === 1 ? [0.045, 0.065, 0.08] : [0.045, 0.05, 0.052];
  k.tube('tailA', [[0, 0.9, -0.13], [0.03, 0.74, -0.33], [0.1, 0.58, -0.44]], rA, base, { seg: 7, paint: tail === 3 ? ring : body });
  if (tail === 1) k.tube('tailB', [[0.1, 0.58, -0.44], [0.2, 0.58, -0.56], [0.3, 0.75, -0.6], [0.34, 0.95, -0.52], [0.33, 1.06, -0.45]], [0.08, 0.1, 0.1, 0.075, 0.012], base, { seg: 8, paint: tipLight });
  else if (tail === 2) k.tube('tailB', [[0.1, 0.58, -0.44], [0.18, 0.48, -0.62], [0.32, 0.6, -0.76], [0.42, 0.84, -0.72], [0.44, 0.98, -0.62]], [0.028, 0.026, 0.024, 0.02, 0.008], base, { seg: 6, paint: body });
  else k.tube('tailB', [[0.1, 0.58, -0.44], [0.2, 0.56, -0.58], [0.3, 0.72, -0.66], [0.34, 0.92, -0.6], [0.33, 1.02, -0.52]], [0.052, 0.058, 0.055, 0.045, 0.02], base, { seg: 7, paint: ring });
}

/** Padded hands for the Brindlekin: the palm side in the darker pad colour. */
export function pawPaint(base: Color3, fur2: Color3, pattern: number, side: number): Paint {
  const body = furPaint(base, fur2, pattern), pad = shade(mix(fur2, INK, 0.5), 0.9);
  return (w, uv, l) => (l.x * side < -0.35 || l.y < -0.6 ? pad : body(w, uv, l));
}
