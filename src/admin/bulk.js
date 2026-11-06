// admin/bulk.js — the Posts panel's publishing controls: status badge + toggle, "publish a wave / the next N", and mass actions on a selection.
//
// One flag decides visibility: posts.published (true = public, false = draft, hidden from every public query and route).
// Selecting: every row has a checkbox named s.<id> (a form's duplicate names would be dropped by the body parser, so the id is in the NAME).
// "All N matching" re-runs the same search/filter on the server (capped), so it also works across pages.
// Actions: publish · unpublish (back to draft) · hide · restore · wave · delete (typed confirmation) · export (CSV of the selection, same shape the importer reads).
// Everything runs in ONE transaction: it all happens or none of it does. Rows an action does not apply to are skipped and counted, never changed.
import { q, tx } from '../db.js';
import { html } from '../html.js';
import { redirect, str, HttpError } from '../http.js';
import { logEvent } from '../metrics.js';
import { stringify } from '../csv.js';
import { recordAction } from '../actions.js';
import { TABLES, invalidate } from './crud.js';
import { P } from './ui.js';

const MAX_SELECTED = 1000, MAX_ALL = 5000;
export const ACTIONS = {
  publish: 'Publish (drafts go live)', unpublish: 'Unpublish (back to draft, hidden at once)', hide: 'Hide (remove from the site)', restore: 'Restore hidden posts',
  wave: 'Set publishing wave…', delete: 'Delete permanently…', export: 'Export selected (CSV)',
};

/** A checkbox column for ui.table(): the header box toggles every row (admin.js); rows work without JavaScript. */
export const selectColumn = () => ({ h: html`<input type="checkbox" data-selall aria-label="Select all rows on this page">`, cls: 'sel',
  f: r => html`<input type="checkbox" name="s.${r.id}" value="1" form="bulk" aria-label="Select post ${r.id}">` });

/** The action bar (a form with id="bulk"; the checkboxes in the table point at it with form="bulk"). */
export function bulkBar(req, { total, filter = {} }) {
  return html`<form id="bulk" method="post" action="${P}/bulk/posts" class="bulkbar">
<input type="hidden" name="_csrf" value="${req.admin.csrf}">
${['q', 'f', 'v'].map(k => (filter[k] ? html`<input type="hidden" name="${k}" value="${filter[k]}">` : ''))}
<label for="bulk_action">With the selected posts:</label>
<select id="bulk_action" name="action" required><option value="">Choose an action…</option>${Object.keys(ACTIONS).map(a => html`<option value="${a}">${ACTIONS[a]}</option>`)}</select>
<label for="bulk_wave" class="muted">Wave (1–99, blank = none)</label><input id="bulk_wave" name="wave" type="number" min="1" max="99" class="sm">
<label for="bulk_confirm" class="muted">Type DELETE to confirm a delete</label><input id="bulk_confirm" name="confirm" type="text" maxlength="10" autocomplete="off" class="sm">
<label class="chk"><input type="checkbox" name="scope" value="all"> all ${total} matching (not only this page)</label>
<button class="btn primary">Apply</button></form>`;
}

/** The Posts list's "Published" cell: a visible status badge plus the one-click toggle (publish a draft / pull a live post back to draft). */
export function statusCell(req, r) {
  if (r.repost_of) return r.published ? html`<span class="pill ok">Published</span>` : html`<span class="pill warn">Draft</span>`;
  return html`<form method="post" action="${P}/posts/publish" class="inline"><input type="hidden" name="_csrf" value="${req.admin.csrf}"><input type="hidden" name="id" value="${r.id}">
<input type="hidden" name="to" value="${r.published ? '0' : '1'}">${r.published ? html`<span class="pill ok">Published</span> <button class="btn sm" title="Hide this post from the public site at once">Unpublish</button>` : html`<span class="pill warn">Draft</span> <button class="btn sm primary">Publish</button>`}</form>`;
}

/** Above the Posts list: "publish a wave" / "publish the next N drafts" (only shown while drafts exist). */
export async function publishBar(req) {
  const { rows } = await q(`SELECT wave, count(*)::int AS n FROM posts WHERE NOT published AND deleted_at IS NULL AND repost_of IS NULL GROUP BY wave ORDER BY wave NULLS LAST`);
  const total = rows.reduce((a, r) => a + r.n, 0);
  if (!total) return '';
  const csrfIn = html`<input type="hidden" name="_csrf" value="${req.admin.csrf}">`;
  return html`<div class="card"><p class="muted">${total} draft${total === 1 ? '' : 's'} (unpublished, invisible to visitors). <a href="${P}/t/posts?f=published&amp;v=false">Show only drafts</a></p><div class="row">
${rows.filter(w => w.wave).map(w => html`<form method="post" action="${P}/posts/publish">${csrfIn}<input type="hidden" name="wave" value="${w.wave}"><button class="btn">Publish wave ${w.wave} (${w.n})</button></form>`)}
<form method="post" action="${P}/posts/publish" class="row">${csrfIn}<label for="nx">Publish the next</label><input id="nx" name="next" type="number" min="1" max="250" value="20" required><button class="btn primary">drafts (lowest wave first)</button></form></div></div>`;
}

