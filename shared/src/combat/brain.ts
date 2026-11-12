// A scripted adventurer: what a sensible player does in a fight, as intents. Shared by the tuning
// simulation (sim.ts) and the load-test bots. Pure: it reads views and its own memory only.
// It never swaps weapons or changes job (only out of combat, in a town), and it never parries.
import { ABILITIES, CHARGE_FULL_S, CHARGE_INTERRUPT_FRAC, WEAPONS, type AbilityData, type AbilityId } from './abilities';
import { ENEMY_ATTACKS, ENEMY_KINDS } from './enemies';
import type { CombatantView, Intent, SelfView, TelegraphView } from './engine';
import { FINISHER_COST } from './constants';
import { JOBS } from './jobs';
import { MARK_BITS } from './marks';
import { escapeDir, inShape } from './shapes';

/**
 * allies: the other adventurers within ALLY_VIEW_R (dead ones included), as the caller sees them.
 * Optional only for callers built before jobs (absent = none): the load-test bots until Task 9.
 */
export interface BrainInput {
  nowS: number; careful: boolean;
  self: CombatantView & SelfView;
  target: CombatantView | null;
  allies?: CombatantView[];
  telegraphs: TelegraphView[];
}
export interface BrainAction { moveTo: { x: number; z: number } | null; intents: Intent[] }
/**
 * dodged: telegraph ids already dodged; chargingSince: when the brain pressed Charged Shot;
 * holdSince: when a careful brain started holding a ready finisher for an interruptible wind-up;
 * reactionS: how long a telegraph must have been up before a careful brain dodges it (0.4 s).
 */
/** solo: plays as if alone (the synergy check): never presses a `support` ability, lays no primer for its finisher, keeps no formation. */
export interface BrainMemory { dodged: Set<number>; chargingSince: number | null; holdSince: number | null; reactionS: number; solo?: boolean }
export function newBrainMemory(reactionS = REACTION_S, solo = false): BrainMemory {
  return solo ? { dodged: new Set(), chargingSince: null, holdSince: null, reactionS, solo } : { dodged: new Set(), chargingSince: null, holdSince: null, reactionS };
}

/** Reaction time before a careful brain dodges a telegraph that contains it, in s. */
export const REACTION_S = 0.4;
/** The brain closes in while its reach is more than the weapon's range minus this, in m. */
export const RANGE_SLACK = 0.3;
/** The longest a careful brain holds a ready finisher, waiting for an interruptible wind-up, in s. */
export const FINISHER_HOLD_S = 1;
/** How far the caller looks for allies (BrainInput.allies), in m. */
export const ALLY_VIEW_R = 30;
/** Where it walks to when closing in: this far inside its range, in m. */
const STAND_INSIDE = 0.6;
/** How far ahead a careful brain looks before stepping toward a marked attack, in m (about two ticks of running). */
const STEP_LOOK = 0.8;
/** A flanker this close to its spot behind the target stays put, in m. */
const FLANK_SLACK = 0.5;
/** Soft Rain's reach (healParty looks for someone hurt within it), in m. */
const PARTY_R = 10;
/** An area supporter keeps its nearest ally within its radius minus this (and walks to its radius minus twice this), in m. */
const COHESION_SLACK = 2;
/** "In reach" of the target's attacks: its auto reach plus this, in m. */
const REACH_SLACK = 1;

const EPS = 1e-6;

/** Slot indices: quick, finisher, signature, then the two picks. */
const QUICK = 0, FINISHER = 1, SIGNATURE = 2;

