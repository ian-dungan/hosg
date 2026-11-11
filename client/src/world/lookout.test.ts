// The Old Lookout: five stone tiers 0.9 m apart, climbed only by jumping tier to tier, with a 4.5 m
// drop from the top. Checked with the shared controller over the shared grove walk (what the
// server and the local adventurer both use).
import { describe, expect, it } from 'vitest';
import { stepBody, makeBody, RUN_SPEED, type Body, type BodyStep } from '@sg2/shared';
import { createGroveWalk, groundHeight } from './layout';
import { LOOKOUT } from './lookout';

const walk = createGroveWalk();
const surface = (x: number, z: number) => walk.surfaceAt(x, z);
const DT = 1 / 30;
const tiers = LOOKOUT.tiers;
const close = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-6;

/** World point from a tier's local coordinates (same convention as Rect obstacles). */
const world = (t: (typeof tiers)[number], lx: number, lz: number) => {
  const c = Math.cos(t.yaw), s = Math.sin(t.yaw);
  return { x: t.x + c * lx + s * lz, z: t.z - s * lx + c * lz };
};
/** Points of tier i where an adventurer stands on that tier (its exposed ledge), on a 0.4 m grid. */
function ledge(i: number): { x: number; z: number }[] {
  const t = tiers[i], out: { x: number; z: number }[] = [];
  for (let lx = -t.hw + 0.2; lx < t.hw; lx += 0.4) for (let lz = -t.hd + 0.2; lz < t.hd; lz += 0.4) {
    const p = world(t, lx, lz);
    if (close(surface(p.x, p.z), t.top)) out.push(p);
  }
  return out;
}
const copy = (b: Body): Body => ({ ...b });

/** Runs toward (tx, tz) at RUN_SPEED for at most `secs`, jumping once after `jumpAfter` metres (never if null). */
function run(b: Body, tx: number, tz: number, jumpAfter: number | null, secs = 3, stopWithin = 0.25): BodyStep[] {
  const steps: BodyStep[] = [];
  const sx = b.x, sz = b.z;
  let jumped = false;
  for (let t = 0; t < secs; t += DT) {
    const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
    if (d < stopWithin && b.grounded) break;
    const jump = jumpAfter !== null && !jumped && Math.hypot(b.x - sx, b.z - sz) >= jumpAfter;
    if (jump) jumped = true;
    const v = d > 1e-6 ? Math.min(RUN_SPEED, d / DT) / d : 0;
    steps.push(stepBody(b, { vx: dx * v, vz: dz * v, jump }, DT, surface));
  }
  return steps;
}

