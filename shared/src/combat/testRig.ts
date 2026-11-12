// Test support only (no test of its own): a flat synthetic zone and a 15 Hz rig over the real engine,
// for jobsEngine.test.ts and casting.test.ts. Enemies are held still (stunned for good) unless asked.
import type { Loadout } from './abilities';
import { createCombat, worldOf, type CampSpawn, type Combat, type CombatZone, type Intent, type TickOut } from './engine';
import type { EnemyKindId } from './enemies';
import type { FxEvent } from './fx';

export interface Wall { x: number; z: number; r: number }
export function flatZone(camps: CampSpawn[], walls: Wall[] = [], jobSwitch?: (x: number, z: number) => boolean): CombatZone {
  const inWall = (x: number, z: number) => walls.some((w) => Math.hypot(x - w.x, z - w.z) <= w.r);
  const surface = (x: number, z: number) => (Math.abs(x) <= 60 && Math.abs(z) <= 60 && !inWall(x, z) ? 0 : null);
  return { surface, ground: surface, sight: (x, z) => !inWall(x, z), camps, ...(jobSwitch ? { jobSwitch } : {}) };
}
export const camp = (kind: EnemyKindId, x = 0, z = 0): CampSpawn => ({ kind, x, z, facing: 0 });
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export class Rig {
  readonly c: Combat;
  /** Index of the next tick, at k / 15 s. Intents sent now land just before that tick. */
  k = 0;
  readonly log: { t: number; ev: FxEvent }[] = [];
  readonly outs: TickOut[] = [];
  constructor(camps: CampSpawn[], o: { walls?: Wall[]; seed?: number; jobSwitch?: CombatZone['jobSwitch'] | null; liveEnemies?: boolean } = {}) {
    this.c = createCombat(flatZone(camps, o.walls, o.jobSwitch === null ? undefined : o.jobSwitch ?? (() => true)), { seed: o.seed ?? 1, nowS: 0 });
    if (!o.liveEnemies) for (const e of worldOf(this.c).enemies.values()) { e.act = 'stun'; e.actUntil = Infinity; }
  }
  get now() { return this.k / 15; }
  get w() { return worldOf(this.c); }
  enemy(kind: EnemyKindId): number {
    for (const v of this.c.all()) if (v.kind === kind) return v.id;
    throw new Error(`no ${kind}`);
  }
  add(x: number, z: number, loadout: Loadout = { job: 'warrior', picks: ['mend', 'bulwark'] }, hp = 100, facing = 0): number {
    return this.c.addAdventurer({ x, z, y: 0, facing, hp, loadout }, this.now);
  }
  tick(): TickOut {
    const out = this.c.tick(this.now);
    for (const ev of out.fx) this.log.push({ t: r3(this.now), ev });
    this.outs.push(out);
    this.k++;
    return out;
  }
  /** Runs every tick before `s`, so the next tick is at s. */
  at(s: number): this {
    const end = Math.round(s * 15);
    while (this.k < end) this.tick();
    return this;
  }
  i(id: number, i: Intent) { return this.c.intent(id, i, this.now); }
  press(id: number, slot: number, ally?: number) {
    return this.i(id, ally === undefined ? { t: 'ability', slot, phase: 'press' } : { t: 'ability', slot, phase: 'press', ally });
  }
  release(id: number, slot: number) { return this.i(id, { t: 'ability', slot, phase: 'release' }); }
  move(id: number, x: number, z: number) { this.c.setPose(id, x, z, 0, 0); }
  /** Logged fx, plus the ones intents queued for the next tick (stamped now). */
  entries() {
    return [...this.log, ...this.w.out.fx.map((ev) => ({ t: r3(this.now), ev }))];
  }
  fx<T extends FxEvent['t']>(t: T) {
    return this.entries().flatMap((l) => (l.ev.t === t ? [{ at: l.t, ...(l.ev as Extract<FxEvent, { t: T }>) }] : []));
  }
  hits(src?: number) {
    return this.fx('hit').filter((h) => src === undefined || h.src === src);
  }
  /** Puts adventurer `id` in combat with enemy `e` (on its threat table). */
  engage(id: number, e: number) { this.w.enemies.get(e)!.threat.add(id, 1); }
}
