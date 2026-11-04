// routes/forum.js — the public product: feeds, communities, posts, comments, votes, reports, profiles, search.
// Feeds use keyset pagination (a cursor of the last item) so any page costs the same as the first.
// Every route is listed at the bottom in forumRoutes: [method, URL regex, handler, options].
import { q, qr, one, tx } from '../db.js';
import { cached } from '../kv.js';
import { hit, LIMITS } from '../ratelimit.js';
import { ipKey } from '../crypto.js';
import { page, redirect, json, str, HttpError } from '../http.js';
import { t } from '../site.js';
import { pageBySlug } from '../site.js';
import { ldHome, ldBreadcrumbs, ldPost, ldCollection, ldWebPage } from '../seo.js';
import { safeUrl, safeBack, slugify } from '../html.js';
import * as V from '../views.js';
import { COMMUNITY_RE, intId } from '../validate.js';

// ---------- AI tags (tiny table, cached in-process) ----------
// In-process copy of the AI tags: when it was loaded, and the rows.
let tagCache = { at: 0, list: [] };
/** All AI model tags (cached in-process for 60 s). */
export async function tags() {
  if (Date.now() - tagCache.at > 60_000) tagCache = { at: Date.now(), list: (await qr('SELECT id, slug, name, description, seo_title, seo_desc FROM ai_tags WHERE enabled ORDER BY sort, name')).rows };
  return tagCache.list;
}
/** Make the next tags() call reload from the database (after an admin edits tags). */
export const resetTagCache = () => { tagCache.at = 0; };
/** Find one AI tag by its slug, or null. */
const tagBySlug = async s => (await tags()).find(t => t.slug === s) || null;

// ---------- Feeds (keyset pagination: cost is independent of page depth) ----------
// SQL fragment: only posts that are neither deleted by the author nor removed by an admin.
const VIS = 'p.deleted_at IS NULL AND p.removed_at IS NULL';
// Columns and joins shared by every feed query (one place so all feeds return the same shape).
const POST_COLS = `p.id, p.title, p.url, p.score, p.comment_count, p.created_at, p.hot, left(p.body, 300) AS excerpt,
  c.name AS community, t.slug AS tag_slug, t.name AS tag_name, CASE WHEN u.deleted_at IS NULL THEN u.username END AS author`;
const POST_FROM = `FROM posts p JOIN communities c ON c.id = p.community_id JOIN ai_tags t ON t.id = p.ai_tag_id
  LEFT JOIN users u ON u.id = p.author_id`;
// Top-feed time windows -> SQL interval. Values are constants, never user text (safe to inline in SQL).
const WINDOWS = { day: '1 day', week: '7 days', month: '30 days', year: '365 days' }; // constants, never user text
// Posts per page.
const PAGE = 25;

/** Validate the ?sort= value (hot | new | top), defaulting to hot. */
const parseSort = s => (s === 'new' || s === 'top' ? s : 'hot');
/** Validate the ?t= time window for Top (day | week | month | year | all), defaulting to day. */
const parseWindow = t => (t in WINDOWS || t === 'all' ? t : 'day');

/** Parse the ?after= pagination cursor for the active sort; returns null if malformed. */
function parseCursor(sort, c) {
  if (typeof c !== 'string' || c.length > 60) return null;
  let m;
  if (sort === 'hot' && (m = c.match(/^h(-?\d{1,12}(?:\.\d{1,12})?)_(\d{1,15})$/))) return { hot: Number(m[1]), id: Number(m[2]) };
  if (sort === 'top' && (m = c.match(/^s(-?\d{1,10})_(\d{1,15})$/))) return { score: Number(m[1]), id: Number(m[2]) };
  if (sort === 'new' && (m = c.match(/^n(\d{1,15})$/))) return { id: Number(m[1]) };
  return null;
}
/** Build the cursor for the NEXT page from the last post shown (keyset pagination). */
const makeCursor = (sort, p) => sort === 'hot' ? `h${p.hot}_${p.id}` : sort === 'top' ? `s${p.score}_${p.id}` : `n${p.id}`;

