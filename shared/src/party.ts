// Parties: constants, refusals, the party request a client may send, and the party as a client sees it.
// The server decides everything (membership, invites, leaders); clients only ask.
import { deepFreeze } from './combat/freeze';
import type { JobId } from './combat/jobs';
import type { ZoneId } from './world/zones';

/** Members, the leader included. */
export const PARTY_MAX = 4;
/** An invite expires after this (s). */
export const PARTY_INVITE_S = 60;
/** Invites one adventurer may send per minute (more → 'rate'). */
export const PARTY_INVITES_PER_MIN = 10;
/** A member signed out (no session anywhere) stays in the party this long (s). */
export const PARTY_OFFLINE_KEEP_S = 300;
/** An offline leader hands the lead on after this (s), to the longest-standing online member. */
export const PARTY_LEADER_AWAY_S = 60;
/** Member status (hp, zone, job, dead) is relayed at most this often (Hz), only when it changed. */
export const PARTY_STATUS_HZ = 2;
/** Party members in the same room within this (m) of a kill share its credit. */
export const PARTY_SHARE_R = 60;

/** Longest party id a client may send. */
export const PARTY_ID_MAX = 32;
/** Shortest and longest adventurer name a party request may carry. */
export const PARTY_NAME_MIN = 1;
export const PARTY_NAME_MAX = 16;

export type PartyRefusal = 'self' | 'unknown' | 'in-party' | 'full' | 'not-leader' | 'expired' | 'rate' | 'not-member' | 'in-instance';

/** A fixed English line for each refusal (shown as plain text). */
export const PARTY_TEXT: Readonly<Record<PartyRefusal, string>> = deepFreeze({
  self: 'You cannot invite yourself',
  unknown: 'No adventurer by that name is online',
  'in-party': 'That adventurer is already in a party',
  full: 'That party is full',
  'not-leader': 'Only the party leader can do that',
  expired: 'That invite is no longer open',
  rate: 'Too many invites, wait a moment',
  'not-member': 'That adventurer is not in your party',
  'in-instance': 'Leave the Lampfall first',
});

/** A party request: invite by engine id (a tap) or by name (any room), answer an invite, leave, kick or promote. */
export type PartyOp =
  | { op: 'invite'; eid: number } | { op: 'invite'; name: string }
  | { op: 'accept'; partyId: string } | { op: 'decline'; partyId: string }
  | { op: 'leave' } | { op: 'kick'; name: string } | { op: 'lead'; name: string };

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isName = (v: unknown): v is string => typeof v === 'string' && v.length >= PARTY_NAME_MIN && v.length <= PARTY_NAME_MAX;
const isPartyId = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= PARTY_ID_MAX;
const isEid = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/**
 * A party request from a client, or null. Strict: a plain object with exactly its op's own fields (no
 * others), of the right types: names 1–16 characters, party ids 1–32, engine ids non-negative integers.
 * Returns a fresh object.
 */
export function parsePartyOp(v: unknown): PartyOp | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!own(o, 'op') || typeof o.op !== 'string') return null;
  const keys = Object.keys(o);
  const only = (...ks: string[]) => keys.length === ks.length + 1 && ks.every((k) => own(o, k));
  switch (o.op) {
    case 'invite':
      if (only('eid') && isEid(o.eid)) return { op: 'invite', eid: o.eid };
      if (only('name') && isName(o.name)) return { op: 'invite', name: o.name };
      return null;
    case 'accept':
    case 'decline':
      return only('partyId') && isPartyId(o.partyId) ? { op: o.op, partyId: o.partyId } : null;
    case 'leave':
      return only() ? { op: 'leave' } : null;
    case 'kick':
    case 'lead':
      return only('name') && isName(o.name) ? { op: o.op, name: o.name } : null;
    default:
      return null;
  }
}

/** One member as another member sees it. */
export interface PartyMemberView {
  name: string; leader: boolean; online: boolean;
  /** null while offline. */
  zone: ZoneId | null;
  /** -1 unless in the receiver's room. */
  eid: number;
  job: JobId; level: number; hp: number; maxHp: number; dead: boolean;
  /** Searing stacks (0..5). */
  searing: number;
}
/** A party as a member sees it: members in join order. */
export interface PartyView { id: string; members: PartyMemberView[] }
