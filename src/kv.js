// kv.js — minimal in-house Valkey/Redis client (RESP2 over TCP or TLS). No third-party code.
//
// Used for: sessions, rate-limit counters and the short-lived feed cache. It implements only the ~15
// commands this site uses, plus MULTI/EXEC, AUTH, SELECT, TLS ("rediss://") and reconnects.
//
// Wire format (RESP2) recap — every reply starts with a type byte:
//   +OK\r\n            simple string        -ERR msg\r\n     error
//   :42\r\n            integer              $5\r\nhello\r\n  bulk string ($-1 = null)
//   *2\r\n...          array of replies     (*-1 = null array)
// Commands are sent as an array of bulk strings:  *3\r\n$3\r\nSET\r\n$1\r\nk\r\n$1\r\nv\r\n
import net from 'node:net';
import tls from 'node:tls';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { config } from './config.js';

/** Error type for replies that begin with "-" (e.g. WRONGTYPE, NOAUTH). */
class RedisError extends Error {}

/**
 * Incremental RESP2 parser. Feed it Buffers with push(); it returns every complete reply found so far
 * and keeps any partial trailing bytes for the next call, so TCP chunk boundaries don't matter.
 */
class RespParser {
  constructor() { this.buf = Buffer.alloc(0); }

  /** @param {Buffer} chunk new bytes from the socket  @returns {Array} completed replies, in order */
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out = [];
    for (;;) {
      const r = this.#parse(0);       // try to parse one reply starting at offset 0
      if (!r) break;                  // incomplete: wait for more bytes
      out.push(r.value);
      this.buf = this.buf.subarray(r.end);
    }
    return out;
  }

  /** Parse one reply at `pos`. Returns {value, end} or null if the buffer doesn't hold a full reply yet. */
  #parse(pos) {
    if (pos >= this.buf.length) return null;
    const eol = this.buf.indexOf('\r\n', pos);
    if (eol < 0) return null;
    const type = String.fromCharCode(this.buf[pos]);
    const line = this.buf.toString('utf8', pos + 1, eol);
    const next = eol + 2;
    switch (type) {
      case '+': return { value: line, end: next };
      case '-': return { value: new RedisError(line), end: next };
      case ':': return { value: Number(line), end: next };
      case '$': {
        const len = Number(line);
        if (len < 0) return { value: null, end: next };
        if (this.buf.length < next + len + 2) return null; // payload + trailing \r\n not fully here yet
        return { value: this.buf.toString('utf8', next, next + len), end: next + len + 2 };
      }
      case '*': {
        const n = Number(line);
        if (n < 0) return { value: null, end: next };
        const items = [];
        let p = next;
        for (let i = 0; i < n; i++) {
          const r = this.#parse(p);
          if (!r) return null;
          items.push(r.value);
          p = r.end;
        }
        return { value: items, end: p };
      }
      default: throw new Error(`bad RESP type byte "${type}"`);
    }
  }
}

/** Encode a command (array of strings/numbers) as a RESP array of bulk strings. */
function encode(args) {
  const parts = [`*${args.length}\r\n`];
  for (const a of args) {
    const s = String(a);
    parts.push(`$${Buffer.byteLength(s)}\r\n${s}\r\n`);
  }
  return parts.join('');
}

/** Turn ['k1','v1','k2','v2'] (HGETALL reply) into {k1:'v1', k2:'v2'}. */
function pairsToObject(flat) {
  const o = {};
  for (let i = 0; i < flat.length; i += 2) o[flat[i]] = flat[i + 1];
  return o;
}

/**
 * The client. One socket; replies come back in the order commands were sent, so a FIFO queue of
 * resolver functions matches each reply to its caller. When disconnected, commands fail immediately
 * (no offline queue) so a Valkey outage can't pile up memory — callers handle the error.
 */
class Client extends EventEmitter {
  /** Remember the connection URL; the socket is opened later by connect(). */
  constructor(url) {
    super();
    this.url = new URL(url);            // redis://[user:pass@]host:port[/db]  or  rediss:// for TLS
    this.socket = null;
    this.parser = new RespParser();
    this.pending = [];                  // FIFO of {resolve, reject, transform}
    this.isOpen = false;                // true once the socket is connected AND authenticated/selected
    this.closing = false;               // true after quit(): don't reconnect
    this.attempt = 0;                   // consecutive failed connects (drives reconnect back-off)
  }

