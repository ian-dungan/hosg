// Every armour and costume look, as data: a piece = a base silhouette TEMPLATE + its PARAMETERS + trim and ornament
// MODULES + a PALETTE (primary, secondary, trim: the three dye channels; dye 0 = these own colours). Templates and
// modules are built by gearFit.ts on the wearer's own body, so one definition fits every people and build.
// Adding a look is one row in DEFS (see docs/superpowers/specs/2026-11-16-gear-fit.md for two worked examples).
//
// Reading at a glance: cloth is long and soft (robes, wraps, hoods, sleeves to the wrist, low shoes), light is fitted
// leather (jerkins to the hip, straps, laced boots, caps), heavy is plate and mail (breastplates, pauldrons, tassets,
// greaves, sabatons, helms). Tiers grow: T1 modest, T2 more trim and ornament, T3 the widest shoulders, the longest
// robes and capes, the tallest helms and a glow. Sets repeat their motif in every slot: Mossweave leaves, Wickthread
// embers, Lenslight lenses, Thornrunner thorns, Cinderstep scorch and ember buckles, Tollwind wind-tails and bells,
// Rootbound bark and roots, Brassbound brass bands, rivets and cogs, Beaconstone stone, brass and the beacon's light.
import { Color3, Vector3 } from '@babylonjs/core';
import type { Fit, ShellOpts } from './gearFit';
import { AST, ST } from './bodySurface';
import { M, P, cone, knob, mix, poly, prism, revolve, ring2d, shade } from './gearKit';
import type { V3 } from './character';

export type DefSlot = 'head' | 'chest' | 'legs' | 'hands' | 'feet' | 'back';
export type DefClass = 'plain' | 'cloth' | 'light' | 'heavy' | 'costume';
type Val = number | string | boolean;
export type Params = Readonly<Record<string, Val>>;
export interface PieceDef {
  /** The look id (an item's or a costume piece's model). */
  readonly id: number;
  readonly slot: DefSlot; readonly cls: DefClass; readonly tier: number;
  /** The base silhouette (TEMPLATES[slot][tpl]). */
  readonly tpl: string;
  readonly p: Params;
  /** Trim and ornament modules, in order: [name, params]. */
  readonly mods: readonly (readonly [string, Params?])[];
  /** Own colours: primary, secondary, trim. */
  readonly pal: readonly [Color3, Color3, Color3];
  /** A lit colour (the emissive mesh) for its glowing parts, if any. */
  readonly glow?: Color3;
}

/** The colours a piece is built in (its palette with the slot's three dyes applied). */
export interface Cols { a: Color3; b: Color3; c: Color3 }
export interface Ctx { F: Fit; p: Params; C: Cols; def: PieceDef; glow: Color3 | null }
const TAU = Math.PI * 2;
const num = (v: Val | undefined, d: number) => (typeof v === 'number' ? v : d);
const str = (v: Val | undefined, d: string) => (typeof v === 'string' ? v : d);
const sh = shade;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sm = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
const pick = (C: Cols, k: Val | undefined, d: Color3): Color3 => (k === 'a' ? C.a : k === 'b' ? C.b : k === 'c' ? C.c : k === 'leather' ? M.leather : k === 'brass' ? M.brass : k === 'iron' ? M.iron : k === 'steel' ? M.steel : k === 'soot' ? M.soot : k === 'gold' ? M.gold : k === 'wood' ? M.wood : d);

// ───────── shared pieces of templates ─────────
/** The cloth's soft fold shading round the body. */
const folds = (c: Color3, a: number, amt = 0.05, n = 6) => sh(c, 1 - amt + amt * Math.cos(a * n));
/** Mail: rows of rings (alternate rows a shade apart). */
const mail = (c: Color3, u: number) => sh(c, Math.floor(u * 9) % 2 ? 0.86 : 1.0);

/** Sleeves of a chest piece on both arms: none, cap, short, elbow, long, bell (loose, flaring to the cuff). */
function sleeves(x: Ctx, kind: string, o: { off: number; col: (u: number, a: number) => Color3; cuff?: Color3; bell?: number; flat?: boolean; to?: number }) {
  const { F } = x;
  if (kind === 'none') return;
  const end = o.to ?? ({ cap: 0.85, short: 1.6, elbow: 3.15, long: 4.9, bell: 4.75 } as Record<string, number>)[kind] ?? 1.6;
  const bell = kind === 'bell' ? (o.bell ?? 0.05) : 0;
  const cuffH = kind === 'long' || kind === 'bell' ? 0.35 : 0.22;
  const rows = F.rowsFor('arm', 0, end, [end - cuffH]);
  F.shell({ region: 'arm', rows, off: (u) => o.off + bell * Math.pow(Math.max(0, (u - 2.6) / (end - 2.6)), 1.6), flat: o.flat, cls: bell ? 'loose' : 'tight',
    col: (u, a) => (o.cuff && u > end - cuffH ? o.cuff : o.col(u, a)) });
}

/** A belt round the torso at u, over everything worn, with a buckle in front. */
function belt(x: Ctx, u: number, col: Color3, buckle: Color3 | null, h = 0.16, thick = 0.007) {
  const { F } = x;
  F.band('torso', u, h, thick, col, { mult: 1 });
  if (buckle) {
    const fr = F.frame('torso', 1, u, 0, thick + 0.004);
    prism(F.k, 'body', fr, [[-0.022, -0.016], [0.022, -0.016], [0.022, 0.016], [-0.022, 0.016]], 0.008, buckle, { rim: sh(buckle, 0.8) });
  }
}

/** The job's tabard down the front (the job's colour: recoloured by setCape), narrowed by `w`. */
function jobTabard(x: Ctx, w: number, bottom: number) {
  const { F } = x;
  const half = (t: number) => (0.042 + 0.016 * t) * w;
  F.panel({ top: ST.CHEST + 0.5, bottom, half, col: (v, t) => (Math.abs(v) > 0.82 || t > 0.93 ? GOLD_TRIM : JOB_CLOTH), tag: 1, tagSkip: GOLD_TRIM, rows: F.fine ? 6 : 4 });
}
/** The colour the job cloth is built in (character.ts recolours it to the job's), and its gold trim (kept). */
export const JOB_CLOTH = P.skyDeep;
export const GOLD_TRIM = P.gold;

// ───────── chest templates ─────────
/**
 * garment: a tunic, jerkin, robe, coat or gown. p: hem (u of the torso part's lower edge), skirt (u of a skirt's hem,
 * 0 = none), flare, open (a coat's open front: radians each side), sleeve, bell, off, neck (round, v, high, wrap,
 * square), pattern (plain, panel, stripes, quilt, halves), skirt2 (a shorter over-skirt's hem), slit (side slits).
 */
function garment(x: Ctx) {
  const { F, p, C } = x;
  const off = num(p.off, 0.008), hem = num(p.hem, 5.4), pat = str(p.pattern, 'plain'), neck = str(p.neck, 'round');
  const cloth = x.def.cls === 'cloth' || x.def.cls === 'costume' || x.def.cls === 'plain';
  const body = (u: number, a: number): Color3 => {
    const s = Math.sin(a), c = Math.cos(a);
    if (u < hem + 0.14) return C.c;                                                   // the hem's band
    if (neck === 'v' && c > 0.8 && u > ST.CHEST + 0.15 + (1 - c) * 4.5) return C.b;     // the shirt in the V
    if (neck === 'wrap' && c > 0.2 && Math.abs(s * 2.2 - (u - ST.WAIST) * 0.55) < 0.12) return C.c; // a wrap's crossing edge
    if (neck === 'square' && c > 0.7 && u > ST.CHEST + 0.35) return C.b;
    if (pat === 'panel' && Math.abs(s) > 0.78) return C.b;
    if (pat === 'stripes' && Math.cos(a * 5) > 0.55) return C.b;
    if (pat === 'halves' && s > 0) return C.b;
    if (pat === 'quilt') return sh(C.a, (Math.floor(u * 4) + Math.floor((a / TAU) * 10)) % 2 ? 0.9 : 1.02);
    if (pat === 'laced' && c > 0.93 && u > ST.WAIST && u < ST.SH) return C.c;
    return cloth ? folds(C.a, a, 0.035) : C.a;
  };
  const rows = F.rowsFor('torso', Math.max(4.95, hem), ST.NECK, [hem + 0.14]);
  F.shell({ region: 'torso', rows, off: (u, a) => off + (u < ST.HIP ? num(p.flare, 0) * (ST.HIP - u) : 0) + (pat === 'quilt' ? 0.003 : 0) * Math.cos(a * 10) ** 2, col: body, flat: !!p.flatTorso });
  const sl = str(p.sleeve, 'short');
  sleeves(x, sl, { off: off + 0.001, col: (u, a) => (pat === 'stripes' && Math.cos(a * 3) > 0.7 ? C.b : cloth ? folds(C.a, a, 0.04, 3) : C.a), cuff: C.c, bell: num(p.bell, 0.05) });
  // the skirt (a robe, a coat's tails, a gown)
  const skirt = num(p.skirt, 0);
  if (skirt > 0) {
    const open = num(p.open, 0), slit = num(p.slit, 0);
    const hemF = p.hemShape === 'swallow' ? (a: number) => skirt - 0.9 * Math.max(0, -Math.cos(a)) : p.hemShape === 'dip' ? (a: number) => skirt + 0.5 * Math.max(0, Math.cos(a)) : p.hemShape === 'jag' ? (a: number) => skirt + 0.35 * Math.abs(Math.sin(a * 4)) : (() => skirt);
    F.skirt({ top: ST.HIP + 0.15, hem: hemF, flare: num(p.flare2, 0.05), clear: num(p.clear, 0.012), arc: open ? [open, TAU - open] : undefined,
      col: (t, a) => (t > 0.9 ? C.c : pat === 'panel' && Math.abs(Math.sin(a)) > 0.8 ? C.b : slit && Math.abs(Math.abs(Math.sin(a)) - 1) < 0.08 && t > 0.5 ? C.b : folds(C.a, a, 0.06, 8)) });
    const s2 = num(p.skirt2, 0);
    if (s2 > 0) F.skirt({ top: ST.HIP + 0.3, hem: s2, flare: 0.03, clear: num(p.clear, 0.012) + 0.012, arc: open ? [open + 0.15, TAU - open - 0.15] : undefined, col: (t, a) => (t > 0.85 ? C.c : folds(C.b, a, 0.06, 8)) });
  }
  // the collar
  if (neck === 'high') F.shell({ region: 'neck', rows: [ST.NECK - 0.05, ST.NECK + 0.5], off: off + 0.004, col: (u) => (u > ST.NECK + 0.38 ? C.c : C.a), hide: true });
  if (neck === 'cowl') F.shell({ region: 'torso', rows: F.rowsFor('torso', ST.SH - 0.3, ST.NECK), off: off + 0.014, col: (u) => (u < ST.SH - 0.15 ? C.c : C.b), hide: false, lip: 'first', cls: 'loose' });
}

/**
 * cuirass: heavy armour. p: hem (the undercoat's edge), skirt (mail skirt hem u), plate (front and back plates'
 * offset), ridge, lames (fauld bands at the waist), paul (round, lames, bark, cog, fin, spiked), paulSize, gorget,
 * sleeve (mail sleeves: elbow or long), coat (cloth or mail undercoat).
 */
