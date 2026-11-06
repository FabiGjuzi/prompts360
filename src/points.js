// points.js — the point system and level tiers.
//
// Rules (all counted only for activity after migration 007, so everyone started at 0):
//   post        +5  to the author of a live post (a repost is a share, not a post)
//   comment     +2  to the commenter, unless the comment is on their own post
//   share       +2  to the reposter AND +2 to the author of the original (nothing if you repost your own post)
//   vote        +1  to the voter AND +1 to the author of the post/comment voted on (up or down; nothing on your own content)
// One vote per person per item (the votes table has one row per pair), so toggling a vote cannot be farmed.
// The automatic upvote a repost gives the original is not a vote (even after the repost is deleted): the share already paid for it.
// Points are computed from LIVE content only, so deleting/removing a post or comment, clearing a vote or removing a
// repost takes its points back; the total never shows below 0.
import { q } from './db.js';

export const POINTS = { vote: 1, comment: 2, post: 5, share: 2 };
export const COMMUNITY_MIN = 150;                 // points needed to create a community
export const TIERS = [[0, 'Newcomer'], [25, 'Explorer'], [75, 'Contributor'], [150, 'Builder'], [500, 'Expert'], [1500, 'Legend']];

/** Level for a point total: { name, min, level (1-based), next: {name, min} | null, toNext, pct (0-100 progress to the next level) }. */
export function levelOf(points) {
  const pts = Math.max(0, Number(points) || 0);
  let i = 0;
  while (i + 1 < TIERS.length && pts >= TIERS[i + 1][0]) i++;
  const [min, name] = TIERS[i], nx = TIERS[i + 1];
  return { name, min, level: i + 1, next: nx ? { min: nx[0], name: nx[1] } : null, toNext: nx ? nx[0] - pts : 0, pct: nx ? Math.floor(((pts - min) / (nx[0] - min)) * 100) : 100 };
}

// One row per scoring event: (uid, pts). $1 = user ids to compute for (NULL = everyone), $2..$5 = vote, comment, post, share.
const ONLY = col => `($1::bigint[] IS NULL OR ${col} = ANY($1::bigint[]))`;
const EVENTS = `
SELECT p.author_id AS uid, $4::int AS pts FROM live_posts p, points_epoch e
  WHERE p.repost_of IS NULL AND p.created_at >= e.starts_at AND ${ONLY('p.author_id')}
UNION ALL
SELECT cm.author_id, $3::int FROM live_comments cm JOIN live_posts p ON p.id = cm.post_id, points_epoch e
  WHERE cm.author_id <> p.author_id AND cm.created_at >= e.starts_at AND ${ONLY('cm.author_id')}
UNION ALL
SELECT r.author_id, $5::int FROM live_posts r JOIN live_posts o ON o.id = r.repost_of, points_epoch e
  WHERE r.author_id <> o.author_id AND r.created_at >= e.starts_at AND ${ONLY('r.author_id')}
UNION ALL
SELECT o.author_id, $5::int FROM live_posts r JOIN live_posts o ON o.id = r.repost_of, points_epoch e
  WHERE r.author_id <> o.author_id AND r.created_at >= e.starts_at AND ${ONLY('o.author_id')}
UNION ALL
SELECT v.user_id, $2::int FROM post_votes v JOIN live_posts p ON p.id = v.post_id, points_epoch e
  WHERE v.user_id <> p.author_id AND v.created_at >= e.starts_at AND ${ONLY('v.user_id')}
    AND NOT EXISTS (SELECT 1 FROM posts r WHERE r.repost_of = p.id AND r.author_id = v.user_id)
UNION ALL
SELECT p.author_id, $2::int FROM post_votes v JOIN live_posts p ON p.id = v.post_id, points_epoch e
  WHERE v.user_id <> p.author_id AND v.created_at >= e.starts_at AND ${ONLY('p.author_id')}
    AND NOT EXISTS (SELECT 1 FROM posts r WHERE r.repost_of = p.id AND r.author_id = v.user_id)
UNION ALL
SELECT v.user_id, $2::int FROM comment_votes v JOIN live_comments cm ON cm.id = v.comment_id, points_epoch e
  WHERE v.user_id <> cm.author_id AND v.created_at >= e.starts_at AND ${ONLY('v.user_id')}
UNION ALL
SELECT cm.author_id, $2::int FROM comment_votes v JOIN live_comments cm ON cm.id = v.comment_id, points_epoch e
  WHERE v.user_id <> cm.author_id AND v.created_at >= e.starts_at AND ${ONLY('cm.author_id')}`;

const RECALC = `WITH ev AS (${EVENTS}), agg AS (SELECT uid, sum(pts)::int AS pts FROM ev GROUP BY uid)
UPDATE users u SET points = greatest(coalesce(a.pts, 0), 0)
FROM users u2 LEFT JOIN agg a ON a.uid = u2.id
WHERE u.id = u2.id AND ${ONLY('u.id')} AND u.points <> greatest(coalesce(a.pts, 0), 0)`;

/** Recompute the cached points of the given users (an array of ids), or of everyone when ids is null. Never throws. */
export async function recalc(ids = null) {
  if (ids) { ids = [...new Set(ids.filter(Boolean).map(Number))]; if (!ids.length) return; }
  try { await q(RECALC, [ids, POINTS.vote, POINTS.comment, POINTS.post, POINTS.share]); }
  catch (e) { console.error('[points]', e.message); }
}

/** Everyone whose points can change when a post is deleted/removed: its author, voters, commenters, comment voters, reposters, and the author of the original when it is a repost. */
export async function relatedToPost(postId) {
  const { rows } = await q(`SELECT author_id AS id FROM posts WHERE id = $1 OR repost_of = $1
    UNION SELECT author_id FROM posts WHERE id = (SELECT repost_of FROM posts WHERE id = $1)
    UNION SELECT user_id FROM post_votes WHERE post_id = $1
    UNION SELECT author_id FROM comments WHERE post_id = $1
    UNION SELECT v.user_id FROM comment_votes v JOIN comments c ON c.id = v.comment_id WHERE c.post_id = $1`, [postId]);
  return rows.map(r => r.id);
}
/** Same for a comment: its author and the people who voted on it. */
export async function relatedToComment(commentId) {
  const { rows } = await q(`SELECT author_id AS id FROM comments WHERE id = $1 UNION SELECT user_id FROM comment_votes WHERE comment_id = $1`, [commentId]);
  return rows.map(r => r.id);
}
