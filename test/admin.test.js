// Dashboard tests: hidden URL, login, CRUD, dynamic texts/pages/models, import, metrics, SEO output.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, client, field, makeUser, csrf, adminClient, ADMIN, ADMIN_PW, flushLimits } from './_helpers.js';

let app, adm, alice;
before(async () => {
  app = await boot();
  alice = await makeUser(app.mail, { username: 'alice_admin_t' });
  adm = await adminClient(app);
});
after(async () => { await app.close(); });

test('dashboard is invisible without the secret path and a session', async () => {
  const c = client();
  for (const p of ['/admin', '/dashboard', '/wp-admin', `${ADMIN}/live`, `${ADMIN}/t/users`, `${ADMIN}/logs`, `${ADMIN}/import`, `${ADMIN}/texts`, `${ADMIN}/db`, `${ADMIN}/live.json`]) {
    assert.equal((await c.get(p)).status, 404, p);
  }
  const login = await c.get(ADMIN);
  assert.equal(login.status, 200);
  assert.match(login.headers.get('x-robots-tag'), /noindex/);
  assert.match(login.headers.get('cache-control'), /no-store/);
  assert.doesNotMatch(login.text, /Visitors now/);
  // A logged-in forum user is not an admin.
  assert.equal((await alice.get(`${ADMIN}/live`)).status, 404);
  // The secret path never appears in robots.txt or the sitemap.
  const robots = (await c.get('/robots.txt')).text, sitemap = (await c.get('/sitemap.xml')).text;
  assert.ok(!robots.includes(ADMIN) && !sitemap.includes(ADMIN));
});

