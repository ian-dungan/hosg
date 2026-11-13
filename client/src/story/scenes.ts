// The story's scenes (Plan 6 Task 6). The Beacon scene was the offline demo's `solstice()` (main.ts): the camera
// goes behind the statue and up along Ellie's arm while the world raises the Beacon. Online it goes on: the
// falling star crosses the whole sky (the Beacon is west-north-west, the east gate east), and the camera pans
// with it, holds on the flash, and eases back. The crater scene eases the camera down over the crater's edge.
// Both run on game time (`update(dt)` from the frame loop: headless checks at 1 fps see the same frames), hold
// the adventurer still, and hand control back at once when the adventurer moves or is hurt. Also here: the
// rising ring of light on a completed step, and the dialogue's framing (the speaker in the top half, above the
// sheet). Nothing is allocated per frame.
import { Color3, Mesh, MeshBuilder, StandardMaterial, Vector3, type ArcRotateCamera, type Scene } from '@babylonjs/core';
import { BEACON_DIR, SKY_ISLAND } from '../world/layout';
import { STAR_S, FLASH_S, groveStarPath } from '../world/storySky';
import type { PlayerRig, WorldApi } from '../core/contracts';

const smooth = (k: number) => k * k * (3 - 2 * k);
const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** The camera's way behind the statue and up along Ellie's arm (the offline demo's numbers). */
export const ARM_VIEW = { TILT: 0.14, BACK: 24, HEIGHT: 12, R: 40, EASE_S: 2.2 } as const;
/** How long the Beacon scene holds on the star's landing before handing back, in s. */
export const STAR_HOLD_S = 2.5;
/** The camera's way back to the adventurer at the end of a scene, in s. */
export const RETURN_S = 1.0;
/** Where the camera watches the falling star from: high over the plaza, south of it, looking north (Task 5's starView). */
const STAR_VIEW_POS = (() => { const a = -Math.PI / 2 - 0.12, b = 1.42, r = 30; return new Vector3(r * Math.cos(a) * Math.sin(b), 28 + r * Math.cos(b), r * Math.sin(a) * Math.sin(b)); })();
/** How long the camera takes to get there, in s (the star is already falling). */
const STAR_MOVE_S = 1.1;
/** A wider lens for the star's sweep (a phone held upright sees little sideways). */
const STAR_FOV = 1.15;
/** The crater scene: how far the camera tilts down, and for how long. */
export const CRATER_TILT = (30 * Math.PI) / 180;
export const CRATER_S = 3;

/** Where the camera goes for the arm view: its target, alpha, beta and radius (the demo's maths). */
export function armView(): { target: Vector3; alpha: number; beta: number; radius: number } {
  const look = new Vector3(BEACON_DIR.x, 0, BEACON_DIR.z).normalize();
  const { TILT, BACK, HEIGHT, R } = ARM_VIEW;
  const camPos = new Vector3(-look.x * BACK, HEIGHT, -look.z * BACK);
  const target = camPos.add(new Vector3(look.x * Math.cos(TILT) * R, Math.sin(TILT) * R, look.z * Math.cos(TILT) * R));
  return { target, alpha: Math.atan2(-look.z, -look.x), beta: Math.PI / 2 + TILT, radius: R };
}

/**
 * The offline demo's Beacon camera, as it was in main.ts (wall-clock easing, the demo's own loop): ease along
 * Ellie's arm, raise the Beacon, hold 2.5 s, give the camera back. The online scene is BeaconScene below.
 */
export async function demoBeaconCamera(rig: PlayerRig, world: WorldApi): Promise<void> {
  try {
    rig.setCinematic(true);
    const cam = rig.camera;
    cam.upperBetaLimit = Math.PI;
    const to = armView();
    const tStart = cam.target.clone();
    const a0 = cam.alpha, b0 = cam.beta, r0 = cam.radius;
    const t0 = performance.now();
    const ease = () => {
      const k = Math.min(1, (performance.now() - t0) / (ARM_VIEW.EASE_S * 1000)), e = smooth(k);
      cam.alpha = a0 + wrap(to.alpha - a0) * e; cam.beta = b0 + (to.beta - b0) * e; cam.radius = r0 + (to.radius - r0) * e;
      Vector3.LerpToRef(tStart, to.target, e, cam.target);
      if (k < 1) requestAnimationFrame(ease);
    };
    ease();
    await world.raiseBeacon();
    await new Promise((r) => setTimeout(r, STAR_HOLD_S * 1000));
    rig.setCinematic(false);
  } catch (e) {
    console.warn('raiseBeacon failed', e);
    rig.setCinematic(false);
  }
}

/** Quadratic Bézier point of the star's path at u, into out. */
function bez(p: { from: Vector3; over: Vector3; to: Vector3 }, u: number, out: Vector3): Vector3 {
  const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
  return out.set(p.from.x * a + p.over.x * b + p.to.x * c, p.from.y * a + p.over.y * b + p.to.y * c, p.from.z * a + p.over.z * b + p.to.z * c);
}
/** The star's own ease (storySky's fallEase). */
const fallEase = (u: number) => u * u * (2.2 - 1.2 * u);

export interface StoryScenesOpts {
  scene: Scene; world: WorldApi; rig: PlayerRig;
  /** The zone (the Beacon scene's star path is the grove's; the Greenway's world drops it into the crater). */
  zone: string;
  /** Hide or show the HUD. */
  hudVisible(on: boolean): void;
  /** True when the adventurer wants control back: they pushed a direction, were hurt, or a fight started. */
  interrupted(): boolean;
}

export interface StoryScenes {
  /** The Beacon: the arm view, the rise, the star with the camera panning after it, the hold, back. */
  beacon(): Promise<void>;
  /** The crater: the camera eases down over its edge (the HUD stays), and back. */
  crater(at: { x: number; z: number }): Promise<void>;
  /** A rising ring of light round the adventurer's feet. */
  ring(): void;
  /** Frames a talk: the camera lifts the scene so the speaker stands above the dialogue sheet (null: back). */
  frameTalk(at: { x: number; z: number; lift?: number; facing?: number; still?: boolean } | null): void;
  /** A scene is playing (the adventurer is held still). */
  readonly holding: boolean;
  /** Which part of a scene is on (for checks): '', 'arm', 'rise', 'star', 'hold', 'back', 'crater'. */
  readonly phase: string;
  /** Seconds into the current part (for checks). */
  readonly elapsed: number;
  update(dt: number): void;
  dispose(): void;
}

export function createStoryScenes(o: StoryScenesOpts): StoryScenes {
  const { scene, world } = o;
  const cam = (): ArcRotateCamera => o.rig.camera;
  let disposed = false;
  let phase = '';
  let holding = false;
  // the scene's clock and its steps (game time)
  let t = 0;
  let stepDone: (() => void) | null = null;
  let stepFn: ((dt: number) => boolean) | null = null;
  /** Runs `fn(dt)` each frame until it returns true (or the scene is cut short). */
  const step = (name: string, fn: (dt: number) => boolean) => new Promise<void>((resolve) => { phase = name; t = 0; stepFn = fn; stepDone = resolve; });
  // the camera's own place before a scene (to ease back to)
  const home = { alpha: 0, beta: 0, radius: 0, target: new Vector3() };
  const from = { alpha: 0, beta: 0, radius: 0, target: new Vector3() };
  const look = new Vector3(), head = new Vector3(), camPos = new Vector3(), tmp = new Vector3(), fromPos = new Vector3();
  let cut = false;

  let homeFov = 0.8;
  const saveHome = () => { const c = cam(); homeFov = c.fov; home.alpha = c.alpha; home.beta = c.beta; home.radius = c.radius; home.target.copyFrom(c.target); };
  const saveFrom = () => { const c = cam(); from.alpha = c.alpha; from.beta = c.beta; from.radius = c.radius; from.target.copyFrom(c.target); };
  const easeCam = (e: number, to: { alpha: number; beta: number; radius: number; target: Vector3 }) => {
    const c = cam();
    c.alpha = from.alpha + wrap(to.alpha - from.alpha) * e;
    c.beta = from.beta + (to.beta - from.beta) * e;
    c.radius = from.radius + (to.radius - from.radius) * e;
    Vector3.LerpToRef(from.target, to.target, e, c.target);
  };
  /** Points the camera from its fixed position at `p` (alpha, beta, radius from the position). */
  const aimFrom = (pos: Vector3, p: Vector3) => {
    const c = cam();
    c.target.copyFrom(p);
    const dx = pos.x - p.x, dy = pos.y - p.y, dz = pos.z - p.z;
    const r = Math.max(1, Math.hypot(dx, dy, dz));
    c.radius = r; c.beta = Math.acos(Math.max(-1, Math.min(1, dy / r))); c.alpha = Math.atan2(dz, dx);
  };
  const begin = (hideHud: boolean) => {
    cut = false;
    talkCam = false;
    holding = true;
    saveHome();
    o.rig.setCinematic(true);
    cam().upperBetaLimit = Math.PI;
    if (hideHud) o.hudVisible(false);
  };
  const end = (hideHud: boolean) => {
    o.rig.setCinematic(false);
    if (hideHud) o.hudVisible(true);
    holding = false;
    phase = '';
    stepFn = null; stepDone = null;
  };
  /** Control goes back at once (the adventurer moved or was hurt): the rig's own follow eases the camera home. */
  const cutShort = () => {
    cut = true;
    cam().fov = homeFov;
    const d = stepDone;
    stepFn = null; stepDone = null;
    d?.();
  };

  // ── the ring of light ──
  const ringMat = new StandardMaterial('questRingMat', scene);
  ringMat.disableLighting = true; ringMat.emissiveColor = Color3.FromHexString('#ffd36a'); ringMat.alpha = 0; ringMat.backFaceCulling = false;
  ringMat.alphaMode = 1; // additive
  const ringMesh: Mesh = MeshBuilder.CreateTorus('questRing', { diameter: 1.4, thickness: 0.07, tessellation: 40 }, scene);
  ringMesh.material = ringMat; ringMesh.isPickable = false; ringMesh.setEnabled(false);
  let ringT = -1;
  const RING_S = 1.2;

  // ── the dialogue's framing: the scene lifts so the speaker stands above the sheet (a screen offset, eased) ──
  let frameGoal = 0, frameNow = 0;
  let talkCam = false;
  const talkGoal = { alpha: 0, beta: 1.2, radius: 7, target: new Vector3() };
  /** How far round from behind the adventurer the talk camera stands (rad). */
  const TALK_SIDE = 0.7;

  // ── the star's path in the grove (the world plays the star; the camera follows its head) ──
  const island = new Vector3(BEACON_DIR.x * SKY_ISLAND.dist, SKY_ISLAND.y, BEACON_DIR.z * SKY_ISLAND.dist);
  const starPath = groveStarPath(island);

  const beacon = async (): Promise<void> => {
    if (disposed || holding) return;
    begin(true);
    const arm = armView();
    saveFrom();
    const rise = world.raiseBeacon();
    let risen = false;
    void rise.then(() => { risen = true; });
    // the arm view
    await step('arm', () => { const e = smooth(Math.min(1, t / ARM_VIEW.EASE_S)); easeCam(e, arm); return t >= ARM_VIEW.EASE_S; });
    if (!cut) await step('rise', () => risen);
    let star: Promise<void> | null = null;
    if (!cut && o.zone === 'grove') {
      // the star: the camera stays where it is and turns after the head (a little behind it, eased), then holds on the flash
      star = world.fallingStar();
      // the camera rises to a high place over the plaza looking north (the whole arc in one sweep: the Beacon at the
      // left, the streak over the town to the east at the right), turning after the head as it goes
      fromPos.copyFrom(cam().position);
      const fov0 = cam().fov;
      look.copyFrom(cam().target);
      await step('star', (dt) => {
        const m = smooth(Math.min(1, t / STAR_MOVE_S));
        Vector3.LerpToRef(fromPos, STAR_VIEW_POS, m, camPos);
        const u = Math.min(1, t / STAR_S);
        bez(starPath, fallEase(Math.min(1, u + 0.04)), head);
        // aim a little below and ahead of the head so the trail reads across the frame
        tmp.copyFrom(head).subtractInPlace(camPos).normalize().scaleInPlace(60).addInPlace(camPos);
        Vector3.LerpToRef(look, tmp, 1 - Math.exp(-7 * dt), look);
        cam().fov = fov0 + (STAR_FOV - fov0) * m;
        aimFrom(camPos, look);
        return t >= STAR_S;
      });
      if (!cut) {
        bez(starPath, 1, head);
        head.y += 25; // the flash rises over the hills there: keep the horizon low in the frame
        tmp.copyFrom(head).subtractInPlace(camPos).normalize().scaleInPlace(60).addInPlace(camPos);
        await step('hold', (dt) => { Vector3.LerpToRef(look, tmp, 1 - Math.exp(-3 * dt), look); aimFrom(camPos, look); return t >= Math.max(STAR_HOLD_S, FLASH_S); });
      }
    } else if (!cut) {
      star = world.fallingStar();
      await step('hold', () => t >= STAR_HOLD_S);
    }
    if (!star) void world.fallingStar(); // cut short before it fell: the sky still tells it
    cam().fov = homeFov;
    // back to the adventurer (eased), unless control was already taken back
    if (!cut) {
      saveFrom();
      await step('back', () => { const e = smooth(Math.min(1, t / RETURN_S)); home.target.set(o.rig.position.x, home.target.y, o.rig.position.z); easeCam(e, home); return t >= RETURN_S; });
    }
    end(true);
  };

  const crater = async (at: { x: number; z: number }): Promise<void> => {
    if (disposed || holding) return;
    begin(false);
    saveFrom();
    const r = o.rig.position;
    const to = {
      alpha: Math.atan2(r.z - at.z, r.x - at.x), beta: Math.max(0.45, from.beta - CRATER_TILT), radius: Math.max(from.radius, 9),
      target: new Vector3(r.x + (at.x - r.x) * 0.8, r.y - 0.5, r.z + (at.z - r.z) * 0.8),
    };
    await step('crater', () => { easeCam(smooth(Math.min(1, t / (CRATER_S * 0.6))), to); return t >= CRATER_S; });
    if (!cut) { saveFrom(); await step('back', () => { easeCam(smooth(Math.min(1, t / RETURN_S)), home); return t >= RETURN_S; }); }
    end(false);
  };

  return {
    beacon, crater,
    ring() {
      if (disposed) return;
      ringT = 0;
      ringMesh.setEnabled(true);
    },
    frameTalk(at) {
      frameGoal = at ? 1 : 0;
      if (!at) { if (talkCam) { talkCam = false; if (!holding) o.rig.setCinematic(false); } return; }
      if (holding || at.still) return;
      // a three-quarter view from the adventurer's side: both faces show, the speaker a little higher than centre
      const p = o.rig.position, c = cam();
      let dx = at.x - p.x, dz = at.z - p.z;
      const d = Math.max(0.5, Math.hypot(dx, dz)); dx /= d; dz /= d;
      const side = (sgn: number) => { const a = sgn * TALK_SIDE, cx = dx * Math.cos(a) - dz * Math.sin(a), cz = dx * Math.sin(a) + dz * Math.cos(a); return Math.atan2(-cz, -cx); };
      const a1 = side(1), a2 = side(-1);
      talkGoal.alpha = Math.abs(wrap(a1 - c.alpha)) <= Math.abs(wrap(a2 - c.alpha)) ? a1 : a2;
      const lift = at.lift ?? 0;
      talkGoal.beta = 1.2;
      talkGoal.radius = Math.max(6.5, d * 1.6 + 4);
      talkGoal.target.set((p.x + at.x) / 2, p.y + 1.25, (p.z + at.z) / 2);
      if (at.facing !== undefined) {
        // someone up on a wall (Pim over the door; facing: the way out from the wall): from out in the street, looking up at them past the adventurer
        talkGoal.alpha = Math.atan2(Math.cos(at.facing), Math.sin(at.facing));
        talkGoal.beta = 1.5; talkGoal.radius = 10;
        talkGoal.target.set(at.x * 0.7 + p.x * 0.3, p.y + lift * 0.55, at.z * 0.7 + p.z * 0.3);
      }
      talkCam = true;
      o.rig.setCinematic(true);
    },
    get holding() { return holding; },
    get phase() { return phase; },
    get elapsed() { return t; },
    update(dt) {
      if (disposed) return;
      if (stepFn) {
        if (holding && phase !== 'back' && o.interrupted()) cutShort();
        else { t += dt; if (stepFn(dt)) { const d = stepDone; stepFn = null; stepDone = null; d?.(); } }
      }
      if (ringT >= 0) {
        ringT += dt;
        const k = Math.min(1, ringT / RING_S);
        const p = o.rig.position;
        ringMesh.position.set(p.x, p.y + 0.15 + k * 1.9, p.z);
        const s = 1 + k * 0.9;
        ringMesh.scaling.set(s, 1, s);
        ringMat.alpha = 0.9 * (1 - k) * Math.min(1, ringT * 8);
        if (k >= 1) { ringT = -1; ringMesh.setEnabled(false); }
      }
      // the talk framing: a screen offset on the camera (the speaker above the sheet), eased in and out
      const fk = 1 - Math.exp(-5 * dt);
      frameNow += (frameGoal - frameNow) * fk;
      if (talkCam && !holding) {
        const c = cam(), k = 1 - Math.exp(-3.2 * dt);
        c.alpha += wrap(talkGoal.alpha - c.alpha) * k; c.beta += (talkGoal.beta - c.beta) * k; c.radius += (talkGoal.radius - c.radius) * k;
        Vector3.LerpToRef(c.target, talkGoal.target, k, c.target);
      }
      if (!holding) {
        const c = cam();
        const want = frameNow * Math.max(0.6, c.radius * 0.12);
        if (Math.abs(c.targetScreenOffset.y - want) > 1e-3) c.targetScreenOffset.y = want;
      }
    },
    dispose() {
      disposed = true;
      if (holding) { try { end(true); } catch { /* the scene is gone */ } }
      const c = o.rig.camera;
      try { c.targetScreenOffset.y = 0; } catch { /* gone */ }
      ringMesh.dispose(); ringMat.dispose();
    },
  };
}
