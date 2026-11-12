// Ally focus: the adventurer an ally-aimed ability (a heal, a shield, Shelter, Second Dawn) should land on.
// A tap on another adventurer focuses them (again: clears it), F cycles through those within 18 m, nearest
// first. The focus goes when they leave the view or after 30 s without use. Without a focus the server's aim
// rule picks (the lowest health in range): aimHint guesses the same pick, so the HUD can show who it is.
// The server always decides; this only says who the client asks for.
import { Color3, MeshBuilder, StandardMaterial, type Mesh, type Scene, type TransformNode } from '@babylonjs/core';
import { ALLY_RANGE, RANGE_FUZZ, type AbilityData } from '@sg2/shared';

/** F cycles through adventurers this close, in m. */
export const FOCUS_RANGE = ALLY_RANGE;
/** A focus not used (no ally-aimed ability sent, no tap) for this long is dropped, in ms. */
export const FOCUS_IDLE_MS = 30_000;

/** One adventurer as the hint sees it (engine id, ground position, health). */
export interface AllyPos { id: number; x: number; z: number; hp: number; maxHp: number; alive: boolean }

export function createAllyFocus() {
  let id: number | null = null, usedAt = -Infinity;
  return {
    get id() { return id; },
    /** A tap on adventurer `eid`: focuses them, or clears the focus when they already have it. */
    tap(eid: number, nowMs: number): number | null {
      id = id === eid ? null : eid; usedAt = nowMs;
      return id;
    },
    /** F: the next adventurer outward from the focus (nearest first, wrapping) within FOCUS_RANGE; none clears it. */
    cycle(me: { x: number; z: number }, others: readonly AllyPos[], nowMs: number): number | null {
      const near = others.map((o) => ({ id: o.id, d: Math.hypot(o.x - me.x, o.z - me.z) }))
        .filter((o) => o.d <= FOCUS_RANGE).sort((a, b) => a.d - b.d || a.id - b.id);
      if (near.length === 0) { id = null; return null; }
      const i = id === null ? -1 : near.findIndex((o) => o.id === id);
      id = near[(i + 1) % near.length].id; usedAt = nowMs;
      return id;
    },
    /** An ability went out aimed at the focus: it stays for another FOCUS_IDLE_MS. */
    use(nowMs: number) { if (id !== null) usedAt = nowMs; },
    /** Per frame: drops a focus that left the view, or went unused too long. */
    update(inView: (eid: number) => boolean, nowMs: number) {
      if (id !== null && (!inView(id) || nowMs - usedAt > FOCUS_IDLE_MS)) id = null;
    },
    clear() { id = null; },
  };
}
export type AllyFocus = ReturnType<typeof createAllyFocus>;

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Who `ab` would most likely land on (the server's resolveAim, without its sight check): the engine id, or
 * null when it lands on nobody (an enemy aim; other-ally or dead-ally with nobody there).
 * - ally: the focus if alive and within range + RANGE_FUZZ, else the lowest hp/maxHp within range, self
 *   included (ties: self, then the lower id);
 * - other-ally: the same without self;
 * - dead-ally: the focus if dead and within range, else the nearest dead one (ties: the lower id).
 */
export function aimHint(
  ab: Pick<AbilityData, 'aim' | 'range'>, focus: number | null, me: AllyPos, others: readonly AllyPos[],
  /** Who the server's own pick may choose besides self (Plan 4: party members); default everyone. A focus may be anyone. */
  allied: (id: number) => boolean = () => true,
): number | null {
  const limit = ab.range + RANGE_FUZZ;
  switch (ab.aim) {
    case 'enemy': return null;
    case 'self': return me.id;
    case 'ally': case 'other-ally': {
      const withSelf = ab.aim === 'ally';
      const near = (b: AllyPos) => b.alive && b.id !== me.id && dist(me, b) <= limit;
      const want = focus === null ? undefined : others.find((o) => o.id === focus);
      if (want && near(want)) return want.id;
      let best: AllyPos | null = withSelf && me.alive ? me : null;
      let bestF = best ? me.hp / me.maxHp : Infinity;
      for (const b of others) {
        if (!near(b) || !allied(b.id)) continue;
        const f = b.hp / b.maxHp;
        if (f < bestF - 1e-12 || (Math.abs(f - bestF) <= 1e-12 && best !== me && (best === null || b.id < best.id))) { best = b; bestF = f; }
      }
      return best ? best.id : withSelf ? me.id : null;
    }
    case 'dead-ally': {
      const ok = (b: AllyPos) => !b.alive && b.id !== me.id && dist(me, b) <= limit;
      const want = focus === null ? undefined : others.find((o) => o.id === focus);
      if (want && ok(want)) return want.id;
      let best: AllyPos | null = null, bestD = Infinity;
      for (const b of others) {
        if (!ok(b) || !allied(b.id)) continue;
        const d = dist(me, b);
        if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best !== null && b.id < best.id)) { best = b; bestD = d; }
      }
      return best ? best.id : null;
    }
  }
}

/** The green ring on the ground under the focused adventurer. */
export function createFocusRing(scene: Scene) {
  const mat = new StandardMaterial('allyFocusRingMat', scene);
  mat.disableLighting = true; mat.emissiveColor = Color3.FromHexString('#8FD16A'); mat.alpha = 0.85; mat.zOffset = -2;
  const ring: Mesh = MeshBuilder.CreateTorus('allyFocusRing', { diameter: 1.35, thickness: 0.1, tessellation: 40 }, scene);
  ring.scaling.y = 0.2; ring.position.y = 0.06; ring.isPickable = false; ring.material = mat; ring.setEnabled(false);
  let on: TransformNode | null = null, t = 0;
  return {
    /** Under `root` (a character's root), or hidden (null). */
    attach(root: TransformNode | null) {
      if (root === on) return;
      on = root;
      ring.parent = root;
      ring.setEnabled(!!root);
    },
    update(dt: number) {
      if (!on) return;
      t += dt;
      const s = 1 + 0.06 * Math.sin(t * 4);
      ring.scaling.x = ring.scaling.z = s;
    },
    dispose() { ring.dispose(); mat.dispose(); },
  };
}
