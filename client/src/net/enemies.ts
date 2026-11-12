// The room's enemies, drawn from server state: one model each (combat/enemies.ts), moved smoothly between
// updates like other adventurers, with the server's mode and wind-up driving its animation.
import type { Scene } from '@babylonjs/core';
import { ENEMY_ATTACKS, ENEMY_KINDS, type EnemyAttackId, type EnemyKindId } from '@sg2/shared';
import type { WorldApi } from '../core/contracts';
import { makeEnemy, type EnemyMode, type EnemyView } from '../combat/enemies';
import { PoseBuffer } from './interp';
import type { EnemyStateView, ZoneRoom } from './session';

/** Speed (m/s) above which an enemy plays its run cycle. */
const RUN_ABOVE = 0.6;

interface Drawn {
  view: EnemyView;
  buf: PoseBuffer;
  kind: EnemyKindId;
  /** The server's mode and wind-up last applied. */
  mode: string; windup: string;
  x: number; z: number; y: number;
  placed: boolean;
  moving: boolean;
}

export interface Enemies {
  /** Call every frame: moves and animates every enemy. */
  update(dt: number): void;
  /** The enemy with this entity id as drawn now, if it is in the room. */
  get(eid: number): { view: EnemyView; x: number; z: number; y: number } | undefined;
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

export function createEnemies(scene: Scene, world: WorldApi, room: ZoneRoom): Enemies {
  const drawn = new Map<number, Drawn>();

  const apply = (d: Drawn, e: EnemyStateView) => {
    const changed = e.mode !== d.mode || e.windup !== d.windup;
    if (!changed) return;
    // a wind-up that ends in anything but a stun or death has just struck
    if (d.mode === 'windup' && e.mode !== 'windup' && e.mode !== 'stunned' && e.mode !== 'dead') d.view.strike();
    d.mode = e.mode; d.windup = e.windup;
    if (e.mode === 'windup' && isAttack(e.windup)) d.view.setMode('windup', e.windup, e.windupTotal > 0 ? e.windupTotal : undefined);
    else d.view.setMode(viewMode(e.mode, d.moving));
  };

  const add = (eid: number, e: EnemyStateView): Drawn | null => {
    if (!isKind(e.kind)) return null;
    const view = makeEnemy(scene, e.kind);
    view.setEntityId(eid);
    world.addShadowCaster(view.root);
    const d: Drawn = { view, buf: new PoseBuffer(), kind: e.kind, mode: '', windup: '', x: e.x, z: e.z, y: e.y, placed: false, moving: false };
    drawn.set(eid, d);
    return d;
  };

  const onState = () => {
    const now = performance.now();
    const seen = new Set<number>();
    room.state.enemies?.forEach((e) => {
      const eid = e.eid;
      seen.add(eid);
      const d = drawn.get(eid) ?? add(eid, e);
      if (!d) return;
      d.buf.push(now, e.x, e.z, e.facing, e.y);
      apply(d, e);
    });
    for (const [eid, d] of drawn) if (!seen.has(eid)) { d.view.dispose(); drawn.delete(eid); }
  };
  room.onStateChange(onState);
  onState();

  return {
    update(dt) {
      const now = performance.now();
      for (const d of drawn.values()) {
        const s = d.buf.sample(now);
        if (!s) continue;
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
    dispose() {
      room.onStateChange.remove(onState);
      for (const d of drawn.values()) d.view.dispose();
      drawn.clear();
    },
  };
}
