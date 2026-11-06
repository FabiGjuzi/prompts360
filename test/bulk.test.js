// Mass selection and mass actions on the Posts panel (publish, unpublish, hide, restore, wave, delete, export), drafts-only export.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, client, adminClient, makeUser, csrf, ADMIN } from './_helpers.js';
import { parseObjects } from '../src/csv.js';

let app, adm, anon, bob, cid;
const one = async (sql, p = []) => (await app.db.q(sql, p)).rows[0];
const rows = async (sql, p = []) => (await app.db.q(sql, p)).rows;
const mk = async (title, { draft = false, wave = null } = {}) => (await one(
  `INSERT INTO posts (community_id, ai_tag_id, title, body, hot, published, wave) SELECT id, ai_tag_id, $1, $2, 0, NOT $3, $4 FROM communities WHERE name = 'Bulk_Hub' RETURNING id`,
  [title, `Body of ${title}`, draft, wave])).id;
const sel = ids => Object.fromEntries(ids.map(i => [`s.${i}`, '1']));
const bulk = (_list, action, ids, extra = {}) => adm.apost('/bulk/posts', { action, ...sel(ids), ...extra });
const status = id => anon.get(`/p/${id}`).then(r => r.status);
const count = async () => (await one("SELECT post_count FROM communities WHERE name = 'Bulk_Hub'")).post_count;
const liveN = async () => (await one("SELECT count(*)::int n FROM posts WHERE community_id = $1 AND deleted_at IS NULL AND removed_at IS NULL AND published", [cid])).n;
const inMap = async id => new RegExp(`/p/${id}/`).test((await anon.get('/sitemap.xml')).text);   // public = in the sitemap (a hidden post's page answers 200 with "[removed]", it is not a 404)

before(async () => {
  app = await boot(); adm = await adminClient(app); anon = client();
  bob = await makeUser(app.mail, { username: 'bk_bob' });
  await app.db.q("INSERT INTO communities (name, title, description, ai_tag_id, creator_id) SELECT 'Bulk_Hub', 'Bulk hub', '', id, (SELECT id FROM users WHERE username = 'prompts360') FROM ai_tags WHERE slug = 'general'");
  cid = (await one("SELECT id FROM communities WHERE name = 'Bulk_Hub'")).id;
});
after(async () => { await app.close(); });

test('lists show a checkbox per row, a select-all box and the action bar; visitors get nothing', async () => {
  const d = [await mk('Bulk draft A', { draft: true, wave: 1 }), await mk('Bulk draft B', { draft: true, wave: 1 })];
  const l = await mk('Bulk live A');
  const dp = (await adm.get(`${ADMIN}/t/posts?f=published&v=false`)).text;
  assert.match(dp, /<form id="bulk" method="post" action="[^"]*\/bulk\/posts"/); assert.match(dp, /data-selall/);
  for (const id of d) assert.match(dp, new RegExp(`<input type="checkbox" name="s\\.${id}" value="1" form="bulk"`));
  assert.match(dp, /<option value="publish">/); assert.match(dp, /<option value="unpublish">/);
  const tp = (await adm.get(`${ADMIN}/t/posts?q=Bulk`)).text;
  assert.match(tp, new RegExp(`name="s\\.${l}"`)); for (const a of ['publish', 'unpublish', 'hide', 'restore', 'wave', 'delete', 'export']) assert.match(tp, new RegExp(`<option value="${a}">`));
  assert.match(tp, /name="q" value="Bulk"/, 'the search is carried into the bar');
  assert.equal((await anon.post(`${ADMIN}/bulk/posts`, { action: 'hide', [`s.${l}`]: '1' })).status, 404);
  assert.equal((await adm.post(`${ADMIN}/bulk/posts`, { action: 'hide', [`s.${l}`]: '1' })).status, 403, 'CSRF required');
  assert.equal((await bob.post(`${ADMIN}/bulk/posts`, { action: 'hide' })).status, 404);
});

test('input checks: unknown action, nothing selected, bad wave, delete without confirmation', async () => {
  const id = await mk('Bulk check');
  assert.equal((await bulk('posts', 'explode', [id])).status, 400);
  assert.equal((await bulk('posts', 'draft', [id])).status, 400, 'the old “draft” action is gone: use unpublish');
  let r = await bulk('posts', 'hide', []); assert.equal(r.status, 303); assert.match(r.location, /bulk=none$/);
  assert.equal((await bulk('posts', 'wave', [id], { wave: '100' })).status, 400); assert.equal((await bulk('posts', 'wave', [id], { wave: 'x' })).status, 400);
  assert.equal((await bulk('posts', 'delete', [id])).status, 400); assert.equal((await bulk('posts', 'delete', [id], { confirm: 'delete' })).status, 400);
  assert.equal((await one('SELECT count(*)::int n FROM posts WHERE id = $1', [id])).n, 1);
  assert.equal((await bulk('posts', 'hide', Array.from({ length: 1001 }, (_, i) => i + 1))).status, 400, 'selection cap');
  const bad = await adm.apost('/bulk/posts', { action: 'hide', 's.1abc': '1', 's.-5': '1', 's.2': 'yes' });
  assert.match(bad.location, /bulk=none$/, 'only s.<digits>=1 counts');
});

