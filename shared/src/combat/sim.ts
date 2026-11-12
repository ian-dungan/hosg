// The seeded fight simulation: scripted adventurers (brain.ts) against one camp on a flat field, run
// through the real engine at TICK_HZ. It is how the time-to-kill and survival bands are checked.
import { makeBody, stepBody, type Body } from '../body';
import { RUN_SPEED, TICK_HZ } from '../constants';
import { DEFAULT_LOADOUT, type WeaponId } from './abilities';
import { adventurerBrain, newBrainMemory, REACTION_S, type BrainInput, type BrainMemory } from './brain';
import type { EnemyKindId } from './enemies';
import { createCombat, type Combat, type CombatZone } from './engine';

export interface FightResult { firstHitAt: number | null; killedAt: number | null; ttk: number | null; died: boolean; hpLeft: number; dodges: number }
export interface PartyMember { weapon: WeaponId; careful: boolean }
export interface PartyResult {
  firstHitAt: number | null; killedAt: number | null; ttk: number | null;
  /** Per member, in the order given. */
  members: { died: boolean; hpLeft: number; dodges: number; damage: number }[];
  /** Finisher hits that detonated another member's mark. */
  combos: number;
}

/** Half-width of the flat field, in m (80 × 80). */
const FIELD = 40;
const flatZone = (enemy: EnemyKindId): CombatZone => {
  const s = (x: number, z: number) => (Math.abs(x) <= FIELD && Math.abs(z) <= FIELD ? 0 : null);
  return { surface: s, ground: s, sight: () => true, camps: [{ kind: enemy, x: 0, z: 0, facing: Math.PI }] };
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

/** The brain's view of adventurer `id` against `targetId` at nowS (null if the adventurer is not there). */
export function brainInputFor(c: Combat, id: number, targetId: number | null, nowS: number, careful: boolean): BrainInput | null {
  const v = c.get(id), s = c.self(id);
  if (!v || !s) return null;
  const target = targetId === null ? null : c.get(targetId) ?? null;
  return { nowS, careful, self: { ...v, ...s }, target, telegraphs: [...c.telegraphs()] };
}

/**
 * Scripted adventurers against one camp of `enemy` at (0, 0) on a flat 80 × 80 m field. Each starts
 * 12 m away with DEFAULT_LOADOUT's free picks and its weapon; the seed varies the approach angle
 * (within ±45° of (0, −12), the members side by side), a careful brain's reaction (0.4–0.6 s) and
 * when each starts (0–0.5 s). Every 1/TICK_HZ s: the brain, the move toward moveTo with stepBody at
 * RUN_SPEED × speedScale (none while dodging or knocked), setPose, intents, tick; displacements are
 * applied to the body. It ends at the kill, when every member is dead, or at maxS (default 180 s).
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
    const id = c.addAdventurer({ x, z, y: 0, facing: angle, hp: 100, loadout: { weapon: m.weapon, free: [DEFAULT_LOADOUT.free[0], DEFAULT_LOADOUT.free[1]] } }, 0);
    const memory: BrainMemory = newBrainMemory(REACTION_S + rng() * 0.2);
    return { ...m, id, memory, body: makeBody(x, z, zone.surface) as Body, startAt: rng() * 0.5, died: false, dodges: 0, damage: 0, facing: angle };
  });
  const byId = new Map(members.map((m) => [m.id, m]));
  let firstHitAt: number | null = null, killedAt: number | null = null, combos = 0;
  const dt = 1 / TICK_HZ;
  for (let k = 0; k <= Math.round(maxS * TICK_HZ); k++) {
    const t = k / TICK_HZ;
    for (const m of members) {
      if (m.died || t < m.startAt) continue;
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
      for (const i of act.intents) {
        const r = c.intent(m.id, i, t);
        if (i.t === 'dodge' && r === null) {
          m.dodges++;
          const v = c.get(m.id)!;
          m.body = { ...m.body, x: v.x, z: v.z, y: v.y, vy: 0, grounded: true, peakY: v.y };
        }
      }
    }
    const out = c.tick(t);
    for (const d of out.displaced) {
      const m = byId.get(d.id);
      if (m) m.body = { ...m.body, x: d.result.x, z: d.result.z, y: d.result.y, vy: 0, grounded: true, peakY: d.result.y };
    }
    for (const f of out.fx) {
      if (f.t !== 'hit') continue;
      const m = byId.get(f.src);
      if (m && f.dst === enemyId) {
        firstHitAt ??= t;
        m.damage += f.amount;
        if (f.combo && f.combo.length) combos++;
      }
    }
    for (const id of out.died) { const m = byId.get(id); if (m) m.died = true; }
    if (out.kills.some((kk) => kk.enemy === enemyId)) { killedAt = t; break; }
    if (members.every((m) => m.died)) break;
  }
  return {
    firstHitAt, killedAt, ttk: killedAt !== null && firstHitAt !== null ? killedAt - firstHitAt : null,
    members: members.map((m) => ({ died: m.died, hpLeft: m.died ? 0 : c.get(m.id)!.hp, dodges: m.dodges, damage: m.damage })),
    combos,
  };
}

/** One scripted adventurer against one camp (see simulateParty); ttk = killedAt − firstHitAt. */
export function simulateFight(o: { seed: number; weapon: WeaponId; enemy: EnemyKindId; careful: boolean; maxS?: number }): FightResult {
  const r = simulateParty({ seed: o.seed, party: [{ weapon: o.weapon, careful: o.careful }], enemy: o.enemy, maxS: o.maxS });
  const m = r.members[0];
  return { firstHitAt: r.firstHitAt, killedAt: r.killedAt, ttk: r.ttk, died: m.died, hpLeft: m.hpLeft, dodges: m.dodges };
}
