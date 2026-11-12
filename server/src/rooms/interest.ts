// Interest management helpers: a uniform grid for "what is near this point" queries, and the
// radius rule (with hysteresis) that decides which adventurers, enemies and telegraphs each client's
// state view holds. The room keeps one Colyseus StateView per client and uses these every step.
import { INTEREST_HYSTERESIS, INTEREST_RADIUS } from '@sg2/shared';

/** Something with a ground position. */
export interface Placed {
  readonly x: number;
  readonly z: number;
}

/** Squared ground distance. */
export const dist2 = (a: Placed, b: Placed): number => (a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z);

/** Enters a view at INTEREST_RADIUS or nearer... */
export const ENTER_R2 = INTEREST_RADIUS * INTEREST_RADIUS;
/** ...and leaves it only beyond INTEREST_RADIUS + INTEREST_HYSTERESIS, so nothing flickers at the edge. */
export const LEAVE_R = INTEREST_RADIUS + INTEREST_HYSTERESIS;
export const LEAVE_R2 = LEAVE_R * LEAVE_R;

/**
 * Whether something `d2` (squared metres) away belongs in a view, given whether it is in it now:
 * it comes in at INTEREST_RADIUS and goes out beyond INTEREST_RADIUS + INTEREST_HYSTERESIS.
 */
export function interested(d2: number, inView: boolean): boolean {
  return d2 <= (inView ? LEAVE_R2 : ENTER_R2);
}

/** How far a telegraph's shape reaches from its (x, z): the radius of a circle or cone, the length (plus width) of a line. */
export function telegraphReach(t: { shape: string; r: number; width: number }): number {
  return t.shape === 'line' ? t.r + t.width : t.r;
}

/**
 * A telegraph belongs in a view when any part of it is within INTEREST_RADIUS of the viewer (so one
 * whose owner stands just outside the radius but whose attack reaches inside is seen), or when its
 * owner is in the view anyway.
 */
export function telegraphInterested(viewer: Placed, t: Placed & { shape: string; r: number; width: number }): boolean {
  const reach = INTEREST_RADIUS + telegraphReach(t);
  return dist2(viewer, t) <= reach * reach;
}

/**
 * A uniform grid of items by ground position, rebuilt each step (insert after clear). Cells are
 * LEAVE_R wide, so everything within LEAVE_R of a point is in the 3 × 3 cells around it: a query
 * costs the items in those cells, never every item in the zone.
 */
export class Grid<T extends Placed> {
  private cells = new Map<number, T[]>();
  /** Arrays of cleared cells, reused (no garbage per step). */
  private spare: T[][] = [];

  constructor(readonly cell: number = LEAVE_R) {}

  private key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  clear(): void {
    for (const list of this.cells.values()) {
      list.length = 0;
      this.spare.push(list);
    }
    this.cells.clear();
  }

  insert(item: T): void {
    const k = this.key(Math.floor(item.x / this.cell), Math.floor(item.z / this.cell));
    let list = this.cells.get(k);
    if (!list) this.cells.set(k, (list = this.spare.pop() ?? []));
    list.push(item);
  }

  /** Calls `fn` for every item in the 3 × 3 cells around (x, z): a superset of those within `cell` metres. */
  near(x: number, z: number, fn: (item: T) => void): void {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cz - 1; j <= cz + 1; j++) {
        const list = this.cells.get(this.key(i, j));
        if (list) for (const item of list) fn(item);
      }
    }
  }
}
