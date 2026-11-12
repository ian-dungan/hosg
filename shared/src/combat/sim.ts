// The seeded fight simulation: scripted adventurers (brain.ts) against one camp (or a camp and its
// adds) on a flat field, run through the real engine at TICK_HZ. It is how the time-to-kill, survival
// and teamwork bands are checked.
import { makeBody, stepBody, type Body } from '../body';
import { RUN_SPEED, TICK_HZ } from '../constants';
import { ABILITIES, PLAN3_DEFAULT_LOADOUT, type AbilityId, type Loadout, type Plan3Loadout } from './abilities';
import { adventurerBrain, ALLY_VIEW_R, dungeonBrain, newBrainMemory, REACTION_S, type BrainInput, type BrainMemory, type DungeonBrainInput } from './brain';
import { REACTIONS, type ReactionId } from './elements';
import { ENEMY_KINDS, type EnemyAttackId, type EnemyKindId } from './enemies';
import { ENCOUNTERS, type EncounterId } from './encounters';
import { createCombat, worldOf, type CampSpawn, type Combat, type CombatantView, type CombatZone, type TickOut } from './engine';
import type { FxEvent } from './fx';
import { JOBS, type JobId } from './jobs';
import type { MarkId } from './marks';
import type { Stats } from './stats';
import { SEAL_DELAY_S } from '../instance';

export interface FightResult { firstHitAt: number | null; killedAt: number | null; ttk: number | null; died: boolean; hpLeft: number; dodges: number }
/**
 * A job and its picks (default: the solo picks for a party of 1, else the duo picks). sloppy: a careful
 * brain that misses a seeded SLOPPY_MISS of the telegraphs it would dodge. Deprecated until Task 9:
 * `{ weapon }` runs a Plan 3 loadout (Blade or Bow with Plan 3's default free picks), exactly as Plan 3's
 * simulation did.
 */
export type PartyMember =
  | { job: JobId; careful: boolean; picks?: [AbilityId, AbilityId]; sloppy?: boolean; weapon?: undefined }
  | { weapon: Plan3Loadout['weapon']; careful: boolean; job?: undefined; picks?: undefined; sloppy?: undefined };
/**
 * died: died at least once; deaths: how often; revived: how often it was brought back; hpLeft: at the
 * end (0 if dead then); hpLost: hp taken from enemy hits (after shields). damage: dealt to enemies.
 * healedOthers / shieldedOthers: hp healed and shield given to other adventurers (any source).
 * assists: effects of its `support` abilities that took effect (see simulateParty). casts: casts
 * started; castBreaks: casts broken by an interrupt or its own dodge.
 */
export interface MemberResult {
  died: boolean; deaths: number; revived: number; hpLeft: number; hpLost: number; dodges: number; damage: number;
  healedOthers: number; shieldedOthers: number; assists: number; casts: number; castBreaks: number;
}
export interface PartyResult {
  /** killedAt: when the last enemy of the fight died (all of them killed: a win). */
  firstHitAt: number | null; killedAt: number | null; ttk: number | null;
  /** Per member, in the order given. */
  members: MemberResult[];
  /** Hits that detonated marks (Plan 3: finisher hits with a combo). */
  combos: number;
  /** Detonations and reactions of a mark another member applied. */
  crossCombos: number;
  reactions: Record<ReactionId, number>;
  /** Seconds the main enemy spent in its chase surge. */
  surgeS: number;
}

/** The share of telegraphs a sloppy brain misses. */
export const SLOPPY_MISS = 0.3;
/** The share of telegraphs a skilled brain misses (ruling P4-h). */
export const SKILLED_MISS = 0.1;
/** Half-width of the flat field, in m (80 × 80). */
const FIELD = 40;
/** Where adds stand, beside the main camp at (0, 0) (the party comes from −z). */
const ADD_SPOTS: readonly [number, number][] = [[5, 2], [-5, 2], [0, 6]];
const flatZone = (camps: CampSpawn[]): CombatZone => {
  const s = (x: number, z: number) => (Math.abs(x) <= FIELD && Math.abs(z) <= FIELD ? 0 : null);
  return { surface: s, ground: s, sight: () => true, camps, jobSwitch: () => false };
};

