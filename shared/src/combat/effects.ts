// Data-driven ability effects: how an ability's subject is found (resolveAim), what each Effect does
// (applyEffects), and the shields, buffs, debuffs, heals, revives and hp costs behind them. Every
// adventurer in the zone counts as an ally (no parties before Plan 4); aims never pick enemies.
import { ABILITIES, type AbilityData, type AbilityId, type BuffId, type DebuffId, type Effect } from './abilities';
import { ALLY_RANGE, RANGE_FUZZ, REVIVE_IFRAMES_S } from './constants';
import type { AdventurerState, CombatWorld, EnemyState, Refusal } from './engine';
import { damageEnemy, enemyInvulnerable, healAdventurer, reach, refillDodges, strike, TIME_EPS, type Strike } from './adventurer';
import type { FxEvent } from './fx';
import { gainMomentum } from './momentum';
import { lineOfSight } from './sight';
import { JOBS } from './jobs';

const fx = (w: CombatWorld, ev: FxEvent) => { w.out.fx.push(ev); };
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

// ───────── hooks (Task 3 fills these: traits, buffs and debuffs on damage and heals) ─────────
/** Outgoing damage multiplier for an adventurer's hit (roar, pact, weakpoint, behind, pinpoint, element, overflow): 1 for now. */
export function outgoingMult(w: CombatWorld, a: AdventurerState, e: EnemyState, s: Strike, nowS: number): number {
  void w; void a; void e; void s; void nowS;
  return 1;
}
/** Damage-taken multiplier for an enemy hit on an adventurer (Steadfast, aegis): 1 for now. */
export function takenMult(w: CombatWorld, a: AdventurerState, e: EnemyState, nowS: number): number {
  void w; void a; void e; void nowS;
  return 1;
}
/** Heal multiplier for `src` healing `dst` (Font on others): 1 for now. */
export function healMult(src: AdventurerState, dst: AdventurerState): number {
  void src; void dst;
  return 1;
}
/** After `src` healed `dst` by `healed` (Font Momentum): nothing for now. */
export function onHealDone(w: CombatWorld, src: AdventurerState | undefined, dst: AdventurerState, healed: number, nowS: number): void {
  void w; void src; void dst; void healed; void nowS;
}
/** After an enemy hit landed on an adventurer (Block Momentum, Crimson Tithe Momentum, Shelter): nothing for now. */
export function onDamageTaken(w: CombatWorld, a: AdventurerState, taken: number, absorbed: number, src: number, nowS: number): void {
  void w; void a; void taken; void absorbed; void src; void nowS;
}

// ───────── aims ─────────
/** What an ability lands on: the enemy target, or the adventurer it is aimed at (the caster for 'self'). */
export type Subject = { enemy: EnemyState; ally?: undefined } | { enemy?: undefined; ally: AdventurerState };

/** The current target if it is a live, hittable enemy within range (+RANGE_FUZZ +slack) and in sight. */
export function targetFor(w: CombatWorld, a: AdventurerState, targetId: number | null, range: number, slack = 0): EnemyState | Refusal {
  const e = targetId === null ? undefined : w.enemies.get(targetId);
  if (!e || !e.alive || enemyInvulnerable(e)) return 'no-target';
  if (reach(a, e) > range + RANGE_FUZZ + slack) return 'range';
  if (!lineOfSight(w.zone.sight, a.x, a.z, e.x, e.z)) return 'sight';
  return e;
}

/**
 * A live adventurer within `limit` of the caster and in sight: `wanted` if it qualifies, else the one
 * with the lowest hp/maxHp (ties: the caster, then the lower id). null when none qualifies.
 */
function pickAlly(w: CombatWorld, a: AdventurerState, wanted: unknown, limit: number, withSelf: boolean): AdventurerState | null {
  const near = (b: AdventurerState) => b.alive && (withSelf || b !== a) && (b === a || dist(a, b) <= limit);
  const seen = (b: AdventurerState) => b === a || lineOfSight(w.zone.sight, a.x, a.z, b.x, b.z);
  const want = typeof wanted === 'number' ? w.adventurers.get(wanted) : undefined;
  if (want && near(want) && seen(want)) return want;
  let best: AdventurerState | null = null, bestF = Infinity;
  for (const b of w.adventurers.values()) {
    if (!near(b)) continue;
    const f = b.hp / b.stats.maxHp;
    // priority first; the line-of-sight trace only for a candidate that would win
    const wins = f < bestF - 1e-12 || (Math.abs(f - bestF) <= 1e-12 && best !== a && (b === a || b.id < best!.id));
    if (wins && seen(b)) { best = b; bestF = f; }
  }
  return best;
}

