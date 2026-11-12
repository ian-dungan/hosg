// Dodges and knockbacks: a push simulated with the shared character controller, so the server and the
// client agree on where the body ends up, and the movement checks can accept the client from there.
import { fallDamage, stepBody, type Body, type BodyInput, type Surface } from '../body';
import { GRAVITY, JUMP_SPEED, STEP_UP, TICK_HZ } from '../constants';
import { checkPose, makeAirTrack, type AirTrack } from '../movement';
import { DISPLACE_MAX_S, DISPLACE_SUBSTEP_M, DODGE_DISTANCE, DODGE_S, KNOCK_MAX_VY } from './constants';
import type { Knock } from './enemies';

/** Horizontal velocity (vx, vz) held for `seconds`, with upward speed vy at the start. */
export interface Displacement { vx: number; vz: number; vy: number; seconds: number }
/**
 * Where the body ended up and how long it took.
 * - drop: the largest landing drop on the way (as stepBody reports it).
 * - drops: every landing's drop, in order; fallHp: the fall damage of all of them together
 *   (Σ fallDamage(drop)), which is what to charge.
 * - grounded: false only when the body was still in the air at DISPLACE_MAX_S over a bottomless
 *   drop (no surface it could reach in time), or the start was not finite or had no surface (then
 *   nothing moved); x/z/y are then where it was. Otherwise it always ends standing on the real surface.
 * - path: samples every 1/TICK_HZ from t = 0 (the start, after any clamp), and at the end.
 */
export interface DisplaceResult {
  x: number; z: number; y: number; drop: number; drops: number[]; fallHp: number;
  seconds: number; grounded: boolean; path: { t: number; x: number; z: number; y: number }[];
}

/** A pose this close above the surface is standing on it. */
const GROUND_EPSILON = 0.05;
/** Longest stepBody call once the push is over (stepBody sub-steps it itself). */
const COAST_STEP_S = 1 / 60;
/** Highest an airborne start may be above the ground under it (the Plan 2 jump cap). */
const AIR_CAP = 2.0;
/**
 * Highest surface a body in flight may enter, above `ref`: AIR_CAP less one STEP_UP (1.65 m, below
 * what one honest jump reaches, ≈ 1.80 m), so the short walk a landing may be followed by before the
 * slope window fills (at most STEP_UP) still ends within AIR_CAP.
 */
const FLIGHT_REACH = AIR_CAP - STEP_UP;
/** Grounded travel over which a rise of at most STEP_UP is allowed (checkPose's sample spacing). */
const SLOPE_WINDOW = 0.25;
/** Faster pushes are refused outright (no horizontal push); the fastest real one is 15 m/s. */
const MAX_PUSH_SPEED = 50;
const STILL: BodyInput = { vx: 0, vz: 0, jump: false };

interface Sample { t: number; b: Body; ref: number; drops: number }
const finite = Number.isFinite;

/**
 * Advances `b` from time `t` to the end (pushed by (vx, vz) until `pushUntil`, then falling with no
 * input until grounded or DISPLACE_MAX_S), appending landings to `drops`; returns the samples after t.
 * `ref` is the ground the flight is judged from (see simulateDisplacement): the body never enters a
 * surface more than FLIGHT_REACH above it (such a surface is a wall) nor flies more than AIR_CAP above
 * it, and while grounded and pushed it never rises more than STEP_UP over the last SLOPE_WINDOW of
 * travel (the push ends there instead).
 */
