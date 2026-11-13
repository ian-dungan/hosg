// Emote poses (EMOTES: wave, bow, cheer, laugh, sit, point), each about 1.5 s; `sit` holds until a move. Pure: it
// writes joint angles (rad) and offsets into a pose record the character blends over its idle pose.
import type { EmoteId } from '@sg2/shared';

/** How long each emote plays (s); sit loops (it eases in over this and then holds). */
export const EMOTE_S = 1.5;
/** Emotes that hold until a move ends them. */
export const LOOPING_EMOTES: ReadonlySet<EmoteId> = new Set<EmoteId>(['sit']);

const ease = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

/**
 * The emote's pose at `t` s into it: every channel it moves is written to `o` (channels are 'joint.rx' style, plus
 * 'base.py' and 'hips.py' in m of the canonical body; `legK` scales the drop of a sit to the legs' length).
 * Returns the blend weight (0..1): it eases in and, for one-shots, back out at the end.
 */
export function emotePose(o: Record<string, number>, id: EmoteId, t: number, legK = 1): number {
  const loop = LOOPING_EMOTES.has(id);
  const w = loop ? ease(t / 0.35) : Math.min(ease(t / 0.2), ease((EMOTE_S - t) / 0.25));
  const env = ease(t / 0.3);
  switch (id) {
    case 'wave': {
      const wv = Math.sin(t * 11);
      o['uArmR.rz'] = 2.45; o['uArmR.rx'] = -0.25; o['fArmR.rz'] = 0.35 + 0.45 * wv; o['fArmR.rx'] = -0.25;
      o['uArmL.rz'] = -0.1; o['fArmL.rx'] = -0.2;
      o['head.rz'] = -0.08; o['head.ry'] = 0.05; o['torso.rz'] = -0.05;
      break;
    }
    case 'bow': {
      const k = t < 0.45 ? ease(t / 0.45) : t < 1.0 ? 1 : 1 - ease((t - 1.0) / 0.4);
      o['torso.rx'] = 0.75 * k; o['head.rx'] = 0.25 * k; o['hips.rx'] = 0.1 * k;
      o['uArmR.rx'] = -0.55 * k; o['fArmR.rx'] = -1.5 * k; o['fArmR.ry'] = -0.6 * k; o['uArmR.rz'] = 0.15;
      o['uArmL.rx'] = 0.35 * k; o['uArmL.rz'] = -0.15; o['fArmL.rx'] = -0.2;
      o['thighL.rx'] = -0.12 * k; o['thighR.rx'] = -0.12 * k;
      break;
    }
    case 'cheer': {
      const pump = Math.abs(Math.sin(t * 7));
      o['uArmL.rz'] = -2.55 * env - 0.2 * pump; o['uArmR.rz'] = 2.55 * env + 0.2 * pump;
      o['fArmL.rz'] = -0.3; o['fArmR.rz'] = 0.3; o['fArmL.rx'] = -0.2; o['fArmR.rx'] = -0.2;
      o['hips.py'] = 0.03 * pump * env; o['head.rx'] = -0.25; o['torso.rx'] = -0.08;
      o['thighL.rx'] = -0.05 * pump; o['thighR.rx'] = -0.05 * pump;
      break;
    }
    case 'laugh': {
      const sh = Math.sin(t * 17) * env;
      o['torso.rx'] = -0.12 + 0.07 * sh + (t > 0.8 ? 0.25 * ease((t - 0.8) / 0.3) : 0);
      o['head.rx'] = -0.35 + 0.08 * sh; o['head.rz'] = 0.05 * Math.sin(t * 5);
      o['uArmL.rx'] = -0.35; o['uArmR.rx'] = -0.35; o['fArmL.rx'] = -1.3; o['fArmR.rx'] = -1.3;
      o['uArmL.rz'] = -0.25; o['uArmR.rz'] = 0.25; o['fArmL.ry'] = 0.8; o['fArmR.ry'] = -0.8;
      o['hips.py'] = 0.012 * sh;
      break;
    }
    case 'sit': {
      const k = env;
      o['base.py'] = -0.46 * legK * k; o['hips.rx'] = -0.05 * k; o['torso.rx'] = 0.16 * k; o['head.rx'] = -0.1 * k;
      o['thighL.rx'] = -1.45 * k; o['thighR.rx'] = -1.4 * k; o['thighL.rz'] = -0.18 * k; o['thighR.rz'] = 0.18 * k;
      o['shinL.rx'] = 1.25 * k; o['shinR.rx'] = 1.15 * k;
      o['uArmL.rx'] = -0.55 * k; o['uArmR.rx'] = -0.55 * k; o['fArmL.rx'] = -0.5 * k; o['fArmR.rx'] = -0.5 * k;
      o['uArmL.rz'] = -0.12; o['uArmR.rz'] = 0.12;
      break;
    }
    case 'point': {
      const k = t < 0.3 ? ease(t / 0.3) : 1;
      o['uArmR.rx'] = -1.5 * k; o['uArmR.rz'] = 0.1; o['fArmR.rx'] = -0.05; o['torso.ry'] = -0.18 * k; o['head.ry'] = -0.05 * k;
      o['uArmL.rx'] = 0.05; o['uArmL.rz'] = -0.12; o['fArmL.rx'] = -0.25; o['thighL.rx'] = -0.15 * k; o['shinL.rx'] = 0.1 * k;
      break;
    }
  }
  return w;
}
