// Accounts API: register, log in, or play as a guest. Every route answers {token, name} or {error}.
import argon2 from 'argon2';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { validatePassword, validateUsername } from '@sg2/shared';
import { NameTakenError, type Account, type Store } from '../store/types';
import { rateLimit } from './rateLimit';
import { signToken } from './tokens';

const WRONG_LOGIN = 'Wrong name or password';
const GUEST_NAME_TRIES = 20;

/** `Guest-` and 6 random digits: a million names, so collisions stay rare as guests pile up. */
function randomGuestName(): string {
  return `Guest-${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`;
}

export function authRouter(store: Store, secret: string, opts: { ratePerMinute?: number } = {}): express.Router {
  const router = express.Router();
  const session = (account: Account) => ({ token: signToken(account.id, secret), name: account.username });

  // Hashed once, so a login for an unknown name costs as much as one with a wrong password.
  let dummyHash: Promise<string> | undefined;

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
      res.json(session(account));
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
    res.json(session(account));
  });

  router.post('/guest', async (_req, res) => {
    for (let i = 0; i < GUEST_NAME_TRIES; i++) {
      try {
        const account = await store.createAccount({ username: randomGuestName(), passwordHash: null, isGuest: true });
        res.json(session(account));
        return;
      } catch (err) {
        if (!(err instanceof NameTakenError)) throw err;
      }
    }
    res.status(503).json({ error: 'No guest names free, try again' });
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
