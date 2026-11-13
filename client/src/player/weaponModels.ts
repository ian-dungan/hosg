// A model per weapon and off-hand item (Plan 5 Task 9): the item's `model` id (ITEMS[*].model) → a code-built
// model in the weapon's own space, placed on every joint that weapon type uses (drawn in the hand, sheathed on the
// back or at the hip), extending Plan 3b's weapons (character.ts buildWeapons/buildJobWeapons, which stay for the
// offline demo and enemies). The starter models are close copies of Plan 3b's; every T1, T2 and T3 model has its
// own silhouette, and the seven named Warden weapons carry a glow in the emissive mesh. Unnamed T3 off-hands wear
// the T3 rarity (violet). Model spaces: y along the blade, limb or staff (0 at the guard or the grip), x across,
// z the thickness (for shields and bucklers: the face's normal, outward).
import type { Color3 } from '@babylonjs/core';
import type { OffhandKind, WeaponId } from '@sg2/shared';
import type { ShapeGroup, ShapeKit, V3 } from './character';
import { M, P, basis, blade, cone, fine, frameAt, knob, mix, poly, prism, revolve, ring2d, rod, segs, shade, type F } from './gearKit';

// ───────── where each weapon type sits (canonical metres; matching Plan 3b's builders) ─────────
const HX = 0.26, HY = 0.725;
const T12 = 0.12;
type Place = { j: ShapeGroup; f: F; tint?: 'white' | 'black' };
const greatHand = (x: number, y: number, z: number): V3 => [HX + x, HY - 0.02 + (y + 0.34) * 0.12 + z, -0.12 + (y + 0.34) * 0.99];
const greatBackF = frameAt([0.33, 1.86, -0.27], -0.1, Math.PI - 0.42);
const bladeBackF = frameAt([-0.3, 1.74, -0.27], -0.08, -Math.PI + 0.5);
const staffHandF = frameAt([HX + 0.01, HY - 0.01, 0.04], 0.8, 0);
const staffBackF = frameAt([0, 1.12, -0.28], -0.08, -0.42);
const dagBackF = (side: number) => frameAt([side * 0.17, 0.8, -0.33], 0, side * 1.05);

export const WEAPON_PLACES: Readonly<Record<WeaponId, readonly Place[]>> = {
  blade: [
    { j: 'bladeHand', f: basis([HX, HY, 0.1], [1, 0, 0], [0, -Math.sin(T12), Math.cos(T12)]) },
    { j: 'bladeBack', f: (x, y, z) => bladeBackF(x, 0.09 + y, z) },
  ],
  sword: [
    { j: 'bladeHand', f: basis([HX, HY, 0.1], [1, 0, 0], [0, -Math.sin(T12), Math.cos(T12)]) },
    { j: 'bladeHip', f: basis([-0.205, 0.95, 0.15], [0, 0.63, -0.77], [-0.065, -0.45, -0.37]) },
  ],
  bow: [
    { j: 'bowHand', f: basis([-HX, HY, 0.04], [1, 0, 0], [0, 1, 0]) },
    { j: 'bowBack', f: basis([0, 1.08, -0.17], [-0.447, 0.894, 0], [0.894, 0.447, 0]) },
  ],
  greatsword: [
    { j: 'gsHand', f: greatHand },
    { j: 'gsBack', f: (x, y, z) => greatBackF(x, y + 0.34, z) },
  ],
  daggers: [
    { j: 'dagR', f: (x, y, z) => [HX + x, HY - 0.01 + z, 0.02 + y + 0.078] },
    { j: 'dagL', f: (x, y, z) => [-HX + x, HY - 0.01 + z, 0.02 + y + 0.078] },
    // sheathed at the hips (worn gear shows them there, so the Ninja reads from the front): points down and a little back
    { j: 'offHip', f: basis([0.215, 0.95, 0.06], [0, 0.24, -0.97], [0.08, -1, -0.25]) },
    { j: 'offHip', f: basis([-0.215, 0.95, 0.06], [0, 0.24, -0.97], [-0.08, -1, -0.25]) },
  ],
  staff: [
    { j: 'staffWHand', f: staffHandF, tint: 'white' }, { j: 'staffBHand', f: staffHandF, tint: 'black' },
    { j: 'staffWBack', f: staffBackF, tint: 'white' }, { j: 'staffBBack', f: staffBackF, tint: 'black' },
  ],
};
export const OFFHAND_PLACES: Readonly<Record<OffhandKind, readonly Place[]>> = {
  buckler: [
    { j: 'offHand', f: basis([-0.3, 0.88, 0.02], [0, 0, 1], [0, 1, 0]) },
    { j: 'offHip', f: basis([-0.2, 0.84, -0.14], [-0.6, 0, 0.8], [0, 1, 0]) },
  ],
  quiver: [{ j: 'offBack', f: basis([0.17, 0.88, -0.27], [0.939, -0.343, 0], [0.343, 0.939, 0]) }],
  shield: [
    { j: 'shieldArm', f: basis([-0.305, 0.89, 0.02], [0, 0, 1], [0, 1, 0]) },
  ],
  tome: [
    { j: 'offHand', f: basis([-0.29, 0.69, 0.07], [0, 0, 1], [0, 1, 0]) },
    { j: 'offHip', f: basis([-0.235, 0.8, 0.03], [0, 0, 1], [0, 1, 0]) },
  ],
};
/** Joints a gear look builds for its weapon and off-hand (the default Plan 3b geometry there is not built). */
export const weaponJoints = (w: WeaponId): readonly string[] => [...new Set(WEAPON_PLACES[w].map((p) => p.j))];
export const offhandJoints = (o: OffhandKind): readonly string[] => [...new Set(OFFHAND_PLACES[o].map((p) => p.j))];

