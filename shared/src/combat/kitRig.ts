// Test support only (no test of its own): kitted adventurers on the 15 Hz Rig, and the per-mod probes of
// mods.test.ts — for each mod, a small scenario through the real engine whose observable outcome the mod
// must change ("every entry does something"). A probe returns null when the job has no means to use the mod
// (no ability of that kind), so a dead mod is visible rather than silently passing.
import { ABILITIES, type AbilityData, type AbilityId, type Loadout } from './abilities';
import { hurtAdventurer } from './adventurer';
import { resolveHit } from './enemyAi';
import { JOBS, type JobId } from './jobs';
import { REACTIONS } from './elements';
import { ENEMY_KINDS } from './enemies';
import type { MarkId } from './marks';
import type { Kit, Mod } from '../mods';
import type { Stats } from './stats';
import { Rig, camp } from './testRig';

export const ENEMY = 'mossback' as const;
const R = ENEMY_KINDS[ENEMY].radius;

/** Two picks of `job`'s pool including `want` (when it is a pick), the rest in pool order. */
export function picksWith(job: JobId, ...want: AbilityId[]): [AbilityId, AbilityId] {
  const pool = JOBS[job].pool;
  const chosen = want.filter((id) => pool.includes(id));
  for (const id of pool) if (chosen.length < 2 && !chosen.includes(id)) chosen.push(id);
  return [chosen[0], chosen[1]];
}

/** Adds a kitted adventurer (stats and mods) at (x, z), facing +z, at `hp` (default full). */
export function addKitted(r: Rig, job: JobId, picks: [AbilityId, AbilityId], kit: Kit | null, x = 0, z = -(R + 0.5), hp?: number): number {
  const loadout: Loadout = { job, picks };
  const max = kit?.stats.maxHp ?? 100;
  const id = r.c.addAdventurer({ x, z, y: 0, facing: 0, hp: hp ?? max, loadout, ...(kit ? { kit } : {}) }, r.now);
  r.c.setParty(id, 'probe');
  return id;
}

/** The job's abilities (bar and pool). */
export const abilitiesOf = (job: JobId): AbilityData[] => [...JOBS[job].bar, ...JOBS[job].pool].map((id) => ABILITIES[id]);
const has = (ab: AbilityData, k: string) => ab.effects.some((e) => e.k === k);

/**
 * Uses ability `ab` of adventurer `a` on enemy `e` (or ally `ally`): cooldowns cleared, Momentum set when
 * given; Charged Shot is held to a full charge; a cast is ticked to its end. Returns the press's refusal.
 */
export function use(r: Rig, a: number, ab: AbilityId, e: number, o: { ally?: number; momentum?: number; finish?: boolean } = {}): string | null {
  const slot = r.c.self(a)!.slots.indexOf(ab);
  if (slot < 0) throw new Error(`${ab} is not on the bar`);
  r.ready(a, o.momentum);
  r.i(a, { t: 'target', id: e });
  const res = r.press(a, slot, o.ally);
  if (res !== null || o.finish === false) return res;
  if (has(ABILITIES[ab], 'charge')) { r.at(r.now + 1.6); r.release(a, slot); }
  if (r.c.self(a)!.cast) r.until('castEnd');
  r.tick();
  return null;
}

/** Per probe: a fresh rig, the main adventurer `a` (kit), an ally `b` (no kit) 2 m away, the enemy `e`. */
interface Scene { r: Rig; a: number; b: number; e: number }
function scene(job: JobId, kit: Kit, picks: [AbilityId, AbilityId], o: { aHp?: number; bHp?: number } = {}): Scene {
  const r = new Rig([camp(ENEMY, 0, 0)]);
  const e = r.enemy(ENEMY);
  const a = addKitted(r, job, picks, kit, 0, -(R + 0.5), o.aHp);
  const b = addKitted(r, 'warrior', ['mend', 'bulwark'], null, 2, -(R + 0.5), o.bHp);
  return { r, a, b, e };
}
const A = (s: Scene) => s.r.w.adventurers.get(s.a)!;
const B = (s: Scene) => s.r.w.adventurers.get(s.b)!;
const E = (s: Scene) => s.r.w.enemies.get(s.e)!;

/** The ally argument an ability's aim needs (and kills the ally first for a revive). */
function allyFor(s: Scene, ab: AbilityData): number | undefined {
  if (ab.aim === 'dead-ally') { hurtAdventurer(s.r.w, B(s), 1e6, s.e, 'auto', s.r.now); return s.b; }
  return ab.aim === 'ally' || ab.aim === 'other-ally' ? s.b : undefined;
}
const sig = (v: unknown) => JSON.stringify(v);
const near = (n: number) => Math.round(n * 1000) / 1000;

