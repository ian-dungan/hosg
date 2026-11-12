// The combat engine: one per zone room. It holds every adventurer and enemy, takes intents, and
// advances the fight one tick at a time. Server-authoritative: the client only ever sends intents.
// Pure and deterministic: the same seed, poses, intents and tick times give the same TickOut stream.
import type { Surface } from '../body';
import type { AbilityId, Loadout, WeaponId } from './abilities';
import type { EnemyAttackId, EnemyKindData, EnemyKindId } from './enemies';
import { ENEMY_KINDS } from './enemies';
import type { FxEvent } from './fx';
import type { Marks } from './marks';
import { markBits } from './marks';
import type { Shape } from './shapes';
import { staggerImmuneLeft, type StaggerBar } from './stagger';
import type { Stats } from './stats';
import { ThreatTable } from './threat';
import { stepEnemies } from './enemyAi';
import type { Displacement, DisplaceResult } from './displace';
import {
  abilityIntent, applyCarry, carryOfState, currentAct, dodgeIntent, fallDamageTaken, liveShield, loadoutIntent, newAdventurer, removeFromThreat,
  resetAdventurer, selfView, spawnEnemyState, speedScaleOf, swapIntent, targetIntent, tickAdventurer, tickEnemyStatus,
} from './adventurer';

// ───────── public API ─────────
export interface CampSpawn { kind: EnemyKindId; x: number; z: number; facing: number }
/** surface: where adventurers stand; ground: where enemies walk; sight: true where a line of sight passes. */
export interface CombatZone { surface: Surface; ground: Surface; sight: (x: number, z: number) => boolean; camps: readonly CampSpawn[] }
export type Act = '' | 'charge' | 'dodge' | 'knock' | 'stun' | 'dead' | 'return';
export interface CombatantView {
  id: number; team: 'adventurer' | 'enemy'; kind: 'adventurer' | EnemyKindId;
  x: number; z: number; y: number; facing: number; hp: number; maxHp: number; alive: boolean; shield: number;
  marks: number; stagger: number; maxStagger: number; targetId: number | null; act: Act;
  windup: { attack: EnemyAttackId; total: number; left: number; interruptible: boolean } | null;
  /** Enemies: the chase surge is on (moving at SURGE_SCALE × RUN_SPEED). */
  surging?: boolean;
  /** Enemies with a stagger bar: seconds until it can gain stagger again (a break, then STAGGER_IMMUNE_S); 0 = it can. */
  staggerImmune?: number;
}
/**
 * cd: seconds left per slot; gcd, swapCd, dodgeNextIn: seconds left (0 = ready / full);
 * swapLock: always 0 (weapons swap only out of combat, so there is no lockout); charge: seconds held, or null.
 */
export interface SelfView {
  momentum: number; weapon: WeaponId; slots: AbilityId[]; cd: number[]; gcd: number; swapCd: number; swapLock: number;
  dodgeCharges: number; dodgeNextIn: number; charge: number | null; inCombat: boolean;
}
export interface TelegraphView { id: number; owner: number; attack: EnemyAttackId; shape: Shape; total: number; left: number }
export interface DisplaceOut { id: number; kind: 'dodge' | 'knock'; from: { x: number; z: number; y: number }; d: Displacement; result: DisplaceResult }
export interface TickOut { fx: FxEvent[]; displaced: DisplaceOut[]; died: number[]; kills: { enemy: number; kind: EnemyKindId; credit: number[] }[] }
export type Intent =
  | { t: 'target'; id: number | null }
  | { t: 'ability'; slot: number; phase: 'press' | 'release' }
  | { t: 'swap' }
  | { t: 'dodge'; dx: number; dz: number; from: { x: number; z: number; y: number }; grounded: boolean }
  | { t: 'loadout'; free: [AbilityId, AbilityId] };
export type Refusal = 'dead' | 'busy' | 'invalid' | 'cooldown' | 'momentum' | 'no-target' | 'range' | 'sight' | 'charges' | 'air' | 'in-combat';
/**
 * What a relog keeps (seconds remaining, so it does not depend on either clock): per-ability
 * cooldowns, the GCD, dodge charges and the time to the next refill, and Momentum. The server takes it
 * with carryOf before removeAdventurer, caches it briefly per account, and passes it back on re-join.
 */