type B = (k: ShapeKit, j: ShapeGroup, f: F, tint?: 'white' | 'black') => void;

// ───────── one-handed blades (Warrior) and swords (Paladin): y 0 the guard, the grip below, the blade above ─────────
const grip = (k: ShapeKit, j: ShapeGroup, f: F, len: number, col: Color3, r = 0.02) => rod(k, j, f, [[0, -0.01, 0], [0, -len, 0]], r, col, 5);

const groveBlade: B = (k, j, f) => {
  blade(k, j, f, [[0.01, -0.032, 0.032], [0.56, -0.03, 0.03], [0.66, 0, 0.002]], 0.012, M.steel, { edge: M.bright });
  prism(k, j, f, [[-0.1, -0.02], [0.1, -0.02], [0.1, 0.02], [-0.1, 0.02]], 0.04, P.gold);
  grip(k, j, f, 0.14, M.leather);
  knob(k, j, f, [0, -0.17, 0], 0.035, P.gold);
};
const hedgecutter: B = (k, j, f) => {
  // a broad leaf-shaped blade with a green-wrapped wooden grip and two leaf quillons
  blade(k, j, f, [[0.01, -0.028, 0.028], [0.2, -0.06, 0.06], [0.42, -0.058, 0.058], [0.6, -0.03, 0.03], [0.7, 0, 0.002]], 0.013, mix(M.steel, M.leaf, 0.12), { edge: M.bright });
  for (const s of [-1, 1]) poly(k, j, [f(0, 0, 0), f(s * 0.06, -0.03, 0), f(s * 0.13, 0.03, 0), f(s * 0.07, 0.035, 0)], M.leaf);
  grip(k, j, f, 0.14, M.leaf, 0.021);
  knob(k, j, f, [0, -0.17, 0], 0.033, M.wood);
};
const wickfang: B = (k, j, f) => {
  // a curved dark sabre with a fang notch on its back edge, a brass knuckle bow and an ember-wrapped grip
  const sl: [number, number, number][] = [];
  for (let i = 0; i <= 5; i++) { const t = i / 5, y = 0.01 + t * 0.7, c = 0.13 * t * t, w = 0.034 * (1 - t * 0.55); sl.push([y, c - w, c + w * (i === 5 ? 0.05 : 1)]); }
  blade(k, j, f, sl, 0.011, M.darkSteel, { edge: mix(M.steel, M.ember, 0.35), ridge: 0.35 });
  cone(k, j, f(-0.03, 0.2, 0), f(-0.085, 0.27, 0), 0.02, M.darkSteel, 3);
  rod(k, j, f, [[0.05, 0.01, 0], [0.07, -0.08, 0], [0.03, -0.16, 0]], 0.012, M.brass, 4);
  prism(k, j, f, [[-0.05, -0.015], [0.06, -0.015], [0.06, 0.015], [-0.05, 0.015]], 0.03, M.brass);
  grip(k, j, f, 0.15, M.ember, 0.02);
  knob(k, j, f, [0, -0.17, 0], 0.028, M.brass);
};
const lastBell: B = (k, j, f) => {
  // Last Bell: a broad bright blade with a gold fuller that glows, an upswept gold guard and a small brass bell
  // hanging from it (its mouth lit), and a bell for a pommel
  blade(k, j, f, [[0.01, -0.045, 0.045], [0.5, -0.042, 0.042], [0.64, -0.03, 0.03], [0.74, 0, 0.002]], 0.013, M.bright, { edge: P.cloud });
  blade(k, j, f, [[0.04, -0.008, 0.008], [0.6, -0.008, 0.008], [0.66, 0, 0.001]], 0.016, M.glowWarm, { glow: true });
  for (const s of [-1, 1]) rod(k, j, f, [[0, 0, 0], [s * 0.08, 0.005, 0], [s * 0.13, 0.05, 0]], [0.022, 0.018, 0.01], P.gold, 5);
  const bell = (y: number, x: number, r: number, lit: boolean) => {
    revolve(k, j, f, [x, y, 0], 'y', [[r * 1.1, 0], [r * 0.9, r * 0.45], [0, r * 0.7], [-r * 0.5, r]], segs(k, 8, 5), M.brass);
    if (lit) knob(k, j, f, [x, y - r * 0.55, 0], r * 0.45, M.glowWarm, true, 5);
  };
  bell(-0.06, 0.085, 0.032, true);
  rod(k, j, f, [[0.085, -0.02, 0], [0.085, 0.0, 0]], 0.004, M.brass, 3);
  grip(k, j, f, 0.14, mix(M.violet, M.leather, 0.3), 0.021);
  knob(k, j, f, [0, -0.17, 0], 0.034, P.gold);
};

