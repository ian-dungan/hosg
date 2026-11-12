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
  /** When the last pose was accepted (ms). */
  atMs: number;
}

/** A track standing at height y (last accepted at atMs). */
export function makeAirTrack(y: number, atMs = 0): AirTrack {
  return { grounded: true, airStartMs: 0, airStartY: y, peakY: y, y, atMs };
}

/**
 * Puts a track on the ground at groundY (at time atMs); returns how far it fell from its highest point
 * (0 if it was grounded, never negative).
 */
export function landAirTrack(track: AirTrack, groundY: number, atMs = track.atMs): number {
  const drop = track.grounded ? 0 : Math.max(0, Math.max(track.peakY, track.airStartY) - groundY);
  Object.assign(track, makeAirTrack(groundY, atMs));
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
/** Longest gap between two poses in which a landing and a new jump are looked for (after a longer one, the track must come down first). */
const REJUMP_MAX_GAP_S = 2.5 / TICK_HZ;
/** Time added to the gap between two poses for network jitter when checking a landing and a new jump fit in it. */
const REJUMP_JITTER_S = 0.5 / TICK_HZ;
/** Added to the highest accepted height when bounding how fast a body can be falling (its true top may fall between two poses). */
const PEAK_MARGIN = 0.05;

/**
 * Sideways offsets (m) for going round the edge of something the straight line between two poses
 * clips: a body sliding round a tree, a lamp or a corner moves along its edge, and the chord cuts in
 * by about L²/8r for a circle of radius r, up to ~0.15 m at a corner.
 */
const ROUND_THE_EDGE = [0.1, 0.2];
/** Most refused sample points in a row (0.5 m of path) a detour round an edge may stand in for. */
const MAX_DETOUR_SAMPLES = 2;
/** Distance between the points checked along a detour. */
const DETOUR_STEP = 0.05;

/**
 * Highest y a body may have t seconds after leaving the ground at y0: its jump arc
 * y0 + JUMP_SPEED·t − ½·GRAVITY·t² plus STEP_UP + 0.2 m, never above y0 + 2 m.
 */
export function jumpCeiling(y0: number, tSeconds: number): number {
  const t = Math.max(0, tSeconds);
  return Math.min(y0 + JUMP_SPEED * t - 0.5 * GRAVITY * t * t + CEILING_TOLERANCE, y0 + CEILING_CAP);
}

/** The ceiling of an air phase (from airStartY at airStartMs) at time ms: the arc's highest point over [t − slack, t]. */
function arcCeiling(airStartMs: number, airStartY: number, ms: number): number {
  const t = (ms - airStartMs) / 1000;
  return jumpCeiling(airStartY, Math.min(t, Math.max(APEX_S, t - CLOCK_SLACK_S)));
}

/**
 * Horizontal + vertical check of one reported pose. Mutates `track` only when the result is 'ok'.
 * - 'too-fast': further than `allowance` (as checkMove).
 * - 'blocked': the body could not have got from `from` to `to`. Points every WALK_SAMPLE m along the
 *   straight line must have a surface no more than STEP_UP above the body's height there
 *   (interpolated). A run of at most MAX_DETOUR_SAMPLES refused points inside the step is let off if
 *   a detour round them is free: the same points shifted 0.1 or 0.2 m to one side, joined to the free
 *   points either side, checked every DETOUR_STEP m. So an obstacle at least DETOUR_STEP thick that
 *   the line crosses is refused unless a free path within 0.2 m of the line goes round its end. Also
 *   'blocked': no surface at the end, the end below the surface, or a standing body rising more than
 *   STEP_UP without being in the air.
 * - 'floating': in the air (or landing) higher than jumpCeiling allows since the air phase began.
 *   Once that ceiling has fallen below the ground (late messages, a reconnect, a re-join), the arc is
 *   surely over: a landing on the surface no higher than the last accepted height is accepted, and
 *   anything in the air is refused, so an expired track can only come down.
 * - With jump held, a body can land and take off again between two poses (stepBody lands and jumps
 *   in one call), so the landing is never reported. A pose in the air that is higher than the last
 *   one after the arc's top, or above the ceiling, is taken as such a new jump only if the time since
 *   the last pose (at most REJUMP_MAX_GAP_S, plus REJUMP_JITTER_S) holds both a fall from the last
 *   height to some ground along the step, at the fastest the body can be falling (from its highest
 *   point), and a fresh jump from that ground up to the pose, started no earlier than that landing.
 *   That ground must be under the old arc's ceiling at the landing (so no higher than one jump reaches)
 *   and at most STEP_UP above the last height. The landing's drop is reported, and a new air phase
 *   starts from that ground. Holding a height in the air therefore fails: the fall alone takes longer
 *   than a send interval for any height above about 0.1 m.
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
  if (!walkable(from, track.y, to, samples, surface)) return { result: 'blocked', landedDrop: 0 };
  const end = surface(to.x, to.z)!; // walkable checked it
  if (to.y < end - GROUND_EPSILON) return { result: 'blocked', landedDrop: 0 };
  const grounded = to.y <= end + GROUND_EPSILON;

  if (grounded && track.grounded) {
    if (to.y - track.y > STEP_UP) return { result: 'blocked', landedDrop: 0 };
    const landedDrop = Math.max(0, track.y - to.y);
    Object.assign(track, makeAirTrack(to.y, nowMs));
    return { result: 'ok', landedDrop };
  }

  const airStartMs = track.grounded ? nowMs - 1000 / TICK_HZ : track.airStartMs;
  const airStartY = track.grounded ? track.y : track.airStartY;
  const t = (nowMs - airStartMs) / 1000;
  const ceiling = arcCeiling(airStartMs, airStartY, nowMs);
  const arcOver = grounded && !track.grounded && to.y <= track.y + GROUND_EPSILON;
  // Going up again once the arc is surely past its top (a send interval after it, for timing), or
  // above the ceiling: maybe it landed and jumped again in between.
  const risingAgain = to.y > track.y && t > APEX_S + 1 / TICK_HZ;
  if (!grounded && !track.grounded && (risingAgain || to.y > ceiling)) {
    const rejump = rejumpFrom(from, track, to, nowMs, surface, samples);
    if (rejump) {
      const landedDrop = landAirTrack(track, rejump.ground);
      Object.assign(track, {
        grounded: false, airStartMs: rejump.takeoffMs, airStartY: rejump.ground, peakY: Math.max(rejump.ground, to.y), y: to.y, atMs: nowMs,
      });
      return { result: 'ok', landedDrop };
    }
  }
  if (to.y > ceiling && !arcOver) return { result: 'floating', landedDrop: 0 };

  if (grounded) return { result: 'ok', landedDrop: landAirTrack(track, to.y, nowMs) };
  const peakY = track.grounded ? Math.max(track.y, to.y) : Math.max(track.peakY, to.y);
  Object.assign(track, { grounded: false, airStartMs, airStartY, peakY, y: to.y, atMs: nowMs });
  return { result: 'ok', landedDrop: 0 };
}

/**
 * Whether a body at height `y0` at `from` can get to `to` (see 'blocked' in checkPose): every sample
 * point passable, or a run of at most MAX_DETOUR_SAMPLES refused ones with a free detour to one side.
 */
function walkable(from: { x: number; z: number }, y0: number, to: Pose, samples: number, surface: Surface): boolean {
  const dx = to.x - from.x, dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  const sx = length > 0 ? -dz / length : 0, sz = length > 0 ? dx / length : 0; // sideways unit vector
  const point = (i: number, side = 0) => ({
    x: from.x + (dx * i) / samples + sx * side, z: from.z + (dz * i) / samples + sz * side, h: y0 + ((to.y - y0) * i) / samples,
  });
  const passable = (p: { x: number; z: number; h: number }) => {
    const s = surface(p.x, p.z);
    return s !== null && s <= p.h + STEP_UP;
  };
  if (!passable({ x: to.x, z: to.z, h: to.y })) return false;
  const detourFree = (first: number, last: number) => ROUND_THE_EDGE.some((d) => [d, -d].some((side) => {
    const path = [point(first - 1)];
    for (let i = first; i <= last; i++) path.push(point(i, side));
    path.push(point(last + 1));
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / DETOUR_STEP));
      for (let j = 1; j <= n; j++) {
        const f = j / n;
        if (!passable({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, h: a.h + (b.h - a.h) * f })) return false;
      }
    }
    return true;
  }));
  for (let i = 1; i < samples; i++) {
    if (passable(point(i))) continue;
    let last = i;
    while (last + 1 < samples && !passable(point(last + 1))) last++;
    if (last - i + 1 > MAX_DETOUR_SAMPLES || !detourFree(i, last)) return false;
    i = last;
  }
  return true;
}

