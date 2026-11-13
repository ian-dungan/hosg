// Gear and costumes on the adventurer (Plan 5 Task 9): a builder per item and costume `model` id, merged into the
// adventurer's one skinned mesh (glows into its one emissive mesh) through character.ts's gear hooks. Everything is
// code-built in canonical human space (character.ts humanPivots) on the skinning groups, so the look's warp fits it
// to every people from Knollfolk to Larchfolk.
//
// How gear reads at phone size (silhouette first, then colour):
//  - cloth is long: robes to the ankle, long sleeves, hoods; Mossweave leaf-edged hems, Wickthread a wick braid with
//    ember stitching and a tall wick-point hood, Lenslight bell sleeves, a standing collar and glowing lens disks;
//  - light is short and fitted: jerkins, short cloaks, laced boots; Thornrunner thorn-spike shoulder tabs and a
//    thorn cap, Cinderstep a scorched fringe, ember buckles and a tattered cloak, Tollwind long wind-swept tails,
//    a swept hat and bell charms;
//  - heavy is wide and tall: pauldrons, plates and helms; Rootbound bark plates and root straps, Brassbound brass
//    bands, rivets, cog shoulder plates and a tall helm, Beaconstone stone-and-brass plates, a great helm with a lit
//    beacon crest and a lit crest on the chest;
//  - the plain Grove-Spun kit is the adventurer's own clothes (character.ts), in its dyes;
//  - each tier adds silhouette (T1 modest, T2 more, T3 the widest shoulders, tallest helms and longest capes).
// Worn chest, legs and feet pieces recut the body's own clothes (tunic, trousers, boots: GearBodyOverride) rather
// than layering over them, so gear costs few triangles; a worn back piece replaces the cape and scarf. The job's
// colour stays on the tabard (cloth: a stole), the weapon is carried visibly, and the job's own cues (hood, helm,
// pauldrons) show only while the starter piece is worn in that slot.
//
// Dyes: channel 1 is the main cloth or plate, channel 2 the trim. DYES[0] (#000000, "Undyed") is the piece's own
// PALETTE-derived colours, never black; every dye's lightness is clamped (look.ts renderColour) so nothing vanishes.
import type { Color3 } from '@babylonjs/core';
import {
  ARMOUR_SLOTS, COSTUMES, COSTUME_IDS, DYES, GEAR_LOOK_SLOTS, ITEMS, SETS, SET_IDS, JOBS, OFFHAND_FOR,
  kitItems, resolveGearLook, starterFor,
  type ArmourSlot, type ArmourType, type CostumeId, type CostumeSlot, type GearLook, type GearLookSlot, type GearSlot,
  type JobId, type Look as AdventurerLook, type OffhandKind, type SetId, type WeaponId,
} from '@sg2/shared';
import type { Quality } from '../core/contracts';
import { DETAIL, pieceKit, type GearBodyOverride, type GearHooks, type GearPlan, type ShapeKit, type V3 } from './character';
import { renderColour } from './look';
import { M, P, basis, cone, fine, knob, mix, poly, prism, revolve, ring2d, segs, shade } from './gearKit';
import { EMBER_LENS_MODEL, buildOffhand, buildWeapon, offhandJoints, weaponJoints } from './weaponModels';

// ───────── model ids (shared/src/items.ts and costumes.ts) ─────────
const WEAPON_ORDER: readonly WeaponId[] = ['blade', 'bow', 'sword', 'greatsword', 'daggers', 'staff'];
const OFFHAND_ORDER: readonly OffhandKind[] = ['buckler', 'quiver', 'shield', 'tome'];
const COSTUME_BY_MODEL = new Map<number, CostumeId>(COSTUME_IDS.map((id) => [COSTUMES[id].model, id]));

export type ModelInfo =
  | { kind: 'armour'; slot: ArmourSlot; set: SetId; type: ArmourType; tier: number; named: false }
  | { kind: 'weapon'; slot: 'weapon'; weapon: WeaponId; tier: number; named: boolean; second: boolean }
  | { kind: 'offhand'; slot: 'offhand'; offhand: OffhandKind; tier: number; named: false }
  | { kind: 'costume'; slot: 'costume'; costume: CostumeId; part: CostumeSlot; tier: 0; named: false };

/** What a model id is (null: no item or costume has it). */
export function modelInfo(model: number): ModelInfo | null {
  if (!Number.isInteger(model)) return null;
  if (model >= 1 && model <= SET_IDS.length * 6) {
    const set = SET_IDS[Math.floor((model - 1) / 6)]!, slot = ARMOUR_SLOTS[(model - 1) % 6]!;
    return { kind: 'armour', slot, set, type: SETS[set].type, tier: SETS[set].tier, named: false };
  }
  if (model >= 64 && model < 64 + WEAPON_ORDER.length * 4) {
    const tier = (model - 64) % 4;
    return { kind: 'weapon', slot: 'weapon', weapon: WEAPON_ORDER[Math.floor((model - 64) / 4)]!, tier, named: tier === 3, second: false };
  }
  if (model === EMBER_LENS_MODEL) return { kind: 'weapon', slot: 'weapon', weapon: 'staff', tier: 3, named: true, second: true };
  if (model >= 96 && model < 96 + OFFHAND_ORDER.length * 4) {
    return { kind: 'offhand', slot: 'offhand', offhand: OFFHAND_ORDER[Math.floor((model - 96) / 4)]!, tier: (model - 96) % 4, named: false };
  }
  const c = COSTUME_BY_MODEL.get(model);
  return c ? { kind: 'costume', slot: 'costume', costume: c, part: COSTUMES[c].slot, tier: 0, named: false } : null;
}
const isPlain = (model: number) => { const i = modelInfo(model); return i?.kind === 'armour' && i.set === 'plain'; };

// ───────── colours ─────────
export interface Own { main: Color3; trim: Color3 }
/** Each set's own colours (Undyed), PALETTE-derived. */
export const OWN: Readonly<Record<SetId, Own>> = {
  plain: { main: P.teal, trim: P.gold },
  mossweave: { main: shade(mix(P.meadow, P.rock, 0.35), 0.78), trim: mix(P.meadow, P.stone, 0.55) },
  thornrunner: { main: shade(mix(P.cliff, P.meadow, 0.45), 0.62), trim: mix(P.stone, P.cliff, 0.25) },
  rootbound: { main: shade(mix(P.cliff, P.gold, 0.3), 0.5), trim: shade(mix(P.meadow, P.gold, 0.35), 0.62) },
  wickthread: { main: shade(mix(P.rock, P.roof, 0.3), 0.78), trim: mix(P.stone, P.cloud, 0.4) },
  cinderstep: { main: shade(mix(P.rock, P.cliff, 0.3), 0.5), trim: mix(P.roof, P.gold, 0.3) },
  brassbound: { main: shade(mix(P.gold, P.cliff, 0.2), 0.9), trim: shade(P.cliff, 0.62) },
  lenslight: { main: mix(P.cloud, P.sky, 0.28), trim: mix(P.rock, P.skyDeep, 0.3) },
  tollwind: { main: mix(P.sky, P.cloud, 0.42), trim: P.gold },
  beaconstone: { main: mix(P.stone, P.cloud, 0.3), trim: shade(mix(P.gold, P.cliff, 0.15), 0.9) },
};
const COSTUME_OWN: Readonly<Record<CostumeId, Own>> = {
  lamplighter_coat: { main: shade(P.skyDeep, 0.5), trim: M.brass },
  solstice_finery: { main: mix(P.cloud, P.gold, 0.18), trim: P.gold },
  orchard_smock: { main: mix(P.cloud, P.stone, 0.6), trim: shade(P.meadow, 0.7) },
  harbour_oilskin: { main: mix(P.gold, P.horizon, 0.2), trim: shade(P.skyDeep, 0.55) },
  mothsilk_gown: { main: mix(P.cloud, P.rock, 0.25), trim: mix(P.cloud, P.sky, 0.3) },
  ploughmans_weeds: { main: mix(P.cloud, P.stone, 0.7), trim: shade(mix(P.cliff, P.gold, 0.3), 0.55) },
  straw_sunhat: { main: mix(P.gold, P.stone, 0.5), trim: P.roof },
  brass_goggles: { main: M.brass, trim: M.leather },
  owlfeather_circlet: { main: P.gold, trim: mix(P.stone, P.cliff, 0.35) },
  patchwork_cape: { main: shade(P.roof, 0.8), trim: P.teal },
  kitewing_mantle: { main: P.roof, trim: P.cloud },
  mapmakers_satchel: { main: M.leatherLight, trim: mix(P.cloud, P.stone, 0.5) },
  starfall_regalia: { main: shade(P.skyDeep, 0.42), trim: mix(P.cloud, P.sky, 0.25) },
  beacon_halo: { main: P.gold, trim: mix(P.cloud, P.horizon, 0.4) },
};
const dyeCache = new Map<number, Color3>();
/** A dye's colour, or `own` for Undyed (DYES[0], #000000 — never black) and anything out of range. */
export function dyeColour(d: number, own: Color3): Color3 {
  if (!Number.isInteger(d) || d <= 0 || d >= DYES.length) return own;
  let c = dyeCache.get(d);
  if (!c) { c = renderColour(parseInt(DYES[d]!.hex.slice(1), 16)); dyeCache.set(d, c); }
  return c;
}
const dyed = (own: Own, dye: readonly [number, number]): Own => ({ main: dyeColour(dye[0], own.main), trim: dyeColour(dye[1], own.trim) });

