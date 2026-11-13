// Shady Grove 2 — online: sign in, then walk the world with everyone else who is here.
// The server owns positions; this page sends the adventurer's pose and draws the others and the enemies.
// One room per zone: the page asks the server which zone the adventurer is in, builds that zone and joins
// its room. Walking through an open gate makes the server send `travel`: the screen fades, the room ends,
// the next zone is built on the same engine, its room is joined, and the screen fades back in.
import { Matrix, Vector3, type Scene } from '@babylonjs/core';
import {
  CLIENT_RECONNECTION,
  GUILD_BOARD,
  REASON_ELSEWHERE,
  REASON_NAME_FIRST,
  RECONNECT_SECONDS,
  TICK_HZ,
  zoneDef,
  zoneFullReason,
  PARTY_TEXT,
  type C2S,
  type CastView,
  type InstanceView,
  type JobId,
  type JobsView,
  type PartyOp,
  type PartyView,
  type QuestsView,
  type S2C,
  type VictoryView,
  type ZoneId,
  type EmoteId,
  type InventoryView,
  validateAdventurerName,
} from '@sg2/shared';
import { setCharacterDetail, setGearBuilder } from './player/character';
import { gearHooks } from './player/gearModels';
import { setCreatorPreview } from './hud/creator';
import { createCreatorPreview } from './player/creatorPreview';
import { LookCache, barberHook, barberRefusal, creatorPlan } from './net/looks';
import { fetchLookInfo, saveLook, startingLook } from './net/lookApi';
import type { HudState, TapInfo } from './core/contracts';
import { bootGame, isZoneBuilt } from './boot';
import { h } from './hud/dom';
import { createChat, type ChatChannel } from './net/chatBox';
import { createPartyState } from './net/party';
import { partySheetView } from './hud/party';
import { victoryLines } from './hud/boss';
import { showLogin } from './net/loginScreen';
import { LeaveNameScreen, showNameScreen } from './net/nameScreen';
import { createRemotes, type Remotes } from './net/remotes';
import { createEnemies, type Enemies } from './net/enemies';
import { COMBAT_MESSAGES, createCombat, type CombatController, type CombatDebug } from './combat/controller';
import { createGuildBoard } from './world/guildBoard';
import { beaconRaisedFor, createStoryWorld, storyIdOf, type StoryWorld } from './world/storyNpcs';
import { stallOfEid } from './world/stallIds';
import { createStalls, type Stalls } from './world/stalls';
import { InvClient } from './net/inventory';
import { createGearCtl, type GearCtl } from './net/gearCtl';
import { routeTap } from './net/tapOrder';
import {
  UNREACHABLE,
  connect,
  forgetToken,
  nameAdventurer,
  poseWorthSending,
  rememberName,
  savedAccount,
  savedToken,
  zoneFor,
  type PlayerView,
  type ZonePlace,
  type SentPose,
  type ZoneRoom,
} from './net/session';

const CONNECTION_LOST = 'Connection lost';
const CONNECTING = 'Connecting…';
const RECONNECTING = 'Reconnecting…';
/** Join refusals that say nothing against the account: its saved token is kept, so "Continue as" stays on offer. */
/** The page could not build the zone the adventurer is in (the previous one was put back, or the page reloads). */
const LOAD_FAILED = "Couldn't load that area, try again";
/** The adventurer is in a zone this version of the client cannot draw. */
/** A zone this client cannot build: the sign-in is kept (the adventurer is fine; this version of the game is old). */
class ZoneClosedError extends Error {}
const zoneClosedNotice = (zone: ZoneId) => `Your adventurer is in ${zoneDef(zone).name}, which this version of the game can't show yet. Reload to update the game, or try again later.`;
const KEEP_TOKEN_ON = new Set([LOAD_FAILED, UNREACHABLE, zoneFullReason('grove'), zoneFullReason('greenway'), zoneFullReason('lampfall')]);
/** How long the screen takes to fade out and back in around a zone change, in s. */
const TRAVEL_FADE_S = 0.6;
/** Longest wait after joining for the room to show this adventurer. */
const ENTER_TIMEOUT_MS = 15_000;
/** Longest wait after `travel` for the server to end the session before the page leaves the room itself. */
const TRAVEL_LEAVE_MS = 5_000;

const CSS = /* css */ `
.sg-online{position:absolute;right:calc(var(--sr) + var(--g) + 226px);top:calc(var(--st) + var(--g));padding:4px 12px;border-radius:12px;
  font-size:13px;font-weight:600;background:rgba(16,18,42,.45)}
.sg-online.away{color:#ffd9a0}
@media (max-width:700px) and (orientation:portrait),(max-height:500px){ .sg-online{right:auto;left:50%;transform:translateX(-50%);top:auto;bottom:calc(var(--sb) + 4px);font-size:11px;padding:2px 8px;background:none} }
.sg-online:empty{display:none}
.sg-modal-open ~ .sg-hud .sg-online,.sg-modal-open ~ div .sg-chat-btn{opacity:0;pointer-events:none}
.sg-net-off{display:none}
.sg-emote-btn{position:absolute;right:calc(var(--sr) + var(--g) + 168px);top:calc(var(--st) + var(--g));width:48px;height:48px;border-radius:24px;
  border:1px solid rgba(255,226,160,.35);background:rgba(16,18,42,.55);color:#fff6e6;font-size:22px;cursor:pointer;pointer-events:auto}
.sg-travel{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;pointer-events:none;
  font:600 18px/1.3 var(--sans,system-ui,sans-serif);color:#fff6e6;letter-spacing:.04em;text-shadow:0 1px 6px rgba(0,0,0,.6);
  opacity:0;transition:opacity .3s}
.sg-travel.on{opacity:1}
/* the top-right row (desktop, landscape): settings, party, the character menu (Plan 5), emotes; portrait phones: the right-hand column */
@media (max-width:700px) and (orientation:portrait){ .sg-emote-btn{right:calc(var(--sr) + var(--g) + 2px);top:calc(var(--st) + var(--g) + 358px)} }
`;