const groveSword = groveBlade;
const millward: B = (k, j, f) => {
  // an arming sword with a wide straight guard and a millstone pommel
  blade(k, j, f, [[0.01, -0.035, 0.035], [0.5, -0.03, 0.03], [0.64, -0.012, 0.012], [0.7, 0, 0.002]], 0.012, M.steel, { edge: M.bright });
  prism(k, j, f, [[-0.13, -0.018], [0.13, -0.018], [0.15, 0], [0.13, 0.018], [-0.13, 0.018], [-0.15, 0]], 0.035, M.iron);
  grip(k, j, f, 0.13, M.wood);
  revolve(k, j, f, [0, -0.165, 0], 'z', [[-0.022, 0.0], [-0.022, 0.05], [0.022, 0.05], [0.022, 0]], segs(k, 9, 6), M.stoneGrey);
};
const cogtooth: B = (k, j, f) => {
  // a brass-backed blade with cog teeth along its back edge and a cog guard
  blade(k, j, f, [[0.01, -0.04, 0.03], [0.52, -0.036, 0.03], [0.68, 0, 0.004]], 0.012, M.steel, { edge: M.bright, ridge: 0.3 });
  const teeth = fine(k) ? 6 : 4;
  for (let i = 0; i < teeth; i++) { const y = 0.08 + (i / teeth) * 0.5; poly(k, j, [f(-0.035, y, 0), f(-0.07, y + 0.02, 0), f(-0.07, y + 0.05, 0), f(-0.035, y + 0.07, 0)], M.brass); }
  prism(k, j, f, ring2d(fine(k) ? 16 : 10, 0.075, 0.058), 0.03, M.brass, { rim: M.brassDark });
  grip(k, j, f, 0.13, M.leather);
  knob(k, j, f, [0, -0.16, 0], 0.03, M.brass);
};
const oath: B = (k, j, f) => {
  // Lampwarden's Oath: a white-gold blade with a lit fuller, a winged gold guard, and a little lamp for a pommel
  blade(k, j, f, [[0.01, -0.044, 0.044], [0.56, -0.04, 0.04], [0.7, -0.012, 0.012], [0.78, 0, 0.002]], 0.013, mix(M.bright, P.gold, 0.15), { edge: P.cloud });
  blade(k, j, f, [[0.05, -0.009, 0.009], [0.66, -0.008, 0.008], [0.72, 0, 0.001]], 0.016, M.glowWarm, { glow: true });
  for (const s of [-1, 1]) poly(k, j, [f(0, -0.01, 0), f(s * 0.08, -0.02, 0), f(s * 0.16, 0.06, 0), f(s * 0.1, 0.05, 0), f(s * 0.03, 0.02, 0)], P.gold);
  grip(k, j, f, 0.13, P.cloud, 0.02);
  revolve(k, j, f, [0, -0.2, 0], 'y', [[-0.035, 0], [-0.03, 0.03], [0.02, 0.03], [0.035, 0.012], [0.05, 0]], segs(k, 8, 5), P.gold);
  knob(k, j, f, [0, -0.19, 0], 0.024, M.glowWarm, true, 6);
};

// ───────── greatswords (Dark Knight): y 0 the guard, grip to −0.34, blade to ~1.06 ─────────
const groveGreat: B = (k, j, f) => {
  blade(k, j, f, [[0.02, -0.075, 0.075], [0.92, -0.075, 0.075], [1.06, 0, 0.002]], 0.018, M.darkSteel, { edge: shade(M.darkSteel, 1.25) });
  blade(k, j, f, [[0.06, -0.02, 0.02], [0.86, -0.02, 0.02], [0.9, 0, 0.001]], 0.021, P.roof, { edge: P.roof });
  prism(k, j, f, [[-0.17, -0.025], [0.17, -0.025], [0.17, 0.025], [-0.17, 0.025]], 0.07, M.darkSteel);
  grip(k, j, f, 0.32, M.leather, 0.024);
  knob(k, j, f, [0, -0.36, 0], 0.045, P.roof);
};
const cleaver: B = (k, j, f) => {
  // a woodsman's cleaver grown huge: a broad squared blade with a dark spine and a bark-wrapped grip
  blade(k, j, f, [[0.02, -0.06, 0.07], [0.5, -0.07, 0.11], [0.92, -0.075, 0.13], [1.0, -0.06, 0.13], [1.03, -0.02, 0.1]], 0.02, M.steel, { edge: M.bright, ridge: 0.15 });
  rod(k, j, f, [[-0.065, 0.03, 0], [-0.075, 0.98, 0]], 0.016, M.iron, 4);
  prism(k, j, f, [[-0.1, -0.02], [0.14, -0.02], [0.14, 0.02], [-0.1, 0.02]], 0.06, M.iron);
  grip(k, j, f, 0.34, M.bark, 0.026);
  knob(k, j, f, [0, -0.37, 0], 0.035, M.iron);
};
const furnace: B = (k, j, f) => {
  // a jagged black blade with a molten orange core and serrated edges
  blade(k, j, f, [[0.02, -0.08, 0.08], [0.85, -0.07, 0.07], [1.08, 0, 0.002]], 0.02, M.soot, { edge: shade(M.soot, 1.6) });
  blade(k, j, f, [[0.08, -0.025, 0.025], [0.8, -0.018, 0.018], [0.9, 0, 0.001]], 0.023, M.ember, { edge: M.emberDeep });
  const n = fine(k) ? 5 : 3;
  for (let i = 0; i < n; i++) for (const s of [-1, 1]) { const y = 0.15 + (i / n) * 0.7; poly(k, j, [f(s * 0.075, y, 0), f(s * 0.12, y + 0.06, 0), f(s * 0.072, y + 0.1, 0)], M.soot); }
  prism(k, j, f, [[-0.16, -0.03], [0, -0.06], [0.16, -0.03], [0.16, 0.03], [0, 0.05], [-0.16, 0.03]], 0.07, M.iron, { rim: M.ember });
  grip(k, j, f, 0.32, M.leather, 0.024);
  knob(k, j, f, [0, -0.36, 0], 0.045, M.ember);
};
const griefOfBrass: B = (k, j, f) => {
  // Grief of Brass: a massive brass blade, cracked along its edges with a glowing seam, a ring guard and a dark pommel
  blade(k, j, f, [[0.02, -0.1, 0.1], [0.75, -0.1, 0.1], [0.98, -0.05, 0.05], [1.14, 0, 0.002]], 0.022, M.brass, { edge: mix(M.brass, P.cloud, 0.3) });
  const cracks: [number, number][] = [[0.12, 0.16], [0.3, 0.37], [0.5, 0.56], [0.68, 0.76], [0.86, 0.92]];
  for (const [i, [a, b]] of cracks.entries()) {
    const s = i % 2 ? 1 : -1, x0 = s * 0.098, x1 = s * 0.055;
    for (const z of [0.0235, -0.0235]) poly(k, j, [f(x0, a, z * 0.3), f(x1, (a + b) / 2 - 0.01, z), f(x0, b, z * 0.3), f(x1 * 1.3, (a + b) / 2 + 0.012, z)], M.glowEmber, true);
  }
  blade(k, j, f, [[0.04, -0.015, 0.015], [0.9, -0.012, 0.012], [0.98, 0, 0.001]], 0.025, M.brassDark, { edge: M.brassDark });
  revolve(k, j, f, [0, 0, 0], 'z', [[-0.04, 0.11], [-0.04, 0.16], [0.04, 0.16], [0.04, 0.11]], segs(k, 12, 8), M.brassDark);
  grip(k, j, f, 0.32, M.soot, 0.026);
  knob(k, j, f, [0, -0.37, 0], 0.05, M.soot);
  knob(k, j, f, [0, 0, 0], 0.03, M.glowEmber, true, 5);
};

