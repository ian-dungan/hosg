// A scripted adventurer: what a sensible player does in a fight, as intents. Shared by the tuning
// simulation (sim.ts) and the load-test bots. Pure: it reads views and its own memory only.
// It never swaps weapons or changes job (only out of combat, in a town), and it never parries.
import { ABILITIES, CHARGE_FULL_S, CHARGE_INTERRUPT_FRAC, WEAPONS, type AbilityData, type AbilityId } from './abilities';
import { ENEMY_ATTACKS, ENEMY_KINDS, type EnemyAttackId } from './enemies';
import type { CastView, CombatantView, FieldView, Intent, SelfView, TelegraphView } from './engine';
import { DODGE_DISTANCE, FINISHER_COST, MELEE_REACH, MOMENTUM_MAX } from './constants';
import { RUN_SPEED } from '../constants';
import { JOBS, type JobId } from './jobs';
import { MARK_BITS } from './marks';
import { escapeDir, inShape } from './shapes';

/** The brain's own view: SelfView with the job fields the engine always fills made required. */
export type BrainSelf = CombatantView & SelfView & { job: JobId; dodgeMax: number; cast: CastView };
/**
 * allies: the other adventurers within ALLY_VIEW_R (dead ones included), as the caller sees them
 * (required: a caller that forgets them must not compile, rather than play solo). home: the target's
 * camp and leash, when the caller knows them (the formation step stays inside it).
 */
export interface BrainInput {
  nowS: number; careful: boolean;
  self: BrainSelf;
  target: CombatantView | null;
  allies: CombatantView[];
  telegraphs: TelegraphView[];
  home?: { x: number; z: number; leash: number };
}
/**
 * The dungeon brain's input (Plan 4): BrainInput plus what a fight in a room needs, all required, so a
 * caller in a dungeon cannot forget them and silently play as on open ground.
 * fields: the standing hazards it can see ([] where there are none); arena: the sealed arena the fight
 * is in (a disc: a boss's sealed arena, or a pack's room), or null on open ground; enemies: the live enemies it can see, the target included
 * (adds to switch to while a boss is warded, and wind-ups to interrupt).
 */
export interface DungeonBrainInput extends BrainInput {
  fields: FieldView[];
  arena: { x: number; z: number; r: number } | null;
  enemies: CombatantView[];
}
export interface BrainAction { moveTo: { x: number; z: number } | null; intents: Intent[] }
/**
 * dodged: telegraph ids already dodged; chargingSince: when the brain pressed Charged Shot;
 * holdSince: when a careful brain started holding a ready finisher for an interruptible wind-up;
 * reactionS: how long a telegraph must have been up before a careful brain dodges it (0.4 s).
 */
/**
 * slip: a "sloppy" careful brain (the synergy scenario) misses this share of the telegraphs it would
 * dodge, drawn from its own seeded state (absent = never).
 */
