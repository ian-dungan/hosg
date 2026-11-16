// Show-as (appearance over gear): what the character sheet's Gear and Wardrobe tabs and the Tailor show about looks,
// as plain data. net/showAs.ts builds it from the server's `inventory` (looks, appearance, outfits) and the shared
// look, costume and dye tables; the HUD (hud/appearance.ts, outfits.ts, tailorPieces.ts) only draws it. Appearance
// only: nothing here is a stat, and nothing is ever unlocked or shown before the server says so.
import type { GearSlot, InvOp } from '@sg2/shared';
import type { IconSpec } from './gearViews';

/** One look that can be shown in a slot (an item's look or a costume piece). */
export interface LookOption {
  id: number;
  name: string;
  /** The tier colour (costume pieces: the costume colour). */
  colour: string;
  /** "Thornrunner set", "Costume · Straw Sunhat", "Named weapon", "Starter". */
  source: string;
  kind: 'item' | 'costume';
  /** An event costume's piece (a star). */
  event: boolean;
  icon: IconSpec;
  /** Shown in the slot now. */
  on: boolean;
}

/** One dye channel of a slot: its label and the dye shown now. */
export interface DyeChannel { ch: 0 | 1 | 2; label: string; dye: number; name: string; hex: string | null }

/** One slot's appearance. */
export interface SlotAppearance {
  slot: GearSlot;
  label: string;
  /** The item really worn (its stats count), or null (nothing is worn and nothing is shown). */
  worn: { name: string; colour: string } | null;
  /** The look shown instead of the worn item, or null (the worn item shows). */
  shown: { id: number; name: string; colour: string; source: string } | null;
  hidden: boolean;
  /** Head, back and off-hand only. */
  canHide: boolean;
  /** Every unlocked look that fits the slot over the worn item, but the worn item's own (that is "Show equipped item"). */
  options: LookOption[];
  /** Unlocked looks that fit, and all looks that fit (the worn item's own counted). */
  unlocked: number; total: number;
  /** The three channels as shown now; `own`: the slot has no dyes of its own (the piece's colours). */
  dyes: DyeChannel[]; own: boolean;
  /** The ops for "Show equipped item", "Hide", and each option (two ops when the slot is hidden: the look, then show). */
  showOps: InvOp[]; hideOp: InvOp | null;
  /** A one-line summary for the Gear tab ("Shown as: Straw Sunhat", "Hidden"), or null. */
  line: string | null;
}

/** "Show a whole set": a set or costume the adventurer has unlocked pieces of. */
export interface ShowSetOption {
  key: string;
  name: string;
  colour: string;
  kind: 'set' | 'costume';
  /** Unlocked pieces that fit what is worn now, and the set's pieces in all. */
  pieces: number; of: number;
  /** The slots it would dress ("Head, Chest, Legs"). */
  slots: string;
  /** One op per slot that changes (plus a "show" for a hidden slot it dresses); empty when it is shown already. */
  ops: InvOp[];
}

export interface OutfitRow {
  index: number;
  /** The fixed label (OUTFIT_LABELS), or null for an empty place. */
  label: string | null;
  labelIndex: number | null;
  /** "Head: Straw Sunhat · Chest: Lamplighter's Coat: Top · Back hidden". */
  summary: string;
  /** The current appearance is this outfit. */
  wearing: boolean;
}

export interface AppearanceView {
  slots: SlotAppearance[];
  /** Why looks cannot change now (knocked out, a fight, a sealed arena, casting), or null. */
  why: string | null;
  /** Slots that show something other than the worn item (a look or hidden). */
  changed: number;
  sets: ShowSetOption[];
  /** "Show my equipped gear": the ops that clear every look and hide (dyes stay). */
  clearOps: InvOp[];
  /** Dyes: at the Tailor only, DYE_PRICE a change. */
  dye: { here: boolean; price: number; gold: number; why: string | null; palette: { id: number; name: string; hex: string | null }[] };
  outfits: OutfitRow[];
  labels: readonly string[];
}

/** The Tailor's costume pieces. */
export interface TailorCostume {
  id: string;
  name: string;
  event: boolean;
  pieces: { id: string; slot: string; name: string; price: number | null; owned: boolean; ok: boolean; why: string | null }[];
  /** The pieces not yet owned, at their prices (0 when all are owned). */
  missing: number; missingPrice: number;
  ok: boolean; why: string | null;
}
