// The party registry on its own (a fake clock): invites and answers, leaders, kicks and promotions,
// refusals, expiry, the invite rate, offline members and leaders, status changes and change events.
import { describe, expect, it } from 'vitest';
import { PARTY_INVITE_S, PARTY_INVITES_PER_MIN, PARTY_LEADER_AWAY_S, PARTY_MAX, PARTY_OFFLINE_KEEP_S, PARTY_REINVITE_S } from '@sg2/shared';
import { Parties, type MemberStatus, type Party } from './parties';

function setup() {
  let t = 1_000_000;
  const parties = new Parties({ now: () => t });
  const changes: { partyId: string; accountIds: string[] }[] = [];
  parties.onChange((partyId, accountIds) => changes.push({ partyId, accountIds: [...accountIds].sort() }));
  return { parties, changes, advance: (s: number) => { t += s * 1000; } };
}
const who = (id: string) => ({ accountId: id, name: id.toUpperCase() + 'name' });
const ids = (p: Party | undefined) => p?.members.map((m) => m.accountId);
const ok = (r: unknown): { partyId: string; size: number } => {
  if (typeof r === 'string') throw new Error(`refused: ${r}`);
  return r as { partyId: string; size: number };
};
/** a invites b and b accepts: the party id. */
function pair(parties: Parties, a: string, b: string): string {
  const { partyId } = ok(parties.invite(who(a), who(b)));
  const p = parties.accept(b, who(b).name, partyId);
  if (typeof p === 'string') throw new Error(`refused: ${p}`);
  return partyId;
}
const status = (over: Partial<MemberStatus> = {}): MemberStatus => ({
  zone: 'grove', roomId: 'r1', eid: 5, job: 'warrior', level: 1, hp: 100, maxHp: 100, dead: false, searing: 0, ...over,
});

