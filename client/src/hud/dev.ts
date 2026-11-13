// Dev harness for the HUD (dev/hud.html). Not part of the game build.
import type { AbilityDef, BossBar, HudEvent, HudState, PartyBar, StatusId, WeaponId } from '../core/contracts';
import { TICK_HZ } from '@sg2/shared';
import { createHud } from './index';
import { jobBoardView } from './jobs';
import { bossBar, victoryLines } from './boss';
import { QUESTS, type QuestsView } from '@sg2/shared';
import { createClientQuests, journalView, onQuests, trackerOf } from '../net/quests';
import { pointerLayout } from './questPointer';

const ABILITIES: AbilityDef[] = [
  { id: 'cleave', name: 'Tide Cleave', glyph: '⟋', desc: 'A wide slash that Soaks foes; Soaked foes take bonus lightning.', cooldown: 6, range: 3, castTime: 0, job: 'warrior', support: false, kind: 'damage' },
  { id: 'parry', name: 'Riposte', glyph: '◈', desc: 'Parry the next hit within 1 s and strike back, filling stagger.', cooldown: 8, range: 0, castTime: 0, job: 'warrior', support: false, kind: 'defence' },
  { id: 'ember', name: 'Ember Edge', glyph: '✷', desc: 'Ignite your blade; hits set foes Burning. Burning + Soaked bursts into steam.', cooldown: 12, range: 0, castTime: 0.6, job: 'warrior', support: false, kind: 'damage' },
  { id: 'mark', name: "Hunter's Mark", glyph: '◎', desc: 'Mark a foe; your next charged shot on it crits.', cooldown: 10, range: 20, castTime: 0, job: 'ranger', support: false, kind: 'utility' },
  { id: 'volley', name: 'Gale Volley', glyph: '⇶', desc: 'Rain arrows in an area; Marked foes are stunned.', cooldown: 14, range: 18, castTime: 1.2, job: 'ranger', support: false, kind: 'damage' },
  { id: 'mend', name: 'Lantern Mend', glyph: '+', desc: 'Heal yourself or an ally over time.', cooldown: 9, range: 15, castTime: 1, job: 'white_mage', support: true, kind: 'heal' },
  { id: 'ward', name: 'Stone Ward', glyph: '◆', desc: 'Gain Guard, halving the next three hits.', cooldown: 20, range: 0, castTime: 0, job: 'white_mage', support: true, kind: 'defence' },
  { id: 'dash', name: 'Skystep', glyph: '»', desc: 'Dash a few metres, slipping through telegraphs.', cooldown: 5, range: 0, castTime: 0, job: 'white_mage', support: true, kind: 'utility' },
  { id: 'surge', name: 'Spray Shot', glyph: '≈', desc: 'A water arrow that Soaks; pairs with Ember Edge.', cooldown: 7, range: 18, castTime: 0, job: 'ranger', support: false, kind: 'damage' },
  { id: 'bash', name: 'Pommel Bash', glyph: '✦', desc: 'Interrupts a cast and adds heavy stagger.', cooldown: 11, range: 3, castTime: 0, job: 'warrior', support: false, kind: 'utility' },
  { id: 'bloom', name: 'Meadow Bloom', glyph: '❀', desc: 'Heal everyone near you a little, and grant Regen.', cooldown: 18, range: 0, castTime: 1.5, job: 'white_mage', support: true, kind: 'heal' },
  { id: 'pin', name: 'Pinning Arrow', glyph: '↧', desc: 'Slows a foe; Slowed + Marked roots them.', cooldown: 9, range: 20, castTime: 0, job: 'ranger', support: false, kind: 'utility' },
];