// ───────── the build context ─────────
interface Ctx { k: ShapeKit; main: Color3; trim: Color3; set: SetId; tier: number; type: ArmourType }
const HY = 1.565;
const SIDES = [-1, 1] as const;
const arm = (s: number) => (s < 0 ? 'armL' : 'armR');
const leg = (s: number) => (s < 0 ? 'legL' : 'legR');

/** A hood: a shell a little larger than the head with the face open, its rim in the trim. */
function hood(c: Ctx, size = 1) {
  c.k.ellip('head', [0, HY + 0.06, -0.03], [0.262 * size, 0.285 * size, 0.27 * size], c.main, { seg: 14, lat: 9, noOcc: true,
    deform: (l) => { if ((l.z > 0.32 && l.y < 0.58 && l.y > -0.75) || l.y < -0.8) { l.x *= 0.82; l.y *= 0.82; l.z *= 0.82; } },
    paint: (_w, _uv, l) => (l.z > 0.2 && l.y < 0.66 && l.y > -0.7 && Math.abs(l.x) > 0.6 ? c.trim : l.z > 0.25 && l.y > 0.52 && l.y < 0.72 ? c.trim : undefined) });
}
/** A cape on the 'cape' springs: `len` m long, its hem cut by `hem(u)` (u −0.5..0.5, a fraction of len), swept by `sweep`. */
function cape(c: Ctx, o: { len: number; width?: number; hem?: (u: number) => number; sweep?: number; paint?: (u: number, t: number, w: V3) => Color3 | undefined; col?: Color3; top?: number }) {
  const grid: V3[][] = [], cols = 8, width = o.width ?? 1, top = o.top ?? 1.31;
  for (const t of [0, 0.15, 0.3, 0.45, 0.6, 0.72, 0.84, 0.92, 0.96, 1]) {
    const r = 0.16 + t * 0.1, spread = (1.0 + t * 0.22) * Math.min(1, width), row: V3[] = [];
    for (let j = 0; j <= cols; j++) {
      const u = j / cols - 0.5, a = Math.PI + u * spread * 2, tt = t * (1 + (o.hem ? o.hem(u) : 0));
      const y = top - tt * o.len, sw = (o.sweep ?? 0) * tt * tt;
      row.push([Math.sin(a) * r + sw, y, Math.cos(a) * r * 0.7 - 0.07 - tt * 0.05 - Math.abs(sw) * 0.3]);
    }
    grid.push(row);
  }
  c.k.sheet('cape', grid, 0.02, o.col ?? c.main, { paint: (w, uv) => o.paint?.(uv[0] - 0.5, uv[1], [w.x, w.y, w.z]) });
}
/** The cloak's folded collar at the shoulders (torso). */
const collar = (c: Ctx, col: Color3, r = 0.2, h = 0.12) =>
  c.k.lathe('torso', [0, 0, -0.015], [[1.33 - h, r], [1.33 - h * 0.55, r + 0.015], [1.33, r * 0.82], [1.37, r * 0.6]], col, { seg: 14, sz: 0.88, arc: [Math.PI * 0.4, Math.PI * 1.6], paint: (w) => (w.y < 1.33 - h + 0.025 ? c.trim : undefined) });
/** A ring round the body at height y (a belt, a braid, a hem band), on 'body'. */
const band = (c: Ctx, y: number, r: number, h: number, col: Color3, g: 'body' | 'torso' = 'body', sz = 0.8) =>
  c.k.lathe(g, [0, 0, 0], [[y - h / 2, r], [y + h / 2, r]], col, { seg: 14, sz, caps: false });

// ───────── head ─────────
function buildHead(c: Ctx) {
  const { k, main, trim, set } = c;
  switch (set) {
    case 'mossweave': {
      hood(c);
      k.tube('head', [[0, HY + 0.12, -0.24], [0, HY - 0.02, -0.32], [0, HY - 0.18, -0.31], [0, HY - 0.3, -0.26]], [0.11, 0.08, 0.05, 0.01], main, { seg: 6, noOcc: true });
      for (const s of SIDES) poly(k, 'head', [[s * 0.03, HY + 0.29, 0.17], [s * 0.1, HY + 0.33, 0.17], [s * 0.17, HY + 0.3, 0.13], [s * 0.1, HY + 0.27, 0.16]], trim);
      return;
    }
    case 'wickthread': {
      hood(c, 1.02);
      // the hood rises to a tall wick point, its tip a little ember
      k.tube('head', [[0, HY + 0.24, -0.06], [0, HY + 0.4, -0.12], [0.02, HY + 0.52, -0.2], [0.05, HY + 0.58, -0.28]], [0.12, 0.07, 0.035, 0.012], main, { seg: 6, noOcc: true });
      knob(k, 'head', (x, y, z) => [x, y, z], [0.055, HY + 0.6, -0.29], 0.022, M.ember, false, 4);
      k.lathe('head', [0, 0, -0.02], [[HY + 0.17, 0.245], [HY + 0.2, 0.25]], trim, { seg: 14, caps: false, noOcc: true, arc: [-1.6, 1.6] });
      return;
    }
    case 'lenslight': {
      hood(c, 1.04);
      // a gold circlet with a lens on the brow (lit)
      revolve(k, 'head', (x, y, z) => [x, y, z], [0, HY + 0.17, 0.24], 'z', [[0, 0.045], [0.012, 0.045]], segs(k, 9, 6), M.glass);
      revolve(k, 'head', (x, y, z) => [x, y, z], [0, HY + 0.17, 0.253], 'z', [[0, 0.028], [0.004, 0.028]], segs(k, 8, 5), M.glowLens, true);
      return;
    }
    case 'thornrunner': {
      // a close leather cap with a band and a thorn on top
      k.ellip('head', [0, HY + 0.07, -0.01], [0.228, 0.205, 0.226], main, { seg: 12, lat: 7, noOcc: true, deform: (l) => { if (l.y < -0.08) l.y = -0.08; },
        paint: (_w, _uv, l) => (l.y < 0.05 ? trim : undefined) });
      cone(k, 'head', [0, HY + 0.25, -0.03], [0, HY + 0.38, -0.14], 0.035, trim, 3);
      for (const s of SIDES) cone(k, 'head', [s * 0.15, HY + 0.18, -0.06], [s * 0.24, HY + 0.24, -0.12], 0.022, trim, 3);
      return;
    }
    case 'cinderstep': {
      // a headwrap, scorched at the edge, its tails flying behind
      k.ellip('head', [0, HY + 0.08, -0.01], [0.226, 0.19, 0.224], main, { seg: 12, lat: 7, noOcc: true, deform: (l) => { if (l.y < -0.12) l.y = -0.12; },
        paint: (_w, _uv, l) => (l.y < 0.0 ? trim : undefined) });
      for (const s of SIDES) k.tube('head', [[s * 0.04, HY + 0.08, -0.21], [s * 0.1, HY + 0.02, -0.33], [s * 0.15, HY - 0.08, -0.4]], [0.035, 0.03, 0.008], trim, { seg: 4, flatten: 0.4, noOcc: true });
      return;
    }
    case 'tollwind': {
      // a hat with a wide brim swept up at one side, a gold band, a long feather and a bell charm
      k.lathe('head', [0, HY + 0.12, -0.02], [[0, 0.29], [0.02, 0.27], [0.035, 0.2], [0.14, 0.17], [0.18, 0]], main, { seg: 14, rot: [-0.12, 0, 0.16], noOcc: true,
        paint: (w) => (w.y > HY + 0.16 && w.y < HY + 0.2 ? trim : undefined) });
      k.tube('head', [[0.12, HY + 0.22, -0.02], [0.2, HY + 0.34, -0.14], [0.17, HY + 0.44, -0.3], [0.1, HY + 0.46, -0.42]], [0.03, 0.035, 0.025, 0.004], P.cloud, { seg: 3, flatten: 0.35, noOcc: true });
      if (fine(k)) revolve(k, 'head', (x, y, z) => [x, y, z], [-0.27, HY + 0.02, 0.0], 'y', [[0.035, 0], [0.025, 0.02], [0, 0.026], [-0.01, 0.028]], 5, M.brass);
      return;
    }
    case 'rootbound': {
      // an open-faced bark helm, ridged, with two roots curling back like horns
      k.ellip('head', [0, HY + 0.05, -0.015], [0.25, 0.272, 0.252], main, { seg: 12, lat: 8, flat: true, noOcc: true,
        deform: (l) => { if (l.z > 0.35 && l.y < 0.35 && l.y > -0.7) { l.x *= 0.85; l.y *= 0.85; l.z *= 0.85; } if (l.y < -0.6) l.y = -0.6; },
        paint: (_w, _uv, l) => (l.y < -0.45 || (l.z > 0.3 && l.y < 0.45 && l.y > 0.3) ? trim : Math.sin(Math.atan2(l.x, l.z) * 9) > 0.55 ? shade(main, 0.8) : undefined) });
      for (const s of SIDES) k.tube('head', [[s * 0.18, HY + 0.17, -0.06], [s * 0.27, HY + 0.24, -0.16], [s * 0.26, HY + 0.32, -0.27], [s * 0.2, HY + 0.33, -0.33]], [0.04, 0.032, 0.02, 0.006], trim, { seg: 4, noOcc: true });
      return;
    }
    case 'brassbound': {
      // a tall brass helm with banded rows, a dark eye slit, rivets and a cog crest
      k.lathe('head', [0, 0, -0.01], [[HY - 0.13, 0.235], [HY + 0.08, 0.25], [HY + 0.24, 0.225], [HY + 0.33, 0.13], [HY + 0.36, 0]], main, { seg: 12, flat: true, noOcc: true,
        paint: (w) => (Math.abs(w.y - (HY - 0.1)) < 0.03 || Math.abs(w.y - (HY + 0.2)) < 0.025 ? trim : undefined) });
      poly(k, 'head', [[-0.15, HY + 0.02, 0.245], [0.15, HY + 0.02, 0.245], [0.14, HY - 0.015, 0.248], [-0.14, HY - 0.015, 0.248]], M.soot);
      prism(k, 'head', (x, y, z) => [z, HY + 0.38 + y, -0.02 + x], ring2d(k.detail >= 0.75 ? 16 : 10, 0.1, 0.075), 0.035, trim, { rim: shade(trim, 0.8) });
      if (k.detail >= 0.75) for (const a of [-1.2, -0.6, 0.6, 1.2]) knob(k, 'head', (x, y, z) => [x, y, z], [Math.sin(a) * 0.25, HY + 0.08, Math.cos(a) * 0.25 - 0.01], 0.014, M.iron, false, 4);
      return;
    }
    case 'beaconstone': {
      // a stone great helm banded in brass with a T visor, crowned by a fin and a lit beacon lamp
      k.lathe('head', [0, 0, -0.01], [[HY - 0.15, 0.24], [HY + 0.06, 0.258], [HY + 0.22, 0.245], [HY + 0.3, 0.17], [HY + 0.335, 0]], main, { seg: 12, flat: true, noOcc: true,
        paint: (w) => (Math.abs(w.y - (HY - 0.12)) < 0.03 || Math.abs(w.y - (HY + 0.26)) < 0.03 ? trim : undefined) });
      poly(k, 'head', [[-0.16, HY + 0.03, 0.253], [0.16, HY + 0.03, 0.253], [0.16, HY - 0.005, 0.256], [-0.16, HY - 0.005, 0.256]], M.soot);
      poly(k, 'head', [[-0.025, HY - 0.005, 0.257], [0.025, HY - 0.005, 0.257], [0.022, HY - 0.12, 0.25], [-0.022, HY - 0.12, 0.25]], M.soot);
      prism(k, 'head', (x, y, z) => [z, HY + 0.3 + y, x - 0.05], [[-0.2, 0], [0.18, 0], [0.12, 0.12], [-0.12, 0.1]], 0.03, trim);
      revolve(k, 'head', (x, y, z) => [x, y, z], [0, HY + 0.33, 0.05], 'y', [[0, 0.05], [0.05, 0.07], [0.06, 0.05]], segs(k, 8, 5), trim);
      revolve(k, 'head', (x, y, z) => [x, y, z], [0, HY + 0.4, 0.05], 'y', [[-0.01, 0.0], [0.0, 0.045], [0.06, 0.03], [0.13, 0]], segs(k, 7, 5), M.glowBeacon, true);
      return;
    }
    default: return;
  }
}

