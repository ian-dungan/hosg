// Smooths another adventurer's movement between server updates: poses are drawn a little in the past,
// between the two updates around that moment.
import { TICK_HZ } from '@sg2/shared';

/** How far in the past other adventurers are drawn: two server updates, so there is nearly always one ahead. */
export const INTERP_DELAY_MS = 133;

/** A pause longer than this between updates means the adventurer stood still in between. */
const STILL_GAP_MS = 250;
/** Updates kept per adventurer (about two seconds at TICK_HZ). */
const MAX_ENTRIES = 32;

interface Entry { t: number; x: number; z: number; y: number; facing: number }

/** A pose to draw: feet position (y is the height of the feet) and facing. */
export interface DrawnPose { x: number; z: number; y: number; facing: number }

/** Wraps an angle to [-pi, pi). */
const wrapAngle = (a: number) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};

export class PoseBuffer {
  private entries: Entry[] = [];

  /** Adds a pose received at `tMs` (milliseconds, in the same clock `sample` is called with); `y` is the feet height (0 if not given). */
  push(tMs: number, x: number, z: number, facing: number, y = 0): void {
    const last = this.entries[this.entries.length - 1];
    if (last && tMs < last.t) return; // out of order: ignore
    // After a long pause, start the next stretch from where they stood one update ago, rather than
    // sliding slowly across the whole pause.
    if (last && tMs - last.t > STILL_GAP_MS) this.entries.push({ ...last, t: tMs - 1000 / TICK_HZ });
    this.entries.push({ t: tMs, x, z, y, facing });
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
  }

  /** The pose to draw at `tMs`: INTERP_DELAY_MS in the past, or the nearest end of the buffer; null while empty. */
  sample(tMs: number): DrawnPose | null {
    const list = this.entries;
    if (list.length === 0) return null;
    const t = tMs - INTERP_DELAY_MS;
    const first = list[0], last = list[list.length - 1];
    if (t <= first.t) return { x: first.x, z: first.z, y: first.y, facing: first.facing };
    if (t >= last.t) return { x: last.x, z: last.z, y: last.y, facing: last.facing };
    let i = list.length - 1;
    while (list[i - 1].t > t) i--;
    const a = list[i - 1], b = list[i];
    const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
    // Updates older than the one just before t are no longer needed.
    if (i > 1) list.splice(0, i - 1);
    return {
      x: a.x + (b.x - a.x) * k,
      z: a.z + (b.z - a.z) * k,
      y: a.y + (b.y - a.y) * k,
      facing: wrapAngle(a.facing + wrapAngle(b.facing - a.facing) * k),
    };
  }
}
