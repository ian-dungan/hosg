// A scripted adventurer: what a sensible player does in a fight, as intents. Shared by the tuning
// simulation (sim.ts) and the load-test bots. Pure: it reads views and its own memory only.
// It never swaps weapons (weapons swap only out of combat) and the Blade brain never parries.
import { ABILITIES, CHARGE_FULL_S, CHARGE_INTERRUPT_FRAC, WEAPONS } from './abilities';
import { ENEMY_ATTACKS, ENEMY_KINDS } from './enemies';
import type { CombatantView, Intent, SelfView, TelegraphView } from './engine';
import { FINISHER_COST } from './constants';
import { escapeDir, inShape } from './shapes';

export interface BrainInput {
  nowS: number; careful: boolean;
  self: CombatantView & SelfView;
  target: CombatantView | null;
  telegraphs: TelegraphView[];
}
export interface BrainAction { moveTo: { x: number; z: number } | null; intents: Intent[] }
/**
 * dodged: telegraph ids already dodged; chargingSince: when the brain pressed Charged Shot;
 * holdSince: when a careful brain started holding a ready finisher for an interruptible wind-up;
 * reactionS: how long a telegraph must have been up before a careful brain dodges it (0.4 s).
 */
export interface BrainMemory { dodged: Set<number>; chargingSince: number | null; holdSince: number | null; reactionS: number }
export function newBrainMemory(reactionS = REACTION_S): BrainMemory {
  return { dodged: new Set(), chargingSince: null, holdSince: null, reactionS };
}

/** Reaction time before a careful brain dodges a telegraph that contains it, in s. */
export const REACTION_S = 0.4;
/** The brain closes in while its reach is more than the weapon's range minus this, in m. */
export const RANGE_SLACK = 0.3;
/** The longest a careful brain holds a ready finisher, waiting for an interruptible wind-up, in s. */
export const FINISHER_HOLD_S = 1;
/** Where it walks to when closing in: this far inside its range, in m. */
const STAND_INSIDE = 0.6;
/** How far ahead a careful brain looks before stepping toward a marked attack, in m (about two ticks of running). */
const STEP_LOOK = 0.8;

const EPS = 1e-6;

/** Slot indices: quick, finisher, signature, then the two free picks. */
const QUICK = 0, FINISHER = 1, SIGNATURE = 2;

/**
 * One decision, every tick:
 * - dodging (careful only): a telegraph containing self, not yet dodged, up for reactionS → dodge
 *   along escapeDir (a held Charged Shot of frac ≥ 0.8 is loosed first). The dodge's `from` is the pose
 *   the brain read; a caller that has moved the body since should put its current pose there;
 * - movement: toward the target while reach > range − 0.3; not during a dodge or a knock, and (careful)
 *   not back into a telegraph it is outside of;
 * - abilities, at most one per tick, in order: Mend below 50% hp; Bulwark in combat; the finisher at
 *   Momentum ≥ 50 (a careful brain holds an interrupting finisher up to 1 s for an interruptible
 *   wind-up); the quick skill; Charged Shot (press when ready and nothing threatens, release at frac 1,
 *   or at once at frac ≥ 0.8 against an interruptible wind-up).
 */
export function adventurerBrain(b: BrainInput, memory: BrainMemory): BrainAction {
  const { self, target, nowS } = b;
  const intents: Intent[] = [];
  if (!self.alive) { memory.chargingSince = null; memory.holdSince = null; return { moveTo: null, intents }; }
  const displaced = self.act === 'dodge' || self.act === 'knock';
  if (self.charge === null) memory.chargingSince = null; // released, or cancelled by a knock
  const charging = self.charge !== null;
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
  if (!live) return { moveTo: null, intents };

  // 2. movement
  const range = WEAPONS[self.weapon].autoRange;
  const radius = ENEMY_KINDS[live.kind as keyof typeof ENEMY_KINDS]?.radius ?? 0;
  const dx = live.x - self.x, dz = live.z - self.z, dist = Math.hypot(dx, dz);
  const reach = dist - radius;
  let moveTo: { x: number; z: number } | null = null;
  if (!displaced && reach > range - RANGE_SLACK && dist > 0) {
    const standAt = Math.max(0, radius + range - STAND_INSIDE);
    moveTo = { x: live.x - (dx / dist) * standAt, z: live.z - (dz / dist) * standAt };
    // a careful brain does not walk back into a marked attack it is outside of: it waits it out
    if (b.careful) {
      const sx = self.x + (dx / dist) * STEP_LOOK, sz = self.z + (dz / dist) * STEP_LOOK;
      for (const tg of b.telegraphs) {
        if (inShape(tg.shape, self.x, self.z)) continue;
        if (inShape(tg.shape, moveTo.x, moveTo.z) || inShape(tg.shape, sx, sz)) { moveTo = null; break; }
      }
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
  if (self.gcd > EPS) return { moveTo, intents };
  const ready = (slot: number) => slot >= 0 && slot < self.slots.length && self.cd[slot] <= EPS;
  const inRange = (slot: number) => reach <= ABILITIES[self.slots[slot]].range;
  const press = (slot: number): BrainAction => { intents.push({ t: 'ability', slot, phase: 'press' }); return { moveTo, intents }; };

  const mend = self.slots.indexOf('mend');
  if (mend >= 0 && ready(mend) && self.hp < self.maxHp / 2) return press(mend);
  const bulwark = self.slots.indexOf('bulwark');
  if (bulwark >= 0 && ready(bulwark) && self.inCombat) return press(bulwark);

  if (self.momentum >= FINISHER_COST && ready(FINISHER) && inRange(FINISHER)) {
    const fin = ABILITIES[self.slots[FINISHER]];
    const worthHolding = b.careful && fin.interrupts === true && kitInterruptible(live.kind);
    if (!worthHolding || interruptibleWindup) { memory.holdSince = null; return press(FINISHER); }
    memory.holdSince ??= nowS;
    if (nowS - memory.holdSince >= FINISHER_HOLD_S - EPS) { memory.holdSince = null; return press(FINISHER); }
  } else memory.holdSince = null;

  if (ready(QUICK) && inRange(QUICK)) return press(QUICK);

  if (self.slots[SIGNATURE] === 'charged_shot' && ready(SIGNATURE) && inRange(SIGNATURE) && !b.telegraphs.some((t) => inShape(t.shape, self.x, self.z))) {
    memory.chargingSince = nowS;
    return press(SIGNATURE);
  }
  return { moveTo, intents };
}

/** True if the enemy kind has an interruptible telegraph (worth holding an interrupting finisher for). */
function kitInterruptible(kind: CombatantView['kind']): boolean {
  if (kind === 'adventurer') return false;
  return ENEMY_KINDS[kind].attacks.some((id) => ENEMY_ATTACKS[id].interruptible);
}
