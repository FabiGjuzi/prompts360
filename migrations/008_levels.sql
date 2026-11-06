-- 008_levels.sql — level tiers and the community-creation requirement become editable from the dashboard.
CREATE TABLE levels (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text    NOT NULL CHECK (length(name) BETWEEN 1 AND 30),
  min_points integer NOT NULL CHECK (min_points >= 0)
);
CREATE UNIQUE INDEX levels_min_points ON levels (min_points);
CREATE UNIQUE INDEX levels_name ON levels (lower(name));
INSERT INTO levels (name, min_points) VALUES ('Newcomer', 0), ('Explorer', 25), ('Contributor', 75), ('Builder', 150), ('Expert', 500), ('Legend', 1500);

CREATE TABLE points_settings (
  id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  community_min integer NOT NULL DEFAULT 150 CHECK (community_min >= 0)
);
INSERT INTO points_settings DEFAULT VALUES;
