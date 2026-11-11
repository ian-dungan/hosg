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
 *   than STEP_UP above the body's height there (interpolated); the end is below the surface; or a
 *   standing body rose more than STEP_UP without being in the air.
 * - 'floating': in the air (or landing) higher than jumpCeiling allows since the air phase began.
 *   Once that ceiling has fallen below the ground (late messages, a reconnect, a re-join), the arc is
 *   surely over: a landing on the surface no higher than the last accepted height is accepted, and
 *   anything in the air is refused, so an expired track can only come down.
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
  let end = 0;
  for (let i = 1; i <= samples; i++) {
    const f = i / samples;
    const x = i === samples ? to.x : from.x + dx * f;
    const z = i === samples ? to.z : from.z + dz * f;
    const s = surface(x, z);
    if (s === null || s > track.y + (to.y - track.y) * f + STEP_UP) return { result: 'blocked', landedDrop: 0 };
    end = s;
  }
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
  if (to.y > ceiling && !arcOver) return { result: 'floating', landedDrop: 0 };

  if (grounded) return { result: 'ok', landedDrop: landAirTrack(track, to.y) };
  const peakY = track.grounded ? Math.max(track.y, to.y) : Math.max(track.peakY, to.y);
  Object.assign(track, { grounded: false, airStartMs, airStartY, peakY, y: to.y });
  return { result: 'ok', landedDrop: 0 };
}
