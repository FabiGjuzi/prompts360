// Site-admin moderation: reports queue, remove content, ban/unban users, manage AI tags.
import { q, one, tx } from '../db.js';
import { page, redirect, str, HttpError } from '../http.js';
import { safeBack, slugify } from '../html.js';
import { destroyAllSessions } from '../session.js';
import * as V from '../views.js';
import { intId, TAG_RE } from '../validate.js';
import { tags, resetTagCache } from './forum.js';

async function reportsPage(req, res) {
  const { rows } = await q(`SELECT r.id, r.reason, r.created_at, r.post_id, r.comment_id, r.community_id,
      ru.username AS reporter,
      p.title AS p_title, p.deleted_at AS p_del, p.removed_at AS p_rem,
      cm.body AS c_body, cm.post_id AS c_post, cm.deleted_at AS c_del, cm.removed_at AS c_rem,
      cc.name AS m_name, cc.removed_at AS m_rem,
      tu.username AS target_author
    FROM reports r
    LEFT JOIN users ru ON ru.id = r.reporter_id
    LEFT JOIN posts p ON p.id = r.post_id
    LEFT JOIN comments cm ON cm.id = r.comment_id
    LEFT JOIN communities cc ON cc.id = r.community_id
    LEFT JOIN users tu ON tu.id = coalesce(p.author_id, cm.author_id, cc.creator_id)
    WHERE r.resolved_at IS NULL ORDER BY r.id LIMIT 200`);
  const reports = rows.map(r => {
    if (r.post_id) return { ...r, type: 'p', kind: 'post', target_id: r.post_id, preview: r.p_title, link: `/p/${r.post_id}/${slugify(r.p_title)}`, target_gone: r.p_del || r.p_rem };
    if (r.comment_id) return { ...r, type: 'c', kind: 'comment', target_id: r.comment_id, preview: r.c_body?.slice(0, 200), link: `/p/${r.c_post}#c${r.comment_id}`, target_gone: r.c_del || r.c_rem };
    return { ...r, type: 'm', kind: 'community', target_id: r.community_id, preview: `c/${r.m_name}`, link: `/c/${r.m_name}`, target_gone: r.m_rem };
  });
  return page(req, res, { title: 'Admin', content: V.adminPage({ user: req.user, reports, tags: await tags() }), noindex: true });
}

async function remove(req, res) {
  const id = intId(req.body.id), type = req.body.type;
  if (!id || !['p', 'c', 'm'].includes(type)) throw new HttpError(400, 'Bad request.');
  await tx(async db => {
    if (type === 'p') {
      const r = await db.query('UPDATE posts SET removed_at = now() WHERE id = $1 AND removed_at IS NULL RETURNING community_id, deleted_at', [id]);
      if (r.rowCount && !r.rows[0].deleted_at) await db.query('UPDATE communities SET post_count = greatest(post_count - 1, 0) WHERE id = $1', [r.rows[0].community_id]);
      await db.query('UPDATE reports SET resolved_at = now(), resolved_by = $2 WHERE post_id = $1 AND resolved_at IS NULL', [id, req.user.id]);
    } else if (type === 'c') {
      await db.query('UPDATE comments SET removed_at = now() WHERE id = $1 AND removed_at IS NULL', [id]);
      await db.query('UPDATE reports SET resolved_at = now(), resolved_by = $2 WHERE comment_id = $1 AND resolved_at IS NULL', [id, req.user.id]);
    } else {
      await db.query('UPDATE communities SET removed_at = now() WHERE id = $1 AND removed_at IS NULL', [id]);
      await db.query('UPDATE posts SET removed_at = now() WHERE community_id = $1 AND removed_at IS NULL', [id]);
      await db.query('UPDATE reports SET resolved_at = now(), resolved_by = $2 WHERE community_id = $1 AND resolved_at IS NULL', [id, req.user.id]);
    }
  });
  const back = safeBack(req.body.back, '/admin');
  return redirect(res, back.includes('#') ? back : `${back.split('?')[0]}?n=removed`);
}

async function dismiss(req, res) {
  const id = intId(req.body.id);
  if (!id) throw new HttpError(400, 'Bad request.');
  await q('UPDATE reports SET resolved_at = now(), resolved_by = $2 WHERE id = $1', [id, req.user.id]);
  return redirect(res, '/admin');
}

const setBan = banned => async (req, res) => {
  const id = intId(req.body.id);
  if (!id || id === req.user.id) throw new HttpError(400, 'Bad request.');
  const u = await one(`UPDATE users SET banned_at = ${banned ? 'now()' : 'NULL'} WHERE id = $1 AND is_admin = false RETURNING username`, [id]);
  if (!u) throw new HttpError(404, 'User not found (admins can’t be banned here).');
  if (banned) await destroyAllSessions(id);
  return redirect(res, `/u/${u.username}?n=${banned ? 'banned' : 'unbanned'}`);
};

async function saveTag(req, res) {
  const slug = str(req.body.slug, 30).trim().toLowerCase(), name = str(req.body.name, 40).trim();
  if (!TAG_RE.test(slug) || !name) throw new HttpError(400, 'Slug must be a-z, 0-9 or -, and a name is required.');
  await q(`INSERT INTO ai_tags (slug, name, sort) VALUES ($1, $2, 500) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name`, [slug, name]);
  resetTagCache();
  return redirect(res, '/admin?n=edited');
}

export const adminRoutes = [
  ['GET', /^\/admin$/, reportsPage, { auth: 'admin' }],
  ['POST', /^\/admin\/remove$/, remove, { form: 'user', auth: 'admin' }],
  ['POST', /^\/admin\/dismiss$/, dismiss, { form: 'user', auth: 'admin' }],
  ['POST', /^\/admin\/ban$/, setBan(true), { form: 'user', auth: 'admin' }],
  ['POST', /^\/admin\/unban$/, setBan(false), { form: 'user', auth: 'admin' }],
  ['POST', /^\/admin\/tag$/, saveTag, { form: 'user', auth: 'admin' }],
];
