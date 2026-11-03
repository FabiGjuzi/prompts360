// Test harness: boots the real server against a scratch PostgreSQL database and Valkey db 1.
import pg from 'pg';
import { createClient } from '@redis/client';

export const PORT = 18080;
export const BASE = `http://localhost:${PORT}`;
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres:devpass@127.0.0.1:54329/prompts360_test';
const KV = process.env.TEST_VALKEY_URL || 'redis://127.0.0.1:6380/1';

Object.assign(process.env, {
  NODE_ENV: 'test', BASE_URL: BASE, DATABASE_URL: DB, VALKEY_URL: KV, MAIL_TRANSPORT: 'memory',
  CLIENT_IP_HEADER: 'x-test-ip', ARGON_MEMORY_KIB: '8192', ARGON_TIME: '1', MICROCACHE_SEC: '0',
});

export async function boot() {
  const admin = new pg.Client({ connectionString: DB });
  await admin.connect();
  await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await admin.end();
  const kv = createClient({ url: KV });
  await kv.connect(); await kv.flushDb(); await kv.quit();

  const db = await import('../src/db.js');
  await db.migrate();
  const { connectKv, closeKv } = await import('../src/kv.js');
  await connectKv();
  const { createServer } = await import('../src/server.js');
  const mail = await import('../src/mail.js');
  const server = createServer();
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  return {
    db, mail,
    async close() { await new Promise(r => server.close(r)); server.closeAllConnections?.(); await closeKv(); await db.closeDb(); },
  };
}

export async function flushKv() {
  const kv = createClient({ url: KV });
  await kv.connect(); await kv.flushDb(); await kv.quit();
}

/** Clear only rate-limit counters (sessions survive). */
export async function flushLimits() {
  const kv = createClient({ url: KV });
  await kv.connect();
  const keys = await kv.keys('rl:*');
  if (keys.length) await kv.del(keys);
  await kv.quit();
}

let ipSeq = 1;
/** Browser-like client with a cookie jar, Origin header and its own source IP. */
export function client(ip = `10.0.0.${ipSeq++}`) {
  let cookie = '';
  const c = {
    ip,
    get cookie() { return cookie; },
    set cookie(v) { cookie = v; },
    async req(method, path, { form, headers = {}, raw } = {}) {
      const h = { 'x-test-ip': c.ip, ...headers };
      if (cookie) h.cookie = cookie;
      let body;
      if (form) { body = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; h.origin ??= BASE; }
      if (raw !== undefined) body = raw;
      const res = await fetch(BASE + path, { method, headers: h, body, redirect: 'manual' });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = /Max-Age=0/.test(sc) ? '' : sc.split(';')[0];
      const text = await res.text();
      return { status: res.status, headers: res.headers, text, location: res.headers.get('location') };
    },
    get: (p, o) => c.req('GET', p, o),
    post: (p, form, o = {}) => c.req('POST', p, { ...o, form }),
  };
  return c;
}

export const field = (html, name) => {
  const m = html.match(new RegExp(`name="${name}" value="([^"]*)"`));
  return m ? m[1].replace(/&#61;/g, '=').replace(/&amp;/g, '&').replace(/&quot;/g, '"') : null;
};

export const PW = 'CorrectHorse9Battery';

/** Full signup → email verify → login. Returns a logged-in client. */
export async function makeUser(mail, { username = '', password = PW, email } = {}) {
  const c = client();
  const page = await c.get('/signup');
  const suggested = field(page.text, 'suggested');
  email ||= `${(username || suggested).toLowerCase()}@example.com`;
  const r = await c.post('/signup', { _ft: field(page.text, '_ft'), suggested, username, email, password, password2: password });
  if (r.status !== 200 || !r.text.includes('Check your email')) throw new Error(`signup failed: ${r.status} ${r.text.match(/class="error"[^<]*>([^<]*)/)?.[1]}`);
  const msg = mail.sentForTests.findLast(m => m.to === email.toLowerCase());
  await mail.drainOutbox(); await mail.drainOutbox();
  const verifyMsg = mail.sentForTests.findLast(m => m.to === email.toLowerCase() && m.subject.startsWith('Verify'));
  const token = verifyMsg.text.match(/verify\?t=([A-Za-z0-9_-]+)/)[1];
  const vp = await c.get(`/verify?t=${token}`);
  await c.post('/verify', { _ft: field(vp.text, '_ft'), t: token });
  const name = username || suggested;
  await login(c, name, password);
  c.username = name; c.email = email;
  return c;
}

export async function login(c, username, password = PW) {
  c.cookie = '';
  const lp = await c.get('/login');
  return c.post('/login', { _ft: field(lp.text, '_ft'), username, password });
}

/** CSRF token for a logged-in client (taken from any page's logout form). */
export async function csrf(c) {
  const r = await c.get('/settings');
  return field(r.text, '_csrf');
}