/** Fetch one page of posts for the given filters/sort (keyset-paginated, index-backed, cached briefly for ranked feeds). Returns {posts, next}. */
async function loadFeed({ communityId, tagId, authorId, search, sort = 'hot', window = 'day', after }) {
  if (search) return searchFeed(search, after);
  if (authorId) sort = 'new';
  const cursor = parseCursor(sort, after);
  const where = [VIS], vals = [];
  const p = v => { vals.push(v); return `$${vals.length}`; };
  if (communityId) where.push(`p.community_id = ${p(communityId)}`);
  if (tagId) where.push(`p.ai_tag_id = ${p(tagId)}`);
  if (authorId) where.push(`p.author_id = ${p(authorId)}`);
  let order;
  if (sort === 'new') { order = 'p.id DESC'; if (cursor) where.push(`p.id < ${p(cursor.id)}`); }
  else if (sort === 'top') {
    order = 'p.score DESC, p.id DESC';
    if (window !== 'all') where.push(`p.created_at > now() - interval '${WINDOWS[window]}'`);
    if (cursor) where.push(`(p.score, p.id) < (${p(cursor.score)}, ${p(cursor.id)})`);
  } else { order = 'p.hot DESC, p.id DESC'; if (cursor) where.push(`(p.hot, p.id) < (${p(cursor.hot)}::float8, ${p(cursor.id)})`); }
  const sql = `SELECT ${POST_COLS} ${POST_FROM} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${PAGE + 1}`;
  const run = async () => (await qr(sql, vals)).rows;
  // Shared cache for ranked feeds: hot 10 s; windowed top 60 s (its uncached worst case is the slowest
  // feed query, ~65 ms on 1M posts). Personal state (votes) is never cached.
  const ttl = sort === 'top' && window !== 'all' ? 60 : 10;
  const rows = (authorId || sort === 'new') ? await run()
    : await cached(`feed:${sort}:${window}:${communityId || 0}:${tagId || 0}:${cursor ? makeCursor(sort, cursor) : ''}`, ttl, run);
  return pageOf(rows, sort);
}

/** Trim the fetched rows (we ask for PAGE+1) to one page and compute the next cursor. */
function pageOf(rows, sort) {
  const posts = rows.slice(0, PAGE);
  return { posts, next: rows.length > PAGE ? makeCursor(sort, posts[posts.length - 1]) : null };
}

// Newest post id and when we last looked (see maxPostId).
let maxIdCache = { at: 0, v: 0 };
/** Newest post id (cached 30 s); search uses it to bound its first phase. */
async function maxPostId() {
  if (Date.now() - maxIdCache.at > 30_000) maxIdCache = { at: Date.now(), v: (await qr('SELECT coalesce(max(id), 0) AS m FROM posts')).rows[0].m };
  return maxIdCache.v;
}

/**
 * Full-text search, newest first, in two bounded phases so neither common nor rare words can force a
 * full-table walk: (A) check only the newest 20k posts — enough to fill a page for any common word;
 * (B) if that found less than a page, the word is rare, so the GIN index finds older matches directly.
 */
// How many of the newest posts search phase A scans before falling back to the full-text index.
const RECENT = 20_000;
/** Two-phase full-text search, newest first: scan the newest 20k posts, then fall back to the GIN index for rare words. */
async function searchFeed(text, after) {
  const cursor = parseCursor('new', after);
  const floor = (await maxPostId()) - RECENT;
  const base = `SELECT ${POST_COLS} ${POST_FROM} WHERE ${VIS} AND p.search @@ websearch_to_tsquery('english', $1)`;
  const rows = [];
  if (!cursor || cursor.id > floor + 1) {
    const vals = [text, floor];
    if (cursor) vals.push(cursor.id);
    rows.push(...(await qr(`${base} AND p.id > $2${cursor ? ' AND p.id < $3' : ''} ORDER BY p.id DESC LIMIT ${PAGE + 1}`, vals)).rows);
  }
  if (rows.length <= PAGE) {
    const upper = cursor ? Math.min(floor + 1, cursor.id) : floor + 1;
    // "ORDER BY p.id + 0" keeps the planner from walking the id index row by row; it uses GIN instead.
    rows.push(...(await qr(`${base} AND p.id < $2 ORDER BY p.id + 0 DESC LIMIT ${PAGE + 1 - rows.length}`, [text, upper])).rows);
  }
  return pageOf(rows, 'new');
}

/** Map of the logged-in user's votes for the given ids ({id -> 1 or -1}); empty for visitors. */
async function myVotes(user, table, col, ids) {
  const m = new Map();
  if (!user || !ids.length) return m;
  const { rows } = await q(`SELECT ${col} AS id, value FROM ${table} WHERE user_id = $1 AND ${col} = ANY($2::bigint[])`, [user.id, ids]);
  for (const r of rows) m.set(Number(r.id), r.value);
  return m;
}
/** myVotes() for a list of posts. */
const postVotes = (user, posts) => myVotes(user, 'post_votes', 'post_id', posts.map(p => p.id));

