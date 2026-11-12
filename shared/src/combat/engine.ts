// The combat engine: one per zone room. It holds every adventurer and enemy, takes intents, and
// advances the fight one tick at a time. Server-authoritative: the client only ever sends intents.
// Pure and deterministic: the same seed, poses, intents and tick times give the same TickOut stream.
import type { Surface } from '../body';
import type { AbilityId, BuffId, DebuffId, Loadout, Plan3Loadout, WeaponId } from './abilities';
import type { JobId } from './jobs';
import type { BuffState } from './effects';
import type { CastState } from './casting';
import type { AfflictionId } from './afflictions';
import type { FieldId } from './bosses';
import type { EnemyAttackId, EnemyKindData, EnemyKindId, EnemyTier } from './enemies';
import type { FxEvent } from './fx';
import type { MarkId, Marks } from './marks';
import { markBits } from './marks';
import type { Shape } from './shapes';
import { staggerImmuneLeft, type StaggerBar } from './stagger';
import type { Stats } from './stats';
import type { ThreatTable } from './threat';
import { sendHome, stepEnemies } from './enemyAi';
import { ENEMY_ATTACKS } from './enemies';
import { bossEnrageIn, bossPhase, bossWarded } from './bossAi';
import type { Displacement, DisplaceResult } from './displace';
import {
  abilityIntent, applyCarry, buffBits, carryOfState, currentAct, debuffBits, dodgeIntent, fallDamageTaken, jobIntent, liveShield, loadoutIntent,
  newAdventurer, newEnemyState, plan3LoadoutState, removeFromThreat, resetAdventurer, searingStacks, selfView, speedScaleOf, swapIntent, targetIntent,
  tickAdventurer, tickEnemyStatus,
} from './adventurer';
import { tickFields } from './fields';
import { castView } from './casting';

// ───────── public API ─────────
/**
 * arena: a boss encounter's sealed arena (ruling P4-c, from the zone data; absent = no restriction). The
 * enemy, the adds it spawns and their fields and telegraphs reach only adventurers inside it; an
 * adventurer outside neither damages them nor stays on their threat tables (nor is noticed).
 */
export interface CampSpawn { kind: EnemyKindId; x: number; z: number; facing: number; arena?: (x: number, z: number) => boolean }
/**
 * surface: where adventurers stand; ground: where enemies walk; sight: true where a line of sight
 * passes; jobSwitch: true where a job may change (the grove, sanctuary circles). Absent = never.
 */
export interface CombatZone {
  surface: Surface; ground: Surface; sight: (x: number, z: number) => boolean; camps: readonly CampSpawn[];
  jobSwitch?: (x: number, z: number) => boolean;
}
/** phase: a boss between phases (invulnerable and still). */
export type Act = '' | 'charge' | 'cast' | 'dodge' | 'knock' | 'stun' | 'dead' | 'return' | 'phase';
export type CastView = { ability: AbilityId; total: number; left: number } | null;
export interface CombatantView {
  id: number; team: 'adventurer' | 'enemy'; kind: 'adventurer' | EnemyKindId;
  x: number; z: number; y: number; facing: number; hp: number; maxHp: number; alive: boolean; shield: number;
  marks: number; stagger: number; maxStagger: number; targetId: number | null; act: Act;
  windup: { attack: EnemyAttackId; total: number; left: number; interruptible: boolean; unavoidable?: true } | null;
  /** Enemies: the chase surge is on (moving at SURGE_SCALE × RUN_SPEED). */
  surging?: boolean;
  /** Enemies with a stagger bar: seconds until it can gain stagger again (a break, then STAGGER_IMMUNE_S); 0 = it can. */
  staggerImmune?: number;
  /**
   * job: adventurers only. buffs: adventurers (BUFF_BITS); debuffs: enemies (DEBUFF_BITS); cast: the
   * cast in progress. The engine always fills buffs, debuffs and cast (and job for adventurers); they
   * are optional only until the server and client build views of their own on them (Tasks 6 and 7).
   */
  job?: JobId; buffs?: number; debuffs?: number; cast?: CastView;
  /** Adventurers: Searing stacks (0 when none). Always filled for adventurers; optional only until the server's views carry it. */
  searing?: number;
  /**
   * Enemies (always filled for them; optional only so adventurer views and older literals compile): the
   * kind's tier; the boss's phase (0-based, already the next one during a transition; 0 for non-bosses);
   * warded: a ward add lives (the boss takes × wardMult); enrageIn: seconds to the enrage (0 once
   * enraged), null for a boss asleep or without one and for non-bosses.
   */
  tier?: EnemyTier; phase?: number; warded?: boolean; enrageIn?: number | null;
}
/** A boss's fight events: woke (first engaged), a transition began (phase = the next index), enraged, reset (went home). */
export interface BossEvent { enemy: number; kind: EnemyKindId; event: 'wake' | 'phase' | 'enrage' | 'reset'; phase?: number; atS: number }
/**
 * cd: seconds left per slot; gcd, dodgeNextIn: seconds left (0 = ready / full); charge: seconds
 * held, or null; dodgeMax: the job's dodge charges; cast: the cast in progress.
 * Deprecated until Tasks 6 and 7: weapon (the job's, or a Plan 3 loadout's weapon), swapCd (a Plan 3
 * loadout's swap cooldown, else 0) and swapLock (always 0). job, dodgeMax and cast are always filled;
 * they are optional only until the server's and client's own SelfView literals carry them.
 */