// ───────── fake 3D view ─────────
const canvas = document.getElementById('game') as HTMLCanvasElement;
function paint(): void {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = innerWidth, hh = innerHeight;
  canvas.width = w * dpr; canvas.height = hh * dpr;
  const c = canvas.getContext('2d')!;
  c.scale(dpr, dpr);
  let g = c.createLinearGradient(0, 0, 0, hh);
  g.addColorStop(0, '#1754D1'); g.addColorStop(0.35, '#479AF2'); g.addColorStop(0.62, '#FCB380'); g.addColorStop(0.63, '#FFFAF3'); g.addColorStop(1, '#f3e3cc');
  c.fillStyle = g; c.fillRect(0, 0, w, hh);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  c.fillStyle = 'rgba(255,250,243,.85)';
  for (let i = 0; i < 14; i++) { const x = rnd() * w, y = hh * (0.45 + rnd() * 0.2), r = 30 + rnd() * 70; c.beginPath(); c.ellipse(x, y, r * 2, r * 0.6, 0, 0, 7); c.fill(); }
  for (let i = 0; i < 4; i++) {
    const x = w * (0.12 + i * 0.26), y = hh * (0.22 + rnd() * 0.18), s = Math.min(w, hh) * (0.08 + rnd() * 0.05);
    c.fillStyle = '#8FD16A'; c.beginPath(); c.moveTo(x - s, y); c.lineTo(x + s, y); c.lineTo(x + s * 0.8, y + s * 0.25); c.lineTo(x - s * 0.9, y + s * 0.2); c.fill();
    c.fillStyle = '#C0605A'; c.beginPath(); c.moveTo(x - s * 0.9, y + s * 0.2); c.lineTo(x + s * 0.8, y + s * 0.25); c.lineTo(x + s * 0.1, y + s * 1.4); c.fill();
    c.fillStyle = '#5D4675'; c.beginPath(); c.moveTo(x + s * 0.8, y + s * 0.25); c.lineTo(x + s * 0.1, y + s * 1.4); c.lineTo(x + s * 0.5, y + s * 0.6); c.fill();
    c.fillStyle = '#EC6A4C'; c.fillRect(x - s * 0.3, y - s * 0.35, s * 0.25, s * 0.35);
  }
  g = c.createLinearGradient(0, hh * 0.68, 0, hh);
  g.addColorStop(0, '#9ad86f'); g.addColorStop(1, '#6fb84f');
  c.fillStyle = g; c.beginPath(); c.moveTo(0, hh * 0.74); c.quadraticCurveTo(w * 0.5, hh * 0.64, w, hh * 0.74); c.lineTo(w, hh); c.lineTo(0, hh); c.fill();
  c.fillStyle = '#ECD9B8'; c.beginPath(); c.ellipse(w * 0.5, hh * 0.86, w * 0.36, hh * 0.09, 0, 0, 7); c.fill();
  c.strokeStyle = '#3FB0A6'; c.lineWidth = 3; c.stroke();
  // statue + player stand-ins
  c.fillStyle = '#e4cfa8'; c.fillRect(w * 0.5 - 22, hh * 0.62, 44, hh * 0.2);
  c.fillStyle = '#d8c09a'; c.fillRect(w * 0.5 - 50, hh * 0.8, 100, hh * 0.05);
  c.fillStyle = '#EC6A4C'; c.beginPath(); c.ellipse(w * 0.42, hh * 0.86, 9, 22, 0, 0, 7); c.fill();
}
paint();
addEventListener('resize', paint);
let canvasTaps = 0;

// ───────── HUD + fake state ─────────
const hud = createHud(document.getElementById('hud')!);
const events: HudEvent[] = [];
const params = new URLSearchParams(location.search);
if (params.has('clean')) document.body.classList.add('clean');
let scene = params.get('scene') ?? 'town'; // town | combat | boss

