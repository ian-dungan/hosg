// The character creator's state, without any DOM (unit-tested): the tabs and their controls, every change through
// parseLook (an impossible look never exists), Undo over the last 20 changes, "Surprise me", the name's live check,
// and what Done says and costs (the Barber: barberCost, or free on the free visit).
import {
  BRINDLE_EARS, DYES, FACE_MARKS, FACE_SHAPES, FACIAL_HAIR, FUR_PATTERNS, HAIR_STYLES, LOOK_LIMITS, PEOPLES, PEOPLE_IDS, STANCES, TAILS, WALKS,
  barberCost, parseLook, type Look, type PeopleId,
} from '@sg2/shared';

export type CreatorTab = 'people' | 'body' | 'face' | 'hair' | 'colours' | 'style' | 'outfit' | 'name';
export const TAB_LABEL: Readonly<Record<CreatorTab, string>> = Object.freeze({
  people: 'People', body: 'Body', face: 'Face', hair: 'Hair', colours: 'Colours', style: 'Style', outfit: 'Outfit', name: 'Name',
});
/** How many changes Undo remembers. */
export const UNDO_DEPTH = 20;

export type Control =
  | { kind: 'people' }
  | { kind: 'slider'; path: string; label: string; min: number; max: number; ends: [string, string] }
  | { kind: 'picker'; path: string; label: string; options: readonly string[] }
  | { kind: 'colour'; path: string; label: string; swatches: readonly number[] }
  | { kind: 'dye'; path: string; label: string }
  | { kind: 'name' };

const hex = (s: string) => parseInt(s.slice(1), 16);
function lerp(a: number, b: number, t: number): number {
  let out = 0;
  for (const sh of [16, 8, 0]) {
    const p = (a >> sh) & 255, q = (b >> sh) & 255;
    out |= Math.round(p + (q - p) * t) << sh;
  }
  return out;
}
/** Twelve suggested colours from a people's ranges (spread evenly over every range). */
export function swatchesFrom(ranges: readonly (readonly [string, string])[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < 12; i++) {
    const at = (i / 12) * ranges.length, r = ranges[Math.min(ranges.length - 1, Math.floor(at))]!;
    out.push(lerp(hex(r[0]), hex(r[1]), at - Math.floor(at)));
  }
  return out;
}
const EYE_SWATCHES = [0x3b2416, 0x6e4527, 0x7a5a2e, 0xa3863f, 0x4f6b3a, 0x7f9a55, 0x5f6b73, 0x9aa6ad, 0x2f5d8a, 0x6d9ccc, 0xb07a1c, 0xe0a93a];
const MARK_SWATCHES = [0xc98d86, 0xe3b1a8, 0x8e2a22, 0xc2412f, 0x28456e, 0x3f6aa3, 0x1d1b22, 0x3a3542, 0xb98a2c, 0xdcb04a, 0xe8e2d4, 0x2e5a44];

const n = (path: string) => LOOK_LIMITS[path]!;
const slider = (path: string, label: string, ends: [string, string]): Control => ({ kind: 'slider', path, label, min: n(path)[0], max: n(path)[1], ends });
const count = (k: number) => Array.from({ length: k }, (_, i) => String(i + 1));
const EYES = ['Round', 'Bright', 'Hooded', 'Almond', 'Sleepy', 'Wide', 'Narrow', 'Heavy-lidded'];
const BROWS = ['None', 'Fine', 'Straight', 'Arched', 'Stern', 'High arch', 'Bold', 'Heavy'];
const NOSES = ['Button', 'Small', 'Straight', 'Broad', 'Long', 'Round', 'Hooked', 'Grand'];
const MUZZLES = ['Snub', 'Short', 'Neat', 'Broad', 'Long', 'Round', 'Keen', 'Grand'];
const MOUTHS = ['Smile', 'Wide', 'Small', 'Grin', 'Stern', 'Full'];
const EARS_ROUND = ['Small', 'Neat', 'Large', 'Grand'];
const EARS_LONG = ['Long', 'Longer', 'Very long', 'Sweeping'];

