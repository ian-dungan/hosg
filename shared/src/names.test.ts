// Adventurer names and the bad-word filter. Failures name a list entry by its index, never by the
// word itself, so the blocklist is not printed into test output.
import { describe, expect, it } from 'vitest';
import { BAD_WORDS } from './badwords';
import { isOffensive, validateAdventurerName } from './names';
import { validateUsername } from './validate';

const NOT_ALLOWED = 'That name is not allowed';
const LETTERS_ONLY = 'Names can only use letters, with single spaces, hyphens or apostrophes between them';

const LOOK_ALIKES: Record<string, string> = { o: '0', i: '1', e: '3', a: '4', s: '5', t: '7' };
const capitalise = (w: string) => w[0]!.toUpperCase() + w.slice(1);

/** The indexes of entries for which `check` is false (an empty list means every entry passed). */
function failing(check: (word: string) => boolean): number[] {
  return BAD_WORDS.flatMap((w, i) => (check(w) ? [] : [i]));
}

describe('validateAdventurerName', () => {
  it('accepts plain names, and single spaces, hyphens or apostrophes between letters', () => {
    expect(validateAdventurerName('Elowen')).toBeNull();
    expect(validateAdventurerName("Mary-Ann O'Neil")).toBeNull();
    expect(validateAdventurerName('Rook')).toBeNull();
    expect(validateAdventurerName('Ash of Elm')).toBeNull();
  });

  it('wants 3 to 16 characters', () => {
    expect(validateAdventurerName('Al')).toBe('Names are 3 to 16 letters');
    expect(validateAdventurerName('A'.repeat(17))).toBe('Names are 3 to 16 letters');
    expect(validateAdventurerName('A'.repeat(16))).toBeNull();
  });

  it('wants letters only, with separators between letters', () => {
    expect(validateAdventurerName('Dr4gon')).toBe(LETTERS_ONLY);
    expect(validateAdventurerName(' Rook')).not.toBeNull();
    expect(validateAdventurerName('Rook ')).not.toBeNull();
    expect(validateAdventurerName('Ro  ok')).not.toBeNull();
    expect(validateAdventurerName('Ro--ok')).not.toBeNull();
    expect(validateAdventurerName("Ro'-ok")).not.toBeNull();
    expect(validateAdventurerName('-Rook')).not.toBeNull();
    expect(validateAdventurerName('<b>Rook</b>')).not.toBeNull();
    expect(validateAdventurerName('Élodie')).not.toBeNull();
    expect(validateAdventurerName('Ro​ok')).not.toBeNull();
    expect(validateAdventurerName(42)).not.toBeNull();
    expect(validateAdventurerName(undefined)).not.toBeNull();
  });

  it('refuses reserved names with the same message as offensive ones', () => {
    for (const n of ['Felix', 'ELLIE', 'Admin', 'Game Master', 'Guestling']) expect(validateAdventurerName(n)).toBe(NOT_ALLOWED);
    for (const n of ['Administrator', 'Mod', 'Moderator', 'Staff', 'System', 'Server', 'Shady Grove', 'Guest', 'Ad-min']) {
      expect(validateAdventurerName(n), n).toBe(NOT_ALLOWED);
    }
    expect(validateUsername('GM')).not.toBeNull(); // too short anyway
    expect(validateUsername('G_M')).toBe(NOT_ALLOWED);
  });

  it('lets innocent names through, including ones that contain a blocked word', () => {
    expect(validateAdventurerName('Cassandra')).toBeNull();
    expect(validateAdventurerName('Dickens')).toBeNull();
    expect(validateAdventurerName('Scunthorpe')).toBeNull();
    expect(validateAdventurerName('Essex')).toBeNull();
    const innocent = [
      'Thomas', 'Lucas', 'Douglas', 'Nicholas', 'Silas', 'Elias', 'Jonas', 'Atlas', 'Hannah', 'Michelle', 'Shelley',
      'Hello', 'Georgina', 'Peacock', 'Hancock', 'Swanky', 'Therapist', 'Grape', 'Raccoon', 'Pakistan', 'Spicer',
      'Janus', 'Canal', 'Torpedo', 'Homer', 'Cumberland', 'Cucumber', 'Pistachio', 'Parsec', 'Arsenal', 'Bobbie',
      'Titus', 'Titan', 'Pimpernel', 'Thorny', 'Rowan', 'Elowen', 'Ash', 'Briar', 'Wren', 'Sage', 'Hazel', 'Juniper',
      'Thistle', 'Bramble', 'Willow', 'Aldric', 'Cedric', 'Mabel', 'Ophelia', 'Penelope', 'Sebastian', 'Matilda',
    ];
    for (const n of innocent) expect(validateAdventurerName(n), n).toBeNull();
  });

  it('refuses every listed word: as-is, capitalised, spaced out with hyphens, and with letters doubled', () => {
    const named = BAD_WORDS.filter((w) => w.length >= 3 && w.length <= 16);
    expect(named.length).toBeGreaterThan(100);
    const refused = (name: string) => validateAdventurerName(name) === (name.length <= 16 ? NOT_ALLOWED : 'Names are 3 to 16 letters');
    const skip = (w: string) => w.length < 3 || w.length > 16;
    expect(failing((w) => skip(w) || refused(w))).toEqual([]);
    expect(failing((w) => skip(w) || refused(capitalise(w)))).toEqual([]);
    expect(failing((w) => skip(w) || refused(w.split('').join('-')))).toEqual([]);
    expect(failing((w) => skip(w) || refused(w.replace(/./g, '$&$&')))).toEqual([]);
    expect(failing((w) => isOffensive(`Sir ${w.toUpperCase()}`))).toEqual([]);
  });
});

