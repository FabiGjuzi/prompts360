-- 009_drafts_seo.sql — hidden drafts and per-post SEO fields.
-- A draft is hidden by the SAME mechanism as an admin-removed post (removed_at is set), so every feed, search, profile,
-- count, sitemap and points query that already skips removed posts skips drafts too. `draft` records WHY it is hidden;
-- publishing clears both. The CHECK keeps the two in step so a draft can never become visible by accident.
ALTER TABLE posts
  ADD COLUMN draft     boolean  NOT NULL DEFAULT false,
  ADD COLUMN wave      smallint CHECK (wave IS NULL OR wave BETWEEN 1 AND 99),
  ADD COLUMN seo_title text     CHECK (seo_title IS NULL OR char_length(seo_title) <= 120),
  ADD COLUMN seo_desc  text     CHECK (seo_desc  IS NULL OR char_length(seo_desc)  <= 300),
  ADD CONSTRAINT posts_draft_is_hidden CHECK (NOT draft OR removed_at IS NOT NULL);
CREATE INDEX posts_drafts ON posts (wave, id) WHERE draft;
