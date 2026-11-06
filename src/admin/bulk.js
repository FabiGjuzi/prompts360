// admin/bulk.js — mass selection and mass actions on posts (Drafts page and the Posts table).
//
// Selecting: every row has a checkbox named s.<id> (a form's duplicate names would be dropped by the body parser, so the id is in the NAME).
// "All N matching" re-runs the same search/filter on the server (capped), so it also works across pages.
// Actions: publish · draft (hide as a draft) · hide · restore · wave · delete (typed confirmation) · export (CSV of the selection, same shape the importer reads).
// Everything runs in ONE transaction: it all happens or none of it does. Rows an action does not apply to are skipped and counted, never changed.
import { q, tx } from '../db.js';
import { html } from '../html.js';
import { redirect, str, HttpError } from '../http.js';
import { logEvent } from '../metrics.js';
import { stringify } from '../csv.js';
import { TABLES, invalidate } from './crud.js';
import { P } from './ui.js';

const MAX_SELECTED = 1000, MAX_ALL = 5000;
export const ACTIONS = {
  publish: 'Publish (drafts become public, dated now)', draft: 'Turn into hidden drafts', hide: 'Hide (remove from the site)', restore: 'Restore hidden posts',
  wave: 'Set publishing wave…', delete: 'Delete permanently…', export: 'Export selected (CSV)',
};
const FOR = { drafts: ['publish', 'wave', 'delete', 'export'], posts: Object.keys(ACTIONS) };

/** A checkbox column for ui.table(): the header box toggles every row (admin.js); rows work without JavaScript. */
export const selectColumn = () => ({ h: html`<input type="checkbox" data-selall aria-label="Select all rows on this page">`, cls: 'sel',
  f: r => html`<input type="checkbox" name="s.${r.id}" value="1" form="bulk" aria-label="Select post ${r.id}">` });

/** The action bar (a form with id="bulk"; the checkboxes in the table point at it with form="bulk"). */
export function bulkBar(req, { from, total, filter = {} }) {
  return html`<form id="bulk" method="post" action="${P}/bulk/posts" class="bulkbar">
<input type="hidden" name="_csrf" value="${req.admin.csrf}"><input type="hidden" name="from" value="${from}">
${['q', 'f', 'v'].map(k => (filter[k] ? html`<input type="hidden" name="${k}" value="${filter[k]}">` : ''))}
<label for="bulk_action">With the selected posts:</label>
<select id="bulk_action" name="action" required><option value="">Choose an action…</option>${FOR[from].map(a => html`<option value="${a}">${ACTIONS[a]}</option>`)}</select>
<label for="bulk_wave" class="muted">Wave (1–99, blank = none)</label><input id="bulk_wave" name="wave" type="number" min="1" max="99" class="sm">
<label for="bulk_confirm" class="muted">Type DELETE to confirm a delete</label><input id="bulk_confirm" name="confirm" type="text" maxlength="10" autocomplete="off" class="sm">
<label class="chk"><input type="checkbox" name="scope" value="all"> all ${total} matching (not only this page)</label>
<button class="btn primary">Apply</button></form>`;
}

