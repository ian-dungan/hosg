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
    // a patch that left this pose unchanged adds nothing (a later move after a pause starts from it: see below)
    if (last && last.x === x && last.z === z && last.y === y && last.facing === facing) return;
    // After a long pause, start the next stretch from where they stood one update ago, rather than
    // sliding slowly across the whole pause.
    if (last && tMs - last.t > STILL_GAP_MS) this.entries.push({ ...last, t: tMs - 1000 / TICK_HZ });
    this.entries.push({ t: tMs, x, z, y, facing });
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
  }

  /** The pose to draw at `tMs`: INTERP_DELAY_MS in the past, or the nearest end of the buffer; null while empty. */
  sample(tMs: number): DrawnPose | null {
    const out = { x: 0, z: 0, y: 0, facing: 0 };
    return this.sampleInto(tMs, out) ? out : null;
  }

  /** As sample, into `out` (no allocation); false while empty. */
  sampleInto(tMs: number, out: DrawnPose): boolean {
    const list = this.entries;
    if (list.length === 0) return false;
    const t = tMs - INTERP_DELAY_MS;
    const first = list[0], last = list[list.length - 1];
    const set = (e: Entry) => { out.x = e.x; out.z = e.z; out.y = e.y; out.facing = e.facing; return true; };
    if (t <= first.t) return set(first);
    if (t >= last.t) return set(last);
    let i = list.length - 1;
    while (list[i - 1].t > t) i--;
    const a = list[i - 1], b = list[i];
    const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
    // Updates older than the one just before t are no longer needed.
    if (i > 1) list.splice(0, i - 1);
    out.x = a.x + (b.x - a.x) * k;
    out.z = a.z + (b.z - a.z) * k;
    out.y = a.y + (b.y - a.y) * k;
    out.facing = wrapAngle(a.facing + wrapAngle(b.facing - a.facing) * k);
    return true;
  }

  /** The latest pose pushed (null while empty). */
  latest(): DrawnPose | null {
    const e = this.entries[this.entries.length - 1];
    return e ? { x: e.x, z: e.z, y: e.y, facing: e.facing } : null;
  }

  /** Forgets every pose: the next one pushed is drawn at once (a respawn or a long jump, not a slide). */
  clear(): void { this.entries.length = 0; }
}
