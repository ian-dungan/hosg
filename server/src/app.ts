// The game server: the accounts API, health check and client files over Express, and the Colyseus zone room, on one port.
import { once } from 'node:events';
import type { Server as HttpServer } from 'node:http';
import express from 'express';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { RECONNECT_SECONDS, SAVE_SECONDS, TICK_HZ } from '@sg2/shared';
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
}

export interface App {
  listen(port: number): Promise<void>;
  close(): Promise<void>;
  stats(): { players: number; tickHz: number };
}

// Room messages are small; this leaves room for a full chat line (CHAT_MAX characters of any script).
const MAX_WS_PAYLOAD = 16 * 1024;

export function createApp(opts: AppOptions): App {
  const live = new Set<ZoneRoom>();
  const players = () => [...live].reduce((n, room) => n + room.playerCount, 0);

  const transport = new WebSocketTransport({ maxPayload: MAX_WS_PAYLOAD });
  const gameServer = new Server({
    transport,
    greet: false,
    gracefullyShutdown: false, // index.ts handles signals and calls close()
    express: (app) => {
      app.use('/api', authRouter(opts.store, opts.jwtSecret, { ratePerMinute: opts.authRatePerMinute }));
      app.get('/healthz', (_req, res) => {
        res.json({ ok: true, players: players() });
      });
      if (opts.clientDir) app.use(express.static(opts.clientDir));
    },
  });

  const roomOptions: ZoneRoomOptions = {
    store: opts.store,
    reconnectSeconds: opts.reconnectSeconds ?? RECONNECT_SECONDS,
    saveSeconds: opts.saveSeconds ?? SAVE_SECONDS,
    live,
  };
  gameServer.define('grove', zoneRoomFor(opts.store, opts.jwtSecret), roomOptions);

  return {
    async listen(port) {
      await gameServer.listen(port);
    },

    /** Saves and disconnects everyone, then closes the HTTP server and its open connections. */
    async close() {
      const http = transport.server as HttpServer | undefined;
      const closed = http?.listening ? once(http, 'close') : undefined;
      await gameServer.gracefullyShutdown(false); // also stops the HTTP server accepting connections
      http?.closeAllConnections(); // idle keep-alive connections would hold it open
      await closed;
    },

    stats() {
      return { players: players(), tickHz: TICK_HZ };
    },
  };
}