// ───────── chest (the tunic's cut comes from the override; here what goes over it) ─────────
const ROBE_HEM = [0, 0.22, 0.15, 0.1], JERKIN_HEM = [0, 0.7, 0.68, 0.64];
function chestOverride(c: { main: Color3; trim: Color3; type: ArmourType; tier: number }): GearBodyOverride {
  const { main, trim, type, tier } = c;
  // the job's tabard narrows over set pieces (a stole on robes, a sash on jerkins, a surcoat strip on plate)
  if (type === 'cloth') return { top: main, topTrim: trim, hem: ROBE_HEM[tier], flare: 0.04 + tier * 0.006, girth: 1, sleeves: 'long', sleeveColor: main, belt: shade(trim, 0.8), buckle: null, pouch: false, vneck: null, tabard: 0.85 };
  if (type === 'light') return { top: main, topTrim: trim, hem: JERKIN_HEM[tier], flare: 0.03, girth: 1, sleeves: tier === 1 ? 'short' : 'long', sleeveColor: main, belt: M.leather, buckle: tier === 2 ? M.ember : M.brass, pouch: true, vneck: tier === 1 ? mix(main, P.cloud, 0.5) : null, tabard: 1.1 };
  return { top: main, topTrim: trim, hem: 0.74, flare: 0.02, girth: 1.03 + tier * 0.015, sleeves: 'long', sleeveColor: shade(mix(main, M.steel, 0.35), 0.8), belt: M.leather, buckle: trim, pouch: false, vneck: null, tabard: 1 };
}
function buildChest(c: Ctx) {
  const { k, main, trim, set, tier } = c;
  const hem = ROBE_HEM[tier]!, W = 0.19;
  switch (set) {
    case 'mossweave': {
      // a hem edged with leaves
      const n = fine(k) ? 12 : 8, r = W + 0.04 + 0.006 + 0.01;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, x = Math.sin(a), z = Math.cos(a) * 0.8, y = hem + 0.03;
        poly(k, 'body', [[x * r, y, z * r], [x * (r + 0.02) + z * 0.03, y - 0.05, z * (r + 0.02) - x * 0.03], [x * (r + 0.025), y - 0.1, z * (r + 0.025)], [x * (r + 0.02) - z * 0.03, y - 0.05, z * (r + 0.02) + x * 0.03]], trim);
      }
      k.tube('body', [[-0.2, 0.96, 0.08], [0, 0.94, 0.17], [0.2, 0.96, 0.08]], 0.014, main, { seg: 4, noOcc: true });
      return;
    }
    case 'wickthread': {
      // a wick braid round the hem stitched with embers, and a high collar
      const n = segs(k, 20, 12), pts: V3[] = [], r = W + 0.046 + 0.008;
      for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; pts.push([Math.sin(a) * r, hem + 0.05 + 0.01 * Math.sin(i * 2.4), Math.cos(a) * r * 0.8]); }
      k.tube('body', pts, 0.016, trim, { seg: 4, noOcc: true, caps: false });
      if (fine(k)) for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, x = Math.sin(a) * (r - 0.004), z = Math.cos(a) * (r - 0.004) * 0.8; poly(k, 'body', [[x, hem + 0.085, z], [x + Math.cos(a) * 0.012, hem + 0.1, z - Math.sin(a) * 0.01], [x, hem + 0.115, z], [x - Math.cos(a) * 0.012, hem + 0.1, z + Math.sin(a) * 0.01]], M.ember); }
      k.lathe('torso', [0, 0, 0], [[1.29, 0.13], [1.36, 0.125], [1.44, 0.14]], main, { seg: 12, sz: 0.95, caps: false, noOcc: true, paint: (w) => (w.y > 1.41 ? trim : undefined) });
      return;
    }
    case 'lenslight': {
      // bell sleeves, a standing collar, and a glassy lens disk on each shoulder, lit
      for (const s of SIDES) {
        const ax = s * 0.247;
        k.lathe(arm(s), [ax, 0, 0], [[0.76, 0.058], [0.8, 0.057], [0.9, 0.054]], main, { seg: 10, caps: false, noOcc: true, paint: (w) => (w.y < 0.79 ? trim : undefined) });
        // the disk faces out and forward, so it shows from the front
        const f = basis([s * 0.215, 1.34, 0.07], [0.8, 0, -s * 0.6], [0, 1, 0]);
        revolve(k, arm(s), f, [0, 0, 0], 'z', [[0, 0.085], [0.016, 0.085]], segs(k, 10, 6), trim);
        revolve(k, arm(s), f, [0, 0, 0], 'z', [[0.017, 0.058], [0.021, 0.058]], segs(k, 9, 6), M.glowLens, true);
      }
      k.lathe('torso', [0, 0, -0.02], [[1.28, 0.15], [1.38, 0.17], [1.5, 0.22]], trim, { seg: 12, sz: 0.9, caps: false, noOcc: true, arc: [Math.PI * 0.45, Math.PI * 1.55] });
      k.lathe('body', [0, 0, 0], [[0.9, W * 0.95 + 0.02], [0.96, W * 0.95 + 0.022]], main, { seg: 12, sz: 0.82, caps: false, noOcc: true, paint: () => undefined });
      return;
    }
    case 'thornrunner': {
      // thorn-spike shoulder tabs and a cross strap
      for (const s of SIDES) {
        k.ellip(arm(s), [s * 0.24, 1.305, 0], [0.09, 0.032, 0.1], main, { seg: 8, lat: 4, flat: true, noOcc: true, rot: [0, 0, -s * 0.35] });
        for (const [dz, h] of [[-0.05, 0.08], [0, 0.11], [0.05, 0.08]] as [number, number][]) cone(k, arm(s), [s * 0.26, 1.32, dz], [s * (0.28 + h * 0.3), 1.32 + h, dz * 1.3], 0.016, trim, 3);
      }
      k.tube('body', [[0.16, 1.25, 0.1], [0, 1.08, 0.17], [-0.17, 0.92, 0.12]], 0.016, trim, { seg: 4, noOcc: true, flatten: 0.5 });
      return;
    }
    case 'cinderstep': {
      // a scorched fringe at the hem, and ember buckles on a cross belt
      const h0 = JERKIN_HEM[2]!, n = fine(k) ? 14 : 9, r = W + 0.035;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, x = Math.sin(a), z = Math.cos(a) * 0.8, tx = Math.cos(a) * 0.022, tz = -Math.sin(a) * 0.022 * 0.8;
        const len = 0.08 + 0.04 * ((i * 7) % 3) / 2;
        poly(k, 'body', [[x * r - tx, h0 + 0.02, z * r - tz], [x * r + tx, h0 + 0.02, z * r + tz], [x * (r + 0.01) + tx * 0.6, h0 - len, z * (r + 0.01) + tz * 0.6], [x * (r + 0.01) - tx * 0.6, h0 - len, z * (r + 0.01) - tz * 0.6]], [main, main, M.soot, M.soot]);
      }
      k.tube('body', [[0.17, 1.22, 0.1], [0, 1.06, 0.17], [-0.18, 0.88, 0.12]], 0.017, trim, { seg: 4, noOcc: true, flatten: 0.5 });
      prism(k, 'body', (x, y, z) => [x, 1.06 + y, 0.18 + z], [[-0.03, -0.025], [0.03, -0.025], [0.03, 0.025], [-0.03, 0.025]], 0.015, M.ember);
      return;
    }
    case 'tollwind': {
      // long coat tails, swept by the wind, and bell charms at the belt
      for (const s of SIDES) {
        const grid: V3[][] = [];
        for (let i = 0; i <= 4; i++) {
          const t = i / 4, y = 0.96 - t * 0.62, sw = 0.09 * t * t;
          grid.push([[s * 0.03 + sw, y, -0.17 - t * 0.06], [s * (0.15 + t * 0.03) + sw, y, -0.13 - t * 0.06]]);
        }
        k.sheet('cape', grid, 0.016, main, { paint: (_w, uv) => (uv[1] > 0.85 ? trim : undefined) });
      }
      k.lathe('torso', [0, 0, -0.01], [[1.28, 0.14], [1.47, 0.19]], trim, { seg: 12, sz: 0.9, caps: false, noOcc: true, arc: [Math.PI * 0.5, Math.PI * 1.5] });
      // a short capelet over the shoulders, gold-edged, clasped with a wind-gem that glows
      k.lathe('torso', [0, 0, 0], [[1.15, 0.24], [1.26, 0.235], [1.35, 0.13]], main, { seg: 14, sz: 0.85, noOcc: true, paint: (w) => (w.y < 1.17 ? trim : undefined) });
      poly(k, 'torso', [[0, 1.33, 0.125], [0.03, 1.29, 0.135], [0, 1.25, 0.14], [-0.03, 1.29, 0.135]], M.glowLens, true);
      if (k.detail >= 0.75) for (const x of [-0.12, 0.14]) revolve(k, 'body', (a, b, cc) => [a, b, cc], [x, 0.86, 0.13], 'y', [[0.035, 0], [0.025, 0.018], [0, 0.024]], 5, M.brass);
      return;
    }
    case 'rootbound': {
      // bark pauldrons with root straps winding round them and across the chest
      for (const s of SIDES) {
        k.ellip(arm(s), [s * 0.228, 1.29, 0], [0.1, 0.078, 0.118], main, { seg: 9, lat: 5, flat: true, power: 0.8, noOcc: true,
          deform: (l) => { if (l.y < -0.4) l.y = -0.4; }, paint: (_w, _uv, l) => (l.y < -0.25 ? trim : Math.sin(l.x * 18 + l.z * 7) > 0.6 ? shade(main, 0.78) : undefined) });
      }
      k.tube('body', [[0.21, 1.3, 0.04], [0.08, 1.16, 0.165], [-0.1, 1.0, 0.16], [-0.2, 0.9, 0.08]], 0.02, trim, { seg: 4, noOcc: true });
      k.tube('body', [[-0.21, 1.3, 0.04], [-0.06, 1.2, 0.17], [0.12, 1.06, 0.16]], 0.016, trim, { seg: 4, noOcc: true });
      return;
    }
    case 'brassbound': {
      // brass lames on the shoulders crowned by cog plates, a banded breastplate with rivets
      for (const s of SIDES) {
        k.ellip(arm(s), [s * 0.225, 1.29, 0], [0.103, 0.085, 0.125], main, { seg: 9, lat: 5, flat: true, power: 0.75, noOcc: true, deform: (l) => { if (l.y < -0.35) l.y = -0.35; } });
        k.ellip(arm(s), [s * 0.24, 1.22, 0], [0.08, 0.05, 0.1], shade(main, 0.88), { seg: 8, lat: 4, flat: true, noOcc: true, deform: (l) => { if (l.y < -0.2) l.y = -0.2; } });
        // the cog plate stands on the shoulder turned half to the front, so it reads from ahead and from the side
        prism(k, arm(s), basis([s * 0.235, 1.39, 0.02], [0.8, 0, -s * 0.6], [0, 1, 0]), ring2d(k.detail >= 0.75 ? 14 : 10, 0.08, 0.06), 0.025, trim, { rim: shade(trim, 0.8) });
      }
      k.lathe('body', [0, 0, 0], [[0.96, W * 1.07 + 0.02], [1.1, W * 1.1 + 0.03], [1.24, W * 1.05 + 0.02]], main, { seg: 12, sz: 0.82, caps: false, flat: true, noOcc: true, arc: [-1.3, 1.3],
        paint: (w) => (Math.abs(w.y - 1.03) < 0.02 || Math.abs(w.y - 1.17) < 0.02 ? trim : undefined) });
      if (fine(k)) for (const y of [1.03, 1.17]) for (const x of [-0.11, 0.11]) knob(k, 'body', (a, b, cc) => [a, b, cc], [x, y, Math.sqrt(Math.max(0, (W * 1.1 + 0.03) ** 2 - x * x)) * 0.82 + 0.004], 0.011, M.iron, false, 4);
      return;
    }
    case 'beaconstone': {
      // wide stone pauldrons in two lames rimmed in brass, a stone breastplate with a lit crest, a brass gorget
      for (const s of SIDES) {
        k.ellip(arm(s), [s * 0.222, 1.32, 0], [0.106, 0.11, 0.15], main, { seg: 10, lat: 5, flat: true, power: 0.75, noOcc: true,
          deform: (l) => { if (l.y < -0.35) l.y = -0.35; }, paint: (_w, _uv, l) => (l.y < -0.2 ? trim : undefined) });
        // a brass fin rising from each pauldron: the T3 shoulder line stands above the head's ears
        prism(k, arm(s), (x, y, z) => [s * 0.24 + z, 1.39 + y, x], [[-0.13, 0], [0.13, 0], [0.07, 0.07], [-0.02, 0.11], [-0.09, 0.06]], 0.022, trim);
        k.ellip(arm(s), [s * 0.235, 1.21, 0], [0.09, 0.06, 0.12], main, { seg: 8, lat: 4, flat: true, noOcc: true,
          deform: (l) => { if (l.y < -0.25) l.y = -0.25; }, paint: (_w, _uv, l) => (l.y < -0.1 ? trim : undefined) });
      }
      k.lathe('body', [0, 0, 0], [[0.95, W * 1.08 + 0.02], [1.1, W * 1.12 + 0.032], [1.25, W * 1.06 + 0.02]], main, { seg: 12, sz: 0.82, caps: false, flat: true, noOcc: true, arc: [-1.35, 1.35],
        paint: (w) => (w.y < 0.975 || w.y > 1.225 ? trim : undefined) });
      k.lathe('torso', [0, 0, 0], [[1.27, 0.15], [1.33, 0.14], [1.38, 0.125]], trim, { seg: 12, sz: 0.92, caps: false, flat: true, noOcc: true });
      const z = (W * 1.12 + 0.032) * 0.82 + 0.006;
      poly(k, 'body', [[0, 1.2, z - 0.01], [0.06, 1.12, z], [0, 1.03, z - 0.01], [-0.06, 1.12, z]], trim);
      poly(k, 'body', [[0, 1.175, z + 0.004], [0.035, 1.12, z + 0.006], [0, 1.06, z + 0.004], [-0.035, 1.12, z + 0.006]], M.glowBeacon, true);
      return;
    }
    default: return;
  }
}

