// Movement messages: parsing a client's pose and checking a step (and its height) is possible.
import { GRAVITY, JUMP_SPEED, RUN_SPEED, STEP_UP, TICK_HZ } from './constants';
import type { Surface } from './body';

/**
 * y: the height of the adventurer's feet. ack: the last displacement (dodge or knockback) the client
 * has applied, as the server numbered it (0 = none yet), so the server can ignore poses sent before it.
 */
export interface Pose { x: number; z: number; y: number; facing: number; moving: boolean; ack?: number }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Largest displacement ack a pose may carry. */
const MAX_ACK = 2 ** 31 - 1;

/**
 * A clean Pose (known fields only), or null unless x, z, y and facing are finite numbers, moving is a
 * boolean, and ack is missing (taken as 0) or an integer from 0 to 2³¹−1.
 */
export function parsePose(msg: unknown): Pose | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (!finite(m.x) || !finite(m.z) || !finite(m.y) || !finite(m.facing) || typeof m.moving !== 'boolean') return null;
  const ack = m.ack === undefined ? 0 : m.ack;
  if (typeof ack !== 'number' || !Number.isInteger(ack) || ack < 0 || ack > MAX_ACK) return null;
  return { x: m.x, z: m.z, y: m.y, facing: m.facing, moving: m.moving, ack };
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
 * A movement allowance after `dtSeconds` more at speed scale `scale` (1.4 while sprinting, 0.4 while
 * charging): it refills at MAX_MOVE_SPEED·scale and is capped at MAX_MOVE_ALLOWANCE·max(1, scale), so
 * a slow scale never lowers the cap. A non-finite or negative dt adds nothing; a non-finite scale counts
 * as 1 and a negative one as 0.
 */
