// admin/crud.js — one generic Create / Read / Update / Delete engine for every whitelisted database table.
//
// SECURITY: table names, column names and SQL fragments come ONLY from the TABLES registry below (code).
// Request data is limited to (a) which registry entry to use, validated against the registry, and
// (b) values, always sent as bound parameters. Sensitive columns (password hashes, email fingerprints,
// token hashes, the admin account, the email outbox) are not in the registry, so they can never be read or written here.
import { q, one, tx } from '../db.js';
import { kv } from '../kv.js';
import { html, raw, esc, safeUrl } from '../html.js';
import { wys } from '../wys.js';
import { redirect, str, HttpError } from '../http.js';
import { logEvent } from '../metrics.js';
import { destroyAllSessions } from '../session.js';
import { refreshSite, TEXTS } from '../site.js';
import { clearMicro } from '../http.js';
import { resetTagCache } from '../routes/forum.js';
import { clearSeoCache } from '../seo.js';
import { refreshLevels } from '../points.js';
import { recordAction } from '../actions.js';
import { bulkBar, selectColumn, bulkFlash, statusCell, publishBar } from './bulk.js';
import { adminPage, csrf, table as htmlTable, card, nf, when, P } from './ui.js';

/** Make every cache forget what it knows, so an edit shows up on the site immediately. */
export async function invalidate() {
  clearMicro(); resetTagCache(); clearSeoCache();
  try { const keys = await kv.keys('feed:*'); if (keys.length) await kv.del(keys); } catch { /* cache only */ }
  await refreshSite().catch(() => {});
  await refreshLevels().catch(() => {});
}

const RESERVED_SLUGS = new Set(['login', 'signup', 'logout', 'forgot', 'reset', 'verify', 'resend', 'settings', 'search', 'submit', 'communities',
  'c', 'p', 'u', 'm', 's', 'vote', 'report', 'comment', 'robots-txt', 'sitemap-xml', 'healthz', 'favicon-ico', 'admin']);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/;

let officialId;
const official = async () => (officialId ??= (await one(`SELECT id FROM users WHERE username = 'prompts360'`))?.id ?? null);

// ---------- Column helpers ----------
const text = (n, label, o = {}) => ({ n, label, t: 'text', max: 200, ...o });
const area = (n, label, o = {}) => ({ n, label, t: 'area', rows: 6, max: 10000, ...o });
const int = (n, label, o = {}) => ({ n, label, t: 'int', ...o });
const bool = (n, label, o = {}) => ({ n, label, t: 'bool', ...o });
const ts = (n, label, o = {}) => ({ n, label, t: 'ts', ...o });
const ro = (n, label, t = 'text') => ({ n, label, t: 'ro', rt: t });
const sel = (n, label, opts, o = {}) => ({ n, label, t: 'sel', opts, ...o });

const tagOptions = async () => (await q('SELECT id, name FROM ai_tags ORDER BY sort, name')).rows.map(r => [String(r.id), r.name]);
const communityOptions = async () => (await q('SELECT id, name FROM communities ORDER BY lower(name) LIMIT 2000')).rows.map(r => [String(r.id), `c/${r.name}`]);

const recountPosts = (db, ids) => db.query(`UPDATE communities c SET post_count = (SELECT count(*) FROM posts p WHERE p.community_id = c.id AND p.deleted_at IS NULL AND p.removed_at IS NULL AND p.published) WHERE c.id = ANY($1::bigint[])`, [ids.filter(Boolean)]);
const recountComments = (db, id) => db.query(`UPDATE posts SET comment_count = (SELECT count(*) FROM comments WHERE post_id = $1 AND deleted_at IS NULL AND removed_at IS NULL) WHERE id = $1`, [id]);