// ───────── back ─────────
const jag = (n: number, d: number) => (u: number) => -d * Math.abs(Math.sin((u + 0.5) * Math.PI * n));
function buildBack(c: Ctx) {
  const { k, main, trim, set } = c;
  switch (set) {
    case 'mossweave': {
      k.lathe('torso', [0, 0, 0], [[1.13, 0.215], [1.2, 0.215], [1.28, 0.195], [1.33, 0.12]], main, { seg: 14, sz: 0.85, noOcc: true, paint: (w) => (w.y < 1.145 ? trim : undefined) });
      cape(c, { len: 0.45, top: 1.2, width: 0.85, paint: (_u, t) => (t > 0.9 ? trim : undefined) });
      const n = fine(k) ? 6 : 4;
      for (let i = 0; i < n; i++) { const u = i / (n - 1) - 0.5, a = Math.PI + u * 1.25 * 0.85 * 2, r = 0.27; const x = Math.sin(a) * r, z = Math.cos(a) * r * 0.7 - 0.12, y = 1.2 - 0.45;
        poly(k, 'cape', [[x - 0.025, y + 0.01, z], [x + 0.025, y + 0.01, z], [x, y - 0.07, z - 0.01]], trim); }
      return;
    }
    case 'wickthread': {
      k.lathe('torso', [0, 0, 0], [[1.12, 0.22], [1.2, 0.22], [1.28, 0.2], [1.33, 0.12]], main, { seg: 14, sz: 0.85, noOcc: true, paint: (w) => (w.y < 1.14 ? trim : undefined) });
      cape(c, { len: 0.8, top: 1.24, width: 0.55, paint: (u, t) => (t > 0.9 || Math.abs(u) > 0.42 ? trim : undefined) });
      knob(k, 'cape', (x, y, z) => [x, y, z], [0, 0.4, -0.31], 0.03, M.ember, false, 4);
      return;
    }
    case 'lenslight': {
      collar(c, main, 0.21, 0.13);
      cape(c, { len: 1.05, width: 1.0, paint: (u, t) => (t > 0.92 || Math.abs(u) > 0.45 ? trim : undefined) });
      revolve(k, 'torso', (x, y, z) => [x, y, z], [0, 1.36, -0.2], 'z', [[0, 0.07], [-0.02, 0.07]], segs(k, 10, 6), trim);
      revolve(k, 'torso', (x, y, z) => [x, y, z], [0, 1.36, -0.222], 'z', [[0, 0.045], [-0.005, 0.045]], segs(k, 9, 6), M.glowLens, true);
      return;
    }
    case 'thornrunner': {
      collar(c, main, 0.2, 0.1);
      cape(c, { len: 0.55, hem: jag(5, 0.12), paint: (_u, t) => (t > 0.85 ? trim : undefined) });
      return;
    }
    case 'cinderstep': {
      collar(c, main, 0.2, 0.11);
      cape(c, { len: 0.72, hem: jag(7, 0.16), paint: (_u, t) => (t > 0.86 ? M.soot : t > 0.72 ? mix(main, M.emberDeep, 0.6) : undefined) });
      for (const s of SIDES) prism(k, 'torso', (x, y, z) => [s * 0.13 + x, 1.27 + y, 0.13 + z], [[-0.02, -0.02], [0.02, -0.02], [0.02, 0.02], [-0.02, 0.02]], 0.014, trim);
      return;
    }
    case 'tollwind': {
      collar(c, main, 0.21, 0.13);
      cape(c, { len: 1.0, width: 1.0, sweep: 0, hem: (u) => 0.08 * u, paint: (u, t) => (t > 0.9 || Math.abs(u) > 0.44 ? trim : undefined) });
      if (fine(k)) for (const s of SIDES) revolve(k, 'cape', (x, y, z) => [x, y, z], [s * 0.27 + 0.1, 0.31 + s * 0.04, -0.32], 'y', [[0.035, 0], [0.025, 0.02], [0, 0.026]], 5, M.brass);
      return;
    }
    case 'rootbound': {
      k.lathe('torso', [0, 0, -0.01], [[1.16, 0.22], [1.24, 0.235], [1.32, 0.19], [1.37, 0.13]], main, { seg: 12, sz: 0.88, flat: true, noOcc: true,
        paint: (w) => (w.y < 1.18 ? trim : Math.sin(w.x * 60) > 0.6 ? shade(main, 0.8) : undefined) });
      cape(c, { len: 0.78, hem: jag(4, 0.06), paint: (_u, t) => (t > 0.88 ? trim : undefined) });
      return;
    }
    case 'brassbound': {
      k.lathe('torso', [0, 0, -0.01], [[1.2, 0.22], [1.26, 0.23], [1.33, 0.18]], trim, { seg: 12, sz: 0.88, flat: true, noOcc: true });
      cape(c, { len: 0.85, paint: (u, t) => (t > 0.9 ? trim : Math.abs(u) > 0.44 ? shade(main, 0.8) : undefined) });
      if (fine(k)) for (const s of [-1, 0, 1]) knob(k, 'cape', (x, y, z) => [x, y, z], [s * 0.18, 0.47, -0.33 + Math.abs(s) * 0.05], 0.022, M.brass, false, 4);
      return;
    }
    case 'beaconstone': {
      k.lathe('torso', [0, 0, -0.01], [[1.18, 0.225], [1.25, 0.24], [1.33, 0.19], [1.38, 0.13]], main, { seg: 12, sz: 0.88, flat: true, noOcc: true, paint: (w) => (w.y < 1.2 ? trim : undefined) });
      cape(c, { len: 1.1, width: 1.08, paint: (u, t) => (t > 0.9 || Math.abs(u) > 0.45 ? trim : undefined) });
      poly(k, 'cape', [[0, 1.08, -0.27], [0.08, 0.95, -0.29], [0, 0.78, -0.31], [-0.08, 0.95, -0.29]], trim);
      return;
    }
    default: return;
  }
}

