// actions.js — the server-side action log (table action_events), written inside the same transaction as the action itself.
// Kinds: post.publish · post.unpublish · vote (counter change) · comment.create. Server-side facts only: no IP, no user agent, no browser clicks.
// `db` is a transaction client (from db.js tx) so the record commits or rolls back together with the change it describes.

/** Record one action. meta must be a small plain object (it is stored as JSON). */
export function recordAction(db, { kind, actorId = null, targetType = null, targetId = null, meta = {} }) {
  return db.query('INSERT INTO action_events (kind, actor_id, target_type, target_id, meta) VALUES ($1, $2, $3, $4, $5)',
    [kind, actorId, targetType, targetId, JSON.stringify(meta)]);
}
