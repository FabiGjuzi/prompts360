// Points and level tiers: earning rules, reversals, the community gate, display.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, makeUser, csrf, adminClient, flushLimits, earnPoints } from './_helpers.js';
import { levelOf, getTiers, communityMin } from '../src/points.js';

let app, alice, bob, carol, adm, comm;
const pts = async name => (await app.db.q('SELECT points FROM users WHERE username = $1', [name])).rows[0].points;
const sql = (s, p = []) => app.db.q(s, p);
const mkPost = async (u, title = 'A post') => Number((await u.post('/submit', { _csrf: await csrf(u), community: comm, tag: 'claude', title, body: 'Body text for the post.' })).location.match(/\/p\/(\d+)/)[1]);
const vote = async (u, type, id, dir) => u.post('/vote', { _csrf: await csrf(u), type, id: String(id), dir: String(dir) });
const comment = async (u, post, body = 'nice') => { const r = await u.post(`/p/${post}/comment`, { _csrf: await csrf(u), body }); return Number(r.location.match(/#c(\d+)/)[1]); };

before(async () => {
  app = await boot(); adm = await adminClient(app);
  [alice, bob, carol] = await Promise.all(['pt_alice', 'pt_bob', 'pt_carol'].map(n => makeUser(app.mail, { username: n })));
  comm = 'Points_Test';
  const site = (await sql("SELECT id FROM users WHERE username = 'prompts360'")).rows[0]?.id ?? 1;
  await sql("INSERT INTO communities (name, title, ai_tag_id, creator_id) VALUES ($1, 'Points', (SELECT id FROM ai_tags WHERE slug = 'claude'), $2)", [comm, site]);
});
after(async () => { await app.close(); });

test('level tiers: names, thresholds and progress', () => {
  assert.deepEqual(getTiers().map(t => t[1]), ['Newcomer', 'Explorer', 'Contributor', 'Builder', 'Expert', 'Legend']);
  assert.equal(levelOf(0).name, 'Newcomer'); assert.equal(levelOf(24).name, 'Newcomer'); assert.equal(levelOf(25).name, 'Explorer');
  assert.equal(levelOf(149).name, 'Contributor'); assert.equal(levelOf(150).name, 'Builder'); assert.equal(levelOf(499).name, 'Builder');
  assert.equal(levelOf(500).name, 'Expert'); assert.equal(levelOf(1500).name, 'Legend'); assert.equal(levelOf(99999).next, null);
  assert.equal(levelOf(-5).name, 'Newcomer'); assert.equal(levelOf(100).toNext, 50); assert.equal(levelOf(150).level, 4); assert.equal(communityMin(), 150);
});

test('everyone starts at 0, including activity from before points existed', async () => {
  assert.equal(await pts('pt_alice'), 0);
  const old = await sql("INSERT INTO posts (community_id, ai_tag_id, author_id, title, body, hot, created_at) SELECT c.id, c.ai_tag_id, u.id, 'Old post', 'old', 0, now() - interval '3 days' FROM communities c, users u WHERE c.name = $1 AND u.username = 'pt_alice' RETURNING id", [comm]);
  const { recalc } = await import('../src/points.js'); await recalc(null);
  assert.equal(await pts('pt_alice'), 0, 'a post made before the start date earns nothing');
  await sql('DELETE FROM posts WHERE id = $1', [old.rows[0].id]);
});

test('posting: +5; commenting on someone else\'s post: +2; own post: nothing', async () => {
  const p = await mkPost(alice, 'Alice post');
  assert.equal(await pts('pt_alice'), 5, 'the author voting on their own post earns nothing');
  await comment(alice, p);                       // own post
  assert.equal(await pts('pt_alice'), 5);
  await comment(bob, p);
  assert.equal(await pts('pt_bob'), 2);
  assert.equal(await pts('pt_alice'), 5, 'a comment earns the commenter, not the author');
});

test('voting: +1 for the voter AND +1 for the author, up or down, once per item', async () => {
  const p = await mkPost(carol, 'Carol post');   // carol 5
  await vote(alice, 'p', p, 1);
  assert.equal(await pts('pt_alice'), 6); assert.equal(await pts('pt_carol'), 6);
  await vote(alice, 'p', p, -1);                 // change direction: still one vote
  assert.equal(await pts('pt_alice'), 6); assert.equal(await pts('pt_carol'), 6);
  await vote(alice, 'p', p, 0);                  // undo: points come back
  assert.equal(await pts('pt_alice'), 5); assert.equal(await pts('pt_carol'), 5);
  for (let i = 0; i < 4; i++) { await vote(alice, 'p', p, 1); await vote(alice, 'p', p, 0); }   // toggling cannot be farmed
  assert.equal(await pts('pt_alice'), 5); assert.equal(await pts('pt_carol'), 5);
  await vote(alice, 'p', p, -1);
  assert.equal(await pts('pt_alice'), 6); assert.equal(await pts('pt_carol'), 6);
  await vote(carol, 'p', p, 1); await vote(carol, 'p', p, -1);
  assert.equal(await pts('pt_carol'), 6, 'voting on your own post earns nothing');
});

test('comment votes count the same way', async () => {
  const p = await mkPost(carol, 'Thread');          // carol +5 → 11
  const c = await comment(bob, p);                  // bob +2
  const bob0 = await pts('pt_bob'), alice0 = await pts('pt_alice');
  await vote(alice, 'c', c, 1);
  assert.equal(await pts('pt_alice'), alice0 + 1); assert.equal(await pts('pt_bob'), bob0 + 1);
  await vote(bob, 'c', c, 1);                       // own comment (auto-upvote already there)
  assert.equal(await pts('pt_bob'), bob0 + 1);
});

test('reposting: +2 for the reposter, +2 for the original author, none for your own post, auto-upvote is not a vote', async () => {
  const p = await mkPost(carol, 'Share me');
  const c0 = await pts('pt_carol'), a0 = await pts('pt_alice');
  await flushLimits();
  const r = await alice.post(`/p/${p}/repost`, { _csrf: await csrf(alice), body: 'sharing' });
  assert.equal(r.status, 303);
  assert.equal(await pts('pt_alice'), a0 + 2); assert.equal(await pts('pt_carol'), c0 + 2);
  const mine = await mkPost(bob, 'My own');
  const b0 = await pts('pt_bob');
  await bob.post(`/p/${mine}/repost`, { _csrf: await csrf(bob), body: 'self' });
  assert.equal(await pts('pt_bob'), b0, 'reposting your own post earns nothing (a repost is not a new post)');
  // deleting the repost takes the share points back
  const rp = (await sql('SELECT id FROM posts WHERE repost_of = $1 AND author_id = (SELECT id FROM users WHERE username = $2)', [p, 'pt_alice'])).rows[0].id;
  await alice.post(`/p/${rp}/delete`, { _csrf: await csrf(alice) });
  assert.equal(await pts('pt_alice'), a0); assert.equal(await pts('pt_carol'), c0);
});

test('deleting a post or comment takes its points back, including the points others earned on it', async () => {
  const p = await mkPost(alice, 'Doomed');
  const c = await comment(bob, p, 'will vanish with the post');
  await vote(carol, 'p', p, 1);
  const before = { a: await pts('pt_alice'), b: await pts('pt_bob'), c: await pts('pt_carol') };
  await alice.post(`/p/${p}/delete`, { _csrf: await csrf(alice) });
  assert.equal(await pts('pt_alice'), before.a - 5 - 1, 'post +5 and the vote she received');
  assert.equal(await pts('pt_bob'), before.b - 2, 'comment on the deleted post');
  assert.equal(await pts('pt_carol'), before.c - 1, 'vote on the deleted post');
  const p2 = await mkPost(carol, 'Keeper');
  const c2 = await comment(bob, p2);
  const b2 = await pts('pt_bob');
  await bob.post(`/comment/${c2}/delete`, { _csrf: await csrf(bob) });
  assert.equal(await pts('pt_bob'), b2 - 2);
  void c;
});

test('admin removals reverse points too, and the total never goes below 0', async () => {
  const p = await mkPost(bob, 'Removed by admin');
  const b0 = await pts('pt_bob');
  await sql('UPDATE posts SET removed_at = now() WHERE id = $1', [p]);
  const { recalc } = await import('../src/points.js'); await recalc(null);
  assert.equal(await pts('pt_bob'), b0 - 5);
  await sql("UPDATE users SET points = -40 WHERE username = 'pt_bob'"); await recalc(null);
  assert.ok(await pts('pt_bob') >= 0);
});

test('community creation needs 150 points: shown on the form, enforced on the server', async () => {
  const dan = await makeUser(app.mail, { username: 'pt_dan' });
  const form = await dan.get('/communities/new');
  assert.match(form.text, /You need 150 points to create a community/); assert.match(form.text, /<fieldset class="plain" disabled>/);
  assert.match(form.text, /You have 0/);
  const r = await dan.post('/communities/new', { _csrf: await csrf(dan), name: 'Too_Early', title: 'No', tag: 'general' });
  assert.equal(r.status, 403); assert.match(r.text, /You need 150 points/);
  assert.equal((await sql("SELECT 1 FROM communities WHERE name = 'Too_Early'")).rowCount, 0);
  await earnPoints(app, dan, 148);
  assert.equal(await pts('pt_dan'), 148);
  assert.equal((await dan.post('/communities/new', { _csrf: await csrf(dan), name: 'Too_Early', title: 'No', tag: 'general' })).status, 403);
  await earnPoints(app, dan, 2);
  assert.equal(await pts('pt_dan'), 150);
  assert.doesNotMatch((await dan.get('/communities/new')).text, /You need 150/);
  const ok = await dan.post('/communities/new', { _csrf: await csrf(dan), name: 'Right_On_Time', title: 'Yes', tag: 'general' });
  assert.equal(ok.status, 303);
  // dropping below 150 closes the door again
  await sql("DELETE FROM comments WHERE author_id = (SELECT id FROM users WHERE username = 'pt_dan') AND id IN (SELECT id FROM comments WHERE author_id = (SELECT id FROM users WHERE username = 'pt_dan') LIMIT 1)");
  await flushLimits();
  assert.equal((await dan.post('/communities/new', { _csrf: await csrf(dan), name: 'Too_Late', title: 'No', tag: 'general' })).status, 403);
});

test('the dashboard is not gated', async () => {
  const tag = (await sql("SELECT id FROM ai_tags WHERE slug = 'claude'")).rows[0];
  const r = await adm.apost('/t/communities/new', { name: 'Admin_Made', title: 'Admin made', description: 'x', ai_tag_id: String(tag.id), creator_id: '', removed_at: '' });
  assert.ok([200, 303].includes(r.status)); assert.equal((await sql("SELECT 1 FROM communities WHERE name = 'Admin_Made'")).rowCount, 1);
});

test('points and level are shown: header menu, profile and author badges', async () => {
  const menu = (await alice.get('/')).text;
  assert.match(menu, /<span class="pts">\w+ · \d+ pts<\/span>/);
  const prof = (await alice.get('/u/pt_carol')).text;
  assert.match(prof, /class="lvlbox"/); assert.match(prof, /<b>\d+<\/b> points · level \d of 6/); assert.match(prof, /<progress /);
  const post = (await sql("SELECT id FROM posts WHERE title = 'Carol post'")).rows[0].id;
  const page = (await alice.getf(`/p/${post}`)).text;
  assert.match(page, /<a href="\/u\/pt_carol">u\/pt_carol<\/a> <span class="lvl" title="\d+ points">(Newcomer|Explorer)<\/span>/);
  assert.match((await alice.get(`/c/${comm}`)).text, /<span class="lvl" title="\d+ points">/);
});

test('dashboard users list shows the points column (read-only)', async () => {
  const r = await adm.get(`${(await import('./_helpers.js')).ADMIN}/t/users`);
  assert.equal(r.status, 200); assert.match(r.text, /points/i);
});

test('dashboard: levels can be created, renamed, re-thresholded and deleted; the site follows immediately', async () => {
  const { ADMIN } = await import('./_helpers.js');
  const ids = async () => Object.fromEntries((await sql('SELECT name, id FROM levels')).rows.map(r => [r.name, r.id]));
  assert.equal((await adm.get(`${ADMIN}/t/levels`)).status, 200);
  // rename Builder → Maker, move Expert to 400, add a new tier
  let l = await ids();
  assert.equal((await adm.apost(`/t/levels/${l.Builder}`, { name: 'Maker', min_points: '150' })).status, 303);
  assert.equal((await adm.apost(`/t/levels/${l.Expert}`, { name: 'Expert', min_points: '400' })).status, 303);
  assert.equal((await adm.apost('/t/levels/new', { name: 'Grandmaster', min_points: '5000' })).status, 303);
  const { levelOf, getTiers } = await import('../src/points.js');
  assert.equal(levelOf(150).name, 'Maker'); assert.equal(levelOf(400).name, 'Expert'); assert.equal(levelOf(5000).name, 'Grandmaster');
  assert.equal(getTiers().length, 7);
  // validation: duplicate threshold, duplicate name, negative, bad number
  for (const [name, pts] of [['Dupe', '25'], ['explorer', '26'], ['Neg', '-5'], ['Huge', '99999999999'], ['Words', 'abc'], ['', '10']]) {
    const r = await adm.apost('/t/levels/new', { name, min_points: pts });
    assert.equal(r.status, 400, `${name}/${pts} must be rejected`);
  }
  // the 0-point level can be renamed but not moved or deleted
  l = await ids();
  assert.equal((await adm.apost(`/t/levels/${l.Newcomer}`, { name: 'Rookie', min_points: '0' })).status, 303);
  assert.equal(levelOf(0).name, 'Rookie');
  assert.equal((await adm.apost(`/t/levels/${l.Newcomer}`, { name: 'Rookie', min_points: '5' })).status, 400);
  assert.equal((await adm.apost(`/t/levels/${l.Newcomer}/delete`, {})).status, 400);
  assert.equal((await sql('SELECT 1 FROM levels WHERE min_points = 0')).rowCount, 1);
  // other tiers can be deleted
  assert.equal((await adm.apost(`/t/levels/${l.Contributor}/delete`, {})).status, 303);
  assert.equal(getTiers().length, 6);
  // the public pages use the new names
  assert.match((await alice.get('/')).text, /<span class="pts">(Rookie|Explorer) · \d+ pts<\/span>/);
});

test('dashboard: the community-creation requirement is its own editable number', async () => {
  const { ADMIN } = await import('./_helpers.js');
  const { communityMin } = await import('../src/points.js');
  assert.equal((await adm.get(`${ADMIN}/t/points_settings`)).status, 200);
  assert.equal((await adm.get(`${ADMIN}/t/points_settings/new`)).status, 404, 'a single settings row: no create');
  assert.equal((await adm.apost('/t/points_settings/1/delete', {})).status, 404, 'and no delete');
  assert.equal((await adm.apost('/t/points_settings/1', { community_min: '-1' })).status, 400);
  assert.equal((await adm.apost('/t/points_settings/1', { community_min: '10' })).status, 303);
  assert.equal(communityMin(), 10);
  const erin = await makeUser(app.mail, { username: 'pt_erin' });
  assert.match((await erin.get('/communities/new')).text, /You need 10 points/);
  await earnPoints(app, erin, 10);
  await flushLimits();
  assert.equal((await erin.post('/communities/new', { _csrf: await csrf(erin), name: 'Ten_Is_Enough', title: 'ok', tag: 'general' })).status, 303);
  assert.equal((await adm.apost('/t/points_settings/1', { community_min: '150' })).status, 303);
  assert.equal(communityMin(), 150);
});
