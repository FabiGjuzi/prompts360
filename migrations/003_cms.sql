-- prompts360 schema v3: content management, superadmin account, metrics and event log.
-- Conventions as before: only bound parameters, no IP addresses stored anywhere.

-- ---------- Editable site content ----------
-- Overrides for the texts/settings registry in src/site.js. A missing key means "use the built-in default".
CREATE TABLE site_settings (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z0-9_.]{1,60}$'),
  value       text        NOT NULL DEFAULT '' CHECK (char_length(value) <= 20000),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Header and footer links.
CREATE TABLE nav_links (
  id       integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  area     text    NOT NULL CHECK (area IN ('header', 'footer')),
  label    text    NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  url      text    NOT NULL CHECK (char_length(url) BETWEEN 1 AND 500),
  sort     integer NOT NULL DEFAULT 0,
  enabled  boolean NOT NULL DEFAULT true
);
INSERT INTO nav_links (area, label, url, sort) VALUES
  ('header', 'Communities', '/communities', 10),
  ('footer', 'Search',      '/search',      10),
  ('footer', 'Communities', '/communities', 20),
  ('footer', 'Privacy',     '/privacy',     30),
  ('footer', 'Terms',       '/terms',       40);

-- Free-form pages served at /<slug> (Privacy, Terms, About, FAQ …). Body is Markdown.
CREATE TABLE pages (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug              text        NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$'),
  title             text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body              text        NOT NULL DEFAULT '' CHECK (char_length(body) <= 100000),
  meta_description  text        NOT NULL DEFAULT '' CHECK (char_length(meta_description) <= 300),
  published         boolean     NOT NULL DEFAULT true,
  noindex           boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pages_slug ON pages (slug);

INSERT INTO pages (slug, title, meta_description, body) VALUES
('privacy', 'Privacy', 'What prompts360 stores, what it does not store, and how visitor statistics are counted.',
$$## What we store

Your username, a one-way keyed fingerprint of your email (never the address itself, so we can find your account when you type it for verification or a password reset, but can't read it back), a one-way Argon2id hash of your password, and the posts, comments, communities and votes you create.

## What we don't store

Your IP address, your real name, or tracking cookies. The only cookie is a session cookie that ends when you close your browser or after 2 hours of inactivity.

## Visitor statistics

To keep the site fast and safe we count visits in aggregate: page views, unique visitors per day and response times. Counting uses a one-way salted hash that exists only in the server's memory, is replaced every day, is never written to the database and is never linked to an account. There are no advertising or third-party analytics trackers.

## Third parties

Cloudflare (network protection and captcha) and Google Gmail (sending account emails) process data on our behalf.

## Your rights

You can delete your account and all your content at any time from Settings.$$),
('terms', 'Terms', 'The rules for using prompts360: be civil, no illegal content, spam or harassment.',
$$## Rules

Be civil. No illegal content, spam, harassment, malware, or sharing of other people's private information.

## Moderation

The administrator may remove content or suspend accounts that break these rules.

## Content

Content is provided as-is by users. Prompts you post may be copied and reused by others, so only post what you are happy to share.$$);

-- ---------- AI model tags become landing pages ----------
ALTER TABLE ai_tags
  ADD COLUMN description text    NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  ADD COLUMN seo_title   text    NOT NULL DEFAULT '' CHECK (char_length(seo_title) <= 120),
  ADD COLUMN seo_desc    text    NOT NULL DEFAULT '' CHECK (char_length(seo_desc) <= 300),
  ADD COLUMN enabled     boolean NOT NULL DEFAULT true;

UPDATE ai_tags SET description = CASE slug
  WHEN 'chatgpt'          THEN 'Prompts, custom instructions and tips for ChatGPT and OpenAI models: writing, coding, analysis and everyday work.'
  WHEN 'claude'           THEN 'Prompts and techniques for Anthropic''s Claude: long documents, careful reasoning, structured output and code.'
  WHEN 'gemini'           THEN 'Prompts for Google Gemini: multimodal questions, long context, research and Workspace tasks.'
  WHEN 'grok'             THEN 'Prompts for xAI''s Grok: current events, direct answers and informal analysis.'
  WHEN 'llama'            THEN 'Prompts and system messages for Meta''s Llama models, hosted or running on your own machine.'
  WHEN 'mistral'          THEN 'Prompts for Mistral models: concise instructions, multilingual work and function calling.'
  WHEN 'deepseek'         THEN 'Prompts for DeepSeek models: step-by-step reasoning, maths and code.'
  WHEN 'qwen'             THEN 'Prompts for Alibaba''s Qwen models: multilingual tasks, coding and structured data extraction.'
  WHEN 'copilot'          THEN 'Prompts for Microsoft Copilot across Windows, Edge, Word, Excel, PowerPoint and Outlook.'
  WHEN 'perplexity'       THEN 'Search-style prompts for Perplexity: sourced answers, comparisons and fast research.'
  WHEN 'midjourney'       THEN 'Image prompts and parameter tricks for Midjourney: style, composition, lighting and consistency.'
  WHEN 'stable-diffusion' THEN 'Image prompts for Stable Diffusion and Flux: weights, negative prompts, samplers and LoRAs.'
  WHEN 'local'            THEN 'Open-source and local models: system prompts, chat templates and settings that make small models behave.'
  WHEN 'general'          THEN 'Prompts that work across models: frameworks, patterns and habits for getting better answers from any AI.'
  ELSE '' END;

-- ---------- The site's own account ----------
-- Content created from the dashboard is attributed to this account. It has no password and no email, so nobody can log in as it.
INSERT INTO users (username, verified_at) VALUES ('prompts360', now());

-- ---------- Superadmin ----------
-- One row. Separate from forum users: its own login, its own session cookie, its own hidden URL (ADMIN_PATH).
-- The row is created at boot from ADMIN_BOOTSTRAP_HASH (an Argon2id hash; the password itself never reaches the server).
CREATE TABLE admin_account (
  id             smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pass_hash      text        NOT NULL,
  changed_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

-- ---------- Aggregate metrics (no IPs, no user ids, no individual visitors) ----------
CREATE TABLE metrics_minute (
  ts          timestamptz PRIMARY KEY,                       -- start of the minute
  requests    integer NOT NULL DEFAULT 0,
  pages       integer NOT NULL DEFAULT 0,                    -- HTML page views
  bots        integer NOT NULL DEFAULT 0,                    -- requests whose user-agent looks automated
  s2xx integer NOT NULL DEFAULT 0, s3xx integer NOT NULL DEFAULT 0, s4xx integer NOT NULL DEFAULT 0, s5xx integer NOT NULL DEFAULT 0,
  limited     integer NOT NULL DEFAULT 0,                    -- refused by rate limits / flood guard
  csrf_fail   integer NOT NULL DEFAULT 0,
  ms_sum      bigint  NOT NULL DEFAULT 0,
  ms_max      integer NOT NULL DEFAULT 0,
  h0 integer NOT NULL DEFAULT 0, h1 integer NOT NULL DEFAULT 0, h2 integer NOT NULL DEFAULT 0, h3 integer NOT NULL DEFAULT 0,
  h4 integer NOT NULL DEFAULT 0, h5 integer NOT NULL DEFAULT 0, h6 integer NOT NULL DEFAULT 0, h7 integer NOT NULL DEFAULT 0,
  rss_mb      integer NOT NULL DEFAULT 0,
  heap_mb     integer NOT NULL DEFAULT 0,
  lag_ms      integer NOT NULL DEFAULT 0,                    -- event-loop delay, 99th percentile
  cpu_pct     integer NOT NULL DEFAULT 0,
  db_ms       integer NOT NULL DEFAULT 0                     -- time of a trivial query
);

CREATE TABLE metrics_day (
  day        date PRIMARY KEY,
  visitors   integer NOT NULL DEFAULT 0,                     -- approximate unique visitors (see src/metrics.js)
  pageviews  integer NOT NULL DEFAULT 0,
  bot_hits   integer NOT NULL DEFAULT 0
);

CREATE TABLE metrics_route (
  day     date    NOT NULL,
  route   text    NOT NULL,
  hits    integer NOT NULL DEFAULT 0,
  ms_sum  bigint  NOT NULL DEFAULT 0,
  ms_max  integer NOT NULL DEFAULT 0,
  errors  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, route)
);

CREATE TABLE metrics_page (
  day    date    NOT NULL,
  path   text    NOT NULL CHECK (char_length(path) <= 200),
  views  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
);

-- ---------- Event log (errors, security events, admin actions) ----------
CREATE TABLE event_log (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts       timestamptz NOT NULL DEFAULT now(),
  level    text NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  kind     text NOT NULL CHECK (char_length(kind) <= 30),
  message  text NOT NULL CHECK (char_length(message) <= 1000),
  meta     jsonb
);
CREATE INDEX event_log_ts   ON event_log (ts DESC);
CREATE INDEX event_log_kind ON event_log (kind, ts DESC);