/** The registry. pk: key column(s). list: columns in the list view. search: text columns for ?q=. ro: no create/update/delete flags. */
export const TABLES = {
  pages: {
    label: 'Pages', pk: ['id'], list: ['id', 'slug', 'title', 'published', 'updated_at'], search: ['slug', 'title', 'body'], order: 'id', view: r => `/${r.slug}`,
    cols: [text('slug', 'URL slug (a-z, 0-9, -) — the page lives at /slug', { req: true, max: 60, pattern: SLUG_RE }), text('title', 'Title (H1 and <title>)', { req: true, max: 120 }),
      area('body', 'Body', { rows: 22, max: 100000, md: true, hl: 2, ho: 0 }),
      area('meta_description', 'Meta description (shown in search results, ~150 characters)', { rows: 2, max: 300 }),
      bool('published', 'Published', { def: true }), bool('noindex', 'Hide from search engines (noindex)'), ro('created_at', 'Created', 'ts'), ro('updated_at', 'Updated', 'ts')],
    before: (db, v, ctx) => { if (RESERVED_SLUGS.has(v.slug)) throw new Problem('That slug is reserved for a built-in page.'); if (ctx.op === 'update') v.updated_at = new Date().toISOString(); },
  },
  nav_links: {
    label: 'Navigation links', pk: ['id'], list: ['id', 'area', 'label', 'url', 'sort', 'enabled'], search: ['label', 'url'], order: 'area, sort, id',
    cols: [sel('area', 'Where', async () => [['header', 'Header'], ['footer', 'Footer']], { req: true }), text('label', 'Label', { req: true, max: 60 }),
      text('url', 'URL (/path or https://…)', { req: true, max: 500, check: u => (u.startsWith('/') && !u.startsWith('//') && !/[\s\\]/.test(u)) || safeUrl(u) }),
      int('sort', 'Order (small numbers first)', { def: 100 }), bool('enabled', 'Shown', { def: true })],
  },
  site_settings: {
    label: 'Text overrides', pk: ['key'], list: ['key', 'value', 'updated_at'], search: ['key', 'value'], order: 'key',
    cols: [text('key', 'Key (see the Texts page for the list)', { req: true, max: 60, pk: true, check: k => k in TEXTS }), area('value', 'Value', { rows: 4, max: 20000 }), ro('updated_at', 'Updated', 'ts')],
    before: (db, v) => { v.updated_at = new Date().toISOString(); },
  },
  ai_tags: {
    label: 'AI models', pk: ['id'], list: ['id', 'slug', 'name', 'sort', 'enabled'], search: ['slug', 'name', 'description'], order: 'sort, id', view: r => `/m/${r.slug}`,
    cols: [text('slug', 'Slug (a-z, 0-9, -) — page at /m/slug', { req: true, max: 30, pattern: /^[a-z0-9-]{1,30}$/ }), text('name', 'Name', { req: true, max: 40 }),
      area('description', 'Intro paragraph on the model page (~160 characters is ideal)', { rows: 3, max: 1000 }),
      text('seo_title', 'Page title override (optional, ≤ 60 characters is ideal)', { max: 120 }), area('seo_desc', 'Meta description override (optional)', { rows: 2, max: 300 }),
      int('sort', 'Order', { def: 100 }), bool('enabled', 'Shown in menus', { def: true })],
  },
  communities: {
    label: 'Communities', pk: ['id'], list: ['id', 'name', 'title', 'ai_tag_id', 'post_count', 'removed_at'], search: ['name', 'title', 'description'], order: 'id DESC', view: r => `/c/${r.name}`,
    filters: ['ai_tag_id'],
    cols: [text('name', 'Name (3–21 letters, digits or _) — page at /c/name', { req: true, max: 21, pattern: /^[A-Za-z0-9_]{3,21}$/ }), text('title', 'Title', { req: true, max: 100 }),
      area('description', 'Description', { rows: 6, max: 4000, md: true }), sel('ai_tag_id', 'AI model', tagOptions, { req: true }),
      int('creator_id', 'Creator user ID (blank = the site account)', { def: official }), ts('removed_at', 'Removed at (UTC; set to hide the community)'), ro('post_count', 'Posts', 'int'), ro('created_at', 'Created', 'ts')],
  },
  posts: {
    label: 'Posts', pk: ['id'], list: ['id', 'title', 'community_id', 'repost_of', 'published', 'wave', 'score', 'comment_count', 'created_at', 'removed_at'], search: ['title', 'body'], order: 'id DESC', view: r => (r.published ? `/p/${r.id}` : `${P}/posts/${r.id}/preview`),
    filters: ['community_id', 'ai_tag_id', 'author_id', 'published'],
    cols: [sel('community_id', 'Community', communityOptions, { req: true }), text('title', 'Title', { req: true, max: 300 }), text('url', 'Link (optional)', { max: 2000, check: u => !u || safeUrl(u) }),
      sel('ai_tag_id', 'AI model tag (blank = the community’s model)', tagOptions), area('body', 'Body (required, except for a repost)', { rows: 22, max: 40000, md: true, req: true, soft: true, hl: 2, ho: 0 }), ro('repost_of', 'Repost of post ID', 'int'), int('author_id', 'Author user ID (default: the site account)', { def: official }),
      bool('published', 'Published: untick to keep this post hidden from the public site (a draft) until you publish it', { def: true }), int('wave', 'Publishing wave (optional, 1–99; used by “Publish a wave” above the Posts list)'),
      text('seo_title', 'Title tag override (optional; used as is, ≤ 60 characters is ideal, no site name is added)', { max: 120 }), area('seo_desc', 'Meta description (optional; blank = the first ~155 characters of the body)', { rows: 2, max: 300 }),
      ts('created_at', 'Created (UTC; leave blank for now)'), ts('deleted_at', 'Deleted at (UTC)'), ts('removed_at', 'Removed at (UTC; set to hide the post)'),
      ro('score', 'Score', 'int'), ro('comment_count', 'Comments', 'int')],
    before: async (db, v, ctx) => {
      // One flag: published = false is a draft that no public query or route can see. The first publication dates the post now.
      v.published = Boolean(v.published);
      const firstTime = v.published && !(ctx.op === 'update' && ctx.old?.published_at);
      if (firstTime) { v.published_at = new Date().toISOString(); if (ctx.op === 'update' && !ctx.old?.published) v.created_at = v.published_at; }
      if (ctx.op === 'insert' && !firstTime) v.published_at = null;
      const c = (await db.query('SELECT ai_tag_id FROM communities WHERE id = $1', [v.community_id])).rows[0];
      if (!c) throw new Problem('That community does not exist.');
      v.ai_tag_id ??= c.ai_tag_id;
      if (!v.body?.trim() && !(ctx.op === 'update' && ctx.old?.repost_of)) throw new Problem('Body is required.');
      if (ctx.op === 'insert') v.hot = 0;
      if (ctx.op === 'update') v.edited_at = new Date().toISOString();
      if (!v.created_at) delete v.created_at;
    },
    after: async (db, row, ctx) => {
      await db.query('UPDATE posts SET hot = hot_rank(score, created_at) WHERE id = $1', [row.id]);
      await recountPosts(db, [row.community_id, ctx.old?.community_id]);
      if (ctx.op === 'update' && ctx.old.published !== row.published) await recordAction(db, { kind: row.published ? 'post.publish' : 'post.unpublish', targetType: 'post', targetId: row.id, meta: { by: 'admin' } });
    },
    afterDelete: (db, row) => recountPosts(db, [row.community_id]),
  },
  notifications: {
    label: 'Notifications', pk: ['id'], list: ['id', 'user_id', 'kind', 'actor_id', 'post_id', 'created_at', 'read_at'], order: 'id DESC', noCreate: true, noEdit: true, cols: [], filters: ['user_id', 'kind'],
  },
  comments: {
    label: 'Comments', pk: ['id'], list: ['id', 'post_id', 'author_id', 'body', 'score', 'created_at', 'removed_at'], search: ['body'], order: 'id DESC', filters: ['post_id', 'author_id'],
    view: r => `/p/${r.post_id}#c${r.id}`,
    cols: [int('post_id', 'Post ID', { req: true }), int('parent_id', 'Reply to comment ID (blank = top level)'), int('author_id', 'Author user ID', { def: official }),
      area('body', 'Body', { rows: 8, req: true, max: 10000, md: true }), ts('created_at', 'Created (UTC; blank = now)'), ts('deleted_at', 'Deleted at (UTC)'), ts('removed_at', 'Removed at (UTC)'), ro('score', 'Score', 'int')],
    before: async (db, v, ctx) => {
      if (!(await db.query('SELECT 1 FROM posts WHERE id = $1', [v.post_id])).rowCount) throw new Problem('That post does not exist.');
      v.depth = 0;
      if (v.parent_id) {
        const p = (await db.query('SELECT depth FROM comments WHERE id = $1 AND post_id = $2', [v.parent_id, v.post_id])).rows[0];
        if (!p) throw new Problem('The parent comment is not on that post.');
        v.depth = Math.min(p.depth + 1, 50);
      }
      if (ctx.op === 'update') v.edited_at = new Date().toISOString();
      if (!v.created_at) delete v.created_at;
    },
    after: async (db, row, ctx) => {
      await recountComments(db, row.post_id);
    },
    afterDelete: (db, row) => recountComments(db, row.post_id),
  },
  users: {
    label: 'Users', pk: ['id'], list: ['id', 'username', 'points', 'verified_at', 'banned_at', 'deleted_at', 'created_at'], search: ['username'], order: 'id DESC', noCreate: true, view: r => `/u/${r.username}`,
    cols: [text('username', 'Username', { req: true, max: 20, pattern: /^[A-Za-z0-9_-]{3,20}$/ }), ts('verified_at', 'Email verified at (UTC)'), ts('banned_at', 'Banned at (UTC; set to ban and sign out everywhere)'),
      ts('deleted_at', 'Deleted at (UTC)'), ro('points', 'Points (derived from activity, read-only)', 'int'), ro('created_at', 'Joined', 'ts')],
    after: async (db, row) => { if (row.banned_at || row.deleted_at) await destroyAllSessions(row.id); },
    protect: async row => { if (row.username === 'prompts360') throw new Problem('The site account cannot be changed or deleted.'); },
    afterDelete: async (db, row) => { await destroyAllSessions(row.id); },
  },
  levels: {
    label: 'Levels', pk: ['id'], list: ['id', 'name', 'min_points'], order: 'min_points', search: ['name'],
    cols: [text('name', 'Level name (shown next to usernames, on profiles and in the account menu)', { req: true, max: 30 }), int('min_points', 'Points needed to unlock this level', { req: true })],
    before: (db, v, ctx) => {
      if (v.min_points < 0 || v.min_points > 10_000_000) throw new Problem('Points must be between 0 and 10,000,000.');
      if (ctx.op === 'update' && ctx.old.min_points === 0 && v.min_points !== 0) throw new Problem('The first level must stay at 0 points so every user has a level. Rename it instead, or add another level above it.');
    },
    protectDelete: async row => { if (row.min_points === 0) throw new Problem('The 0-point level cannot be deleted (every user needs a level). You can rename it.'); },
  },
  points_settings: {
    label: 'Points settings', pk: ['id'], list: ['id', 'community_min'], order: 'id', noCreate: true, noDelete: true,
    cols: [int('community_min', 'Points needed to create a community', { req: true })],
    before: (db, v) => { if (v.community_min < 0 || v.community_min > 10_000_000) throw new Problem('Points must be between 0 and 10,000,000.'); },
  },
  reports: {
    label: 'Reports', pk: ['id'], list: ['id', 'reason', 'post_id', 'comment_id', 'community_id', 'created_at', 'resolved_at'], search: ['reason'], order: 'id DESC', noCreate: true,
    cols: [ro('reason', 'Reason'), ts('resolved_at', 'Resolved at (UTC; set to close the report)')],
  },
  post_votes: { label: 'Post votes', pk: ['user_id', 'post_id'], list: ['user_id', 'post_id', 'value'], order: 'post_id DESC, user_id', noCreate: true, noEdit: true, cols: [],
    afterDelete: async (db, row) => { await db.query('UPDATE posts SET net = coalesce((SELECT sum(value) FROM post_votes WHERE post_id = $1), 0)::int WHERE id = $1', [row.post_id]); await db.query('UPDATE posts SET score = greatest(net, 0), hot = hot_rank(greatest(net, 0), created_at) WHERE id = $1', [row.post_id]); } },
  comment_votes: { label: 'Comment votes', pk: ['user_id', 'comment_id'], list: ['user_id', 'comment_id', 'value'], order: 'comment_id DESC, user_id', noCreate: true, noEdit: true, cols: [],
    afterDelete: async (db, row) => { await db.query('UPDATE comments SET net = coalesce((SELECT sum(value) FROM comment_votes WHERE comment_id = $1), 0)::int WHERE id = $1', [row.comment_id]); await db.query('UPDATE comments SET score = greatest(net, 0) WHERE id = $1', [row.comment_id]); } },
  action_events: { label: 'Action log', pk: ['id'], list: ['id', 'ts', 'kind', 'actor_id', 'target_type', 'target_id'], search: ['kind'], order: 'id DESC', noCreate: true, noEdit: true, cols: [], filters: ['kind', 'actor_id', 'target_type', 'target_id'] },
  event_log: { label: 'Event log', pk: ['id'], list: ['id', 'ts', 'level', 'kind', 'message'], search: ['message', 'kind'], order: 'id DESC', noCreate: true, noEdit: true, cols: [], filters: ['level', 'kind'] },
  metrics_minute: { label: 'Metrics per minute', pk: null, list: ['ts', 'requests', 'pages', 'bots', 's4xx', 's5xx', 'limited', 'ms_max', 'rss_mb', 'lag_ms', 'cpu_pct', 'db_ms'], order: 'ts DESC', readOnly: true, cols: [] },
  metrics_day: { label: 'Metrics per day', pk: null, list: ['day', 'visitors', 'pageviews', 'bot_hits'], order: 'day DESC', readOnly: true, cols: [] },
  metrics_route: { label: 'Metrics per route', pk: null, list: ['day', 'route', 'hits', 'ms_sum', 'ms_max', 'errors'], order: 'day DESC, hits DESC', readOnly: true, cols: [] },
  metrics_page: { label: 'Page views per path', pk: null, list: ['day', 'path', 'views'], order: 'day DESC, views DESC', readOnly: true, cols: [] },
  schema_migrations: { label: 'Schema migrations', pk: null, list: ['version', 'applied_at'], order: 'version', readOnly: true, cols: [] },
};
// Column types of list-only columns that are not editable (for display).
const LIST_TYPES = { id: 'int', user_id: 'int', post_id: 'int', comment_id: 'int', community_id: 'int', author_id: 'int', ai_tag_id: 'int', creator_id: 'int', score: 'int', value: 'int', sort: 'int', post_count: 'int', comment_count: 'int' };
const colOf = (T, n) => T.cols.find(c => c.n === n);
const isTs = n => /(_at|^ts)$/.test(n);
const isBool = (T, n) => colOf(T, n)?.t === 'bool';

