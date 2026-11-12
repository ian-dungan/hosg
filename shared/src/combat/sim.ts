// The seeded fight simulation: scripted adventurers (brain.ts) against one camp on a flat field, run
// through the real engine at TICK_HZ. It is how the time-to-kill, survival and teamwork bands are checked.
import { makeBody, stepBody, type Body } from '../body';
import { RUN_SPEED, TICK_HZ } from '../constants';
import { ABILITIES, PLAN3_DEFAULT_LOADOUT, type AbilityId, type Loadout, type Plan3Loadout } from './abilities';
import { adventurerBrain, ALLY_VIEW_R, newBrainMemory, REACTION_S, type BrainInput, type BrainMemory } from './brain';
import { REACTIONS, type ReactionId } from './elements';
import type { EnemyKindId } from './enemies';
import { createCombat, type Combat, type CombatZone } from './engine';
import { JOBS, type JobId } from './jobs';
import type { MarkId } from './marks';

export interface FightResult { firstHitAt: number | null; killedAt: number | null; ttk: number | null; died: boolean; hpLeft: number; dodges: number }
/**
 * A job and its picks (default: the solo picks for a party of 1, else the duo picks). Deprecated until
 * Task 9: `{ weapon }` runs a Plan 3 loadout (Blade or Bow with Plan 3's default free picks), exactly as
 * Plan 3's simulation did. ignoreTeam: the synergy check's control, a brain that plays as if alone
 * (BrainMemory.solo: no support abilities, no primer before its finisher, no formation, no revive).
 */
export type PartyMember =
  | { job: JobId; careful: boolean; picks?: [AbilityId, AbilityId]; ignoreTeam?: boolean; weapon?: undefined }
  | { weapon: Plan3Loadout['weapon']; careful: boolean; job?: undefined; picks?: undefined };
/**
 * died: died at least once; deaths: how often; revived: how often it was brought back; hpLeft: at the
 * end (0 if dead then). damage: dealt to the enemy. healedOthers / shieldedOthers: hp healed and shield
 * given to other adventurers. assists: support effects that took effect (see simulateParty). casts:
 * casts started; castBreaks: casts broken by an interrupt or its own dodge.
 */
export interface MemberResult {
  died: boolean; deaths: number; revived: number; hpLeft: number; dodges: number; damage: number;
  healedOthers: number; shieldedOthers: number; assists: number; casts: number; castBreaks: number;
}
export interface PartyResult {
  firstHitAt: number | null; killedAt: number | null; ttk: number | null;
  /** Per member, in the order given. */
  members: MemberResult[];
  /** Hits that detonated marks (Plan 3: finisher hits with a combo). */
  combos: number;
  /** Detonations and reactions of a mark another member applied. */
  crossCombos: number;
  reactions: Record<ReactionId, number>;
  /** Seconds the enemy spent in its chase surge. */
  surgeS: number;
}

