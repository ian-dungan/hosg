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

/** Like normalise, but digits are read as separators rather than letters ("f8u8c8k"). */
function normaliseDigitsAsSeparators(s: string): string {
  return collapse(s.toLowerCase().replace(/[@$]/g, (c) => LOOK_ALIKES[c]!).replace(/[^a-z]/g, ''));
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

/**
 * Whether `s` holds a blocked word, ignoring case, separators, look-alike characters and repeated
 * letters. Long entries are searched for across the whole name, words joined ("f-u-c-k" is caught);
 * a word that is exactly an allowed one ("Dickens") is left out of that search, splitting the name
 * there, while "Dick-ens" is searched as a whole. Short entries are matched as whole words only.
 */
export function isOffensive(s: string): boolean {
  const { blocked, short, allowed } = lists();
  const contains = (text: string) => {
    const plain = normalise(text);
    const loose = normaliseDigitsAsSeparators(text);
    return blocked.some((word) => plain.includes(word) || loose.includes(word));
  };
  let run: string[] = [];
  const runs: string[][] = [];
  for (const word of wordsOf(s)) {
    if (allowed.has(letters(word))) {
      runs.push(run);
      run = [];
    } else {
      run.push(word);
    }
  }
  runs.push(run);
  if (runs.some((r) => r.length > 0 && contains(r.join('')))) return true;
  return wordsOf(s).some((word) => {
    if (allowed.has(letters(word))) return false;
    const forms = [letters(word), word.toLowerCase().replace(/[@$]/g, (c) => LOOK_ALIKES[c]!).replace(/[^a-z]/g, '')];
    return short.some((pattern) => forms.some((form) => pattern.test(form)));
  });
}

/** Whether `s` is a name only the game itself uses, or has a staff word as one of its words. */
export function isReserved(s: string): boolean {
  const { reservedWords, reservedNames } = lists();
  const plain = normalise(s);
  if (reservedNames.has(plain) || plain.startsWith('guest')) return true;
  const words = wordsOf(s).map(normalise);
  // Each word, and each pair of neighbours ("Game Master").
  return words.some((w, i) => reservedWords.has(w) || (i > 0 && reservedWords.has(collapse(words[i - 1]! + w))));
}

/** An error message for a name a player chose for their adventurer, or null when it is fine. */
export function validateAdventurerName(s: unknown): string | null {
  if (typeof s !== 'string' || s.length < 3 || s.length > 16) return LENGTH;
  if (!NAME_RE.test(s)) return LETTERS;
  if (isOffensive(s) || isReserved(s)) return NAME_NOT_ALLOWED;
  return null;
}
