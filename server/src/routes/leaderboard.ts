// The boss leaderboard: GET /api/leaderboard/:boss?size=n answers { entries: [{ names, seconds, at }] },
// the ten fastest kills of that boss (wickhound or fallen_warden) at that party size (1–4). Public and
// read-only: adventurer names, seconds and the kill's time only. Rate-limited per address; anything
// malformed is a 400.
import express from 'express';
import { rateLimit } from '../auth/rateLimit';
import { BOSS_KILL_BOSSES, type BossKill, type Store } from '../store/types';

/** Entries a leaderboard answers. */
export const LEADERBOARD_SIZE = 10;

export function leaderboardRouter(store: Store, opts: { perMinute?: number } = {}): express.Router {
  const router = express.Router();
  router.use(rateLimit(opts.perMinute ?? 60, 'Too many requests, wait a minute'));
  router.get('/:boss', async (req, res, next) => {
    try {
      const boss = req.params.boss;
      const size = req.query.size;
      if (!(BOSS_KILL_BOSSES as readonly string[]).includes(boss) || typeof size !== 'string' || !/^[1-4]$/.test(size)) {
        res.status(400).json({ error: 'Bad request' });
        return;
      }
      const entries = await store.bossLeaderboard(boss as BossKill['boss'], Number(size), LEADERBOARD_SIZE);
      res.json({ entries: entries.map((e) => ({ names: [...e.names], seconds: Math.round(e.seconds * 10) / 10, at: e.at })) });
    } catch (err) {
      next(err);
    }
  });
  router.use((_req, res) => res.status(400).json({ error: 'Bad request' }));
  const onError: express.ErrorRequestHandler = (err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  };
  router.use(onError);
  return router;
}
