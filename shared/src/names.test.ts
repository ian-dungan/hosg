// Adventurer names and the bad-word filter. Failures name a list entry by its index, never by the
// word itself, so the blocklist is not printed into test output.
import { describe, expect, it } from 'vitest';
import { BAD_WORDS, SHORT_BAD_WORDS } from './badwords';
import { ALLOWED_WORDS, isOffensive, validateAdventurerName } from './names';
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

describe('allowed words', () => {
  it('exempt only a whole word of the name: the rest of the name is still checked', () => {
    expect(validateAdventurerName('Sir Essex')).toBeNull();
    expect(validateAdventurerName('Dickens Rowe')).toBeNull();
    const word = BAD_WORDS.find((w) => w.length >= 4 && w.length <= 6)!;
    expect(validateAdventurerName(`Essex ${capitalise(word)}`)).toBe(NOT_ALLOWED);
    expect(validateAdventurerName(`${capitalise(word)}-Dickens`)).toBe(NOT_ALLOWED);
  });

  it('give no cover when split at any point with a space or a hyphen', () => {
    const blocked = BAD_WORDS.map((w) => w.replace(/(.)\1+/g, '$1'));
    const failures: string[] = [];
    ALLOWED_WORDS.forEach((allowed, i) => {
      const plain = allowed.replace(/(.)\1+/g, '$1');
      if (!blocked.some((w) => plain.includes(w))) return; // nothing to expose
      for (let at = 1; at < allowed.length; at++) {
        for (const sep of [' ', '-']) {
          const name = capitalise(allowed.slice(0, at)) + sep + allowed.slice(at);
          // "W essex" only shows another allowed word, not a blocked one.
          if (ALLOWED_WORDS.includes(allowed.slice(0, at)) || ALLOWED_WORDS.includes(allowed.slice(at))) continue;
          if (!isOffensive(name) || validateAdventurerName(name) === null) failures.push(`#${i} at ${at} '${sep}'`);
        }
      }
    });
    expect(failures).toEqual([]);
  });
});

describe('entries across word boundaries', () => {
  const SEPS = [' ', '-', "'", '_'];
  const collapse = (w: string) => w.replace(/(.)\1+/g, '$1');

  it('finds a blocked entry that runs out of an allowed word into its neighbour, either way round', () => {
    const failures: string[] = [];
    BAD_WORDS.forEach((entry, bi) => {
      ALLOWED_WORDS.forEach((allowed, ai) => {
        const plain = collapse(allowed);
        for (let k = 1; k < entry.length; k++) {
          const head = entry.slice(0, k);
          const tail = entry.slice(k);
          for (const sep of SEPS) {
            if (plain.endsWith(head) && !isOffensive(capitalise(allowed) + sep + tail)) failures.push(`#${bi} at ${k} after allowed #${ai} '${sep}'`);
            if (plain.startsWith(tail) && !isOffensive(capitalise(head) + sep + allowed)) failures.push(`#${bi} at ${k} before allowed #${ai} '${sep}'`);
          }
        }
      });
    });
    expect(failures).toEqual([]);
  });

  it('finds a short word split across neighbouring words, alone or after another word', () => {
    const failures: string[] = [];
    SHORT_BAD_WORDS.forEach((word, i) => {
      for (let k = 1; k < word.length; k++) {
        for (const sep of SEPS) {
          const split = capitalise(word.slice(0, k)) + sep + word.slice(k);
          for (const [label, name] of [['alone', split], ['after', `Rook ${split}`], ['plural', `${split}s`]]) {
            if (!isOffensive(name!)) failures.push(`#${i} at ${k} '${sep}' ${label}`);
          }
        }
      }
    });
    expect(failures).toEqual([]);
  });

  it('still lets innocent names of several words, and allowed words next to innocent ones, through', () => {
    const innocent = [
      'Mary Ann', 'Jo Ann Lee', 'Al Capone', 'Van Der Berg', 'De La Cruz', "Mary-Ann O'Neil", 'Ash of Elm',
      'Rook the Bold', 'Le Fay', 'Mac Tavish', 'Da Silva', 'Di Maggio', 'El Cid', 'Bo Peep', 'Tom Thumb', 'Ann Marie',
      'Sue Ellen', 'Kit Fox', 'Pip Ash', 'Tam Lin', 'Cass Moon', 'Jo March', 'Ty Rowan', 'Li Wei', 'Ma Ra', 'Abe Lin',
      'Ada Lovelace', 'Ivy Rose', 'Ora Lee', 'Bea Thorn', 'Dot Cotton', 'Kay Wren', 'Una Brook', 'Wil Wheaton',
      'Rook Essex', 'Essex Rook', 'Sir Hancock', 'Hancock the Bold', 'Peacock Wren', 'Dickens Rowe', 'Lady Sussex',
    ];
    expect(innocent.filter((n) => validateAdventurerName(n) !== null)).toEqual([]);
    expect(ALLOWED_WORDS.filter((w) => w.length <= 16 && validateAdventurerName(capitalise(w)) !== null)).toEqual([]);
  });
});

