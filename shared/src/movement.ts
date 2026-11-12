// Movement messages: parsing a client's pose and checking a step (and its height) is possible.
import { GRAVITY, JUMP_SPEED, RUN_SPEED, STEP_UP, TICK_HZ } from './constants';
import type { Surface } from './body';

/** y: the height of the adventurer's feet. */
export interface Pose { x: number; z: number; y: number; facing: number; moving: boolean }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A clean Pose (known fields only), or null unless x, z, y and facing are finite numbers and moving is a boolean. */
export function parsePose(msg: unknown): Pose | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (!finite(m.x) || !finite(m.z) || !finite(m.y) || !finite(m.facing) || typeof m.moving !== 'boolean') return null;
  return { x: m.x, z: m.z, y: m.y, facing: m.facing, moving: m.moving };
}

/** Fastest an adventurer may move, in m/s: running speed plus 30% for timing jitter. */
export const MAX_MOVE_SPEED = RUN_SPEED * 1.3;
/** Extra distance allowed on top of the speed limit, for jitter. Granted once, as part of the allowance cap. */
export const STEP_SLACK = 0.5;
/** Most distance an adventurer can bank: one second of movement plus the slack. */
export const MAX_MOVE_ALLOWANCE = MAX_MOVE_SPEED * 1 + STEP_SLACK;
/** Distance between the points checked along a step, so thin obstacles cannot be stepped over. */
const WALK_SAMPLE = 0.25;
/**
 * Sideways offsets (m) tried at a refused point inside a step. A body sliding round a tree, a lamp
 * or a corner moves along its edge, and the straight line between two of its poses cuts into it (by
 * about L²/8r for a circle of radius r, up to ~0.15 m at a corner): if a point this far to either side
 * is free, the body went round. A wall across the whole step is still refused.
 */
const ROUND_THE_EDGE = [0.1, 0.2];

type Walkable = (x: number, z: number) => boolean;

const clampDt = (dtSeconds: number) => (Number.isFinite(dtSeconds) ? Math.min(1, Math.max(0, dtSeconds)) : 0);

/**
 * A movement allowance after `dtSeconds` more: it refills at MAX_MOVE_SPEED and is capped at
 * MAX_MOVE_ALLOWANCE. A non-finite or negative dt adds nothing.
 */
export function refillAllowance(allowance: number, dtSeconds: number): number {
  const dt = Number.isFinite(dtSeconds) ? Math.max(0, dtSeconds) : 0;
  return Math.min(MAX_MOVE_ALLOWANCE, allowance + MAX_MOVE_SPEED * dt);
}

/**
 * Whether an adventurer at `from` can move to `to` with `allowance` metres left: 'too-fast' if the
 * step is longer, 'blocked' if any point along it (every WALK_SAMPLE m, and the end) is not walkable.
 */
export function checkMove(
  from: { x: number; z: number },
  to: Pose,
  allowance: number,
  walkable: Walkable,
): 'ok' | 'too-fast' | 'blocked' {
  const dx = to.x - from.x, dz = to.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance > allowance) return 'too-fast';
  const samples = Math.max(1, Math.ceil(distance / WALK_SAMPLE));
  for (let i = 1; i <= samples; i++) {
    const x = i === samples ? to.x : from.x + (dx * i) / samples;
    const z = i === samples ? to.z : from.z + (dz * i) / samples;
    if (!walkable(x, z)) return 'blocked';
  }
  return 'ok';
}

/**
 * A single step on its own: `checkMove` with the allowance earned in `dtSeconds` (capped at 1 s, a
 * non-finite dt counts as 0) plus the slack. The server uses `checkMove` with a running allowance
 * instead, so the slack cannot be claimed again on every message.
 */
export function checkStep(
  from: { x: number; z: number },
  to: Pose,
  dtSeconds: number,
  walkable: Walkable,
): 'ok' | 'too-fast' | 'blocked' {
  return checkMove(from, to, MAX_MOVE_SPEED * clampDt(dtSeconds) + STEP_SLACK, walkable);
}

// ───────── height ─────────

/** What the server knows of an adventurer's height: standing, or in the air since airStartMs from airStartY. */
export interface AirTrack {
  grounded: boolean;
  /** When the current air phase began (ms; meaningless while grounded). */
  airStartMs: number;
  /** Height the current air phase began at. */
  airStartY: number;
  /** Highest accepted height since leaving the ground. */
  peakY: number;
  /** Last accepted height. */
  y: number;
}