// ───────── legs ─────────
function legsOverride(c: { main: Color3; type: ArmourType }): GearBodyOverride {
  return c.type === 'heavy' ? { legs: shade(mix(c.main, M.steel, 0.4), 0.7) } : c.type === 'cloth' ? { legs: shade(c.main, 0.85) } : { legs: c.main };
}
function buildLegs(c: Ctx) {
  const { k, main, trim, set, type, tier } = c;
  for (const s of SIDES) {
    const g = leg(s), x = s * 0.1;
    if (type === 'cloth') {
      k.lathe(g, [x, 0, 0], [[0.36, 0.07], [0.42, 0.075]], trim, { seg: 8, caps: false, noOcc: true });
      k.lathe(g, [x, 0, 0], [[0.44, 0.077], [0.5, 0.079]], main, { seg: 8, caps: false, noOcc: true });
      if (set === 'lenslight' && fine(k)) knob(k, g, (a, b, cc) => [a, b, cc], [x, 0.47, 0.08], 0.016, M.glass, false, 4);
    } else if (type === 'light') {
      k.ellip(g, [x, 0.5, 0.06], [0.06, 0.062, 0.04], main, { seg: 7, lat: 4, flat: true, noOcc: true });
      k.lathe(g, [x, 0, 0], [[0.62, 0.088], [0.66, 0.09]], trim, { seg: 8, caps: false, noOcc: true });
      if (set === 'thornrunner') cone(k, g, [x, 0.52, 0.09], [x, 0.56, 0.16], 0.016, trim, 3);
      if (set === 'cinderstep') k.lathe(g, [x, 0, 0], [[0.7, 0.091], [0.73, 0.092]], M.ember, { seg: 8, caps: false, noOcc: true });
      if (set === 'tollwind') k.tube(g, [[x + s * 0.085, 0.84, 0], [x + s * 0.09, 0.56, -0.01]], 0.012, trim, { seg: 3, noOcc: true });
    } else {
      // knee cops, a shin plate and the cuisse's rim
      k.ellip(g, [x, 0.5, 0.055], [0.07, 0.07, 0.055], main, { seg: 7, lat: 4, flat: true, power: 0.7, noOcc: true, paint: (_w, _uv, l) => (l.y > 0.5 ? trim : undefined) });
      k.lathe(g, [x, 0, 0.012], [[0.14, 0.072], [0.3, 0.078], [0.44, 0.08]], main, { seg: 8, sz: 1.1, arc: [-1.2, 1.2], caps: false, flat: true, noOcc: true });
      k.lathe(g, [x, 0, 0], [[0.6, 0.092], [0.64, 0.096]], trim, { seg: 8, caps: false, noOcc: true });
      if (tier >= 2 && fine(k)) knob(k, g, (a, b, cc) => [a, b, cc], [x, 0.5, 0.115], 0.016, set === 'brassbound' ? M.iron : trim, false, 4);
    }
  }
  if (type === 'heavy' && tier >= 2) {
    // tassets: plates hanging from the belt over the thighs
    for (const s of SIDES) k.ellip('body', [s * 0.11, 0.8, 0.12], [0.085, 0.085, 0.03], main, { seg: 6, lat: 4, flat: true, power: 0.6, noOcc: true, rot: [0.15, s * 0.35, 0], paint: (_w, _uv, l) => (l.y < -0.5 ? trim : undefined) });
  }
}

// ───────── hands ─────────
function buildHands(c: Ctx) {
  const { k, main, trim, set, type } = c;
  for (const s of SIDES) {
    const g = arm(s), hx = s * (0.235 + 0.028), ax = s * 0.247;
    if (type === 'cloth') {
      k.ellip(g, [hx, 0.715, 0.01], [0.045, 0.052, 0.054], main, { seg: 7, lat: 4, noOcc: true, deform: (l) => { if (l.y < -0.3) l.y = -0.3; } });
      k.lathe(g, [ax, 0, 0], [[0.75, 0.054], [0.8, 0.058]], trim, { seg: 8, caps: false, noOcc: true });
      if (set === 'lenslight') revolve(k, g, (a, b, cc) => [a, b, cc], [hx + s * 0.03, 0.72, 0.035], 'x', [[0, 0.016], [s * 0.004, 0.016]], 5, M.glass);
    } else if (type === 'light') {
      k.ellip(g, [hx, 0.712, 0.01], [0.047, 0.064, 0.055], main, { seg: 7, lat: 4, noOcc: true, power: 0.85 });
      k.lathe(g, [ax, 0, 0], [[0.74, 0.055], [0.8, 0.06], [0.84, 0.068]], trim, { seg: 8, caps: false, noOcc: true });
      if (set === 'thornrunner') cone(k, g, [hx + s * 0.02, 0.73, 0.04], [hx + s * 0.035, 0.76, 0.09], 0.012, trim, 3);
    } else {
      k.ellip(g, [hx, 0.71, 0.012], [0.046, 0.07, 0.062], main, { seg: 7, lat: 4, flat: true, noOcc: true, power: 0.7 });
      k.lathe(g, [ax, 0, 0], [[0.74, 0.058], [0.8, 0.066], [0.88, 0.08]], main, { seg: 8, caps: false, flat: true, noOcc: true, paint: (w) => (w.y > 0.86 ? trim : undefined) });
      prism(k, g, (x, y, z) => [hx + s * (0.034 + z), 0.69 + y, 0.012 + x], [[-0.04, -0.03], [0.04, -0.03], [0.03, 0.03], [-0.03, 0.03]], 0.012, trim);
    }
  }
}