/** A validation problem to show next to the form (not a server error). */
class Problem extends Error {}

const tableOf = name => { const T = Object.hasOwn(TABLES, name) ? TABLES[name] : null; if (!T) throw new HttpError(404, 'Page not found.'); return T; };
const url = (t, rest = '') => `${P}/t/${t}${rest}`;

// ---------- Rendering ----------
function cell(T, r, n) {
  const v = r[n];
  if (v === null || v === undefined || v === '') return '–';
  if (v instanceof Date) return when(v);
  if (typeof v === 'boolean') return v ? '✓' : '–';
  if (typeof v === 'number') return LIST_TYPES[n] ? String(v) : nf(v);
  const s = String(v);
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
}

/** SQL for the key condition: "k1 = $1 AND k2 = $2". */
const keyWhere = (T, from = 1) => T.pk.map((k, i) => `${k} = $${from + i}`).join(' AND ');
function parseId(T, idStr) {
  const parts = String(idStr).split(':');
  if (!T.pk || parts.length !== T.pk.length) throw new HttpError(404, 'Page not found.');
  return T.pk.map((k, i) => {
    const c = colOf(T, k);
    if (c?.t === 'text') { if (!/^[a-z0-9_.]{1,80}$/.test(parts[i])) throw new HttpError(404, 'Page not found.'); return parts[i]; }
    if (!/^\d{1,15}$/.test(parts[i])) throw new HttpError(404, 'Page not found.');
    return Number(parts[i]);
  });
}
const idOf = (T, r) => T.pk.map(k => r[k]).join(':');

