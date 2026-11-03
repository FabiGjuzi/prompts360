// crypto.js — every cryptographic primitive the site uses, in one place.
//   • AES-256-GCM encryption (queued emails)        • HMAC-SHA256 email fingerprint ("blind index")
//   • Argon2id password hashing (Node built-in)      • random tokens, constant-time compare
//   • CSRF tokens (logged-in) and signed form tokens (logged-out)
// All keys derive from two secrets in the environment: APP_SECRET (HMAC/pepper keys) and DATA_KEY (AES key).
import crypto from 'node:crypto';
import { config } from './config.js';

// A secret is either 32 bytes in base64 (gen-keys.js) or any long random string, hashed to 32 bytes.
function keyFrom(secret) {
  const b = Buffer.from(secret, 'base64');
  return b.length === 32 ? b : crypto.createHash('sha256').update(secret).digest();
}
const appSecret = keyFrom(config.appSecret);
/** HKDF-derive an independent 32-byte sub-key from APP_SECRET for one purpose (`label`), so keys never overlap. */
const derive = label => Buffer.from(crypto.hkdfSync('sha256', appSecret, Buffer.alloc(0), `prompts360:${label}`, 32));

// Independent sub-keys (HKDF): compromise or misuse of one purpose doesn't weaken another.
// Independent sub-keys, each used for exactly one purpose (compromise of one doesn't weaken the others).
const K = {
  emailIndex: derive('email-index'),
  pepper: derive('password-pepper'),
  csrf: derive('csrf'),
  ip: derive('ip-hash'),
  form: derive('form-token'),
};

// ---------- AES-256-GCM for private columns ----------
// Layout: [1 byte key id][12 byte IV][16 byte tag][ciphertext]. Key id allows rotation via DATA_KEY_OLD.
const dataKeys = new Map([[1, keyFrom(config.dataKey)]]);
if (config.dataKeyOld) dataKeys.set(0, keyFrom(config.dataKeyOld));

/** AES-256-GCM encrypt `plaintext`. `aad` (additional authenticated data) binds the ciphertext to its purpose. Returns [key id][12-byte IV][16-byte tag][ciphertext]. */
export function encrypt(plaintext, aad = '') {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', dataKeys.get(1), iv);
  if (aad) c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(String(plaintext), 'utf8'), c.final()]);
  return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), ct]);
}

/** Reverse of encrypt(): returns the plaintext, or null if the blob is too short or its key id is unknown. Throws if the data or `aad` was tampered with. */
export function decrypt(blob, aad = '') {
  if (!blob || blob.length < 30) return null;
  const key = dataKeys.get(blob[0]);
  if (!key) return null;
  const d = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(1, 13));
  d.setAuthTag(blob.subarray(13, 29));
  if (aad) d.setAAD(Buffer.from(aad));
  return Buffer.concat([d.update(blob.subarray(29)), d.final()]).toString('utf8');
}

// ---------- Hashing ----------
/** SHA-256 digest of `data` (a 32-byte Buffer); used to store tokens so a database leak doesn't reveal them. */
export const sha256 = data => crypto.createHash('sha256').update(data).digest();
/** HMAC-SHA256 of `data` under `key` (returns a 32-byte Buffer). */
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/** Canonical form of an email for fingerprinting and sending: trimmed, lower-cased, Unicode-normalised (NFKC). */
export const normalizeEmail = e => String(e).trim().toLowerCase().normalize('NFKC');
/** Deterministic, keyed blind index: lets us find/uniquely-constrain an email without storing it. */
export const emailIndex = email => hmac(K.emailIndex, normalizeEmail(email));
/** Keyed IP hash used only for rate-limit keys in Valkey (expires); raw IPs are never persisted. */
export const ipKey = ip => hmac(K.ip, String(ip)).subarray(0, 12).toString('base64url');