/**
 * The highest ground along the step that an airborne track could have landed on and jumped from
 * again before reporting `to`, with the time that take-off is taken to be, or null (see checkPose).
 * The highest, because a later pose of that jump is judged from it (a body coming down beside a
 * platform can land on its edge).
 */
function rejumpFrom(
  from: { x: number; z: number }, track: AirTrack, to: Pose, nowMs: number, surface: Surface, samples: number,
): { ground: number; takeoffMs: number } | null {
  const gap = (nowMs - track.atMs) / 1000;
  if (!(gap > 0) || gap > REJUMP_MAX_GAP_S) return null;
  const time = gap + REJUMP_JITTER_S;
  // the fastest it can be coming down at its last pose: falling all the way from its highest point
  const top = Math.max(track.peakY, track.airStartY) + PEAK_MARGIN;
  const v0 = Math.sqrt(2 * GRAVITY * Math.max(0, top - track.y));
  let best: { ground: number; takeoffMs: number } | null = null;
  for (let i = 0; i <= samples; i++) {
    const f = i / samples;
    const s = surface(from.x + (to.x - from.x) * f, from.z + (to.z - from.z) * f);
    if (s === null || s > track.y + STEP_UP || (best !== null && s <= best.ground)) continue;
    const fall = Math.max(0, track.y - s);
    const fallTime = fall > 0 ? (-v0 + Math.sqrt(v0 * v0 + 2 * GRAVITY * fall)) / GRAVITY : 0;
    const left = time - fallTime;
    if (left < 0) continue;
    const landingMs = track.atMs + fallTime * 1000;
    if (s > arcCeiling(track.airStartMs, track.airStartY, landingMs)) continue; // no higher than the old jump reaches
    if (to.y > jumpCeiling(s, Math.min(left, APEX_S))) continue;
    best = { ground: s, takeoffMs: Math.max(landingMs, nowMs - 1000 / TICK_HZ) };
  }
  return best;
}
