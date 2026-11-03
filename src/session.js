// Server-side sessions in Valkey. The browser holds a random 256-bit token in an HttpOnly cookie with
// no Max-Age (dies when the browser closes); Valkey stores only SHA-256(token). Sessions expire after
// 2 h idle (sliding) and 24 h absolute. All of a user's sessions can be revoked at once.
import { kv } from './kv.js';
import { sha256, randomToken, csrfFor } from './crypto.js';
import { config } from './config.js';

// Cookie name. The __Host- prefix makes browsers require Secure + Path=/ and refuse a Domain attribute.
const COOKIE = config.cookieSecure ? '__Host-sid' : 'sid';
/** Valkey key for a session: SHA-256 of the cookie token (the raw token is never stored). */
const skey = token => `s:${sha256(token).toString('base64url')}`;
/** Valkey key of the set that lists all of one user's sessions (so they can be revoked together). */
const ukey = uid => `us:${uid}`;

/** Set-Cookie value for a session: HttpOnly, SameSite=Lax, Secure in production, and no Max-Age (so it ends when the browser closes). */
export function cookieHeader(token) {
  // No Max-Age/Expires => session cookie. __Host- prefix forces Secure, Path=/ and no Domain (no subdomain overrides).
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${config.cookieSecure ? '; Secure' : ''}`;
}
/** Set-Cookie value that deletes the session cookie. */
export const clearCookieHeader = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.cookieSecure ? '; Secure' : ''}`;

/** Start a session for `user` ({id, username, is_admin}); returns the random token to put in the cookie. */
export async function createSession(user) {
  const token = randomToken(32);
  const key = skey(token);
  const userId = user.id;
  // Username/admin flag are cached in the session so logged-in requests need no DB round trip.
  // Anything that changes them (ban, delete, admin change, password change) revokes all sessions.
  await kv.multi()
    .hSet(key, { u: String(userId), n: user.username, a: user.is_admin ? '1' : '0', t: String(Date.now()) })
    .expire(key, config.sessionIdleSec)
    .sAdd(ukey(userId), key)
    .expire(ukey(userId), config.sessionMaxSec)
    .exec();
  return token;
}

/** End one session (logout). */
export async function destroySession(token) {
  if (!token) return;
  const key = skey(token);
  const uid = await kv.hGet(key, 'u').catch(() => null);
  await kv.del(key).catch(() => {});
  if (uid) await kv.sRem(ukey(uid), key).catch(() => {});
}

/** Revoke every session of a user (password change/reset, ban, account deletion). */
export async function destroyAllSessions(userId) {
  const keys = await kv.sMembers(ukey(userId)).catch(() => []);
  if (keys.length) await kv.del(keys).catch(() => {});
  await kv.del(ukey(userId)).catch(() => {});
}

/** Resolve the session cookie to the logged-in user, enforcing idle and absolute expiry. */
export async function loadSession(token) {
  if (!token || token.length !== 43 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const key = skey(token);
  let s;
  try { s = await kv.hGetAll(key); } catch { return null; }
  if (!s || !s.u) return null;
  if (Date.now() - Number(s.t) > config.sessionMaxSec * 1000) { await destroySession(token); return null; }
  kv.expire(key, config.sessionIdleSec).catch(() => {}); // sliding idle window
  return { id: Number(s.u), username: s.n, is_admin: s.a === '1', csrf: csrfFor(token), token };
}

/** Pull one cookie value out of the request's Cookie header (null if absent or the header is oversized). */
export function readCookie(req, name = COOKIE) {
  const h = req.headers.cookie;
  if (!h || h.length > 4096) return null;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