/** SQL WHERE for the rows a request means: ticked ids, or every row matching the list's search/filter. */
async function selection(body) {
  const ids = [];
  for (const k of Object.keys(body)) { const m = /^s\.(\d{1,15})$/.exec(k); if (m && body[k] === '1') ids.push(Number(m[1])); }
  if (body.scope === 'all') {
    const where = ['p.deleted_at IS NULL'], vals = [];
    const search = str(body.q || '', 100).trim(), f = str(body.f || '', 30), v = str(body.v || '', 60);
    if (search) { vals.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`); where.push(`(p.title ILIKE $${vals.length} OR p.body ILIKE $${vals.length})`); }
    if (f && TABLES.posts.filters.includes(f) && v) { vals.push(v); where.push(`p.${f}::text = $${vals.length}`); }
    const { rows } = await q(`SELECT p.id FROM posts p WHERE ${where.join(' AND ')} ORDER BY p.id LIMIT ${MAX_ALL + 1}`, vals);
    if (rows.length > MAX_ALL) throw new HttpError(400, `That matches more than ${MAX_ALL} posts. Narrow the search first.`);
    return rows.map(r => r.id);
  }
  if (ids.length > MAX_SELECTED) throw new HttpError(400, `Select at most ${MAX_SELECTED} posts at a time (or use “all matching”).`);
  return [...new Set(ids)];
}

const recount = (db, cids) => cids.length ? db.query(`UPDATE communities c SET post_count = (SELECT count(*) FROM posts p WHERE p.community_id = c.id AND p.deleted_at IS NULL AND p.removed_at IS NULL AND p.published) WHERE c.id = ANY($1::bigint[])`, [[...new Set(cids)]]) : null;

/**
 * Set published on the given posts (reposts are skipped: they follow the original). Only rows that actually change are touched.
 * The first publication dates the post now; later toggles keep its date. Returns the ids that changed.
 */
export async function setPublished(db, ids, to) {
  if (!ids.length) return [];
  const { rows } = to
    ? await db.query(`UPDATE posts SET published = true, published_at = coalesce(published_at, now()),
        created_at = CASE WHEN published_at IS NULL THEN now() ELSE created_at END, edited_at = CASE WHEN published_at IS NULL THEN NULL ELSE edited_at END,
        hot = hot_rank(score, CASE WHEN published_at IS NULL THEN now() ELSE created_at END)
        WHERE id = ANY($1::bigint[]) AND NOT published AND repost_of IS NULL AND deleted_at IS NULL RETURNING id, community_id`, [ids])
    : await db.query(`UPDATE posts SET published = false WHERE id = ANY($1::bigint[]) AND published AND repost_of IS NULL AND deleted_at IS NULL RETURNING id, community_id`, [ids]);
  await recount(db, rows.map(r => r.community_id));
  for (const r of rows) await recordAction(db, { kind: to ? 'post.publish' : 'post.unpublish', targetType: 'post', targetId: r.id, meta: { by: 'admin' } });
  return rows.map(r => r.id);
}

const back = body => {
  const p = new URLSearchParams(); for (const k of ['q', 'f', 'v']) { const v = str(body[k] || '', 100); if (v) p.set(k, v); }
  return `${P}/t/posts${p.size ? `?${p}` : ''}`;
};
const withParam = (to, kv) => `${to}${to.includes('?') ? '&' : '?'}${kv}`;

/** POST /posts/publish — toggle one post (id + to=1|0), publish a whole wave (wave) or the next N drafts (next). */
export async function postsPublish(req, res) {
  const b = req.body, id = Number(str(b.id, 15)), wave = Number(str(b.wave, 3)), next = Number(str(b.next, 4)), to = str(b.to, 1) === '0' ? 0 : 1;
  let sel;
  if (b.id && Number.isInteger(id) && id > 0) sel = ['SELECT id FROM posts WHERE id = $1', [id]];
  else if (b.wave && Number.isInteger(wave) && wave >= 1 && wave <= 99) sel = ['SELECT id FROM posts WHERE NOT published AND wave = $1 ORDER BY id', [wave]];
  else if (b.next && Number.isInteger(next) && next >= 1 && next <= 250) sel = ['SELECT id FROM posts WHERE NOT published AND repost_of IS NULL AND deleted_at IS NULL ORDER BY wave NULLS LAST, id LIMIT $1', [next]];
  else throw new HttpError(400, 'Choose a post, a wave or a number to publish.');
  const n = (await tx(async db => setPublished(db, (await db.query(sel[0], sel[1])).rows.map(r => r.id), to))).length;
  logEvent('info', 'admin', `${to ? 'Published' : 'Unpublished'} ${n} post${n === 1 ? '' : 's'}`);
  await invalidate();
  return redirect(res, withParam(back(b), `bulk=${to ? 'publish' : 'unpublish'}.${n}.0`));
}

/** POST /bulk/posts */
export async function bulkPosts(req, res) {
  const b = req.body, action = str(b.action, 20);
  if (!Object.hasOwn(ACTIONS, action)) throw new HttpError(400, 'Choose an action from the list.');
  const ids = await selection(b);
  if (!ids.length) return redirect(res, withParam(back(b), 'bulk=none'));
  let wave = null;
  if (action === 'wave') {
    const w = str(b.wave, 3).trim();
    if (w !== '') { wave = Number(w); if (!Number.isInteger(wave) || wave < 1 || wave > 99) throw new HttpError(400, 'A wave is a whole number from 1 to 99.'); }
  }
  if (action === 'delete' && str(b.confirm, 10).trim() !== 'DELETE') throw new HttpError(400, 'To delete, type DELETE in the confirmation box.');

  if (action === 'export') {
    const { rows } = await q(`SELECT c.name AS community, p.title, p.body, t.slug AS model, p.url, p.published, p.wave, p.seo_title, p.seo_desc FROM posts p JOIN communities c ON c.id = p.community_id JOIN ai_tags t ON t.id = p.ai_tag_id
      WHERE p.id = ANY($1::bigint[]) AND p.deleted_at IS NULL AND p.repost_of IS NULL ORDER BY p.id`, [ids]);
    const csv = stringify(['community', 'title', 'body', 'model', 'url', 'published', 'wave', 'seo_title', 'seo_desc'], rows.map(r => [r.community, r.title, r.body, r.model, r.url, r.published ? 1 : 0, r.wave ?? '', r.seo_title ?? '', r.seo_desc ?? '']));
    logEvent('info', 'admin', `Exported ${rows.length} selected posts as CSV`);
    const buf = Buffer.from(csv);
    res.statusCode = 200; res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="prompts360-selected-posts-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Length', buf.length);
    return res.end(buf);
  }

  const done = await tx(async db => {
    // Lock the rows in a stable order so two bulk actions cannot deadlock.
    const { rows: cur } = await db.query('SELECT id, community_id, published, removed_at, repost_of FROM posts WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE', [ids]);
    const by = f => cur.filter(f).map(r => r.id), cids = cur.map(r => r.community_id);
    let n = 0;
    switch (action) {
      case 'publish': n = (await setPublished(db, by(r => !r.published), 1)).length; return { n, skipped: ids.length - n };
      case 'unpublish': n = (await setPublished(db, by(r => r.published), 0)).length; return { n, skipped: ids.length - n };
      case 'hide': n = (await db.query('UPDATE posts SET removed_at = now() WHERE id = ANY($1::bigint[]) AND removed_at IS NULL RETURNING id', [by(r => !r.removed_at)])).rowCount; break;
      case 'restore': n = (await db.query('UPDATE posts SET removed_at = NULL WHERE id = ANY($1::bigint[]) AND removed_at IS NOT NULL RETURNING id', [by(r => r.removed_at)])).rowCount; break;
      case 'wave': n = (await db.query('UPDATE posts SET wave = $2 WHERE id = ANY($1::bigint[]) AND repost_of IS NULL RETURNING id', [by(r => !r.repost_of), wave])).rowCount; break;
      case 'delete': {
        const T = TABLES.posts;
        for (const id of cur.map(r => r.id)) {
          const old = (await db.query('SELECT * FROM posts WHERE id = $1', [id])).rows[0];
          await T.protect?.(old); await T.protectDelete?.(old);
          await db.query('DELETE FROM posts WHERE id = $1', [id]); await T.afterDelete?.(db, old); n++;
        }
        break;
      }
    }
    if (action !== 'wave') await recount(db, cids);
    return { n, skipped: ids.length - n };
  });
  logEvent(action === 'delete' ? 'warn' : 'info', 'admin', `Mass action “${action}” on ${ids.length} selected posts: ${done.n} changed, ${done.skipped} skipped`);
  await invalidate();
  return redirect(res, withParam(back(b), `bulk=${action}.${done.n}.${done.skipped}`));
}

/** Flash text for ?bulk=<action>.<changed>.<skipped>. */
export function bulkFlash(param) {
  if (param === 'none') return 'Nothing was selected, so nothing changed.';
  const m = /^(publish|unpublish|hide|restore|wave|delete)\.(\d{1,6})\.(\d{1,6})$/.exec(param || '');
  if (!m) return undefined;
  const verb = { publish: 'Published', unpublish: 'Unpublished (back to draft):', hide: 'Hidden:', restore: 'Restored:', wave: 'Wave set on', delete: 'Deleted' }[m[1]];
  return `${verb} ${m[2]} post${m[2] === '1' ? '' : 's'}.${m[3] !== '0' ? ` ${m[3]} skipped (the action did not apply to them).` : ''}`;
}
