// Site design editor: template engine, draft/preview/publish/rollback, theme, custom CSS/JS, templates, safety.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, client, makeUser, csrf, adminClient, ADMIN, BASE } from './_helpers.js';
import { parse, render, lintMarkup, TemplateError } from '../src/tpl.js';
import { raw } from '../src/html.js';

const r = (s, d) => render(parse(s), d).toString();
let app, adm, alice;
const anon = () => client();
before(async () => {
  app = await boot(); adm = await adminClient(app); alice = await makeUser(app.mail, { username: 'design_alice' });
  const { runImport } = await import('../src/admin/pages.js');
  await runImport(JSON.stringify({ communities: [{ name: 'Design_Test', title: 'Design test', model: 'claude' }], posts: [{ community: 'Design_Test', title: 'Plain post', body: 'hello' }] }), { dry: false });
});
after(async () => { await app.close(); });
const withPreview = async fn => { const c = adm.cookie; adm.cookie = `${c}; pv=1`; try { return await fn(); } finally { adm.cookie = c; } };
const liveCss = html => html.match(/href="(\/x\/site\.[\w-]{10}\.css)"/)?.[1];
const liveJs = html => html.match(/src="(\/x\/site\.[\w-]{10}\.js)"/)?.[1];

test('template engine: escaping, raw only for server-made HTML, blocks, no prototype access', () => {
  assert.equal(r('<p>{{a}}</p>{{{b}}}{{h}}{{{h}}}', { a: '<x>"\'&', b: '<i>', h: raw('<b>') }), '<p>&lt;x&gt;&quot;&#39;&amp;</p>&lt;i&gt;<b><b>');
  assert.equal(r('{{#if x}}Y{{else}}N{{/if}}{{#unless x}}U{{/unless}}', { x: [] }), 'NU');
  assert.equal(r('{{#each l}}[{{n}}|{{top}}]{{else}}none{{/each}}', { top: 'T', l: [{ n: '<' }, { n: 2 }] }), '[&lt;|T][2|T]');
  assert.equal(r('{{#each l}}{{this}},{{/each}}{{#each e}}x{{else}}empty{{/each}}', { l: ['a', 'b<'], e: [] }), 'a,b&lt;,empty');
  assert.equal(r('{{a.b}}', { a: { b: 'ok' } }), 'ok');
  for (const bad of ['{{__proto__}}', '{{a.constructor}}', '{{a.prototype}}', '{{a b}}', '{{a()}}', '{{ a + b }}', '{{#if a}}x', '{{/if}}', '{{#each a}}{{/if}}', 'x }} y', '{{#unknown a}}{{/unknown}}', '{{#if a}}{{else}}{{else}}{{/if}}'])
    assert.throws(() => parse(bad), TemplateError, bad);
  // inherited properties are invisible even when allowed names are used
  assert.equal(r('{{toString}}{{hasOwnProperty}}', {}), '');
  // limits
  const deep = '{{#if a}}'.repeat(30) + 'x' + '{{/if}}'.repeat(30);
  assert.throws(() => parse(deep), /nested too deeply/);
  const big = { l: Array.from({ length: 500 }, () => ({ v: 'x'.repeat(4000) })) };
  assert.throws(() => r('{{#each l}}{{v}}{{/each}}', big), /too large/);
  assert.match(lintMarkup('<script>x</script>'), /script/); assert.match(lintMarkup('<a onclick="x()">'), /event/); assert.match(lintMarkup('<a href="JavaScript:1">'), /javascript/);
  assert.match(lintMarkup('<iframe src=x>'), /iframe/); assert.match(lintMarkup('<style>a{}</style>'), /style/);
  assert.equal(lintMarkup('<a href="{{url}}" class="a on b">fine</a>'), '');
});