/** Half-width of the flat field, in m (80 × 80). */
const FIELD = 40;
const flatZone = (enemy: EnemyKindId): CombatZone => {
  const s = (x: number, z: number) => (Math.abs(x) <= FIELD && Math.abs(z) <= FIELD ? 0 : null);
  return { surface: s, ground: s, sight: () => true, camps: [{ kind: enemy, x: 0, z: 0, facing: Math.PI }], jobSwitch: () => false };
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

/** The brain's view of adventurer `id` against `targetId` at nowS (null if the adventurer is not there); allies within ALLY_VIEW_R. */
export function brainInputFor(c: Combat, id: number, targetId: number | null, nowS: number, careful: boolean): BrainInput | null {
  const v = c.get(id), s = c.self(id);
  if (!v || !s) return null;
  const target = targetId === null ? null : c.get(targetId) ?? null;
  const allies = [...c.all()].filter((o) => o.team === 'adventurer' && o.id !== id && Math.hypot(o.x - v.x, o.z - v.z) <= ALLY_VIEW_R);
  return { nowS, careful, self: { ...v, ...s }, target, allies, telegraphs: [...c.telegraphs()] };
}

const REACTION_MARK: Record<ReactionId, MarkId> = {
  blast: REACTIONS.fire.mark, conduct: REACTIONS.lightning.mark, steam: REACTIONS.water.mark, bedrock: REACTIONS.earth.mark,
};
const TAUNTS = (id: AbilityId) => ABILITIES[id].effects.some((e) => e.k === 'taunt' || e.k === 'threat-drop');

/**
 * Scripted adventurers against one camp of `enemy` at (0, 0) on a flat 80 × 80 m field (jobs never
 * change there). Each starts 12 m away; the seed varies the approach angle (within ±45° of (0, −12),
 * the members 3 m apart, side by side), a careful brain's reaction (0.4–0.6 s) and when each starts
 * (0–0.5 s). Every 1/TICK_HZ s, for each live member: the brain, the move toward moveTo with stepBody
 * at RUN_SPEED × speedScale (none while dodging or knocked), setPose, intents; then the tick;
 * displacements are applied to the body. A dead member's brain does nothing, and a revived one carries
 * on. It ends at the kill, when every member is dead (the dead cast nothing, so no revive is coming),
 * or at maxS (default 180 s).
 *
 * assists count each support effect that took effect: a heal or shield on another adventurer; a buff
 * starting on another adventurer; Momentum given; a revive; a taunt or threat-drop used; a debuff
 * starting on the enemy; an interrupt; a primer mark placed by a `support` ability.
 */
export function simulateParty(o: { seed: number; party: PartyMember[]; enemy: EnemyKindId; maxS?: number }): PartyResult {
  const maxS = o.maxS ?? 180;
  const rng = rngOf(o.seed);
  const zone = flatZone(o.enemy);
  const c = createCombat(zone, { seed: o.seed, nowS: 0 });
  const enemyId = [...c.all()].find((v) => v.team === 'enemy')!.id;
  const angle = (rng() - 0.5) * (Math.PI / 2);
  const n = o.party.length;
  const members = o.party.map((m, i) => {
    const side = (i - (n - 1) / 2) * 3; // 3 m apart, across the approach
    const x = Math.sin(angle) * -12 + Math.cos(angle) * side, z = Math.cos(angle) * -12 - Math.sin(angle) * side;
    const loadout: Plan3Loadout | Loadout = m.weapon !== undefined
      ? { weapon: m.weapon, free: [PLAN3_DEFAULT_LOADOUT.free[0], PLAN3_DEFAULT_LOADOUT.free[1]] }
      : { job: m.job, picks: m.picks ? [m.picks[0], m.picks[1]] : [...(n === 1 ? JOBS[m.job].picks.solo : JOBS[m.job].picks.duo)] as [AbilityId, AbilityId] };
    const id = c.addAdventurer({ x, z, y: 0, facing: angle, hp: 100, loadout }, 0);
    const memory: BrainMemory = newBrainMemory(REACTION_S + rng() * 0.2, m.weapon === undefined && m.ignoreTeam === true);
    return {
      careful: m.careful, id, memory, body: makeBody(x, z, zone.surface) as Body, startAt: rng() * 0.5, facing: angle,
      r: { died: false, deaths: 0, revived: 0, hpLeft: 0, dodges: 0, damage: 0, healedOthers: 0, shieldedOthers: 0, assists: 0, casts: 0, castBreaks: 0 } as MemberResult,
    };
  });
  const byId = new Map(members.map((m) => [m.id, m]));
  const plan3 = o.party.some((m) => m.weapon !== undefined);
  const reactions: Record<ReactionId, number> = { blast: 0, conduct: 0, steam: 0, bedrock: 0 };
  /** Who last set each mark on the enemy (from `mark … on: true` after a member's hit). */
  const markOwner: Partial<Record<MarkId, number>> = {};
  let firstHitAt: number | null = null, killedAt: number | null = null, combos = 0, crossCombos = 0, surgeTicks = 0;
  let lastHit: { src: number; by: string } | null = null;
  const assist = (src: number) => { const m = byId.get(src); if (m) m.r.assists++; };
  const dt = 1 / TICK_HZ;
  for (let k = 0; k <= Math.round(maxS * TICK_HZ); k++) {
    const t = k / TICK_HZ;
    // job mode: who acts first alternates each tick (on a server, simultaneous intents arrive in any order);
    // a Plan 3 party keeps Plan 3's fixed order
    const order = plan3 || n < 2 ? members : [...members.slice(k % n), ...members.slice(0, k % n)];
    for (const m of order) {
      if (t < m.startAt || c.get(m.id)?.alive !== true) continue;
      const input = brainInputFor(c, m.id, enemyId, t, m.careful);
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
        const r = c.intent(m.id, i, t);
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
    for (const f of out.fx) {
      switch (f.t) {
        case 'hit': {
          const m = byId.get(f.src);
          if (!m || f.dst !== enemyId) break;
          firstHitAt ??= t;
          m.r.damage += f.amount;
          lastHit = { src: f.src, by: f.by };
          if (f.combo && f.combo.length) {
            combos++;
            for (const mk of f.combo) if (markOwner[mk] !== undefined && markOwner[mk] !== f.src) crossCombos++;
          }
          break;
        }
        case 'react': {
          reactions[f.reaction]++;
          const owner = markOwner[REACTION_MARK[f.reaction]];
          if (owner !== undefined && owner !== f.src) crossCombos++;
          break;
        }
        case 'mark':
          if (f.on && f.dst === enemyId && lastHit) {
            markOwner[f.mark] = lastHit.src;
            const ab = ABILITIES[lastHit.by as AbilityId];
            if (ab && ab.support && ab.primer && ab.mark === f.mark) assist(lastHit.src);
          }
          break;
        case 'interrupt': if (f.dst === enemyId && lastHit) assist(lastHit.src); break;
        case 'heal': {
          const m = byId.get(f.src);
          if (m && f.dst !== f.src && byId.has(f.dst)) { m.r.healedOthers += f.amount; m.r.assists++; }
          break;
        }
        case 'shield': {
          const m = byId.get(f.src);
          if (m && f.dst !== f.src && byId.has(f.dst)) { m.r.shieldedOthers += f.amount; m.r.assists++; }
          break;
        }
        case 'buff':
          if (f.on && f.dst !== f.src && (byId.has(f.dst) || f.dst === enemyId)) assist(f.src);
          break;
        case 'gift': if (f.dst !== f.src) assist(f.src); break;
        case 'revive': { assist(f.src); const m = byId.get(f.dst); if (m) m.r.revived++; break; }
        case 'use': if (TAUNTS(f.ability)) assist(f.src); break;
        case 'cast': { const m = byId.get(f.src); if (m) m.r.casts++; break; }
        case 'castEnd': {
          const m = byId.get(f.src);
          if (m && !f.ok && (f.reason === 'interrupt' || f.reason === 'dodge')) m.r.castBreaks++;
          break;
        }
        default: break;
      }
    }
    for (const id of out.died) { const m = byId.get(id); if (m) { m.r.died = true; m.r.deaths++; } }
    if (out.kills.some((kk) => kk.enemy === enemyId)) { killedAt = t; break; }
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
