// Adventurers in a fight: intents (target, abilities, swap, dodge, loadout), autos, timers, and the
// hit and hurt helpers the enemy AI reuses. All state lives in the engine's CombatWorld.
import { HP_REGEN_DELAY_S, HP_REGEN_PER_S, TICK_HZ } from '../constants';
import {
  ABILITIES, BULWARK_ABSORB, FREE_POOL, BULWARK_S, CHARGE_MAX_S, CHARGE_MOVE_SCALE, DEFAULT_LOADOUT, MEND_HEAL, PARRY_WINDOW_S,
  SPRINT_S, SPRINT_SCALE, WEAPONS, chargedShot, parseLoadout, slotsFor, type AbilityId,
} from './abilities';
import {
  AUTO_MOMENTUM, BREAK_DAMAGE_MULT, BURNING_COEF_PER_S, CHARGE_SLOW_GRACE_S, COMBAT_TIMEOUT_S, COMBO_COEF, COMBO_STAGGER,
  DODGE_CHARGES, DODGE_IFRAME_S, MOMENTUM_MAX, DODGE_MIN_GAP_S, DODGE_REFILL_S, FINISHER_COST, GCD_S, INTERRUPT_STAGGER, KNOCK_RECOVER_S,
  RANGE_FUZZ, RESPAWN_CLEAR_RADIUS, SPEED_GRACE_S, SWAP_COOLDOWN_S, TARGET_DROP_RANGE, TARGET_RANGE, THREAT_PER_DAMAGE,
  THREAT_PER_HEAL,
} from './constants';
import { dodgeDisplacement, simulateDisplacement, type Displacement } from './displace';
import { ENEMY_ATTACKS, type EnemyAttackId } from './enemies';
import type { FxEvent } from './fx';
import { applyFinisherMark, type MarkId } from './marks';
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
  return a.charge ? 'charge' : '';
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
  return s;
}

const left = (until: number, nowS: number) => Math.max(0, until - nowS);
export function selfView(w: CombatWorld, a: AdventurerState, nowS: number): SelfView {
  return {
    momentum: a.momentum, weapon: a.loadout.weapon, slots: [...a.slots],
    cd: a.slots.map((id) => left(a.readyAt[id] ?? -Infinity, nowS)),
    gcd: left(a.gcdUntil, nowS), swapCd: left(a.swapReadyAt, nowS), swapLock: 0,
    dodgeCharges: a.dodgeCharges, dodgeNextIn: a.dodgeRefillAt === null ? 0 : left(a.dodgeRefillAt, nowS),
    charge: a.charge ? Math.max(0, nowS - a.charge.startedAt) : null,
    inCombat: adventurerInCombat(w, a, nowS),
  };
}

const fx = (w: CombatWorld, ev: FxEvent) => { w.out.fx.push(ev); };
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

// ───────── lifecycle ─────────
export function newAdventurer(id: number, s: { x: number; z: number; y: number; facing: number; hp: number; loadout: unknown }, nowS: number): AdventurerState {
  const loadout = parseLoadout(s.loadout) ?? { weapon: DEFAULT_LOADOUT.weapon, free: [DEFAULT_LOADOUT.free[0], DEFAULT_LOADOUT.free[1]] };
  const stats = { ...STARTER_STATS };
  const a: AdventurerState = {
    id, team: 'adventurer', x: finite(s.x) ? s.x : 0, z: finite(s.z) ? s.z : 0, y: finite(s.y) ? s.y : 0, facing: finite(s.facing) ? s.facing : 0,
    stats, hp: finite(s.hp) ? Math.min(stats.maxHp, Math.max(1, s.hp)) : stats.maxHp, alive: true, diedAt: -Infinity,
    act: '', actUntil: -Infinity, loadout, slots: slotsFor(loadout), momentum: 0,
    lastDealtAt: -Infinity, lastCombatAt: -Infinity, lastHurtAt: -Infinity,
    readyAt: {}, gcdUntil: -Infinity, swapReadyAt: -Infinity, targetId: null, nextAutoAt: -Infinity,
    shield: 0, shieldUntil: -Infinity, sprintUntil: -Infinity, parryUntil: -Infinity, iframeUntil: -Infinity,
    dodgeCharges: DODGE_CHARGES, dodgeRefillAt: null, lastDodgeAt: -Infinity, lastDodgeFrom: null, charge: null,
    autoWaiting: false,
  };
  void nowS;
  return a;
}

