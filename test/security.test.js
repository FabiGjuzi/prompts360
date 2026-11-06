// Attack suite: injection, XSS, CSRF, brute force, enumeration, session attacks, DoS guards, data-at-rest checks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { boot, client, field, makeUser, login, csrf, PW, flushKv, flushLimits, BASE, earnPoints } from './_helpers.js';

let app, eve, victim, et, postPath;
before(async () => {
  app = await boot();
  victim = await makeUser(app.mail, { username: 'victim_user' });
  eve = await makeUser(app.mail, { username: 'eve_attacker' });
  et = await csrf(eve);
  await earnPoints(app, eve);
  await eve.post('/communities/new', { _csrf: et, name: 'sec_test', title: 'Security', tag: 'general' });
});
after(async () => { await app.close(); });

const SQLI = [`' OR '1'='1`, `'; DROP TABLE users; --`, `1 UNION SELECT pass_hash FROM users--`, `\\'; SELECT pg_sleep(5); --`, `") OR 1=1 /*`, `1; UPDATE users SET is_admin=true`];

test('SQL injection: payloads in every input are treated as data', async () => {
  const c = client();
  for (const p of SQLI) {
    const e = encodeURIComponent(p);
    for (const path of [`/?sort=${e}`, `/?tag=${e}`, `/?after=${e}`, `/?sort=top&t=${e}`, `/search?q=${e}`, `/communities?sort=new&after=${e}`, `/communities?tag=${e}`, `/u/${e}`, `/c/${e}`, `/p/1?sort=${e}`]) {
      const r = await c.get(path);
      assert.ok(r.status < 500, `${path} -> ${r.status}`);
    }
    assert.equal((await login(client(), p, p)).status, 401);
  }
  const t0 = Date.now();
  await c.get(`/search?q=${encodeURIComponent("'); SELECT pg_sleep(3); --")}`);
  assert.ok(Date.now() - t0 < 2000, 'no time-based injection');
  // Payloads stored literally in content.
  const r = await eve.post('/submit', { _csrf: et, community: 'sec_test', tag: 'general', title: SQLI[1], body: SQLI.join('\n') });
  assert.equal(r.status, 303);
  const { rows } = await app.db.q("SELECT count(*)::int AS n FROM users");
  assert.ok(rows[0].n >= 2, 'users table intact');
  const { rows: admins } = await app.db.q('SELECT count(*)::int AS n FROM users WHERE is_admin');
  assert.equal(admins[0].n, 0);
  assert.ok((await client().get(r.location)).text.includes('DROP TABLE users; --'));
});