function rngOf(seed: number): () => number {
  let a = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The brain's view of adventurer `id` against `targetId` at nowS (null if the adventurer is not there):
 * allies within ALLY_VIEW_R, dead ones included; `home` passed through.
 */
export function brainInputFor(c: Combat, id: number, targetId: number | null, nowS: number, careful: boolean, home?: BrainInput['home']): BrainInput | null {
  const v = c.get(id), s = c.self(id);
  if (!v || !s || s.job === undefined || s.dodgeMax === undefined) return null;
  const target = targetId === null ? null : c.get(targetId) ?? null;
  const allies = [...c.all()].filter((o) => o.team === 'adventurer' && o.id !== id && Math.hypot(o.x - v.x, o.z - v.z) <= ALLY_VIEW_R);
  const input: BrainInput = { nowS, careful, self: { ...v, ...s, job: s.job, dodgeMax: s.dodgeMax, cast: s.cast ?? null }, target, allies, telegraphs: [...c.telegraphs()] };
  if (home) input.home = home;
  return input;
}

const REACTION_MARK: Record<ReactionId, MarkId> = {
  blast: REACTIONS.fire.mark, conduct: REACTIONS.lightning.mark, steam: REACTIONS.water.mark, bedrock: REACTIONS.earth.mark,
};
const TAUNTS = (id: AbilityId) => ABILITIES[id].effects.some((e) => e.k === 'taunt' || e.k === 'threat-drop');

/**
 * Scripted adventurers against one camp of `enemy` at (0, 0), plus `adds` beside it, on a flat 80 × 80 m
 * field (jobs never change there). Each starts 12 m away; the seed varies the approach angle (within
 * ±45° of (0, −12), the members 3 m apart, side by side), a careful brain's reaction (0.4–0.6 s) and
 * when each starts (0–0.5 s). Every 1/TICK_HZ s, for each live member (in job mode who goes first
 * alternates each tick; a Plan 3 party keeps its order): the brain on its target (the live enemy with
 * the least hp; the main camp's home and leash for the formation), the move toward moveTo with stepBody
 * at RUN_SPEED × speedScale (none while dodging or knocked), setPose, intents; then the tick;
 * displacements are applied to the body. A dead member's brain does nothing, and a revived one carries
 * on. It ends when every enemy has been killed once, when every member is dead (the dead cast nothing,
 * so no revive is coming), or at maxS (default 180 s).
 *
 * assists count each effect of a member's `support` ability that took effect: a heal, shield or buff
 * on another adventurer; Momentum given; a revive; the taunt or threat-drop itself; a debuff on an
 * enemy; an interrupt; its primer mark. Soft Rain's heals on others count, and so do Bloodbond's shared
 * heals (riding on the Dark Knight's damage abilities). An effect is attributed to the ability whose
 * `use` it follows: within the fx of that intent, or of that cast's completion.
 */
export function simulateParty(o: { seed: number; party: PartyMember[]; enemy: EnemyKindId; adds?: EnemyKindId[]; maxS?: number }): PartyResult {
  const maxS = o.maxS ?? 180;
  const rng = rngOf(o.seed);
  const camps: CampSpawn[] = [{ kind: o.enemy, x: 0, z: 0, facing: Math.PI }];
  (o.adds ?? []).forEach((kind, i) => { const [x, z] = ADD_SPOTS[i % ADD_SPOTS.length]; camps.push({ kind, x, z, facing: Math.PI }); });
  const zone = flatZone(camps);
  const c = createCombat(zone, { seed: o.seed, nowS: 0 });
  const w = worldOf(c);
  const enemyIds = [...c.all()].filter((v) => v.team === 'enemy').map((v) => v.id);
  const enemyId = enemyIds[0];
  const isEnemy = (id: number) => enemyIds.includes(id);
  const home = { x: 0, z: 0, leash: ENEMY_KINDS[o.enemy].leash };
  const angle = (rng() - 0.5) * (Math.PI / 2);
  const n = o.party.length;
  const members = o.party.map((m, i) => {
    const side = (i - (n - 1) / 2) * 3; // 3 m apart, across the approach
    const x = Math.sin(angle) * -12 + Math.cos(angle) * side, z = Math.cos(angle) * -12 - Math.sin(angle) * side;
    const loadout: Plan3Loadout | Loadout = m.weapon !== undefined
      ? { weapon: m.weapon, free: [PLAN3_DEFAULT_LOADOUT.free[0], PLAN3_DEFAULT_LOADOUT.free[1]] }
      : { job: m.job, picks: m.picks ? [m.picks[0], m.picks[1]] : [...(n === 1 ? JOBS[m.job].picks.solo : JOBS[m.job].picks.duo)] as [AbilityId, AbilityId] };
    const id = c.addAdventurer({ x, z, y: 0, facing: angle, hp: 100, loadout }, 0);
    c.setParty(id, 'sim'); // one party: every member is every other's ally
    // the slip's own seed: it draws nothing from the shared generator
    const memory: BrainMemory = newBrainMemory(REACTION_S + rng() * 0.2, m.sloppy ? { rate: SLOPPY_MISS, seed: o.seed * 7919 + i * 104729 + 1 } : undefined);
    return {
      careful: m.careful, id, memory, body: makeBody(x, z, zone.surface) as Body, startAt: rng() * 0.5, facing: angle,
      r: { died: false, deaths: 0, revived: 0, hpLeft: 0, hpLost: 0, dodges: 0, damage: 0, healedOthers: 0, shieldedOthers: 0, assists: 0, casts: 0, castBreaks: 0 } as MemberResult,
    };
  });
  const byId = new Map(members.map((m) => [m.id, m]));
  const plan3 = o.party.some((m) => m.weapon !== undefined);
  const tally = new Tally(byId, (id) => enemyIds.includes(id));
  let killedAt: number | null = null, surgeTicks = 0;
  const killed = new Set<number>();
  /** Intent fx ranges of this tick: [start, end) of w.out.fx, by member. */
  let windows: FxWindow[] = [];
  const dt = 1 / TICK_HZ;
  const targetOf = () => {
    let best: number | null = null, bestHp = Infinity;
    for (const id of enemyIds) { const v = c.get(id)!; if (v.alive && v.hp < bestHp) { best = id; bestHp = v.hp; } }
    return best;
  };
  for (let k = 0; k <= Math.round(maxS * TICK_HZ); k++) {
    const t = k / TICK_HZ;
    windows = [];
    // job mode: who acts first alternates each tick (on a server, simultaneous intents arrive in any order);
    // a Plan 3 party keeps Plan 3's fixed order
    const order = plan3 || n < 2 ? members : [...members.slice(k % n), ...members.slice(0, k % n)];
    const target = targetOf();
    for (const m of order) {
      if (t < m.startAt || c.get(m.id)?.alive !== true) continue;
      const input = brainInputFor(c, m.id, target, t, m.careful, plan3 ? undefined : home);
      if (!input) continue;
      const act = adventurerBrain(input, m.memory);
      const self = input.self;
      const busy = self.act === 'dodge' || self.act === 'knock';
      if (act.moveTo && !busy) {
        const dx = act.moveTo.x - m.body.x, dz = act.moveTo.z - m.body.z, d = Math.hypot(dx, dz);
        const speed = Math.min(RUN_SPEED * c.speedScale(m.id, t), d / dt);
        if (d > 1e-6) {
          stepBody(m.body, { vx: (dx / d) * speed, vz: (dz / d) * speed, jump: false }, dt, zone.surface);
          m.facing = Math.atan2(dx, dz);
        }
      } else stepBody(m.body, { vx: 0, vz: 0, jump: false }, dt, zone.surface);
      c.setPose(m.id, m.body.x, m.body.z, m.body.y, m.facing);
      for (const raw of act.intents) {
        // a dodge starts from where the body is now (as an honest client sends it), not from the view the brain read
        const i = raw.t === 'dodge' ? { ...raw, from: { x: m.body.x, z: m.body.z, y: m.body.y } } : raw;
        const start = w.out.fx.length;
        const r = c.intent(m.id, i, t);
        windows.push({ start, end: w.out.fx.length, src: m.id });
        if (i.t === 'dodge' && r === null) {
          m.r.dodges++;
          const v = c.get(m.id)!;
          m.body = { ...m.body, x: v.x, z: v.z, y: v.y, vy: 0, grounded: true, peakY: v.y };
        }
      }
    }
    const out = c.tick(t);
    if (c.get(enemyId)!.surging) surgeTicks++;
    for (const d of out.displaced) {
      const m = byId.get(d.id);
      if (m) m.body = { ...m.body, x: d.result.x, z: d.result.z, y: d.result.y, vy: 0, grounded: true, peakY: d.result.y };
    }
    tally.tick(out, windows, t);
    // a killed enemy stays dead for the rest of the fight (an add does not respawn into it)
    for (const kk of out.kills) if (isEnemy(kk.enemy)) { killed.add(kk.enemy); w.enemies.get(kk.enemy)!.respawnAt = Infinity; }
    if (killed.size === enemyIds.length) { killedAt = t; break; }
    if (members.every((m) => c.get(m.id)?.alive !== true)) break;
  }
  const firstHitAt = tally.firstHitAt;
  return {
    firstHitAt, killedAt, ttk: killedAt !== null && firstHitAt !== null ? killedAt - firstHitAt : null,
    members: members.map((m) => { const v = c.get(m.id)!; return { ...m.r, hpLeft: v.alive ? v.hp : 0 }; }),
    combos: tally.combos, crossCombos: tally.crossCombos, reactions: tally.reactions, surgeS: surgeTicks / TICK_HZ,
  };
}

/**
 * One scripted adventurer against one camp (see simulateParty): a job with its solo picks (or `picks`),
 * or (deprecated, until Task 9) a Plan 3 `weapon`; ttk = killedAt − firstHitAt.
 */
export function simulateFight(o: {
  seed: number; enemy: EnemyKindId; careful: boolean; maxS?: number;
} & ({ job: JobId; picks?: [AbilityId, AbilityId]; weapon?: undefined } | { weapon: Plan3Loadout['weapon']; job?: undefined; picks?: undefined })): FightResult {
  const member: PartyMember = o.weapon !== undefined ? { weapon: o.weapon, careful: o.careful } : { job: o.job, careful: o.careful, picks: o.picks };
  const r = simulateParty({ seed: o.seed, party: [member], enemy: o.enemy, maxS: o.maxS });
  const m = r.members[0];
  return { firstHitAt: r.firstHitAt, killedAt: r.killedAt, ttk: r.ttk, died: m.died, hpLeft: m.hpLeft, dodges: m.dodges };
}

// ───────── fx accounting (shared by simulateParty and simulateEncounter) ─────────
/** One member's intent fx: [start, end) of the tick's fx, by member. */
interface FxWindow { start: number; end: number; src: number }
interface Tallied { id: number; r: MemberResult }

/** Counts a fight's fx per member (damage, hp lost, heals, shields, assists, casts, deaths) and per party. */
class Tally {
  firstHitAt: number | null = null;
  combos = 0; crossCombos = 0; interrupts = 0; breaks = 0;
  readonly reactions: Record<ReactionId, number> = { blast: 0, conduct: 0, steam: 0, bedrock: 0 };
  /** Per enemy: who last set each mark on it (from `mark … on: true` after a member's hit on it). */
  private readonly markOwner = new Map<number, Partial<Record<MarkId, number>>>();
  private readonly lastHit = new Map<number, { src: number; by: string }>();
  private readonly bloodbond = new Set<number>();
  constructor(private readonly byId: Map<number, Tallied>, private readonly isEnemy: (id: number) => boolean) {}
  private owners(id: number): Partial<Record<MarkId, number>> {
    let o = this.markOwner.get(id);
    if (!o) { o = {}; this.markOwner.set(id, o); }
    return o;
  }
  private assist(src: number) { const m = this.byId.get(src); if (m) m.r.assists++; }

  tick(out: TickOut, windows: FxWindow[], t: number): void {
    const { byId, isEnemy, lastHit, bloodbond } = this;
    // the ability each fx belongs to: an intent's `use`, or a cast completing in the tick (`use` … `castEnd`)
    let wi = 0;
    let ctx: { src: number; ability: AbilityId | null } | null = null;
    const tickCtx = new Map<number, AbilityId>();
    out.fx.forEach((f: FxEvent, idx) => {
      while (wi < windows.length && idx >= windows[wi].end) { wi++; ctx = null; }
      const inIntent = wi < windows.length && idx >= windows[wi].start;
      if (inIntent && (!ctx || ctx.src !== windows[wi].src)) ctx = { src: windows[wi].src, ability: null };
      if (!inIntent) ctx = null;
      if (f.t === 'use') { if (inIntent && ctx) ctx.ability = f.ability; else tickCtx.set(f.src, f.ability); }
      const abOf = (src: number): AbilityId | null | undefined => (inIntent ? (ctx && ctx.src === src ? ctx.ability : undefined) : tickCtx.get(src));
      /** A support effect by `src`: its support ability's, Bloodbond's shared heals, or (outside any ability) Soft Rain's. */
      const supportBy = (src: number, kind: 'heal' | 'other'): boolean => {
        const ab = abOf(src);
        if (ab) return ABILITIES[ab].support === true || (kind === 'heal' && bloodbond.has(src));
        return kind === 'heal' && ab === undefined; // a tick heal with no ability: Soft Rain
      };
      switch (f.t) {
        case 'hit': {
          const m = byId.get(f.src);
          if (m && isEnemy(f.dst)) {
            this.firstHitAt ??= t;
            m.r.damage += f.amount;
            lastHit.set(f.dst, { src: f.src, by: f.by });
            const owners = this.owners(f.dst);
            if (f.combo && f.combo.length) {
              this.combos++;
              for (const mk of f.combo) if (owners[mk] !== undefined && owners[mk] !== f.src) this.crossCombos++;
            }
          }
          const v = byId.get(f.dst);
          if (v && isEnemy(f.src)) v.r.hpLost += f.amount;
          break;
        }
        case 'react': {
          this.reactions[f.reaction]++;
          const owner = this.markOwner.get(f.dst)?.[REACTION_MARK[f.reaction]];
          if (owner !== undefined && owner !== f.src) this.crossCombos++;
          break;
        }
        case 'mark': {
          const lh = lastHit.get(f.dst);
          if (f.on && lh && isEnemy(f.dst)) {
            this.owners(f.dst)[f.mark] = lh.src;
            const ab = ABILITIES[lh.by as AbilityId];
            if (ab && ab.support && ab.primer && ab.mark === f.mark) this.assist(lh.src);
          }
          break;
        }
        case 'interrupt': {
          if (isEnemy(f.dst)) this.interrupts++;
          const lh = lastHit.get(f.dst); if (lh && supportBy(lh.src, 'other')) this.assist(lh.src);
          break;
        }
        case 'break': if (isEnemy(f.dst)) this.breaks++; break;
        case 'heal': {
          const m = byId.get(f.src);
          if (m && f.dst !== f.src && byId.has(f.dst)) { m.r.healedOthers += f.amount; if (supportBy(f.src, 'heal')) m.r.assists++; }
          break;
        }
        case 'shield': {
          const m = byId.get(f.src);
          if (m && f.dst !== f.src && byId.has(f.dst)) { m.r.shieldedOthers += f.amount; if (supportBy(f.src, 'other')) m.r.assists++; }
          break;
        }
        case 'buff':
          if (f.buff === 'bloodbond' && byId.has(f.dst)) { if (f.on) bloodbond.add(f.dst); else bloodbond.delete(f.dst); }
          if (f.on && f.dst !== f.src && (byId.has(f.dst) || isEnemy(f.dst)) && supportBy(f.src, 'other')) this.assist(f.src);
          break;
        case 'gift': if (f.dst !== f.src && supportBy(f.src, 'other')) this.assist(f.src); break;
        case 'revive': { this.assist(f.src); const m = byId.get(f.dst); if (m) m.r.revived++; break; }
        case 'use': if (TAUNTS(f.ability)) this.assist(f.src); break;
        case 'cast': { const m = byId.get(f.src); if (m) m.r.casts++; break; }
        case 'castEnd': {
          tickCtx.delete(f.src);
          const m = byId.get(f.src);
          if (m && !f.ok && (f.reason === 'interrupt' || f.reason === 'dodge')) m.r.castBreaks++;
          break;
        }
        default: break;
      }
    });
    for (const id of out.died) { const m = byId.get(id); if (m) { m.r.died = true; m.r.deaths++; bloodbond.delete(id); } }
  }
}

// ───────── dungeon encounters (Plan 4) ─────────
/**
 * careful: Plan 3b's careful brain with the dungeon rules; skilled: the same, missing a seeded
 * SKILLED_MISS of the telegraphs it would answer (ruling P4-h); sloppy: missing SLOPPY_MISS; careless:
 * never dodges, stands in fields.
 */
export type Skill = 'careful' | 'skilled' | 'sloppy' | 'careless';
/** picks: default the duo picks in a party, the solo picks alone; stats: default STARTER_STATS (a gear stand-in). */
export interface EncounterMember { job: JobId; skill: Skill; picks?: [AbilityId, AbilityId]; stats?: Stats }
/**
 * won: every enemy of a pack, or the boss, killed; ttk = killedAt − firstHitAt. bossHpFrac: the boss's
 * hp fraction at the end (a pack: its enemies' total), 0 on a win. phaseReached: the boss's highest
 * phase (0-based, 0 for a pack). interrupts: enemy wind-ups the party interrupted; breaks: Breaks.
 */
export interface EncounterResult {
  won: boolean; killedAt: number | null; firstHitAt: number | null; ttk: number | null;
  members: MemberResult[];
  bossHpFrac: number;
  phaseReached: number; enraged: boolean;
  interrupts: number;
  /** The same, by the attack interrupted (Keeper's Toll, Ember Breath, Focus Beam). */
  interruptedBy: Partial<Record<EnemyAttackId, number>>;
  breaks: number; reactions: Record<ReactionId, number>; crossCombos: number;
}
/** How long a Warden fight may run in the simulation (well past its enrage, `BOSSES.fallen_warden.enrage.s`). */
export const SIM_WARDEN_MAX_S = 480;
/** How long any other encounter may run. */
export const SIM_ENCOUNTER_MAX_S = 240;
/** The room's entry corridor stub on −z: width and length, in m. */
export const SIM_CORRIDOR_W = 5;
export const SIM_CORRIDOR_L = 12;

/**
 * One encounter of the Lampfall (ENCOUNTERS[id]) through the real engine at TICK_HZ, the party in one
 * party. The field is the room: a flat disc of roomR at (0, 0), with its entry corridor stub (5 m × 12 m)
 * on −z, where the members start (3 m or more apart, in two files) and walk in. Enemies stand at their
 * spawns. A boss camp's arena is the disc (ruling P4-c: its attacks and fields reach only members
 * inside); SEAL_DELAY_S after the boss wakes the gate shuts (the corridor is no longer ground; anyone
 * still in it is moved into the room) until the fight ends. Each tick, every live member in turn (who
 * goes first alternates): the dungeon brain on the target (the boss while it lives, else the pack's
 * live enemy with the least hp), the move toward moveTo, setPose, intents; then the tick. The dead stay
 * dead unless revived. It ends on a win, when every member is dead, or at maxS (SIM_WARDEN_MAX_S for
 * the Warden, else SIM_ENCOUNTER_MAX_S). Seeds vary each member's start (0–0.5 s), a careful brain's
 * reaction (0.4–0.6 s) and a sloppy brain's slips.
 */
export function simulateEncounter(o: {
  seed: number; party: EncounterMember[]; encounter: EncounterId; maxS?: number;
  /** Diagnostics only (tuning scripts): every tick's output, after the simulation has read it. */
  trace?: (out: TickOut, t: number, c: Combat) => void;
}): EncounterResult {
  const enc = ENCOUNTERS[o.encounter];
  const bossKind = enc.boss ?? null;
  const maxS = o.maxS ?? (bossKind === 'fallen_warden' ? SIM_WARDEN_MAX_S : SIM_ENCOUNTER_MAX_S);
  const R = enc.roomR;
  const rng = rngOf(o.seed);
  let sealed = false;
  const inRoom = (x: number, z: number) => x * x + z * z <= R * R;
  const inCorridor = (x: number, z: number) => Math.abs(x) <= SIM_CORRIDOR_W / 2 && z >= -R - SIM_CORRIDOR_L && z <= -R + 1;
  const surface = (x: number, z: number) => (inRoom(x, z) || (!sealed && inCorridor(x, z)) ? 0 : null);
  // enemies never need the corridor of a boss room (their leash is inside it); a pack may follow into it
  const ground = bossKind ? (x: number, z: number) => (inRoom(x, z) ? 0 : null) : (x: number, z: number) => (inRoom(x, z) || inCorridor(x, z) ? 0 : null);
  const arenaOf = bossKind ? inRoom : undefined;
  const camps: CampSpawn[] = enc.spawns.map((sp) => ({ kind: sp.kind, x: sp.dx, z: sp.dz, facing: Math.PI, ...(arenaOf && sp.kind === bossKind ? { arena: arenaOf } : {}) }));
  const zone: CombatZone = { surface, ground, sight: () => true, camps, jobSwitch: () => false };
  const c = createCombat(zone, { seed: o.seed, nowS: 0 });
  const w = worldOf(c);
  const campIds = [...w.enemies.keys()];
  const bossId = bossKind ? campIds.find((id) => w.enemies.get(id)!.kind === bossKind)! : null;
  // the brain's arena: the room the fight is in (a boss's is sealed; a pack's is not, but the fight stays in it)
  const arena = { x: 0, z: 0, r: R };
  const seen = new Set<number>(campIds);
  const n = o.party.length;
  const members = o.party.map((m, i) => {
    const x = n === 1 ? 0 : i % 2 === 0 ? -1.5 : 1.5, z = -R - 2 - 1.5 * i;
    const picks: [AbilityId, AbilityId] = m.picks ? [m.picks[0], m.picks[1]] : [...(n === 1 ? JOBS[m.job].picks.solo : JOBS[m.job].picks.duo)] as [AbilityId, AbilityId];
    const id = c.addAdventurer({ x, z, y: 0, facing: 0, hp: m.stats?.maxHp ?? 100, loadout: { job: m.job, picks }, ...(m.stats ? { stats: m.stats } : {}) }, 0);
    c.setParty(id, 'sim');
    const memory = newBrainMemory(REACTION_S + rng() * 0.2, m.skill === 'sloppy' || m.skill === 'skilled'
      ? { rate: m.skill === 'sloppy' ? SLOPPY_MISS : SKILLED_MISS, seed: o.seed * 7919 + i * 104729 + 1 } : undefined);
    return {
      careful: m.skill !== 'careless', id, memory, body: makeBody(x, z, zone.surface) as Body, startAt: rng() * 0.5, facing: 0,
      r: { died: false, deaths: 0, revived: 0, hpLeft: 0, hpLost: 0, dodges: 0, damage: 0, healedOthers: 0, shieldedOthers: 0, assists: 0, casts: 0, castBreaks: 0 } as MemberResult,
    };
  });
  const byId = new Map(members.map((m) => [m.id, m]));
  const tally = new Tally(byId, (id) => seen.has(id));
  const killed = new Set<number>();
  let killedAt: number | null = null, sealAt = Infinity, phaseReached = 0, enraged = false;
  const interruptedBy: Partial<Record<EnemyAttackId, number>> = {};
  let windows: FxWindow[] = [];
  const dt = 1 / TICK_HZ;
  const bossHome = bossId !== null ? { x: 0, z: 0, leash: ENEMY_KINDS[bossKind!].leash } : undefined;
  for (let k = 0; k <= Math.round(maxS * TICK_HZ); k++) {
    const t = k / TICK_HZ;
    windows = [];
    if (!sealed && t >= sealAt - 1e-9) {
      sealed = true;
      // the gate shuts: anyone still in the corridor steps into the room
      for (const m of members) {
        const d = Math.hypot(m.body.x, m.body.z);
        if (d > R - 0.5) {
          const x = (m.body.x / d) * (R - 0.5), z = (m.body.z / d) * (R - 0.5);
          m.body = { ...m.body, x, z };
          c.setPose(m.id, x, z, m.body.y, m.facing);
        }
      }
    }
    // the views every member reads this tick (the enemies, telegraphs and fields as the last tick left them)
    const enemies: CombatantView[] = [], advs: CombatantView[] = [];
    for (const v of c.all()) { if (v.team === 'adventurer') advs.push(v); else if (v.alive) enemies.push(v); }
    const telegraphs = [...c.telegraphs()], fields = [...c.fields()];
    let targetId: number | null = null;
    if (bossId !== null && c.get(bossId)!.alive) targetId = bossId;
    else {
      let bestHp = Infinity;
      for (const v of enemies) if (v.hp < bestHp) { targetId = v.id; bestHp = v.hp; }
    }
    const target = targetId === null ? null : c.get(targetId) ?? null;
    const home = targetId === null ? undefined
      : (() => { const e = w.enemies.get(targetId)!; return e.data.speed > 0 ? { x: e.camp.x, z: e.camp.z, leash: e.data.leash } : bossHome; })();
    const order = n < 2 ? members : [...members.slice(k % n), ...members.slice(0, k % n)];
    for (const m of order) {
      if (t < m.startAt || c.get(m.id)?.alive !== true) continue;
      const v = c.get(m.id)!, s = c.self(m.id)!;
      const allies = advs.filter((a) => a.id !== m.id && Math.hypot(a.x - v.x, a.z - v.z) <= ALLY_VIEW_R);
      const input: DungeonBrainInput = {
        nowS: t, careful: m.careful, self: { ...v, ...s, job: s.job!, dodgeMax: s.dodgeMax!, cast: s.cast ?? null },
        target, allies, telegraphs, fields, arena, enemies,
      };
      if (home) input.home = home;
      const act = dungeonBrain(input, m.memory);
      const busy = input.self.act === 'dodge' || input.self.act === 'knock';
      if (act.moveTo && !busy) {
        const dx = act.moveTo.x - m.body.x, dz = act.moveTo.z - m.body.z, d = Math.hypot(dx, dz);
        const speed = Math.min(RUN_SPEED * c.speedScale(m.id, t), d / dt);
        if (d > 1e-6) {
          stepBody(m.body, { vx: (dx / d) * speed, vz: (dz / d) * speed, jump: false }, dt, zone.surface);
          m.facing = Math.atan2(dx, dz);
        }
      } else stepBody(m.body, { vx: 0, vz: 0, jump: false }, dt, zone.surface);
      c.setPose(m.id, m.body.x, m.body.z, m.body.y, m.facing);
      for (const raw of act.intents) {
        const i = raw.t === 'dodge' ? { ...raw, from: { x: m.body.x, z: m.body.z, y: m.body.y } } : raw;
        const start = w.out.fx.length;
        const r = c.intent(m.id, i, t);
        windows.push({ start, end: w.out.fx.length, src: m.id });
        if (i.t === 'dodge' && r === null) {
          m.r.dodges++;
          const p = c.get(m.id)!;
          m.body = { ...m.body, x: p.x, z: p.z, y: p.y, vy: 0, grounded: true, peakY: p.y };
        }
      }
    }
    const out = c.tick(t);
    for (const id of w.enemies.keys()) seen.add(id);
    for (const d of out.displaced) {
      const m = byId.get(d.id);
      if (m) m.body = { ...m.body, x: d.result.x, z: d.result.z, y: d.result.y, vy: 0, grounded: true, peakY: d.result.y };
    }
    for (const ev of out.boss) {
      if (ev.enemy !== bossId) continue;
      if (ev.event === 'wake') sealAt = Math.min(sealAt, t + SEAL_DELAY_S);
      if (ev.event === 'phase' && ev.phase !== undefined) phaseReached = Math.max(phaseReached, ev.phase);
      if (ev.event === 'enrage') enraged = true;
      if (ev.event === 'reset') { sealed = false; sealAt = Infinity; }
    }
    tally.tick(out, windows, t);
    // what each interrupt cancelled: the wind-up its enemy had when the tick began
    for (const f of out.fx) {
      if (f.t !== 'interrupt') continue;
      const wu = enemies.find((v) => v.id === f.dst)?.windup;
      if (wu) interruptedBy[wu.attack] = (interruptedBy[wu.attack] ?? 0) + 1;
    }
    o.trace?.(out, t, c);
    for (const kk of out.kills) if (campIds.includes(kk.enemy)) { killed.add(kk.enemy); w.enemies.get(kk.enemy)!.respawnAt = Infinity; }
    if (bossId !== null ? killed.has(bossId) : killed.size === campIds.length) { killedAt = t; break; }
    if (members.every((m) => c.get(m.id)?.alive !== true)) break;
  }
  const won = killedAt !== null;
  let bossHpFrac = 0;
  if (!won) {
    if (bossId !== null) { const b = w.enemies.get(bossId)!; bossHpFrac = b.alive ? b.hp / b.maxHp : 0; }
    else {
      let hp = 0, max = 0;
      for (const id of campIds) { const e = w.enemies.get(id)!; hp += e.alive ? e.hp : 0; max += e.maxHp; }
      bossHpFrac = max > 0 ? hp / max : 0;
    }
  }
  const firstHitAt = tally.firstHitAt;
  return {
    won, killedAt, firstHitAt, ttk: killedAt !== null && firstHitAt !== null ? killedAt - firstHitAt : null,
    members: members.map((m) => { const v = c.get(m.id)!; return { ...m.r, hpLeft: v.alive ? v.hp : 0 }; }),
    bossHpFrac, phaseReached, enraged, interrupts: tally.interrupts, interruptedBy, breaks: tally.breaks,
    reactions: tally.reactions, crossCombos: tally.crossCombos,
  };
}