export interface SelfView {
  momentum: number; weapon: WeaponId; slots: AbilityId[]; cd: number[]; gcd: number; swapCd: number; swapLock: number;
  dodgeCharges: number; dodgeNextIn: number; charge: number | null; inCombat: boolean;
  job?: JobId; dodgeMax?: number; cast?: CastView;
}
/** unavoidable: dodge i-frames do not avoid it (ruling P4-f; clients draw it as "cannot be dodged"). */
export interface TelegraphView { id: number; owner: number; attack: EnemyAttackId; shape: Shape; total: number; left: number; unavoidable?: true }
/** A standing hazard on the ground (world coordinates): it ticks at startedAt + 1, + 2, … while its owner lives. */
export interface FieldView { id: number; owner: number; field: FieldId; shape: Shape; raw: number; startedAt: number }
export interface DisplaceOut { id: number; kind: 'dodge' | 'knock'; from: { x: number; z: number; y: number }; d: Displacement; result: DisplaceResult }
/** revived: always filled by the engine (optional only until the server's own TickOut literals carry it). */
export interface TickOut {
  fx: FxEvent[]; displaced: DisplaceOut[]; died: number[]; kills: { enemy: number; kind: EnemyKindId; credit: number[] }[];
  revived?: { id: number; by: number; hp: number }[];
  /**
   * Enemies that left the engine this tick: despawnEnemy (no death, no credit), or a spawned add pruned
   * after its death (its kill was credited as usual in `kills`). Their ids are never reused.
   */
  despawned: number[];
  /** Boss events this tick, in order. */
  boss: BossEvent[];
}
/**
 * ally: the adventurer an ally-aimed ability should land on (else the aim rule picks one).
 * Deprecated until Tasks 6 and 7, for adventurers added with a Plan 3 loadout only: `swap` (Blade ⇄
 * Bow) and `loadout { free }` (Plan 3's free picks).
 */
export type Intent =
  | { t: 'target'; id: number | null }
  | { t: 'ability'; slot: number; phase: 'press' | 'release'; ally?: number }
  | { t: 'dodge'; dx: number; dz: number; from: { x: number; z: number; y: number }; grounded: boolean }
  | { t: 'loadout'; picks: [AbilityId, AbilityId] }
  | { t: 'job'; job: JobId; picks: [AbilityId, AbilityId] }
  | { t: 'swap' }
  | { t: 'loadout'; free: [AbilityId, AbilityId] };