function run(b: Body, ref: number, t: number, vx: number, vz: number, pushUntil: number, pushStep: number, surface: Surface, drops: number[]): Sample[] {
  const samples: Sample[] = [];
  const sampleS = 1 / TICK_HZ;
  let next = Math.floor(t * TICK_HZ + 1e-9) + 1;
  let dist = 0;
  let hist: { d: number; y: number }[] = b.grounded ? [{ d: 0, y: b.y }] : [];
  /** After a landing, the ref of the flight, until a full SLOPE_WINDOW has been walked from it. */
  let landRef: number | null = null;
  while (t < DISPLACE_MAX_S) {
    const pushing = t < pushUntil;
    if (!pushing && b.grounded) break;
    let end = Math.min(t + (pushing ? pushStep : COAST_STEP_S), next * sampleS, DISPLACE_MAX_S);
    if (pushing) end = Math.min(end, pushUntil);
    const before = { ...b };
    const cap = ref + FLIGHT_REACH;
    const capped: Surface = (x, z) => { const s = surface(x, z); return s !== null && s > cap ? null : s; };
    const out = stepBody(b, pushing ? { vx, vz, jump: false } : STILL, end - t, capped);
    if (pushing && before.grounded && b.grounded) {
      const d = dist + Math.hypot(b.x - before.x, b.z - before.z);
      // too steep to walk; or, just after a landing (whose slope window has no history yet), above
      // AIR_CAP over the flight's ground: refuse the step, and the push is over
      if (b.y - heightBack(hist, d - SLOPE_WINDOW) > STEP_UP + 1e-9 || (landRef !== null && b.y > landRef + AIR_CAP + 1e-9)) {
        Object.assign(b, before);
        pushUntil = t;
        continue;
      }
      dist = d;
      hist.push({ d, y: b.y });
      if (d >= SLOPE_WINDOW) landRef = null;
    } else if (b.grounded) { dist = 0; hist = [{ d: 0, y: b.y }]; landRef = ref; }
    else hist = [];
    if (out.landed) drops.push(Math.max(0, out.drop));
    // ref moves only with walking (grounded to grounded, slope-checked above): a landing in flight,
    // even one that rides up a steep ramp, never raises the ground the flight is judged from
    if (b.grounded && before.grounded) ref = b.y;
    else if (!b.grounded && b.y > ref + AIR_CAP) {
      b.y = ref + AIR_CAP; // never more than one jump above that ground, however a launch rides rims
      if (b.vy > 0) b.vy = 0;
      b.peakY = Math.min(b.peakY, b.y);
    }
    t = end;
    if (t >= next * sampleS) { samples.push({ t, b: { ...b }, ref, drops: drops.length }); next++; }
  }
  if (samples.length === 0 || samples[samples.length - 1].t !== t) samples.push({ t, b: { ...b }, ref, drops: drops.length });
  return samples;
}

/**
 * The body at `last` (accepted, possibly in the air) falls straight down onto the surface under it,
 * from rest (any upward speed is dropped): samples on the 1/TICK_HZ grid and the landing, which is
 * grounded on the real surface and charged in `drops`. Falling straight down needs no movement check,
 * and it is not limited by DISPLACE_MAX_S (the surface below is known).
 */
function fallStraight(last: Sample, surface: Surface, drops: number[]): Sample[] {
  const s = surface(last.b.x, last.b.z);
  if (last.b.grounded || s === null) return [];
  const h = Math.max(0, last.b.y - s);
  const fallS = Math.sqrt((2 * h) / GRAVITY);
  const out: Sample[] = [];
  const at = (t: number, y: number, grounded: boolean): Sample => ({ t, b: { ...last.b, y, vy: 0, grounded, peakY: grounded ? y : last.b.peakY }, ref: grounded ? y : last.ref, drops: drops.length });
  for (let k = Math.floor(last.t * TICK_HZ + 1e-9) + 1; k / TICK_HZ < last.t + fallS; k++) {
    const dt = k / TICK_HZ - last.t;
    out.push(at(k / TICK_HZ, last.b.y - 0.5 * GRAVITY * dt * dt, false));
  }
  drops.push(Math.max(0, Math.max(last.b.peakY, last.b.y) - s));
  out.push(at(last.t + fallS, s, true));
  return out;
}

/** The height `d` metres along the grounded travel recorded in `hist` (its first point before that). */
function heightBack(hist: { d: number; y: number }[], d: number): number {
  if (d <= hist[0].d) return hist[0].y;
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i].d > d) continue;
    const a = hist[i], c = hist[i + 1];
    return c && c.d > a.d ? a.y + ((c.y - a.y) * (d - a.d)) / (c.d - a.d) : a.y;
  }
  return hist[0].y;
}

/**
 * Simulates a displacement from `start` over `surface`.
 *
 * Guarantee: a displacement never ends at, or passes through, a place the Plan 2 movement bounds
 * forbid, and it never adds reachable height:
 * - a grounded start (within GROUND_EPSILON of the surface under it, or below it) gets the launch
 *   vy (clamped to 0..KNOCK_MAX_VY), so it can land only on rims within its own arc (≤ 1.17 m);
 *   an airborne start gets no upward speed and keeps falling, from at most AIR_CAP (2 m) above the
 *   ground under it (a higher start is brought down to that first);
 * - airborne, the body never enters a surface more than FLIGHT_REACH (AIR_CAP − STEP_UP = 1.65 m,
 *   less than one honest jump) above `ref`, nor rises more than AIR_CAP (2 m) above it, however a launch rides up rims or ramps.
 *   `ref` is the ground under the start, and moves only with walking (grounded to grounded travel,
 *   slope-checked below), never with a landing; and until a landed body has walked a full slope
 *   window it stays within AIR_CAP of the flight's `ref`: so no point is ever more than 2 m above
 *   the ground under the start except by legal walking (grounded travel rising ≤ STEP_UP per 0.25 m);
 * - grounded and pushed, it never rises more than STEP_UP over SLOPE_WINDOW (0.25 m) of travel:
 *   the push stops instead, as walking up something that steep is refused;
 * - each pushed stepBody call moves it at most DISPLACE_SUBSTEP_M, so no wall 0.25 m or thicker
 *   (and no null surface) is crossed;
 * - finally every path sample is checked with checkPose (allowance Infinity) from the start's track
 *   (a standing track on the ground under it, or an air phase at its apex over that ground); at the
 *   first refused sample the path is cut, and the body falls straight down from the last accepted one
 *   onto the real surface below (from rest; no check needed; the drop is charged).
 *
 * Pushed by (vx, vz) for d.seconds, then left to fall with no input until it is grounded or
 * DISPLACE_MAX_S have passed. Non-finite input, or a push faster than 50 m/s, moves nothing
 * horizontally; a start that is not finite or has no surface does not move (grounded: false).
 * Deterministic: the same input gives the same result, bit for bit.
 */