let loadout = ['cleave', 'parry', 'ember', 'mend', 'ward'];
const weapon: WeaponId = 'blade';
const cds = [0, 0, 0, 0, 0];
let quest: HudState['quest'] = { title: 'The Solstice Crossing', steps: [{ text: 'Speak with Old Marrow', done: false }, { text: 'Find where the Two are pointing', done: false }] };
// Plan 6: ?quest=<main step id>[&qc=2,1,0,0][&side] puts the real tracker on (from the shared quest data and text)
const devQuests = createClientQuests();
const questView = (step: string, counts?: number[]): QuestsView => {
  const i = Math.max(0, QUESTS.solstice_crossing.steps.findIndex((x) => x.id === step));
  const c = counts ?? QUESTS.solstice_crossing.steps[i]!.objectives.map(() => 0);
  return { active: [{ id: 'solstice_crossing', step: i, counts: c }, ...(params.has('side') ? [{ id: 'bristle_bounty' as const, step: 0, counts: [4] }] : [])],
    done: params.has('side') ? [{ id: 'grans_waymarks', times: 1, today: false }] : [], offers: ['grans_waymarks'].filter(() => !params.has('side')) as QuestsView['offers'], skipped: [] };
};
const devTouch = () => document.querySelector('.sg-hud')?.classList.contains('sg-touch') ? 'touch' as const : 'desktop' as const;
if (params.get('quest')) { onQuests(devQuests, questView(params.get('quest')!, params.get('qc')?.split(',').map(Number))); quest = trackerOf(devQuests, devTouch()); }
let prompt: string | null = params.has('noprompt') ? null : 'Talk · Old Marrow';
let party = params.has('party');

/** Plan 4: three party members (one here, one far off in this room, one in the grove), with Searing on the tank. */
function devParty(t: number): PartyBar[] {
  const row = (o: Partial<PartyBar>): PartyBar => ({ name: '', hp: 100, maxHp: 100, statuses: [], eid: 1, dead: false, leader: false, online: true, zoneLabel: null, inRange: true, glyph: '⚔', job: 'warrior', level: 3, searing: 0, ...o });
  return [
    row({ name: 'Ellie_01', eid: 4, leader: true, job: 'paladin', glyph: '⛨', hp: 420 + 200 * Math.sin(t), maxHp: 700, searing: Math.floor(t / 2) % 6, level: 7 }),
    row({ name: 'Felix_Lamp', eid: 5, job: 'white_mage', glyph: '✚', hp: 0, maxHp: 520, dead: true, level: 6 }),
    row({ name: 'Pim', eid: -1, job: 'ninja', glyph: '✴', hp: 300, maxHp: 480, zoneLabel: 'Shady Grove', inRange: false, level: 2 }),
  ];
}
/** A boss for the frame: the Wickhound mid-fight, or the Warden warded and enraging. */
const bossBuf = { phaseMarks: [] as number[] } as unknown as BossBar;
function devBoss(t: number): BossBar | null {
  if (scene === 'wickhound') {
    const ph = t % 9;
    return bossBar({ kind: 'wickhound', hp: 1500 - (t * 12) % 600, maxHp: 3380, mode: ph > 7 ? 'stunned' : 'fight', windup: ph < 1.8 ? 'ember_breath' : '', stagger: (ph / 7) * 220, maxStagger: 220, phase: 1 },
      1000, { windupFrac: ph / 1.8, transitionLeftS: 0, targeted: true }, bossBuf);
  }
  if (scene === 'warden') {
    const ph = t % 8;
    return bossBar({ kind: 'fallen_warden', hp: 3300 - (t * 8) % 900, maxHp: 6500, mode: 'windup', windup: ph < 4 ? 'keepers_toll' : 'beacon_lance', stagger: 120, maxStagger: 300, phase: 1, warded: true, enrageAt: 1000 + (42 - t % 42) * TICK_HZ },
      1000, { windupFrac: (ph % 4) / 4, transitionLeftS: 0, targeted: false }, bossBuf);
  }
  return null;
}
let castT = -1;

hud.on((e) => {
  events.push(e);
  if (e.type === 'ability') {
    const a = ABILITIES.find((x) => x.id === loadout[e.slot]);
    if (a && cds[e.slot] <= 0) { cds[e.slot] = a.cooldown; if (a.castTime) castT = 0; }
    else hud.toast('Not ready yet');
  } else if (e.type === 'openJobs') { void dev.jobs(); }
  else if (e.type === 'openLoadout') { void dev.loadout(); }
  else if (e.type === 'interact') { void demoDialogue(); }
  else if (e.type === 'clearTarget') { if (scene !== 'town') scene = 'town'; }
  else if (e.type === 'openJournal') { void dev.journal(); }
});

