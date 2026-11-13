import { describe, expect, it } from 'vitest';
import { EMOTES, defaultLook, encodeGearLook, encodeLook, resolveGearLook, validateAdventurerName } from '@sg2/shared';
import { LookCache, barberRefusal, createBarber, creatorPlan, emoteToPlay } from './looks';
import { accountIdOf, lookInfoResult, saveLookResult, startingLook } from './lookApi';

const a = defaultLook('a'), b = defaultLook('b');
const gear = encodeGearLook(resolveGearLook({ weapon: { model: 3, dye: [1, 2] } }, {}, false));

describe('LookCache', () => {
  it('keeps codes by engine id, decoded, and says which changed', () => {
    const c = new LookCache();
    expect(c.handle({ a: [[5, encodeLook(a), gear], [9, encodeLook(b), gear]] })).toEqual([5, 9]);
    expect(c.get(5)!.look).toEqual(a);
    expect(c.get(5)!.gear!.weapon).toEqual({ model: 3, dye: [1, 2] });
    expect(c.ver(5)).toBe(1);
    expect(c.handle({ a: [[5, encodeLook(a), gear]] })).toEqual([]); // unchanged: no rebuild
    expect(c.handle({ a: [[5, encodeLook(b), gear]] })).toEqual([5]);
    expect(c.ver(5)).toBe(2);
    expect(c.codes()).toEqual({ 5: encodeLook(b), 9: encodeLook(b) });
  });
  it('ignores malformed rows and bad codes without throwing', () => {
    const c = new LookCache();
    expect(c.handle(null)).toEqual([]);
    expect(c.handle({ a: 'x' })).toEqual([]);
    expect(c.handle({ a: [[1, 'nonsense', gear], [-1, encodeLook(a), gear], ['2', encodeLook(a), gear], [3, encodeLook(a)]] })).toEqual([]);
    expect(c.size).toBe(0);
    expect(c.rejected).toBeGreaterThan(3);
    // a bad gear code still shows the look (as the starter kit)
    expect(c.handle({ a: [[4, encodeLook(a), '!!']] })).toEqual([4]);
    expect(c.get(4)!.gear).toBeNull();
  });
  it('is cleared on a room change (engine ids are per room), with the free flag', () => {
    const c = new LookCache();
    c.handle({ a: [[5, encodeLook(a), gear]] });
    c.handleFree({ free: true });
    expect(c.free).toBe(true);
    c.clear();
    expect(c.get(5)).toBeUndefined();
    expect(c.free).toBeNull();
    c.handleFree({ free: 'yes' });
    expect(c.free).toBeNull();
  });
});

describe('the creator flow', () => {
  it('opens once (the free visit), asking for the name only for a named account without one', () => {
    expect(creatorPlan({ free: true, name: null, guest: false })).toEqual({ open: true, needsName: true });
    expect(creatorPlan({ free: true, name: 'Bram', guest: false })).toEqual({ open: true, needsName: false });
    expect(creatorPlan({ free: true, name: null, guest: true })).toEqual({ open: true, needsName: false });
    expect(creatorPlan({ free: false, name: null, guest: false })).toEqual({ open: false, needsName: false });
  });
  it('reads GET /api/look', () => {
    expect(lookInfoResult(200, { look: a, free: true, name: null, guest: false })).toEqual({ kind: 'ok', info: { look: a, free: true, name: null, guest: false } });
    expect(lookInfoResult(200, { look: { v: 2 }, free: false, name: 'Bram', guest: false })).toEqual({ kind: 'ok', info: { look: null, free: false, name: 'Bram', guest: false } });
    expect(lookInfoResult(401, { error: 'Please sign in again' }).kind).toBe('signIn');
    expect(lookInfoResult(500, null).kind).toBe('error');
    expect(lookInfoResult(200, { nope: 1 }).kind).toBe('error');
  });
  it('reads POST /api/look: saved, a refused name (back to the Name tab), the visit already spent, sign in again', () => {
    expect(saveLookResult(200, { look: a, free: false, name: 'Bram', guest: false }, true)).toEqual({ kind: 'saved', info: { look: a, free: false, name: 'Bram', guest: false } });
    expect(saveLookResult(409, { error: 'That name is taken' }, true)).toEqual({ kind: 'name', error: 'That name is taken' });
    const bad = validateAdventurerName('x')!;
    expect(saveLookResult(400, { error: bad }, true)).toEqual({ kind: 'name', error: bad });
    expect(saveLookResult(400, { error: 'That look is not possible' }, true).kind).toBe('retry');
    expect(saveLookResult(409, { error: 'Visit the Barber in Shady Grove to change your look' }, false).kind).toBe('notFree');
    expect(saveLookResult(401, {}, false).kind).toBe('signIn');
    expect(saveLookResult(503, null, false).kind).toBe('retry');
  });
  it('starts from the stored look, else the account default look (seeded by the token subject)', () => {
    const payload = btoa(JSON.stringify({ sub: 'acct-42' })).replace(/=+$/, '');
    const token = `x.${payload}.y`;
    expect(accountIdOf(token)).toBe('acct-42');
    expect(accountIdOf('not-a-jwt')).toBe('not-a-jwt');
    expect(startingLook({ look: null, free: true, name: null, guest: false }, token)).toEqual(defaultLook('acct-42'));
    expect(startingLook({ look: a, free: true, name: null, guest: false }, token)).toEqual(a);
  });
  it('names a Barber refusal; other refusals are not its business', () => {
    expect(barberRefusal({ op: 'look', reason: 'gold', text: 'Not enough gold' })).toBe('Not enough gold');
    expect(barberRefusal({ op: 'buy', reason: 'gold', text: 'Not enough gold' })).toBeNull();
  });
});

