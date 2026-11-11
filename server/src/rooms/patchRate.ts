// Measures how many state patches a room actually sends per second, over a sliding window.

const WINDOW_MS = 5000;

export class PatchRateMeter {
  /** Times (ms) of the patches inside the window, oldest first. */
  private times: number[] = [];

  /** @param startedAt when measuring began (ms), so a young room is not under-reported. */
  constructor(private readonly startedAt: number) {}

  record(now: number) {
    this.times.push(now);
    this.forget(now);
  }

  /** Patches per second over the last 5 s (or since the start, if that is less). */
  rate(now: number): number {
    this.forget(now);
    const span = Math.min(WINDOW_MS, now - this.startedAt);
    return span > 0 ? (this.times.length * 1000) / span : 0;
  }

  private forget(now: number) {
    let old = 0;
    while (old < this.times.length && this.times[old] <= now - WINDOW_MS) old++;
    if (old > 0) this.times.splice(0, old);
  }
}
