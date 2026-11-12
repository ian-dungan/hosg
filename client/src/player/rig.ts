// Player rig: the player's character + an overhead three-quarter ArcRotateCamera follow rig.
// Input is handled deliberately with Pointer Events on the canvas (no Babylon camera inputs):
//  - 1 pointer drag  -> orbit (alpha/beta)
//  - 2 pointer pinch -> zoom
//  - short tap/click -> onTap (picked entityId and/or ground point)
//  - wheel           -> zoom
//  - WASD / arrows   -> camera-relative movement (merged with the HUD joystick vector)
//  - Space           -> jump
// Position comes from the shared character controller (stepBody over world.surfaceAt): the same walking,
// stepping, jumping and falling the server checks.
import { Scene, ArcRotateCamera, Vector3, Plane, type AbstractMesh, type Node } from '@babylonjs/core';
import type { CreatePlayerRig, PlayerRig, PlayerRigOpts, TapInfo } from '../core/contracts';
import { makeCharacter } from './character';
import { RUN_SPEED, STEP_UP, makeBody, simulateDisplacement, stepBody, type Body, type Displacement, type Surface } from '@sg2/shared';

const ACCEL = 14;             // exponential approach rate toward target velocity (1/s)
const TURN_RATE = 12;         // rad/s max turn speed
const DEFAULT_RADIUS = 20;
const DEFAULT_BETA = (62 * Math.PI) / 180;   // 28 degrees down from horizontal, so the statue and sky are in view
const MIN_BETA = 0.3, MAX_BETA = 1.42;
const MIN_RADIUS = 7, MAX_RADIUS = 34;
const TAP_MS = 300;
const ROT_SENS = 0.0065;      // rad per CSS pixel
const TARGET_LIFT = 1.8;      // camera looks at chest height
const PORTRAIT_SHIFT = 2.6;   // view-space shift of the framing on narrow portrait screens (m at the target)

const wrapAngle = (a: number) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

const KEYMAP: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};

interface Ptr { id: number; x: number; y: number; sx: number; sy: number; t: number; moved: boolean; multi: boolean; type: string; button: number }

