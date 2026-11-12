// The party registry: one per server process, in memory only (a restart dissolves every party).
// It alone decides who is in which party, who leads, and which invites are open; rooms ask it and
// relay what it says. Every map here is pruned: parties when they dissolve, invites when answered,
// expired or their party dissolves, invite-rate entries a minute after their last invite.
import {
  JOB_IDS,
  PARTY_INVITE_S,
  PARTY_INVITES_PER_MIN,
  PARTY_LEADER_AWAY_S,
  PARTY_MAX,
  PARTY_OFFLINE_KEEP_S,
  type JobId,
  type PartyRefusal,
  type PartyView,
  type ZoneId,
} from '@sg2/shared';

/** What a member's room last reported of it (relayed to the other members at most PARTY_STATUS_HZ). */
export interface MemberStatus { zone: ZoneId; roomId: string; eid: number; job: JobId; level: number; hp: number; maxHp: number; dead: boolean; searing: number }

export interface Party {
  id: string;
  leader: string;
  /** In join order (the longest-standing first). */
  members: { accountId: string; name: string; joinedAt: number; offlineSince: number | null; status: MemberStatus | null }[];
}

type Member = Party['members'][number];

interface Invite { partyId: string; from: string; fromName: string; to: string; until: number }

const RATE_WINDOW_MS = 60_000;

const sameStatus = (a: MemberStatus | null, b: MemberStatus | null) =>
  a === b || (a !== null && b !== null && a.zone === b.zone && a.roomId === b.roomId && a.eid === b.eid && a.job === b.job
    && a.level === b.level && a.hp === b.hp && a.maxHp === b.maxHp && a.dead === b.dead && a.searing === b.searing);