/** Build a '?a=1&b=2' query string, skipping empty values. */
function qs(params) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) s.set(k, v);
  const out = s.toString();
  return out ? `?${out}` : '';
}

// ---------- Home ----------
/** Shared by the home page and the model landing pages: the sorted, paginated feed with the hero block above it. */
async function feedPage(req, res, tag) {
  const sort = parseSort(req.query.get('sort')), window = parseWindow(req.query.get('t'));
  const { posts, next } = await loadFeed({ tagId: tag?.id, sort, window, after: req.query.get('after') });
  const votes = await postVotes(req.user, posts);
  const base = tag ? `/m/${tag.slug}` : '/';
  const back = `${base}${qs({ sort: sort !== 'hot' && sort, t: sort === 'top' && window })}`;
  const nextUrl = next && `${base}${qs({ sort, t: sort === 'top' && window, after: next })}`;
  const list = V.postList(posts, votes, req.user, { back, nextUrl });
  const tabs = V.sortTabs(base, sort, window);
  const sidebar = V.sidebar({ tags: await tags(), activeTag: tag?.slug, user: req.user });
  if (!tag) return page(req, res, { fullTitle: t('seo.home_title'), desc: t('seo.description'), jsonld: ldHome(), content: [V.hero(t('home.heading'), t('home.intro')), tabs, list], sidebar });
  const title = tag.seo_title || `${tag.name} prompts, tips & discussion`;
  const desc = tag.seo_desc || tag.description || t('seo.description');
  return page(req, res, { title, desc, canonical: base, content: [V.hero(`${tag.name} prompts`, tag.description), tabs, list], sidebar,
    jsonld: [ldCollection(title, desc, base), ldBreadcrumbs([['Home', '/'], [tag.name, base]])] });
}

/** GET / — the front page feed. The old ?tag= form is redirected (permanently) to the model's own page. */
async function home(req, res) {
  const tag = await tagBySlug(req.query.get('tag') || '');
  if (tag) { const p = new URLSearchParams(req.query); p.delete('tag'); return redirect(res, `/m/${tag.slug}${p.toString() ? `?${p}` : ''}`, 301); }
  return feedPage(req, res, null);
}
/** GET /m/:slug — landing page for one AI model (its own title, description and feed). */
async function modelPage(req, res, [slug]) {
  const tag = await tagBySlug(slug);
  if (!tag) throw new HttpError(404, t('err.404'));
  return feedPage(req, res, tag);
}

// ---------- Communities ----------
/** Look up a live (not removed) community by name, case-insensitively, with its AI tag. */
async function getCommunity(name) {
  if (!COMMUNITY_RE.test(name)) return null;
  return one(`SELECT c.id, c.name, c.title, c.description, c.post_count, c.created_at, c.ai_tag_id,
    t.slug AS tag_slug, t.name AS tag_name FROM communities c JOIN ai_tags t ON t.id = c.ai_tag_id
    WHERE lower(c.name) = lower($1) AND c.removed_at IS NULL`, [name]);
}

/** GET /c/:name — a community's feed. */
async function communityPage(req, res, [name]) {
  const c = await getCommunity(name);
  if (!c) throw new HttpError(404, 'That community doesn’t exist.');
  const sort = parseSort(req.query.get('sort')), window = parseWindow(req.query.get('t'));
  const { posts, next } = await loadFeed({ communityId: c.id, sort, window, after: req.query.get('after') });
  const votes = await postVotes(req.user, posts);
  const base = `/c/${c.name}`;
  return page(req, res, {
    title: `c/${c.name} — ${c.title}`, desc: (c.description || `${c.title} — ${c.tag_name} prompts and discussion.`).slice(0, 300),
    jsonld: [ldCollection(`c/${c.name} — ${c.title}`, c.description || c.title, base), ldBreadcrumbs([['Home', '/'], [c.tag_name, `/m/${c.tag_slug}`], [`c/${c.name}`, base]])],
    content: [V.communityHeader(c), req.user ? V.reportForm(req.user, 'm', c.id) : '', V.sortTabs(base, sort, window),
      V.postList(posts, votes, req.user, { back: base, showCommunity: false, nextUrl: next && `${base}${qs({ sort, t: sort === 'top' && window, after: next })}` })],
    sidebar: V.sidebar({ tags: await tags(), user: req.user, community: c }),
  });
}