export const createPlayerRig: CreatePlayerRig = (scene: Scene, opts: PlayerRigOpts): PlayerRig => {
  const { canvas, world } = opts;
  const view = makeCharacter(scene, { kind: 'player' });
  view.setEntityId(0);

  const position = new Vector3(0, 0, 0);
  let facing = 0, facingGoal = 0;
  let moveScale = 1;
  let cinematic = false;
  let moving = false;
  const surface: Surface = (x, z) => world.surfaceAt(x, z);
  let body: Body = makeBody(0, 0, surface);
  let jumpWanted = false;            // a jump requested since the last step
  let showY = body.y;                // the character's drawn height: eases over small steps, else body.y
  const doJump = () => { if (moveScale > 0 && !cinematic) jumpWanted = true; };
  const vel = { x: 0, z: 0 };
  let running = false;
  /** A displacement playing (a dodge or a knockback): its path samples and the time into it. */
  let disp: { path: { t: number; x: number; z: number; y: number }[]; t: number } | null = null;

  // camera
  let alphaGoal = -Math.PI / 2, betaGoal = DEFAULT_BETA, radiusGoal = DEFAULT_RADIUS;
  const camera = new ArcRotateCamera('playerCam', alphaGoal, betaGoal, radiusGoal, position.add(new Vector3(0, TARGET_LIFT, 0)), scene);
  camera.minZ = 0.3;
  camera.maxZ = 2000;
  camera.inputs.clear();          // we drive the camera ourselves
  camera.fov = 0.8;
  if (!scene.activeCamera) scene.activeCamera = camera;
  // Narrow portrait phones: the thumb cluster fills the lower right, so the adventurer is framed higher up the screen.
  const frame = () => {
    const portrait = innerHeight > innerWidth && innerWidth <= 700;
    camera.targetScreenOffset.set(0, portrait ? PORTRAIT_SHIFT : 0);
  };
  frame();
  window.addEventListener('resize', frame);

  const alphaBehind = (f: number) => Math.atan2(-Math.cos(f), -Math.sin(f));

  // ── keyboard ──
  const keys = new Set<string>();
  const isTyping = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space' && !e.repeat) { doJump(); e.preventDefault(); }
    if (KEYMAP[e.code]) { keys.add(e.code); if (e.code.startsWith('Arrow')) e.preventDefault(); }
  };
  const onKeyUp = (e: KeyboardEvent) => { keys.delete(e.code); };
  const onBlur = () => keys.clear();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  // ── pointers ──
  canvas.style.touchAction = 'none';
  const ptrs = new Map<number, Ptr>();
  let pinchDist = 0;
  const local = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const twoDist = () => {
    const [a, b] = [...ptrs.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    const p = local(e);
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    ptrs.set(e.pointerId, { id: e.pointerId, x: p.x, y: p.y, sx: p.x, sy: p.y, t: e.timeStamp || performance.now(), moved: false, multi: false, type: e.pointerType, button: e.button });
    if (ptrs.size >= 2) {
      for (const q of ptrs.values()) q.multi = true;
      pinchDist = twoDist();
    }
  };
  const onMove = (e: PointerEvent) => {
    const q = ptrs.get(e.pointerId);
    if (!q) return;
    const p = local(e);
    const dx = p.x - q.x, dy = p.y - q.y;
    q.x = p.x; q.y = p.y;
    const thresh = q.type === 'mouse' ? 6 : 10;
    if (!q.moved && Math.hypot(q.x - q.sx, q.y - q.sy) > thresh) q.moved = true;
    if (cinematic) return;
    if (ptrs.size >= 2) {
      const d = twoDist();
      if (pinchDist > 0 && d > 0) radiusGoal = clamp(radiusGoal * (pinchDist / d), MIN_RADIUS, MAX_RADIUS);
      pinchDist = d;
    } else if (q.moved) {
      alphaGoal -= dx * ROT_SENS;
      betaGoal = clamp(betaGoal - dy * ROT_SENS, MIN_BETA, MAX_BETA);
    }
  };
  const endPtr = (e: PointerEvent, cancelled: boolean) => {
    const q = ptrs.get(e.pointerId);
    if (!q) return;
    ptrs.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (ptrs.size === 2) pinchDist = twoDist();
    const quick = (e.timeStamp || performance.now()) - q.t < TAP_MS;
    if (!cancelled && !q.moved && !q.multi && quick && !(q.type === 'mouse' && q.button !== 0)) doTap(q.x, q.y);
  };
  const onUp = (e: PointerEvent) => endPtr(e, false);
  const onCancel = (e: PointerEvent) => endPtr(e, true);
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (cinematic) return;
    const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    radiusGoal = clamp(radiusGoal * Math.exp(dy * 0.0012), MIN_RADIUS, MAX_RADIUS);
  };
  const onCtx = (e: Event) => e.preventDefault();
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('lostpointercapture', onCancel);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onCtx);

  // ── picking ──
  const entityOf = (m: AbstractMesh | null): number | null => {
    let n: Node | null = m;
    while (n) {
      const id = (n.metadata as { entityId?: unknown } | null | undefined)?.entityId;
      if (typeof id === 'number') return id;
      n = n.parent;
    }
    return null;
  };
  const doTap = (x: number, y: number) => {
    const pick = scene.pick(x, y, (m) => m.isPickable && m.isEnabled() && m.isVisible, false, camera);
    const entityId = pick?.hit ? entityOf(pick.pickedMesh) : null;
    let point: Vector3 | null = null;
    if (pick?.hit && entityId === null && pick.pickedPoint) point = pick.pickedPoint.clone();
    else {
      // ground point: first non-entity hit, else the plane at the player's feet
      const g = scene.pick(x, y, (m) => m.isPickable && m.isEnabled() && m.isVisible && entityOf(m) === null, false, camera);
      if (g?.hit && g.pickedPoint) point = g.pickedPoint.clone();
      else {
        const ray = scene.createPickingRay(x, y, null, camera);
        const d = ray.intersectsPlane(Plane.FromPositionAndNormal(position, Vector3.Up()));
        if (d !== null && d > 0) point = ray.origin.add(ray.direction.scale(d));
      }
    }
    const tap: TapInfo = { entityId, point };
    opts.onTap(tap);
  };

  const rig: PlayerRig = {
    view,
    camera,
    position,
    get facing() { return facing; },
    get moving() { return moving; },
    get body() { return body; },
    teleport(pos: Vector3, f: number) {
      disp = null;
      body = makeBody(pos.x, pos.z, surface);
      if (surface(pos.x, pos.z) === null) body.y = body.peakY = pos.y;
      position.set(body.x, body.y, body.z);
      showY = body.y;
      jumpWanted = false;
      facing = facingGoal = f;
      vel.x = vel.z = 0;
      view.root.position.copyFrom(position);
      view.root.rotation.y = facing;
      if (!cinematic) {
        camera.target.copyFrom(position).addInPlaceFromFloats(0, TARGET_LIFT, 0);
        alphaGoal = camera.alpha = alphaBehind(f);
      }
    },
    place(pos: Vector3) {
      disp = null;
      // Where the server says the adventurer is: on the surface if the height is on (or under) it, else in the
      // air there, falling from rest. Facing and camera angle stay; the camera target follows as usual.
      body = makeBody(pos.x, pos.z, surface);
      const ground = surface(pos.x, pos.z);
      if (ground === null || pos.y > ground + 0.05) Object.assign(body, { y: pos.y, peakY: pos.y, grounded: ground === null });
      position.set(body.x, body.y, body.z);
      showY = body.y;
      jumpWanted = false;
      vel.x = vel.z = 0;
      view.root.position.copyFrom(position);
    },
    setMoveScale(s: number) { moveScale = clamp(Number.isFinite(s) ? s : 0, 0, 1.5); },
    get displacing() { return disp !== null; },
    displace(from, d: Displacement) {
      // the shared simulation from `from`: the server ran the same and ends the body at the same point
      const r = simulateDisplacement(from, d, surface);
      disp = { path: r.path, t: 0 };
      body = makeBody(from.x, from.z, surface);
      const g = surface(from.x, from.z);
      if (g === null || from.y > g + 0.05) Object.assign(body, { y: from.y, peakY: from.y, grounded: g === null });
      position.set(body.x, body.y, body.z);
      jumpWanted = false;
      vel.x = vel.z = 0;
    },
    faceTowards(x: number, z: number) {
      const dx = x - position.x, dz = z - position.z;
      if (dx * dx + dz * dz > 1e-6) facingGoal = Math.atan2(dx, dz);
    },
    jump() { doJump(); },
    setCinematic(on: boolean) { cinematic = on; if (on) ptrs.forEach((p) => (p.moved = true)); },
    update(rawDt: number) {
      const dt = Math.min(0.1, Math.max(0, rawDt));
      // input
      let ix = 0, iy = 0;
      for (const k of keys) { const v = KEYMAP[k]; if (v) { ix += v[0]; iy += v[1]; } }
      const j = opts.joystick();
      if (j) { ix += j.x || 0; iy += j.y || 0; }
      let mag = Math.hypot(ix, iy);
      if (mag > 1) { ix /= mag; iy /= mag; mag = 1; }
      if (mag < 0.08) { ix = iy = 0; mag = 0; }
      moving = mag > 0 && moveScale > 0;

      // camera-relative direction (forward = from camera toward target on the ground plane)
      const fx = -Math.cos(camera.alpha), fz = -Math.sin(camera.alpha);
      const rx = fz, rz = -fx;
      const wx = rx * ix + fx * iy, wz = rz * ix + fz * iy;
      const speed = RUN_SPEED * moveScale;
      const tx = wx * speed, tz = wz * speed;
      const k = 1 - Math.exp(-ACCEL * dt);
      vel.x += (tx - vel.x) * k; vel.z += (tz - vel.z) * k;
      if (moveScale === 0) { vel.x = vel.z = 0; }

      // the shared controller: walk (sliding along whatever blocks), step, jump, fall
      const jump = jumpWanted && moveScale > 0 && !cinematic && !disp;
      jumpWanted = false;
      const x0 = body.x, z0 = body.z;
      let res: { landed: boolean; drop: number } = { landed: false, drop: 0 };
      if (disp) {
        // a displacement plays its path, input ignored; at its end the body stands where the path ends
        disp.t += dt;
        const path = disp.path, last = path[path.length - 1];
        let i = 1;
        while (i < path.length - 1 && path[i].t < disp.t) i++;
        const a = path[i - 1] ?? last, b = path[i] ?? last;
        const k = b.t > a.t ? Math.min(1, Math.max(0, (disp.t - a.t) / (b.t - a.t))) : 1;
        const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k, z = a.z + (b.z - a.z) * k;
        if (disp.t >= last.t) {
          body = makeBody(last.x, last.z, surface);
          const g = surface(last.x, last.z);
          if (g === null || last.y > g + 0.05) Object.assign(body, { y: last.y, peakY: last.y, grounded: g === null });
          disp = null;
        } else Object.assign(body, { x, y, z, vy: 0, grounded: false, peakY: y });
        vel.x = vel.z = 0;
        moving = false;
      } else res = stepBody(body, { vx: vel.x, vz: vel.z, jump }, dt, surface);
      if (dt > 0 && !disp) {
        // keep only the velocity that was actually achieved (blocked or sliding along a wall)
        const ax = (body.x - x0) / dt, az = (body.z - z0) / dt;
        if (Math.abs(ax - vel.x) > 1e-3) vel.x = ax;
        if (Math.abs(az - vel.z) > 1e-3) vel.z = az;
      }
      position.set(body.x, body.y, body.z);
      // drawn height: ease over small steps (kerbs, a step down) so the character does not pop; exact otherwise
      if (body.grounded && Math.abs(body.y - showY) <= STEP_UP + 0.01) showY += (body.y - showY) * (1 - Math.exp(-14 * dt));
      else showY = body.y;
      if (res.landed) opts.onLand?.(res.drop);

      // facing: toward movement while moving, else toward faceTowards goal
      const sp = Math.hypot(vel.x, vel.z);
      if (moving && sp > 0.3) facingGoal = Math.atan2(vel.x, vel.z);
      const diff = wrapAngle(facingGoal - facing);
      const step = TURN_RATE * dt;
      facing = wrapAngle(facing + clamp(diff, -step, step));

      // animation
      const nowRunning = sp > 0.8;
      if (nowRunning !== running) { running = nowRunning; view.setPose(running ? 'run' : 'idle'); }
      view.root.position.copyFrom(position);
      view.root.position.y = showY;
      view.root.rotation.y = facing;
      view.update(dt);

      // camera follow
      if (!cinematic) {
        const tk = 1 - Math.exp(-8 * dt);
        const t = camera.target;
        t.x += (position.x - t.x) * tk;
        t.y += (position.y + TARGET_LIFT - t.y) * tk;
        t.z += (position.z - t.z) * tk;
        const ck = 1 - Math.exp(-16 * dt);
        camera.alpha += wrapAngle(alphaGoal - camera.alpha) * ck;
        camera.beta += (betaGoal - camera.beta) * ck;
        camera.radius += (radiusGoal - camera.radius) * (1 - Math.exp(-10 * dt));
      }
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', frame);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('lostpointercapture', onCancel);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onCtx);
      for (const id of ptrs.keys()) { try { canvas.releasePointerCapture(id); } catch { /* ignore */ } }
      ptrs.clear(); keys.clear();
      view.dispose();
      camera.dispose();
    },
  };
  view.root.position.copyFrom(position);
  return rig;
};
