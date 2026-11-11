// Adventurer names: what a player may call their adventurer, and the bad-word filter behind it.
import { BAD_WORDS, SHORT_BAD_WORDS } from './badwords';

const LENGTH = 'Names are 3 to 16 letters';
const LETTERS = 'Names can only use letters, with single spaces, hyphens or apostrophes between them';
/** One message for offensive and reserved names alike (usernames too), so the filter is not a guessing game. */
export const NAME_NOT_ALLOWED = 'That name is not allowed';

/** Letters, with single spaces, hyphens or apostrophes between them (never leading, trailing or doubled). */
const NAME_RE = /^[A-Za-z]+(?:[ '-][A-Za-z]+)*$/;

/**
 * Staff names: refused when one is a word of the name ("Admin Rook", "Game Master Ash"), as are names
 * that start with "guest". Compared in normalised form.
 */
export const RESERVED_WORDS: readonly string[] = [
  'admin', 'administrator', 'gm', 'gamemaster', 'moderator', 'mod', 'staff', 'system', 'server',
];

/** The game's heroes and the game itself: refused only as the whole name ("Felix Stone" is fine). */
export const RESERVED_NAMES: readonly string[] = ['ellie', 'felix', 'shadygrove'];

/**
 * Innocent words that contain a blocked one. A word of a name (between separators) that is exactly one
 * of these (ignoring case) is not searched; the rest of the name still is.
 */
export const ALLOWED_WORDS: readonly string[] = [
  'scunthorpe', 'penistone', 'clitheroe', 'essex', 'sussex', 'wessex', 'middlesex', 'sexton', 'cassandra',
  'dickens', 'dickinson', 'dickson', 'hancock', 'peacock', 'woodcock', 'babcock', 'hitchcock', 'cockatoo',
  'cockatiel', 'cocktail', 'ashkenazi', 'montenegro', 'negroni', 'nigeria', 'nigerian', 'therapist', 'shiitake',
  'matsushita',
];

const LOOK_ALIKES: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

/** Repeated letters written once: "fuuuck" -> "fuck". */
const collapse = (s: string) => s.replace(/(.)\1+/g, '$1');

/** Lower case, look-alikes mapped to letters, everything else that is not a letter dropped, repeats collapsed. */
function normalise(s: string): string {
  return collapse(s.toLowerCase().replace(/[0-9@$]/g, (c) => LOOK_ALIKES[c] ?? '').replace(/[^a-z]/g, ''));
}

/** Separators between the words of a name or username. */
const SEPARATORS = /[\s'_-]+/;

/** Lower case with look-alikes mapped to letters and everything else dropped; repeats are kept. */
const letters = (s: string) => s.toLowerCase().replace(/[0-9@$]/g, (c) => LOOK_ALIKES[c] ?? '').replace(/[^a-z]/g, '');

/** "ass" -> /^a+s{2,}(?:e?s)?$/: the word with any letter repeated more, and an optional plural. */
function shortWordPattern(word: string): RegExp {
  const runs = word.match(/(.)\1*/g)!.map((run) => (run.length === 1 ? `${run[0]}+` : `${run[0]}{${run.length},}`));
  return new RegExp(`^${runs.join('')}(?:e?s)?$`);
}

/** The lists in normalised form, made on first use (so bundles that never check a name can drop them). */
let normalised:
  | { blocked: string[]; short: RegExp[]; allowed: Set<string>; reservedWords: Set<string>; reservedNames: Set<string> }
  | undefined;
const lists = () =>
  (normalised ??= {
    blocked: BAD_WORDS.map(collapse),
    short: SHORT_BAD_WORDS.map(shortWordPattern),
    allowed: new Set(ALLOWED_WORDS),
    reservedWords: new Set(RESERVED_WORDS.map(normalise)),
    reservedNames: new Set(RESERVED_NAMES.map(normalise)),
  });

/** The words of `s` (split at separators), empty ones dropped. */
const wordsOf = (s: string) => s.split(SEPARATORS).filter((w) => w !== '');

/** Lower case, @ and $ mapped, everything else that is not a letter dropped (digits read as separators); repeats kept. */
const looseLetters = (s: string) => s.toLowerCase().replace(/[@$]/g, (c) => LOOK_ALIKES[c]!).replace(/[^a-z]/g, '');

/**
 * Whether one reading of the name (each word turned into letters by `read`) holds a blocked entry
 * anywhere in its joined, repeat-collapsed letters, except where a match lies entirely inside one
 * exempt (allowed) word: "Dickens" is fine, but an entry that runs out of an allowed word into its
 * neighbour ("…cock Sucker"-style) is still found.
 */
function holdsBlocked(words: string[], exempt: boolean[], read: (w: string) => string, blocked: string[]): boolean {
  // The joined letters, collapsed to runs of one letter, each run remembering where it lies in the raw letters.
  const runs: { ch: string; start: number; end: number }[] = [];
  const exemptRanges: [number, number][] = [];
  let at = 0;
  words.forEach((word, i) => {
    const raw = read(word);
    if (exempt[i]) exemptRanges.push([at, at + raw.length]);
    for (const ch of raw) {
      const last = runs.at(-1);
      if (last && last.ch === ch) last.end = at + 1;
      else runs.push({ ch, start: at, end: at + 1 });
      at++;
    }
  });
  const text = runs.map((r) => r.ch).join('');
  return blocked.some((entry) => {
    for (let i = text.indexOf(entry); i !== -1; i = text.indexOf(entry, i + 1)) {
      // The narrowest raw letters the match needs: a run of one letter can cross a word join ("Kay"
      // after "…k"), and either end of it will do, so a match inside an allowed word stays excused.
      const from = runs[i]!.end - 1;
      const to = runs[i + entry.length - 1]!.start + 1;
      if (!exemptRanges.some(([a, b]) => a <= from && to <= b)) return true;
    }
    return false;
  });
}

/**
 * Whether `s` holds a blocked word, ignoring case, separators, look-alike characters and repeated
 * letters. Long entries are searched for across the whole name, words joined ("f-u-c-k" is caught),
 * except inside a word that is exactly an allowed one ("Dickens"). Short entries must be a whole word,
 * or a run of neighbouring words joined ("A ss"), so they never match inside a longer word (Thomas).
 */
export function isOffensive(s: string): boolean {
  const { blocked, short, allowed } = lists();
  const words = wordsOf(s);
  const exempt = words.map((w) => allowed.has(letters(w)));
  if (holdsBlocked(words, exempt, letters, blocked) || holdsBlocked(words, exempt, looseLetters, blocked)) return true;
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j <= words.length; j++) {
      const run = words.slice(i, j);
      if (run.length === 1 && exempt[i]) continue;
      const forms = [run.map(letters).join(''), run.map(looseLetters).join('')];
      if (short.some((pattern) => forms.some((form) => pattern.test(form)))) return true;
    }
  }
  return false;
}

/** Whether `s` is a name only the game itself uses, or has a staff word as a word (or run of words) of its own. */
export function isReserved(s: string): boolean {
  const { reservedWords, reservedNames } = lists();
  const plain = normalise(s);
  if (reservedNames.has(plain) || plain.startsWith('guest')) return true;
  // Each word, and each run of neighbouring words joined ("Game Master", "A-d-m-i-n"), also as a plural.
  const words = wordsOf(s).map(letters);
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j <= words.length; j++) {
      const joined = collapse(words.slice(i, j).join(''));
      if (reservedWords.has(joined) || reservedWords.has(joined.replace(/s$/, ''))) return true;
    }
  }
  return false;
}

/** An error message for a name a player chose for their adventurer, or null when it is fine. */
export function validateAdventurerName(s: unknown): string | null {
  if (typeof s !== 'string' || s.length < 3 || s.length > 16) return LENGTH;
  if (!NAME_RE.test(s)) return LETTERS;
  if (isOffensive(s) || isReserved(s)) return NAME_NOT_ALLOWED;
  return null;
}
