// One `published` flag: drafts (published = false) are invisible to every public route; the Posts panel toggles them; import/export; SEO fields, hyphen slugs, heading levels, TechArticle vs DiscussionForumPosting.
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
  assert.equal(d1.published, false); assert.equal(d1.removed_at, null, 'a draft is only unpublished, not removed'); assert.equal(d1.published_at, null); assert.equal(d1.wave, 1);
  assert.equal(d1.seo_title, 'Custom SEO title for draft one'); assert.equal(d1.seo_desc, 'Custom meta description for draft one.');
  assert.equal((await one('SELECT published, wave FROM posts WHERE title = $1', [D(3)])).wave, 2);
  const live = await one("SELECT published, removed_at, score FROM posts WHERE title = 'Live post visible now'");
  assert.equal(live.published, true); assert.equal(live.removed_at, null); assert.equal(live.score, 0, 'imported posts start at 0');
  const again = await runImport(JSON.stringify(payload), { dry: false });
  assert.equal(again.postsNew, 0); assert.equal(again.postsDuplicate, 4);
  // CSV with the new columns
  const csv = 'community,title,body,model,draft,wave,seo_title,seo_desc\nDraft_Hub,CSV draft,CSV body,claude,1,3,CSV SEO title,CSV SEO desc\n';
  const c = await runImport(csv, { dry: false });
  assert.equal(c.postsDrafts, 1); const row = await one("SELECT published, wave, seo_title FROM posts WHERE title = 'CSV draft'");
  assert.deepEqual([row.published, row.wave, row.seo_title], [false, 3, 'CSV SEO title']);
  // the `published` column: 0 = draft, 1 = live, blank = live
  const csv2 = 'community,title,body,model,published\nDraft_Hub,Pub zero,b,claude,0\nDraft_Hub,Pub one,b,claude,1\nDraft_Hub,Pub blank,b,claude,\n';
  assert.equal((await runImport(csv2, { dry: false })).postsDrafts, 1);
  assert.deepEqual((await rows("SELECT title, published FROM posts WHERE title LIKE 'Pub %' ORDER BY title")).map(r => [r.title, r.published]), [['Pub blank', true], ['Pub one', true], ['Pub zero', false]]);
  await app.db.q("DELETE FROM posts WHERE title LIKE 'Pub %'");
});

test('import page over HTTP: preview then import, with the published column documented', async () => {
  const data = JSON.stringify({ communities: [{ name: 'Http_Hub', title: 'Http hub', model: 'general' }], posts: [{ community: 'Http_Hub', title: 'Http draft', body: 'b', draft: true, wave: 9, seo_title: 'T', seo_desc: 'D' }] });
  assert.match((await adm.get(`${ADMIN}/import`)).text, /<code>published<\/code>[\s\S]*<code>seo_desc<\/code>/);
  assert.equal((await adm.apost('/import', { mode: 'nonsense', data })).status, 400);
  let r = await adm.apost('/import', { mode: 'preview', data }); assert.equal(r.status, 200); assert.match(r.text, /hidden drafts/);
  assert.equal((await one("SELECT count(*)::int n FROM posts WHERE title = 'Http draft'")).n, 0, 'preview writes nothing');
  r = await adm.apost('/import', { mode: 'import', data }); assert.equal(r.status, 200);
  const row = await one("SELECT published, wave, seo_title, seo_desc FROM posts WHERE title = 'Http draft'");
  assert.deepEqual([row.published, row.wave, row.seo_title, row.seo_desc], [false, 9, 'T', 'D']);
  await app.db.q("DELETE FROM posts WHERE title = 'Http draft'");
});