/** GET /communities — browse communities (popular/new, per AI model). */
async function communitiesList(req, res) {
  const sort = req.query.get('sort') === 'new' ? 'new' : 'popular';
  const tag = await tagBySlug(req.query.get('tag') || '');
  const after = req.query.get('after') || '';
  const where = ['c.removed_at IS NULL'], vals = [];
  const p = v => { vals.push(v); return `$${vals.length}`; };
  if (tag) where.push(`c.ai_tag_id = ${p(tag.id)}`);
  let m;
  if (sort === 'new') { if ((m = after.match(/^n(\d{1,15})$/))) where.push(`c.id < ${p(Number(m[1]))}`); }
  else if ((m = after.match(/^p(\d{1,10})_(\d{1,15})$/))) where.push(`(c.post_count, c.id) < (${p(Number(m[1]))}, ${p(Number(m[2]))})`);
  const order = sort === 'new' ? 'c.id DESC' : 'c.post_count DESC, c.id DESC';
  const { rows } = await qr(`SELECT c.id, c.name, c.title, c.description, c.post_count, t.slug AS tag_slug, t.name AS tag_name
    FROM communities c JOIN ai_tags t ON t.id = c.ai_tag_id WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${PAGE + 1}`, vals);
  const list = rows.slice(0, PAGE), last = list[list.length - 1];
  const next = rows.length > PAGE ? (sort === 'new' ? `n${last.id}` : `p${last.post_count}_${last.id}`) : null;
  return page(req, res, {
    title: t('communities.title'), desc: `Browse communities for ChatGPT, Claude, Gemini and every other AI model.`, canonical: '/communities',
    content: V.communitiesPage({ list, tags: await tags(), tag: tag?.slug, sort, user: req.user, nextUrl: next && `/communities${qs({ sort, tag: tag?.slug, after: next })}` }),
  });
}

/** GET /communities/new — the create-community form. */
async function communityNewGet(req, res) {
  return page(req, res, { title: 'Create a community', content: V.communityForm({ user: req.user, tags: await tags() }) });
}
/** POST /communities/new — validate and create a community (3 per user per day). */
async function communityNewPost(req, res) {
  const b = req.body;
  const v = { name: str(b.name, 21).trim(), title: str(b.title, 100).trim(), description: str(b.description, 1000).trim(), tag: str(b.tag, 30) };
  const bad = (error, status = 400) => page(req, res, { status, title: 'Create a community', content: V.communityForm({ user: req.user, tags: allTags, v, error }) });
  const allTags = await tags();
  const rl = await hit(`community:${req.user.id}`, ...LIMITS.community);
  if (!rl.ok) return bad('You can create up to 3 communities per day.', 429);
  if (!COMMUNITY_RE.test(v.name)) return bad('Name must be 3–21 letters, numbers or underscores.');
  if (!v.title) return bad('Give your community a title.');
  const tag = allTags.find(t => t.slug === v.tag);
  if (!tag) return bad('Pick which AI model the community is about.');
  try {
    await q('INSERT INTO communities (name, title, description, ai_tag_id, creator_id) VALUES ($1, $2, $3, $4, $5)',
      [v.name, v.title, v.description, tag.id, req.user.id]);
  } catch (e) {
    if (e.code === '23505') return bad('A community with that name already exists.');
    throw e;
  }
  return redirect(res, `/c/${v.name}?n=community`);
}

