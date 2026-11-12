import { describe, expect, it } from 'vitest';
import { ABILITIES, FINISHER_COST, TELEGRAPH_LEAD_S, type SelfView } from '@sg2/shared';
import { ABILITY_DEFS } from './abilityDefs';
import { CHARGE_SELF_LAG_MS, chargeStillHeld, cycleTarget, isNewSeq, keepFollowing, refusalIsForCharge, screenToWorld, slotView, tapAction, telegraphFill, type SelfSnap } from './controller';

const P = { x: 1, y: 0, z: 2 };

describe('tapAction', () => {
  const enemies = new Set([7, 8]);
  it('an enemy tap targets it, and walks only with tap-to-walk on and out of range', () => {
    expect(tapAction({ entityId: 7, point: null }, { tapToWalk: true }, enemies, 10, 2.5)).toEqual({ target: 7, walk: 'enemy' });
    expect(tapAction({ entityId: 7, point: null }, { tapToWalk: true }, enemies, 2, 2.5)).toEqual({ target: 7, walk: null });
    expect(tapAction({ entityId: 8, point: null }, { tapToWalk: false }, enemies, 10, 2.5)).toEqual({ target: 8, walk: null });
  });
  it('a ground tap walks only with tap-to-walk on, and never targets', () => {
    expect(tapAction({ entityId: null, point: P }, { tapToWalk: true }, enemies, Infinity, 2.5)).toEqual({ target: undefined, walk: 'ground' });
    expect(tapAction({ entityId: null, point: P }, { tapToWalk: false }, enemies, Infinity, 2.5)).toEqual({ target: undefined, walk: null });
    // something that is not an enemy (a person, the adventurer itself) is ground for combat
    expect(tapAction({ entityId: 3, point: P }, { tapToWalk: true }, enemies, Infinity, 2.5)).toEqual({ target: undefined, walk: 'ground' });
    expect(tapAction({ entityId: null, point: null }, { tapToWalk: true }, enemies, Infinity, 2.5)).toEqual({ target: undefined, walk: null });
  });
});

describe('abilityDefs', () => {
  it('maps all ten abilities with their glyph, cooldown and kind', () => {
    const ids = Object.keys(ABILITIES);
    expect(ids).toHaveLength(10);
    for (const id of ids) {
      const a = ABILITIES[id as keyof typeof ABILITIES], d = ABILITY_DEFS[id as keyof typeof ABILITIES];
      expect(d).toMatchObject({ id, name: a.name, glyph: a.glyph, cooldown: a.cooldown, kind: a.kind, weapon: a.weapon, range: a.range, desc: a.desc });
    }
    expect(ABILITY_DEFS.charged_shot.castTime).toBe(1.5);
    expect(ABILITY_DEFS.slash.castTime).toBe(0);
  });
});

const self = (over: Partial<SelfView> = {}, at = 0): SelfSnap => ({
  momentum: 0, weapon: 'blade', slots: ['slash', 'sunder', 'parry', 'mend', 'bulwark'], cd: [0, 0, 0, 0, 0], gcd: 0, swapCd: 0, swapLock: 0,
  dodgeCharges: 2, dodgeNextIn: 0, charge: null, inCombat: false, ...over, at,
});

describe('slotView', () => {
  it('five slots in order, with their definitions', () => {
    const v = slotView(self(), 0);
    expect(v.map((s) => s.ability.id)).toEqual(['slash', 'sunder', 'parry', 'mend', 'bulwark']);
  });
  it('the finisher is unusable below 50 Momentum, usable from 50', () => {
    expect(slotView(self({ momentum: FINISHER_COST - 1 }), 0)[1].usable).toBe(false);
    expect(slotView(self({ momentum: FINISHER_COST }), 0)[1].usable).toBe(true);
    expect(slotView(self({ momentum: 0 }), 0)[0].usable).toBe(true);
  });
  it('cooldowns count down from when `self` arrived; the GCD alone never fills a ready slot with numbers', () => {
    const v = slotView(self({ cd: [4, 0, 0, 0, 0], gcd: 0.5 }, 1000), 2000);
    expect(v[0].cdRemaining).toBeCloseTo(3);
    expect(v[1].cdRemaining).toBe(0);
    const w = slotView(self({ cd: [4, 0.2, 0, 0, 0], gcd: 0.5 }, 1000), 1100);
    expect(w[1].cdRemaining).toBeCloseTo(0.4); // its own 0.1 left, the GCD's 0.4 longer
    expect(w[2].cdRemaining).toBe(0);
  });
  it('nothing is usable while dead; no self, no slots', () => {
    expect(slotView(self({ momentum: 100 }), 0, true).every((s) => !s.usable)).toBe(true);
    expect(slotView(null, 0)).toEqual([]);
  });
});