/** A track standing at height y. */
export function makeAirTrack(y: number): AirTrack {
  return { grounded: true, airStartMs: 0, airStartY: y, peakY: y, y };
}

/** Puts a track on the ground at groundY; returns how far it fell from its highest point (0 if it was grounded, never negative). */
export function landAirTrack(track: AirTrack, groundY: number): number {
  const drop = track.grounded ? 0 : Math.max(0, Math.max(track.peakY, track.airStartY) - groundY);
  Object.assign(track, makeAirTrack(groundY));
  return drop;
}

/**
 * Room above a jump's arc: a rising body that clears a rim by less than STEP_UP is lifted onto it
 * (see stepBody), so it can be up to STEP_UP above the plain arc; plus 0.2 m, so the ceiling at the
 * apex (≈ 2.0 m) is at least 0.15 m above the highest rim stepBody clears (1.80 m, measured in
 * movement.test.ts at 15, 30 and 60 frames a second).
 */
const CEILING_TOLERANCE = STEP_UP + 0.2;
/** Most height an air phase may reach above its take-off. */
const CEILING_CAP = 2.0;
/** Seconds the server's clock may run ahead of a client's (messages delayed, then on time): the arc may be that much later. */
const CLOCK_SLACK_S = 0.25;
/** A pose within this of the surface is standing on it. */
const GROUND_EPSILON = 0.05;
/** Seconds from take-off to the top of a full jump. */
const APEX_S = JUMP_SPEED / GRAVITY;
/** Longest gap between two poses a landing and a new jump are looked for in: one and a half send intervals. */
const REJUMP_GAP_S = 1.5 / TICK_HZ;

/**
 * Highest y a body may have t seconds after leaving the ground at y0: its jump arc
 * y0 + JUMP_SPEED·t − ½·GRAVITY·t² plus STEP_UP + 0.2 m, never above y0 + 2 m.
 */
export function jumpCeiling(y0: number, tSeconds: number): number {
  const t = Math.max(0, tSeconds);
  return Math.min(y0 + JUMP_SPEED * t - 0.5 * GRAVITY * t * t + CEILING_TOLERANCE, y0 + CEILING_CAP);
}

/**
 * Horizontal + vertical check of one reported pose. Mutates `track` only when the result is 'ok'.
 * - 'too-fast': further than `allowance` (as checkMove).
 * - 'blocked': some point along the step (every WALK_SAMPLE m, and the end) has no surface or one more
 *   than STEP_UP above the body's height there (interpolated), and, inside the step, no free point
 *   ROUND_THE_EDGE to either side; the end is below the surface; or a standing body rose more than
 *   STEP_UP without being in the air.
 * - 'floating': in the air (or landing) higher than jumpCeiling allows since the air phase began.
 *   Once that ceiling has fallen below the ground (late messages, a reconnect, a re-join), the arc is
 *   surely over: a landing on the surface no higher than the last accepted height is accepted, and
 *   anything in the air is refused, so an expired track can only come down.
 * - With jump held, a body can land and take off again between two poses (stepBody lands and jumps
 *   in one call), so the landing is never reported. A pose in the air that is higher than the last
 *   one after the arc's top (an arc never rises again once it falls) or above the ceiling is taken
 *   as such a new jump when some point along the step has ground the body could have come down to
 *   within REJUMP_GAP_S at the speed it falls from its highest point (no more than STEP_UP above the
 *   last height), and the pose is no higher than a jump from that ground reaches in that time. The
 *   landing's drop is reported, and a new air phase starts from that ground, so the height gained is
 *   never more than one jump above it.
 * landedDrop: on landing (or dropping straight onto lower ground), how far it fell (never negative).
 */
