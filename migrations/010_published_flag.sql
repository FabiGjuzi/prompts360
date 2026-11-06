-- 010_published_flag.sql — one `published` flag replaces the draft/removed_at pair, and vote scores start at 0.
--
-- Posts: published = true is public; published = false is a draft, hidden from every public query and route.
-- (removed_at stays what it always was: a moderator removal that shows "[removed]" on the post page.)
-- The old draft marker hid a post by ALSO setting removed_at; both are cleared here so a draft is only "unpublished".
ALTER TABLE posts ADD COLUMN published boolean NOT NULL DEFAULT true;
ALTER TABLE posts ADD COLUMN published_at timestamptz;
UPDATE posts SET published = false, removed_at = NULL WHERE draft;
UPDATE posts SET published_at = created_at WHERE published;          -- first-publish date of everything already live
ALTER TABLE posts DROP CONSTRAINT posts_draft_is_hidden;
DROP INDEX posts_drafts;
ALTER TABLE posts DROP COLUMN draft;
CREATE INDEX posts_unpublished ON posts (wave, id) WHERE NOT published AND deleted_at IS NULL;

-- Public views used by the points engine only count published posts.
CREATE OR REPLACE VIEW live_posts AS
  SELECT p.id, p.author_id, p.repost_of, p.created_at
  FROM posts p JOIN communities c ON c.id = p.community_id
  WHERE p.deleted_at IS NULL AND p.removed_at IS NULL AND p.published AND c.removed_at IS NULL;

-- Counters: a score starts at 0 and never shows below 0.
-- `net` is the raw sum of votes (it can be negative internally, so a later upvote is counted correctly);
-- `score` is what is shown and ranked: greatest(net, 0).
ALTER TABLE posts    ADD COLUMN net integer NOT NULL DEFAULT 0;
ALTER TABLE comments ADD COLUMN net integer NOT NULL DEFAULT 0;
ALTER TABLE posts    ALTER COLUMN score SET DEFAULT 0;
ALTER TABLE comments ALTER COLUMN score SET DEFAULT 0;
-- The automatic "author upvotes own post/comment" vote (which made every score start at 1) is removed.
DELETE FROM post_votes    v USING posts    p WHERE v.post_id = p.id    AND v.user_id = p.author_id;
DELETE FROM comment_votes v USING comments c WHERE v.comment_id = c.id AND v.user_id = c.author_id;
UPDATE posts    p SET net = coalesce((SELECT sum(value) FROM post_votes    v WHERE v.post_id = p.id), 0);
UPDATE comments c SET net = coalesce((SELECT sum(value) FROM comment_votes v WHERE v.comment_id = c.id), 0);
UPDATE posts    SET score = greatest(net, 0), hot = hot_rank(greatest(net, 0), created_at);
UPDATE comments SET score = greatest(net, 0);
ALTER TABLE posts    ADD CONSTRAINT posts_score_floor    CHECK (score >= 0);
ALTER TABLE comments ADD CONSTRAINT comments_score_floor CHECK (score >= 0);

-- Server-side action log (an outbox): publish/unpublish toggles, vote (counter) changes and comment submissions.
-- Written in the SAME transaction as the action, so it can never disagree with what happened. No IPs, no user agents, no browser clicks.
-- A stream shipper (Kafka etc.) can later read it by id; nothing is deleted automatically (retention is not decided yet).
CREATE TABLE action_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts          timestamptz NOT NULL DEFAULT now(),
  kind        text   NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 40),
  actor_id    bigint REFERENCES users(id) ON DELETE SET NULL,   -- null = the dashboard administrator or a deleted account
  target_type text   CHECK (target_type IN ('post', 'comment')),
  target_id   bigint,
  meta        jsonb  NOT NULL DEFAULT '{}'
);
CREATE INDEX action_events_ts   ON action_events (ts);
CREATE INDEX action_events_kind ON action_events (kind, ts);
