// Synchronised zone state: the adventurers in the room (keyed by Colyseus sessionId), and the zone's
// enemies and live telegraphs (keyed by their engine id), mirrored from the combat engine. Each
// client sees only those within its interest radius, and the zone's head count as `online`.
import { schema, t, type SchemaType } from '@colyseus/schema';
import { STATE_XZ_LIMIT_M, STATE_Y_MAX_M, STATE_Y_MIN_M } from '@sg2/shared';

/**
 * Positions and facings are quantised on the wire (the client's decoder turns them back into plain
 * numbers, via the schema reflection: no client code knows). The state is what others are drawn
 * from; the positions the server checks moves against stay exact on the server (Session.lastGood) and
 * in its messages (correct, displaced, respawned).
 * - x, z: 16 bits over [-512, 512) m, a step of 1/64 m (1.6 cm); zones fit well inside (the
 *   Greenway is 260 × 180 m).
 * - y (feet height): 16 bits over [-64, 192) m, a step of 1/256 m (0.4 cm).
 * - facing: 8 bits around the circle, a step of 1.4° (read back in [0, 2π)).
 * The ranges are powers of two read as wrapping, so every multiple of a step (whole metres, a flat
 * floor at 0) comes back exactly. A change smaller than a step sends nothing: the quantisation is the
 * dead band.
 */
// The ranges are shared/src/world/limits.ts's STATE_* limits: every zone must fit inside them (the
// zone registry and the generator throw otherwise), since a value outside would wrap.
const pos = () => t.quantized({ min: -STATE_XZ_LIMIT_M, max: STATE_XZ_LIMIT_M, mode: 'wrap' });
const height = () => t.quantized({ min: STATE_Y_MIN_M, max: STATE_Y_MAX_M, mode: 'wrap' });
const facing = () => t.angle({ bits: 8 });

export const PlayerState = schema(
  {
    name: t.string(),
    x: pos(),
    z: pos(),
    /** Height of the feet. */
    y: height(),
    facing: facing(),
    moving: t.boolean(),
    /** Health, 1..maxHp while alive (Math.ceil of the engine's), 0 when dead. */
    hp: t.number(),
    maxHp: t.number(),
    /** The adventurer's combat engine id (fx events, enemy targets and telegraph owners use it). */
    eid: t.int32(),
    /** The equipped weapon ('blade' | 'bow'). */
    weapon: t.string(),
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
    x: pos(),
    z: pos(),
    y: height(),
    facing: facing(),
    hp: t.uint16(),
    /** Scaled with the adventurers it fights (elites): it can change. */
    maxHp: t.uint16(),
    /** Uint16: an elite's bar scales with the adventurers it fights (×3.1 at 4: 310). */
    stagger: t.uint16(),
    maxStagger: t.uint16(),
    /** Live marks as bits (markBits). */
    marks: t.uint8(),
    /** 'idle' | 'fight' | 'windup' | 'stunned' | 'return' | 'dead'. */
    mode: t.string(),
    /** The engine id of its target, or -1. */
    target: t.int32(),
    /** The attack it is winding up ('' = none), and the wind-up's full length in seconds. */
    windup: t.string(),
    windupTotal: t.float32(),
    /** The chase surge is on (it runs faster to catch up). */
    surging: t.boolean(),
    /** Seconds until its stagger bar can fill again (after a break); 0 = it can. */
    staggerImmune: t.float32(),
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
    /**
     * When the wind-up began, on the zone's `clock` (steps of 1/TICK_HZ s): a client that first sees it
     * late knows how far along it is ((clock - at) / TICK_HZ s). An enemy's wind-up starts with its
     * telegraph (every attack has one): the telegraph whose owner it is.
     */
    at: t.uint32(),
  },
  'TelegraphState',
);
export type TelegraphState = SchemaType<typeof TelegraphState>;

/**
 * The three maps are filtered per client (`.view()`): each client's StateView holds itself and what is
 * within its interest radius (see interest.ts), so its `players` is NOT everyone in the zone; `online`
 * is the zone's true head count (everyone in `players` on the server, reconnect windows included).
 */
export const ZoneState = schema(
  {
    players: t.map(PlayerState).view(),
    enemies: t.map(EnemyState).view(),
    telegraphs: t.map(TelegraphState).view(),
    online: t.uint16(),
    /** The combat clock in steps of 1/TICK_HZ s (TelegraphState.at is on it). */
    clock: t.uint32(),
  },
  'ZoneState',
);
export type ZoneState = SchemaType<typeof ZoneState>;
