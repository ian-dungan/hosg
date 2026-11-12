// The Lampfall's encounters: what stands in each room. The dungeon generator places a camp per encounter
// (rotating the spawns into the room's own entry direction) and the simulation fights it. The party enters
// each room from −z of its centre; dx, dz are metres from the room centre.
import { deepFreeze } from './freeze';
import type { EnemyKindId } from './enemies';

export type EncounterId = 'root_cellar' | 'brass_gallery' | 'cog_hall' | 'wickhound' | 'warden';
export interface EncounterSpawn { readonly kind: EnemyKindId; readonly dx: number; readonly dz: number }
export interface EncounterData {
  readonly id: EncounterId;
  /** The room's name. */
  readonly room: string;
  /** The room's floor radius (m). */
  readonly roomR: number;
  readonly spawns: readonly EncounterSpawn[];
  /** The boss of a boss room (its arena is sealed while the fight lasts). */
  readonly boss?: EnemyKindId;
}

export const ENCOUNTERS: Readonly<Record<EncounterId, EncounterData>> = deepFreeze({
  root_cellar: {
    id: 'root_cellar', room: 'Root Cellar', roomR: 11,
    spawns: [{ kind: 'thornling', dx: -3, dz: 2 }, { kind: 'thornling', dx: 3, dz: 2 }, { kind: 'archer', dx: 0, dz: 6 }],
  },
  brass_gallery: {
    id: 'brass_gallery', room: 'Brass Gallery', roomR: 13,
    spawns: [{ kind: 'mossback', dx: 0, dz: 2 }, { kind: 'thornling', dx: -4, dz: 5 }, { kind: 'thornling', dx: 4, dz: 5 }],
  },
  cog_hall: {
    id: 'cog_hall', room: 'Cog Hall', roomR: 12,
    spawns: [{ kind: 'boar', dx: -3, dz: 1 }, { kind: 'boar', dx: 3, dz: 1 }, { kind: 'archer', dx: -4, dz: 6 }, { kind: 'archer', dx: 4, dz: 6 }],
  },
  wickhound: { id: 'wickhound', room: 'Wick Den', roomR: 16, spawns: [{ kind: 'wickhound', dx: 0, dz: 0 }], boss: 'wickhound' },
  warden: { id: 'warden', room: 'Lens Pit', roomR: 22, spawns: [{ kind: 'fallen_warden', dx: 0, dz: 0 }], boss: 'fallen_warden' },
});

/** In the Numbers table's order (the generator decides where each room goes). */
export const ENCOUNTER_IDS: readonly EncounterId[] = deepFreeze(['root_cellar', 'brass_gallery', 'cog_hall', 'wickhound', 'warden']);