export interface Carry {
  cooldowns: Partial<Record<AbilityId, number>>; gcd: number; dodgeCharges: number; dodgeRefillIn: number; momentum: number;
  /**
   * Optional (absent = fresh), seconds: since combat damage dealt or taken (in combat), since any damage
   * taken (regen delay), since damage dealt (Momentum decay), swap cooldown left, shield amount and time
   * left, sprint left. carryOf always fills them; "since" values are capped at 1e6.
   */
  sinceCombat?: number; sinceHurt?: number; sinceDealt?: number; swapCd?: number; shield?: number; shieldLeft?: number; sprintLeft?: number;
}
/**
 * Every `nowS` (intents, ticks, damage, revive) is the caller's clock in seconds: it must be monotonic
 * and room-relative (the server uses its tick count or a monotonic clock, never Date.now). The engine
 * still never runs backwards: a time earlier than the latest one it has seen counts as that latest
 * time, so a stale or rewound stamp can neither bypass a cooldown nor rewind a timer.
 */
export interface Combat {
  /** carry: what a relog keeps (see Carry); clamped to the real numbers. Without it everything starts fresh. */
  addAdventurer(a: { x: number; z: number; y: number; facing: number; hp: number; loadout: Loadout; carry?: Carry }, nowS: number): number;
  /** The relog snapshot of a present adventurer (take it before removeAdventurer), else undefined. */
  carryOf(id: number): Carry | undefined;
  /** Also drops it from every threat table. */
  removeAdventurer(id: number): void;
  setPose(id: number, x: number, z: number, y: number, facing: number): void;
  /** null = accepted. */
  intent(id: number, i: Intent, nowS: number): Refusal | null;
  /** Never kills (leaves 1 hp), ignores i-frames and shields; returns hp taken. */
  damage(id: number, amount: number, nowS: number, cause: 'fall'): number;
  /** Full hp, Momentum 0, cooldowns and charges reset, marks cleared. */
  revive(id: number, at: { x: number; z: number; y: number }, nowS: number): void;
  tick(nowS: number): TickOut;
  get(id: number): CombatantView | undefined; self(id: number): SelfView | undefined;
  all(): Iterable<CombatantView>; telegraphs(): Iterable<TelegraphView>;
  /** 1.4 while sprinting (+SPEED_GRACE_S), 0.4 from CHARGE_SLOW_GRACE_S into a charge, else 1 (both: the product). */
  speedScale(id: number, nowS: number): number;
  loadout(id: number): Loadout | undefined;
}

// ───────── internal state (shared with adventurer.ts and the enemy AI) ─────────
export interface AdventurerState {
  id: number; team: 'adventurer';
  x: number; z: number; y: number; facing: number;
  stats: Stats; hp: number; alive: boolean; diedAt: number;
  /** '' | 'dodge' | 'knock' | 'dead' ('charge' is derived from `charge`); dodge and knock last until actUntil. */
  act: Act; actUntil: number;
  loadout: Loadout; slots: AbilityId[];
  momentum: number;
  /** Last combat damage dealt (Momentum decay), dealt or taken (in combat), and any damage taken (regen delay). */
  lastDealtAt: number; lastCombatAt: number; lastHurtAt: number;
  readyAt: Partial<Record<AbilityId, number>>; gcdUntil: number; swapReadyAt: number;
  targetId: number | null; nextAutoAt: number;
  shield: number; shieldUntil: number; sprintUntil: number; parryUntil: number; iframeUntil: number;
  dodgeCharges: number; dodgeRefillAt: number | null; lastDodgeAt: number; lastDodgeFrom: { x: number; z: number } | null;
  charge: { startedAt: number } | null;
  /** A swing came due on a tick that could not swing: the next one counts from when it lands. */
  autoWaiting: boolean;
}
export interface EnemyWindup { attack: EnemyAttackId; startedAt: number; endsAt: number; interruptible: boolean; telegraphId: number | null }
export interface EnemyState {
  id: number; team: 'enemy'; kind: EnemyKindId; data: EnemyKindData; camp: CampSpawn;
  x: number; z: number; y: number; facing: number;
  hp: number; maxHp: number; alive: boolean;
  /** '' | 'stun' | 'dead' | 'return'; stun lasts until actUntil. */
  act: Act; actUntil: number;
  targetId: number | null;
  threat: ThreatTable; stagger: StaggerBar; marks: Marks;
  /** Burning damage: from `src` with its power, next tick at nextAt (once a second while the mark lives). */
  /** orphan: its source died, revived or left since; it still burns but adds no threat, combat time or credit. */
  burning: { src: number; power: number; nextAt: number; orphan?: boolean } | null;
  windup: EnemyWindup | null;
  /** When each attack may next start (the enemy AI sets these; an interrupt restarts the cooldown). */
  attackReadyAt: Partial<Record<EnemyAttackId, number>>;
  diedAt: number; respawnAt: number; lastDamagedAt: number;
  /** The chase surge (enemyAi): faster until it next starts an attack. */
  surging: boolean;
}
export interface TelegraphState { id: number; owner: number; attack: EnemyAttackId; shape: Shape; startedAt: number; endsAt: number }
export interface CombatWorld {
  zone: CombatZone;
  /** The seeded generator (mulberry32): the only randomness the engine may use. */
  rng: () => number;
  /** The latest time any call has seen (views are computed at it). */
  now: number; lastTick: number;
  nextId: number; nextTelegraphId: number;
  adventurers: Map<number, AdventurerState>; enemies: Map<number, EnemyState>; telegraphs: Map<number, TelegraphState>;
  /** What the next tick returns: events from intents land here too. */
  out: TickOut;
}

