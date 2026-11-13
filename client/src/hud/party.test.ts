import { describe, expect, it } from 'vitest';
import { JOBS, type PartyMemberView, type PartyView } from '@sg2/shared';
import { inviteLine, partyBars, partySheetView, zoneLabel, type MemberHere } from './party';

const mem = (name: string, o: Partial<PartyMemberView> = {}): PartyMemberView => ({
  name, leader: false, online: true, zone: 'greenway', eid: -1, job: 'warrior', level: 1, hp: 100, maxHp: 100, dead: false, searing: 0, ...o,
});
const view = (...members: PartyMemberView[]): PartyView => ({ id: 'p1', members });

describe('party frames: partyBars', () => {
  const room = new Map<number, MemberHere>();
  const here = (eid: number) => room.get(eid);

  it('one row per other member, in join order, without self; nothing without a party', () => {
    expect(partyBars(null, 'Me', here, { x: 0, z: 0 })).toEqual([]);
    const v = view(mem('Ann', { leader: true }), mem('Me'), mem('Bo'), mem('Cy'));
    expect(partyBars(v, 'Me', here, { x: 0, z: 0 }).map((b) => b.name)).toEqual(['Ann', 'Bo', 'Cy']);
  });

  it('members in this room read hp, dead, job and Searing from their PlayerState (the view is stale for them)', () => {
    room.clear();
    room.set(7, { x: 3, z: 4, hp: 12, maxHp: 140, dead: false, job: 'white_mage', searing: 4, level: 6 });
    const v = view(mem('Me'), mem('Ann', { eid: 7, hp: 99, maxHp: 100, job: 'warrior', searing: 0, level: 2 }));
    const [b] = partyBars(v, 'Me', here, { x: 0, z: 0 });
    expect(b).toMatchObject({ eid: 7, hp: 12, maxHp: 140, dead: false, job: 'white_mage', glyph: JOBS.white_mage.glyph, searing: 4, level: 6, zoneLabel: null, inRange: true });
  });

  it('others read the view and are dimmed with where they are: the zone, or Offline', () => {
    room.clear();
    const v = view(mem('Me'), mem('Ann', { zone: 'grove', hp: 30, dead: true }), mem('Bo', { online: false, zone: null }), mem('Cy', { zone: 'lampfall' }));
    const bars = partyBars(v, 'Me', here, { x: 0, z: 0 });
    expect(bars.map((b) => b.zoneLabel)).toEqual(['Shady Grove', 'Offline', 'The Lampfall']);
    expect(bars[0]).toMatchObject({ eid: -1, hp: 30, dead: true, inRange: false });
    // an eid whose adventurer is not (yet) in this client's state counts as away
    const w = view(mem('Me'), mem('Di', { eid: 9, zone: 'greenway' }));
    expect(partyBars(w, 'Me', here, { x: 0, z: 0 })[0]).toMatchObject({ eid: -1, zoneLabel: 'The Greenway' });
  });

  it('the leader has the crown; in range within 18 m (plus the server fuzz), never while down', () => {
    room.clear();
    room.set(1, { x: 18.9, z: 0, hp: 50, maxHp: 100 });
    room.set(2, { x: 19.2, z: 0, hp: 50, maxHp: 100 });
    room.set(3, { x: 1, z: 0, hp: 0, maxHp: 100, dead: true });
    const v = view(mem('Me'), mem('Ann', { eid: 1, leader: true }), mem('Bo', { eid: 2 }), mem('Cy', { eid: 3 }));
    const bars = partyBars(v, 'Me', here, { x: 0, z: 0 });
    expect(bars.map((b) => [b.leader, b.inRange])).toEqual([[true, true], [false, false], [false, false]]);
    expect(bars[2].dead).toBe(true);
  });

  it('reuses its rows (nothing allocated per frame once warm) and shrinks when members leave', () => {
    room.clear();
    const out = partyBars(view(mem('Me'), mem('Ann'), mem('Bo')), 'Me', here, { x: 0, z: 0 });
    const first = out[0];
    const again = partyBars(view(mem('Me'), mem('Bo')), 'Me', here, { x: 0, z: 0 }, out);
    expect(again).toBe(out);
    expect(again[0]).toBe(first);
    expect(again.map((b) => b.name)).toEqual(['Bo']);
  });
});

describe('party sheet and card', () => {
  it('the sheet lists every member (self marked) and knows the leader', () => {
    const v = partySheetView(view(mem('Ann', { leader: true, job: 'ninja', level: 3 }), mem('Me', { zone: 'grove' })), 'Me', false);
    expect(v.amLeader).toBe(false);
    expect(v.members.map((m) => [m.name, m.me, m.leader, m.job, m.zone])).toEqual([['Ann', false, true, JOBS.ninja.name, 'The Greenway'], ['Me', true, false, JOBS.warrior.name, 'Shady Grove']]);
    expect(partySheetView(view(mem('Me', { leader: true })), 'Me', true).amLeader).toBe(true);
    expect(partySheetView(null, 'Me', true)).toEqual({ members: [], amLeader: false, canInvite: true });
  });
  it('zone labels and the invite line', () => {
    expect(zoneLabel(true, 'grove', true)).toBeNull();
    expect(zoneLabel(false, 'grove', false)).toBe('Offline');
    expect(inviteLine('Ellie_01', 2)).toBe('Ellie_01 invites you to a party (2/4)');
  });
});