/** The controls of a tab for this look (the Brindlekin get muzzles, animal ears, fur and a tail). */
export function controlsFor(tab: CreatorTab, l: Look): Control[] {
  const furred = PEOPLES[l.people].furred;
  switch (tab) {
    case 'people': return [{ kind: 'people' }];
    case 'body': return [
      slider('body.height', 'Height', ['Short', 'Tall']), slider('body.build', 'Build', ['Slight', 'Stout']),
      slider('body.shoulders', 'Shoulders', ['Narrow', 'Broad']), slider('body.hips', 'Hips', ['Narrow', 'Wide']),
      slider('body.legs', 'Legs', ['Short', 'Long']), slider('body.head', 'Head', ['Small', 'Large']),
    ];
    case 'face': return [
      { kind: 'picker', path: 'face.shape', label: 'Face', options: FACE_SHAPES },
      { kind: 'picker', path: 'face.eyes', label: 'Eyes', options: EYES },
      { kind: 'picker', path: 'face.brows', label: 'Brows', options: BROWS },
      { kind: 'picker', path: 'face.nose', label: furred ? 'Muzzle' : 'Nose', options: furred ? MUZZLES : NOSES },
      { kind: 'picker', path: 'face.mouth', label: 'Mouth', options: MOUTHS },
      { kind: 'picker', path: 'face.ears', label: 'Ears', options: furred ? BRINDLE_EARS : l.people === 'larchfolk' ? EARS_LONG : EARS_ROUND },
      { kind: 'picker', path: 'face.marks', label: 'Marks', options: FACE_MARKS },
    ];
    case 'hair': return [
      { kind: 'picker', path: 'hair.style', label: 'Hair', options: HAIR_STYLES },
      { kind: 'picker', path: 'hair.facial', label: 'Facial hair', options: FACIAL_HAIR },
    ];
    case 'colours': {
      const p = PEOPLES[l.people];
      const out: Control[] = [
        { kind: 'colour', path: 'colours.skin', label: furred ? 'Fur' : 'Skin', swatches: swatchesFrom(p.skinRange) },
        { kind: 'colour', path: 'colours.hair', label: 'Hair', swatches: swatchesFrom(p.hairRange) },
        { kind: 'colour', path: 'colours.facial', label: 'Facial hair and brows', swatches: swatchesFrom(p.hairRange) },
        { kind: 'colour', path: 'colours.eyes', label: 'Eyes', swatches: EYE_SWATCHES },
        { kind: 'colour', path: 'colours.marks', label: 'Marks', swatches: MARK_SWATCHES },
      ];
      if (furred) {
        out.push({ kind: 'colour', path: 'fur.colour', label: 'Fur pattern', swatches: swatchesFrom(p.hairRange.concat(p.skinRange)) });
        out.push({ kind: 'picker', path: 'fur.pattern', label: 'Pattern', options: FUR_PATTERNS });
        out.push({ kind: 'picker', path: 'fur.tail', label: 'Tail', options: TAILS });
      }
      return out;
    }
    case 'style': return [
      { kind: 'picker', path: 'style.stance', label: 'Stance', options: STANCES },
      { kind: 'picker', path: 'style.walk', label: 'Walk', options: WALKS },
    ];
    case 'outfit': return [{ kind: 'dye', path: 'outfit.dye1', label: 'Tunic' }, { kind: 'dye', path: 'outfit.dye2', label: 'Trousers and ties' }];
    case 'name': return [{ kind: 'name' }];
  }
}
export { count as optionNumbers };

/** A field's value by path ('body.height', 'fur.tail', ...); null when the group is absent (fur on a non-furred people). */
export function getPath(l: Look, path: string): number | null {
  const [g, k] = path.split('.') as [keyof Look, string];
  const grp = l[g] as Record<string, number> | null;
  return grp && typeof grp === 'object' ? grp[k] ?? null : null;
}