// ───────── feet ─────────
const BOOT_TOP: Record<ArmourType, number[]> = { cloth: [0, 0.15, 0.17, 0.2], light: [0, 0.44, 0.4, 0.5], heavy: [0, 0.42, 0.42, 0.44], plain: [0.38, 0.38, 0.38, 0.38] };
function feetOverride(c: { main: Color3; type: ArmourType; tier: number }): GearBodyOverride {
  return { boots: c.type === 'heavy' ? shade(mix(c.main, M.steel, 0.3), 0.75) : c.main, bootTop: BOOT_TOP[c.type][c.tier] };
}
function buildFeet(c: Ctx) {
  const { k, main, trim, set, type, tier } = c;
  for (const s of SIDES) {
    const g = leg(s), x = s * 0.1, top = BOOT_TOP[type][tier]!;
    if (type === 'cloth') {
      k.ellip(g, [x, 0.06, 0.08], [0.075, 0.05, 0.11], main, { seg: 7, lat: 4, noOcc: true, power: 0.8, deform: (l) => { if (l.y < -0.4) l.y = -0.4; } });
      k.tube(g, [[x, 0.06, 0.17], [x, 0.08, 0.22], [x, 0.12, 0.23]], [0.022, 0.014, 0.004], trim, { seg: 4, noOcc: true });
      if (set === 'mossweave') poly(k, g, [[x - 0.03, 0.1, 0.12], [x + 0.03, 0.1, 0.12], [x, 0.14, 0.17]], trim);
    } else if (type === 'light') {
      k.lathe(g, [x, 0, 0], [[top - 0.02, 0.086], [top + 0.03, 0.092]], main, { seg: 8, caps: false, noOcc: true });
      const lace: V3[] = [];
      for (let i = 0; i <= 2; i++) lace.push([x + (i % 2 ? 0.03 : -0.03), 0.14 + (i / 2) * (top - 0.18), 0.075]);
      k.tube(g, lace, 0.008, trim, { seg: 3, noOcc: true });
      if (set === 'thornrunner') cone(k, g, [x, 0.08, -0.06], [x, 0.09, -0.13], 0.014, trim, 3);
      if (set === 'cinderstep') prism(k, g, (a, b, cc) => [x + a, 0.2 + b, 0.08 + cc], [[-0.025, -0.02], [0.025, -0.02], [0.025, 0.02], [-0.025, 0.02]], 0.012, M.ember);
      if (set === 'tollwind' && fine(k)) revolve(k, g, (a, b, cc) => [a, b, cc], [x + s * 0.09, top - 0.02, 0], 'y', [[0.03, 0], [0.02, 0.016], [0, 0.02]], 5, M.brass);
    } else {
      k.ellip(g, [x, 0.07, 0.1], [0.08, 0.055, 0.1], main, { seg: 7, lat: 4, flat: true, power: 0.6, noOcc: true, deform: (l) => { if (l.y < -0.5) l.y = -0.5; } });
      k.lathe(g, [x, 0, 0], [[0.15, 0.085], [0.2, 0.09]], trim, { seg: 8, caps: false, flat: true, noOcc: true });
      k.lathe(g, [x, 0, 0], [[top - 0.03, 0.09], [top + 0.02, 0.1]], trim, { seg: 8, caps: false, flat: true, noOcc: true });
    }
  }
}

// ───────── costumes ─────────
function costumeOverride(id: CostumeId, o: Own): GearBodyOverride {
  const base: GearBodyOverride = { noTabard: true, pouch: false, belt: null, buckle: null, vneck: null, sleeveColor: o.main };
  switch (id) {
    case 'lamplighter_coat': return { ...base, top: o.main, topTrim: o.trim, hem: 0.3, flare: 0.05, sleeves: 'long', legs: shade(M.soot, 1.3), boots: M.leather, bootTop: 0.4, belt: M.leather, buckle: o.trim, vneck: mix(P.cloud, P.stone, 0.5) };
    case 'solstice_finery': return { ...base, top: o.main, topTrim: o.trim, hem: 0.08, flare: 0.06, sleeves: 'long', legs: o.trim, boots: o.trim, bootTop: 0.12, belt: o.trim };
    case 'orchard_smock': return { ...base, top: o.main, topTrim: o.trim, hem: 0.56, flare: 0.07, sleeves: 'rolled', legs: M.leatherLight, boots: M.leather, bootTop: 0.36 };
    case 'harbour_oilskin': return { ...base, top: o.main, topTrim: o.trim, hem: 0.48, flare: 0.06, sleeves: 'long', legs: o.trim, boots: M.soot, bootTop: 0.5 };
    case 'mothsilk_gown': return { ...base, top: o.main, topTrim: o.trim, hem: 0.04, flare: 0.07, sleeves: 'long', legs: o.main, boots: o.main, bootTop: 0.1 };
    case 'ploughmans_weeds': return { ...base, top: o.main, topTrim: o.main, hem: 0.88, flare: 0, sleeves: 'rolled', legs: o.trim, boots: shade(M.leather, 0.8), bootTop: 0.3 };
    case 'starfall_regalia': return { ...base, top: o.main, topTrim: o.trim, hem: 0.04, flare: 0.07, sleeves: 'long', legs: o.main, boots: o.trim, bootTop: 0.12 };
    default: return {};
  }
}
const star = (k: ShapeKit, g: 'body' | 'head' | 'torso', at: V3, r: number, col: Color3, glow: boolean) =>
  poly(k, g, [[at[0], at[1] + r, at[2]], [at[0] + r * 0.28, at[1] + r * 0.28, at[2]], [at[0] + r, at[1], at[2]], [at[0] + r * 0.28, at[1] - r * 0.28, at[2]], [at[0], at[1] - r, at[2]], [at[0] - r * 0.28, at[1] - r * 0.28, at[2]], [at[0] - r, at[1], at[2]], [at[0] - r * 0.28, at[1] + r * 0.28, at[2]]], col, glow);