/** A dead adventurer within `limit` and in sight: `wanted` if it qualifies, else the nearest (ties: the lower id). */
function pickDead(w: CombatWorld, a: AdventurerState, wanted: unknown, limit: number): AdventurerState | null {
  const ok = (b: AdventurerState) => !b.alive && b !== a && dist(a, b) <= limit;
  const seen = (b: AdventurerState) => lineOfSight(w.zone.sight, a.x, a.z, b.x, b.z);
  const want = typeof wanted === 'number' ? w.adventurers.get(wanted) : undefined;
  if (want && ok(want) && seen(want)) return want;
  let best: AdventurerState | null = null, bestD = Infinity;
  for (const b of w.adventurers.values()) {
    if (!ok(b)) continue;
    const d = dist(a, b);
    if ((d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && b.id < best!.id)) && seen(b)) { best = b; bestD = d; }
  }
  return best;
}

/**
 * The subject of `ab` cast by `a` (Numbers → Aim rules), or a refusal. `targetId` is the enemy target
 * to check (the adventurer's own, or a cast's), `allyId` the intent's `ally`; `slack` is extra range
 * (CAST_RANGE_SLACK when a cast completes).
 */
export function resolveAim(w: CombatWorld, a: AdventurerState, ab: AbilityData, targetId: number | null, allyId: unknown, slack = 0): Subject | Refusal {
  const limit = ab.range + RANGE_FUZZ + slack;
  switch (ab.aim) {
    case 'enemy': {
      const e = targetFor(w, a, targetId, ab.range, slack);
      return typeof e === 'string' ? e : { enemy: e };
    }
    case 'self': return { ally: a };
    case 'ally': return { ally: pickAlly(w, a, allyId, limit, true) ?? a };
    case 'other-ally': { const b = pickAlly(w, a, allyId, limit, false); return b ? { ally: b } : 'no-ally'; }
    case 'dead-ally': { const b = pickDead(w, a, allyId, limit); return b ? { ally: b } : 'no-ally'; }
  }
}

// ───────── shields, buffs, debuffs ─────────
/** The one shield: a new one replaces the live one when its amount is ≥ the live amount left (else it is ignored). */
export function applyShield(w: CombatWorld, src: AdventurerState, dst: AdventurerState, amount: number, s: number, nowS: number): boolean {
  if (!dst.alive) return false;
  const live = dst.shield > 0 && nowS < dst.shieldUntil ? dst.shield : 0;
  if (amount < live) return false;
  dst.shield = amount; dst.shieldUntil = nowS + s;
  fx(w, { t: 'shield', src: src.id, dst: dst.id, amount });
  return true;
}

/** lastHealAt: Soft Rain's latest heal; orphan: its src died or left since (it heals, but credits no one). */
export interface BuffState { until: number; src: number; startedAt: number; lastHealAt?: number; orphan?: boolean }
/** A buff on an adventurer: a new application refreshes it (the later expiry, the newer src); `buff` fx when it starts. */
export function applyBuff(w: CombatWorld, src: AdventurerState, dst: AdventurerState, buff: BuffId, s: number, nowS: number): void {
  if (!dst.alive) return;
  const cur = dst.buffs[buff];
  if (cur && cur.until > nowS) { cur.until = Math.max(cur.until, nowS + s); cur.src = src.id; delete cur.orphan; return; }
  dst.buffs[buff] = { until: nowS + s, src: src.id, startedAt: nowS };
  fx(w, { t: 'buff', src: src.id, dst: dst.id, buff, on: true });
}
/** A debuff on an enemy, refreshed like a buff. */
export function applyDebuff(w: CombatWorld, src: AdventurerState, e: EnemyState, debuff: DebuffId, s: number, nowS: number): void {
  if (!e.alive) return;
  const cur = e.debuffs[debuff];
  if (cur && cur.until > nowS) { cur.until = Math.max(cur.until, nowS + s); cur.src = src.id; return; }
  e.debuffs[debuff] = { until: nowS + s, src: src.id, startedAt: nowS };
  fx(w, { t: 'buff', src: src.id, dst: e.id, buff: debuff, on: true });
}
export function hasBuff(a: AdventurerState, buff: BuffId, nowS: number): boolean {
  const b = a.buffs[buff];
  return b !== undefined && b.until > nowS;
}
export function hasDebuff(e: EnemyState, debuff: DebuffId, nowS: number): boolean {
  const d = e.debuffs[debuff];
  return d !== undefined && d.until > nowS;
}
/** Soft Rain heals this much at each whole second after it starts. */
export const RAIN_HEAL = 4;

