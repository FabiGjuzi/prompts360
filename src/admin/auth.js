// admin/auth.js — superadmin login and session. Completely separate from forum accounts:
// its own table (admin_account), its own cookie, its own KV keys, its own CSRF token.
import { q, one } from '../db.js';
import { kv } from '../kv.js';
import { config } from '../config.js';
import { sha256, randomToken, csrfFor, hashPassword, verifyPassword, burnPasswordTime, ipKey } from '../crypto.js';
import { hit, peek, reset } from '../ratelimit.js';
import { verifyHuman } from '../turnstile.js';
import { logEvent } from '../metrics.js';

const COOKIE = config.cookieSecure ? '__Host-asid' : 'asid';
const IDLE = 30 * 60, MAX = 8 * 3600;          // 30 min idle, 8 h absolute
const skey = t => `as:${sha256(t).toString('base64url')}`;
const ALL = 'as:all';
const uaHash = req => sha256(String(req.headers['user-agent'] || '')).toString('base64url').slice(0, 16);

export const cookieHeader = token => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${config.cookieSecure ? '; Secure' : ''}`;
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${config.cookieSecure ? '; Secure' : ''}`;

function cookieOf(req) {
  const h = req.headers.cookie;
  if (!h || h.length > 4096) return null;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}

/** Start an admin session; returns the cookie token. The session is tied to the browser's user-agent. */
export async function createAdminSession(req) {
  const token = randomToken(32), key = skey(token);
  await kv.multi().hSet(key, { t: String(Date.now()), ua: uaHash(req) }).expire(key, IDLE).sAdd(ALL, key).expire(ALL, MAX).exec();
  return token;
}
export async function destroyAdminSession(token) {
  if (!token) return;
  const key = skey(token);
  await kv.del(key).catch(() => {});
  await kv.sRem(ALL, key).catch(() => {});
}
/** Revoke every admin session (password change). */
export async function destroyAllAdminSessions() {
  const keys = await kv.sMembers(ALL).catch(() => []);
  if (keys.length) await kv.del(keys).catch(() => {});
  await kv.del(ALL).catch(() => {});
}

/** Resolve the admin cookie to {token, csrf} or null (idle/absolute expiry, user-agent binding). */
export async function loadAdmin(req) {
  const token = cookieOf(req);
  if (!token || token.length !== 43 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const key = skey(token);
  let s;
  try { s = await kv.hGetAll(key); } catch { return null; }
  if (!s || !s.t) return null;
  if (Date.now() - Number(s.t) > MAX * 1000 || s.ua !== uaHash(req)) { await destroyAdminSession(token); return null; }
  kv.expire(key, IDLE).catch(() => {});
  return { token, csrf: csrfFor(`admin:${token}`) };
}

/** Create the single admin_account row from ADMIN_BOOTSTRAP_HASH if there is none yet. */
async function ensureAccount() {
  if (await one('SELECT 1 FROM admin_account')) return;
  const h = config.adminBootstrapHash;
  if (/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/.test(h)) {
    await q('INSERT INTO admin_account (id, pass_hash) VALUES (1, $1) ON CONFLICT DO NOTHING', [h]);
    logEvent('info', 'admin', 'Superadmin account created from ADMIN_BOOTSTRAP_HASH');
  }
}

const LIM = { ip: [8, 900] };
/** Check a login attempt. Returns {ok:true} or {ok:false, error, status}. Every failure looks the same. */
export async function attemptLogin(req, password, turnstileToken) {
  const rl = await hit(`adminlogin:${ipKey(req.ip)}`, ...LIM.ip);
  if (!rl.ok) { logEvent('warn', 'admin', 'Admin login rate-limited'); return { ok: false, status: 429, error: `Too many attempts. Try again in ${Math.ceil(rl.retryAfter / 60)} min.` }; }
  if (!(await verifyHuman(turnstileToken, req.ip, 'admin'))) return { ok: false, status: 400, error: 'Please complete the captcha.' };
  await ensureAccount();
  const acct = await one('SELECT pass_hash FROM admin_account WHERE id = 1');
  const ok = acct ? await verifyPassword(acct.pass_hash, password) : await burnPasswordTime(password);
  if (!ok) { logEvent('warn', 'admin', 'Admin login failed'); return { ok: false, status: 401, error: 'Wrong password.' }; }
  await reset(`adminlogin:${ipKey(req.ip)}`);
  await q('UPDATE admin_account SET last_login_at = now() WHERE id = 1');
  logEvent('info', 'admin', 'Admin login');
  return { ok: true };
}

/** Change the admin password (current one required). Revokes all admin sessions. */
export async function changePassword(current, next) {
  const acct = await one('SELECT pass_hash FROM admin_account WHERE id = 1');
  if (!acct || !(await verifyPassword(acct.pass_hash, current))) return 'Current password is wrong.';
  if (next.length < 12 || next.length > 128) return 'New password must be 12–128 characters.';
  if (next === current) return 'Choose a different password.';
  await q('UPDATE admin_account SET pass_hash = $1, changed_at = now() WHERE id = 1', [await hashPassword(next)]);
  await destroyAllAdminSessions();
  logEvent('warn', 'admin', 'Admin password changed');
  return null;
}

export const adminCookieToken = cookieOf;