/** A live wind-up the next interrupt can cancel. */
function windup(s: Scene) {
  const e = E(s);
  e.windup = { attack: 'thorn_burst', startedAt: s.r.now, endsAt: s.r.now + 30, interruptible: true, telegraphId: null };
}
/** A perfect dodge on `a` (inside an attack's shape, in i-frames). */
function perfectDodge(s: Scene) {
  const a = A(s);
  a.iframeUntil = s.r.now + 1;
  resolveHit(s.r.w, E(s), a, 20, 'thorn_burst', false, null, s.r.now, { kind: 'circle', x: a.x, z: a.z, r: 3 });
}

/**
 * The observable outcome of `mod`'s scenario for `job` with `kit` (its stats and every mod), or null when the
 * job has no means to use that mod. Two kits that differ only in `mod` must give different outcomes.
 */
export function probe(job: JobId, kit: Kit, mod: Mod): string | null {
  const abs = abilitiesOf(job);
  const mine = (id: AbilityId) => abs.some((ab) => ab.id === id);
  const firstWith = (ok: (ab: AbilityData) => boolean) => abs.find(ok);
  switch (mod.k) {
    case 'coef': {
      if (!mine(mod.ability)) return null;
      const s = scene(job, kit, picksWith(job, mod.ability));
      const ab = ABILITIES[mod.ability];
      use(s.r, s.a, ab.id, s.e, { momentum: 100, ally: allyFor(s, ab) });
      return sig(s.r.hits(s.a).filter((h) => h.by === ab.id && h.dst === s.e).map((h) => h.amount));
    }
    case 'amount': return amountProbe(job, kit, mine(mod.ability) ? ABILITIES[mod.ability] : undefined);
    case 'given': return amountProbe(job, kit, firstWith((ab) => has(ab, 'heal') || has(ab, 'shield')));
    case 'cd': {
      if (!mine(mod.ability)) return null;
      const s = scene(job, kit, picksWith(job, mod.ability));
      const ab = ABILITIES[mod.ability];
      use(s.r, s.a, ab.id, s.e, { momentum: 100, ally: allyFor(s, ab) });
      const v = s.r.c.self(s.a)!;
      return sig(near(v.cd[v.slots.indexOf(ab.id)]));
    }
    case 'cast': {
      const ab = mod.ability === 'all' ? firstWith((x) => (x.cast ?? 0) > 0) : mine(mod.ability) ? ABILITIES[mod.ability] : undefined;
      if (!ab || !ab.cast) return null;
      const s = scene(job, kit, picksWith(job, ab.id));
      use(s.r, s.a, ab.id, s.e, { momentum: 100, ally: allyFor(s, ab), finish: false });
      return sig(near(s.r.c.self(s.a)!.cast?.total ?? -1));
    }
    case 'buffS': {
      if (!mine(mod.ability)) return null;
      const s = scene(job, kit, picksWith(job, mod.ability));
      const ab = ABILITIES[mod.ability];
      const t = s.r.now;
      use(s.r, s.a, ab.id, s.e, { momentum: 100, ally: allyFor(s, ab) });
      const until = (o: Record<string, { until: number } | undefined>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, near(v!.until - t)]));
      const a = A(s);
      return sig({ a: until(a.buffs), b: until(B(s).buffs), e: until(E(s).debuffs), shield: near(a.shieldUntil - t), sprint: near(a.sprintUntil - t) });
    }
    case 'hpCost': {
      if (!mine(mod.ability)) return null;
      const s = scene(job, kit, picksWith(job, mod.ability), { aHp: 60 });
      use(s.r, s.a, mod.ability, s.e, { momentum: 100 });
      return sig(near(A(s).hp));
    }
    case 'stagger': {
      if (!mine(mod.ability)) return null;
      const s = scene(job, kit, picksWith(job, mod.ability));
      use(s.r, s.a, mod.ability, s.e, { momentum: 100 });
      return sig(near(E(s).stagger.value));
    }
    case 'staggerMult': {
      const ab = firstWith((x) => (x.stagger ?? 0) > 0 && x.aim === 'enemy' && !has(x, 'charge'));
      if (!ab) return null;
      const s = scene(job, kit, picksWith(job, ab.id));
      use(s.r, s.a, ab.id, s.e, { momentum: 100 });
      return sig(near(E(s).stagger.value));
    }
    case 'finisherCost': {
      const s = scene(job, kit, picksWith(job));
      return sig(use(s.r, s.a, JOBS[job].bar[1], s.e, { momentum: 45, finish: false }));
    }
    case 'momentumOn': return momentumProbe(job, kit, mod.on);
    case 'dodge': {
      const s = scene(job, kit, picksWith(job));
      const v0 = s.r.c.self(s.a)!;
      const p = s.r.c.get(s.a)!;
      s.r.i(s.a, { t: 'dodge', dx: 1, dz: 0, from: { x: p.x, z: p.z, y: p.y }, grounded: true });
      return sig({ max: v0.dodgeMax, next: near(s.r.c.self(s.a)!.dodgeNextIn) });
    }
    case 'healShield': {
      const ab = firstWith((x) => has(x, 'heal'));
      if (!ab) return null;
      // the overheal kind heals a full ally; the normal one a hurt ally (and a hurt self, for self heals)
      const full = mod.overhealOnly === true;
      const s = scene(job, kit, picksWith(job, ab.id), { aHp: full ? undefined : 40, bHp: full ? undefined : 40 });
      use(s.r, s.a, ab.id, s.e, { momentum: 100, ally: allyFor(s, ab) });
      return sig(s.r.fx('kitShield').map((f) => [f.dst === s.a ? 'a' : 'b', f.amount]));
    }
    case 'cdOnCast': {
      const ab = firstWith((x) => (x.cast ?? 0) > 0);
      if (!ab) return null;
      const s = scene(job, kit, picksWith(job, ab.id));
      // the quick ability's cooldown runs while the cast completes: cdOnCast cuts it
      const quick = JOBS[job].bar[0];
      use(s.r, s.a, quick, s.e, { momentum: 100 });
      const a = A(s);
      const before = a.readyAt[quick]!;
      a.gcdUntil = -Infinity; a.momentum = 100;
      s.r.i(s.a, { t: 'target', id: s.e });
      s.r.press(s.a, s.r.c.self(s.a)!.slots.indexOf(ab.id), allyFor(s, ab));
      s.r.until('castEnd');
      return sig(near((a.readyAt[quick] ?? -1) - before));
    }
    case 'afterDodge': {
      const s = scene(job, kit, picksWith(job));
      const p = s.r.c.get(s.a)!;
      s.r.i(s.a, { t: 'dodge', dx: 0, dz: 0.001, from: { x: p.x, z: p.z, y: p.y }, grounded: true });
      s.r.at(s.r.now + 0.6);
      const quick = JOBS[job].bar[0];
      use(s.r, s.a, quick, s.e, { momentum: 100 });
      return sig(s.r.hits(s.a).filter((h) => h.by === quick).map((h) => h.amount));
    }
    case 'lowHpShield': {
      const s = scene(job, kit, picksWith(job));
      const a = A(s);
      a.hp = Math.ceil(0.4 * a.stats.maxHp);
      hurtAdventurer(s.r.w, a, Math.ceil(0.1 * a.stats.maxHp), s.e, 'auto', s.r.now);
      return sig(s.r.fx('kitShield').map((f) => f.amount));
    }
    case 'auraTaken': {
      const s = scene(job, kit, picksWith(job));
      resolveHit(s.r.w, E(s), B(s), 60, 'auto', false, null, s.r.now);
      return sig(near(B(s).hp));
    }
    case 'lastStand': {
      const s = scene(job, kit, picksWith(job));
      A(s).hp = 5;
      hurtAdventurer(s.r.w, A(s), 500, s.e, 'auto', s.r.now);
      return sig({ alive: A(s).alive, hp: near(A(s).hp) });
    }
    case 'resetOn': {
      const s = scene(job, kit, picksWith(job));
      use(s.r, s.a, JOBS[job].bar[0], s.e, { momentum: 0 });
      perfectDodge(s);
      return sig(near(s.r.c.self(s.a)!.cd[0]));
    }
    case 'shieldOn': {
      const ab = firstWith((x) => has(x, 'taunt'));
      if (!ab) return null;
      const s = scene(job, kit, picksWith(job, ab.id));
      use(s.r, s.a, ab.id, s.e, { momentum: 0 });
      return sig(s.r.fx('kitShield').map((f) => f.amount));
    }
  }
}

