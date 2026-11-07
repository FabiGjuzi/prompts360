-- 011_geoip_tasks.sql — the visitor country file (IP ranges -> country) and the dashboard's scheduled tasks.
--
-- geoip_ranges: one row per IP range. source 'feed' rows come from the IPtoASN country file (the bundled copy, then the daily refresh);
-- source 'manual' rows are made in the dashboard and are never touched by a refresh. On overlap the manual (and then the smallest) range wins.
CREATE TABLE geoip_ranges (
  id       bigserial PRIMARY KEY,
  ip_from  inet NOT NULL,
  ip_to    inet NOT NULL,
  country  char(2) NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  source   text NOT NULL DEFAULT 'manual' CHECK (source IN ('feed', 'manual')),
  CHECK (family(ip_from) = family(ip_to) AND ip_from <= ip_to)
);
CREATE INDEX geoip_ranges_from ON geoip_ranges (ip_from);
CREATE INDEX geoip_ranges_source ON geoip_ranges (source);

-- One row. `version` goes up on every change so every running instance reloads its in-memory copy.
CREATE TABLE geoip_meta (
  id              smallint PRIMARY KEY CHECK (id = 1),
  version         bigint NOT NULL DEFAULT 1,
  source_modified timestamptz,          -- when the upstream file was last published (its Last-Modified)
  source_etag     text,
  source_note     text,                 -- where the current feed rows came from (bundled file or URL)
  loaded_at       timestamptz,
  task_seeded     boolean NOT NULL DEFAULT false   -- the built-in refresh task was created once (deleting it later sticks)
);
INSERT INTO geoip_meta (id) VALUES (1);

-- Scheduled tasks. kind: 'api_call' (an HTTPS request) or 'geoip_refresh' (reload the country file).
-- schedule (JSON): {type:'once',at:ISO} | {type:'every',minutes:n} | {type:'daily',at:'HH:MM'} | {type:'weekly',days:[0-6],at:'HH:MM'} | {type:'follow',offset:minutes}
-- (clock times are New York time). config (JSON): url, method, body, timeout (api_call) or v4Url, v6Url (geoip_refresh).
-- headers_enc holds request headers encrypted with DATA_KEY (they may contain tokens) and is never shown again.
CREATE TABLE scheduled_tasks (
  id           bigserial PRIMARY KEY,
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  kind         text NOT NULL CHECK (kind IN ('api_call', 'geoip_refresh')),
  enabled      boolean NOT NULL DEFAULT true,
  schedule     jsonb NOT NULL,
  config       jsonb NOT NULL DEFAULT '{}',
  headers_enc  bytea,
  next_run     timestamptz,
  lease_until  timestamptz,             -- set while an instance is running the task, so two instances never run it twice
  last_run     timestamptz,
  last_ok      boolean,
  last_message text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scheduled_tasks_due ON scheduled_tasks (next_run) WHERE enabled;

CREATE TABLE task_runs (
  id          bigserial PRIMARY KEY,
  task_id     bigint NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  started_at  timestamptz NOT NULL,
  finished_at timestamptz,
  ok          boolean,
  trigger     text NOT NULL DEFAULT 'schedule',
  message     text
);
CREATE INDEX task_runs_task ON task_runs (task_id, id DESC);
