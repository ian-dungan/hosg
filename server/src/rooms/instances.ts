// The Lampfall's instances: one private room per party (a solo adventurer is a party of one, keyed
// 'solo:' + accountId), at most MAX_INSTANCES open at once. The registry opens them (one open at a time
// per key, the cap checked atomically), says who may join each (`allowed`: the party at entry and anyone
// who joins the party later), holds seats for travellers and drops, follows party changes (a member who
// leaves or is kicked is sent out; a dissolved party's instance stays its last member's), and closes them:
// empty ones after INSTANCE_EMPTY_S, cleared and empty ones at once, any past INSTANCE_MAX_S (everyone
// inside is sent to the mouth first). Every map here is pruned when its instance closes.
import { INSTANCE_EMPTY_S, INSTANCE_MAX_S, MAX_INSTANCES, REASON_INSTANCE_CLOSED } from '@sg2/shared';
import type { Parties } from '../party/parties';
import type { ZoneRoom } from './ZoneRoom';

export interface InstanceInfo {
  key: string;
  roomId: string;
  room: ZoneRoom | null;
  allowed: Set<string>;
  createdAt: number;
  emptySince: number | null;
  cleared: boolean;
  /** accountId → until (ms): a seat held for a traveller on its way in (or a drop). */
  heldFor: Map<string, number>;
  /** Closing: nobody new gets in, and the next entry by its key opens a fresh one. */
  closing: boolean;
}

export interface InstancesOptions {
  max?: number;
  emptyMs?: number;
  maxMs?: number;
  now?: () => number;
  /** Opens the room (matchMaker.createRoom('lampfall', { instanceKey })) and resolves with its roomId. */
  open: (key: string) => Promise<string>;
  log?: (what: string, err: unknown) => void;
}

export class Instances {
  private readonly max: number;
  private readonly emptyMs: number;
  private readonly maxMs: number;
  private readonly now: () => number;
  private readonly open: (key: string) => Promise<string>;
  private readonly log: (what: string, err: unknown) => void;
  /** Open instances by key (a party id or 'solo:' + accountId). */
  private readonly byKeyMap = new Map<string, InstanceInfo>();
  /** Instances being opened, by key: a second entry waits for the first one's open. */
  private readonly opening = new Map<string, Promise<InstanceInfo | 'full'>>();
  /** Rooms that registered before their open resolved (onCreate runs inside createRoom), by key. */
  private readonly early = new Map<string, ZoneRoom>();
  /** Instances closing (out of byKeyMap, not disposed yet), by room id. */
  private readonly closingRooms = new Map<string, InstanceInfo>();

  constructor(opts: InstancesOptions) {
    this.max = opts.max ?? MAX_INSTANCES;
    this.emptyMs = opts.emptyMs ?? INSTANCE_EMPTY_S * 1000;
    this.maxMs = opts.maxMs ?? INSTANCE_MAX_S * 1000;
    this.now = opts.now ?? Date.now;
    this.open = opts.open;
    this.log = opts.log ?? ((what, err) => console.error(what, err));
  }

  /** The key of an account's instance: its party's id, or 'solo:' + accountId. */
  keyFor(accountId: string, parties: Parties): string {
    return parties.partyOf(accountId)?.id ?? `solo:${accountId}`;
  }

  /** Whether an entry by `key` can get in now (its instance is open, or there is room for another). */
  canEnter(key: string): boolean {
    return this.byKeyMap.has(key) || this.opening.has(key) || this.openCount < this.max;
  }

