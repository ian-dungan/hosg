// Chat: the last lines in a corner, and a line to type in, on two channels: Zone (everyone in this room) and
// Party (every member, in any room). Party lines are teal and tagged "[Party]"; a game master's lines carry a
// GM badge; announcements are gold. Every line is set as text, never as HTML.
// Desktop: Enter opens the line and sends, Escape closes it. Touch: the Chat button opens it. The channel
// toggle (Zone / Party) shows while in a party; `/p text` says something to the party from either channel,
// `/z text` to the zone, `/invite Name` invites by name.
import { CHAT_MAX } from '@sg2/shared';
import { h } from '../hud/dom';

/** Lines kept on screen. */
const MAX_LINES = 50;

export type ChatChannel = 'zone' | 'party';
/** What a typed line asks for. */
export type ChatCommand =
  | { kind: 'say'; text: string; channel: ChatChannel }
  | { kind: 'invite'; name: string }
  | { kind: 'error'; text: string };

/** The line shown when party chat is asked for without a party. */
export const NO_PARTY_TEXT = 'You are not in a party';

/** A typed line: `/p` and `/party` (to the party), `/z` and `/zone` (to the zone), `/invite Name`; else the current channel. */
export function parseChatLine(raw: string, channel: ChatChannel, inParty: boolean): ChatCommand | null {
  const text = raw.trim();
  if (!text) return null;
  const m = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(text);
  if (!m) {
    if (channel === 'party' && !inParty) return { kind: 'error', text: NO_PARTY_TEXT };
    return { kind: 'say', text, channel };
  }
  const cmd = m[1].toLowerCase(), rest = (m[2] ?? '').trim();
  switch (cmd) {
    case 'p': case 'party':
      if (!inParty) return { kind: 'error', text: NO_PARTY_TEXT };
      return rest ? { kind: 'say', text: rest, channel: 'party' } : null;
    case 'z': case 'zone': case 's': case 'say':
      return rest ? { kind: 'say', text: rest, channel: 'zone' } : null;
    case 'invite': case 'inv':
      return rest ? { kind: 'invite', name: rest } : { kind: 'error', text: 'Type a name after /invite' };
    default:
      return { kind: 'error', text: 'Unknown command: try /p, /z or /invite Name' };
  }
}

const CSS = /* css */ `
.sg-chat-log{position:absolute;left:calc(var(--sl) + var(--g));bottom:calc(var(--sb) + var(--g) + 58px);
  width:min(440px,calc(100% - 2 * var(--g)));max-height:min(36vh,230px);overflow:hidden;
  display:flex;flex-direction:column;justify-content:flex-end;gap:2px;font-size:14px;line-height:1.35}
.sg-chat-line{padding:2px 9px;border-radius:8px;background:rgba(16,18,42,.42);align-self:flex-start;max-width:100%;overflow-wrap:anywhere;
  -webkit-user-select:text;user-select:text}
.sg-chat-from{font-weight:700;color:var(--goldl)}
.sg-chat-line.party{background:rgba(20,70,72,.6);box-shadow:inset 3px 0 0 #3FB0A6;color:#d9fbf6}
.sg-chat-line.party .sg-chat-from{color:#7fe0d6}
.sg-chat-tag{font-weight:800;font-size:.86em;color:#7fe0d6;margin-right:4px}
.sg-chat-gm{display:inline-block;margin-right:5px;padding:0 5px;border-radius:5px;font:800 10px/16px var(--sans);color:#3a2508;background:var(--gold2);text-shadow:none;vertical-align:1px}
.sg-chat-line.announce{background:rgba(90,60,10,.6);box-shadow:inset 3px 0 0 #F2B742;color:#fff3c4;font-style:italic}
.sg-chat-line.system{background:rgba(16,18,42,.3);font-style:italic;opacity:.85}
.sg-chat-bar{position:absolute;left:calc(var(--sl) + var(--g));bottom:calc(var(--sb) + var(--g));display:none;gap:8px;
  width:min(500px,calc(100% - 2 * var(--g)));pointer-events:auto}
.sg-chat-open .sg-chat-bar{display:flex}
.sg-chat-chan{display:none;flex:none;min-width:0;min-height:48px;padding:0 12px;font-size:14px}
.sg-chat-party .sg-chat-chan{display:inline-flex}
.sg-chat-chan.party{color:#0f2a28;text-shadow:none;background:linear-gradient(180deg,#9fe8de,#3FB0A6);box-shadow:0 0 0 1px rgba(200,255,250,.6)}
.sg-chat-input{flex:1;min-width:0;min-height:48px;padding:0 14px;border:0;border-radius:12px;outline:none;
  font:500 16px var(--sans);color:var(--cream);background:rgba(16,18,42,.78);box-shadow:inset 0 0 0 2px var(--gold2);
  -webkit-user-select:text;user-select:text}
.sg-chat-input.party{box-shadow:inset 0 0 0 2px #3FB0A6}
.sg-chat-send{min-width:0;min-height:48px;padding:0 16px}
.sg-chat-hint{position:absolute;left:calc(var(--sl) + var(--g));bottom:calc(var(--sb) + var(--g) + 12px);font-size:12px;opacity:.75}
.sg-chat-open .sg-chat-hint{display:none}
.sg-chat-btn{position:absolute;right:calc(var(--sr) + var(--g));top:calc(var(--st) + var(--g) + 58px);min-width:0;min-height:48px;padding:0 18px;
  pointer-events:auto;background:rgba(16,18,42,.55)}
/* touch: the log sits under the name plate, the typing line at the top, clear of the joystick and the keyboard */
.sg-chat-touch .sg-chat-log{bottom:auto;top:calc(var(--st) + var(--g) + var(--tlh,62px) + 14px);max-height:min(26vh,160px);width:min(360px,calc(62% - var(--g)))}
.sg-chat-touch .sg-chat-bar{bottom:auto;top:calc(var(--st) + var(--g));width:calc(100% - 2 * var(--g))}
.sg-chat-touch .sg-chat-hint{display:none}
@media (max-width:700px) and (orientation:portrait){ .sg-chat-touch .sg-chat-log{top:calc(var(--st) + var(--g) + var(--tlh,138px) + 66px + var(--hy,0px));width:min(300px,56%)} }
.sg-chat:not(.sg-chat-touch) .sg-chat-btn,.sg-chat-open .sg-chat-btn{display:none}
.sg-chat:not(.sg-chat-touch) .sg-chat-send{display:none}
`;

