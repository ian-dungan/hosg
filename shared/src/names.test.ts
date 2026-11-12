// Adventurer names and the bad-word filter. Failures name a list entry by its index, never by the
// word itself, so the blocklist is not printed into test output. The words come from the ROT13 fixture.
import { describe, expect, it } from 'vitest';
import { LONG_FIXTURE, SHORT_FIXTURE, rot13 } from './names.fixture';
import { ALLOWED_WORDS, isOffensive, validateAdventurerName } from './names';
import { validateUsername } from './validate';

/** The blocklist, decoded from the ROT13 fixture in memory (badwords.ts ships hashes only). */
const BAD_WORDS = LONG_FIXTURE.map(rot13);
const SHORT_BAD_WORDS = SHORT_FIXTURE.map(rot13);

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

  it('lets an allowed word share its first or last letter with a neighbouring name', () => {
    const NAMES = [
      'Les', 'Gus', 'Ross', 'Pip', 'Marc', 'Rose', 'Jane', 'Drew', 'Tom', 'Sam', 'Ed', 'Ted', 'Seth', 'Beth', 'Rob',
      'Bob', 'Ida', 'Ana', 'Ann', 'Wren', 'Kit', 'Pat', 'Eve', 'Xander', 'Xia', 'Ned', 'Nell', 'Ada', 'Sue', 'Kay',
      'Otto', 'Oak', 'Ode', 'Lee', 'Liz', 'Ivy', 'Ira', 'Ty', 'Max', 'Mia', 'Cal', 'Dot', 'Hal', 'Wil', 'Ben', 'Nan',
      'Tess', 'Abe', 'Will', 'Zed',
    ];
    const blocked = BAD_WORDS.map(collapse);
    const count = (text: string, entry: string) => {
      let n = 0;
      for (let i = text.indexOf(entry); i !== -1; i = text.indexOf(entry, i + 1)) n++;
      return n;
    };
    // The pair really forms an entry across the join when the joined letters hold more of it than the two words do.
    const formsEntry = (left: string, right: string) => {
      const [l, r, both] = [collapse(left.toLowerCase()), collapse(right.toLowerCase()), collapse((left + right).toLowerCase())];
      return blocked.some((b) => count(both, b) > count(l, b) + count(r, b));
    };
    const failures: string[] = [];
    let pairs = 0;
    ALLOWED_WORDS.forEach((allowed, ai) => {
      const after = NAMES.filter((n) => n[0]!.toLowerCase() === allowed.at(-1));
      const before = NAMES.filter((n) => n.at(-1) === allowed[0]);
      if (after.length === 0 || before.length === 0) failures.push(`allowed #${ai}: no neighbour names to test`);
      for (const sep of [' ', '-']) {
        for (const n of after) {
          pairs++;
          const name = capitalise(allowed) + sep + n;
          if (isOffensive(name) !== formsEntry(allowed, n)) failures.push(`allowed #${ai} then ${n} '${sep}'`);
        }
        for (const n of before) {
          pairs++;
          const name = n + sep + capitalise(allowed);
          if (isOffensive(name) !== formsEntry(n, allowed)) failures.push(`${n} then allowed #${ai} '${sep}'`);
        }
      }
    });
    expect(pairs).toBeGreaterThan(100);
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

describe('the hashed blocklist', () => {
  it('badwords.ts holds no fixture word in plain text', async () => {
    // shared/ has no Node typings: a string-typed specifier keeps tsc out of node:fs
    const fs: { readFileSync(p: string, enc: 'utf8'): string } = await import('node:fs' as string);
    const here = expect.getState().testPath!.replace(/[^/\\]+$/, '');
    const src = fs.readFileSync(here + 'badwords.ts', 'utf8').toLowerCase();
    expect(src.includes('bad_word_hashes')).toBe(true); // never print the source: it is compared, not shown
    const entries = [...BAD_WORDS, ...SHORT_BAD_WORDS];
    const found = entries.flatMap((w, i) => (w.length >= 3 && src.includes(w) ? [i] : []));
    expect(found).toEqual([]);
  });

  it('built bundles (client/dist, client/dist-online, server/dist, when built since badwords.ts) hold no entry as a string', async () => {
    // shared/ has no Node typings: a string-typed specifier keeps tsc out of node:fs
    const fs: {
      readFileSync(p: string, enc: 'utf8'): string;
      existsSync(p: string): boolean;
      readdirSync(p: string): string[];
      statSync(p: string): { isDirectory(): boolean; mtimeMs: number };
    } = await import('node:fs' as string);
    const here = expect.getState().testPath!.replace(/[^/\\]+$/, '');
    const since = fs.statSync(here + 'badwords.ts').mtimeMs;
    const files = (d: string): string[] =>
      fs.readdirSync(d).flatMap((f) => (fs.statSync(d + '/' + f).isDirectory() ? files(d + '/' + f) : /\.(m?js|html)$/.test(f) ? [d + '/' + f] : []));
    // Entries (and, by chance, ROT13 forms) can sit inside innocent words or minified names, so only a quoted
    // string counts: a shipped list, plain or the fixture, would be a run of quoted entries.
    const quoted = (t: string, w: string) => [`'${w}'`, `"${w}"`, `\`${w}\``].some((q) => t.includes(q));
    let scanned = 0;
    for (const dir of ['../../client/dist', '../../client/dist-online', '../../server/dist']) {
      if (!fs.existsSync(here + dir)) continue;
      const list = files(here + dir);
      if (list.length === 0 || list.some((f) => fs.statSync(f).mtimeMs < since)) continue; // not built, or built before the blocklist changed
      const text = list.map((f) => fs.readFileSync(f, 'utf8')).join('\n').toLowerCase();
      scanned++;
      expect([...BAD_WORDS, ...SHORT_BAD_WORDS].flatMap((w, i) => (quoted(text, w) ? [i] : [])), dir).toEqual([]);
      expect([...LONG_FIXTURE, ...SHORT_FIXTURE].flatMap((w, i) => (quoted(text, w) ? [i] : [])), dir).toEqual([]);
    }
    expect(scanned).toBeGreaterThanOrEqual(0); // none when nothing is built
  });

  it('the hashed filter refuses exactly what the plain filter refused', () => {
    const plain = plainIsOffensive(BAD_WORDS, SHORT_BAD_WORDS);
    const LEET: Record<string, string> = { o: '0', i: '1', e: '3', a: '4', s: '5', t: '7' };
    const variants = (w: string) => [
      w, capitalise(w), w.toUpperCase(), `${capitalise(w)}s`, `${capitalise(w)}es`, w.split('').join('-'), w.split('').join(' '),
      w.replace(/./g, '$&$&'), w.replace(/[oieast]/g, (c) => LEET[c]!), w.replace(/a/g, '@').replace(/s/g, '$'),
      `Sir ${capitalise(w)}`, `${capitalise(w)}-Rook`, `Essex ${w}`, `${w} Dickens`, w.slice(0, -1), w.slice(1),
      `${w.slice(0, 2)} ${w.slice(2)}`, `big_${w}_1`,
    ];
    // Seeded pseudo-names from syllables, so the two filters are also compared on names nobody chose.
    let seed = 12345;
    const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
    const SYL = ['ba', 'ash', 'el', 'wen', 'ro', 'ok', 'mar', 'is', 'th', 'or', 'ne', 'li', 'ka', 'us', 'an', 'sh', 'it', 'co', 'ck', 'di', 'pu', 'ss', 'fa', 'gg', 'ni', 'cu', 'nt', 'ta', 'es', 'ho'];
    const random = Array.from({ length: 4000 }, () => {
      const n = 1 + Math.floor(next() * 4);
      const word = () => capitalise(Array.from({ length: n }, () => SYL[Math.floor(next() * SYL.length)]).join(''));
      return next() < 0.3 ? `${word()} ${word()}` : word();
    });
    const innocent = [
      'Elowen', 'Thomas', 'Cassandra', 'Scunthorpe', 'Penistone', 'Sussex Rook', 'Dickens Rowe', 'Hancock', 'Mary-Ann',
      'Cucumber', 'Pistachio', 'Arsenal', 'Michelle', 'Grape', 'Raccoon', 'Analise', 'Basement', 'Japan', 'Nigel', ...ALLOWED_WORDS,
    ];
    const names = [...BAD_WORDS.flatMap(variants), ...SHORT_BAD_WORDS.flatMap(variants), ...innocent, ...random];
    expect(names.length).toBeGreaterThan(7500);
    const differ = names.flatMap((n, i) => (isOffensive(n) === plain(n) ? [] : [i]));
    expect(differ).toEqual([]);
    // Both outcomes are exercised.
    expect(names.filter((n) => isOffensive(n)).length).toBeGreaterThan(3000);
    expect(names.filter((n) => !isOffensive(n)).length).toBeGreaterThan(1000);
  });

  it('lets a wider list of ordinary names through, the Scunthorpe kind included', () => {
    const ordinary = [
      'Abigail', 'Adrian', 'Agatha', 'Alasdair', 'Alice', 'Amara', 'Ambrose', 'Anastasia', 'Angus', 'Aoife', 'Arthur',
      'Astrid', 'Barnaby', 'Beatrix', 'Bertram', 'Bianca', 'Brigid', 'Caspian', 'Celeste', 'Clement', 'Cordelia', 'Cosmo',
      'Dashiell', 'Delphine', 'Desmond', 'Dorian', 'Edmund', 'Eleanor', 'Emeric', 'Esther', 'Evander', 'Fenella', 'Finnian',
      'Florence', 'Gareth', 'Genevieve', 'Gideon', 'Greta', 'Gwendolyn', 'Harriet', 'Horace', 'Imogen', 'Isolde', 'Ivo',
      'Jasper', 'Josephine', 'Kasimir', 'Lavinia', 'Leopold', 'Lorcan', 'Lucinda', 'Magnus', 'Marigold', 'Maximilian',
      'Mercy', 'Montague', 'Morwenna', 'Nathaniel', 'Niamh', 'Octavia', 'Oswin', 'Percival', 'Philippa', 'Quentin',
      'Rosalind', 'Rufus', 'Saoirse', 'Septimus', 'Sylvia', 'Tabitha', 'Tarquin', 'Theodora', 'Ursula', 'Valentina',
      'Wilhelmina', 'Xavier', 'Yusuf', 'Zenobia', 'Lowen Ashby', 'Tamsin Reed', 'Oren Vale', 'Kit Marlowe', 'Rook Hadley',
      'Sussex', 'Middlesex', 'Penistone', 'Clitheroe', 'Scunthorpe', 'Cockatiel', 'Shiitake', 'Matsushita', 'Montenegro',
    ];
    expect(ordinary.filter((n) => validateAdventurerName(n) !== null)).toEqual([]);
  });
});

/** A test-local copy of the plain-list filter that names.ts used before the hashes (its behaviour is the contract). */
function plainIsOffensive(BAD: readonly string[], SHORT: readonly string[]): (s: string) => boolean {
  const LOOKS: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };
  const collapse = (s: string) => s.replace(/(.)\1+/g, '$1');
  const SEPARATORS = /[\s'_-]+/;
  const letters = (s: string) => s.toLowerCase().replace(/[0-9@$]/g, (c) => LOOKS[c] ?? '').replace(/[^a-z]/g, '');
  const looseLetters = (s: string) => s.toLowerCase().replace(/[@$]/g, (c) => LOOKS[c]!).replace(/[^a-z]/g, '');
  const shortWordPattern = (word: string) => {
    const runs = word.match(/(.)\1*/g)!.map((run) => (run.length === 1 ? `${run[0]}+` : `${run[0]}{${run.length},}`));
    return new RegExp(`^${runs.join('')}(?:e?s)?$`);
  };
  const blocked = BAD.map(collapse);
  const short = SHORT.map(shortWordPattern);
  const allowed = new Set(ALLOWED_WORDS);
  const wordsOf = (s: string) => s.split(SEPARATORS).filter((w) => w !== '');
  function holdsBlocked(words: string[], exempt: boolean[], read: (w: string) => string): boolean {
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
        const from = runs[i]!.end - 1;
        const to = runs[i + entry.length - 1]!.start + 1;
        if (!exemptRanges.some(([a, b]) => a <= from && to <= b)) return true;
      }
      return false;
    });
  }
  return (s: string) => {
    const words = wordsOf(s);
    const exempt = words.map((w) => allowed.has(letters(w)));
    if (holdsBlocked(words, exempt, letters) || holdsBlocked(words, exempt, looseLetters)) return true;
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j <= words.length; j++) {
        const run = words.slice(i, j);
        if (run.length === 1 && exempt[i]) continue;
        const forms = [run.map(letters).join(''), run.map(looseLetters).join('')];
        if (short.some((pattern) => forms.some((form) => pattern.test(form)))) return true;
      }
    }
    return false;
  };
}
