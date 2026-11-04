-- Community descriptions are rich text (stored as Markdown): allow more room than the old 1,000 characters.
ALTER TABLE communities DROP CONSTRAINT IF EXISTS communities_description_check;
ALTER TABLE communities ADD CONSTRAINT communities_description_check CHECK (char_length(description) <= 4000);
