// Input checks for names, passwords and chat. Validators return an error message, or null when fine.
import { CHAT_MAX } from './constants';

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

export function validateUsername(s: unknown): string | null {
  if (typeof s !== 'string') return 'Name is required.';
  if (!USERNAME_RE.test(s)) return 'Names are 3 to 16 letters, numbers or underscores.';
  return null;
}

export function validatePassword(s: unknown): string | null {
  if (typeof s !== 'string') return 'Password is required.';
  if (s.length < 8) return 'Passwords need at least 8 characters.';
  if (s.length > 72) return 'Passwords can be at most 72 characters.';
  return null;
}

// C0 controls, DEL and C1 controls, except tab/newline/CR/VT/FF, which count as whitespace.
const CONTROL_RE = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/g;
// Zero-width and bidi format characters (they can hide or reorder text).
const FORMAT_RE = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** Plain, single-line chat text of at most CHAT_MAX characters, or null if nothing is left. */
export function cleanChat(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  let text = s.replace(CONTROL_RE, '').replace(FORMAT_RE, '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
  if (/[\ud800-\udbff]$/.test(text)) text = text.slice(0, -1); // do not cut an emoji in half
  text = text.trimEnd();
  return text === '' ? null : text;
}
