// The other adventurers in the room: one character each, a name label above the head, and
// movement (and height: jumps, falls, platforms) smoothed between server updates.
import { Matrix, Vector3, type Scene } from '@babylonjs/core';
import type { CharacterView, WorldApi } from '../core/contracts';
import { makeCharacter } from '../player/character';
import { PoseBuffer } from './interp';
import type { ZoneRoom } from './session';

/** Speed (m/s) above which a remote adventurer plays the run cycle. */
const RUN_ABOVE = 0.8;
/** Label height above the head (m). */
const LABEL_LIFT = 0.45;
/** Parked characters wait here, out of sight (their ground shadow follows them). */
const PARK = new Vector3(0, -1000, 0);

const CSS = /* css */ `
.sg-labels{z-index:0}
.sg-nl{position:absolute;left:0;top:0;padding:2px 9px 3px;border-radius:10px;white-space:nowrap;
  font:600 13px/1.2 var(--sans);color:var(--cream);background:rgba(16,18,42,.55);
  box-shadow:0 0 0 1px rgba(255,226,160,.3);will-change:transform}
`;

interface Remote {
  view: CharacterView;
  label: HTMLElement;
  buf: PoseBuffer;
  name: string;
  running: boolean;
  /** False until the first pose is drawn (so a newcomer does not appear to sprint in from where it was parked). */
  placed: boolean;
}

export interface Remotes {
  /** Call every frame: moves, animates and labels everyone. */
  update(dt: number): void;
  /** Other adventurers currently shown. */
  count(): number;
  /** Removes every character and label (leaving the room). */
  dispose(): void;
}

/**
 * Character views are kept and reused, so adventurers coming and going do not pile up shadow casters. The pool
 * belongs to one scene: when the scene changes (a zone change) or is disposed, its spare views are disposed.
 */
const spare: CharacterView[] = [];
let spareScene: Scene | null = null;
function clearSpare(): void {
  for (const v of spare.splice(0)) v.dispose();
  spareScene = null;
}
function useScene(scene: Scene): void {
  if (spareScene === scene) return;
  clearSpare();
  spareScene = scene;
  scene.onDisposeObservable.addOnce(() => { if (spareScene === scene) clearSpare(); });
}
/** Spare character views waiting for reuse (tests and leak checks). */
export const spareViews = (): number => spare.length;

function injectStyles(): void {
  if (document.getElementById('sg-net-labels-css')) return;
  const s = document.createElement('style');
  s.id = 'sg-net-labels-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function createRemotes(scene: Scene, world: WorldApi, room: ZoneRoom, mySessionId: string): Remotes {
  injectStyles();
  useScene(scene);
  const layer = document.createElement('div');
  layer.className = 'sg-hud sg-labels';
  // Under the HUD panels (#hud), above the 3D view.
  const host = document.getElementById('hud') ?? document.body;
  host.prepend(layer);

  const remotes = new Map<string, Remote>();
  const at = new Vector3();
  const screen = new Vector3();

  function add(sessionId: string): Remote {
    let view = spare.pop();
    if (!view) {
      view = makeCharacter(scene, { kind: 'player' });
      world.addShadowCaster(view.root);
    }
    view.root.setEnabled(true);
    view.setPose('idle');
    const label = document.createElement('div');
    label.className = 'sg-nl';
    label.style.visibility = 'hidden';
    layer.appendChild(label);
    const r: Remote = { view, label, buf: new PoseBuffer(), name: '', running: false, placed: false };
    remotes.set(sessionId, r);
    return r;
  }

  function remove(sessionId: string): void {
    const r = remotes.get(sessionId);
    if (!r) return;
    remotes.delete(sessionId);
    r.label.remove();
    if (scene.isDisposed || spareScene !== scene) { r.view.dispose(); return; }
    r.view.root.position.copyFrom(PARK);
    r.view.root.setEnabled(false);
    spare.push(r.view);
  }

  // Every state patch: record each adventurer's pose at the time it arrived, add newcomers, drop leavers.
  const onState = () => {
    const now = performance.now();
    const seen = new Set<string>();
    room.state.players?.forEach((p, sessionId) => {
      if (sessionId === mySessionId) return;
      seen.add(sessionId);
      const r = remotes.get(sessionId) ?? add(sessionId);
      r.buf.push(now, p.x, p.z, p.facing, p.y);
      if (p.name !== r.name) { r.name = p.name; r.label.textContent = p.name; }
    });
    for (const sessionId of [...remotes.keys()]) if (!seen.has(sessionId)) remove(sessionId);
  };
  room.onStateChange(onState);
  onState();

  return {
    update(dt) {
      const now = performance.now();
      const camera = scene.activeCamera;
      const w = scene.getEngine().getRenderingCanvas()?.clientWidth ?? window.innerWidth;
      const h = scene.getEngine().getRenderingCanvas()?.clientHeight ?? window.innerHeight;
      const viewport = camera?.viewport.toGlobal(w, h);
      const transform = scene.getTransformMatrix();
      for (const r of remotes.values()) {
        const s = r.buf.sample(now);
        if (!s) continue;
        const root = r.view.root;
        const y = s.y; // the server's feet height: on a bench, up the Lookout, mid-jump
        const speed = r.placed && dt > 0 ? Math.hypot(s.x - root.position.x, s.z - root.position.z) / dt : 0;
        root.position.set(s.x, y, s.z);
        root.rotation.y = s.facing;
        r.placed = true;
        const running = speed > RUN_ABOVE;
        if (running !== r.running) { r.running = running; r.view.setPose(running ? 'run' : 'idle'); }
        r.view.update(dt);

        // Name label: project the point above the head to CSS pixels.
        let shown = false;
        if (viewport) {
          at.set(s.x, y + r.view.height + LABEL_LIFT, s.z);
          Vector3.ProjectToRef(at, Matrix.IdentityReadOnly, transform, viewport, screen);
          shown = screen.z > 0 && screen.z < 1 && screen.x > -100 && screen.x < w + 100 && screen.y > -40 && screen.y < h + 40;
          if (shown) r.label.style.transform = `translate(${screen.x.toFixed(1)}px,${screen.y.toFixed(1)}px) translate(-50%,-100%)`;
        }
        r.label.style.visibility = shown ? 'visible' : 'hidden';
      }
    },
    count: () => remotes.size,
    dispose() {
      room.onStateChange.remove(onState);
      for (const sessionId of [...remotes.keys()]) remove(sessionId);
      layer.remove();
    },
  };
}
