// Shady Grove 2 — what every entry starts with: engine, world, HUD, the adventurer and their camera,
// tap-to-walk, the touch Jump button and a render loop that steps quality down on slow devices.
// A zone change (loadZone) disposes the scene and builds the next zone's world, rig and camera in a new
// Scene on the same Engine; the HUD, settings, quality and tap-to-walk state carry over.
import { Color3, Engine, MeshBuilder, Scene, StandardMaterial, Vector3, type Mesh } from '@babylonjs/core';
import type { HudApi, PlayerRig, Quality, TapInfo, WorldApi, ZoneId } from './core/contracts';
import { buildWorld } from './world/index';
import { buildGreenway } from './world/greenway';
import { createPlayerRig } from './player/rig';
import { createHud } from './hud/index';
import { SAFE_FALL, findPath, withClearance, type Vec2 } from '@sg2/shared';

/** The zones this client can build (Plan 4's 'lampfall' comes with Task 9). */
const BUILT_ZONES: ReadonlySet<ZoneId> = new Set<ZoneId>(['grove', 'beacon', 'arena', 'greenway']);
/** How far tap-to-walk routes keep from anything blocked, in m. */
const CLEARANCE = 0.3;
/** Distance at which a waypoint counts as reached and the walk heads for the next, in m. */
const WAYPOINT_REACHED = 0.4;
/** Distance from the end of the walk at which the adventurer stops, in m. */
const ARRIVED = 0.35;
/** A walk that makes no progress for this long is given up, in s. */
const STUCK_S = 0.8;
/** A walk that follows a moving goal plans its way again this often, in s. */
const FOLLOW_REPLAN_S = 0.5;

/**
 * How a walk ends: within `within` m of its goal, then `then`. With `follow`, the goal moves (an enemy): the walk
 * re-plans toward follow() every FOLLOW_REPLAN_S, and stops when it returns null.
 */
export interface WalkArrive { within: number; then: () => void; follow?: () => Vector3 | null }

export interface GameOpts {
  /** Handles a tap itself and returns true; otherwise tap-to-walk walks to the tapped point (when the setting is on). */
  onTap?: (tap: TapInfo) => boolean;
  /** True while something holds the adventurer (dialogue, cutscene): tap-to-walk stops and Jump does nothing. */
  busy?: () => boolean;
  /** The zone to build first (default 'grove'). */
  zone?: ZoneId;
}

export interface Game {
  readonly canvas: HTMLCanvasElement;
  readonly hudRoot: HTMLElement;
  readonly touch: boolean;
  readonly engine: Engine;
  /** The current zone's scene, world and rig: each zone change replaces them (read them through the game). */
  readonly scene: Scene;
  readonly world: WorldApi;
  readonly hud: HudApi;
  readonly rig: PlayerRig;
  readonly zone: ZoneId;
  /**
   * Disposes the current scene and builds `zone`'s world, rig and camera in a new Scene on the same Engine
   * (the adventurer stands at the zone's start until placed). The HUD, settings and quality carry over.
   */
  loadZone(zone: ZoneId): void;
  /** Called after every loadZone, with the zone now loaded. */
  onZoneLoaded(cb: (zone: ZoneId) => void): void;
  /**
   * Tap-to-walk: find a way to `p` and walk it (null stops). With `arrive`, stop `within` metres of it and call
   * `then`. Does nothing while the "Tap to walk" setting is off; toasts "Can't get there" when there is no way.
   * True if a walk started.
   */
  walkTo(p: Vector3 | null, arrive?: WalkArrive): boolean;
  /** True while a tap-to-walk is under way. */
  readonly walking: boolean;
  /** When (performance.now ms) the player last took over from a tap-to-walk (joystick or a movement key). */
  readonly walkOverriddenAt: number;
  /** Starts the render loop; `frame(dt)` runs after the rig and world update, before the scene renders. */
  start(frame: (dt: number) => void): void;
}

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
};

