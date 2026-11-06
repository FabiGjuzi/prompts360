// admin/stats.js — database queries behind the dashboard (all read-only, parameterised, aggregate data only).
import { q, primary } from '../db.js';
import { BOUNDS } from '../metrics.js';

/** Approximate percentile from latency histogram counts h[0..7] (returns the upper bound of the bucket it falls in). */
export function percentile(h, p) {
  const total = h.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  let acc = 0;
  for (let i = 0; i < h.length; i++) { acc += h[i]; if (acc >= total * p) return i < BOUNDS.length ? BOUNDS[i] : BOUNDS[BOUNDS.length - 1] * 2; }
  return BOUNDS[BOUNDS.length - 1] * 2;
}
const H = 'h0, h1, h2, h3, h4, h5, h6, h7';
const hsum = r => [r.h0, r.h1, r.h2, r.h3, r.h4, r.h5, r.h6, r.h7].map(Number);
const sumH = rows => rows.reduce((a, r) => a.map((v, i) => v + hsum(r)[i]), new Array(8).fill(0));

/** Totals for the last `hours` hours: requests, pages, errors, latency percentiles. */
export async function kpi(hours) {
  const { rows: [r] } = await q(`SELECT coalesce(sum(requests),0)::bigint AS requests, coalesce(sum(pages),0)::bigint AS pages, coalesce(sum(bots),0)::bigint AS bots,
      coalesce(sum(s4xx),0)::bigint AS s4, coalesce(sum(s5xx),0)::bigint AS s5, coalesce(sum(limited),0)::bigint AS limited, coalesce(sum(csrf_fail),0)::bigint AS csrf,
      coalesce(sum(ms_sum),0)::bigint AS ms_sum, coalesce(max(ms_max),0) AS ms_max,
      coalesce(sum(h0),0)::bigint AS h0, coalesce(sum(h1),0)::bigint AS h1, coalesce(sum(h2),0)::bigint AS h2, coalesce(sum(h3),0)::bigint AS h3,
      coalesce(sum(h4),0)::bigint AS h4, coalesce(sum(h5),0)::bigint AS h5, coalesce(sum(h6),0)::bigint AS h6, coalesce(sum(h7),0)::bigint AS h7
    FROM metrics_minute WHERE ts > now() - make_interval(hours => $1)`, [hours]);
  const h = hsum(r), req = Number(r.requests);
  return { requests: req, pages: Number(r.pages), bots: Number(r.bots), s4: Number(r.s4), s5: Number(r.s5), limited: Number(r.limited), csrf: Number(r.csrf),
    avg: req ? Number(r.ms_sum) / req : 0, max: Number(r.ms_max), p50: percentile(h, 0.5), p95: percentile(h, 0.95), p99: percentile(h, 0.99) };
}

/** Per-minute rows for the last hour (for the live charts). */
export async function minutes(n = 60) {
  const { rows } = await q(`SELECT to_char(ts AT TIME ZONE 'UTC', 'HH24:MI') AS label, requests, pages, s4xx, s5xx, ms_sum, ms_max, ${H}, rss_mb, heap_mb, lag_ms, cpu_pct, db_ms
    FROM metrics_minute WHERE ts > now() - make_interval(mins => $1) ORDER BY ts`, [n]);
  return rows.map(r => ({ ...r, avg: r.requests ? Number(r.ms_sum) / r.requests : 0, p95: percentile(hsum(r), 0.95) }));
}

/** Hourly rows for the last 24 hours. */
export async function hours24() {
  const { rows } = await q(`SELECT to_char(date_trunc('hour', ts) AT TIME ZONE 'UTC', 'HH24"h"') AS label, sum(requests)::int AS requests, sum(pages)::int AS pages, sum(bots)::int AS bots, sum(s5xx)::int AS s5
    FROM metrics_minute WHERE ts > now() - interval '24 hours' GROUP BY date_trunc('hour', ts) ORDER BY date_trunc('hour', ts)`);
  return rows;
}

/** One row per day for the last 30 days (days with no traffic show as zero). */
export async function days30() {
  const { rows } = await q(`SELECT to_char(d::date, 'MM-DD') AS label, coalesce(m.visitors, 0) AS visitors, coalesce(m.pageviews, 0) AS pageviews, coalesce(m.bot_hits, 0) AS bots,
      (SELECT count(*) FROM users u WHERE u.created_at::date = d::date AND u.verified_at IS NOT NULL)::int AS signups,
      (SELECT count(*) FROM posts p WHERE p.created_at::date = d::date AND p.published)::int AS posts,
      (SELECT count(*) FROM comments c WHERE c.created_at::date = d::date)::int AS comments
    FROM generate_series(current_date - 29, current_date, interval '1 day') d LEFT JOIN metrics_day m ON m.day = d::date ORDER BY d`);
  return rows;
}