function cuirass(x: Ctx) {
  const { F, p, C } = x;
  const hem = num(p.hem, 5.2), coat = str(p.coat, 'mail');
  const under = (u: number) => (coat === 'mail' ? mail(C.b, u) : folds(C.b, u * 3, 0.05));
  F.shell({ region: 'torso', rows: F.rowsFor('torso', Math.max(4.95, hem), ST.NECK), off: 0.01, col: (u) => (u < hem + 0.12 ? sh(C.b, 0.8) : under(u)) });
  sleeves(x, str(p.sleeve, 'elbow'), { off: 0.01, col: (u) => under(u), cuff: sh(C.b, 0.8) });
  if (num(p.skirt, 0) > 0) F.skirt({ top: ST.HIP + 0.2, hem: num(p.skirt, 4.3), flare: 0.02, clear: 0.01, col: (t) => (t > 0.86 ? sh(C.b, 0.75) : mail(C.b, t * 4)), flat: coat === 'mail' });
  // breast- and backplate: arcs over the undercoat, edged in the trim, a ridge down the middle
  const plate = num(p.plate, 0.024), ridge = num(p.ridge, 0.006), top = ST.SH + 0.5, bot = ST.WAIST - 0.15;
  const pcol = (edge: Color3) => (u: number, a: number) => (u < bot + 0.12 || u > top - 0.12 ? edge : str(p.bands, '') && Math.abs(((u - bot) * 3) % 1 - 0.5) < 0.07 ? edge : C.a);
  F.shell({ region: 'torso', rows: F.rowsFor('torso', bot, top, [bot + 0.12, top - 0.12]), arc: [-1.3, 1.3], off: (_u, a) => plate + ridge * Math.cos(a) ** 6, col: pcol(C.c), flat: true, hide: false, lip: 'both', cls: 'tight' });
  F.shell({ region: 'torso', rows: F.rowsFor('torso', bot, top, [bot + 0.12, top - 0.12]), arc: [Math.PI - 1.2, Math.PI + 1.2], off: plate * 0.85, col: pcol(sh(C.c, 0.85)), flat: true, hide: false, lip: 'both', cls: 'tight' });
  // faulds: lames round the waist and hips
  const n = num(p.lames, 2);
  for (let i = 0; i < n; i++) F.band('torso', ST.WAIST - 0.3 - i * 0.32, 0.3, 0.008, (_u, a) => (Math.cos(a * 2) > 0.9 ? C.c : sh(C.a, 0.92 - i * 0.04)), { flat: true });
  if (p.gorget) F.shell({ region: 'neck', rows: [ST.NECK - 0.1, ST.NECK + 0.45], off: 0.014, col: (u) => (u > ST.NECK + 0.33 ? C.c : C.a), flat: true, hide: true });
  pauldrons(x, str(p.paul, 'round'), num(p.paulSize, 1));
}

/** Pauldrons by style, sized to the shoulder they cover. */
function pauldrons(x: Ctx, style: string, size: number) {
  const { F, C } = x;
  const kk = F.kk, f = F.f;
  const bark = (l: Vector3) => (l.y < -0.15 ? C.c : Math.sin(l.x * 14 + l.z * 6) > 0.55 ? sh(C.a, 0.78) : undefined);
  const rim = (l: Vector3) => (l.y < -0.12 ? C.c : undefined);
  // (aspect: x out, y up, z front-back; the dome is fitted round the shoulder, `scale` grows it past the fit)
  switch (style) {
    case 'none': return;
    case 'bark': F.pauldron({ aspect: [1.0, 0.75, 1.05], scale: size, col: C.a, paint: bark, flat: true, power: 0.8, cut: -0.4 }); break;
    case 'lames': case 'cog': F.pauldron({ aspect: [1.0, 0.8, 1.05], scale: size, lames: 1, col: C.a, paint: rim, flat: true, power: 0.75, cut: -0.3 }); break;
    case 'fin': F.pauldron({ aspect: [1.05, 0.9, 1.15], scale: size, lames: 2, lift: 0.01, col: C.a, paint: rim, flat: true, power: 0.72, cut: -0.3 }); break;
    case 'spiked': F.pauldron({ aspect: [0.95, 0.7, 1.0], scale: size, col: C.a, paint: rim, flat: true, power: 0.8, cut: -0.35 }); break;
    default: F.pauldron({ aspect: [1.0, 0.78, 1.05], scale: size, col: C.a, paint: rim, flat: true, power: 0.8, cut: -0.35 });
  }
  void kk; void f;
}

// ───────── legs ─────────
/**
 * trousers (every class): p: off, loose (flare at the ankle), hem (u of the leg's end: 1.05 the ankle, 2.6 a
 * breech), rise (u of the seat's top), knee (pad, patch, cop), stripe (side stripe in trim), wraps (shin bands),
 * cuisse / greave (heavy plates on thigh and shin), tassets (plates hanging from the waist), mail.
 */
function trousers(x: Ctx) {
  const { F, p, C } = x;
  const off = num(p.off, 0.006), loose = num(p.loose, 0), hem = num(p.hem, 1.05), rise = num(p.rise, ST.WAIST - 0.1);
  const isMail = !!p.mail;
  const col = (u: number, a: number): Color3 => {
    if (p.stripe && Math.abs(Math.abs(Math.sin(a)) - 1) < 0.12 && Math.sin(a) > 0) return C.c;
    if (p.wraps && u < ST.KNEE - 0.1 && u > hem + 0.1 && Math.abs(((u * 4 + a * 0.3) % 1) - 0.5) < 0.16) return C.c;
    if (u < hem + 0.12 && !p.noCuff) return C.c;
    return isMail ? mail(C.b, u) : folds(C.a, a, 0.04, 3);
  };
  F.shell({ region: 'torso', rows: F.rowsFor('torso', 4.95, rise, [rise - 0.12]), off, col: (u, a) => (u > rise - 0.12 ? C.c : isMail ? mail(C.b, u) : C.a) });
  F.shell({ region: 'leg', rows: F.rowsFor('leg', hem, 6.4, [hem + 0.12]), off: (u) => off + loose * Math.pow(Math.max(0, (ST.KNEE - u) / (ST.KNEE - hem)), 1.5) + (u > ST.THIGH ? num(p.puff, 0) * Math.sin(((u - ST.THIGH) / 2) * Math.PI) : 0), col, cls: loose > 0.02 ? 'loose' : 'tight' });
  const knee = str(p.knee, '');
  for (const side of [-1, 1]) {
    if (knee === 'pad' || knee === 'patch') {
      const fr = F.frame('leg', side, ST.KNEE + 0.05, 0, 0.004);
      F.mark('orn', 'leg', () => prism(F.k, side < 0 ? 'legL' : 'legR', fr, ring2d(F.fine ? 8 : 6, 0.034, 0.034), 0.006, knee === 'patch' ? C.b : C.c));
    }
    if (knee === 'cop') kneeCop(x, side);
  }
  if (p.cuisse) F.shell({ region: 'leg', rows: F.rowsFor('leg', ST.KNEE + 0.4, ST.CROTCH + 0.3), arc: [-1.25, 1.25], off: 0.022, col: (u) => (u < ST.KNEE + 0.55 || u > ST.CROTCH + 0.15 ? C.c : C.a), flat: true, hide: false });
  if (p.greave) F.shell({ region: 'leg', rows: F.rowsFor('leg', 1.25, ST.KNEE - 0.3), arc: [-1.35, 1.35], off: 0.02, col: (u) => (u > ST.KNEE - 0.45 ? C.c : C.a), flat: true, hide: false });
  if (p.tassets) F.skirt({ top: ST.HIP + 0.4, hem: num(p.tassets, 4.6), arc: [-1.15, 1.15], flare: 0.01, clear: 0.012, rows: 3, flat: true, col: (t, a) => (t > 0.8 || Math.abs(Math.sin(a * 2)) < 0.12 ? C.c : sh(C.a, t > 0.45 ? 0.92 : 1)), cls: 'free' });
}
/** A knee cop: a cup over the knee's front, its back flat and clear of the leg. */
function kneeCop(x: Ctx, side: number) {
  const { F, C } = x;
  const f = F.f, kk = F.kk, r = f.kneeR;
  const { p, n } = F.at('leg', side, ST.KNEE + 0.08, 0);
  const lift = F.under('leg', ST.KNEE) + 0.004 * kk + r * 0.55 * 0.25;
  F.mark('orn', 'leg', () => F.k.ellip(side < 0 ? 'legL' : 'legR', [p[0] + n[0] * lift, p[1], p[2] + n[2] * lift], [r * 1.05, r * 1.15, r * 0.55], C.a, { seg: F.fine ? 8 : 6, lat: 4, flat: true, power: 0.75, noOcc: true,
    deform: (l) => { if (l.z < -0.25) l.z = -0.25; }, paint: (_w, _uv, l) => (l.y > 0.55 || l.y < -0.6 ? C.c : undefined) }));
}

// ───────── hands ─────────
/** gloves: p: off, cuff (AST u the cuff reaches up the forearm), flare, fingers (full, bare, mitten), plates, wraps, trim. */
function gloves(x: Ctx) {
  const { F, p, C } = x;
  const off = num(p.off, 0.004), cuffTo = num(p.cuff, 4.3), flare = num(p.flare, 0);
  const rows = F.rowsFor('arm', cuffTo, 5.05, [cuffTo + 0.15]);
  // over a fitted sleeve; under a loose one (it ends inside the sleeve)
  let maxUnder = 0;
  for (const u of rows) maxUnder = Math.max(maxUnder, F.under('arm', u));
  const overOK = maxUnder <= 0.018 * F.kk;
  const capOff = overOK ? undefined : Math.max(0.0045, maxUnder / F.kk - 0.004);
  F.shell({ region: 'arm', rows, over: overOK, off: (u) => Math.min(capOff ?? 1, off + 0.003 + flare * Math.pow(Math.max(0, (5 - u) / (5 - cuffTo)), 1.4)), flat: !!p.plates,
    col: (u, a) => (u < cuffTo + 0.15 ? C.c : p.wraps && Math.abs(((u * 5 + a * 0.4) % 1) - 0.5) < 0.18 ? C.b : C.a), cls: flare > 0.012 ? 'loose' : 'tight' });
  const fingers = str(p.fingers, 'full');
  F.hands({ off, col: C.a, fingers: fingers === 'bare' ? F.skin : fingers === 'tip' ? C.b : C.a, mitten: fingers === 'mitten', flat: !!p.plates,
    paint: p.plates ? (l, part) => (part === 'palm' && l.x * 0 + l.z > 0.55 ? C.c : part === 'fingers' && Math.abs((l.y * 3) % 1) < 0.2 ? sh(C.a, 0.8) : undefined)
      : p.wraps ? (l) => (Math.abs(((l.y * 2.5 + l.z) % 1)) < 0.25 ? C.b : undefined) : undefined });
}

// ───────── feet ─────────
/** boots: p: off, shaft (u the shaft reaches), toe, heel, fold (a turned-down cuff), laces, plates (sabatons), sole. */
function boots(x: Ctx) {
  const { F, p, C } = x;
  const off = num(p.off, 0.006), shaft = num(p.shaft, 1.6);
  const sole = pick(C, p.sole, sh(C.a, 0.5));
  F.feet({ off, col: C.a, sole, toe: str(p.toe, 'round') as 'round', heel: num(p.heel, 0), flat: !!p.plates, long: num(p.long, 0),
    paint: p.plates ? (l) => (Math.abs(((l.z + 1) * 3) % 1) < 0.18 ? C.c : undefined) : p.toecap ? (l) => (l.z > 0.55 ? C.c : undefined) : undefined });
  if (shaft > 1.05) {
    const rows = F.rowsFor('leg', 1.0, shaft, [shaft - 0.15]);
    F.shell({ region: 'leg', rows, off: (u) => off + num(p.flare, 0) * Math.max(0, (u - shaft + 0.6) / 0.6), flat: !!p.plates, col: (u, a) => (u > shaft - 0.15 ? C.c : p.laces && Math.cos(a) > 0.88 && Math.abs(((u * 6) % 1) - 0.5) < 0.2 ? C.b : C.a) });
    if (p.fold) F.band('leg', shaft - 0.08, 0.22, 0.008, C.b);
  }
}

// ───────── head ─────────
/** A polar edge by azimuth: `front` at the face, `side` at the ears, `back` at the nape (radians from the crown). */
const edge = (front: number, side: number, back: number) => (ph: number) => { const c = Math.cos(ph); return c > 0 ? lerp(side, front, Math.pow(c, 1.5)) : lerp(side, back, Math.pow(-c, 1.2)); };
/** Holes for the ears that a head piece covers. */
const holesUnder = (F: Fit, thMax: (ph: number) => number) => F.earHoles().filter((h) => Math.acos(h.d[1]) < thMax(Math.atan2(h.d[0], h.d[2])) + 0.1);

