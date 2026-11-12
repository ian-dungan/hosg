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
    /** The current job's weapon (JOBS[job].weapon): 'blade' | 'bow' | 'sword' | 'greatsword' | 'daggers' | 'staff'. */
    weapon: t.string(),
    /** The engine id of the targeted enemy, or -1. */
    target: t.int32(),
    dead: t.boolean(),
    /** '' | 'charge' | 'dodge' | 'knock' | 'dead'. */
    act: t.string(),
    /** Shield points left (Bulwark, Dawn Ward, Mistveil, ...). */
    shield: t.uint8(),
    /** The current job (a JobId). */
    job: t.string(),
    /**
     * The ability being cast ('' = none), its full cast time in seconds, and when it began on the zone's
     * `clock` (as TelegraphState.at). Unset (read as '' and 0) until the adventurer's first cast.
     */
    cast: t.string(),
    castTotal: t.float32(),
    castAt: t.uint32(),
    /** Live buffs as bits (BUFF_BITS); unset (read as 0) until the first buff. */
    buffs: t.uint8(),
    /** Searing stacks (0–5; the Warden's autos); unset (read as 0) until the first. */
    searing: t.uint8(),
    // Plan 5: each changes only on an event. (The look and gear codes are not here: they go in `looks`
    // messages, once per client per adventurer and on change, so a view's churn never re-sends them.)
    /** The current job's level (1–10). */
    level: t.uint8(),
    /** The zone `clock` step of the last level-up (0: none yet): others play the effect when it changes. */
    lvlAt: t.uint32(),
    /** The last emote (an EmoteId; unset until the first), and its `clock` step: a change plays it; a move cancels it on clients. */
    emote: t.string(),
    emoteAt: t.uint32(),
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
    /** Live debuffs as bits (DEBUFF_BITS); unset (read as 0) until the first debuff. */
    debuffs: t.uint8(),
    /** The kind's tier: 'elite' | 'boss' | 'mega'; unset (read as '' or undefined) for 'ordinary'. */
    tier: t.string(),
    /** A boss's phase, 0-based (lore.phases[phase] is its banner); during a transition already the next one. Unset (0) otherwise. */
    phase: t.uint8(),
    /** A ward add lives: the boss takes reduced damage. */
    warded: t.boolean(),
    /** When the boss enrages (or enraged), on the zone's `clock`; 0 = no enrage clock running (asleep, no enrage, not a boss). */
    enrageAt: t.uint32(),
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
    /** 'circle' | 'cone' | 'line' | 'ring'. */
    shape: t.string(),
    x: t.float32(),
    z: t.float32(),
    /** Direction (cone, line), as `facing`: 0 points +Z. */
    dir: t.float32(),
    /** Radius (circle, cone, the ring's outer edge) or length (line). */
    r: t.float32(),
    /** A ring's inner radius (inside when inner ≤ d ≤ r: the Cinder Ring's safe middle); unset (0) for other shapes. */
    inner: t.float32(),
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

/** A standing hazard (a boss's fire ring): added when it starts, never changed, deleted when it ends. Every client gets every one. */
export const FieldState = schema(
  {
    id: t.int32(),
    /** The enemy's engine id. */
    owner: t.int32(),
    /** The FieldId ('lampfire', 'lampfire_deep'). */
    field: t.string(),
    /** 'ring' | 'circle' (the Shape kind, in world coordinates). */
    shape: t.string(),
    x: t.float32(),
    z: t.float32(),
    /** Outer radius. */
    r: t.float32(),
    /** A ring's inner radius (0 for a circle). */
    inner: t.float32(),
    /** Raw damage of each tick (one a second from `at` + 1 s). */
    raw: t.uint8(),
    /** When it started, on the zone's `clock`. */
    at: t.uint32(),
  },
  'FieldState',
);
export type FieldState = SchemaType<typeof FieldState>;

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
    /**
     * Standing hazards: every client's view holds every one (a view map all the same: an unfiltered map
     * beside the filtered ones made every patch dearer, about +10% in the clustered grove).
     */
    fields: t.map(FieldState).view(),
    /** A Lampfall instance's room id ('' in a shared zone room). */
    instance: t.string(),
    /** The boss room whose gate is sealed now (an EncounterId: 'wickhound' | 'warden'), or ''. */
    sealed: t.string(),
    /**
     * Shut lamp-gates as bits (GATE_WICK, GATE_WICK_EXIT, GATE_PIT from @sg2/shared): each shut gate
     * circle is a wall (gatedSurface), for prediction exactly as the server applies it. 0 outside instances.
     */
    gates: t.uint8(),
    /** During a wipe: the clock step when everyone gets up at the checkpoint; 0 = none. */
    wipeAt: t.uint32(),
    /** The lamp-lift (the Lens Pit's exit) is open: the Warden has fallen in this instance. */
    lift: t.boolean(),
  },
  'ZoneState',
);
export type ZoneState = SchemaType<typeof ZoneState>;