export type Refusal = 'dead' | 'busy' | 'invalid' | 'cooldown' | 'momentum' | 'no-target' | 'range' | 'sight' | 'charges' | 'air' | 'in-combat'
  | 'not-here' | 'no-ally';
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
   * left, sprint left. carryOf always fills them; "since" values are capped at 1e6. A cast is never carried.
   * swapCd: deprecated, read only for a Plan 3 loadout (ignored otherwise).
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
  /**
   * carry: what a relog keeps (see Carry); clamped to the real numbers. Without it everything starts fresh.
   * loadout: a job Loadout; anything else reads as DEFAULT_LOADOUT, except (deprecated, until Tasks
   * 5–7) a Plan 3 loadout, which runs as its job (Blade → Warrior, Bow → Ranger) with its Plan 3 slots.
   */
  addAdventurer(a: { x: number; z: number; y: number; facing: number; hp: number; loadout: Plan3Loadout | Loadout; carry?: Carry; stats?: Stats }, nowS: number): number;
  /**
   * Party membership, set only by the room (the engine never takes it from an intent): adventurers with
   * the same non-null party are allies; anything but a string is no party. Live buffs (Shelter included)
   * stay as they are; only later picks change. Kept through revives.
   */
  setParty(id: number, party: string | null): void;
  /** Standing hazards (ground fields). */
  fields(): Iterable<FieldView>;
  /** The relog snapshot of a present adventurer (take it before removeAdventurer), else undefined. */
  carryOf(id: number): Carry | undefined;
  /** Also drops it from every threat table. */
  removeAdventurer(id: number): void;
  /**
   * Sends an engaged enemy home now (the instance's wipe): Plan 3's return (invulnerable, healed at
   * camp); a boss resets (phase 0, adds despawned, fields and telegraphs removed, the enrage clock
   * stopped, a `reset` event). False when it is dead, already going home, or idle at camp.
   */
  resetEnemy(id: number, nowS: number): boolean;
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
  /**
   * 1.4 while sprinting (+SPEED_GRACE_S), 0.4 from CHARGE_SLOW_GRACE_S into a charge, 0.5 from
   * CHARGE_SLOW_GRACE_S into a cast until it ends, else 1 (several: the product).
   */
  speedScale(id: number, nowS: number): number;
  /** The job and picks it runs (a copy). */
  jobLoadout(id: number): Loadout | undefined;
  /**
   * @deprecated Until Task 6 (the server saves it): a Plan 3 loadout as it was added or changed by swap
   * and `loadout { free }`; for an adventurer on a job loadout, plan3LoadoutOf of it.
   */
  loadout(id: number): Plan3Loadout | undefined;
}

