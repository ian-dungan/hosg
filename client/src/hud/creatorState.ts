// The Look v2 character creator's state, without any DOM (unit-tested): its tabs and their controls (every field of
// a look has one), every change through parseLook (an impossible look never exists), reset per control and per tab,
// Undo and Redo, compare-with-before, presets, "Surprise me", the look code to copy and paste, the name's live check,
// and what Done says and costs (the Barber: barberCost — a new people or body costs more — or free on the free visit).
import {
  BRINDLE_EARS, BROW_SHAPES, DYES, EYE_COLOURS, EYE_SHAPES, FACE_PAINTS, FACIAL_HAIR, FUR_PATTERNS, HAIRLINES, HAIR_COLOURS,
  HAIR_STYLES, LINER_COLOURS, LIP_COLOURS, LOOK_LIMITS, LOOK_PRESETS, MOLE_SPOTS, PAINT_COLOURS, PEOPLES, PEOPLE_IDS, SCARS,
  SHADOW_COLOURS, SKIN_TONES, STANCES, TAILS, WALKS, barberCost, clampLookColour, decodeLook, encodeLook, parseLook,
  type BodyType, type Look, type NamedColour, type PeopleId,
} from '@sg2/shared';

export type CreatorTab = 'start' | 'body' | 'head' | 'eyes' | 'brows' | 'nose' | 'mouth' | 'ears' | 'skin' | 'hair' | 'facial' | 'marks' | 'style' | 'name';
export const TAB_LABEL: Readonly<Record<CreatorTab, string>> = Object.freeze({
  start: 'Start', body: 'Body', head: 'Head', eyes: 'Eyes', brows: 'Brows', nose: 'Nose', mouth: 'Mouth', ears: 'Ears',
  skin: 'Skin', hair: 'Hair', facial: 'Facial hair', marks: 'Marks', style: 'Style', name: 'Name',
});
/** Where the preview's camera goes on each tab. */
export const TAB_CAMERA: Readonly<Record<CreatorTab, 'face' | 'body' | 'full'>> = Object.freeze({
  start: 'full', body: 'full', head: 'face', eyes: 'face', brows: 'face', nose: 'face', mouth: 'face', ears: 'face',
  skin: 'face', hair: 'face', facial: 'face', marks: 'face', style: 'full', name: 'full',
});
/** How many changes Undo remembers. */
export const UNDO_DEPTH = 50;

export type Control =
  | { kind: 'start' }
  | { kind: 'slider'; path: string; label: string; min: number; max: number; ends: [string, string]; neutral: number }
  | { kind: 'picker'; path: string; label: string; options: readonly string[] }
  | { kind: 'colour'; path: string; label: string; swatches: readonly NamedColour[]; none?: string }
  | { kind: 'palette'; path: string; label: string; swatches: readonly NamedColour[] }
  | { kind: 'bits'; path: string; label: string; options: readonly string[] }
  | { kind: 'dye'; path: string; label: string }
  | { kind: 'name' };

const lim = (path: string) => LOOK_LIMITS[path]!;
const slider = (path: string, label: string, ends: [string, string]): Control => {
  const [min, max] = lim(path);
  return { kind: 'slider', path, label, min, max, ends, neutral: path === 'face.age' ? 0 : Math.round((min + max) / 2) };
};
const picker = (path: string, label: string, options: readonly string[]): Control => ({ kind: 'picker', path, label, options });
const hex = (s: string) => parseInt(s.slice(1), 16);
/** Twelve suggested colours from a people's ranges (spread evenly over every range), lightness-clamped. */
export function swatchesFrom(ranges: readonly (readonly [string, string])[], name = ''): NamedColour[] {
  const out: NamedColour[] = [];
  for (let i = 0; i < 12; i++) {
    const at = (i / 12) * ranges.length, r = ranges[Math.min(ranges.length - 1, Math.floor(at))]!;
    const a = hex(r[0]), b = hex(r[1]), t = at - Math.floor(at);
    let c = 0;
    for (const sh of [16, 8, 0]) c |= Math.round(((a >> sh) & 255) + ((((b >> sh) & 255) - ((a >> sh) & 255)) * t)) << sh;
    out.push({ name: `${name} ${i + 1}`.trim(), colour: clampLookColour(c) });
  }
  return out;
}
const named = (s: readonly string[]) => s;

