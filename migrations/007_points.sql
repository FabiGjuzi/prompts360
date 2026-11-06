-- 007_points.sql — points and level tiers.
-- Points are DERIVED from live activity (see src/points.js), never stored as a ledger, so deleting or removing content,
-- or clearing a vote, takes its points back automatically. users.points is a cache refreshed by recalc().
-- Everyone starts at 0: only activity after this migration counts (points_epoch). Votes had no timestamp, so the
-- column is added without a default for existing rows (NULL = before the epoch = never counts), then defaults to now().
ALTER TABLE users ADD COLUMN points integer NOT NULL DEFAULT 0;
ALTER TABLE post_votes ADD COLUMN created_at timestamptz;
ALTER TABLE comment_votes ADD COLUMN created_at timestamptz;
ALTER TABLE post_votes ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE comment_votes ALTER COLUMN created_at SET DEFAULT now();

CREATE TABLE points_epoch (
  id        boolean PRIMARY KEY DEFAULT true CHECK (id),
  starts_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO points_epoch DEFAULT VALUES;

-- "Live" content: not deleted, not removed, and (for posts) in a community that is not removed.
CREATE VIEW live_posts AS
  SELECT p.id, p.author_id, p.repost_of, p.created_at
  FROM posts p JOIN communities c ON c.id = p.community_id
  WHERE p.deleted_at IS NULL AND p.removed_at IS NULL AND c.removed_at IS NULL;
CREATE VIEW live_comments AS
  SELECT cm.id, cm.author_id, cm.post_id, cm.created_at
  FROM comments cm JOIN live_posts p ON p.id = cm.post_id
  WHERE cm.deleted_at IS NULL AND cm.removed_at IS NULL;