interface NetDebug {
  remotes: { name: string; x: number; z: number; y: number }[];
  /** The room's enemies as the server states them. */
  enemies: { eid: number; kind: string; x: number; z: number; hp: number; mode: string; windup: string }[];
  /** The zone whose room this page is in (or is joining). */
  zone: ZoneId;
  /** Zone changes so far, and how long the last took from `travel` to standing in the next room (ms, wall clock). */
  travels: number;
  lastTravelMs: number;
  /** How long building the last zone took (ms, wall clock). */
  lastLoadMs: number;
  /** This adventurer's combat numbers as the server states them (null before entering), with its job and cast. */
  self: { hp: number; momentum: number; dead: boolean; target: number | null; job: JobId | null; cast: CastView } | null;
  /** The last `jobs` (null before it arrives). */
  jobs: JobsView | null;
  /** The last 20 refusals, oldest first. */
  refusals: { action: string; reason: string }[];
  /** The focused adventurer's engine id (null: none). */
  allyFocus: number | null;
  /** Where the Guild Board stands in the grove. */
  guildBoard: { x: number; z: number };
  /** Combat fx events received so far. */
  fxSeen: number;
  /** The controller's counters (dodges, refusals, corrections, ...). */
  combat: CombatDebug | null;
  /** Moves sent (and with which ack, the last). */
  moves: number;
  /** Plan 4: the party (null: none), pending invites, the last party refusals (PARTY_TEXT lines). */
  party: PartyView | null;
  invites: { partyId: string; from: string }[];
  partyRefusals: string[];
  /** The Lampfall instance as last heard (null outside one), and the room's id (an instance's id inside one). */
  instance: InstanceView | null;
  roomId: string;
  /** The boss the boss frame shows (null: none). */
  boss: { kind: string; phase: number; warded: boolean; enrageIn: number | null } | null;
  /** The last boss kill this adventurer was credited with (null: none in this room). */
  victory: VictoryView | null;
  /** The last 50 chat lines. */
  chatLog: { from: string; text: string; channel: string }[];
  /** Which end screen is up ('fallen', 'wipe', 'defeat', 'victory', or ''). */
  screen: string;
  /** `correct` messages received so far (an honest client at a shut lamp-gate gets none). */
  corrections: number;
  /** Edge markers shown now (party members off screen). */
  edges: number;
  /** Plan 5: this adventurer's look code ('' until the room sends it), whether the free creator visit is unused, whether
   *  the creator (or the Barber) is open, and every look code the room has sent (engine id → code). */
  look: string;
  lookFree: boolean;
  creatorOpen: boolean;
  remoteLooks: Record<number, string>;
  /** Gold, as the last `inventory` said (the Barber's price check). */
  gold: number;
  /** Plan 5 (Task 10): the last `inventory`, the last loot, the last 20 refusal lines, the kit's stats, level-ups, the open stall sheet. */
  inventory: InventoryView | null;
  lastLoot: { items: string[]; gold: number } | null;
  invRefusals: string[];
  stats: InventoryView['stats'] | null;
  levelUps: { job: string; level: number }[];
  stall: string | null;
}
/** What ended a connection: a reason for the login screen, or a travel to another zone (an instance by id). */
type Ended = { reason: string } | { travel: ZonePlace };

