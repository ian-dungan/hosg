// Request limits over fixed one-minute windows: per IP (the middleware), or per any key (createLimiter).
import type { RequestHandler } from 'express';

const WINDOW_MS = 60_000;

/** Counts hits per key in fixed one-minute windows: `hit` is false once a key is past `perMinute`. */
export function createLimiter(perMinute: number): { hit(key: string): boolean } {
  const windows = new Map<string, { count: number; resetAt: number }>();
  let nextSweep = 0;
  return {
    hit(key) {
      const now = Date.now();
      if (now >= nextSweep) {
        // Forget finished windows so the map does not grow with every key ever seen.
        for (const [k, w] of windows) if (now >= w.resetAt) windows.delete(k);
        nextSweep = now + WINDOW_MS;
      }
      let w = windows.get(key);
      if (!w || now >= w.resetAt) {
        w = { count: 0, resetAt: now + WINDOW_MS };
        windows.set(key, w);
      }
      w.count++;
      return w.count <= perMinute;
    },
  };
}

/** The address a request came from (as express sees it: behind a trusted proxy, the client's). */
export const ipOf = (req: { ip?: string; socket: { remoteAddress?: string } }): string => req.ip ?? req.socket.remoteAddress ?? 'unknown';

export function rateLimit(perMinute: number, message: string): RequestHandler {
  const limiter = createLimiter(perMinute);
  return (req, res, next) => {
    if (!limiter.hit(ipOf(req))) {
      res.status(429).json({ error: message });
      return;
    }
    next();
  };
}
