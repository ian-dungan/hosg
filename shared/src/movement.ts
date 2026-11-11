// Movement messages: parsing a client's pose and checking a step is possible.
import { RUN_SPEED } from './constants';

export interface Pose { x: number; z: number; facing: number; moving: boolean }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A clean Pose (known fields only), or null unless x, z and facing are finite numbers and moving is a boolean. */
export function parsePose(msg: unknown): Pose | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (!finite(m.x) || !finite(m.z) || !finite(m.facing) || typeof m.moving !== 'boolean') return null;
  return { x: m.x, z: m.z, facing: m.facing, moving: m.moving };
}

/** Fastest an adventurer may move, in m/s: running speed plus 30% for timing jitter. */
export const MAX_MOVE_SPEED = RUN_SPEED * 1.3;
/** Extra distance allowed on top of the speed limit, for jitter. Granted once, as part of the allowance cap. */
const STEP_SLACK = 0.5;
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