function injectStyles(): void {
  if (document.getElementById('sg-net-chat-css')) return;
  const s = document.createElement('style');
  s.id = 'sg-net-chat-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

export interface ChatBox {
  /** A line someone said (channel: where; gm: a game master said it). */
  add(from: string, text: string, channel?: ChatChannel, gm?: boolean): void;
  /** A game master's announcement. */
  announce(text: string): void;
  /** A line from the game itself (a refused command). */
  system(text: string): void;
  /** In a party or not: the channel toggle shows (without a party the channel goes back to Zone). */
  setParty(on: boolean): void;
  readonly channel: ChatChannel;
}

export interface ChatOpts {
  send(text: string, channel: ChatChannel): void;
  invite(name: string): void;
}

export function createChat(root: HTMLElement, opts: ChatOpts): ChatBox {
  injectStyles();
  const touch = matchMedia('(pointer: coarse)').matches;
  const wrap = h('div', 'sg-hud sg-chat' + (touch ? ' sg-chat-touch' : ''), root);
  const log = h('div', 'sg-chat-log', wrap);
  log.setAttribute('aria-live', 'polite');
  const hint = h('div', 'sg-chat-hint', wrap, 'Enter to chat');
  const bar = h('form', 'sg-chat-bar', wrap);
  const chan = h('button', 'sg-btn sg-chat-chan', bar, 'Zone');
  chan.type = 'button';
  const input = h('input', 'sg-chat-input', bar);
  Object.assign(input, { type: 'text', maxLength: CHAT_MAX + 8, autocomplete: 'off', enterKeyHint: 'send' });
  const sendBtn = h('button', 'sg-btn sg-btn-gold sg-chat-send', bar, 'Send');
  sendBtn.type = 'submit';
  const open = h('button', 'sg-btn sg-chat-btn', wrap, 'Chat');
  open.type = 'button';

  let channel: ChatChannel = 'zone';
  let inParty = false;
  const setChannel = (c: ChatChannel) => {
    channel = c;
    chan.textContent = c === 'party' ? 'Party' : 'Zone';
    chan.classList.toggle('party', c === 'party');
    input.classList.toggle('party', c === 'party');
    input.placeholder = c === 'party' ? 'Say something to your party' : 'Say something to everyone here';
    hint.textContent = inParty ? `Enter to chat (${c === 'party' ? 'Party' : 'Zone'}) · /p for party` : 'Enter to chat';
  };
  setChannel('zone');

  const line = (cls: string) => {
    const el = h('div', 'sg-chat-line' + (cls ? ' ' + cls : ''), log);
    while (log.childElementCount > MAX_LINES) log.firstElementChild?.remove();
    return el;
  };
  const box: ChatBox = {
    get channel() { return channel; },
    add(from, text, ch = 'zone', gm = false) {
      const el = line(ch === 'party' ? 'party' : '');
      if (ch === 'party') h('span', 'sg-chat-tag', el, '[Party]');
      if (gm) h('span', 'sg-chat-gm', el, 'GM');
      h('span', 'sg-chat-from', el, from);
      el.append(': ' + text);
    },
    announce(text) {
      const el = line('announce');
      h('span', 'sg-chat-from', el, 'Announcement');
      el.append(': ' + text);
    },
    system(text) { line('system').textContent = text; },
    setParty(on) {
      inParty = on;
      wrap.classList.toggle('sg-chat-party', on);
      setChannel(on ? channel : 'zone');
    },
  };

  const setOpen = (on: boolean) => {
    wrap.classList.toggle('sg-chat-open', on);
    if (on) input.focus();
    else { input.value = ''; input.blur(); }
  };
  bar.addEventListener('submit', (e) => {
    e.preventDefault();
    const c = parseChatLine(input.value, channel, inParty);
    if (c?.kind === 'say') opts.send(c.text.slice(0, CHAT_MAX), c.channel);
    else if (c?.kind === 'invite') opts.invite(c.name);
    else if (c?.kind === 'error') box.system(c.text);
    setOpen(false);
  });
  // the channel toggle keeps the line open (one tap switches, the typing carries on)
  chan.addEventListener('pointerdown', (e) => e.preventDefault());
  chan.addEventListener('click', () => { setChannel(channel === 'party' ? 'zone' : 'party'); input.focus(); });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // typed keys never reach the game
    if (e.key === 'Escape') setOpen(false);
  });
  input.addEventListener('blur', () => { if (!input.value.trim()) window.setTimeout(() => { if (document.activeElement !== input) wrap.classList.remove('sg-chat-open'); }, 0); });
  open.addEventListener('click', () => setOpen(!wrap.classList.contains('sg-chat-open')));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target === input || !wrap.isConnected) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.isContentEditable)) return;
    e.preventDefault();
    setOpen(true);
  });
  return box;
}
