// The /gm parser (server only): every command, and every way a line can be wrong, without throwing.
import { describe, expect, it } from 'vitest';
import { GM_AWARD_MAX_NAMES, GM_GOLD_GRANT_MAX, GM_HELP, GmLimits, GM_ANNOUNCE_EVERY_S, GM_PER_MIN, parseGmCommand } from './commands';

describe('parseGmCommand', () => {
  it('parses every command; refuses junk, huge amounts, unknown items and costumes, more than 20 names', () => {
    expect(parseGmCommand('/gm announce The   lamps are lit')).toEqual({ cmd: 'announce', text: 'The lamps are lit' });
    expect(parseGmCommand('/GM Announce hello')).toEqual({ cmd: 'announce', text: 'hello' });
    expect(parseGmCommand('/gm grant gold 500 Old Tom')).toEqual({ cmd: 'grant', what: 'gold', amount: 500, name: 'Old Tom' });
    expect(parseGmCommand('/gm grant gold 10000 "Old Tom"')).toEqual({ cmd: 'grant', what: 'gold', amount: 10000, name: 'Old Tom' });
    expect(parseGmCommand('/gm grant item hedgecutter Wren')).toEqual({ cmd: 'grant', what: 'item', item: 'hedgecutter', name: 'Wren' });
    expect(parseGmCommand('/gm grant costume beacon_halo Guest-004211')).toEqual({ cmd: 'grant', what: 'costume', costume: 'beacon_halo', name: 'Guest-004211' });
    expect(parseGmCommand('/gm tp Wren')).toEqual({ cmd: 'tp', name: 'Wren' });
    expect(parseGmCommand('/gm tp -3.5 12')).toEqual({ cmd: 'tp', x: -3.5, z: 12 });
    expect(parseGmCommand('/gm kick "Old Tom" spamming the plaza')).toEqual({ cmd: 'kick', name: 'Old Tom', reason: 'spamming the plaza' });
    expect(parseGmCommand('/gm kick Wren afk')).toEqual({ cmd: 'kick', name: 'Wren', reason: 'afk' });
    expect(parseGmCommand('/gm event start Lantern Night')).toEqual({ cmd: 'event', op: 'start', title: 'Lantern Night' });
    expect(parseGmCommand('/gm event end')).toEqual({ cmd: 'event', op: 'end' });
    expect(parseGmCommand('/gm event award starfall_regalia Wren "Old Tom" Sorrel')).toEqual({
      cmd: 'event', op: 'award', costume: 'starfall_regalia', names: ['Wren', 'Old Tom', 'Sorrel'],
    });
    expect(parseGmCommand('/gm help')).toEqual({ cmd: 'help' });

    const error = (line: string) => {
      const r = parseGmCommand(line);
      expect(r, line).toHaveProperty('error');
      expect(typeof (r as { error: string }).error).toBe('string');
    };
    for (const line of [
      '/gm', '/gm ', '/gm frobnicate', '/gm announce', '/gm announce    ',
      '/gm grant', '/gm grant gold', '/gm grant gold 100', '/gm grant gold 0 Wren', '/gm grant gold -5 Wren',
      `/gm grant gold ${GM_GOLD_GRANT_MAX + 1} Wren`, '/gm grant gold 1e9 Wren', '/gm grant gold 9999999999999999999999 Wren', '/gm grant gold 1.5 Wren',
      '/gm grant gold NaN Wren', '/gm grant gold Infinity Wren', '/gm grant silver 5 Wren',
      '/gm grant item excalibur Wren', '/gm grant item __proto__ Wren', '/gm grant item constructor Wren', '/gm grant item hedgecutter',
      '/gm grant costume crown_of_ages Wren', '/gm grant costume toString Wren', '/gm grant costume beacon_halo',
      '/gm grant gold 5 <script>', '/gm grant gold 5 Wren;DROP', `/gm grant gold 5 ${'a'.repeat(40)}`,
      '/gm tp', '/gm tp 1', '/gm tp 1 2 3', '/gm tp 99999 0', '/gm tp 1e3 2', '/gm tp NaN 2', '/gm tp "unterminated',
      '/gm kick', '/gm kick Wren', '/gm kick "" afk',
      '/gm event', '/gm event begin x', '/gm event start', '/gm event end now', '/gm event award', '/gm event award beacon_halo',
      '/gm event award nope Wren', `/gm event award beacon_halo ${Array.from({ length: GM_AWARD_MAX_NAMES + 1 }, (_, i) => `N${'a'.repeat(i % 5 + 2)}`).join(' ')}`,
      '/gm role grant Wren', '/gm grant gm Wren', '/gm setgm Wren', '/gm isGm Wren true',
    ]) error(line);
    expect(parseGmCommand(`/gm event award beacon_halo ${Array.from({ length: GM_AWARD_MAX_NAMES }, (_, i) => `Wren${'x'.repeat(i % 3)}`).join(' ')}`)).toHaveProperty('names');
    // never throws, whatever it is given
    for (const junk of [undefined, null, 42, {}, [], { text: '/gm help' }, '/gm \u0000‮ grant', `/gm ${'x'.repeat(5000)}`]) {
      expect(() => parseGmCommand(junk as never)).not.toThrow();
    }
    expect(parseGmCommand(`/gm announce ${'y'.repeat(5000)}`)).toEqual({ cmd: 'announce', text: expect.stringMatching(/^y{1,200}$/) });
  });

  it('returns null for chat that is not /gm', () => {
    for (const line of ['hello', '', '   ', 'gm grant gold 5 Wren', '/gmgrant gold 5 Wren', '/g m help', ' x /gm help', '/party hi', '/gms']) {
      expect(parseGmCommand(line), line).toBeNull();
    }
    expect(parseGmCommand(42 as never)).toBeNull();
    expect(parseGmCommand('  /gm help')).toEqual({ cmd: 'help' }); // cleaned like any chat line first
  });

  it('help names every command (it is sent only to game masters)', () => {
    for (const word of ['announce', 'grant gold', 'grant item', 'grant costume', 'tp', 'kick', 'event start', 'event end', 'event award']) {
      expect(GM_HELP).toContain(word);
    }
  });
});

describe('GmLimits', () => {
  it(`allows ${GM_PER_MIN} commands a minute per game master, and one announce every ${GM_ANNOUNCE_EVERY_S} s for the process`, () => {
    const limits = new GmLimits();
    for (let i = 0; i < GM_PER_MIN; i++) expect(limits.take('a', 1000 + i)).toBe(true);
    expect(limits.take('a', 2000)).toBe(false);
    expect(limits.take('b', 2000)).toBe(true); // per game master
    expect(limits.take('a', 1000 + 60_000)).toBe(true); // the oldest left the window
    expect(limits.announce(0)).toBe(true);
    expect(limits.announce(GM_ANNOUNCE_EVERY_S * 1000 - 1)).toBe(false);
    expect(limits.announce(GM_ANNOUNCE_EVERY_S * 1000)).toBe(true);
  });
});

describe('server only', () => {
  it('no client or shared source imports the GM code or holds its command words', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const files: string[] = [];
    const walk = async (dir: string) => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('dist')) continue;
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) await walk(p);
        else if (/\.(ts|js|mjs|html)$/.test(e.name)) files.push(p);
      }
    };
    for (const d of ['../../../client/src', '../../../shared/src']) await walk(fileURLToPath(new URL(d, import.meta.url)));
    expect(files.length).toBeGreaterThan(50);
    for (const f of files) {
      const text = await readFile(f, 'utf8');
      expect(text, f).not.toMatch(/gm\/commands|gm\/grant|grant gold|event award|GM_HELP/);
    }
  });
});