/** hood: p: off, point (a tall tip's length), drape (cowl over the shoulders), rim. */
function hood(x: Ctx) {
  const { F, p, C } = x;
  const th = edge(num(p.front, 1.0), 2.25, 2.55);
  const off = num(p.off, 0.03);
  F.headShell({ thMax: th, off: (d) => off + 0.012 * Math.max(0, -d[1]), col: (d) => (Math.acos(d[1]) > th(Math.atan2(d[0], d[2])) - 0.16 && d[2] > -0.2 ? C.c : folds(C.a, Math.atan2(d[0], d[2]), 0.04, 5)), holes: holesUnder(F, th), overHair: true });
  const pt = num(p.point, 0);
  if (pt > 0) {
    const kk = F.kk, top = F.headAt([0, 0.72, -0.69], off * kk + F.env([0, 0.72, -0.69]));
    const path: V3[] = [top.p, [top.p[0], top.p[1] + pt * 0.35 * kk, top.p[2] - pt * 0.25 * kk], [top.p[0] + 0.01 * kk, top.p[1] + pt * 0.75 * kk, top.p[2] - pt * 0.55 * kk], [top.p[0] + 0.03 * kk, top.p[1] + pt * kk, top.p[2] - pt * 0.85 * kk]];
    F.mark('orn', 'head', () => F.k.tube('head', path, [0.07 * kk, 0.045 * kk, 0.022 * kk, 0.006 * kk], C.a, { seg: F.fine ? 6 : 4, noOcc: true }));
  }
  if (p.drape) F.shell({ region: 'torso', rows: F.rowsFor('torso', ST.SH - 0.2, ST.NECK), off: 0.016, col: (u) => (u < ST.SH - 0.08 ? C.c : C.a), hide: false, lip: 'first', cls: 'loose' });
}
/** cap (and wrap, hat crown): a close shell to the brow, over the hair. p: front, side, back, off, band (trim band). */
function cap(x: Ctx) {
  const { F, p, C } = x;
  const th = edge(num(p.front, 0.95), num(p.side, 1.35), num(p.back, 1.75));
  F.headShell({ thMax: th, off: num(p.off, 0.008), col: (d) => (Math.acos(d[1]) > th(Math.atan2(d[0], d[2])) - num(p.band, 0.2) ? C.c : C.a), holes: holesUnder(F, th), flat: !!p.flat });
  if (p.tails) {
    // a wrap's tails flying behind
    const kk = F.kk;
    for (const sx of [-1, 1]) {
      const a = F.headAt([sx * 0.15, -0.05, -0.99], 0.012 * kk + F.env([sx * 0.15, -0.05, -0.99])).p;
      F.mark('orn', 'head', () => F.k.tube('head', [a, [a[0] + sx * 0.03 * kk, a[1] - 0.06 * kk, a[2] - 0.08 * kk], [a[0] + sx * 0.06 * kk, a[1] - 0.16 * kk, a[2] - 0.14 * kk]], [0.03 * kk, 0.026 * kk, 0.006 * kk], C.c, { seg: 4, flatten: 0.35, noOcc: true }));
    }
  }
  if (num(p.brim, 0) > 0) F.brim(th(Math.PI / 2) - 0.05, num(p.off, 0.008), num(p.brim, 0.08), C.a, { droop: num(p.droop, 0.01), tilt: num(p.tilt, 0), up: num(p.up, 0) });
}
/** helm: heavy. p: front (the brow's edge), side (cheek guards), back (the nape guard), off, crown (extra height), visor (bars), nasal. */
function helm(x: Ctx) {
  const { F, p, C } = x;
  const th = edge(num(p.front, 1.05), num(p.side, 2.0), num(p.back, 2.35));
  const off = num(p.off, 0.016), crown = num(p.crown, 0);
  F.headShell({ thMax: th, off: (d) => off + crown * Math.max(0, d[1]) ** 2, overHair: false, flat: true, holes: holesUnder(F, th),
    col: (d) => { const t = Math.acos(d[1]), e = th(Math.atan2(d[0], d[2])); return t > e - 0.14 ? C.c : p.bands && Math.abs(t - 0.95) < 0.07 ? C.c : p.ribs && Math.abs(Math.sin(Math.atan2(d[0], d[2]) * 4)) < 0.12 ? sh(C.a, 0.82) : C.a; } });
  const kk = F.kk;
  if (p.nasal && !F.look.fur) {
    const fr = F.headFrame([0, 0.42, 0.91], off * kk + 0.004 * kk);
    F.mark('orn', 'head', () => prism(F.k, 'head', fr, [[-0.012, 0.03], [0.012, 0.03], [0.009, -0.07], [-0.009, -0.07]], 0.008, C.c));
  }
  if (p.visor) {
    // a T visor's brow bar standing off the face's opening
    for (const y of [0.45, 0.3]) {
      const pts: V3[] = [];
      for (let i = 0; i <= 6; i++) { const ph = -0.7 + (i / 6) * 1.4; const d: V3 = [Math.sin(ph) * Math.sqrt(1 - y * y), y, Math.cos(ph) * Math.sqrt(1 - y * y)]; pts.push(F.headAt(d, (off + 0.006 + crown * y * y) * kk).p); }
      F.mark('orn', 'head', () => F.k.tube('head', pts, 0.009 * kk, y > 0.4 ? C.c : C.a, { seg: 4, noOcc: true }));
      if (!F.fine) break;
    }
  }
}
/** band: a ring round the brow (a circlet, the starter's band). p: th (polar angle), r (thickness), gem. */
function band(x: Ctx) {
  const { F, p, C } = x;
  const th = num(p.th, 0.95);
  F.headRing(th, num(p.off, 0.004), num(p.r, 0.009), C.a, { tilt: num(p.tilt, 0.12) });
  if (p.gem) {
    const d: V3 = [0, Math.cos(th - 0.12), Math.sin(th - 0.12)];
    const fr = F.headFrame(d, num(p.off, 0.004) * F.kk + F.env(d) + 0.016 * F.kk);
    F.mark('orn', 'head', () => revolve(F.k, 'head', fr, [0, 0, 0], 'z', [[0, 0.016], [0.008, 0.016]], F.fine ? 8 : 5, p.gem === 'glow' && x.glow ? x.glow : C.c, p.gem === 'glow' && !!x.glow));
  }
}
/** halo: a ring floating over the head (no contact), p: h (height over the crown), r. */
function halo(x: Ctx) {
  const { F, p, C } = x;
  const kk = F.kk, top = F.headAt([0, 1, 0], F.env([0, 1, 0])).p;
  const y = top[1] + num(p.h, 0.09) * kk, R = F.hs.W * num(p.r, 0.95), n = F.fine ? 18 : 10;
  const ring = (r: number): V3[] => Array.from({ length: n + 1 }, (_, i) => { const a = (i / n) * TAU; return [Math.sin(a) * r, y, F.hs.cz + Math.cos(a) * r]; });
  F.mark('orn', 'head', () => F.k.tube('head', ring(R), 0.012 * kk, C.a, { seg: 4, noOcc: true, caps: false }));
  if (x.glow) F.mark('orn', 'head', () => F.k.tube('head', ring(R * 0.86), 0.01 * kk, x.glow!, { seg: 4, noOcc: true, caps: false, glow: true }));
}

// ───────── back ─────────
/** cape: p: len (m at 1.75 m), width, hem (straight, jag, leaf, tatter, round, swallow, patch), collar (fold, mantle, high, hood, none), clasp, flare, job. */
function capeTpl(x: Ctx) {
  const { F, p, C } = x;
  const hemS = str(p.hem, 'straight'), job = !!p.job;
  const hem = hemS === 'jag' ? (v: number) => -0.12 * Math.abs(Math.sin((v + 1) * Math.PI * 2.5))
    : hemS === 'tatter' ? (v: number) => -0.18 * Math.abs(Math.sin((v + 1) * 7.3)) * Math.abs(Math.cos((v + 1) * 3.1))
      : hemS === 'round' ? (v: number) => -0.15 * v * v : hemS === 'swallow' ? (v: number) => -0.2 * (1 - Math.abs(v)) + 0.05 : hemS === 'leaf' ? (v: number) => -0.08 * Math.abs(Math.sin((v + 1) * Math.PI * 3)) : undefined;
  const main = job ? JOB_CLOTH : C.a, trim = job ? GOLD_TRIM : C.c;
  const patch = [C.a, C.b, C.c, M.leatherLight, P.teal, mix(P.cloud, P.stone, 0.5)];
  const top = num(p.top, ST.SH - 0.25);
  F.cape({ top, len: num(p.len, 0.7), width: num(p.width, 0.8), flare: num(p.flare, 0.22), hem, tag: job ? 1 : 0, tagSkip: job ? trim : undefined,
    col: (v, t) => (t > 0.9 ? trim : hemS === 'patch' ? patch[(Math.floor((v + 1) * 1.99) + Math.floor(t * 3.99) * 2) % 6]! : p.edge && Math.abs(v) > 0.86 ? trim : p.stripe && Math.abs(v) < 0.15 ? C.b : main) });
  const collar = str(p.collar, 'fold');
  if (collar === 'fold' || collar === 'mantle' || collar === 'high') {
    const lo = collar === 'mantle' ? ST.CHEST + 0.3 : ST.SH - 0.35;
    if (job) F.k.g.tagNow = 1;
    if (job) F.k.g.tagSkip = trim;
    F.shell({ region: 'torso', rows: F.rowsFor('torso', lo, ST.NECK), arc: collar === 'mantle' ? undefined : [Math.PI * 0.42, Math.PI * 1.58], off: 0.012, col: (u) => (u < lo + 0.12 ? trim : collar === 'mantle' ? C.b : main), hide: false, lip: 'first', cls: 'loose' });
    F.k.g.tagNow = 0; F.k.g.tagSkip = null;
    if (collar === 'high') F.shell({ region: 'neck', rows: [ST.NECK - 0.1, ST.NECK + 0.6], arc: [Math.PI * 0.5, Math.PI * 1.5], off: 0.02, col: (u) => (u > ST.NECK + 0.45 ? trim : C.b), hide: false, cls: 'loose' });
  }
  if (p.clasp) for (const sx of [-1, 1]) {
    const fr = F.frame('torso', 1, ST.SH - 0.2, sx * 0.55, 0.008);
    F.mark('orn', 'torso', () => revolve(F.k, 'body', fr, [0, 0, 0], 'z', [[0, 0.02], [0.008, 0.02]], F.fine ? 8 : 5, p.clasp === 'glow' && x.glow ? x.glow : pick(C, p.clasp, M.brass), p.clasp === 'glow' && !!x.glow));
  }
}
/** pack: a satchel at the hip on a strap across the chest, a case on the back. */
function pack(x: Ctx) {
  const { F, C } = x;
  F.strap('torso', 1, [[ST.SH + 0.6, -0.8], [ST.CHEST, -0.15], [ST.WAIST, 0.6], [ST.HIP, 1.45]], 0.012, C.b);
  F.strap('torso', 1, [[ST.SH + 0.6, -0.8], [ST.CHEST, -2.4], [ST.WAIST, -3.4], [ST.HIP, -4.8]], 0.012, C.b);
  const bag = F.frame('torso', 1, ST.HIP - 0.1, 1.55, 0.03);
  F.mark('orn', 'torso', () => prism(F.k, 'body', bag, [[-0.08, -0.06], [0.08, -0.06], [0.08, 0.07], [-0.08, 0.07]], 0.05, C.a, { rim: sh(C.a, 0.85) }));
  F.mark('orn', 'torso', () => poly(F.k, 'body', [bag(-0.08, 0.07, 0.027), bag(0.08, 0.07, 0.027), bag(0.075, 0.0, 0.028), bag(-0.075, 0.0, 0.028)], C.c));
  const cs = F.frame('torso', 1, ST.CHEST - 0.2, Math.PI - 0.35, 0.045);
  F.mark('orn', 'torso', () => revolve(F.k, 'body', cs, [0, 0, 0], 'y', [[-0.17, 0.038], [0.17, 0.038]], F.fine ? 7 : 5, M.leather));
  for (const dx of [-0.015, 0.015]) F.mark('orn', 'torso', () => revolve(F.k, 'body', cs, [dx, 0, 0], 'y', [[0.17, 0.014], [0.23, 0.014]], 5, C.c));
}
/** wings: two panels on spars at the back (kites), or a moth's. p: kind (kite, moth). */
function wings(x: Ctx) {
  const { F, p, C } = x;
  const kk = F.kk;
  for (const sx of [-1, 1]) {
    const fr = F.frame('torso', 1, ST.CHEST, Math.PI - sx * 0.35, 0.02);
    if (p.kind === 'moth') {
      F.mark('free', 'cape', () => poly(F.k, 'cape', [fr(0, 0.12, 0), fr(sx * -0.3, 0.2, -0.05), fr(sx * -0.34, -0.05, -0.06), fr(sx * -0.2, -0.24, -0.05), fr(sx * -0.02, -0.15, 0)], C.a));
      F.mark('orn', 'cape', () => poly(F.k, 'cape', [fr(sx * -0.17, 0.06, -0.035), fr(sx * -0.22, 0.02, -0.04), fr(sx * -0.17, -0.03, -0.035), fr(sx * -0.12, 0.02, -0.03)], C.c));
    } else {
      F.mark('free', 'cape', () => poly(F.k, 'cape', [fr(0, 0.2, 0), fr(sx * -0.2, 0.05, -0.07), fr(sx * -0.04, -0.5, -0.05), fr(0, -0.15, 0)], C.a));
      F.mark('orn', 'cape', () => poly(F.k, 'cape', [fr(sx * -0.03, 0.1, -0.012), fr(sx * -0.13, 0.03, -0.055), fr(sx * -0.04, -0.28, -0.035)], C.c));
      F.mark('orn', 'cape', () => F.k.tube('cape', [fr(0, 0.2, -0.004), fr(sx * -0.04, -0.5, -0.05)], 0.007 * kk, M.wood, { seg: 3, noOcc: true }));
    }
  }
  if (p.kind !== 'moth') {
    const t = F.frame('torso', 1, ST.WAIST, Math.PI, 0.05);
    F.mark('free', 'cape', () => F.k.tube('cape', [t(0, 0, 0), t(0.04, -0.2, -0.04), t(-0.03, -0.38, -0.05), t(0.03, -0.55, -0.05)], [0.02 * kk, 0.018 * kk, 0.014 * kk, 0.004 * kk], C.b, { seg: 3, flatten: 0.3, noOcc: true }));
  }
}

