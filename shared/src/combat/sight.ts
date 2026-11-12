// Line of sight over the ground plane.
import { LOS_END_SKIP, LOS_STEP } from './constants';

/**
 * True if every point every LOS_STEP along a→b is clear by `sight` (true = see-through), ignoring
 * points within LOS_END_SKIP of either end (an adventurer against a wall, an enemy's own body).
 * An obstacle thinner than LOS_STEP can fall between two points.
 */
export function lineOfSight(sight: (x: number, z: number) => boolean, ax: number, az: number, bx: number, bz: number): boolean {
  const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz);
  const n = Math.ceil(length / LOS_STEP);
  for (let i = 1; i < n; i++) {
    const along = (length * i) / n;
    if (along <= LOS_END_SKIP || length - along <= LOS_END_SKIP) continue;
    if (!sight(ax + (dx * i) / n, az + (dz * i) / n)) return false;
  }
  return true;
}
