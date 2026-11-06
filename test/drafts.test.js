// Hidden drafts, SEO fields, hyphen slugs, heading levels, TechArticle vs DiscussionForumPosting.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, client, makeUser, csrf, adminClient, ADMIN, earnPoints } from './_helpers.js';
import { parseObjects } from '../src/csv.js';

let app, adm, anon, bob;
const one = async (sql, p = []) => (await app.db.q(sql, p)).rows[0];
const rows = async (sql, p = []) => (await app.db.q(sql, p)).rows;
const D = n => `Draft ${n} about long context prompts`;
const BODY = '# Top heading in body\n\nIntro paragraph.\n\n## Second level\n\nText.\n\n### Third level\n\nMore.';
let runImport;

before(async () => {
  app = await boot(); adm = await adminClient(app); anon = client();
  bob = await makeUser(app.mail, { username: 'dr_bob' });
  ({ runImport } = await import('../src/admin/pages.js'));
});
after(async () => { await app.close(); });

test('import: drafts are stored hidden, with wave and SEO fields; bad values are rejected; re-import is a no-op', async () => {
  const payload = {
    communities: [{ name: 'Draft_Hub', title: 'Draft hub', description: 'd', model: 'claude' }],
    posts: [
      { community: 'Draft_Hub', title: D(1), body: BODY, model: 'claude', draft: true, wave: 1, seo_title: 'Custom SEO title for draft one', seo_desc: 'Custom meta description for draft one.' },
      { community: 'Draft_Hub', title: D(2), body: 'Body two.', model: 'claude', draft: true, wave: 1 },
      { community: 'Draft_Hub', title: D(3), body: 'Body three.', model: 'claude', draft: 'true', wave: '2' },
      { community: 'Draft_Hub', title: 'Live post visible now', body: 'Visible body.', model: 'claude' },
      { community: 'Draft_Hub', title: 'Bad wave', body: 'x', draft: true, wave: 100 },
      { community: 'Draft_Hub', title: 'Bad desc', body: 'x', draft: true, seo_desc: 'y'.repeat(301) },
      { community: 'Draft_Hub', title: 'Bad title', body: 'x', draft: true, seo_title: 'y'.repeat(121) },
    ],
  };
  const dry = await runImport(JSON.stringify(payload), { dry: true });
  assert.equal(dry.postsNew, 4); assert.equal(dry.problems.length, 3, dry.problems.join(' | '));
  assert.equal((await one("SELECT count(*)::int n FROM posts WHERE title LIKE 'Draft %'")).n, 0, 'a dry run writes nothing');
  const res = await runImport(JSON.stringify(payload), { dry: false });
  assert.equal(res.postsNew, 4); assert.equal(res.postsDrafts, 3);
  const d1 = await one('SELECT * FROM posts WHERE title = $1', [D(1)]);
  assert.equal(d1.draft, true); assert.ok(d1.removed_at, 'hidden through removed_at'); assert.equal(d1.wave, 1);
  assert.equal(d1.seo_title, 'Custom SEO title for draft one'); assert.equal(d1.seo_desc, 'Custom meta description for draft one.');
  assert.equal((await one('SELECT draft, wave FROM posts WHERE title = $1', [D(3)])).wave, 2);
  const live = await one("SELECT draft, removed_at FROM posts WHERE title = 'Live post visible now'");
  assert.equal(live.draft, false); assert.equal(live.removed_at, null);
  const again = await runImport(JSON.stringify(payload), { dry: false });
  assert.equal(again.postsNew, 0); assert.equal(again.postsDuplicate, 4);
  // CSV with the new columns
  const csv = 'community,title,body,model,draft,wave,seo_title,seo_desc\nDraft_Hub,CSV draft,CSV body,claude,1,3,CSV SEO title,CSV SEO desc\n';
  const c = await runImport(csv, { dry: false });
  assert.equal(c.postsDrafts, 1); const row = await one("SELECT draft, wave, seo_title FROM posts WHERE title = 'CSV draft'");
  assert.deepEqual([row.draft, row.wave, row.seo_title], [true, 3, 'CSV SEO title']);
});

