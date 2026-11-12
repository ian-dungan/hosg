// The room's enemies, drawn from server state: one model each (combat/enemies.ts), moved smoothly between
// updates like other adventurers, with the server's mode and wind-up driving its animation.
// Enemies come and go as they enter and leave this client's interest radius: their views are parked and
// reused per kind (KindPool), so walking past a camp never rebuilds a model.
import type { Scene } from '@babylonjs/core';
import { ENEMY_ATTACKS, ENEMY_KINDS, type EnemyAttackId, type EnemyKindId } from '@sg2/shared';
import type { WorldApi } from '../core/contracts';
import { makeEnemy, type EnemyMode, type EnemyView } from '../combat/enemies';
import { PoseBuffer, type DrawnPose } from './interp';
import { windupElapsedS, type EnemyStateView, type ZoneRoom } from './session';

/** Speed (m/s) above which an enemy plays its run cycle. */
const RUN_ABOVE = 0.6;
/** An enemy first seen dead starts this far into its death (its fall and sinking done). */
const DEAD_SETTLED_S = 10;
/** A jump between two updates longer than this (m) is drawn at once, not slid through. */
const SNAP_M = 5;

interface Drawn {
  view: EnemyView;
  buf: PoseBuffer;
  kind: EnemyKindId;
  /** The server's mode and wind-up last applied. */
  mode: string; windup: string;
  x: number; z: number; y: number;
  placed: boolean;
  moving: boolean;
  /** The latest position pushed (for the snap check). */
  lx: number; lz: number;
}

export interface Enemies {
  /** Call every frame: moves and animates every enemy. */
  update(dt: number): void;
  /** The enemy with this entity id as drawn now, if it is in view. */
  get(eid: number): { view: EnemyView; x: number; z: number; y: number } | undefined;
  /** Every enemy in view, as drawn now. */
  forEach(cb: (eid: number, d: { view: EnemyView; x: number; z: number; y: number; kind: EnemyKindId }) => void): void;
  /** Removes every enemy model (leaving the room). */
  dispose(): void;
}

const isKind = (k: string): k is EnemyKindId => Object.prototype.hasOwnProperty.call(ENEMY_KINDS, k);
const isAttack = (a: string): a is EnemyAttackId => Object.prototype.hasOwnProperty.call(ENEMY_ATTACKS, a);

/** The view mode for a server mode: 'fight' and 'return' run while moving; the rest map straight across. */
export function viewMode(serverMode: string, moving: boolean): EnemyMode {
  switch (serverMode) {
    case 'windup': return 'windup';
    case 'stunned': return 'stunned';
    case 'dead': return 'dead';
    case 'return': return moving ? 'return' : 'idle';
    default: return moving ? 'run' : 'idle';
  }
}

/**
 * Whether a wind-up that ended in `next` released its attack: it did when the enemy carries on fighting (or
 * stands); going home (a leash), a stun (an interrupt) or a death cancelled it.
 */
export function windupReleased(next: string): boolean {
  return next === 'fight' || next === 'idle';
}

/** Parked views per kind, reused before a new one is built. */
export class KindPool<K, V> {
  private spare = new Map<K, V[]>();
  constructor(private make: (k: K) => V, private park: (v: V) => void, private revive: (v: V) => void) {}
  take(k: K): V {
    const v = this.spare.get(k)?.pop();
    if (v === undefined) return this.make(k);
    this.revive(v);
    return v;
  }
  give(k: K, v: V): void {
    this.park(v);
    let l = this.spare.get(k);
    if (!l) this.spare.set(k, (l = []));
    l.push(v);
  }
  /** Every parked view (to dispose them). */
  drain(): V[] {
    const all = [...this.spare.values()].flat();
    this.spare.clear();
    return all;
  }
  get size(): number { let n = 0; for (const l of this.spare.values()) n += l.length; return n; }
}

