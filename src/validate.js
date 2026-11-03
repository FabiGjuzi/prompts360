import crypto from 'node:crypto';

export const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
export const ANON_RE = /^anon-[0-9a-f]{8}$/;
const RESERVED = new Set(['admin', 'administrator', 'root', 'system', 'support', 'staff', 'official', 'mod',
  'moderator', 'prompts360', 'deleted', 'removed', 'anon', 'anonymous', 'null', 'undefined', 'me', 'help', 'security']);

export const genAnonName = () => `anon-${crypto.randomBytes(4).toString('hex')}`;

export function usernameProblem(u) {
  if (!USERNAME_RE.test(u)) return 'Usernames are 3–20 characters: letters, numbers, _ or -.';
  if (RESERVED.has(u.toLowerCase())) return 'That username is reserved.';
  return null;
}

export function emailOk(e) {
  return typeof e === 'string' && e.length <= 254 &&
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(e);
}

/** Rules: 12–128 chars, at least one uppercase letter and one digit, both entries equal. */
export function passwordProblem(pw, pw2, username = '') {
  if (pw.length < 12) return 'Password must be at least 12 characters.';
  if (pw.length > 128) return 'Password must be at most 128 characters.';
  if (!/\p{Lu}/u.test(pw)) return 'Password needs at least one uppercase letter.';
  if (!/\d/.test(pw)) return 'Password needs at least one number.';
  if (pw !== pw2) return 'Passwords don’t match.';
  if (username && pw.toLowerCase().includes(username.toLowerCase())) return 'Password can’t contain your username.';
  return null;
}

export const COMMUNITY_RE = /^[A-Za-z0-9_]{3,21}$/;
export const TAG_RE = /^[a-z0-9-]{1,30}$/;
export const intId = v => (typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : null);
