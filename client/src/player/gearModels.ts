// Gear and costumes on the adventurer: every look id (shared ITEMS models and COSTUME_PIECES) → its piece.
//  · Armour and costume pieces are DATA (gearDefs.ts: template + parameters + modules + palette), built by the
//    fitter (gearFit.ts) on the wearer's own body: a piece is defined once and fits every people and build. Each slot
//    draws only its region (head, chest with the upper arms, hands to the forearm, legs from the hips to the shins,
//    feet, back), so pieces of any sets mix; layers stack legs → feet → chest → hands → back → head.
//  · Weapons and off-hands (weaponModels.ts) ride their joints, scaled with the wearer (character.ts).
// Fitted pieces are cached per (body shape × piece × detail × the pieces under it × dyes), bounded (GEAR_CACHE_SIZE):
// a crowd of different bodies builds each piece once per body; a dye or gear change rebuilds only what changed.
// Dyes: three channels per slot (primary, secondary, trim); DYES[0] (#000000, "Undyed") is the piece's own colours,
// never black; every dye's lightness is clamped (look.ts renderColour) so nothing vanishes.
import type { Color3 } from '@babylonjs/core';
import {
  ARMOUR_SLOTS, COSTUME_PIECES, COSTUME_PIECE_IDS, DYES, GEAR_LOOK_SLOTS, ITEMS, LOOKS, LOOK_PRESETS, SETS, SET_IDS, JOBS, OFFHAND_FOR, encodeLook, kitItems, resolveGearLook, starterFor, upgradeGearLook,
  type ArmourSlot, type ArmourType, type CostumeId, type CostumePieceSlot, type GearLook, type GearLookSlotV2, type GearLookV2, type GearSlot, type JobId, type Look as AdventurerLook, type OffhandKind, type SetId, type WeaponId,
} from '@sg2/shared';
import type { Quality } from '../core/contracts';
import { DETAIL, appendChunk, pieceKit, type GearBodyOverride, type GearChunk, type GearFitIn, type GearFitOut, type GearHooks, type GearPlan, type ShapeKit } from './character';
import { bodyFrame, faceParams, lookColours, makeAttachWarp, renderColour } from './look';
import { headShape } from './face2';
import { legY, type BodyCover, type HairEnvelope } from './body2';
import { Fit, emptyLayer, type FitMeta, type FittedPiece, type LayerSnapshot } from './gearFit';
import { DEFS, HEAD_COVER, buildDef, type Cols, type PieceDef } from './gearDefs';
import { M, P, mix } from './gearKit';
import { EMBER_LENS_MODEL, buildOffhand, buildWeapon, offhandJoints, weaponJoints } from './weaponModels';

// ───────── model ids (shared/src/items.ts and costumes.ts) ─────────
const WEAPON_ORDER: readonly WeaponId[] = ['blade', 'bow', 'sword', 'greatsword', 'daggers', 'staff'];
const OFFHAND_ORDER: readonly OffhandKind[] = ['buckler', 'quiver', 'shield', 'tome'];
const COSTUME_PIECE_BY_MODEL = new Map(COSTUME_PIECE_IDS.map((id) => [COSTUME_PIECES[id]!.model, COSTUME_PIECES[id]!]));

export type ModelInfo =
  | { kind: 'armour'; slot: ArmourSlot; set: SetId; type: ArmourType; tier: number; named: false }
  | { kind: 'weapon'; slot: 'weapon'; weapon: WeaponId; tier: number; named: boolean; second: boolean }
  | { kind: 'offhand'; slot: 'offhand'; offhand: OffhandKind; tier: number; named: false }
  | { kind: 'costume'; slot: CostumePieceSlot; costume: CostumeId; part: CostumePieceSlot; tier: 0; named: false };

/** What a model id is (null: no item or costume piece has it). */
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
  const c = COSTUME_PIECE_BY_MODEL.get(model);
  return c ? { kind: 'costume', slot: c.slot, costume: c.costume, part: c.slot, tier: 0, named: false } : null;
}