// ───────── internal state (shared with adventurer.ts and the enemy AI) ─────────
export interface AdventurerState {
  id: number; team: 'adventurer';
  x: number; z: number; y: number; facing: number;
  stats: Stats; hp: number; alive: boolean; diedAt: number;
  /** The party the room put it in (null: none, its only ally is itself). */
  party: string | null;
  /** '' | 'dodge' | 'knock' | 'dead' ('charge' and 'cast' are derived from `charge` and `cast`); dodge and knock last until actUntil. */
  act: Act; actUntil: number;
  /**
   * job and loadout.job are the same. slots: the job's bar and picks, except for a Plan 3 loadout
   * (deprecated, `plan3` set until Tasks 5–7): its Plan 3 bar and free picks.
   */
  job: JobId; loadout: Loadout; slots: AbilityId[]; plan3: Plan3Loadout | null;
  momentum: number;
  /** Last combat damage dealt (Momentum decay), dealt or taken (in combat), and any damage taken (regen delay). */
  lastDealtAt: number; lastCombatAt: number; lastHurtAt: number;
  /** swapReadyAt: deprecated, Plan 3 loadouts only. */
  readyAt: Partial<Record<AbilityId, number>>; gcdUntil: number; swapReadyAt: number;
  targetId: number | null; nextAutoAt: number;
  shield: number; shieldUntil: number; sprintUntil: number; parryUntil: number; iframeUntil: number;
  /** After a revive: enemy hits miss (plainly: never a perfect dodge) until then. */
  reviveSafeUntil: number;
  dodgeCharges: number; dodgeRefillAt: number | null; lastDodgeAt: number; lastDodgeFrom: { x: number; z: number } | null;
  charge: { startedAt: number } | null;
  cast: CastState | null;
  buffs: Partial<Record<BuffId, BuffState>>;
  /** Afflictions from enemies (Searing): stacks, expiry and who last added one. Wellspring's cleanse clears them; death too. */
  afflictions: Map<AfflictionId, { stacks: number; until: number; src: number }>;
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
  /** Who applied each live mark (an adventurer's engine id). */
  markBy: Partial<Record<MarkId, number>>;
  /** Burning damage: from `src` with its power, next tick at nextAt (once a second while the mark lives). */
  /** orphan: its source died, revived or left since; it still burns but adds no threat, combat time or credit. */
  burning: { src: number; power: number; nextAt: number; orphan?: boolean } | null;
  windup: EnemyWindup | null;
  /** When each attack may next start (the enemy AI sets these; an interrupt restarts the cooldown). */
  attackReadyAt: Partial<Record<EnemyAttackId, number>>;
  diedAt: number; respawnAt: number; lastDamagedAt: number;
  /** The chase surge (enemyAi): faster until it next starts an attack. */
  surging: boolean;
  debuffs: Partial<Record<DebuffId, BuffState>>;
  /** Rooted cannot be set again before this (ROOT_IMMUNE_S after it last ended). */
  rootImmuneUntil: number;
  /** Spawned by spawnEnemy (an add): never respawns, pruned after its death. */
  spawned: boolean;
  /** Its base factor on max hp and the stagger bar (1 for a camp; an add's spawn scale), restored when it walks home. */
  baseScale: number;
}
export interface TelegraphState { id: number; owner: number; attack: EnemyAttackId; shape: Shape; startedAt: number; endsAt: number }
/** A ground field: shape in world coordinates; nextAt: its next tick (startedAt + 1, + 2, …). */
export interface FieldState { id: number; owner: number; field: FieldId; shape: Shape; raw: number; startedAt: number; nextAt: number }
export interface CombatWorld {
  zone: CombatZone;
  /** The seeded generator (mulberry32): the only randomness the engine may use. */
  rng: () => number;
  /** The latest time any call has seen (views are computed at it). */
  now: number; lastTick: number;
  nextId: number; nextTelegraphId: number;
  adventurers: Map<number, AdventurerState>; enemies: Map<number, EnemyState>; telegraphs: Map<number, TelegraphState>;
  /** Ground fields by id (removed with their owner: despawn, death, removeFieldsOf). */
  fields: Map<number, FieldState>; nextFieldId: number;
  /** What the next tick returns: events from intents land here too. */
  out: TickOut;
}

// Per-tick enemy behaviour (enemyAi.ts) runs after the adventurers and before enemy status (marks,
// burning, stagger decay, stun end, respawns); ground fields tick last.

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

function windupView(wu: EnemyWindup, now: number): NonNullable<CombatantView['windup']> {
  const v: NonNullable<CombatantView['windup']> = { attack: wu.attack, total: wu.endsAt - wu.startedAt, left: Math.max(0, wu.endsAt - now), interruptible: wu.interruptible };
  if (ENEMY_ATTACKS[wu.attack].unavoidable) v.unavoidable = true;
  return v;
}