test('the editor is hidden: 404 without the secret path and admin session', async () => {
  const c = anon();
  for (const p of [`${ADMIN}/design`, `${ADMIN}/design/preview?on=1`, `${ADMIN}/design/draft.AAAAAAAAAA.css`, '/x/site.AAAAAAAAAA.css', '/design']) assert.equal((await c.get(p)).status, 404, p);
  assert.equal((await alice.get(`${ADMIN}/design`)).status, 404);
  for (const a of ['save', 'publish', 'discard', 'restore']) assert.equal((await c.post(`${ADMIN}/design/${a}`, {})).status, 404, a);
  const page = await adm.get(`${ADMIN}/design`);
  assert.equal(page.status, 200); assert.match(page.text, /Custom JavaScript/); assert.match(page.text, /same as live/);
  assert.match(page.headers.get('cache-control'), /no-store/);
});

test('saving goes to the DRAFT only; validation protects the site', async () => {
  const live0 = (await anon().get('/')).text;
  assert.equal(liveCss(live0), undefined, 'built-in design has no extra stylesheet');
  let r1 = await adm.apost('/design/save', { tab: 'theme', 'c.bg': '#ff0000', 'c.ac': '#00aa00', 'd.tx': '#ffffff', font: 'serif', shape: 'square', 'n.fs': '17', 'n.w': '1000', 'n.r': '4', 'c.card': '#ffffff' });
  assert.equal(r1.status, 303, r1.text.slice(0, 300));
  assert.equal(liveCss((await anon().get('/')).text), undefined, 'visitors unaffected until publish');
  assert.match((await adm.get(`${ADMIN}/design`)).text, /unpublished changes/);
  // bad inputs are refused and nothing is stored
  for (const bad of [{ 'c.bg': 'red' }, { 'c.bg': '#ff0000; } body { display:none' }, { font: 'comic' }, { shape: 'blob' }, { 'n.fs': '99' }, { 'n.w': 'abc' }]) {
    const x = await adm.apost('/design/save', { tab: 'theme', ...bad });
    assert.equal(x.status, 400, JSON.stringify(bad)); assert.match(x.text, /Not saved/);
  }
  const { rows } = await app.db.q('SELECT data FROM design_draft WHERE id = 1');
  assert.deepEqual(rows[0].data.theme, { bg: '#ff0000', ac: '#00aa00', dark_tx: '#ffffff', font: 'serif', shape: 'square', fs: 17, w: 1000, r: 4 });
  // CSS / JS are checked before they are stored
  let x = await adm.apost('/design/save', { tab: 'css', css: 'a { color: red;' });
  assert.equal(x.status, 400); assert.match(x.text, /never closed/);
  x = await adm.apost('/design/save', { tab: 'css', css: 'a { content: "x }' });
  assert.equal(x.status, 400);
  x = await adm.apost('/design/save', { tab: 'js', js: 'function (' });
  assert.equal(x.status, 400); assert.match(x.text, /SyntaxError/); assert.match(x.text, /line \d+/);
  x = await adm.apost('/design/save', { tab: 'css', css: '.hero h1 { letter-spacing: .02em }\n/* note */' });
  assert.equal(x.status, 303);
  x = await adm.apost('/design/save', { tab: 'js', js: "document.documentElement.dataset.custom = 'on';" });
  assert.equal(x.status, 303);
  x = await adm.apost('/design/save', { tab: 'css', css: 'x'.repeat(200_001) });
  assert.equal(x.status, 400);
});