test('import page over HTTP: preview then import, with the draft columns documented', async () => {
  const data = JSON.stringify({ communities: [{ name: 'Http_Hub', title: 'Http hub', model: 'general' }], posts: [{ community: 'Http_Hub', title: 'Http draft', body: 'b', draft: true, wave: 9, seo_title: 'T', seo_desc: 'D' }] });
  assert.match((await adm.get(`${ADMIN}/import`)).text, /<code>draft<\/code>[\s\S]*<code>seo_desc<\/code>/);
  assert.equal((await adm.apost('/import', { mode: 'nonsense', data })).status, 400);
  let r = await adm.apost('/import', { mode: 'preview', data }); assert.equal(r.status, 200); assert.match(r.text, /hidden drafts/);
  assert.equal((await one("SELECT count(*)::int n FROM posts WHERE title = 'Http draft'")).n, 0, 'preview writes nothing');
  r = await adm.apost('/import', { mode: 'import', data }); assert.equal(r.status, 200);
  const row = await one("SELECT draft, wave, seo_title, seo_desc FROM posts WHERE title = 'Http draft'");
  assert.deepEqual([row.draft, row.wave, row.seo_title, row.seo_desc], [true, 9, 'T', 'D']);
  await app.db.q("DELETE FROM posts WHERE title = 'Http draft'");
});

test('the database refuses a visible draft', async () => {
  const id = (await one('SELECT id FROM posts WHERE title = $1', [D(2)])).id;
  await assert.rejects(app.db.q('UPDATE posts SET removed_at = NULL WHERE id = $1', [id]), /posts_draft_is_hidden/);
});

test('drafts are invisible to everyone except the dashboard', async () => {
  const d1 = (await one('SELECT id FROM posts WHERE title = $1', [D(1)])).id;
  for (const p of [`/p/${d1}`, `/p/${d1}/draft-1-about-long-context-prompts`]) assert.equal((await anon.get(p)).status, 404, p);
  assert.equal((await bob.get(`/p/${d1}`)).status, 404, 'logged-in users too');
  for (const p of ['/', '/?sort=new', '/?sort=top', '/c/Draft_Hub?sort=new', '/m/claude', '/search?q=draft+about+long', '/u/prompts360', '/sitemap.xml', '/communities']) {
    const r = await anon.get(p); assert.doesNotMatch(r.text, /Draft \d about long context/, p);
    assert.doesNotMatch(r.text, /CSV draft/, p);
  }
  assert.match((await anon.get('/c/Draft_Hub?sort=new')).text, /Live post visible now/);
  assert.doesNotMatch((await anon.get('/sitemap.xml')).text, new RegExp(`/p/${d1}/`));
  assert.equal((await one("SELECT post_count FROM communities WHERE name = 'Draft_Hub'")).post_count, 1, 'only the live post is counted');
  assert.equal((await one('SELECT count(*)::int n FROM live_posts l JOIN posts p ON p.id = l.id WHERE p.draft')).n, 0, 'drafts never earn points');
  // no interactions with a draft
  const t = await csrf(bob);
  const before = await one('SELECT (SELECT count(*) FROM post_votes)::int v, (SELECT count(*) FROM comments)::int c, (SELECT count(*) FROM posts)::int p');
  const v = await bob.post('/vote', { _csrf: t, type: 'p', id: String(d1), dir: '1', back: '/' });
  const cm = await bob.post(`/p/${d1}/comment`, { _csrf: t, body: 'hello' });
  const rp = await bob.post(`/p/${d1}/repost`, { _csrf: t, body: '' });
  for (const r of [v, cm, rp]) assert.ok(r.status >= 400 && r.status < 500, `interaction refused (${r.status})`);
  const after = await one('SELECT (SELECT count(*) FROM post_votes)::int v, (SELECT count(*) FROM comments)::int c, (SELECT count(*) FROM posts)::int p');
  assert.deepEqual(after, before, 'no vote, comment or repost row was created');
});