describe('Parties', () => {
  it('invite and accept make a party of two led by the inviter; decline drops the invite', () => {
    const { parties } = setup();
    const r = ok(parties.invite(who('a'), who('b')));
    expect(r).toEqual({ partyId: expect.stringMatching(/^p\d+$/), size: 1 });
    expect(parties.partyOf('a')).toBeUndefined(); // nobody is a party of one
    const p = parties.accept('b', who('b').name, r.partyId) as Party;
    expect(p.id).toBe(r.partyId);
    expect(p.leader).toBe('a');
    expect(ids(p)).toEqual(['a', 'b']);
    expect(parties.partyOf('a')).toBe(p);
    expect(parties.partyOf('b')).toBe(p);
    expect(ok(parties.invite(who('a'), who('c')))).toEqual({ partyId: p.id, size: 2 });
    parties.decline('c', p.id);
    expect(parties.accept('c', who('c').name, p.id)).toBe('expired');
    expect(ids(parties.partyOf('a'))).toEqual(['a', 'b']);
    expect(parties.size).toBe(1);
  });

  it('refuses: self, not-leader, in-party, full, a fifth member, and an unknown party id as expired', () => {
    const { parties } = setup();
    expect(parties.invite(who('a'), who('a'))).toBe('self');
    const id = pair(parties, 'a', 'b');
    expect(parties.invite(who('b'), who('c'))).toBe('not-leader');
    expect(parties.invite(who('a'), who('b'))).toBe('in-party');
    pair(parties, 'x', 'y');
    expect(parties.invite(who('a'), who('x'))).toBe('in-party');
    for (const m of ['c', 'd']) {
      ok(parties.invite(who('a'), who(m)));
      expect(parties.accept(m, who(m).name, id)).not.toBeTypeOf('string');
    }
    expect(parties.partyOf('a')!.members.length).toBe(PARTY_MAX);
    expect(parties.invite(who('a'), who('e'))).toBe('full');
    expect(parties.accept('e', who('e').name, id)).toBe('expired');
    expect(parties.accept('e', who('e').name, 'p999')).toBe('expired');
  });

  it('an invite accepted after the party filled is refused full; one from a party since joined is in-party', () => {
    const { parties } = setup();
    const id = pair(parties, 'a', 'b');
    ok(parties.invite(who('a'), who('c')));
    ok(parties.invite(who('a'), who('d')));
    ok(parties.invite(who('a'), who('e')));
    expect(parties.accept('c', who('c').name, id)).not.toBeTypeOf('string');
    expect(parties.accept('d', who('d').name, id)).not.toBeTypeOf('string');
    expect(parties.accept('e', who('e').name, id)).toBe('full');
    expect(parties.partyOf('e')).toBeUndefined();
    // f holds invites from two parties and accepts one; the other is then in-party
    const q = pair(parties, 'x', 'y');
    const g = ok(parties.invite(who('g'), who('f')));
    ok(parties.invite(who('x'), who('f')));
    expect(parties.accept('f', who('f').name, q)).not.toBeTypeOf('string');
    expect(parties.accept('f', who('f').name, g.partyId)).toBe('in-party');
  });

  it('an invite expires after PARTY_INVITE_S; a new one from the same party refreshes it', () => {
    const { parties, advance } = setup();
    const id = pair(parties, 'a', 'b');
    ok(parties.invite(who('a'), who('c')));
    advance(PARTY_INVITE_S - 10);
    ok(parties.invite(who('a'), who('c'))); // refreshed
    advance(20);
    expect(parties.accept('c', who('c').name, id)).not.toBeTypeOf('string');
    ok(parties.invite(who('a'), who('d')));
    advance(PARTY_INVITE_S + 0.001);
    expect(parties.accept('d', who('d').name, id)).toBe('expired');
    parties.sweep();
    expect(parties.counts().invites).toBe(0);
  });

  it(`the ${PARTY_INVITES_PER_MIN + 1}th invite in a minute is refused rate, unknown names included; a minute later it works`, () => {
    const { parties, advance } = setup();
    for (let i = 0; i < PARTY_INVITES_PER_MIN - 1; i++) expect(parties.invite(who('a'), who(`t${i}`))).not.toBeTypeOf('string');
    expect(parties.inviteUnknown('a')).toBe('unknown');
    expect(parties.invite(who('a'), who('z'))).toBe('rate');
    expect(parties.inviteUnknown('a')).toBe('rate');
    expect(parties.invite(who('a'), who('a'))).toBe('rate');
    expect(parties.invite(who('b'), who('z'))).not.toBeTypeOf('string'); // per adventurer
    advance(60);
    expect(parties.invite(who('a'), who('z'))).not.toBeTypeOf('string');
    advance(120);
    parties.sweep();
    expect(parties.counts()).toMatchObject({ parties: 0, invites: 0, rates: 0, members: 0 });
  });

  it('the leader leaving hands the lead to the longest-standing member; a party of one dissolves', () => {
    const { parties, changes } = setup();
    const id = pair(parties, 'a', 'b');
    for (const m of ['c', 'd']) { ok(parties.invite(who('a'), who(m))); parties.accept(m, who(m).name, id); }
    const after = parties.leave('a')!;
    expect(after.leader).toBe('b');
    expect(ids(after)).toEqual(['b', 'c', 'd']);
    expect(parties.partyOf('a')).toBeUndefined();
    expect(parties.leave('c')!.leader).toBe('b');
    ok(parties.invite(who('b'), who('e')));
    expect(parties.leave('d')).toBeUndefined(); // b alone: dissolved
    expect(parties.partyOf('b')).toBeUndefined();
    expect(parties.size).toBe(0);
    expect(parties.counts().invites).toBe(0); // its invites went with it
    expect(parties.accept('e', who('e').name, id)).toBe('expired');
    expect(changes.at(-1)).toEqual({ partyId: id, accountIds: ['b', 'd'] });
    expect(parties.leave('zzz')).toBeUndefined();
  });

  it('kick and lead: leader only, members only, by name in any case', () => {
    const { parties, changes } = setup();
    const id = pair(parties, 'a', 'b');
    ok(parties.invite(who('a'), who('c')));
    parties.accept('c', who('c').name, id);
    expect(parties.kick('b', 'Cname')).toBe('not-leader');
    expect(parties.kick('a', 'nobody')).toBe('not-member');
    expect(parties.kick('a', 'Aname')).toBe('self');
    expect(parties.kick('z', 'Aname')).toBe('not-member');
    expect(parties.lead('b', 'Cname')).toBe('not-leader');
    expect(parties.lead('a', 'nobody')).toBe('not-member');
    const r = parties.kick('a', 'cNAME');
    expect(r).toMatchObject({ kicked: 'c' });
    expect(changes.at(-1)).toEqual({ partyId: id, accountIds: ['a', 'b', 'c'] });
    expect(ids(parties.partyOf('a'))).toEqual(['a', 'b']);
    expect((parties.lead('a', 'bname') as Party).leader).toBe('b');
    expect(parties.kick('a', 'Bname')).toBe('not-leader');
    const last = parties.kick('b', 'Aname') as { kicked: string; party: Party | undefined };
    expect(last).toEqual({ kicked: 'a', party: undefined });
    expect(parties.size).toBe(0);
  });

  it('offline members are removed after PARTY_OFFLINE_KEEP_S; an offline leader hands on the lead after PARTY_LEADER_AWAY_S', () => {
    const { parties, advance, changes } = setup();
    const id = pair(parties, 'a', 'b');
    ok(parties.invite(who('a'), who('c')));
    parties.accept('c', who('c').name, id);
    parties.setOnline('a', false);
    expect(changes.at(-1)).toEqual({ partyId: id, accountIds: ['a', 'b', 'c'] });
    parties.setOnline('b', false);
    advance(PARTY_LEADER_AWAY_S - 1);
    parties.sweep();
    expect(parties.partyOf('a')!.leader).toBe('a');
    advance(2);
    parties.sweep();
    expect(parties.partyOf('a')!.leader).toBe('c'); // b is offline too: the first online member
    expect(parties.view(parties.partyOf('a')!, null).members.map((m) => [m.name, m.leader, m.online])).toEqual([
      ['Aname', false, false], ['Bname', false, false], ['Cname', true, true],
    ]);
    parties.setOnline('b', true);
    advance(PARTY_OFFLINE_KEEP_S);
    parties.sweep();
    expect(ids(parties.partyOf('c'))).toEqual(['b', 'c']);
    parties.setOnline('b', false);
    advance(PARTY_OFFLINE_KEEP_S + 1);
    parties.sweep();
    expect(parties.size).toBe(0);
    expect(parties.counts()).toMatchObject({ parties: 0, invites: 0, rates: 0, members: 0 });
  });

  it('setStatus reports a change only when something changed; view gives eids only for the room asked about', () => {
    const { parties } = setup();
    const id = pair(parties, 'a', 'b');
    expect(parties.setStatus('a', status())).toBe(true);
    expect(parties.setStatus('a', status())).toBe(false);
    expect(parties.setStatus('a', status({ hp: 90 }))).toBe(true);
    expect(parties.setStatus('b', status({ zone: 'greenway', roomId: 'r2', eid: 9, job: 'ranger', level: 3 }))).toBe(true);
    expect(parties.setStatus('zz', status())).toBe(false);
    expect(parties.statusOf('a')).toEqual(status({ hp: 90 }));
    expect(parties.statusOf('zz')).toBeNull();
    const p = parties.partyOf('a')!;
    expect(parties.view(p, 'r1')).toEqual({
      id,
      members: [
        { name: 'Aname', leader: true, online: true, zone: 'grove', eid: 5, job: 'warrior', level: 1, hp: 90, maxHp: 100, dead: false, searing: 0 },
        { name: 'Bname', leader: false, online: true, zone: 'greenway', eid: -1, job: 'ranger', level: 3, hp: 100, maxHp: 100, dead: false, searing: 0 },
      ],
    });
    expect(parties.view(p, 'r2').members.map((m) => m.eid)).toEqual([-1, 9]);
    expect(parties.clearRoom('b', 'r1')).toBe(false);
    expect(parties.clearRoom('b', 'r2')).toBe(true);
    expect(parties.view(p, 'r2').members[1]).toMatchObject({ eid: -1, zone: 'greenway', job: 'ranger' });
    parties.setOnline('b', false);
    expect(parties.view(p, 'r2').members[1]).toMatchObject({ online: false, zone: null, eid: -1 });
  });

  it('onChange lists every member before and after: accept, leave, lead', () => {
    const { parties, changes } = setup();
    const id = pair(parties, 'a', 'b');
    expect(changes).toEqual([{ partyId: id, accountIds: ['a', 'b'] }]);
    ok(parties.invite(who('a'), who('c')));
    expect(changes.length).toBe(1); // an invite changes no party
    parties.accept('c', who('c').name, id);
    expect(changes.at(-1)).toEqual({ partyId: id, accountIds: ['a', 'b', 'c'] });
    parties.leave('b');
    expect(changes.at(-1)).toEqual({ partyId: id, accountIds: ['a', 'b', 'c'] });
    parties.lead('a', 'Cname');
    expect(changes.at(-1)).toEqual({ partyId: id, accountIds: ['a', 'c'] });
    expect(changes.length).toBe(4);
  });

  it('a solo inviter who joins another party first: its own invite is then expired', () => {
    const { parties } = setup();
    const mine = ok(parties.invite(who('a'), who('b')));
    pair(parties, 'x', 'a');
    expect(parties.accept('b', who('b').name, mine.partyId)).toBe('expired');
    expect(parties.partyOf('b')).toBeUndefined();
  });

  it('Task 6 review: no ghost leader: an invite from someone who signed out cannot be accepted (solo or leading)', () => {
    const { parties } = setup();
    const { partyId } = ok(parties.invite(who('a'), who('b')));
    parties.setOnline('a', false); // a solo inviter signs out: its invites go
    expect(parties.invitesFor('b')).toEqual([]);
    expect(parties.accept('b', who('b').name, partyId)).toBe('expired');
    expect(parties.size).toBe(0);
    expect(parties.partyOf('b')).toBeUndefined();
    // a leader who signs out: its party's invites can no longer be accepted either
    parties.setOnline('a', true);
    const id = pair(parties, 'a', 'b');
    ok(parties.invite(who('a'), who('c')));
    parties.setOnline('a', false);
    expect(parties.accept('c', who('c').name, id)).toBe('expired');
    expect(ids(parties.partyOf('a'))).toEqual(['a', 'b']);
    parties.setOnline('a', true);
    ok(parties.invite(who('a'), who('c')));
    expect(parties.accept('c', who('c').name, id)).not.toBeTypeOf('string');
  });

  it('Task 6 review: a listener that throws never stops the others or the change, and is logged', () => {
    const logged: string[] = [];
    const parties = new Parties({ log: (what) => logged.push(what) });
    const heard: string[] = [];
    parties.onChange(() => { throw new Error('boom'); });
    parties.onChange((partyId) => heard.push(partyId));
    const id = pair(parties, 'a', 'b');
    expect(heard).toEqual([id]);
    expect(parties.partyOf('b')?.id).toBe(id);
    expect(() => parties.leave('b')).not.toThrow();
    expect(heard).toEqual([id, id]);
    expect(logged.length).toBe(1); // throttled
  });

  it(`P4-d: after a decline the same inviter cannot invite again for PARTY_REINVITE_S (rate); others can; invites are listed`, () => {
    const { parties, advance } = setup();
    const { partyId } = ok(parties.invite(who('a'), who('b')));
    expect(parties.invitesFor('b')).toEqual([{ partyId, from: 'Aname', fromAccountId: 'a', size: 1 }]);
    expect(parties.inviterOf(partyId, 'b')).toBe('a');
    parties.decline('b', partyId);
    expect(parties.invitesFor('b')).toEqual([]);
    expect(parties.invite(who('a'), who('b'))).toBe('rate');
    ok(parties.invite(who('c'), who('b')));
    advance(PARTY_REINVITE_S + 1);
    ok(parties.invite(who('a'), who('b')));
    parties.sweep();
    expect(parties.counts().declined).toBe(0);
  });

  it('leave and kick events name the account taken out', () => {
    const { parties } = setup();
    const lefts: (string | undefined)[] = [];
    parties.onChange((_p, _a, left) => lefts.push(left));
    const id = pair(parties, 'a', 'b');
    ok(parties.invite(who('a'), who('c')));
    parties.accept('c', who('c').name, id);
    parties.kick('a', 'Cname');
    parties.leave('b'); // dissolves
    expect(lefts).toEqual([undefined, undefined, 'c', 'b']);
  });
});