describe('isOffensive', () => {
  it('sees through look-alike digits and symbols', () => {
    const sample = BAD_WORDS.filter((_, i) => i % 3 === 0);
    const disguise = (w: string) => w.replace(/[oieast]/g, (c) => LOOK_ALIKES[c]!);
    expect(failing((w) => !sample.includes(w) || isOffensive(disguise(w)))).toEqual([]);
    expect(failing((w) => !sample.includes(w) || isOffensive(w.replace(/a/g, '@').replace(/s/g, '$')))).toEqual([]);
  });

  it('sees through separators, underscores and digits between letters', () => {
    expect(failing((w) => isOffensive(w.split('').join('_')))).toEqual([]);
    expect(failing((w) => isOffensive(w.split('').join(' ')))).toEqual([]);
    expect(failing((w) => isOffensive(w.split('').join("'")))).toEqual([]);
    expect(failing((w) => isOffensive(w.split('').join('8')))).toEqual([]);
  });

  it('is false for ordinary words', () => {
    expect(isOffensive('Elowen')).toBe(false);
    expect(isOffensive('Mary-Ann')).toBe(false);
  });
});

describe('BAD_WORDS', () => {
  it('holds normalised entries: lower-case letters, no letter repeated in a row, no duplicates', () => {
    expect(failing((w) => /^[a-z]+$/.test(w) && !/(.)\1/.test(w))).toEqual([]);
    expect(new Set(BAD_WORDS).size).toBe(BAD_WORDS.length);
  });
});

describe('validateUsername', () => {
  it('refuses offensive and reserved usernames', () => {
    const word = BAD_WORDS.find((w) => w.length >= 4 && w.length <= 12)!;
    expect(validateUsername(word)).toBe(NOT_ALLOWED);
    expect(validateUsername(`x_${word}_1`)).toBe(NOT_ALLOWED);
    for (const n of ['admin', 'Felix', 'GameMaster', 'Guest_7', 'guestling']) expect(validateUsername(n)).toBe(NOT_ALLOWED);
    expect(validateUsername('Rowan_01')).toBeNull();
  });
});