export class Parties {
  private readonly now: () => number;
  private next = 1;
  private readonly parties = new Map<string, Party>();
  /** accountId -> its party's id. */
  private readonly byAccount = new Map<string, string>();
  /** `${partyId} ${to}` -> the open invite. */
  private readonly invites = new Map<string, Invite>();
  /** A party id kept for an adventurer not in a party, carried by its invites until one is accepted. */
  private readonly soloIds = new Map<string, string>();
  /** When each adventurer's invites in the last minute were sent (ms), oldest first, at most PARTY_INVITES_PER_MIN. */
  private readonly rates = new Map<string, number[]>();
  private readonly listeners: ((partyId: string, accountIds: readonly string[]) => void)[] = [];

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
  }

  /** Parties now (for /healthz). */
  get size(): number {
    return this.parties.size;
  }

  /** The sizes of every map (tests and health: nothing grows without bound). */
  counts(): { parties: number; invites: number; rates: number; members: number } {
    return { parties: this.parties.size, invites: this.invites.size, rates: this.rates.size, members: this.byAccount.size };
  }

  partyOf(accountId: string): Party | undefined {
    const id = this.byAccount.get(accountId);
    return id === undefined ? undefined : this.parties.get(id);
  }

  /** Called with every member of the party before and after each change of its members, leader or online flags. */
  onChange(cb: (partyId: string, accountIds: readonly string[]) => void): void {
    this.listeners.push(cb);
  }

  /**
   * An invite from `from` (the leader, or anyone not in a party) to `to`: refused, or open for
   * PARTY_INVITE_S (a second invite from the same party refreshes it). Every attempt counts toward
   * PARTY_INVITES_PER_MIN, whatever its outcome (so does inviteUnknown).
   */
  invite(from: { accountId: string; name: string }, to: { accountId: string; name: string }): PartyRefusal | { partyId: string; size: number } {
    if (!this.spend(from.accountId)) return 'rate';
    if (from.accountId === to.accountId) return 'self';
    const party = this.partyOf(from.accountId);
    if (party && party.leader !== from.accountId) return 'not-leader';
    if (this.byAccount.has(to.accountId)) return 'in-party';
    if (party && party.members.length >= PARTY_MAX) return 'full';
    let partyId = party?.id;
    if (partyId === undefined) {
      partyId = this.soloIds.get(from.accountId) ?? this.newId();
      this.soloIds.set(from.accountId, partyId);
    }
    this.invites.set(`${partyId} ${to.accountId}`, { partyId, from: from.accountId, fromName: from.name, to: to.accountId, until: this.now() + PARTY_INVITE_S * 1000 });
    return { partyId, size: party?.members.length ?? 1 };
  }

  /** An invite to nobody the room could find: 'rate' past the limit, else 'unknown' (it counts as an attempt). */
  inviteUnknown(fromAccountId: string): 'rate' | 'unknown' {
    return this.spend(fromAccountId) ? 'unknown' : 'rate';
  }

  /** Joins party `partyId` on its open invite: the party after, or why not. Any other invites to it are dropped. */
  accept(accountId: string, name: string, partyId: string): PartyRefusal | Party {
    if (this.byAccount.has(accountId)) return 'in-party';
    const key = `${partyId} ${accountId}`;
    const invite = this.invites.get(key);
    if (!invite || invite.until <= this.now()) {
      if (invite) this.invites.delete(key);
      return 'expired';
    }
    let party = this.parties.get(partyId);
    const before = party ? party.members.map((m) => m.accountId) : [];
    if (party) {
      if (party.members.length >= PARTY_MAX) return 'full';
    } else {
      // The inviter's own party, made now: it must still be on its own.
      if (this.soloIds.get(invite.from) !== partyId || this.byAccount.has(invite.from)) {
        this.invites.delete(key);
        return 'expired';
      }
      this.soloIds.delete(invite.from);
      party = { id: partyId, leader: invite.from, members: [this.member(invite.from, invite.fromName)] };
      this.parties.set(partyId, party);
      this.byAccount.set(invite.from, partyId);
    }
    party.members.push(this.member(accountId, name));
    this.byAccount.set(accountId, partyId);
    for (const [k, inv] of this.invites) if (inv.to === accountId) this.invites.delete(k);
    this.dropSoloInvites(accountId);
    this.changed(party, before);
    return party;
  }

  decline(accountId: string, partyId: string): void {
    this.invites.delete(`${partyId} ${accountId}`);
  }

  /** Out of its party: the party as it is after, or undefined (no party, or it dissolved). */
  leave(accountId: string): Party | undefined {
    const party = this.partyOf(accountId);
    if (!party) return undefined;
    return this.remove(party, accountId);
  }

  kick(leader: string, name: string): PartyRefusal | { kicked: string; party: Party | undefined } {
    const found = this.leaderAndMember(leader, name);
    if (typeof found === 'string') return found;
    return { kicked: found.member.accountId, party: this.remove(found.party, found.member.accountId) };
  }

  lead(leader: string, name: string): PartyRefusal | Party {
    const found = this.leaderAndMember(leader, name);
    if (typeof found === 'string') return found;
    const before = found.party.members.map((m) => m.accountId);
    found.party.leader = found.member.accountId;
    this.changed(found.party, before);
    return found.party;
  }

  /** The member's status from its room; true if it changed (false for anyone not in a party). */
  setStatus(accountId: string, s: MemberStatus | null): boolean {
    const m = this.memberOf(accountId);
    if (!m || sameStatus(m.status, s)) return false;
    m.status = s && { ...s };
    return true;
  }

  /** The member's last status (null if none or not in a party). */
  statusOf(accountId: string): MemberStatus | null {
    return this.memberOf(accountId)?.status ?? null;
  }

  /** The member left room `roomId` (its status there is stale): no eid now, the rest kept. True if it changed. */
  clearRoom(accountId: string, roomId: string): boolean {
    const m = this.memberOf(accountId);
    if (!m?.status || m.status.roomId !== roomId) return false;
    m.status = { ...m.status, roomId: '', eid: -1 };
    return true;
  }

  /** The account is online somewhere (a session in any room, or inside a reconnect window), or not. */
  setOnline(accountId: string, online: boolean): void {
    const party = this.partyOf(accountId);
    const m = party && this.memberOf(accountId);
    if (!party || !m || (m.offlineSince === null) === online) return;
    m.offlineSince = online ? null : this.now();
    this.changed(party, party.members.map((x) => x.accountId));
  }

  /** Drops expired invites and stale rate entries; removes long-offline members; hands on an away leader's lead. */
  sweep(): void {
    const now = this.now();
    for (const [k, inv] of this.invites) if (inv.until <= now) this.invites.delete(k);
    for (const [id, times] of this.rates) if (times.length === 0 || times[times.length - 1] <= now - RATE_WINDOW_MS) this.rates.delete(id);
    const carried = new Set<string>();
    for (const inv of this.invites.values()) carried.add(inv.partyId);
    for (const [id, partyId] of this.soloIds) if (!carried.has(partyId)) this.soloIds.delete(id);
    for (const party of [...this.parties.values()]) {
      for (const m of [...party.members]) {
        if (m.offlineSince !== null && now - m.offlineSince >= PARTY_OFFLINE_KEEP_S * 1000 && this.parties.has(party.id)) this.remove(party, m.accountId);
      }
      if (!this.parties.has(party.id)) continue;
      const leader = party.members.find((m) => m.accountId === party.leader)!;
      if (leader.offlineSince === null || now - leader.offlineSince < PARTY_LEADER_AWAY_S * 1000) continue;
      const heir = party.members.find((m) => m.offlineSince === null);
      if (!heir) continue;
      const before = party.members.map((m) => m.accountId);
      party.leader = heir.accountId;
      this.changed(party, before);
    }
  }

  /** The party as a member in room `forRoomId` sees it: engine ids only for members in that room. */
  view(party: Party, forRoomId: string | null): PartyView {
    return {
      id: party.id,
      members: party.members.map((m) => {
        const s = m.status, online = m.offlineSince === null;
        return {
          name: m.name, leader: m.accountId === party.leader, online,
          zone: online && s ? s.zone : null,
          eid: online && s && forRoomId !== null && s.roomId === forRoomId ? s.eid : -1,
          job: s?.job ?? JOB_IDS[0], level: s?.level ?? 1, hp: s?.hp ?? 0, maxHp: s?.maxHp ?? 0, dead: s?.dead ?? false, searing: s?.searing ?? 0,
        };
      }),
    };
  }

  // ───────── inside ─────────

  private newId(): string {
    return `p${this.next++}`;
  }

  private member(accountId: string, name: string): Member {
    return { accountId, name, joinedAt: this.now(), offlineSince: null, status: null };
  }

  private memberOf(accountId: string): Member | undefined {
    return this.partyOf(accountId)?.members.find((m) => m.accountId === accountId);
  }

  /** One more invite from this adventurer, if it is within the minute's limit. */
  private spend(accountId: string): boolean {
    const now = this.now();
    let times = this.rates.get(accountId);
    if (!times) this.rates.set(accountId, (times = []));
    while (times.length > 0 && times[0] <= now - RATE_WINDOW_MS) times.shift();
    if (times.length >= PARTY_INVITES_PER_MIN) return false;
    times.push(now);
    return true;
  }

  /** Invites carrying the solo id an adventurer kept (it is in a party now): gone. */
  private dropSoloInvites(accountId: string) {
    const solo = this.soloIds.get(accountId);
    if (solo === undefined) return;
    this.soloIds.delete(accountId);
    for (const [k, inv] of this.invites) if (inv.partyId === solo) this.invites.delete(k);
  }

  private leaderAndMember(leader: string, name: string): PartyRefusal | { party: Party; member: Member } {
    const party = this.partyOf(leader);
    if (!party) return 'not-member';
    if (party.leader !== leader) return 'not-leader';
    const lower = name.toLowerCase();
    const member = party.members.find((m) => m.name.toLowerCase() === lower);
    if (!member) return 'not-member';
    if (member.accountId === leader) return 'self';
    return { party, member };
  }

  /** Takes a member out; the longest-standing one left leads if the leader went; one left alone dissolves it. */
  private remove(party: Party, accountId: string): Party | undefined {
    const before = party.members.map((m) => m.accountId);
    party.members = party.members.filter((m) => m.accountId !== accountId);
    this.byAccount.delete(accountId);
    if (party.leader === accountId && party.members.length > 0) party.leader = party.members[0].accountId;
    if (party.members.length <= 1) {
      for (const m of party.members) this.byAccount.delete(m.accountId);
      party.members = [];
      this.parties.delete(party.id);
      for (const [k, inv] of this.invites) if (inv.partyId === party.id) this.invites.delete(k);
      this.emit(party.id, before);
      return undefined;
    }
    this.changed(party, before);
    return party;
  }

  private changed(party: Party, before: readonly string[]) {
    const all = new Set(before);
    for (const m of party.members) all.add(m.accountId);
    this.emit(party.id, [...all]);
  }

  private emit(partyId: string, accountIds: readonly string[]) {
    for (const cb of this.listeners) cb(partyId, accountIds);
  }
}