export const TEMPLATES: Readonly<Record<DefSlot, Readonly<Record<string, (x: Ctx) => void>>>> = {
  chest: { garment, cuirass },
  legs: { trousers },
  hands: { gloves },
  feet: { boots },
  head: { hood, cap, helm, band, halo },
  back: { cape: capeTpl, pack, wings },
};
/** What a head template covers: the hair ('cap': tucked, its volume gone; 'none': a closed helm) and the round ears. */
export const HEAD_COVER: Readonly<Record<string, { hair: 'full' | 'cap' | 'none'; ears: boolean }>> = {
  hood: { hair: 'cap', ears: true }, cap: { hair: 'cap', ears: false }, helm: { hair: 'none', ears: true }, band: { hair: 'full', ears: false }, halo: { hair: 'full', ears: false },
};

// ───────── modules: trims and ornaments ─────────
type Mod = (x: Ctx, m: Params) => void;
export const MODULES: Readonly<Record<string, Mod>> = {
  /** A belt at u (default the waist) in a colour, its buckle. */
  belt: (x, m) => belt(x, num(m.u, ST.WAIST - 0.15), pick(x.C, m.col, M.leather), m.buckle === 'none' ? null : pick(x.C, m.buckle, M.brass), num(m.h, 0.16), num(m.thick, 0.007)),
  /** A sash: a broad band of cloth, its knot's tails at one hip. */
  sash: (x, m) => {
    const { F } = x, c = pick(x.C, m.col, x.C.b);
    F.band('torso', num(m.u, ST.WAIST - 0.1), 0.3, 0.006, (_u, a) => folds(c, a, 0.06, 4));
    for (const k of [0, 1]) { const fr = F.frame('torso', 1, num(m.u, ST.WAIST - 0.1) - 0.1, 0.9 + k * 0.25, 0.012); F.mark('orn', 'torso', () => poly(F.k, 'body', [fr(-0.02, 0, 0), fr(0.02, 0, 0), fr(0.025 + k * 0.01, -0.2 - k * 0.04, 0.01), fr(-0.015, -0.18 - k * 0.04, 0.01)], c)); }
  },
  /** The job's tabard (cloth: a stole; light: a sash-width strip; heavy: a surcoat strip). */
  tabard: (x, m) => jobTabard(x, num(m.w, 1), num(m.to, ST.THIGH)),
  /** A strap across the chest (from the right shoulder to the left hip, or `mirror`). */
  strap: (x, m) => {
    const s = m.mirror ? -1 : 1, c = pick(x.C, m.col, M.leather);
    x.F.strap('torso', 1, [[ST.SH + 0.5, s * 0.75], [ST.CHEST, s * 0.15], [ST.RIBS, -s * 0.45], [ST.WAIST - 0.1, -s * 1.1]], num(m.r, 0.011), c);
    if (m.back) x.F.strap('torso', 1, [[ST.SH + 0.5, s * 0.75], [ST.CHEST, Math.PI - s * 0.2], [ST.RIBS, Math.PI + s * 0.45], [ST.WAIST - 0.1, Math.PI + s * 1.6]], num(m.r, 0.011), c);
  },
  /** Braces (two straps over the shoulders). */
  braces: (x, m) => { for (const s of [-1, 1]) x.F.strap('torso', 1, [[ST.WAIST - 0.1, s * 0.4], [ST.CHEST, s * 0.42], [ST.SHTOP, s * 0.5], [ST.CHEST, Math.PI - s * 0.4], [ST.WAIST - 0.1, Math.PI - s * 0.3]], 0.009, pick(x.C, m.col, M.leather)); },
  /** Leaves along a skirt's or sleeve's hem (Mossweave). */
  leafHem: (x, m) => {
    const { F } = x, n = F.fine ? num(m.n, 12) : 7, c = pick(x.C, m.col, x.C.c), u = num(m.u, ST.HIP - 0.3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, fr = F.frame('torso', 1, u, a, 0.006);
      F.mark('orn', 'torso', () => poly(F.k, 'body', [fr(0, 0.02, 0), fr(0.025, -0.03, 0.006), fr(0, -0.08, 0.01), fr(-0.025, -0.03, 0.006)], i % 2 ? c : sh(c, 0.85)));
    }
  },
  /** Ember stitches along a band (Wickthread): small lit diamonds. */
  embers: (x, m) => {
    const { F } = x;
    if (!F.fine) return;
    const n = num(m.n, 10), region = str(m.region, 'torso') as 'torso' | 'arm' | 'leg', u = num(m.u, ST.HIP);
    const sides = region === 'torso' ? [1] : [-1, 1];
    for (const side of sides) for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, fr = F.frame(region, side, u, a, 0.004);
      F.mark('orn', region, () => poly(F.k, F.group(region, side), [fr(0, 0.016, 0), fr(0.01, 0, 0), fr(0, -0.016, 0), fr(-0.01, 0, 0)], x.glow ?? M.ember, !!x.glow));
    }
  },
  /** Lens disks (Lenslight): at the shoulders, on the chest, at the brow. */
  lens: (x, m) => {
    const { F } = x, at = str(m.at, 'shoulder'), lit = x.glow ?? M.glowLens;
    const disk = (fr: ReturnType<Fit['frame']>, g: 'body' | 'armL' | 'armR' | 'head', r: number) => {
      F.mark('orn', 'torso', () => revolve(F.k, g, fr, [0, 0, 0], 'z', [[0, r], [0.012, r]], F.fine ? 10 : 6, x.C.c));
      F.mark('orn', 'torso', () => revolve(F.k, g, fr, [0, 0, 0.013], 'z', [[0, r * 0.68], [0.004, r * 0.68]], F.fine ? 9 : 6, lit, !!x.glow));
    };
    if (at === 'shoulder') for (const side of [-1, 1]) disk(F.frame('arm', side, 0.55, Math.PI / 2 - 0.5, 0.02), side < 0 ? 'armL' : 'armR', 0.07);
    if (at === 'chest') disk(F.frame('torso', 1, ST.CHEST + 0.2, 0, 0.01), 'body', 0.045);
    if (at === 'brow') { const d: V3 = [0, 0.55, 0.83]; disk(F.headFrame(d, F.env(d) + 0.014 * F.kk), 'head', 0.032); }
    if (at === 'hand') for (const side of [-1, 1]) disk(F.frame('arm', side, 4.75, Math.PI / 2, 0.008), side < 0 ? 'armL' : 'armR', 0.022);
  },
  /** Thorns on the shoulders, knees, cap or heels (Thornrunner). */
  thorns: (x, m) => {
    const { F } = x, at = str(m.at, 'shoulder'), c = pick(x.C, m.col, x.C.c), kk = F.kk, n = num(m.n, 3);
    if (at === 'shoulder') for (const side of [-1, 1]) for (let i = 0; i < n; i++) {
      const fr = F.frame('arm', side, 0.4 + i * 0.3, Math.PI / 2 - 0.3 + (i - 1) * 0.5, 0.004);
      F.mark('orn', 'arm', () => cone(F.k, side < 0 ? 'armL' : 'armR', fr(0, 0, 0), fr(0.01, 0.04, 0.07 + 0.02 * (i % 2)), 0.014 * kk, c, 3));
    }
    if (at === 'knee') for (const side of [-1, 1]) { const fr = F.frame('leg', side, ST.KNEE + 0.1, 0, 0.004); F.mark('orn', 'leg', () => cone(F.k, side < 0 ? 'legL' : 'legR', fr(0, 0, 0), fr(0, 0.03, 0.06), 0.013 * kk, c, 3)); }
    if (at === 'heel') for (const side of [-1, 1]) { const fr = F.frame('leg', side, 1.4, Math.PI, 0.006); F.mark('orn', 'leg', () => cone(F.k, side < 0 ? 'legL' : 'legR', fr(0, 0, 0), fr(0, -0.02, 0.06), 0.012 * kk, c, 3)); }
    if (at === 'hand') for (const side of [-1, 1]) { const fr = F.frame('arm', side, 4.6, Math.PI / 2, 0.005); F.mark('orn', 'arm', () => cone(F.k, side < 0 ? 'armL' : 'armR', fr(0, 0, 0), fr(0, 0.03, 0.05), 0.011 * kk, c, 3)); }
    if (at === 'cap') { const d: V3 = [0, 0.95, -0.3]; const fr = F.headFrame(d, F.env(d) + 0.01 * kk); F.mark('orn', 'head', () => cone(F.k, 'head', fr(0, 0, 0), fr(0, -0.05, 0.12), 0.03 * kk, c, 3)); for (const sx of [-1, 1]) { const e: V3 = [sx * 0.7, 0.55, -0.35]; const f2 = F.headFrame(e, F.env(e) + 0.01 * kk); F.mark('orn', 'head', () => cone(F.k, 'head', f2(0, 0, 0), f2(sx * 0.02, -0.03, 0.08), 0.018 * kk, c, 3)); } }
  },
  /** A scorched fringe hanging from a hem (Cinderstep). */
  fringe: (x, m) => {
    const { F } = x, n = F.fine ? num(m.n, 14) : 8, u = num(m.u, 5.3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, fr = F.frame('torso', 1, u, a, 0.004), len = 0.07 + 0.04 * ((i * 7) % 3) / 2;
      F.mark('orn', 'torso', () => poly(F.k, 'body', [fr(-0.022, 0.01, 0), fr(0.022, 0.01, 0), fr(0.014, -len, 0.01), fr(-0.014, -len, 0.01)], [x.C.a, x.C.a, M.soot, M.soot]));
    }
  },
  /** Buckles (ember or brass) down the front or across a strap. */
  buckles: (x, m) => {
    const { F } = x, n = num(m.n, 2), c = m.col === 'ember' ? (x.glow ?? M.ember) : pick(x.C, m.col, M.brass), lit = m.col === 'ember' && !!x.glow;
    if (m.region === 'leg') {
      for (const side of [-1, 1]) {
        const fr = F.frame('leg', side, num(m.u, 1.6), Math.PI / 2 - 0.3, 0.008);
        F.mark('orn', 'leg', () => prism(F.k, side < 0 ? 'legL' : 'legR', fr, [[-0.018, -0.013], [0.018, -0.013], [0.018, 0.013], [-0.018, 0.013]], 0.008, c, { glow: lit }));
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      const fr = F.frame('torso', 1, ST.CHEST - 0.2 - i * 0.65, num(m.a, -0.25), 0.008);
      F.mark('orn', 'torso', () => prism(F.k, 'body', fr, [[-0.02, -0.014], [0.02, -0.014], [0.02, 0.014], [-0.02, 0.014]], 0.008, c, { glow: lit }));
    }
  },
  /** Bells (Tollwind): at the belt, on a hat's side, at the boots. */
  bells: (x, m) => {
    const { F } = x;
    if (!F.fine) return;
    const at = str(m.at, 'belt');
    const bell = (fr: ReturnType<Fit['frame']>, g: 'body' | 'legL' | 'legR' | 'head') => F.mark('orn', 'torso', () => revolve(F.k, g, fr, [0, -0.03, 0.02], 'y', [[0.03, 0], [0.022, 0.016], [0, 0.022], [-0.008, 0.024]], 5, M.brass));
    if (at === 'belt') for (const a of [-0.7, 0.8]) bell(F.frame('torso', 1, ST.WAIST - 0.2, a, 0.01), 'body');
    if (at === 'boots') for (const side of [-1, 1]) bell(F.frame('leg', side, num(m.u, 2.3), Math.PI / 2, 0.012), side < 0 ? 'legL' : 'legR');
    if (at === 'hat') { const d: V3 = [-0.95, 0.15, 0.1]; bell(F.headFrame(d, F.env(d) + 0.03 * F.kk), 'head'); }
  },
  /** Coat tails swept behind (Tollwind): two long panels from the waist. */
  tails: (x, m) => {
    const { F } = x, kk = F.kk, len = num(m.len, 0.55);
    for (const s of [-1, 1]) {
      const grid: V3[][] = [];
      for (let i = 0; i <= 4; i++) {
        const t = i / 4, y = F.f.waistY - t * len * kk, sw = 0.08 * kk * t * t;
        const z0 = F.S.torsoAt(F.S.torsoS(Math.max(F.f.crotchY, y)), Math.PI)[2] - F.under('torso', ST.HIP) - 0.012 * kk - t * 0.06 * kk;
        grid.push([[s * 0.02 * kk + sw, y, z0], [s * (0.13 + t * 0.03) * kk + sw, y, z0 + 0.03 * kk]]);
      }
      F.mark('free', 'cape', () => F.k.sheet('cape', grid, 0.014 * kk, x.C.a, { paint: (_w, uv) => (uv[1] > 0.85 ? x.C.c : undefined) }));
    }
  },
  /** A capelet over the shoulders, edged in trim, clasped at the throat (a lit gem if the piece glows). */
  capelet: (x, m) => {
    const { F } = x;
    F.shell({ region: 'torso', rows: F.rowsFor('torso', num(m.lo, ST.CHEST + 0.2), ST.NECK), off: 0.018, col: (u) => (u < num(m.lo, ST.CHEST + 0.2) + 0.13 ? x.C.c : x.C.b), hide: false, lip: 'first', cls: 'loose' });
    const fr = F.frame('torso', 1, ST.SHTOP + 0.4, 0, 0.012);
    F.mark('orn', 'torso', () => poly(F.k, 'body', [fr(0, 0.025, 0), fr(0.02, 0, 0), fr(0, -0.025, 0), fr(-0.02, 0, 0)], x.glow ?? x.C.c, !!x.glow));
  },
  /** Rivets in a row round a region at u (Brassbound). */
  rivets: (x, m) => {
    const { F } = x;
    if (!F.fine) return;
    const region = str(m.region, 'torso') as 'torso' | 'leg' | 'arm', u = num(m.u, ST.CHEST), n = num(m.n, 6), arc = num(m.arc, 1.1);
    const sides = region === 'torso' ? [1] : [-1, 1];
    for (const side of sides) for (let i = 0; i < n; i++) {
      const a = -arc + (2 * arc * i) / Math.max(1, n - 1), fr = F.frame(region, side, u, a, num(m.off, 0.026));
      F.mark('orn', region, () => knob(F.k, F.group(region, side), fr, [0, 0, 0], 0.009, M.iron, false, 4));
    }
  },
  /** Cog plates standing on the shoulders (Brassbound). */
  cogs: (x) => {
    const { F } = x;
    for (const side of [-1, 1]) {
      const fr = F.frame('arm', side, 0.1, Math.PI / 2 - 0.6, 0.075);
      F.mark('orn', 'arm', () => prism(F.k, side < 0 ? 'armL' : 'armR', (X, Y, Z) => fr(X, Y + 0.02, Z), ring2d(F.fine ? 14 : 10, 0.07, 0.054), 0.022, x.C.c, { rim: sh(x.C.c, 0.8) }));
    }
  },
  /** Fins rising from the pauldrons (Beaconstone T3: the shoulder line stands above the ears). */
  fins: (x) => {
    const { F } = x;
    for (const side of [-1, 1]) {
      const fr = F.frame('arm', side, 0.0, Math.PI / 2 - 0.25, 0.09);
      F.mark('orn', 'arm', () => prism(F.k, side < 0 ? 'armL' : 'armR', (X, Y, Z) => fr(Z, Y + 0.02, X), [[-0.11, 0], [0.11, 0], [0.06, 0.07], [-0.02, 0.1], [-0.08, 0.05]], 0.02, x.C.c));
    }
  },
  /** Roots winding over plates and across the chest (Rootbound). */
  roots: (x) => {
    const { F } = x, c = x.C.c;
    x.F.strap('torso', 1, [[ST.SH + 0.4, 0.85], [ST.CHEST, 0.2], [ST.RIBS, -0.4], [ST.WAIST, -1.0]], 0.014, c, 0.03);
    x.F.strap('torso', 1, [[ST.SH + 0.4, -0.85], [ST.CHEST + 0.2, -0.3], [ST.RIBS + 0.3, 0.2]], 0.011, c, 0.03);
    if (F.fine) x.F.strap('torso', 1, [[ST.SH + 0.4, Math.PI - 0.8], [ST.CHEST, Math.PI], [ST.RIBS, Math.PI + 0.8]], 0.011, c, 0.03);
  },
  /** A crest on the chest (a lit gem in a diamond plate, or a shape: sun, star, leaf). */
  crest: (x, m) => {
    const { F } = x, kind = str(m.kind, 'diamond'), lit = !!x.glow && m.lit !== false;
    const fr = F.frame('torso', 1, num(m.u, ST.CHEST), 0, num(m.off, 0.032));
    const r = num(m.r, 0.06);
    const shape: [number, number][] = kind === 'sun' ? ring2d(16, r, r * 0.62) : kind === 'star' ? ring2d(10, r, r * 0.45) : kind === 'leaf' ? [[0, r], [r * 0.45, 0], [0, -r * 1.1], [-r * 0.45, 0]] : [[0, r], [r * 0.7, 0], [0, -r * 1.2], [-r * 0.7, 0]];
    F.mark('orn', 'torso', () => prism(F.k, 'body', fr, shape, 0.01, x.C.c, { rim: sh(x.C.c, 0.8) }));
    if (lit) F.mark('orn', 'torso', () => prism(F.k, 'body', (X, Y, Z) => fr(X * 0.55, Y * 0.55, Z + 0.008), shape, 0.004, x.glow!, { glow: true }));
  },
  /** Stars that shine scattered on a robe (Starfall). */
  stars: (x, m) => {
    const { F } = x;
    const spots: [number, number][] = [[ST.CHEST, -0.4], [ST.RIBS, 0.5], [ST.WAIST, -0.9], [ST.SH, 2.4], [ST.RIBS, 3.6], [ST.WAIST + 0.2, 1.8]];
    for (const [u, a] of spots.slice(0, F.fine ? num(m.n, 6) : 3)) {
      const fr = F.frame('torso', 1, u, a, 0.006);
      F.mark('orn', 'torso', () => poly(F.k, 'body', ring2d(8, 0.028, 0.01).map(([X, Y]) => fr(X, Y, 0)), x.glow ?? M.glowStar, true));
    }
  },
  /** Buttons down the front (a coat), or toggles. */
  buttons: (x, m) => {
    const { F } = x;
    if (!F.fine) return;
    const n = num(m.n, 4), toggles = !!m.toggles;
    for (let i = 0; i < n; i++) {
      const u = ST.SH - 0.2 - i * ((ST.SH - ST.HIP) / n), fr = F.frame('torso', 1, u, num(m.a, 0.18), 0.012);
      F.mark('orn', 'torso', () => (toggles ? prism(F.k, 'body', fr, [[-0.03, -0.007], [0.03, -0.007], [0.03, 0.007], [-0.03, 0.007]], 0.012, x.C.c) : knob(F.k, 'body', fr, [0, 0, 0], 0.011, x.C.c, false, 4)));
    }
  },
  /** Rays round the collar (Solstice), or a star-pointed collar (Starfall). */
  rays: (x, m) => {
    const { F } = x, n = F.fine ? num(m.n, 12) : 8, out = num(m.out, 0.1);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, fr = F.frame('torso', 1, ST.SHTOP + 0.6, a, 0.01);
      F.mark('orn', 'torso', () => poly(F.k, 'body', [fr(-0.03, 0, 0), fr(0.03, 0, 0), fr(0, -out * (i % 2 ? 0.7 : 1), 0.02)], i % 2 ? x.C.c : x.C.a));
    }
  },
  /** A soft ruff at the throat (the Moth-Silk gown). */
  ruff: (x) => x.F.shell({ region: 'neck', rows: [ST.NECK - 0.1, ST.NECK + 0.3], off: (_u, a) => 0.016 + 0.008 * Math.cos(a * 8) ** 2, col: x.C.c, hide: true, cls: 'loose' }),
  /** An apron over the front (the Orchard smock), with two berries at its pocket. */
  apron: (x) => {
    const { F } = x;
    F.panel({ top: ST.RIBS, bottom: ST.KNEE + 0.4, half: (t) => 0.13 + 0.03 * t, col: (_v, t) => (t > 0.9 ? sh(x.C.c, 0.8) : x.C.c), rows: F.fine ? 6 : 4 });
    if (F.fine) for (const dx of [-0.025, 0.025]) { const fr = F.frame('torso', 1, ST.HIP, dx * 4, 0.04); F.mark('orn', 'torso', () => knob(F.k, 'body', fr, [0, 0, 0], 0.02, M.berry, false, 5)); }
  },
  /** A little brass lamp hanging at the hip (the Lamplighter). */
  lamp: (x) => {
    const { F } = x, fr = F.frame('torso', 1, ST.HIP - 0.2, -1.4, 0.05);
    F.mark('orn', 'torso', () => revolve(F.k, 'body', fr, [0, -0.06, 0], 'y', [[0, 0.03], [0.02, 0.035], [0.08, 0.035], [0.1, 0.02], [0.12, 0]], F.fine ? 6 : 5, (r) => (r === 1 || r === 2 ? (x.glow ?? M.glass) : x.C.c), false));
  },
  /** A neckerchief knotted at the throat (the Ploughman). */
  kerchief: (x) => {
    const { F } = x;
    F.shell({ region: 'neck', rows: [ST.NECK - 0.05, ST.NECK + 0.2], off: 0.01, col: P.roof, hide: true });
    const fr = F.frame('torso', 1, ST.SHTOP + 0.6, 0, 0.012);
    F.mark('orn', 'torso', () => poly(F.k, 'body', [fr(-0.05, 0.02, 0), fr(0.05, 0.02, 0), fr(0, -0.07, 0.01)], P.roof));
  },
  /** Patches on the knees (worn trousers). */
  patches: (x) => { for (const side of [-1, 1]) { const fr = x.F.frame('leg', side, ST.KNEE + 0.1, 0.1, 0.004); x.F.mark('orn', 'leg', () => poly(x.F.k, side < 0 ? 'legL' : 'legR', [fr(-0.035, 0.04, 0), fr(0.035, 0.04, 0), fr(0.035, -0.04, 0), fr(-0.035, -0.04, 0)], sh(x.C.a, 0.8))); } },
  /** A crest, plume, horns, a lamp or a feather on a head piece. */
  helmTop: (x, m) => {
    const { F } = x, kk = F.kk, kind = str(m.kind, 'crest'), c = pick(x.C, m.col, x.C.c);
    const top = (d: V3, out = 0.016) => F.headFrame(d, out * kk + num(m.lift, 0) * kk);
    if (kind === 'crest' || kind === 'cog') {
      const fr = top([0, 0.98, -0.2], num(m.base, 0.03));
      if (kind === 'cog') F.mark('orn', 'head', () => prism(F.k, 'head', (X, Y, Z) => fr(Z, Y + 0.05, X), ring2d(F.fine ? 16 : 10, 0.085, 0.065), 0.03, c, { rim: sh(c, 0.8) }));
      else F.mark('orn', 'head', () => prism(F.k, 'head', (X, Y, Z) => fr(Z, Y, X), [[-0.14, 0], [0.12, 0], [0.08, 0.08], [-0.1, 0.06]], 0.024, c));
    }
    if (kind === 'horns') for (const sx of [-1, 1]) {
      const a = F.headAt([sx * 0.7, 0.6, -0.2], 0.03 * kk).p;
      F.mark('orn', 'head', () => F.k.tube('head', [a, [a[0] + sx * 0.06 * kk, a[1] + 0.06 * kk, a[2] - 0.08 * kk], [a[0] + sx * 0.05 * kk, a[1] + 0.13 * kk, a[2] - 0.16 * kk], [a[0] + sx * 0.02 * kk, a[1] + 0.15 * kk, a[2] - 0.2 * kk]], [0.035 * kk, 0.028 * kk, 0.017 * kk, 0.004 * kk], c, { seg: 4, noOcc: true }));
    }
    if (kind === 'plume' || kind === 'feather') {
      const a = F.headAt(kind === 'feather' ? [0.75, 0.6, -0.1] : [0, 0.97, -0.25], 0.03 * kk + F.env([0, 0.97, -0.25])).p, sx = kind === 'feather' ? 1 : 0;
      F.mark('orn', 'head', () => F.k.tube('head', [a, [a[0] + sx * 0.06 * kk, a[1] + 0.1 * kk, a[2] - 0.08 * kk], [a[0] + sx * 0.05 * kk, a[1] + 0.18 * kk, a[2] - 0.22 * kk], [a[0] + sx * 0.02 * kk, a[1] + 0.2 * kk, a[2] - 0.34 * kk]], [0.025 * kk, 0.035 * kk, 0.028 * kk, 0.004 * kk], c, { seg: 3, flatten: 0.35, noOcc: true }));
    }
    if (kind === 'beacon') {
      const fr = top([0, 1, 0.05], 0.03);
      F.mark('orn', 'head', () => prism(F.k, 'head', (X, Y, Z) => fr(Z, Y, X - 0.03), [[-0.17, 0], [0.15, 0], [0.1, 0.1], [-0.1, 0.08]], 0.026, c));
      F.mark('orn', 'head', () => revolve(F.k, 'head', fr, [0, 0, 0.1], 'z', [[0, 0.045], [0.05, 0.06], [0.06, 0.045]], F.fine ? 8 : 5, c));
      F.mark('orn', 'head', () => revolve(F.k, 'head', fr, [0, 0, 0.17], 'z', [[-0.01, 0.0], [0.0, 0.04], [0.06, 0.025], [0.11, 0]], F.fine ? 7 : 5, x.glow ?? M.glowBeacon, !!x.glow));
    }
    if (kind === 'ember') {
      const a = F.headAt([0.05, 0.75, -0.66], 0.03 * kk).p;
      F.mark('orn', 'head', () => knob(F.k, 'head', (X, Y, Z) => [X, Y, Z], [a[0], a[1] + 0.3 * kk, a[2] - 0.27 * kk], 0.02 * kk, x.glow ?? M.ember, !!x.glow, 4));
    }
    if (kind === 'feathers') {
      const n = F.fine ? 7 : 5;
      for (let i = 0; i < n; i++) {
        const ph = Math.PI * 0.55 + (i / (n - 1)) * Math.PI * 0.9, d: V3 = [Math.sin(ph) * 0.82, 0.57, Math.cos(ph) * 0.82];
        const fr = F.headFrame(d, F.env(d) + 0.012 * kk);
        const h = 0.2 - Math.abs(i - (n - 1) / 2) * 0.03;
        F.mark('orn', 'head', () => poly(F.k, 'head', [fr(0, 0, 0), fr(0.025, h * 0.45, 0.03), fr(0, h, 0.05), fr(-0.025, h * 0.45, 0.03)], [x.C.a, x.C.a, P.cloud, sh(x.C.a, 0.7)]));
      }
    }
  },
  /** Goggles on the brow: two lens cups on a strap (Brass Goggles). */
  goggles: (x) => {
    const { F } = x, kk = F.kk;
    for (const sx of [-1, 1]) {
      const d: V3 = [sx * 0.36, 0.48, 0.86], fr = F.headFrame(d, F.env(d) + 0.012 * kk);
      F.mark('orn', 'head', () => revolve(F.k, 'head', fr, [0, 0, 0], 'z', [[0, 0.05], [0.04, 0.05], [0.052, 0.044]], F.fine ? 9 : 6, x.C.a));
      F.mark('orn', 'head', () => revolve(F.k, 'head', fr, [0, 0, 0.042], 'z', [[0, 0.036], [0.002, 0.036]], F.fine ? 9 : 6, M.glass));
    }
  },
  /** Spikes standing out of a piece (spiked pauldrons, a mace-like crest). */
  spikes: (x, m) => {
    const { F } = x, kk = F.kk, c = pick(x.C, m.col, M.iron);
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
      const fr = F.frame('arm', side, 0.2 + i * 0.25, Math.PI / 2 - 0.4 + i * 0.4, 0.07);
      F.mark('orn', 'arm', () => cone(F.k, side < 0 ? 'armL' : 'armR', fr(0, 0, 0), fr(0, 0.02, 0.08), 0.015 * kk, c, 4));
    }
  },
  /** A fold-down at the top of a boot or glove. */
  cuffBand: (x, m) => x.F.band(str(m.region, 'leg') as 'leg', num(m.u, 2.2), num(m.h, 0.2), num(m.thick, 0.008), pick(x.C, m.col, x.C.c)),
  /** Plates on the back of the hands (gauntlets). */
  handPlates: (x) => {
    const { F } = x;
    for (const side of [-1, 1]) {
      const fr = F.frame('arm', side, 5.05, Math.PI / 2 + 0.1, 0.012);
      F.mark('orn', 'hand', () => prism(F.k, side < 0 ? 'armL' : 'armR', (X, Y, Z) => fr(X, Y - 0.04, Z), [[-0.03, 0.03], [0.03, 0.03], [0.026, -0.04], [-0.026, -0.04]], 0.01, x.C.c));
    }
  },
  /** Laces criss-crossing a boot's or bracer's front. */
  laces: (x, m) => {
    const { F } = x;
    if (!F.fine) return;
    const region = str(m.region, 'leg') as 'leg' | 'arm', u0 = num(m.from, 1.2), u1 = num(m.to, 2.3);
    for (const side of [-1, 1]) {
      const path: [number, number][] = [];
      for (let i = 0; i <= 4; i++) path.push([lerp(u0, u1, i / 4), (i % 2 ? 0.3 : -0.3) + (region === 'arm' ? Math.PI / 2 : 0)]);
      F.strap(region, side, path, 0.005, pick(x.C, m.col, x.C.c), 0.002);
    }
  },
};
void sm; void AST;