const XSS = [
  '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"><svg/onload=alert(1)>', "'><iframe src=javascript:alert(1)>",
  '[click](javascript:alert(1))', '[x](JaVaScRiPt:alert(1))', '[x](data:text/html,<script>alert(1)</script>)',
  '<a href="javascript:alert(1)">x</a>', '`<script>alert(1)</script>`', '**<b onmouseover=alert(1)>x</b>**',
  'https://example.com/"onmouseover="alert(1)', '[ok](https://example.com/"><script>alert(1)</script>)',
];
test('XSS: user content can never produce executable markup', async () => {
  for (const p of XSS) {
    await flushLimits();
    const r = await eve.post('/submit', { _csrf: et, community: 'sec_test', tag: 'general', title: p, body: p, url: '' });
    assert.equal(r.status, 303, `submit ${p}`);
    const page = (await client().get(r.location)).text;
    const content = page.slice(page.indexOf('<main'));
    assert.doesNotMatch(content, /<script/i, p);
    assert.doesNotMatch(content, /<(img|svg|iframe|b)\b[^>]*\son\w+\s*=/i, p);
    assert.doesNotMatch(content, /href="\s*(javascript|data|vbscript):/i, p);
    assert.doesNotMatch(content, /<[a-z][^<>]*\son[a-z]+\s*=/i, p);   // any real tag carrying an event handler
    await eve.post(`${r.location.match(/\/p\/\d+/)[0]}/comment`, { _csrf: et, body: p });
    const after = (await client().get(r.location)).text;
    assert.doesNotMatch(after.slice(after.indexOf('<main')), /<script|<[a-z][^<>]*\son[a-z]+\s*=|href="javascript:/i, `comment ${p}`);
  }
  // Link field only accepts http(s).
  const r = await eve.post('/submit', { _csrf: et, community: 'sec_test', tag: 'general', title: 'x', url: 'javascript:alert(1)' });
  assert.match(r.text, /must start with http/);
  // Search box reflection is escaped.
  const s = await client().get(`/search?q=${encodeURIComponent('"><script>alert(1)</script>')}`);
  assert.doesNotMatch(s.text, /<script>alert/);
  // Username field rejects markup.
  const page = await client().get('/signup');
  const u = await client().post('/signup', { _ft: field(page.text, '_ft'), suggested: field(page.text, 'suggested'), username: '<script>x</script>', email: 'x@example.com', password: PW, password2: PW });
  assert.equal(u.status, 400);
});

test('CSRF: forged and token-less requests are rejected', async () => {
  // No token.
  let r = await eve.post('/submit', { community: 'sec_test', tag: 'general', title: 'csrf' });
  assert.equal(r.status, 403);
  // Another user's token.
  r = await eve.post('/submit', { _csrf: await csrf(victim), community: 'sec_test', tag: 'general', title: 'csrf' });
  assert.equal(r.status, 403);
  // Valid token but cross-site Origin / Sec-Fetch-Site.
  r = await eve.post('/submit', { _csrf: et, community: 'sec_test', tag: 'general', title: 'csrf' }, { headers: { origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
  r = await eve.post('/vote', { _csrf: et, type: 'p', id: '1', dir: '1' }, { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(r.status, 403);
  // Logged-out forms need a signed, unexpired form token (blocks login CSRF).
  r = await client().post('/login', { username: 'victim_user', password: PW });
  assert.equal(r.status, 403);
  r = await client().post('/login', { _ft: '9999999999.abc.forged', username: 'victim_user', password: PW });
  assert.equal(r.status, 403);
  r = await client().post('/login', { _ft: '1000.abc.def', username: 'victim_user', password: PW });
  assert.equal(r.status, 403);
});

test('Brute force: per-account lockout and per-IP throttling', async () => {
  await flushKv();
  victim = await (async () => { const c = client(); await login(c, 'victim_user'); return c; })();
  for (let i = 0; i < 10; i++) {
    const r = await login(client(`172.16.0.${i + 1}`), 'victim_user', `WrongGuess${i}AAA`);
    assert.equal(r.status, 401);
  }
  const locked = await login(client('172.16.1.1'), 'victim_user', PW);   // even the right password
  assert.equal(locked.status, 429);
  assert.match(locked.text, /temporarily locked/);
  await flushKv();
  const one = client('172.16.2.2');
  let last;
  for (let i = 0; i < 21; i++) last = await login(one, `user${i}`, 'x');
  assert.equal(last.status, 429, 'per-IP login limit');
  await flushKv();
  victim = await (async () => { const c = client(); await login(c, 'victim_user'); return c; })();
  eve = await (async () => { const c = client(); await login(c, 'eve_attacker'); return c; })();
  et = await csrf(eve);
});

test('Account enumeration: signup with a taken email looks identical', async () => {
  const strip = s => s.replace(/value="[^"]*"/g, '').replace(/anon-[0-9a-f]{8}/g, 'anon-x');   // only the random name differs
  const try1 = async email => {
    const c = client(); const p = await c.get('/signup');
    return c.post('/signup', { _ft: field(p.text, '_ft'), suggested: field(p.text, 'suggested'), username: '', email, password: PW, password2: PW });
  };
  const a = await try1('victim_user@example.com');    // already registered
  const b = await try1('brand.new@example.com');
  assert.equal(a.status, b.status);
  assert.equal(strip(a.text), strip(b.text));
  await app.mail.drainOutbox(); await app.mail.drainOutbox();
  assert.ok(app.mail.sentForTests.some(m => m.to === 'victim_user@example.com' && /Sign-up attempt/.test(m.subject)), 'owner is notified');
});

test('Session attacks: fixation, logout invalidation, forged cookies, hashed storage', async () => {
  // Fixation: a cookie chosen before login is never adopted.
  const c = client();
  c.cookie = 'sid=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const lp = await c.get('/login');
  await c.post('/login', { _ft: field(lp.text, '_ft'), username: 'victim_user', password: PW });
  assert.notEqual(c.cookie, 'sid=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  // Logout kills the server-side session; replaying the old cookie fails.
  const stolen = c.cookie;
  await c.post('/logout', { _csrf: await csrf(c) });
  const replay = client(); replay.cookie = stolen;
  assert.equal((await replay.get('/settings')).status, 303);
  // Random / malformed cookies are ignored.
  for (const v of ['sid=x', `sid=${'A'.repeat(43)}`, 'sid=../../etc/passwd', `sid=${'%00'.repeat(10)}`]) {
    const x = client(); x.cookie = v;
    assert.equal((await x.get('/settings')).status, 303);
  }
  // Valkey stores only SHA-256 hashes of session tokens.
  const { kv } = await import('../src/kv.js');
  const keys = await kv.keys('s:*');
  const raw = eve.cookie.split('=')[1];
  assert.ok(keys.length > 0 && keys.every(k => !k.includes(raw)));
});

test('Open redirects are blocked', async () => {
  for (const back of ['//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)', '\\\\evil.example']) {
    const c = client();
    const lp = await c.get('/login');
    const r = await c.post('/login', { _ft: field(lp.text, '_ft'), username: 'eve_attacker', password: PW, back });
    assert.equal(r.location, '/', back);
    const v = await eve.post('/vote', { _csrf: et, type: 'p', id: '1', dir: '1', back });
    assert.equal(v.location, '/', back);
  }
});

test('Request smuggling of objects: prototype pollution and parameter pollution', async () => {
  const r = await eve.req('POST', '/vote', {
    raw: `_csrf=${et}&__proto__[admin]=1&constructor[prototype][admin]=1&type=p&type=c&id=1&dir=1`,
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE, 'x-requested-with': 'fetch' },
  });
  assert.ok(r.status < 500);
  assert.equal({}.admin, undefined);
  assert.equal(Object.prototype.admin, undefined);
});

test('DoS guards: body size, content type, methods, headers, ReDoS, path traversal', async () => {
  let r = await eve.req('POST', '/vote', { raw: `_csrf=${et}&x=${'a'.repeat(50_000)}`, headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE } });
  assert.equal(r.status, 413);
  r = await eve.req('POST', '/vote', { raw: JSON.stringify({ _csrf: et }), headers: { 'content-type': 'application/json', origin: BASE } });
  assert.equal(r.status, 415);
  for (const m of ['PUT', 'DELETE', 'PATCH', 'OPTIONS']) assert.equal((await client().req(m, '/')).status, 405, m);
  for (const p of ['/s/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/s/..%2f..%2fpackage.json', '/.env', '/src/config.js', '/package.json', '/.git/config']) {
    const res = await client().get(p);
    assert.equal(res.status, 404, p);
    assert.doesNotMatch(res.text, /DATABASE_URL|root:|"dependencies"/);
  }
  // Pathological markdown renders quickly (no catastrophic backtracking).
  const { markdown } = await import('../src/markdown.js');
  for (const evil of ['*'.repeat(40000), '['.repeat(40000), '_a'.repeat(20000), '**a'.repeat(13000), 'http://' + 'a'.repeat(39000), '`'.repeat(40000), '~~'.repeat(20000), '> '.repeat(20000)]) {
    const t0 = performance.now(); markdown(evil);
    assert.ok(performance.now() - t0 < 300, `markdown ReDoS on ${evil.slice(0, 10)}…`);
  }
  // Per-IP flood throttle.
  const flood = client('203.0.113.77');
  let blocked = false;
  for (let i = 0; i < 200 && !blocked; i++) blocked = (await flood.get('/robots.txt').then(() => flood.get('/terms'))).status === 429;
  assert.ok(blocked, 'flood from one IP gets 429');
});

test('Write rate limits: voting and posting', async () => {
  await flushKv();
  const c = await (async () => { const x = client(); await login(x, 'eve_attacker'); return x; })();
  const t = await csrf(c);
  const { rows: [p] } = await app.db.q('SELECT id FROM posts WHERE deleted_at IS NULL AND removed_at IS NULL LIMIT 1');
  let status;
  for (let i = 0; i < 62; i++) status = (await c.post('/vote', { _csrf: t, type: 'p', id: String(p.id), dir: i % 2 ? '1' : '0' }, { headers: { 'x-requested-with': 'fetch' } })).status;
  assert.equal(status, 429);
  await flushKv();
  const c2 = await (async () => { const x = client(); await login(x, 'eve_attacker'); return x; })();
  const t2 = await csrf(c2);
  for (let i = 0; i < 6; i++) status = (await c2.post('/submit', { _csrf: t2, community: 'sec_test', tag: 'general', title: `flood ${i}` })).status;
  assert.equal(status, 429);
  await flushKv();
});

test('Data at rest: no plaintext emails, tokens or IPs in the database', async () => {
  const dump = JSON.stringify((await app.db.q(`SELECT u.*, (SELECT json_agg(t) FROM auth_tokens t) AS tokens, (SELECT json_agg(o) FROM email_outbox o) AS outbox FROM users u`)).rows);
  assert.doesNotMatch(dump, /@example\.com/, 'no plaintext email anywhere');
  assert.doesNotMatch(dump, /10\.0\.0\.|172\.16\.|203\.0\.113/, 'no IP addresses stored');
  const { rows } = await app.db.q("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name ~ '(^|_)(ip|email|password|token)$'");
  assert.deepEqual(rows, [], `unexpected sensitive-looking plaintext columns: ${JSON.stringify(rows)}`);
});

test('Error handling never leaks internals', async () => {
  for (const p of ['/p/999999999999', '/c/does_not_exist', '/u/nobody_at_all', '/nope']) {
    const r = await client().get(p);
    assert.equal(r.status, 404);
    assert.doesNotMatch(r.text, /at \w+ \(|node_modules|SELECT |stack/i);
  }
  const r = await eve.req('POST', '/vote', { raw: '%', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE } });
  assert.ok(r.status < 500, String(r.status));
});

function runWithEnv(env, code) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, ...env }, cwd: process.cwd() });
    let out = ''; p.stdout.on('data', d => (out += d)); p.stderr.on('data', d => (out += d));
    p.on('close', code => resolve({ code, out }));
  });
}

