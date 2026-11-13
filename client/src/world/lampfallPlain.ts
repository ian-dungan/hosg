// The Lampfall's walk and rooms for the client, from the shared layout (lampfallLayout()): movement and prediction
// use the shared walk with every shut gate a wall (gatedSurface, as on the server), so an honest adventurer is never
// corrected at a gate. (The placeholder look that lived here went when world/lampfall.ts built the real one.)
import { gatedSurface, lampfallLayout, type DungeonLayout, type Surface } from '@sg2/shared';

/** What the Lampfall needs from the room: the shut-gate bits and whether the lamp-lift is open. */
export interface LampfallLive { gates(): number; lift(): boolean }

/** The walk with every shut gate (as `gates()` says now) a wall: the same wrapper the server uses. */
export function lampfallSurfaces(gates: () => number, layout: DungeonLayout = lampfallLayout()): { surface: Surface; ground: Surface } {
  const walk = layout.walk;
  return {
    surface: gatedSurface((x, z) => walk.surfaceAt(x, z), gates),
    ground: gatedSurface((x, z) => walk.groundAt(x, z), gates),
  };
}

/** The room the point (x, z) is in, or null (a corridor, or off the floor). */
export function lampfallRoomAt(x: number, z: number, layout: DungeonLayout = lampfallLayout()) {
  for (const r of layout.rooms) if ((x - r.x) * (x - r.x) + (z - r.z) * (z - r.z) <= r.r * r.r) return r;
  return null;
}
