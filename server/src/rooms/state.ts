// Synchronised zone state: every adventurer in the room (keyed by Colyseus sessionId), and the
// zone's enemies and live telegraphs (keyed by their engine id), mirrored from the combat engine.
import { schema, t, type SchemaType } from '@colyseus/schema';

export const PlayerState = schema(
  {
    name: t.string(),
    // float64, so clients see exactly the position the server checks moves against (t.number() is float32).
    x: t.float64(),
    z: t.float64(),
    /** Height of the feet. */
    y: t.float64(),
    facing: t.float64(),
    moving: t.boolean(),
    /** Health, 1..maxHp while alive (Math.ceil of the engine's), 0 when dead. */
    hp: t.number(),
    maxHp: t.number(),
    /** The adventurer's combat engine id (fx events, enemy targets and telegraph owners use it). */
    eid: t.int32(),
    /** The equipped weapon ('blade' | 'bow'). */
    weapon: t.string(),
    momentum: t.uint8(),
    /** The engine id of the targeted enemy, or -1. */
    target: t.int32(),
    dead: t.boolean(),
    /** '' | 'charge' | 'dodge' | 'knock' | 'dead'. */
    act: t.string(),
    /** Shield points left (Bulwark). */
    shield: t.uint8(),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const EnemyState = schema(
  {
    eid: t.int32(),
    kind: t.string(),
    x: t.float32(),
    z: t.float32(),
    y: t.float32(),
    facing: t.float32(),
    hp: t.uint16(),
    maxHp: t.uint16(),
    stagger: t.uint8(),
    maxStagger: t.uint8(),
    /** Live marks as bits (markBits). */
    marks: t.uint8(),
    /** 'idle' | 'fight' | 'windup' | 'stunned' | 'return' | 'dead'. */
    mode: t.string(),
    /** The engine id of its target, or -1. */
    target: t.int32(),
    /** The attack it is winding up ('' = none), and the wind-up's full length in seconds. */
    windup: t.string(),
    windupTotal: t.float32(),
  },
  'EnemyState',
);
export type EnemyState = SchemaType<typeof EnemyState>;

/** A telegraph on the ground: added when a wind-up starts, never changed, deleted when it resolves or is cancelled. */
export const TelegraphState = schema(
  {
    id: t.int32(),
    /** The enemy's engine id. */
    owner: t.int32(),
    attack: t.string(),
    /** 'circle' | 'cone' | 'line'. */
    shape: t.string(),
    x: t.float32(),
    z: t.float32(),
    /** Direction (cone, line), as `facing`: 0 points +Z. */
    dir: t.float32(),
    /** Radius (circle, cone) or length (line). */
    r: t.float32(),
    /** Line width. */
    width: t.float32(),
    /** Cone full width (rad). */
    angle: t.float32(),
    /** Wind-up length in seconds. */
    total: t.float32(),
  },
  'TelegraphState',
);
export type TelegraphState = SchemaType<typeof TelegraphState>;

export const ZoneState = schema(
  {
    players: t.map(PlayerState),
    enemies: t.map(EnemyState),
    telegraphs: t.map(TelegraphState),
  },
  'ZoneState',
);
export type ZoneState = SchemaType<typeof ZoneState>;
