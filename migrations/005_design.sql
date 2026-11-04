-- Site design editor: one working draft (edited in the dashboard) and an append-only history of published versions.
-- The live design is the newest published version; no versions = the built-in design.
CREATE TABLE design_draft (
  id         smallint PRIMARY KEY CHECK (id = 1),
  data       jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE design_versions (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  note       text        NOT NULL DEFAULT '' CHECK (char_length(note) <= 300),
  data       jsonb       NOT NULL
);