test('dashboard: Drafts list, preview (admin only, noindex, uncached) and access control', async () => {
  const d1 = (await one('SELECT id FROM posts WHERE title = $1', [D(1)])).id;
  for (const p of ['/drafts', `/drafts/${d1}`]) assert.equal((await anon.get(`${ADMIN}${p}`)).status, 404, `${p} is hidden from visitors`);
  assert.equal((await anon.post(`${ADMIN}/drafts/publish`, { id: String(d1) })).status, 404);
  const list = await adm.get(`${ADMIN}/drafts`);
  assert.equal(list.status, 200); assert.match(list.text, /Draft 1 about long context/); assert.match(list.text, /Publish wave 1 \(2\)/); assert.match(list.text, /Publish wave 2 \(1\)/); assert.match(list.text, /Publish wave 3 \(1\)/);
  assert.doesNotMatch(list.text, /Live post visible now/);
  assert.match(list.text, /href="[^"]*\/drafts\/publish"|action="[^"]*\/drafts\/publish"/);
  const pv = await adm.get(`${ADMIN}/drafts/${d1}`);
  assert.equal(pv.status, 200); assert.match(pv.headers.get('x-robots-tag'), /noindex/); assert.match(pv.text, /name="robots" content="noindex/);
  assert.doesNotMatch(pv.text, /rel="canonical"/); assert.doesNotMatch(pv.text, /application\/ld\+json/); assert.match(pv.text, /Draft preview/);
  assert.match(pv.headers.get('cache-control') || '', /no-store|private|no-cache/);
  const live = (await one("SELECT id FROM posts WHERE title = 'Live post visible now'")).id;
  assert.equal((await adm.get(`${ADMIN}/drafts/${live}`)).status, 404, 'only drafts can be previewed here');
  assert.equal((await adm.get(`${ADMIN}/drafts/999999`)).status, 404);
  // The generic table editor shows the new columns and links drafts to the preview.
  const tbl = await adm.get(`${ADMIN}/t/posts?q=Draft+1`);
  assert.match(tbl.text, />draft</); assert.match(tbl.text, />wave</); assert.match(tbl.text, new RegExp(`/drafts/${d1}`));
});

test('dashboard: publish one, a wave, or the next N (lowest wave first); inputs are validated', async () => {
  const ids = Object.fromEntries((await rows("SELECT title, id FROM posts WHERE draft")).map(r => [r.title, r.id]));
  assert.equal((await adm.post(`${ADMIN}/drafts/publish`, { id: String(ids[D(1)]) })).status, 403, 'CSRF is required');
  assert.equal((await adm.apost('/drafts/publish', {})).status, 400);
  assert.equal((await adm.apost('/drafts/publish', { wave: '0' })).status, 400);
  assert.equal((await adm.apost('/drafts/publish', { next: '9999' })).status, 400);
  assert.equal((await adm.apost('/drafts/publish', { id: 'abc' })).status, 400);
  // one
  const t0 = Date.now();
  let r = await adm.apost('/drafts/publish', { id: String(ids[D(1)]) });
  assert.equal(r.status, 303); assert.match(r.location, /\/drafts\?published=1$/);
  const p1 = await one('SELECT * FROM posts WHERE id = $1', [ids[D(1)]]);
  assert.equal(p1.draft, false); assert.equal(p1.removed_at, null); assert.ok(new Date(p1.created_at).getTime() >= t0 - 2000, 'dated at publication');
  assert.equal(p1.seo_title, 'Custom SEO title for draft one', 'SEO fields survive publishing');
  assert.equal((await one("SELECT post_count FROM communities WHERE name = 'Draft_Hub'")).post_count, 2);
  const pub = await anon.get(`/p/${ids[D(1)]}`);
  assert.equal(pub.status, 301); assert.equal((await anon.get(pub.location)).status, 200);
  assert.match((await anon.get('/sitemap.xml')).text, new RegExp(`/p/${ids[D(1)]}/`));
  assert.match((await anon.get('/c/Draft_Hub?sort=new')).text, /Draft 1 about long context/);
  assert.match((await adm.get(`${ADMIN}/drafts?published=1`)).text, /Published 1 post\./);
  assert.equal((await adm.get(`${ADMIN}/drafts/${ids[D(1)]}`)).status, 404, 'a published post is no longer a draft');
  // publishing it again does nothing
  r = await adm.apost('/drafts/publish', { id: String(ids[D(1)]) }); assert.match(r.location, /published=0$/);
  // next N: lowest wave first -> D(2) (wave 1) then D(3) (wave 2); CSV draft (wave 3) stays
  r = await adm.apost('/drafts/publish', { next: '2' }); assert.match(r.location, /published=2$/);
  assert.equal((await one('SELECT draft FROM posts WHERE id = $1', [ids[D(2)]])).draft, false);
  assert.equal((await one('SELECT draft FROM posts WHERE id = $1', [ids[D(3)]])).draft, false);
  assert.equal((await one("SELECT draft FROM posts WHERE title = 'CSV draft'")).draft, true);
  // a wave
  r = await adm.apost('/drafts/publish', { wave: '3' }); assert.match(r.location, /published=1$/);
  assert.equal((await one('SELECT count(*)::int n FROM posts WHERE draft')).n, 0);
  assert.equal((await one("SELECT post_count FROM communities WHERE name = 'Draft_Hub'")).post_count, 5);
  assert.match((await adm.get(`${ADMIN}/drafts`)).text, /No drafts/);
});

test('dashboard: ticking Draft in the post editor hides a post; unticking and publishing are consistent', async () => {
  const c = await one("SELECT id FROM communities WHERE name = 'Draft_Hub'");
  const r = await adm.apost('/t/posts/new', { community_id: String(c.id), title: 'Editor made draft', body: 'Editor body.', ai_tag_id: '', author_id: '', created_at: '', deleted_at: '', removed_at: '', draft: '1', wave: '4', seo_title: '', seo_desc: '', url: '' });
  assert.equal(r.status, 303, r.text.slice(0, 300));
  const row = await one("SELECT id, draft, removed_at, wave FROM posts WHERE title = 'Editor made draft'");
  assert.equal(row.draft, true); assert.ok(row.removed_at); assert.equal(row.wave, 4);
  assert.equal((await anon.get(`/p/${row.id}`)).status, 404);
  assert.equal((await adm.apost('/drafts/publish', { wave: '4' })).status, 303);
  assert.equal((await anon.get(`/p/${row.id}`)).status, 301);
});

test('export includes drafts with their columns, and the file imports back without changes', async () => {
  const c = await one("SELECT id FROM communities WHERE name = 'Draft_Hub'");
  await adm.apost('/t/posts/new', { community_id: String(c.id), title: 'Export draft', body: 'Export body.', ai_tag_id: '', author_id: '', created_at: '', deleted_at: '', removed_at: '', draft: '1', wave: '7', seo_title: 'Export SEO', seo_desc: 'Export desc', url: '' });
  const res = await adm.get(`${ADMIN}/export/content/posts.csv`);
  const { records, headers } = parseObjects(res.text);
  assert.deepEqual(headers, ['community', 'title', 'body', 'model', 'url', 'draft', 'wave', 'seo_title', 'seo_desc']);
  const row = records.find(r => r.title === 'Export draft');
  assert.deepEqual([row.draft, row.wave, row.seo_title, row.seo_desc], ['1', '7', 'Export SEO', 'Export desc']);
  const again = await runImport(res.text, { dry: true });
  assert.deepEqual(again.problems, []); assert.equal(again.postsNew, 0);
});

test('SEO fields: title tag and meta description come from the dashboard values; defaults otherwise', async () => {
  const d1 = (await one('SELECT id FROM posts WHERE title = $1', [D(1)])).id;
  const page = (await anon.getf(`/p/${d1}`)).text;
  assert.match(page, /<title>Custom SEO title for draft one<\/title>/, 'used as is, without the site suffix');
  assert.match(page, /<meta name="description" content="Custom meta description for draft one\.">/);
  assert.match(page, /<meta property="og:title" content="Custom SEO title for draft one">/);
  const d2 = (await one('SELECT id FROM posts WHERE title = $1', [D(2)])).id;
  const p2 = (await anon.getf(`/p/${d2}`)).text;
  assert.match(p2, /<title>Draft 2 about long context prompts · prompts360<\/title>/); assert.match(p2, /<meta name="description" content="Draft 2 about long context prompts — Body two\.">/);
});

test('post pages: one H1, body headings start at H2, hyphen slugs, 301 from old underscore URLs', async () => {
  const d1 = (await one('SELECT id FROM posts WHERE title = $1', [D(1)])).id;
  const page = (await anon.getf(`/p/${d1}`)).text;
  assert.equal((page.match(/<h1[ >]/g) || []).length, 1, 'exactly one H1');
  assert.match(page, /<h2[^>]*>Top heading in body<\/h2>/, 'a # in the body becomes H2 (never H1)'); assert.match(page, /<h2[^>]*>Second level<\/h2>/); assert.match(page, /<h3[^>]*>Third level<\/h3>/);
  assert.match(page, new RegExp(`<link rel="canonical" href="http://localhost:18080/p/${d1}/draft-1-about-long-context-prompts">`));
  const old = await anon.get(`/p/${d1}/draft_1_about_long_context_prompts`);
  assert.equal(old.status, 301); assert.equal(old.location, `/p/${d1}/draft-1-about-long-context-prompts`);
  // slug rules
  const { slugify } = await import('../src/html.js');
  assert.equal(slugify('Claude: long_context -- prompts!  (2026)'), 'claude-long-context-prompts-2026'); assert.equal(slugify('___'), 'post');
  assert.ok(slugify('x'.repeat(200)).length <= 60); assert.doesNotMatch(slugify('a'.repeat(59) + ' b'), /-$/);
});

test('structured data: site-written posts are TechArticle, user posts stay DiscussionForumPosting', async () => {
  const d1 = (await one('SELECT id FROM posts WHERE title = $1', [D(1)])).id;
  const ed = (await anon.getf(`/p/${d1}`)).text;
  assert.match(ed, /"@type":"TechArticle"/); assert.doesNotMatch(ed, /DiscussionForumPosting/);
  await earnPoints(app, bob);
  const r = await bob.post('/submit', { _csrf: await csrf(bob), community: 'Draft_Hub', tag: 'claude', title: 'A user written prompt', body: 'My own prompt text.' });
  const u = (await anon.getf(r.location)).text;
  assert.match(u, /"@type":"DiscussionForumPosting"/); assert.doesNotMatch(u, /TechArticle/);
  for (const html of [ed, u]) for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
});