function boot(): void {
  let room: ZoneRoom | null = null;
  let remotes: Remotes | null = null;
  let enemies: Enemies | null = null;
  let combat: CombatController | null = null;
  /** Plan 5: the gear screens of the room being played (null between rooms), and the inventory (it outlives rooms). */
  let gearCtl: GearCtl | null = null;
  const inv = new InvClient();
  /** The room being played (set on joining, before the adventurer is in it): the Lampfall's gates come from its state. */
  let joining: ZoneRoom | null = null;

  const game = bootGame({
    busy: () => !room, onTap: (tap) => onTap(tap),
    // the Lampfall's shut lamp-gates are walls (as on the server) and its lamp-lift opens after the Warden
    lampfall: { gates: () => joining?.state.gates ?? 0, lift: () => !!joining?.state.lift },
  });
  const { hud, hudRoot } = game;
  /**
   * Who answers a tap (routeTap): an enemy (combat) > a story NPC or prop (story.handleTap) > a town booth (the gear
   * screens) > the rest (an adventurer, the ground: the combat controller, then tap-to-walk).
   */
  const isEnemy = (eid: number) => { const r = room; if (!r) return false; let hit = false; r.state.enemies?.forEach((e) => { if (e.eid === eid && e.mode !== 'dead') hit = true; }); return hit; };
  const tapIs = { enemy: isEnemy, story: (eid: number) => storyIdOf(eid) !== null, booth: (eid: number) => stallOfEid(eid) !== null };
  function onTap(tap: TapInfo): boolean {
    const route = routeTap(tap, tapIs);
    if (route === 'story' && story?.handleTap(tap)) return true;
    if (route === 'booth' && gearCtl?.onTap(tap)) return true;
    return combat?.onTap(tap) ?? false;
  }
  // the Guild Board stands in the grove's Plaza (online only: the offline demo has no jobs)
  // (its meshes go with the scene on a zone change)
  if (game.zone === 'grove') createGuildBoard(game.scene, game.world);
  game.onZoneLoaded((z) => { if (z === 'grove') createGuildBoard(game.scene, game.world); });
  // the people and places of the opening quest (grove and Greenway), their markers from the last `quests` view
  // (Plan 6 Task 6 wires taps on them: story.handleTap, and the talk flow)
  let story: StoryWorld | null = null;
  let questView: QuestsView | null = null;
  const buildStory = (z: typeof game.zone) => {
    try { story?.dispose(); } catch { /* its scene is gone already */ }
    story = z === 'grove' || z === 'greenway' ? createStoryWorld(game.scene, game.world, z, { quality: game.quality }) : null;
    story?.setView(questView);
    game.world.setBeaconRaised(beaconRaisedFor(questView));
  };
  buildStory(game.zone);
  game.onZoneLoaded((z) => buildStory(z));
  // the five town stalls and their keepers (online only; their meshes go with the scene on a zone change)
  let stalls: Stalls | null = game.zone === 'grove' ? createStalls(game.scene, game.world) : null;
  game.onZoneLoaded((z) => { stalls = z === 'grove' ? createStalls(game.scene, game.world) : null; });
  game.rig.setMoveScale(0);
  game.onZoneLoaded(() => game.rig.setMoveScale(0)); // a new zone's adventurer waits for its room
  hud.setVisible(false);

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const netUi = h('div', 'sg-net-off', hudRoot);
  // Outside netUi, so "Connecting…" shows before the room does.
  const status = h('div', 'sg-online', h('div', 'sg-hud', hudRoot));
  const net: NetDebug = {
    remotes: [], enemies: [], zone: game.zone as ZoneId, travels: 0, lastTravelMs: 0, lastLoadMs: 0, self: null, fxSeen: 0, combat: null, moves: 0,
    jobs: null, refusals: [], allyFocus: null, guildBoard: { x: GUILD_BOARD.x, z: GUILD_BOARD.z },
    party: null, invites: [], partyRefusals: [], instance: null, roomId: '', boss: null, victory: null, chatLog: [], screen: '', corrections: 0, edges: 0,
    look: '', lookFree: false, creatorOpen: false, remoteLooks: {}, gold: 0,
    inventory: null, lastLoot: null, invRefusals: inv.refusals, stats: null, levelUps: inv.levelUps, stall: null,
  };
  const logChat = (from: string, text: string, channel: string) => { net.chatLog.push({ from, text, channel }); if (net.chatLog.length > 50) net.chatLog.shift(); };
  // ── Plan 4: the party (it outlives each room), invites, party chat ──
  const party = createPartyState();
  const sendParty = (op: PartyOp) => { if (room) send(room, 'party', op); else hud.toast('Not connected right now'); };
  const chat = createChat(netUi, {
    send: (text, channel: ChatChannel) => { if (room) send(room, 'chat', channel === 'party' ? { text, channel } : { text }); },
    invite: (name) => { sendParty({ op: 'invite', name }); if (room) hud.toast(`Invite sent to ${name}`); },
  });
  const travelLabel = h('div', 'sg-travel', document.body);
  /** The instance message of this room and when it came (the controller counts its timers down from then). */
  let instance: { view: InstanceView; at: number } | null = null;
  const socialView = { party, instance: () => instance };
  const syncParty = () => {
    net.party = party.view;
    net.invites = party.invites.map((i) => ({ partyId: i.partyId, from: i.from }));
    net.partyRefusals = party.refusals.slice();
    social.inParty = party.view !== null; social.invites = party.invites.length;
  };
  const social = { inParty: false, invites: 0 };
  let sheetOpen = false;
  const openPartySheet = () => {
    if (sheetOpen || !room) return;
    sheetOpen = true;
    const me = state.player.name;
    void hud.partySheet(partySheetView(party.view, me, party.canInvite(me))).then((a) => {
      sheetOpen = false;
      if (!a) return;
      if (a.kind === 'invite') { sendParty({ op: 'invite', name: a.name }); hud.toast(`Invite sent to ${a.name}`); }
      else if (a.kind === 'leave') sendParty({ op: 'leave' });
      else sendParty({ op: a.kind, name: a.name });
    });
  };
  hud.on((e) => { if (e.type === 'openParty') openPartySheet(); else if (!gearCtl?.onHud(e)) combat?.onHud(e); });
  // Plan 5: looks. The cache holds every adventurer's look by engine id for the room (cleared on leaving it).
  const lookCache = new LookCache();
  let ownLookVer = 0;
  setCreatorPreview(createCreatorPreview);
  setCharacterDetail(game.quality);
  // Plan 5 Task 9: worn gear and costumes on every adventurer (gear codes arrive with the looks)
  setGearBuilder(gearHooks);
  /** This adventurer's own look onto its rig, when the room has sent a new one. */
  const applyOwnLook = () => {
    const me = room?.state.players?.get(room.sessionId);
    const e = me && typeof me.eid === 'number' ? lookCache.get(me.eid) : undefined;
    if (!e || e.ver === ownLookVer) return;
    ownLookVer = e.ver;
    net.look = e.code;
    game.rig.view.setAppearance(e.look, e.gear);
  };
  /** The Barber (Task 10's stall tap calls barberHook.open): the creator in Barber mode, then a `look` for the server to price. */
  const openBarber = async () => {
    const r = room;
    if (!r || net.creatorOpen) return;
    const me = r.state.players?.get(r.sessionId);
    const e = me && typeof me.eid === 'number' ? lookCache.get(me.eid) : undefined;
    if (!e) return;
    net.creatorOpen = true;
    const res = await hud.creator({ look: e.look, mode: 'barber', needsName: false, gold: net.gold, free: lookCache.free === true, validateName: validateAdventurerName });
    net.creatorOpen = false;
    if (res && room === r) send(r, 'look', { look: res.look });
  };
  barberHook.open = openBarber;
  (window as unknown as Record<string, unknown>).__sg2barber = openBarber; // browser checks: the Barber without its stall
  // the emote button (the wheel: wave, bow, cheer, laugh, sit, point); played here at once, and sent for the others
  const emoteBtn = h('button', 'sg-emote-btn', netUi, '☺');
  emoteBtn.setAttribute('aria-label', 'Emotes');
  emoteBtn.addEventListener('click', () => {
    void hud.emoteWheel().then((e: EmoteId | null) => {
      if (!e || !room) return;
      game.rig.view.emote(e);
      send(room, 'emote', { emote: e });
    });
  });
  (window as unknown as { __sg2net: NetDebug }).__sg2net = net;
  // Like the offline demo's window.__sg2: for playtests and browser checks (the server still checks every move).
  // Getters: a zone change replaces the scene, world and rig.
  (window as unknown as Record<string, unknown>).__sg2 = {
    get rig() { return game.rig; }, get world() { return game.world; }, get scene() { return game.scene; },
    hud, engine: game.engine, game,
    /** Where a world point is on screen, in CSS px (null behind the camera): for playtests that tap things. */
    screenOf(x: number, y: number, z: number) {
      const sc = game.scene, cam = sc.activeCamera, cv = sc.getEngine().getRenderingCanvas();
      if (!cam || !cv) return null;
      const at = Vector3.Project(new Vector3(x, y, z), Matrix.IdentityReadOnly, sc.getTransformMatrix(), cam.viewport.toGlobal(cv.clientWidth, cv.clientHeight));
      return at.z > 0 && at.z < 1 ? { x: at.x, y: at.y } : null;
    },
    /** The combat controller of the room this page is in (null between rooms). */
    get combat() { return combat; },
    get room() { return room; },
    /**
     * Rendering counters for budget checks: draw calls per frame since the previous call (null on the first), active
     * meshes and their triangles, and the spell pool (live visuals, instances drawn).
     */
    gfx() {
      // draw calls per frame since the last call (the engine's running total over the frames between)
      const sc = game.scene as Scene & { __gfx?: { total: number; frame: number } };
      const e = sc.getEngine() as unknown as { _drawCalls: { total: number }; frameId: number };
      const prev = sc.__gfx, total = e._drawCalls.total, frame = e.frameId;
      sc.__gfx = { total, frame };
      const act = sc.getActiveMeshes();
      let tris = 0;
      for (let i = 0; i < act.length; i++) tris += act.data[i].getTotalIndices() / 3;
      const sp = combat?.debug.spells;
      const drawCalls = prev && frame > prev.frame ? Math.round((total - prev.total) / (frame - prev.frame)) : null;
      return { drawCalls, activeMeshes: act.length, tris: Math.round(tris), spellsLive: sp?.live ?? 0, spellsDrawn: sp?.drawn ?? 0, quality: game.quality };
    },
  };

  const state: HudState = {
    player: { name: 'Adventurer', hp: 100, maxHp: 100, statuses: [], level: 1, weapon: 'blade', cast: null },
    target: null,
    party: [],
    slots: [],
    quest: null,
    prompt: null,
    inCombat: false,
    social,
  };

  /** From asking to join until this adventurer is in the room (or the attempt ends). */
  let connecting = false;
  let statusText = '';
  game.start((dt) => {
    story?.setInCombat(state.inCombat);
    story?.update(dt);
    remotes?.update(dt);
    enemies?.update(dt);
    combat?.update(dt);
    gearCtl?.update(dt); // after the controller: a stall in reach takes the prompt when nothing else wants it
    stalls?.update(dt);
    net.stall = gearCtl?.stall ?? null;
    if (combat) {
      const d = combat.debug;
      net.self = d.self; net.fxSeen = d.fxSeen; net.jobs = d.jobs; net.refusals = d.refused; net.allyFocus = d.allyFocus;
      net.boss = d.boss;
      net.edges = state.edges?.length ?? 0;
      if (net.screen !== 'victory') net.screen = d.screen;
    }
    // invites that ran out: their cards go
    if (party.invites.length) for (const gone of party.expire(performance.now())) { hud.closeInvite(gone.from); syncParty(); }
    let text = connecting ? CONNECTING : '';
    if (room) text = room.reconnection.isReconnecting ? RECONNECTING : `Adventurers online: ${room.state.online ?? room.state.players?.size ?? 0}`;
    if (text !== statusText) {
      statusText = text;
      status.textContent = text;
      status.classList.toggle('away', text === RECONNECTING);
    }
    hud.render(state);
  });

  /** A fall cost health: "−n" floats up from the adventurer, and the screen edge flashes red. */
  const showHurt = (amount: number) => {
    const { scene, rig } = game;
    const canvas = scene.getEngine().getRenderingCanvas();
    const w = canvas?.clientWidth ?? window.innerWidth, ht = canvas?.clientHeight ?? window.innerHeight;
    const camera = scene.activeCamera;
    let x = w / 2, y = ht / 2;
    if (camera) {
      const p = rig.position;
      const at = Vector3.Project(new Vector3(p.x, p.y + rig.view.height * 0.8, p.z), Matrix.IdentityReadOnly,
        scene.getTransformMatrix(), camera.viewport.toGlobal(w, ht));
      if (at.z > 0 && at.z < 1) { x = at.x; y = at.y; }
    }
    hud.floatText(x, y, `−${amount}`, 'hurt');
    hud.danger('flash');
  };

  /** Set from a `travel` message until the next room is entered: where to (an instance by id), the fade and when it began. */
  let travelling: { zone: ZoneId; instance?: string; fade: Promise<void>; since: number } | null = null;
  /** Ends a travel that will not reach its room (a kick, a timeout, a failed join): the label goes and the screen fades back in. */
  const endTravel = () => {
    if (!travelling) return;
    travelling = null;
    travelLabel.classList.remove('on');
    void hud.fade(false, '#16122a', TRAVEL_FADE_S);
  };

  /** Plays one connection (to zone `zone`'s room) until it ends; resolves with what ended it. */
  function play(r: ZoneRoom, zone: ZoneId): Promise<Ended> {
    const rig = game.rig;
    return new Promise((resolve) => {
      let kickedFor = '';
      let travelTo: ZonePlace | null = null;
      joining = r;
      net.roomId = r.roomId;
      instance = null; net.instance = null; net.victory = null;
      let lostTimer = 0;
      let sendTimer = 0;
      let travelTimer = 0;
      let entered = false;
      const sent: SentPose = { x: NaN, z: NaN, y: NaN, facing: NaN, moving: false };
      let sentAck = 0;

      // Reconnect for up to RECONNECT_SECONDS, however long the room has been up, then give up.
      Object.assign(r.reconnection, CLIENT_RECONNECTION);
      r.onDrop(() => {
        rig.setMoveScale(0);
        game.walkTo(null);
        if (!lostTimer) lostTimer = window.setTimeout(() => void r.leave(), RECONNECT_SECONDS * 1000);
      });
      r.onReconnect(() => {
        clearTimeout(lostTimer);
        lostTimer = 0;
        if (!travelTo) rig.setMoveScale(1);
        sent.x = NaN; // the server may have missed the last pose: send it again
      });
      r.onMessage('kicked', (m: S2C['kicked']) => { kickedFor = m.reason; });
      r.onMessage('chat', (m: S2C['chat']) => {
        const channel = m.channel === 'party' ? 'party' : 'zone';
        chat.add(m.from, m.text, channel, m.gm === true);
        logChat(m.from, m.text, channel);
      });
      // a game master's announcement: a banner (as text, never HTML) and a chat line
      r.onMessage('announce', (m: S2C['announce']) => {
        if (typeof m?.text !== 'string') return;
        hud.banner(m.text, typeof m.event === 'string' && m.event ? m.event : 'Announcement');
        chat.announce(m.text);
        logChat('Announcement', m.text, 'announce');
      });
      // ── parties ──
      r.onMessage('party', (m: S2C['party']) => {
        const was = party.view?.members.find((x) => x.leader)?.name;
        const { joined, left } = party.onParty(m);
        if (joined) { hud.closeInvite(null); const lead = party.view?.members.find((x) => x.leader)?.name; hud.toast(lead && lead !== state.player.name ? `You joined ${lead}'s party` : 'Your party is formed'); }
        if (left) hud.toast('You are no longer in a party');
        const now = party.view?.members.find((x) => x.leader)?.name;
        if (!joined && !left && was && now && was !== now) hud.toast(now === state.player.name ? 'You lead the party now' : `${now} leads the party now`);
        chat.setParty(party.view !== null);
        syncParty();
      });
      r.onMessage('partyStatus', (m: S2C['partyStatus']) => { party.onStatus(m); net.party = party.view; });
      r.onMessage('partyInvite', (m: S2C['partyInvite']) => {
        const { invite, fresh } = party.onInvite(m, performance.now());
        syncParty();
        if (!fresh) return; // a refreshed invite: its card is already up (or queued)
        void hud.partyInvite(invite.from, invite.size, Math.max(1, (invite.expiresAt - performance.now()) / 1000)).then((ok) => {
          if (!party.invites.some((i) => i.partyId === invite.partyId)) return; // expired, or joined another party meanwhile
          party.answered(invite.partyId);
          syncParty();
          // decline has no answer from the server; accept answers with `party` (or a refusal)
          if (room) send(room, 'party', { op: ok ? 'accept' : 'decline', partyId: invite.partyId });
        });
      });
      r.onMessage('partyRefused', (m: S2C['partyRefused']) => {
        party.onRefused({ reason: m.reason, text: typeof m.text === 'string' ? m.text : PARTY_TEXT[m.reason] ?? 'Refused' });
        hud.toast(PARTY_TEXT[m.reason] ?? m.text);
        syncParty();
      });
      // ── the Lampfall ──
      r.onMessage('instance', (m: S2C['instance']) => { instance = { view: m, at: performance.now() }; net.instance = m; });
      r.onMessage('victory', (m: S2C['victory']) => {
        net.victory = m;
        net.screen = 'victory';
        hud.dismissEndScreen();
        void hud.endScreen('victory', victoryLines(m), ['Leave the Lampfall', 'Stay'], { title: 'Victory' }).then((i) => {
          if (net.screen === 'victory') net.screen = '';
          if (i === 0 && room === r) send(r, 'leaveInstance', {} as Record<string, never>);
        });
      });
      // Plan 5: looks by engine id (own included), the free creator visit, the Barber's refusals, gold
      r.onMessage('looks', (m: S2C['looks']) => {
        if (lookCache.handle(m).length === 0) return;
        net.remoteLooks = lookCache.codes();
        if (room === r) applyOwnLook();
      });
      r.onMessage('lookFree', (m: S2C['lookFree']) => { lookCache.handleFree(m); net.lookFree = lookCache.free === true; });
      r.onMessage('invRefused', (m: S2C['invRefused']) => {
        const line = barberRefusal(m);
        if (line) hud.toast(line);
        else if (gearCtl) gearCtl.refused(m);
        else { const l = inv.onRefused(m); if (l) hud.toast(l); }
      });
      // Plan 5: the inventory (the only source of what the adventurer owns), loot and level-ups
      r.onMessage('inventory', (m: S2C['inventory']) => {
        if (typeof m?.gold === 'number') net.gold = m.gold;
        if (!inv.onInventory(m)) return;
        net.inventory = inv.view; net.stats = inv.view?.stats ?? null;
        gearCtl?.inventory();
      });
      r.onMessage('loot', (m: S2C['loot']) => { if (gearCtl) gearCtl.loot(m); else inv.onLoot(m); net.lastLoot = inv.lastLoot; });
      r.onMessage('levelUp', (m: S2C['levelUp']) => { if (gearCtl) gearCtl.levelUp(m); else inv.onLevelUp(m); });
      // combat messages: forwarded to the controller once it exists (it is made on entering the room)
      const early: [typeof COMBAT_MESSAGES[number], unknown][] = [];
      for (const type of COMBAT_MESSAGES) r.onMessage(type, (m: unknown) => { if (combat) combat.message(type, m); else early.push([type, m]); });
      r.onMessage('correct', (m: S2C['correct']) => {
        net.corrections++;
        combat?.onCorrect();
        game.walkTo(null);
        rig.place(new Vector3(m.x, m.y, m.z)); // keeps the facing and the camera angle
        Object.assign(sent, { x: m.x, z: m.z, y: m.y });
      });
      r.onMessage('hurt', (m: S2C['hurt']) => { if (m.amount > 0) showHurt(m.amount); });
      // quest views (to this adventurer only): markers follow every one; the Beacon's state is set from the first in
      // each room (a returning adventurer past the plaque sees it risen; the rise itself is the Beacon scene's)
      let beaconSet = false;
      r.onMessage('quests', (m: S2C['quests']) => {
        questView = m;
        story?.setView(m);
        if (!beaconSet) { beaconSet = true; game.world.setBeaconRaised(beaconRaisedFor(m)); }
      });
      r.onMessage('notice', (m: S2C['notice']) => hud.toast(m.text));
      r.onMessage('travel', (m: S2C['travel']) => {
        // The server has moved the adventurer to `m.zone` and ends this session: fade out meanwhile.
        if (travelTo) return;
        travelTo = { zone: m.zone, ...(typeof m.instance === 'string' && m.instance ? { instance: m.instance } : {}) };
        hud.dismissEndScreen();
        combat?.onTravel(); // or its per-frame speed would let the adventurer walk during the fade
        rig.setMoveScale(0);
        game.walkTo(null);
        clearInterval(sendTimer);
        travelLabel.textContent = m.zone === 'lampfall' ? 'Entering the Lampfall…' : `${zoneDef(m.zone).name}…`;
        travelLabel.classList.add('on');
        travelling = { ...travelTo, fade: hud.fade(true, '#16122a', TRAVEL_FADE_S), since: performance.now() };
        // the server ends the session right after `travel`; if it never does, leave it ourselves
        travelTimer = window.setTimeout(() => void r.leave(), TRAVEL_LEAVE_MS);
      });

      const onState = () => {
        const list: NetDebug['remotes'] = [];
        r.state.players?.forEach((p, id) => { if (id !== r.sessionId) list.push({ name: p.name, x: p.x, z: p.z, y: p.y }); });
        net.remotes = list;
        const foes: NetDebug['enemies'] = [];
        r.state.enemies?.forEach((e) => foes.push({ eid: e.eid, kind: e.kind, x: e.x, z: e.z, hp: e.hp, mode: e.mode, windup: e.windup }));
        net.enemies = foes;
        const me = r.state.players?.get(r.sessionId);
        if (me && !entered) enter(me);
        if (me) { state.player.hp = me.hp; state.player.maxHp = me.maxHp; }
      };
      const enter = (me: PlayerView) => {
        entered = true;
        connecting = false;
        state.player.name = me.name;
        rememberName(me.name);
        rig.teleport(new Vector3(me.x, me.y, me.z), me.facing);
        rig.place(new Vector3(me.x, me.y, me.z)); // a re-join in mid-air carries on falling from there
        Object.assign(sent, { x: me.x, z: me.z, y: me.y, facing: me.facing, moving: false });
        room = r;
        setCharacterDetail(game.quality);
        remotes = createRemotes(game.scene, game.world, r, r.sessionId, lookCache);
        ownLookVer = 0;
        applyOwnLook();
        enemies = createEnemies(game.scene, game.world, r);
        combat = createCombat({
          game, hud, room: r, state, remotes, enemies, zone, social: socialView, send: (type, message) => send(r, type, message),
          openTalents: () => gearCtl?.openChar('talents'),
        });
        gearCtl = createGearCtl({
          game, hud, room: r, zone, state, inv, combat, remotes, stalls: () => stalls,
          sealed: () => !!instance?.view.sealed, send: (op) => send(r, 'inv', op),
          labelLayer: (hudRoot.querySelector('.sg-hud') as HTMLElement | null) ?? hudRoot,
        });
        if (inv.view) gearCtl.inventory();
        net.combat = combat.debug;
        for (const [type, m] of early.splice(0)) combat.message(type, m);
        rig.setMoveScale(1);
        hud.setVisible(true);
        netUi.className = '';
        if (travelling) {
          net.travels++;
          net.lastTravelMs = performance.now() - travelling.since;
          travelling = null;
          travelLabel.classList.remove('on');
          void hud.fade(false, '#16122a', TRAVEL_FADE_S);
        }
        const [title, subtitle] = zoneDef(zone).banner;
        hud.banner(title, subtitle);
        sendTimer = window.setInterval(sendPose, 1000 / TICK_HZ);
      };
      const sendPose = () => {
        if (r.reconnection.isReconnecting || !combat || !combat.canSendPose()) return;
        const p = rig.position;
        const pose: C2S['move'] = { x: p.x, z: p.z, y: p.y, facing: rig.facing, moving: rig.moving, ack: combat.ack };
        if (!poseWorthSending(pose, sent) && sentAck === combat.ack) return;
        send(r, 'move', pose);
        net.moves++;
        Object.assign(sent, pose);
        sentAck = combat.ack;
      };
      r.onStateChange(onState);
      onState();
      const enterTimer = window.setTimeout(() => { if (!entered) void r.leave(); }, ENTER_TIMEOUT_MS);

      r.onLeave(() => {
        connecting = false;
        clearTimeout(enterTimer);
        clearTimeout(lostTimer);
        clearTimeout(travelTimer);
        clearInterval(sendTimer);
        combat?.dispose();
        combat = null;
        gearCtl?.dispose(); // its sheets belong to this room: their answers would go nowhere
        gearCtl = null;
        net.stall = null;
        net.combat = null;
        net.self = null;
        // engine ids are unique only within a room: no member keeps this room's eid; the next room's view sends its own
        party.clearEids();
        if (joining === r) joining = null;
        instance = null; net.instance = null; net.boss = null; net.roomId = '';
        if (net.screen === 'victory') { hud.dismissEndScreen(); net.screen = ''; }
        state.party = []; state.boss = null;
        remotes?.dispose();
        remotes = null;
        enemies?.dispose();
        enemies = null;
        room = null;
        // engine ids belong to the room: every look goes with it (the next room sends its own)
        lookCache.clear();
        ownLookVer = 0;
        net.remoteLooks = {};
        net.remotes = [];
        net.enemies = [];
        rig.setMoveScale(0);
        game.walkTo(null);
        hud.setVisible(false);
        netUi.className = 'sg-net-off';
        (document.activeElement as HTMLElement | null)?.blur?.();
        if (travelTo && !kickedFor) { resolve({ travel: travelTo }); return; }
        if (kickedFor) { party.reset(); chat.setParty(false); hud.closeInvite(null); syncParty(); }
        endTravel(); // a kick during a travel (or a travel join that never entered) ends the travel here
        if (kickedFor) forgetToken(); // a reload must not sign in again and kick the other place
        inv.reset(); net.inventory = null; net.stats = null; net.lastLoot = null; // signed out: the next account brings its own
        resolve({ reason: kickedFor || CONNECTION_LOST });
      });
    });
  }

  void (async () => {
    let notice = '';
    let resume = savedToken(); // a reload carries on with this tab's account
    /** Shows the name screen until the adventurer has a name; false when the player must sign in again (`notice` says why). */
    const chooseName = async (token: string): Promise<boolean> => {
      try {
        await showNameScreen(hudRoot, async (name) => {
          const result = await nameAdventurer(token, name);
          if (result.kind === 'named') return result.name;
          if (result.kind === 'alreadyNamed') return name; // named in another tab: just join, the room shows the real name
          if (result.kind === 'signIn') throw new LeaveNameScreen(result.error);
          throw new Error(result.error);
        });
        return true;
      } catch (err) {
        if (!(err instanceof LeaveNameScreen)) throw err;
        forgetToken();
        notice = err.message;
        return false;
      }
    };
    /**
     * The one free creator visit (new and existing adventurers alike): GET /api/look, and when it is unused the creator
     * opens (asking for the name when a named account has none), then POST /api/look. Returns false when the player
     * must sign in again (`notice` says why), with the name the adventurer has after it (null: still none).
     */
    const creatorStep = async (token: string): Promise<{ ok: boolean; name: string | null | undefined }> => {
      const got = await fetchLookInfo(token);
      if (got.kind === 'signIn') { forgetToken(); notice = got.error; return { ok: false, name: undefined }; }
      if (got.kind === 'error') return { ok: true, name: undefined }; // the game goes on; the creator waits for next time
      net.lookFree = got.info.free;
      const plan = creatorPlan(got.info);
      if (!plan.open) return { ok: true, name: got.info.name };
      let look = startingLook(got.info, token), line: string | undefined;
      for (;;) {
        net.creatorOpen = true;
        const res = await hud.creator({ look, mode: 'create', needsName: plan.needsName, gold: 0, free: true, validateName: validateAdventurerName, notice: line });
        net.creatorOpen = false;
        if (!res) return { ok: true, name: got.info.name };
        look = res.look;
        const saved = await saveLook(token, res.look, plan.needsName ? res.name : undefined);
        if (saved.kind === 'saved') { net.lookFree = false; if (saved.info.name) rememberName(saved.info.name); return { ok: true, name: saved.info.name }; }
        if (saved.kind === 'notFree') return { ok: true, name: got.info.name };
        if (saved.kind === 'signIn') { forgetToken(); notice = saved.error; return { ok: false, name: undefined }; }
        line = saved.error; // a refused name (or a hiccup): the creator opens again with the line
      }
    };
    /** Builds `zone` if it is not the one loaded. */
    const ensureZone = (place: ZonePlace | ZoneId) => {
      const zone = typeof place === 'string' ? place : place.zone;
      net.zone = zone;
      if (game.zone === zone) return;
      const t0 = performance.now();
      // a zone this client cannot draw yet (a newer server): say so plainly rather than "try again", which would fail
      // the same way (Plan 4 may add a way back to the grove from the server's side)
      if (!isZoneBuilt(zone)) { net.zone = game.zone as ZoneId; throw new ZoneClosedError(zoneClosedNotice(zone)); }
      try { game.loadZone(zone); } catch { net.zone = game.zone as ZoneId; throw new Error(LOAD_FAILED); }
      net.lastLoadMs = performance.now() - t0;
    };
    /**
     * Joins the adventurer's zone: `zone` when known (a travel), else whatever /api/zone says. A join refused
     * because the adventurer is somewhere else asks /api/zone again and tries once more.
     */
    const join = async (token: string, place: ZonePlace | null): Promise<{ r: ZoneRoom; zone: ZoneId }> => {
      let z = place ?? await zoneFor(token);
      ensureZone(z);
      try {
        return { r: await connect(token, z.zone, z.instance), zone: z.zone };
      } catch (err) {
        if (!(err instanceof Error) || err.message !== REASON_ELSEWHERE) throw err;
        z = await zoneFor(token);
        ensureZone(z);
        return { r: await connect(token, z.zone, z.instance), zone: z.zone };
      }
    };
    let travelToken: string | null = null;
    for (;;) {
      let token: string | null = travelToken ?? resume;
      const arriving = travelling as { zone: ZoneId; instance?: string; fade: Promise<void>; since: number } | null;
      travelToken = null;
      resume = null;
      if (!token) {
        const session = await showLogin(hudRoot, notice, savedAccount());
        token = session.token;
        // the creator first (it asks for the name too); the old name screen only when the name is still missing
        const made = await creatorStep(token);
        if (!made.ok) continue;
        const name = made.name === undefined ? session.name : made.name;
        if (name === null && !(await chooseName(token))) continue;
      } else if (!arriving) {
        // a reload: a creator visit still unused opens now
        const made = await creatorStep(token);
        if (!made.ok) continue;
      }
      let joined: { r: ZoneRoom; zone: ZoneId };
      connecting = true;
      try {
        if (arriving) await arriving.fade; // build the next zone behind the faded screen
        joined = await join(token, arriving ? { zone: arriving.zone, ...(arriving.instance ? { instance: arriving.instance } : {}) } : null);
      } catch (err) {
        connecting = false;
        endTravel();
        const message = err instanceof Error ? err.message : CONNECTION_LOST;
        if (message === REASON_NAME_FIRST) {
          // A reload while choosing a name: carry on choosing it, then join.
          if (await chooseName(token)) resume = token;
          continue;
        }
        if (!KEEP_TOKEN_ON.has(message) && !(err instanceof ZoneClosedError)) forgetToken(); // refused: back to the plain login screen
        notice = message;
        continue;
      }
      const ended = await play(joined.r, joined.zone);
      if ('travel' in ended) { travelToken = token; continue; }
      notice = ended.reason;
    }
  })();
}

function send<K extends keyof C2S>(r: ZoneRoom, type: K, message: C2S[K]): void {
  r.send(type, message);
}

boot();
