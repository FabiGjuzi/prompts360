// Reposts (quote posts) and notifications.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, client, makeUser, csrf, adminClient, flushLimits, earnPoints } from './_helpers.js';

let app, alice, bob, carol, dan, adm, orig, origUrl;
const one = async (sql, p = []) => (await app.db.q(sql, p)).rows[0];
const repost = async (u, id, body = '') => u.post(`/p/${id}/repost`, { _csrf: await csrf(u), body });

before(async () => {
  app = await boot(); adm = await adminClient(app);
  [alice, bob, carol, dan] = await Promise.all(['rp_alice', 'rp_bob', 'rp_carol', 'rp_dan'].map(n => makeUser(app.mail, { username: n })));
  await earnPoints(app, alice);
  const t = await csrf(alice);
  await alice.post('/communities/new', { _csrf: t, name: 'Repost_Test', title: 'Repost test', tag: 'general' });
  const r = await alice.post('/submit', { _csrf: await csrf(alice), community: 'Repost_Test', tag: 'gemini', title: 'Original prompt about foxes', body: 'Write a **story** about a fox who learns to code.' });
  orig = Number(r.location.match(/\/p\/(\d+)/)[1]); origUrl = r.location;
});
after(async () => { await app.close(); });

test('the repost form is shown to logged-in readers only', async () => {
  const page = await bob.get(origUrl);
  assert.match(page.text, /<summary>repost<\/summary>/); assert.match(page.text, new RegExp(`action="/p/${orig}/repost"`));
  assert.doesNotMatch((await client().get(origUrl)).text, /<summary>repost<\/summary>/);
  assert.equal((await client().post(`/p/${orig}/repost`, { body: 'x' })).status, 401);
  assert.equal((await bob.post(`/p/${orig}/repost`, { body: 'no csrf' })).status, 403);
  assert.equal((await repost(bob, 999999)).status, 404);
});

