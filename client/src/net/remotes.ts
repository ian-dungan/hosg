// The other adventurers in the room: one character each, a name label above the head (their job's glyph, a
// health bar once hurt, a cast bar while they cast), and movement (and height: jumps, falls, platforms)
// smoothed between server updates. Their meshes carry their engine id, so a tap on one can focus them.
import { Matrix, Vector3, type Scene } from '@babylonjs/core';
import { ABILITIES, JOBS, TICK_HZ, isJobId, type AbilityId } from '@sg2/shared';
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
  box-shadow:0 0 0 1px rgba(255,226,160,.3);will-change:transform;display:flex;flex-direction:column;align-items:center;gap:2px}
.sg-nl-hp{width:54px;height:5px;border-radius:3px;overflow:hidden;background:rgba(10,10,26,.7);display:none}
.sg-nl-hp.on{display:block}
.sg-nl-hp i{display:block;height:100%;transform-origin:0 50%;background:linear-gradient(90deg,#5fb84a,#8FD16A)}
.sg-nl.dead{opacity:.55}
.sg-nl-top{display:flex;align-items:center;gap:5px}
.sg-nl-job{font:700 12px/1 var(--serif);font-variant-emoji:text;color:var(--goldl)}
.sg-nl-job:empty{display:none}
.sg-nl.focus{box-shadow:0 0 0 2px #8FD16A,0 0 10px rgba(143,209,106,.7);background:rgba(20,52,30,.7)}
.sg-nl-cast{display:none;flex-direction:column;align-items:center;gap:1px;font:600 10px/1.1 var(--sans);color:#ffe8a8}
.sg-nl-cast.on{display:flex}
.sg-nl-cast u{display:block;width:54px;height:4px;border-radius:2px;overflow:hidden;background:rgba(10,10,26,.7);text-decoration:none}
.sg-nl-cast u i{display:block;height:100%;transform-origin:0 50%;background:linear-gradient(90deg,#ffe08a,#F2B742)}
`;

interface Remote {
  view: CharacterView;
  label: HTMLElement;
  nameEl: HTMLElement;
  jobEl: HTMLElement;
  castEl: HTMLElement;
  castName: HTMLElement;
  castFill: HTMLElement;
  /** The cast shown (ability and castAt, '' and 0: none), and when it began here (performance.now ms). */
  castId: string; castAt: number; castTotal: number; castSince: number;
  eid: number;
  job: string;
  hpEl: HTMLElement;
  hpFill: HTMLElement;
  hp: number;
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
  /** The character drawn for this session, if it is in view. */
  viewOf(sessionId: string): CharacterView | undefined;
  /** The character drawn for the adventurer with engine id `eid`, if it is in view. */
  viewOfEid(eid: number): CharacterView | undefined;
  /** Marks the focused adventurer's label (null: none). */
  setFocus(eid: number | null): void;
  /** A short green pulse on an adventurer's label (a heal or an ally ability landing on them). */
  pulse(eid: number): void;
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
  let focus: number | null = null;
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
    const top = document.createElement('div'); top.className = 'sg-nl-top';
    const jobEl = document.createElement('b'); jobEl.className = 'sg-nl-job';
    const nameEl = document.createElement('span');
    top.append(jobEl, nameEl);
    const hpEl = document.createElement('div'); hpEl.className = 'sg-nl-hp';
    const hpFill = document.createElement('i'); hpEl.appendChild(hpFill);
    const castEl = document.createElement('div'); castEl.className = 'sg-nl-cast';
    const castName = document.createElement('span');
    const castBar = document.createElement('u'); const castFill = document.createElement('i'); castBar.appendChild(castFill);
    castEl.append(castName, castBar);
    label.append(top, hpEl, castEl);
    layer.appendChild(label);
    const r: Remote = { view, label, nameEl, jobEl, castEl, castName, castFill, castId: '', castAt: 0, castTotal: 1, castSince: 0, eid: -1, job: '', hpEl, hpFill, hp: -1, buf: new PoseBuffer(), name: '', running: false, placed: false };
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
  const seen = new Set<string>();
  const onState = () => {
    const now = performance.now();
    seen.clear();
    room.state.players?.forEach((p, sessionId) => {
      if (sessionId === mySessionId) return;
      seen.add(sessionId);
      const r = remotes.get(sessionId) ?? add(sessionId);
      r.buf.push(now, p.x, p.z, p.facing, p.y);
      if (p.name !== r.name) { r.name = p.name; r.nameEl.textContent = p.name; }
      const eid = p.eid ?? -1;
      if (eid !== r.eid) { r.eid = eid; if (eid >= 0) r.view.setEntityId(eid); r.label.classList.toggle('focus', eid === focus && eid >= 0); }
      const job = p.job ?? '';
      if (job !== r.job) { r.job = job; r.jobEl.textContent = isJobId(job) ? JOBS[job].glyph : ''; r.jobEl.title = isJobId(job) ? JOBS[job].name : ''; }
      // a cast: from when the server says it began (the clock), so one first seen late shows how far along it is
      const castId = p.cast ?? '', castAt = castId ? p.castAt ?? 0 : 0;
      if (castId !== r.castId || castAt !== r.castAt) {
        r.castId = castId; r.castAt = castAt;
        if (castId && Object.prototype.hasOwnProperty.call(ABILITIES, castId)) {
          const el = typeof room.state.clock === 'number' && typeof p.castAt === 'number' ? Math.max(0, (room.state.clock - p.castAt) / TICK_HZ) : 0;
          r.castTotal = Math.max(0.1, p.castTotal ?? 1); r.castSince = now - el * 1000;
          r.castName.textContent = ABILITIES[castId as AbilityId].name;
          r.castEl.classList.add('on');
        } else { r.castId = ''; r.castEl.classList.remove('on'); }
      }
      // health under the name once it is not full (and greyed when dead)
      const f = p.maxHp > 0 ? Math.max(0, Math.min(1, p.hp / p.maxHp)) : 1;
      if (f !== r.hp) {
        r.hp = f;
        r.hpFill.style.transform = `scaleX(${f.toFixed(3)})`;
        r.hpEl.classList.toggle('on', f < 1);
        r.label.classList.toggle('dead', f <= 0);
      }
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
        // the focused adventurer's frame (top left) names them: their label would only repeat it
        if (focus !== null && r.eid === focus) shown = false;
        r.label.style.visibility = shown ? 'visible' : 'hidden';
        if (r.castId && shown) r.castFill.style.transform = `scaleX(${Math.min(1, (now - r.castSince) / 1000 / r.castTotal).toFixed(3)})`;
      }
    },
    count: () => remotes.size,
    viewOf: (sessionId) => remotes.get(sessionId)?.view,
    viewOfEid(eid) { for (const r of remotes.values()) if (r.eid === eid) return r.view; return undefined; },
    setFocus(eid) {
      if (eid === focus) return;
      focus = eid;
      for (const r of remotes.values()) r.label.classList.toggle('focus', r.eid >= 0 && r.eid === eid);
    },
    pulse(eid) {
      for (const r of remotes.values()) {
        if (r.eid !== eid) continue;
        r.label.animate([{ boxShadow: '0 0 0 3px #b8f59a,0 0 22px rgba(143,209,106,1)', backgroundColor: 'rgba(40,110,50,.85)' }, { boxShadow: '0 0 0 1px rgba(255,226,160,.3)', backgroundColor: 'rgba(16,18,42,.55)' }], { duration: 900, easing: 'ease-out' });
      }
    },
    dispose() {
      room.onStateChange.remove(onState);
      for (const sessionId of [...remotes.keys()]) remove(sessionId);
      layer.remove();
    },
  };
}