// ───────── twin daggers (Ninja): y 0 the guard, blade to ~0.38 curving up (z) ─────────
const dagBlade = (k: ShapeKit, j: ShapeGroup, f: F, len: number, w: number, curve: number, col: Color3, edge: Color3) => {
  const sl: [number, number, number][] = [];
  for (let i = 0; i <= 4; i++) { const t = i / 4; sl.push([0.01 + t * len, -w * (1 - t * 0.85) - 0.002, w * (1 - t * 0.85) + 0.002 - (i === 4 ? w * 0.15 : 0)]); }
  blade(k, j, (x, y, z) => f(x, y, z + curve * ((y - 0.01) / len) ** 2), sl, 0.009, col, { edge });
};
const groveKnife: B = (k, j, f) => {
  dagBlade(k, j, f, 0.38, 0.017, 0.1, mix(M.steel, P.cloud, 0.5), P.cloud);
  rod(k, j, f, [[0, -0.01, 0], [0, -0.13, 0]], 0.022, M.iron, 4);
  prism(k, j, f, [[-0.06, -0.012], [0.06, -0.012], [0.06, 0.012], [-0.06, 0.012]], 0.03, P.gold);
  rod(k, j, f, [[0, -0.13, 0], [0, -0.22, -0.04], [0, -0.3, -0.03]], [0.018, 0.014, 0.005], P.roof, 3);
};
const thornpick: B = (k, j, f) => {
  // a thin stiletto with thorn spines on its guard and a green-wrapped grip
  dagBlade(k, j, f, 0.4, 0.011, 0.04, M.steel, M.bright);
  for (const s of [-1, 1]) cone(k, j, f(s * 0.015, 0, 0), f(s * 0.075, 0.04, 0), 0.013, M.bark, 3);
  cone(k, j, f(0, 0.02, 0.01), f(0, 0.07, 0.05), 0.01, M.bark, 3);
  rod(k, j, f, [[0, -0.01, 0], [0, -0.13, 0]], 0.019, M.leaf, 4);
  knob(k, j, f, [0, -0.145, 0], 0.02, M.bark);
};
const twinSparks: B = (k, j, f) => {
  // a forked blade: two prongs with brass spark tips
  dagBlade(k, j, f, 0.16, 0.022, 0, M.steel, M.bright);
  for (const s of [-1, 1]) {
    const g: F = (x, y, z) => f(x + s * (0.012 + (y - 0.15) * 0.12), y, z);
    blade(k, j, g, [[0.15, -0.009, 0.009], [0.36, -0.006, 0.006], [0.42, 0, 0.001]], 0.007, M.steel, { edge: M.bright });
    cone(k, j, g(0, 0.37, 0), g(0, 0.45, 0), 0.012, P.gold, 3);
  }
  prism(k, j, f, ring2d(8, 0.05, 0.03), 0.026, M.brass);
  rod(k, j, f, [[0, -0.01, 0], [0, -0.13, 0]], 0.02, M.darkSteel, 4);
  knob(k, j, f, [0, -0.145, 0], 0.02, M.brass);
};
const twinWicks: B = (k, j, f) => {
  // Twin Wicks: pale wax-white blades with a dark wick core, each tipped with a burning flame (crossed glow quads)
  dagBlade(k, j, f, 0.36, 0.019, 0.08, mix(P.cloud, P.stone, 0.4), P.cloud);
  rod(k, j, f, [[0, 0.02, 0.012], [0, 0.3, 0.06]], 0.005, M.soot, 3);
  const tip = (x: number, y: number, z: number) => f(x, y, z + 0.08 * ((y - 0.01) / 0.36) ** 2);
  const fl = (a: number) => { const cs = Math.cos(a) * 0.035, sn = Math.sin(a) * 0.035;
    poly(k, j, [tip(0, 0.34, 0), tip(cs, 0.39, sn), tip(cs * 0.5, 0.45, sn * 0.5), tip(0, 0.5, 0), tip(-cs * 0.5, 0.45, -sn * 0.5), tip(-cs, 0.39, -sn)], [M.glowEmber, M.glowEmber, M.glowWarm, M.glowWarm, M.glowWarm, M.glowEmber], true); };
  fl(0); fl(Math.PI / 2);
  prism(k, j, f, [[-0.05, -0.012], [0.05, -0.012], [0.05, 0.012], [-0.05, 0.012]], 0.03, M.violet);
  rod(k, j, f, [[0, -0.01, 0], [0, -0.13, 0]], 0.021, M.soot, 4);
  rod(k, j, f, [[0, -0.13, 0], [0, -0.21, -0.04], [0, -0.28, -0.03]], [0.014, 0.012, 0.004], M.glowEmber, 3, true);
};