export function simulateDisplacement(start: { x: number; z: number; y: number }, d: Displacement, surface: Surface): DisplaceResult {
  const g0 = finite(start.x) && finite(start.z) && finite(start.y) ? surface(start.x, start.z) : null;
  if (g0 === null) {
    return { x: start.x, z: start.z, y: start.y, drop: 0, drops: [], fallHp: 0, seconds: 0, grounded: false, path: [{ t: 0, x: start.x, z: start.z, y: start.y }] };
  }
  const onGround = start.y <= g0 + GROUND_EPSILON;
  const y0 = onGround ? g0 : Math.min(start.y, g0 + AIR_CAP);
  const b: Body = { x: start.x, z: start.z, y: y0, vy: 0, grounded: onGround, peakY: y0 };
  const vy = finite(d.vy) ? Math.min(Math.max(0, d.vy), KNOCK_MAX_VY) : 0;
  if (onGround && vy > 0) { b.vy = vy; b.grounded = false; }

  const pushS = finite(d.seconds) ? Math.min(Math.max(0, d.seconds), DISPLACE_MAX_S) : 0;
  const speed = Math.hypot(d.vx, d.vz);
  const ok = finite(speed) && speed <= MAX_PUSH_SPEED;
  const vx = ok ? d.vx : 0, vz = ok ? d.vz : 0;
  const pushStep = ok && speed > 0 ? DISPLACE_SUBSTEP_M / speed : COAST_STEP_S;

  const drops: number[] = [];
  const startSample: Sample = { t: 0, b: { ...b }, ref: g0, drops: 0 };
  const samples = [startSample, ...run(b, g0, 0, vx, vz, ok ? pushS : 0, pushStep, surface, drops)];

  // check every step as the movement checks would, from the start's track
  const track: AirTrack = onGround ? makeAirTrack(g0)
    : { grounded: false, airStartMs: -(JUMP_SPEED / GRAVITY) * 1000, airStartY: g0, peakY: y0, y: y0 };
  const kept = [startSample];
  const accept = (list: Sample[]): boolean => {
    for (const s of list) {
      const from = kept[kept.length - 1].b;
      const r = checkPose(from, track, { x: s.b.x, z: s.b.z, y: s.b.y, facing: 0, moving: true }, s.t * 1000, Infinity, surface);
      if (r.result !== 'ok') return false;
      kept.push(s);
    }
    return true;
  };
  if (!accept(samples.slice(1))) {
    const last = kept[kept.length - 1];
    drops.length = last.drops;
    kept.push(...fallStraight(last, surface, drops));
  }

  const end = kept[kept.length - 1];
  const path = kept.map((s) => ({ t: s.t, x: s.b.x, z: s.b.z, y: s.b.y }));
  const kd = drops.slice(0, end.drops);
  return {
    x: end.b.x, z: end.b.z, y: end.b.y,
    drop: kd.reduce((m, v) => Math.max(m, v), 0), drops: kd, fallHp: kd.reduce((sum, v) => sum + fallDamage(v), 0),
    seconds: end.t, grounded: end.b.grounded, path,
  };
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

/**
 * Guard on a knock taken: speed × (1 − min(0.5, guard/100)); the knock's time and lift are unchanged. No
 * Guard (absent, 0 or not finite) gives `k` itself.
 */
export function knockForGuard(k: Knock, guard: number | undefined): Knock {
  if (typeof guard !== 'number' || !Number.isFinite(guard) || guard <= 0) return k;
  return { ...k, speed: k.speed * (1 - Math.min(0.5, guard / 100)) };
}