async function demoDialogue(): Promise<number> {
  const p = prompt; prompt = null;
  const r = await hud.dialogue('Old Marrow', [
    "Ah — another soul come to see the Two. Ellie pointing, Felix with his spyglass. Folk say they're looking at nothing.",
    'But on solstice morning the light catches the lens just so… and the sky remembers.',
  ], ['Where are they pointing?', 'Tell me about the ferry.', 'Goodbye.']);
  prompt = p;
  if (r === 0 && quest) { quest = { ...quest, steps: quest.steps.map((s, i) => (i === 0 ? { ...s, done: true } : s)) }; hud.toast('Quest updated'); }
  return r;
}

let t0 = performance.now(), last = t0;
let stagger = 0, staggeredT = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const t = (now - t0) / 1000;
  for (let i = 0; i < 5; i++) cds[i] = Math.max(0, cds[i] - dt);
  if (castT >= 0) { castT += dt; if (castT > 1.2) castT = -1; }
  const combat = scene !== 'town';
  const boss = devBoss(t);
  const st: StatusId[] = combat ? ['regen', ...(Math.sin(t * 0.5) > 0 ? ['guard' as StatusId] : [])] : [];
  let target: HudState['target'] = null;
  if (scene === 'combat') {
    target = { name: 'Brine Grunt', hp: 300 + 260 * Math.sin(t * 0.7), maxHp: 600, statuses: ['soaked', 'marked'], stagger: 0, maxStagger: 0, isBoss: false,
      cast: (t % 6) < 2 ? { name: 'Shell Slam', frac: (t % 6) / 2, interruptible: true } : null };
  } else if (scene === 'elite') {
    // the Greenway's elite as Plan 3 shows it: stagger bar (greyed while immune), an interruptible wind-up, marks
    const ph = t % 10, immune = ph > 6;
    target = { name: 'Mossback', hp: 750 - (t * 9) % 700, maxHp: 1275, statuses: ['marked', 'burning'], stagger: immune ? 0 : (ph / 6) * 100, maxStagger: 170,
      isBoss: true, staggerImmune: immune ? 10 - ph : 0, surging: ph > 8.5,
      cast: ph < 2.2 ? { name: 'Thorn Hail', frac: ph / 2.2, interruptible: true } : ph < 3.8 ? { name: 'Ground Slam', frac: (ph - 2.2) / 1.6, interruptible: false } : null };
  } else if (scene === 'boss') {
    if (staggeredT > 0) { staggeredT -= dt; stagger = 0; } else { stagger += dt * 14; if (stagger >= 100) { stagger = 0; staggeredT = 3; } }
    const ph = t % 8;
    target = { name: 'The Lighthouse Warden', hp: 42000 - (t * 300) % 40000, maxHp: 42000, statuses: staggeredT > 0 ? ['staggered', 'burning'] : ['burning'],
      stagger, maxStagger: 100, isBoss: true,
      cast: ph < 3 ? { name: ph < 1.5 ? 'Beam Sweep' : 'Tidal Crash', frac: (ph % 1.5) / 1.5, interruptible: ph < 1.5 } : null };
  }
  const state: HudState = {
    player: { name: 'Wren', hp: combat ? 620 + 380 * Math.sin(t * 0.4) : 1000, maxHp: 1000, statuses: st, level: 4, weapon,
      cast: castT >= 0 ? { name: 'Casting…', frac: castT / 1.2 } : scene === 'elite' ? { name: 'Charged Shot', frac: Math.min(1, (t % 3) / 1.5), mark: 0.8 } : null,
      ...(scene === 'elite' ? { momentum: (t * 12) % 110 > 100 ? 100 : (t * 12) % 110, dodge: { charges: Math.floor(t / 3) % 3, max: 2, refill: (t % 5) / 5 } } : {}) },
    target,
    party: party ? devParty(t) : [],
    slots: combat || params.has('slots') ? loadout.map((id, i) => {
      const a = ABILITIES.find((x) => x.id === id)!;
      return { ability: a, cdRemaining: cds[i], usable: true };
    }) : [],
    quest,
    prompt: combat ? null : prompt,
    inCombat: combat,
    boss,
    social: params.has('social') || party ? { inParty: party, invites: 0 } : null,
    hint: params.has('mouth') ? 'The Lampfall: a private dungeon for your party (you, Ellie_01). Party members who walk in join you.' : null,
    ally: params.has('ally') ? { name: 'Brightwen', hp: 260, maxHp: 400, statuses: [], dead: false, inRange: true, glyph: '✚', cast: null, eid: 9, canInvite: true } : null,
  };
  hud.render(state);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

