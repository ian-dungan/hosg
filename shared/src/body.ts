// The shared character controller: walking with sliding, stepping up and down, jumping, gravity and
// fall damage over a height surface. Pure maths, run the same way by the client and the server.
import { GRAVITY, JUMP_SPEED, STEP_UP, SAFE_FALL, FALL_DAMAGE_PER_M } from './constants';

/** Height an adventurer would stand on at (x, z), or null where nobody can be (wall, water, out of bounds). */
export type Surface = (x: number, z: number) => number | null;
export interface Body { x: number; z: number; y: number; vy: number; grounded: boolean; /** highest y since leaving the ground */ peakY: number }
/** vx, vz: desired horizontal velocity in m/s; jump: pressed this step. */
export interface BodyInput { vx: number; vz: number; jump: boolean }
/** drop = peakY - landing y (0 unless landed). */
export interface BodyStep { landed: boolean; drop: number; jumped: boolean }

/** Longest simulated sub-step, in seconds. */
const MAX_SUBSTEP = 1 / 60;
/** Longest total time one stepBody call simulates, in seconds. */
const MAX_DT = 0.25;

/** A body standing on the surface at (x, z) (at y = 0 where there is no surface). */
export function makeBody(x: number, z: number, surface: Surface): Body {
  const y = surface(x, z) ?? 0;
  return { x, z, y, vy: 0, grounded: true, peakY: y };
}

/** True if a body at height y may move into (x, z): there is a surface there, at most STEP_UP above y. */
export function canEnter(surface: Surface, x: number, z: number, y: number): boolean {
  const s = surface(x, z);
  return s !== null && s <= y + STEP_UP;
}

/** Advances the body by dt seconds (capped at 0.25 s, sub-stepped at 1/60 s). Mutates b. */
export function stepBody(b: Body, input: BodyInput, dt: number, surface: Surface): BodyStep {
  const out: BodyStep = { landed: false, drop: 0, jumped: false };
  const total = Math.min(Math.max(dt, 0), MAX_DT);
  if (!(total > 0)) return out;
  const n = Math.ceil(total / MAX_SUBSTEP - 1e-9);
  const h = total / n;
  let wantJump = input.jump;
  for (let k = 0; k < n; k++) {
    // horizontal: full move, else x only, else z only (slides along whatever blocks)
    const nx = b.x + input.vx * h, nz = b.z + input.vz * h;
    if (canEnter(surface, nx, nz, b.y)) { b.x = nx; b.z = nz; }
    else if (canEnter(surface, nx, b.z, b.y)) b.x = nx;
    else if (canEnter(surface, b.x, nz, b.y)) b.z = nz;

    const s = surface(b.x, b.z);
    if (b.grounded) {
      if (wantJump) {
        wantJump = false;
        b.vy = JUMP_SPEED; b.grounded = false; b.peakY = b.y; out.jumped = true;
      } else if (s !== null && s < b.y - STEP_UP) {
        b.vy = 0; b.grounded = false; b.peakY = b.y; // walked off a ledge
      } else {
        if (s !== null) b.y = s; // step up or down
        continue;
      }
    }
    // in the air (exact for constant gravity, so the apex does not depend on the step size)
    b.y += b.vy * h - 0.5 * GRAVITY * h * h;
    b.vy -= GRAVITY * h;
    if (s !== null && b.y <= s) {
      if (b.vy <= 0) {
        b.y = s; b.vy = 0; b.grounded = true;
        out.landed = true; out.drop = b.peakY - s;
        continue;
      }
      b.y = s; // still rising over a rim it just cleared: ride up its edge
    }
    if (b.y > b.peakY) b.peakY = b.y;
  }
  return out;
}

/** Health lost for a fall of `drop` metres: free up to SAFE_FALL, then FALL_DAMAGE_PER_M per metre. */
export function fallDamage(drop: number): number {
  return drop <= SAFE_FALL ? 0 : Math.round((drop - SAFE_FALL) * FALL_DAMAGE_PER_M);
}
