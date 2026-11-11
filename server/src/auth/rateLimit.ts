// Per-IP request limit over fixed one-minute windows.
import type { RequestHandler } from 'express';

const WINDOW_MS = 60_000;

export function rateLimit(perMinute: number, message: string): RequestHandler {
  const windows = new Map<string, { count: number; resetAt: number }>();
  let nextSweep = 0;

  return (req, res, next) => {
    const now = Date.now();
    if (now >= nextSweep) {
      // Forget finished windows so the map does not grow with every address ever seen.
      for (const [ip, w] of windows) if (now >= w.resetAt) windows.delete(ip);
      nextSweep = now + WINDOW_MS;
    }
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    let w = windows.get(ip);
    if (!w || now >= w.resetAt) {
      w = { count: 0, resetAt: now + WINDOW_MS };
      windows.set(ip, w);
    }
    w.count++;
    if (w.count > perMinute) {
      res.status(429).json({ error: message });
      return;
    }
    next();
  };
}
