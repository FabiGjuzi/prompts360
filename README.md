# prompts360

A fast, minimal, Reddit-style community for AI/LLM prompts and discussion. It's anonymous by default: every account gets an `anon-xxxxxxxx` username unless the user picks another.

- **Browse** Hot / New / Top feeds (day, week, month, year, all), filter by AI model, search.
- **Communities**: any verified user creates one (`c/name`) and tags it with the AI model it's about.
- **Posts**: a title, an optional link and Markdown text (bold, italic, code, code blocks, quotes, lists, links).
- **Comments** are threaded and collapsible, with replies, editing and deleting.
- **Votes** on posts and comments update without a page reload, and voting also works with JavaScript off.
- **Accounts**: sign up with an optional username, email, the password twice and a captcha. The email link must be clicked before the first login. Logging in takes username, password and captcha. Forgot-password, change password and delete account are all there.
- **Moderation**: anyone can report; the superadmin dashboard (hidden URL, separate login) removes content, bans users and edits everything on the site: texts and slogan, pages, menus, AI models, communities, posts, with live visitor metrics, response times and logs.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Server | Node.js 24.7+, plain `node:http` (no framework) | Fewer dependencies means less attack surface and nothing to purge |
| Database | PostgreSQL 17+ | Keyset-paginated, partial indexes, full-text search, read replicas |
| Cache / sessions / rate limits | Valkey (Redis-compatible), our own 270-line client | Sub-millisecond, shared across instances, no library |
| Front end | 7 KB of hand-written CSS + 2 KB of JS, no frameworks | There's nothing third-party to purge. A full page is about 5 KB over the wire |
| Captcha | Cloudflare Turnstile (only on signup, login and forgot-password) | Free and privacy-friendly |
| Email | Gmail API over HTTPS (free) with a durable encrypted queue | Works where SMTP ports are blocked |

The only third-party library is `pg`, the PostgreSQL driver (about 160 KB), with 0 known vulnerabilities (`npm audit`). Everything else is our own code: the web server, the Valkey client, templates, Markdown, CSS and JS. Password hashing uses Node's built-in Argon2. See **CODE_MAP.md** for every file, function and setting.

## Run locally

```bash
docker compose up --build          # http://localhost:8080 — emails (verify links) print in the log
```

Without Docker you need Node.js 24.7 or newer, PostgreSQL and Valkey. Set `DATABASE_URL` and `VALKEY_URL`, then run `npm ci && npm start`.
Superadmin: set `ADMIN_PATH` (e.g. `/x-<24 random chars>`) and `ADMIN_BOOTSTRAP_HASH` (from `APP_SECRET=… node scripts/make-admin-hash.js`), then open that path. Optional `ADMIN_IP_ALLOW` (comma-separated IPs).

## Tests

```bash
npm test     # 28 tests: 12 end-to-end flows + 16 attack/security tests, against a real PostgreSQL + Valkey
```

Set `TEST_DATABASE_URL` and `TEST_VALKEY_URL` to point at a scratch database. The suite **drops and recreates** that database's schema.

## Performance (measured)

Measured on a 1,000,000-post, 2,000,000-comment database:

| Query | Time |
|---|---|
| Home / tag / community feeds (hot, new, top-all), any page depth | 0.1–0.5 ms |
| Post page comments, user profile, login lookup | 0.04–0.5 ms |
| Search (two-phase: recent scan, then GIN index) | 0.1–17 ms |
| Top of day/week (worst case, then cached 60 s) | 10–65 ms |

One Node process on a shared 2-vCPU box, with the database and load generator on the same box:

| Request | Throughput |
|---|---|
| Logged-out page (micro-cached) | about 45,000 req/s, median under 1 ms |
| Logged-in feed (personalised) | about 900 req/s per process |

100M views a day averages about 1,200 req/s, so a handful of instances covers it.

## Layout

```
src/server.js        request pipeline (headers, origin lock, throttle, sessions, CSRF, routing)
src/http.js          responses, body parsing, CSRF, caching, micro-cache
src/crypto.js        Argon2id (built-in), AES-256-GCM, HMAC email fingerprint, tokens
src/kv.js            our own Valkey/Redis client
src/session.js       Valkey sessions (2 h idle / 24 h max, browser-session cookie)
src/ratelimit.js     shared rate limits + per-IP flood guard
src/mail.js          encrypted outbox + Gmail/Resend transports + templates
src/markdown.js      safe Markdown renderer
src/views.js         all HTML (escape-by-default templates)
src/routes/*.js      auth, forum (+ CMS pages)
src/admin/           superadmin dashboard: auth, CRUD engine, metrics views, import, texts
src/site.js          editable texts / menus / pages (DB overrides over code defaults)
src/metrics.js       aggregate request metrics (no IPs), event log
src/seo.js           robots.txt, sitemap.xml, JSON-LD
migrations/          SQL schema
public/              app.css, app.js, favicon.svg, logo-*.svg (generated)
scripts/             migrate, make-admin-hash, gen-keys, gmail-auth, build-logo (regenerates the animated logo)
```

See **DEPLOY.md** to go live, **SECURITY.md** for the threat model and test results, and **CODE_MAP.md** for a guide to every file, function, variable and setting.