/** Cryptographically random URL-safe token (default 32 bytes = 256 bits, base64url). */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Constant-time string comparison (prevents timing attacks when comparing secrets). */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// ---------- Argon2id with a concurrency cap (each hash takes 64 MiB; unbounded parallel hashing = easy DoS) ----------
let active = 0;          // hashes currently running
const waiters = [];      // resolvers of callers queued for a free slot
/** Run `fn` when one of the `argonConcurrency` hashing slots is free; queue the rest (max 200 waiting, then reject with 503). */
async function withSlot(fn) {
  if (active >= config.argonConcurrency) {
    if (waiters.length > 200) throw Object.assign(new Error('busy'), { status: 503 });
    await new Promise(r => waiters.push(r));
  }
  active++;
  try { return await fn(); } finally { active--; waiters.shift()?.(); }
}
// ---------- Argon2id via Node's built-in crypto.argon2 (Node >= 24.7; no third-party code) ----------
// Stored format is the standard PHC string, so hashes are portable between implementations:
//   $argon2id$v=19$m=<KiB>,t=<passes>,p=<lanes>$<salt, base64 no padding>$<hash, base64 no padding>
const ARGON_TAG_BYTES = 32;
/** Base64 without trailing '=' padding, as used inside PHC password-hash strings. */
const b64 = buf => buf.toString('base64').replace(/=+$/, '');

/** Promise wrapper over crypto.argon2 (runs on the libuv thread pool, so it doesn't block requests). */
const argon2id = (message, nonce, { m, t, p }) => new Promise((resolve, reject) =>
  crypto.argon2('argon2id', { message, nonce, parallelism: p, tagLength: ARGON_TAG_BYTES, memory: m, passes: t, secret: K.pepper },
    (err, tag) => (err ? reject(err) : resolve(tag))));

/** Hash a password with a fresh random 16-byte salt and the configured cost. @returns {Promise<string>} PHC string */
export const hashPassword = pw => withSlot(async () => {
  const salt = crypto.randomBytes(16);
  const cost = { m: config.argon.memoryCost, t: config.argon.timeCost, p: config.argon.parallelism };
  const tag = await argon2id(pw, salt, cost);
  return `$argon2id$v=19$m=${cost.m},t=${cost.t},p=${cost.p}$${b64(salt)}$${b64(tag)}`;
});

/**
 * Check a password against a stored PHC string, using the cost parameters stored inside it (so hashes made
 * with older settings still verify). Constant-time comparison. Returns false for anything malformed.
 */
export async function verifyPassword(stored, pw) {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(stored || '');
  if (!m) return false;
  const cost = { m: Number(m[1]), t: Number(m[2]), p: Number(m[3]) };
  if (cost.m > 262144 || cost.t > 10 || cost.p > 8) return false; // refuse absurd costs (a tampered row can't DoS us)
  try {
    const expected = Buffer.from(m[5], 'base64');
    const actual = await withSlot(() => argon2id(pw, Buffer.from(m[4], 'base64'), cost));
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}

// Pre-computed hash used when the username doesn't exist, so the response time doesn't reveal it.
let dummy;
/** Spend the same time as a real password check (against a dummy hash) so response time can't reveal whether a username exists. Always returns false. */
export async function burnPasswordTime(pw) {
  dummy ||= await hashPassword('dummy-password-for-timing-1A');
  await verifyPassword(dummy, pw);
  return false;
}

// ---------- CSRF ----------
/** Per-session CSRF token (synchronizer pattern), bound to the session secret. */
export const csrfFor = sessionToken => hmac(K.csrf, sessionToken).subarray(0, 24).toString('base64url');

/** Stateless signed token for logged-out forms (login, signup, reset): "<expiry>.<nonce>.<mac>". */
export function formToken(ttlSec = 7200) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const body = `${exp}.${randomToken(12)}`;
  return `${body}.${hmac(K.form, body).subarray(0, 18).toString('base64url')}`;
}
/** Validate a signed logged-out form token: correct shape, genuine signature, and not yet expired. */
export function checkFormToken(t) {
  if (typeof t !== 'string' || t.length > 120) return false;
  const parts = t.split('.');
  if (parts.length !== 3) return false;
  const body = `${parts[0]}.${parts[1]}`;
  if (!safeEqual(parts[2], hmac(K.form, body).subarray(0, 18).toString('base64url'))) return false;
  return Number(parts[0]) > Date.now() / 1000;
}