describe('the Old Lookout', () => {
  it('has five tiers, each exactly 0.9 m above the last (the first 0.9 m above the terrain)', () => {
    expect(tiers).toHaveLength(5);
    expect(Math.abs(tiers[0].top - groundHeight(LOOKOUT.x, LOOKOUT.z) - 0.9)).toBeLessThanOrEqual(0.05);
    for (let i = 1; i < tiers.length; i++) expect(tiers[i].top - tiers[i - 1].top).toBeCloseTo(0.9, 9);
  });

  it('is inside the town, where the shared walk honours platform tops', () => {
    for (const t of tiers) expect(Math.hypot(t.x, t.z)).toBeLessThan(110);
  });

  it('every tier has a ledge at least 2.4 m deep to land on, and the top is about 4 x 4 m', () => {
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      // some 2.4 x 2.4 m square of the tier is all at its top height
      let found = false;
      for (let cx = -t.hw + 1.2; cx <= t.hw - 1.2 + 1e-9 && !found; cx += 0.2) for (let cz = -t.hd + 1.2; cz <= t.hd - 1.2 + 1e-9 && !found; cz += 0.2) {
        let all = true;
        for (let ox = -1.15; ox <= 1.15 + 1e-9 && all; ox += 0.23) for (let oz = -1.15; oz <= 1.15 + 1e-9 && all; oz += 0.23) {
          const p = world(t, cx + ox, cz + oz); const s = surface(p.x, p.z);
          if (!close(s, t.top) && !(i === 4 && s !== null && s >= t.top)) all = false; // the bench on top counts as top
        }
        if (all) found = true;
      }
      expect(found, `tier ${i + 1}`).toBe(true);
    }
    const top = tiers[4];
    expect(top.hw * 2).toBeGreaterThan(3.5); expect(top.hw * 2).toBeLessThan(5);
    expect(top.hd * 2).toBeGreaterThan(3.5); expect(top.hd * 2).toBeLessThan(5);
  });

  it('cannot be climbed onto tier 1 without jumping', () => {
    const t = tiers[0];
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const r = Math.max(t.hw, t.hd) * Math.SQRT2 + 1.5;
      const sx = LOOKOUT.x + Math.cos(a) * r, sz = LOOKOUT.z + Math.sin(a) * r;
      if (surface(sx, sz) === null) continue;
      const b = makeBody(sx, sz, surface);
      for (let t2 = 0; t2 < 3; t2 += DT) {
        const dx = LOOKOUT.x - b.x, dz = LOOKOUT.z - b.z, d = Math.hypot(dx, dz) || 1;
        stepBody(b, { vx: (dx / d) * RUN_SPEED, vz: (dz / d) * RUN_SPEED, jump: false }, DT, surface);
        expect(b.y).toBeLessThan(t.top - 0.3);
      }
    }
  });

  it('can be climbed from the ground to the top by running and jumping tier to tier', () => {
    // start on the ground beside tier 1's ledge, on the side away from the rest of the outcrop
    const l0 = ledge(0);
    expect(l0.length).toBeGreaterThan(10);
    const t0 = tiers[0];
    let body: Body | null = null;
    for (const lx of [-t0.hw - 2, t0.hw + 2]) {
      const p = world(t0, lx, 0);
      if (surface(p.x, p.z) !== null && surface(p.x, p.z)! < t0.top - 0.5) { body = makeBody(p.x, p.z, surface); break; }
    }
    expect(body).not.toBeNull();
    let b = body!;
    for (let i = 0; i < tiers.length; i++) {
      const goal = ledge(i);
      expect(goal.length, `tier ${i + 1} ledge`).toBeGreaterThan(4);
      const gx = goal.reduce((s, p) => s + p.x, 0) / goal.length, gz = goal.reduce((s, p) => s + p.z, 0) / goal.length;
      // where it may run up from: anywhere on the current ledge (or the ground start), walking there first
      const starts = i === 0 ? [{ x: b.x, z: b.z }] : ledge(i - 1);
      let made: Body | null = null;
      for (const st of starts) {
        const s = copy(b);
        run(s, st.x, st.z, null, 4, 0.05);
        if (i > 0) expect(close(s.y, tiers[i - 1].top), 'walks about on its ledge').toBe(true);
        for (let jd = 0; jd <= 3 && !made; jd += 0.25) {
          const t = copy(s);
          run(t, gx, gz, jd, 3);
          if (t.grounded && t.y >= tiers[i].top - 0.05 && close(surface(t.x, t.z), tiers[i].top)) made = t;
        }
        if (made) break;
      }
      expect(made, `reach tier ${i + 1}`).not.toBeNull();
      b = made!;
    }
    expect(b.y).toBeGreaterThanOrEqual(tiers[4].top - 0.05);
  });

  it('walking off the top drops 4.5 m to the ground', () => {
    const top = tiers[4];
    const b = makeBody(top.x, top.z, surface);
    expect(b.y).toBeCloseTo(top.top, 6);
    // the outcrop's sheer side is local +X of the tiers
    const far = world(top, top.hw + 4, 0);
    const steps = run(b, far.x, far.z, null, 3);
    const land = steps.find(s => s.landed);
    expect(land).toBeDefined();
    expect(Math.abs(land!.drop - 4.5)).toBeLessThanOrEqual(0.1);
  });
});
