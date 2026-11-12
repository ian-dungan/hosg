import { describe, expect, it } from 'vitest';
import * as shared from './index';
import {
  PARTY_MAX, PARTY_INVITE_S, PARTY_INVITES_PER_MIN, PARTY_OFFLINE_KEEP_S, PARTY_LEADER_AWAY_S, PARTY_STATUS_HZ, PARTY_SHARE_R,
  PARTY_TEXT, parsePartyOp, type PartyRefusal,
  MAX_INSTANCES, INSTANCE_EMPTY_S, INSTANCE_MAX_S, INSTANCE_RECONNECT_S, INSTANCE_EVICT_S, WIPE_DELAY_S, RELEASE_MIN_S,
  AUTO_RELEASE_S, SEAL_DELAY_S, SEAL_GATE_R, REASON_INSTANCES_FULL, REASON_ARENA_SEALED, REASON_INSTANCE_CLOSED, REASON_LEFT_PARTY,
} from './index';

describe('party and instance constants', () => {
  it('the Numbers table values', () => {
    expect([PARTY_MAX, PARTY_INVITE_S, PARTY_INVITES_PER_MIN, PARTY_OFFLINE_KEEP_S, PARTY_LEADER_AWAY_S, PARTY_STATUS_HZ, PARTY_SHARE_R])
      .toEqual([4, 60, 10, 300, 60, 2, 60]);
    expect([MAX_INSTANCES, INSTANCE_EMPTY_S, INSTANCE_MAX_S, INSTANCE_RECONNECT_S, INSTANCE_EVICT_S, WIPE_DELAY_S, RELEASE_MIN_S, AUTO_RELEASE_S, SEAL_DELAY_S, SEAL_GATE_R])
      .toEqual([12, 120, 5400, 120, 10, 5, 10, 60, 3, 3.0]);
    expect(REASON_INSTANCES_FULL).toBe('The Lampfall is crowded right now, try again in a minute');
    expect(REASON_ARENA_SEALED).toBe('The lamp-gate is shut until the fight ends');
    expect(REASON_INSTANCE_CLOSED).toBe('The Lampfall has gone quiet; you climb back out');
    expect(REASON_LEFT_PARTY).toBe('You left the party, so you climb back out of the Lampfall');
  });
});

describe('parsePartyOp', () => {
  it('parsePartyOp accepts each op and refuses junk, NaN eids, long names, unknown ops, extra-long ids', () => {
    const good: [unknown, unknown][] = [
      [{ op: 'invite', eid: 0 }, { op: 'invite', eid: 0 }],
      [{ op: 'invite', eid: 17 }, { op: 'invite', eid: 17 }],
      [{ op: 'invite', name: 'Bramblewick' }, { op: 'invite', name: 'Bramblewick' }],
      [{ op: 'invite', name: 'a' }, { op: 'invite', name: 'a' }],
      [{ op: 'invite', name: 'x'.repeat(16) }, { op: 'invite', name: 'x'.repeat(16) }],
      [{ op: 'accept', partyId: 'p1' }, { op: 'accept', partyId: 'p1' }],
      [{ op: 'accept', partyId: 'p'.repeat(32) }, { op: 'accept', partyId: 'p'.repeat(32) }],
      [{ op: 'decline', partyId: 'p42' }, { op: 'decline', partyId: 'p42' }],
      [{ op: 'leave' }, { op: 'leave' }],
      [{ op: 'kick', name: 'Moss' }, { op: 'kick', name: 'Moss' }],
      [{ op: 'lead', name: 'Moss' }, { op: 'lead', name: 'Moss' }],
    ];
    for (const [v, want] of good) expect(parsePartyOp(v), JSON.stringify(v)).toEqual(want);

    const bad: unknown[] = [
      null, undefined, 0, 'invite', [], ['invite', 1], {}, { op: 'Invite', eid: 1 }, { op: 'toString' }, { op: 'constructor' },
      { op: 'shout' }, { op: 1 }, { op: null },
      // invite
      { op: 'invite' }, { op: 'invite', eid: NaN }, { op: 'invite', eid: Infinity }, { op: 'invite', eid: -1 }, { op: 'invite', eid: 1.5 },
      { op: 'invite', eid: '3' }, { op: 'invite', eid: 2 ** 60 }, { op: 'invite', eid: 1, name: 'Moss' }, { op: 'invite', name: '' },
      { op: 'invite', name: 'x'.repeat(17) }, { op: 'invite', name: 'x'.repeat(100000) }, { op: 'invite', name: 7 }, { op: 'invite', name: ['Moss'] },
      { op: 'invite', eid: 1, junk: true },
      // accept / decline
      { op: 'accept' }, { op: 'accept', partyId: '' }, { op: 'accept', partyId: 'p'.repeat(33) }, { op: 'accept', partyId: 1 },
      { op: 'decline', partyId: null }, { op: 'decline', partyId: 'p1', extra: 'x' },
      // leave / kick / lead
      { op: 'leave', name: 'Moss' }, { op: 'kick' }, { op: 'kick', name: '' }, { op: 'kick', name: 'x'.repeat(17) },
      { op: 'lead', eid: 3 }, { op: 'lead', name: { toString: () => 'Moss' } },
    ];
    for (const v of bad) expect(parsePartyOp(v), String(JSON.stringify(v))?.slice(0, 80)).toBeNull();

    // a parsed op is a fresh object with only its own fields
    const src = { op: 'kick', name: 'Moss' };
    const out = parsePartyOp(src)!;
    expect(out).not.toBe(src);
    // inherited fields do not count
    const proto = Object.create({ op: 'leave' });
    expect(parsePartyOp(proto)).toBeNull();
  });

  it('PARTY_TEXT has a line for every refusal', () => {
    const all: PartyRefusal[] = ['self', 'unknown', 'in-party', 'full', 'not-leader', 'expired', 'rate', 'not-member', 'in-instance'];
    expect(Object.keys(PARTY_TEXT).sort()).toEqual([...all].sort());
    const lines = Object.values(PARTY_TEXT);
    for (const l of lines) { expect(typeof l).toBe('string'); expect(l.length).toBeGreaterThan(0); expect(l).not.toMatch(/[<>]/); }
    expect(new Set(lines).size).toBe(lines.length);
    expect(Object.isFrozen(PARTY_TEXT)).toBe(true);
  });

  it('REASON_* lines are distinct from every existing REASON_* line', () => {
    const reasons = Object.entries(shared).filter(([k, v]) => k.startsWith('REASON_') && typeof v === 'string') as [string, string][];
    const names = reasons.map(([k]) => k);
    for (const k of ['REASON_INSTANCES_FULL', 'REASON_ARENA_SEALED', 'REASON_INSTANCE_CLOSED', 'REASON_LEFT_PARTY', 'REASON_GROVE_FULL', 'REASON_ELSEWHERE']) expect(names).toContain(k);
    const texts = reasons.map(([, v]) => v);
    expect(new Set(texts).size, JSON.stringify(reasons)).toBe(texts.length);
    // no refusal line repeats a REASON_ line either
    for (const l of Object.values(PARTY_TEXT)) expect(texts).not.toContain(l);
  });
});
