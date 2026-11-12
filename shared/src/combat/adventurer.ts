// Adventurers in a fight: intents (target, abilities, dodge, loadout, job; and, deprecated, the Plan 3
// swap), autos, timers, and the hit and hurt helpers the enemy AI reuses. All state lives in the
// engine's CombatWorld. What abilities do is data (effects.ts); casts are casting.ts.
import { HP_REGEN_DELAY_S, HP_REGEN_PER_S, TICK_HZ } from '../constants';
import {
  ABILITIES, BUFF_BITS, CHARGE_MAX_S, CHARGE_MOVE_SCALE, DEBUFF_BITS, DEFAULT_LOADOUT, SPRINT_S, SPRINT_SCALE, WEAPONS, chargedShot,
  legacyLoadout, parseLoadout, parsePlan3Loadout, plan3LoadoutOf, plan3Slots, slotsFor, type AbilityId, type BuffId, type DebuffId,
  type Loadout, type Plan3Loadout,
} from './abilities';
import {
  AUTO_MOMENTUM, BEDROCK_R, BEDROCK_S, BEDROCK_SHIELD, BLAST_COEF, BLAST_SPLASH_FRAC, BLAST_SPLASH_R, BREAK_DAMAGE_MULT, CONDUCT_STAGGER, CONDUCT_STUN_S,
  RHYTHM_AUTO_MOMENTUM, STEAM_HEAL, STEAM_R, BURNING_COEF_PER_S, CAST_MOVE_SCALE, CHARGE_SLOW_GRACE_S, COMBAT_TIMEOUT_S,
  COMBO_COEF, COMBO_STAGGER, DODGE_IFRAME_S, ELITE_ROOT_MULT, MARK_S, ROOT_IMMUNE_S, MOMENTUM_MAX, DODGE_MIN_GAP_S, DODGE_REFILL_S, GCD_S, INTERRUPT_STAGGER,
  KNOCK_RECOVER_S, RESPAWN_CLEAR_RADIUS, SPEED_GRACE_S, SWAP_COOLDOWN_S, TARGET_DROP_RANGE, TARGET_RANGE, THREAT_PER_DAMAGE,
  THREAT_PER_HEAL,
} from './constants';
import { breakCast, castView, startCast, tickCast } from './casting';
import {
  applyEffects, applyShield, healMult, onDamageTaken, onHealDone, outgoingMult, resolveAim, strikesFromBehind, targetFor, threatMult, tickBuffs, tickDebuffs, traitOf,
} from './effects';
import { REACTIONS, reactionFor, type ElementId } from './elements';
import { stunEnemy } from './enemyAi';
import { JOBS, isJobId, type JobId } from './jobs';
import { dodgeDisplacement, simulateDisplacement, type Displacement } from './displace';
import { ENEMY_ATTACKS, type EnemyAttackId } from './enemies';
import type { FxEvent } from './fx';
import { applyFinisherMark, applyPrimerMark, liveMarks, MARK_BITS, type MarkId } from './marks';
import { decayMomentum, gainMomentum } from './momentum';
import { lineOfSight } from './sight';
import { addStagger, isBroken, tickStagger } from './stagger';
import { STARTER_STATS, hitDamage } from './stats';
import type { Act, AdventurerState, Carry, CombatWorld, DisplaceOut, EnemyState, Intent, Refusal, SelfView } from './engine';

/** What a `hit` fx may be `by`. */
export type HitBy = Extract<FxEvent, { t: 'hit' }>['by'];

/** Slack on time comparisons, so schedules built from sums of floats land on the tick they mean. */
export const TIME_EPS = 1e-6;

// ───────── in combat: the one definition ─────────
/**
 * In combat: on any live enemy's threat table, or combat damage dealt or taken less than
 * COMBAT_TIMEOUT_S ago. Regen, swap and loadout changes all use this.
 */
export function isInCombat(lastCombatAt: number, onThreatTable: boolean, nowS: number): boolean {
  return onThreatTable || nowS - lastCombatAt < COMBAT_TIMEOUT_S - TIME_EPS;
}
export function onAnyThreatTable(w: CombatWorld, id: number): boolean {
  for (const e of w.enemies.values()) if (e.alive && e.threat.has(id)) return true;
  return false;
}
export function adventurerInCombat(w: CombatWorld, a: AdventurerState, nowS: number): boolean {
  return a.alive && isInCombat(a.lastCombatAt, onAnyThreatTable(w, a.id), nowS);
}

// ───────── small state queries ─────────
/** Dodge i-frames. */
export function isInvulnerable(a: AdventurerState, nowS: number): boolean {
  return nowS < a.iframeUntil;
}
/** In a dodge or a knock (no autos, abilities, swaps or dodges). */
export function isDisplaced(a: AdventurerState, nowS: number): boolean {
  return (a.act === 'dodge' || a.act === 'knock') && nowS < a.actUntil;
}
export function currentAct(a: AdventurerState, nowS: number): Act {
  if (!a.alive) return 'dead';
  if (isDisplaced(a, nowS)) return a.act;
  return a.cast ? 'cast' : a.charge ? 'charge' : '';
}
/** The adventurer's live buffs as BUFF_BITS flags. */
export function buffBits(a: AdventurerState, nowS: number): number {
  let bits = 0;
  for (const [id, b] of Object.entries(a.buffs) as [BuffId, { until: number }][]) if (b.until > nowS) bits |= BUFF_BITS[id];
  return bits;
}
/** The enemy's live debuffs as DEBUFF_BITS flags. */
export function debuffBits(e: EnemyState, nowS: number): number {
  let bits = 0;
  for (const [id, d] of Object.entries(e.debuffs) as [DebuffId, { until: number }][]) if (d.until > nowS) bits |= DEBUFF_BITS[id];
  return bits;
}
/** The job's dodge charges. */
export function dodgeMax(a: AdventurerState): number {
  return JOBS[a.job].dodgeCharges;
}
export function liveShield(a: AdventurerState, nowS: number): number {
  return a.shield > 0 && nowS < a.shieldUntil ? a.shield : 0;
}
/** Horizontal distance from the adventurer to the edge of the enemy's radius. */
export function reach(a: { x: number; z: number }, e: EnemyState): number {
  return Math.hypot(e.x - a.x, e.z - a.z) - e.data.radius;
}
/** An enemy walking home cannot be hurt. */
export function enemyInvulnerable(e: EnemyState): boolean {
  return e.act === 'return';
}
export function speedScaleOf(a: AdventurerState, nowS: number): number {
  if (!a.alive) return 1;
  let s = 1;
  if (nowS < a.sprintUntil + SPEED_GRACE_S) s *= SPRINT_SCALE;
  if (a.charge && nowS - a.charge.startedAt >= CHARGE_SLOW_GRACE_S - TIME_EPS) s *= CHARGE_MOVE_SCALE;
  // the slow starts CHARGE_SLOW_GRACE_S in (latency) and ends with the cast: never stricter than an honest client
  if (a.cast && nowS - a.cast.startedAt >= CHARGE_SLOW_GRACE_S - TIME_EPS && nowS < a.cast.endsAt) s *= CAST_MOVE_SCALE;
  return s;
}

