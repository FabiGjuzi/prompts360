// flow.test.js — end-to-end tests of the product through real HTTP against a real PostgreSQL + Valkey:
// signup/verify/login, communities, posts, comments, votes, moderation, recovery, account deletion.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, client, field, makeUser, login, csrf, PW, adminClient, ADMIN } from './_helpers.js';

let app, alice, bob;
before(async () => { app = await boot(); });
after(async () => { await app.close(); });

test('anonymous home page is public, cacheable and hardened', async () => {
  const r = await client().get('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control'), /public, max-age=0, s-maxage=30/);
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('signup: generated anon username, encrypted email, argon2id hash, captcha-free in tests', async () => {
  const c = client();
  const page = await c.get('/signup');
  assert.equal(page.headers.get('cache-control'), 'private, no-store');
  const suggested = field(page.text, 'suggested');
  assert.match(suggested, /^anon-[0-9a-f]{8}$/);
  assert.ok(page.text.includes(`placeholder="${suggested}"`));

  const bad = async (p1, p2, msg) => {
    const r = await c.post('/signup', { _ft: field(page.text, '_ft'), suggested, username: '', email: 'x@example.com', password: p1, password2: p2 });
    assert.equal(r.status, 400); assert.match(r.text, msg);
  };
  await bad('Short1A', 'Short1A', /at least 12/);
  await bad('alllowercase123', 'alllowercase123', /uppercase/);
  await bad('NoNumbersHereAtAll', 'NoNumbersHereAtAll', /number/);
  await bad('GoodPassword123', 'GoodPassword124', /match/);

  alice = await makeUser(app.mail, { username: 'alice_ai' });
  const { rows: [u] } = await app.db.q("SELECT * FROM users WHERE username = 'alice_ai'");
  assert.ok(u.verified_at);
  assert.match(u.pass_hash, /^\$argon2id\$/);
  assert.ok(!('email_enc' in u), 'the email address is not stored at all, not even encrypted');
  assert.ok(!JSON.stringify(u).includes('alice_ai@example.com'));
  assert.equal(u.email_bidx.length, 32);

  const anon = await makeUser(app.mail);           // blank username => keeps the generated anon-xxxxxxxx name
  assert.match(anon.username, /^anon-[0-9a-f]{8}$/);
  bob = await makeUser(app.mail, { username: 'bob-prompts' });
});

test('login requires a verified email; wrong credentials give one generic message', async () => {
  const c = client();
  const page = await c.get('/signup');
  await c.post('/signup', { _ft: field(page.text, '_ft'), suggested: field(page.text, 'suggested'), username: 'unverified1', email: 'unv@example.com', password: PW, password2: PW });
  let r = await login(c, 'unverified1');
  assert.equal(r.status, 403); assert.match(r.text, /Verify your email first/);

  r = await login(client(), 'alice_ai', 'WrongPassword123');
  assert.equal(r.status, 401); assert.match(r.text, /Wrong username or password/);
  r = await login(client(), 'nobody_here', 'WrongPassword123');
  assert.equal(r.status, 401); assert.match(r.text, /Wrong username or password/);
});

test('session cookie: HttpOnly, SameSite, no Max-Age (ends with browser); logged-in pages are private', async () => {
  const c = client();
  const lp = await c.get('/login');
  const res = await fetch('http://localhost:18080/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost:18080', 'x-test-ip': '10.9.9.9' },
    body: new URLSearchParams({ _ft: field(lp.text, '_ft'), username: 'alice_ai', password: PW }),
  });
  const sc = res.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Lax/); assert.doesNotMatch(sc, /Max-Age|Expires/i);
  const home = await alice.get('/');
  assert.equal(home.headers.get('cache-control'), 'private, no-store');
  assert.match(home.text, /alice_ai/);
});