// ───────── colours ─────────
const dyeCache = new Map<number, Color3>();
/** A dye's colour, or `own` for Undyed (DYES[0], #000000 — never black) and anything out of range. */
export function dyeColour(d: number, own: Color3): Color3 {
  if (!Number.isInteger(d) || d <= 0 || d >= DYES.length) return own;
  let c = dyeCache.get(d);
  if (!c) { c = renderColour(parseInt(DYES[d]!.hex.slice(1), 16)); dyeCache.set(d, c); }
  return c;
}
export type Dye3 = readonly [number, number, number];
/** A definition's colours with a slot's three dyes. */
export const dyedCols = (d: PieceDef, dye: Dye3): Cols => ({ a: dyeColour(dye[0], d.pal[0]), b: dyeColour(dye[1], d.pal[1]), c: dyeColour(dye[2], d.pal[2]) });
/** Each set's own primary and trim (the dev pages' swatches). */
export const OWN: Readonly<Record<SetId, { main: Color3; trim: Color3 }>> = Object.fromEntries(SET_IDS.map((s) => {
  const d = DEFS.get(ITEMS[`${s}_chest`]!.model)!;
  return [s, { main: d.pal[0], trim: d.pal[2] }];
})) as Record<SetId, { main: Color3; trim: Color3 }>;

// ───────── gear looks ─────────
/** Either gear code's look, as v2 (a v1 look upgraded: dyes [a, b, 0], hideHead → the hidden head). */
export type AnyGearLook = GearLook | GearLookV2;
export const asV2 = (g: AnyGearLook): GearLookV2 => ('hidden' in g ? g : upgradeGearLook(g));
export interface Piece { slot: GearSlot; model: number; dye: Dye3 }
/** The pieces a gear look shows (hidden and empty slots drop out). */
export function gearPieces(g0: AnyGearLook): Piece[] {
  const g = asV2(g0), out: Piece[] = [];
  for (const s of GEAR_LOOK_SLOTS) { const v = g[s] as GearLookSlotV2 | null; if (v && modelInfo(v.model)) out.push({ slot: s, model: v.model, dye: [v.dye[0], v.dye[1], v.dye[2]] }); }
  return out;
}
/** The definition a worn look id has in its slot (null: a weapon, an off-hand, or a look that does not fit there). */
export function defFor(slot: GearSlot, model: number): PieceDef | null {
  const d = DEFS.get(model);
  return d && d.slot === slot ? d : null;
}

/** The clothes under gear: a linen shirt, braies and plain shoes (what a bare slot shows; nothing a piece covers). */
const UNDER = { shirt: mix(P.cloud, P.stone, 0.42), braies: mix(P.cloud, P.stone, 0.62), shoes: M.leather };

function plan(g0: AnyGearLook, _look: AdventurerLook): GearPlan {
  const g = asV2(g0);
  const def = (s: GearSlot) => { const v = g[s]; return v ? defFor(s, v.model) : null; };
  const head = def('head'), chest = def('chest'), legs = def('legs'), feet = def('feet'), back = def('back'), hands = def('hands');
  const any = head || chest || legs || feet || back || hands;
  const body: GearBodyOverride = {};
  if (any) {
    // the body under gear: an undershirt to the hips, braies, low shoes (seen only where no piece covers)
    Object.assign(body, { top: UNDER.shirt, topTrim: UNDER.shirt, sleeveColor: UNDER.shirt, hem: 0.86, flare: 0, sleeves: 'short', vneck: null, legs: UNDER.braies, boots: UNDER.shoes, bootTop: 0.13 } satisfies GearBodyOverride);
    if (chest || legs) { body.belt = null; body.buckle = null; body.pouch = false; }
    if (chest) body.noTabard = true;
    if (chest || back) body.scarf = false;
    // (an empty back shows the job's cape fitted over the gear: fitGear; a hidden back shows none)
    body.noCape = true;
  }
  const w = modelInfo(g.weapon?.model ?? -1), o = modelInfo(g.offhand?.model ?? -1);
  const replaces: string[] = [];
  if (w?.kind === 'weapon') replaces.push(...weaponJoints(w.weapon), ...(w.weapon === 'daggers' ? ['dagBack'] : []));
  if (o?.kind === 'offhand') replaces.push(...offhandJoints(o.offhand), ...(o.offhand === 'shield' ? ['shieldBack'] : []));
  const setPiece = (d: PieceDef | null) => !!d && d.cls !== 'plain' && d.cls !== 'costume';
  return {
    body: Object.keys(body).length ? body : null,
    replaces,
    offhand: o?.kind === 'offhand' ? o.offhand : null,
    headCue: !g.hidden.head && !g.cueHidden && (!head || head.cls === 'plain'),
    shoulderCue: !chest || chest.cls === 'plain',
    hair: !head || HEAD_COVER[head.tpl]!.hair === 'full',
    // the job's head cue goes over a set's cap, hat or circlet; a hood is its own (the cue would cover it exactly) and a
    // heavy helm hides it (shared LOOKS[id].hidesCue)
    headAccent: setPiece(head) && head!.tpl !== 'hood' && !LOOKS[g.head!.model]?.hidesCue,
    shoulderAccent: setPiece(chest),
  };
}

