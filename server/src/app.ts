// The game server: the accounts API, health check and client files over Express, and one Colyseus room per zone, on one port.
import { once } from 'node:events';
import type { Server as HttpServer } from 'node:http';
import express from 'express';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { AUTO_RESPAWN_S, MAX_PLAYERS, RECONNECT_SECONDS, SAVE_SECONDS, ZONE_IDS, zoneDef, type ZoneDef, type ZoneId } from '@sg2/shared';
import { authRouter } from './auth/routes';
import type { Store } from './store/types';
import { Presence } from './rooms/presence';
import { zoneRoomFor, type ZoneRoom, type ZoneRoomOptions } from './rooms/ZoneRoom';

export interface AppOptions {
  store: Store;
  jwtSecret: string;
  clientDir?: string;
  reconnectSeconds?: number;
  saveSeconds?: number;
  authRatePerMinute?: number;
  /** Reverse proxies in front of the server whose X-Forwarded-For is believed (Express's `trust proxy` hop count); none when unset. */
  trustProxy?: number;
  /** Test-only: smaller zones (default MAX_PLAYERS in each zone's room). */
  maxPlayers?: number;
  /** Test-only: fields merged over each zone's zoneDef (its surface, spawn, exits, ...). */
  zones?: Partial<Record<ZoneId, Partial<ZoneDef>>>;
  /** Exits to open at start, beside those open by default: from zone -> destinations (SG2_OPEN_EXITS). */
  openExits?: Partial<Record<ZoneId, readonly ZoneId[]>>;
  /** Seed of each zone's combat engine (fixed in tests; random by default). */
  combatSeed?: number;
  /** Test-only: the rooms' combat clock in seconds, monotonic (default: each room's own performance.now()). */
  combatClock?: () => number;
  /** Test-only: seconds after a death before an adventurer gets up by itself (default AUTO_RESPAWN_S). */
  autoRespawnSeconds?: number;
  /** Test-only: the wall clock (ms) the rooms' movement checks and budgets use (default Date.now). */
  wallClock?: () => number;
  /** Test-only: how long a failed respawn save waits before it is tried again (ms; default 5000). */
  respawnRetryMs?: number;
}

/** One zone's numbers in stats() and /healthz. */
export interface ZoneStats { players: number; tickHz: number; tickMs: number; patchMs: number; stepErrors: number }

export interface App {
  listen(port: number): Promise<void>;
  close(): Promise<void>;
  /**
   * Adventurers online, and state patches sent per second over the last 5 s: in all, and per zone.
   * The overall tickHz is the lowest among zones with adventurers (the grove's when none have any).
   * Each zone's tickMs is the p95 of its room step's time over the last 5 s, and patchMs that of its
   * state patches (one encode per client's view); stepErrors counts the failures its steps and
   * handlers caught (and carried on from) since it started.
   */
  stats(): { players: number; tickHz: number; zones: Record<ZoneId, ZoneStats> };
  /** Whether the exits from `from` to `to` are open now. */
  isExitOpen(from: ZoneId, to: ZoneId): boolean;
  /** Opens or shuts the exits from `from` to `to`, at once, for every adventurer (gates are server state). */
  setExitOpen(from: ZoneId, to: ZoneId, open: boolean): void;
}

// Room messages are small; this leaves room for a full chat line (CHAT_MAX characters of any script).
const MAX_WS_PAYLOAD = 16 * 1024;

