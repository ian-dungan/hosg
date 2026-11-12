// Ground fields: standing hazards a boss lays (Plan 4). Each whole second after a field starts, every
// live adventurer inside it (by ground x/z only: being in the air never avoids it) takes
// enemyHit(raw, defence, takenMult) through its shield. Fields ignore i-frames, never break casts,
// never knock, give no Momentum and never add Searing (Searing still raises what they deal, through
// takenMult). A revive's safe window still holds (a plain miss). A field lives while its owner does:
// it goes with the owner's despawn or death, or removeFieldsOf. Deterministic: fields in id order,
// adventurers in insertion order.
import type { FieldDef } from './bosses';
import { CATCH_UP_TICKS, FIELD_TICK_S } from './constants';
import type { CombatWorld, EnemyState, FieldState } from './engine';
import { hurtAdventurer, TIME_EPS } from './adventurer';
import { takenMult } from './effects';
import { inShape, type Shape } from './shapes';
import { enemyHit } from './stats';

/** The def's shape moved to world coordinates at `at` (a ring or circle carries dir 0). */
function placed(s: Shape, at: { x: number; z: number }): Shape {
  switch (s.kind) {
    case 'ring': return { kind: 'ring', x: at.x + s.x, z: at.z + s.z, dir: 0, inner: s.inner, r: s.r };
    case 'circle': return { kind: 'circle', x: at.x + s.x, z: at.z + s.z, r: s.r };
    case 'cone': return { ...s, x: at.x + s.x, z: at.z + s.z };
    case 'line': return { ...s, x: at.x + s.x, z: at.z + s.z };
  }
}

/** A field of `def` owned by `owner`, its shape moved to the owner's camp; first tick at nowS + FIELD_TICK_S. Returns its id. */
export function addField(w: CombatWorld, owner: EnemyState, def: FieldDef, nowS: number): number {
  // never earlier than the engine's latest time: a stale stamp would owe several ticks at once
  nowS = Number.isFinite(nowS) && nowS > w.now ? nowS : w.now;
  const id = w.nextFieldId++;
  const f: FieldState = {
    id, owner: owner.id, field: def.id, shape: placed(def.shape, owner.camp), raw: def.raw, startedAt: nowS, nextAt: nowS + FIELD_TICK_S,
  };
  w.fields.set(id, f);
  return id;
}

/** Removes every field `owner` (an enemy id) owns. */
export function removeFieldsOf(w: CombatWorld, owner: number): void {
  if (!w.fields.size) return;
  for (const f of w.fields.values()) if (f.owner === owner) w.fields.delete(f.id);
}

/** engine.tick, after enemy status: each field's due ticks land (a field whose owner is gone or dead is dropped). */
export function tickFields(w: CombatWorld, nowS: number): void {
  if (!w.fields.size) return;
  for (const f of w.fields.values()) {
    const owner = w.enemies.get(f.owner);
    if (!owner || !owner.alive) { w.fields.delete(f.id); continue; }
    for (let n = 0; f.nextAt <= nowS + TIME_EPS; n++) {
      // after a stall, at most CATCH_UP_TICKS land in one engine tick; the rest are skipped
      if (n >= CATCH_UP_TICKS) { while (f.nextAt <= nowS + TIME_EPS) f.nextAt += FIELD_TICK_S; break; }
      f.nextAt += FIELD_TICK_S;
      for (const a of w.adventurers.values()) {
        if (!a.alive || !inShape(f.shape, a.x, a.z)) continue;
        if (nowS < a.reviveSafeUntil) { w.out.fx.push({ t: 'miss', src: owner.id, dst: a.id, perfect: false }); continue; }
        hurtAdventurer(w, a, enemyHit(f.raw, a.stats.defence, takenMult(w, a, owner, nowS)), owner.id, 'field', nowS);
      }
    }
  }
}
