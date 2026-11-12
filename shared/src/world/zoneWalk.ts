// Walkability for a generated zone: a height function inside rectangular bounds, plus obstacles.
// The same meanings as Walk's (layout.ts): groundAt is null on any obstacle, surfaceAt stands on platform tops.
// Exactly-rounded arithmetic only (see recipe.ts), so every engine agrees.
import type { Obstacle } from './layout';

// Grid cell size for bucketing obstacles, in m.
const CELL = 4;

export class ZoneWalk {
  private readonly grid: Obstacle[][] = [];
  private readonly ni: number;
  private readonly nj: number;
  constructor(
    readonly bounds: { x0: number; x1: number; z0: number; z1: number },
    private readonly height: (x: number, z: number) => number,
    obstacles: readonly Obstacle[],
  ) {
    this.ni = Math.max(1, Math.ceil((bounds.x1 - bounds.x0) / CELL));
    this.nj = Math.max(1, Math.ceil((bounds.z1 - bounds.z0) / CELL));
    for (let k = 0; k < this.ni * this.nj; k++) this.grid.push([]);
    for (const o of obstacles) {
      // a rect's half-diagonal bounds it in any yaw; hw + hd >= that, and needs no square root
      const ext = o.kind === 'c' ? o.r : o.hw + o.hd;
      const i0 = this.ci(o.x - ext), i1 = this.ci(o.x + ext), j0 = this.cj(o.z - ext), j1 = this.cj(o.z + ext);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) this.grid[j * this.ni + i].push(o);
    }
  }
  private ci(x: number) { return Math.min(this.ni - 1, Math.max(0, Math.floor((x - this.bounds.x0) / CELL))); }
  private cj(z: number) { return Math.min(this.nj - 1, Math.max(0, Math.floor((z - this.bounds.z0) / CELL))); }

  // What covers (x, z) (inside the bounds): -Infinity for nothing, Infinity for a wall, else the highest platform top.
  private cover(x: number, z: number): number {
    let top = -Infinity;
    for (const o of this.grid[this.cj(z) * this.ni + this.ci(x)]) {
      const dx = x - o.x, dz = z - o.z;
      let inside: boolean;
      if (o.kind === 'c') inside = dx * dx + dz * dz < o.r * o.r;
      else {
        const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
        inside = Math.abs(lx) < o.hw && Math.abs(lz) < o.hd;
      }
      if (!inside) continue;
      if (o.top === undefined) return Infinity;
      if (o.top > top) top = o.top;
    }
    return top;
  }

  // Terrain height where an adventurer can stand, or null (out of bounds, or any obstacle, platforms included).
  groundAt(x: number, z: number): number | null { return this.ground(x, z, false); }
  // Height of what an adventurer would stand on: the higher of the terrain and a platform top, or null (out of bounds or a wall).
  surfaceAt(x: number, z: number): number | null { return this.ground(x, z, true); }

  private ground(x: number, z: number, platforms: boolean): number | null {
    const b = this.bounds;
    if (!(x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1)) return null; // NaN is out of bounds too
    const top = this.cover(x, z);
    if (top === -Infinity) return this.height(x, z);
    if (!platforms || top === Infinity) return null;
    return Math.max(this.height(x, z), top);
  }
}