// ───────── own colours ─────────
const c = (a: Color3, b: Color3, cc: Color3) => [a, b, cc] as const;
const PAL = {
  plain: c(P.teal, mix(P.cloud, P.stone, 0.55), P.gold),
  mossweave: c(shade(mix(P.meadow, P.rock, 0.35), 0.78), shade(mix(P.meadow, P.cloud, 0.4), 0.85), mix(P.meadow, P.stone, 0.55)),
  wickthread: c(shade(mix(P.rock, P.roof, 0.3), 0.78), shade(mix(P.rock, P.cliff, 0.3), 0.55), mix(P.stone, P.cloud, 0.4)),
  lenslight: c(mix(P.cloud, P.sky, 0.28), mix(P.cloud, P.stone, 0.3), mix(P.rock, P.skyDeep, 0.3)),
  thornrunner: c(shade(mix(P.cliff, P.meadow, 0.45), 0.62), shade(mix(P.cliff, P.gold, 0.3), 0.5), mix(P.stone, P.cliff, 0.25)),
  cinderstep: c(shade(mix(P.rock, P.cliff, 0.3), 0.5), shade(mix(P.cliff, P.roof, 0.3), 0.45), mix(P.roof, P.gold, 0.3)),
  tollwind: c(mix(P.sky, P.cloud, 0.42), mix(P.cloud, P.stone, 0.4), P.gold),
  rootbound: c(shade(mix(P.cliff, P.gold, 0.3), 0.5), shade(mix(P.cliff, P.rock, 0.4), 0.4), shade(mix(P.meadow, P.gold, 0.35), 0.62)),
  brassbound: c(shade(mix(P.gold, P.cliff, 0.2), 0.9), shade(mix(P.rock, P.sky, 0.3), 0.6), shade(P.cliff, 0.62)),
  beaconstone: c(mix(P.stone, P.cloud, 0.3), shade(mix(P.rock, P.sky, 0.25), 0.62), shade(mix(P.gold, P.cliff, 0.15), 0.9)),
  lamplighter: c(shade(P.skyDeep, 0.5), shade(M.soot, 1.3), M.brass),
  solstice: c(mix(P.cloud, P.gold, 0.18), mix(P.cloud, P.stone, 0.2), P.gold),
  orchard: c(mix(P.cloud, P.stone, 0.6), M.leatherLight, shade(P.meadow, 0.7)),
  harbour: c(mix(P.gold, P.horizon, 0.2), shade(P.skyDeep, 0.55), shade(P.skyDeep, 0.4)),
  mothsilk: c(mix(P.cloud, P.rock, 0.25), mix(P.cloud, P.sky, 0.3), mix(P.cloud, P.sky, 0.5)),
  ploughman: c(mix(P.cloud, P.stone, 0.7), shade(mix(P.cliff, P.gold, 0.3), 0.55), P.roof),
  starfall: c(shade(P.skyDeep, 0.42), shade(P.skyDeep, 0.3), mix(P.cloud, P.sky, 0.25)),
  straw: c(mix(P.gold, P.stone, 0.5), P.roof, shade(mix(P.gold, P.stone, 0.5), 0.8)),
  goggles: c(M.brass, M.leather, M.brassDark),
  owl: c(P.gold, mix(P.stone, P.cliff, 0.35), M.violet),
  halo: c(P.gold, mix(P.cloud, P.horizon, 0.4), P.gold),
  patchwork: c(shade(P.roof, 0.8), P.teal, P.gold),
  kite: c(P.roof, P.cloud, P.cloud),
  satchel: c(M.leatherLight, M.leather, mix(P.cloud, P.stone, 0.5)),
};

