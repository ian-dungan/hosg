// The seeded fight simulation: scripted adventurers (brain.ts) against one camp (or a camp and its
// adds) on a flat field, run through the real engine at TICK_HZ. It is how the time-to-kill, survival
// and teamwork bands are checked.
import { makeBody, stepBody, type Body } from '../body';
import { RUN_SPEED, TICK_HZ } from '../constants';
import { ABILITIES, PLAN3_DEFAULT_LOADOUT, type AbilityId, type Loadout, type Plan3Loadout } from './abilities';
import { adventurerBrain, ALLY_VIEW_R, newBrainMemory, REACTION_S, type BrainInput, type BrainMemory } from './brain';
import { REACTIONS, type ReactionId } from './elements';
import { ENEMY_KINDS, type EnemyKindId } from './enemies';
import { createCombat, worldOf, type CampSpawn, type Combat, type CombatZone } from './engine';
import type { FxEvent } from './fx';
import { JOBS, type JobId } from './jobs';
import type { MarkId } from './marks';

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
    // the slip's own seed: it draws nothing from the shared generator
    const memory: BrainMemory = newBrainMemory(REACTION_S + rng() * 0.2, m.sloppy ? { rate: SLOPPY_MISS, seed: o.seed * 7919 + i * 104729 + 1 } : undefined);
    return {
      careful: m.careful, id, memory, body: makeBody(x, z, zone.surface) as Body, startAt: rng() * 0.5, facing: angle,
      r: { died: false, deaths: 0, revived: 0, hpLeft: 0, hpLost: 0, dodges: 0, damage: 0, healedOthers: 0, shieldedOthers: 0, assists: 0, casts: 0, castBreaks: 0 } as MemberResult,
    };
  });
  const byId = new Map(members.map((m) => [m.id, m]));
  const plan3 = o.party.some((m) => m.weapon !== undefined);
  const reactions: Record<ReactionId, number> = { blast: 0, conduct: 0, steam: 0, bedrock: 0 };
  /** Per enemy: who last set each mark on it (from `mark … on: true` after a member's hit on it). */
  const markOwner = new Map<number, Partial<Record<MarkId, number>>>(enemyIds.map((id) => [id, {}]));
  const lastHit = new Map<number, { src: number; by: string }>();
  const killed = new Set<number>();
  let firstHitAt: number | null = null, killedAt: number | null = null, combos = 0, crossCombos = 0, surgeTicks = 0;
  /** Intent fx ranges of this tick: [start, end) of w.out.fx, by member. */
  let windows: { start: number; end: number; src: number }[] = [];
  const bloodbond = new Set<number>();
  const assist = (src: number) => { const m = byId.get(src); if (m) m.r.assists++; };
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
            firstHitAt ??= t;
            m.r.damage += f.amount;
            lastHit.set(f.dst, { src: f.src, by: f.by });
            const owners = markOwner.get(f.dst)!;
            if (f.combo && f.combo.length) {
              combos++;
              for (const mk of f.combo) if (owners[mk] !== undefined && owners[mk] !== f.src) crossCombos++;
            }
          }
          const v = byId.get(f.dst);
          if (v && isEnemy(f.src)) v.r.hpLost += f.amount;
          break;
        }
        case 'react': {
          reactions[f.reaction]++;
          const owner = markOwner.get(f.dst)?.[REACTION_MARK[f.reaction]];
          if (owner !== undefined && owner !== f.src) crossCombos++;
          break;
        }
        case 'mark': {
          const lh = lastHit.get(f.dst);
          if (f.on && lh && isEnemy(f.dst)) {
            markOwner.get(f.dst)![f.mark] = lh.src;
            const ab = ABILITIES[lh.by as AbilityId];
            if (ab && ab.support && ab.primer && ab.mark === f.mark) assist(lh.src);
          }
          break;
        }
        case 'interrupt': { const lh = lastHit.get(f.dst); if (lh && supportBy(lh.src, 'other')) assist(lh.src); break; }
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
          if (f.on && f.dst !== f.src && (byId.has(f.dst) || isEnemy(f.dst)) && supportBy(f.src, 'other')) assist(f.src);
          break;
        case 'gift': if (f.dst !== f.src && supportBy(f.src, 'other')) assist(f.src); break;
        case 'revive': { assist(f.src); const m = byId.get(f.dst); if (m) m.r.revived++; break; }
        case 'use': if (TAUNTS(f.ability)) assist(f.src); break;
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
    // a killed enemy stays dead for the rest of the fight (an add does not respawn into it)
    for (const kk of out.kills) if (isEnemy(kk.enemy)) { killed.add(kk.enemy); w.enemies.get(kk.enemy)!.respawnAt = Infinity; }
    if (killed.size === enemyIds.length) { killedAt = t; break; }
    if (members.every((m) => c.get(m.id)?.alive !== true)) break;
  }
  return {
    firstHitAt, killedAt, ttk: killedAt !== null && firstHitAt !== null ? killedAt - firstHitAt : null,
    members: members.map((m) => { const v = c.get(m.id)!; return { ...m.r, hpLeft: v.alive ? v.hp : 0 }; }),
    combos, crossCombos, reactions, surgeS: surgeTicks / TICK_HZ,
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
