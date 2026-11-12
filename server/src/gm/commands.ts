// GM commands (SERVER ONLY: never imported by shared/ or client/, so no command name or help text ships to a
// client). A chat line starting with "/gm " is parsed here; the room runs it only for an account whose stored role
// (is_gm, re-read on every line) says GM, and writes one audit row for every line, done or refused.
//
// Syntax (names are adventurer names, any case; quote a name with spaces where more words follow it):
//   /gm help
//   /gm announce <text>                              1..200 characters, plain text, at most one every 30 s
//   /gm grant gold <1..10000> <name>                 at most 100 000 gold a GM a UTC day
//   /gm grant item <item id> <name>
//   /gm grant costume <costume id> <name>            event-only costumes included
//   /gm tp <name>  |  /gm tp <x> <z>                 the GM moves, in its own room only
//   /gm kick <name> <reason>
//   /gm event start <title>  |  /gm event end
//   /gm event award <costume id> <name> [<name> …]   at most 20 names
import { CHAT_MAX, GOLD_MAX, ITEMS, cleanChat, isCostumeId, isItemId, type CostumeId, type ItemId } from '@sg2/shared';
import { GM_GOLD_GRANT_MAX, grantThing, type GmGrant, type GrantOutcome } from './grant';
import { utcDay, type GmLogEntry, type Store } from '../store/types';

export { GM_GOLD_GRANT_MAX } from './grant';

export type GmCommand =
  | { cmd: 'help' }
  | { cmd: 'announce'; text: string }
  | { cmd: 'grant'; what: 'gold'; amount: number; name: string }
  | { cmd: 'grant'; what: 'item'; item: ItemId; name: string }
  | { cmd: 'grant'; what: 'costume'; costume: CostumeId; name: string }
  | { cmd: 'tp'; name: string } | { cmd: 'tp'; x: number; z: number }
  | { cmd: 'kick'; name: string; reason: string }
  | { cmd: 'event'; op: 'start'; title: string } | { cmd: 'event'; op: 'end' }
  | { cmd: 'event'; op: 'award'; costume: CostumeId; names: string[] };

/** GM lines a GM may run a minute (more are refused 'rate', and audited). */
export const GM_PER_MIN = 20;
/** At most one announce (or event start) this often, for the whole process (s). */
export const GM_ANNOUNCE_EVERY_S = 30;
/** Gold one GM may grant a UTC day (summed from that day's audit rows). */
export const GM_GOLD_PER_DAY = 100_000;
/** Names one event award takes at most. */
export const GM_AWARD_MAX_NAMES = 20;
export const GM_ANNOUNCE_MAX = CHAT_MAX;
export const GM_TITLE_MAX = 60;
export const GM_REASON_MAX = 100;
/** How far from the origin a tp spot may be (m). */
const TP_MAX = 10_000;

/** The help line: sent only to a GM (as a notice). */
export const GM_HELP = 'GM commands: /gm announce <text> · /gm grant gold <1-10000> <name> · /gm grant item <item id> <name> · '
  + '/gm grant costume <costume id> <name> · /gm tp <name> or /gm tp <x> <z> · /gm kick <name> <reason> · /gm event start <title> · '
  + '/gm event end · /gm event award <costume id> <name> [more names, at most 20] · quote names with spaces: "Old Tom"';

const PREFIX_RE = /^\/gm(?:\s|$)/i;
const NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9' -]{0,30}[A-Za-z0-9])?$/;
const AMOUNT_RE = /^\d{1,7}$/;
const COORD_RE = /^-?\d{1,5}(?:\.\d{1,3})?$/;