const clamp = (v: unknown, lo: number, hi: number, dflt: number) => (finite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
const ALL_ABILITIES = Object.keys(ABILITIES) as AbilityId[];
void FREE_POOL;

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
    swapCd: Math.max(0, a.swapReadyAt - nowS), shield, shieldLeft: shield > 0 ? a.shieldUntil - nowS : 0,
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
  a.dodgeCharges = Math.floor(clamp(c.dodgeCharges, 0, DODGE_CHARGES, DODGE_CHARGES));
  a.dodgeRefillAt = a.dodgeCharges < DODGE_CHARGES ? nowS + clamp(c.dodgeRefillIn, 0, DODGE_REFILL_S, DODGE_REFILL_S) : null;
  a.momentum = clamp(c.momentum, 0, MOMENTUM_MAX, 0);
  // the optional extras: absent = fresh; present but nonsense = the most restrictive value
  const since = (v: unknown) => nowS - clamp(v, 0, SINCE_CAP, 0);
  if (c.sinceCombat !== undefined) a.lastCombatAt = since(c.sinceCombat);
  if (c.sinceHurt !== undefined) a.lastHurtAt = since(c.sinceHurt);
  if (c.sinceDealt !== undefined) a.lastDealtAt = since(c.sinceDealt);
  if (c.swapCd !== undefined) a.swapReadyAt = nowS + clamp(c.swapCd, 0, SWAP_COOLDOWN_S, SWAP_COOLDOWN_S);
  if (c.shield !== undefined && c.shieldLeft !== undefined) {
    const amount = clamp(c.shield, 0, BULWARK_ABSORB, 0), left = clamp(c.shieldLeft, 0, BULWARK_S, 0);
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
  Object.assign(a, newAdventurer(a.id, { ...at, facing: a.facing, hp: a.stats.maxHp, loadout: a.loadout }, nowS));
}

/** Drops id from every threat table and enemy target; its Burning keeps burning, but credits no one now. */
export function removeFromThreat(w: CombatWorld, id: number): void {
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

// ───────── enemies: spawning and hits ─────────
/** The enemy fresh at its camp spot: full hp, no threat, marks, stagger, wind-up or cooldowns (no fx). */
export function spawnEnemyState(w: CombatWorld, e: EnemyState): void {
  const c = e.camp;
  e.x = c.x; e.z = c.z; e.y = w.zone.ground(c.x, c.z) ?? 0; e.facing = c.facing;
  e.maxHp = e.data.hp; e.hp = e.maxHp; e.alive = true; e.act = ''; e.actUntil = -Infinity; e.targetId = null; e.surging = false;
  e.threat.clear(); e.stagger = { value: 0, max: e.data.stagger, brokenUntil: -Infinity, lastGainAt: -Infinity };
  e.marks = {}; e.burning = null; e.windup = null; e.attackReadyAt = {};
  e.respawnAt = Infinity; e.lastDamagedAt = -Infinity;
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

/** An interrupting hit: cancels an interruptible wind-up (`interrupt` fx, +INTERRUPT_STAGGER, its cooldown restarts). */
export function interruptWindup(w: CombatWorld, e: EnemyState, nowS: number): boolean {
  if (!e.alive || !e.windup || !e.windup.interruptible) return false;
  const attack: EnemyAttackId = e.windup.attack;
  cancelWindup(w, e);
  e.attackReadyAt[attack] = nowS + ENEMY_ATTACKS[attack].cooldown;
  fx(w, { t: 'interrupt', dst: e.id });
  applyStagger(w, e, INTERRUPT_STAGGER, nowS);
  return true;
}

/**
 * `amount` damage on an enemy from `src` (an adventurer id, or null): hp, threat, the combat timers,
 * a `hit` fx and, at 0 hp, the kill.
 */
export function damageEnemy(
  w: CombatWorld, src: number, e: EnemyState, amount: number, by: HitBy, nowS: number, combo?: MarkId[], credit = true,
): void {
  if (!e.alive || enemyInvulnerable(e)) return;
  e.hp = Math.max(0, e.hp - amount);
  e.lastDamagedAt = nowS;
  fx(w, combo && combo.length ? { t: 'hit', src, dst: e.id, amount, absorbed: 0, by, combo } : { t: 'hit', src, dst: e.id, amount, absorbed: 0, by });
  // a dead source's damage over time still lands, but adds no threat, combat time or kill credit
  const a = w.adventurers.get(src);
  if (a && a.alive && credit) {
    a.lastDealtAt = nowS;
    a.lastCombatAt = nowS;
    e.threat.add(a.id, amount * THREAT_PER_DAMAGE);
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
  e.threat.clear(); e.marks = {}; e.burning = null;
  e.stagger = { value: 0, max: e.stagger.max, brokenUntil: -Infinity, lastGainAt: -Infinity };
  for (const a of w.adventurers.values()) if (a.targetId === e.id) a.targetId = null;
  fx(w, { t: 'death', dst: e.id });
  w.out.kills.push({ enemy: e.id, kind: e.kind, credit });
}

interface Strike { coef: number; by: AbilityId | 'auto'; momentum?: number; mark?: MarkId; stagger?: number; interrupts?: boolean }

/**
 * An adventurer's hit: hitDamage(coef) (×BREAK_DAMAGE_MULT on a broken target); a finisher's mark
 * detonates every other live mark (+hitDamage(COMBO_COEF) and COMBO_STAGGER each, one `hit` with
 * `combo`), then sets its own; then Momentum, stagger and the interrupt.
 */
function strike(w: CombatWorld, a: AdventurerState, e: EnemyState, s: Strike, nowS: number): void {
  if (!e.alive || enemyInvulnerable(e)) return;
  const power = a.stats.power, def = e.data.defence;
  const mult = isBroken(e.stagger, nowS) ? BREAK_DAMAGE_MULT : 1;
  let amount = hitDamage(s.coef, power, def, mult);
  let stagger = s.stagger ?? 0;
  let combo: MarkId[] | undefined;
  if (s.mark) {
    const hadBurning = e.burning !== null && (e.marks.burning ?? -Infinity) > nowS;
    combo = applyFinisherMark(e.marks, s.mark, nowS);
    for (const m of combo) {
      amount += hitDamage(COMBO_COEF, power, def, mult);
      stagger += COMBO_STAGGER;
      fx(w, { t: 'mark', dst: e.id, mark: m, on: false });
    }
    if (s.mark === 'burning') {
      e.burning = hadBurning && e.burning ? { src: a.id, power, nextAt: e.burning.nextAt } : { src: a.id, power, nextAt: nowS + 1 };
    } else if (combo.includes('burning')) e.burning = null;
  }
  if (s.momentum) a.momentum = gainMomentum(a.momentum, s.momentum);
  damageEnemy(w, a.id, e, amount, s.by, nowS, combo);
  if (!e.alive) return;
  if (s.mark) fx(w, { t: 'mark', dst: e.id, mark: s.mark, on: true });
  applyStagger(w, e, stagger, nowS);
  if (s.interrupts) interruptWindup(w, e, nowS);
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
  w: CombatWorld, a: AdventurerState, amount: number, src: number, by: EnemyAttackId | 'auto', nowS: number,
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
  return { taken, absorbed };
}

/** Death from combat damage: `died`, `death` fx, act 'dead', dropped from every threat table. */
export function killAdventurer(w: CombatWorld, a: AdventurerState, nowS: number): void {
  if (!a.alive) return;
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
  a.x = result.x; a.z = result.z; a.y = result.y;
  a.act = 'knock';
  a.actUntil = nowS + result.seconds + KNOCK_RECOVER_S;
  const out: DisplaceOut = { id: a.id, kind: 'knock', from, d, result };
  w.out.displaced.push(out);
  return out;
}

/** Heals up to the maximum; `heal` fx; THREAT_PER_HEAL × healed for `src` on every table that holds the healed. */
export function healAdventurer(w: CombatWorld, a: AdventurerState, amount: number, src: number, nowS: number): number {
  if (!a.alive) return 0;
  const healed = Math.max(0, Math.min(amount, a.stats.maxHp - a.hp));
  a.hp += healed;
  fx(w, { t: 'heal', src, dst: a.id, amount: healed });
  if (healed > 0) for (const e of w.enemies.values()) if (e.alive && e.threat.has(a.id)) e.threat.add(src, healed * THREAT_PER_HEAL);
  void nowS;
  return healed;
}

// ───────── intents ─────────
/** The current target if it is a live, hittable enemy within range (+RANGE_FUZZ) and in sight. */
function targetFor(w: CombatWorld, a: AdventurerState, range: number): EnemyState | Refusal {
  const e = a.targetId === null ? undefined : w.enemies.get(a.targetId);
  if (!e || !e.alive || enemyInvulnerable(e)) return 'no-target';
  if (reach(a, e) > range + RANGE_FUZZ) return 'range';
  if (!lineOfSight(w.zone.sight, a.x, a.z, e.x, e.z)) return 'sight';
  return e;
}

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

export function abilityIntent(w: CombatWorld, a: AdventurerState, slot: unknown, phase: unknown, nowS: number): Refusal | null {
  if (!a.alive) return 'dead';
  if (isDisplaced(a, nowS) || (a.charge && phase === 'press')) return 'busy';
  if (!Number.isInteger(slot) || (slot as number) < 0 || (slot as number) >= a.slots.length || (phase !== 'press' && phase !== 'release')) return 'invalid';
  const id = a.slots[slot as number];
  if (phase === 'release') return id === 'charged_shot' && a.charge ? releaseCharge(w, a, nowS) : 'invalid';
  const ab = ABILITIES[id];
  if (nowS < a.gcdUntil - TIME_EPS || nowS < (a.readyAt[id] ?? -Infinity) - TIME_EPS) return 'cooldown';
  if (ab.cost !== undefined && a.momentum < ab.cost) return 'momentum';
  let target: EnemyState | null = null;
  if (ab.needsTarget) {
    const t = targetFor(w, a, ab.range);
    if (typeof t === 'string') return t;
    target = t;
  }
  a.gcdUntil = nowS + GCD_S;
  if (id === 'charged_shot') { a.charge = { startedAt: nowS }; return null; }
  a.readyAt[id] = nowS + ab.cooldown;
  useAbility(w, a, id, target, nowS);
  return null;
}

function useAbility(w: CombatWorld, a: AdventurerState, id: AbilityId, target: EnemyState | null, nowS: number): void {
  const ab = ABILITIES[id];
  fx(w, target ? { t: 'use', src: a.id, ability: id, dst: target.id } : { t: 'use', src: a.id, ability: id });
  switch (id) {
    case 'slash': case 'snap_shot': case 'sunder': case 'pitch_arrow':
      if (ab.cost !== undefined) a.momentum = gainMomentum(a.momentum, -FINISHER_COST);
      strike(w, a, target!, { coef: ab.coef ?? 0, by: id, momentum: ab.momentum, mark: ab.mark, stagger: ab.stagger, interrupts: ab.interrupts }, nowS);
      return;
    case 'parry': a.parryUntil = nowS + PARRY_WINDOW_S; return;
    case 'mend': healAdventurer(w, a, MEND_HEAL, a.id, nowS); return;
    case 'taunt': target!.threat.taunt(a.id, nowS); return;
    case 'bulwark': a.shield = BULWARK_ABSORB; a.shieldUntil = nowS + BULWARK_S; return;
    case 'sprint': a.sprintUntil = nowS + SPRINT_S; return;
    case 'charged_shot': return; // pressed and released through releaseCharge
  }
}

/** Fires a Charged Shot held since charge.startedAt; on a lost target the charge is dropped with no cooldown. */
function releaseCharge(w: CombatWorld, a: AdventurerState, nowS: number): Refusal | null {
  const held = nowS - a.charge!.startedAt;
  cancelCharge(a);
  const t = targetFor(w, a, ABILITIES.charged_shot.range);
  if (typeof t === 'string') return t;
  const cs = chargedShot(held);
  a.readyAt.charged_shot = nowS + ABILITIES.charged_shot.cooldown;
  fx(w, { t: 'use', src: a.id, ability: 'charged_shot', dst: t.id, frac: cs.frac });
  strike(w, a, t, { coef: cs.coef, by: 'charged_shot', momentum: cs.momentum, stagger: cs.stagger, interrupts: cs.interrupts }, nowS);
  return null;
}

/** Blade ⇄ Bow, only out of combat (weapons belong to jobs). SWAP_COOLDOWN_S between swaps. */
export function swapIntent(w: CombatWorld, a: AdventurerState, nowS: number): Refusal | null {
  if (!a.alive) return 'dead';
  if (isDisplaced(a, nowS)) return 'busy';
  if (adventurerInCombat(w, a, nowS)) return 'in-combat';
  if (nowS < a.swapReadyAt - TIME_EPS) return 'cooldown';
  cancelCharge(a);
  a.loadout = { weapon: a.loadout.weapon === 'blade' ? 'bow' : 'blade', free: [a.loadout.free[0], a.loadout.free[1]] };
  a.slots = slotsFor(a.loadout);
  a.swapReadyAt = nowS + SWAP_COOLDOWN_S;
  return null;
}

export function loadoutIntent(w: CombatWorld, a: AdventurerState, free: unknown, nowS: number): Refusal | null {
  if (!a.alive) return 'dead';
  if (isDisplaced(a, nowS) || a.charge) return 'busy';
  const l = parseLoadout({ weapon: a.loadout.weapon, free });
  if (!l) return 'invalid';
  if (adventurerInCombat(w, a, nowS)) return 'in-combat';
  a.loadout = l;
  a.slots = slotsFor(l);
  return null;
}

function refillDodges(a: AdventurerState, nowS: number): void {
  while (a.dodgeRefillAt !== null && nowS >= a.dodgeRefillAt - TIME_EPS) {
    a.dodgeCharges = Math.min(DODGE_CHARGES, a.dodgeCharges + 1);
    a.dodgeRefillAt = a.dodgeCharges < DODGE_CHARGES ? a.dodgeRefillAt + DODGE_REFILL_S : null;
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
/** Timers, Momentum decay, regen, the Charged Shot's self-release, target drop, then the auto. */
export function tickAdventurer(w: CombatWorld, a: AdventurerState, nowS: number, dt: number): void {
  if (!a.alive) return;
  if ((a.act === 'dodge' || a.act === 'knock') && nowS >= a.actUntil - TIME_EPS) a.act = '';
  refillDodges(a, nowS);
  if (a.shield > 0 && nowS >= a.shieldUntil) a.shield = 0;
  a.momentum = decayMomentum(a.momentum, nowS - a.lastDealtAt, dt);
  if (a.hp < a.stats.maxHp && !adventurerInCombat(w, a, nowS)) {
    const s = Math.min(dt, nowS - a.lastHurtAt - HP_REGEN_DELAY_S);
    if (s > 0) a.hp = Math.min(a.stats.maxHp, a.hp + HP_REGEN_PER_S * s);
  }
  if (a.charge && nowS - a.charge.startedAt >= CHARGE_MAX_S - TIME_EPS) releaseCharge(w, a, nowS);

  // The swing schedule: on cadence (nextAutoAt + every, whatever the tick jitter) while swinging; a
  // tick that finds a swing due but cannot swing (no target, out of range or sight, busy) marks the
  // adventurer as waiting, and the next swing then counts from the moment it lands.
  const due = nowS >= a.nextAutoAt - TIME_EPS;
  const wait = () => { if (due) a.autoWaiting = true; };
  if (a.targetId === null) { wait(); return; }
  const e = w.enemies.get(a.targetId);
  if (!e || !e.alive || reach(a, e) > TARGET_DROP_RANGE) { a.targetId = null; wait(); return; }
  if (!due) return;
  const weapon = WEAPONS[a.loadout.weapon];
  if (a.charge || isDisplaced(a, nowS) || enemyInvulnerable(e) || reach(a, e) > weapon.autoRange || !lineOfSight(w.zone.sight, a.x, a.z, e.x, e.z)) { wait(); return; }
  let next = a.autoWaiting ? nowS + weapon.autoEvery : a.nextAutoAt + weapon.autoEvery;
  if (next <= nowS + TIME_EPS) next = nowS + weapon.autoEvery; // a long stall: never two swings at once
  a.nextAutoAt = next;
  a.autoWaiting = false;
  strike(w, a, e, { coef: weapon.autoCoef, by: 'auto', momentum: AUTO_MOMENTUM }, nowS);
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
  for (const m of ['soaked', 'burning', 'marked'] as const) {
    const until = e.marks[m];
    if (until !== undefined && until <= nowS + TIME_EPS) {
      delete e.marks[m];
      if (m === 'burning') e.burning = null;
      fx(w, { t: 'mark', dst: e.id, mark: m, on: false });
    }
  }
  tickStagger(e.stagger, nowS, dt);
  if (e.act === 'stun' && nowS >= e.actUntil - TIME_EPS) e.act = '';
}
