// The inventory queue's per-task `landed` hook (Plan 6): it runs inside the session's write lock as the write
// lands, once, before any save waiting on that lock; never for a stale or a failed write. And the snapshot
// carries the quests a landed write gave.
import { describe, expect, it } from 'vitest';
import { defaultLook, newInventory, newJobsSave, newQuestSave, type QuestSave } from '@sg2/shared';
import type { InvWrite, InvWritten } from '../store/types';
import { InventoryQueue, WriteLock, type InvSnapshot, type InvTask } from './inventoryQueue';

const DAY = '2026-11-12';
const snap = (version = 0, quests: QuestSave = newQuestSave(DAY)): InvSnapshot => ({
  inv: newInventory([0, 0]), gold: 0, seals: 0, look: defaultLook('q'), lookFree: true, version, quests,
});
const later: QuestSave = { ...newQuestSave(DAY), active: [{ id: 'solstice_crossing', step: 1, counts: [0], since: DAY }] };

/** A task that writes `later` and logs its landed hook. */
function task(log: string[], name: string): InvTask<null> {
  return {
    retries: 0,
    run: (s, jobs) => ({
      kind: 'write', info: null,
      write: { inventory: s.inv, jobs, dGold: 0, dSeals: 0, quests: later },
      next: { inv: s.inv, gold: s.gold, seals: s.seals, jobs, look: s.look, lookFree: s.lookFree, quests: later },
    }),
    landed: () => log.push(`${name} landed`),
    settle: (r) => log.push(`${name} ${r.status}`),
  };
}

function queue(write: (expect: number, w: InvWrite) => Promise<InvWritten | null>, lock = new WriteLock(), log: string[] = []) {
  return new InventoryQueue(snap(), {
    lock, jobs: () => newJobsSave(), write,
    load: async () => snap(5),
    landed: () => log.push('deps landed'),
  });
}

describe('InventoryQueue landed hook', () => {
  it("a task's landed hook runs once inside the lock when its write lands, before a waiting save; never on stale or failed", async () => {
    const log: string[] = [];
    const lock = new WriteLock();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const q = queue(async (expect) => {
      log.push('write');
      await gate;
      return { version: expect + 1, gold: 0, seals: 0 };
    }, lock, log);
    const done = q.push(task(log, 'a'));
    await Promise.resolve();
    // a save that waits on the same lock (as the session's saves do)
    const saved = lock.run(async () => { log.push('save'); });
    release();
    const r = await done;
    await saved;
    expect(r.status).toBe('applied');
    expect(log).toEqual(['write', 'deps landed', 'a landed', 'save', 'a applied']);
    expect(q.snapshot.quests).toEqual(later);
    expect(q.snapshot.version).toBe(1);

    // stale (every try): no landed hook
    const staleLog: string[] = [];
    const stale = queue(async () => null, new WriteLock(), staleLog);
    expect((await stale.push(task(staleLog, 'b'))).status).toBe('stale');
    expect(staleLog).toEqual(['b stale']);
    expect(stale.snapshot.quests).toEqual(newQuestSave(DAY)); // the stored truth (re-read)

    // failed (the store threw): no landed hook
    const failLog: string[] = [];
    const failing = queue(async () => { throw new Error('down'); }, new WriteLock(), failLog);
    expect((await failing.push(task(failLog, 'c'))).status).toBe('failed');
    expect(failLog).toEqual(['c failed']);
  });

  it('a landed hook that throws never stops the queue (the result is still applied)', async () => {
    const errors: unknown[] = [];
    const q = new InventoryQueue(snap(), {
      lock: new WriteLock(), jobs: () => newJobsSave(), load: async () => snap(),
      write: async (expect) => ({ version: expect + 1, gold: 0, seals: 0 }),
      onError: (e) => errors.push(e),
    });
    const r = await q.push({ ...task([], 'a'), landed: () => { throw new Error('boom'); } });
    expect(r.status).toBe('applied');
    expect(errors).toHaveLength(1);
    expect((await q.push(task([], 'b'))).status).toBe('applied');
  });

  it('a session that ended meanwhile still gets its landed hook (the write landed)', async () => {
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const q = queue(async (expect) => { await gate; return { version: expect + 1, gold: 0, seals: 0 }; }, new WriteLock(), log);
    const done = q.push(task(log, 'a'));
    await Promise.resolve();
    q.close();
    release();
    await done;
    expect(log).toContain('a landed');
  });
});
