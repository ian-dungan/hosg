// Accounts API: register, log in or play as a guest (each answers {token, name} or {error}, where name
// is the adventurer's name, null until chosen), name your adventurer (answers {name} or {error}), and
// ask which zone it is in (GET /zone answers {zone}: the room to join).
import argon2 from 'argon2';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { validateAdventurerName, validatePassword, validateUsername } from '@sg2/shared';
import { AlreadyNamedError, NameTakenError, type Account, type Store } from '../store/types';
import { createLimiter, rateLimit } from './rateLimit';
import { signToken, verifyToken } from './tokens';

const WRONG_LOGIN = 'Wrong name or password';
const SIGN_IN_AGAIN = 'Please sign in again';
const BEARER_RE = /^Bearer (\S+)$/;
const GUEST_NAME_TRIES = 20;

/** `Guest-` and 6 random digits: a million names, so collisions stay rare as guests pile up. */
function randomGuestName(): string {
  return `Guest-${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`;
}

export function authRouter(store: Store, secret: string, opts: { ratePerMinute?: number; zoneRatePerMinute?: number; zoneIpRatePerMinute?: number } = {}): express.Router {
  const router = express.Router();
  const session = async (account: Account) => ({
    token: signToken(account.id, secret),
    name: (await store.getOrCreateAdventurer(account.id)).name,
  });

  // Hashed once, so a login for an unknown name costs as much as one with a wrong password.
  let dummyHash: Promise<string> | undefined;

  /** The account a request's `Authorization: Bearer <token>` names, or null. */
  const bearer = async (req: express.Request): Promise<Account | null> => {
    const token = BEARER_RE.exec(req.get('authorization') ?? '')?.[1];
    const verified = token ? verifyToken(token, secret) : null;
    return (verified && (await store.findAccountById(verified.accountId))) || null;
  };

  // Before the login limit: a client asks this before every join (and after each travel), which is
  // not a login attempt. It needs a valid token, so it reveals nothing to a guesser. Its own, generous
  // limit is per account (60 a minute by default), keyed after the token is verified (no store lookup
  // before it), so players behind one NAT or proxy never hold each other up; a loose per-address
  // ceiling (600 a minute by default, bad tokens included) keeps one address from hammering it.
  const zoneLimit = createLimiter(opts.zoneRatePerMinute ?? 60);
  const TOO_MANY = 'Too many requests, wait a minute';
  router.get('/zone', rateLimit(opts.zoneIpRatePerMinute ?? 600, TOO_MANY), async (req, res) => {
    const token = BEARER_RE.exec(req.get('authorization') ?? '')?.[1];
    const verified = token ? verifyToken(token, secret) : null;
    if (verified && !zoneLimit.hit(verified.accountId)) {
      res.status(429).json({ error: TOO_MANY });
      return;
    }
    const account = verified && (await store.findAccountById(verified.accountId));
    if (!account) {
      res.status(401).json({ error: SIGN_IN_AGAIN });
      return;
    }
    res.json({ zone: (await store.getOrCreateAdventurer(account.id)).zone });
  });

  router.use(rateLimit(opts.ratePerMinute ?? 10, 'Too many attempts, wait a minute'));
  // Parse every body as JSON, whatever its declared type, so the 2 KB cap always applies.
  router.use(express.json({ limit: '2kb', type: () => true }));

  router.post('/register', async (req, res) => {
    const { username, password } = req.body ?? {};
    const invalid = validateUsername(username) ?? validatePassword(password);
    if (invalid) {
      res.status(400).json({ error: invalid });
      return;
    }
    const passwordHash = await argon2.hash(password);
    try {
      const account = await store.createAccount({ username, passwordHash, isGuest: false });
      res.json(await session(account));
    } catch (err) {
      if (!(err instanceof NameTakenError)) throw err;
      res.status(409).json({ error: 'That name is taken' });
    }
  });

  router.post('/login', async (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      res.status(401).json({ error: WRONG_LOGIN });
      return;
    }
    const account = await store.findAccountByUsername(username);
    if (!account?.passwordHash || account.isGuest) {
      await argon2.verify(await (dummyHash ??= argon2.hash('not-a-real-password')), password);
      res.status(401).json({ error: WRONG_LOGIN });
      return;
    }
    if (!(await argon2.verify(account.passwordHash, password))) {
      res.status(401).json({ error: WRONG_LOGIN });
      return;
    }
    res.json(await session(account));
  });

  router.post('/guest', async (_req, res) => {
    for (let i = 0; i < GUEST_NAME_TRIES; i++) {
      try {
        const username = randomGuestName();
        const account = await store.createAccount({ username, passwordHash: null, isGuest: true });
        // Guests skip the naming step: the adventurer is named after the account. Players cannot
        // choose Guest names, so only an old adventurer could hold it; then the account is left unused.
        await store.nameAdventurer(account.id, username);
        res.json({ token: signToken(account.id, secret), name: username });
        return;
      } catch (err) {
        if (!(err instanceof NameTakenError)) throw err;
      }
    }
    res.status(503).json({ error: 'No guest names free, try again' });
  });

  router.post('/name', async (req, res) => {
    const account = await bearer(req);
    if (!account) {
      res.status(401).json({ error: SIGN_IN_AGAIN });
      return;
    }
    const { name } = req.body ?? {};
    const invalid = validateAdventurerName(name);
    if (invalid) {
      res.status(400).json({ error: invalid });
      return;
    }
    try {
      const adventurer = await store.nameAdventurer(account.id, name);
      res.json({ name: adventurer.name });
    } catch (err) {
      if (err instanceof NameTakenError) {
        res.status(409).json({ error: 'That name is taken' });
      } else if (err instanceof AlreadyNamedError) {
        res.status(409).json({ error: 'Your adventurer already has a name' });
      } else {
        throw err;
      }
    }
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) console.error(err);
    const error = status === 413 ? 'Request too large' : status === 500 ? 'Something went wrong' : 'Bad request';
    res.status(status).json({ error });
  };
  router.use(onError);

  return router;
}