describe('SHORT_BAD_WORDS', () => {
  const failingShort = (check: (word: string) => boolean) => SHORT_BAD_WORDS.flatMap((w, i) => (check(w) ? [] : [i]));
  const refused = (name: string) => name.length > 16 || validateAdventurerName(name) === NOT_ALLOWED;

  it('refuses each as a word of its own: alone, capitalised, plural, stretched, and inside a longer name', () => {
    expect(failingShort((w) => /^[a-z]+$/.test(w))).toEqual([]);
    expect(failingShort((w) => refused(w.padEnd(3, w.at(-1)!)))).toEqual([]);
    expect(failingShort((w) => refused(capitalise(w) + 's'))).toEqual([]);
    expect(failingShort((w) => refused(w.replace(/./g, '$&$&')))).toEqual([]);
    expect(failingShort((w) => refused(`Sir ${capitalise(w)}`))).toEqual([]);
    expect(failingShort((w) => refused(`${capitalise(w)}-Rook`))).toEqual([]);
    expect(failingShort((w) => refused(`Rook o'${w}`))).toEqual([]);
    expect(failingShort((w) => isOffensive(`big_${w}_1`))).toEqual([]);
  });

  it('lets longer innocent names that contain those letters through', () => {
    const innocent = [
      'Thomas', 'Lucas', 'Cassius', 'Grape', 'Raccoon', 'Pakistan', 'Spicer', 'Janus', 'Canal', 'Cucumber', 'Titus',
      'Titania', 'Georgy', 'Basement', 'Pimpernel', 'Japan', 'Nigel', 'Bumble', 'Saturday', 'Damned Rook', 'Crapaud',
      'Hoel', 'Poofle', 'Slagle', 'Wogan', 'Knobel', 'Tardis', 'Thoth', 'Pubert', 'Analise', 'Arsenal', 'Boobook',
    ];
    const blocked = innocent.filter((n) => validateAdventurerName(n) !== null);
    expect(blocked).toEqual([]);
  });
});

describe('reserved words', () => {
  it('refuses a staff word anywhere in the name as a word of its own', () => {
    const names = [
      'Admin Rook', 'Rook the Admin', 'Administrator Jo', 'GM Rook', 'Rook-GM', 'Gamemaster Jo', 'Game Master Jo',
      'Rook Game-Master', 'Moderator Jo', 'Mod Rook', "Rook o'Mod", 'Staff Rook', 'System Rook', 'Server Rook',
    ];
    names.push('A-d-m-i-n', 'Ga Me Master', 'Admins', 'Mods', 'GMs', 'Moderators', 'Staffs', 'Sys Tem Rook');
    for (const n of names) expect(validateAdventurerName(n), n).toBe(NOT_ALLOWED);
    expect(validateUsername('admin_rook')).toBe(NOT_ALLOWED);
  });

  it('refuses the heroes and the game only as the whole name', () => {
    for (const n of ['Felix', 'Ellie', 'Shady Grove', 'Shadygrove']) expect(validateAdventurerName(n), n).toBe(NOT_ALLOWED);
    for (const n of ['Felix Stone', 'Ellie Rose', 'Shady Glen', 'Modesty', 'Systema', 'Staffordshire', 'Adminah']) {
      expect(validateAdventurerName(n), n).toBeNull();
    }
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