/** SQL WHERE for the rows a request means: ticked ids, or every row matching the list's search/filter. */
async function selection(body, from) {
  const ids = [];
  for (const k of Object.keys(body)) { const m = /^s\.(\d{1,15})$/.exec(k); if (m && body[k] === '1') ids.push(Number(m[1])); }
  if (body.scope === 'all') {
    const where = from === 'drafts' ? ['p.draft'] : ['p.deleted_at IS NULL'], vals = [];
    const search = str(body.q || '', 100).trim(), f = str(body.f || '', 30), v = str(body.v || '', 60);
    if (from === 'posts') {
      if (search) { vals.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`); where.push(`(p.title ILIKE $${vals.length} OR p.body ILIKE $${vals.length})`); }
      if (f && TABLES.posts.filters.includes(f) && v) { vals.push(v); where.push(`p.${f}::text = $${vals.length}`); }
    }
    const { rows } = await q(`SELECT p.id FROM posts p WHERE ${where.join(' AND ')} ORDER BY p.id LIMIT ${MAX_ALL + 1}`, vals);
    if (rows.length > MAX_ALL) throw new HttpError(400, `That matches more than ${MAX_ALL} posts. Narrow the search first.`);
    return rows.map(r => r.id);
  }
  if (ids.length > MAX_SELECTED) throw new HttpError(400, `Select at most ${MAX_SELECTED} posts at a time (or use “all matching”).`);
  return [...new Set(ids)];
}

/** Publish drafts: visible, dated now, community counts fixed. Returns how many were published. Shared with the single-post button. */
export async function publishDrafts(db, ids) {
  if (!ids.length) return 0;
  const { rows } = await db.query(`UPDATE posts SET draft = false, removed_at = NULL, created_at = now(), edited_at = NULL, hot = hot_rank(score, now()) WHERE id = ANY($1::bigint[]) AND draft RETURNING community_id`, [ids]);
  await recount(db, rows.map(r => r.community_id));
  return rows.length;
}
const recount = (db, cids) => cids.length ? db.query(`UPDATE communities c SET post_count = (SELECT count(*) FROM posts p WHERE p.community_id = c.id AND p.deleted_at IS NULL AND p.removed_at IS NULL) WHERE c.id = ANY($1::bigint[])`, [[...new Set(cids)]]) : null;

const back = (from, body) => {
  if (from === 'drafts') return `${P}/drafts`;
  const p = new URLSearchParams(); for (const k of ['q', 'f', 'v']) { const v = str(body[k] || '', 100); if (v) p.set(k, v); }
  return `${P}/t/posts${p.size ? `?${p}` : ''}`;
};

/** POST /bulk/posts */
export async function bulkPosts(req, res) {
  const b = req.body, from = b.from === 'drafts' ? 'drafts' : b.from === 'posts' ? 'posts' : null;
  const action = str(b.action, 20);
  if (!from || !FOR[from].includes(action)) throw new HttpError(400, 'Choose an action from the list.');
  const ids = await selection(b, from);
  if (!ids.length) return redirect(res, `${back(from, b)}${back(from, b).includes('?') ? '&' : '?'}bulk=none`);
  let wave = null;
  if (action === 'wave') {
    const w = str(b.wave, 3).trim();
    if (w !== '') { wave = Number(w); if (!Number.isInteger(wave) || wave < 1 || wave > 99) throw new HttpError(400, 'A wave is a whole number from 1 to 99.'); }
  }
  if (action === 'delete' && str(b.confirm, 10).trim() !== 'DELETE') throw new HttpError(400, 'To delete, type DELETE in the confirmation box.');

  if (action === 'export') {
    const { rows } = await q(`SELECT c.name AS community, p.title, p.body, t.slug AS model, p.url, p.draft, p.wave, p.seo_title, p.seo_desc FROM posts p JOIN communities c ON c.id = p.community_id JOIN ai_tags t ON t.id = p.ai_tag_id
      WHERE p.id = ANY($1::bigint[]) AND p.deleted_at IS NULL AND p.repost_of IS NULL ORDER BY p.id`, [ids]);
    const csv = stringify(['community', 'title', 'body', 'model', 'url', 'draft', 'wave', 'seo_title', 'seo_desc'], rows.map(r => [r.community, r.title, r.body, r.model, r.url, r.draft ? 1 : '', r.wave ?? '', r.seo_title ?? '', r.seo_desc ?? '']));
    logEvent('info', 'admin', `Exported ${rows.length} selected posts as CSV`);
    const buf = Buffer.from(csv);
    res.statusCode = 200; res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="prompts360-selected-posts-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Length', buf.length);
    return res.end(buf);
  }

  const done = await tx(async db => {
    // Lock the rows in a stable order so two bulk actions cannot deadlock.
    const { rows: cur } = await db.query('SELECT id, community_id, draft, removed_at, repost_of FROM posts WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE', [ids]);
    const by = f => cur.filter(f).map(r => r.id), cids = cur.map(r => r.community_id);
    let n = 0;
    switch (action) {
      case 'publish': n = await publishDrafts(db, by(r => r.draft)); return { n, skipped: ids.length - n };
      case 'draft': n = (await db.query('UPDATE posts SET draft = true, removed_at = now() WHERE id = ANY($1::bigint[]) AND NOT draft AND repost_of IS NULL RETURNING id', [by(r => !r.draft && !r.repost_of)])).rowCount; break;
      case 'hide': n = (await db.query('UPDATE posts SET removed_at = now() WHERE id = ANY($1::bigint[]) AND NOT draft AND removed_at IS NULL RETURNING id', [by(r => !r.draft && !r.removed_at)])).rowCount; break;
      case 'restore': n = (await db.query('UPDATE posts SET removed_at = NULL WHERE id = ANY($1::bigint[]) AND NOT draft AND removed_at IS NOT NULL RETURNING id', [by(r => !r.draft && r.removed_at)])).rowCount; break;
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
    if (!['publish', 'wave'].includes(action)) await recount(db, cids);
    return { n, skipped: ids.length - n };
  });
  logEvent(action === 'delete' ? 'warn' : 'info', 'admin', `Mass action “${action}” on ${ids.length} selected posts: ${done.n} changed, ${done.skipped} skipped`);
  await invalidate();
  const to = back(from, b);
  return redirect(res, `${to}${to.includes('?') ? '&' : '?'}bulk=${action}.${done.n}.${done.skipped}`);
}

/** Flash text for ?bulk=<action>.<changed>.<skipped>. */
export function bulkFlash(param) {
  if (param === 'none') return 'Nothing was selected, so nothing changed.';
  const m = /^(publish|draft|hide|restore|wave|delete)\.(\d{1,6})\.(\d{1,6})$/.exec(param || '');
  if (!m) return undefined;
  const verb = { publish: 'Published', draft: 'Turned into drafts:', hide: 'Hidden:', restore: 'Restored:', wave: 'Wave set on', delete: 'Deleted' }[m[1]];
  return `${verb} ${m[2]} post${m[2] === '1' ? '' : 's'}.${m[3] !== '0' ? ` ${m[3]} skipped (the action did not apply to them).` : ''}`;
}