export async function topPages(days = 7) {
  const { rows } = await q(`SELECT path, sum(views)::int AS views FROM metrics_page WHERE day > current_date - $1::int GROUP BY path ORDER BY 2 DESC LIMIT 15`, [days]);
  return rows;
}
export async function routeStats() {
  const { rows } = await q(`SELECT route, sum(hits)::int AS hits, round(sum(ms_sum)::numeric / greatest(sum(hits), 1), 1)::float AS avg, max(ms_max) AS max, sum(errors)::int AS errors
    FROM metrics_route WHERE day >= current_date - 1 GROUP BY route ORDER BY 2 DESC LIMIT 25`);
  return rows;
}

export async function content() {
  const { rows: [r] } = await q(`SELECT
    (SELECT count(*) FROM users WHERE deleted_at IS NULL AND verified_at IS NOT NULL)::int AS users,
    (SELECT count(*) FROM users WHERE deleted_at IS NULL AND verified_at IS NULL)::int AS unverified,
    (SELECT count(*) FROM users WHERE banned_at IS NOT NULL)::int AS banned,
    (SELECT count(*) FROM posts WHERE deleted_at IS NULL AND removed_at IS NULL AND published)::int AS posts,
    (SELECT count(*) FROM comments WHERE deleted_at IS NULL AND removed_at IS NULL)::int AS comments,
    (SELECT count(*) FROM communities WHERE removed_at IS NULL)::int AS communities,
    (SELECT count(*) FROM ai_tags WHERE enabled)::int AS models,
    (SELECT count(*) FROM pages WHERE published)::int AS pages,
    (SELECT count(*) FROM post_votes)::int + (SELECT count(*) FROM comment_votes)::int AS votes,
    (SELECT count(*) FROM reports WHERE resolved_at IS NULL)::int AS reports`);
  return r;
}

export async function database() {
  const [info, sizes, stat] = await Promise.all([
    q(`SELECT current_setting('server_version') AS version, pg_database_size(current_database()) AS size`),
    q(`SELECT relname AS name, n_live_tup::bigint AS rows, pg_total_relation_size(relid) AS bytes FROM pg_stat_user_tables ORDER BY 3 DESC LIMIT 12`),
    q(`SELECT numbackends, round(100.0 * blks_hit / greatest(blks_hit + blks_read, 1), 2)::float AS cache_hit, xact_commit, xact_rollback, deadlocks FROM pg_stat_database WHERE datname = current_database()`),
  ]);
  return { ...info.rows[0], size: Number(info.rows[0].size), tables: sizes.rows, ...stat.rows[0],
    pool: { total: primary.totalCount, idle: primary.idleCount, waiting: primary.waitingCount } };
}

export async function security() {
  const [a, b] = await Promise.all([
    q(`SELECT message, count(*)::int AS n FROM event_log WHERE kind = 'admin' AND ts > now() - interval '24 hours' GROUP BY message ORDER BY 2 DESC`),
    q(`SELECT last_login_at, changed_at FROM admin_account WHERE id = 1`),
  ]);
  return { admin: a.rows, account: b.rows[0] || null };
}

/** Things that hold back search rankings: empty descriptions and thin pages. */
export async function seoHealth() {
  const { rows: [r] } = await q(`SELECT
    (SELECT count(*) FROM pages WHERE published AND NOT noindex AND meta_description = '')::int AS pages_no_desc,
    (SELECT count(*) FROM ai_tags WHERE enabled AND description = '')::int AS models_no_desc,
    (SELECT count(*) FROM communities WHERE removed_at IS NULL AND description = '')::int AS communities_no_desc,
    (SELECT count(*) FROM posts WHERE deleted_at IS NULL AND removed_at IS NULL AND published AND char_length(body) < 80 AND url IS NULL)::int AS thin_posts,
    (SELECT count(*) FROM posts WHERE deleted_at IS NULL AND removed_at IS NULL AND published)::int AS indexable_posts,
    (SELECT coalesce(sum(bot_hits), 0) FROM metrics_day WHERE day > current_date - 7)::int AS bot_hits_7d`);
  return r;
}

export async function recentErrors(limit = 15) {
  const { rows } = await q(`SELECT id, ts, kind, message FROM event_log WHERE level = 'error' ORDER BY id DESC LIMIT $1`, [limit]);
  return rows;
}