const left = (until: number, nowS: number) => Math.max(0, until - nowS);
export function selfView(w: CombatWorld, a: AdventurerState, nowS: number): SelfView {
  return {
    momentum: a.momentum, weapon: a.plan3?.weapon ?? JOBS[a.job].weapon, slots: [...a.slots],
    cd: a.slots.map((id) => left(a.readyAt[id] ?? -Infinity, nowS)),
    gcd: left(a.gcdUntil, nowS), swapCd: a.plan3 ? left(a.swapReadyAt, nowS) : 0, swapLock: 0,
    dodgeCharges: a.dodgeCharges, dodgeNextIn: a.dodgeRefillAt === null ? 0 : left(a.dodgeRefillAt, nowS),
    charge: a.charge ? Math.max(0, nowS - a.charge.startedAt) : null,
    inCombat: adventurerInCombat(w, a, nowS),
    job: a.job, dodgeMax: dodgeMax(a), cast: castView(a, nowS),
  };
}

const fx = (w: CombatWorld, ev: FxEvent) => { w.out.fx.push(ev); };
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

// ───────── lifecycle ─────────
/** What the engine runs for a stored loadout: a job Loadout; a Plan 3 one (deprecated) as its job with its Plan 3 slots; else DEFAULT_LOADOUT. */
function runLoadout(v: unknown): { loadout: Loadout; slots: AbilityId[]; plan3: Plan3Loadout | null } {
  const l = parseLoadout(v);
  if (l) return { loadout: l, slots: slotsFor(l), plan3: null };
  const p3 = parsePlan3Loadout(v);
  if (p3) return { loadout: legacyLoadout(p3)!, slots: plan3Slots(p3), plan3: p3 };
  const d = parseLoadout(DEFAULT_LOADOUT)!;
  return { loadout: d, slots: slotsFor(d), plan3: null };
}

/** @deprecated Until Task 6: the Plan 3 loadout the server saves (a Plan 3 one as it runs; else plan3LoadoutOf the job loadout). */
export function plan3LoadoutState(a: AdventurerState): Plan3Loadout {
  return a.plan3 ? { weapon: a.plan3.weapon, free: [a.plan3.free[0], a.plan3.free[1]] } : plan3LoadoutOf(a.loadout);
}

export function newAdventurer(id: number, s: { x: number; z: number; y: number; facing: number; hp: number; loadout: unknown }, nowS: number): AdventurerState {
  const { loadout, slots, plan3 } = runLoadout(s.loadout);
  const stats = { ...STARTER_STATS };
  const a: AdventurerState = {
    id, team: 'adventurer', x: finite(s.x) ? s.x : 0, z: finite(s.z) ? s.z : 0, y: finite(s.y) ? s.y : 0, facing: finite(s.facing) ? s.facing : 0,
    stats, hp: finite(s.hp) ? Math.min(stats.maxHp, Math.max(1, s.hp)) : stats.maxHp, alive: true, diedAt: -Infinity,
    act: '', actUntil: -Infinity, job: loadout.job, loadout, slots, plan3, momentum: 0,
    lastDealtAt: -Infinity, lastCombatAt: -Infinity, lastHurtAt: -Infinity,
    readyAt: {}, gcdUntil: -Infinity, swapReadyAt: -Infinity, targetId: null, nextAutoAt: -Infinity,
    shield: 0, shieldUntil: -Infinity, sprintUntil: -Infinity, parryUntil: -Infinity, iframeUntil: -Infinity, reviveSafeUntil: -Infinity,
    dodgeCharges: JOBS[loadout.job].dodgeCharges, dodgeRefillAt: null, lastDodgeAt: -Infinity, lastDodgeFrom: null, charge: null,
    cast: null, buffs: {}, afflictions: new Set(), autoWaiting: false,
  };
  void nowS;
  return a;
}