/** A point on the tunic's front (W·sz), for buttons and emblems. */
const front = (y: number, x = 0, out = 0.006): V3 => [x, y, Math.sqrt(Math.max(0, 0.19 ** 2 - x * x)) * 0.8 + out];
function buildCostume(c: Ctx, id: CostumeId) {
  const { k, main, trim } = c;
  const id3 = (a: number, b: number, cc: number): V3 => [a, b, cc];
  switch (id) {
    case 'lamplighter_coat': {
      k.lathe('torso', [0, 0, 0], [[1.25, 0.18], [1.33, 0.17], [1.4, 0.15]], main, { seg: 12, sz: 0.9, caps: false, noOcc: true, arc: [Math.PI * 0.4, Math.PI * 1.6], paint: (w) => (w.y > 1.37 ? trim : undefined) });
      for (const y of [1.18, 1.08, 0.98, 0.88]) knob(k, 'body', id3, front(y, 0.05), 0.014, trim, false, 4);
      // a little brass lamp hanging at the hip
      revolve(k, 'body', id3, [-0.24, 0.72, 0.05], 'y', [[0, 0.03], [0.02, 0.035], [0.08, 0.035], [0.1, 0.02], [0.12, 0]], segs(k, 6, 5), (r) => (r === 1 || r === 2 ? M.glass : trim));
      k.tube('body', [[-0.21, 0.92, 0.04], [-0.24, 0.84, 0.05]], 0.006, M.iron, { seg: 3, noOcc: true });
      return;
    }
    case 'solstice_finery': {
      // a sun-ray collar, a sash and a sun brooch
      const n = fine(k) ? 12 : 8;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, cx = Math.sin(a), cz = Math.cos(a) * 0.85;
        poly(k, 'torso', [[cx * 0.16 - cz * 0.03, 1.32, cz * 0.16 + cx * 0.03], [cx * 0.16 + cz * 0.03, 1.32, cz * 0.16 - cx * 0.03], [cx * 0.27, 1.27, cz * 0.27]], i % 2 ? trim : main); }
      k.tube('body', [[0.17, 1.25, 0.1], [0, 1.02, 0.17], [-0.19, 0.78, 0.13]], 0.03, trim, { seg: 4, noOcc: true, flatten: 0.4 });
      revolve(k, 'torso', id3, [0, 1.2, 0.16], 'z', [[0, 0.04], [0.012, 0.04]], segs(k, 10, 6), trim);
      return;
    }
    case 'orchard_smock': {
      const grid: V3[][] = [];
      for (let i = 0; i <= 4; i++) { const y = 1.0 - (i / 4) * 0.42; grid.push([-1, -0.5, 0, 0.5, 1].map((u) => [u * 0.15, y, 0.165 + (1.0 - y) * 0.16 - Math.abs(u) * 0.05] as V3)); }
      k.sheet('body', grid, 0.012, trim, { paint: (_w, uv) => (uv[1] > 0.88 ? shade(trim, 0.8) : undefined) });
      poly(k, 'body', [[-0.08, 0.84, 0.205], [0.08, 0.84, 0.205], [0.08, 0.74, 0.22], [-0.08, 0.74, 0.22]], main);
      for (const x of [-0.03, 0.03]) knob(k, 'body', id3, [x, 0.86, 0.2], 0.026, M.berry, false, 5);
      return;
    }
    case 'harbour_oilskin': {
      // a wide flared collar, a short shoulder cape and toggles
      k.lathe('torso', [0, 0, 0], [[1.27, 0.16], [1.36, 0.2], [1.42, 0.24]], main, { seg: 12, sz: 0.85, caps: false, noOcc: true, flat: true, arc: [Math.PI * 0.3, Math.PI * 1.7] });
      k.lathe('torso', [0, 0, -0.01], [[1.1, 0.25], [1.2, 0.235], [1.3, 0.19], [1.33, 0.15]], main, { seg: 12, sz: 0.85, noOcc: true, flat: true, paint: (w) => (w.y < 1.12 ? trim : undefined) });
      for (const y of [1.0, 0.86, 0.72]) prism(k, 'body', (a, b, cc) => { const f = front(y, 0, 0.01); return [f[0] + a, f[1] + b, f[2] + cc]; }, [[-0.03, -0.008], [0.03, -0.008], [0.03, 0.008], [-0.03, 0.008]], 0.014, trim);
      return;
    }
    case 'mothsilk_gown': {
      // moth wings at the back with eye spots, a soft ruff
      for (const s of SIDES) {
        poly(k, 'cape', [[s * 0.04, 1.26, -0.17], [s * 0.26, 1.33, -0.24], [s * 0.3, 1.1, -0.25], [s * 0.2, 0.92, -0.22], [s * 0.05, 0.98, -0.18]], main);
        poly(k, 'cape', [[s * 0.05, 0.96, -0.18], [s * 0.2, 0.9, -0.22], [s * 0.22, 0.7, -0.22], [s * 0.08, 0.76, -0.19]], main);
        star(k, 'torso', [s * 0.19, 1.16, -0.245], 0.04, trim, false);
      }
      k.lathe('torso', [0, 0, 0], [[1.29, 0.14], [1.33, 0.18], [1.37, 0.15]], trim, { seg: 12, sz: 0.9, caps: false, noOcc: true });
      return;
    }
    case 'ploughmans_weeds': {
      for (const s of SIDES) k.tube('body', [[s * 0.1, 0.9, 0.16], [s * 0.11, 1.15, 0.165], [s * 0.1, 1.31, 0.06], [s * 0.06, 1.2, -0.16], [s * 0.08, 0.9, -0.15]], 0.012, trim, { seg: 4, noOcc: true, flatten: 0.5 });
      k.lathe('body', [0, 0, 0], [[0.86, 0.2], [0.92, 0.2]], trim, { seg: 12, sz: 0.8, caps: false, noOcc: true });
      poly(k, 'torso', [[-0.08, 1.33, 0.12], [0.08, 1.33, 0.12], [0, 1.24, 0.17]], P.roof);
      for (const s of SIDES) poly(k, leg(s), [[s * 0.1 - 0.035, 0.54, 0.085], [s * 0.1 + 0.035, 0.54, 0.085], [s * 0.1 + 0.035, 0.46, 0.08], [s * 0.1 - 0.035, 0.46, 0.08]], shade(main, 0.85));
      return;
    }
    case 'starfall_regalia': {
      // a robe of night with stars that shine, and a star-pointed collar
      const stars: V3[] = [front(1.12, -0.08, 0.01), front(0.95, 0.09, 0.03), [0.13, 0.62, 0.17], [-0.15, 0.42, 0.18], [0.04, 0.28, 0.21], [-0.05, 0.75, 0.19]];
      for (const p of stars.slice(0, fine(k) ? 6 : 3)) star(k, 'body', p, 0.03, M.glowStar, true);
      const n = fine(k) ? 10 : 6;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, cx = Math.sin(a), cz = Math.cos(a) * 0.85;
        poly(k, 'torso', [[cx * 0.15 - cz * 0.03, 1.33, cz * 0.15 + cx * 0.03], [cx * 0.15 + cz * 0.03, 1.33, cz * 0.15 - cx * 0.03], [cx * 0.24, 1.36, cz * 0.24]], trim); }
      k.lathe('torso', [0, 0, 0], [[1.3, 0.14], [1.34, 0.15]], main, { seg: 10, caps: false, noOcc: true });
      return;
    }
    case 'straw_sunhat': {
      k.lathe('head', [0, HY + 0.12, -0.01], [[0, 0.31], [0.015, 0.29], [0.03, 0.21], [0.14, 0.18], [0.16, 0]], main, { seg: 14, noOcc: true });
      k.lathe('head', [0, HY + 0.12, -0.01], [[0.035, 0.197], [0.075, 0.19]], trim, { seg: 14, noOcc: true, caps: false });
      if (fine(k)) for (let i = 0; i < 5; i++) { const a = 0.6 + i * 0.4; poly(k, 'head', [[Math.sin(a) * 0.205, HY + 0.2, Math.cos(a) * 0.205], [Math.sin(a + 0.15) * 0.22, HY + 0.24, Math.cos(a + 0.15) * 0.22], [Math.sin(a + 0.3) * 0.205, HY + 0.2, Math.cos(a + 0.3) * 0.205]], P.cloud); }
      return;
    }
    case 'brass_goggles': {
      k.lathe('head', [0, 0, -0.01], [[HY + 0.1, 0.222], [HY + 0.14, 0.224]], trim, { seg: 14, caps: false, noOcc: true });
      for (const s of SIDES) {
        revolve(k, 'head', id3, [s * 0.078, HY + 0.13, 0.19], 'z', [[0, 0.062], [0.05, 0.062], [0.065, 0.055]], segs(k, 9, 6), main);
        revolve(k, 'head', id3, [s * 0.078, HY + 0.13, 0.256], 'z', [[0, 0.046], [0.002, 0.046]], segs(k, 9, 6), M.glass);
      }
      return;
    }
    case 'owlfeather_circlet': {
      k.lathe('head', [0, 0, -0.01], [[HY + 0.1, 0.212], [HY + 0.12, 0.214]], main, { seg: 14, caps: false, noOcc: true });
      const n = fine(k) ? 7 : 5;
      for (let i = 0; i < n; i++) {
        const a = Math.PI * 0.55 + (i / (n - 1)) * Math.PI * 0.9, sx = Math.sin(a), sz = Math.cos(a), r = 0.215;
        poly(k, 'head', [[sx * r, HY + 0.11, sz * r], [sx * (r + 0.05) + sz * 0.025, HY + 0.22, sz * (r + 0.05) - sx * 0.025], [sx * (r + 0.07), HY + 0.4 - Math.abs(i - (n - 1) / 2) * 0.035, sz * (r + 0.07)], [sx * (r + 0.05) - sz * 0.025, HY + 0.22, sz * (r + 0.05) + sx * 0.025]], [trim, trim, P.cloud, shade(trim, 0.7)]);
      }
      knob(k, 'head', id3, [0, HY + 0.12, 0.215], 0.022, M.violet, false, 5);
      return;
    }
    case 'beacon_halo': {
      // a gold ring floating over the head with a ring of light inside it and four little beacon flames
      const n = segs(k, 18, 10), ring = (r: number): V3[] => Array.from({ length: n + 1 }, (_, i) => { const a = (i / n) * Math.PI * 2; return [Math.sin(a) * r, HY + 0.34, Math.cos(a) * r - 0.02]; });
      k.tube('head', ring(0.19), 0.014, main, { seg: 4, noOcc: true, caps: false });
      k.tube('head', ring(0.165), 0.012, M.glowBeacon, { seg: 4, noOcc: true, caps: false, glow: true });
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4, x = Math.sin(a) * 0.19, z = Math.cos(a) * 0.19 - 0.02;
        knob(k, 'head', id3, [x, HY + 0.34, z], 0.02, trim, false, 4);
        cone(k, 'head', [x, HY + 0.355, z], [x, HY + 0.43, z], 0.016, M.glowWarm, 3, true); }
      return;
    }
    case 'patchwork_cape': {
      collar(c, main, 0.2, 0.11);
      const patch = [main, trim, P.teal, M.leatherLight, P.gold, mix(P.cloud, P.stone, 0.5)];
      cape(c, { len: 0.75, hem: jag(3, 0.05), paint: (u, t) => {
        if (t > 0.92) return trim;
        const cell = (Math.floor((u + 0.5) * 3.99) + Math.floor(t * 3.99) * 2) % 6;
        return patch[cell];
      } });
      return;
    }
    case 'kitewing_mantle': {
      // two kite panels on spars, their borders in the trim, a ribbon tail
      for (const s of SIDES) {
        poly(k, 'cape', [[s * 0.03, 1.3, -0.2], [s * 0.2, 1.16, -0.27], [s * 0.05, 0.62, -0.25], [s * 0.0, 1.0, -0.21]], main);
        poly(k, 'cape', [[s * 0.06, 1.2, -0.215], [s * 0.15, 1.12, -0.255], [s * 0.065, 0.84, -0.24]], trim);
        k.tube('cape', [[s * 0.03, 1.3, -0.205], [s * 0.05, 0.62, -0.255]], 0.008, M.wood, { seg: 3, noOcc: true });
      }
      k.tube('cape', [[0, 0.7, -0.25], [0.05, 0.5, -0.29], [-0.03, 0.32, -0.3], [0.03, 0.16, -0.3]], [0.02, 0.018, 0.015, 0.004], trim, { seg: 3, flatten: 0.3, noOcc: true });
      return;
    }
    case 'mapmakers_satchel': {
      // a satchel at the hip on a strap across the chest, a map case on the back with rolled maps
      k.tube('body', [[-0.17, 1.3, 0.05], [-0.04, 1.2, 0.165], [0.12, 1.02, 0.16], [0.22, 0.88, 0.06]], 0.016, main, { seg: 4, noOcc: true, flatten: 0.5 });
      prism(k, 'body', (a, b, cc) => [0.24 + cc, 0.8 + b, 0.02 + a], [[-0.09, -0.07], [0.09, -0.07], [0.09, 0.07], [-0.09, 0.07]], 0.06, main);
      poly(k, 'body', [[0.275, 0.87, -0.07], [0.275, 0.87, 0.11], [0.276, 0.79, 0.1], [0.276, 0.79, -0.06]], trim);
      revolve(k, 'torso', id3, [0.06, 1.0, -0.24], 'y', [[0, 0.045], [0.38, 0.045]], segs(k, 7, 5), M.leather);
      for (const dx of [-0.02, 0.02]) revolve(k, 'torso', id3, [0.06 + dx, 1.38, -0.24], 'y', [[0, 0.018], [0.08, 0.018]], 5, trim);
      return;
    }
    default: return;
  }
}

