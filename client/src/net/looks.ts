// Adventurers' looks and gear as the room sends them: `looks` messages carry [eid, encodeLook, encodeGearLook] once per
// adventurer the first time it enters this client's view (its own included) and again when either changes; they are
// not re-sent on a view re-entry, so the client keeps them by engine id for the whole room. Engine ids belong to one
// room: the cache is cleared on every room change (a travel, a relog, a reconnect into a new room).
// Also: the free creator visit (`lookFree`) and the Barber's refusals (`invRefused` with op 'look'). Pure: unit-tested.
import { decodeGearLook, decodeLook, type GearLook, type Look, type S2C } from '@sg2/shared';
import type { CreatorOpts } from '../core/contracts';

export interface LookEntry {
  /** The codes as sent (compare them to see a change). */
  code: string; gearCode: string;
  look: Look; gear: GearLook | null;
  /** Bumped on every change of this eid's look or gear (remotes rebuild when it moves). */
  ver: number;
}

export class LookCache {
  private byEid = new Map<number, LookEntry>();
  /** The free creator visit is still unused (null: not told yet). */
  free: boolean | null = null;
  /** Messages and entries ignored as malformed (diagnostics). */
  rejected = 0;

  /** Takes a `looks` message; returns the engine ids whose look or gear changed. */
  handle(m: S2C['looks'] | unknown): number[] {
    const changed: number[] = [];
    const a = (m as { a?: unknown } | null)?.a;
    if (!Array.isArray(a)) { this.rejected++; return changed; }
    for (const row of a) {
      if (!Array.isArray(row) || row.length !== 3) { this.rejected++; continue; }
      const [eid, code, gearCode] = row as unknown[];
      if (typeof eid !== 'number' || !Number.isInteger(eid) || eid < 0 || typeof code !== 'string' || typeof gearCode !== 'string') { this.rejected++; continue; }
      const prev = this.byEid.get(eid);
      if (prev && prev.code === code && prev.gearCode === gearCode) continue;
      const look = decodeLook(code);
      if (!look) { this.rejected++; continue; }
      const gear = decodeGearLook(gearCode);
      this.byEid.set(eid, { code, gearCode, look, gear, ver: (prev?.ver ?? 0) + 1 });
      changed.push(eid);
    }
    return changed;
  }
  /** Takes a `lookFree` message. */
  handleFree(m: S2C['lookFree'] | unknown): void {
    const f = (m as { free?: unknown } | null)?.free;
    if (typeof f === 'boolean') this.free = f;
  }
  get(eid: number): LookEntry | undefined { return this.byEid.get(eid); }
  /** The version of an eid's look (0: none yet). */
  ver(eid: number): number { return this.byEid.get(eid)?.ver ?? 0; }
  /** eid → look code (the debug hook's `remoteLooks`). */
  codes(): Record<number, string> {
    const out: Record<number, string> = {};
    for (const [eid, e] of this.byEid) out[eid] = e.code;
    return out;
  }
  /** eid → gear code (the debug hook's `remoteGear`; only rows that passed the checks). */
  gearCodes(): Record<number, string> {
    const out: Record<number, string> = {};
    for (const [eid, e] of this.byEid) out[eid] = e.gearCode;
    return out;
  }
  get size(): number { return this.byEid.size; }
  /** Forget everything (a room change: engine ids are per room). */
  clear(): void { this.byEid.clear(); this.free = null; }
}

/** The line to show for a Barber refusal (`invRefused` with op 'look'), or null for another operation's. */
export function barberRefusal(m: S2C['invRefused'] | unknown): string | null {
  const r = m as { op?: unknown; text?: unknown } | null;
  if (!r || r.op !== 'look') return null;
  return typeof r.text === 'string' && r.text ? r.text : 'The Barber cannot do that now';
}

/** After sign-in: whether the creator opens (the free visit, once) and whether it asks for the name (named accounts only, not guests). */
export function creatorPlan(info: { free: boolean; name: string | null; guest: boolean }): { open: boolean; needsName: boolean } {
  return { open: info.free, needsName: info.free && info.name === null && !info.guest };
}

/** How long after it was made an emote still plays when first seen (s): an older one is history, not news. */
export const EMOTE_FRESH_S = 1.5;
/**
 * Whether a remote's `emote`/`emoteAt` change should play now: a new emoteAt, made within EMOTE_FRESH_S of the room's
 * clock (sit holds, so it plays however old it is: it lasts until the adventurer moves).
 */
export function emoteToPlay(seenAt: number, emote: string | undefined, emoteAt: number | undefined, clock: number | undefined, tickHz: number): string | null {
  const at = emoteAt ?? 0;
  if (!emote || at === 0 || at === seenAt) return null;
  if (emote === 'sit') return emote;
  if (typeof clock === 'number' && (clock - at) / tickHz > EMOTE_FRESH_S) return null;
  return emote;
}

/** The Barber's entry point: the online client fills `open` (the creator in Barber mode, then a `look`); the Barber
 *  stall's tap (Plan 5 Task 10) calls it. Null in the offline demo. */
export const barberHook: { open: (() => Promise<void>) | null } = { open: null };

/** What the Barber session needs from the page (online.ts); `R` is the room. */
export interface BarberDeps<R> {
  /** The room being played (null between rooms). */
  room(): R | null;
  /** This adventurer's look in that room (undefined: not sent yet). */
  look(r: R): Look | undefined;
  opts(look: Look): CreatorOpts;
  /** Opens the creator in Barber mode (hud.creator): a modal over the game, closable from outside. */
  open(o: CreatorOpts): { done: Promise<{ look: Look; name?: string } | null>; close(): void };
  /** Stops the adventurer where they stand (a walk under way ends); while `open`, the page holds the move scale at 0. */
  hold(): void;
  send(r: R, look: Look): void;
}
/**
 * The Barber: one creator at a time, the adventurer held still behind it, and closed when its room ends (a kick, a
 * disconnect, a travel), so it never stays over the login screen; a Done that lands in another room sends nothing.
 */
export function createBarber<R>(d: BarberDeps<R>): { readonly open: boolean; show(): Promise<void>; close(): void } {
  let session: { close(): void } | null = null;
  return {
    get open() { return session !== null; },
    async show() {
      const r = d.room();
      if (!r || session) return;
      const look = d.look(r);
      if (!look) return;
      const s = d.open(d.opts(look));
      session = s;
      d.hold();
      let res: { look: Look } | null = null;
      try { res = await s.done; } finally { if (session === s) session = null; }
      if (res && d.room() === r) d.send(r, res.look);
    },
    close() { const s = session; session = null; s?.close(); },
  };
}
