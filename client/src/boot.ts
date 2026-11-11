// Shady Grove 2 — what every entry starts with: engine, world, HUD, the adventurer and their camera,
// tap-to-walk, the touch Jump button and a render loop that steps quality down on slow devices.
import { Color3, Engine, MeshBuilder, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import type { HudApi, PlayerRig, Quality, TapInfo, WorldApi } from './core/contracts';
import { buildWorld } from './world/index';
import { createPlayerRig } from './player/rig';
import { createHud } from './hud/index';

export interface GameOpts {
  /** Handles a tap itself and returns true; otherwise a tap on walkable ground walks there. */
  onTap?: (tap: TapInfo) => boolean;
  /** True while something holds the adventurer (dialogue, cutscene): tap-to-walk stops and Jump does nothing. */
  busy?: () => boolean;
}

export interface Game {
  readonly canvas: HTMLCanvasElement;
  readonly hudRoot: HTMLElement;
  readonly touch: boolean;
  readonly engine: Engine;
  readonly scene: Scene;
  readonly world: WorldApi;
  readonly hud: HudApi;
  readonly rig: PlayerRig;
  /** Walk to `p` (null stops). With `arrive`, stop `within` metres of it and call `then`. */
  walkTo(p: Vector3 | null, arrive?: { within: number; then: () => void }): void;
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
  const scene = new Scene(engine);

  const world = buildWorld(scene);
  // Every device starts on full settings; a device that cannot keep up steps down by itself (see the render loop).
  let quality: Quality = 'high';
  world.setQuality(quality);
  let slowTime = 0, fpsSettle = 4;
  const lockQuality = /[?&]lockq/.test(location.search);   // playtests keep full settings even when slow
  const hud = createHud(hudRoot);

  // ── tap-to-walk: tap the ground (or a person) and the character walks there ──
  let rigRef: PlayerRig | null = null;
  let walkTarget: Vector3 | null = null;
  let walkThen: { within: number; then: () => void } | null = null;
  let stuckTime = 0;
  const lastPos = new Vector3();
  const marker = MeshBuilder.CreateTorus('walkMarker', { diameter: 1.1, thickness: 0.09, tessellation: 24 }, scene);
  const markerMat = new StandardMaterial('walkMarkerMat', scene);
  markerMat.emissiveColor = Color3.FromHexString('#F2B742');
  markerMat.disableLighting = true;
  marker.material = markerMat;
  marker.isPickable = false;
  marker.setEnabled(false);
  function walkTo(p: Vector3 | null, arrive?: { within: number; then: () => void }): void {
    walkTarget = p ? p.clone() : null;
    walkThen = arrive ?? null;
    stuckTime = 0;
    marker.setEnabled(!!p && !arrive);
    if (p) marker.position.set(p.x, (world.groundAt(p.x, p.z) ?? p.y) + 0.08, p.z);
  }
  function walkInput(): { x: number; y: number } {
    const j = hud.joystick();
    const r = rigRef;
    if (!r || !walkTarget) return j;
    if (busy() || Math.hypot(j.x, j.y) > 0.15) { walkTo(null); return j; }
    const dx = walkTarget.x - r.position.x, dz = walkTarget.z - r.position.z;
    const dist = Math.hypot(dx, dz);
    const stopAt = walkThen ? walkThen.within : 0.35;
    if (dist <= stopAt) {
      const then = walkThen;
      walkTo(null);
      then?.then();
      return j;
    }
    // world direction -> the rig's camera-relative input space
    const a = r.camera.alpha;
    const fx = -Math.cos(a), fz = -Math.sin(a), rx = fz, rz = -fx;
    const ux = dx / dist, uz = dz / dist;
    const k = Math.min(1, 0.35 + dist / 3);      // ease in on arrival
    return { x: (ux * rx + uz * rz) * k, y: (ux * fx + uz * fz) * k };
  }
  // Any movement key cancels a tap-to-walk (not while typing).
  window.addEventListener('keydown', (e) => {
    if (!isTyping(e) && /^(Key[WASD]|Arrow)/.test(e.code)) walkTo(null);
  });

  const rig = createPlayerRig(scene, {
    canvas,
    world,
    joystick: () => walkInput(),
    onTap: (tap: TapInfo) => {
      if (opts.onTap?.(tap)) return;
      if (busy()) return;
      if (tap.point && world.groundAt(tap.point.x, tap.point.z) !== null) {
        walkTo(tap.point);                     // tap the ground to walk there
      }
    },
  });
  rigRef = rig;
  world.attachCamera(rig.camera);
  world.addShadowCaster(rig.view.root);
  rig.camera.maxZ = 8000;   // the sky dome must never be clipped, even when the camera looks up
  const start = world.anchor('playerStart');
  rig.teleport(start.pos, start.facing);

  if (touch) {
    const jb = document.createElement('div');
    jb.textContent = 'Jump';
    jb.style.cssText = 'position:fixed;right:max(18px,env(safe-area-inset-right));bottom:calc(max(18px,env(safe-area-inset-bottom)) + 96px);width:72px;height:72px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:600 15px system-ui,sans-serif;color:#3a2a08;background:rgba(242,183,66,.88);box-shadow:0 2px 10px rgba(0,0,0,.3);pointer-events:auto;touch-action:none;';
    jb.addEventListener('pointerdown', (e) => { e.preventDefault(); if (!busy()) rig.jump(); });
    hudRoot.appendChild(jb);
  }
  window.addEventListener('resize', () => engine.resize());

  return {
    canvas, hudRoot, touch, engine, scene, world, hud, rig,
    walkTo,
    start(frame) {
      let last = performance.now();
      let lastFrameMs = last;
      engine.runRenderLoop(() => {
        const now = performance.now();
        const dt = Math.min(0.05, (now - last) / 1000);
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
        if (walkTarget) {
          // give up if blocked by an obstacle for a moment
          if (Vector3.Distance(rig.position, lastPos) < 1.2 * dt) stuckTime += dt; else stuckTime = 0;
          if (stuckTime > 0.6) walkTo(null);
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
