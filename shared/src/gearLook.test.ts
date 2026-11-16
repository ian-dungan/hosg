// Gear looks: costumes over pieces, the strict gear code.
import { describe, expect, it } from 'vitest';
import { GEAR_LOOK_SLOTS, decodeGearLook, encodeGearLook, resolveGearLook, type GearLook } from './gearLook';
import { prng } from './world/recipe';

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

describe('gear codes', () => {
  const plain = (model: number, d1 = 0, d2 = 0) => ({ model, dye: [d1, d2] as [number, number] });
  const worn = {
    head: plain(10, 3, 4), chest: plain(11, 31, 0), legs: plain(12), hands: plain(13, 1, 2), feet: plain(14, 5, 6), back: plain(15, 7, 8),
    weapon: plain(40, 9, 10), offhand: plain(60, 11, 12),
  };

  it('encodeGearLook ↔ decodeGearLook round-trips; costumes replace their slots; hideHead clears the head; at most 40 characters', () => {
    const bare = resolveGearLook(worn, {}, false);
    expect(bare).toEqual({ ...worn, hideHead: false });
    const body = resolveGearLook(worn, { body: plain(201, 2, 3) }, false);
    expect([body.chest, body.legs, body.hands, body.feet]).toEqual([plain(201, 2, 3), null, null, null]);
    expect([body.head, body.back, body.weapon, body.offhand]).toEqual([worn.head, worn.back, worn.weapon, worn.offhand]);
    const head = resolveGearLook(worn, { head: plain(220, 1, 1), back: plain(240, 4, 4) }, false);
    expect([head.head, head.back, head.chest]).toEqual([plain(220, 1, 1), plain(240, 4, 4), worn.chest]);
    const hidden = resolveGearLook(worn, { head: plain(220) }, true);
    expect(hidden.head).toBeNull();
    expect(hidden.hideHead).toBe(true);
    expect(resolveGearLook(worn, {}, true).head).toBeNull();
    const twoHanded = resolveGearLook({ ...worn, offhand: undefined }, {}, false);
    expect(twoHanded.offhand).toBeNull();

    const all = resolveGearLook(worn, { body: plain(255, 31, 31), head: plain(200, 31, 31), back: plain(254, 31, 31) }, false);
    const looks: GearLook[] = [bare, body, head, hidden, twoHanded, all, { ...bare, weapon: plain(255 - 56, 31, 31) }];
    const rng = prng(3);
    for (let i = 0; i < 300; i++) {
      const pick = () => plain(Math.floor(rng() * 200), Math.floor(rng() * 32), Math.floor(rng() * 32));
      const w = Object.fromEntries(GEAR_LOOK_SLOTS.map((s) => [s, rng() < 0.1 ? undefined : pick()]));
      const costume = () => (rng() < 0.4 ? plain(200 + Math.floor(rng() * 56), Math.floor(rng() * 32), Math.floor(rng() * 32)) : null);
      looks.push(resolveGearLook(w, { body: costume(), head: costume(), back: costume() }, rng() < 0.2));
    }
    for (const g of looks) {
      const code = encodeGearLook(g);
      expect(code.length).toBeLessThanOrEqual(40);
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeGearLook(code)).toEqual(g);
    }
    // Refused: a costume model in an item slot, an item under a body costume, a head shown while hidden, junk.
    expect(() => encodeGearLook({ ...bare, legs: plain(210) })).toThrow();
    expect(() => encodeGearLook({ ...body, legs: plain(12) })).toThrow();
    expect(() => encodeGearLook({ ...bare, hideHead: true })).toThrow();
    expect(() => encodeGearLook({ ...bare, weapon: plain(256) })).toThrow();
    expect(() => encodeGearLook({ ...bare, weapon: plain(3, 32, 0) })).toThrow();
    for (const bad of ['', 'A', '_'.repeat(40), encodeGearLook(bare) + 'A', encodeGearLook(bare).slice(0, -1), 'AAA=']) {
      expect(decodeGearLook(bad), bad).toBeNull();
    }
    // Every one-character change decodes to what it encodes, or is refused.
    const code = encodeGearLook(all);
    for (let i = 0; i < code.length; i++) {
      for (const c of BASE64URL) {
        const s = code.slice(0, i) + c + code.slice(i + 1);
        const g = decodeGearLook(s);
        if (g !== null) expect(encodeGearLook(g)).toBe(s);
      }
    }
  });
});

describe('resolveGearLook with bad models', () => {
  const plain = (model: number, d1 = 0, d2 = 0) => ({ model, dye: [d1, d2] as [number, number] });
  const worn = {
    head: plain(10), chest: plain(11), legs: plain(12), hands: plain(13), feet: plain(14), back: plain(15), weapon: plain(40), offhand: plain(60),
  };

  it('drops a worn piece with a costume-range or invalid model, ignores a costume with an item-range model, and never throws', () => {
    const g = resolveGearLook({ ...worn, legs: plain(200), weapon: plain(256), feet: plain(-1), hands: plain(13, 32, 0) }, {}, false);
    expect([g.legs, g.weapon, g.feet, g.hands]).toEqual([null, null, null, null]);
    expect(g.chest).toEqual(worn.chest);
    const c = resolveGearLook(worn, { body: plain(150), head: plain(12), back: plain(256) }, false);
    expect(c).toEqual({ ...worn, hideHead: false });
    expect(() => encodeGearLook(c)).not.toThrow();
    // Junk of every kind still gives a gear look that encodes and decodes.
    const rng = prng(5);
    const junk = (): unknown => {
      const r = rng();
      if (r < 0.1) return null;
      if (r < 0.2) return 'x';
      if (r < 0.3) return { model: Number.NaN, dye: [0, 0] };
      if (r < 0.4) return { model: 3, dye: [1] };
      return plain(Math.floor(rng() * 300) - 20, Math.floor(rng() * 40) - 4, Math.floor(rng() * 40) - 4);
    };
    for (let i = 0; i < 500; i++) {
      const w = Object.fromEntries(GEAR_LOOK_SLOTS.map((s) => [s, junk()])) as Parameters<typeof resolveGearLook>[0];
      const cs = { body: junk(), head: junk(), back: junk() } as Parameters<typeof resolveGearLook>[1];
      const out = resolveGearLook(w, cs, rng() < 0.3);
      expect(decodeGearLook(encodeGearLook(out))).toEqual(out);
    }
    expect(() => resolveGearLook(null as never, null as never, 'yes' as never)).not.toThrow();
  });
});
