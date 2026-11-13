import { describe, expect, it } from 'vitest';
import { PARTY_INVITE_S, type PartyMemberView, type PartyView } from '@sg2/shared';
import { createPartyState } from './party';

const mem = (name: string, o: Partial<PartyMemberView> = {}): PartyMemberView => ({
  name, leader: false, online: true, zone: 'greenway', eid: -1, job: 'warrior', level: 1, hp: 100, maxHp: 100, dead: false, searing: 0, ...o,
});
const party = (...members: PartyMemberView[]): PartyView => ({ id: 'p1', members });

describe('party state', () => {
  it('follows `party` views: members in join order, leader, zones and eids; null drops the party', () => {
    const s = createPartyState();
    expect(s.onParty({ party: party(mem('Ann', { leader: true, eid: 4 }), mem('Bo', { zone: 'grove' })) })).toEqual({ joined: true, left: false });
    expect(s.view?.members.map((m) => m.name)).toEqual(['Ann', 'Bo']);
    expect(s.leads('Ann')).toBe(true);
    expect(s.leads('Bo')).toBe(false);
    expect(s.memberByEid(4)?.name).toBe('Ann');
    expect(s.memberByEid(-1)).toBeNull();
    expect(s.member('Bo')?.zone).toBe('grove');
    // a later view replaces it (a third member, a new leader)
    expect(s.onParty({ party: party(mem('Ann'), mem('Bo', { leader: true }), mem('Cy')) })).toEqual({ joined: false, left: false });
    expect(s.leads('Bo')).toBe(true);
    expect(s.onParty({ party: null })).toEqual({ joined: false, left: true });
    expect(s.view).toBeNull();
  });

  it('the view is a copy: the message object is never changed by status lines', () => {
    const s = createPartyState();
    const m = { party: party(mem('Ann'), mem('Bo')) };
    s.onParty(m);
    s.onStatus({ m: [{ i: 1, hp: 3 }] });
    expect(m.party.members[1].hp).toBe(100);
    expect(s.view?.members[1].hp).toBe(3);
  });

  it('applies `partyStatus` lines by index, only the fields present; lines for no member are ignored', () => {
    const s = createPartyState();
    s.onStatus({ m: [{ i: 0, hp: 1 }] }); // no party yet: nothing to do
    s.onParty({ party: party(mem('Ann'), mem('Bo')) });
    s.onStatus({ m: [{ i: 1, hp: 40, searing: 3 }, { i: 0, dead: true, job: 'ninja', level: 4, maxHp: 120 }, { i: 7, hp: 1 }] });
    expect(s.view?.members[1]).toMatchObject({ hp: 40, maxHp: 100, searing: 3, dead: false });
    expect(s.view?.members[0]).toMatchObject({ dead: true, job: 'ninja', level: 4, maxHp: 120, hp: 100 });
  });

  it('who may invite: anyone without a party; in a party only its leader, and not when full', () => {
    const s = createPartyState();
    expect(s.canInvite('Ann')).toBe(true);
    s.onParty({ party: party(mem('Ann', { leader: true }), mem('Bo')) });
    expect(s.canInvite('Ann')).toBe(true);
    expect(s.canInvite('Bo')).toBe(false);
    s.onParty({ party: party(mem('Ann', { leader: true }), mem('Bo'), mem('Cy'), mem('Di')) });
    expect(s.canInvite('Ann')).toBe(false);
  });

  it('queues invites, refreshes one from the same party, and expires them after PARTY_INVITE_S', () => {
    const s = createPartyState();
    expect(s.onInvite({ partyId: 'p1', from: 'Ann', size: 1 }, 0).fresh).toBe(true);
    expect(s.onInvite({ partyId: 'p2', from: 'Cy', size: 2 }, 10_000).fresh).toBe(true);
    // the same party again (a re-sent invite on reconnect, or a second invite): refreshed, not queued twice
    const again = s.onInvite({ partyId: 'p1', from: 'Ann', size: 2 }, 20_000);
    expect(again.fresh).toBe(false);
    expect(again.invite.size).toBe(2);
    expect(s.invites.map((i) => i.partyId)).toEqual(['p1', 'p2']);
    expect(s.expire(PARTY_INVITE_S * 1000 + 9_999)).toEqual([]);
    expect(s.expire(PARTY_INVITE_S * 1000 + 10_000).map((i) => i.partyId)).toEqual(['p2']);
    expect(s.expire(PARTY_INVITE_S * 1000 + 20_000).map((i) => i.partyId)).toEqual(['p1']);
    expect(s.invites).toEqual([]);
  });

  it('an answered invite leaves the queue; joining a party drops every pending invite', () => {
    const s = createPartyState();
    s.onInvite({ partyId: 'p1', from: 'Ann', size: 1 }, 0);
    s.onInvite({ partyId: 'p2', from: 'Cy', size: 1 }, 0);
    s.answered('p2');
    expect(s.invites.map((i) => i.partyId)).toEqual(['p1']);
    s.onParty({ party: party(mem('Ann', { leader: true }), mem('Me')) });
    expect(s.invites).toEqual([]);
  });

  it('keeps the last 20 refusal lines', () => {
    const s = createPartyState();
    for (let i = 0; i < 25; i++) s.onRefused({ reason: 'rate', text: `line ${i}` });
    expect(s.refusals.length).toBe(20);
    expect(s.refusals[0]).toBe('line 5');
    s.reset();
    expect(s.refusals).toEqual([]);
  });
});

describe('party state across rooms', () => {
  it('leaving a room forgets every member\'s engine id (eids are unique only within a room)', () => {
    const s = createPartyState();
    s.onParty({ party: { id: 'p1', members: [{ name: 'Ann', leader: true, online: true, zone: 'greenway', eid: 5, job: 'warrior', level: 1, hp: 1, maxHp: 1, dead: false, searing: 0 }] } });
    s.clearEids();
    expect(s.memberByEid(5)).toBeNull();
    expect(s.view?.members[0].eid).toBe(-1);
  });
});