  /**
   * The account into the key's instance, opening it if needed (one open at a time per key; the cap is
   * checked before any await, so two keys racing for the last slot cannot both open). `members` are
   * allowed too (the party at entry). 'full' when MAX_INSTANCES are open (or opening) already.
   */
  async enter(key: string, accountId: string, members: Iterable<string> = []): Promise<InstanceInfo | 'full'> {
    const allow = (info: InstanceInfo) => {
      info.allowed.add(accountId);
      for (const m of members) info.allowed.add(m);
      return info;
    };
    const open = this.byKeyMap.get(key);
    if (open) return allow(open);
    const pending = this.opening.get(key);
    if (pending) {
      const r = await pending;
      return r === 'full' ? r : allow(r);
    }
    if (this.openCount >= this.max) return 'full';
    const opened = (async (): Promise<InstanceInfo | 'full'> => {
      const roomId = await this.open(key);
      const info: InstanceInfo = {
        key, roomId, room: this.early.get(key) ?? null, allowed: new Set(), createdAt: this.now(), emptySince: null, cleared: false,
        heldFor: new Map(), closing: false,
      };
      this.early.delete(key);
      this.byKeyMap.set(key, info);
      return info;
    })();
    this.opening.set(key, opened);
    try {
      const r = await opened;
      return r === 'full' ? r : allow(r);
    } finally {
      this.opening.delete(key);
      this.early.delete(key);
    }
  }

  /** Whether a room for `key` is being opened by enter now (only then may an instance room be created). */
  expects(key: string): boolean {
    return this.opening.has(key) && !this.early.has(key);
  }

  /** An instance room registers itself (its onCreate) under its key. */
  attach(key: string, room: ZoneRoom): void {
    const info = this.byKeyMap.get(key);
    if (info && info.roomId === room.roomId) info.room = room;
    else this.early.set(key, room);
  }

  /** The instance a room id belongs to (open or closing). */
  byRoom(roomId: string): InstanceInfo | undefined {
    for (const info of this.byKeyMap.values()) if (info.roomId === roomId) return info;
    return this.closingRooms.get(roomId);
  }

  byKey(key: string): InstanceInfo | undefined {
    return this.byKeyMap.get(key);
  }

  /** Holds a seat in the room for the account for `ms` (a travel on its way in). */
  hold(accountId: string, roomId: string, ms: number): void {
    const info = this.byRoom(roomId);
    if (info) info.heldFor.set(accountId, this.now() + ms);
  }

  /** The open instance the account has a seat in (in the room, away within its window, or held), if it is allowed there. */
  heldRoom(accountId: string): string | undefined {
    return this.instanceOf(accountId)?.roomId;
  }

  instanceOf(accountId: string): InstanceInfo | undefined {
    const now = this.now();
    for (const info of this.byKeyMap.values()) {
      if (info.closing || !info.allowed.has(accountId)) continue;
      if ((info.heldFor.get(accountId) ?? -Infinity) > now || info.room?.hasSeat(accountId)) return info;
    }
    return undefined;
  }

  /** The account's held seats end (it joined, or it will not come). */
  release(accountId: string): void {
    for (const info of this.byKeyMap.values()) info.heldFor.delete(accountId);
  }

  /** Instances open now (and opening). */
  get count(): number {
    return this.openCount;
  }

  private get openCount(): number {
    let n = this.opening.size;
    for (const key of this.byKeyMap.keys()) if (!this.opening.has(key)) n++;
    return n;
  }

  /** Adventurers in instances now (reconnect windows included). */
  get players(): number {
    let n = 0;
    for (const info of this.byKeyMap.values()) n += info.room?.playerCount ?? 0;
    return n;
  }

  /** The worst step p95 (ms) among open instances. */
  get tickMsP95Max(): number {
    let m = 0;
    for (const info of this.byKeyMap.values()) m = Math.max(m, info.room?.tickMsP95 ?? 0);
    return m;
  }

  /** Sizes of every map (tests and health: nothing outlives its instance). */
  counts(): { open: number; opening: number; early: number; closing: number; held: number } {
    let held = 0;
    for (const info of this.byKeyMap.values()) held += info.heldFor.size;
    return { open: this.byKeyMap.size, opening: this.opening.size, early: this.early.size, closing: this.closingRooms.size, held };
  }