/** heeded: Plan 4 telegraphs seen, true when the brain answers them (a sloppy brain's slip: false). */
export interface BrainMemory {
  dodged: Set<number>; chargingSince: number | null; holdSince: number | null; reactionS: number;
  slip?: { rate: number; state: number };
  heeded: Map<number, boolean>;
  /** A ranged brain is kiting a chasing boss (to shed Searing). */
  kiting: boolean;
}
export function newBrainMemory(reactionS = REACTION_S, slip?: { rate: number; seed: number }): BrainMemory {
  const m: BrainMemory = { dodged: new Set(), chargingSince: null, holdSince: null, reactionS, heeded: new Map(), kiting: false };
  if (slip) m.slip = { rate: slip.rate, state: slip.seed >>> 0 };
  return m;
}
/** The next draw in [0, 1) of a slip's state (mulberry32). */
function slipDraw(s: { state: number }): number {
  s.state = (s.state + 0x6d2b79f5) >>> 0;
  let t = s.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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
/** healParty (Soft Rain) goes out when anyone within PARTY_R is below this hp fraction (review round 1: was 0.8). */
const HEAL_PARTY_FRAC = 0.9;
/** Soft Rain's reach (healParty looks for someone hurt within it), in m. */
const PARTY_R = 10;
/** An area supporter keeps its nearest ally within its radius minus this (and walks to its radius minus twice this), in m. */
const COHESION_SLACK = 2;
/** The formation spot stays this far inside the target's leash, in m. */
const LEASH_MARGIN = 3;
/** "In reach" of the target's attacks: its auto reach plus this, in m. */
const REACH_SLACK = 1;
// ───── the dungeon brain (Plan 4) ─────
/** A whole-arena (or otherwise inescapable) telegraph is dodged for its i-frames once this little is left, in s. */
export const IFRAME_DODGE_LEFT_S = 0.25;
/** While a boss uses an attack on each adventurer (Brass Fall), allies keep at least this far apart, in m. */
export const SPREAD_M = 4;
/** Wellspring goes to an adventurer with at least this many Searing stacks. */
export const SEARING_CLEANSE = 3;
/** A safe spot is this far beyond the edge of what it escapes, in m. */
const SAFE_MARGIN = 0.6;
/** Safe spots are looked for this far away at most, in 0.5 m steps along 16 directions, in m. */
const ESCAPE_MAX = 12;
/** Running out must leave this much of the telegraph's wind-up spare (two ticks and a little), in s. */
const RUN_SLACK_S = 0.2;
/** Stand this far inside a field's safe edge, and an arena's wall, in m. */
const FIELD_IN = 1.5;
const WALL_IN = 1;
/** A cast in progress is finished when it ends this long before the telegraph it stands in lands, in s. */
const CAST_FINISH_SLACK_S = 0.5;
/** In a boss fight a ranged adventurer keeps its nearest ally within this, in m. */
const TOGETHER_R = 10;
/** A ranged adventurer the Warden chases kites from this many Searing stacks until they are gone. */
export const KITE_SEARING = 3;
/** A melee adventurer the Warden chases (with an ally to keep hitting it) steps out of reach from this many. */
export const KITE_SEARING_MELEE = 4;
/** A ranged adventurer keeps this far beyond a chasing boss's reach (and kites to twice this), in m. */
const KITE_SLACK = 2.5;
/** A cast may start inside a Plan 4 telegraph when it ends at least this long before the telegraph lands, in s. */
const CAST_SPARE_S = 0.4;
/** Plan 3's attacks keep Plan 3b's dodge rules exactly; every other attack gets the dungeon brain's. */
const PLAN3_ATTACKS: ReadonlySet<EnemyAttackId> = new Set<EnemyAttackId>(['thorn_burst', 'gore_charge', 'briar_volley', 'ground_slam', 'thorn_hail']);
const isPlan4 = (tg: TelegraphView) => !PLAN3_ATTACKS.has(tg.attack);

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
 * memory.slip (a sloppy brain) misses a seeded share of the telegraphs it would dodge.
 */
export function adventurerBrain(b: BrainInput, memory: BrainMemory): BrainAction {
  return dungeonBrain({ ...b, fields: [], arena: null, enemies: b.target ? [b.target] : [] }, memory);
}

/**
 * The dungeon brain: Plan 3b's brain (adventurerBrain is this on open ground: no fields, no arena,
 * only the target known) with, for careful brains (sloppy ones included) unless stated:
 * - Plan 4 telegraphs: after reactionS, run to the nearest safe spot (outside every telegraph and field,
 *   inside the arena) when it can be reached in time; else dodge out when one dodge reaches it; else (a
 *   whole-arena hit) dodge for the i-frames IFRAME_DODGE_LEFT_S before it lands. A sloppy brain ignores
 *   a seeded share of them (one draw per telegraph). Rings are escaped toward the nearer edge (inward);
 * - fields: never walks into one; standing in one, walks out (toward the arena centre) first;
 * - spread: while a boss's phase uses an attack on each adventurer, keeps SPREAD_M from every ally;
 * - adds first: a warded boss's add (ranged: the nearest; melee: the one nearest the boss);
 * - interrupts: also another enemy's interruptible Plan 4 wind-up (Keeper's Toll while on a shard, a
 *   shard's Focus Beam), retargeting for it; a cast may start inside a Plan 4 telegraph that lands later;
 * - Wellspring (a cleanse) on an adventurer with SEARING_CLEANSE or more Searing stacks.
 * A careless brain never dodges and stands in fields, as on open ground.
 */
export function dungeonBrain(b: DungeonBrainInput, memory: BrainMemory): BrainAction {
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
  if (memory.heeded.size > 0) {
    for (const id of memory.heeded.keys()) if (!b.telegraphs.some((t) => t.id === id)) memory.heeded.delete(id);
  }

  // the target (careful: a warded boss's add first)
  let live = target && target.alive && target.team === 'enemy' ? target : null;
  if (live && b.careful && live.warded === true) live = wardAdd(b, live) ?? live;
  if (live && self.targetId !== live.id) intents.push({ t: 'target', id: live.id });

  // 1. dodging
  if (b.careful && !displaced) {
    for (const tg of b.telegraphs) {
      if (isPlan4(tg) || memory.dodged.has(tg.id) || !inShape(tg.shape, self.x, self.z)) continue;
      if (tg.total - tg.left < memory.reactionS - EPS) continue;
      memory.dodged.add(tg.id);
      if (self.dodgeCharges <= 0) continue; // nothing to dodge with: take it
      if (memory.slip && slipDraw(memory.slip) < memory.slip.rate) continue; // sloppy: missed it
      if (charging && chargeSlot >= 0 && held / CHARGE_FULL_S >= CHARGE_INTERRUPT_FRAC - 1e-9) intents.push({ t: 'ability', slot: chargeSlot, phase: 'release' });
      const d = escapeDir(tg.shape, self.x, self.z);
      intents.push({ t: 'dodge', dx: d.x, dz: d.z, from: { x: self.x, z: self.z, y: self.y }, grounded: true });
      memory.chargingSince = null;
      return { moveTo: null, intents };
    }
  }
  // 1b. Plan 4 telegraphs: run out in time, else dodge out, else dodge for the i-frames
  let escape: { x: number; z: number } | null = null;
  if (b.careful && !displaced) {
    let first: TelegraphView | null = null;
    for (const tg of b.telegraphs) {
      if (!isPlan4(tg) || memory.dodged.has(tg.id) || !inShape(tg.shape, self.x, self.z)) continue;
      if (tg.total - tg.left < memory.reactionS - EPS) continue;
      let heed = memory.heeded.get(tg.id);
      if (heed === undefined) { heed = !(memory.slip && slipDraw(memory.slip) < memory.slip.rate); memory.heeded.set(tg.id, heed); }
      if (heed && (!first || tg.left < first.left)) first = tg;
    }
    // a cast that completes before the telegraph lands is finished first (a revive, a heal): it escapes after
    if (first && casting && self.cast && self.cast.left + CAST_FINISH_SLACK_S < first.left) first = null;
    if (first) {
      const spot = safeSpot(b, self, target && target.alive ? target : null);
      const speed = RUN_SPEED * (charging ? 0.4 : casting ? 0.5 : 1);
      const dodgeIt = (d: { x: number; z: number }): BrainAction => {
        memory.dodged.add(first!.id);
        if (charging && chargeSlot >= 0 && held / CHARGE_FULL_S >= CHARGE_INTERRUPT_FRAC - 1e-9) intents.push({ t: 'ability', slot: chargeSlot, phase: 'release' });
        intents.push({ t: 'dodge', dx: d.x, dz: d.z, from: { x: self.x, z: self.z, y: self.y }, grounded: true });
        memory.chargingSince = null;
        return { moveTo: null, intents };
      };
      if (spot && spot.d / speed + RUN_SLACK_S <= first.left) escape = spot;
      else if (spot && spot.d <= DODGE_DISTANCE - 0.1 && self.dodgeCharges > 0) {
        return dodgeIt({ x: (spot.x - self.x) / spot.d, z: (spot.z - self.z) / spot.d });
      } else if (self.dodgeCharges > 0 && first.left <= IFRAME_DODGE_LEFT_S + EPS) {
        return dodgeIt(iframeDir(b, spot, target && target.alive ? target : null));
      } else escape = spot; // as far out as it gets (it waits to dodge for the i-frames, or takes it)
    }
  }

  const allies = b.allies;
  const liveAllies = allies.filter((a) => a.alive && a.id !== self.id);
  // a revive needs no target: a dead partner comes first even once the fight is over
  if (!live) {
    if (!displaced && !charging && !casting && self.gcd <= EPS) {
      const act = tryRevive(b, allies, { moveTo: null, intents }, castRule(b, escape !== null));
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
  const flanking = JOBS[self.job].brain.flank && live.targetId !== null && live.targetId !== self.id
    && liveAllies.some((a) => a.id === live.targetId);
  if (!displaced && flanking) {
    const back = Math.max(0, radius + range - STAND_INSIDE);
    const spot = { x: live.x - Math.sin(live.facing) * back, z: live.z - Math.cos(live.facing) * back };
    if (dist(spot, self) > FLANK_SLACK) moveTo = spot;
  } else if (!displaced && reach > range - RANGE_SLACK && dist0 > 0) {
    const standAt = Math.max(0, radius + range - STAND_INSIDE);
    moveTo = { x: live.x - (dx / dist0) * standAt, z: live.z - (dz / dist0) * standAt };
  }
  // near the edge of its leash: fight from the camp side, so the enemy is drawn back rather than out to a reset
  if (!displaced && b.home && dist(live, b.home) > b.home.leash - 2 * LEASH_MARGIN) {
    const hd = dist(live, b.home), standAt = Math.max(0, radius + range - STAND_INSIDE);
    moveTo = { x: live.x + ((b.home.x - live.x) / hd) * Math.min(standAt, hd), z: live.z + ((b.home.z - live.z) / hd) * Math.min(standAt, hd) };
  }
  // a job with an area support (Soft Rain, Roar, Dawn Ward, Aegis) keeps the nearest live ally inside it, while in range of the target
  const area = areaSupportR(self.slots);
  // (the spot is on the camp side of the ally when the camp is known, and never past the leash, so the
  // formation does not drag the fight out until the enemy resets)
  if (!displaced && area !== null && liveAllies.length > 0) {
    let near = liveAllies[0];
    for (const a of liveAllies) if (dist(a, self) < dist(near, self)) near = a;
    const d = dist(near, self);
    if (d > area - COHESION_SLACK && d > 0) {
      const keep = area - 2 * COHESION_SLACK;
      const from = b.home ?? self, fd = dist(from, near);
      const p = fd > EPS
        ? { x: near.x + ((from.x - near.x) / fd) * Math.min(keep, fd), z: near.z + ((from.z - near.z) / fd) * Math.min(keep, fd) }
        : { x: near.x, z: near.z };
      const inRange = Math.hypot(live.x - p.x, live.z - p.z) - radius <= range - RANGE_SLACK;
      const inLeash = !b.home || dist(p, b.home) <= b.home.leash - LEASH_MARGIN;
      if (inRange && inLeash) moveTo = p;
    }
  }
  // a ready revive walks toward a dead ally out of its range
  const revive = self.slots.findIndex((id, s) => ABILITIES[id].ai === 'revive' && self.cd[s] <= EPS);
  if (!displaced && revive >= 0) {
    const r = ABILITIES[self.slots[revive]].range;
    let dead: CombatantView | null = null;
    for (const a of allies) if (!a.alive && a.id !== self.id && (!dead || dist(a, self) < dist(dead, self))) dead = a;
    if (dead && dist(dead, self) > r - EPS) {
      const d = dist(dead, self), keep = r - 1.5;
      moveTo = { x: dead.x + ((self.x - dead.x) / d) * keep, z: dead.z + ((self.z - dead.z) / d) * keep };
    }
  }
  // the dungeon rules (careful): spread, never into a field or out of the arena, out of a field first, out of a telegraph above all
  let forced = false;
  // any brain: outside the fight's arena (still in the doorway: nothing reaches across its edge) or
  // pressed against its wall (where an enemy cannot reach it and goes home), step in first
  if (!displaced && b.arena && !inArenaWall(b, self.x, self.z, WALL_IN + 0.5)) {
    const ax = b.arena.x - self.x, az = b.arena.z - self.z, ad = Math.hypot(ax, az), step = ad - (b.arena.r - 2 * WALL_IN);
    moveTo = { x: self.x + (ax / ad) * step, z: self.z + (az / ad) * step };
  }
  if (b.careful && !displaced) {
    // a ranged adventurer in a boss fight stays within TOGETHER_R of its nearest supporting ally (a
    // healer, tank or hybrid job: inside its Shelter, Bloodbond, Kindle, heals and revive), while still in range of the boss
    let near: CombatantView | null = null;
    if ((live.tier === 'boss' || live.tier === 'mega') && range > MELEE_REACH) {
      for (const a of liveAllies) if (a.job !== undefined && JOBS[a.job].role !== 'damage' && (!near || dist(a, self) < dist(near, self))) near = a;
    }
    if (near) {
      const d = dist(near, self);
      if (d > TOGETHER_R) {
        const p = { x: near.x + ((self.x - near.x) / d) * (TOGETHER_R - 2), z: near.z + ((self.z - near.z) / d) * (TOGETHER_R - 2) };
        if (Math.hypot(live.x - p.x, live.z - p.z) - radius <= range - RANGE_SLACK) moveTo = p;
      }
    }
    // a ranged adventurer a melee boss is chasing keeps out of its reach (Searing falls off; the boss never surges)
    // (ranged: to shed Searing from KITE_SEARING stacks until they are gone, and from a boss without Searing
    // while it chases; melee, with a live ally to keep hitting it: from KITE_SEARING_MELEE stacks)
    const ranged = range > MELEE_REACH;
    const chaser = b.enemies.find((e) => e.alive && e.targetId === self.id && (e.tier === 'boss' || e.tier === 'mega'));
    const searing = self.searing ?? 0;
    const afflicts = chaser !== undefined && ENEMY_KINDS[chaser.kind as keyof typeof ENEMY_KINDS]?.auto?.afflict !== undefined;
    // (a ranged adventurer with no healer, tank or hybrid beside it has nobody to take the hits: from the first stack)
    const covered = liveAllies.some((a) => a.job !== undefined && JOBS[a.job].role !== 'damage');
    const from = ranged ? (covered ? KITE_SEARING : 1) : KITE_SEARING_MELEE;
    memory.kiting = chaser !== undefined && (ranged || (afflicts && liveAllies.length > 0))
      && ((ranged && !afflicts) || searing >= from || (memory.kiting && searing > 0));
    if (chaser && memory.kiting) {
      const k = ENEMY_KINDS[chaser.kind as keyof typeof ENEMY_KINDS];
      if (k?.auto && !k.auto.ranged) {
        const out = k.radius + k.auto.reach + KITE_SLACK;
        if (dist(chaser, self) < out) moveTo = kiteSpot(b, chaser, out + KITE_SLACK) ?? moveTo;
      }
    }
    if (spreadNeeded(b)) moveTo = spreadFrom(b, moveTo, live, liveAllies);
    if (moveTo) moveTo = keepSafe(b, moveTo);
    if (b.fields.some((f) => inShape(f.shape, self.x, self.z))) { const out = fieldExit(b); if (out) { moveTo = out; forced = true; } }
    if (escape) { moveTo = escape; forced = true; }
  }
  // a careful brain does not walk back into a marked attack it is outside of: it waits it out
  if (moveTo && b.careful && !forced) {
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
  const ready = (slot: number) => slot >= 0 && slot < self.slots.length && self.cd[slot] <= EPS;
  const castOk = castRule(b, escape !== null);
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
  /** Careful: another live enemy winding up an interruptible Plan 4 attack (the target's own is `interruptibleWindup`). */
  const caster = b.careful
    ? b.enemies.find((e) => e.alive && e.id !== live.id && e.windup !== null && e.windup.interruptible && !PLAN3_ATTACKS.has(e.windup.attack)) ?? null
    : null;
  const reachOf = (e: CombatantView) => dist(e, self) - (ENEMY_KINDS[e.kind as keyof typeof ENEMY_KINDS]?.radius ?? 0);
  const retarget = (e: CombatantView, slot: number): BrainAction => {
    intents.push({ t: 'target', id: e.id });
    return action(slot);
  };

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
    () => tryRevive(b, allies, { moveTo, intents }, castOk),
    // 2. allyBigHeal: the lowest (self included) below 50%
    () => first('allyBigHeal', (ab, s) => { const l = lowestWithin(ab.range); return frac(l) < 0.5 ? action(s, allyArg(l)) : null; }),
    // 3. selfHeal
    () => first('selfHeal', (_ab, s) => (frac(self) < 0.5 ? action(s) : null)),
    // 4. allyHeal: the lowest below 65%
    () => first('allyHeal', (ab, s) => { const l = lowestWithin(ab.range); return frac(l) < 0.65 ? action(s, allyArg(l)) : null; }),
    // 4b. cleanse (Wellspring): the most Searing stacks within range, at SEARING_CLEANSE or more
    () => first('allyBigHeal', (ab, s) => {
      if (!ab.effects.some((e) => e.k === 'cleanse')) return null;
      let best: CombatantView | null = null;
      for (const v of [self as CombatantView, ...liveAllies]) {
        const n = v.searing ?? 0;
        if (n >= SEARING_CLEANSE && dist(v, self) <= ab.range && (!best || n > (best.searing ?? 0))) best = v;
      }
      return best ? action(s, allyArg(best)) : null;
    }),
    // 5. healParty: in combat, anyone within 10 m below HEAL_PARTY_FRAC (a heal over time goes out early)
    () => first('healParty', (_ab, s) => (inCombat && frac(lowestWithin(PARTY_R)) < HEAL_PARTY_FRAC ? action(s) : null)),
    // 6. shieldSelf
    () => first('shieldSelf', (_ab, s) => (inCombat ? action(s) : null)),
    // 7. shieldAlly: the lowest below 85%
    () => first('shieldAlly', (ab, s) => { const l = lowestWithin(ab.range); return inCombat && frac(l) < 0.85 ? action(s, allyArg(l)) : null; }),
    // 8. shieldParty
    () => first('shieldParty', (_ab, s) => (inCombat ? action(s) : null)),
    // 9. aegis: the target in reach and winding up, or attacking self
    () => first('aegis', (_ab, s) => ((inItsReach && live.windup !== null) || targetsSelf ? action(s) : null)),
    // 10. interrupt: an interruptible wind-up
    () => first('interrupt', (ab, s) => (interruptibleWindup && enemyInRange(ab) ? action(s)
      : caster && reachOf(caster) <= ab.range ? retarget(caster, s) : null)),
    // 11. tauntIfNotMe: with an ally, the target attacking someone else
    () => first('tauntIfNotMe', (ab, s) => (liveAllies.length > 0 && live.targetId !== null && !targetsSelf && selfOrEnemyInRange(ab) ? action(s) : null)),
    // 12. shelter: in combat, an ally the target is attacking, while self is the healthier one and above half
    //     (taking half of a partner's hits when low only trades one death for another)
    () => first('shelter', (ab, s) => {
      const a = liveAllies.find((v) => v.id === live.targetId && dist(v, self) <= ab.range);
      return inCombat && a && frac(self) >= Math.max(0.5, frac(a)) ? action(s, a.id) : null;
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
    () => first('dodgeRefill', (_ab, s) => (self.dodgeCharges < self.dodgeMax ? action(s) : null)),
    // 18b. an interrupting finisher on another enemy's interruptible Plan 4 wind-up in its range (Keeper's Toll while on a shard)
    () => {
      const fin = ABILITIES[self.slots[FINISHER]];
      if (!caster || interruptibleWindup || fin.interrupts !== true || self.momentum < FINISHER_COST || !ready(FINISHER) || !castOk(fin) || reachOf(caster) > fin.range) return null;
      memory.holdSince = null;
      return retarget(caster, FINISHER);
    },
    // 19. the finisher (Plan 3's rules, the careful hold included)
    () => {
      if (!(self.momentum >= FINISHER_COST && ready(FINISHER) && enemyInRange(ABILITIES[self.slots[FINISHER]]) && castOk(ABILITIES[self.slots[FINISHER]]))) {
        memory.holdSince = null;
        return null;
      }
      const fin = ABILITIES[self.slots[FINISHER]];
      // nothing to detonate: lay a ready primer of another mark first (the finisher follows after the GCD)
      if ((live.marks & ~MARK_BITS[fin.mark ?? 'marked']) === 0) {
        for (let s = 0; s < self.slots.length; s++) {
          const ab = ABILITIES[self.slots[s]];
          // not when its Momentum would spill past the cap
          if (self.momentum + (ab.momentum ?? 0) > MOMENTUM_MAX) continue;
          if (s !== FINISHER && ab.primer && ab.mark !== fin.mark && ab.ai !== 'never' && ready(s) && castOk(ab) && enemyInRange(ab)) return action(s);
        }
      }
      const worthHolding = b.careful && fin.interrupts === true
        && (kitInterruptible(live.kind) || b.enemies.some((e) => e.alive && e.id !== live.id && (e.tier === 'boss' || e.tier === 'mega') && kitInterruptible(e.kind)));
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
        // (careful: inside Plan 4 telegraphs only to interrupt, when an interrupting draw ends before they land)
        const drawFits = b.careful && interruptibleWindup && escape === null && live.windup!.left > CHARGE_FULL_S * CHARGE_INTERRUPT_FRAC + CAST_SPARE_S
          && castRule(b, false)({ ...ABILITIES[self.slots[s]], cast: CHARGE_FULL_S * CHARGE_INTERRUPT_FRAC });
        if (ready(s) && enemyInRange(ABILITIES[self.slots[s]]) && (!inTelegraph || drawFits)) { memory.chargingSince = nowS; return action(s); }
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
function tryRevive(b: BrainInput, allies: CombatantView[], act: BrainAction, castOk: (ab: AbilityData) => boolean): BrainAction | null {
  const self = b.self;
  if (self.gcd > EPS) return null;
  for (let s = 0; s < self.slots.length; s++) {
    const ab = ABILITIES[self.slots[s]];
    if (ab.ai !== 'revive' || self.cd[s] > EPS || !castOk(ab)) continue;
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


// ───────── the dungeon brain's geometry ─────────
/**
 * Whether a cast may start (careful): not inside a Plan 3 telegraph (Plan 3b's rule); inside Plan 4 ones
 * only when the cast ends CAST_SPARE_S before the soonest of them lands; never while running out of one.
 */
function castRule(b: DungeonBrainInput, escaping: boolean): (ab: AbilityData) => boolean {
  const self = b.self;
  let plan3In = false, p4Left = Infinity;
  for (const t of b.telegraphs) {
    if (!inShape(t.shape, self.x, self.z)) continue;
    if (isPlan4(t)) p4Left = Math.min(p4Left, t.left);
    else plan3In = true;
  }
  return (ab) => !(ab.cast && b.careful && (plan3In || escaping || ab.cast + CAST_SPARE_S > p4Left));
}

const inArenaWall = (b: DungeonBrainInput, x: number, z: number, margin: number) =>
  b.arena === null || Math.hypot(x - b.arena.x, z - b.arena.z) <= b.arena.r - margin;
const inField = (b: DungeonBrainInput, x: number, z: number) => b.fields.some((f) => inShape(f.shape, x, z));
/** Outside every telegraph and field, inside the arena. */
function safeAt(b: DungeonBrainInput, x: number, z: number): boolean {
  return inArenaWall(b, x, z, WALL_IN) && !inField(b, x, z) && !b.telegraphs.some((t) => inShape(t.shape, x, z));
}

/**
 * The nearest safe spot from self (SAFE_MARGIN past the first safe point along 16 directions, 0.5 m
 * steps up to ESCAPE_MAX, stopping at the arena wall), near the target on ties; d: how far. null if none.
 */
function safeSpot(b: DungeonBrainInput, from: { x: number; z: number }, prefer: { x: number; z: number } | null): { x: number; z: number; d: number } | null {
  let best: { x: number; z: number; d: number } | null = null, bestScore = Infinity;
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI) / 8, ux = Math.sin(a), uz = Math.cos(a);
    for (let s = 0.5; s <= ESCAPE_MAX + EPS; s += 0.5) {
      const x = from.x + ux * s, z = from.z + uz * s;
      if (!inArenaWall(b, x, z, WALL_IN)) break;
      if (!safeAt(b, x, z)) continue;
      const m = s + SAFE_MARGIN, mx = from.x + ux * m, mz = from.z + uz * m;
      const p = safeAt(b, mx, mz) ? { x: mx, z: mz, d: m } : { x, z, d: s };
      const score = p.d + (prefer ? 0.1 * Math.hypot(p.x - prefer.x, p.z - prefer.z) : 0);
      if (score < bestScore) { best = p; bestScore = score; }
      break;
    }
  }
  return best;
}

/** An i-frame dodge's direction: toward the safe spot, else the target, else the arena's centre, landing outside fields and inside the arena. */
function iframeDir(b: DungeonBrainInput, spot: { x: number; z: number } | null, target: { x: number; z: number } | null): { x: number; z: number } {
  const self = b.self;
  const tries: { x: number; z: number }[] = [];
  const toward = (p: { x: number; z: number } | null) => {
    if (!p) return;
    const dx = p.x - self.x, dz = p.z - self.z, d = Math.hypot(dx, dz);
    if (d > EPS) tries.push({ x: dx / d, z: dz / d });
  };
  toward(spot); toward(target); toward(b.arena);
  for (let k = 0; k < 8; k++) tries.push({ x: Math.sin((k * Math.PI) / 4), z: Math.cos((k * Math.PI) / 4) });
  for (const u of tries) {
    const x = self.x + u.x * DODGE_DISTANCE, z = self.z + u.z * DODGE_DISTANCE;
    if (inArenaWall(b, x, z, WALL_IN) && !inField(b, x, z)) return u;
  }
  return tries[0];
}

/** A point never inside a field (a ring: moved to its nearer safe side) nor past the arena wall; null if it cannot be helped. */
function keepSafe(b: DungeonBrainInput, p: { x: number; z: number }): { x: number; z: number } | null {
  let q = p;
  if (b.arena) {
    const dx = q.x - b.arena.x, dz = q.z - b.arena.z, d = Math.hypot(dx, dz), lim = b.arena.r - WALL_IN;
    if (d > lim) q = { x: b.arena.x + (dx / d) * lim, z: b.arena.z + (dz / d) * lim };
  }
  for (const f of b.fields) {
    if (!inShape(f.shape, q.x, q.z)) continue;
    const s = f.shape;
    if (s.kind !== 'ring') return null;
    const dx = q.x - s.x, dz = q.z - s.z, d = Math.hypot(dx, dz) || 1;
    const to = d - s.inner < s.r - d ? Math.max(0, s.inner - FIELD_IN) : s.r + FIELD_IN;
    q = { x: s.x + (dx / d) * to, z: s.z + (dz / d) * to };
  }
  return q;
}

/** Out of the field self stands in: a ring's safe side (toward its centre when nearer), else the nearest safe spot. */
function fieldExit(b: DungeonBrainInput): { x: number; z: number } | null {
  const self = b.self;
  const out = keepSafe(b, { x: self.x, z: self.z });
  if (out && !inField(b, out.x, out.z)) return out;
  return safeSpot(b, self, null);
}

/** A boss's current phase (or a live telegraph) uses an attack on each adventurer. */
function spreadNeeded(b: DungeonBrainInput): boolean {
  if (b.telegraphs.some((t) => ENEMY_ATTACKS[t.attack].targets === 'each')) return true;
  for (const e of b.enemies) {
    if (!e.alive || e.kind === 'adventurer') continue;
    const phase = ENEMY_KINDS[e.kind].boss?.phases[e.phase ?? 0];
    if (phase && phase.rotation.some((id) => ENEMY_ATTACKS[id].targets === 'each')) return true;
  }
  return false;
}

/** Where to stand SPREAD_M from every live ally: the planned spot (or self) turned around the target in 15° steps, when it is too close. */
function spreadFrom(b: DungeonBrainInput, moveTo: { x: number; z: number } | null, live: CombatantView | null, allies: CombatantView[]): { x: number; z: number } | null {
  const self = b.self;
  const p = moveTo ?? { x: self.x, z: self.z };
  const close = (q: { x: number; z: number }) => allies.some((a) => dist(a, q) < SPREAD_M);
  if (!close(p)) return moveTo;
  const c = live ?? self;
  const rr = Math.max(1, dist(p, c));
  const base = Math.atan2(p.x - c.x, p.z - c.z);
  for (let k = 1; k <= 11; k++) for (const sg of [1, -1]) {
    const a = base + (sg * k * Math.PI) / 12;
    const q = { x: c.x + Math.sin(a) * rr, z: c.z + Math.cos(a) * rr };
    if (!close(q) && safeAt(b, q.x, q.z)) return q;
  }
  return moveTo;
}

/** A warded boss's add to switch to: ranged, the nearest to self; melee, the one nearest the boss. */
function wardAdd(b: DungeonBrainInput, boss: CombatantView): CombatantView | null {
  const ranged = WEAPONS[b.self.weapon].autoRange > MELEE_REACH;
  const from = ranged ? b.self : boss;
  let best: CombatantView | null = null;
  for (const e of b.enemies) {
    if (!e.alive || e.id === boss.id || e.team !== 'enemy' || e.tier === 'boss' || e.tier === 'mega') continue;
    if (!best || dist(e, from) < dist(best, from)) best = e;
  }
  return best;
}

/** Where a chased ranged adventurer goes: `r` from the boss, the safe point of 16 around it nearest to self (away from the boss on ties). */
function kiteSpot(b: DungeonBrainInput, boss: CombatantView, r: number): { x: number; z: number } | null {
  const self = b.self;
  let best: { x: number; z: number } | null = null, bestD = Infinity;
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI) / 8;
    const p = { x: boss.x + Math.sin(a) * r, z: boss.z + Math.cos(a) * r };
    if (!safeAt(b, p.x, p.z)) continue;
    const d = dist(p, self);
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}