export function bootGame(opts: GameOpts = {}): Game {
  const busy = () => opts.busy?.() ?? false;
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hudRoot = document.getElementById('hud') as HTMLElement;
  const touch = matchMedia('(pointer: coarse)').matches;

  const engine = new Engine(canvas, !touch, { stencil: true, powerPreference: 'high-performance' });
  // Cap render resolution so phones stay smooth.
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2));
  let scene = new Scene(engine);
  let zone: ZoneId = opts.zone ?? 'grove';
  const build = (z: ZoneId) => (z === 'greenway' ? buildGreenway : buildWorld)(scene);
  let world = build(zone);
  // Every device starts on full settings; a device that cannot keep up steps down by itself (see the render loop).
  let quality: Quality = 'high';
  world.setQuality(quality);
  let slowTime = 0, fpsSettle = 4;
  const lockQuality = /[?&]lockq/.test(location.search);   // playtests keep full settings even when slow
  const hud = createHud(hudRoot);

  // ── tap-to-walk: tap the ground (or a person) and the character finds a way there round obstacles ──
  // Routes keep to the ground (no jumps, platforms count as blocked) and stay CLEARANCE m from anything
  // blocked, so the adventurer does not snag on corners.
  let passable = withClearance((x, z) => world.groundAt(x, z) !== null, CLEARANCE);
  let rigRef: PlayerRig | null = null;
  let route: Vec2[] = [];                  // waypoints still to reach; the last is where the walk ends
  let walkGoal: Vector3 | null = null;     // the tapped point or person
  let walkThen: WalkArrive | null = null;
  let replanIn = 0;
  let overriddenAt = -Infinity;
  let walkOnGround = false;                // the walk has had the adventurer on the ground (not up on something)
  let stuckTime = 0;
  const lastPos = new Vector3();
  const makeMarker = (): Mesh => {
    const m = MeshBuilder.CreateTorus('walkMarker', { diameter: 1.1, thickness: 0.09, tessellation: 24 }, scene);
    const mat = new StandardMaterial('walkMarkerMat', scene);
    mat.emissiveColor = Color3.FromHexString('#F2B742');
    mat.disableLighting = true;
    m.material = mat;
    m.isPickable = false;
    m.setEnabled(false);
    return m;
  };
  let marker = makeMarker();
  const stopWalk = () => {
    route = []; walkGoal = null; walkThen = null; stuckTime = 0; walkOnGround = false;
    marker.setEnabled(false);
  };
  function walkTo(p: Vector3 | null, arrive?: WalkArrive): boolean {
    stopWalk();
    replanIn = FOLLOW_REPLAN_S;
    const r = rigRef;
    if (!p || !r || !hud.settings.tapToWalk) return false;
    const from = { x: r.position.x, z: r.position.z };
    // to a person: as near as can be stood within talking range of them
    const path = findPath(from, { x: p.x, z: p.z }, passable, arrive ? { snap: arrive.within } : undefined);
    const first = path?.[0];
    // starting up on something (a bench, the Lookout), the route steps off it: never off a drop that hurts
    const offY = first && !passable(from.x, from.z) ? world.groundAt(first.x, first.z) : null;
    if (!path || (offY !== null && r.body.y - offY > SAFE_FALL)) {
      hud.toast("Can't get there");
      return false;
    }
    route = path;
    walkGoal = p.clone();
    walkThen = arrive ?? null;
    lastPos.copyFrom(r.position);
    const end = path[path.length - 1];
    marker.setEnabled(!arrive);
    marker.position.set(end.x, (world.groundAt(end.x, end.z) ?? p.y) + 0.08, end.z);
    return true;
  }
  function arrived(): void {
    const then = walkThen;
    stopWalk();
    then?.then();
  }
  function walkInput(): { x: number; y: number } {
    const j = hud.joystick();
    const r = rigRef;
    if (!r || !walkGoal || route.length === 0) return j;
    if (busy() || Math.hypot(j.x, j.y) > 0.15) { if (!busy()) overriddenAt = performance.now(); stopWalk(); return j; }
    // routes keep to the ground: up on something after a jump (a bench, the Lookout), the walk ends before it
    // could walk the adventurer off the edge
    const b = r.body;
    if (b.grounded) {
      if (world.groundAt(b.x, b.z) !== null) walkOnGround = true;
      else if (walkOnGround && world.surfaceAt(b.x, b.z) !== null) { stopWalk(); return j; }
    }
    const px = r.position.x, pz = r.position.z;
    if (walkThen && Math.hypot(walkGoal.x - px, walkGoal.z - pz) <= walkThen.within) { arrived(); return j; }
    // on to the next waypoint once this one is close
    while (route.length > 1 && Math.hypot(route[0].x - px, route[0].z - pz) < WAYPOINT_REACHED) route.shift();
    const wp = route[0];
    const dx = wp.x - px, dz = wp.z - pz;
    const dist = Math.hypot(dx, dz);
    const last = route.length === 1;
    if (last && dist <= ARRIVED) { arrived(); return j; }
    // world direction -> the rig's camera-relative input space
    const a = r.camera.alpha;
    const fx = -Math.cos(a), fz = -Math.sin(a), rx = fz, rz = -fx;
    const ux = dx / dist, uz = dz / dist;
    const k = last ? Math.min(1, 0.35 + dist / 3) : 1;   // ease in on arrival
    return { x: (ux * rx + uz * rz) * k, y: (ux * fx + uz * fz) * k };
  }
  // Any movement key cancels a tap-to-walk (not while typing).
  window.addEventListener('keydown', (e) => {
    if (!isTyping(e) && /^(Key[WASD]|Arrow)/.test(e.code)) { overriddenAt = performance.now(); stopWalk(); }
  });

  const makeRig = (): PlayerRig => {
    const r = createPlayerRig(scene, {
      canvas,
      world,
      joystick: () => walkInput(),
      onTap: (tap: TapInfo) => {
        if (opts.onTap?.(tap)) return;
        if (busy() || !hud.settings.tapToWalk) return;
        if (tap.point) walkTo(tap.point);        // tap the ground (or something on it) to walk there
      },
    });
    world.attachCamera(r.camera);
    world.addShadowCaster(r.view.root);
    r.camera.maxZ = 8000;   // the sky dome must never be clipped, even when the camera looks up
    const start = world.anchor('playerStart');
    r.teleport(start.pos, start.facing);
    return r;
  };
  let rig = makeRig();
  rigRef = rig;

  const zoneLoaded: ((z: ZoneId) => void)[] = [];
  /** True while a zone change is half done (its scene is being replaced): the render loop draws nothing. */
  let swapping = false;
  function swapTo(z: ZoneId): void {
    swapping = true;
    try { rig.dispose(); } catch { /* a half-built rig */ }
    rigRef = null;
    scene.dispose();
    scene = new Scene(engine);
    zone = z;
    world = build(z);
    world.setQuality(quality);
    fpsSettle = 4; slowTime = 0;
    passable = withClearance((x, zz) => world.groundAt(x, zz) !== null, CLEARANCE);
    marker = makeMarker();
    rig = makeRig();
    rigRef = rig;
    swapping = false;
  }
  function loadZone(z: ZoneId): void {
    // a zone with no look built yet: refused before anything is torn down (the current scene keeps running)
    if (!BUILT_ZONES.has(z)) { hud.toast("That area isn't open yet"); throw new Error(`zone ${z} has no client build yet`); }
    stopWalk();
    const from = zone;
    try {
      swapTo(z);
    } catch (err) {
      // Building the zone failed (a lost GL context, out of memory on a phone): put the previous zone back; if
      // even that fails, the page cannot carry on, so it reloads.
      console.error('loading zone', z, 'failed', err);
      try {
        swapTo(from);
      } catch (err2) {
        console.error('restoring zone', from, 'failed', err2);
        hud.toast('Something went wrong, reloading…');
        window.setTimeout(() => location.reload(), 1200);
        throw err2;
      }
      hud.toast("Couldn't load the next area");
      throw err;
    }
    for (const cb of zoneLoaded) cb(z);
  }

  // the touch Jump button lives in the HUD's thumb cluster (Space is the rig's own)
  hud.on((e) => { if (e.type === 'jump' && !busy()) rigRef?.jump(); });
  window.addEventListener('resize', () => engine.resize());

  return {
    canvas, hudRoot, touch, engine, hud,
    get scene() { return scene; },
    get world() { return world; },
    get rig() { return rig; },
    get zone() { return zone; },
    get walking() { return walkGoal !== null; },
    get walkOverriddenAt() { return overriddenAt; },
    loadZone,
    onZoneLoaded(cb) { zoneLoaded.push(cb); },
    walkTo,
    start(frame) {
      let last = performance.now();
      let lastFrameMs = last;
      engine.runRenderLoop(() => {
        if (swapping || scene.isDisposed) return; // a zone change that failed half way: nothing to draw
        const now = performance.now();
        // game time follows real time down to 10 fps (the server checks jumps against real time)
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;

        // If the frame rate stays under ~28 fps for 4 seconds, drop one quality level.
        if (fpsSettle > 0) fpsSettle -= dt;
        else if (quality !== 'low' && !lockQuality) {
          slowTime = now - lastFrameMs > 36 ? slowTime + dt : Math.max(0, slowTime - dt * 2);
          if (slowTime > 4) {
            quality = quality === 'high' ? 'med' : 'low';
            world.setQuality(quality);
            slowTime = 0; fpsSettle = 4;
          }
        }
        lastFrameMs = now;
        rig.update(dt);
        if (walkGoal && walkThen?.follow) {
          replanIn -= dt;
          if (replanIn <= 0) {
            const a = walkThen, goal = a.follow!();
            if (!goal) stopWalk();
            else if (Vector3.Distance(goal, walkGoal) > 0.3) walkTo(goal, a);
            else replanIn = FOLLOW_REPLAN_S;
          }
        }
        if (walkGoal) {
          // give up if no progress for a moment (pushed against something)
          if (Vector3.Distance(rig.position, lastPos) < 1.2 * dt) stuckTime += dt; else stuckTime = 0;
          if (stuckTime > STUCK_S) stopWalk();
          marker.rotation.y += dt * 2;
        }
        lastPos.copyFrom(rig.position);
        world.update(dt);
        frame(dt);
        scene.render();
      });
    },
  };
}
