// The Lampfall's lamp-gates and boss arenas (rulings P4-a, P4-b, P4-c): which gate circles there are,
// a shut gate as a wall (the same wrapper for the server's instance, the client's prediction and the
// bots), and the sealed part of each boss room. Gate state is a bit mask the server sends in its state
// (ZoneState.gates): a set bit is a shut gate. Everything is read from lampfallLayout(), never placed.
import type { Surface } from '../body';
import { lampfallLayout, type DungeonRoom, type Gate } from './dungeon';

/** The Wick Den's entry gate: shut from SEAL_DELAY_S after the Wickhound wakes until it dies or resets. */
export const GATE_WICK = 1;
/** The Wick Den's way on to the landing: shut from the instance's start until the Wickhound is cleared (P4-a). */
export const GATE_WICK_EXIT = 2;
/** The Lens Pit's entry gate: shut from SEAL_DELAY_S after the Warden wakes until it dies or resets. */
export const GATE_PIT = 4;

export type ArenaEncounter = 'wickhound' | 'warden';

/** One gate circle, the room it closes, and the way from the gate centre into that room (unit vector). */
export interface LampGate {
  readonly bit: number; readonly encounter: ArenaEncounter; readonly x: number; readonly z: number; readonly r: number;
  readonly room: { readonly x: number; readonly z: number; readonly r: number };
  readonly ux: number; readonly uz: number;
}

const roomOf = (encounter: ArenaEncounter): DungeonRoom => {
  const layout = lampfallLayout();
  const i = layout.recipe.rooms.findIndex((spec) => spec.encounter === encounter);
  return layout.rooms[i];
};

function gateOf(bit: number, encounter: ArenaEncounter, room: DungeonRoom, g: Gate): LampGate {
  const dx = room.x - g.x, dz = room.z - g.z, d = Math.sqrt(dx * dx + dz * dz);
  return Object.freeze({ bit, encounter, x: g.x, z: g.z, r: g.r, room: Object.freeze({ x: room.x, z: room.z, r: room.r }), ux: dx / d, uz: dz / d });
}

let gates: readonly LampGate[] | null = null;
/** Every lamp-gate of the Lampfall (the Wick Den's two, the Lens Pit's one), built once. */
export function lampfallGates(): readonly LampGate[] {
  if (!gates) {
    const den = roomOf('wickhound'), pit = roomOf('warden');
    gates = Object.freeze([gateOf(GATE_WICK, 'wickhound', den, den.gate!), gateOf(GATE_WICK_EXIT, 'wickhound', den, den.exitGate!), gateOf(GATE_PIT, 'warden', pit, pit.gate!)]);
  }
  return gates;
}

/** The shut gate whose circle holds (x, z) (its edge included), or null. */
export function shutGateAt(mask: number, x: number, z: number): LampGate | null {
  if (mask === 0) return null;
  for (const g of lampfallGates()) {
    if ((mask & g.bit) === 0) continue;
    const dx = x - g.x, dz = z - g.z;
    if (dx * dx + dz * dz <= g.r * g.r) return g;
  }
  return null;
}

/** `surface` with every shut gate circle (as `mask()` says now) a wall: nothing stands, walks, rolls or is knocked into it. */
export function gatedSurface(surface: Surface, mask: () => number): Surface {
  return (x, z) => (shutGateAt(mask(), x, z) ? null : surface(x, z));
}

/** `sight` blocked by every shut gate circle (nobody sees, heals or revives through a shut gate). */
export function gatedSight(sight: (x: number, z: number) => boolean, mask: () => number): (x: number, z: number) => boolean {
  return (x, z) => !shutGateAt(mask(), x, z) && sight(x, z);
}

/** A shut gate the straight step from `from` to `to` touches (sampled every 0.25 m, ends included), or null. */
export function shutGateOnStep(mask: number, from: { x: number; z: number }, to: { x: number; z: number }): LampGate | null {
  if (mask === 0) return null;
  const dx = to.x - from.x, dz = to.z - from.z, n = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dz * dz) / 0.25));
  for (let i = 0; i <= n; i++) {
    const g = shutGateAt(mask, from.x + (dx * i) / n, from.z + (dz * i) / n);
    if (g) return g;
  }
  return null;
}

/** Where someone standing in a gate circle when it shuts is put: on the room side, 0.5 m clear of the circle. */
export function roomSideOf(g: LampGate): { x: number; z: number } {
  return { x: g.x + g.ux * (g.r + 0.5), z: g.z + g.uz * (g.r + 0.5) };
}

/**
 * The sealed part of a boss room (ruling P4-c): its floor and its corridors up to its gate circles'
 * centres, never inside a gate circle. Only adventurers here are hit by the boss and its fields, and only
 * they can hurt it.
 */
export function lampfallArena(encounter: ArenaEncounter): (x: number, z: number) => boolean {
  const own = lampfallGates().filter((g) => g.encounter === encounter);
  const room = own[0].room;
  const width = lampfallLayout().recipe.corridor.width;
  const strips = own.map((g) => {
    const dx = g.x - room.x, dz = g.z - room.z, d = Math.sqrt(dx * dx + dz * dz);
    return { ux: dx / d, uz: dz / d, d };
  });
  return (x, z) => {
    for (const g of own) if ((x - g.x) * (x - g.x) + (z - g.z) * (z - g.z) <= g.r * g.r) return false;
    if ((x - room.x) * (x - room.x) + (z - room.z) * (z - room.z) <= room.r * room.r) return true;
    for (const s of strips) {
      const a = (x - room.x) * s.ux + (z - room.z) * s.uz, lat = Math.abs((x - room.x) * -s.uz + (z - room.z) * s.ux);
      if (a > 0 && a <= s.d && lat <= width / 2 + 1e-9) return true;
    }
    return false;
  };
}