export function createEnemies(scene: Scene, world: WorldApi, room: ZoneRoom): Enemies {
  const drawn = new Map<number, Drawn>();
  const pool = new KindPool<EnemyKindId, EnemyView>(
    (kind) => { const v = makeEnemy(scene, kind); world.addShadowCaster(v.root); return v; },
    (v) => { v.setTargeted(false); v.root.setEnabled(false); },
    (v) => v.reset(),
  );

  const apply = (d: Drawn, e: EnemyStateView) => {
    const changed = e.mode !== d.mode || e.windup !== d.windup;
    if (!changed) return;
    if (d.mode === 'windup' && e.mode !== 'windup' && windupReleased(e.mode)) d.view.strike();
    const firstSight = d.mode === '';
    d.mode = e.mode; d.windup = e.windup;
    // A wind-up plays from where the server's clock says it is (from its telegraph's start): 0 when seen as
    // it starts, part way through for an enemy that came into view mid-wind-up.
    if (e.mode === 'windup' && isAttack(e.windup)) d.view.setMode('windup', e.windup, e.windupTotal > 0 ? e.windupTotal : undefined, windupElapsedS(room.state, e.eid));
    // one that comes into view already dead lies still (its fall played before it was seen)
    else if (e.mode === 'dead' && firstSight) d.view.setMode('dead', undefined, undefined, DEAD_SETTLED_S);
    else d.view.setMode(viewMode(e.mode, d.moving));
  };

  const add = (eid: number, e: EnemyStateView): Drawn | null => {
    if (!isKind(e.kind)) return null;
    const view = pool.take(e.kind);
    view.setEntityId(eid);
    const d: Drawn = { view, buf: new PoseBuffer(), kind: e.kind, mode: '', windup: '', x: e.x, z: e.z, y: e.y, placed: false, moving: false, lx: e.x, lz: e.z };
    drawn.set(eid, d);
    return d;
  };
  const remove = (eid: number, d: Drawn) => { drawn.delete(eid); pool.give(d.kind, d.view); };

  const seen = new Set<number>();
  let now = 0;
  const visit = (e: EnemyStateView) => {
    const eid = e.eid;
    seen.add(eid);
    let d = drawn.get(eid);
    if (!d) { const made = add(eid, e); if (!made) return; d = made; }
    // a respawn (dead → alive) or a long jump is drawn at once, not slid through
    const respawned = d.mode === 'dead' && e.mode !== 'dead';
    if (respawned || Math.hypot(e.x - d.lx, e.z - d.lz) > SNAP_M) { d.buf.clear(); d.placed = false; }
    d.lx = e.x; d.lz = e.z;
    d.buf.push(now, e.x, e.z, e.facing, e.y);
    d.view.setSurging(!!e.surging);
    apply(d, e);
  };
  const onState = () => {
    now = performance.now();
    seen.clear();
    room.state.enemies?.forEach(visit);
    for (const [eid, d] of drawn) if (!seen.has(eid)) remove(eid, d);
  };
  room.onStateChange(onState);
  onState();

  const s: DrawnPose = { x: 0, z: 0, y: 0, facing: 0 };
  return {
    update(dt) {
      const t = performance.now();
      for (const d of drawn.values()) {
        if (!d.buf.sampleInto(t, s)) continue;
        const root = d.view.root;
        const speed = d.placed && dt > 0 ? Math.hypot(s.x - d.x, s.z - d.z) / dt : 0;
        d.x = s.x; d.z = s.z; d.y = s.y; d.placed = true;
        root.position.set(s.x, s.y, s.z);
        root.rotation.y = s.facing;
        const moving = speed > RUN_ABOVE;
        if (moving !== d.moving) {
          d.moving = moving;
          if (d.mode !== 'windup') d.view.setMode(viewMode(d.mode, moving));
        }
        d.view.update(dt);
      }
    },
    get(eid) {
      const d = drawn.get(eid);
      return d ? { view: d.view, x: d.x, z: d.z, y: d.y } : undefined;
    },
    forEach(cb) {
      for (const [eid, d] of drawn) cb(eid, { view: d.view, x: d.x, z: d.z, y: d.y, kind: d.kind });
    },
    dispose() {
      room.onStateChange.remove(onState);
      for (const d of drawn.values()) d.view.dispose();
      drawn.clear();
      for (const v of pool.drain()) v.dispose();
    },
  };
}
