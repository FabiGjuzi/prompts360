// Valkey (Redis-compatible) client: sessions, rate-limit counters and short-lived feed cache.
import { createClient } from '@redis/client';
import { config } from './config.js';

export const kv = createClient({
  url: config.valkeyUrl,
  socket: { connectTimeout: 5000, reconnectStrategy: n => Math.min(n * 100, 3000) },
  disableOfflineQueue: true, // fail fast instead of piling up commands while disconnected
});
kv.on('error', e => console.error('[kv]', e.message));

export async function connectKv() { if (!kv.isOpen) await kv.connect(); }
export async function closeKv() { if (kv.isOpen) await kv.quit(); }

/** Cache a JSON-serialisable result for ttl seconds. Cache errors fall through to the source. */
export async function cached(key, ttl, fn) {
  try {
    const hit = await kv.get(key);
    if (hit) return JSON.parse(hit);
  } catch {}
  const val = await fn();
  kv.set(key, JSON.stringify(val), { EX: ttl }).catch(() => {});
  return val;
}
