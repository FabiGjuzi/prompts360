-- prompts360 schema v1
-- Conventions:
--   * Every user-supplied value is inserted with bound parameters ($1, $2 ...) — never string-built SQL.
--   * Private data (email) is stored AES-256-GCM encrypted (email_enc) plus an HMAC-SHA256
--     "blind index" (email_bidx) so we can look it up without ever storing it in plaintext.
--   * Passwords are Argon2id hashes (PHC string, peppered). Email/reset tokens are stored as SHA-256 hashes.
--   * IP addresses are never stored in the database.
--   * Feed indexes are partial (visible rows only) and keyed for keyset pagination (no OFFSET scans).

CREATE TABLE users (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username         text        NOT NULL,
  email_enc        bytea,
  email_bidx       bytea,
  pass_hash        text,
  is_admin         boolean     NOT NULL DEFAULT false,
  verified_at      timestamptz,
  banned_at        timestamptz,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_username_format CHECK (username ~ '^[A-Za-z0-9_-]{3,20}$')
);
CREATE UNIQUE INDEX users_username_lower ON users (lower(username));
CREATE UNIQUE INDEX users_email_bidx ON users (email_bidx) WHERE email_bidx IS NOT NULL;
CREATE INDEX users_unverified ON users (created_at) WHERE verified_at IS NULL AND deleted_at IS NULL;

CREATE TABLE ai_tags (
  id    smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug  text     NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{1,30}$'),
  name  text     NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  sort  smallint NOT NULL DEFAULT 0
);

INSERT INTO ai_tags (slug, name, sort) VALUES
  ('chatgpt',          'ChatGPT / OpenAI',        10),
  ('claude',           'Claude',                  20),
  ('gemini',           'Gemini',                  30),
  ('grok',             'Grok',                    40),
  ('llama',            'Llama / Meta AI',         50),
  ('mistral',          'Mistral',                 60),
  ('deepseek',         'DeepSeek',                70),
  ('qwen',             'Qwen',                    80),
  ('copilot',          'Microsoft Copilot',       90),
  ('perplexity',       'Perplexity',             100),
  ('midjourney',       'Midjourney',             110),
  ('stable-diffusion', 'Stable Diffusion / Flux',120),
  ('local',            'Open-source & local',    130),
  ('general',          'Multi-model / General',  140);

CREATE TABLE communities (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         text        NOT NULL CHECK (name ~ '^[A-Za-z0-9_]{3,21}$'),
  title        text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  description  text        NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  ai_tag_id    smallint    NOT NULL REFERENCES ai_tags(id),
  creator_id   bigint      REFERENCES users(id) ON DELETE SET NULL,
  post_count   integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  removed_at   timestamptz
);
CREATE UNIQUE INDEX communities_name_lower ON communities (lower(name));
CREATE INDEX communities_popular ON communities (post_count, id) WHERE removed_at IS NULL;
CREATE INDEX communities_new     ON communities (id) WHERE removed_at IS NULL;
CREATE INDEX communities_tag_pop ON communities (ai_tag_id, post_count, id) WHERE removed_at IS NULL;
CREATE INDEX communities_tag_new ON communities (ai_tag_id, id) WHERE removed_at IS NULL;

-- Reddit-style "hot" rank: log-scaled score plus time decay (45000 s ≈ 12.5 h per order of magnitude).
CREATE FUNCTION hot_rank(score integer, created timestamptz) RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT round((sign(score) * log(greatest(abs(score), 1))
               + (extract(epoch FROM created) - 1767225600) / 45000.0)::numeric, 7)::double precision
$$;

