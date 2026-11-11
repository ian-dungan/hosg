// Message shapes between client and server, keyed by message type.
import type { Pose } from './movement';

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