// ───────── fitting ─────────
const JOB_CAPE_SLOT: GearLookSlotV2 = { model: ITEMS['plain_back']!.model, dye: [0, 0, 0] };
/** The order pieces are fitted in: each goes over the ones before it. */
export const FIT_ORDER: readonly ArmourSlot[] = ['legs', 'feet', 'chest', 'hands', 'back', 'head'];
/** Fitted pieces kept (an LRU): about a crowd's worth of bodies × the pieces they wear. */
export const GEAR_CACHE_SIZE = 384;
const fitCache = new Map<string, FittedPiece>();
export const gearCacheStats = { hits: 0, builds: 0, get size() { return fitCache.size; } };
export function clearGearCache(): void { fitCache.clear(); }
const frameKey = (f: object) => Object.values(f).map((v) => (typeof v === 'number' ? v.toFixed(4) : String(v))).join(',');

interface FitInput { look: AdventurerLook; frame: ReturnType<typeof bodyFrame>; hs: ReturnType<typeof headShape>; detail: number; bootTop: number; skin: Color3 }
/** Fits the worn pieces of `g` to a body: their chunks, what they cover, and the head piece (built once the hair is). */
export function fitGear(i: FitInput, g0: AnyGearLook): { cover: BodyCover; pieces: FittedPiece[]; head: (env: HairEnvelope) => FittedPiece | null } {
  const g = asV2(g0);
  const F = new Fit({ look: i.look, f: i.frame, hs: i.hs, detail: i.detail, bootTop: i.bootTop, skin: i.skin });
  const fk = `${frameKey(i.frame)}|${i.detail}|${i.bootTop.toFixed(4)}`;
  let layer: LayerSnapshot = emptyLayer();
  let under = '';
  const anyArmour = ARMOUR_SLOTS.some((s) => { const v = g[s]; return !!v && !!defFor(s, v.model); });
  const pieces: FittedPiece[] = [];
  const cover: BodyCover = {};
  const merge = (c: BodyCover) => {
    for (const k of ['torso', 'arm', 'leg', 'neck'] as const) if (c[k]) (cover[k] ??= []).push(...c[k]!);
    if (c.hands) cover.hands = true;
    if (c.feet) cover.feet = true;
  };
  const one = (slot: ArmourSlot, env: HairEnvelope | null, extra = ''): FittedPiece | null => {
    // an empty back (not hidden) under worn gear: the job's own cape, fitted over what is worn (the starter's)
    const v = g[slot] ?? (slot === 'back' && !g.hidden.back && anyArmour ? JOB_CAPE_SLOT : null);
    const d = v ? defFor(slot, v.model) : null;
    if (!v || !d) return null;
    const key = `${fk}|${slot}|${v.model}|${v.dye.join('.')}|${under}|${extra}`;
    let fp = fitCache.get(key);
    if (fp) { fitCache.delete(key); fitCache.set(key, fp); gearCacheStats.hits++; }
    else {
      if (env) F.env = env;
      fp = F.piece(i.detail, () => buildDef(F, d, dyedCols(d, v.dye)), layer);
      fitCache.set(key, fp); gearCacheStats.builds++;
      while (fitCache.size > GEAR_CACHE_SIZE) fitCache.delete(fitCache.keys().next().value!);
    }
    layer = fp.layer; under += `${v.model},`;
    return fp;
  };
  for (const s of FIT_ORDER) {
    if (s === 'head') break;
    const fp = one(s, null);
    if (fp) { pieces.push(fp); merge(fp.cover); }
  }
  const hv = g.head, hd = hv ? defFor('head', hv.model) : null;
  if (hd) { const hc = HEAD_COVER[hd.tpl]!; cover.hair = hc.hair; if (hc.ears) cover.ears = true; }
  let lookKey: string;
  try { lookKey = encodeLook(i.look); } catch { lookKey = String(Math.random()); }
  return { cover, pieces, head: (env) => one('head', env, lookKey) };
}