function amountProbe(job: JobId, kit: Kit, ab: AbilityData | undefined): string | null {
  if (!ab || !(has(ab, 'heal') || has(ab, 'shield'))) return null;
  const s = scene(job, kit, picksWith(job, ab.id), { aHp: 20, bHp: 20 });
  use(s.r, s.a, ab.id, s.e, { momentum: 100, ally: allyFor(s, ab) });
  const heals = s.r.fx('heal').filter((f) => f.src === s.a).map((f) => near(f.amount));
  const shields = s.r.fx('shield').filter((f) => f.src === s.a).map((f) => near(f.amount));
  return sig({ heals, shields });
}

function momentumProbe(job: JobId, kit: Kit, on: Extract<Mod, { k: 'momentumOn' }>['on']): string | null {
  const abs = abilitiesOf(job);
  const find = (ok: (ab: AbilityData) => boolean) => abs.find(ok);
  const m = (s: Scene) => sig(near(A(s).momentum));
  switch (on) {
    case 'parry': {
      const ab = find((x) => has(x, 'parry'));
      if (!ab) return null;
      const s = scene(job, kit, picksWith(job));
      use(s.r, s.a, ab.id, s.e, { momentum: 0 });
      resolveHit(s.r.w, E(s), A(s), 10, 'auto', true, null, s.r.now);
      return m(s);
    }
    case 'perfectDodge': { const s = scene(job, kit, picksWith(job)); perfectDodge(s); return m(s); }
    case 'hitTaken': { const s = scene(job, kit, picksWith(job)); hurtAdventurer(s.r.w, A(s), 10, s.e, 'auto', s.r.now); return m(s); }
    case 'interrupt': {
      const ab = find((x) => x.interrupts === true || has(x, 'charge'));
      if (!ab) return null;
      const s = scene(job, kit, picksWith(job, ab.id));
      if (has(ab, 'charge')) {
        // the wind-up starts while the shot is held
        const slot = s.r.c.self(s.a)!.slots.indexOf(ab.id);
        s.r.ready(s.a, 0); s.r.i(s.a, { t: 'target', id: s.e }); s.r.press(s.a, slot);
        s.r.at(s.r.now + 1.6); windup(s); s.r.release(s.a, slot); s.r.tick();
        return m(s);
      }
      windup(s);
      use(s.r, s.a, ab.id, s.e, { momentum: ab.cost ?? 0 });
      return m(s);
    }
    case 'detonate': {
      const fin = ABILITIES[JOBS[job].bar[1]];
      const other: MarkId = (['soaked', 'dazed', 'marked', 'burning'] as MarkId[]).find((mk) => mk !== fin.mark && (!fin.element || REACTIONS[fin.element].mark !== mk))!;
      const s = scene(job, kit, picksWith(job));
      E(s).marks[other] = s.r.now + 20;
      use(s.r, s.a, fin.id, s.e, { momentum: 100 });
      return m(s);
    }
    case 'react': {
      const ab = find((x) => x.element !== undefined && has(x, 'damage') && REACTIONS[x.element].mark !== x.mark);
      if (!ab) return null;
      const s = scene(job, kit, picksWith(job, ab.id));
      E(s).marks[REACTIONS[ab.element!].mark] = s.r.now + 20;
      use(s.r, s.a, ab.id, s.e, { momentum: ab.cost ?? 0 });
      return m(s);
    }
    case 'castDone': {
      const ab = find((x) => (x.cast ?? 0) > 0);
      if (!ab) return null;
      const s = scene(job, kit, picksWith(job, ab.id));
      use(s.r, s.a, ab.id, s.e, { momentum: ab.cost ?? 0, ally: allyFor(s, ab) });
      return m(s);
    }
    case 'cleanse': {
      const ab = find((x) => has(x, 'cleanse'));
      if (!ab) return null;
      const s = scene(job, kit, picksWith(job, ab.id));
      use(s.r, s.a, ab.id, s.e, { momentum: 0, ally: allyFor(s, ab) });
      return m(s);
    }
    case 'revive': {
      const ab = find((x) => has(x, 'revive'));
      if (!ab) return null;
      const s = scene(job, kit, picksWith(job, ab.id));
      use(s.r, s.a, ab.id, s.e, { momentum: 0, ally: allyFor(s, ab) });
      return m(s);
    }
    case 'behind': {
      if (JOBS[job].trait.id !== 'dusk_slip') return null;
      const s = scene(job, kit, picksWith(job));
      use(s.r, s.a, JOBS[job].bar[0], s.e, { momentum: 0 });
      return m(s);
    }
  }
}
