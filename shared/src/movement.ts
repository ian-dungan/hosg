// Movement messages: parsing a client's pose and checking a step is possible.
import { RUN_SPEED } from './constants';

export interface Pose { x: number; z: number; facing: number; moving: boolean }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A clean Pose (known fields only), or null unless x, z and facing are finite numbers and moving is a boolean. */
export function parsePose(msg: unknown): Pose | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (!finite(m.x) || !finite(m.z) || !finite(m.facing) || typeof m.moving !== 'boolean') return null;
  return { x: m.x, z: m.z, facing: m.facing, moving: m.moving };
}

/** Longest gap between two moves that still earns more allowed distance. */
const MAX_STEP_DT = 1;

/** Whether an adventurer at `from` can reach `to` within `dtSeconds` (a non-finite dt counts as 0), given the walkable test. */
export function checkStep(
  from: { x: number; z: number },
  to: Pose,
  dtSeconds: number,
  walkable: (x: number, z: number) => boolean,
): 'ok' | 'too-fast' | 'blocked' {
  const dt = Number.isFinite(dtSeconds) ? Math.min(MAX_STEP_DT, Math.max(0, dtSeconds)) : 0;
  const allowed = RUN_SPEED * 1.3 * dt + 0.5;
  if (Math.hypot(to.x - from.x, to.z - from.z) > allowed) return 'too-fast';
  if (!walkable(to.x, to.z)) return 'blocked';
  return 'ok';
}