// ───────── the plan and the build ─────────
export interface Piece { slot: GearSlot; model: number; dye: [number, number] }
/** The pieces a gear look shows (null slots drop out: a costume already took them, or the head is hidden). */
export function gearPieces(g: GearLook): Piece[] {
  const out: Piece[] = [];
  for (const s of GEAR_LOOK_SLOTS) { const v = g[s] as GearLookSlot | null; if (v && modelInfo(v.model)) out.push({ slot: s, model: v.model, dye: [v.dye[0], v.dye[1]] }); }
  return out;
}
const COVERS_HAIR = (i: ModelInfo | null) => !!i && ((i.kind === 'armour' && i.set !== 'plain') || (i.kind === 'costume' && (i.costume === 'straw_sunhat')));

function plan(g: GearLook, _look: AdventurerLook): GearPlan {
  const body: GearBodyOverride = {};
  const info = (s: GearSlot) => { const v = g[s]; return v ? modelInfo(v.model) : null; };
  const dye = (s: GearSlot): [number, number] => { const v = g[s]; return v ? [v.dye[0], v.dye[1]] : [0, 0]; };
  const chest = info('chest'), legs = info('legs'), feet = info('feet'), back = info('back'), head = info('head');
  if (chest?.kind === 'armour') {
    if (chest.set === 'plain') { const o = dyed(OWN.plain, dye('chest')); body.top = o.main; body.topTrim = o.trim; }
    else Object.assign(body, chestOverride({ ...dyed(OWN[chest.set], dye('chest')), type: chest.type, tier: chest.tier }));
  } else if (chest?.kind === 'costume') Object.assign(body, costumeOverride(chest.costume, dyed(COSTUME_OWN[chest.costume], dye('chest'))));
  if (legs?.kind === 'armour') {
    // Grove-Spun trousers: channel 2 (the creator's second outfit dye), else their own cream
    if (legs.set === 'plain') body.legs = dyeColour(dye('legs')[1], dyeColour(0, mix(P.cloud, P.stone, 0.55)));
    else Object.assign(body, legsOverride({ main: dyed(OWN[legs.set], dye('legs')).main, type: legs.type }));
  }
  if (feet?.kind === 'armour') {
    if (feet.set === 'plain') body.boots = dyeColour(dye('feet')[0], M.leather);
    else Object.assign(body, feetOverride({ main: dyed(OWN[feet.set], dye('feet')).main, type: feet.type, tier: feet.tier }));
  }
  if (back && !(back.kind === 'armour' && back.set === 'plain')) { body.noCape = true; body.scarf = false; }
  const w = info('weapon'), o = info('offhand');
  const replaces: string[] = [];
  // (the shield's back mount and the daggers' back sheath are not used with gear: character.ts keeps them on the arm and hips)
  if (w?.kind === 'weapon') replaces.push(...weaponJoints(w.weapon), ...(w.weapon === 'daggers' ? ['dagBack'] : []));
  if (o?.kind === 'offhand') replaces.push(...offhandJoints(o.offhand), ...(o.offhand === 'shield' ? ['shieldBack'] : []));
  return {
    body: Object.keys(body).length ? body : null,
    replaces,
    offhand: o?.kind === 'offhand' ? o.offhand : null,
    headCue: !g.hideHead && (!head || (head.kind === 'armour' && head.set === 'plain')),
    shoulderCue: !chest || (chest.kind === 'armour' && chest.set === 'plain'),
    hair: !COVERS_HAIR(head),
    headAccent: !!head && head.kind === 'armour' && head.set !== 'plain',
    shoulderAccent: !!chest && chest.kind === 'armour' && chest.set !== 'plain',
  };
}

/** Builds one model with its dyes into a kit (armour and costumes in their slot; weapons and off-hands on their joints). */
export function buildModel(k: ShapeKit, model: number, dye: readonly [number, number]): boolean {
  const i = modelInfo(model);
  if (!i) return false;
  if (i.kind === 'weapon') { buildWeapon(k, i.weapon, i.tier, i.second); return true; }
  if (i.kind === 'offhand') { buildOffhand(k, i.offhand, i.tier); return true; }
  if (i.kind === 'costume') {
    const o = dyed(COSTUME_OWN[i.costume], dye);
    buildCostume({ k, main: o.main, trim: o.trim, set: 'plain', tier: 0, type: 'plain' }, i.costume);
    return true;
  }
  if (i.set === 'plain') return true;   // the adventurer's own clothes (character.ts), recoloured by the plan
  const o = dyed(OWN[i.set], dye), c: Ctx = { k, main: o.main, trim: o.trim, set: i.set, tier: i.tier, type: i.type };
  switch (i.slot) {
    case 'head': buildHead(c); break;
    case 'chest': buildChest(c); break;
    case 'legs': buildLegs(c); break;
    case 'hands': buildHands(c); break;
    case 'feet': buildFeet(c); break;
    case 'back': buildBack(c); break;
  }
  return true;
}

/** character.ts's gear hooks (registered by online.ts and the dev pages: `setGearBuilder(gearHooks)`). */
export const gearHooks: GearHooks & { pieces(g: GearLook): Piece[] } = {
  plan,
  build(k, g) { for (const p of gearPieces(g)) buildModel(k, p.model, p.dye); },
  pieces: gearPieces,
};

// ───────── standalone builds (tests, budgets, the dev page) ─────────
export interface PieceBuild {
  slot: GearSlot | 'costume';
  positions: Float32Array; colours: Float32Array; groups: string[]; triangles: number;
  glowPositions: Float32Array; glowTriangles: number;
}
/** One model built alone (canonical space, or warped for `look`), at a quality's level of detail. */
export function buildPiece(model: number, dye: readonly [number, number], q: Quality = 'med', look: AdventurerLook | null = null): PieceBuild | null {
  const i = modelInfo(model);
  if (!i) return null;
  const pk = pieceKit(DETAIL[q], look);
  buildModel(pk.k, model, dye);
  const r = pk.read();
  return { slot: i.slot, positions: r.positions, colours: r.colours, groups: r.groups, triangles: r.triangles, glowPositions: r.glowPositions, glowTriangles: r.glowTriangles };
}
/** The triangles a gear look's pieces build (skinned and emissive), not counting what they recut in the body. */
export function gearTriangles(g: GearLook, look: AdventurerLook | null, q: Quality = 'med'): number {
  let n = 0;
  for (const p of gearPieces(g)) { const b = buildPiece(p.model, p.dye, q, look); if (b) n += b.triangles + b.glowTriangles; }
  return n;
}

// ───────── kits (tests and the dev page) ─────────
const slotOf = (id: string | null) => (id && ITEMS[id] ? { model: ITEMS[id]!.model, dye: [0, 0] as [number, number] } : null);
/** A job's full kit of a tier (0: the starter kit) as a gear look, every piece dyed `dye`. */
export function kitGear(tier: 0 | 1 | 2 | 3, job: JobId, dye: [number, number] = [0, 0], costumes: Parameters<typeof resolveGearLook>[1] = {}, hideHead = false): GearLook {
  const ids: Record<GearSlot, string | null> = tier === 0
    ? Object.fromEntries((['head', 'chest', 'legs', 'hands', 'feet', 'back', 'weapon', 'offhand'] as GearSlot[]).map((s) => [s, starterFor(job, s)])) as Record<GearSlot, string | null>
    : kitItems(tier, job);
  const worn = Object.fromEntries(Object.entries(ids).map(([s, id]) => { const v = slotOf(id); return [s, v ? { ...v, dye } : null]; }));
  return resolveGearLook(worn, costumes, hideHead);
}
/** A set's six pieces on a job, with that set's tier of the job's weapon and off-hand. */
export function setGear(set: SetId, job: JobId, dye: [number, number] = [0, 0]): GearLook {
  const tier = SETS[set].tier as 0 | 1 | 2 | 3;
  const g = kitGear(tier, job, dye);
  for (const s of ARMOUR_SLOTS) g[s] = { model: ITEMS[`${set}_${s}`]!.model, dye };
  return g;
}
/** The off-hand kind a job carries (null: none). */
export const offhandOf = (job: JobId): OffhandKind | null => OFFHAND_FOR[JOBS[job].weapon];
