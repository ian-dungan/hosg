// Swaying grass tufts and little flowers (merged, per-vertex wind weight), split into tiers.
import { Builder, hex, mix, vnoise, type RGB, type V3 } from './mesh';

const BASE = hex('#4a8a46'), TIP = hex('#a6cf6c'), TIP2 = hex('#c4d77c'), DRY = hex('#d2c27a');
const FLOWERS: RGB[] = [hex('#ffffff'), hex('#ffd36a'), hex('#ff8fa0'), hex('#b9a4ff'), hex('#ff9a5c')];

/** Fill `b` with `count` tufts at positions accepted by `ok` (sampled with density `dens`). */
export function buildGrass(b: Builder, count: number, ground: (x: number, z: number) => number, ok: (x: number, z: number) => boolean, sample: () => [number, number]) {
  b.cj = 0.0;
  b.windFn = (p: V3) => Math.max(0, p[1] - ground(p[0], p[2])) * 0.55;
  const rng = b.rng; let made = 0;
  for (let tries = 0; tries < count * 4 && made < count; tries++) {
    const [x, z] = sample();
    if (!ok(x, z)) continue;
    const y = ground(x, z) - 0.03;
    const lush = vnoise(x * 0.08 + 4, z * 0.08 + 9);
    const tip = mix(mix(TIP, TIP2, rng.next()), DRY, Math.max(0, 0.35 - lush) * 1.2);
    const base = mix(BASE, hex('#5fae52'), rng.next() * 0.5);
    const blades = 3 + Math.floor(rng.next() * 3);
    const hgt = 0.32 + lush * 0.4 + rng.next() * 0.2;
    for (let k = 0; k < blades; k++) {
      const a = rng.r(0, 6.283), lean = rng.r(0.05, 0.28) * hgt;
      const ox = x + Math.cos(a) * 0.12 * rng.next(), oz = z + Math.sin(a) * 0.12 * rng.next();
      const w = 0.045 + rng.next() * 0.03;
      const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      const h = hgt * rng.r(0.7, 1.15);
      b.triW([ox - px, y, oz - pz], [ox + px, y, oz + pz], [ox + Math.cos(a) * lean, y + h, oz + Math.sin(a) * lean], base, base, tip, 'up');
    }
    if (rng.next() < 0.09) {
      const c = FLOWERS[Math.floor(rng.next() * FLOWERS.length)]; const fy = y + hgt * 1.05, s = 0.07;
      b.triW([x - s, fy, z], [x + s, fy, z], [x, fy + s * 0.6, z + s], c, c, c, 'up');
      b.triW([x - s, fy, z], [x, fy + s * 0.6, z - s], [x + s, fy, z], c, c, c, 'up');
    }
    made++;
  }
  b.windFn = null;
  // light blades like the ground they grow from (soft, painterly)
  for (let i = 0; i < b.nor.length; i += 3) { b.nor[i] = 0.12; b.nor[i + 1] = 0.99; b.nor[i + 2] = 0.05; }
  return made;
}
