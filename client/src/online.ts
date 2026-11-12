// Shady Grove 2 — online: sign in, then walk the world with everyone else who is here.
// The server owns positions; this page sends the adventurer's pose and draws the others and the enemies.
// One room per zone: the page asks the server which zone the adventurer is in, builds that zone and joins
// its room. Walking through an open gate makes the server send `travel`: the screen fades, the room ends,
// the next zone is built on the same engine, its room is joined, and the screen fades back in.
import { Matrix, Vector3 } from '@babylonjs/core';
import {
  CLIENT_RECONNECTION,
  REASON_ELSEWHERE,
  REASON_NAME_FIRST,
  RECONNECT_SECONDS,
  TICK_HZ,
  zoneDef,
  zoneFullReason,
  type C2S,
  type S2C,
  type ZoneId,
} from '@sg2/shared';
import type { HudState } from './core/contracts';
import { bootGame } from './boot';
import { h } from './hud/dom';
import { createChat } from './net/chatBox';
import { showLogin } from './net/loginScreen';
import { LeaveNameScreen, showNameScreen } from './net/nameScreen';
import { createRemotes, type Remotes } from './net/remotes';
import { createEnemies, type Enemies } from './net/enemies';
import { COMBAT_MESSAGES, createCombat, type CombatController, type CombatDebug } from './combat/controller';
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
  type SentPose,
  type ZoneRoom,
} from './net/session';

const CONNECTION_LOST = 'Connection lost';
const CONNECTING = 'Connecting…';
const RECONNECTING = 'Reconnecting…';
/** Join refusals that say nothing against the account: its saved token is kept, so "Continue as" stays on offer. */
/** The page could not build the zone the adventurer is in (the previous one was put back, or the page reloads). */
const LOAD_FAILED = "Couldn't load that area, try again";
const KEEP_TOKEN_ON = new Set([LOAD_FAILED, UNREACHABLE, zoneFullReason('grove'), zoneFullReason('greenway')]);
/** How long the screen takes to fade out and back in around a zone change, in s. */
const TRAVEL_FADE_S = 0.6;
/** Longest wait after joining for the room to show this adventurer. */
const ENTER_TIMEOUT_MS = 15_000;
/** Longest wait after `travel` for the server to end the session before the page leaves the room itself. */
const TRAVEL_LEAVE_MS = 5_000;