// ───────── bows (Ranger): y along the bow (0 the grip), z forward (the limbs bow forward) ─────────
const limbPts = (half: number, bulge: number, recurve = 0, n = 7): V3[] => {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) { const t = (i / (n - 1)) * 2 - 1, y = t * half; out.push([0, y, bulge * Math.cos(t * 1.15) + recurve * Math.max(0, Math.abs(t) - 0.7) * 3.3]); }
  return out;
};
const bowOf = (k: ShapeKit, j: ShapeGroup, f: F, pts: V3[], r: number, wood: Color3, gripCol: Color3, string: Color3, glowString = false) => {
  const n = pts.length, rr = pts.map((_, i) => { const t = Math.abs((i / (n - 1)) * 2 - 1); return r * (1.25 - t * 0.85); });
  rod(k, j, f, pts, rr, wood, 5);
  rod(k, j, f, [[0, -0.06, pts[(n - 1) / 2]![2]], [0, 0.06, pts[(n - 1) / 2]![2]]], r * 1.35, gripCol, 5);
  rod(k, j, f, [pts[0]!, pts[n - 1]!], 0.005, string, 3, glowString);
};
const groveBow: B = (k, j, f) => bowOf(k, j, f, limbPts(0.55, 0.16), 0.026, P.gold, M.leather, P.cloud);
const ashwood: B = (k, j, f) => {
  // a tall pale longbow with horn tips and a green grip
  const pts = limbPts(0.68, 0.14);
  bowOf(k, j, f, pts, 0.026, M.woodPale, M.leaf, P.cloud);
  for (const p of [pts[0]!, pts[pts.length - 1]!]) cone(k, j, f(p[0], p[1] * 0.96, p[2]), f(p[0], p[1] * 1.06, p[2] - 0.02), 0.016, M.stoneGrey, 3);
};
const cinderstring: B = (k, j, f) => {
  // a dark recurve: the tips curl forward; an ember string and ember tips
  const pts = limbPts(0.55, 0.12, 0.08, 9);
  bowOf(k, j, f, pts, 0.026, M.woodDark, M.ember, M.ember);
  for (const p of [pts[0]!, pts[pts.length - 1]!]) knob(k, j, f, p, 0.02, M.ember);
};
const longwatch: B = (k, j, f) => {
  // Longwatch: a long dark bow with brass caps, a spyglass sight mounted at the grip (its lens lit) and lit tips
  const pts = limbPts(0.7, 0.15, 0.03, 9);
  bowOf(k, j, f, pts, 0.028, M.woodDark, M.violet, P.cloud);
  for (const p of [pts[0]!, pts[pts.length - 1]!]) { cone(k, j, f(p[0], p[1] * 0.95, p[2]), f(p[0], p[1] * 1.05, p[2]), 0.02, M.brass, 4); knob(k, j, f, [p[0], p[1] * 1.06, p[2]], 0.014, M.glowLens, true, 4); }
  const g = 0.15;
  revolve(k, j, f, [0.045, 0.06, g - 0.06], 'z', [[0, 0.018], [0.2, 0.022], [0.2, 0.03], [0.24, 0.03]], segs(k, 7, 5), M.brass);
  revolve(k, j, f, [0.045, 0.06, g + 0.185], 'z', [[0, 0.024], [0.004, 0.024]], segs(k, 7, 5), M.glowLens, true);
  rod(k, j, f, [[0.005, 0.03, g], [0.045, 0.05, g]], 0.008, M.brass, 3);
};

// ───────── staffs (the mages): y along the staff, the head above ~0.9 ─────────
const staffShaft = (k: ShapeKit, j: ShapeGroup, f: F, wood: Color3, top = 0.84, wobble = 0) =>
  rod(k, j, f, [[0, -0.66, 0], [wobble, -0.2, 0.012], [-wobble, 0.3, -0.012], [wobble * 0.5, top, 0]], [0.03, 0.034, 0.035, 0.04], wood, 5);
