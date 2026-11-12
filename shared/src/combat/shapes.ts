// Telegraph shapes on the ground. Hits are decided by ground x/z only: nothing here reads a height.
// Yaw convention as `facing`: dir 0 points +Z, positive turns toward +X, so a direction a is (sin a, cos a).

export type Shape =
  | { kind: 'circle'; x: number; z: number; r: number }
  /** angle = full width (rad). */
  | { kind: 'cone'; x: number; z: number; dir: number; r: number; angle: number }
  | { kind: 'line'; x: number; z: number; dir: number; length: number; width: number };

/** Signed angle in (-π, π]. */
function wrap(a: number): number {
  const t = 2 * Math.PI;
  let w = a % t;
  if (w <= -Math.PI) w += t;
  else if (w > Math.PI) w -= t;
  return w;
}

/** (x, z) relative to the shape's origin: `along` its dir and `aside` toward its right (dir + π/2). */
function local(s: { x: number; z: number; dir: number }, x: number, z: number) {
  const dx = x - s.x, dz = z - s.z;
  const fx = Math.sin(s.dir), fz = Math.cos(s.dir);
  return { along: dx * fx + dz * fz, aside: dx * fz - dz * fx, dx, dz };
}

const unit = (a: number) => ({ x: Math.sin(a), z: Math.cos(a) });

/** True if ground point (x, z) is inside the shape (edges included). */
export function inShape(s: Shape, x: number, z: number): boolean {
  switch (s.kind) {
    case 'circle':
      return Math.hypot(x - s.x, z - s.z) <= s.r;
    case 'cone': {
      const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz);
      if (d > s.r) return false;
      if (d === 0) return true;
      return Math.abs(wrap(Math.atan2(dx, dz) - s.dir)) <= s.angle / 2;
    }
    case 'line': {
      const p = local(s, x, z);
      return p.along >= 0 && p.along <= s.length && Math.abs(p.aside) <= s.width / 2;
    }
  }
}

/**
 * A unit vector from (x, z) toward the nearest boundary of `s`, the way out of it:
 * - circle: radially outward (+Z from the very centre);
 * - cone: perpendicular out through the nearer side edge, or radially out through the arc, whichever is nearer;
 * - line: sideways, toward the nearer long side (to the right when on the centre line).
 */
export function escapeDir(s: Shape, x: number, z: number): { x: number; z: number } {
  switch (s.kind) {
    case 'circle': {
      const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz);
      return d > 0 ? { x: dx / d, z: dz / d } : { x: 0, z: 1 };
    }
    case 'cone': {
      const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz);
      const half = s.angle / 2;
      const theta = d > 0 ? wrap(Math.atan2(dx, dz) - s.dir) : 0;
      const side = theta >= 0 ? 1 : -1;
      const toEdge = d * Math.sin(Math.max(0, half - Math.abs(theta)));
      const toArc = s.r - d;
      if (toArc < toEdge && d > 0) return { x: dx / d, z: dz / d };
      return unit(s.dir + side * (half + Math.PI / 2));
    }
    case 'line': {
      const p = local(s, x, z);
      return unit(s.dir + (p.aside >= 0 ? Math.PI / 2 : -Math.PI / 2));
    }
  }
}