const frac = (v: CombatantView) => v.hp / v.maxHp;
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * One decision, every tick (Plan 3b, Task 4):
 * 1. dodging (careful only): a telegraph containing self, not yet dodged, up for reactionS → dodge
 *    along escapeDir (a held Charged Shot of frac ≥ 0.8 is loosed first; a cast is cancelled by it).
 *    The dodge's `from` is the pose the brain read; a caller that has moved the body since should put
 *    its current pose there;
 * 2. movement: toward the target while reach > the weapon's range − 0.3; a `flank` job (Ninja) whose
 *    target attacks another adventurer goes to the point behind it (target − facing × (radius + range
 *    − 0.6)). Not during a dodge or a knock, and (careful) not back into a telegraph it is outside of.
 *    Casting keeps moving (the engine slows it). A job with an area support (Soft Rain, Roar, Dawn Ward,
 *    Aegis) keeps its nearest ally within that radius while still in range of the target, and a ready
 *    revive walks toward a dead ally out of its range;
 * 3. abilities, at most one per tick, by each slot's `ai` hint in the order of the Task 4 brief (revive,
 *    heals, shields, aegis, interrupt, taunt, shelter, threat-drop, mist, buffs, Momentum gift, debuff,
 *    dodge refill, the finisher, damage — quick first, Charged Shot). The first that applies, is
 *    ready and in range wins. A careful brain never starts a cast inside a telegraph. A ready finisher
 *    with nothing to detonate lays a ready primer of another mark first (the finisher follows after the GCD).
 * memory.solo (the synergy check's control) plays as if alone: no support ability, no primer laid for the
 * finisher, no formation and no revive.
 */
export function adventurerBrain(b: BrainInput, memory: BrainMemory): BrainAction {
  const { self, target, nowS } = b;
  const intents: Intent[] = [];
  if (!self.alive) { memory.chargingSince = null; memory.holdSince = null; return { moveTo: null, intents }; }
  const displaced = self.act === 'dodge' || self.act === 'knock';
  if (self.charge === null) memory.chargingSince = null; // released, or cancelled by a knock
  const charging = self.charge !== null;
  const casting = self.cast !== null && self.cast !== undefined;
  const held = self.charge ?? 0;
  const chargeSlot = self.slots.indexOf('charged_shot');

  // forget telegraphs that are gone
  if (memory.dodged.size > 0) {
    for (const id of memory.dodged) if (!b.telegraphs.some((t) => t.id === id)) memory.dodged.delete(id);
  }

  // the target
  const live = target && target.alive && target.team === 'enemy' ? target : null;
  if (live && self.targetId !== live.id) intents.push({ t: 'target', id: live.id });

  // 1. dodging
  if (b.careful && !displaced) {
    for (const tg of b.telegraphs) {
      if (memory.dodged.has(tg.id) || !inShape(tg.shape, self.x, self.z)) continue;
      if (tg.total - tg.left < memory.reactionS - EPS) continue;
      memory.dodged.add(tg.id);
      if (self.dodgeCharges <= 0) continue; // nothing to dodge with: take it
      if (charging && chargeSlot >= 0 && held / CHARGE_FULL_S >= CHARGE_INTERRUPT_FRAC - 1e-9) intents.push({ t: 'ability', slot: chargeSlot, phase: 'release' });
      const d = escapeDir(tg.shape, self.x, self.z);
      intents.push({ t: 'dodge', dx: d.x, dz: d.z, from: { x: self.x, z: self.z, y: self.y }, grounded: true });
      memory.chargingSince = null;
      return { moveTo: null, intents };
    }
  }

  const allies = b.allies ?? [];
  const liveAllies = allies.filter((a) => a.alive && a.id !== self.id);
  // a revive needs no target: a dead partner comes first even once the fight is over
  if (!live) {
    if (!displaced && !charging && !casting && self.gcd <= EPS && !memory.solo) {
      const act = tryRevive(b, allies, { moveTo: null, intents });
      if (act) return act;
    }
    return { moveTo: null, intents };
  }

  // 2. movement
  const range = WEAPONS[self.weapon].autoRange;
  const radius = ENEMY_KINDS[live.kind as keyof typeof ENEMY_KINDS]?.radius ?? 0;
  const dx = live.x - self.x, dz = live.z - self.z, dist0 = Math.hypot(dx, dz);
  const reach = dist0 - radius;
  let moveTo: { x: number; z: number } | null = null;
  const flanking = JOBS[self.job ?? 'warrior']?.brain.flank === true && live.targetId !== null && live.targetId !== self.id
    && liveAllies.some((a) => a.id === live.targetId);
  if (!displaced && flanking) {
    const back = Math.max(0, radius + range - STAND_INSIDE);
    const spot = { x: live.x - Math.sin(live.facing) * back, z: live.z - Math.cos(live.facing) * back };
    if (dist(spot, self) > FLANK_SLACK) moveTo = spot;
  } else if (!displaced && reach > range - RANGE_SLACK && dist0 > 0) {
    const standAt = Math.max(0, radius + range - STAND_INSIDE);
    moveTo = { x: live.x - (dx / dist0) * standAt, z: live.z - (dz / dist0) * standAt };
  }
  // a job with an area support (Soft Rain, Roar, Dawn Ward, Aegis) keeps the nearest live ally inside it, while in range of the target
  const area = areaSupportR(self.slots);
  if (!displaced && !memory.solo && area !== null && liveAllies.length > 0) {
    let near = liveAllies[0];
    for (const a of liveAllies) if (dist(a, self) < dist(near, self)) near = a;
    const d = dist(near, self);
    if (d > area - COHESION_SLACK && d > 0) {
      const keep = area - 2 * COHESION_SLACK;
      const p = { x: near.x + ((self.x - near.x) / d) * keep, z: near.z + ((self.z - near.z) / d) * keep };
      if (Math.hypot(live.x - p.x, live.z - p.z) - radius <= range - RANGE_SLACK) moveTo = p;
    }
  }
  // a ready revive walks toward a dead ally out of its range
  const revive = self.slots.findIndex((id, s) => ABILITIES[id].ai === 'revive' && self.cd[s] <= EPS);
  if (!displaced && !memory.solo && revive >= 0) {
    const r = ABILITIES[self.slots[revive]].range;
    let dead: CombatantView | null = null;
    for (const a of allies) if (!a.alive && a.id !== self.id && (!dead || dist(a, self) < dist(dead, self))) dead = a;
    if (dead && dist(dead, self) > r - EPS) {
      const d = dist(dead, self), keep = r - 1.5;
      moveTo = { x: dead.x + ((self.x - dead.x) / d) * keep, z: dead.z + ((self.z - dead.z) / d) * keep };
    }
  }
  // a careful brain does not walk back into a marked attack it is outside of: it waits it out
  if (moveTo && b.careful) {
    const mx = moveTo.x - self.x, mz = moveTo.z - self.z, md = Math.hypot(mx, mz) || 1;
    const sx = self.x + (mx / md) * STEP_LOOK, sz = self.z + (mz / md) * STEP_LOOK;
    for (const tg of b.telegraphs) {
      if (inShape(tg.shape, self.x, self.z)) continue;
      if (inShape(tg.shape, moveTo.x, moveTo.z) || inShape(tg.shape, sx, sz)) { moveTo = null; break; }
    }
  }
  if (displaced) return { moveTo: null, intents };

  // 3. abilities
  const interruptibleWindup = live.windup !== null && live.windup.interruptible;
  if (charging) {
    if (chargeSlot >= 0 && (held >= CHARGE_FULL_S - EPS || (interruptibleWindup && held / CHARGE_FULL_S >= CHARGE_INTERRUPT_FRAC - 1e-9))) {
      intents.push({ t: 'ability', slot: chargeSlot, phase: 'release' });
      memory.chargingSince = null;
    }
    return { moveTo, intents };
  }
  if (casting || self.gcd > EPS) return { moveTo, intents };

  const inTelegraph = b.telegraphs.some((t) => inShape(t.shape, self.x, self.z));
  const ready = (slot: number) => slot >= 0 && slot < self.slots.length && self.cd[slot] <= EPS && !(memory.solo && ABILITIES[self.slots[slot]].support);
  const castOk = (ab: AbilityData) => !(ab.cast && b.careful && inTelegraph);
  const enemyInRange = (ab: AbilityData) => reach <= ab.range;
  const action = (slot: number, ally?: number): BrainAction => {
    intents.push(ally === undefined ? { t: 'ability', slot, phase: 'press' } : { t: 'ability', slot, phase: 'press', ally });
    return { moveTo, intents };
  };

  const inCombat = self.inCombat;
  const targetsSelf = live.targetId === self.id;
  const enemyReach = (ENEMY_KINDS[live.kind as keyof typeof ENEMY_KINDS]?.auto?.reach ?? 0) + REACH_SLACK;
  const inItsReach = reach <= enemyReach;
  /** self and live allies within `r`, the lowest hp fraction first (ties: self). */
  const lowestWithin = (r: number): CombatantView => {
    let best: CombatantView = self;
    for (const a of liveAllies) if (dist(a, self) <= r && frac(a) < frac(best) - 1e-12) best = a;
    return best;
  };
  const allyArg = (v: CombatantView) => (v.id === self.id ? undefined : v.id);

  // which slots use which hint
  const slotsBy = (ai: AbilityData['ai']) => {
    const out: number[] = [];
    for (let s = 0; s < self.slots.length; s++) if (ABILITIES[self.slots[s]].ai === ai) out.push(s);
    return out;
  };
  const first = (ai: AbilityData['ai'], ok: (ab: AbilityData, slot: number) => BrainAction | null): BrainAction | null => {
    for (const s of slotsBy(ai)) {
      const ab = ABILITIES[self.slots[s]];
      if (!ready(s) || !castOk(ab)) continue;
      const r = ok(ab, s);
      if (r) return r;
    }
    return null;
  };
  /** An area effect on enemies around self (taunt, threat-drop, debuff): its radius, else null. */
  const enemyArea = (ab: AbilityData): number | null => {
    for (const e of ab.effects) if ((e.k === 'taunt' || e.k === 'debuff') && e.on === 'area') return e.r;
    for (const e of ab.effects) if (e.k === 'threat-drop') return e.r;
    return null;
  };
  const selfOrEnemyInRange = (ab: AbilityData) => {
    if (ab.aim === 'enemy') return enemyInRange(ab);
    const r = enemyArea(ab);
    return r === null || reach <= r;
  };

  const steps: (() => BrainAction | null)[] = [
    // 1. revive
    () => (memory.solo ? null : tryRevive(b, allies, { moveTo, intents })),
    // 2. allyBigHeal: the lowest (self included) below 50%
    () => first('allyBigHeal', (ab, s) => { const l = lowestWithin(ab.range); return frac(l) < 0.5 ? action(s, allyArg(l)) : null; }),
    // 3. selfHeal
    () => first('selfHeal', (_ab, s) => (frac(self) < 0.5 ? action(s) : null)),
    // 4. allyHeal: the lowest below 65%
    () => first('allyHeal', (ab, s) => { const l = lowestWithin(ab.range); return frac(l) < 0.65 ? action(s, allyArg(l)) : null; }),
    // 5. healParty: in combat, anyone within 10 m below 80%
    () => first('healParty', (_ab, s) => (inCombat && frac(lowestWithin(PARTY_R)) < 0.8 ? action(s) : null)),
    // 6. shieldSelf
    () => first('shieldSelf', (_ab, s) => (inCombat ? action(s) : null)),
    // 7. shieldAlly: the lowest below 85%
    () => first('shieldAlly', (ab, s) => { const l = lowestWithin(ab.range); return inCombat && frac(l) < 0.85 ? action(s, allyArg(l)) : null; }),
    // 8. shieldParty
    () => first('shieldParty', (_ab, s) => (inCombat ? action(s) : null)),
    // 9. aegis: the target in reach and winding up, or attacking self
    () => first('aegis', (_ab, s) => ((inItsReach && live.windup !== null) || targetsSelf ? action(s) : null)),
    // 10. interrupt: an interruptible wind-up
    () => first('interrupt', (ab, s) => (interruptibleWindup && enemyInRange(ab) ? action(s) : null)),
    // 11. tauntIfNotMe: with an ally, the target attacking someone else
    () => first('tauntIfNotMe', (ab, s) => (liveAllies.length > 0 && live.targetId !== null && !targetsSelf && selfOrEnemyInRange(ab) ? action(s) : null)),
    // 12. shelter: in combat, an ally the target is attacking
    () => first('shelter', (ab, s) => {
      const a = liveAllies.find((v) => v.id === live.targetId && dist(v, self) <= ab.range);
      return inCombat && a ? action(s, a.id) : null;
    }),
    // 13. threatDrop: the target attacking self, with an ally or below 60%
    () => first('threatDrop', (ab, s) => (targetsSelf && (liveAllies.length > 0 || frac(self) < 0.6) && selfOrEnemyInRange(ab) ? action(s) : null)),
    // 14. mist: the target attacking self, in its reach
    () => first('mist', (_ab, s) => (targetsSelf && inItsReach ? action(s) : null)),
    // 15. buffParty and selfBuff: in combat, the target engaged
    () => first('buffParty', (_ab, s) => (inCombat && live.targetId !== null ? action(s) : null)),
    () => first('selfBuff', (_ab, s) => (inCombat && live.targetId !== null ? action(s) : null)),
    // 16. momentumGift: in combat, with an ally (the nearest)
    () => first('momentumGift', (ab, s) => {
      let near: CombatantView | null = null;
      for (const a of liveAllies) if (dist(a, self) <= ab.range && (!near || dist(a, self) < dist(near, self))) near = a;
      return inCombat && near ? action(s, near.id) : null;
    }),
    // 17. debuff
    () => first('debuff', (ab, s) => (inCombat && selfOrEnemyInRange(ab) ? action(s) : null)),
    // 18. dodgeRefill
    () => first('dodgeRefill', (_ab, s) => (self.dodgeCharges < (self.dodgeMax ?? 2) ? action(s) : null)),
    // 19. the finisher (Plan 3's rules, the careful hold included)
    () => {
      if (!(self.momentum >= FINISHER_COST && ready(FINISHER) && enemyInRange(ABILITIES[self.slots[FINISHER]]) && castOk(ABILITIES[self.slots[FINISHER]]))) {
        memory.holdSince = null;
        return null;
      }
      const fin = ABILITIES[self.slots[FINISHER]];
      // nothing to detonate: lay a ready primer of another mark first (the finisher follows after the GCD)
      if (!memory.solo && (live.marks & ~MARK_BITS[fin.mark ?? 'marked']) === 0) {
        for (let s = 0; s < self.slots.length; s++) {
          const ab = ABILITIES[self.slots[s]];
          if (s !== FINISHER && ab.primer && ab.mark !== fin.mark && ab.ai !== 'never' && ready(s) && castOk(ab) && enemyInRange(ab)) return action(s);
        }
      }
      const worthHolding = b.careful && fin.interrupts === true && kitInterruptible(live.kind);
      if (!worthHolding || interruptibleWindup) { memory.holdSince = null; return action(FINISHER); }
      memory.holdSince ??= nowS;
      if (nowS - memory.holdSince >= FINISHER_HOLD_S - EPS) { memory.holdSince = null; return action(FINISHER); }
      return null;
    },
    // 20. damage: the quick skill first, then the others in slot order
    () => {
      const order = slotsBy('damage').sort((x, y) => (x === QUICK ? -1 : y === QUICK ? 1 : x - y));
      for (const s of order) {
        const ab = ABILITIES[self.slots[s]];
        if (ready(s) && castOk(ab) && enemyInRange(ab)) return action(s);
      }
      return null;
    },
    // 21. charge (Charged Shot): press when ready and nothing threatens
    () => {
      for (const s of slotsBy('charge')) {
        if (ready(s) && enemyInRange(ABILITIES[self.slots[s]]) && !inTelegraph) { memory.chargingSince = nowS; return action(s); }
      }
      return null;
    },
  ];
  for (const step of steps) {
    const r = step();
    if (r) return r;
  }
  return { moveTo, intents };
}

/** The smallest radius of an area effect that reaches other adventurers (heal over time, buff, shield) among the slots, else null. */
function areaSupportR(slots: readonly AbilityId[]): number | null {
  let r: number | null = null;
  for (const id of slots) for (const e of ABILITIES[id].effects) {
    if ((e.k === 'buff' || e.k === 'shield') && (e.on === 'area' || e.on === 'others')) r = r === null ? e.r : Math.min(r, e.r);
  }
  return r;
}

/** Second Dawn (or any `revive` slot) on the nearest dead ally in range, when ready (careful: not inside a telegraph). */
function tryRevive(b: BrainInput, allies: CombatantView[], act: BrainAction): BrainAction | null {
  const self = b.self;
  if (self.gcd > EPS) return null;
  const inTelegraph = b.careful && b.telegraphs.some((t) => inShape(t.shape, self.x, self.z));
  for (let s = 0; s < self.slots.length; s++) {
    const ab = ABILITIES[self.slots[s]];
    if (ab.ai !== 'revive' || self.cd[s] > EPS || (ab.cast && inTelegraph)) continue;
    let best: CombatantView | null = null;
    for (const a of allies) if (!a.alive && a.id !== self.id && dist(a, self) <= ab.range && (!best || dist(a, self) < dist(best, self))) best = a;
    if (best) { act.intents.push({ t: 'ability', slot: s, phase: 'press', ally: best.id }); return act; }
  }
  return null;
}

/** True if the enemy kind has an interruptible telegraph (worth holding an interrupting finisher for). */
function kitInterruptible(kind: CombatantView['kind']): boolean {
  if (kind === 'adventurer') return false;
  return ENEMY_KINDS[kind].attacks.some((id) => ENEMY_ATTACKS[id].interruptible);
}