let postId;
test('communities, posts, comments, replies, votes', async () => {
  const t = await csrf(alice);
  let r = await alice.post('/communities/new', { _csrf: t, name: 'claude_prompts', title: 'Claude prompts', description: 'Share prompts for Claude', tag: 'claude' });
  assert.equal(r.status, 303);
  r = await alice.post('/communities/new', { _csrf: t, name: 'CLAUDE_prompts', title: 'dup', tag: 'claude' });
  assert.match(r.text, /already exists/);

  r = await alice.post('/submit', { _csrf: t, community: 'claude_prompts', title: 'My best system prompt', url: '', body: '**Bold** and `code`\n\n```\nYou are a helpful assistant\n```' });
  assert.equal(r.status, 303);
  postId = Number(r.location.match(/\/p\/(\d+)/)[1]);
  const page = await client().get(r.location);
  assert.match(page.text, /<strong>Bold<\/strong>/);
  assert.match(page.text, /<pre><code>You are a helpful assistant<\/code><\/pre>/);

  const tb = await csrf(bob);
  r = await bob.post(`/p/${postId}/comment`, { _csrf: tb, body: 'Great prompt!' });
  assert.equal(r.status, 303);
  const cid = Number(r.location.match(/#c(\d+)/)[1]);
  r = await alice.post(`/p/${postId}/comment`, { _csrf: t, body: 'Thanks!', parent: String(cid) });
  assert.equal(r.status, 303);

  // Votes: author auto-upvotes (score 1). Bob upvotes -> 2, flips to down -> 0, clears -> 1.
  const vote = async dir => JSON.parse((await bob.post('/vote', { _csrf: tb, type: 'p', id: String(postId), dir }, { headers: { 'x-requested-with': 'fetch' } })).text);
  assert.deepEqual(await vote('1'), { score: 2, vote: 1 });
  assert.deepEqual(await vote('1'), { score: 2, vote: 1 });          // idempotent
  assert.deepEqual(await vote('-1'), { score: 0, vote: -1 });
  assert.deepEqual(await vote('0'), { score: 1, vote: 0 });
  const cv = JSON.parse((await alice.post('/vote', { _csrf: t, type: 'c', id: String(cid), dir: '1' }, { headers: { 'x-requested-with': 'fetch' } })).text);
  assert.deepEqual(cv, { score: 2, vote: 1 });

  const post = await client().getf(`/p/${postId}`);
  assert.match(post.text, /2 comments/);
  assert.match(post.text, /Great prompt!/);
  assert.match(post.text, /Thanks!/);
  const comm = await client().get('/c/claude_prompts');
  assert.match(comm.text, /My best system prompt/);
  const tagged = await client().getf('/?tag=claude');
  assert.match(tagged.text, /My best system prompt/);
  const other = await client().getf('/?tag=gemini');
  assert.doesNotMatch(other.text, /My best system prompt/);
});

test('only authors can edit/delete; IDOR blocked', async () => {
  const tb = await csrf(bob);
  let r = await bob.post(`/p/${postId}/edit`, { _csrf: tb, body: 'hacked' });
  assert.equal(r.status, 403);
  r = await bob.post(`/p/${postId}/delete`, { _csrf: tb });
  assert.equal(r.status, 403);
  const t = await csrf(alice);
  r = await alice.post(`/p/${postId}/edit`, { _csrf: t, body: 'Edited body' });
  assert.equal(r.status, 303);
  assert.match((await client().getf(`/p/${postId}`)).text, /Edited body/);
});

test('feeds paginate with keyset cursors and no duplicates', async () => {
  const t = await csrf(alice);
  const { rows: [c] } = await app.db.q("SELECT id, ai_tag_id FROM communities WHERE name = 'claude_prompts'");
  await app.db.q(`INSERT INTO posts (community_id, ai_tag_id, author_id, title, hot, created_at)
    SELECT $1, $2, (SELECT id FROM users WHERE username = 'alice_ai'), 'Bulk post ' || g, hot_rank(1, now() - g * interval '1 minute'), now() - g * interval '1 minute'
    FROM generate_series(1, 60) g`, [c.id, c.ai_tag_id]);
  for (const sort of ['hot', 'new', 'top']) {
    const seen = new Set();
    let url = `/?sort=${sort}&t=all`;
    let pages = 0;
    while (url && pages < 10) {
      const r = await client().get(url);
      const ids = [...r.text.matchAll(/<h2><a href="\/p\/(\d+)\//g)].map(m => m[1]);
      for (const id of ids) { assert.ok(!seen.has(id), `duplicate ${id} in ${sort}`); seen.add(id); }
      url = r.text.match(/href="([^"]+)" rel="next"/)?.[1]?.replace(/&amp;/g, '&');
      pages++;
    }
    assert.equal(seen.size, 61, `${sort} feed should list every post exactly once`);
  }
  void t;
});

test('search uses full-text index', async () => {
  const r = await client().get('/search?q=system+prompt');
  assert.match(r.text, /My best system prompt/);
});

test('reports and admin moderation (superadmin dashboard)', async () => {
  const tb = await csrf(bob);
  let r = await bob.post('/report', { _csrf: tb, type: 'p', id: String(postId), reason: 'spam' });
  assert.equal(r.status, 303);
  assert.equal((await bob.get('/admin')).status, 404, 'the old /admin path does not exist');
  assert.equal((await bob.get(`${ADMIN}/reports`)).status, 404, 'forum users cannot open the dashboard');
  const adm = await adminClient(app);
  r = await adm.get(`${ADMIN}/reports`);
  assert.equal(r.status, 200); assert.match(r.text, /spam/);
  const rid = r.text.match(/reports\/(\d+)\/remove/)[1];
  r = await adm.apost(`/reports/${rid}/remove`, {});
  assert.equal(r.status, 303);
  assert.doesNotMatch((await client().get('/?sort=new')).text, /My best system prompt/);
  assert.match((await client().getf(`/p/${postId}`)).text, /\[removed\]/);
  assert.doesNotMatch((await adm.get(`${ADMIN}/reports`)).text, /spam/);
});

test('ban signs the user out everywhere', async () => {
  const { rows: [b] } = await app.db.q("SELECT id, username FROM users WHERE username = 'bob-prompts'");
  const adm = await adminClient(app);
  let r = await adm.apost(`/t/users/${b.id}`, { username: b.username, verified_at: '2026-01-01T00:00', banned_at: '2026-01-02T00:00', deleted_at: '' });
  assert.equal(r.status, 303);
  r = await bob.get('/settings');
  assert.equal(r.status, 303, 'banned user session must be gone');
  const again = await login(client(), 'bob-prompts');
  assert.equal(again.status, 403);
  await adm.apost(`/t/users/${b.id}`, { username: b.username, verified_at: '2026-01-01T00:00', banned_at: '', deleted_at: '' });
  await login(bob, 'bob-prompts');
});

test('resend verification: user types the address, only its fingerprint is stored', async () => {
  const c = client();
  const p = await c.get('/signup');
  await c.post('/signup', { _ft: field(p.text, '_ft'), suggested: field(p.text, 'suggested'), username: 'resend_me', email: 'resend.me@example.com', password: PW, password2: PW });
  await app.mail.drainOutbox(); await app.mail.drainOutbox();
  const { rows: [u0] } = await app.db.q("SELECT * FROM users WHERE username = 'resend_me'");
  assert.ok(!('email_enc' in u0) && u0.email_bidx.length === 32);
  const r = await login(c, 'resend_me');
  assert.equal(r.status, 403); assert.match(r.text, /Resend verification/);
  const ask = async email => { const f = await c.get('/resend'); return c.post('/resend', { _ft: field(f.text, '_ft'), email }); };
  const before = app.mail.sentForTests.length;
  const hit = await ask('resend.me@example.com');
  const miss = await ask('nobody.here@example.com');
  assert.equal(hit.status, 200);
  assert.equal(hit.text.replace(/value="[^"]*"/g, ''), miss.text.replace(/value="[^"]*"/g, ''), 'same answer for unknown addresses');
  await app.mail.drainOutbox(); await app.mail.drainOutbox();
  const sent = app.mail.sentForTests.slice(before);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'resend.me@example.com');
  const token = sent[0].text.match(/verify\?t=([A-Za-z0-9_-]+)/)[1];
  const vp = await c.get(`/verify?t=${token}`);
  assert.equal((await c.post('/verify', { _ft: field(vp.text, '_ft'), t: token })).status, 303);
  assert.equal((await login(c, 'resend_me')).status, 303);
});

test('forgot password: same answer for unknown emails, reset revokes old sessions', async () => {
  const c = client();
  const ask = async email => { const p = await c.get('/forgot'); return c.post('/forgot', { _ft: field(p.text, '_ft'), email }); };
  const before = app.mail.sentForTests.length;
  const a = await ask('nobody@example.com');
  const b = await ask('bob-prompts@example.com');
  const strip = s => s.replace(/value="[^"]*"/g, '');
  assert.equal(strip(a.text), strip(b.text), 'response must not reveal whether the email exists');
  await app.mail.drainOutbox(); await app.mail.drainOutbox();
  const msg = app.mail.sentForTests.slice(before).find(m => m.subject.startsWith('Reset'));
  const token = msg.text.match(/reset\?t=([A-Za-z0-9_-]+)/)[1];
  const rp = await c.get(`/reset?t=${token}`);
  const NEW = 'BrandNewPass42word';
  let r = await c.post('/reset', { _ft: field(rp.text, '_ft'), t: token, password: NEW, password2: NEW });
  assert.equal(r.status, 303);
  r = await c.post('/reset', { _ft: field(rp.text, '_ft'), t: token, password: NEW, password2: NEW });
  assert.equal(r.status, 400, 'reset links are single-use');
  assert.equal((await bob.get('/settings')).status, 303, 'old session revoked after reset');
  assert.equal((await login(client(), 'bob-prompts', PW)).status, 401);
  assert.equal((await login(bob, 'bob-prompts', NEW)).status, 303);
});

test('account deletion erases personal data and content', async () => {
  const carol = await makeUser(app.mail, { username: 'carol_x' });
  const t = await csrf(carol);
  const r0 = await carol.post('/submit', { _csrf: t, community: 'claude_prompts', title: 'Carol secret post', body: 'private stuff' });
  const pid = r0.location.match(/\/p\/(\d+)/)[1];
  const r = await carol.post('/settings/delete', { _csrf: t, current: PW, confirm: 'DELETE' });
  assert.equal(r.status, 303);
  const { rows: [u] } = await app.db.q("SELECT email_bidx, pass_hash, deleted_at FROM users WHERE username = 'carol_x'");
  assert.equal(u.email_bidx, null); assert.equal(u.pass_hash, null); assert.ok(u.deleted_at);
  const p = await client().get(`/p/${pid}`);
  assert.doesNotMatch(p.text, /private stuff|Carol secret post/);
  assert.equal((await login(client(), 'carol_x')).status, 401);
});