test('one field decides: flipping `published` in the database alone hides or shows a post', async () => {
  const id = (await one('SELECT id FROM posts WHERE title = $1', [D(2)])).id;
  assert.equal((await anon.get(`/p/${id}`)).status, 404);
  await app.db.q('UPDATE posts SET published = true WHERE id = $1', [id]);
  const { invalidate } = await import('../src/admin/crud.js'); await invalidate();
  assert.equal((await anon.get(`/p/${id}`)).status, 301, 'visible with no other column touched');
  await app.db.q('UPDATE posts SET published = false WHERE id = $1', [id]); await invalidate();
  assert.equal((await anon.get(`/p/${id}`)).status, 404, 'hidden again');
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
  assert.equal((await one('SELECT count(*)::int n FROM live_posts l JOIN posts p ON p.id = l.id WHERE NOT p.published')).n, 0, 'drafts never earn points');
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

test('dashboard: one Posts panel lists drafts and live posts with a status badge; preview is admin only, noindex, uncached', async () => {
  const d1 = (await one('SELECT id FROM posts WHERE title = $1', [D(1)])).id;
  for (const p of ['/drafts', `/drafts/${d1}`]) assert.equal((await adm.get(`${ADMIN}${p}`)).status, 404, `${p}: there is no separate Drafts section any more`);
  for (const p of [`/posts/${d1}/preview`]) assert.equal((await anon.get(`${ADMIN}${p}`)).status, 404, `${p} is hidden from visitors`);
  assert.equal((await anon.post(`${ADMIN}/posts/publish`, { id: String(d1) })).status, 404);
  assert.doesNotMatch((await adm.get(`${ADMIN}/db`)).text + (await adm.get(`${ADMIN}/`)).text, /href="[^"]*\/drafts"/, 'no Drafts menu entry');
  const all = await adm.get(`${ADMIN}/t/posts?q=about+long`);
  assert.equal(all.status, 200); assert.match(all.text, /Draft 1 about long context/);
  const live = (await one("SELECT id FROM posts WHERE title = 'Live post visible now'")).id;
  const both = await adm.get(`${ADMIN}/t/posts`);
  assert.match(both.text, /Live post visible now/); assert.match(both.text, /Draft 1 about long context/, 'drafts and live posts share one list');
  assert.match(both.text, /<span class="pill ok">Published<\/span>/); assert.match(both.text, /<span class="pill warn">Draft<\/span>/);
  assert.match(both.text, /Publish wave 1 \(2\)/); assert.match(both.text, /Publish wave 2 \(1\)/); assert.match(both.text, /Publish wave 3 \(1\)/);
  assert.match(both.text, /action="[^"]*\/posts\/publish"/);
  const only = await adm.get(`${ADMIN}/t/posts?f=published&v=false`);
  assert.match(only.text, /Draft 1 about long context/); assert.doesNotMatch(only.text, /Live post visible now/, 'filter published = false shows drafts only');
  const pv = await adm.get(`${ADMIN}/posts/${d1}/preview`);
  assert.equal(pv.status, 200); assert.match(pv.headers.get('x-robots-tag'), /noindex/); assert.match(pv.text, /name="robots" content="noindex/);
  assert.doesNotMatch(pv.text, /rel="canonical"/); assert.doesNotMatch(pv.text, /application\/ld\+json/); assert.match(pv.text, /Draft preview/);
  assert.match(pv.headers.get('cache-control') || '', /no-store|private|no-cache/);
  assert.equal((await adm.get(`${ADMIN}/posts/${live}/preview`)).status, 404, 'only unpublished posts have a preview');
  assert.equal((await adm.get(`${ADMIN}/posts/999999/preview`)).status, 404);
  assert.match(both.text, new RegExp(`/posts/${d1}/preview`), 'the list links a draft to its preview');
});

test('dashboard: publish one, a wave, or the next N (lowest wave first); inputs are validated', async () => {
  const ids = Object.fromEntries((await rows("SELECT title, id FROM posts WHERE NOT published")).map(r => [r.title, r.id]));
  assert.equal((await adm.post(`${ADMIN}/posts/publish`, { id: String(ids[D(1)]), to: '1' })).status, 403, 'CSRF is required');
  assert.equal((await adm.apost('/posts/publish', {})).status, 400);
  assert.equal((await adm.apost('/posts/publish', { wave: '0' })).status, 400);
  assert.equal((await adm.apost('/posts/publish', { next: '9999' })).status, 400);
  assert.equal((await adm.apost('/posts/publish', { id: 'abc' })).status, 400);
  // one
  const t0 = Date.now();
  let r = await adm.apost('/posts/publish', { id: String(ids[D(1)]), to: '1' });
  assert.equal(r.status, 303); assert.match(r.location, /bulk=publish\.1\.0$/);
  const p1 = await one('SELECT * FROM posts WHERE id = $1', [ids[D(1)]]);
  assert.equal(p1.published, true); assert.equal(p1.removed_at, null); assert.ok(new Date(p1.created_at).getTime() >= t0 - 2000, 'dated at the first publication');
  assert.ok(p1.published_at);
  assert.equal(p1.seo_title, 'Custom SEO title for draft one', 'SEO fields survive publishing');
  assert.equal((await one("SELECT post_count FROM communities WHERE name = 'Draft_Hub'")).post_count, 2);
  const pub = await anon.get(`/p/${ids[D(1)]}`);
  assert.equal(pub.status, 301); assert.equal((await anon.get(pub.location)).status, 200);
  assert.match((await anon.get('/sitemap.xml')).text, new RegExp(`/p/${ids[D(1)]}/`));
  assert.match((await anon.get('/c/Draft_Hub?sort=new')).text, /Draft 1 about long context/);
  assert.match((await adm.get(`${ADMIN}/t/posts?bulk=publish.1.0`)).text, /Published 1 post\./);
  assert.equal((await adm.get(`${ADMIN}/posts/${ids[D(1)]}/preview`)).status, 404, 'a published post has no draft preview');
  // publishing it again does nothing
  r = await adm.apost('/posts/publish', { id: String(ids[D(1)]), to: '1' }); assert.match(r.location, /bulk=publish\.0\.0$/);
  // BACK TO DRAFT: the live post stops resolving on every public route at once, keeps its date, and the community count follows
  r = await adm.apost('/posts/publish', { id: String(ids[D(1)]), to: '0' });
  assert.equal(r.status, 303); assert.match(r.location, /bulk=unpublish\.1\.0$/);
  const back = await one('SELECT published, created_at, published_at FROM posts WHERE id = $1', [ids[D(1)]]);
  assert.equal(back.published, false);
  for (const path of [`/p/${ids[D(1)]}`, `/p/${ids[D(1)]}/draft-1-about-long-context-prompts`]) assert.equal((await anon.get(path)).status, 404, `${path} no longer resolves`);
  assert.doesNotMatch((await anon.get('/c/Draft_Hub?sort=new')).text, /Draft 1 about long context/);
  assert.doesNotMatch((await anon.get('/sitemap.xml')).text, new RegExp(`/p/${ids[D(1)]}/`));
  assert.equal((await one("SELECT post_count FROM communities WHERE name = 'Draft_Hub'")).post_count, 1);
  // publishing again keeps the original publication date (only the first publication dates a post)
  await adm.apost('/posts/publish', { id: String(ids[D(1)]), to: '1' });
  const again = await one('SELECT created_at, published_at FROM posts WHERE id = $1', [ids[D(1)]]);
  assert.equal(String(again.created_at), String(p1.created_at)); assert.equal(String(again.published_at), String(p1.published_at));
  // next N: lowest wave first -> D(2) (wave 1) then D(3) (wave 2); CSV draft (wave 3) stays
  r = await adm.apost('/posts/publish', { next: '2' }); assert.match(r.location, /bulk=publish\.2\.0$/);
  assert.equal((await one('SELECT published FROM posts WHERE id = $1', [ids[D(2)]])).published, true);
  assert.equal((await one('SELECT published FROM posts WHERE id = $1', [ids[D(3)]])).published, true);
  assert.equal((await one("SELECT published FROM posts WHERE title = 'CSV draft'")).published, false);
  // a wave
  r = await adm.apost('/posts/publish', { wave: '3' }); assert.match(r.location, /bulk=publish\.1\.0$/);
  assert.equal((await one('SELECT count(*)::int n FROM posts WHERE NOT published')).n, 0);
  assert.equal((await one("SELECT post_count FROM communities WHERE name = 'Draft_Hub'")).post_count, 5);
  assert.doesNotMatch((await adm.get(`${ADMIN}/t/posts`)).text, /Publish wave|Publish the next/, 'the publish-in-bulk box disappears when no drafts are left');
  // every toggle was written to the action log
  assert.ok((await one("SELECT count(*)::int n FROM action_events WHERE kind = 'post.publish'")).n >= 5);
  assert.equal((await one("SELECT count(*)::int n FROM action_events WHERE kind = 'post.unpublish' AND target_id = $1", [ids[D(1)]])).n, 1);
});

test('dashboard: the Published box in the post editor works with a real browser form (checkbox before the hidden 0)', async () => {
  const c = await one("SELECT id FROM communities WHERE name = 'Draft_Hub'");
  const form = (await adm.get(`${ADMIN}/t/posts/new`)).text;
  assert.match(form, /<input type="checkbox"[^>]*name="published"[^>]*checked[^>]*><input type="hidden" name="published" value="0">/, 'a new post is published by default; checkbox first so a ticked box wins');
  const r = await adm.apost('/t/posts/new', { community_id: String(c.id), title: 'Editor made draft', body: 'Editor body.', ai_tag_id: '', author_id: '', created_at: '', deleted_at: '', removed_at: '', published: '0', wave: '4', seo_title: '', seo_desc: '', url: '' });
  assert.equal(r.status, 303, r.text.slice(0, 300));
  const row = await one("SELECT id, published, removed_at, wave FROM posts WHERE title = 'Editor made draft'");
  assert.equal(row.published, false); assert.equal(row.removed_at, null); assert.equal(row.wave, 4);
  assert.equal((await anon.get(`/p/${row.id}`)).status, 404);
  assert.equal((await adm.apost('/posts/publish', { wave: '4' })).status, 303);
  assert.equal((await anon.get(`/p/${row.id}`)).status, 301);
  // untick in the editor -> hidden again at once
  const e = await adm.apost(`/t/posts/${row.id}`, { community_id: String(c.id), title: 'Editor made draft', body: 'Editor body.', ai_tag_id: '', author_id: String((await one('SELECT author_id FROM posts WHERE id = $1', [row.id])).author_id), created_at: '', deleted_at: '', removed_at: '', published: '0', wave: '4', seo_title: '', seo_desc: '', url: '' });
  assert.equal(e.status, 303, e.text.slice(0, 300));
  assert.equal((await anon.get(`/p/${row.id}`)).status, 404, 'unticking Published hides the post immediately');
});

test('export includes drafts with their columns, and the file imports back without changes', async () => {
  const c = await one("SELECT id FROM communities WHERE name = 'Draft_Hub'");
  await adm.apost('/t/posts/new', { community_id: String(c.id), title: 'Export draft', body: 'Export body.', ai_tag_id: '', author_id: '', created_at: '', deleted_at: '', removed_at: '', published: '0', wave: '7', seo_title: 'Export SEO', seo_desc: 'Export desc', url: '' });
  const res = await adm.get(`${ADMIN}/export/content/posts.csv`);
  const { records, headers } = parseObjects(res.text);
  assert.deepEqual(headers, ['community', 'title', 'body', 'model', 'url', 'published', 'wave', 'seo_title', 'seo_desc']);
  const row = records.find(r => r.title === 'Export draft');
  assert.deepEqual([row.published, row.wave, row.seo_title, row.seo_desc], ['0', '7', 'Export SEO', 'Export desc']);
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

test('the bundled draft library: previews, imports as 249 hidden drafts in 3 waves, is safe to repeat, and every page renders once published', async () => {
  const page = await adm.get(`${ADMIN}/import`); assert.match(page.text, /Draft library \(249 posts in 3 waves\)/); assert.match(page.text, /value="drafts-import"/);
  assert.equal((await anon.post(`${ADMIN}/import`, { mode: 'drafts-import' })).status, 404);
  const before = (await one("SELECT count(*)::int n FROM posts WHERE wave IN (1, 2, 3) AND title LIKE '%Claude%'")).n;
  let r = await adm.apost('/import', { mode: 'drafts-preview' });
  assert.equal(r.status, 200); assert.match(r.text, /Preview/); assert.match(r.text, /<strong>249<\/strong>|249/);
  assert.equal((await one("SELECT count(*)::int n FROM posts WHERE wave IN (1, 2, 3) AND title LIKE '%Claude%'")).n, before, 'preview writes nothing');
  r = await adm.apost('/import', { mode: 'drafts-import' }); assert.equal(r.status, 200);
  const st = await one("SELECT count(*) FILTER (WHERE NOT p.published AND p.removed_at IS NULL)::int d, count(*) FILTER (WHERE p.wave = 1)::int w1, count(*) FILTER (WHERE p.wave = 2)::int w2, count(*) FILTER (WHERE p.wave = 3)::int w3, count(*) FILTER (WHERE p.seo_title IS NOT NULL AND p.seo_desc IS NOT NULL)::int seo FROM posts p JOIN communities c ON c.id = p.community_id WHERE c.name NOT LIKE '%\\_%' AND p.wave IN (1, 2, 3)");
  assert.deepEqual([st.d, st.w1, st.w2, st.w3, st.seo], [249, 64, 65, 120, 249]);
  assert.equal((await one('SELECT count(*)::int n FROM communities WHERE removed_at IS NULL AND name IN (\'SoftwareEngineering\', \'LegalCompliance\', \'GeneralPrompting\')')).n, 3);
  r = await adm.apost('/import', { mode: 'drafts-import' }); assert.match(r.text, /Duplicate posts skipped/); assert.equal((await one("SELECT count(*)::int n FROM posts p JOIN communities c ON c.id = p.community_id WHERE c.name NOT LIKE '%\\_%' AND NOT p.published")).n, 249);
  assert.doesNotMatch((await anon.get('/sitemap.xml')).text, /\/p\/\d+\/claude/); assert.doesNotMatch((await anon.get('/')).text, /Claude Long-Context Prompts/);
  // publish a sample through the bulk action and check what visitors get
  const ids = (await rows("SELECT id FROM posts WHERE wave = 1 AND NOT published ORDER BY id LIMIT 5")).map(x => x.id);
  await adm.apost('/bulk/posts', { action: 'publish', ...Object.fromEntries(ids.map(i => [`s.${i}`, '1'])) });
  for (const id of ids) {
    const a = await anon.get(`/p/${id}`); const pg = await anon.get(a.location);
    assert.equal(pg.status, 200); assert.equal((pg.text.match(/<h1[ >]/g) || []).length, 1); assert.match(pg.text, /"@type":"TechArticle"/); assert.match(pg.text, /<meta name="description" content="[^"]{20,}">/);
  }
});
