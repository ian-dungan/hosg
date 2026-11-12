import { describe, expect, it } from 'vitest';
import { ABILITIES, BUFF_BITS, CHARGE_FULL_S, DEBUFF_BITS, FINISHER_COST, JOBS, JOB_IDS, MARK_BITS, REASON_JOB_NOT_HERE, TELEGRAPH_LEAD_S, slotsFor, type SelfView } from '@sg2/shared';
import { ABILITY_DEFS } from './abilityDefs';
import {
  CHARGE_CONFIRM_MS, buffStatuses, castFrac, chargeStillHeld, createChargeHold, cycleTarget, isNewSeq, keepFollowing, markStatuses, refusalIsForCharge, refusalText, screenToWorld, slotView, tapAction, tapSubject, telegraphFill,
  type SelfSnap,
} from './controller';

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

describe('tapSubject', () => {
  const enemy = (id: number) => id >= 100, adv = (id: number) => id < 100;
  it('an enemy anywhere under the tap wins over an adventurer in front of it', () => {
    expect(tapSubject([5, 101], enemy, adv, 1)).toEqual({ kind: 'enemy', id: 101 });
    expect(tapSubject([102, 5], enemy, adv, 1)).toEqual({ kind: 'enemy', id: 102 });
  });
  it('else another adventurer, never this one', () => {
    expect(tapSubject([1, 5], enemy, adv, 1)).toEqual({ kind: 'ally', id: 5 });
    expect(tapSubject([1], enemy, adv, 1)).toBeNull();
    expect(tapSubject([], enemy, adv, 1)).toBeNull();
  });
});