const clamp = (v: unknown, lo: number, hi: number, dflt: number) => (finite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
const ALL_ABILITIES = Object.keys(ABILITIES) as AbilityId[];
/** The largest shield any effect gives, and the longest. */
let shieldMax: { amount: number; s: number } | null = null;
function maxShield(): { amount: number; s: number } {
  if (!shieldMax) {
    let amount = BEDROCK_SHIELD, s = BEDROCK_S;
    for (const ab of Object.values(ABILITIES)) for (const e of ab.effects) if (e.k === 'shield') { amount = Math.max(amount, e.amount); s = Math.max(s, e.s); }
    shieldMax = { amount, s };
  }
  return shieldMax;
}

/** The relog snapshot: seconds remaining on each cooldown still running, the GCD, dodge charges, Momentum. */
export function carryOfState(a: AdventurerState, nowS: number): Carry {
  const cooldowns: Partial<Record<AbilityId, number>> = {};
  for (const id of ALL_ABILITIES) {
    const r = (a.readyAt[id] ?? -Infinity) - nowS;
    if (r > 0) cooldowns[id] = r;
  }
  refillDodges(a, nowS);
  const since = (t: number) => Math.min(SINCE_CAP, Math.max(0, nowS - t));
  const shield = liveShield(a, nowS);
  return {
    cooldowns, gcd: Math.max(0, a.gcdUntil - nowS), dodgeCharges: a.dodgeCharges,
    dodgeRefillIn: a.dodgeRefillAt === null ? 0 : Math.max(0, a.dodgeRefillAt - nowS), momentum: a.momentum,
    sinceCombat: since(a.lastCombatAt), sinceHurt: since(a.lastHurtAt), sinceDealt: since(a.lastDealtAt),
    swapCd: a.plan3 ? Math.max(0, a.swapReadyAt - nowS) : 0, shield, shieldLeft: shield > 0 ? a.shieldUntil - nowS : 0,
    sprintLeft: Math.max(0, a.sprintUntil - nowS),
  };
}

/** Applies a relog snapshot to a fresh adventurer, every value clamped to what the real numbers allow. */
export function applyCarry(a: AdventurerState, c: Carry, nowS: number): void {
  if (typeof c !== 'object' || c === null) return;
  const cds = typeof c.cooldowns === 'object' && c.cooldowns !== null ? c.cooldowns : {};
  for (const id of ALL_ABILITIES) {
    const r = clamp((cds as Record<string, unknown>)[id], 0, ABILITIES[id].cooldown, 0);
    if (r > 0) a.readyAt[id] = nowS + r;
  }
  const gcd = clamp(c.gcd, 0, GCD_S, 0);
  if (gcd > 0) a.gcdUntil = nowS + gcd;
  const max = dodgeMax(a);
  a.dodgeCharges = Math.floor(clamp(c.dodgeCharges, 0, max, max));
  a.dodgeRefillAt = a.dodgeCharges < max ? nowS + clamp(c.dodgeRefillIn, 0, DODGE_REFILL_S, DODGE_REFILL_S) : null;
  a.momentum = clamp(c.momentum, 0, MOMENTUM_MAX, 0);
  // the optional extras: absent = fresh; present but nonsense = the most restrictive value
  const since = (v: unknown) => nowS - clamp(v, 0, SINCE_CAP, 0);
  if (c.sinceCombat !== undefined) a.lastCombatAt = since(c.sinceCombat);
  if (c.sinceHurt !== undefined) a.lastHurtAt = since(c.sinceHurt);
  if (c.sinceDealt !== undefined) a.lastDealtAt = since(c.sinceDealt);
  if (c.swapCd !== undefined && a.plan3) a.swapReadyAt = nowS + clamp(c.swapCd, 0, SWAP_COOLDOWN_S, SWAP_COOLDOWN_S);
  if (c.shield !== undefined && c.shieldLeft !== undefined) {
    const m = maxShield();
    const amount = clamp(c.shield, 0, m.amount, 0), left = clamp(c.shieldLeft, 0, m.s, 0);
    if (amount > 0 && left > 0) { a.shield = amount; a.shieldUntil = nowS + left; }
  }
  if (c.sprintLeft !== undefined) {
    const left = clamp(c.sprintLeft, 0, SPRINT_S, 0);
    if (left > 0) a.sprintUntil = nowS + left;
  }
}
/** "since" values in a Carry are capped here (an absent timer is "long ago", not Infinity, so it survives JSON). */
const SINCE_CAP = 1e6;

/** revive: full hp at `at`, Momentum 0, cooldowns, charges and timers reset, out of combat. */
export function resetAdventurer(w: CombatWorld, a: AdventurerState, at: { x: number; z: number; y: number }, nowS: number): void {
  removeFromThreat(w, a.id);
  Object.assign(a, newAdventurer(a.id, { ...at, facing: a.facing, hp: a.stats.maxHp, loadout: a.plan3 ?? a.loadout }, nowS));
}

/**
 * Drops id from every threat table and enemy target; its Burning keeps burning and its Soft Rain keeps
 * healing, but they credit no one now (no threat, no Momentum, even after a revive).
 */
export function removeFromThreat(w: CombatWorld, id: number): void {
  for (const b of w.adventurers.values()) if (b.buffs.rain && b.buffs.rain.src === id) b.buffs.rain.orphan = true;
  for (const e of w.enemies.values()) {
    if (e.burning && e.burning.src === id) e.burning.orphan = true;
    e.threat.remove(id);
    if (e.targetId === id) e.targetId = null;
  }
}

/** Fall damage: never below 1 hp, ignores i-frames and shields, resets the regen delay; returns hp taken. */
export function fallDamageTaken(a: AdventurerState, amount: number, nowS: number): number {
  if (!a.alive || !finite(amount) || amount <= 0) return 0;
  a.lastHurtAt = nowS;
  const taken = Math.max(0, Math.min(amount, a.hp - 1));
  a.hp -= taken;
  return taken;
}

function cancelCharge(a: AdventurerState): void {
  a.charge = null;
}

/** A job or picks change: job, loadout and slots; it leaves a Plan 3 loadout for good. */
function setLoadout(a: AdventurerState, l: Loadout): void {
  a.job = l.job; a.loadout = l; a.slots = slotsFor(l); a.plan3 = null;
}

// ───────── enemies: spawning and hits ─────────
/** The enemy fresh at its camp spot: full hp, no threat, marks, stagger, wind-up or cooldowns (no fx). */
export function spawnEnemyState(w: CombatWorld, e: EnemyState): void {
  const c = e.camp;
  e.x = c.x; e.z = c.z; e.y = w.zone.ground(c.x, c.z) ?? 0; e.facing = c.facing;
  e.maxHp = e.data.hp; e.hp = e.maxHp; e.alive = true; e.act = ''; e.actUntil = -Infinity; e.targetId = null; e.surging = false;
  e.threat.clear(); e.stagger = { value: 0, max: e.data.stagger, brokenUntil: -Infinity, lastGainAt: -Infinity };
  e.marks = {}; e.markBy = {}; e.burning = null; e.windup = null; e.attackReadyAt = {}; e.debuffs = {};
  e.respawnAt = Infinity; e.lastDamagedAt = -Infinity; e.rootImmuneUntil = -Infinity;
}

/**
 * A stagger gain; on a break: `break` fx, the wind-up cancelled (its attack's cooldown restarts from
 * now, as an interrupt's does), stunned until the bar recovers.
 */
export function applyStagger(w: CombatWorld, e: EnemyState, amount: number, nowS: number): boolean {
  if (!e.alive || !addStagger(e.stagger, amount, nowS)) return false;
  fx(w, { t: 'break', dst: e.id });
  if (e.windup) e.attackReadyAt[e.windup.attack] = nowS + ENEMY_ATTACKS[e.windup.attack].cooldown;
  cancelWindup(w, e);
  e.act = 'stun';
  e.actUntil = e.stagger.brokenUntil;
  return true;
}

/** Drops the enemy's wind-up and its telegraph (no fx). */
export function cancelWindup(w: CombatWorld, e: EnemyState): void {
  if (!e.windup) return;
  if (e.windup.telegraphId !== null) w.telegraphs.delete(e.windup.telegraphId);
  e.windup = null;
}

/** An interrupting hit: cancels an interruptible wind-up (`interrupt` fx, +INTERRUPT_STAGGER unless `stagger` is false, its cooldown restarts). */
export function interruptWindup(w: CombatWorld, e: EnemyState, nowS: number, stagger = true): boolean {
  if (!e.alive || !e.windup || !e.windup.interruptible) return false;
  const attack: EnemyAttackId = e.windup.attack;
  cancelWindup(w, e);
  e.attackReadyAt[attack] = nowS + ENEMY_ATTACKS[attack].cooldown;
  fx(w, { t: 'interrupt', dst: e.id });
  if (stagger) applyStagger(w, e, INTERRUPT_STAGGER, nowS);
  return true;
}

/**
 * `amount` damage on an enemy from `src` (an adventurer id, or null): hp, threat (× threatMult), the
 * combat timers, a `hit` fx (with `element` and `behind` from `tag`) and, at 0 hp, the kill.
 */
export function damageEnemy(
  w: CombatWorld, src: number, e: EnemyState, amount: number, by: HitBy, nowS: number, combo?: MarkId[], credit = true,
  tag?: { element?: ElementId; behind?: boolean },
): void {
  if (!e.alive || enemyInvulnerable(e)) return;
  e.hp = Math.max(0, e.hp - amount);
  e.lastDamagedAt = nowS;
  const ev: Extract<FxEvent, { t: 'hit' }> = { t: 'hit', src, dst: e.id, amount, absorbed: 0, by };
  if (combo && combo.length) ev.combo = combo;
  if (tag?.element !== undefined) ev.element = tag.element;
  if (tag?.behind) ev.behind = true;
  fx(w, ev);
  // a dead source's damage over time still lands, but adds no threat, combat time or kill credit
  const a = w.adventurers.get(src);
  if (a && a.alive && credit) {
    a.lastDealtAt = nowS;
    a.lastCombatAt = nowS;
    e.threat.add(a.id, amount * THREAT_PER_DAMAGE * threatMult(w, a.id));
  }
  if (e.hp <= 0) killEnemy(w, e, nowS);
}

/** An enemy at 0 hp: `death` fx, a kill credited to its threat table, targets dropped, respawn scheduled. */
export function killEnemy(w: CombatWorld, e: EnemyState, nowS: number): void {
  if (!e.alive) return; // idempotent
  const credit = e.threat.ids().filter((id) => w.adventurers.get(id)?.alive === true);
  cancelWindup(w, e);
  e.alive = false; e.hp = 0; e.act = 'dead'; e.actUntil = -Infinity; e.targetId = null;
  e.diedAt = nowS; e.respawnAt = nowS + e.data.respawn;
  e.threat.clear(); e.marks = {}; e.markBy = {}; e.burning = null; e.debuffs = {};
  e.stagger = { value: 0, max: e.stagger.max, brokenUntil: -Infinity, lastGainAt: -Infinity };
  for (const a of w.adventurers.values()) if (a.targetId === e.id) a.targetId = null;
  fx(w, { t: 'death', dst: e.id });
  w.out.kills.push({ enemy: e.id, kind: e.kind, credit });
}

/**
 * An adventurer's hit. mark: the mark it leaves; primer: it only sets that mark (no detonation);
 * finisher: it detonates (default: it has a mark and is no primer); element: a damage effect's element
 * (never set for heals, shields or buffs); behind: it always counts as from behind (Ghost Edge).
 */
export interface Strike {
  coef: number; by: AbilityId | 'auto'; momentum?: number; mark?: MarkId; primer?: boolean; finisher?: boolean;
  element?: ElementId; behind?: boolean; stagger?: number; interrupts?: boolean;
}

/** Rooted ended (at `at`): the enemy cannot be Rooted again until at + ROOT_IMMUNE_S. */
function endRooted(e: EnemyState, at: number): void {
  e.rootImmuneUntil = Math.max(e.rootImmuneUntil, at + ROOT_IMMUNE_S);
}

/** A splash or area hit of `coef` on enemy `o`, from its own defence, break and multipliers (ruling P3b-d). */
export function splashDamage(w: CombatWorld, a: AdventurerState, o: EnemyState, coef: number, s: Strike, nowS: number): number {
  const mult = (isBroken(o.stagger, nowS) ? BREAK_DAMAGE_MULT : 1) * outgoingMult(w, a, o, s, nowS);
  return hitDamage(coef, a.stats.power, o.data.defence, mult);
}

/** Drops a live mark (and who set it); Burning's DoT ends with its mark. */
function consumeMark(w: CombatWorld, e: EnemyState, m: MarkId): void {
  delete e.marks[m]; delete e.markBy[m];
  if (m === 'burning') e.burning = null;
  fx(w, { t: 'mark', dst: e.id, mark: m, on: false });
}

/** Live adventurers within r of point p (no sight needed). */
function adventurersAround(w: CombatWorld, p: { x: number; z: number }, r: number): AdventurerState[] {
  const out: AdventurerState[] = [];
  for (const b of w.adventurers.values()) if (b.alive && Math.hypot(b.x - p.x, b.z - p.z) <= r) out.push(b);
  return out;
}

/** strike, returning the plain hit's amount (without detonations or reactions) and everything it dealt. */
export function strikeFull(w: CombatWorld, a: AdventurerState, e: EnemyState, s: Strike, nowS: number): { plain: number; total: number } {
  if (!e.alive || enemyInvulnerable(e)) return { plain: 0, total: 0 };
  const power = a.stats.power, def = e.data.defence;
  const behind = strikesFromBehind(a, e, s);
  const mult = (isBroken(e.stagger, nowS) ? BREAK_DAMAGE_MULT : 1) * outgoingMult(w, a, e, s, nowS);
  let amount = hitDamage(s.coef, power, def, mult);
  const plain = amount;
  let stagger = s.stagger ?? 0;
  // 1. the reaction: an elemental hit on a live reacting mark (not its own) consumes it
  const reaction = reactionFor(s.element, liveMarks(e.marks, nowS), s.mark);
  if (reaction) {
    fx(w, { t: 'react', src: a.id, dst: e.id, reaction });
    consumeMark(w, e, REACTIONS[s.element!].mark);
    const extra = hitDamage(reaction === 'blast' ? BLAST_COEF : COMBO_COEF, power, def, mult);
    amount += extra;
    stagger += COMBO_STAGGER + (reaction === 'conduct' && e.data.elite ? CONDUCT_STAGGER : 0);
  }
  // 2. a finisher's plain detonations, 3. its own mark (finisher or primer)
  let combo: MarkId[] | undefined;
  // Rooted (ruling P3b-c): never refreshed while it lives, and not set again for ROOT_IMMUNE_S after it ends
  const rootWas = e.marks.rooted, rootLive = (rootWas ?? -Infinity) > nowS;
  if (rootWas !== undefined && !rootLive) endRooted(e, rootWas); // expired, not yet swept by the tick
  const rootBlocked = s.mark === 'rooted' && (rootLive || nowS < e.rootImmuneUntil - TIME_EPS);
  if (s.mark) {
    const hadBurning = e.burning !== null && (e.marks.burning ?? -Infinity) > nowS;
    if (s.finisher ?? !s.primer) {
      if (s.mark !== 'rooted' && rootWas !== undefined) endRooted(e, Math.min(nowS, rootWas));
      combo = applyFinisherMark(e.marks, s.mark, nowS);
      for (const m of Object.keys(e.markBy) as MarkId[]) if (m !== s.mark) delete e.markBy[m];
      for (const m of combo) {
        amount += hitDamage(COMBO_COEF, power, def, mult);
        stagger += COMBO_STAGGER;
        fx(w, { t: 'mark', dst: e.id, mark: m, on: false });
      }
    } else applyPrimerMark(e.marks, s.mark, nowS);
    if (s.mark === 'rooted') {
      if (rootBlocked && rootLive) e.marks.rooted = rootWas;
      else if (rootBlocked) delete e.marks.rooted;
      else if (e.data.elite) e.marks.rooted = nowS + MARK_S * ELITE_ROOT_MULT;
    }
    if (!rootBlocked) e.markBy[s.mark] = a.id;
    if (s.mark === 'burning') {
      e.burning = hadBurning && e.burning ? { src: a.id, power, nextAt: e.burning.nextAt } : { src: a.id, power, nextAt: nowS + 1 };
    } else if (combo?.includes('burning')) e.burning = null;
  }
  // 4. Momentum, the hit, stagger and the interrupt
  if (s.momentum) a.momentum = gainMomentum(a.momentum, s.momentum);
  damageEnemy(w, a.id, e, amount, s.by, nowS, combo, true, { element: s.element, behind });
  let total = amount;
  // the reaction's effects around the target land even when the hit killed it
  if (reaction === 'blast') {
    // per enemy (ruling P3b-d): its own defence, break and weakness
    for (const o of w.enemies.values()) {
      if (o === e || !o.alive || enemyInvulnerable(o) || Math.hypot(o.x - e.x, o.z - e.z) - o.data.radius > BLAST_SPLASH_R) continue;
      const part = splashDamage(w, a, o, BLAST_COEF * BLAST_SPLASH_FRAC, s, nowS);
      damageEnemy(w, a.id, o, part, s.by, nowS, undefined, true, { element: s.element });
      total += part;
    }
  } else if (reaction === 'steam') {
    // the hitter's heal: Font applies
    for (const b of adventurersAround(w, e, STEAM_R)) onHealDone(w, a, b, healAdventurer(w, b, STEAM_HEAL * healMult(a, b), a.id, nowS), nowS);
  } else if (reaction === 'bedrock') {
    for (const b of adventurersAround(w, e, BEDROCK_R)) applyShield(w, a, b, BEDROCK_SHIELD, BEDROCK_S, nowS);
  }
  if (!e.alive) return { plain, total };
  if (reaction === 'conduct') {
    // the reaction interrupts; INTERRUPT_STAGGER only when the hit itself interrupts
    if (e.data.elite) interruptWindup(w, e, nowS, s.interrupts === true);
    else stunEnemy(w, e, CONDUCT_STUN_S, nowS);
  }
  if (s.mark && !rootBlocked) fx(w, { t: 'mark', dst: e.id, mark: s.mark, on: true });
  applyStagger(w, e, stagger, nowS);
  if (s.interrupts) interruptWindup(w, e, nowS);
  return { plain, total };
}

/**
 * An adventurer's hit, in the order of Numbers → Elements: hitDamage(coef) × BREAK_DAMAGE_MULT on a
 * broken target × outgoingMult; 1. a reaction (an elemental hit on its reacting mark consumes it:
 * blast, conduct, steam or bedrock; `react` fx); 2. a finisher detonates every other live mark
 * (+hitDamage(COMBO_COEF) and COMBO_STAGGER each, one `hit` with `combo`); 3. its own mark (finisher
 * or primer); 4. Momentum, stagger and the interrupt. Returns the plain hit's amount, 0 if nothing landed.
 */
export function strike(w: CombatWorld, a: AdventurerState, e: EnemyState, s: Strike, nowS: number): number {
  return strikeFull(w, a, e, s, nowS).plain;
}

// ───────── hurting adventurers (the enemy AI calls these) ─────────
/**
 * Combat damage on an adventurer: the shield absorbs first, then hp; a `hit` fx; the combat and
 * regen timers; at 0 hp, death. It does NOT check i-frames or parries: enemy hits go through
 * enemyAi.resolveHit, which does (i-frames → miss, parry, then this, then knockAdventurer).
 * hp can be fractional while regenerating: callers mirroring it should use Math.ceil, so a live
 * adventurer never shows 0.
 */
export function hurtAdventurer(
  w: CombatWorld, a: AdventurerState, amount: number, src: number, by: EnemyAttackId | 'auto', nowS: number, redirected = false,
): { taken: number; absorbed: number } {
  if (!a.alive || !finite(amount) || amount <= 0) return { taken: 0, absorbed: 0 };
  const shield = liveShield(a, nowS);
  const absorbed = Math.min(shield, amount);
  a.shield = shield - absorbed;
  const taken = Math.min(a.hp, amount - absorbed);
  a.hp -= taken;
  a.lastHurtAt = nowS;
  a.lastCombatAt = nowS;
  fx(w, { t: 'hit', src, dst: a.id, amount: amount - absorbed, absorbed, by });
  if (a.hp <= 0) killAdventurer(w, a, nowS);
  else onDamageTaken(w, a, taken, absorbed, src, nowS, redirected);
  return { taken, absorbed };
}

/** Death from combat damage: a cast cancelled, `died`, `death` fx, act 'dead', buffs gone, dropped from every threat table. */
export function killAdventurer(w: CombatWorld, a: AdventurerState, nowS: number): void {
  if (!a.alive) return;
  breakCast(w, a, 'cancel', nowS);
  a.buffs = {};
  a.alive = false; a.hp = 0; a.act = 'dead'; a.actUntil = -Infinity; a.diedAt = nowS;
  a.targetId = null; a.shield = 0; a.parryUntil = -Infinity; a.sprintUntil = -Infinity;
  cancelCharge(a);
  removeFromThreat(w, a.id);
  fx(w, { t: 'death', dst: a.id });
  w.out.died.push(a.id);
}

/**
 * (No i-frame check here either: see hurtAdventurer.) A knockback: the displacement simulated on zone.surface from the adventurer's pose, which becomes
 * its end at once; act 'knock' for its duration plus KNOCK_RECOVER_S; any charge cancelled.
 */
export function knockAdventurer(w: CombatWorld, a: AdventurerState, d: Displacement, nowS: number): DisplaceOut | null {
  if (!a.alive) return null;
  const from = { x: a.x, z: a.z, y: a.y };
  const result = simulateDisplacement(from, d, w.zone.surface);
  // Still airborne at DISPLACE_MAX_S, or an invalid start: no displacement; ordinary falling goes on.
  if (!result.grounded) return null;
  cancelCharge(a);
  breakCast(w, a, 'interrupt', nowS);
  a.x = result.x; a.z = result.z; a.y = result.y;
  a.act = 'knock';
  a.actUntil = nowS + result.seconds + KNOCK_RECOVER_S;
  const out: DisplaceOut = { id: a.id, kind: 'knock', from, d, result };
  w.out.displaced.push(out);
  return out;
}

/**
 * Heals up to the maximum; `heal` fx (none when nothing is healed); THREAT_PER_HEAL × healed × threatMult for `src`
 * on every table that holds the healed, only with `credit` and while `src` is a live adventurer here.
 */
export function healAdventurer(w: CombatWorld, a: AdventurerState, amount: number, src: number, nowS: number, credit = true): number {
  if (!a.alive) return 0;
  const healed = Math.max(0, Math.min(amount, a.stats.maxHp - a.hp));
  if (!(healed > 0)) return 0;
  a.hp += healed;
  fx(w, { t: 'heal', src, dst: a.id, amount: healed });
  // heal threat only for a healer who is here and alive (a dead healer's Soft Rain keeps healing, quietly)
  if (credit && w.adventurers.get(src)?.alive === true) {
    const t = healed * THREAT_PER_HEAL * threatMult(w, src, true);
    for (const e of w.enemies.values()) if (e.alive && e.threat.has(a.id)) e.threat.add(src, t);
  }
  void nowS;
  return healed;
}

// ───────── intents ─────────
export function targetIntent(w: CombatWorld, a: AdventurerState, id: unknown, nowS: number): Refusal | null {
  if (!a.alive) return 'dead';
  if (id === null) { a.targetId = null; return null; }
  if (!Number.isInteger(id)) return 'invalid';
  const e = w.enemies.get(id as number);
  if (!e) return 'invalid';
  if (!e.alive) return 'no-target';
  if (reach(a, e) > TARGET_RANGE) return 'range';
  a.targetId = e.id;
  void nowS;
  return null;
}

/**
 * An ability press or release on slot `slot` of the current five: dead, busy (displaced, casting, or
 * charging on a press), invalid, cooldown (GCD or the ability's own), Momentum, then the aim
 * (no-target, range, sight, no-ally). An instant ability lands at once; a cast starts (casting.ts);
 * Charged Shot charges until released.
 */
export function abilityIntent(w: CombatWorld, a: AdventurerState, slot: unknown, phase: unknown, ally: unknown, nowS: number): Refusal | null {
  if (!a.alive) return 'dead';
  if (isDisplaced(a, nowS) || ((a.charge || a.cast) && phase === 'press')) return 'busy';
  if (!Number.isInteger(slot) || (slot as number) < 0 || (slot as number) >= a.slots.length || (phase !== 'press' && phase !== 'release')) return 'invalid';
  const id = a.slots[slot as number];
  const ab = ABILITIES[id];
  const charges = ab.effects.some((e) => e.k === 'charge');
  if (phase === 'release') return charges && a.charge ? releaseCharge(w, a, id, nowS) : 'invalid';
  if (nowS < a.gcdUntil - TIME_EPS || nowS < (a.readyAt[id] ?? -Infinity) - TIME_EPS) return 'cooldown';
  if (ab.cost !== undefined && a.momentum < ab.cost) return 'momentum';
  const subject = resolveAim(w, a, ab, a.targetId, ally);
  if (typeof subject === 'string') return subject;
  a.gcdUntil = nowS + GCD_S;
  if (charges) { a.charge = { startedAt: nowS }; return null; }
  if (ab.cast) { startCast(w, a, slot as number, id, subject, nowS); return null; }
  a.readyAt[id] = nowS + ab.cooldown;
  const dst = subject.enemy?.id ?? (subject.ally !== a ? subject.ally?.id : undefined);
  fx(w, dst === undefined ? { t: 'use', src: a.id, ability: id } : { t: 'use', src: a.id, ability: id, dst });
  if (ab.cost !== undefined) a.momentum = gainMomentum(a.momentum, -ab.cost);
  applyEffects(w, a, id, subject, nowS);
  return null;
}

/** Fires a Charged Shot held since charge.startedAt; on a lost target the charge is dropped with no cooldown. */
function releaseCharge(w: CombatWorld, a: AdventurerState, id: AbilityId, nowS: number): Refusal | null {
  const held = nowS - a.charge!.startedAt;
  cancelCharge(a);
  const ab = ABILITIES[id];
  const t = targetFor(w, a, a.targetId, ab.range);
  if (typeof t === 'string') return t;
  const cs = chargedShot(held);
  a.readyAt[id] = nowS + ab.cooldown;
  fx(w, { t: 'use', src: a.id, ability: id, dst: t.id, frac: cs.frac });
  strike(w, a, t, { coef: cs.coef, by: id, momentum: cs.momentum, stagger: cs.stagger, interrupts: cs.interrupts }, nowS);
  return null;
}

/**
 * A job change: dead; busy (displaced, casting, charging); invalid (not a starting job, or picks not
 * two distinct ids of its pool); in-combat; not-here (zone.jobSwitch false or absent). On accept: the
 * new loadout and slots, Momentum 0, cooldowns kept per id, dodge charges min(charges, the job's)
 * refilling toward its maximum, the target kept; no fx.
 */
export function jobIntent(w: CombatWorld, a: AdventurerState, job: unknown, picks: unknown, nowS: number): Refusal | null {
  if (!a.alive) return 'dead';
  if (isDisplaced(a, nowS) || a.cast || a.charge) return 'busy';
  const l = isJobId(job) ? parseLoadout({ job, picks }) : null;
  if (!l) return 'invalid';
  if (adventurerInCombat(w, a, nowS)) return 'in-combat';
  if (!w.zone.jobSwitch?.(a.x, a.z)) return 'not-here';
  refillDodges(a, nowS);
  setLoadout(a, l);
  a.momentum = 0;
  const max = dodgeMax(a);
  a.dodgeCharges = Math.min(a.dodgeCharges, max);
  if (a.dodgeCharges >= max) a.dodgeRefillAt = null;
  else a.dodgeRefillAt ??= nowS + DODGE_REFILL_S;
  return null;
}

/**
 * New picks for the current job, anywhere out of combat: dead, busy, invalid (not two distinct ids of
 * the job's pool), in-combat. Deprecated until Tasks 6 and 7: `{ free }` on a Plan 3 loadout runs
 * Plan 3's rules (any two distinct Plan 3 free picks); on a job loadout it is invalid.
 */
export function loadoutIntent(w: CombatWorld, a: AdventurerState, i: Extract<Intent, { t: 'loadout' }>, nowS: number): Refusal | null {
  if (!a.alive) return 'dead';
  if (isDisplaced(a, nowS) || a.charge || a.cast) return 'busy';
  if ('free' in i) {
    const p3 = a.plan3 ? parsePlan3Loadout({ weapon: a.plan3.weapon, free: i.free }) : null;
    if (!p3) return 'invalid';
    if (adventurerInCombat(w, a, nowS)) return 'in-combat';
    a.plan3 = p3; a.loadout = legacyLoadout(p3)!; a.slots = plan3Slots(p3);
    return null;
  }
  const l = parseLoadout({ job: a.job, picks: (i as { picks?: unknown }).picks });
  if (!l) return 'invalid';
  if (adventurerInCombat(w, a, nowS)) return 'in-combat';
  setLoadout(a, l);
  return null;
}

/** @deprecated Plan 3 loadouts only (until Tasks 6 and 7): Blade ⇄ Bow, out of combat, SWAP_COOLDOWN_S apart; Momentum kept. */
export function swapIntent(w: CombatWorld, a: AdventurerState, nowS: number): Refusal | null {
  if (!a.alive) return 'dead';
  if (!a.plan3) return 'invalid';
  if (isDisplaced(a, nowS) || a.cast) return 'busy';
  if (adventurerInCombat(w, a, nowS)) return 'in-combat';
  if (nowS < a.swapReadyAt - TIME_EPS) return 'cooldown';
  cancelCharge(a);
  const p3: Plan3Loadout = { weapon: a.plan3.weapon === 'blade' ? 'bow' : 'blade', free: [a.plan3.free[0], a.plan3.free[1]] };
  a.plan3 = p3; a.loadout = legacyLoadout(p3)!; a.job = a.loadout.job; a.slots = plan3Slots(p3);
  a.swapReadyAt = nowS + SWAP_COOLDOWN_S;
  return null;
}

/** Charges that came due refill, one at a time, up to the job's maximum. */
export function refillDodges(a: AdventurerState, nowS: number): void {
  const max = dodgeMax(a);
  while (a.dodgeRefillAt !== null && nowS >= a.dodgeRefillAt - TIME_EPS) {
    a.dodgeCharges = Math.min(max, a.dodgeCharges + 1);
    a.dodgeRefillAt = a.dodgeCharges < max ? a.dodgeRefillAt + DODGE_REFILL_S : null;
  }
}

export function dodgeIntent(w: CombatWorld, a: AdventurerState, i: Extract<Intent, { t: 'dodge' }>, nowS: number): Refusal | null {
  if (!a.alive) return 'dead';
  if (isDisplaced(a, nowS)) return 'busy';
  const from = i.from as { x: unknown; z: unknown; y: unknown } | null;
  if (!finite(i.dx) || !finite(i.dz) || typeof from !== 'object' || from === null || !finite(from.x) || !finite(from.z) || !finite(from.y) || typeof i.grounded !== 'boolean') return 'invalid';
  if (!i.grounded) return 'air';
  refillDodges(a, nowS);
  if (a.dodgeCharges <= 0) return 'charges';
  if (nowS - a.lastDodgeAt < DODGE_MIN_GAP_S - TIME_EPS) return 'cooldown';
  let dx = i.dx, dz = i.dz;
  if (!(Math.hypot(dx, dz) > 0)) { dx = Math.sin(a.facing); dz = Math.cos(a.facing); }
  const start = { x: from.x, z: from.z, y: from.y };
  const d = dodgeDisplacement(dx, dz);
  const result = simulateDisplacement(start, d, w.zone.surface);
  // Still airborne at DISPLACE_MAX_S (a bottomless drop) or no surface at the start: refused, nothing spent.
  if (!result.grounded) return 'invalid';
  cancelCharge(a);
  breakCast(w, a, 'dodge', nowS);
  a.x = result.x; a.z = result.z; a.y = result.y;
  a.act = 'dodge';
  a.actUntil = nowS + result.seconds;
  a.iframeUntil = nowS + DODGE_IFRAME_S;
  a.dodgeCharges--;
  if (a.dodgeRefillAt === null) a.dodgeRefillAt = nowS + DODGE_REFILL_S;
  a.lastDodgeAt = nowS;
  a.lastDodgeFrom = { x: start.x, z: start.z };
  fx(w, { t: 'dodge', src: a.id });
  w.out.displaced.push({ id: a.id, kind: 'dodge', from: start, d, result });
  return null;
}

// ───────── the tick ─────────
/** Timers, buffs, Momentum decay, regen, the Charged Shot's self-release, a cast's completion, target drop, then the auto. */
export function tickAdventurer(w: CombatWorld, a: AdventurerState, nowS: number, dt: number): void {
  if (!a.alive) return;
  tickBuffs(w, a, nowS);
  if (!a.alive) return;
  if ((a.act === 'dodge' || a.act === 'knock') && nowS >= a.actUntil - TIME_EPS) a.act = '';
  refillDodges(a, nowS);
  if (a.shield > 0 && nowS >= a.shieldUntil) a.shield = 0;
  // decay pauses while casting, so the Momentum checked at a cast's start is still there at completion
  if (!a.cast) a.momentum = decayMomentum(a.momentum, nowS - a.lastDealtAt, dt);
  if (a.hp < a.stats.maxHp && !adventurerInCombat(w, a, nowS)) {
    const s = Math.min(dt, nowS - a.lastHurtAt - HP_REGEN_DELAY_S);
    if (s > 0) a.hp = Math.min(a.stats.maxHp, a.hp + HP_REGEN_PER_S * s);
  }
  if (a.charge && nowS - a.charge.startedAt >= CHARGE_MAX_S - TIME_EPS) releaseCharge(w, a, 'charged_shot', nowS);
  tickCast(w, a, nowS);
  if (!a.alive) return;

  // The swing schedule: on cadence (nextAutoAt + every, whatever the tick jitter) while swinging; a
  // tick that finds a swing due but cannot swing (no target, out of range or sight, busy) marks the
  // adventurer as waiting, and the next swing then counts from the moment it lands.
  const due = nowS >= a.nextAutoAt - TIME_EPS;
  const wait = () => { if (due) a.autoWaiting = true; };
  if (a.targetId === null) { wait(); return; }
  const e = w.enemies.get(a.targetId);
  if (!e || !e.alive || reach(a, e) > TARGET_DROP_RANGE) { a.targetId = null; wait(); return; }
  if (!due) return;
  const weapon = WEAPONS[JOBS[a.job].weapon];
  if (a.charge || a.cast || isDisplaced(a, nowS) || enemyInvulnerable(e) || reach(a, e) > weapon.autoRange || !lineOfSight(w.zone.sight, a.x, a.z, e.x, e.z)) { wait(); return; }
  let next = a.autoWaiting ? nowS + weapon.autoEvery : a.nextAutoAt + weapon.autoEvery;
  if (next <= nowS + TIME_EPS) next = nowS + weapon.autoEvery; // a long stall: never two swings at once
  a.nextAutoAt = next;
  a.autoWaiting = false;
  strike(w, a, e, { coef: weapon.autoCoef, by: 'auto', momentum: traitOf(a) === 'battle_rhythm' ? RHYTHM_AUTO_MOMENTUM : AUTO_MOMENTUM }, nowS);
}

/** Per enemy, after the enemy AI: Burning ticks, mark expiry, stagger decay, the end of a stun, respawns. */
export function tickEnemyStatus(w: CombatWorld, e: EnemyState, nowS: number, dt: number): void {
  if (!e.alive) {
    if (nowS < e.respawnAt - TIME_EPS) return;
    for (const a of w.adventurers.values()) {
      if (Math.hypot(a.x - e.camp.x, a.z - e.camp.z) <= RESPAWN_CLEAR_RADIUS) { e.respawnAt = nowS + 1; return; }
    }
    spawnEnemyState(w, e);
    fx(w, { t: 'spawn', dst: e.id });
    return;
  }
  const exp = e.marks.burning;
  while (e.alive && e.burning && exp !== undefined && e.burning.nextAt <= nowS + TIME_EPS && e.burning.nextAt <= exp + TIME_EPS) {
    const b = e.burning;
    b.nextAt += 1;
    const mult = isBroken(e.stagger, nowS) ? BREAK_DAMAGE_MULT : 1;
    damageEnemy(w, b.src, e, hitDamage(BURNING_COEF_PER_S, b.power, e.data.defence, mult), 'burning', nowS, undefined, !b.orphan);
  }
  if (!e.alive) return;
  tickDebuffs(w, e, nowS);
  for (const m of Object.keys(MARK_BITS) as MarkId[]) {
    const until = e.marks[m];
    if (until !== undefined && until <= nowS + TIME_EPS) {
      delete e.marks[m]; delete e.markBy[m];
      if (m === 'burning') e.burning = null;
      if (m === 'rooted') endRooted(e, until);
      fx(w, { t: 'mark', dst: e.id, mark: m, on: false });
    }
  }
  tickStagger(e.stagger, nowS, dt);
  if (e.act === 'stun' && nowS >= e.actUntil - TIME_EPS) e.act = '';
}