/** character.ts's gear hooks (registered by online.ts and the dev pages: `setGearBuilder(gearHooks)`). */
export const gearHooks: GearHooks & { pieces(g: AnyGearLook): Piece[] } = {
  plan,
  /** Weapons and off-hands (armour and costumes are fitted: `fit`). */
  build(k, g) {
    for (const p of gearPieces(g)) {
      const i = modelInfo(p.model);
      if (i?.kind === 'weapon' && p.slot === 'weapon') buildWeapon(k, i.weapon, i.tier, i.second);
      else if (i?.kind === 'offhand' && p.slot === 'offhand') buildOffhand(k, i.offhand, i.tier);
    }
  },
  fit(i: GearFitIn): GearFitOut {
    const r = fitGear(i, i.gear);
    return { cover: r.cover, chunks: r.pieces.map((p) => p.chunk), head: (env) => { const h = r.head(env); return h ? [h.chunk] : []; } };
  },
  pieces: gearPieces,
};

/** Builds one model with its dyes into a kit: weapons and off-hands on their joints (armour is fitted: buildPiece). */
export function buildModel(k: ShapeKit, model: number, dye: readonly number[]): boolean {
  const i = modelInfo(model);
  if (!i) return false;
  void dye;
  if (i.kind === 'weapon') { buildWeapon(k, i.weapon, i.tier, i.second); return true; }
  if (i.kind === 'offhand') { buildOffhand(k, i.offhand, i.tier); return true; }
  return DEFS.has(model);
}

// ───────── standalone builds (tests, budgets, the dev page) ─────────
export interface PieceBuild {
  slot: GearSlot;
  positions: Float32Array; colours: Float32Array; groups: string[]; triangles: number;
  glowPositions: Float32Array; glowTriangles: number;
  /** The fit test's ranges (armour and costumes). */
  meta: FitMeta[];
  cover: BodyCover;
}
/** The inputs to fit pieces to a look's body (standalone: no character). */
export function fitInputOf(look: AdventurerLook, q: Quality | number = 'med'): FitInput {
  const frame = bodyFrame(look), warp = makeAttachWarp(frame);
  return { look, frame, hs: headShape(frame, faceParams(look)), detail: typeof q === 'number' ? q : DETAIL[q], bootTop: legY(warp, 0.13), skin: lookColours(look).skin };
}
const readChunk = (c: GearChunk) => ({
  positions: Float32Array.from(c.g.pos), colours: Float32Array.from(c.g.col), groups: c.g.grp.slice() as string[], triangles: c.g.triangles,
  glowPositions: Float32Array.from(c.glow.pos), glowTriangles: c.glow.triangles,
});
/** One model built alone: armour and costumes fitted on `look`'s body (or a default one), weapons on their joints. */
export function buildPiece(model: number, dye: readonly number[], q: Quality | number = 'med', look: AdventurerLook | null = null): PieceBuild | null {
  const i = modelInfo(model);
  if (!i) return null;
  if (i.kind === 'weapon' || i.kind === 'offhand') {
    const pk = pieceKit(typeof q === 'number' ? q : DETAIL[q], look);
    buildModel(pk.k, model, dye);
    const r = pk.read();
    return { slot: i.slot, positions: r.positions, colours: r.colours, groups: r.groups, triangles: r.triangles, glowPositions: r.glowPositions, glowTriangles: r.glowTriangles, meta: [], cover: {} };
  }
  const d = DEFS.get(model);
  if (!d) return null;
  const L = look ?? defaultFitLook();
  const inp = fitInputOf(L, q);
  const g = resolveGearLook({}, {}, false), v2 = upgradeGearLook(g);
  v2[d.slot] = { model, dye: [dye[0] ?? 0, dye[1] ?? 0, dye[2] ?? 0] };
  const r = fitGear(inp, v2);
  const fp = d.slot === 'head' ? r.head(() => 0) : r.pieces[0] ?? null;
  if (!fp) return null;
  return { slot: d.slot, ...readChunk(fp.chunk), meta: fp.meta, cover: fp.cover };
}
/** The body pieces are fitted to when none is given: a preset Human man. */
const defaultFitLook = (): AdventurerLook => LOOK_PRESETS.find((p) => p.look.people === 'human' && p.look.body === 'male')!.look;

