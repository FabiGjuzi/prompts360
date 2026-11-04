// WYSIWYG editor (server side), community pre-fill, per-post model tag, escapes, dashboard editors.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, client, makeUser, csrf, adminClient } from './_helpers.js';
import { markdown } from '../src/markdown.js';

let app, alice, adm;
before(async () => { app = await boot(); alice = await makeUser(app.mail, { username: 'wys_alice' }); adm = await adminClient(app); });
after(async () => { await app.close(); });

test('community form has a rich editor (and a textarea fallback); description renders as formatted text', async () => {
  const form = await alice.get('/communities/new');
  assert.match(form.text, /class="wys"[^>]*data-hlevel="3"/);
  assert.match(form.text, /<textarea[^>]*name="description"[^>]*maxlength="4000"/);
  assert.match(form.text, /editor\.[\w-]+\.js/); assert.match(form.text, /editor\.[\w-]+\.css/);
  const t = await csrf(alice);
  const r = await alice.post('/communities/new', { _csrf: t, name: 'Rich_Desc', title: 'Rich', tag: 'claude', description: 'Prompts for **Claude**.\n\n- one\n- two\n\n<script>alert(1)</script> [x](javascript:alert(1))' });
  assert.equal(r.status, 303);
  const pg = (await client().get('/c/Rich_Desc')).text;
  assert.match(pg, /<strong>Claude<\/strong>/); assert.match(pg, /<li>one<\/li>/);
  assert.doesNotMatch(pg, /<script>alert/); assert.doesNotMatch(pg, /href="javascript:/);
  assert.match(pg, /<meta name="description" content="Prompts for Claude\. one two/);          // plain text in meta
  assert.match((await client().get('/communities')).text, /Prompts for Claude\./);             // plain-text preview in the list
  // names are unique regardless of case; ids are unique by construction
  assert.equal((await alice.post('/communities/new', { _csrf: t, name: 'RICH_desc', title: 'dup', tag: 'claude' })).text.includes('already exists'), true);
  const { rows } = await app.db.q("SELECT count(*)::int AS n, count(DISTINCT id)::int AS ids FROM communities WHERE lower(name) = 'rich_desc'");
  assert.deepEqual(rows[0], { n: 1, ids: 1 });
});

test('post form: community pre-filled from the community being browsed, model pre-selected, rich editor', async () => {
  const c = await client().get('/c/Rich_Desc');
  assert.match(c.text, /href="\/submit\?c=Rich_Desc"/, 'sidebar button carries the community');
  const f = await alice.get('/submit?c=Rich_Desc');
  assert.match(f.text, /name="community"[^>]*value="Rich_Desc"/);
  assert.match(f.text, /<option value="claude" selected>/);
  assert.match(f.text, /<datalist id="community-list">[\s\S]*<option value="Rich_Desc" data-tag="claude">/);
  assert.match(f.text, /class="wys"/); assert.match(f.text, /<textarea[^>]*name="body"/);
  // unknown community name in the URL is shown as typed, nothing selected
  const g = await alice.get('/submit?c=Nope_Nope');
  assert.match(g.text, /value="Nope_Nope"/); assert.doesNotMatch(g.text, /<option value="[a-z-]+" selected>/);
  // model landing page: "Create post" pre-selects that model
  assert.match((await client().get('/m/mistral')).text, /href="\/submit\?m=mistral"/);
  assert.match((await alice.get('/submit?m=mistral')).text, /<option value="mistral" selected>/);
  assert.doesNotMatch((await alice.get('/submit?m=evil"onfocus="x')).text, /onfocus/);
});

test('each post carries its own community and its own model tag', async () => {
  const t = await csrf(alice);
  let r = await alice.post('/submit', { _csrf: t, community: 'Rich_Desc', tag: 'gemini', title: 'Cross model post', body: 'Hello' });
  assert.equal(r.status, 303);
  const { rows: [p] } = await app.db.q("SELECT p.ai_tag_id, t.slug, c.name FROM posts p JOIN ai_tags t ON t.id = p.ai_tag_id JOIN communities c ON c.id = p.community_id WHERE p.title = 'Cross model post'");
  assert.equal(p.slug, 'gemini'); assert.equal(p.name, 'Rich_Desc');
  assert.match((await client().get('/m/gemini')).text, /Cross model post/);
  assert.doesNotMatch((await client().get('/m/claude')).text, /Cross model post/);
  assert.match((await client().get('/c/Rich_Desc?sort=new')).text, /Cross model post/);
  // missing / unknown / disabled models and unknown communities are refused with the form re-shown
  r = await alice.post('/submit', { _csrf: t, community: 'Rich_Desc', tag: '', title: 'no tag', body: '' });
  assert.equal(r.status, 400); assert.match(r.text, /Pick which AI model/); assert.match(r.text, /value="no tag"/);
  r = await alice.post('/submit', { _csrf: t, community: 'Rich_Desc', tag: 'not-a-model', title: 'bad tag', body: '' });
  assert.equal(r.status, 400);
  r = await alice.post('/submit', { _csrf: t, community: 'Missing_One', tag: 'claude', title: 'bad community', body: '' });
  assert.equal(r.status, 400); assert.match(r.text, /doesn’t exist/);
  assert.equal((await app.db.q("SELECT count(*)::int AS n FROM posts WHERE title IN ('no tag','bad tag','bad community')")).rows[0].n, 0);
  // editing a post shows the rich editor with the existing text, comments keep a plain textarea
  const { rows: [post] } = await app.db.q("SELECT id FROM posts WHERE title = 'Cross model post'");
  const page = (await alice.getf(`/p/${post.id}`)).text;
  assert.match(page, /<details class="inline"><summary>edit<\/summary>[\s\S]*class="wys"[\s\S]*<p>Hello<\/p>/);
  assert.match(page, /<textarea name="body" rows="4"[^>]*required/);
});

test('changing a community\'s model in the dashboard does not retag its posts', async () => {
  const { rows: [c] } = await app.db.q("SELECT id, ai_tag_id FROM communities WHERE name = 'Rich_Desc'");
  const { rows: [g] } = await app.db.q("SELECT id FROM ai_tags WHERE slug = 'grok'");
  const r = await adm.apost(`/t/communities/${c.id}`, { name: 'Rich_Desc', title: 'Rich', description: 'x', ai_tag_id: String(g.id), creator_id: '', removed_at: '' });
  assert.equal(r.status, 303);
  assert.equal((await app.db.q("SELECT t.slug FROM posts p JOIN ai_tags t ON t.id = p.ai_tag_id WHERE p.title = 'Cross model post'")).rows[0].slug, 'gemini');
});

test('dashboard editors: posts, communities, comments and pages use the rich editor; post tag is selectable', async () => {
  for (const [path, field] of [['/t/posts/new', 'body'], ['/t/communities/new', 'description'], ['/t/comments/new', 'body'], ['/t/pages/new', 'body']]) {
    const r = await adm.get(`${'/hidden-admin-path-for-tests'}${path}`);
    assert.equal(r.status, 200, path);
    assert.match(r.text, new RegExp(`class="wys"[\\s\\S]*<textarea[^>]*name="${field}"`), path);
    assert.match(r.text, /editor\.[\w-]+\.js/, path);
  }
  const pages = await adm.get('/hidden-admin-path-for-tests/t/pages/new');
  assert.match(pages.text, /data-hlevel="2" data-hoff="0"/, 'CMS pages: headings start at H2');
  assert.match((await adm.get('/hidden-admin-path-for-tests/t/posts/new')).text, /name="ai_tag_id"/);
  const { rows: [c] } = await app.db.q("SELECT id FROM communities WHERE name = 'Rich_Desc'");
  const { rows: [m] } = await app.db.q("SELECT id, slug FROM ai_tags WHERE slug = 'perplexity'");
  const r = await adm.apost('/t/posts/new', { community_id: String(c.id), ai_tag_id: String(m.id), title: 'Dash tagged', url: '', body: '# Hi', author_id: '', created_at: '', deleted_at: '', removed_at: '' });
  assert.equal(r.status, 303, r.text.slice(0, 200));
  assert.equal((await app.db.q("SELECT t.slug FROM posts p JOIN ai_tags t ON t.id = p.ai_tag_id WHERE p.title = 'Dash tagged'")).rows[0].slug, 'perplexity');
  // blank tag → the community's model
  await adm.apost('/t/posts/new', { community_id: String(c.id), ai_tag_id: '', title: 'Dash default', url: '', body: '', author_id: '', created_at: '', deleted_at: '', removed_at: '' });
  assert.equal((await app.db.q("SELECT t.slug FROM posts p JOIN ai_tags t ON t.id = p.ai_tag_id WHERE p.title = 'Dash default'")).rows[0].slug, 'grok');
  // the editor's source HTML is the server-rendered markdown (so edit forms open with the existing content)
  const { rows: [p] } = await app.db.q("SELECT id FROM posts WHERE title = 'Dash tagged'");
  assert.match((await adm.get(`/hidden-admin-path-for-tests/t/posts/${p.id}`)).text, /<div class="wys-src" hidden><h3>Hi<\/h3><\/div>/);
});

test('markdown backslash escapes: literal punctuation, no way to smuggle markup', () => {
  assert.equal(markdown('\\*not italic\\* and \\_x\\_'), '<p>*not italic* and _x_</p>');
  assert.equal(markdown('\\# not a heading'), '<p># not a heading</p>');
  assert.equal(markdown('1\\. not a list'), '<p>1. not a list</p>');
  assert.equal(markdown('\\> not a quote'), '<p>&gt; not a quote</p>');
  assert.equal(markdown('a\\\\b'), '<p>a\\b</p>');
  assert.equal(markdown('[a\\]b](https://example.com/x)'), '<p><a href="https://example.com/x" rel="nofollow ugc noopener noreferrer">a]b</a></p>');
  assert.equal(markdown('`a\\*b`'), '<p><code>a\\*b</code></p>');
  assert.doesNotMatch(markdown('x\\<script\\>'), /<script/);
  // placeholders typed by hand are stripped, never turned into characters
  assert.doesNotMatch(markdown(' '), /[*_~]/);
  assert.equal(markdown('plain *italic* **bold**'), '<p>plain <em>italic</em> <strong>bold</strong></p>');
});
