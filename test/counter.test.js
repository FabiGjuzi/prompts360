// Vote counters start at 0 and never show below 0; unpublishing hides a post at once; the comment editor; the server-side action log.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, client, makeUser, csrf, adminClient, earnPoints, flushLimits, ADMIN } from './_helpers.js';

let app, adm, anon, alice, voters, postId, cid;
const one = async (sql, p = []) => (await app.db.q(sql, p)).rows[0];
const FETCH = { headers: { 'x-requested-with': 'fetch' } };
let ipN = 0; const freshIp = u => { ipN++; u.ip = `10.50.${ipN >> 8}.${ipN & 255}`; };   // the per-IP burst bucket is not what these tests are about
const castOn = (type, id) => async (u, dir) => { freshIp(u); const r = await u.post('/vote', { _csrf: await csrf(u), type, id: String(id), dir }, FETCH); try { return JSON.parse(r.text); } catch { return { err: r.status, text: r.text.slice(0, 150) }; } };
let vote, cvote;

before(async () => {
  app = await boot(); adm = await adminClient(app); anon = client();
  alice = await makeUser(app.mail, { username: 'ct_alice' }); await earnPoints(app, alice);
  voters = []; for (let i = 0; i < 4; i++) voters.push(await makeUser(app.mail, { username: `ct_v${i}` }));
  const t = await csrf(alice);
  await alice.post('/communities/new', { _csrf: t, name: 'Counter_Hub', title: 'Counter hub', description: 'x', tag: 'claude' });
  const r = await alice.post('/submit', { _csrf: t, community: 'Counter_Hub', tag: 'claude', title: 'Counter post', url: '', body: 'Body of the counter post.' });
  postId = Number(r.location.match(/\/p\/(\d+)/)[1]);
  const c = await voters[0].post(`/p/${postId}/comment`, { _csrf: await csrf(voters[0]), body: 'First comment' });
  cid = Number(c.location.match(/#c(\d+)/)[1]);
  vote = castOn('p', postId); cvote = castOn('c', cid);
});
after(async () => { await app.close(); });

test('a new post and a new comment start at exactly 0 (no automatic author vote)', async () => {
  assert.equal((await one('SELECT score, net FROM posts WHERE id = $1', [postId])).score, 0);
  assert.equal((await one('SELECT score, net FROM comments WHERE id = $1', [cid])).score, 0);
  assert.equal((await one('SELECT count(*)::int n FROM post_votes WHERE post_id = $1', [postId])).n, 0);
  assert.match((await anon.getf(`/p/${postId}`)).text, /<b>0<\/b>/, 'the page shows 0');
});

test('increment goes 0 -> 1 -> 2; decrement and clearing come back down to 0, never to 1, never below 0', async () => {
  const [a, b] = voters;
  assert.deepEqual(await vote(a, '1'), { score: 1, vote: 1 });
  assert.deepEqual(await vote(b, '1'), { score: 2, vote: 1 });
  assert.deepEqual(await vote(b, '0'), { score: 1, vote: 0 });
  assert.deepEqual(await vote(a, '0'), { score: 0, vote: 0 }, 'cleared back to 0');
  assert.notEqual((await one('SELECT score FROM posts WHERE id = $1', [postId])).score, 1, 'clearing every vote must not leave 1');
  // downvotes from 0 stay at 0 on screen; clearing them stays at 0
  assert.deepEqual(await vote(a, '-1'), { score: 0, vote: -1 });
  assert.deepEqual(await vote(b, '-1'), { score: 0, vote: -1 });
  assert.deepEqual(await vote(a, '0'), { score: 0, vote: 0 });
  assert.deepEqual(await vote(b, '0'), { score: 0, vote: 0 });
  assert.equal((await one('SELECT net FROM posts WHERE id = $1', [postId])).net, 0);
});

test('the raw sum is kept behind the floor, so later votes count correctly', async () => {
  const [a, b, c] = voters;
  await vote(a, '-1'); await vote(b, '-1');                                   // net -2, shown 0
  assert.deepEqual(await vote(c, '1'), { score: 0, vote: 1 }, 'net -1 is still shown as 0');
  assert.deepEqual(await vote(a, '0'), { score: 0, vote: 0 });               // net 0
  assert.deepEqual(await vote(b, '0'), { score: 1, vote: 0 }, 'net +1 once the downvotes are gone');
  assert.deepEqual(await vote(c, '0'), { score: 0, vote: 0 });
  const row = await one('SELECT score, net FROM posts WHERE id = $1', [postId]); assert.deepEqual([row.score, row.net], [0, 0]);
});

test('any sequence of votes keeps score = max(0, sum of votes), for posts and comments', async () => {
  let seed = 12345; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const state = new Map();
  for (const [name, cast, table, key, id, votesTable] of [['post', vote, 'posts', 'post_id', postId, 'post_votes'], ['comment', cvote, 'comments', 'comment_id', cid, 'comment_votes']]) {
    for (let i = 0; i < 40; i++) {
      const u = voters[rnd(voters.length)], dir = ['1', '-1', '0'][rnd(3)];
      await flushLimits();
      const res = await cast(u, dir);
      const { rows: [{ sum }] } = await app.db.q(`SELECT coalesce(sum(value), 0)::int AS sum FROM ${votesTable} WHERE ${key} = $1`, [id]);
      assert.equal(res.score, Math.max(0, sum), `${name} step ${i} ${JSON.stringify(res)} dir=${dir}`); assert.ok(res.score >= 0);
      state.set(name, sum);
    }
    const row = await one(`SELECT score, net FROM ${table} WHERE id = $1`, [id]);
    assert.deepEqual([row.score, row.net], [Math.max(0, state.get(name)), state.get(name)]);
  }
});

test('the database itself refuses a negative score', async () => {
  await assert.rejects(app.db.q('UPDATE posts SET score = -1 WHERE id = $1', [postId]), /posts_score_floor/);
  await assert.rejects(app.db.q('UPDATE comments SET score = -1 WHERE id = $1', [cid]), /comments_score_floor/);
});

test('reposting your own post is not an upvote for it; reposting someone else’s is one', async () => {
  await flushLimits(); freshIp(alice);
  const a = await makeUser(app.mail, { username: 'ct_rep' }); await earnPoints(app, a); const t = await csrf(a);
  const mk = await alice.post('/submit', { _csrf: await csrf(alice), community: 'Counter_Hub', tag: 'claude', title: 'Repost counter post', url: '', body: 'Fresh post for the repost check.' });
  const id = Number(mk.location.match(/\/p\/(\d+)/)[1]);
  const sc = async () => (await one('SELECT score, net FROM posts WHERE id = $1', [id]));
  assert.deepEqual(await sc(), { score: 0, net: 0 });
  const own = await alice.post(`/p/${id}/repost`, { _csrf: await csrf(alice), body: '' }); assert.equal(own.status, 303);
  assert.deepEqual(await sc(), { score: 0, net: 0 }, 'own repost: no upvote');
  const rr = await a.post(`/p/${id}/repost`, { _csrf: t, body: '' }); assert.equal(rr.status, 303, rr.text.slice(0, 300));
  assert.deepEqual(await sc(), { score: 1, net: 1 }, 'someone else’s repost: one upvote');
  const rp = await one('SELECT score FROM posts WHERE repost_of = $1 AND author_id = (SELECT id FROM users WHERE username = $2)', [id, 'ct_rep']);
  assert.equal(rp.score, 0, 'a repost itself starts at 0 too');
});

test('unpublishing a live post stops it resolving on every public route at once; publishing brings it back', async () => {
  const t = await csrf(alice);
  const r = await alice.post('/submit', { _csrf: t, community: 'Counter_Hub', tag: 'claude', title: 'Toggle me off and on', url: '', body: 'Toggle body text.' });
  const id = Number(r.location.match(/\/p\/(\d+)/)[1]); const slug = r.location;
  const routes = [slug, `/p/${id}`, '/', '/?sort=new', '/c/Counter_Hub?sort=new', '/m/claude', '/search?q=toggle+me+off', '/sitemap.xml', '/u/ct_alice'];
  const seen = async () => { const out = []; for (const p of routes) { const g = await anon.get(p); out.push(g.status === 200 && /Toggle me off and on/.test(g.text) || (p === slug && g.status === 200)); } return out; };
  assert.ok((await seen()).slice(0, 2).some(Boolean), 'visible while published (this also fills the page cache)');
  assert.equal((await anon.getf(slug)).status, 200);
  const off = await adm.apost('/posts/publish', { id: String(id), to: '0' });
  assert.equal(off.status, 303);
  assert.equal((await anon.get(slug)).status, 404); assert.equal((await anon.get(`/p/${id}`)).status, 404);
  for (const p of routes.slice(2)) { const g = await anon.get(p); assert.doesNotMatch(g.text, /Toggle me off and on/, p); }
  assert.equal((await alice.get(slug)).status, 404, 'not even for its author');
  // no interaction with an unpublished post
  const v = await alice.post('/vote', { _csrf: t, type: 'p', id: String(id), dir: '1' });
  const cm = await alice.post(`/p/${id}/comment`, { _csrf: t, body: 'hi' });
  const rp = await voters[1].post(`/p/${id}/repost`, { _csrf: await csrf(voters[1]), body: '' });
  for (const x of [v, cm, rp]) assert.ok(x.status >= 400 && x.status < 500, `refused (${x.status})`);
  assert.equal((await one('SELECT count(*)::int n FROM comments WHERE post_id = $1', [id])).n, 0);
  // the dashboard still sees it, flagged as a draft
  assert.match((await adm.get(`${ADMIN}/t/posts?q=Toggle+me`)).text, /<span class="pill warn">Draft<\/span>/);
  const on = await adm.apost('/posts/publish', { id: String(id), to: '1' }); assert.equal(on.status, 303);
  assert.equal((await anon.getf(slug)).status, 200);
});

test('comment editor: a compact rich editor on the comment, reply and edit forms, with a textarea fallback; markdown renders safely', async () => {
  await flushLimits(); [alice, voters[0], anon].forEach(freshIp);
  const page = (await alice.getf(`/p/${postId}`)).text;
  assert.match(page, /<div class="wys"[^>]*data-compact="1"[^>]*>\s*<textarea[^>]*name="body"[^>]*maxlength="10000"/, 'new comment form');
  assert.match(page, /<summary>reply<\/summary><form[^>]*>[\s\S]*?class="wys"[^>]*data-compact="1"/, 'reply form');
  assert.match(page, /editor\.[\w-]+\.js/);
  const own = await voters[0].getf(`/p/${postId}`);
  assert.match(own.text, /<summary>edit<\/summary>[\s\S]*?data-compact="1"/, 'edit form for the author');
  const ed = (await import('node:fs')).readFileSync(new URL('../public/editor.js', import.meta.url), 'utf8');
  assert.match(ed, /\['bold', 'italic', 'quote', 'ul', 'ol'\]/, 'compact toolbar: bold, italic, quote, lists only');
  assert.match(ed, /d\.addEventListener\('toggle'/, 'editors inside closed reply/edit boxes are built only when opened');
  const body = '**bold** and *italic*\n\n> quoted line\n\n- one\n- two\n\n1. first\n2. second\n\n<script>alert(1)</script> [x](javascript:alert(1))';
  const r = await alice.post(`/p/${postId}/comment`, { _csrf: await csrf(alice), body });
  const cm = await anon.getf(`/p/${postId}`);
  assert.match(cm.text, /<strong>bold<\/strong>/); assert.match(cm.text, /<em>italic<\/em>/); assert.match(cm.text, /<blockquote>[\s\S]*quoted line/); assert.match(cm.text, /<ul>[\s\S]*<li>one<\/li>/); assert.match(cm.text, /<ol>[\s\S]*<li>first<\/li>/);
  assert.doesNotMatch(cm.text, /<script>alert/); assert.doesNotMatch(cm.text, /href="javascript:/);
  assert.equal(r.status, 303);
});

test('action log: votes, comments and publish toggles are recorded inside the same transaction, without IP or browser data', async () => {
  const kinds = (await app.db.q('SELECT kind, count(*)::int n FROM action_events GROUP BY kind')).rows.reduce((m, r) => ({ ...m, [r.kind]: r.n }), {});
  assert.ok(kinds.vote >= 40 && kinds['comment.create'] >= 2 && kinds['post.unpublish'] >= 1 && kinds['post.publish'] >= 1, JSON.stringify(kinds));
  const v = await one("SELECT * FROM action_events WHERE kind = 'vote' ORDER BY id DESC LIMIT 1");
  assert.deepEqual(Object.keys(v).sort(), ['actor_id', 'id', 'kind', 'meta', 'target_id', 'target_type', 'ts']);
  assert.ok(['from', 'to', 'score'].every(k => k in v.meta));
  assert.equal((await one("SELECT count(*)::int n FROM action_events WHERE kind = 'vote' AND meta::text ~ '[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+'")).n, 0, 'no IP address anywhere');
  // an unchanged vote (same direction again) is not an event
  await flushLimits();
  const n0 = (await one("SELECT count(*)::int n FROM action_events WHERE kind = 'vote'")).n;
  await vote(voters[2], '1'); await vote(voters[2], '1');
  assert.equal((await one("SELECT count(*)::int n FROM action_events WHERE kind = 'vote'")).n, n0 + 1);
  // the dashboard can read it, visitors cannot
  assert.equal((await anon.get(`${ADMIN}/t/action_events`)).status, 404);
  assert.match((await adm.get(`${ADMIN}/t/action_events`)).text, /Action log/);
});