canvas.addEventListener('pointerdown', (e) => { canvasTaps++; if (!document.body.classList.contains('clean')) hud.floatText(e.clientX, e.clientY, 'tap', 'info'); });

function burst(): void {
  const x = innerWidth * 0.55, y = innerHeight * 0.45;
  hud.floatText(x, y, '124', 'damage');
  setTimeout(() => hud.floatText(x, y, '386!', 'crit'), 180);
  setTimeout(() => hud.floatText(x - 40, y + 60, '+92', 'heal'), 360);
  setTimeout(() => hud.floatText(innerWidth * 0.42, innerHeight * 0.62, '-57', 'hurt'), 500);
  setTimeout(() => hud.floatText(x, y - 30, 'Steam Burst!', 'combo'), 650);
  setTimeout(() => hud.floatText(x, y + 30, 'Immune', 'info'), 800);
}

const dev = {
  hud, events, ABILITIES,
  get canvasTaps() { return canvasTaps; },
  setScene(s: string) { scene = s; },
  setPrompt(p: string | null) { prompt = p; },
  setParty(on: boolean) { party = on; },
  setQuest(q: HudState['quest']) { quest = q; },
  completeStep(i: number) { if (quest) quest = { ...quest, steps: quest.steps.map((s, j) => (j === i ? { ...s, done: true } : s)) }; },
  dialogue: demoDialogue,
  title: () => hud.titleScreen(),
  loadout: () => hud.loadout(ABILITIES, loadout, 'Wren', 5).then((ids) => { loadout = ids; return ids; }),
  jobs: () => hud.jobs(jobBoardView(null, params.has('greenway') ? 'greenway' : 'grove')),
  invite: () => hud.partyInvite('Ellie_01', 2, 60),
  partySheet: (leader = true) => hud.partySheet({ amLeader: leader, canInvite: leader, members: [
    { name: 'Wren', leader, online: true, zone: 'The Lampfall', job: 'Warrior', level: 4, glyph: '⚔', me: true },
    { name: 'Ellie_01', leader: !leader, online: true, zone: 'The Lampfall', job: 'Paladin', level: 7, glyph: '⛨', me: false },
    { name: 'Pim', leader: false, online: false, zone: 'Offline', job: 'Ninja', level: 2, glyph: '✴', me: false },
  ] }),
  fallen: () => hud.endScreen('defeat', ['You have fallen.', 'A party member can bring you back, or release to get up at the Crater Rim.'], ['Release', 'Watch'],
    { title: 'Fallen', countdown: { seconds: 10, text: 'Release in {s} s', doneText: 'You can release now' } }),
  wipe: () => hud.endScreen('defeat', ['Everyone in the party has fallen.', 'The foes still standing go back to their places.'], ['OK'],
    { title: 'The light goes out…', countdown: { seconds: 5, text: "Back to the Keeper's Landing in {s} s" } }),
  lampVictory: (seal = true) => hud.endScreen('victory', victoryLines({ boss: 'fallen_warden', seconds: 277, partySize: 2, xp: 300, seal, seals: seal ? 1 : 2, title: null, rank: 3,
    lore: "The Warden's lamp steadies, and for a moment its beam points the same way as Ellie's arm." }), ['Leave the Lampfall', 'Stay'], { title: 'Victory' }),
  victory: () => hud.endScreen('victory', ['The Warden falls silent. The lamp burns clear.', 'Solo · 6:42'], ['Return to Shady Grove', 'Fight again']),
  defeat: () => hud.endScreen('defeat', ['The tide took you this time.'], ['Retry', 'Return to the statue']),
  banner: () => hud.banner('The Plaza of the Two', 'Shady Grove'),
  toast: () => hud.toast('Out of range'),
  burst,
  fade: async () => { await hud.fade(true, '#FFFAF3', 0.6); await hud.fade(false, '#FFFAF3', 0.6); },
  hidden: false,
  // Plan 6: the journal, the completion moment, a hint, the quest card, the pointer, a closable dialogue
  journal: (tab?: 'active' | 'offers' | 'done') => hud.journal(journalView(devQuests.view ? devQuests : (onQuests(devQuests, questView('duo')), devQuests), devTouch(), tab)),
  moment: (big = false) => hud.questDone(big
    ? { title: 'The Solstice Crossing', step: 'Look into the crater', xp: 40, gold: 30, item: null, title2: 'Witness of the Crossing', questDone: true }
    : { title: 'The Solstice Crossing', step: 'Defeat Thornlings', xp: 60, gold: 10, item: null, title2: null, questDone: false }),
  hint: (t = 'When your Momentum bar is half full, press your finisher (button 2, or key 2).') => hud.questHint(t, 600),
  card: () => hud.questCard({ kicker: 'New quest', title: "The Keeper's Lamp", text: 'Climb down into the Lampfall and find what fell. Best with friends.', buttons: ['Accept', 'Not now'] }),
  /** The pointer toward a target projected at (x, y) (off screen: it goes to the edge, out of the controls' way). */
  pointer: (x = -100, y = 300, label = 'Nell Thistlewood') => { const l = pointerLayout(x, y, true, innerWidth, innerHeight, hud.exclusions()); hud.pointer({ ...l, label }); },
  talk: () => hud.dialogue('Nell Thistlewood, the road-keeper', ['You\'ll do. Better than do, even.', 'Here. The smiths in town send me spares for anyone who\'s earned them. Pick what suits you.'],
    ['Mossweave Robe — cloth: stronger abilities', 'Thornrunner Jerkin — light: faster Momentum', 'Rootbound Hauberk — heavy: they come for you, not your friends'], { closable: true, start: 1 }),
  toggleHud() { this.hidden = !this.hidden; hud.setVisible(!this.hidden); },
};
(window as unknown as { dev: typeof dev }).dev = dev;

