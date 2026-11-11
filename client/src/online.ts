// Shady Grove 2 — online: sign in, then walk the grove with everyone else who is here.
// The server owns positions; this page sends the adventurer's pose and draws the others.
import { Vector3 } from '@babylonjs/core';
import { RECONNECT_SECONDS, TICK_HZ, type C2S, type S2C } from '@sg2/shared';
import type { HudState } from './core/contracts';
import { bootGame } from './boot';
import { h } from './hud/dom';
import { createChat } from './net/chatBox';
import { showLogin } from './net/loginScreen';
import { createRemotes, type Remotes } from './net/remotes';
import { connect, forgetToken, savedToken, type GroveRoom } from './net/session';

const CONNECTION_LOST = 'Connection lost';
/** Longest wait after joining for the room to show this adventurer. */
const ENTER_TIMEOUT_MS = 15_000;
/** Smallest pose change worth sending (m or rad); the rig's slow-down never quite reaches zero. */
const POSE_EPSILON = 1e-3;

const CSS = /* css */ `
.sg-online{position:absolute;right:calc(var(--sr) + var(--g));top:calc(var(--st) + var(--g));padding:4px 12px;border-radius:12px;
  font-size:13px;font-weight:600;background:rgba(16,18,42,.45)}
.sg-online.away{color:#ffd9a0}
.sg-net-off{display:none}
`;

interface NetDebug { remotes: { name: string; x: number; z: number }[] }

function boot(): void {
  let room: GroveRoom | null = null;
  let remotes: Remotes | null = null;

  const game = bootGame({ busy: () => !room });
  const { hud, rig, scene, world, hudRoot } = game;
  rig.setMoveScale(0);
  hud.setVisible(false);

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const netUi = h('div', 'sg-net-off', hudRoot);
  const status = h('div', 'sg-online', h('div', 'sg-hud', netUi));
  const chat = createChat(netUi, (text) => room && send(room, 'chat', { text }));

  const net: NetDebug = { remotes: [] };
  (window as unknown as { __sg2net: NetDebug }).__sg2net = net;

  const state: HudState = {
    player: { name: 'Adventurer', hp: 100, maxHp: 100, statuses: [], level: 1, weapon: 'blade', cast: null },
    target: null,
    party: [],
    slots: [],
    quest: null,
    prompt: null,
    inCombat: false,
  };

  let statusText = '';
  game.start((dt) => {
    remotes?.update(dt);
    let text = '';
    if (room) text = room.reconnection.isReconnecting ? 'Reconnecting…' : `Adventurers online: ${room.state.players?.size ?? 0}`;
    if (text !== statusText) {
      statusText = text;
      status.textContent = text;
      status.classList.toggle('away', text === 'Reconnecting…');
    }
    hud.render(state);
  });

  /** Plays one connection until it ends; resolves with what the login screen should say. */
  function play(r: GroveRoom): Promise<string> {
    return new Promise((resolve) => {
      let kickedFor = '';
      let lostTimer = 0;
      let sendTimer = 0;
      let entered = false;
      const sent = { x: NaN, z: NaN, facing: NaN, moving: false };

      // Reconnect for up to RECONNECT_SECONDS, however long the room has been up, then give up.
      Object.assign(r.reconnection, { minUptime: 0, maxRetries: 1000, maxDelay: 2000 });
      r.onDrop(() => {
        rig.setMoveScale(0);
        game.walkTo(null);
        if (!lostTimer) lostTimer = window.setTimeout(() => void r.leave(), RECONNECT_SECONDS * 1000);
      });
      r.onReconnect(() => {
        clearTimeout(lostTimer);
        lostTimer = 0;
        rig.setMoveScale(1);
        sent.x = NaN; // the server may have missed the last pose: send it again
      });
      r.onMessage('kicked', (m: S2C['kicked']) => { kickedFor = m.reason; });
      r.onMessage('chat', (m: S2C['chat']) => chat.add(m.from, m.text));
      r.onMessage('correct', (m: S2C['correct']) => {
        game.walkTo(null);
        rig.teleport(new Vector3(m.x, 0, m.z), rig.facing);
        Object.assign(sent, { x: m.x, z: m.z });
      });

      const onState = () => {
        const list: NetDebug['remotes'] = [];
        r.state.players?.forEach((p, id) => { if (id !== r.sessionId) list.push({ name: p.name, x: p.x, z: p.z }); });
        net.remotes = list;
        const me = r.state.players?.get(r.sessionId);
        if (me && !entered) enter(me);
      };
      const enter = (me: { name: string; x: number; z: number; facing: number }) => {
        entered = true;
        state.player.name = me.name;
        rig.teleport(new Vector3(me.x, 0, me.z), me.facing);
        Object.assign(sent, { x: me.x, z: me.z, facing: me.facing, moving: false });
        room = r;
        remotes = createRemotes(scene, world, r, r.sessionId);
        rig.setMoveScale(1);
        hud.setVisible(true);
        netUi.className = '';
        hud.banner('The Plaza of the Two', 'Shady Grove');
        sendTimer = window.setInterval(sendPose, 1000 / TICK_HZ);
      };
      const sendPose = () => {
        if (r.reconnection.isReconnecting) return;
        const p = rig.position;
        const pose: C2S['move'] = { x: p.x, z: p.z, facing: rig.facing, moving: rig.moving };
        if (Math.abs(pose.x - sent.x) < POSE_EPSILON && Math.abs(pose.z - sent.z) < POSE_EPSILON
          && Math.abs(pose.facing - sent.facing) < POSE_EPSILON && pose.moving === sent.moving) return;
        send(r, 'move', pose);
        Object.assign(sent, pose);
      };
      r.onStateChange(onState);
      onState();
      const enterTimer = window.setTimeout(() => { if (!entered) void r.leave(); }, ENTER_TIMEOUT_MS);

      r.onLeave(() => {
        clearTimeout(enterTimer);
        clearTimeout(lostTimer);
        clearInterval(sendTimer);
        remotes?.dispose();
        remotes = null;
        room = null;
        net.remotes = [];
        rig.setMoveScale(0);
        game.walkTo(null);
        hud.setVisible(false);
        netUi.className = 'sg-net-off';
        (document.activeElement as HTMLElement | null)?.blur?.();
        if (kickedFor) forgetToken(); // a reload must not sign in again and kick the other place
        resolve(kickedFor || CONNECTION_LOST);
      });
    });
  }

  void (async () => {
    let notice = '';
    let resume = savedToken(); // a reload carries on with this tab's account
    for (;;) {
      const token = resume ?? (await showLogin(hudRoot, notice)).token;
      resume = null;
      let r: GroveRoom;
      try {
        r = await connect(token);
      } catch (err) {
        forgetToken();
        notice = err instanceof Error ? err.message : CONNECTION_LOST;
        continue;
      }
      notice = await play(r);
    }
  })();
}

function send<K extends keyof C2S>(r: GroveRoom, type: K, message: C2S[K]): void {
  r.send(type, message);
}

boot();
