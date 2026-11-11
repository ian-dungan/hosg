// Session tokens: HS256 JWTs carrying the account id, valid for 7 days.
import jwt from 'jsonwebtoken';

export function signToken(accountId: string, secret: string): string {
  return jwt.sign({}, secret, { algorithm: 'HS256', subject: accountId, expiresIn: '7d' });
}

/** The account id in a valid, unexpired token signed with `secret`, or null. */
export function verifyToken(token: string, secret: string): { accountId: string } | null {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof payload === 'object' && typeof payload.sub === 'string') return { accountId: payload.sub };
    return null;
  } catch {
    return null;
  }
}
