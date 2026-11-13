import { describe, expect, it } from 'vitest';
import { NO_PARTY_TEXT, parseChatLine } from './chatBox';

describe('parseChatLine', () => {
  it('plain lines go to the current channel; blank lines are nothing', () => {
    expect(parseChatLine('  hi all ', 'zone', false)).toEqual({ kind: 'say', text: 'hi all', channel: 'zone' });
    expect(parseChatLine('pull now', 'party', true)).toEqual({ kind: 'say', text: 'pull now', channel: 'party' });
    expect(parseChatLine('   ', 'zone', true)).toBeNull();
  });
  it('/p (and /party) talks to the party from either channel, refused without a party', () => {
    expect(parseChatLine('/p heal me', 'zone', true)).toEqual({ kind: 'say', text: 'heal me', channel: 'party' });
    expect(parseChatLine('/PARTY ok', 'zone', true)).toEqual({ kind: 'say', text: 'ok', channel: 'party' });
    expect(parseChatLine('/p heal me', 'zone', false)).toEqual({ kind: 'error', text: NO_PARTY_TEXT });
    expect(parseChatLine('/p', 'zone', true)).toBeNull();
    // the party channel left on after the party ends
    expect(parseChatLine('hello', 'party', false)).toEqual({ kind: 'error', text: NO_PARTY_TEXT });
  });
  it('/z talks to the zone from the party channel; /invite Name invites by name', () => {
    expect(parseChatLine('/z hello <b>x</b>', 'party', true)).toEqual({ kind: 'say', text: 'hello <b>x</b>', channel: 'zone' });
    expect(parseChatLine('/invite Ellie_01', 'zone', false)).toEqual({ kind: 'invite', name: 'Ellie_01' });
    expect(parseChatLine('/invite', 'zone', false)?.kind).toBe('error');
    expect(parseChatLine('/dance', 'zone', false)?.kind).toBe('error');
  });
});