export function checkPose(
  from: { x: number; z: number },
  track: AirTrack,
  to: Pose,
  nowMs: number,
  allowance: number,
  surface: Surface,
): { result: 'ok' | 'too-fast' | 'blocked' | 'floating'; landedDrop: number } {
  const dx = to.x - from.x, dz = to.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance > allowance) return { result: 'too-fast', landedDrop: 0 };
  const samples = Math.max(1, Math.ceil(distance / WALK_SAMPLE));
  // sideways unit vector, for going round the edge of something the straight line clips
  const sx = distance > 0 ? -dz / distance : 0, sz = distance > 0 ? dx / distance : 0;
  const passable = (x: number, z: number, h: number) => {
    const s = surface(x, z);
    return s !== null && s <= h + STEP_UP;
  };
  for (let i = 1; i < samples; i++) {
    const f = i / samples;
    const x = from.x + dx * f, z = from.z + dz * f, h = track.y + (to.y - track.y) * f;
    if (passable(x, z, h)) continue;
    if (!ROUND_THE_EDGE.some((d) => passable(x + sx * d, z + sz * d, h) || passable(x - sx * d, z - sz * d, h))) {
      return { result: 'blocked', landedDrop: 0 };
    }
  }
  const end = surface(to.x, to.z);
  if (end === null || end > to.y + STEP_UP) return { result: 'blocked', landedDrop: 0 };
  if (to.y < end - GROUND_EPSILON) return { result: 'blocked', landedDrop: 0 };
  const grounded = to.y <= end + GROUND_EPSILON;

  if (grounded && track.grounded) {
    if (to.y - track.y > STEP_UP) return { result: 'blocked', landedDrop: 0 };
    const landedDrop = Math.max(0, track.y - to.y);
    Object.assign(track, makeAirTrack(to.y));
    return { result: 'ok', landedDrop };
  }

  const airStartMs = track.grounded ? nowMs - 1000 / TICK_HZ : track.airStartMs;
  const airStartY = track.grounded ? track.y : track.airStartY;
  const t = (nowMs - airStartMs) / 1000;
  // the arc's highest point over [t − slack, t]: it rises until APEX_S, then falls
  const ceiling = jumpCeiling(airStartY, Math.min(t, Math.max(APEX_S, t - CLOCK_SLACK_S)));
  const arcOver = grounded && !track.grounded && to.y <= track.y + GROUND_EPSILON;
  // Going up again once the arc is surely past its top (a send interval after it, for timing), or
  // above the ceiling: maybe it landed and jumped again in between.
  const risingAgain = to.y > track.y && t > APEX_S + 1 / TICK_HZ;
  if (!grounded && !track.grounded && (risingAgain || to.y > ceiling)) {
    const ground = rejumpGround(from, track, to, surface, samples);
    if (ground !== null) {
      const landedDrop = landAirTrack(track, ground);
      Object.assign(track, { grounded: false, airStartMs: nowMs - 1000 / TICK_HZ, airStartY: ground, peakY: Math.max(ground, to.y), y: to.y });
      return { result: 'ok', landedDrop };
    }
  }
  if (to.y > ceiling && !arcOver) return { result: 'floating', landedDrop: 0 };

  if (grounded) return { result: 'ok', landedDrop: landAirTrack(track, to.y) };
  const peakY = track.grounded ? Math.max(track.y, to.y) : Math.max(track.peakY, to.y);
  Object.assign(track, { grounded: false, airStartMs, airStartY, peakY, y: to.y });
  return { result: 'ok', landedDrop: 0 };
}

/**
 * The highest ground along the step (from `from` to `to`, at `samples` + 1 points) that an airborne
 * track could have landed on and jumped from again before reporting `to`, or null if there is none.
 * The highest, because a later pose of that jump is judged from it (a body coming down beside a
 * platform can land on its edge); it is never more than STEP_UP above the last height.
 */
function rejumpGround(from: { x: number; z: number }, track: AirTrack, to: Pose, surface: Surface, samples: number): number | null {
  const top = Math.max(track.peakY, track.airStartY);
  let best: number | null = null;
  for (let i = 0; i <= samples; i++) {
    const f = i / samples;
    const s = surface(from.x + (to.x - from.x) * f, from.z + (to.z - from.z) * f);
    if (s === null || s > track.y + STEP_UP || (best !== null && s <= best)) continue;
    const fallReach = Math.sqrt(2 * GRAVITY * Math.max(0, top - s)) * REJUMP_GAP_S + GROUND_EPSILON;
    if (track.y - s <= fallReach && to.y <= jumpCeiling(s, REJUMP_GAP_S)) best = s;
  }
  return best;
}