const groveStaff: B = (k, j, f, tint) => {
  const white = tint !== 'black';
  const wood = white ? mix(P.stone, P.cloud, 0.35) : shade(mix(P.rock, P.cliff, 0.3), 0.48);
  staffShaft(k, j, f, wood);
  rod(k, j, f, [[0, -0.08, 0], [0, 0.14, 0]], 0.042, white ? mix(P.teal, P.cloud, 0.3) : P.roof, 5);
  rod(k, j, f, [[0, 0.82, 0], [0, 0.93, 0]], 0.056, white ? P.gold : M.iron, 5);
  revolve(k, j, f, [0, 1.13, 0], 'y', [[-0.23, 0], [-0.08, 0.12], [0.08, 0.12], [0.23, 0]], 5, white ? mix(P.teal, P.cloud, 0.62) : mix(P.rock, P.roof, 0.42));
  if (white) {
    const ring: V3[] = [];
    for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI * 2; ring.push([Math.cos(a) * 0.25, 1.13 + Math.sin(a) * 0.25, 0]); }
    rod(k, j, f, ring, 0.024, mix(P.cloud, P.gold, 0.2), 3);
  } else {
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.5, c = Math.cos(a), s = Math.sin(a); rod(k, j, f, [[c * 0.05, 0.9, s * 0.05], [c * 0.19, 1.0, s * 0.19], [c * 0.18, 1.26, s * 0.18], [c * 0.06, 1.44, s * 0.06]], [0.03, 0.028, 0.02, 0.006], M.iron, 3); }
  }
};
const rowan: B = (k, j, f) => {
  // a gnarled rowan staff forking at the top round a cluster of red berries, with leaves
  staffShaft(k, j, f, M.bark, 0.86, 0.025);
  rod(k, j, f, [[0, -0.08, 0], [0, 0.14, 0]], 0.04, M.leaf, 5);
  for (const s of [-1, 1]) rod(k, j, f, [[0, 0.84, 0], [s * 0.1, 0.98, 0.02], [s * 0.08, 1.16, 0]], [0.034, 0.026, 0.01], M.bark, 4);
  const berries: V3[] = [[0, 1.04, 0.02], [0.035, 1.08, -0.01], [-0.035, 1.09, 0.01], [0.0, 1.12, -0.02], [0.02, 1.0, -0.03]];
  for (const b of berries.slice(0, fine(k) ? 5 : 3)) knob(k, j, f, b, 0.03, M.berry, false, 5);
  for (const [s, y] of [[-1, 0.96], [1, 1.02], [-1, 1.12]] as [number, number][]) poly(k, j, [f(s * 0.06, y, 0), f(s * 0.13, y + 0.03, 0.03), f(s * 0.2, y + 0.02, 0), f(s * 0.13, y - 0.02, -0.02)], M.leaf);
};
const lampglass: B = (k, j, f) => {
  // a slim brass rod topped with a glass lamp bulb, an ember filament and a brass cap
  rod(k, j, f, [[0, -0.66, 0], [0, 0.88, 0]], [0.024, 0.028], M.brass, 5);
  for (const y of [-0.3, 0.1, 0.5]) rod(k, j, f, [[0, y - 0.02, 0], [0, y + 0.02, 0]], 0.036, M.brassDark, 5);
  revolve(k, j, f, [0, 0.88, 0], 'y', [[0, 0.05], [0.08, 0.1], [0.2, 0.11], [0.3, 0.06], [0.33, 0.04]], segs(k, 8, 6), M.glass);
  rod(k, j, f, [[0, 0.95, 0], [0.03, 1.02, 0], [-0.03, 1.08, 0], [0, 1.14, 0]], 0.01, M.ember, 3);
  revolve(k, j, f, [0, 1.2, 0], 'y', [[0, 0.05], [0.04, 0.05], [0.09, 0]], segs(k, 8, 5), M.brass);
};
const dawnlantern: B = (k, j, f) => {
  // Dawnlantern: a pale staff carrying a brass lantern with a lit core, gold wings at its sides
  staffShaft(k, j, f, mix(P.stone, P.cloud, 0.4), 0.86);
  rod(k, j, f, [[0, -0.08, 0], [0, 0.14, 0]], 0.042, mix(P.teal, P.cloud, 0.3), 5);
  revolve(k, j, f, [0, 0.88, 0], 'y', [[0, 0.05], [0.04, 0.1], [0.07, 0.1]], segs(k, 8, 6), M.brass);
  revolve(k, j, f, [0, 1.2, 0], 'y', [[0, 0.1], [0.03, 0.1], [0.1, 0.05], [0.15, 0]], segs(k, 8, 6), M.brass);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.4; rod(k, j, f, [[Math.cos(a) * 0.085, 0.94, Math.sin(a) * 0.085], [Math.cos(a) * 0.1, 1.06, Math.sin(a) * 0.1], [Math.cos(a) * 0.085, 1.2, Math.sin(a) * 0.085]], 0.009, M.brass, 3); }
  revolve(k, j, f, [0, 1.07, 0], 'y', [[-0.11, 0], [-0.06, 0.06], [0.04, 0.065], [0.11, 0]], segs(k, 8, 6), M.glowWarm, true);
  for (const s of [-1, 1]) poly(k, j, [f(s * 0.1, 1.04, 0), f(s * 0.3, 1.2, 0), f(s * 0.27, 1.1, 0), f(s * 0.22, 1.02, 0), f(s * 0.12, 0.98, 0)], P.gold);
  cone(k, j, f(0, 1.34, 0), f(0, 1.44, 0), 0.03, P.gold, 4);
};
const emberLens: B = (k, j, f) => {
  // Ember Lens: a dark staff ending in an iron ring that holds a pale lens round a burning ember core
  staffShaft(k, j, f, M.woodDark, 0.86);
  rod(k, j, f, [[0, -0.08, 0], [0, 0.14, 0]], 0.042, P.roof, 5);
  const ring: V3[] = [];
  const n = fine(k) ? 12 : 8;
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; ring.push([Math.cos(a) * 0.19, 1.12 + Math.sin(a) * 0.19, 0]); }
  rod(k, j, f, ring, 0.026, M.iron, 4);
  prism(k, j, (x, y, z) => f(x, y + 1.12, z), ring2d(n, 0.17), 0.01, M.glass);
  knob(k, j, f, [0, 1.12, 0], 0.075, M.glowEmber, true, 6);
  for (const s of [-1, 1]) rod(k, j, f, [[0, 0.86, 0], [s * 0.1, 0.92, 0], [s * 0.18, 0.98, 0]], [0.03, 0.022, 0.012], M.iron, 3);
  cone(k, j, f(0, 1.3, 0), f(0, 1.48, 0), 0.03, M.iron, 4, false, M.ember);
};