/** Per adventurer, each tick: Soft Rain heals (from its src), then expired buffs end (`buff … on: false`). */
export function tickBuffs(w: CombatWorld, a: AdventurerState, nowS: number): void {
  const rain = a.buffs.rain;
  if (rain) {
    // heals at startedAt + 1, + 2, …, up to the expiry
    let k = Math.floor((rain.lastHealAt ?? rain.startedAt) - rain.startedAt + TIME_EPS) + 1;
    while (a.alive && rain.startedAt + k <= nowS + TIME_EPS && rain.startedAt + k <= rain.until + TIME_EPS) {
      rain.lastHealAt = rain.startedAt + k;
      const src = rain.orphan ? undefined : w.adventurers.get(rain.src);
      const healed = healAdventurer(w, a, RAIN_HEAL * (src ? healMult(src, a) : 1), rain.src, nowS, src !== undefined);
      onHealDone(w, src, a, healed, nowS);
      k++;
    }
  }
  for (const id of Object.keys(a.buffs) as BuffId[]) {
    if (a.buffs[id]!.until <= nowS + TIME_EPS) { delete a.buffs[id]; fx(w, { t: 'buff', src: a.id, dst: a.id, buff: id, on: false }); }
  }
}
/** Per enemy, each tick: expired debuffs end. */
export function tickDebuffs(w: CombatWorld, e: EnemyState, nowS: number): void {
  for (const id of Object.keys(e.debuffs) as DebuffId[]) {
    if (e.debuffs[id]!.until <= nowS + TIME_EPS) { const src = e.debuffs[id]!.src; delete e.debuffs[id]; fx(w, { t: 'buff', src, dst: e.id, buff: id, on: false }); }
  }
}

// ───────── revive, hp cost ─────────
/** A dead adventurer back where it lies: round(frac × maxHp) hp, Momentum 0, act '', REVIVE_IFRAMES_S of i-frames, cooldowns kept; `revive` fx and out.revived. */
export function reviveAdventurer(w: CombatWorld, by: AdventurerState, a: AdventurerState, frac: number, nowS: number): void {
  if (a.alive) return;
  const hp = Math.max(1, Math.round(frac * a.stats.maxHp));
  a.alive = true; a.hp = hp; a.momentum = 0; a.act = ''; a.actUntil = -Infinity;
  a.lastHurtAt = nowS; a.nextAutoAt = -Infinity; a.autoWaiting = false;
  a.iframeUntil = nowS + REVIVE_IFRAMES_S;
  fx(w, { t: 'revive', src: by.id, dst: a.id, hp });
  (w.out.revived ??= []).push({ id: a.id, by: by.id, hp });
}
/** min(amount, hp − 1) from the caster: never kills, adds no threat, and is not combat damage. */
export function payHp(a: AdventurerState, amount: number): number {
  const paid = Math.max(0, Math.min(amount, a.hp - 1));
  a.hp -= paid;
  return paid;
}

// ───────── applying an ability ─────────
/** Live adventurers within r of `a` (the caster included), no sight needed. */
function adventurersNear(w: CombatWorld, a: AdventurerState, r: number): AdventurerState[] {
  return [...w.adventurers.values()].filter((b) => b.alive && (b === a || dist(a, b) <= r));
}
/** Live, hittable enemies whose edge is within r of `p`. */
function enemiesNear(w: CombatWorld, p: { x: number; z: number }, r: number, except?: EnemyState): EnemyState[] {
  return [...w.enemies.values()].filter((e) => e !== except && e.alive && !enemyInvulnerable(e) && reach(p, e) <= r);
}

/**
 * Applies the ability's effects, in list order, for caster `a` on `subject`. The ability's Momentum,
 * mark, stagger and interrupt ride on its (first) damage effect, through strike. Primer marks are
 * Task 3's (a primer sets no mark yet). Splash hits other live enemies within r of the target for
 * frac × the target's amount, with no marks and no detonation.
 */
