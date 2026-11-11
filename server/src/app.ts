// The game server: the accounts API, health check and client files over Express, and the Colyseus zone room, on one port.
import { once } from 'node:events';
import type { Server as HttpServer } from 'node:http';
import express from 'express';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { MAX_PLAYERS, RECONNECT_SECONDS, SAVE_SECONDS } from '@sg2/shared';
import { authRouter } from './auth/routes';
import type { Store } from './store/types';
import { zoneRoomFor, type ZoneRoom, type ZoneRoomOptions } from './rooms/ZoneRoom';

export interface AppOptions {
  store: Store;
  jwtSecret: string;
  clientDir?: string;
  reconnectSeconds?: number;
  saveSeconds?: number;
  authRatePerMinute?: number;
  /** Test-only: a smaller grove (default MAX_PLAYERS). */
  maxPlayers?: number;
}

export interface App {
  listen(port: number): Promise<void>;
  close(): Promise<void>;
  /** Adventurers online, and state patches sent per second over the last 5 s. */
  stats(): { players: number; tickHz: number };
}

// Room messages are small; this leaves room for a full chat line (CHAT_MAX characters of any script).
const MAX_WS_PAYLOAD = 16 * 1024;

export function createApp(opts: AppOptions): App {
  const live = new Set<ZoneRoom>();
  const players = () => [...live].reduce((n, room) => n + room.playerCount, 0);
  const tickHz = () => Math.round(([...live][0]?.measuredPatchHz ?? 0) * 10) / 10;
  const stats = () => ({ players: players(), tickHz: tickHz() });

  const transport = new WebSocketTransport({ maxPayload: MAX_WS_PAYLOAD });
  const gameServer = new Server({
    transport,
    greet: false,
    gracefullyShutdown: false, // index.ts handles signals and calls close()
    express: (app) => {
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

  const roomOptions: ZoneRoomOptions = {
    store: opts.store,
    reconnectSeconds: opts.reconnectSeconds ?? RECONNECT_SECONDS,
    saveSeconds: opts.saveSeconds ?? SAVE_SECONDS,
    maxPlayers: opts.maxPlayers ?? MAX_PLAYERS,
    live,
  };
  gameServer.define('grove', zoneRoomFor(roomOptions, opts.jwtSecret), roomOptions);

  return {
    async listen(port) {
      await gameServer.listen(port);
      // The one grove room, made up front so joins find it (a join that got in first already made it).
      if (live.size === 0) await matchMaker.createRoom('grove', {});
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
  };
}