/** The triangles a gear look's pieces build (skinned and emissive), not counting what they leave out of the body. */
export function gearTriangles(g: AnyGearLook, look: AdventurerLook | null, q: Quality = 'med'): number {
  let n = 0;
  for (const p of gearPieces(g)) { const b = buildPiece(p.model, p.dye, q, look); if (b) n += b.triangles + b.glowTriangles; }
  return n;
}

// ───────── kits (tests and the dev page) ─────────
const slotOf = (id: string | null) => (id && ITEMS[id] ? { model: ITEMS[id]!.model, dye: [0, 0] as [number, number] } : null);
/** A job's full kit of a tier (0: the starter kit) as a gear look (v2), every piece dyed `dye`. */
export function kitGear(tier: 0 | 1 | 2 | 3, job: JobId, dye: readonly number[] = [0, 0, 0], costumes: Parameters<typeof resolveGearLook>[1] = {}, hideHead = false): GearLookV2 {
  const ids: Record<GearSlot, string | null> = tier === 0
    ? Object.fromEntries((['head', 'chest', 'legs', 'hands', 'feet', 'back', 'weapon', 'offhand'] as GearSlot[]).map((s) => [s, starterFor(job, s)])) as Record<GearSlot, string | null>
    : kitItems(tier, job);
  const worn = Object.fromEntries(Object.entries(ids).map(([s, id]) => { const v = slotOf(id); return [s, v ? { ...v, dye: [dye[0] ?? 0, dye[1] ?? 0] } : null]; }));
  const g = upgradeGearLook(resolveGearLook(worn, costumes, hideHead));
  for (const s of GEAR_LOOK_SLOTS) { const v = g[s]; if (v) v.dye = [dye[0] ?? 0, dye[1] ?? 0, dye[2] ?? 0]; }
  return g;
}
/** A set's six pieces on a job, with that set's tier of the job's weapon and off-hand. */
export function setGear(set: SetId, job: JobId, dye: readonly number[] = [0, 0, 0]): GearLookV2 {
  const tier = SETS[set].tier as 0 | 1 | 2 | 3;
  const g = kitGear(tier, job, dye);
  for (const s of ARMOUR_SLOTS) g[s] = { model: ITEMS[`${set}_${s}`]!.model, dye: [dye[0] ?? 0, dye[1] ?? 0, dye[2] ?? 0] };
  return g;
}
/** A gear look with chosen looks per armour slot (any mix of sets and costume pieces) over a job's kit of a tier. */
export function mixGear(job: JobId, tier: 0 | 1 | 2 | 3, looks: Partial<Record<ArmourSlot, number | null>>, dye: readonly number[] = [0, 0, 0]): GearLookV2 {
  const g = kitGear(tier, job, dye);
  for (const [s, m] of Object.entries(looks) as [ArmourSlot, number | null][]) g[s] = m === null ? null : { model: m, dye: [dye[0] ?? 0, dye[1] ?? 0, dye[2] ?? 0] };
  return g;
}
/** The off-hand kind a job carries (null: none). */
export const offhandOf = (job: JobId): OffhandKind | null => OFFHAND_FOR[JOBS[job].weapon];
export { DEFS };
