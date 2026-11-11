// Message shapes between client and server, keyed by message type, and the reasons the server
// gives when it refuses a join or ends a session (the client recognises them by exact text).
import type { Pose } from './movement';

/** A join refused because the account's adventurer has no name yet. */
export const REASON_NAME_FIRST = 'Name your adventurer first';
/** A session ended because the same account joined from somewhere else. */
export const REASON_SIGNED_IN_ELSEWHERE = 'Signed in somewhere else';
/** A join refused because the grove holds MAX_PLAYERS adventurers. */
export const REASON_GROVE_FULL = 'Shady Grove is full, try again soon';

/** Client → server. */
export type C2S = {
  move: Pose;
  chat: { text: string };
};

/** Server → client. */
export type S2C = {
  chat: { from: string; text: string };
  correct: { x: number; z: number };
  kicked: { reason: string };
};
