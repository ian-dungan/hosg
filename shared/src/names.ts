// Adventurer names: what a player may call their adventurer, and the bad-word filter behind it.
import { BAD_WORDS } from './badwords';

const LENGTH = 'Names are 3 to 16 letters';
const LETTERS = 'Names can only use letters, with single spaces, hyphens or apostrophes between them';
/** One message for offensive and reserved names alike (usernames too), so the filter is not a guessing game. */
export const NAME_NOT_ALLOWED = 'That name is not allowed';

/** Letters, with single spaces, hyphens or apostrophes between them (never leading, trailing or doubled). */
const NAME_RE = /^[A-Za-z]+(?:[ '-][A-Za-z]+)*$/;

/** Names only the game itself uses (compared in normalised form). Anything starting with "guest" is reserved too. */
export const RESERVED_NAMES: readonly string[] = [
  'admin', 'administrator', 'gm', 'gamemaster', 'moderator', 'mod', 'staff', 'system', 'server', 'ellie', 'felix',
  'shadygrove',
];

/** Innocent words that contain a blocked one; a name that is exactly one of these (in normalised form) is fine. */
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

/** The lists in normalised form, made on first use (so bundles that never check a name can drop them). */
let normalised: { blocked: string[]; allowed: Set<string>; reserved: Set<string> } | undefined;
const lists = () =>
  (normalised ??= {
    blocked: BAD_WORDS.map(collapse),
    allowed: new Set(ALLOWED_WORDS.map(normalise)),
    reserved: new Set(RESERVED_NAMES.map(normalise)),
  });

/** Whether `s` contains a blocked word, ignoring case, separators, look-alike characters and repeated letters. */
export function isOffensive(s: string): boolean {
  const { blocked, allowed } = lists();
  const plain = normalise(s);
  if (allowed.has(plain)) return false;
  const loose = normaliseDigitsAsSeparators(s);
  return blocked.some((word) => plain.includes(word) || loose.includes(word));
}

/** Whether `s` is a name only the game itself uses. */
export function isReserved(s: string): boolean {
  const plain = normalise(s);
  return lists().reserved.has(plain) || plain.startsWith('guest');
}

/** An error message for a name a player chose for their adventurer, or null when it is fine. */
export function validateAdventurerName(s: unknown): string | null {
  if (typeof s !== 'string' || s.length < 3 || s.length > 16) return LENGTH;
  if (!NAME_RE.test(s)) return LETTERS;
  if (isOffensive(s) || isReserved(s)) return NAME_NOT_ALLOWED;
  return null;
}
