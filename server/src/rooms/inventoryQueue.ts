// One inventory queue per session: every inventory operation, Barber visit, loot award and GM grant of an
// adventurer runs here, one at a time, against the latest stored state, and lands as one compare-and-set
// write (Store.writeInventory). Never lose, never duplicate:
// - a task computes its result from the queue's snapshot (the last state the store confirmed) and the
//   session's jobs at that moment; the snapshot changes only when a write lands;
// - a write the store finds stale (another writer bumped inv_version: a Seal, a GM grant, the creator, a
//   second tab) is never written again as computed: the queue re-reads the store and runs the task again
//   on the fresh truth (once for a client's operation, a few times for loot), then gives up with the truth;
// - a write that throws leaves the snapshot as it was (no partial state) and the next task re-reads first
//   (the write may or may not have landed);
// - while a write is in flight, later tasks wait; closing (the session ended) lets the in-flight write
//   finish (it is atomic) and drops the rest.
// The session's saves (position, hp, jobs) share its WriteLock with these writes, so a save computed before
// a talent change can never land after it.
import { INV_OPS_PER_S, type InvState, type InventorySave, type JobsSave, type Look } from '@sg2/shared';
import type { InvWrite, InvWritten } from '../store/types';

/** What the queue holds between tasks: the stored inventory, gold, Seals and look, and their version. */
export interface InvSnapshot { inv: InventorySave; gold: number; seals: number; look: Look; lookFree: boolean; version: number }

/** What a task's run gives: a write (and the state after it), nothing to write, or a refusal. */
export type TaskOutcome<T> =
  | { kind: 'write'; write: InvWrite; next: InvState & { look: Look; lookFree: boolean }; info: T }
  | { kind: 'none'; info: T }
  | { kind: 'refuse'; reason: string };

/** How a task ended. */
export type TaskResult<T> =
  | { status: 'applied'; snapshot: InvSnapshot; jobs: JobsSave; info: T }
  | { status: 'unchanged'; snapshot: InvSnapshot; info: T }
  /** reread: the snapshot was read afresh for it (the owner should hear the new truth too). */
  | { status: 'refused'; snapshot: InvSnapshot; reason: string; reread?: true }
  /** Stale every time it was tried: the snapshot is the stored truth now. */
  | { status: 'stale'; snapshot: InvSnapshot }
  /** The store threw (logged by the caller): nothing changed here; the next task re-reads first. */
  | { status: 'failed'; snapshot: InvSnapshot; error: unknown }
  /** The session ended before the task ran. */
  | { status: 'dropped' };

export interface InvTask<T> {
  /** Computes the task from the snapshot and the session's jobs now (pure: it may run again after a re-read). */
  run(s: InvSnapshot, jobs: JobsSave): TaskOutcome<T>;
  /** Re-reads and runs again after a stale write at most this many times (1 for a client's operation). */
  retries: number;
  /**
   * Refusals that depend on balances or room (gold, Seals, a full bag): checked once more on a fresh read
   * before they are given, so a change the store holds but this queue has not seen yet never refuses wrongly.
   */
  recheck?: readonly string[];
  /** Runs synchronously as the task ends, before the next task starts (the room applies the result here). */
  settle?(r: TaskResult<T>): void;
}

