// Lampfall instances: constants, the notices the server gives, and the instance as a client sees it.
// One instance per party (or 'solo:' + accountId); the server opens, seals, wipes and closes them.
import type { EncounterId } from './combat/encounters';

/** Lampfall instances open at once (48 adventurers at most). */
export const MAX_INSTANCES = 12;
/** An instance closes this long (s) after its last adventurer left (reconnect holds included); a cleared one at once. */
export const INSTANCE_EMPTY_S = 120;
/** Hard lifetime (s): then everyone inside is sent to the mouth with a notice. */
export const INSTANCE_MAX_S = 5400;
/** A dropped adventurer's seat inside is held this long (s). */
export const INSTANCE_RECONNECT_S = 120;
/** After leaving or being kicked from the party, an adventurer inside is sent to the mouth after this (s). */
export const INSTANCE_EVICT_S = 10;
/**
 * An adventurer inside with no pose change and no intent for this long (s) is sent to the crater mouth
 * with REASON_INSTANCE_IDLE (dead and idle counts as idle), never while engaged in a boss fight (inside an
 * awake boss's arena: the wipe and release rules handle that). Instances are few (MAX_INSTANCES).
 */
export const INSTANCE_IDLE_S = 300;
/** After a wipe, everyone gets up at the checkpoint after this (s). */
export const WIPE_DELAY_S = 5;
/** A dead adventurer in an instance may release (get up at the checkpoint) after this (s)… */
export const RELEASE_MIN_S = 10;
/** …and releases by itself after this (s). */
export const AUTO_RELEASE_S = 60;
/** A boss arena's gate shuts this long (s) after the boss wakes. */
export const SEAL_DELAY_S = 3;
/** Radius (m) of the gate circle on the arena's entry corridor. */
export const SEAL_GATE_R = 3.0;

/** Walking into the crater mouth while MAX_INSTANCES are open (corrected, with this notice). */
export const REASON_INSTANCES_FULL = 'The Lampfall is crowded right now, try again in a minute';
/** A pose into a sealed arena's gate (corrected, with this notice). */
export const REASON_ARENA_SEALED = 'The lamp-gate is shut until the fight ends';
/** The instance closed (its hard lifetime) with this adventurer inside: sent to the mouth. */
export const REASON_INSTANCE_CLOSED = 'The Lampfall has gone quiet; you climb back out';
/** Idle inside for INSTANCE_IDLE_S: sent to the mouth. */
export const REASON_INSTANCE_IDLE = 'You rested too long in the Lampfall, so you climb back out';
/** Left or kicked from the party while inside: sent to the mouth after INSTANCE_EVICT_S. */
export const REASON_LEFT_PARTY = 'You left the party, so you climb back out of the Lampfall';

export type CheckpointId = 'rim' | 'landing';

/** The instance as one adventurer inside sees it: sent on join and when it changes. */
export interface InstanceView {
  checkpoint: CheckpointId; cleared: EncounterId[];
  /** The boss room whose gate is shut. */
  sealed: EncounterId | null;
  /** Seconds until everyone gets up, during a wipe. */
  wipeIn: number | null;
  /** Seconds until this adventurer may release (dead only). */
  releaseIn: number | null;
  partySize: number;
  /** Wall-clock ms. */
  startedAt: number;
}

/** A boss kill as each credited adventurer sees it. */
export interface VictoryView {
  boss: 'wickhound' | 'fallen_warden'; seconds: number; partySize: number;
  xp: number; seal: boolean; seals: number; title: string | null; rank: number | null; lore: string;
}