describe('emoteToPlay', () => {
  it('plays a new, fresh emote once; old ones are history; sit holds', () => {
    expect(emoteToPlay(0, 'wave', 100, 105, 15)).toBe('wave');
    expect(emoteToPlay(100, 'wave', 100, 105, 15)).toBeNull();      // already played
    expect(emoteToPlay(0, 'wave', 100, 100 + 15 * 3, 15)).toBeNull(); // 3 s old on first sight
    expect(emoteToPlay(0, 'sit', 100, 100 + 15 * 60, 15)).toBe('sit');
    expect(emoteToPlay(0, '', 0, 10, 15)).toBeNull();
    for (const e of EMOTES) expect(emoteToPlay(1, e, 2, 2, 15)).toBe(e);
  });
});

describe('the Barber session', () => {
  type Room = { id: string };
  function setup() {
    let room: Room | null = { id: 'r1' };
    const sent: [string, unknown][] = [];
    let answer: (v: { look: typeof a } | null) => void = () => {};
    let opened = 0, closed = 0, held = 0;
    const barber = createBarber<Room>({
      room: () => room,
      look: () => a,
      opts: (look) => ({ look, mode: 'barber', needsName: false, gold: 10, free: false, validateName: validateAdventurerName }),
      open: () => {
        opened++;
        const done = new Promise<{ look: typeof a } | null>((r) => { answer = r; });
        return { done, close: () => { closed++; answer(null); } };
      },
      hold: () => { held++; },
      send: (r, look) => { sent.push([r.id, look]); },
    });
    return { barber, sent, setRoom: (r: Room | null) => { room = r; }, answer: (v: { look: typeof a } | null) => answer(v), counts: () => ({ opened, closed, held }) };
  }

  it('holds the adventurer while open, and sends the look on Done in the same room', async () => {
    const t = setup();
    const p = t.barber.show();
    expect(t.barber.open).toBe(true);
    expect(t.counts().held).toBe(1);
    void t.barber.show(); // a second tap: one Barber
    expect(t.counts().opened).toBe(1);
    t.answer({ look: b });
    await p;
    expect(t.barber.open).toBe(false);
    expect(t.sent).toEqual([['r1', b]]);
  });

  it('closes when the room ends (a kick, a disconnect, a travel): nothing is sent, the screen goes', async () => {
    const t = setup();
    const p = t.barber.show();
    t.setRoom(null);
    t.barber.close();
    await p;
    expect(t.counts().closed).toBe(1);
    expect(t.barber.open).toBe(false);
    expect(t.sent).toEqual([]);
    t.barber.close(); // nothing open: nothing to do
    expect(t.counts().closed).toBe(1);
  });

  it('a Done that lands in another room sends nothing', async () => {
    const t = setup();
    const p = t.barber.show();
    t.setRoom({ id: 'r2' });
    t.answer({ look: b });
    await p;
    expect(t.sent).toEqual([]);
  });
});