/** The controls of a tab for this look (the Brindlekin get a muzzle, animal ears, fur and a tail). */
export function controlsFor(tab: CreatorTab, l: Look): Control[] {
  const p = PEOPLES[l.people], furred = p.furred;
  switch (tab) {
    case 'start': return [{ kind: 'start' }];
    case 'body': return [
      slider('build.height', 'Height', ['Short', 'Tall']), slider('build.weight', 'Weight', ['Slight', 'Heavy']), slider('build.muscle', 'Muscle', ['Soft', 'Built']),
      slider('build.shoulders', 'Shoulders', ['Narrow', 'Broad']), slider('build.chest', 'Chest', ['Flat', 'Full']), slider('build.waist', 'Waist', ['Narrow', 'Wide']),
      slider('build.hips', 'Hips', ['Narrow', 'Wide']), slider('build.arms', 'Arms', ['Short', 'Long']), slider('build.legs', 'Legs', ['Short', 'Long']),
      slider('build.neck', 'Neck', ['Slim', 'Thick']), slider('build.head', 'Head size', ['Small', 'Large']),
    ];
    case 'head': return [
      slider('face.width', 'Face width', ['Narrow', 'Wide']), slider('face.length', 'Face length', ['Short', 'Long']), slider('face.forehead', 'Forehead', ['Low', 'High']),
      slider('face.cheekbones', 'Cheekbones', ['Soft', 'High']), slider('face.jawWidth', 'Jaw', ['Narrow', 'Wide']), slider('face.chinLength', 'Chin length', ['Short', 'Long']),
      slider('face.chinWidth', 'Chin width', ['Pointed', 'Broad']), slider('face.age', 'Age lines', ['None', 'Deep']),
    ];
    case 'eyes': return [
      picker('eyes.shape', 'Eye shape', EYE_SHAPES), slider('eyes.size', 'Size', ['Small', 'Large']), slider('eyes.spacing', 'Spacing', ['Close', 'Wide']),
      slider('eyes.height', 'Height', ['Low', 'High']), slider('eyes.tilt', 'Tilt', ['Down', 'Up']), slider('eyes.openness', 'Openness', ['Narrow', 'Wide open']),
      { kind: 'colour', path: 'eyes.colour', label: 'Eye colour', swatches: EYE_COLOURS },
      { kind: 'colour', path: 'eyes.colour2', label: 'Other eye', swatches: EYE_COLOURS, none: 'Same' },
    ];
    case 'brows': return [
      picker('brows.shape', 'Brow shape', BROW_SHAPES), slider('brows.thickness', 'Thickness', ['Fine', 'Heavy']), slider('brows.height', 'Height', ['Low', 'High']),
      slider('brows.tilt', 'Tilt', ['Down', 'Up']), { kind: 'colour', path: 'brows.colour', label: 'Brow colour', swatches: HAIR_COLOURS, none: 'As hair' },
    ];
    case 'nose': return furred
      ? [picker('fur.muzzle', 'Muzzle', named(['Snub', 'Short', 'Neat', 'Broad', 'Long', 'Round', 'Keen', 'Grand'])), slider('nose.length', 'Muzzle length', ['Short', 'Long']),
        slider('nose.width', 'Width', ['Narrow', 'Wide']), slider('nose.bridge', 'Bridge', ['Flat', 'High']), slider('nose.tip', 'Nose tilt', ['Down', 'Up'])]
      : [slider('nose.length', 'Length', ['Short', 'Long']), slider('nose.width', 'Width', ['Narrow', 'Wide']), slider('nose.bridge', 'Bridge', ['Low', 'High']), slider('nose.tip', 'Tip', ['Down', 'Upturned'])];
    case 'mouth': return [
      slider('mouth.width', 'Width', ['Narrow', 'Wide']), slider('mouth.upperLip', 'Upper lip', ['Thin', 'Full']), slider('mouth.lowerLip', 'Lower lip', ['Thin', 'Full']),
      slider('mouth.height', 'Height', ['Low', 'High']), { kind: 'palette', path: 'makeup.lips', label: 'Lip colour', swatches: LIP_COLOURS },
    ];
    case 'ears': return [
      picker('ears.style', 'Ears', furred ? BRINDLE_EARS : l.people === 'larchfolk' ? ['Long', 'Longer', 'Very long', 'Sweeping'] : ['Small', 'Neat', 'Large', 'Grand']),
      slider('ears.size', 'Size', ['Small', 'Large']), slider('ears.angle', 'Angle', ['Flat', 'Out']),
    ];
    case 'skin': {
      const out: Control[] = [
        { kind: 'colour', path: 'skin.colour', label: furred ? 'Fur' : 'Skin', swatches: furred || l.people !== 'human' ? swatchesFrom(p.skinRange, furred ? 'Fur' : 'Skin').concat(SKIN_TONES.filter((_, i) => i % 3 === 0)) : SKIN_TONES },
        slider('skin.blush', 'Blush', ['None', 'Rosy']),
      ];
      if (furred) {
        out.push(picker('fur.pattern', 'Pattern', FUR_PATTERNS), { kind: 'colour', path: 'fur.colour', label: 'Pattern colour', swatches: swatchesFrom(p.hairRange.concat(p.skinRange), 'Fur') }, picker('fur.tail', 'Tail', TAILS));
      }
      out.push({ kind: 'palette', path: 'makeup.shadow', label: 'Eye shadow', swatches: SHADOW_COLOURS }, { kind: 'palette', path: 'makeup.liner', label: 'Eyeliner', swatches: LINER_COLOURS });
      return out;
    }
    case 'hair': return [
      picker('hair.style', 'Hair style', HAIR_STYLES), picker('hair.hairline', 'Hairline', HAIRLINES),
      { kind: 'colour', path: 'hair.colour', label: 'Hair colour', swatches: HAIR_COLOURS },
      { kind: 'colour', path: 'hair.colour2', label: 'Tips and streaks', swatches: HAIR_COLOURS, none: 'None' },
      slider('hair.grey', 'Grey', ['None', 'White']),
    ];
    case 'facial': return [picker('hair.facial', 'Facial hair', FACIAL_HAIR), { kind: 'colour', path: 'hair.facialColour', label: 'Colour', swatches: HAIR_COLOURS }];
    case 'marks': return [
      slider('skin.freckles', 'Freckles', ['None', 'Many']), { kind: 'bits', path: 'skin.moles', label: 'Moles', options: MOLE_SPOTS.map((m) => m.name) },
      picker('skin.scar', 'Scar', SCARS), picker('paint.style', 'Face paint', FACE_PAINTS), { kind: 'colour', path: 'paint.colour', label: 'Paint colour', swatches: PAINT_COLOURS },
    ];
    case 'style': return [picker('style.stance', 'Stance', STANCES), picker('style.walk', 'Walk', WALKS), { kind: 'dye', path: 'outfit.dye1', label: 'Tunic' }, { kind: 'dye', path: 'outfit.dye2', label: 'Trousers and ties' }];
    case 'name': return [{ kind: 'name' }];
  }
}

