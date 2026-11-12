// The character creator's route (bearer auth, the auth rate limit):
// - GET /api/look → { look: Look | null, free: boolean, name: string | null, guest: boolean };
// - POST /api/look { look, name? }: the one free creator visit. The look goes through parseLook (a bad one is
//   a 400 and changes nothing). The name, when given and the adventurer has none, goes through Plan 1's
//   validateAdventurerName and nameAdventurer first (a bad name 400, a taken one 409; an adventurer that
//   already has a name keeps it: names are permanent). Then useFreeLook; while the inventory is untouched
//   (nextUid 17: only the starter kit) the starter kit takes the look's two outfit dyes. Not free any more:
//   409 { error: 'Visit the Barber in Shady Grove to change your look' }.
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { parseLook, validateAdventurerName, type Look } from '@sg2/shared';
import { rateLimit } from '../auth/rateLimit';
import { verifyToken } from '../auth/tokens';
import { AlreadyNamedError, NameTakenError, type Account, type Store } from '../store/types';

const BEARER_RE = /^Bearer (\S+)$/;
export const LOOK_NOT_FREE = 'Visit the Barber in Shady Grove to change your look';
/** An inventory no one has touched: the 16 starter items only (uids 1–16). */
const UNTOUCHED_NEXT_UID = 17;

export function lookRouter(store: Store, secret: string, opts: { ratePerMinute?: number } = {}): express.Router {
  const router = express.Router();
  router.use(rateLimit(opts.ratePerMinute ?? 10, 'Too many attempts, wait a minute'));
  router.use(express.json({ limit: '2kb', type: () => true }));

  const bearer = async (req: express.Request): Promise<Account | null> => {
    const token = BEARER_RE.exec(req.get('authorization') ?? '')?.[1];
    const verified = token ? verifyToken(token, secret) : null;
    return (verified && (await store.findAccountById(verified.accountId))) || null;
  };
  const answer = async (account: Account) => {
    const a = await store.getOrCreateAdventurer(account.id);
    return { look: a.look, free: a.lookFree, name: a.name, guest: account.isGuest };
  };

  router.get('/', async (req, res, next) => {
    try {
      const account = await bearer(req);
      if (!account) return void res.status(401).json({ error: 'Please sign in again' });
      res.json(await answer(account));
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const account = await bearer(req);
      if (!account) return void res.status(401).json({ error: 'Please sign in again' });
      const body = (req.body ?? {}) as { look?: unknown; name?: unknown };
      const look: Look | null = parseLook(body.look);
      if (!look) return void res.status(400).json({ error: 'That look is not possible' });
      let a = await store.getOrCreateAdventurer(account.id);
      if (!a.lookFree) return void res.status(409).json({ error: LOOK_NOT_FREE });
      if (body.name !== undefined && a.name === null) {
        const invalid = validateAdventurerName(body.name);
        if (invalid) return void res.status(400).json({ error: invalid });
        try {
          await store.nameAdventurer(account.id, body.name as string);
        } catch (err) {
          if (err instanceof NameTakenError) return void res.status(409).json({ error: 'That name is taken' });
          if (!(err instanceof AlreadyNamedError)) throw err; // named meanwhile: it keeps that name
        }
      }
      if (!(await store.useFreeLook(account.id, look))) return void res.status(409).json({ error: LOOK_NOT_FREE });
      a = await store.getOrCreateAdventurer(account.id);
      if (a.inventory.nextUid === UNTOUCHED_NEXT_UID) {
        const dye: [number, number] = [look.outfit.dye1, look.outfit.dye2];
        const inventory = { ...a.inventory, bag: a.inventory.bag.map((i) => ({ ...i, dye: [dye[0], dye[1]] as [number, number] })) };
        // compare-and-set: if anything changed it meanwhile (a join's first write), the dyes are left as they are
        await store.writeInventory(a.id, a.invVersion, { inventory, jobs: a.jobs, dGold: 0, dSeals: 0 });
      }
      res.json(await answer(account));
    } catch (err) {
      next(err);
    }
  });

  router.use((_req, res) => res.status(400).json({ error: 'Bad request' }));
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 413 ? 'Request too large' : status === 500 ? 'Something went wrong' : 'Bad request' });
  };
  router.use(onError);
  return router;
}