const PAGE = 50;
/** GET /t/:table — searchable, sortable, paginated list. */
export async function list(req, res, [name]) {
  const T = tableOf(name);
  const search = str(req.query.get('q') || '', 100).trim();
  const pg = Math.max(1, Math.min(100000, Number(req.query.get('page')) || 1));
  const where = [], vals = [];
  if (search && T.search) {
    vals.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(${T.search.map(c => `${c}::text ILIKE $1`).join(' OR ')})`);
  }
  const f = req.query.get('f'), fv = str(req.query.get('v') || '', 60);
  if (f && T.filters?.includes(f) && fv) { vals.push(fv); where.push(`${f}::text = $${vals.length}`); }
  const sortCol = T.list.includes(req.query.get('sort')) ? req.query.get('sort') : null;
  const dir = req.query.get('dir') === 'asc' ? 'ASC' : 'DESC';
  const order = sortCol ? `${sortCol} ${dir}, ${T.order}` : T.order;
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sel = [...new Set([...(T.pk || []), ...T.list, ...(T.view ? ['id', 'slug', 'name', 'post_id', 'username'].filter(c => T.cols.some(x => x.n === c) || (T.pk || []).includes(c)) : [])])];
  const [{ rows }, { rows: [{ n }] }] = await Promise.all([
    q(`SELECT ${sel.join(', ')} FROM ${name} ${w} ORDER BY ${order} LIMIT ${PAGE + 1} OFFSET ${(pg - 1) * PAGE}`, vals),
    q(`SELECT count(*)::int AS n FROM ${name} ${w}`, vals),
  ]);
  const shown = rows.slice(0, PAGE);
  const qsOf = (extra = {}) => { const p = new URLSearchParams(); const m = { q: search, f, v: fv, sort: sortCol, dir: sortCol ? dir.toLowerCase() : '', ...extra }; for (const [k, v] of Object.entries(m)) if (v) p.set(k, v); const s = p.toString(); return s ? `?${s}` : ''; };
  const editable = T.pk && !T.noEdit && !T.readOnly;
  const bulk = name === 'posts';
  const cols = [...(bulk ? [selectColumn()] : []), ...T.list.map(n => ({ h: html`<a href="${url(name)}${qsOf({ sort: n, dir: sortCol === n && dir === 'DESC' ? 'asc' : 'desc', page: '' })}">${n}</a>`, f: r => (name === 'posts' && n === 'published' ? statusCell(req, r) : cell(T, r, n)) })),
    ...(T.pk && !T.readOnly ? [{ h: '', cls: 'act', f: r => html`${T.view ? html`<a href="${T.view(r)}" target="_blank" rel="noopener">view ↗</a> ` : ''}${editable ? html`<a href="${url(name, `/${idOf(T, r)}`)}">edit</a>` : html`<a href="${url(name, `/${idOf(T, r)}`)}">open</a>`}` }] : [])];
  const flash = { saved: 'Saved.', created: 'Created.', deleted: 'Deleted.' }[req.query.get('n')] || (bulk ? bulkFlash(req.query.get('bulk')) : undefined);
  const content = html`<div class="bar-tools"><form method="get" action="${url(name)}" class="inline">${f ? html`<input type="hidden" name="f" value="${f}"><input type="hidden" name="v" value="${fv}">` : ''}
${T.search ? html`<input type="search" name="q" value="${search}" placeholder="Search…" aria-label="Search ${T.label}"><button class="btn">Search</button>` : ''}</form>
${!T.noCreate && !T.readOnly && !T.noEdit ? html`<a class="btn primary" href="${url(name, '/new')}">+ New</a>` : ''}<span class="muted">${nf(n)} row${n === 1 ? '' : 's'}${f ? html` · filtered by ${f} = ${fv} · <a href="${url(name)}">clear</a>` : ''}</span></div>
${bulk ? await publishBar(req) : ''}
${bulk && n ? bulkBar(req, { total: n, filter: { q: search, f, v: fv } }) : ''}
${htmlTable(cols, shown, { empty: 'No rows.' })}
<p class="pager">${pg > 1 ? html`<a href="${url(name)}${qsOf({ page: String(pg - 1) })}">← Previous</a>` : ''}<span>Page ${pg}</span>${rows.length > PAGE ? html`<a href="${url(name)}${qsOf({ page: String(pg + 1) })}">Next →</a>` : ''}</p>`;
  return adminPage(req, res, { title: T.label, active: ['pages', 'nav_links', 'ai_tags', 'communities', 'posts', 'comments', 'users'].includes(name) ? `/t/${name}` : '/db', content, flash });
}

async function fieldHtml(c, v) {
  const id = `f_${c.n}`;
  const label = (inner) => html`<label for="${id}">${c.label}${c.req ? raw(' <abbr title="required">*</abbr>') : ''}</label>${inner}`;
  // The checkbox comes BEFORE the hidden 0: the body parser keeps the first value of a repeated name, so a ticked box (1) wins and an unticked one falls back to 0.
  if (c.t === 'bool') return html`<div class="fld chk"><input type="checkbox" id="${id}" name="${c.n}" value="1"${v ? raw(' checked') : ''}><input type="hidden" name="${c.n}" value="0"><label for="${id}">${c.label}</label></div>`;
  if (c.t === 'area' && c.md) return html`<div class="fld"><label for="${id}">${c.label}${c.req ? raw(' <abbr title="required">*</abbr>') : ''}</label>${wys({ name: c.n, id, md: v ?? '', rows: c.rows, max: c.max, required: Boolean(c.req && !c.soft), label: c.label, hlevel: c.hl ?? 3, hoff: c.ho ?? 2 })}</div>`;
  if (c.t === 'area') return html`<div class="fld">${label(html`<textarea id="${id}" name="${c.n}" rows="${c.rows}" maxlength="${c.max}">${v ?? ''}</textarea>`)}</div>`;
  if (c.t === 'sel') {
    const opts = await c.opts();
    return html`<div class="fld">${label(html`<select id="${id}" name="${c.n}"${c.req ? raw(' required') : ''}>${c.req ? '' : html`<option value="">—</option>`}${opts.map(([val, lab]) => html`<option value="${val}"${String(v ?? '') === val ? raw(' selected') : ''}>${lab}</option>`)}</select>`)}</div>`;
  }
  if (c.t === 'ts') {
    const val = v ? new Date(v).toISOString().slice(0, 16) : '';
    return html`<div class="fld">${label(html`<input type="datetime-local" id="${id}" name="${c.n}" value="${val}">`)}</div>`;
  }
  if (c.t === 'int') return html`<div class="fld">${label(html`<input type="number" id="${id}" name="${c.n}" value="${v ?? ''}" step="1"${c.req ? raw(' required') : ''}>`)}</div>`;
  return html`<div class="fld">${label(html`<input type="text" id="${id}" name="${c.n}" value="${v ?? ''}" maxlength="${c.max}"${c.req ? raw(' required') : ''}>`)}</div>`;
}

async function form(req, res, name, T, { row = {}, error, status = 200, isNew }) {
  const editable = T.cols.filter(c => c.t !== 'ro');
  const fields = [];
  for (const c of T.cols) {
    if (c.t === 'ro') { if (!isNew) fields.push(html`<div class="fld ro"><span>${c.label}</span><b>${row[c.n] instanceof Date ? when(row[c.n]) : row[c.n] ?? '–'}</b></div>`); continue; }
    if (c.pk && !isNew) { fields.push(html`<div class="fld ro"><span>${c.label}</span><b>${row[c.n]}</b></div>`); continue; }
    let v = row[c.n];
    if (v === undefined && isNew) v = typeof c.def === 'function' ? await c.def() : c.def;
    fields.push(await fieldHtml(c, v));
  }
  const key = isNew ? '' : idOf(T, row);
  const content = html`<p><a href="${url(name)}">← ${T.label}</a></p>${error ? html`<p class="error" role="alert">${error}</p>` : ''}
<form method="post" action="${url(name, isNew ? '/new' : `/${key}`)}" class="edit">${csrf(req)}${fields}
${editable.length ? html`<button class="btn primary">${isNew ? 'Create' : 'Save'}</button>` : ''}</form>
${!isNew && !T.readOnly && !T.noDelete && T.pk ? html`<details class="danger"><summary>Delete this row</summary><form method="post" action="${url(name, `/${key}/delete`)}">${csrf(req)}<p>This cannot be undone.</p><button class="btn danger">Yes, delete permanently</button></form></details>` : ''}`;
  return adminPage(req, res, { title: `${isNew ? 'New' : 'Edit'} · ${T.label}`, active: `/t/${name}`, content, status });
}

/** Read the submitted values for the table's editable columns, validating each against its definition. Throws Problem. */
async function readValues(T, b, { op }) {
  const v = {};
  for (const c of T.cols) {
    if (c.t === 'ro' || (c.pk && op === 'update')) continue;
    const raw0 = b[c.n];
    if (c.t === 'bool') { v[c.n] = raw0 === '1'; continue; }
    let s = str(raw0, c.t === 'area' ? c.max : 400).replace(/\r\n/g, '\n');
    if (c.t !== 'area') s = s.trim();
    if (c.t === 'area') s = s.trim();
    if (!s && op === 'insert' && c.t === 'int' && c.def !== undefined) { v[c.n] = typeof c.def === 'function' ? await c.def() : c.def; continue; }
    if (!s) { if (c.req && !c.soft) throw new Problem(`${c.label.split(' (')[0]} is required.`); v[c.n] = c.t === 'text' || c.t === 'area' ? '' : null; if (c.t === 'text' && c.n === 'url') v[c.n] = null; continue; }
    if (c.t === 'text' || c.t === 'area') {
      if (s.length > c.max) throw new Problem(`${c.label.split(' (')[0]} is too long (max ${c.max}).`);
      if (c.pattern && !c.pattern.test(s)) throw new Problem(`${c.label.split(' (')[0]} has an invalid format.`);
      if (c.check && !c.check(s)) throw new Problem(`${c.label.split(' (')[0]} is not valid.`);
      v[c.n] = c.check && c.n === 'url' && c.label.startsWith('Link') ? safeUrl(s) : s;
    } else if (c.t === 'int') {
      if (!/^-?\d{1,15}$/.test(s)) throw new Problem(`${c.label.split(' (')[0]} must be a whole number.`);
      v[c.n] = Number(s);
    } else if (c.t === 'ts') {
      const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
      if (Number.isNaN(d.getTime())) throw new Problem(`${c.label.split(' (')[0]} is not a valid date.`);
      v[c.n] = d.toISOString();
    } else if (c.t === 'sel') {
      const ok = (await c.opts()).some(([val]) => val === s);
      if (!ok) throw new Problem(`${c.label.split(' (')[0]}: pick one of the options.`);
      v[c.n] = /^\d+$/.test(s) ? Number(s) : s;
    }
  }
  return v;
}

const dbMessage = e => (e.code === '23505' ? 'That value already exists (it must be unique).'
  : e.code === '23503' ? 'It is linked to other data. Remove or change the linked rows first.'
  : e.code === '23514' || e.code === '22001' ? 'A value is outside its allowed range or length.'
  : e.code === '23502' ? 'A required value is missing.' : null);

/** GET /t/:table/new */
export async function newForm(req, res, [name]) {
  const T = tableOf(name);
  if (T.noCreate || T.readOnly || T.noEdit) throw new HttpError(404, 'Page not found.');
  return form(req, res, name, T, { isNew: true });
}
/** POST /t/:table/new */
export async function create(req, res, [name]) {
  const T = tableOf(name);
  if (T.noCreate || T.readOnly || T.noEdit) throw new HttpError(404, 'Page not found.');
  let v;
  try {
    v = await readValues(T, req.body, { op: 'insert' });
    const row = await tx(async db => {
      const ctx = { op: 'insert' };
      await T.before?.(db, v, ctx);
      const keys = Object.keys(v);
      const { rows: [r] } = await db.query(`INSERT INTO ${name} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, keys.map(k => v[k]));
      await T.after?.(db, r, ctx);
      return r;
    });
    logEvent('info', 'admin', `Created ${name} ${T.pk ? idOf(T, row) : ''}`);
    await invalidate();
    return redirect(res, `${url(name)}?n=created`);
  } catch (e) {
    const msg = e instanceof Problem ? e.message : dbMessage(e);
    if (!msg) throw e;
    return form(req, res, name, T, { row: { ...(v || {}), ...Object.fromEntries(T.cols.filter(c => c.t !== 'ro').map(c => [c.n, req.body[c.n]])) }, error: msg, status: 400, isNew: true });
  }
}