/** Serialises a session's store writes (inventory writes and saves). */
export class WriteLock {
  private tail: Promise<unknown> = Promise.resolve();
  /** Runs `fn` after every earlier holder has finished. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => {});
    return result;
  }
}

/** INV_OPS_PER_S as a token bucket: a burst of INV_OPS_PER_S, refilling INV_OPS_PER_S a second. */
export class TokenBucket {
  private tokens: number;
  private at: number;
  constructor(now: number, private readonly rate = INV_OPS_PER_S, private readonly burst = INV_OPS_PER_S) {
    this.tokens = burst;
    this.at = now;
  }
  /** Takes a token at wall time `now` (ms): false when the bucket is empty. */
  take(now: number): boolean {
    this.tokens = Math.min(this.burst, this.tokens + (Math.max(0, now - this.at) / 1000) * this.rate);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export interface QueueDeps {
  /** Reads the stored truth. */
  load(): Promise<InvSnapshot>;
  /** Store.writeInventory for this adventurer. */
  write(expect: number, w: InvWrite): Promise<InvWritten | null>;
  /** The session's jobs now (the session is the authority for xp, picks and the current job). */
  jobs(): JobsSave;
  /** Shared with the session's saves. */
  lock: WriteLock;
  /** Every write that landed (for /healthz's invWritesPerS). */
  onWrite?(): void;
  /** A task's settle threw (logged by the caller; the queue carries on with the next task). */
  onError?(err: unknown): void;
}

/** The most tasks waiting in one queue: more are refused at once (a client is limited to INV_OPS_PER_S anyway). */
export const QUEUE_MAX = 64;

type Pending = { task: InvTask<unknown>; resolve: (r: TaskResult<unknown>) => void };

export class InventoryQueue {
  private pending: Pending[] = [];
  private running = false;
  private closed = false;
  /** A write threw: the next task re-reads before it runs. */
  private dirty = false;
  private idleWaiters: (() => void)[] = [];

  constructor(private snap: InvSnapshot, private readonly deps: QueueDeps) {}

  /** The last state the store confirmed. */
  get snapshot(): InvSnapshot {
    return this.snap;
  }

  /** A task is running or waiting. */
  get busy(): boolean {
    return this.running || this.pending.length > 0;
  }

  /** Queues a task; resolves when it ends (also through task.settle). */
  push<T>(task: InvTask<T>): Promise<TaskResult<T>> {
    if (this.closed) {
      const r: TaskResult<T> = { status: 'dropped' };
      task.settle?.(r);
      return Promise.resolve(r);
    }
    if (this.pending.length >= QUEUE_MAX) {
      const r: TaskResult<T> = { status: 'refused', snapshot: this.snap, reason: 'rate' };
      task.settle?.(r);
      return Promise.resolve(r);
    }
    return new Promise<TaskResult<T>>((resolve) => {
      this.pending.push({ task: task as InvTask<unknown>, resolve: resolve as (r: TaskResult<unknown>) => void });
      void this.drain();
    });
  }

  /** The store changed behind the queue (a Seal, a GM write): the next task re-reads first. */
  markStale(): void {
    this.dirty = true;
  }

  /** The session ended: the running task finishes (its write is atomic); every waiting one is dropped. */
  close(): void {
    this.closed = true;
    const dropped = this.pending.splice(0);
    for (const p of dropped) this.finish(p, { status: 'dropped' });
    if (!this.running) this.wakeIdle();
  }

  /** Resolves once no task is running or waiting (a closed queue: once the running one is done). */
  idle(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private wakeIdle() {
    for (const w of this.idleWaiters.splice(0)) w();
  }

  private finish(p: Pending, r: TaskResult<unknown>) {
    try {
      p.task.settle?.(r);
    } catch (err) {
      this.deps.onError?.(err);
    }
    p.resolve(r);
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      for (let p = this.pending.shift(); p; p = this.pending.shift()) {
        let r: TaskResult<unknown>;
        try {
          r = await this.runOne(p.task);
        } catch (error) {
          r = { status: 'failed', snapshot: this.snap, error };
        }
        this.finish(p, r);
      }
    } finally {
      this.running = false;
      this.wakeIdle();
    }
  }

  private async runOne(task: InvTask<unknown>): Promise<TaskResult<unknown>> {
    if (this.dirty) {
      try {
        this.snap = await this.deps.load();
        this.dirty = false;
      } catch (error) {
        return { status: 'failed', snapshot: this.snap, error };
      }
    }
    let rechecked = false, reread = false;
    for (let attempt = 0; ; attempt++) {
      const out = task.run(this.snap, this.deps.jobs());
      if (out.kind === 'refuse' && !rechecked && task.recheck?.includes(out.reason)) {
        rechecked = true;
        try {
          const fresh = await this.deps.load();
          if (fresh.version !== this.snap.version) {
            this.snap = fresh;
            reread = true;
            attempt--;
            continue;
          }
        } catch (error) {
          return { status: 'failed', snapshot: this.snap, error };
        }
      }
      if (out.kind === 'refuse') return { status: 'refused', snapshot: this.snap, reason: out.reason, ...(reread ? { reread: true as const } : {}) };
      if (out.kind === 'none') return { status: 'unchanged', snapshot: this.snap, info: out.info };
      const expect = this.snap.version;
      let written: InvWritten | null;
      try {
        written = await this.deps.lock.run(() => this.deps.write(expect, out.write));
      } catch (error) {
        this.dirty = true; // it may have landed: read the truth before the next task
        return { status: 'failed', snapshot: this.snap, error };
      }
      if (written) {
        this.deps.onWrite?.();
        this.snap = {
          inv: out.next.inv, gold: written.gold, seals: written.seals, look: out.next.look, lookFree: out.next.lookFree, version: written.version,
        };
        return { status: 'applied', snapshot: this.snap, jobs: out.next.jobs, info: out.info };
      }
      // stale: never written again as computed; the task runs again on the stored truth
      try {
        this.snap = await this.deps.load();
        reread = true;
      } catch (error) {
        this.dirty = true;
        return { status: 'failed', snapshot: this.snap, error };
      }
      if (attempt >= task.retries) return { status: 'stale', snapshot: this.snap };
    }
  }
}
