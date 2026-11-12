// Which session holds each account, across every zone room: an account is online in one room at a
// time, and the newest join wins (the room it is in kicks the older session).
import type { AirTrack, ZoneId } from '@sg2/shared';
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
  /** Movement allowances by account id, shared by every room (see Allowance). */
  readonly allowances = new Map<string, Allowance>();

  /** The session that holds the account now, if any (a copy). */
  get(accountId: string): Claim | undefined {
    const claim = this.claims.get(accountId);
    return claim && { ...claim };
  }

  /** Gives the account to this session; returns the claim it replaced, whose session the caller kicks. */
  claim(accountId: string, room: ZoneRoom, sessionId: string): Claim | undefined {
    const previous = this.claims.get(accountId);
    this.claims.set(accountId, { room, sessionId });
    return previous;
  }

  /** Frees the account, but only if this session still holds it (a stale release does nothing). */
  release(accountId: string, sessionId: string): void {
    if (this.claims.get(accountId)?.sessionId === sessionId) this.claims.delete(accountId);
  }

  /** Accounts online (joining, in a room, or inside a reconnect window). */
  get size(): number {
    return this.claims.size;
  }
}
