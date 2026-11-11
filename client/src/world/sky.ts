// Sky dome, the sea of clouds and the distant vista (islands, waterfalls, wind-ships).
import { Builder, hex, mix, norm, type RGB, type V3 } from './mesh';
import { PAL } from './parts';
import { PALETTE } from '../core/contracts';

export const HAZE = '#f2d9c2';
export const SUN_DIR: V3 = norm([-0.62, 0.52, -0.58]); // toward the sun

export function buildSkyDome(b: Builder, radius: number) {
  const zen = hex(PALETTE.skyDeep), mid = hex(PALETTE.sky), hor = hex(PALETTE.horizon), horCool = hex('#cfe0f5'), below = hex('#fbe6d6');
  const col = (d: V3): RGB => {
    const sa = Math.max(0, (d[0] * SUN_DIR[0] + d[2] * SUN_DIR[2]) / (Math.hypot(d[0], d[2]) * Math.hypot(SUN_DIR[0], SUN_DIR[2]) + 1e-6));
    const h = d[1];
    const haze = hex(HAZE);
    const glowH = mix(haze, hex('#ffbf8a'), Math.pow(sa, 2) * 0.8);
    if (h < 0.02) return mix(haze, glowH, Math.max(0, h) / 0.02);
    const horizon = mix(glowH, mix(horCool, hor, 0.35), Math.min(1, (h - 0.02) / 0.12));
    let c = mix(horizon, mid, Math.min(1, Math.max(0, h - 0.06) / 0.3));
    c = mix(c, zen, Math.max(0, Math.min(1, (h - 0.2) / 0.55)));
    return c;
  };
  const NA = 40, NE = 16;
  const P = (i: number, j: number): V3 => {
    const a = i / NA * Math.PI * 2; const e = -0.35 + j / NE * (Math.PI / 2 + 0.35);
    return [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
  };
  b.cj = 0;
  b.withHint([0, 0, 0], () => {
    for (let i = 0; i < NA; i++) for (let j = 0; j < NE; j++) {
      const p = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
      const s = (v: V3): V3 => [v[0] * radius, v[1] * radius, v[2] * radius];
      // smooth per-vertex gradient
      b.triW(s(p[0]), s(p[1]), s(p[2]), col(p[0]), col(p[1]), col(p[2]), [0, 0, 0]);
      b.triW(s(p[0]), s(p[2]), s(p[3]), col(p[0]), col(p[2]), col(p[3]), [0, 0, 0]);
    }
  });
}

/** Soft fair-weather clouds high in the sky (kept out of the patch where Ellie points). */
export function buildSkyClouds(base: Builder, extra: Builder, avoidAngle: number) {
  for (const [b, n, seed] of [[base, 26, 1], [extra, 30, 2]] as [Builder, number, number][]) {
    let made = 0;
    for (let i = 0; i < 400 && made < n; i++) {
      const a = b.rng.r(0, 6.283);
      const da = Math.abs(Math.atan2(Math.sin(a - avoidAngle), Math.cos(a - avoidAngle)));
      if (da < 0.22) continue;
      const d = b.rng.r(380, 1700), y = b.rng.r(170, 430) * (0.6 + d / 2500);
      const c: V3 = [Math.cos(a) * d, y, Math.sin(a) * d];
      const sz = b.rng.r(28, 60) * (0.7 + d / 1800);
      const puffs = 3 + Math.floor(b.rng.next() * 4);
      for (let q = 0; q < puffs; q++) b.ball([c[0] + b.rng.r(-1.4, 1.4) * sz, c[1] + b.rng.r(0, 0.35) * sz, c[2] + b.rng.r(-0.6, 0.6) * sz], sz * b.rng.r(0.5, 0.9), PAL.cloud, 1, 0.55, 1, d > 800 ? 0 : 1, 0.25, hex('#efe3ee'));
      made++; void seed;
    }
  }
}