const panel = document.getElementById('dev')!;
document.getElementById('devtoggle')!.addEventListener('click', () => panel.classList.toggle('open'));
const btns: [string, () => unknown][] = [
  ['Title', dev.title], ['Dialogue', dev.dialogue], ['Banner', dev.banner], ['Toast', dev.toast], ['Fade', dev.fade],
  ['Hide/show HUD', () => dev.toggleHud()], ['Town', () => dev.setScene('town')], ['Combat', () => dev.setScene('combat')], ['Boss', () => dev.setScene('boss')], ['Elite', () => dev.setScene('elite')],
  ['Party', () => { party = !party; }], ['Prompt', () => { prompt = prompt ? null : 'Talk · Old Marrow'; }], ['Step done', () => dev.completeStep(1)],
  ['Floats', burst], ['Loadout', dev.loadout], ['Jobs', dev.jobs], ['Victory', dev.victory], ['Defeat', dev.defeat],
  ['Wickhound', () => dev.setScene('wickhound')], ['Warden', () => dev.setScene('warden')], ['Invite', dev.invite], ['Party sheet', () => dev.partySheet()],
  ['Fallen', dev.fallen], ['Wipe', dev.wipe], ['Lampfall victory', () => dev.lampVictory()],
  ['Journal', () => dev.journal()], ['Quest moment', () => dev.moment()], ['Quest done', () => dev.moment(true)], ['Hint', () => dev.hint()], ['Quest card', dev.card],
  ['Pointer', () => dev.pointer()], ['Reward talk', dev.talk],
];
for (const [label, fn] of btns) {
  const b = document.createElement('button'); b.textContent = label;
  b.addEventListener('click', () => { panel.classList.remove('open'); void fn(); });
  panel.appendChild(b);
}
if (params.has('banner')) setTimeout(() => dev.banner(), 50);