/** A field's value by path ('build.height', 'fur.tail', ...); undefined when the group is absent (fur on a non-furred people). */
export function getPath(l: Look, path: string): number | null | undefined {
  const [g, k] = path.split('.') as [keyof Look, string];
  const grp = l[g] as Record<string, number | null> | null;
  return grp && typeof grp === 'object' ? grp[k] : undefined;
}
const withPath = (l: Look, path: string, v: number | null): Look | null => {
  const [g, k] = path.split('.') as [keyof Look, string];
  const grp = l[g];
  if (!grp || typeof grp !== 'object') return null;
  return parseLook({ ...l, [g]: { ...(grp as Record<string, number>), [k]: v } });
};

/** A people's fresh fur (the Brindlekin). */
const furFor = (p: PeopleId): Look['fur'] => (PEOPLES[p].furred ? { pattern: 1, colour: swatchesFrom(PEOPLES[p].hairRange)[3]!.colour, tail: 1, muzzle: 3 } : null);

export interface CreatorStateOpts {
  look: Look; mode: 'create' | 'barber'; needsName: boolean; gold: number; free: boolean;
  validateName: (s: string) => string | null;
  /** The name to start with (the one the server refused, so the player can change it rather than type it again). */
  name?: string;
}

export class CreatorState {
  private cur: Look;
  readonly original: Look;
  name = '';
  /** Showing the look as it was when the creator opened (Compare); edits are paused meanwhile. */
  comparing = false;
  private undoStack: Look[] = [];
  private redoStack: Look[] = [];
  private readonly originalName: string;
  constructor(readonly o: CreatorStateOpts) {
    this.cur = parseLook(o.look) ?? o.look;
    this.original = this.cur;
    this.name = o.name ?? '';
    this.originalName = this.name;
  }
  /** The look being edited. */
  get look(): Look { return this.cur; }
  /** The look the preview shows (the original while comparing). */
  get shown(): Look { return this.comparing ? this.original : this.cur; }
  /** The tab to open on: the Name tab when the creator opened again over a name (a notice) and a name is asked for. */
  startTab(notice: string | undefined): CreatorTab {
    return notice && this.o.needsName ? 'name' : 'start';
  }
  /** The line over the buttons: the notice until the look or the name changes; else what stops Done; else nothing. */
  noteLine(tab: CreatorTab, notice: string | undefined): string {
    if (notice && this.unchanged && this.name === this.originalName) return notice;
    const block = this.blocker;
    if (block && (tab !== 'name' || !this.o.needsName)) return block;
    return '';
  }
  get tabs(): CreatorTab[] {
    const t: CreatorTab[] = ['start', 'body', 'head', 'eyes', 'brows', 'nose', 'mouth', 'ears', 'skin', 'hair', 'facial', 'marks', 'style'];
    if (this.o.needsName) t.push('name');
    return t;
  }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get undoDepth(): number { return this.undoStack.length; }
  private commit(next: Look | null): boolean {
    if (!next || JSON.stringify(next) === JSON.stringify(this.cur)) return false;
    this.comparing = false;
    this.undoStack.push(this.cur);
    if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
    this.redoStack = [];
    this.cur = next;
    return true;
  }
  /** Sets one field (a number clamped into its range, or a colour lightness-clamped; null only where allowed); false when nothing changed. */
  set(path: string, value: number | null): boolean {
    const r = lim(path);
    if (!r) return false;
    let v: number | null;
    if (value === null) v = null;
    else if (!Number.isFinite(value)) return false;
    else if (path.endsWith('olour') || path.endsWith('olour2')) v = clampLookColour(Math.max(0, Math.min(0xffffff, Math.round(value))));
    else {
      const hi = path === 'ears.style' ? PEOPLES[this.cur.people].earsMax : r[1];
      v = Math.max(r[0], Math.min(hi, Math.round(value)));
    }
    return this.commit(withPath(this.cur, path, v));
  }
  /** Steps a picker by ±1, wrapping round. */
  step(path: string, by: number): boolean {
    const cur = getPath(this.cur, path);
    if (typeof cur !== 'number') return false;
    const r = lim(path)!;
    const hi = path === 'ears.style' ? PEOPLES[this.cur.people].earsMax : r[1];
    const span = hi - r[0] + 1;
    return this.set(path, r[0] + ((((cur - r[0] + by) % span) + span) % span));
  }
  /** Toggles bit `i` of a bit set (moles). */
  toggleBit(path: string, i: number): boolean {
    const cur = getPath(this.cur, path);
    return typeof cur === 'number' && this.set(path, cur ^ (1 << i));
  }
  /** One control back to its neutral (sliders: the middle; anything else: as the creator opened). */
  reset(c: Control): boolean {
    if (!('path' in c)) return false;
    if (c.kind === 'slider') return this.set(c.path, c.neutral);
    const was = getPath(this.original, c.path);
    return was !== undefined && this.commit(withPath(this.cur, c.path, was));
  }
  /** Every control of a tab back (one Undo step). */
  resetTab(tab: CreatorTab): boolean {
    let l: Look = this.cur;
    for (const c of controlsFor(tab, l)) {
      if (!('path' in c)) continue;
      const v = c.kind === 'slider' ? c.neutral : getPath(this.original, c.path);
      if (v === undefined) continue;
      l = withPath(l, c.path, v) ?? l;
    }
    return this.commit(l);
  }
  /** Another people: fur appears or goes, ears are kept within the people's, the skin moves to its suggested colours. */
  setPeople(p: PeopleId): boolean {
    if (p === this.cur.people || !PEOPLE_IDS.includes(p)) return false;
    const d = PEOPLES[p];
    const human = p === 'human' && !PEOPLES[this.cur.people].furred;
    const skin = human ? this.cur.skin.colour : swatchesFrom(d.skinRange)[Math.min(11, Math.floor(((this.cur.skin.colour & 255) / 256) * 12))]!.colour;
    return this.commit(parseLook({ ...this.cur, people: p, fur: furFor(p), ears: { ...this.cur.ears, style: Math.min(this.cur.ears.style, d.earsMax) }, skin: { ...this.cur.skin, colour: skin } }));
  }
  setBody(b: BodyType): boolean {
    return this.commit(parseLook({ ...this.cur, body: b }));
  }
  /** A named preset (its people and body too); the outfit's dyes stay. */
  applyPreset(id: string): boolean {
    const p = LOOK_PRESETS.find((x) => x.id === id);
    return !!p && this.commit(parseLook({ ...p.look, outfit: this.cur.outfit }));
  }
  /** "Surprise me": a random look of the same people and body (the Start tab changes those). */
  randomise(random: (rng: () => number) => Look, rng: () => number): boolean {
    for (let i = 0; i < 60; i++) {
      const r = random(rng);
      if (r.people === this.cur.people && r.body === this.cur.body) return this.commit(r);
    }
    return this.commit(random(rng));
  }
  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.cur);
    this.cur = prev;
    this.comparing = false;
    return true;
  }
  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.cur);
    this.cur = next;
    this.comparing = false;
    return true;
  }
  /** The look's code to share (72 characters). */
  get code(): string { return encodeLook(this.cur); }
  /** Takes a pasted look code; the line to show when it is not one. */
  pasteCode(text: string): { ok: true } | { ok: false; error: string } {
    const t = text.trim();
    const l = decodeLook(t);
    if (!l) return { ok: false, error: t ? 'That is not a look code' : 'Paste a look code first' };
    this.commit(parseLook({ ...l, outfit: this.cur.outfit }));
    return { ok: true };
  }
  /** The name's problem as a line to show, or null (only when a name is needed). */
  get nameError(): string | null {
    if (!this.o.needsName) return null;
    if (this.name.trim() === '') return 'Choose a name for your adventurer';
    return this.o.validateName(this.name);
  }
  /** Gold the Barber asks (0 on the free visit and in the creator). */
  get cost(): number {
    if (this.o.mode === 'create' || this.o.free) return 0;
    return barberCost(this.original, this.cur);
  }
  get unchanged(): boolean { return JSON.stringify(this.cur) === JSON.stringify(this.original); }
  /** What the Done button says. */
  get doneLabel(): string {
    if (this.o.mode === 'create') return 'Done';
    if (this.o.free) return 'Change look — free';
    if (this.unchanged) return 'No change';
    return `Change look — ${this.cost} gold`;
  }
  /** Whether Done may finish, and why not. */
  get blocker(): string | null {
    if (this.nameError) return this.nameError;
    if (this.o.mode === 'barber' && !this.o.free && !this.unchanged && this.cost > this.o.gold) return `You need ${this.cost} gold (you have ${this.o.gold})`;
    return null;
  }
  result(): { look: Look; name?: string } {
    return this.o.needsName ? { look: this.cur, name: this.name.trim() } : { look: this.cur };
  }
}

/** A dye's swatch colour (0 is Undyed: drawn as a pattern by the DOM). */
export const dyeHex = (d: number): string => DYES[d]?.hex ?? '#000000';
export const dyeName = (d: number): string => DYES[d]?.name ?? '';