const CSS = /* css */ `
.sg-online{position:absolute;right:calc(var(--sr) + var(--g) + 58px);top:calc(var(--st) + var(--g));padding:4px 12px;border-radius:12px;
  font-size:13px;font-weight:600;background:rgba(16,18,42,.45)}
.sg-online.away{color:#ffd9a0}
@media (max-width:700px) and (orientation:portrait){ .sg-online{right:auto;left:50%;transform:translateX(-50%);top:auto;bottom:calc(var(--sb) + 4px);font-size:11px;padding:2px 8px;background:none} }
.sg-online:empty{display:none}
.sg-net-off{display:none}
.sg-travel{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;pointer-events:none;
  font:600 18px/1.3 var(--sans,system-ui,sans-serif);color:#fff6e6;letter-spacing:.04em;text-shadow:0 1px 6px rgba(0,0,0,.6);
  opacity:0;transition:opacity .3s}
.sg-travel.on{opacity:1}
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
  /** This adventurer's combat numbers as the server states them (null before entering). */
  self: { hp: number; momentum: number; dead: boolean; target: number | null } | null;
  /** Combat fx events received so far. */
  fxSeen: number;
  /** The controller's counters (dodges, refusals, corrections, ...). */
  combat: CombatDebug | null;
  /** Moves sent (and with which ack, the last). */
  moves: number;
}
/** What ended a connection: a reason for the login screen, or a travel to another zone. */
type Ended = { reason: string } | { travel: ZoneId };

function boot(): void {
  let room: ZoneRoom | null = null;
  let remotes: Remotes | null = null;
  let enemies: Enemies | null = null;
  let combat: CombatController | null = null;

  const game = bootGame({ busy: () => !room, onTap: (tap) => combat?.onTap(tap) ?? false });
  const { hud, hudRoot } = game;
  game.rig.setMoveScale(0);
  game.onZoneLoaded(() => game.rig.setMoveScale(0)); // a new zone's adventurer waits for its room
  hud.setVisible(false);

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const netUi = h('div', 'sg-net-off', hudRoot);
  // Outside netUi, so "Connecting…" shows before the room does.
  const status = h('div', 'sg-online', h('div', 'sg-hud', hudRoot));
  const chat = createChat(netUi, (text) => room && send(room, 'chat', { text }));
  const travelLabel = h('div', 'sg-travel', document.body);

  const net: NetDebug = { remotes: [], enemies: [], zone: game.zone as ZoneId, travels: 0, lastTravelMs: 0, lastLoadMs: 0, self: null, fxSeen: 0, combat: null, moves: 0 };
  hud.on((e) => combat?.onHud(e));
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
  };

  const state: HudState = {
    player: { name: 'Adventurer', hp: 100, maxHp: 100, statuses: [], level: 1, weapon: 'blade', cast: null },
    target: null,
    party: [],
    slots: [],
    quest: null,
    prompt: null,
    inCombat: false,
  };

  /** From asking to join until this adventurer is in the room (or the attempt ends). */
  let connecting = false;
  let statusText = '';
  game.start((dt) => {
    remotes?.update(dt);
    enemies?.update(dt);
    combat?.update(dt);
    if (combat) { net.self = combat.debug.self; net.fxSeen = combat.debug.fxSeen; }
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

  /** Set from a `travel` message until the next room is entered: the zone, the fade and when it began. */
  let travelling: { zone: ZoneId; fade: Promise<void>; since: number } | null = null;
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
      let travelTo: ZoneId | null = null;
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
      r.onMessage('chat', (m: S2C['chat']) => chat.add(m.from, m.text));
      // combat messages: forwarded to the controller once it exists (it is made on entering the room)
      const early: [typeof COMBAT_MESSAGES[number], unknown][] = [];
      for (const type of COMBAT_MESSAGES) r.onMessage(type, (m: unknown) => { if (combat) combat.message(type, m); else early.push([type, m]); });
      r.onMessage('correct', (m: S2C['correct']) => {
        combat?.onCorrect();
        game.walkTo(null);
        rig.place(new Vector3(m.x, m.y, m.z)); // keeps the facing and the camera angle
        Object.assign(sent, { x: m.x, z: m.z, y: m.y });
      });
      r.onMessage('hurt', (m: S2C['hurt']) => { if (m.amount > 0) showHurt(m.amount); });
      r.onMessage('notice', (m: S2C['notice']) => hud.toast(m.text));
      r.onMessage('travel', (m: S2C['travel']) => {
        // The server has moved the adventurer to `m.zone` and ends this session: fade out meanwhile.
        if (travelTo) return;
        travelTo = m.zone;
        hud.dismissEndScreen();
        combat?.onTravel(); // or its per-frame speed would let the adventurer walk during the fade
        rig.setMoveScale(0);
        game.walkTo(null);
        clearInterval(sendTimer);
        travelLabel.textContent = `${zoneDef(m.zone).name}…`;
        travelLabel.classList.add('on');
        travelling = { zone: m.zone, fade: hud.fade(true, '#16122a', TRAVEL_FADE_S), since: performance.now() };
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
        remotes = createRemotes(game.scene, game.world, r, r.sessionId);
        enemies = createEnemies(game.scene, game.world, r);
        combat = createCombat({ game, hud, room: r, state, remotes, enemies, send: (type, message) => send(r, type, message) });
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
        net.combat = null;
        net.self = null;
        remotes?.dispose();
        remotes = null;
        enemies?.dispose();
        enemies = null;
        room = null;
        net.remotes = [];
        net.enemies = [];
        rig.setMoveScale(0);
        game.walkTo(null);
        hud.setVisible(false);
        netUi.className = 'sg-net-off';
        (document.activeElement as HTMLElement | null)?.blur?.();
        if (travelTo && !kickedFor) { resolve({ travel: travelTo }); return; }
        endTravel(); // a kick during a travel (or a travel join that never entered) ends the travel here
        if (kickedFor) forgetToken(); // a reload must not sign in again and kick the other place
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
    /** Builds `zone` if it is not the one loaded. */
    const ensureZone = (zone: ZoneId) => {
      net.zone = zone;
      if (game.zone === zone) return;
      const t0 = performance.now();
      try { game.loadZone(zone); } catch { net.zone = game.zone as ZoneId; throw new Error(LOAD_FAILED); }
      net.lastLoadMs = performance.now() - t0;
    };
    /**
     * Joins the adventurer's zone: `zone` when known (a travel), else whatever /api/zone says. A join refused
     * because the adventurer is somewhere else asks /api/zone again and tries once more.
     */
    const join = async (token: string, zone: ZoneId | null): Promise<{ r: ZoneRoom; zone: ZoneId }> => {
      let z = zone ?? await zoneFor(token);
      ensureZone(z);
      try {
        return { r: await connect(token, z), zone: z };
      } catch (err) {
        if (!(err instanceof Error) || err.message !== REASON_ELSEWHERE) throw err;
        z = await zoneFor(token);
        ensureZone(z);
        return { r: await connect(token, z), zone: z };
      }
    };
    let travelToken: string | null = null;
    for (;;) {
      let token: string | null = travelToken ?? resume;
      const arriving = travelling as { zone: ZoneId; fade: Promise<void>; since: number } | null;
      travelToken = null;
      resume = null;
      if (!token) {
        const session = await showLogin(hudRoot, notice, savedAccount());
        token = session.token;
        if (session.name === null && !(await chooseName(token))) continue;
      }
      let joined: { r: ZoneRoom; zone: ZoneId };
      connecting = true;
      try {
        if (arriving) await arriving.fade; // build the next zone behind the faded screen
        joined = await join(token, arriving?.zone ?? null);
      } catch (err) {
        connecting = false;
        endTravel();
        const message = err instanceof Error ? err.message : CONNECTION_LOST;
        if (message === REASON_NAME_FIRST) {
          // A reload while choosing a name: carry on choosing it, then join.
          if (await chooseName(token)) resume = token;
          continue;
        }
        if (!KEEP_TOKEN_ON.has(message)) forgetToken(); // refused: back to the plain login screen
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