test('Production config fails closed', async () => {
  const r = await runWithEnv({ NODE_ENV: 'production', BASE_URL: 'https://prompts360.si' }, "await import('./src/config.js')");
  assert.notEqual(r.code, 0);
  assert.match(r.out, /Missing required environment variable|development key/);
  const k = Buffer.alloc(32, 1).toString('base64');
  const r2 = await runWithEnv({ NODE_ENV: 'production', BASE_URL: 'https://prompts360.si', DATABASE_URL: 'x', VALKEY_URL: 'x', APP_SECRET: k, DATA_KEY: k, TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET: '' }, "await import('./src/config.js')");
  assert.notEqual(r2.code, 0, 'no captcha keys => refuse to start');
});

test('Turnstile verification fails closed', async () => {
  const r = await runWithEnv({ TURNSTILE_SECRET: '0x4AAAAAAAdummy', TURNSTILE_SITE_KEY: 'x' },
    "const { verifyHuman } = await import('./src/turnstile.js'); console.log(await verifyHuman('', '1.2.3.4', 'login'), await verifyHuman('forged-token', '1.2.3.4', 'login'))");
  assert.match(r.out.trim(), /false false$/);
});

test('Origin lock: direct-to-origin requests (bypassing Cloudflare) are refused', async () => {
  const code = `const { createServer } = await import('./src/server.js'); const s = createServer();
    await new Promise(r => s.listen(18099, '127.0.0.1', r));
    const a = await fetch('http://127.0.0.1:18099/robots.txt');
    const b = await fetch('http://127.0.0.1:18099/robots.txt', { headers: { 'x-origin-secret': 's3cret-value' } });
    const c = await fetch('http://127.0.0.1:18099/healthz');
    console.log(a.status, b.status, c.status); s.close(); process.exit(0);`;
  const r = await runWithEnv({ ORIGIN_SECRET: 's3cret-value' }, code);
  assert.match(r.out, /403 200 200/);
});

test('Micro-cache never stores forms or personalised pages', async () => {
  const code = `const { createServer } = await import('./src/server.js'); const s = createServer();
    await new Promise(r => s.listen(18098, '127.0.0.1', r));
    const get = async (p, h = {}) => (await fetch('http://127.0.0.1:18098' + p, { headers: h })).text();
    const ft = t => t.match(/name="_ft" value="([^"]+)"/)?.[1];
    const a = ft(await get('/login')), b = ft(await get('/login'));
    const t1 = await get('/terms'), t2 = await get('/terms');
    const withCookie = await get('/terms?x=1', { cookie: 'sid=whatever' }), anonSame = await get('/terms?x=1');
    console.log(JSON.stringify({ formsDiffer: a !== b && !!a, termsCached: t1 === t2, cc: (await fetch('http://127.0.0.1:18098/login')).headers.get('cache-control') }));
    s.close(); process.exit(0);`;
  const r = await runWithEnv({ MICROCACHE_SEC: '5' }, code);
  const out = JSON.parse(r.out.trim().split('\n').pop());
  assert.equal(out.formsDiffer, true, 'login form tokens must be unique per render');
  assert.equal(out.termsCached, true);
  assert.equal(out.cc, 'private, no-store');
});