const emptyOut = (): TickOut => ({ fx: [], displaced: [], died: [], kills: [], revived: [], despawned: [], boss: [] });

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
    adventurers: new Map(), enemies: new Map(), telegraphs: new Map(), fields: new Map(), nextFieldId: 1, out: emptyOut(),
  };
  for (const c of zone.camps) { const e = newEnemyState(w, c); w.enemies.set(e.id, e); }
  // the clock never runs backwards: a stale or non-finite nowS is the latest time seen
  const at = (nowS: number) => { if (finite(nowS) && nowS > w.now) w.now = nowS; return w.now; };

  const enemyView = (e: EnemyState): CombatantView => ({
    id: e.id, team: 'enemy', kind: e.kind, x: e.x, z: e.z, y: e.y, facing: e.facing,
    hp: e.hp, maxHp: e.maxHp, alive: e.alive, shield: 0, marks: markBits(e.marks, w.now),
    stagger: e.stagger.value, maxStagger: e.stagger.max, targetId: e.targetId, act: e.act,
    windup: e.windup ? windupView(e.windup, w.now) : null,
    surging: e.surging, staggerImmune: e.stagger.max > 0 ? staggerImmuneLeft(e.stagger, w.now) : 0,
    buffs: 0, debuffs: debuffBits(e, w.now), cast: null,
    tier: e.data.tier, phase: bossPhase(e), warded: bossWarded(w, e), enrageIn: bossEnrageIn(e, w.now),
  });
  const advView = (a: AdventurerState): CombatantView => ({
    id: a.id, team: 'adventurer', kind: 'adventurer', x: a.x, z: a.z, y: a.y, facing: a.facing,
    hp: a.hp, maxHp: a.stats.maxHp, alive: a.alive, shield: liveShield(a, w.now), marks: 0, stagger: 0, maxStagger: 0,
    targetId: a.targetId, act: currentAct(a, w.now), windup: null,
    job: a.job, buffs: buffBits(a, w.now), debuffs: 0, cast: castView(a, w.now), searing: searingStacks(a, w.now),
  });

  const combat: Combat = {
    addAdventurer(a, nowS) {
      const t = at(nowS);
      // only setParty (and a revive, which keeps it) sets a party: any party key on the input is dropped
      const { party: _party, ...input } = a as typeof a & { party?: unknown };
      void _party;
      const s = newAdventurer(w.nextId++, input, t);
      if (a.carry) applyCarry(s, a.carry, t);
      w.adventurers.set(s.id, s);
      return s.id;
    },
    setParty(id, party) {
      const a = w.adventurers.get(id);
      if (a) a.party = typeof party === 'string' && party !== '' ? party : null;
    },
    *fields() {
      for (const f of w.fields.values()) yield { id: f.id, owner: f.owner, field: f.field, shape: f.shape, raw: f.raw, startedAt: f.startedAt };
    },
    carryOf(id) {
      const a = w.adventurers.get(id);
      return a ? carryOfState(a, w.now) : undefined;
    },
    removeAdventurer(id) {
      if (!w.adventurers.delete(id)) return;
      removeFromThreat(w, id);
    },
    resetEnemy(id, nowS) {
      const e = w.enemies.get(id);
      return e ? sendHome(w, e, at(nowS)) : false;
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
        case 'ability': return abilityIntent(w, a, i.slot, i.phase, i.ally, t);
        // the dodge trusts i.from: the server runs checkPose on it (as on any pose) before passing it on
        case 'dodge': return dodgeIntent(w, a, i, t);
        case 'loadout': return loadoutIntent(w, a, i, t);
        case 'job': return jobIntent(w, a, i.job, i.picks, t);
        case 'swap': return swapIntent(w, a, t);
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
      tickFields(w, now);
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
        const v: TelegraphView = { id: t.id, owner: t.owner, attack: t.attack, shape: t.shape, total: t.endsAt - t.startedAt, left: Math.max(0, t.endsAt - w.now) };
        if (ENEMY_ATTACKS[t.attack].unavoidable) v.unavoidable = true;
        yield v;
      }
    },
    speedScale(id, nowS) {
      const a = w.adventurers.get(id);
      return a ? speedScaleOf(a, finite(nowS) ? nowS : w.now) : 1;
    },
    jobLoadout(id) {
      const a = w.adventurers.get(id);
      return a ? { job: a.loadout.job, picks: [a.loadout.picks[0], a.loadout.picks[1]] } : undefined;
    },
    loadout(id) {
      const a = w.adventurers.get(id);
      return a ? plan3LoadoutState(a) : undefined;
    },
  };
  worlds.set(combat, w);
  return combat;
}