test('admin login: wrong password, rate limit, CSRF, separate cookie', async () => {
  const c = client('10.9.9.9');
  let page = await c.get(ADMIN);
  let r = await c.post(`${ADMIN}/login`, { _ft: field(page.text, '_ft'), password: 'wrong-password-123' });
  assert.equal(r.status, 401); assert.match(r.text, /Wrong password/);
  // Missing / forged form token
  r = await c.post(`${ADMIN}/login`, { password: ADMIN_PW });
  assert.equal(r.status, 403);
  r = await c.post(`${ADMIN}/login`, { _ft: 'x.y.z', password: ADMIN_PW });
  assert.equal(r.status, 403);
  // Brute force from one address is cut off.
  let last;
  for (let i = 0; i < 10; i++) { page = await c.get(ADMIN); last = await c.post(`${ADMIN}/login`, { _ft: field(page.text, '_ft'), password: `guess-${i}-xxxxxxx` }); }
  assert.equal(last.status, 429);
  await flushLimits();
  // Admin POSTs without the admin CSRF token are refused, even with a valid session.
  r = await adm.post(`${ADMIN}/texts`, { 't.slogan': 'pwned' });
  assert.equal(r.status, 403);
  r = await adm.post(`${ADMIN}/texts`, { _csrf: csrf.name || 'nope', 't.slogan': 'pwned' });
  assert.equal(r.status, 403);
  // A forum session's CSRF token does not work for admin forms.
  const forumToken = await csrf(alice);
  r = await adm.post(`${ADMIN}/texts`, { _csrf: forumToken, 't.slogan': 'pwned' });
  assert.equal(r.status, 403);
  // Cross-site origin is refused.
  r = await adm.post(`${ADMIN}/texts`, { _csrf: adm.csrf, 't.slogan': 'pwned' }, { headers: { origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
  assert.doesNotMatch((await client().get('/')).text, /pwned/);
  // Cookie is the dedicated admin cookie, HttpOnly + SameSite=Strict.
  const c2 = client(); page = await c2.get(ADMIN);
  const ok = await c2.post(`${ADMIN}/login`, { _ft: field(page.text, '_ft'), password: ADMIN_PW });
  assert.equal(ok.status, 303);
  assert.match(ok.headers.get('set-cookie'), /^asid=/); assert.match(ok.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
});

test('dashboard shows metrics, live visitors, logs and database tables', async () => {
  const visitor = client('10.7.7.7');
  await visitor.get('/'); await visitor.get('/communities'); await visitor.get('/nope-page');
  const { tick } = await import('../src/metrics.js');
  await tick(true);
  const dash = await adm.get(ADMIN);
  assert.equal(dash.status, 200);
  for (const s of ['Visitors now', 'Response time', 'Server health', 'Database', 'SEO health', 'Security', 'Most viewed pages']) assert.match(dash.text, new RegExp(s), s);
  assert.match(dash.text, /<svg[^>]+role="img"/);
  const live = JSON.parse((await adm.get(`${ADMIN}/live.json`)).text);
  assert.ok(live.visitors5m >= 1 && live.reqPerMin >= 3, JSON.stringify(live).slice(0, 200));
  assert.ok(live.recent.some(r => r.p === '/communities' && r.s === 200));
  assert.ok(!JSON.stringify(live).includes('10.7.7.7'), 'no IP addresses in live data');
  assert.equal((await adm.get(`${ADMIN}/live`)).status, 200);
  const { rows } = await app.db.q('SELECT sum(requests)::int AS n FROM metrics_minute'); assert.ok(rows[0].n >= 3);
  const logs = await adm.get(`${ADMIN}/logs`);
  assert.match(logs.text, /Admin login/);
  const db = await adm.get(`${ADMIN}/db`);
  for (const t of ['pages', 'posts', 'users', 'event_log']) assert.match(db.text, new RegExp(`/t/${t}"`));
});

test('metrics store no IP addresses or user identifiers', async () => {
  const { rows } = await app.db.q(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name LIKE 'metrics%' OR table_name = 'event_log'`);
  for (const r of rows) assert.doesNotMatch(r.column_name, /ip|user|addr|agent|cookie/i, `${r.table_name}.${r.column_name}`);
  const dump = JSON.stringify((await app.db.q('SELECT * FROM metrics_page')).rows) + JSON.stringify((await app.db.q('SELECT * FROM event_log')).rows);
  assert.ok(!/10\.\d+\.\d+\.\d+/.test(dump), 'no IPs in stored metrics/logs');
});

test('only whitelisted tables are reachable, and secrets never render', async () => {
  for (const t of ['admin_account', 'auth_tokens', 'email_outbox', 'pg_user', 'users;drop', 'constructor', '__proto__']) {
    assert.equal((await adm.get(`${ADMIN}/t/${t}`)).status, 404, t);
  }
  const users = await adm.get(`${ADMIN}/t/users`);
  assert.equal(users.status, 200);
  assert.doesNotMatch(users.text, /argon2id|pass_hash|email_bidx/);
  // Injection attempts in search / sort / filter parameters are inert.
  for (const qs of [`q=' OR 1=1 --`, `sort=id;DROP TABLE users`, `sort=pass_hash`, `f=pass_hash&v=1`, `page=-5`, `q=%25_%5C`]) {
    const r = await adm.get(`${ADMIN}/t/users?${encodeURIComponent(qs.split('=')[0])}=${encodeURIComponent(qs.split('=').slice(1).join('='))}`);
    assert.ok(r.status < 500, qs);
  }
  assert.ok((await app.db.q('SELECT count(*) FROM users')).rows[0].count >= 2);
  // The site account cannot be deleted.
  const { rows: [o] } = await app.db.q("SELECT id FROM users WHERE username = 'prompts360'");
  const r = await adm.apost(`/t/users/${o.id}/delete`, {});
  assert.equal(r.status, 400);
  assert.equal((await app.db.q("SELECT count(*)::int AS n FROM users WHERE username = 'prompts360'")).rows[0].n, 1);
  // The site account has no password and cannot log in.
  assert.equal((await app.db.q("SELECT pass_hash FROM users WHERE username = 'prompts360'")).rows[0].pass_hash, null);
});

test('the slogan and every text are editable and reset to defaults', async () => {
  const before = (await client().get('/')).text;
  assert.match(before, /Communicating better for a more intelligent World/);
  let r = await adm.apost('/texts', { 't.slogan': 'Prompts that <b>work</b>', 't.home.heading': 'Hello prompt people', 't.ui.login': 'Sign in' });
  assert.equal(r.status, 303);
  const home = (await client().get('/')).text;
  assert.match(home, /Prompts that &lt;b&gt;work&lt;\/b&gt;/, 'new slogan is shown and HTML-escaped');
  assert.doesNotMatch(home, /Communicating better/);
  assert.match(home, /<h1>Hello prompt people<\/h1>/);
  assert.match(home, />Sign in</);
  assert.match(home, /aria-label="prompts360 — Prompts that &lt;b&gt;work&lt;\/b&gt;"/);
  // Blank = back to the built-in default.
  await adm.apost('/texts', { 't.slogan': '', 't.home.heading': '', 't.ui.login': '' });
  assert.match((await client().get('/')).text, /Communicating better for a more intelligent World/);
  // Unknown keys are ignored.
  await adm.apost('/texts', { 't.evil.key': 'x' });
  assert.equal((await app.db.q("SELECT count(*)::int AS n FROM site_settings WHERE key = 'evil.key'")).rows[0].n, 0);
});

test('pages CRUD: create, render as Markdown, sitemap, reserved slugs, delete', async () => {
  let r = await adm.apost('/t/pages/new', { slug: 'about', title: 'About us', body: '## Who\n\nWe like **prompts**.\n\n<script>alert(1)</script>', meta_description: 'About the site', published: '1', noindex: '0' });
  assert.equal(r.status, 303, r.text.slice(0, 300));
  const page = await client().get('/about');
  assert.equal(page.status, 200);
  assert.match(page.text, /<h1>About us<\/h1>/); assert.match(page.text, /<strong>prompts<\/strong>/);
  assert.doesNotMatch(page.text, /<script>alert/);
  assert.match(page.text, /<link rel="canonical" href="http:\/\/localhost:18080\/about">/);
  assert.match(page.text, /<meta name="description" content="About the site">/);
  assert.match((await client().get('/sitemap.xml')).text, /<loc>http:\/\/localhost:18080\/about<\/loc>/);
  r = await adm.apost('/t/pages/new', { slug: 'login', title: 'x', body: 'x', published: '1' });
  assert.equal(r.status, 400); assert.match(r.text, /reserved/);
  r = await adm.apost('/t/pages/new', { slug: 'Bad Slug', title: 'x', body: 'x', published: '1' });
  assert.equal(r.status, 400);
  r = await adm.apost('/t/pages/new', { slug: 'about', title: 'dup', body: 'x', published: '1' });
  assert.equal(r.status, 400); assert.match(r.text, /unique/);
  // Edit then unpublish
  const { rows: [p] } = await app.db.q("SELECT id FROM pages WHERE slug = 'about'");
  r = await adm.apost(`/t/pages/${p.id}`, { slug: 'about', title: 'About v2', body: 'Changed', meta_description: '', published: '1', noindex: '0' });
  assert.equal(r.status, 303);
  assert.match((await client().get('/about')).text, /About v2/);
  r = await adm.apost(`/t/pages/${p.id}`, { slug: 'about', title: 'About v2', body: 'Changed', meta_description: '', published: '0', noindex: '0' });
  assert.equal((await client().get('/about')).status, 404);
  assert.equal((await adm.apost(`/t/pages/${p.id}/delete`, {})).status, 303);
  // Built-in pages exist and are editable
  assert.match((await client().get('/privacy')).text, /Visitor statistics/);
});

test('navigation links and AI models are dynamic', async () => {
  let r = await adm.apost('/t/nav_links/new', { area: 'footer', label: 'Press kit', url: '/press', sort: '5', enabled: '1' });
  assert.equal(r.status, 303);
  assert.match((await client().get('/')).text, /<a href="\/press">Press kit<\/a>/);
  r = await adm.apost('/t/nav_links/new', { area: 'footer', label: 'Evil', url: 'javascript:alert(1)', sort: '5', enabled: '1' });
  assert.equal(r.status, 400);
  const { rows: [tag] } = await app.db.q("SELECT * FROM ai_tags WHERE slug = 'claude'");
  r = await adm.apost(`/t/ai_tags/${tag.id}`, { slug: 'claude', name: 'Claude (Anthropic)', description: 'Custom intro for Claude prompts.', seo_title: 'Best Claude prompts', seo_desc: 'Handpicked Claude prompts.', sort: '20', enabled: '1' });
  assert.equal(r.status, 303);
  const m = await client().get('/m/claude');
  assert.equal(m.status, 200);
  assert.match(m.text, /<title>Best Claude prompts · prompts360<\/title>/); assert.match(m.text, /Custom intro for Claude prompts\./);
  assert.match(m.text, /<meta name="description" content="Handpicked Claude prompts.">/);
  assert.match(m.text, /<link rel="canonical" href="http:\/\/localhost:18080\/m\/claude">/);
  assert.match(m.text, /Claude \(Anthropic\)/);
  assert.equal((await client().get('/?tag=claude')).status, 301);
  r = await adm.apost(`/t/ai_tags/${tag.id}`, { slug: 'claude', name: 'Claude', description: '', seo_title: '', seo_desc: '', sort: '20', enabled: '0' });
  assert.equal((await client().get('/m/claude')).status, 404, 'disabled model page is gone');
  assert.doesNotMatch((await client().get('/')).text, />Claude</);
  await adm.apost(`/t/ai_tags/${tag.id}`, { slug: 'claude', name: 'Claude', description: '', seo_title: '', seo_desc: '', sort: '20', enabled: '1' });
});

test('communities and posts CRUD keep counters and feeds consistent', async () => {
  const { rows: [tag] } = await app.db.q("SELECT id FROM ai_tags WHERE slug = 'gemini'");
  let r = await adm.apost('/t/communities/new', { name: 'Gemini_Tricks', title: 'Gemini tricks', description: 'Tips for Gemini', ai_tag_id: String(tag.id), creator_id: '', removed_at: '' });
  assert.equal(r.status, 303, r.text.slice(0, 300));
  const { rows: [c] } = await app.db.q("SELECT id FROM communities WHERE name = 'Gemini_Tricks'");
  r = await adm.apost('/t/posts/new', { community_id: String(c.id), title: 'Summarise a PDF', url: '', body: 'Summarise this document in 5 bullets:\n\n```\n[paste]\n```', author_id: '', created_at: '', deleted_at: '', removed_at: '' });
  assert.equal(r.status, 303, r.text.slice(0, 300));
  const { rows: [p] } = await app.db.q("SELECT * FROM posts WHERE title = 'Summarise a PDF'");
  assert.equal(p.score, 1); assert.equal(p.ai_tag_id, tag.id);
  assert.equal((await app.db.q('SELECT post_count FROM communities WHERE id = $1', [c.id])).rows[0].post_count, 1);
  assert.equal((await app.db.q('SELECT count(*)::int AS n FROM post_votes WHERE post_id = $1', [p.id])).rows[0].n, 1);
  const pg = await client().getf(`/p/${p.id}`);
  assert.match(pg.text, /Summarise a PDF/); assert.match(pg.text, /u\/prompts360/);
  assert.match((await client().get('/m/gemini')).text, /Summarise a PDF/);
  // Comment through the dashboard
  r = await adm.apost('/t/comments/new', { post_id: String(p.id), parent_id: '', author_id: '', body: 'Works great.', created_at: '', deleted_at: '', removed_at: '' });
  assert.equal(r.status, 303, r.text.slice(0, 300));
  assert.equal((await app.db.q('SELECT comment_count FROM posts WHERE id = $1', [p.id])).rows[0].comment_count, 1);
  // Bad foreign keys are friendly errors, not 500s
  r = await adm.apost('/t/posts/new', { community_id: '999999', title: 'x', body: '' });
  assert.equal(r.status, 400);
  r = await adm.apost('/t/comments/new', { post_id: '999999', body: 'x' });
  assert.equal(r.status, 400);
  // Remove (hide) the post
  r = await adm.apost(`/t/posts/${p.id}`, { community_id: String(c.id), title: 'Summarise a PDF', url: '', body: 'x', author_id: String(p.author_id), created_at: '', deleted_at: '', removed_at: '2026-01-01T00:00' });
  assert.equal(r.status, 303);
  assert.equal((await app.db.q('SELECT post_count FROM communities WHERE id = $1', [c.id])).rows[0].post_count, 0);
  assert.doesNotMatch((await client().get('/m/gemini')).text, /Summarise a PDF/);
  // Delete community → posts cascade
  assert.equal((await adm.apost(`/t/communities/${c.id}/delete`, {})).status, 303);
  assert.equal((await app.db.q('SELECT count(*)::int AS n FROM posts WHERE community_id = $1', [c.id])).rows[0].n, 0);
});

test('import: preview changes nothing, import is idempotent, problems are reported', async () => {
  const data = JSON.stringify({ communities: [{ name: 'Import_Test', title: 'Import test', description: 'd', model: 'chatgpt' }, { name: 'bad name!', title: 'x', model: 'chatgpt' }, { name: 'No_Model', title: 'x', model: 'nope' }],
    posts: [{ community: 'Import_Test', title: 'First prompt', body: 'Body one' }, { community: 'Import_Test', title: 'Second prompt', body: 'Body two', url: 'https://example.com/x' },
      { community: 'Import_Test', title: 'Bad link', body: 'x', url: 'javascript:alert(1)' }, { community: 'Missing_Community', title: 'Orphan', body: 'x' }] });
  let r = await adm.apost('/import', { mode: 'preview', data });
  assert.equal(r.status, 200); assert.match(r.text, /Preview/);
  assert.equal((await app.db.q("SELECT count(*)::int AS n FROM posts WHERE title = 'First prompt'")).rows[0].n, 0, 'preview writes nothing');
  r = await adm.apost('/import', { mode: 'import', data });
  assert.equal(r.status, 200); assert.match(r.text, /Done/);
  assert.match(r.text, /invalid name/); assert.match(r.text, /unknown model/); assert.match(r.text, /must start with http/); assert.match(r.text, /does not exist/);
  assert.equal((await app.db.q("SELECT post_count FROM communities WHERE name = 'Import_Test'")).rows[0].post_count, 2);
  assert.match((await client().get('/c/Import_Test')).text, /First prompt/);
  r = await adm.apost('/import', { mode: 'import', data });
  assert.match(r.text, /Duplicate posts skipped/);
  assert.equal((await app.db.q("SELECT count(*)::int AS n FROM posts WHERE title = 'First prompt'")).rows[0].n, 1, 'second import adds nothing');
  r = await adm.apost('/import', { mode: 'import', data: '{not json' });
  assert.equal(r.status, 400); assert.match(r.text, /not valid JSON/);
  r = await adm.apost('/import', { mode: 'drop', data });
  assert.equal(r.status, 400);
});

test('SEO: robots, sitemap, canonical, Open Graph, JSON-LD, slug redirects', async () => {
  const c = client();
  const robots = (await c.get('/robots.txt')).text;
  assert.match(robots, /User-agent: \*/); assert.match(robots, /Sitemap: http:\/\/localhost:18080\/sitemap\.xml/);
  const sm = await c.get('/sitemap.xml');
  assert.match(sm.headers.get('content-type'), /application\/xml/);
  assert.match(sm.text, /^<\?xml/); assert.match(sm.text, /<loc>http:\/\/localhost:18080\/<\/loc>/); assert.match(sm.text, /\/m\/chatgpt<\/loc>/); assert.match(sm.text, /\/c\/Import_Test<\/loc>/);
  const home = (await c.get('/')).text;
  assert.match(home, /<link rel="canonical" href="http:\/\/localhost:18080\/">/);
  assert.match(home, /<meta property="og:title"/); assert.match(home, /<meta property="og:image" content="http:\/\/localhost:18080\/s\/og\./);
  assert.match(home, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(home, /<meta name="theme-color"/); assert.match(home, /<html lang="en">/);
  const ld = [...home.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map(m => JSON.parse(m[1]));
  assert.ok(ld.some(o => o['@graph']?.some(g => g['@type'] === 'WebSite' && g.potentialAction)));
  assert.equal((home.match(/<h1[ >]/g) || []).length, 1, 'exactly one H1');
  // Post page: canonical slug URL, 301 from the bare id, DiscussionForumPosting
  const { rows: [p] } = await app.db.q("SELECT id FROM posts WHERE title = 'First prompt'");
  const bare = await c.get(`/p/${p.id}`);
  assert.equal(bare.status, 301); assert.equal(bare.location, `/p/${p.id}/first_prompt`);
  const post = await c.get(bare.location);
  assert.equal(post.status, 200);
  assert.match(post.text, new RegExp(`<link rel="canonical" href="http://localhost:18080/p/${p.id}/first_prompt">`));
  assert.match(post.text, /DiscussionForumPosting/); assert.match(post.text, /BreadcrumbList/);
  assert.match(post.text, /<meta property="og:type" content="article">/);
  // Search and account pages are noindex.
  assert.match((await c.get('/search?q=prompt')).text, /name="robots" content="noindex/);
  assert.match((await c.get('/login')).text, /name="robots" content="noindex/);
  assert.equal((await c.get('/nonexistent-page')).status, 404);
  // JSON-LD cannot be broken out of with a hostile title.
  await app.db.q("INSERT INTO posts (community_id, ai_tag_id, title, body, hot) SELECT id, ai_tag_id, $1, 'x', 0 FROM communities WHERE name = 'Import_Test'", ['</script><script>alert(1)</script>']);
  const { rows: [h] } = await app.db.q("SELECT id, title FROM posts WHERE title LIKE '</script>%'");
  const hp = (await c.getf(`/p/${h.id}`)).text;
  assert.doesNotMatch(hp, /<script>alert\(1\)/); assert.doesNotMatch(hp, /<\/script><script>/);
});

test('changing the admin password signs every admin session out', async () => {
  let r = await adm.apost('/account', { current: 'wrong-current-pw', password: 'NewAdminPassword-123' });
  assert.equal(r.status, 400);
  r = await adm.apost('/account', { current: ADMIN_PW, password: 'short' });
  assert.equal(r.status, 400);
  const other = await adminClient(app);                // second session
  r = await adm.apost('/account', { current: ADMIN_PW, password: 'NewAdminPassword-123' });
  assert.equal(r.status, 303);
  assert.equal((await adm.get(`${ADMIN}/live`)).status, 404, 'session ended');
  assert.equal((await other.get(`${ADMIN}/live`)).status, 404, 'other sessions ended too');
  const c = client(); const page = await c.get(ADMIN);
  assert.equal((await c.post(`${ADMIN}/login`, { _ft: field(page.text, '_ft'), password: ADMIN_PW })).status, 401);
  const page2 = await c.get(ADMIN);
  assert.equal((await c.post(`${ADMIN}/login`, { _ft: field(page2.text, '_ft'), password: 'NewAdminPassword-123' })).status, 303);
});