// ───────── off-hands ─────────
/** Shield space: x across, y up, z the face's normal (outward). */
const roundFace = (k: ShapeKit, j: ShapeGroup, f: F, r: number, face: Color3, rim: Color3, boss: Color3, n: number) => {
  prism(k, j, f, ring2d(n, r), 0.03, face, { rim, bulge: 0.03 });
  revolve(k, j, f, [0, 0, 0.03], 'z', [[0, r * 0.28], [0.03, r * 0.2], [0.05, 0]], segs(k, 8, 5), boss);
};
const groveBuckler: B = (k, j, f) => roundFace(k, j, f, 0.13, M.wood, M.steel, M.steel, segs(k, 12, 8));
const hedgeBuckler: B = (k, j, f) => {
  roundFace(k, j, f, 0.13, M.wood, M.leaf, M.leaf, segs(k, 12, 8));
  const n = fine(k) ? 8 : 5;
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); poly(k, j, [f(c * 0.12, s * 0.12, 0.01), f(c * 0.16 - s * 0.03, s * 0.16 + c * 0.03, 0.0), f(c * 0.2, s * 0.2, 0), f(c * 0.16 + s * 0.03, s * 0.16 - c * 0.03, 0.0)], M.leaf); }
};
const cogBuckler: B = (k, j, f) => {
  prism(k, j, f, ring2d(fine(k) ? 20 : 12, 0.15, 0.125), 0.03, M.brass, { rim: M.brassDark });
  prism(k, j, (x, y, z) => f(x, y, z + 0.02), ring2d(segs(k, 10, 6), 0.09), 0.02, M.soot);
  knob(k, j, f, [0, 0, 0.04], 0.03, M.ember);
};
const tollBuckler: B = (k, j, f) => {
  // violet enamel (T3 rarity) in a gold rim, a brass bell for a boss
  prism(k, j, f, ring2d(segs(k, 14, 8), 0.145), 0.03, M.violet, { rim: P.gold, bulge: 0.03 });
  revolve(k, j, f, [0, 0, 0.03], 'z', [[0, 0.055], [0.04, 0.045], [0.065, 0.02], [0.08, 0]], segs(k, 8, 5), M.brass);
};
const groveShield: B = (k, j, f) => roundFace(k, j, f, 0.2, P.cloud, P.gold, P.gold, segs(k, 16, 10));
const heater = (w: number, h: number, pt: number): [number, number][] => [[-w, h], [w, h], [w, h * 0.1], [w * 0.7, -h * 0.55], [0, -h - pt], [-w * 0.7, -h * 0.55], [-w, h * 0.1]];
const millShield: B = (k, j, f) => {
  // a heater shield of planks with an iron rim and a millwheel emblem
  prism(k, j, f, heater(0.17, 0.2, 0.06), 0.03, M.wood, { rim: M.iron, bulge: 0.02 });
  const n = fine(k) ? 6 : 4;
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; rod(k, j, f, [[0, 0.02, 0.025], [Math.cos(a) * 0.09, 0.02 + Math.sin(a) * 0.09, 0.025]], 0.009, M.iron, 3); }
  prism(k, j, (x, y, z) => f(x, y + 0.02, z + 0.024), ring2d(segs(k, 10, 6), 0.035), 0.012, M.stoneGrey);
};
const brassKite: B = (k, j, f) => {
  // a tall brass kite shield with a dark band and a cog boss
  prism(k, j, f, [[-0.17, 0.2], [0, 0.26], [0.17, 0.2], [0.13, -0.08], [0, -0.32], [-0.13, -0.08]], 0.03, M.brass, { rim: M.brassDark, bulge: 0.025 });
  poly(k, j, [f(-0.03, 0.24, 0.031), f(0.03, 0.24, 0.031), f(0.02, -0.28, 0.031), f(-0.02, -0.28, 0.031)], M.soot);
  prism(k, j, (x, y, z) => f(x, y + 0.04, z + 0.03), ring2d(fine(k) ? 14 : 10, 0.06, 0.045), 0.02, M.brassDark);
};
const beaconShield: B = (k, j, f) => {
  // a tall stone-faced heater with a brass rim, a violet band and the Beacon's tower emblem (T3 rarity)
  prism(k, j, f, heater(0.19, 0.24, 0.08), 0.035, M.stoneGrey, { rim: P.gold, bulge: 0.025 });
  poly(k, j, [f(-0.19, 0.12, 0.036), f(0.19, 0.12, 0.036), f(0.19, 0.06, 0.036), f(-0.19, 0.06, 0.036)], M.violet);
  poly(k, j, [f(-0.035, -0.18, 0.04), f(0.035, -0.18, 0.04), f(0.025, 0.04, 0.04), f(-0.025, 0.04, 0.04)], P.gold);
  poly(k, j, [f(0, 0.2, 0.042), f(0.05, 0.12, 0.042), f(0, 0.04, 0.042), f(-0.05, 0.12, 0.042)], M.violetLight);
};
/** Quiver space: y up the quiver (0 its foot), z toward the body. */
const quiverOf = (k: ShapeKit, j: ShapeGroup, f: F, h: number, r: number, body: Color3, band: Color3, fletch: Color3) => {
  revolve(k, j, f, [0, 0, 0], 'y', [[0, r * 0.85], [h * 0.95, r * 1.15], [h, r * 1.25]], segs(k, 8, 5), (row) => (row === 2 ? band : body));
  rod(k, j, f, [[0, h * 0.2 - 0.015, 0], [0, h * 0.2 + 0.015, 0]], r * 1.05, band, segs(k, 8, 5));
  for (let i = 0; i < 3; i++) { const x = (i - 1) * 0.03; poly(k, j, [f(x - 0.022, h + 0.02, 0), f(x + 0.022, h + 0.02, 0), f(x + 0.022, h + 0.13, 0), f(x, h + 0.16, 0), f(x - 0.022, h + 0.13, 0)], fletch); rod(k, j, f, [[x, h - 0.05, 0], [x, h + 0.04, 0]], 0.006, M.wood, 3); }
};
const groveQuiver: B = (k, j, f) => quiverOf(k, j, f, 0.44, 0.06, M.leather, M.leather, P.roof);
const fletchQuiver: B = (k, j, f) => quiverOf(k, j, f, 0.5, 0.062, M.leatherLight, M.leather, M.leaf);
const emberQuiver: B = (k, j, f) => quiverOf(k, j, f, 0.48, 0.066, M.soot, M.brass, M.ember);
const lensQuiver: B = (k, j, f) => {
  quiverOf(k, j, f, 0.5, 0.068, M.violet, P.gold, P.cloud);
  revolve(k, j, f, [0, 0.3, -0.07], 'z', [[0, 0.04], [0.012, 0.04]], segs(k, 8, 5), M.glass);
};
/** Tome space: x across the cover, y up the spine, z out of the front cover. */
const bookOf = (k: ShapeKit, j: ShapeGroup, f: F, w: number, h: number, d: number, cover: Color3, pages: Color3, band: Color3) => {
  prism(k, j, f, [[-w, -h], [w, -h], [w, h], [-w, h]], d, cover);
  prism(k, j, (x, y, z) => f(x + 0.008, y, z), [[-w, -h + 0.01], [w - 0.002, -h + 0.01], [w - 0.002, h - 0.01], [-w, h - 0.01]], d + 0.008, pages, { rim: pages, back: pages });
  poly(k, j, [f(-w * 0.6, -h * 0.2, d / 2 + 0.002), f(w * 0.6, -h * 0.2, d / 2 + 0.002), f(w * 0.6, h * 0.2, d / 2 + 0.002), f(-w * 0.6, h * 0.2, d / 2 + 0.002)], band);
};
const groveTome: B = (k, j, f) => bookOf(k, j, f, 0.07, 0.09, 0.04, M.leather, M.woodPale, M.leatherLight);
const herbalTome: B = (k, j, f) => {
  bookOf(k, j, f, 0.075, 0.095, 0.045, shade(M.leaf, 0.7), M.woodPale, M.leaf);
  for (const [x, y] of [[0.05, 0.1], [0.08, 0.06]] as [number, number][]) poly(k, j, [f(x - 0.01, y - 0.02, 0), f(x + 0.03, y + 0.02, 0.01), f(x + 0.01, y + 0.06, 0), f(x - 0.02, y + 0.02, -0.01)], M.leaf);
};
const wickTome: B = (k, j, f) => {
  bookOf(k, j, f, 0.075, 0.1, 0.05, mix(P.rock, P.roof, 0.3), M.woodPale, M.brass);
  rod(k, j, f, [[0.02, 0.1, 0], [0.025, 0.04, -0.005], [0.03, -0.06, 0]], 0.006, M.ember, 3);
  knob(k, j, f, [0.03, -0.075, 0], 0.012, M.ember, false, 4);
};
const logbook: B = (k, j, f) => {
  // the Keeper's Logbook: thick, violet, brass-cornered, a lens set in its cover (T3 rarity)
  bookOf(k, j, f, 0.08, 0.105, 0.065, M.violet, M.woodPale, P.gold);
  if (fine(k)) for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][]) poly(k, j, [f(x * 0.08, y * 0.105, 0.034), f(x * 0.05, y * 0.105, 0.034), f(x * 0.08, y * 0.075, 0.034)], P.gold);
  revolve(k, j, f, [0, 0.02, 0.034], 'z', [[0, 0.03], [0.008, 0.03]], segs(k, 8, 5), M.glass);
};