  /** Open the connection (resolves once ready). Reconnects automatically after later drops. */
  async connect() {
    if (this.isOpen) return;
    await this.#dial();
  }

  /** Create the socket, wire its events, then AUTH + SELECT. Rejects if the first connect fails. */
  #dial() {
    return new Promise((resolve, reject) => {
      const { hostname, port, protocol } = this.url;
      const opts = { host: hostname, port: Number(port) || 6379 };
      // TLS always verifies the server certificate; VALKEY_CA_CERT adds a private CA when needed.
      let ca = config.valkeyCa;
      if (ca && !ca.includes('-----BEGIN')) ca = readFileSync(ca, 'utf8');
      const sock = protocol === 'rediss:' ? tls.connect({ ...opts, servername: hostname, ...(ca ? { ca } : {}) }) : net.connect(opts);
      sock.setNoDelay(true);
      sock.setKeepAlive(true, 15_000);
      sock.setTimeout(5_000, () => sock.destroy(new Error('connect timeout'))); // only while connecting
      this.socket = sock;
      this.parser = new RespParser();
      let settled = false;

      sock.on(protocol === 'rediss:' ? 'secureConnect' : 'connect', async () => {
        sock.setTimeout(0);
        try {
          // Replies for AUTH/SELECT are queued through the same FIFO as normal commands.
          this.isOpen = true; // allow the handshake commands through #send
          const user = decodeURIComponent(this.url.username), pass = decodeURIComponent(this.url.password);
          if (pass) await this.#send(user ? ['AUTH', user, pass] : ['AUTH', pass]);
          const db = Number(this.url.pathname.slice(1)) || 0;
          if (db) await this.#send(['SELECT', db]);
          this.attempt = 0;
          settled = true;
          resolve();
        } catch (e) { this.isOpen = false; sock.destroy(); if (!settled) { settled = true; reject(e); } }
      });
      sock.on('data', chunk => {
        let replies;
        try { replies = this.parser.push(chunk); } catch (e) { sock.destroy(e); return; }
        for (const r of replies) {
          const p = this.pending.shift();
          if (!p) continue;
          if (r instanceof RedisError) p.reject(r); else p.resolve(p.transform ? p.transform(r) : r);
        }
      });
      sock.on('error', e => { this.emit('error', e); if (!settled) { settled = true; reject(e); } });
      sock.on('close', () => {
        this.isOpen = false;
        // Fail everything still waiting for a reply: those commands may or may not have run.
        for (const p of this.pending.splice(0)) p.reject(new Error('connection closed'));
        if (!this.closing && settled) this.#reconnect();
      });
    });
  }

  /** Reconnect with back-off (100 ms, 200 ms … capped at 3 s), forever, until quit(). */
  #reconnect() {
    const delay = Math.min(++this.attempt * 100, 3000);
    setTimeout(() => { if (!this.closing) this.#dial().catch(() => this.#reconnect()); }, delay).unref();
  }

  /** Send one command; resolves with its (optionally transformed) reply. Fails fast if not connected. */
  #send(args, transform) {
    if (!this.isOpen) return Promise.reject(new Error('Valkey is not connected'));
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject, transform });
      this.socket.write(encode(args));
    });
  }

  // ---------- Commands (names and shapes follow the common Redis client convention) ----------
  /** GET key → string | null */
  get(key) { return this.#send(['GET', key]); }
  /** SET key value [EX seconds] → 'OK' */
  set(key, value, opts = {}) { return this.#send(opts.EX ? ['SET', key, value, 'EX', opts.EX] : ['SET', key, value]); }
  /** DEL key | [keys] → number removed */
  del(keys) { const k = Array.isArray(keys) ? keys : [keys]; return k.length ? this.#send(['DEL', ...k]) : Promise.resolve(0); }
  /** EXPIRE key seconds → 1 | 0 */
  expire(key, seconds) { return this.#send(['EXPIRE', key, seconds]); }
  /** HSET key {field: value, …} → number of new fields */
  hSet(key, obj) { return this.#send(['HSET', key, ...Object.entries(obj).flat()]); }
  /** HGET key field → string | null */
  hGet(key, field) { return this.#send(['HGET', key, field]); }
  /** HGETALL key → {field: value} ({} if the key doesn't exist) */
  hGetAll(key) { return this.#send(['HGETALL', key], pairsToObject); }
  /** SADD key member → number added */
  sAdd(key, member) { return this.#send(['SADD', key, member]); }
  /** SREM key member → number removed */
  sRem(key, member) { return this.#send(['SREM', key, member]); }
  /** SMEMBERS key → array of members */
  sMembers(key) { return this.#send(['SMEMBERS', key]); }
  /** EVAL script {keys, arguments} → the script's return value (Lua runs atomically inside Valkey) */
  eval(script, { keys = [], arguments: argv = [] } = {}) { return this.#send(['EVAL', script, keys.length, ...keys, ...argv]); }
  /** KEYS pattern → array (O(N): only for tests and admin scripts, never request paths) */
  keys(pattern) { return this.#send(['KEYS', pattern]); }
  /** FLUSHDB → 'OK' (tests only) */
  flushDb() { return this.#send(['FLUSHDB']); }

  /**
   * Start a MULTI/EXEC transaction: commands are queued locally; exec() sends them all in one write
   * wrapped in MULTI … EXEC so they run atomically. Chainable: kv.multi().hSet(…).expire(…).exec().
   */
  multi() {
    const cmds = [];
    const tx = {
      hSet: (k, o) => (cmds.push(['HSET', k, ...Object.entries(o).flat()]), tx),
      expire: (k, s) => (cmds.push(['EXPIRE', k, s]), tx),
      sAdd: (k, m) => (cmds.push(['SADD', k, m]), tx),
      /** @returns {Promise<Array>} one result per queued command */
      exec: () => this.#transaction(cmds),
    };
    return tx;
  }

  /** Write MULTI, the commands and EXEC back-to-back; resolve with EXEC's array of results. */
  #transaction(cmds) {
    if (!this.isOpen) return Promise.reject(new Error('Valkey is not connected'));
    const all = [['MULTI'], ...cmds, ['EXEC']];
    return new Promise((resolve, reject) => {
      all.forEach((c, i) => this.pending.push({
        resolve: i === all.length - 1 ? resolve : () => {},   // only EXEC's reply matters
        reject: i === all.length - 1 ? reject : () => {},
      }));
      this.socket.write(all.map(encode).join(''));
    });
  }

  /** Close gracefully (sends QUIT) and stop reconnecting. */
  async quit() {
    this.closing = true;
    if (this.isOpen) { try { await this.#send(['QUIT']); } catch {} }
    this.socket?.destroy();
    this.isOpen = false;
  }
}

/**
 * MemoryClient — drop-in replacement for Client that keeps everything in this process's memory.
 * Selected with VALKEY_URL=memory (saves the cost of a separate Valkey server on a one-instance deploy).
 * Trade-offs: data is lost on restart/redeploy (everyone is logged out, rate-limit counters reset) and
 * it is NOT shared between app instances, so use a real Valkey as soon as you run more than one.
 * Entries live in one Map: key → {v: string | Map (hash) | Set, exp: epoch-ms or 0 for "never"}.
 */
class MemoryClient extends EventEmitter {
  constructor() {
    super();
    this.isOpen = false;
    this.data = new Map();
    this.maxKeys = 200_000;               // hard cap so floods of unique keys can't exhaust memory
    this.sweeper = null;
  }
  /** "Connect": start the periodic sweep that frees expired entries (timer never blocks shutdown). */
  async connect() {
    this.isOpen = true;
    this.sweeper ??= setInterval(() => this.#sweep(), 30_000).unref();
  }
  /** Stop the sweeper and drop all data. */
  async quit() { this.isOpen = false; clearInterval(this.sweeper); this.sweeper = null; this.data.clear(); }
  /** Remove every expired entry. */
  #sweep() { const now = Date.now(); for (const [k, e] of this.data) if (e.exp && e.exp <= now) this.data.delete(k); }
  /** Live entry for `key`, or undefined (expired entries are deleted on access). */
  #live(key) {
    const e = this.data.get(key);
    if (e && e.exp && e.exp <= Date.now()) { this.data.delete(key); return undefined; }
    return e;
  }
  /** Insert/replace an entry, evicting the oldest keys first when over the cap. */
  #put(key, v, exp = 0) {
    this.data.delete(key);                // re-insert so Map order = age order
    this.data.set(key, { v, exp });
    while (this.data.size > this.maxKeys) this.data.delete(this.data.keys().next().value);
  }
  async get(key) { const e = this.#live(key); return typeof e?.v === 'string' ? e.v : null; }
  async set(key, value, opts = {}) { this.#put(key, String(value), opts.EX ? Date.now() + opts.EX * 1000 : 0); return 'OK'; }
  async del(keys) { let n = 0; for (const k of Array.isArray(keys) ? keys : [keys]) if (this.data.delete(k)) n++; return n; }
  async expire(key, seconds) { const e = this.#live(key); if (!e) return 0; e.exp = Date.now() + seconds * 1000; return 1; }
  async hSet(key, obj) {
    let e = this.#live(key);
    if (!e) { this.#put(key, new Map()); e = this.data.get(key); }
    for (const [f, v] of Object.entries(obj)) e.v.set(f, String(v));
    return Object.keys(obj).length;
  }
  async hGet(key, field) { return this.#live(key)?.v.get?.(field) ?? null; }
  async hGetAll(key) { const e = this.#live(key); return e?.v instanceof Map ? Object.fromEntries(e.v) : {}; }
  async sAdd(key, member) {
    let e = this.#live(key);
    if (!e) { this.#put(key, new Set()); e = this.data.get(key); }
    e.v.add(member); return 1;
  }
  async sRem(key, member) { return this.#live(key)?.v.delete?.(member) ? 1 : 0; }
  async sMembers(key) { const e = this.#live(key); return e?.v instanceof Set ? [...e.v] : []; }
  /** Only the rate-limiter's script is supported: INCR key, set expiry on first use, return [count, ms left]. */
  async eval(script, { keys = [], arguments: argv = [] } = {}) {
    if (!script.includes("redis.call('INCR'")) throw new Error('MemoryClient supports only the rate-limit script');
    const [key] = keys; const e = this.#live(key);
    const count = e ? Number(e.v) + 1 : 1;
    this.#put(key, String(count), e ? e.exp : Date.now() + Number(argv[0]));
    return [count, this.data.get(key).exp - Date.now()];
  }
  /** Glob match (only * wildcard) — tests/admin only. */
  async keys(pattern) {
    const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return [...this.data.keys()].filter(k => this.#live(k) && re.test(k));
  }
  async flushDb() { this.data.clear(); return 'OK'; }
  /** Same chainable shape as Client.multi(); the commands run back-to-back (single-threaded, so atomic). */
  multi() {
    const ops = [];
    const tx = {
      hSet: (k, o) => (ops.push(() => this.hSet(k, o)), tx),
      expire: (k, s) => (ops.push(() => this.expire(k, s)), tx),
      sAdd: (k, m) => (ops.push(() => this.sAdd(k, m)), tx),
      exec: async () => { const out = []; for (const op of ops) out.push(await op()); return out; },
    };
    return tx;
  }
}

/** The shared client instance used across the app (connect it once at boot with connectKv()). VALKEY_URL=memory → in-process store. */
export const kv = config.valkeyUrl === 'memory' ? new MemoryClient() : new Client(config.valkeyUrl);
kv.on('error', e => console.error('[kv]', e.message));

/** Connect the shared client (no-op if already connected). */
export async function connectKv() { if (!kv.isOpen) await kv.connect(); }
/** Close the shared client (used on shutdown and in tests). */
export async function closeKv() { if (kv.isOpen) await kv.quit(); }

/**
 * Cache-aside helper: return the cached JSON for `key`, or run `fn`, store its result for `ttl`
 * seconds and return it. Any cache error falls through to `fn`, so Valkey trouble only costs speed.
 */
export async function cached(key, ttl, fn) {
  try {
    const hit = await kv.get(key);
    if (hit) return JSON.parse(hit);
  } catch {}
  const val = await fn();
  kv.set(key, JSON.stringify(val), { EX: ttl }).catch(() => {});
  return val;
}