/** Words, with "double-quoted" runs as one word; null when a quote is left open. */
function words(s: string): string[] | null {
  if ((s.match(/"/g) ?? []).length % 2 !== 0) return null;
  const out: string[] = [];
  for (const m of s.matchAll(/"([^"]*)"|(\S+)/g)) out.push(m[1] ?? m[2]!);
  return out;
}

const okName = (n: string | undefined): n is string => typeof n === 'string' && NAME_RE.test(n);
const err = (error: string) => ({ error });

/**
 * A chat line as a GM command: null when it is not a /gm line (any other chat), `{ error }` when it is one but
 * malformed (the GM is told why). Cleaned like any chat line first. Never throws.
 */
export function parseGmCommand(text: string): GmCommand | { error: string } | null {
  try {
    const line = cleanChat(text);
    if (line === null || !PREFIX_RE.test(line)) return null;
    const body = line.slice(3).trim();
    const w = words(body);
    if (!w) return err('A quote is not closed');
    const [verb, ...rest] = w;
    switch ((verb ?? '').toLowerCase()) {
      case 'help':
        return rest.length === 0 ? { cmd: 'help' } : err('Usage: /gm help');
      case 'announce': {
        const t = cleanChat(body.slice(verb!.length));
        if (t === null || t.length > GM_ANNOUNCE_MAX) return err(`Usage: /gm announce <text> (1 to ${GM_ANNOUNCE_MAX} characters)`);
        return { cmd: 'announce', text: t };
      }
      case 'grant': {
        const [what, arg, ...nameWords] = rest;
        const name = nameWords.join(' ');
        const usage = 'Usage: /gm grant gold <1-10000> <name> | /gm grant item <item id> <name> | /gm grant costume <costume id> <name>';
        if (!what || !arg || !okName(name)) return err(usage);
        switch (what.toLowerCase()) {
          case 'gold': {
            const amount = AMOUNT_RE.test(arg) ? Number(arg) : NaN;
            if (!(amount >= 1 && amount <= GM_GOLD_GRANT_MAX)) return err(`Gold must be a whole number from 1 to ${GM_GOLD_GRANT_MAX}`);
            return { cmd: 'grant', what: 'gold', amount, name };
          }
          case 'item':
            return isItemId(arg) ? { cmd: 'grant', what: 'item', item: arg, name } : err(`No item has the id ${String(arg).slice(0, 40)}`);
          case 'costume':
            return isCostumeId(arg) ? { cmd: 'grant', what: 'costume', costume: arg, name } : err(`No costume has the id ${arg.slice(0, 40)}`);
          default:
            return err(usage);
        }
      }
      case 'tp': {
        if (rest.length === 2 && COORD_RE.test(rest[0]!) && COORD_RE.test(rest[1]!)) {
          const x = Number(rest[0]), z = Number(rest[1]);
          if (Math.abs(x) <= TP_MAX && Math.abs(z) <= TP_MAX) return { cmd: 'tp', x, z };
          return err(`Usage: /gm tp <x> <z> (each within ±${TP_MAX})`);
        }
        const name = rest.join(' ');
        if (rest.some((r) => /\d/.test(r) && !/[A-Za-z]/.test(r)) || !okName(name)) return err('Usage: /gm tp <name> | /gm tp <x> <z>');
        return { cmd: 'tp', name };
      }
      case 'kick': {
        const [name, ...why] = rest;
        const reason = cleanChat(why.join(' '));
        if (!okName(name) || reason === null || reason.length > GM_REASON_MAX) return err(`Usage: /gm kick <name> <reason> (a reason of 1 to ${GM_REASON_MAX} characters)`);
        return { cmd: 'kick', name, reason };
      }
      case 'event': {
        const [op, ...more] = rest;
        switch ((op ?? '').toLowerCase()) {
          case 'start': {
            const title = cleanChat(body.replace(/^event\s+start/i, ''));
            if (title === null || title.length > GM_TITLE_MAX) return err(`Usage: /gm event start <title> (1 to ${GM_TITLE_MAX} characters)`);
            return { cmd: 'event', op: 'start', title };
          }
          case 'end':
            return more.length === 0 ? { cmd: 'event', op: 'end' } : err('Usage: /gm event end');
          case 'award': {
            const [costume, ...names] = more;
            if (!costume || names.length === 0) return err('Usage: /gm event award <costume id> <name> [more names]');
            if (!isCostumeId(costume)) return err(`No costume has the id ${costume.slice(0, 40)}`);
            if (names.length > GM_AWARD_MAX_NAMES) return err(`At most ${GM_AWARD_MAX_NAMES} names an award`);
            if (!names.every(okName)) return err('Names are letters, digits, spaces, hyphens and apostrophes (quote a name with spaces)');
            const seen = new Set<string>();
            const unique = names.filter((n) => !seen.has(n.toLowerCase()) && (seen.add(n.toLowerCase()), true));
            return { cmd: 'event', op: 'award', costume, names: unique };
          }
          default:
            return err('Usage: /gm event start <title> | /gm event end | /gm event award <costume id> <names>');
        }
      }
      default:
        return err('Unknown GM command; /gm help lists them');
    }
  } catch {
    return err('That command could not be read');
  }
}

/** The audit row's command name for a parsed line. */
export function commandName(c: GmCommand | { error: string }): string {
  if ('error' in c) return 'invalid';
  if (c.cmd === 'grant') return `grant ${c.what}`;
  if (c.cmd === 'event') return `event ${c.op}`;
  return c.cmd;
}

/** The rate limits: GM_PER_MIN lines a minute per GM, and one announce every GM_ANNOUNCE_EVERY_S for the process. */
export class GmLimits {
  private lines = new Map<string, number[]>();
  private lastAnnounce = -Infinity;
  /** Takes one of the GM's lines at wall time `now` (ms): false when it has had GM_PER_MIN in the last minute. */
  take(gmAccount: string, now: number): boolean {
    const recent = (this.lines.get(gmAccount) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= GM_PER_MIN) {
      this.lines.set(gmAccount, recent);
      return false;
    }
    recent.push(now);
    this.lines.set(gmAccount, recent);
    return true;
  }
  /** Seconds until the next announce may go out (0: now). */
  announceWait(now: number): number {
    return Math.max(0, Math.ceil((this.lastAnnounce + GM_ANNOUNCE_EVERY_S * 1000 - now) / 1000));
  }
  /** Takes the announce slot at `now` (ms): false within GM_ANNOUNCE_EVERY_S of the last one. */
  announce(now: number): boolean {
    if (now - this.lastAnnounce < GM_ANNOUNCE_EVERY_S * 1000) return false;
    this.lastAnnounce = now;
    return true;
  }
}

/** What a command's run reports: the GM's notice, and one audit row each (a whole award: one per name). */
export interface GmRun { notice: string; rows: Omit<GmLogEntry, 'gmAccount'>[] }

/** What the room and the app give a command to act with. */
export interface GmHost {
  store: Store;
  limits: GmLimits;
  /** Wall clock (ms). */
  now(): number;
  /** The process-wide event title (null: none). */
  event(): string | null;
  setEvent(title: string | null): void;
  /** `announce` to every room and instance. */
  announce(text: string): void;
  /** A grant to the named adventurer: online through its session's queue (wherever it is), else grantOffline. */
  grant(name: string, g: GmGrant): Promise<{ outcome: GrantOutcome; name: string }>;
  /** The GM moves (in its own room). */
  tp(to: { name: string } | { x: number; z: number }): { ok: boolean; result: string };
  /** The named adventurer's session is ended with the reason. */
  kick(name: string, reason: string): Promise<{ ok: boolean; result: string }>;
  /** A fresh grant key (`gm:` + random). */
  key(): string;
}

const target = (s: string | null): string | null => (s === null ? null : s.slice(0, 64));

function grantText(outcome: GrantOutcome, name: string, thing: string): string {
  switch (outcome) {
    case 'done': return `You gave ${name} ${thing}`;
    case 'unknown': return `No adventurer named ${name}`;
    case 'owned': return `${name} already has ${thing}`;
    case 'bag-full': return `${name}'s bag is full: nothing was given (try again later)`;
    case 'purse-full': return `${name}'s purse would pass ${GOLD_MAX} gold: nothing was given`;
    case 'invalid': return `That grant is not possible: nothing was given`;
    default: return `The grant to ${name} may not have landed: check before retrying (its inventory, or the audit log)`;
  }
}

/**
 * Runs one /gm line for a GM (its role already checked against the store): the rate limit, the parse, then the
 * command. Never throws: a failure is reported and audited like a refusal.
 */
export async function runGmLine(line: string, gmAccount: string, host: GmHost): Promise<GmRun> {
  const parsed = parseGmCommand(line) ?? { error: 'Not a GM command' };
  const command = commandName(parsed);
  const typed = { text: (cleanChat(line) ?? '').slice(0, 200) };
  if (!host.limits.take(gmAccount, host.now())) {
    const result = `Too many GM commands: at most ${GM_PER_MIN} a minute`;
    return { notice: result, rows: [{ command, target: null, args: typed, ok: false, result }] };
  }
  if ('error' in parsed) return { notice: parsed.error, rows: [{ command, target: null, args: typed, ok: false, result: parsed.error }] };
  try {
    return await run(parsed, gmAccount, host);
  } catch (e) {
    const result = 'That command failed; nothing was changed that the log does not show';
    void e;
    return { notice: result, rows: [{ command, target: null, args: typed, ok: false, result: `failed: ${String((e as Error)?.message ?? e).slice(0, 200)}` }] };
  }
}

async function run(c: GmCommand, gmAccount: string, host: GmHost): Promise<GmRun> {
  const one = (ok: boolean, result: string, tgt: string | null, args: unknown): GmRun => ({ notice: result, rows: [{ command: commandName(c), target: target(tgt), args, ok, result }] });
  switch (c.cmd) {
    case 'help':
      return one(true, GM_HELP, null, {});
    case 'announce': {
      const now = host.now();
      if (!host.limits.announce(now)) return one(false, `One announcement every ${GM_ANNOUNCE_EVERY_S} s: wait ${host.limits.announceWait(now)} s`, null, { text: c.text });
      host.announce(c.text);
      return one(true, 'Announced', null, { text: c.text });
    }
    case 'grant': {
      const args = c.what === 'gold' ? { amount: c.amount, name: c.name } : c.what === 'item' ? { item: c.item, name: c.name } : { costume: c.costume, name: c.name };
      const g: GmGrant = c.what === 'gold' ? { gold: c.amount } : c.what === 'item' ? { item: c.item } : { costume: c.costume };
      // gold, and items at their sell value, count toward the GM's daily cap (a grant that may have landed too)
      const worth = c.what === 'gold' ? c.amount : c.what === 'item' ? (ITEMS[c.item]?.sell ?? 0) : 0;
      if (worth > 0) {
        const today = await host.store.gmGoldToday(gmAccount, utcDay(host.now()));
        if (today + worth > GM_GOLD_PER_DAY) {
          return one(false, `At most ${GM_GOLD_PER_DAY} gold (items at their sell value) a day per game master: ${Math.max(0, GM_GOLD_PER_DAY - today)} left today`, c.name, args);
        }
      }
      const { outcome, name } = await host.grant(c.name, { ...g, key: host.key() });
      const counted = worth > 0 && (outcome === 'done' || outcome === 'failed') ? { counted: worth } : {};
      return one(outcome === 'done', grantText(outcome, name, grantThing(g)), c.name, { ...args, ...counted });
    }
    case 'tp': {
      const r = host.tp('name' in c ? { name: c.name } : { x: c.x, z: c.z });
      return one(r.ok, r.result, 'name' in c ? c.name : null, 'name' in c ? { name: c.name } : { x: c.x, z: c.z });
    }
    case 'kick': {
      const r = await host.kick(c.name, c.reason);
      return one(r.ok, r.result, c.name, { name: c.name, reason: c.reason });
    }
    case 'event': {
      if (c.op === 'start') {
        const now = host.now();
        if (!host.limits.announce(now)) return one(false, `One announcement every ${GM_ANNOUNCE_EVERY_S} s: wait ${host.limits.announceWait(now)} s`, null, { title: c.title });
        host.setEvent(c.title);
        host.announce(`Event: ${c.title}`);
        return one(true, `Event started: ${c.title}`, null, { title: c.title });
      }
      if (c.op === 'end') {
        const title = host.event();
        if (title === null) return one(false, 'No event is running', null, {});
        host.setEvent(null);
        return one(true, `Event ended: ${title}`, null, { title });
      }
      // award: each name as `grant costume`, flagged as an event grant (its row carries the event's title)
      const event = host.event();
      if (event === null) return one(false, 'No event is running: start one first (/gm event start <title>)', c.names.join(', '), { costume: c.costume, names: c.names });
      const rows: GmRun['rows'] = [];
      const lines: string[] = [];
      for (const typed of c.names) {
        const g: GmGrant = { costume: c.costume, key: host.key() };
        const { outcome, name } = await host.grant(typed, g);
        const result = grantText(outcome, name, grantThing(g));
        lines.push(result);
        rows.push({ command: 'event award', target: target(typed), args: { costume: c.costume, name: typed, event, eventGrant: true }, ok: outcome === 'done', result });
      }
      return { notice: lines.join('; '), rows };
    }
  }
}

/** The process's GM state, made by the app and shared by every room: the limits, the event, announce and order. */
export interface GmProcess {
  limits: GmLimits;
  event: string | null;
  /** `announce` { text, event } to every zone room and instance. */
  announceAll(text: string): void;
  /** Runs one GM's lines one at a time (so its daily gold sum and limits are never raced by its own lines). */
  serial<T>(gmAccount: string, fn: () => Promise<T>): Promise<T>;
  /**
   * Whether a refused ('denied') row may be written for the account now (wall ms): at most one per account a UTC
   * day, and at most DENIED_PER_MIN for the process a minute, so nobody can flood the append-only log.
   */
  deniedRow(accountId: string, now: number): boolean;
}

/** Refused rows from accounts that are not GMs, for the whole process, a minute at most. */
export const DENIED_PER_MIN = 60;

/** The verb of a /gm line as a refused row keeps it ("/gm grant"; at most 16 characters): never the text. */
export function gmVerb(text: string): string {
  return `/gm ${(text.slice(3).trim().split(/\s+/)[0] ?? '').replace(/[^A-Za-z]/g, '')}`.trim().slice(0, 16);
}

/** A GmProcess over the rooms `each` lists (the app's zone rooms and instances). */
export function gmProcess(each: () => Iterable<{ announce(m: { text: string; event: string | null }): void }>): GmProcess {
  const tails = new Map<string, Promise<unknown>>();
  let deniedDay = '';
  const deniedToday = new Set<string>();
  let deniedTimes: number[] = [];
  const p: GmProcess = {
    deniedRow(accountId, now) {
      const day = utcDay(now);
      if (day !== deniedDay) { deniedDay = day; deniedToday.clear(); }
      if (deniedToday.has(accountId)) return false;
      deniedTimes = deniedTimes.filter((t) => now - t < 60_000);
      if (deniedTimes.length >= DENIED_PER_MIN) return false;
      deniedToday.add(accountId);
      deniedTimes.push(now);
      return true;
    },
    limits: new GmLimits(),
    event: null,
    announceAll(text) {
      for (const room of each()) room.announce({ text, event: p.event });
    },
    serial(gmAccount, fn) {
      const prev = tails.get(gmAccount) ?? Promise.resolve();
      const next = prev.then(fn, fn);
      const tail = next.catch(() => {}).finally(() => { if (tails.get(gmAccount) === tail) tails.delete(gmAccount); });
      tails.set(gmAccount, tail);
      return next;
    },
  };
  return p;
}

/** Whether a (cleaned) chat line is a /gm line at all. */
export const isGmLine = (text: string): boolean => PREFIX_RE.test(text);