export function createApp(opts: AppOptions): App {
  const rooms = new Map<ZoneId, ZoneRoom>();
  const presence = new Presence();
  const zones = new Map<ZoneId, ZoneDef>(ZONE_IDS.map((id) => [id, { ...zoneDef(id), ...opts.zones?.[id], id }]));

  // Open gates by "from>to": each exit's own default, then openExits.
  const openGates = new Set<string>();
  const gate = (from: ZoneId, to: ZoneId) => `${from}>${to}`;
  for (const zone of zones.values()) for (const exit of zone.exits) if (exit.open) openGates.add(gate(zone.id, exit.to));
  for (const [from, tos] of Object.entries(opts.openExits ?? {}) as [ZoneId, readonly ZoneId[]][]) {
    for (const to of tos) openGates.add(gate(from, to));
  }
  const isExitOpen = (from: ZoneId, to: ZoneId) => openGates.has(gate(from, to));

  const round = (hz: number) => Math.round(hz * 10) / 10;
  const stats = () => {
    const perZone = Object.fromEntries(
      ZONE_IDS.map((id) => {
        const room = rooms.get(id);
        return [id, {
          players: room?.playerCount ?? 0, tickHz: round(room?.measuredPatchHz ?? 0), tickMs: Math.round((room?.tickMsP95 ?? 0) * 100) / 100,
          patchMs: Math.round((room?.patchMsP95 ?? 0) * 100) / 100, stepErrors: room?.stepErrors ?? 0,
        }];
      }),
    ) as Record<ZoneId, ZoneStats>;
    const busy = ZONE_IDS.filter((id) => perZone[id].players > 0).map((id) => perZone[id].tickHz);
    return {
      players: ZONE_IDS.reduce((n, id) => n + perZone[id].players, 0),
      tickHz: busy.length > 0 ? Math.min(...busy) : perZone.grove.tickHz,
      zones: perZone,
    };
  };

  const transport = new WebSocketTransport({ maxPayload: MAX_WS_PAYLOAD });
  const gameServer = new Server({
    transport,
    greet: false,
    gracefullyShutdown: false, // index.ts handles signals and calls close()
    express: (app) => {
      if (opts.trustProxy !== undefined) app.set('trust proxy', opts.trustProxy); // before the login limit reads req.ip
      app.use('/api', authRouter(opts.store, opts.jwtSecret, { ratePerMinute: opts.authRatePerMinute }));
      app.get('/healthz', (_req, res) => {
        // Memory in MB: resident now, and the most this process has held since it started (maxRSS is in KB).
        const rssMb = Math.round(process.memoryUsage.rss() / 2 ** 20);
        const peakRssMb = Math.round(process.resourceUsage().maxRSS / 1024);
        res.json({ ok: true, ...stats(), rssMb, peakRssMb });
      });
      if (opts.clientDir) app.use(express.static(opts.clientDir));
    },
  });

  for (const zone of zones.values()) {
    const roomOptions: ZoneRoomOptions = {
      store: opts.store,
      reconnectSeconds: opts.reconnectSeconds ?? RECONNECT_SECONDS,
      saveSeconds: opts.saveSeconds ?? SAVE_SECONDS,
      maxPlayers: opts.maxPlayers ?? MAX_PLAYERS,
      zone,
      presence,
      rooms,
      isExitOpen,
      combatSeed: opts.combatSeed ?? Math.floor(Math.random() * 2 ** 31),
      combatClock: opts.combatClock,
      autoRespawnSeconds: opts.autoRespawnSeconds ?? AUTO_RESPAWN_S,
      wallClock: opts.wallClock,
      respawnRetryMs: opts.respawnRetryMs,
    };
    gameServer.define(zone.id, zoneRoomFor(roomOptions, opts.jwtSecret), roomOptions); // room name = zone id
  }

  return {
    /** Rejects (e.g. EADDRINUSE) when the port cannot be bound. */
    async listen(port) {
      // Colyseus never settles listen() when the bind fails (it only prints the error), so race the
      // HTTP server's 'error' instead, with Colyseus's printing listeners set aside meanwhile.
      const http = transport.server as HttpServer;
      const printers = http.listeners('error') as ((err: Error) => void)[];
      http.removeAllListeners('error');
      const stopWatching = new AbortController();
      const bindFailed = once(http, 'error', { signal: stopWatching.signal }).then(([err]) => Promise.reject(err));
      bindFailed.catch(() => {}); // settled by the race below, or aborted once listening
      try {
        await Promise.race([gameServer.listen(port), bindFailed]);
      } finally {
        stopWatching.abort();
        for (const print of printers) http.on('error', print);
      }
      // Each zone's one room, made up front so joins and travellers find it (a join that got in first already made it).
      for (const id of ZONE_IDS) if (!rooms.has(id)) await matchMaker.createRoom(id, {});
    },

    /** Saves and disconnects everyone, then closes the HTTP server and its open connections. */
    async close() {
      const http = transport.server as HttpServer | undefined;
      const closed = http?.listening ? once(http, 'close') : undefined;
      await gameServer.gracefullyShutdown(false); // also stops the HTTP server accepting connections
      http?.closeAllConnections(); // idle keep-alive connections would hold it open
      await closed;
    },

    stats,
    isExitOpen,
    setExitOpen(from, to, open) {
      if (open) openGates.add(gate(from, to));
      else openGates.delete(gate(from, to));
    },
  };
}
