-- Reposts (quote posts) and in-site notifications.
-- A repost is a normal post (own votes, comments, community, model tag) that embeds another post as a card.
-- The embedded post is always the original ("root"), never another repost.
ALTER TABLE posts ADD COLUMN repost_of bigint REFERENCES posts(id) ON DELETE SET NULL;
CREATE INDEX posts_repost_of ON posts (repost_of, id) WHERE repost_of IS NOT NULL AND deleted_at IS NULL AND removed_at IS NULL;
-- One live repost of the same post per person.
CREATE UNIQUE INDEX posts_one_repost_per_user ON posts (author_id, repost_of) WHERE repost_of IS NOT NULL AND deleted_at IS NULL AND removed_at IS NULL;

CREATE TABLE notifications (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- who is told
  kind        text        NOT NULL CHECK (kind IN ('repost')),
  actor_id    bigint      REFERENCES users(id) ON DELETE SET NULL,           -- who did it
  post_id     bigint      REFERENCES posts(id) ON DELETE CASCADE,            -- the repost
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX notifications_user   ON notifications (user_id, id DESC);
CREATE INDEX notifications_unread ON notifications (user_id) WHERE read_at IS NULL;