  /** The room marks its instance cleared (the Warden fell). */
  markCleared(roomId: string): void {
    const info = this.byRoom(roomId);
    if (info) info.cleared = true;
  }

  /**
   * Closes empty instances after emptyMs (at once if cleared) and any past maxMs (everyone inside sent to
   * the mouth first, with a notice). Expired holds are dropped. Called every few seconds.
   */
  sweep(): void {
    const now = this.now();
    for (const info of [...this.byKeyMap.values()]) {
      for (const [id, until] of info.heldFor) if (until <= now) info.heldFor.delete(id);
      if (!info.room) continue; // (still opening)
      const occupied = info.room.playerCount > 0 || info.heldFor.size > 0 || info.room.hasArrivals();
      if (occupied) info.emptySince = null;
      else info.emptySince ??= now;
      if (now - info.createdAt >= this.maxMs) this.close(info, REASON_INSTANCE_CLOSED);
      else if (!occupied && (info.cleared || now - (info.emptySince ?? now) >= this.emptyMs)) this.close(info);
    }
  }

  /** Out of the registry now; the room sends everyone out (with `reason`) and disconnects. */
  close(info: InstanceInfo, reason?: string): void {
    if (info.closing) return;
    info.closing = true;
    if (this.byKeyMap.get(info.key) === info) this.byKeyMap.delete(info.key);
    this.closingRooms.set(info.roomId, info);
    const room = info.room;
    if (!room) return void this.closingRooms.delete(info.roomId);
    void room.closeInstance(reason).catch((err) => this.log('Closing an instance failed:', err)).finally(() => this.closingRooms.delete(info.roomId));
  }

  /** The room went away (disposed): nothing of it is kept. */
  disposed(roomId: string): void {
    for (const [key, info] of this.byKeyMap) if (info.roomId === roomId) this.byKeyMap.delete(key);
    this.closingRooms.delete(roomId);
    for (const [key, room] of this.early) if (room.roomId === roomId) this.early.delete(key);
  }

  /**
   * A party changed (Parties.onChange): its instance (keyed by its id) allows every member now; a member
   * taken out (`left`) is no longer allowed and its room sends it out after INSTANCE_EVICT_S. A party that
   * formed around someone inside a solo instance makes that instance the party's; a party that dissolved
   * leaves its instance to the member who stayed.
   */
  partyChanged(partyId: string, accountIds: readonly string[], left: string | undefined, parties: Parties): void {
    const party = parties.get(partyId);
    let info = this.byKeyMap.get(partyId);
    if (party) {
      if (!info) {
        // members are inside solo instances: the first (the leader's first) becomes the party's
        const order = [party.leader, ...party.members.map((m) => m.accountId)];
        const solo = order.map((a) => this.byKeyMap.get(`solo:${a}`)).find((i) => i !== undefined);
        if (solo) info = this.rekey(solo, partyId);
      }
      if (info) for (const m of party.members) info.allowed.add(m.accountId);
    } else if (info) {
      // dissolved: the instance is its remaining member's own now (a solo run)
      const stayed = accountIds.find((a) => a !== left && info!.allowed.has(a) && !parties.partyOf(a));
      if (stayed !== undefined && !this.byKeyMap.has(`solo:${stayed}`)) info = this.rekey(info, `solo:${stayed}`);
    }
    if (left !== undefined) {
      const from = info ?? this.byKeyMap.get(partyId);
      if (from && from.allowed.delete(left)) {
        from.heldFor.delete(left);
        from.room?.evict(left);
      }
    }
  }

  private rekey(info: InstanceInfo, key: string): InstanceInfo {
    if (this.byKeyMap.get(info.key) === info) this.byKeyMap.delete(info.key);
    info.key = key;
    this.byKeyMap.set(key, info);
    info.room?.rekeyed(key);
    return info;
  }
}