export function refillAllowance(allowance: number, dtSeconds: number, scale = 1): number {
  const dt = Number.isFinite(dtSeconds) ? Math.max(0, dtSeconds) : 0;
  const k = Number.isFinite(scale) ? Math.max(0, scale) : 1;
  return Math.min(MAX_MOVE_ALLOWANCE * Math.max(1, k), allowance + MAX_MOVE_SPEED * k * dt);
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
 *
 * What it guarantees is a height and reach bound, not that the body touches the ground: a pose is
 * never more than one jump (CEILING_CAP, 2 m) above real ground the body was over (where its air
 * phase began, or ground along the step it is taken to have jumped from again), a single take-off
 * never stands on ground more than 2.00 m above where it began (measured by a brute-force search in
 * the task report; the standing tolerance GROUND_EPSILON adds nothing, because a standing track
 * keeps the surface height, not the reported one, and a landing is judged by its surface), every
 * step is within the allowance and clear of walls and gaps, and drops are charged between surfaces. A bounded hover within one jump of real ground is
 * accepted, since a player holding jump is in the air almost all the time anyway: game rules must
 * never treat "airborne" as avoiding ground effects unless the server simulates it.
 *
 * - 'too-fast': further than `allowance`.
 * - 'blocked': the body could not have got from `from` to `to`. Points every WALK_SAMPLE (0.25 m)
 *   along the straight line must have a surface no more than STEP_UP above the body's height there
 *   (interpolated), so an obstacle thinner than that can fall between two points (the thinnest in
 *   the grove is 0.32 m). A run of at most MAX_DETOUR_SAMPLES refused points inside the step is let
 *   off if a detour round them is free: the same points shifted 0.1 or 0.2 m to one side, joined to
 *   the free points either side, checked every DETOUR_STEP m, so going round the end of something
 *   the line clips is fine but crossing it is not. Also 'blocked': no surface at the end, the end
 *   below the surface, or a standing body (grounded before and after) whose surface rises more than
 *   STEP_UP between two neighbouring points of the step: it would have had to jump. Such a body is
 *   charged a fall (landedDrop) only if the step goes over a ledge (a drop of more than STEP_UP
 *   between neighbouring points), so walking down a slope in one long step costs nothing.
 * - 'floating': higher than the air phase's ceiling (jumpCeiling since it began, with clock slack),
 *   unless one of these explains it:
 *   - landing, once the ceiling has fallen below the ground (late messages, a reconnect, a re-join):
 *     a pose on a surface no higher than the last accepted height is accepted;
 *   - jumping again: with jump held, stepBody can land and take off again between two poses, so the
 *     landing is never reported; and after a frame hitch a take-off can be longer ago than the one
 *     send interval assumed. A pose in the air above the ceiling is taken as a jump from the
 *     highest ground along the step that is at most STEP_UP above the last height and at most
 *     CEILING_CAP above where the air phase began, if the pose is within one jump of that ground.
 *     The drop from the phase's highest point to that ground is reported, and a new air phase starts
 *     from it. No timing is assumed, so frame hitches, jitter and bunched messages do not matter.
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
    let prev = track.y, overLedge = false;
    for (let i = 1; i <= samples; i++) {
      const s = i === samples ? end : surface(from.x + (dx * i) / samples, from.z + (dz * i) / samples);
      if (s === null || s > track.y + ((to.y - track.y) * i) / samples + STEP_UP) continue; // gone round an edge
      if (s - prev > STEP_UP) return { result: 'blocked', landedDrop: 0 };
      if (prev - s > STEP_UP) overLedge = true;
      prev = s;
    }
    const landedDrop = overLedge ? Math.max(0, track.y - end) : 0;
    Object.assign(track, makeAirTrack(end)); // the surface, not the reported height (it may be 5 cm off)
    return { result: 'ok', landedDrop };
  }

  const airStartMs = track.grounded ? nowMs - 1000 / TICK_HZ : track.airStartMs;
  const airStartY = track.grounded ? track.y : track.airStartY;
  const ceiling = arcCeiling(airStartMs, airStartY, nowMs);
  // a landing is judged by the surface it stands on, so the standing tolerance never adds height
  if ((grounded ? Math.max(to.y, end) : to.y) > ceiling) {
    // landed (the arc is surely over) on ground no higher than it last was
    if (grounded && !track.grounded && end <= track.y) {
      return { result: 'ok', landedDrop: landAirTrack(track, end) };
    }
    // (landed and) jumped since the last pose, longer ago than the send interval assumed (a frame hitch)
    const ground = grounded ? null : rejumpGround(from, track, to, surface, samples);
    if (ground === null) return { result: 'floating', landedDrop: 0 };
    const landedDrop = landAirTrack(track, ground);
    Object.assign(track, { grounded: false, airStartMs: nowMs - 1000 / TICK_HZ, airStartY: ground, peakY: Math.max(ground, to.y), y: to.y });
    return { result: 'ok', landedDrop };
  }

  if (grounded) return { result: 'ok', landedDrop: landAirTrack(track, end) };
  const peakY = track.grounded ? Math.max(track.y, to.y) : Math.max(track.peakY, to.y);
  Object.assign(track, { grounded: false, airStartMs, airStartY, peakY, y: to.y });
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
 * The highest ground along the step (at its sample points, `from` included) that an airborne track
 * can be taken to have landed on and jumped from again before reporting `to`, or null: at most
 * STEP_UP above its last height, at most CEILING_CAP above where its air phase began, and `to` within
 * one jump of it. The highest, because the rest of that jump is judged from it (a body coming down
 * beside a platform can land on its edge).
 */
function rejumpGround(from: { x: number; z: number }, track: AirTrack, to: Pose, surface: Surface, samples: number): number | null {
  let best: number | null = null;
  for (let i = 0; i <= samples; i++) {
    const f = i / samples;
    const s = surface(from.x + (to.x - from.x) * f, from.z + (to.z - from.z) * f);
    if (s === null || (best !== null && s <= best)) continue;
    if (s > track.y + STEP_UP || s > track.airStartY + CEILING_CAP || to.y > jumpCeiling(s, APEX_S)) continue;
    best = s;
  }
  return best;
}
