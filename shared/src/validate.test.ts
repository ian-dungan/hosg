import { describe, expect, it } from 'vitest';
import { validateUsername, validatePassword, cleanChat } from './validate';

describe('validateUsername', () => {
  it('accepts 3-16 letters, digits and underscores', () => {
    expect(validateUsername('Ellie_01')).toBeNull();
    expect(validateUsername('abc')).toBeNull();
    expect(validateUsername('a'.repeat(16))).toBeNull();
  });
  it('rejects bad names with a message', () => {
    expect(validateUsername('ab')).not.toBeNull();
    expect(validateUsername('a'.repeat(17))).not.toBeNull();
    expect(validateUsername('<img src=x>')).not.toBeNull();
    expect(validateUsername('ellie\n')).not.toBeNull();
    expect(validateUsername(42)).not.toBeNull();
    expect(typeof validateUsername(undefined)).toBe('string');
  });
});

describe('validatePassword', () => {
  it('accepts 8-72 characters', () => {
    expect(validatePassword('x'.repeat(8))).toBeNull();
    expect(validatePassword('x'.repeat(72))).toBeNull();
  });
  it('rejects too short, too long and non-strings', () => {
    expect(validatePassword('short')).not.toBeNull();
    expect(validatePassword('x'.repeat(73))).not.toBeNull();
    expect(validatePassword(12345678)).not.toBeNull();
  });
});

describe('cleanChat', () => {
  it('strips control characters and collapses whitespace', () => {
    expect(cleanChat('  hi\u0000\n there ')).toBe('hi there');
    expect(cleanChat('a\u0007b\u007fc\u0085d')).toBe('abcd');
    expect(cleanChat('line1\r\nline2\tend')).toBe('line1 line2 end');
  });
  it('cuts to CHAT_MAX', () => {
    expect(cleanChat('a'.repeat(5000))!.length).toBe(200);
    expect(cleanChat('a'.repeat(199) + ' b')).toBe('a'.repeat(199));
    expect(cleanChat('a'.repeat(199) + '\u{1F600}')).toBe('a'.repeat(199));
  });
  it('returns null for empty or non-string input', () => {
    expect(cleanChat('   ')).toBeNull();
    expect(cleanChat('\u0000\u0001')).toBeNull();
    expect(cleanChat({})).toBeNull();
    expect(cleanChat(undefined)).toBeNull();
  });
});