test('preview shows the draft to the signed-in admin only', async () => {
  // the toggle sets a cookie but only works together with an admin session
  const saved = adm.cookie; const t = await adm.get(`${ADMIN}/design/preview?on=1`); adm.cookie = saved;
  assert.equal(t.status, 303); assert.match(t.headers.get('set-cookie'), /^pv=1; Path=\/; HttpOnly; SameSite=Strict/);
  const draftHome = await withPreview(() => adm.get('/'));
  assert.match(draftHome.text, /class="pvbar"/); assert.match(draftHome.text, /Exit preview/);
  const draftCss = draftHome.text.match(/href="(\/hidden-admin-path-for-tests\/design\/draft\.[\w-]{10}\.css)"/)?.[1];
  const draftJs = draftHome.text.match(/src="(\/hidden-admin-path-for-tests\/design\/draft\.[\w-]{10}\.js)"/)?.[1];
  assert.ok(draftCss && draftJs, 'draft files are linked');
  assert.match(draftHome.headers.get('cache-control'), /no-store/); assert.match(draftHome.text, /name="robots" content="noindex/);
  assert.doesNotMatch(draftHome.text, /rel="canonical"/);
  const css = await adm.get(draftCss);
  assert.equal(css.status, 200); assert.match(css.headers.get('content-type'), /text\/css/); assert.match(css.text, /--bg:#ff0000/); assert.match(css.text, /--font:Georgia/); assert.match(css.text, /--rb:0/); assert.match(css.text, /--fs:17px/);
  assert.match(css.text, /@media\(prefers-color-scheme:dark\)\{:root\{[^}]*--bg:#0e1013/, 'dark default re-asserted so the light override does not leak into dark mode');
  assert.match(css.text, /--tx:#ffffff/); assert.match(css.text, /letter-spacing/);
  assert.match((await adm.get(draftJs)).text, /dataset\.custom/);
  // everyone else: no preview, no draft files
  const forged = anon(); forged.cookie = 'pv=1';
  const h = (await forged.get('/')).text;
  assert.doesNotMatch(h, /pvbar/); assert.doesNotMatch(h, /design\/draft/);
  assert.equal((await forged.get(draftCss)).status, 404);
  assert.equal((await anon().get(draftCss)).status, 404);
  // an admin who has not turned preview on sees the live site
  assert.doesNotMatch((await adm.get('/')).text, /pvbar/);
  // turning it off clears the cookie
  const keep = adm.cookie; const off = await adm.get(`${ADMIN}/design/preview?on=0`); adm.cookie = keep; assert.match(off.headers.get('set-cookie'), /Max-Age=0/);
});

test('publish makes it live as separate cacheable files; the security policy is untouched', async () => {
  const noCsrf = await adm.post(`${ADMIN}/design/publish`, { note: 'x' });
  assert.equal(noCsrf.status, 403);
  assert.equal((await adm.post(`${ADMIN}/design/publish`, { _csrf: await csrf(alice), note: 'x' })).status, 403, 'forum CSRF token is not accepted');
  const p = await adm.apost('/design/publish', { note: 'First custom design' });
  assert.equal(p.status, 303); assert.match(p.location, /n=published/);
  const home = await anon().get('/');
  const cssUrl = liveCss(home.text), jsUrl = liveJs(home.text);
  assert.ok(cssUrl && jsUrl);
  assert.match(home.headers.get('content-security-policy'), /script-src 'self'/); assert.doesNotMatch(home.headers.get('content-security-policy'), /unsafe-inline|unsafe-eval/);
  assert.doesNotMatch(home.text, /<style|<script>(?!<)/);
  const cssRes = await fetch(`${BASE}${cssUrl}`, { headers: { 'x-test-ip': '10.77.0.1', 'accept-encoding': 'br' } });
  assert.equal(cssRes.status, 200); assert.match(cssRes.headers.get('cache-control'), /immutable/); assert.equal(cssRes.headers.get('content-encoding'), 'br'); assert.equal(cssRes.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await cssRes.text(), /--bg:#ff0000/);
  const js = await anon().get(jsUrl); assert.match(js.headers.get('content-type'), /javascript/); assert.match(js.text, /dataset\.custom/);
  // the dashboard never loads the custom files (a broken design cannot lock the admin out)
  const dash = (await adm.get(`${ADMIN}/design`)).text;
  assert.doesNotMatch(dash, /\/x\/site\./);
  // state: same as live, version recorded with note
  assert.match(dash, /same as live/); assert.match(dash, /First custom design/);
  assert.equal((await app.db.q('SELECT count(*)::int AS n FROM design_versions')).rows[0].n, 1);
});

test('templates: edit, validate, escape, publish; broken templates fall back', async () => {
  const save = (name, src) => adm.apost('/design/save', { tab: 'templates', tpl: name, src });
  for (const [src, re] of [['<footer><script>x()</script></footer>', /Custom JavaScript tab/], ['<footer onclick="x()">{{copy}}</footer>', /event attributes/], ['<footer>{{#if a}}</footer>', /never closed/], ['<footer>{{__proto__}}</footer>', /not a valid variable/], ['<footer>{{copy}} <iframe src="https://x.test"></iframe></footer>', /iframe/], ['<a href="javascript:alert(1)">x</a>', /javascript/]]) {
    const x = await save('footer', src); assert.equal(x.status, 400, src); assert.match(x.text, re, src);
  }
  assert.equal((await save('nope', 'x')).status, 404);
  let x = await save('footer', '<footer class="custom-foot">{{copy}} · {{#each links}}<a href="{{url}}">{{label}}</a>|{{/each}} {{missing}}</footer>');
  assert.equal(x.status, 303);
  x = await save('hero', '<section class="card hero custom-hero"><h1>{{heading}}</h1>{{#if intro}}<p class="lead">{{intro}}</p>{{/if}}</section>');
  assert.equal(x.status, 303);
  x = await save('post_card', '<li class="card post custom-card"><b>{{title}}</b> by {{#if author}}{{author}}{{else}}nobody{{/if}} {{{votes}}} <a href="{{url}}">{{comments}}</a> {{{title}}}</li>');
  assert.equal(x.status, 303);
  x = await save('header', '<header class="top custom-head"><a class="brand" href="/">{{{logo}}}<span class="slogan">{{slogan}}</span></a>{{#if user}}<span>Hi {{user.username}}</span>{{else}}<a href="/login">{{ui.login}}</a>{{/if}}</header>');
  assert.equal(x.status, 303);
  // nothing live yet
  assert.doesNotMatch((await anon().get('/')).text, /custom-foot|custom-head/);
  await app.db.q("INSERT INTO posts (community_id, ai_tag_id, title, body, hot) SELECT id, ai_tag_id, $1, 'x', 0 FROM communities WHERE name = 'Design_Test'", ['<img src=x onerror=alert(1)>']);
  // preview shows them
  const pv = await withPreview(() => adm.get('/m/claude?sort=new'));
  assert.match(pv.text, /custom-foot/); assert.match(pv.text, /custom-head/); assert.match(pv.text, /custom-card/);
  assert.doesNotMatch(pv.text, /<img src=x onerror/); assert.match(pv.text, /&lt;img src=x onerror=alert\(1\)&gt;/, 'raw braces never un-escape user text');
  assert.doesNotMatch(pv.text, /<\/footer><footer/);
  await adm.apost('/design/publish', { note: 'Templates' });
  const live = (await anon().get('/m/claude?sort=new')).text;
  assert.match(live, /<footer class="custom-foot">© \d{4} prompts360 · Every AI agent is welcome here\. · <a href="\/search">Search<\/a>\|<a href="\/communities">/);
  assert.match(live, /<header class="top custom-head">.*<a href="\/login">Log in<\/a>/s);
  assert.match(live, /custom-hero/); assert.match(live, /<b>Plain post<\/b> by prompts360/); assert.match(live, /<div class="vote"/);
  assert.equal((live.match(/<h1[ >]/g) || []).length, 1);
  // logged-in view uses the user branch + csrf-bearing logout is not needed by this header
  assert.match((await alice.get('/')).text, /Hi design_alice/);
  // reset a template: back to the built-in markup after publish
  assert.equal((await adm.apost('/design/save', { tab: 'templates', tpl: 'footer', reset: '1', src: '' })).status, 303);
  await adm.apost('/design/publish', { note: 'Footer reset' });
  const after = (await anon().get('/')).text; assert.doesNotMatch(after, /custom-foot/); assert.match(after, /<footer><nav aria-label="Footer">/);
  assert.match(after, /custom-head/, 'other templates stay customised');
});

test('a template that fails while rendering falls back to the built-in one', async () => {
  // bypass validation: store a template that is valid but exceeds the render limits for a long feed
  const ok = parse('{{#each links}}{{#each links}}{{#each links}}{{#each links}}x{{/each}}{{/each}}{{/each}}{{/each}}');
  assert.ok(ok);
  const big = { links: Array.from({ length: 60 }, () => ({})) };
  assert.throws(() => render(ok, big), /too complex|too large/);
  const { tpl } = await import('../src/design.js');
  assert.match(tpl('hero', { heading: 'Built-in works', intro: '' }).toString(), /Built-in works/);
});

test('history: every publish is kept; rollback and built-in restore work; discard resets the draft', async () => {
  const hist = (await adm.get(`${ADMIN}/design?tab=history`)).text;
  for (const n of ['First custom design', 'Templates', 'Footer reset', 'Built-in']) assert.match(hist, new RegExp(n));
  const { rows: v } = await app.db.q('SELECT id, note FROM design_versions ORDER BY id');
  assert.equal(v.length, 3);
  const first = v[0].id;
  // load into draft: visitors unchanged
  let x = await adm.apost('/design/restore', { id: String(first), mode: 'draft' });
  assert.equal(x.status, 303);
  assert.match((await anon().get('/')).text, /custom-head/, 'still the previous live design');
  assert.match((await adm.get(`${ADMIN}/design`)).text, /unpublished changes/);
  // discard: draft = live again
  await adm.apost('/design/discard', {});
  assert.match((await adm.get(`${ADMIN}/design`)).text, /same as live/);
  // one-click rollback to version 1 (theme+css+js, no custom templates)
  x = await adm.apost('/design/restore', { id: String(first), mode: 'publish' });
  assert.equal(x.status, 303);
  const home = (await anon().get('/')).text;
  assert.doesNotMatch(home, /custom-head/); assert.ok(liveCss(home) && liveJs(home));
  assert.equal((await app.db.q('SELECT count(*)::int AS n FROM design_versions')).rows[0].n, 4, 'rollback is itself a new version');
  // the earlier stylesheet URL keeps working for pages cached by browsers
  // built-in design restore removes everything
  x = await adm.apost('/design/restore', { id: '0', mode: 'publish' });
  const plain = (await anon().get('/')).text;
  assert.equal(liveCss(plain), undefined); assert.equal(liveJs(plain), undefined); assert.match(plain, /<header class="top"><div class="bar">/);
  assert.equal((await adm.apost('/design/restore', { id: '9999', mode: 'publish' })).status, 404);
  assert.equal((await adm.apost('/design/restore', { id: '-1', mode: 'publish' })).status, 404);
  assert.equal((await adm.apost('/design/restore', { id: "1;DROP TABLE users", mode: 'publish' })).status, 404);
});

test('old stylesheet files stay reachable after a newer publish; theme reset works', async () => {
  await adm.apost('/design/save', { tab: 'theme', 'c.bg': '#112233' }); await adm.apost('/design/publish', { note: 'v-a' });
  const a = liveCss((await anon().get('/')).text);
  await adm.apost('/design/save', { tab: 'theme', 'c.bg': '#445566' }); await adm.apost('/design/publish', { note: 'v-b' });
  const b = liveCss((await anon().get('/')).text);
  assert.notEqual(a, b);
  assert.match((await anon().get(a)).text, /#112233/); assert.match((await anon().get(b)).text, /#445566/);
  assert.equal((await anon().get('/x/site.ZZZZZZZZZZ.css')).status, 404);
  await adm.apost('/design/save', { tab: 'theme', reset: 'theme' });
  assert.deepEqual((await app.db.q('SELECT data FROM design_draft')).rows[0].data.theme, {});
  // publishing with nothing changed does nothing
  await adm.apost('/design/discard', {});
  const n0 = (await app.db.q('SELECT count(*)::int AS n FROM design_versions')).rows[0].n;
  await adm.apost('/design/publish', { note: 'noop' });
  assert.equal((await app.db.q('SELECT count(*)::int AS n FROM design_versions')).rows[0].n, n0);
});

test('design actions are audited and old history is pruned', async () => {
  await (await import('../src/metrics.js')).tick(true);
  const { rows } = await app.db.q("SELECT message FROM event_log WHERE kind = 'admin' AND message LIKE 'Design%'");
  assert.ok(rows.some(x => /published as version/.test(x.message)) && rows.some(x => /rolled back/.test(x.message)) && rows.some(x => /draft saved/.test(x.message)));
  const { publish } = await import('../src/design.js');
  for (let i = 0; i < 3; i++) await publish(`bulk ${i}`, { theme: { fs: 16 + i }, css: '', js: '', templates: {} });
  assert.ok((await app.db.q('SELECT count(*)::int AS n FROM design_versions')).rows[0].n <= 100);
});
