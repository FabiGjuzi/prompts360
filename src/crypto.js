import crypto from 'node:crypto';
import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import { config } from './config.js';

// A secret is either 32 bytes in base64 (gen-keys.js) or any long random string, hashed to 32 bytes.
export function keyFrom(secret) {
  const b = Buffer.from(secret, 'base64');
  return b.length === 32 ? b : crypto.createHash('sha256').update(secret).digest();
}
const appSecret = keyFrom(config.appSecret);
const derive = label => Buffer.from(crypto.hkdfSync('sha256', appSecret, Buffer.alloc(0), `prompts360:${label}`, 32));

// Independent sub-keys (HKDF): compromise or misuse of one purpose doesn't weaken another.
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

export function encrypt(plaintext, aad = '') {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', dataKeys.get(1), iv);
  if (aad) c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(String(plaintext), 'utf8'), c.final()]);
  return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), ct]);
}

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
export const sha256 = data => crypto.createHash('sha256').update(data).digest();
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

export const normalizeEmail = e => String(e).trim().toLowerCase().normalize('NFKC');
/** Deterministic, keyed blind index: lets us find/uniquely-constrain an email without storing it. */
export const emailIndex = email => hmac(K.emailIndex, normalizeEmail(email));
/** Keyed IP hash used only for rate-limit keys in Valkey (expires); raw IPs are never persisted. */
export const ipKey = ip => hmac(K.ip, String(ip)).subarray(0, 12).toString('base64url');

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// ---------- Argon2id with a concurrency cap (each hash takes 64 MiB; unbounded parallel hashing = easy DoS) ----------
let active = 0;
const waiters = [];
async function withSlot(fn) {
  if (active >= config.argonConcurrency) {
    if (waiters.length > 200) throw Object.assign(new Error('busy'), { status: 503 });
    await new Promise(r => waiters.push(r));
  }
  active++;
  try { return await fn(); } finally { active--; waiters.shift()?.(); }
}
const argonOpts = { algorithm: Algorithm.Argon2id, ...config.argon, secret: K.pepper };

export const hashPassword = pw => withSlot(() => argonHash(pw, argonOpts));
export async function verifyPassword(stored, pw) {
  if (!stored) return false;
  try { return await withSlot(() => argonVerify(stored, pw, { secret: K.pepper })); } catch { return false; }
}
// Pre-computed hash used when the username doesn't exist, so the response time doesn't reveal it.
let dummy;
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
export function checkFormToken(t) {
  if (typeof t !== 'string' || t.length > 120) return false;
  const parts = t.split('.');
  if (parts.length !== 3) return false;
  const body = `${parts[0]}.${parts[1]}`;
  if (!safeEqual(parts[2], hmac(K.form, body).subarray(0, 18).toString('base64url'))) return false;
  return Number(parts[0]) > Date.now() / 1000;
}