export function applyEffects(w: CombatWorld, a: AdventurerState, id: AbilityId, subject: Subject, nowS: number): void {
  const ab = ABILITIES[id];
  let struck = false;
  for (const ef of ab.effects) {
    if (!a.alive && ef.k !== 'damage') break;
    applyEffect(w, a, ab, ef, subject, nowS, struck);
    if (ef.k === 'damage') struck = true;
  }
}

function applyEffect(w: CombatWorld, a: AdventurerState, ab: AbilityData, ef: Effect, subject: Subject, nowS: number, struck: boolean): void {
  const aim = subject.ally ?? a;
  switch (ef.k) {
    case 'damage': {
      const e = subject.enemy;
      if (!e) return;
      const s: Strike = struck ? { coef: ef.coef, by: ab.id } : {
        coef: ef.coef, by: ab.id, momentum: ab.momentum, mark: ab.primer ? undefined : ab.mark, stagger: ab.stagger, interrupts: ab.interrupts,
      };
      const near = ef.splash ? enemiesNear(w, e, ef.splash.r, e) : [];
      const amount = strike(w, a, e, s, nowS);
      if (ef.splash && amount > 0) {
        const part = Math.max(1, Math.round(amount * ef.splash.frac));
        for (const o of near) splashHit(w, a, o, part, ab.id, nowS);
      }
      return;
    }
    case 'heal': {
      const dst = ef.on === 'self' ? a : ef.on === 'aim' ? aim : pickAlly(w, a, undefined, ALLY_RANGE, true) ?? a;
      const healed = healAdventurer(w, dst, ef.amount * healMult(a, dst), a.id, nowS);
      onHealDone(w, a, dst, healed, nowS);
      return;
    }
    case 'shield': {
      const dsts = ef.on === 'area' ? adventurersNear(w, a, ef.r) : [ef.on === 'self' ? a : aim];
      for (const d of dsts) applyShield(w, a, d, ef.amount, ef.s, nowS);
      return;
    }
    case 'buff': {
      const dsts = ef.on === 'area' || ef.on === 'others' ? adventurersNear(w, a, ef.r).filter((b) => ef.on === 'area' || b !== a) : [ef.on === 'self' ? a : aim];
      for (const d of dsts) applyBuff(w, a, d, ef.buff, ef.s, nowS);
      return;
    }
    case 'debuff': {
      const dsts = ef.on === 'area' ? enemiesNear(w, a, ef.r) : subject.enemy ? [subject.enemy] : [];
      for (const e of dsts) applyDebuff(w, a, e, ef.debuff, ef.s, nowS);
      return;
    }
    case 'momentum': {
      const dst = ef.on === 'self' ? a : aim;
      if (!dst.alive) return;
      dst.momentum = gainMomentum(dst.momentum, ef.amount);
      fx(w, { t: 'gift', src: a.id, dst: dst.id, amount: ef.amount });
      return;
    }
    case 'taunt': {
      const dsts = ef.on === 'area' ? enemiesNear(w, a, ef.r) : subject.enemy ? [subject.enemy] : [];
      for (const e of dsts) e.threat.taunt(a.id, nowS);
      return;
    }
    case 'threat-drop':
      for (const e of enemiesNear(w, a, ef.r)) if (e.threat.has(a.id)) e.threat.set(a.id, 0);
      return;
    case 'revive': if (subject.ally && subject.ally !== a) reviveAdventurer(w, a, subject.ally, ef.frac, nowS); return;
    case 'hp-cost': payHp(a, ef.amount); return;
    case 'dodge-refill': {
      const max = JOBS[a.job].dodgeCharges;
      refillDodges(a, nowS);
      a.dodgeCharges = Math.min(max, a.dodgeCharges + ef.charges);
      if (a.dodgeCharges >= max) a.dodgeRefillAt = null;
      return;
    }
    case 'parry': a.parryUntil = nowS + ef.s; return;
    case 'sprint': a.sprintUntil = nowS + ef.s; return;
    case 'charge': return; // pressed and released through the charge (adventurer.ts)
    case 'cleanse': aim.afflictions.clear(); return;
  }
}

/** A splash: `amount` on another enemy, with no marks, Momentum, stagger or detonation. */
function splashHit(w: CombatWorld, a: AdventurerState, e: EnemyState, amount: number, by: AbilityId, nowS: number): void {
  damageEnemy(w, a.id, e, amount, by, nowS);
}