// ───────── the table: one row per look id ─────────
type Row = [id: number, slot: DefSlot, cls: DefClass, tier: number, tpl: string, p: Params, mods: PieceDef['mods'], pal: PieceDef['pal'], glow?: Color3];
const ROWS: Row[] = [
  // ── the starter (Grove-Spun): a fitted tunic to the hip with a belt, trousers, wrist wraps, low boots, a brow band, the job's cape ──
  [1, 'head', 'plain', 0, 'band', { th: 0.98, r: 0.008 }, [], PAL.plain],
  [2, 'chest', 'plain', 0, 'garment', { hem: 5.3, sleeve: 'short', neck: 'v', off: 0.007 }, [['belt', { u: ST.HIP + 0.2, col: 'leather', buckle: 'c' }], ['tabard', { w: 1, to: ST.THIGH + 0.2 }]], PAL.plain],
  [3, 'legs', 'plain', 0, 'trousers', { off: 0.005, rise: ST.HIP + 0.6, noCuff: true }, [], [PAL.plain[1], PAL.plain[1], shade(PAL.plain[1], 0.85)]],
  [4, 'hands', 'plain', 0, 'gloves', { cuff: 4.55, fingers: 'bare', off: 0.002, wraps: true }, [], [mix(P.cloud, P.stone, 0.4), shade(mix(P.cloud, P.stone, 0.4), 0.8), M.leather]],
  [5, 'feet', 'plain', 0, 'boots', { shaft: 1.55, off: 0.006 }, [], [M.leather, M.leatherLight, shade(M.leather, 0.8)]],
  [6, 'back', 'plain', 0, 'cape', { len: 0.62, job: true, collar: 'fold', width: 0.8 }, [], PAL.plain],
  // ── Mossweave (cloth T1): a knee robe edged with leaves, a rope belt, a wide hood ──
  [7, 'head', 'cloth', 1, 'hood', { off: 0.026, front: 1.0 }, [], PAL.mossweave],
  [8, 'chest', 'cloth', 1, 'garment', { hem: 5.4, skirt: 3.25, sleeve: 'long', neck: 'wrap', off: 0.009, flare2: 0.05 }, [['leafHem', { u: 3.35 }], ['belt', { col: 'c', buckle: 'none', h: 0.1 }], ['tabard', { w: 0.75, to: 3.6 }]], PAL.mossweave],
  [9, 'legs', 'cloth', 1, 'trousers', { off: 0.007, loose: 0.012, wraps: true }, [], PAL.mossweave],
  [10, 'hands', 'cloth', 1, 'gloves', { cuff: 4.2, fingers: 'bare', wraps: true }, [], PAL.mossweave],
  [11, 'feet', 'cloth', 1, 'boots', { shaft: 1.3, off: 0.006, toe: 'round' }, [], PAL.mossweave],
  [12, 'back', 'cloth', 1, 'cape', { len: 0.45, hem: 'leaf', collar: 'mantle', width: 0.85 }, [], PAL.mossweave],
  // ── Thornrunner (light T1): a laced jerkin to the hip, thorned shoulders, a cross strap, a thorn cap ──
  [13, 'head', 'light', 1, 'cap', { front: 0.9, side: 1.4, back: 1.8, off: 0.008 }, [['thorns', { at: 'cap' }]], PAL.thornrunner],
  [14, 'chest', 'light', 1, 'garment', { hem: 5.6, sleeve: 'cap', neck: 'round', pattern: 'laced', off: 0.008, flatTorso: true }, [['thorns', { at: 'shoulder' }], ['strap', { col: 'c' }], ['belt', { col: 'b' }], ['tabard', { w: 1.1, to: ST.HIP - 0.4 }]], PAL.thornrunner],
  [15, 'legs', 'light', 1, 'trousers', { off: 0.006, knee: 'pad' }, [['thorns', { at: 'knee' }]], PAL.thornrunner],
  [16, 'hands', 'light', 1, 'gloves', { cuff: 4.0, off: 0.005 }, [['thorns', { at: 'hand' }]], PAL.thornrunner],
  [17, 'feet', 'light', 1, 'boots', { shaft: 2.5, laces: true, off: 0.007 }, [['thorns', { at: 'heel' }]], PAL.thornrunner],
  [18, 'back', 'light', 1, 'cape', { len: 0.5, hem: 'jag', collar: 'fold', width: 0.7 }, [], PAL.thornrunner],
  // ── Rootbound (heavy T1): bark plates over leather, bark pauldrons, roots, an open bark helm with root horns ──
  [19, 'head', 'heavy', 1, 'helm', { front: 1.05, side: 1.85, back: 2.25, off: 0.016, ribs: true }, [['helmTop', { kind: 'horns' }]], PAL.rootbound],
  [20, 'chest', 'heavy', 1, 'cuirass', { coat: 'cloth', hem: 5.2, skirt: 4.4, plate: 0.022, ridge: 0.004, lames: 1, paul: 'bark', paulSize: 1.0, sleeve: 'elbow' }, [['roots'], ['tabard', { w: 0.9, to: 4.0 }]], PAL.rootbound],
  [21, 'legs', 'heavy', 1, 'trousers', { off: 0.008, knee: 'cop', greave: true }, [], PAL.rootbound],
  [22, 'hands', 'heavy', 1, 'gloves', { cuff: 3.8, flare: 0.012, off: 0.007, plates: true }, [], PAL.rootbound],
  [23, 'feet', 'heavy', 1, 'boots', { shaft: 2.7, off: 0.009, plates: true, toe: 'square' }, [], PAL.rootbound],
  [24, 'back', 'heavy', 1, 'cape', { len: 0.72, hem: 'jag', collar: 'fold', width: 0.75 }, [], PAL.rootbound],
  // ── Wickthread (cloth T2): a calf robe with ember stitching, a high collar, wide sleeves, a tall wick-point hood ──
  [25, 'head', 'cloth', 2, 'hood', { off: 0.03, point: 0.3, front: 0.95 }, [['helmTop', { kind: 'ember' }]], PAL.wickthread, M.glowEmber],
  [26, 'chest', 'cloth', 2, 'garment', { hem: 5.4, skirt: 1.9, sleeve: 'bell', bell: 0.035, neck: 'high', off: 0.009, pattern: 'panel', flare2: 0.06 }, [['embers', { u: 2.1, n: 12 }], ['sash', { col: 'c' }], ['tabard', { w: 0.7, to: 2.4 }]], PAL.wickthread, M.glowEmber],
  [27, 'legs', 'cloth', 2, 'trousers', { off: 0.008, loose: 0.02, stripe: true }, [['embers', { region: 'leg', u: 1.3, n: 6 }]], PAL.wickthread, M.glowEmber],
  [28, 'hands', 'cloth', 2, 'gloves', { cuff: 4.0, fingers: 'bare', flare: 0.006 }, [['embers', { region: 'arm', u: 4.2, n: 6 }]], PAL.wickthread, M.glowEmber],
  [29, 'feet', 'cloth', 2, 'boots', { shaft: 1.35, toe: 'curl', off: 0.006, long: 0.02 }, [], PAL.wickthread],
  [30, 'back', 'cloth', 2, 'cape', { len: 0.85, width: 0.5, collar: 'high', edge: true }, [], PAL.wickthread],
  // ── Cinderstep (light T2): charcoal leather, a scorched fringe, cross belts with ember buckles, a headwrap ──
  [31, 'head', 'light', 2, 'cap', { front: 0.85, side: 1.5, back: 1.95, off: 0.012, band: 0.35, tails: true }, [], PAL.cinderstep],
  [32, 'chest', 'light', 2, 'garment', { hem: 5.5, sleeve: 'short', neck: 'v', off: 0.008, flatTorso: true }, [['fringe', { u: 5.55 }], ['strap', { col: 'b' }], ['strap', { col: 'b', mirror: true }], ['buckles', { col: 'ember', n: 2 }], ['belt', { col: 'b', buckle: 'c' }], ['tabard', { w: 1, to: ST.HIP - 0.5 }]], PAL.cinderstep, M.glowEmber],
  [33, 'legs', 'light', 2, 'trousers', { off: 0.006, knee: 'pad', wraps: true }, [], PAL.cinderstep],
  [34, 'hands', 'light', 2, 'gloves', { cuff: 3.7, fingers: 'bare', off: 0.005, flare: 0.006 }, [['laces', { region: 'arm', from: 3.9, to: 4.8 }]], PAL.cinderstep],
  [35, 'feet', 'light', 2, 'boots', { shaft: 2.8, fold: true, off: 0.008 }, [['buckles', { col: 'ember', region: 'leg', u: 1.7 }]], PAL.cinderstep],
  [36, 'back', 'light', 2, 'cape', { len: 0.72, hem: 'tatter', collar: 'fold', width: 0.8, clasp: 'c' }, [], PAL.cinderstep],
  // ── Brassbound (heavy T2): a banded brass breastplate, lames and cog plates on the shoulders, rivets, a tall helm ──
  [37, 'head', 'heavy', 2, 'helm', { front: 1.12, side: 2.15, back: 2.4, off: 0.017, crown: 0.03, bands: true, nasal: true }, [['helmTop', { kind: 'cog' }]], PAL.brassbound],
  [38, 'chest', 'heavy', 2, 'cuirass', { coat: 'mail', hem: 5.1, skirt: 4.2, plate: 0.026, ridge: 0.006, bands: 'yes', lames: 2, paul: 'cog', paulSize: 1.08, gorget: true }, [['cogs'], ['rivets', { u: ST.CHEST + 0.1, n: 6, off: 0.03 }], ['tabard', { w: 0.8, to: 3.8 }]], PAL.brassbound],
  [39, 'legs', 'heavy', 2, 'trousers', { off: 0.01, mail: true, knee: 'cop', cuisse: true, greave: true }, [['rivets', { region: 'leg', u: 2.2, n: 3, arc: 0.8, off: 0.024 }]], PAL.brassbound],
  [40, 'hands', 'heavy', 2, 'gloves', { cuff: 3.6, flare: 0.016, off: 0.008, plates: true }, [['handPlates']], PAL.brassbound],
  [41, 'feet', 'heavy', 2, 'boots', { shaft: 2.9, off: 0.01, plates: true, toe: 'square', flare: 0.008 }, [['rivets', { region: 'leg', u: 2.7, n: 3, arc: 0.7, off: 0.02 }]], PAL.brassbound],
  [42, 'back', 'heavy', 2, 'cape', { len: 0.85, collar: 'fold', width: 0.8, stripe: true, clasp: 'brass' }, [], PAL.brassbound],
  // ── Lenslight (cloth T3): an ankle robe, layered, bell sleeves, a standing collar, lit lenses; a hood with a lens circlet ──
  [43, 'head', 'cloth', 3, 'hood', { off: 0.032, front: 1.05, drape: true }, [['lens', { at: 'brow' }]], PAL.lenslight, M.glowLens],
  [44, 'chest', 'cloth', 3, 'garment', { hem: 5.4, skirt: 1.2, skirt2: 3.2, sleeve: 'bell', bell: 0.06, neck: 'high', off: 0.01, flare2: 0.08 }, [['lens', { at: 'shoulder' }], ['lens', { at: 'chest' }], ['belt', { col: 'c', buckle: 'c', h: 0.12 }], ['tabard', { w: 0.65, to: 1.7 }]], PAL.lenslight, M.glowLens],
  [45, 'legs', 'cloth', 3, 'trousers', { off: 0.009, loose: 0.03, puff: 0.01 }, [], PAL.lenslight],
  [46, 'hands', 'cloth', 3, 'gloves', { cuff: 3.9, off: 0.003, fingers: 'full' }, [['lens', { at: 'hand' }]], PAL.lenslight],
  [47, 'feet', 'cloth', 3, 'boots', { shaft: 1.5, toe: 'point', off: 0.006, long: 0.03, toecap: true }, [], PAL.lenslight],
  [48, 'back', 'cloth', 3, 'cape', { len: 1.05, collar: 'high', width: 1.0, edge: true, clasp: 'glow' }, [], PAL.lenslight, M.glowLens],
  // ── Tollwind (light T3): a long coat with wind-swept tails, a gold-edged capelet, bells; a swept hat with a feather ──
  [49, 'head', 'light', 3, 'cap', { front: 0.85, side: 1.05, back: 1.25, off: 0.01, brim: 0.11, tilt: 0.12, up: 0.06, band: 0.18 }, [['helmTop', { kind: 'feather', col: 'b' }], ['bells', { at: 'hat' }]], PAL.tollwind],
  [50, 'chest', 'light', 3, 'garment', { hem: 5.5, skirt: 3.6, open: 0.45, hemShape: 'swallow', sleeve: 'long', neck: 'round', off: 0.009, pattern: 'panel' }, [['tails', { len: 0.62 }], ['capelet', {}], ['bells', { at: 'belt' }], ['belt', { col: 'c', buckle: 'c' }], ['buttons', { n: 4 }], ['tabard', { w: 0.9, to: ST.HIP - 0.4 }]], PAL.tollwind, M.glowLens],
  [51, 'legs', 'light', 3, 'trousers', { off: 0.006, stripe: true, knee: 'pad' }, [], PAL.tollwind],
  [52, 'hands', 'light', 3, 'gloves', { cuff: 3.6, flare: 0.014, off: 0.005 }, [['cuffBand', { region: 'arm', u: 3.75, h: 0.2, col: 'c' }]], PAL.tollwind],
  [53, 'feet', 'light', 3, 'boots', { shaft: 3.1, fold: true, off: 0.008, flare: 0.006 }, [['bells', { at: 'boots', u: 2.8 }]], PAL.tollwind],
  [54, 'back', 'light', 3, 'cape', { len: 1.0, hem: 'round', collar: 'fold', width: 0.95, edge: true, flare: 0.3 }, [], PAL.tollwind],
  // ── Beaconstone (heavy T3): stone-and-brass plate, three-lame pauldrons with fins, a lit crest, a great helm with a beacon ──
  [55, 'head', 'heavy', 3, 'helm', { front: 1.2, side: 2.3, back: 2.5, off: 0.019, crown: 0.045, bands: true, visor: true }, [['helmTop', { kind: 'beacon' }]], PAL.beaconstone, M.glowBeacon],
  [56, 'chest', 'heavy', 3, 'cuirass', { coat: 'mail', hem: 5.0, skirt: 3.9, plate: 0.03, ridge: 0.009, lames: 3, paul: 'fin', paulSize: 1.15, gorget: true, sleeve: 'long' }, [['fins'], ['crest', { kind: 'diamond', off: 0.04 }], ['tabard', { w: 0.85, to: 3.5 }]], PAL.beaconstone, M.glowBeacon],
  [57, 'legs', 'heavy', 3, 'trousers', { off: 0.011, mail: true, knee: 'cop', cuisse: true, greave: true, tassets: 4.55 }, [], PAL.beaconstone],
  [58, 'hands', 'heavy', 3, 'gloves', { cuff: 3.4, flare: 0.022, off: 0.009, plates: true }, [['handPlates'], ['cuffBand', { region: 'arm', u: 3.55, h: 0.22, col: 'c', thick: 0.01 }]], PAL.beaconstone],
  [59, 'feet', 'heavy', 3, 'boots', { shaft: 3.05, off: 0.012, plates: true, toe: 'point', flare: 0.012 }, [['cuffBand', { region: 'leg', u: 2.9, h: 0.22, col: 'c', thick: 0.01 }]], PAL.beaconstone],
  [60, 'back', 'heavy', 3, 'cape', { len: 1.1, collar: 'mantle', width: 1.0, edge: true, flare: 0.3, clasp: 'glow' }, [], PAL.beaconstone, M.glowBeacon],
  // ── costumes: body pieces (chest 200..205, 212; legs, hands, feet 214..234), heads (206..208, 213), backs (209..211) ──
  [200, 'chest', 'costume', 0, 'garment', { hem: 5.4, skirt: 3.0, open: 0.35, sleeve: 'long', neck: 'high', off: 0.01, pattern: 'plain' }, [['buttons', { n: 4, a: 0.42 }], ['belt', { col: 'leather', buckle: 'c' }], ['lamp']], PAL.lamplighter],
  [214, 'legs', 'costume', 0, 'trousers', { off: 0.006, stripe: true }, [], [shade(M.soot, 1.3), shade(M.soot, 1.3), M.brass]],
  [215, 'hands', 'costume', 0, 'gloves', { cuff: 4.1, off: 0.004 }, [], [M.leather, M.leather, M.brass]],
  [216, 'feet', 'costume', 0, 'boots', { shaft: 2.2, off: 0.007, fold: true }, [], [M.leather, M.brass, shade(M.leather, 0.8)]],
  [201, 'chest', 'costume', 0, 'garment', { hem: 5.4, skirt: 0.9, sleeve: 'bell', bell: 0.04, neck: 'square', off: 0.009, flare2: 0.07 }, [['rays', { n: 12 }], ['sash', { col: 'c' }], ['crest', { kind: 'sun', u: ST.CHEST + 0.1, off: 0.016, r: 0.04, lit: false }]], PAL.solstice],
  [217, 'legs', 'costume', 0, 'trousers', { off: 0.007, loose: 0.015 }, [], [P.gold, P.gold, mix(P.cloud, P.gold, 0.3)]],
  [218, 'hands', 'costume', 0, 'gloves', { cuff: 3.6, off: 0.003 }, [], [mix(P.cloud, P.gold, 0.1), P.gold, P.gold]],
  [219, 'feet', 'costume', 0, 'boots', { shaft: 1.25, toe: 'point', off: 0.005 }, [], [P.gold, P.gold, shade(P.gold, 0.8)]],
  [202, 'chest', 'costume', 0, 'garment', { hem: 4.6, sleeve: 'elbow', neck: 'round', off: 0.012, flare: 0.012 }, [['apron'], ['belt', { col: 'b', buckle: 'none', h: 0.08 }]], PAL.orchard],
  [220, 'legs', 'costume', 0, 'trousers', { off: 0.006, hem: 1.9, knee: 'patch' }, [], [M.leatherLight, shade(M.leatherLight, 0.8), shade(M.leatherLight, 0.85)]],
  [221, 'hands', 'costume', 0, 'gloves', { cuff: 4.2, off: 0.006, fingers: 'mitten' }, [], [shade(P.meadow, 0.7), M.leatherLight, shade(P.meadow, 0.55)]],
  [222, 'feet', 'costume', 0, 'boots', { shaft: 1.2, off: 0.012, toe: 'square', heel: 0.1 }, [], [M.wood, M.woodDark, M.woodDark]],
  [203, 'chest', 'costume', 0, 'garment', { hem: 5.4, skirt: 3.4, sleeve: 'long', neck: 'high', off: 0.012, flatTorso: true }, [['capelet', { lo: ST.CHEST - 0.2 }], ['buttons', { n: 3, toggles: true, a: 0 }]], PAL.harbour],
  [223, 'legs', 'costume', 0, 'trousers', { off: 0.01, loose: 0.01 }, [], [shade(P.skyDeep, 0.55), shade(P.skyDeep, 0.55), mix(P.gold, P.horizon, 0.2)]],
  [224, 'hands', 'costume', 0, 'gloves', { cuff: 3.8, off: 0.008, flare: 0.01, fingers: 'mitten' }, [], [mix(P.gold, P.horizon, 0.2), mix(P.gold, P.horizon, 0.2), shade(P.skyDeep, 0.55)]],
  [225, 'feet', 'costume', 0, 'boots', { shaft: 3.0, off: 0.014, flare: 0.01 }, [], [shade(M.soot, 1.2), M.soot, mix(P.gold, P.horizon, 0.2)]],
  [204, 'chest', 'costume', 0, 'garment', { hem: 5.4, skirt: 0.9, sleeve: 'bell', bell: 0.08, neck: 'round', off: 0.008, pattern: 'stripes', flare2: 0.06 }, [['ruff'], ['crest', { kind: 'leaf', u: ST.RIBS, off: 0.012, r: 0.045, lit: false }]], PAL.mothsilk],
  [226, 'legs', 'costume', 0, 'trousers', { off: 0.004 }, [], [mix(P.cloud, P.rock, 0.25), mix(P.cloud, P.rock, 0.25), mix(P.cloud, P.sky, 0.5)]],
  [227, 'hands', 'costume', 0, 'gloves', { cuff: 3.2, off: 0.002, fingers: 'full' }, [], [mix(P.cloud, P.sky, 0.5), mix(P.cloud, P.rock, 0.25), mix(P.cloud, P.sky, 0.3)]],
  [228, 'feet', 'costume', 0, 'boots', { shaft: 1.2, off: 0.004, toe: 'point' }, [], [mix(P.cloud, P.rock, 0.25), mix(P.cloud, P.rock, 0.25), mix(P.cloud, P.sky, 0.5)]],
  [205, 'chest', 'costume', 0, 'garment', { hem: 5.3, sleeve: 'elbow', neck: 'v', off: 0.008 }, [['braces', { col: 'b' }], ['kerchief']], PAL.ploughman],
  [229, 'legs', 'costume', 0, 'trousers', { off: 0.008, hem: 2.1, loose: 0.006 }, [['patches']], [shade(mix(P.cliff, P.gold, 0.3), 0.55), shade(mix(P.cliff, P.gold, 0.3), 0.55), shade(mix(P.cliff, P.gold, 0.3), 0.45)]],
  [230, 'hands', 'costume', 0, 'gloves', { cuff: 4.4, fingers: 'bare', off: 0.005 }, [], [M.leatherLight, M.leatherLight, M.leather]],
  [231, 'feet', 'costume', 0, 'boots', { shaft: 1.7, off: 0.012, toe: 'square', laces: true }, [], [shade(M.leather, 0.8), M.leatherLight, M.leather]],
  [212, 'chest', 'costume', 0, 'garment', { hem: 5.4, skirt: 0.8, sleeve: 'long', neck: 'high', off: 0.01, flare2: 0.07 }, [['stars', { n: 6 }], ['rays', { n: 10, out: 0.07 }]], PAL.starfall, M.glowStar],
  [232, 'legs', 'costume', 0, 'trousers', { off: 0.007, loose: 0.01, stripe: true }, [], PAL.starfall],
  [233, 'hands', 'costume', 0, 'gloves', { cuff: 3.9, off: 0.004, fingers: 'tip' }, [], [shade(P.skyDeep, 0.42), mix(P.cloud, P.sky, 0.25), mix(P.cloud, P.sky, 0.25)]],
  [234, 'feet', 'costume', 0, 'boots', { shaft: 2.3, off: 0.007, toe: 'point', fold: true }, [], PAL.starfall],
  [206, 'head', 'costume', 0, 'cap', { front: 0.8, side: 0.95, back: 1.1, off: 0.012, brim: 0.2, droop: 0.04, band: 0.1 }, [], PAL.straw],
  [207, 'head', 'costume', 0, 'band', { th: 0.88, r: 0.011 }, [['goggles']], PAL.goggles],
  [208, 'head', 'costume', 0, 'band', { th: 0.92, r: 0.008, gem: 'c' }, [['helmTop', { kind: 'feathers' }]], PAL.owl],
  [213, 'head', 'costume', 0, 'halo', { h: 0.09, r: 0.95 }, [], PAL.halo, M.glowBeacon],
  [209, 'back', 'costume', 0, 'cape', { len: 0.72, hem: 'patch', collar: 'fold', width: 0.85 }, [], PAL.patchwork],
  [210, 'back', 'costume', 0, 'wings', { kind: 'kite' }, [], PAL.kite],
  [211, 'back', 'costume', 0, 'pack', {}, [], PAL.satchel],
];

/** Every armour and costume look's definition, by look id. */
export const DEFS: ReadonlyMap<number, PieceDef> = new Map(ROWS.map(([id, slot, cls, tier, tpl, p, mods, pal, glow]) => [id, { id, slot, cls, tier, tpl, p, mods, pal, glow }]));

/** Builds a definition on a fitter with its colours (the fitter's `piece` captures it). */
export function buildDef(F: Fit, d: PieceDef, C: Cols): void {
  const x: Ctx = { F, p: d.p, C, def: d, glow: d.glow ?? null };
  TEMPLATES[d.slot][d.tpl]!(x);
  for (const [name, mp] of d.mods) MODULES[name]!(x, mp ?? {});
}
/** A definition's signature (the distinctness test: no two looks share one). */
export const defSignature = (d: PieceDef): string => JSON.stringify([d.slot, d.tpl, d.p, d.mods, d.pal.map((c) => c.toHexString()), d.glow?.toHexString() ?? null]);
export type { ShellOpts };
