// Synchronised zone state: every adventurer in the room, keyed by Colyseus sessionId.
import { schema, t, type SchemaType } from '@colyseus/schema';

export const PlayerState = schema(
  {
    name: t.string(),
    // float64, so clients see exactly the position the server checks moves against (t.number() is float32).
    x: t.float64(),
    z: t.float64(),
    facing: t.float64(),
    moving: t.boolean(),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const ZoneState = schema(
  {
    players: t.map(PlayerState),
  },
  'ZoneState',
);
export type ZoneState = SchemaType<typeof ZoneState>;