CREATE TABLE posts (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  community_id   bigint      NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  ai_tag_id      smallint    NOT NULL REFERENCES ai_tags(id),
  author_id      bigint      REFERENCES users(id) ON DELETE SET NULL,
  title          text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  url            text        CHECK (url IS NULL OR char_length(url) <= 2000),
  body           text        NOT NULL DEFAULT '' CHECK (char_length(body) <= 40000),
  score          integer     NOT NULL DEFAULT 1,
  comment_count  integer     NOT NULL DEFAULT 0,
  hot            double precision NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  edited_at      timestamptz,
  deleted_at     timestamptz,
  removed_at     timestamptz,
  search         tsvector GENERATED ALWAYS AS (
                   setweight(to_tsvector('english', title), 'A') ||
                   setweight(to_tsvector('english', left(body, 10000)), 'B')) STORED
);
-- Keyset-paginated feeds (scanned backward for DESC order); partial = only visible posts.
CREATE INDEX posts_hot       ON posts (hot, id)                    WHERE deleted_at IS NULL AND removed_at IS NULL;
CREATE INDEX posts_new       ON posts (id)                         WHERE deleted_at IS NULL AND removed_at IS NULL;
CREATE INDEX posts_top       ON posts (score, id)                  WHERE deleted_at IS NULL AND removed_at IS NULL;
CREATE INDEX posts_c_hot     ON posts (community_id, hot, id)      WHERE deleted_at IS NULL AND removed_at IS NULL;
CREATE INDEX posts_c_new     ON posts (community_id, id)           WHERE deleted_at IS NULL AND removed_at IS NULL;
CREATE INDEX posts_c_top     ON posts (community_id, score, id)    WHERE deleted_at IS NULL AND removed_at IS NULL;
CREATE INDEX posts_t_hot     ON posts (ai_tag_id, hot, id)         WHERE deleted_at IS NULL AND removed_at IS NULL;
CREATE INDEX posts_t_new     ON posts (ai_tag_id, id)              WHERE deleted_at IS NULL AND removed_at IS NULL;
CREATE INDEX posts_t_top     ON posts (ai_tag_id, score, id)       WHERE deleted_at IS NULL AND removed_at IS NULL;
CREATE INDEX posts_created   ON posts (created_at)                 WHERE deleted_at IS NULL AND removed_at IS NULL;
CREATE INDEX posts_author    ON posts (author_id, id)              WHERE deleted_at IS NULL AND removed_at IS NULL;
CREATE INDEX posts_search    ON posts USING gin (search)           WHERE deleted_at IS NULL AND removed_at IS NULL;

CREATE TABLE comments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id     bigint      NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  parent_id   bigint      REFERENCES comments(id) ON DELETE CASCADE,
  author_id   bigint      REFERENCES users(id) ON DELETE SET NULL,
  depth       smallint    NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 50),
  body        text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  score       integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  edited_at   timestamptz,
  deleted_at  timestamptz,
  removed_at  timestamptz
);
CREATE INDEX comments_post   ON comments (post_id, score DESC, id);
CREATE INDEX comments_parent ON comments (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX comments_author ON comments (author_id, id) WHERE deleted_at IS NULL AND removed_at IS NULL;

CREATE TABLE post_votes (
  user_id  bigint   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id  bigint   NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  value    smallint NOT NULL CHECK (value IN (-1, 1)),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX post_votes_post ON post_votes (post_id);

CREATE TABLE comment_votes (
  user_id     bigint   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id  bigint   NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  value       smallint NOT NULL CHECK (value IN (-1, 1)),
  PRIMARY KEY (user_id, comment_id)
);
CREATE INDEX comment_votes_comment ON comment_votes (comment_id);

CREATE TABLE reports (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reporter_id   bigint      REFERENCES users(id) ON DELETE SET NULL,
  post_id       bigint      REFERENCES posts(id) ON DELETE CASCADE,
  comment_id    bigint      REFERENCES comments(id) ON DELETE CASCADE,
  community_id  bigint      REFERENCES communities(id) ON DELETE CASCADE,
  reason        text        NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  resolved_by   bigint      REFERENCES users(id) ON DELETE SET NULL,
  CHECK (num_nonnulls(post_id, comment_id, community_id) = 1)
);
CREATE INDEX reports_open ON reports (id) WHERE resolved_at IS NULL;
CREATE UNIQUE INDEX reports_once ON reports (reporter_id, coalesce(post_id, 0), coalesce(comment_id, 0), coalesce(community_id, 0));

-- Single-use email tokens (verify / reset). Only the SHA-256 of the token is stored.
CREATE TABLE auth_tokens (
  token_hash  bytea       PRIMARY KEY,
  user_id     bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text        NOT NULL CHECK (purpose IN ('verify', 'reset')),
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user ON auth_tokens (user_id, purpose);
CREATE INDEX auth_tokens_exp  ON auth_tokens (expires_at);

-- Durable email queue. The whole message (recipient included) is AES-256-GCM encrypted; rows are deleted once sent.
CREATE TABLE email_outbox (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payload_enc      bytea       NOT NULL,
  attempts         smallint    NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_outbox_due ON email_outbox (next_attempt_at);