test('reposting: same community and tag, one upvote for the original, a notification for its author', async () => {
  const before = await one('SELECT score FROM posts WHERE id = $1', [orig]);
  const cBefore = await one("SELECT post_count FROM communities WHERE name = 'Repost_Test'");
  const r = await repost(bob, orig, 'This is *great* for onboarding.');
  assert.equal(r.status, 303); assert.match(r.location, /\/p\/\d+\?n=reposted$/);
  const rp = await one('SELECT p.*, t.slug AS tag, c.name AS community FROM posts p JOIN ai_tags t ON t.id = p.ai_tag_id JOIN communities c ON c.id = p.community_id WHERE p.repost_of = $1', [orig]);
  assert.equal(rp.community, 'Repost_Test'); assert.equal(rp.tag, 'gemini', 'tag of the ORIGINAL, not of the community'); assert.equal(rp.title, 'Original prompt about foxes');
  assert.equal(rp.body, 'This is *great* for onboarding.'); assert.equal(rp.score, 0);
  assert.equal((await one('SELECT score FROM posts WHERE id = $1', [orig])).score, before.score + 1, 'a repost is an upvote for the original');
  assert.equal((await one("SELECT post_count FROM communities WHERE name = 'Repost_Test'")).post_count, cBefore.post_count + 1);
  const n = await one('SELECT n.*, u.username AS who, a.username AS actor FROM notifications n JOIN users u ON u.id = n.user_id JOIN users a ON a.id = n.actor_id');
  assert.equal(n.who, 'rp_alice'); assert.equal(n.actor, 'rp_bob'); assert.equal(Number(n.post_id), rp.id); assert.equal(n.kind, 'repost'); assert.equal(n.read_at, null);
  // the repost's own page: embedded card, comment rendered, never indexed
  const page = await bob.getf(r.location);
  assert.match(page.text, /Repost: Original prompt about foxes/); assert.match(page.text, /<blockquote class="quote">/); assert.match(page.text, new RegExp(`<h2><a href="/p/${orig}/original-prompt-about-foxes">Original prompt about foxes</a></h2>`));
  assert.match(page.text, /a story about a fox|story about a fox/); assert.match(page.text, /<em>great<\/em>/); assert.match(page.text, /Reposted\./);
  assert.match(page.text, /name="robots" content="noindex/); assert.doesNotMatch(page.text, /rel="canonical"/); assert.doesNotMatch(page.text, /application\/ld\+json/);
});

test('feeds show the quote card; the original shows its repost count; the list page works', async () => {
  const feed = (await client().get('/c/Repost_Test?sort=new')).text;
  assert.match(feed, /<li class="card post repost">/); assert.match(feed, /↻ reposted/); assert.match(feed, /<blockquote class="quote">[\s\S]*Original prompt about foxes[\s\S]*<\/blockquote>/);
  assert.match(feed, /This is great for onboarding\./, 'the reposter’s comment (plain-text teaser) is shown above the card');
  assert.match(feed, new RegExp(`<a href="/reposts/${orig}">1 repost</a>`));
  const list = await client().get(`/reposts/${orig}`);
  assert.equal(list.status, 200); assert.match(list.text, /<h1>Reposts<\/h1>/); assert.match(list.text, /class="card post repost"/); assert.match(list.text, /noindex/);
  assert.equal((await client().get('/reposts/999999')).status, 404);
  assert.match((await bob.getf(`/p/${orig}`)).text, new RegExp(`<a href="/reposts/${orig}">1 repost</a>`));
});

test('rules: one repost per person, reposting a repost embeds the original, own posts allowed, no comment needed', async () => {
  assert.equal((await repost(bob, orig, 'again')).status, 409);
  const bobRepost = (await one('SELECT id FROM posts WHERE repost_of = $1 AND author_id = (SELECT id FROM users WHERE username = $2)', [orig, 'rp_bob'])).id;
  const r = await repost(carol, bobRepost);                      // carol clicks bob's repost, with no comment
  assert.equal(r.status, 303);
  const c = await one("SELECT p.repost_of, p.body FROM posts p JOIN users u ON u.id = p.author_id WHERE u.username = 'rp_carol' AND p.repost_of IS NOT NULL");
  assert.equal(Number(c.repost_of), orig, 'the root, never a repost'); assert.equal(c.body, '');
  const page = await carol.getf(r.location);
  assert.match(page.text, /<blockquote class="quote">/); assert.doesNotMatch(page.text, /<div class="md"><\/div>[\s\S]{0,5}<div class="md">/);
  const notified = (await app.db.q("SELECT u.username FROM notifications n JOIN users u ON u.id = n.user_id ORDER BY n.id")).rows.map(x => x.username);
  assert.deepEqual(notified, ['rp_alice', 'rp_alice'], 'only the author of the original is told (not the person whose repost was clicked)');
  // own post
  const sBefore = (await one('SELECT score FROM posts WHERE id = $1', [orig])).score;
  assert.equal((await repost(alice, orig, 'my own, again')).status, 303);
  assert.equal((await one('SELECT score FROM posts WHERE id = $1', [orig])).score, sBefore, 'reposting your own post is not an upvote for it');
  assert.equal((await app.db.q("SELECT count(*)::int n FROM notifications")).rows[0].n, 2, 'no notification to yourself');
  assert.equal((await one('SELECT count(*)::int n FROM posts WHERE repost_of = $1', [orig])).n, 3);
});

test('a downvote becomes an upvote; the score counts reposts', async () => {
  await dan.post('/vote', { _csrf: await csrf(dan), type: 'p', id: String(orig), dir: '-1' });
  const down = (await one('SELECT score FROM posts WHERE id = $1', [orig])).score;
  await repost(dan, orig, 'changed my mind');
  assert.equal((await one('SELECT score FROM posts WHERE id = $1', [orig])).score, down + 2);
  assert.equal((await one("SELECT value FROM post_votes WHERE post_id = $1 AND user_id = (SELECT id FROM users WHERE username = 'rp_dan')", [orig])).value, 1);
  assert.equal((await one('SELECT score FROM posts WHERE id = $1', [orig])).score, (await one('SELECT coalesce(sum(value),0)::int s FROM post_votes WHERE post_id = $1', [orig])).s, 'stored score equals the sum of votes');
});

test('notifications: badge, page, read state, privacy', async () => {
  await flushLimits();
  const home = (await alice.get('/')).text;
  assert.match(home, /<b class="badge">3<\/b>/); assert.match(home, /Notifications \(3\)/);
  const page = await alice.get('/notifications');
  assert.equal(page.status, 200); assert.match(page.text, /u\/rp_bob<\/a> reposted your post/); assert.match(page.text, /u\/rp_carol/); assert.match(page.text, /class="unread"/); assert.match(page.text, /noindex/);
  assert.match(page.headers.get('cache-control'), /no-store|private/);
  assert.doesNotMatch((await alice.get('/')).text, /class="badge"/, 'read');
  assert.match((await alice.get('/notifications')).text, /reposted your post/);
  assert.doesNotMatch((await bob.get('/notifications')).text, /reposted your post/, 'bob sees none of alice’s');
  assert.equal((await client().get('/notifications')).status, 303, 'login required');
});

test('reposts stay out of search and the sitemap; editing rules', async () => {
  const search = (await client().get('/search?q=foxes')).text;
  assert.equal((search.match(/class="card post/g) || []).length, 1, 'only the original is found');
  const sm = (await client().get('/sitemap.xml')).text;
  assert.ok(sm.includes(`/p/${orig}/`));
  const rids = (await app.db.q('SELECT id FROM posts WHERE repost_of = $1', [orig])).rows.map(r => r.id);
  for (const id of rids) assert.ok(!sm.includes(`/p/${id}/`), `repost ${id} is not in the sitemap`);
  // a repost's comment can be emptied; an ordinary post's body cannot
  const mine = (await one("SELECT id FROM posts WHERE author_id = (SELECT id FROM users WHERE username = 'rp_bob') AND repost_of IS NOT NULL")).id;
  assert.equal((await bob.post(`/p/${mine}/edit`, { _csrf: await csrf(bob), body: '' })).status, 303);
  assert.equal((await alice.post(`/p/${orig}/edit`, { _csrf: await csrf(alice), body: '  ' })).status, 400);
  assert.match((await one('SELECT body FROM posts WHERE id = $1', [orig])).body, /fox who learns/);
});

test('when the original disappears the card says so and reposting is refused', async () => {
  const del = await alice.post(`/p/${orig}/delete`, { _csrf: await csrf(alice) });
  assert.equal(del.status, 303);
  const feed = (await client().get('/c/Repost_Test?sort=new')).text;
  assert.match(feed, /This post is no longer available\./); assert.doesNotMatch(feed, /Original prompt about foxes<\/a><\/h2>/);
  const rp = (await one("SELECT id FROM posts WHERE repost_of = $1 AND author_id = (SELECT id FROM users WHERE username = 'rp_carol')", [orig])).id;
  const page = (await bob.getf(`/p/${rp}`)).text;
  assert.match(page, /This post is no longer available\./); assert.doesNotMatch(page, /<summary>repost<\/summary>/);
  assert.equal((await repost(dan, rp)).status, 404, 'cannot repost a repost whose original is gone');
  assert.equal((await repost(dan, orig)).status, 404);
  assert.match((await alice.get('/notifications')).text, /since removed|reposted your post/);
});

test('dashboard: reposts are visible, bodies stay required for normal posts, exports skip reposts', async () => {
  const list = (await adm.get(`/hidden-admin-path-for-tests/t/posts?q=foxes`)).text;
  assert.match(list, /repost_of/);
  const csv = (await adm.get('/hidden-admin-path-for-tests/export/content/posts.csv')).text;
  assert.doesNotMatch(csv, /changed my mind/); assert.doesNotMatch(csv, /my own, again/);
  const c = await one("SELECT id FROM communities WHERE name = 'Repost_Test'");
  const r = await adm.apost('/t/posts/new', { community_id: String(c.id), title: 'Dash empty', body: '', ai_tag_id: '', author_id: '', created_at: '', deleted_at: '', removed_at: '' });
  assert.equal(r.status, 400); assert.match(r.text, /Body is required/);
  // a dashboard edit of a repost with an empty comment is allowed
  const rp = await one("SELECT id, title, community_id, ai_tag_id FROM posts WHERE repost_of IS NOT NULL AND body = '' LIMIT 1");
  const e = await adm.apost(`/t/posts/${rp.id}`, { community_id: String(rp.community_id), title: rp.title, body: '', ai_tag_id: String(rp.ai_tag_id), author_id: '', created_at: '', deleted_at: '', removed_at: '' });
  assert.ok([200, 303].includes(e.status), `status ${e.status}`); assert.doesNotMatch(e.status === 200 ? e.text : '', /Body is required/);
});

test('custom post-card templates keep working (old templates without repost variables)', async () => {
  const { tpl } = await import('../src/design.js');
  const old = tpl('post_card', { votes: '', title: 'T', url: '/p/1', community: 'c', show_community: true, tag: 'x', tag_slug: 'x', author: 'a', age: '1h', link: null, excerpt: '', comments: '0 comments', score: 1, id: 1 }).toString();
  assert.match(old, /<h2><a href="\/p\/1">T<\/a><\/h2>/); assert.doesNotMatch(old, /quote|repost/);
});