describe('abilityDefs', () => {
  it('maps every ability with its glyph, cooldown, cast time, job and kind', () => {
    const ids = Object.keys(ABILITIES);
    expect(ids).toHaveLength(49);
    for (const id of ids) {
      const a = ABILITIES[id as keyof typeof ABILITIES], d = ABILITY_DEFS[id as keyof typeof ABILITIES];
      expect(d).toMatchObject({ id, name: a.name, glyph: a.glyph, cooldown: a.cooldown, kind: a.kind, job: a.job, range: a.range, desc: a.desc, support: !!a.support });
      expect(d.element).toBe(a.element);
      expect(d.castTime).toBe(a.id === 'charged_shot' ? CHARGE_FULL_S : a.cast ?? 0);
      expect('weapon' in d).toBe(false);
    }
    expect(ABILITY_DEFS.charged_shot.castTime).toBe(CHARGE_FULL_S);
    expect(ABILITY_DEFS.slash.castTime).toBe(0);
    expect(ABILITY_DEFS.skyfall_arc.castTime).toBe(ABILITIES.skyfall_arc.cast);
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
  it('every job: its five slots (bar, then picks), the finisher unusable below 50', () => {
    for (const job of JOB_IDS) {
      const slots = slotsFor({ job, picks: [JOBS[job].pool[0], JOBS[job].pool[1]] });
      const v = slotView(self({ job, slots, momentum: FINISHER_COST - 1, weapon: JOBS[job].weapon }), 0);
      expect(v.map((s) => s.ability.id)).toEqual(slots);
      expect(v.map((s) => s.ability.job)).toEqual(slots.map(() => job));
      expect(v[1].usable).toBe(false);
      expect(slotView(self({ job, slots, momentum: FINISHER_COST }), 0)[1].usable).toBe(true);
    }
  });
  it('a cast in progress makes the other slots unusable; the cast one keeps its state', () => {
    const slots = slotsFor({ job: 'black_mage', picks: [...JOBS.black_mage.picks.solo] });
    const v = slotView(self({ job: 'black_mage', slots, momentum: 100, cast: { ability: 'hearthfall', total: 2.5, left: 1 } }), 0);
    expect(v.map((s) => s.usable)).toEqual([false, false, true, false, false]);
    expect(slotView(self({ job: 'black_mage', slots, momentum: 100, cast: null }), 0).every((s) => s.usable)).toBe(true);
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
  it('a held Charged Shot ends when a self after one showing the charge shows none, or ~1 s after the press with none seen', () => {
    const press = 1000;
    expect(chargeStillHeld(press, null, null, press + 500)).toBe(true);
    // 400 ms latency: a self built before the press reached the server arrives 400 ms later, still with no charge
    expect(chargeStillHeld(press, null, { at: press + 400, charge: null }, press + 400)).toBe(true);
    expect(chargeStillHeld(press, press + 600, { at: press + 600, charge: 0.2 }, press + 700)).toBe(true);
    expect(chargeStillHeld(press, press + 600, { at: press + 900, charge: null }, press + 900)).toBe(false); // released, auto-released, cancelled
    // nothing ever showed the charge (a lost or refused press): over after the timeout
    expect(chargeStillHeld(press, null, { at: press + 400, charge: null }, press + CHARGE_CONFIRM_MS - 1)).toBe(true);
    expect(chargeStillHeld(press, null, { at: press + 400, charge: null }, press + CHARGE_CONFIRM_MS + 1)).toBe(false);
  });
  it('with 400 ms latency a held Charged Shot is released on key-up (the stale self does not drop it)', () => {
    const h = createChargeHold();
    expect(h.press(2, 0)).toBe(true);
    expect(h.press(2, 50)).toBe(false); // key auto-repeat
    h.onSelf(null, 400); h.update({ at: 400, charge: null }, 400); // built before the server got the press
    expect(h.pressedAt).toBe(0);
    h.onSelf(0.2, 650); h.update({ at: 650, charge: 0.2 }, 650);
    expect(h.up(3)).toBe(false); // another slot
    expect(h.up(2)).toBe(true); // the release goes out
    expect(h.pressedAt).toBeNull();
  });
  it('the release is sent on key-up even when the charge already ended here (the server ignores a stray one)', () => {
    const h = createChargeHold();
    h.press(2, 0);
    h.onSelf(0.3, 500); h.onSelf(null, 2600); h.update({ at: 2600, charge: null }, 2600); // auto-released at 2.5 s
    expect(h.pressedAt).toBeNull();
    expect(h.up(2)).toBe(true);
    expect(h.up(2)).toBe(false); // once
    h.press(2, 3000); h.cancel(); // death, a refused press
    expect(h.pressedAt).toBeNull();
    expect(h.up(2)).toBe(true);
  });
  it('an ability refusal ends the pending charge only when the last press was the charge slot', () => {
    expect(refusalIsForCharge({ slot: 2, at: 1000 }, 2, 1200)).toBe(true);
    expect(refusalIsForCharge({ slot: 3, at: 1100 }, 2, 1200)).toBe(false); // a Mend pressed since
    expect(refusalIsForCharge({ slot: 2, at: 1000 }, 2, 1700)).toBe(false);
    expect(refusalIsForCharge(null, 2, 1000)).toBe(false);
  });
  it('the per-frame views reuse what they are given (no allocation per frame)', () => {
    const out: ReturnType<typeof slotView> = [];
    const a = slotView(self({ cd: [4, 0, 0, 0, 0] }, 1000), 1000, false, out);
    const first = a[0];
    const b = slotView(self({ cd: [0, 0, 0, 0, 0] }, 1000), 1000, false, out);
    expect(b).toBe(out); expect(b[0]).toBe(first); expect(b[0].cdRemaining).toBe(0);
    expect(slotView(null, 0, false, out)).toEqual([]);
    const marks = ['stunned'] as ReturnType<typeof markStatuses>;
    expect(markStatuses(0, marks)).toBe(marks);
    expect(marks).toEqual([]);
  });
});

describe('casts, refusals and status icons', () => {
  it('the cast bar fills from the server cast, counted on from when self arrived', () => {
    expect(castFrac({ ability: 'hearthfall', total: 2.5, left: 2.5 }, 1000, 1000)).toBe(0);
    expect(castFrac({ ability: 'hearthfall', total: 2.5, left: 1.5 }, 1000, 1500)).toBeCloseTo(0.6);
    expect(castFrac({ ability: 'hearthfall', total: 2.5, left: 0.2 }, 1000, 9000)).toBe(1);
  });
  it('refusal toasts: job refusals say why; ally aims say nobody is there; busy and dead are silent', () => {
    expect(refusalText('not-here', 'job')).toBe(REASON_JOB_NOT_HERE);
    expect(refusalText('in-combat', 'job')).toBe('Not during a fight');
    expect(refusalText('busy', 'job')).toBe('Finish what you are doing first');
    expect(refusalText('busy', 'loadout')).toBe('Finish what you are doing first');
    expect(refusalText('no-ally', 'ability')).toBe('Nobody to help here');
    expect(refusalText('busy', 'ability')).toBeNull();
    expect(refusalText('dead', 'job')).toBeNull();
    expect(refusalText('range', 'ability')).toBe('Out of range');
  });
  it('marks include Rooted and Dazed; enemy debuffs and adventurer buffs come from their bits', () => {
    expect(markStatuses(MARK_BITS.rooted | MARK_BITS.dazed | MARK_BITS.soaked)).toEqual(['soaked', 'rooted', 'dazed']);
    expect(buffStatuses(DEBUFF_BITS.blinded | DEBUFF_BITS.weakpoint, 'enemy')).toEqual(['blinded', 'weakpoint']);
    expect(buffStatuses(BUFF_BITS.roar | BUFF_BITS.aegis | BUFF_BITS.mist, 'adventurer')).toEqual(['roar', 'aegis', 'mist']);
    expect(buffStatuses(0, 'adventurer')).toEqual([]);
  });
});
