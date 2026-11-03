// ratelimit.js — abuse protection.
//   hit()/peek()/reset(): shared counters in Valkey (same limits across all app instances).
//   ipThrottle(): in-process per-IP token bucket against request floods.
//   LIMITS: the table of per-action limits.
import { kv } from './kv.js';

// Fixed-window counter in Valkey, shared by every app instance. Returns {ok, retryAfter}.
// Fails CLOSED: if Valkey is unreachable, rate-limited actions are refused rather than unlimited.
// Lua run atomically inside Valkey: increment the counter, set its expiry on first use, return [count, ms left].
const SCRIPT = `local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {c, redis.call('PTTL', KEYS[1])}`;

/** Count one event for `key` and report whether it is still within `limit` per `windowSec`. Fails closed (not ok) if Valkey is down. Returns {ok, retryAfter, count}. */
export async function hit(key, limit, windowSec) {
  try {
    const [count, pttl] = await kv.eval(SCRIPT, { keys: [`rl:${key}`], arguments: [String(windowSec * 1000)] });
    return { ok: count <= limit, retryAfter: Math.max(1, Math.ceil(pttl / 1000)), count };
  } catch {
    return { ok: false, retryAfter: 30, count: Infinity };
  }
}
/** Read a counter without incrementing it (used for the failed-login lockout check). */
export async function peek(key) {
  try { return Number(await kv.get(`rl:${key}`)) || 0; } catch { return Infinity; }
}
/** Clear a counter (used after a successful login). */
export async function reset(key) { try { await kv.del(`rl:${key}`); } catch {} }

// Limits: [max, windowSeconds]. Tuned for humans; bots hit them fast.
export const LIMITS = {
  signupIp:      [5, 3600],
  loginIp:       [20, 900],
  loginUserFail: [10, 900],     // failed attempts per account per 15 min, then locked for the window
  forgotIp:      [5, 3600],
  forgotEmail:   [3, 3600],
  resendIp:      [5, 3600],
  post:          [5, 600],
  postDay:       [30, 86400],
  comment:       [10, 60],
  commentDay:    [500, 86400],
  vote:          [60, 60],
  community:     [3, 86400],
  report:        [20, 3600],
  edit:          [30, 600],
  search:        [30, 60],
};

// ---------- In-process per-IP request throttle (layer-7 flood guard, no network round trip) ----------
// Token bucket: `burst` requests, refilled at `perSec`. Cloudflare absorbs volumetric DDoS before this.
const buckets = new Map();
/** In-process token bucket per IP: `burst` requests at once, refilling `perSec` per second. Returns false when the caller must be refused. */
export function ipThrottle(ip, burst = 120, perSec = 4) {
  const now = Date.now() / 1000;
  let b = buckets.get(ip);
  if (!b) {
    if (buckets.size > 100_000) buckets.clear(); // bounded memory under IP-spraying floods
    b = { t: burst, at: now };
    buckets.set(ip, b);
  }
  b.t = Math.min(burst, b.t + (now - b.at) * perSec);
  b.at = now;
  if (b.t < 1) return false;
  b.t -= 1;
  return true;
}