test('publish: only the selected drafts go public (dated now); live posts in the selection are skipped and counted', async () => {
  const [a, b, c] = [await mk('Bulk pub 1', { draft: true }), await mk('Bulk pub 2', { draft: true }), await mk('Bulk pub 3', { draft: true })];
  const live = await mk('Bulk already live');
  const r = await bulk('drafts', 'publish', [a, b, live]);
  assert.match(r.location, /\/t\/posts\?bulk=publish\.2\.1$/);
  assert.deepEqual([await status(a), await status(b), await status(c)], [301, 301, 404]);
  assert.equal(await count(), await liveN(), 'community count matches the live posts');
  assert.match((await adm.get(`${ADMIN}${r.location.slice(ADMIN.length)}`)).text, /Published 2 posts\. 1 skipped/);
  assert.match((await anon.get('/sitemap.xml')).text, new RegExp(`/p/${a}/`)); assert.doesNotMatch((await anon.get('/sitemap.xml')).text, new RegExp(`/p/${c}/`));
});

test('wave: set and clear on a selection (drafts and live posts)', async () => {
  const [d, l] = [await mk('Bulk wave d', { draft: true }), await mk('Bulk wave l')];
  await bulk('posts', 'wave', [d, l], { wave: '7' });
  assert.deepEqual((await rows('SELECT wave FROM posts WHERE id = ANY($1) ORDER BY id', [[d, l]])).map(r => r.wave), [7, 7]);
  await bulk('posts', 'wave', [d, l], { wave: '' });
  assert.deepEqual((await rows('SELECT wave FROM posts WHERE id = ANY($1) ORDER BY id', [[d, l]])).map(r => r.wave), [null, null]);
});

test('draft / hide / restore: visibility and community counts follow; each action skips rows it does not apply to', async () => {
  const [x, y, dd] = [await mk('Bulk vis x'), await mk('Bulk vis y'), await mk('Bulk vis d', { draft: true })];
  let r = await bulk('posts', 'hide', [x, y]); assert.match(r.location, /bulk=hide\.2\.0$/);
  assert.deepEqual([await inMap(x), await inMap(y)], [false, false]); assert.match((await anon.get(`/p/${x}`)).text, /\[removed\]/); assert.equal(await count(), await liveN());
  r = await bulk('posts', 'restore', [x, dd]); assert.match(r.location, /bulk=restore\.1\.1$/);
  assert.deepEqual([await inMap(x), await inMap(y), await inMap(dd)], [true, false, false]); assert.equal((await one('SELECT published FROM posts WHERE id = $1', [dd])).published, false, 'restore never exposes a draft');
  assert.equal(await count(), await liveN());
  r = await bulk('posts', 'unpublish', [x, dd]); assert.match(r.location, /bulk=unpublish\.1\.1$/);
  const row = await one('SELECT published, removed_at FROM posts WHERE id = $1', [x]); assert.equal(row.published, false); assert.equal(row.removed_at, null);
  assert.equal(await status(x), 404, 'a draft is a 404 for visitors, at once');
  assert.equal(await count(), await liveN());
  const back = await bulk('posts', 'publish', [x]); assert.match(back.location, /publish\.1\.0$/); assert.equal(await status(x), 301); assert.equal(await inMap(x), true);
});

test('reposts are never unpublished or given a wave', async () => {
  const orig = await mk('Bulk repost original');
  const rp = (await one(`INSERT INTO posts (community_id, ai_tag_id, title, body, hot, repost_of) SELECT community_id, ai_tag_id, title, '', 0, id FROM posts WHERE id = $1 RETURNING id`, [orig])).id;
  const r = await bulk('posts', 'unpublish', [rp]); assert.match(r.location, /unpublish\.0\.1$/);
  assert.equal((await one('SELECT published FROM posts WHERE id = $1', [rp])).published, true);
  assert.match((await bulk('posts', 'wave', [rp], { wave: '3' })).location, /wave\.0\.1$/);
});

