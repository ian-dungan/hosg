// Plan 5: what the gear screens show (the character sheet, the stalls, the loot toasts, the level-up moment), as plain
// data. net/inventory.ts builds every view from the server's `inventory` and `jobs` and the shared item, set, costume,
// dye and talent data; the HUD (hud/bag.ts, vendor.ts, talents.ts, wardrobe.ts, loot.ts) only draws them and answers
// with what the player asked for. Nothing here is a price or a number of its own: all of it comes from shared data.
import type { CostumeSlot, GearSlot, InvOp, JobId } from '@sg2/shared';

/** How an item's icon is drawn (hud/itemIcon.ts): its slot's silhouette, its armour type's shape and its tier colour. */
export interface IconSpec {
  slot: GearSlot;
  /** Armour: cloth, light, heavy or plain (each has its own outline). */
  type: 'cloth' | 'light' | 'heavy' | 'plain' | null;
  /** A weapon's kind (blade, bow, …) or an off-hand's (buckler, quiver, …). */
  kind: string | null;
  tier: 0 | 1 | 2 | 3;
  named: boolean;
  /** The rarity colour (CSS). */
  colour: string;
}

/** One stat's before → after (a comparison line). */
export interface StatDelta {
  key: 'power' | 'defence' | 'maxHp' | 'focus' | 'flow' | 'guard';
  label: string;
  before: string; after: string;
  /** "+3", "−12" ('' when equal). */
  delta: string;
  /** true: better, false: worse, null: the same. */
  up: boolean | null;
}
/** Wearing an item instead of what the current job wears in its slot. */
export interface Comparison {
  /** The piece it replaces ("Grove-Spun Tunic"), or null when the slot is empty. */
  replaces: string | null;
  /** The whole kit's totals, before → after, for every stat that is not 0 on both sides. */
  lines: StatDelta[];
  /** "+3 Power, −12 hp", or "No change to your stats". */
  summary: string;
  /** Set bonuses gained or lost by the swap, in plain words ("Gains Thornrunner (3): …"). */
  sets: string[];
}

/** A set's progress on the current job: "Wickthread 3/6" with both bonus lines, lit when active. */
export interface SetProgress {
  name: string; colour: string; pieces: number; of: number;
  bonuses: { at: 3 | 5; text: string; on: boolean }[];
}

/** One item as a card (the bag, the Vault, an equipment slot, a stall's list). */
export interface ItemView {
  uid: number;
  item: string;
  name: string;
  colour: string;
  icon: IconSpec;
  /** "Tier 2 · Lampfall", "Starter". */
  tierLabel: string;
  ilvl: number;
  /** "Light armour · Chest", "Bow", "Quiver (off-hand)". */
  kindLabel: string;
  /** Its own stats in plain words ("+4.1 Defence · +11 hp · +3 Flow"). */
  stats: string;
  set: SetProgress | null;
  /** A named weapon's line. */
  namedLine: string | null;
  /** The jobs wearing it (their glyphs show on the tile). */
  worn: { job: JobId; glyph: string; name: string }[];
  /** Worn by the current job. */
  wornHere: boolean;
  dye: [number, number];
  /** Equip on the current job: the slot, whether it can be done now and why not, and the comparison. Null: nothing to equip (worn here). */
  equip: { slot: GearSlot; ok: boolean; why: string | null; cmp: Comparison | null } | null;
  /** At the Smithy: sell (price; confirm: tier 2 or better asks first), or why not. */
  sell: { price: number; confirm: boolean; ok: boolean; why: string | null } | null;
  /** At the Vault: put it in (from the bag) or take it out (from the Vault), or why not. */
  bank: { dir: 'in' | 'out'; ok: boolean; why: string | null } | null;
}

export type CharTab = 'gear' | 'bag' | 'talents' | 'wardrobe' | 'vault';

export interface TalentCardView {
  id: string; name: string; desc: string;
  /** "Needs Pinning Shot on your bar" when the talent changes an ability the job does not carry now, else null. */
  needs: string | null;
  chosen: boolean;
}
export interface TalentsView {
  jobName: string; level: number;
  rows: {
    row: 0 | 1 | 2; level: number; unlocked: boolean;
    /** The choice made in this row, or null. */
    chosen: number | null;
    cards: TalentCardView[];
  }[];
  /** Choosing is allowed here (a town or sanctuary, out of combat); else why not. */
  canChoose: boolean; chooseNote: string | null;
  /** Retraining: its price (0 = the free first one), whether it can be done here and now, and why not. */
  respec: { price: number; free: boolean; ok: boolean; why: string | null; rows: number };
}