// Per-tick enemy behaviour (enemyAi.ts) runs after the adventurers and before enemy status (marks,
// burning, stagger decay, stun end, respawns).

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const emptyOut = (): TickOut => ({ fx: [], displaced: [], died: [], kills: [] });

function newEnemy(w: CombatWorld, c: CampSpawn, nowS: number): EnemyState {
  const data = ENEMY_KINDS[c.kind];
  const e: EnemyState = {
    id: w.nextId++, team: 'enemy', kind: c.kind, data, camp: { ...c },
    x: 0, z: 0, y: 0, facing: 0, hp: data.hp, maxHp: data.hp, alive: true, act: '', actUntil: -Infinity, targetId: null,
    threat: new ThreatTable(), stagger: { value: 0, max: data.stagger, brokenUntil: -Infinity, lastGainAt: -Infinity }, marks: {},
    burning: null, windup: null, attackReadyAt: {}, diedAt: -Infinity, respawnAt: Infinity, lastDamagedAt: -Infinity, surging: false,
  };
  spawnEnemyState(w, e);
  void nowS;
  return e;
}

const worlds = new WeakMap<Combat, CombatWorld>();
/** The engine's internal state, for the enemy AI and tests. Throws for anything createCombat did not make. */
export function worldOf(c: Combat): CombatWorld {
  const w = worlds.get(c);
  if (!w) throw new Error('not a combat engine');
  return w;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Spawns every camp at once. */
export function createCombat(zone: CombatZone, opts: { seed: number; nowS: number }): Combat {
  const start = finite(opts.nowS) ? opts.nowS : 0;
  const w: CombatWorld = {
    zone, rng: mulberry32(opts.seed), now: start, lastTick: start, nextId: 1, nextTelegraphId: 1,
    adventurers: new Map(), enemies: new Map(), telegraphs: new Map(), out: emptyOut(),
  };
  for (const c of zone.camps) { const e = newEnemy(w, c, start); w.enemies.set(e.id, e); }
  // the clock never runs backwards: a stale or non-finite nowS is the latest time seen
  const at = (nowS: number) => { if (finite(nowS) && nowS > w.now) w.now = nowS; return w.now; };

  const enemyView = (e: EnemyState): CombatantView => ({
    id: e.id, team: 'enemy', kind: e.kind, x: e.x, z: e.z, y: e.y, facing: e.facing,
    hp: e.hp, maxHp: e.maxHp, alive: e.alive, shield: 0, marks: markBits(e.marks, w.now),
    stagger: e.stagger.value, maxStagger: e.stagger.max, targetId: e.targetId, act: e.act,
    windup: e.windup ? { attack: e.windup.attack, total: e.windup.endsAt - e.windup.startedAt, left: Math.max(0, e.windup.endsAt - w.now), interruptible: e.windup.interruptible } : null,
    surging: e.surging, staggerImmune: e.stagger.max > 0 ? staggerImmuneLeft(e.stagger, w.now) : 0,
  });
  const advView = (a: AdventurerState): CombatantView => ({
    id: a.id, team: 'adventurer', kind: 'adventurer', x: a.x, z: a.z, y: a.y, facing: a.facing,
    hp: a.hp, maxHp: a.stats.maxHp, alive: a.alive, shield: liveShield(a, w.now), marks: 0, stagger: 0, maxStagger: 0,
    targetId: a.targetId, act: currentAct(a, w.now), windup: null,
  });

  const combat: Combat = {
    addAdventurer(a, nowS) {
      const t = at(nowS);
      const s = newAdventurer(w.nextId++, a, t);
      if (a.carry) applyCarry(s, a.carry, t);
      w.adventurers.set(s.id, s);
      return s.id;
    },
    carryOf(id) {
      const a = w.adventurers.get(id);
      return a ? carryOfState(a, w.now) : undefined;
    },
    removeAdventurer(id) {
      if (!w.adventurers.delete(id)) return;
      removeFromThreat(w, id);
    },
    setPose(id, x, z, y, facing) {
      const a = w.adventurers.get(id);
      if (!a || !finite(x) || !finite(z) || !finite(y)) return;
      a.x = x; a.z = z; a.y = y;
      if (finite(facing)) a.facing = facing;
    },
    intent(id, i, nowS) {
      const a = w.adventurers.get(id);
      if (!a || typeof i !== 'object' || i === null) return 'invalid';
      const t = at(nowS);
      switch (i.t) {
        case 'target': return targetIntent(w, a, i.id, t);
        case 'ability': return abilityIntent(w, a, i.slot, i.phase, t);
        case 'swap': return swapIntent(w, a, t);
        // the dodge trusts i.from: the server runs checkPose on it (as on any pose) before passing it on
        case 'dodge': return dodgeIntent(w, a, i, t);
        case 'loadout': return loadoutIntent(w, a, i.free, t);
        default: return a.alive ? 'invalid' : 'dead';
      }
    },
    damage(id, amount, nowS) {
      const a = w.adventurers.get(id);
      return a ? fallDamageTaken(a, amount, at(nowS)) : 0;
    },
    revive(id, pos, nowS) {
      const a = w.adventurers.get(id);
      if (a) resetAdventurer(w, a, pos, at(nowS));
    },
    tick(nowS) {
      const now = finite(nowS) ? Math.max(nowS, w.now) : w.now;
      const dt = now - w.lastTick;
      w.lastTick = now;
      at(now);
      for (const a of w.adventurers.values()) tickAdventurer(w, a, now, dt);
      stepEnemies(w, now, dt);
      for (const e of w.enemies.values()) tickEnemyStatus(w, e, now, dt);
      const out = w.out;
      w.out = emptyOut();
      return out;
    },
    get(id) {
      const a = w.adventurers.get(id);
      if (a) return advView(a);
      const e = w.enemies.get(id);
      return e ? enemyView(e) : undefined;
    },
    self(id) {
      const a = w.adventurers.get(id);
      return a ? selfView(w, a, w.now) : undefined;
    },
    *all() {
      for (const e of w.enemies.values()) yield enemyView(e);
      for (const a of w.adventurers.values()) yield advView(a);
    },
    *telegraphs() {
      for (const t of w.telegraphs.values()) {
        yield { id: t.id, owner: t.owner, attack: t.attack, shape: t.shape, total: t.endsAt - t.startedAt, left: Math.max(0, t.endsAt - w.now) };
      }
    },
    speedScale(id, nowS) {
      const a = w.adventurers.get(id);
      return a ? speedScaleOf(a, finite(nowS) ? nowS : w.now) : 1;
    },
    loadout(id) {
      const a = w.adventurers.get(id);
      return a ? { weapon: a.loadout.weapon, free: [a.loadout.free[0], a.loadout.free[1]] } : undefined;
    },
  };
  worlds.set(combat, w);
  return combat;
}