// ───────── the tables: model id → builder ─────────
const WEAPON_MODELS: Readonly<Record<WeaponId, readonly B[]>> = {
  blade: [groveBlade, hedgecutter, wickfang, lastBell],
  bow: [groveBow, ashwood, cinderstring, longwatch],
  sword: [groveSword, millward, cogtooth, oath],
  greatsword: [groveGreat, cleaver, furnace, griefOfBrass],
  daggers: [groveKnife, thornpick, twinSparks, twinWicks],
  staff: [groveStaff, rowan, lampglass, dawnlantern],
};
const OFFHAND_MODELS: Readonly<Record<OffhandKind, readonly B[]>> = {
  buckler: [groveBuckler, hedgeBuckler, cogBuckler, tollBuckler],
  quiver: [groveQuiver, fletchQuiver, emberQuiver, lensQuiver],
  shield: [groveShield, millShield, brassKite, beaconShield],
  tome: [groveTome, herbalTome, wickTome, logbook],
};
/** The second named staff (model 88): Ember Lens. */
export const EMBER_LENS_MODEL = 88;

/** Builds weapon model (tier 0–3 of its type; `second`: Ember Lens) on every joint its type uses. */
export function buildWeapon(k: ShapeKit, weapon: WeaponId, tier: number, second = false): void {
  const b = second ? emberLens : WEAPON_MODELS[weapon][tier]!;
  for (const p of WEAPON_PLACES[weapon]) b(k, p.j, p.f, p.tint);
}
/** Builds an off-hand (tier 0–3 of its kind) on every joint its kind uses. */
export function buildOffhand(k: ShapeKit, kind: OffhandKind, tier: number): void {
  const b = OFFHAND_MODELS[kind][tier]!;
  for (const p of OFFHAND_PLACES[kind]) b(k, p.j, p.f, p.tint);
}

/** Builds a weapon or off-hand model in a given frame on one group (the dev page's display stands). */
export function buildWeaponIn(k: ShapeKit, j: ShapeGroup, f: F, kind: { weapon: WeaponId; tier: number; second: boolean } | { offhand: OffhandKind; tier: number }): void {
  if ('weapon' in kind) (kind.second ? emberLens : WEAPON_MODELS[kind.weapon][kind.tier]!)(k, j, f, 'white');
  else OFFHAND_MODELS[kind.offhand][kind.tier]!(k, j, f);
}
