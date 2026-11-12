// Dodges and knockbacks: a push simulated with the shared character controller, so the server and the
// client agree on where the body ends up, and the movement checks can accept the client from there.
import { stepBody, type Body, type Surface } from '../body';
import { TICK_HZ } from '../constants';
import { DISPLACE_MAX_S, DISPLACE_SUBSTEP_M, DODGE_DISTANCE, DODGE_S, KNOCK_MAX_VY } from './constants';
import type { Knock } from './enemies';

/** Horizontal velocity (vx, vz) held for `seconds`, with upward speed vy at the start. */
export interface Displacement { vx: number; vz: number; vy: number; seconds: number }
/**
 * Where the body ended up and how long it took; drop: the largest landing drop on the way (as
 * stepBody reports it), for fall damage; path: samples every 1/TICK_HZ from t = 0, and at the end.
 */
export interface DisplaceResult { x: number; z: number; y: number; drop: number; seconds: number; path: { t: number; x: number; z: number; y: number }[] }

/** A pose this close above the surface is standing on it. */
const GROUND_EPSILON = 0.05;
/** Longest stepBody call once the push is over (stepBody sub-steps it itself). */
const COAST_STEP_S = 1 / 60;

/**
 * Simulates a displacement from `start`: grounded if within GROUND_EPSILON of the surface (unless
 * vy > 0 lifts it), pushed by (vx, vz) for d.seconds, then left to fall with no input until it is
 * grounded or DISPLACE_MAX_S have passed. While pushed, each stepBody call moves the body at most
 * DISPLACE_SUBSTEP_M. Deterministic: the same input gives the same result, bit for bit.
 */
export function simulateDisplacement(start: { x: number; z: number; y: number }, d: Displacement, surface: Surface): DisplaceResult {
  const s = surface(start.x, start.z);
  const onGround = s !== null && Math.abs(start.y - s) <= GROUND_EPSILON;
  const b: Body = { x: start.x, z: start.z, y: onGround ? s : start.y, vy: 0, grounded: onGround, peakY: start.y };
  if (d.vy > 0) { b.vy = d.vy; b.grounded = false; b.peakY = b.y; }
  else if (!b.grounded) b.vy = d.vy;

  const pushS = Math.min(Math.max(0, Number.isFinite(d.seconds) ? d.seconds : 0), DISPLACE_MAX_S);
  const speed = Math.hypot(d.vx, d.vz);
  const vx = Number.isFinite(speed) ? d.vx : 0, vz = Number.isFinite(speed) ? d.vz : 0;
  const pushStep = speed > 0 && Number.isFinite(speed) ? DISPLACE_SUBSTEP_M / speed : COAST_STEP_S;
  const sampleS = 1 / TICK_HZ;

  const path: DisplaceResult['path'] = [{ t: 0, x: b.x, z: b.z, y: b.y }];
  let t = 0, drop = 0, nextSample = 1;
  while (t < DISPLACE_MAX_S) {
    if (t >= pushS && b.grounded) break;
    const pushing = t < pushS;
    let end = Math.min(t + (pushing ? pushStep : COAST_STEP_S), nextSample * sampleS, DISPLACE_MAX_S);
    if (pushing) end = Math.min(end, pushS);
    const out = stepBody(b, pushing ? { vx, vz, jump: false } : { vx: 0, vz: 0, jump: false }, end - t, surface);
    if (out.landed) drop = Math.max(drop, out.drop);
    t = end;
    if (t >= nextSample * sampleS) {
      path.push({ t, x: b.x, z: b.z, y: b.y });
      nextSample++;
    }
  }
  const last = path[path.length - 1];
  if (last.t !== t) path.push({ t, x: b.x, z: b.z, y: b.y });
  return { x: b.x, z: b.z, y: b.y, drop: Math.max(0, drop), seconds: t, path };
}

/** A dodge along (dx, dz) (normalised; no movement for a zero or non-finite direction): DODGE_DISTANCE over DODGE_S, vy 0. */
export function dodgeDisplacement(dx: number, dz: number): Displacement {
  const l = Math.hypot(dx, dz);
  const v = l > 0 && Number.isFinite(l) ? DODGE_DISTANCE / DODGE_S / l : 0;
  return { vx: dx * v, vz: dz * v, vy: 0, seconds: DODGE_S };
}

/**
 * A knock on a body at `at` from an attack at `from`: k.speed away from `from` (along lineDir, as a
 * facing angle, for line attacks; +Z when `at` is on `from`) for k.seconds, vy capped at KNOCK_MAX_VY.
 */
export function knockDisplacement(from: { x: number; z: number }, at: { x: number; z: number }, k: Knock, lineDir?: number): Displacement {
  let ux = 0, uz = 1;
  if (lineDir !== undefined && Number.isFinite(lineDir)) { ux = Math.sin(lineDir); uz = Math.cos(lineDir); }
  else {
    const dx = at.x - from.x, dz = at.z - from.z, l = Math.hypot(dx, dz);
    if (l > 0 && Number.isFinite(l)) { ux = dx / l; uz = dz / l; }
  }
  return { vx: ux * k.speed, vz: uz * k.speed, vy: Math.min(k.vy, KNOCK_MAX_VY), seconds: k.seconds };
}
