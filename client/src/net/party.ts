// The client's party state, from the server's `party`, `partyStatus`, `partyInvite` and `partyRefused`.
// Pure (no DOM, no room): online.ts feeds it the messages and reads it for the HUD. The server decides
// everything; this only remembers what it said, applies the compact status lines to the last view, and
// keeps the pending invites (queued, refreshed by a second invite from the same party, expired after
// PARTY_INVITE_S).
import { PARTY_INVITE_S, PARTY_MAX, type PartyMemberView, type PartyView, type S2C } from '@sg2/shared';

/** An invite waiting for an answer: expiresAt is on the clock passed in (ms). */
export interface PendingInvite { partyId: string; from: string; size: number; expiresAt: number }

/** Refusal lines kept (the last ones). */
const REFUSALS_KEPT = 20;

export interface PartyState {
  /** The party as last heard (members in join order, self included), or null. */
  readonly view: PartyView | null;
  /** Pending invites, oldest first. */
  readonly invites: readonly PendingInvite[];
  /** The last refusal lines (PARTY_TEXT), oldest first. */
  readonly refusals: readonly string[];
  /** A `party`: the new view (null: no party). joined/left: whether this starts or ends being in a party. */
  onParty(m: S2C['party']): { joined: boolean; left: boolean };
  /** A `partyStatus`: each line's fields onto member `i` of the last view (lines for no member are ignored). */
  onStatus(m: S2C['partyStatus']): void;
  /** A `partyInvite`: queued, or refreshed (fresh: false) when that party's invite is already pending. */
  onInvite(m: S2C['partyInvite'], nowMs: number): { invite: PendingInvite; fresh: boolean };
  onRefused(m: S2C['partyRefused']): void;
  /** Drops the invites that have expired by `nowMs` and returns them. */
  expire(nowMs: number): PendingInvite[];
  /** The invite was answered (accepted or declined): it is no longer pending. */
  answered(partyId: string): void;
  /** The member named `name` (exact), or null. */
  member(name: string): PartyMemberView | null;
  /** The member with engine id `eid` in this room (eid ≥ 0), or null. */
  memberByEid(eid: number): PartyMemberView | null;
  /** Whether `name` leads the party. */
  leads(name: string): boolean;
  /** Whether `me` may invite now: without a party (a solo invite starts one), or as the leader of a party that is not full. */
  canInvite(me: string): boolean;
  /** Leaving a room: engine ids are unique only within a room, so no member keeps one (the next room's view sends its own). */
  clearEids(): void;
  /** Forgets everything (a sign-out). */
  reset(): void;
}

export function createPartyState(inviteS = PARTY_INVITE_S): PartyState {
  let view: PartyView | null = null;
  const invites: PendingInvite[] = [];
  const refusals: string[] = [];
  const s: PartyState = {
    get view() { return view; },
    get invites() { return invites; },
    get refusals() { return refusals; },
    onParty(m) {
      const was = view !== null;
      view = m.party ? { id: m.party.id, members: m.party.members.map((x) => ({ ...x })) } : null;
      // accepting drops the other invites on the server too
      if (view) invites.length = 0;
      return { joined: !was && view !== null, left: was && view === null };
    },
    onStatus(m) {
      if (!view || !Array.isArray(m.m)) return;
      for (const line of m.m) {
        const mem = view.members[line.i];
        if (!mem) continue;
        if (line.hp !== undefined) mem.hp = line.hp;
        if (line.maxHp !== undefined) mem.maxHp = line.maxHp;
        if (line.dead !== undefined) mem.dead = line.dead;
        if (line.searing !== undefined) mem.searing = line.searing;
        if (line.job !== undefined) mem.job = line.job;
        if (line.level !== undefined) mem.level = line.level;
      }
    },
    onInvite(m, now) {
      const expiresAt = now + inviteS * 1000;
      const had = invites.find((i) => i.partyId === m.partyId);
      if (had) { had.from = m.from; had.size = m.size; had.expiresAt = expiresAt; return { invite: had, fresh: false }; }
      const invite = { partyId: m.partyId, from: m.from, size: m.size, expiresAt };
      invites.push(invite);
      return { invite, fresh: true };
    },
    onRefused(m) {
      refusals.push(m.text);
      if (refusals.length > REFUSALS_KEPT) refusals.splice(0, refusals.length - REFUSALS_KEPT);
    },
    expire(now) {
      const gone: PendingInvite[] = [];
      for (let i = invites.length - 1; i >= 0; i--) if (invites[i].expiresAt <= now) gone.unshift(...invites.splice(i, 1));
      return gone;
    },
    answered(partyId) {
      const i = invites.findIndex((x) => x.partyId === partyId);
      if (i >= 0) invites.splice(i, 1);
    },
    member(name) { return view?.members.find((x) => x.name === name) ?? null; },
    memberByEid(eid) { return eid >= 0 ? view?.members.find((x) => x.eid === eid) ?? null : null; },
    leads(name) { return !!view?.members.some((x) => x.leader && x.name === name); },
    canInvite(me) { return view === null || (s.leads(me) && view.members.length < PARTY_MAX); },
    clearEids() { if (view) for (const m of view.members) m.eid = -1; },
    reset() { view = null; invites.length = 0; refusals.length = 0; },
  };
  return s;
}
