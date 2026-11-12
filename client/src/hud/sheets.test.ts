import { describe, expect, it } from 'vitest';
import { Sheets } from './sheets';

/** A sheet like the job board: a promise answered by its own buttons or by its closer (null). */
function openSheet(sheets: Sheets, kind: string) {
  let answer: (v: string | null) => void = () => {};
  const p = new Promise<string | null>((r) => { answer = r; });
  let done = false;
  const close = () => finish(null);
  const finish = (v: string | null) => { if (done) return; done = true; sheets.remove(kind, close); answer(v); };
  sheets.add(kind, close);
  return { p, finish };
}

describe('Sheets', () => {
  it('closeAll answers every open sheet as cancelled (the controller goes away with the board open)', async () => {
    const s = new Sheets();
    const board = openSheet(s, 'jobs'), picks = openSheet(s, 'loadout');
    s.closeAll();
    expect(await board.p).toBeNull();
    expect(await picks.p).toBeNull();
    expect(s.has('jobs')).toBe(false);
  });
  it('a second board closes the first, never stacking', async () => {
    const s = new Sheets();
    const a = openSheet(s, 'jobs');
    const b = openSheet(s, 'jobs');
    expect(await a.p).toBeNull();
    expect(s.has('jobs')).toBe(true);
    b.finish('ninja');
    expect(await b.p).toBe('ninja');
    expect(s.has('jobs')).toBe(false);
  });
  it('a sheet answered by its own button is forgotten, and closeAll leaves it be', async () => {
    const s = new Sheets();
    const a = openSheet(s, 'jobs');
    a.finish('ranger');
    s.closeAll();
    expect(await a.p).toBe('ranger');
  });
});