test('"all matching" works across pages: the Posts panel follows the search and the draft filter', async () => {
  const many = []; for (let i = 0; i < 60; i++) many.push(await mk(`Bulk many ${i}`, { draft: true, wave: 9 }));
  const other = await mk('Different title zzz', { draft: true });
  const tp = (await adm.get(`${ADMIN}/t/posts?q=Bulk+many`)).text;
  assert.match(tp, /all 60 matching/);
  let r = await adm.apost('/bulk/posts', { action: 'wave', scope: 'all', q: 'Bulk many', wave: '5' });
  assert.match(r.location, /\/t\/posts\?q=Bulk\+many&bulk=wave\.60\.0$/);
  assert.equal((await one('SELECT count(*)::int n FROM posts WHERE wave = 5')).n, 60); assert.notEqual((await one('SELECT wave FROM posts WHERE id = $1', [other])).wave, 5);
  r = await adm.apost('/bulk/posts', { action: 'delete', scope: 'all', q: 'Bulk many', confirm: 'DELETE' });
  assert.match(r.location, /delete\.60\.0$/); assert.equal((await one("SELECT count(*)::int n FROM posts WHERE title LIKE 'Bulk many%'")).n, 0);
  const left = (await one('SELECT count(*)::int n FROM posts WHERE NOT published')).n;
  r = await adm.apost('/bulk/posts', { action: 'publish', scope: 'all', f: 'published', v: 'false' });
  assert.match(r.location, new RegExp(`publish\\.${left}\\.0$`)); assert.equal((await one('SELECT count(*)::int n FROM posts WHERE NOT published')).n, 0);
  assert.doesNotMatch((await adm.get(`${ADMIN}/t/posts`)).text, /Publish wave|Publish the next/);
});

test('delete: permanent, counts fixed, comments go with the post', async () => {
  const id = await mk('Bulk to delete');
  await app.db.q("INSERT INTO comments (post_id, author_id, body) VALUES ($1, (SELECT id FROM users WHERE username = 'bk_bob'), 'c')", [id]);
  const r = await bulk('posts', 'delete', [id], { confirm: 'DELETE' }); assert.match(r.location, /delete\.1\.0$/);
  assert.equal((await one('SELECT count(*)::int n FROM posts WHERE id = $1', [id])).n, 0); assert.equal((await one('SELECT count(*)::int n FROM comments WHERE post_id = $1', [id])).n, 0);
  assert.equal(await count(), await liveN()); assert.equal(await status(id), 404);
});

test('export selected: only those posts, in the importer’s shape, and it round-trips; drafts.csv has drafts only', async () => {
  const [d, l] = [await mk('Bulk exp draft', { draft: true, wave: 4 }), await mk('Bulk exp live')];
  await app.db.q("UPDATE posts SET seo_title = 'Exp SEO', seo_desc = 'Exp desc' WHERE id = $1", [d]);
  const r = await bulk('posts', 'export', [d, l]);
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/csv/); assert.match(r.headers.get('content-disposition'), /prompts360-selected-posts-\d{4}-\d{2}-\d{2}\.csv/);
  const { records, headers } = parseObjects(r.text);
  assert.deepEqual(headers, ['community', 'title', 'body', 'model', 'url', 'published', 'wave', 'seo_title', 'seo_desc']); assert.equal(records.length, 2);
  const rd = records.find(x => x.title === 'Bulk exp draft'); assert.deepEqual([rd.published, rd.wave, rd.seo_title, rd.seo_desc], ['0', '4', 'Exp SEO', 'Exp desc']);
  const { runImport } = await import('../src/admin/pages.js');
  assert.equal((await runImport(r.text, { dry: true })).postsNew, 0, 'importing the export changes nothing');
  const dr = parseObjects((await adm.get(`${ADMIN}/export/content/drafts.csv`)).text);
  assert.ok(dr.records.length >= 1 && dr.records.every(x => x.published === '0')); assert.ok(dr.records.some(x => x.title === 'Bulk exp draft')); assert.ok(!dr.records.some(x => x.title === 'Bulk exp live'));
  assert.equal((await anon.get(`${ADMIN}/export/content/drafts.csv`)).status, 404);
  assert.match((await adm.get(`${ADMIN}/export`)).text, /drafts\.csv/);
});

test('every mass action is logged', async () => {
  await (await import('../src/metrics.js')).tick(true);   // events are buffered and written once a minute
  const ev = await rows("SELECT message FROM event_log WHERE message LIKE 'Mass action%' ORDER BY id");
  assert.ok(ev.length >= 8); assert.ok(ev.some(e => /“delete” on 1 selected posts: 1 changed, 0 skipped/.test(e.message)));
  void cid;
});
