// Which session holds each account, across every zone room: an account is online in one room at a
// time, and the newest join wins (the room it is in kicks the older session).
import type { AirTrack, Carry, ZoneId } from '@sg2/shared';
import type { ZoneRoom } from './ZoneRoom';

/**
 * An account's movement allowance: metres it may still move, when that was last refilled (ms), its
 * height in the air or on the ground, and the zone that height is in. Kept per account across
 * sessions and rooms, so neither a new session nor a travel hands out a fresh budget.
 */
export interface Allowance {
  metres: number;
  at: number;
  air: AirTrack;
  zone: ZoneId;
}

export interface Claim {
  room: ZoneRoom;
  sessionId: string;
}

export class Presence {
  private claims = new Map<string, Claim>(); // key: accountId
  /**
   * Online adventurers by lower-case name -> account id (for an invite by name), kept by joins
   * (`named`) and removed when the account goes offline everywhere.
   */
  readonly names = new Map<string, string>();
  /** The name each named account was given (accountId -> name as written). */
  private nameOfAccount = new Map<string, string>();
  /** Told when an account comes online (its first claim) and goes offline everywhere (its last release). */
  private readonly onOnline?: (accountId: string, online: boolean) => void;

  constructor(opts: { onOnline?: (accountId: string, online: boolean) => void } = {}) {
    this.onOnline = opts.onOnline;
  }
  /** Movement allowances by account id, shared by every room (see Allowance). */
  readonly allowances = new Map<string, Allowance>();
  /**
   * Combat state an account's last session left with (cooldowns, dodge charges, Momentum) and when
   * (ms), by account id, shared by every room: the next join, in any zone, picks it up, so relogging
   * resets nothing. Forgotten once taken, or once everything would have been ready anyway.
   */
  readonly carries = new Map<string, { carry: Carry; at: number }>();
  /**
   * Accounts saved as respawned (a death) that have not joined the respawn zone since, and until when
   * (ms): their join there is always admitted, however full it is (deaths may push the respawn zone
   * past maxPlayers by design).
   */
  readonly respawns = new Map<string, number>();

  /** The session that holds the account now, if any (a copy). */
  get(accountId: string): Claim | undefined {
    const claim = this.claims.get(accountId);
    return claim && { ...claim };
  }

  /** Gives the account to this session; returns the claim it replaced, whose session the caller kicks. */
  claim(accountId: string, room: ZoneRoom, sessionId: string): Claim | undefined {
    const previous = this.claims.get(accountId);
    this.claims.set(accountId, { room, sessionId });
    if (!previous) this.onOnline?.(accountId, true);
    return previous;
  }

  /** The account's adventurer is called `name` (a join, once the name is loaded): findable by it while online. */
  named(accountId: string, name: string): void {
    if (!this.claims.has(accountId)) return;
    const old = this.nameOfAccount.get(accountId);
    if (old !== undefined && this.names.get(old.toLowerCase()) === accountId) this.names.delete(old.toLowerCase());
    this.nameOfAccount.set(accountId, name);
    this.names.set(name.toLowerCase(), accountId);
  }

  /** The name of an online, named account. */
  nameOf(accountId: string): string | undefined {
    return this.nameOfAccount.get(accountId);
  }

  /** Frees the account, but only if this session still holds it (a stale release does nothing). */
  release(accountId: string, sessionId: string): void {
    if (this.claims.get(accountId)?.sessionId !== sessionId) return;
    this.claims.delete(accountId);
    const name = this.nameOfAccount.get(accountId);
    this.nameOfAccount.delete(accountId);
    if (name !== undefined && this.names.get(name.toLowerCase()) === accountId) this.names.delete(name.toLowerCase());
    this.onOnline?.(accountId, false);
  }

  /** Accounts online (joining, in a room, or inside a reconnect window). */
  get size(): number {
    return this.claims.size;
  }
}
