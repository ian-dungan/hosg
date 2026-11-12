// Message shapes between client and server, keyed by message type, and the reasons the server
// gives when it refuses a join or ends a session (the client recognises them by exact text).
import type { Pose } from './movement';
import type { ZoneId } from './world/zones';

/** A join refused because the account's adventurer has no name yet. */
export const REASON_NAME_FIRST = 'Name your adventurer first';
/** A session ended because the same account joined from somewhere else. */
export const REASON_SIGNED_IN_ELSEWHERE = 'Signed in somewhere else';
/** A join refused because the grove holds MAX_PLAYERS adventurers. */
export const REASON_GROVE_FULL = 'Shady Grove is full, try again soon';
/**
 * A join refused because the adventurer is saved in another zone: the client asks GET /api/zone
 * where it is and joins that zone's room instead.
 */
export const REASON_ELSEWHERE = 'Your adventurer is somewhere else';
/** Travel through an open exit that could not be saved (the adventurer stays where it was). */
export const REASON_TRAVEL_FAILED = 'The way is blocked for now, try again soon';

/** Client → server. */
export type C2S = {
  move: Pose;
  chat: { text: string };
};

/** Server → client. */
export type S2C = {
  chat: { from: string; text: string };
  /** The move was refused: go back to the last accepted pose. */
  correct: { x: number; z: number; y: number };
  /** Health lost (already taken off the adventurer's hp). */
  hurt: { amount: number; cause: 'fall' };
  kicked: { reason: string };
  /**
   * The adventurer walked through an open exit and is now saved in `zone`, at that exit's arrival
   * point. The server ends this session (consented) right after: the client joins the room named `zone`.
   */
  travel: { zone: ZoneId };
  /** A short line to show the player (for example why an exit refused them). */
  notice: { text: string };
};
