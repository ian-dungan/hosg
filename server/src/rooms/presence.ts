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
  /**
   * Accounts between rooms (a travel: released by the room it left, not claimed yet by the next), and
   * until when (ms): still online and findable by name meanwhile.
   */
  private readonly travellers = new Map<string, number>();
  private loggedAt = -Infinity;
  private readonly now: () => number;

  constructor(opts: { onOnline?: (accountId: string, online: boolean) => void; now?: () => number } = {}) {
    this.onOnline = opts.onOnline;
    this.now = opts.now ?? Date.now;
  }

  /** Tells onOnline; a throw there is logged (throttled) and never leaves a claim half made or released. */
  private tell(accountId: string, online: boolean) {
    try {
      this.onOnline?.(accountId, online);
    } catch (err) {
      const now = Date.now();
      if (now - this.loggedAt >= 60_000) {
        this.loggedAt = now;
        console.error('An online listener failed (logged at most once a minute):', err);
      }
    }
  }

  /** The account is between rooms (travelling): released, but still online and named. */
  isTravelling(accountId: string): boolean {
    return (this.travellers.get(accountId) ?? -Infinity) > this.now();
  }

  /** Travellers that never arrived go offline (called every few seconds). */
  sweep(): void {
    const now = this.now();
    for (const [accountId, until] of this.travellers) {
      if (until > now) continue;
      this.travellers.delete(accountId);
      if (!this.claims.has(accountId)) this.gone(accountId);
    }
  }

  /** Accounts between rooms now (tests and health). */
  get travelling(): number {
    return this.travellers.size;
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

  /**
   * An ended session's inventory write still in flight, per account (it is atomic and lands once): the
   * account's next join waits for it before reading the store. Entries go once it settles.
   */
  private readonly invFlights = new Map<string, Promise<void>>();
  /** Holds the account's next join until `flight` settles. */
  inventoryInFlight(accountId: string, flight: Promise<void>): void {
    const entry = flight.catch(() => {}).finally(() => { if (this.invFlights.get(accountId) === entry) this.invFlights.delete(accountId); });
    this.invFlights.set(accountId, entry);
  }
  /** Resolves once no ended session's inventory write for the account is in flight. */
  inventorySettled(accountId: string): Promise<void> {
    return this.invFlights.get(accountId) ?? Promise.resolve();
  }

  /** The session that holds the account now, if any (a copy). */
  get(accountId: string): Claim | undefined {
    const claim = this.claims.get(accountId);
    return claim && { ...claim };
  }

  /** Gives the account to this session; returns the claim it replaced, whose session the caller kicks. */
  claim(accountId: string, room: ZoneRoom, sessionId: string): Claim | undefined {
    const previous = this.claims.get(accountId);
    this.claims.set(accountId, { room, sessionId });
    const arriving = this.travellers.delete(accountId);
    if (!previous && !arriving) this.tell(accountId, true);
    return previous;
  }

  /** The account's adventurer is called `name` (a join, once the name is loaded): findable by it while online. */
  named(accountId: string, name: string): void {
    if (!this.claims.has(accountId) && !this.travellers.has(accountId)) return;
    const old = this.nameOfAccount.get(accountId);
    if (old !== undefined && this.names.get(old.toLowerCase()) === accountId) this.names.delete(old.toLowerCase());
    this.nameOfAccount.set(accountId, name);
    this.names.set(name.toLowerCase(), accountId);
  }

  /** The name of an online, named account. */
  nameOf(accountId: string): string | undefined {
    return this.nameOfAccount.get(accountId);
  }

  /**
   * Frees the account, but only if this session still holds it (a stale release does nothing). With
   * `travelMs`, the account is travelling: it stays online and named for that long, until its next claim.
   */
  release(accountId: string, sessionId: string, travelMs?: number): void {
    if (this.claims.get(accountId)?.sessionId !== sessionId) return;
    this.claims.delete(accountId);
    if (travelMs !== undefined && travelMs > 0) {
      this.travellers.set(accountId, this.now() + travelMs);
      return;
    }
    this.gone(accountId);
  }

  /** Offline everywhere: no name, and onOnline hears. */
  private gone(accountId: string) {
    this.travellers.delete(accountId);
    const name = this.nameOfAccount.get(accountId);
    this.nameOfAccount.delete(accountId);
    if (name !== undefined && this.names.get(name.toLowerCase()) === accountId) this.names.delete(name.toLowerCase());
    this.tell(accountId, false);
  }

  /** Accounts online (joining, in a room, or inside a reconnect window). */
  get size(): number {
    return this.claims.size;
  }
}