describe('telegraphFill', () => {
  it('fills from first sight and reaches 1 at total − 0.15 s', () => {
    expect(telegraphFill(1000, 1000, 1.0)).toBe(0);
    expect(telegraphFill(1000, 1000 + (1.0 - TELEGRAPH_LEAD_S) * 500, 1.0)).toBeCloseTo(0.5);
    expect(telegraphFill(1000, 1000 + (1.0 - TELEGRAPH_LEAD_S) * 1000, 1.0)).toBe(1);
    expect(telegraphFill(1000, 5000, 1.0)).toBe(1);
    expect(telegraphFill(1000, 900, 1.0)).toBe(0);
    expect(telegraphFill(0, 0, 0.1)).toBe(1); // shorter than the lead: full at once
  });
});

describe('cycleTarget', () => {
  const list = [{ eid: 4, d: 9 }, { eid: 2, d: 3 }, { eid: 9, d: 30 }, { eid: 5, d: 45 }];
  it('Tab goes nearest first, then on outward, and wraps; only within 40 m', () => {
    expect(cycleTarget(null, list)).toBe(2);
    expect(cycleTarget(2, list)).toBe(4);
    expect(cycleTarget(4, list)).toBe(9);
    expect(cycleTarget(9, list)).toBe(2);
    expect(cycleTarget(77, list)).toBe(2);
    expect(cycleTarget(null, [])).toBeNull();
  });
});

describe('screenToWorld', () => {
  it('turns a screen-space input direction into a ground direction for the camera, null = facing', () => {
    // camera behind an adventurer facing +Z: alpha = -π/2, so "up" on screen is +Z and "right" is +X
    const up = screenToWorld({ x: 0, y: 1 }, -Math.PI / 2, 0);
    expect(up.x).toBeCloseTo(0); expect(up.z).toBeCloseTo(1);
    const f = screenToWorld(null, -Math.PI / 2, Math.PI / 2);
    expect(f.x).toBeCloseTo(1); expect(f.z).toBeCloseTo(0);
    const r = screenToWorld({ x: 1, y: 0 }, -Math.PI / 2, 0);
    expect(Math.hypot(r.x, r.z)).toBeCloseTo(1);
  });
});

describe('Task 8 review round 1', () => {
  it('a displaced/respawned sent again after a reconnect (seq already applied) is ignored; a newer one is not', () => {
    expect(isNewSeq(3, 3)).toBe(false);
    expect(isNewSeq(3, 2)).toBe(false);
    expect(isNewSeq(3, 4)).toBe(true);
    expect(isNewSeq(0, 1)).toBe(true);
  });
  it('a walk toward an enemy stops when there is no way there, or once the player steers themselves', () => {
    expect(keepFollowing(false, 100, 0)).toBe(false); // no path: give up instead of searching every frame
    expect(keepFollowing(true, 100, 50)).toBe(true);
    expect(keepFollowing(true, 100, 150)).toBe(false); // keys or joystick since it began
  });
  it('a held Charged Shot ends when a self a round trip after the press shows no charge (blur, swap, auto-release)', () => {
    const press = 1000;
    expect(chargeStillHeld(press, null)).toBe(true);
    expect(chargeStillHeld(press, { at: press + 50, charge: null })).toBe(true); // sent before the press reached the server
    expect(chargeStillHeld(press, { at: press + CHARGE_SELF_LAG_MS + 1, charge: 0.4 })).toBe(true);
    expect(chargeStillHeld(press, { at: press + CHARGE_SELF_LAG_MS + 1, charge: null })).toBe(false);
  });
  it('an ability refusal ends the pending charge only when the last press was the charge slot', () => {
    expect(refusalIsForCharge({ slot: 2, at: 1000 }, 2, 1200)).toBe(true);
    expect(refusalIsForCharge({ slot: 3, at: 1100 }, 2, 1200)).toBe(false); // a Mend pressed since
    expect(refusalIsForCharge({ slot: 2, at: 1000 }, 2, 1700)).toBe(false);
    expect(refusalIsForCharge(null, 2, 1000)).toBe(false);
  });
});