export interface WardrobeView {
  slots: {
    slot: CostumeSlot; label: string;
    /** The costume worn in this slot, or null (the gear shows). */
    worn: string | null;
    options: { id: string; name: string; event: boolean; worn: boolean }[];
  }[];
  hideHead: boolean;
  /** Owned costumes in all. */
  owned: number;
  /** Why the wardrobe cannot change now (dead, a fight, …), or null. */
  why: string | null;
}

export interface CharSheetView {
  jobId: JobId; jobName: string; jobGlyph: string; level: number;
  /** 0..1 through this level (1 at the cap); "120 / 250 xp" or "Top level". */
  xpFrac: number; xpText: string;
  gold: number; seals: number;
  /** The kit's stats (the server's), each as a label and its value; the specials say what they do. */
  stats: { key: StatDelta['key']; label: string; value: string; hint: string }[];
  /** The current job's eight slots (the off-hand is null for a weapon that takes none). */
  /** takeOff: whether the worn piece can be taken off now (the starter piece goes on), and why not. */
  slots: { slot: GearSlot; label: string; item: ItemView | null; none: string | null; takeOff: { ok: boolean; why: string | null } }[];
  sets: SetProgress[];
  /** The named weapon's line, when one is worn. */
  named: string | null;
  /** Unworn items in the bag (oldest first; the sheet sorts), and how many slots there are. */
  bag: ItemView[]; bagSlots: number;
  /** Items other jobs wear (not starter pieces): they take no bag slot. */
  wornElsewhere: ItemView[];
  /** The Vault's contents, or null away from the Vault. */
  vault: ItemView[] | null; vaultSlots: number;
  talents: TalentsView;
  wardrobe: WardrobeView;
  /** Unchosen talent rows that are open (the menu button's badge). */
  openRows: number;
  /** Where the adventurer stands, for the sheet's notes ("At the Grove Vault"). */
  at: string | null;
}

/** A stall's list row (the Smithy, the Lampwright). */
export interface ShopRow {
  item: ItemView;
  /** Gold or Seals. */
  price: number; currency: 'gold' | 'seals';
  owned: number;
  /** Affordable now; else "Need 30 more gold". */
  ok: boolean; why: string | null;
  /** Which jobs can use it ("Ranger" for a bow), for weapons and off-hands. */
  fitsLabel: string | null;
  /** The current job can wear it (a comparison is shown). */
  forMe: boolean;
  /** The current job wears this very piece now. */
  wearing: boolean;
}
export interface VendorView {
  stall: 'smithy' | 'lampwright' | 'tailor' | 'vault' | 'barber';
  name: string; keeper: string; greeting: string;
  gold: number; seals: number;
  /** In reach of the stall (buying needs it); else why not. */
  here: boolean; why: string | null;
  /** The Smithy and the Lampwright: the filters and their rows. */
  filters: { id: string; label: string }[];
  defaultFilter: string;
  rows: Record<string, ShopRow[]>;
  /** The Smithy: what it would buy from the bag. */
  sell: ItemView[];
  /** The Tailor: costumes and the dye targets. */
  costumes: { id: string; name: string; slot: string; price: number | null; owned: boolean; event: boolean; ok: boolean; why: string | null }[];
  dyeTargets: { key: string; label: string; short: string; colour: string; kind: 'item' | 'costume'; uid: number | null; costume: string | null; dye: [number, number] }[];
  dyes: { id: number; name: string; hex: string | null }[];
  dyePrice: number;
}

/** What a sheet answers with. */
export type SheetAct =
  | { kind: 'op'; op: InvOp }
  | { kind: 'barber' }
  | { kind: 'tab'; tab: CharTab };

/** An open sheet: update() redraws it in place (the tab, the open card and the scroll stay); close() closes it. */
export interface SheetHandle {
  update(v: unknown): void;
  close(): void;
  /** Ops waiting for the server (their buttons show a wait and ignore taps). */
  setPending(keys: ReadonlySet<string>): void;
  readonly open: boolean;
}
/** The character sheet's handle: also switches tabs (I, C, O, T, the level-up's talent button). */
export interface CharSheetHandle extends SheetHandle { setTab(t: CharTab): void; readonly tab: CharTab }

/** One loot toast. */
export interface LootShow {
  items: { name: string; colour: string; named: boolean }[];
  gold: number;
  soldFor: number;
}
/** The level-up moment. */
export interface LevelShow {
  jobName: string; level: number;
  /** "+0.3 Power · +0.3 Defence · +2 hp". */
  gains: string;
  /** A talent row opened: its button ("Choose a talent") and whether it can be chosen here, else where to go. */
  talent: { row: number; ok: boolean; why: string | null } | null;
}