// ---------- Posts ----------
/** GET /submit — the create-post form (optionally prefilled with ?c=community). */
async function submitGet(req, res) {
  const c = str(req.query.get('c') || '', 21);
  return page(req, res, { title: 'Create a post', content: V.submitForm({ user: req.user, community: COMMUNITY_RE.test(c) ? c : '' }) });
}
/** POST /submit — create a post (rate-limited), auto-upvote it, bump the community's post count. */
async function submitPost(req, res) {
  const b = req.body;
  const v = { community: str(b.community, 21).trim().replace(/^c\//, ''), title: str(b.title, 300).trim(), url: str(b.url, 2000).trim(), body: str(b.body, 40000).trim() };
  const bad = (error, status = 400) => page(req, res, { status, title: 'Create a post', content: V.submitForm({ user: req.user, v, error }) });
  for (const [k, lim] of [['post', LIMITS.post], ['postDay', LIMITS.postDay]]) {
    const rl = await hit(`${k}:${req.user.id}`, ...lim);
    if (!rl.ok) return bad(`You're posting too fast. Try again in ${Math.ceil(rl.retryAfter / 60)} min.`, 429);
  }
  const c = await getCommunity(v.community);
  if (!c) return bad('That community doesn’t exist. Check the name or create it first.');
  if (!v.title) return bad('A title is required.');
  let url = null;
  if (v.url && !(url = safeUrl(v.url))) return bad('Links must start with http:// or https://');
  const id = await tx(async db => {
    const { rows: [p] } = await db.query(
      `INSERT INTO posts (community_id, ai_tag_id, author_id, title, url, body, score, hot)
       VALUES ($1, $2, $3, $4, $5, $6, 1, hot_rank(1, now())) RETURNING id`,
      [c.id, c.ai_tag_id, req.user.id, v.title, url, v.body]);
    await db.query('INSERT INTO post_votes (user_id, post_id, value) VALUES ($1, $2, 1)', [req.user.id, p.id]);
    await db.query('UPDATE communities SET post_count = post_count + 1 WHERE id = $1', [c.id]);
    return p.id;
  });
  return redirect(res, `/p/${id}/${slugify(v.title)}`);
}

/** GET /p/:id — a post with its comment tree. */
async function postPage(req, res, [idStr]) {
  const id = Number(idStr);
  const post = await one(`SELECT p.id, p.title, p.url, p.body, p.score, p.comment_count, p.created_at, p.edited_at,
      p.deleted_at, coalesce(p.removed_at, c.removed_at) AS removed_at, c.name AS community, t.slug AS tag_slug, t.name AS tag_name,
      CASE WHEN u.deleted_at IS NULL THEN u.username END AS author
    ${POST_FROM} WHERE p.id = $1`, [id]);
  if (!post) throw new HttpError(404, 'That post doesn’t exist.');
  const gonePost = Boolean(post.removed_at || post.deleted_at);
  const canon = `/p/${post.id}/${slugify(post.title)}`;
  // One URL per post: /p/12 and a stale slug are redirected (permanently) to /p/12/<current-title-slug>.
  if (!gonePost && req.path !== canon) { const qsx = req.query.toString(); return redirect(res, `${canon}${qsx ? `?${qsx}` : ''}`, 301); }
  const sort = req.query.get('sort') === 'new' ? 'new' : 'best';
  // Logged-in readers use the primary so their own fresh comment is never missing due to replica lag.
  const { rows } = await (req.user ? q : qr)(`SELECT cm.id, cm.parent_id, cm.body, cm.score, cm.created_at, cm.edited_at, cm.deleted_at, cm.removed_at,
      CASE WHEN u.deleted_at IS NULL THEN u.username END AS author
    FROM comments cm LEFT JOIN users u ON u.id = cm.author_id WHERE cm.post_id = $1
    ORDER BY ${sort === 'new' ? 'cm.id DESC' : 'cm.score DESC, cm.id'} LIMIT 2000`, [id]);
  const byId = new Map(rows.map(r => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const c of byId.values()) (c.parent_id && byId.get(c.parent_id)?.children || roots).push(c);
  const prune = list => list.filter(c => { c.children = prune(c.children); return c.children.length || !(c.deleted_at || c.removed_at); });
  const comments = prune(roots);
  const [votes, cvotes] = await Promise.all([
    postVotes(req.user, [post]),
    myVotes(req.user, 'comment_votes', 'comment_id', rows.map(r => r.id)),
  ]);
  return page(req, res, {
    title: post.removed_at ? '[removed]' : post.title,
    desc: gonePost ? undefined : descOf(post.body, post.title),
    noindex: gonePost, canonical: gonePost ? undefined : canon, ogType: 'article',
    jsonld: gonePost ? undefined : [ldPost({ ...post, path: canon }), ldBreadcrumbs([['Home', '/'], [post.tag_name, `/m/${post.tag_slug}`], [`c/${post.community}`, `/c/${post.community}`], [post.title.slice(0, 80), canon]])],
    content: V.postPage({ post, comments, votes, cvotes, user: req.user, sort }),
    sidebar: V.sidebar({ tags: await tags(), user: req.user, community: await getCommunity(post.community) }),
  });
}

/** Meta description from a post body: plain text of the first ~155 characters (Markdown symbols removed), else the title. */
function descOf(body, title) {
  const plain = (body || '').replace(/```[\s\S]*?(?:```|$)/g, ' ').replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, '$1').replace(/^[ \t]*(?:#{1,6}|>|[-*+]|\d{1,9}[.)])[ \t]+/gm, '').replace(/[*_~`]+/g, '').replace(/\s+/g, ' ').trim();
  const src = plain.length >= 30 ? plain : `${title}${plain ? ` — ${plain}` : ''}`;
  return src.length > 155 ? `${src.slice(0, 152).replace(/\s+\S*$/, '')}…` : src;
}

/** POST /p/:id/edit — the author edits the body. */
async function postEdit(req, res, [idStr]) {
  const id = Number(idStr), body = str(req.body.body, 40000).trim();
  const rl = await hit(`edit:${req.user.id}`, ...LIMITS.edit);
  if (!rl.ok) throw new HttpError(429, 'Too many edits. Slow down a little.');
  const r = await q(`UPDATE posts SET body = $3, edited_at = now() WHERE id = $1 AND author_id = $2
    AND deleted_at IS NULL AND removed_at IS NULL RETURNING id`, [id, req.user.id, body]);
  if (!r.rowCount) throw new HttpError(403, 'You can only edit your own posts.');
  return redirect(res, `/p/${id}?n=edited`);
}

/** POST /p/:id/delete — the author deletes their post (content erased, the row stays for the thread). */
async function postDelete(req, res, [idStr]) {
  const id = Number(idStr);
  const ok = await tx(async db => {
    const r = await db.query(`UPDATE posts SET title = '[deleted]', body = '', url = NULL, deleted_at = now()
      WHERE id = $1 AND author_id = $2 AND deleted_at IS NULL RETURNING community_id, removed_at`, [id, req.user.id]);
    if (!r.rowCount) return false;
    if (!r.rows[0].removed_at) await db.query('UPDATE communities SET post_count = greatest(post_count - 1, 0) WHERE id = $1', [r.rows[0].community_id]);
    return true;
  });
  if (!ok) throw new HttpError(403, 'You can only delete your own posts.');
  return redirect(res, `/p/${id}?n=deleted`);
}

// ---------- Comments ----------
/** POST /p/:id/comment — add a comment or reply (rate-limited), auto-upvote it, bump the post's comment count. */
async function commentCreate(req, res, [idStr]) {
  const postId = Number(idStr), body = str(req.body.body, 10000).trim(), parentId = intId(req.body.parent);
  for (const [k, lim] of [['comment', LIMITS.comment], ['commentDay', LIMITS.commentDay]]) {
    const rl = await hit(`${k}:${req.user.id}`, ...lim);
    if (!rl.ok) throw new HttpError(429, `You're commenting too fast. Try again in ${rl.retryAfter} s.`);
  }
  if (!body) throw new HttpError(400, 'A comment can’t be empty.');
  const id = await tx(async db => {
    const post = (await db.query(`SELECT id FROM posts WHERE id = $1 AND deleted_at IS NULL AND removed_at IS NULL FOR NO KEY UPDATE`, [postId])).rows[0];
    if (!post) throw new HttpError(404, 'That post is gone.');
    let depth = 0;
    if (parentId) {
      const parent = (await db.query(`SELECT depth FROM comments WHERE id = $1 AND post_id = $2 AND deleted_at IS NULL AND removed_at IS NULL`, [parentId, postId])).rows[0];
      if (!parent) throw new HttpError(404, 'The comment you replied to is gone.');
      depth = Math.min(parent.depth + 1, 50);
    }
    const { rows: [c] } = await db.query(
      'INSERT INTO comments (post_id, parent_id, author_id, depth, body) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [postId, parentId, req.user.id, depth, body]);
    await db.query('INSERT INTO comment_votes (user_id, comment_id, value) VALUES ($1, $2, 1)', [req.user.id, c.id]);
    await db.query('UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1', [postId]);
    return c.id;
  });
  return redirect(res, `/p/${postId}#c${id}`);
}

/** POST /comment/:id/edit — the author edits a comment. */
async function commentEdit(req, res, [idStr]) {
  const id = Number(idStr), body = str(req.body.body, 10000).trim();
  if (!body) throw new HttpError(400, 'A comment can’t be empty.');
  const rl = await hit(`edit:${req.user.id}`, ...LIMITS.edit);
  if (!rl.ok) throw new HttpError(429, 'Too many edits. Slow down a little.');
  const r = await q(`UPDATE comments SET body = $3, edited_at = now() WHERE id = $1 AND author_id = $2
    AND deleted_at IS NULL AND removed_at IS NULL RETURNING post_id`, [id, req.user.id, body]);
  if (!r.rowCount) throw new HttpError(403, 'You can only edit your own comments.');
  return redirect(res, `/p/${r.rows[0].post_id}#c${id}`);
}

/** POST /comment/:id/delete — the author deletes a comment. */
async function commentDelete(req, res, [idStr]) {
  const id = Number(idStr);
  const r = await q(`UPDATE comments SET body = '[deleted]', deleted_at = now() WHERE id = $1 AND author_id = $2
    AND deleted_at IS NULL RETURNING post_id`, [id, req.user.id]);
  if (!r.rowCount) throw new HttpError(403, 'You can only delete your own comments.');
  return redirect(res, `/p/${r.rows[0].post_id}?n=deleted`);
}

// ---------- Votes ----------
// Per-target SQL for voting: table, votes table, key column and the score-update statement (p = post, c = comment).
const VOTE_T = {
  p: { t: 'posts', v: 'post_votes', k: 'post_id', upd: 'UPDATE posts SET score = score + $2, hot = hot_rank(score + $2, created_at) WHERE id = $1 RETURNING score' },
  c: { t: 'comments', v: 'comment_votes', k: 'comment_id', upd: 'UPDATE comments SET score = score + $2 WHERE id = $1 RETURNING score' },
};
/** POST /vote — set, change or clear a vote on a post or comment. The target row is locked so the score can't drift under concurrent votes. */
async function vote(req, res) {
  const b = req.body, T = VOTE_T[b.type], id = intId(b.id), dir = { '1': 1, '-1': -1, '0': 0 }[b.dir];
  if (!T || !id || dir === undefined) throw new HttpError(400, 'Bad vote.');
  const rl = await hit(`vote:${req.user.id}`, ...LIMITS.vote);
  if (!rl.ok) throw new HttpError(429, 'You’re voting too fast.');
  const result = await tx(async db => {
    // Lock the target row: serialises concurrent votes on it, so score can never drift.
    const row = (await db.query(`SELECT score FROM ${T.t} WHERE id = $1 AND deleted_at IS NULL AND removed_at IS NULL FOR NO KEY UPDATE`, [id])).rows[0];
    if (!row) throw new HttpError(404, 'That’s gone.');
    const prev = (await db.query(`SELECT value FROM ${T.v} WHERE user_id = $1 AND ${T.k} = $2`, [req.user.id, id])).rows[0]?.value || 0;
    if (prev === dir) return { score: row.score, vote: dir };
    if (dir === 0) await db.query(`DELETE FROM ${T.v} WHERE user_id = $1 AND ${T.k} = $2`, [req.user.id, id]);
    else await db.query(`INSERT INTO ${T.v} (user_id, ${T.k}, value) VALUES ($1, $2, $3)
      ON CONFLICT (user_id, ${T.k}) DO UPDATE SET value = EXCLUDED.value`, [req.user.id, id, dir]);
    const { rows: [u] } = await db.query(T.upd, [id, dir - prev]);
    return { score: u.score, vote: dir };
  });
  if (req.headers['x-requested-with'] === 'fetch') return json(req, res, 200, result);
  return redirect(res, safeBack(b.back, '/'));
}

// ---------- Reports ----------
/** POST /report — a user reports a post, comment or community for the admin queue. */
async function report(req, res) {
  const b = req.body, id = intId(b.id), reason = str(b.reason, 500).trim();
  const col = { p: 'post_id', c: 'comment_id', m: 'community_id' }[b.type];
  if (!col || !id || !reason) throw new HttpError(400, 'Say briefly what is wrong.');
  const rl = await hit(`report:${req.user.id}`, ...LIMITS.report);
  if (!rl.ok) throw new HttpError(429, 'Too many reports. Try again later.');
  const target = { p: 'posts', c: 'comments', m: 'communities' }[b.type];
  if (!(await one(`SELECT 1 FROM ${target} WHERE id = $1`, [id]))) throw new HttpError(404, 'That’s gone.');
  await q(`INSERT INTO reports (reporter_id, ${col}, reason) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [req.user.id, id, reason]);
  let back = '/';
  try { back = safeBack(new URL(req.headers.referer || '/', 'http://x').pathname, '/'); } catch {}
  return redirect(res, `${back}?n=reported`);
}

// ---------- Profiles & search ----------
/** GET /u/:name — a user's public profile with their posts or comments. */
async function profile(req, res, [name]) {
  const prof = await one('SELECT id, username, created_at, banned_at FROM users WHERE lower(username) = lower($1) AND deleted_at IS NULL AND verified_at IS NOT NULL', [name]);
  if (!prof) throw new HttpError(404, 'No such user.');
  const tab = req.query.get('tab') === 'comments' ? 'comments' : 'posts';
  const base = `/u/${prof.username}`;
  if (tab === 'comments') {
    const m = (req.query.get('after') || '').match(/^n(\d{1,15})$/);
    const vals = [prof.id];
    if (m) vals.push(Number(m[1]));
    const { rows } = await qr(`SELECT cm.id, cm.post_id, cm.body, cm.score, cm.created_at, p.title AS post_title
      FROM comments cm JOIN posts p ON p.id = cm.post_id
      WHERE cm.author_id = $1 AND cm.deleted_at IS NULL AND cm.removed_at IS NULL AND p.removed_at IS NULL
      ${m ? 'AND cm.id < $2' : ''} ORDER BY cm.id DESC LIMIT ${PAGE + 1}`, vals);
    const items = rows.slice(0, PAGE);
    const nextUrl = rows.length > PAGE ? `${base}?tab=comments&after=n${items[items.length - 1].id}` : null;
    return page(req, res, { title: `u/${prof.username}`, noindex: true, content: V.profilePage({ profile: prof, tab, items, votes: new Map(), user: req.user, nextUrl }) });
  }
  const { posts, next } = await loadFeed({ authorId: prof.id, after: req.query.get('after') });
  return page(req, res, {
    title: `u/${prof.username}`, noindex: true,
    content: V.profilePage({ profile: prof, tab, items: posts, votes: await postVotes(req.user, posts), user: req.user, nextUrl: next && `${base}?after=${next}` }),
  });
}

/** GET /search — rate-limited full-text search. */
async function search(req, res) {
  const qtext = (req.query.get('q') || '').trim().slice(0, 200);
  let posts = [], next = null;
  if (qtext.length >= 2) {
    const rl = await hit(`search:${ipKey(req.ip)}`, ...LIMITS.search);
    if (!rl.ok) throw new HttpError(429, 'Too many searches. Wait a moment.');
    ({ posts, next } = await loadFeed({ search: qtext, after: req.query.get('after') }));
  }
  return page(req, res, {
    title: qtext ? `Search: ${qtext}` : t('search.title'), q: qtext, noindex: true,
    content: V.searchPage({ q: qtext, posts, votes: await postVotes(req.user, posts), user: req.user, nextUrl: next && `/search?q=${encodeURIComponent(qtext)}&after=${next}` }),
  });
}

/** GET /<slug> — a free-form page edited in the dashboard (Privacy, Terms, About …). Registered last so built-in routes win. */
async function cmsPage(req, res, [slug]) {
  const p = pageBySlug(slug);
  if (!p) throw new HttpError(404, t('err.404'));
  const desc = p.meta_description || t('seo.description');
  return page(req, res, { title: p.title, desc, noindex: p.noindex, canonical: p.noindex ? undefined : `/${slug}`, content: V.cmsPage(p), jsonld: ldWebPage(p.title, desc, `/${slug}`) });
}

export const forumRoutes = [
  ['GET', /^\/$/, home],
  ['GET', /^\/m\/([a-z0-9-]{1,30})$/, modelPage],
  ['GET', /^\/c\/([A-Za-z0-9_]{3,21})$/, communityPage],
  ['GET', /^\/communities$/, communitiesList],
  ['GET', /^\/communities\/new$/, communityNewGet, { auth: 'user' }],
  ['POST', /^\/communities\/new$/, communityNewPost, { form: 'user', auth: 'user' }],
  ['GET', /^\/submit$/, submitGet, { auth: 'user' }],
  ['POST', /^\/submit$/, submitPost, { form: 'user', auth: 'user', bodyLimit: 200_000 }],
  ['GET', /^\/p\/(\d{1,15})(?:\/[A-Za-z0-9_-]{0,80})?$/, postPage],
  ['POST', /^\/p\/(\d{1,15})\/edit$/, postEdit, { form: 'user', auth: 'user', bodyLimit: 200_000 }],
  ['POST', /^\/p\/(\d{1,15})\/delete$/, postDelete, { form: 'user', auth: 'user' }],
  ['POST', /^\/p\/(\d{1,15})\/comment$/, commentCreate, { form: 'user', auth: 'user', bodyLimit: 60_000 }],
  ['POST', /^\/comment\/(\d{1,15})\/edit$/, commentEdit, { form: 'user', auth: 'user', bodyLimit: 60_000 }],
  ['POST', /^\/comment\/(\d{1,15})\/delete$/, commentDelete, { form: 'user', auth: 'user' }],
  ['POST', /^\/vote$/, vote, { form: 'user', auth: 'user' }],
  ['POST', /^\/report$/, report, { form: 'user', auth: 'user' }],
  ['GET', /^\/u\/([A-Za-z0-9_-]{3,20})$/, profile],
  ['GET', /^\/search$/, search],
];
/** Routes that must come after every other route (they match any single-segment path). */
export const cmsRoutes = [
  ['GET', /^\/([a-z0-9][a-z0-9-]{0,58}[a-z0-9])$/, cmsPage],
];
