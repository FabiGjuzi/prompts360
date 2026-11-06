// Migration 010 must upgrade a database that ALREADY holds hidden drafts (the old CHECK posts_draft_is_hidden forbids clearing removed_at on a draft).
// This is the production shape: it failed a real deploy once because the empty test database had no drafts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';

const ROOT = (process.env.TEST_DATABASE_URL || 'postgres://postgres:devpass@127.0.0.1:54329/prompts360_test').replace(/\/[^/]*$/, '');

test('010 upgrades a populated database: drafts become unpublished, removed posts stay removed, scores are floored, self-votes go', async () => {
  const admin = new pg.Client({ connectionString: `${ROOT}/postgres` }); await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS mig010'); await admin.query('CREATE DATABASE mig010'); await admin.end();
  const c = new pg.Client({ connectionString: `${ROOT}/mig010` }); await c.connect();
  try {
    const files = fs.readdirSync(new URL('../migrations/', import.meta.url)).filter(f => /^\d+.*\.sql$/.test(f)).sort();
    const run = f => c.query(fs.readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
    for (const f of files.filter(f => f < '010')) await run(f);
    const q = (t, p) => c.query(t, p);
    await q("INSERT INTO users (username) VALUES ('alice'),('bob')");
    const [ua, ub] = (await q('SELECT id FROM users ORDER BY id')).rows.map(r => r.id);
    const tag = (await q('SELECT id FROM ai_tags LIMIT 1')).rows[0]?.id ?? (await q("INSERT INTO ai_tags (slug,name) VALUES ('claude','Claude') RETURNING id")).rows[0].id;
    const cm = (await q("INSERT INTO communities (name,title,ai_tag_id) VALUES ('Hub','Hub',$1) RETURNING id", [tag])).rows[0].id;
    const ins = async (title, draft, removed) => (await q(`INSERT INTO posts (community_id, ai_tag_id, title, hot, author_id, score, draft, removed_at) VALUES ($1,$2,$3,0,$4,1,$5,${removed || draft ? 'now()' : 'NULL'}) RETURNING id`, [cm, tag, title, ua, draft])).rows[0].id;
    const live1 = await ins('live one', false, false), live2 = await ins('live two', false, false);
    await ins('draft one', true, true); await ins('draft two', true, true); await ins('removed live', false, true);
    await q('INSERT INTO post_votes (user_id, post_id, value) VALUES ($1,$2,1),($3,$2,-1)', [ua, live1, ub]);   // self-vote + a downvote
    await q('INSERT INTO post_votes (user_id, post_id, value) VALUES ($1,$2,1),($3,$2,1)', [ua, live2, ub]);    // self-vote + an upvote
    await run('010_published_flag.sql');
    const by = Object.fromEntries((await q('SELECT title, published, removed_at IS NOT NULL AS removed, published_at IS NOT NULL AS dated, score, net FROM posts')).rows.map(r => [r.title, r]));
    assert.deepEqual([by['draft one'].published, by['draft one'].removed, by['draft one'].dated], [false, false, false]);
    assert.deepEqual([by['draft two'].published, by['draft two'].removed], [false, false]);
    assert.deepEqual([by['live one'].published, by['live one'].dated, by['live one'].score, by['live one'].net], [true, true, 0, -1], 'net kept, shown score floored at 0');
    assert.deepEqual([by['live two'].score, by['live two'].net], [1, 1]);
    assert.deepEqual([by['removed live'].published, by['removed live'].removed], [true, true], 'a moderator removal survives');
    assert.equal((await q('SELECT count(*)::int n FROM post_votes v JOIN posts p ON p.id = v.post_id WHERE v.user_id = p.author_id')).rows[0].n, 0, 'author self-votes deleted');
    await assert.rejects(q('UPDATE posts SET score = -1'), /posts_score_floor/);
  } finally { await c.end(); const a = new pg.Client({ connectionString: `${ROOT}/postgres` }); await a.connect(); await a.query('DROP DATABASE IF EXISTS mig010'); await a.end(); }
});