/** GET /t/:table/:id */
export async function editForm(req, res, [name, idStr]) {
  const T = tableOf(name);
  const ids = parseId(T, idStr);
  const row = await one(`SELECT ${[...new Set([...T.pk, ...T.cols.map(c => c.n), ...(T.list || [])])].join(', ')} FROM ${name} WHERE ${keyWhere(T)}`, ids);
  if (!row) throw new HttpError(404, 'Page not found.');
  if (T.noEdit || !T.cols.length) {
    const content = html`<p><a href="${url(name)}">← ${T.label}</a></p><div class="card">${Object.entries(row).map(([k, v]) => html`<div class="fld ro"><span>${k}</span><b>${v instanceof Date ? when(v) : String(v ?? '–')}</b></div>`)}</div>
${!T.readOnly ? html`<details class="danger"><summary>Delete this row</summary><form method="post" action="${url(name, `/${idStr}/delete`)}">${csrf(req)}<p>This cannot be undone.</p><button class="btn danger">Yes, delete permanently</button></form></details>` : ''}`;
    return adminPage(req, res, { title: T.label, active: '/db', content });
  }
  return form(req, res, name, T, { row });
}
/** POST /t/:table/:id */
export async function update(req, res, [name, idStr]) {
  const T = tableOf(name);
  if (T.noEdit || T.readOnly) throw new HttpError(404, 'Page not found.');
  const ids = parseId(T, idStr);
  let v;
  try {
    v = await readValues(T, req.body, { op: 'update' });
    await tx(async db => {
      const old = (await db.query(`SELECT * FROM ${name} WHERE ${keyWhere(T)} FOR UPDATE`, ids)).rows[0];
      if (!old) throw new HttpError(404, 'Page not found.');
      await T.protect?.(old);
      const ctx = { op: 'update', old };
      await T.before?.(db, v, ctx);
      const keys = Object.keys(v);
      const { rows: [r] } = await db.query(`UPDATE ${name} SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE ${keyWhere(T, keys.length + 1)} RETURNING *`, [...keys.map(k => v[k]), ...ids]);
      await T.after?.(db, r, ctx);
    });
    logEvent('info', 'admin', `Updated ${name} ${idStr}`);
    await invalidate();
    return redirect(res, `${url(name)}?n=saved`);
  } catch (e) {
    const msg = e instanceof Problem ? e.message : dbMessage(e);
    if (!msg) throw e;
    const row = { ...Object.fromEntries(T.pk.map((k, i) => [k, ids[i]])), ...Object.fromEntries(T.cols.filter(c => c.t !== 'ro').map(c => [c.n, req.body[c.n]])) };
    return form(req, res, name, T, { row, error: msg, status: 400 });
  }
}
/** POST /t/:table/:id/delete */
export async function remove(req, res, [name, idStr]) {
  const T = tableOf(name);
  if (T.readOnly || T.noDelete || !T.pk) throw new HttpError(404, 'Page not found.');
  const ids = parseId(T, idStr);
  try {
    await tx(async db => {
      const old = (await db.query(`SELECT * FROM ${name} WHERE ${keyWhere(T)} FOR UPDATE`, ids)).rows[0];
      if (!old) throw new HttpError(404, 'Page not found.');
      await T.protect?.(old);
      await T.protectDelete?.(old);
      await db.query(`DELETE FROM ${name} WHERE ${keyWhere(T)}`, ids);
      await T.afterDelete?.(db, old);
    });
  } catch (e) {
    const msg = e instanceof Problem ? e.message : dbMessage(e);
    if (!msg) throw e;
    return adminPage(req, res, { title: 'Cannot delete', content: html`<p class="error" role="alert">${msg}</p><p><a href="${url(name)}">← ${T.label}</a></p>`, status: 400 });
  }
  logEvent('warn', 'admin', `Deleted ${name} ${idStr}`);
  await invalidate();
  return redirect(res, `${url(name)}?n=deleted`);
}