/** A people's fresh fur (the Brindlekin): a pattern colour from its ranges, the first tail. */
const furFor = (p: PeopleId): Look['fur'] => (PEOPLES[p].furred ? { pattern: 1, colour: swatchesFrom(PEOPLES[p].hairRange)[3]!, tail: 1 } : null);

export interface CreatorStateOpts {
  look: Look; mode: 'create' | 'barber'; needsName: boolean; gold: number; free: boolean;
  validateName: (s: string) => string | null;
}

export class CreatorState {
  look: Look;
  readonly original: Look;
  name = '';
  private undoStack: Look[] = [];
  constructor(readonly o: CreatorStateOpts) {
    this.look = parseLook(o.look) ?? o.look;
    this.original = this.look;
  }
  get tabs(): CreatorTab[] {
    const t: CreatorTab[] = ['people', 'body', 'face', 'hair', 'colours', 'style', 'outfit'];
    if (this.o.needsName) t.push('name');
    return t;
  }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get undoDepth(): number { return this.undoStack.length; }
  private commit(next: Look | null): boolean {
    if (!next || JSON.stringify(next) === JSON.stringify(this.look)) return false;
    this.undoStack.push(this.look);
    if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
    this.look = next;
    return true;
  }
  /** Sets one field (clamped into its range); false when nothing changed. */
  set(path: string, value: number): boolean {
    const [g, k] = path.split('.') as [keyof Look, string];
    const grp = this.look[g];
    if (!grp || typeof grp !== 'object') return false;
    const lim = LOOK_LIMITS[path];
    if (!lim || !Number.isFinite(value)) return false;
    let hi = lim[1];
    if (path === 'face.ears') hi = PEOPLES[this.look.people].earsMax;
    const v = Math.max(lim[0], Math.min(hi, Math.round(value)));
    return this.commit(parseLook({ ...this.look, [g]: { ...(grp as Record<string, number>), [k]: v } }));
  }
  /** Steps a picker by ±1, wrapping round. */
  step(path: string, by: number): boolean {
    const cur = getPath(this.look, path);
    if (cur === null) return false;
    const lim = LOOK_LIMITS[path]!;
    const hi = path === 'face.ears' ? PEOPLES[this.look.people].earsMax : lim[1];
    const span = hi - lim[0] + 1;
    return this.set(path, lim[0] + ((((cur - lim[0] + by) % span) + span) % span));
  }
  /** Another people: fur appears or goes, ears are kept within the people's, skin and hair move to its suggested colours. */
  setPeople(p: PeopleId): boolean {
    if (p === this.look.people || !PEOPLE_IDS.includes(p)) return false;
    const d = PEOPLES[p];
    const skin = swatchesFrom(d.skinRange)[Math.min(11, Math.floor(((this.look.colours.skin & 255) / 256) * 12))]!;
    return this.commit(parseLook({
      ...this.look, people: p, fur: furFor(p),
      face: { ...this.look.face, ears: Math.min(this.look.face.ears, d.earsMax) },
      colours: { ...this.look.colours, skin },
    }));
  }
  /** "Surprise me": a random look of the same people (a new people is one tap away on its tab). */
  randomise(random: (rng: () => number) => Look, rng: () => number): boolean {
    for (let i = 0; i < 40; i++) {
      const r = random(rng);
      if (r.people === this.look.people) return this.commit(r);
    }
    return this.commit(random(rng));
  }
  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.look = prev;
    return true;
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
    return barberCost(this.original, this.look);
  }
  get unchanged(): boolean { return JSON.stringify(this.look) === JSON.stringify(this.original); }
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
    return this.o.needsName ? { look: this.look, name: this.name.trim() } : { look: this.look };
  }
}

/** A dye's swatch colour (0 is Undyed: drawn as a pattern by the DOM). */
export const dyeHex = (d: number): string => DYES[d]?.hex ?? '#000000';
export const dyeName = (d: number): string => DYES[d]?.name ?? '';
