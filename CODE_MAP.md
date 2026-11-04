# Code map

Every file, function and important variable in prompts360, in one place. Each function also has a comment directly above it in the source; the tables below are generated from those comments.

**Third-party code:** one library, `pg` (the PostgreSQL driver, about 160 KB). Everything else is in this repo: the web server, the Valkey client (`src/kv.js`), password hashing (Node's built-in `crypto.argon2`), templates, Markdown, and all CSS and JS. There are no front-end frameworks or plugins.

**Why `pg` stays:** it speaks PostgreSQL's login (SCRAM) and wire protocol. Hand-writing that would put new, hard-to-test code under every query. If you ever want to drop it, only `src/db.js` needs to change.

## Request flow

1. `server.js handle()` sets the security headers, answers `/healthz`, checks the origin lock, serves static files, and applies the per-IP flood limit.
2. Logged-out `GET`s without cookies are served from the micro-cache if a fresh copy exists (`http.js serveMicro`).
3. The URL is matched against the route table (built from `admin/index.js`, `routes/auth.js`, `routes/forum.js`, with the catch-all CMS page route last).
4. The session cookie is looked up in Valkey (`session.js loadSession`) to get the logged-in user (or none).
5. Routes marked `auth` require a user. Dashboard routes use `admin: 'open'|'required'` (its own session cookie, CSRF and 404-when-not-logged-in).
6. `POST`s: the body is read with a size limit (`http.js readBody`) and the CSRF check runs (`checkCsrf`).
7. The route handler runs, queries PostgreSQL through `db.js`, and returns a page built from `views.js` via `http.js page()` (or a redirect).

## Route table

A route is `[method, URL pattern, handler, options]`. Options: `auth: 'user' | 'admin'` (login required), `form: 'user' | 'anon'` (which CSRF token the form carries), `bodyLimit` (max POST bytes, default 16 KB).

| Method | URL | Handler | Options |
|---|---|---|---|
| GET | `/signup` | `signupGet` |  |
| POST | `/signup` | `signupPost` | `{ form: 'anon' }` |
| GET | `/verify` | `verifyGet` |  |
| POST | `/verify` | `verifyPost` | `{ form: 'anon' }` |
| GET | `/resend` | `resendGet` |  |
| POST | `/resend` | `resendPost` | `{ form: 'anon' }` |
| GET | `/login` | `loginGet` |  |
| POST | `/login` | `loginPost` | `{ form: 'anon' }` |
| POST | `/logout` | `logoutPost` | `{ form: 'user', auth: 'user' }` |
| GET | `/forgot` | `forgotGet` |  |
| POST | `/forgot` | `forgotPost` | `{ form: 'anon' }` |
| GET | `/reset` | `resetGet` |  |
| POST | `/reset` | `resetPost` | `{ form: 'anon' }` |
| GET | `/settings` | `settingsGet` | `{ auth: 'user' }` |
| POST | `/settings/password` | `settingsPassword` | `{ form: 'user', auth: 'user' }` |
| POST | `/settings/delete` | `settingsDelete` | `{ form: 'user', auth: 'user' }` |
| GET | `/` | `home` |  |
| GET | `/c/:name` | `communityPage` |  |
| GET | `/communities` | `communitiesList` |  |
| GET | `/communities/new` | `communityNewGet` | `{ auth: 'user' }` |
| POST | `/communities/new` | `communityNewPost` | `{ form: 'user', auth: 'user' }` |
| GET | `/submit` | `submitGet` | `{ auth: 'user' }` |
| POST | `/submit` | `submitPost` | `{ form: 'user', auth: 'user', bodyLimit: 200_000 }` |
| GET | `/p/:id` | `postPage` |  |
| POST | `/p/:id/edit` | `postEdit` | `{ form: 'user', auth: 'user', bodyLimit: 200_000 }` |
| POST | `/p/:id/delete` | `postDelete` | `{ form: 'user', auth: 'user' }` |
| POST | `/p/:id/comment` | `commentCreate` | `{ form: 'user', auth: 'user', bodyLimit: 60_000 }` |
| POST | `/comment/:id/edit` | `commentEdit` | `{ form: 'user', auth: 'user', bodyLimit: 60_000 }` |
| POST | `/comment/:id/delete` | `commentDelete` | `{ form: 'user', auth: 'user' }` |
| POST | `/vote` | `vote` | `{ form: 'user', auth: 'user' }` |
| POST | `/report` | `report` | `{ form: 'user', auth: 'user' }` |
| GET | `/u/:name` | `profile` |  |
| GET | `/search` | `search` |  |
| GET | `/privacy` | `legal('privacy')` |  |
| GET | `/terms` | `legal('terms')` |  |
| GET | `/admin` | `reportsPage` | `{ auth: 'admin' }` |
| POST | `/admin/remove` | `remove` | `{ form: 'user', auth: 'admin' }` |
| POST | `/admin/dismiss` | `dismiss` | `{ form: 'user', auth: 'admin' }` |
| POST | `/admin/ban` | `setBan(true)` | `{ form: 'user', auth: 'admin' }` |
| POST | `/admin/unban` | `setBan(false)` | `{ form: 'user', auth: 'admin' }` |
| POST | `/admin/tag` | `saveTag` | `{ form: 'user', auth: 'admin' }` |

## Functions by file

### `src/server.js` — Entry point + request pipeline

| Function | What it does |
|---|---|
| `clientIp` | The visitor's IP: the proxy header (e.g. do-connecting-ip) only when the request is verified, otherwise the socket address. |
| `handle` | The request pipeline: security headers -> health check -> origin lock -> static assets -> flood throttle -> micro-cache -> routing -> session -> auth checks -> body + CSRF check -> handler. |
| `onRequest` | Wrap handle() so any thrown error becomes a safe error page (no stack traces or SQL ever reach the client). |
| `createServer` | Build the HTTP server with header-size and timeout limits tuned against slow-client attacks. |
| `startWorker` | Connect Valkey, start listening, start the background jobs (email queue, cleanup) and wire graceful shutdown. |
| `cleanup` | Background housekeeping every 10 minutes: delete expired tokens and unverified accounts older than 48 hours. |

### `src/config.js` — All settings, read from environment variables

| Function | What it does |
|---|---|
| `req` | Read a required environment variable. In production a missing value aborts startup; in dev/test `fallbackForDev` is used. |
| `int` | Read an integer environment variable, falling back to `def` when unset or not a number. |

### `src/http.js` — Responses, body parsing, CSRF, caching, security headers

| Function | What it does |
|---|---|
| `HttpError` | Error carrying an HTTP status; thrown by handlers and turned into an error page by server.js. |
| `securityHeaders` | Set the security response headers (CSP, HSTS, nosniff, framing, referrer, permissions). `turnstile` additionally allows Cloudflare's captcha script and frame. |
| `encodingFor` | Pick the best response compression the browser accepts: 'br', 'gzip' or null. |
| `compress` | Compress a Buffer with the chosen encoding (brotli quality 4 / gzip level 6: fast, good ratio). |
| `serveMicro` | Serve a recently rendered logged-out page from the in-process micro-cache if one exists. Returns true when it handled the request. |
| `storeMicro` | Remember a rendered logged-out page for MICROCACHE_SEC seconds (bounded to 2000 entries, oldest evicted first). |
| `redirect` | Send a redirect (303 by default so a POST becomes a GET) and end the response. |
| `json` | Send a JSON response (used by the no-reload vote buttons). |
| `renderError` | Send an error as a normal page, or as JSON when the request came from fetch(). |
| `readBody` | Read and parse a urlencoded POST body with a hard size limit. Returns a prototype-less object; first value wins on duplicate keys; control characters are stripped. |
| `str` | Coerce a value to a string of at most `max` characters ('' if it isn't a string). |

### `src/session.js` — Login sessions in Valkey

| Function | What it does |
|---|---|
| `skey` | Valkey key for a session: SHA-256 of the cookie token (the raw token is never stored). |
| `ukey` | Valkey key of the set that lists all of one user's sessions (so they can be revoked together). |
| `cookieHeader` | Set-Cookie value for a session: HttpOnly, SameSite=Lax, Secure in production, and no Max-Age (so it ends when the browser closes). |
| `clearCookieHeader` | Set-Cookie value that deletes the session cookie. |
| `createSession` | Start a session for `user` ({id, username, is_admin}); returns the random token to put in the cookie. |
| `destroySession` | End one session (logout). |
| `readCookie` | Pull one cookie value out of the request's Cookie header (null if absent or the header is oversized). |

### `src/crypto.js` — Encryption, hashing, tokens

| Function | What it does |
|---|---|
| `derive` | HKDF-derive an independent 32-byte sub-key from APP_SECRET for one purpose (`label`), so keys never overlap. |
| `encrypt` | AES-256-GCM encrypt `plaintext`. `aad` (additional authenticated data) binds the ciphertext to its purpose. Returns [key id][12-byte IV][16-byte tag][ciphertext]. |
| `decrypt` | Reverse of encrypt(): returns the plaintext, or null if the blob is too short or its key id is unknown. Throws if the data or `aad` was tampered with. |
| `hmac` | HMAC-SHA256 of `data` under `key` (returns a 32-byte Buffer). |
| `normalizeEmail` | Canonical form of an email for fingerprinting and sending: trimmed, lower-cased, Unicode-normalised (NFKC). |
| `randomToken` | Cryptographically random URL-safe token (default 32 bytes = 256 bits, base64url). |
| `safeEqual` | Constant-time string comparison (prevents timing attacks when comparing secrets). |
| `withSlot` | Run `fn` when one of the `argonConcurrency` hashing slots is free; queue the rest (max 200 waiting, then reject with 503). |
| `b64` | Base64 without trailing '=' padding, as used inside PHC password-hash strings. |
| `burnPasswordTime` | Spend the same time as a real password check (against a dummy hash) so response time can't reveal whether a username exists. Always returns false. |
| `checkFormToken` | Validate a signed logged-out form token: correct shape, genuine signature, and not yet expired. |
| `sha256` | SHA-256 digest of `data` (a 32-byte Buffer); used to store tokens so a database leak doesn't reveal them. |

### `src/db.js` — PostgreSQL pools, transactions, migrations

| Function | What it does |
|---|---|
| `stripSslParams` | Remove ssl-related query parameters from a connection URL; TLS is configured in code by tlsOptions() instead. |
| `makePool` | Create a pg connection pool for `url` with TLS, a connection cap and per-query time limits. |
| `one` | Run a parameterised query on the primary and return the first row (or null). |
| `closeDb` | Close both connection pools (shutdown and tests). |

### `src/kv.js` — Our own Valkey/Redis client (no library)

Commands mirror the common Redis client names: `get`, `set(key, value, {EX})`, `del`, `expire`, `hSet`, `hGet`, `hGetAll`, `sAdd`, `sRem`, `sMembers`, `eval`, `keys`, `flushDb`, `multi().…exec()`, `connect`, `quit`. Also `RespParser` (incremental reply parser), `encode()` (command writer), `connectKv`, `closeKv`, `cached(key, ttl, fn)`.

| Function | What it does |
|---|---|
| `constructor` | Remember the connection URL; the socket is opened later by connect(). |

### `src/ratelimit.js` — Rate limits and flood throttle

| Function | What it does |
|---|---|
| `hit` | Count one event for `key` and report whether it is still within `limit` per `windowSec`. Fails closed (not ok) if Valkey is down. Returns {ok, retryAfter, count}. |
| `peek` | Read a counter without incrementing it (used for the failed-login lockout check). |
| `reset` | Clear a counter (used after a successful login). |
| `ipThrottle` | In-process token bucket per IP: `burst` requests at once, refilling `perSec` per second. Returns false when the caller must be refused. |

### `src/mail.js` — Email queue, Gmail/Resend transports, templates

| Function | What it does |
|---|---|
| `drain` | Worker loop: lease up to 10 due messages at a time, send each, delete on success or reschedule with back-off (give up after 12 attempts). |
| `gmailAccessToken` | Exchange the stored refresh token for a short-lived Gmail access token (cached until a minute before expiry). |
| `b64h` | Encode a header value as an RFC 2047 UTF-8 'encoded word' so non-ASCII subjects survive. |
| `mime` | Build a multipart/alternative (plain text + HTML) email message as a raw MIME string. |
| `gmail` | Transport: send via the Gmail API over HTTPS. Flags quota errors (about 500/day on a personal account) so the queue backs off. |
| `resend` | Transport: send via the Resend HTTPS API (optional fallback; set RESEND_API_KEY). |
| `button` | HTML snippet for a call-to-action button plus the raw link underneath it. |
| `escMail` | Escape text for the HTML part of an email. |
| `queueEmail` | Add an email to the encrypted outbox (inside the caller's transaction if `client` is given) and wake the sender. msg = {to, subject, text, html}. |
| `send` | Deliver one message, trying each configured transport in order until one succeeds. |
| `wrap` | Wrap an email body in the shared HTML layout (title + footer). |

### `src/turnstile.js` — Captcha verification

| Function | What it does |
|---|---|
| `turnstileEnabled` | True when a Turnstile secret key is configured. |
| `verifyHuman` | Ask Cloudflare whether `token` is a real solved captcha for this form (`action`) and this site. Any error or timeout counts as 'not human'. |

### `src/validate.js` — Input validation rules

| Function | What it does |
|---|---|
| `genAnonName` | Random default username 'anon-' + 8 hex characters (32 bits). |
| `usernameProblem` | Return an error message if the username is invalid or reserved, else null. |
| `emailOk` | Practical email syntax check (length limits, one @, valid domain labels). |
| `intId` | Parse a positive integer id from a form string, or null. |

### `src/html.js` — Escape-by-default HTML templating helpers

| Function | What it does |
|---|---|
| `Raw` | Wrapper marking a string as already-safe HTML, so html`` won't escape it again. |
| `raw` | Mark `s` as trusted HTML. Use only for markup this code generated itself, never for user input. |
| `esc` | Escape the five HTML-significant characters. Safe in text and in double-quoted attribute values. |
| `render` | Convert one template value to safe HTML: null/false -> '', Raw -> as is, arrays -> joined, anything else -> escaped. |
| `html` | Tagged template literal: html`<p>${value}</p>`. Every interpolated value is escaped unless it is raw() or came from another html``. This is the core XSS defence. |
| `timeAgo` | Human-friendly relative time ('3h ago') from a date. |
| `plural` | '1 comment' / '2 comments'. |
| `slugify` | Lower-case ASCII slug for post URLs (/p/12/my_title). Purely cosmetic: the numeric id is what identifies a post. |

### `src/markdown.js` — Safe Markdown renderer

| Function | What it does |
|---|---|
| `emphasis` | Apply bold/italic/strikethrough to text that is ALREADY HTML-escaped. |
| `links` | Turn [label](https://…) and bare https:// URLs into rel=nofollow links; everything else is escaped. Only http(s) schemes are ever emitted. |
| `inline` | Render one line of inline Markdown: `code` spans are escaped verbatim, the rest goes through links() and emphasis(). |
| `markdown` | Render a Markdown string to safe HTML (paragraphs, headings, quotes, lists, rules, code blocks). Raw HTML in the input is never passed through. |

### `src/views.js` — All HTML pages and components

| Function | What it does |
|---|---|
| `csrfField` | Hidden CSRF input for logged-in forms (empty for visitors). |
| `formField` | Hidden signed token input for logged-out forms (login, signup, reset, …). |
| `captcha` | Cloudflare Turnstile widget for `action` (empty when no site key is configured). |
| `layout` | The full HTML page: head, header (logo + slogan + search + account menu), main column + sidebar, footer. |
| `sidebar` | Right-hand column: about box (home or community), AI model filter chips, sign-up prompt. |
| `author` | Link to a user's profile, or '[deleted]'. |
| `voteBox` | Up/down arrows with the score. Logged-in users get real forms (no-JS works; app.js upgrades them to in-place updates); visitors get login links. |
| `postList` | A list of post cards with vote boxes, plus a 'Next page' link when there are more. |
| `hostOf` | Domain shown next to link posts, e.g. 'example.com'. |
| `sortTabs` | Hot / New / Top tabs (plus time-window chips for Top). |
| `communityHeader` | Title block at the top of a community page. |
| `reportForm` | Collapsible 'report' form for a post, comment or community. |
| `postPage` | A single post: body, comment box, sort tabs and the comment tree. |
| `commentTree` | Recursively render nested comments with collapse, vote, reply, edit, delete and report controls. |
| `signupForm` | Sign-up page: username (placeholder = generated anon name), email, password twice, captcha. |
| `loginForm` | Login page: username, password, captcha, forgot/resend/sign-up links. |
| `forgotForm` | Forgot-password page: email + captcha. |
| `resendForm` | Resend-verification page: email + captcha. |
| `resetForm` | Choose-a-new-password page (reached from the emailed link). |
| `verifyForm` | Email verification confirmation button (a POST, so email-scanner bots can't consume the link). |
| `submitForm` | Create-post form. |
| `communityForm` | Create-community form with the AI model picker. |
| `communitiesPage` | Browse communities: Popular/New tabs, model filter, list. |
| `profilePage` | A user's profile with Posts / Comments tabs (and the ban button for admins). |
| `settingsPage` | Change password and delete account forms. |
| `searchPage` | Search box and results. |
| `adminPage` | Admin: open reports queue (remove / dismiss) and AI tag management. |
| `legalPage` | Privacy or Terms page (templates; have a lawyer review). |
| `errorPage` | Content of an error page. |
| `controls` | Edit / delete / report / admin-remove controls for a post or comment, shown according to who is looking. |
| `err` | Red error box for form pages (empty when there's no error). |

### `src/assets.js` — Static file build: minify, hash, compress

| Function | What it does |
|---|---|
| `minCss` | Minify CSS: strip comments and whitespace around punctuation (pure string work, no tooling needed). |
| `add` | Read one file from public/, transform it, content-hash its name, pre-compress it (brotli + gzip) and register it in `files`. Returns the public URL (/s/<name>.<hash>.<ext>). |

### `src/routes/auth.js` — Account routes

| Function | What it does |
|---|---|
| `tooMany` | Friendly 'try again in N minutes' message from a retry-after in seconds. |
| `issueToken` | Create a single-use email token (verify or reset), replacing any older one. Only its SHA-256 is stored; the raw token is returned for the link. |
| `consumeToken` | Atomically use up a token: returns {user_id} once, then never again (also null if expired or malformed). |
| `signupPost` | POST /signup — validate, hash the password, store the account (email fingerprint only), queue the verification email. Answers identically for already-registered emails. |
| `verifyPost` | POST /verify — consume the emailed token and mark the account verified. |
| `loginPost` | POST /login — captcha, rate limits, constant-time password check, lockout after repeated failures, then a brand-new session. |
| `logoutPost` | POST /logout — destroy the session and clear the cookie. |
| `forgotPost` | POST /forgot — if the typed email's fingerprint matches an account, email a 30-minute reset link; the page answers the same either way. |
| `resetGet` | GET /reset — new-password form for a reset link. |
| `resetPost` | POST /reset — consume the reset token, set the new password, sign out every session. |
| `resendPost` | POST /resend — send a fresh verification link if the typed email matches an unverified account (same answer either way). |
| `settingsPassword` | POST /settings/password — change password (needs the current one); signs out other sessions. |
| `settingsDelete` | POST /settings/delete — erase credentials and content; the username stays reserved. |
| `signupGet` | GET /signup — the sign-up form with a freshly generated anon username suggestion. |
| `verifyGet` | GET /verify — confirmation page for an emailed link (the actual verification is the POST, so link scanners can't use it up). |
| `loginGet` | GET /login — the login form. |
| `forgotGet` | GET /forgot — the forgot-password form. |
| `resendGet` | GET /resend — the resend-verification form. |
| `settingsGet` | GET /settings — change password / delete account. |

### `src/routes/forum.js` — Feeds, communities, posts, comments, votes, search

| Function | What it does |
|---|---|
| `tags` | All AI model tags (cached in-process for 60 s). |
| `resetTagCache` | Make the next tags() call reload from the database (after an admin edits tags). |
| `tagBySlug` | Find one AI tag by its slug, or null. |
| `parseSort` | Validate the ?sort= value (hot \| new \| top), defaulting to hot. |
| `parseWindow` | Validate the ?t= time window for Top (day \| week \| month \| year \| all), defaulting to day. |
| `parseCursor` | Parse the ?after= pagination cursor for the active sort; returns null if malformed. |
| `makeCursor` | Build the cursor for the NEXT page from the last post shown (keyset pagination). |
| `loadFeed` | Fetch one page of posts for the given filters/sort (keyset-paginated, index-backed, cached briefly for ranked feeds). Returns {posts, next}. |
| `pageOf` | Trim the fetched rows (we ask for PAGE+1) to one page and compute the next cursor. |
| `maxPostId` | Newest post id (cached 30 s); search uses it to bound its first phase. |
| `searchFeed` | Two-phase full-text search, newest first: scan the newest 20k posts, then fall back to the GIN index for rare words. |
| `myVotes` | Map of the logged-in user's votes for the given ids ({id -> 1 or -1}); empty for visitors. |
| `postVotes` | myVotes() for a list of posts. |
| `qs` | Build a '?a=1&b=2' query string, skipping empty values. |
| `communityPage` | GET /c/:name — a community's feed. |
| `communitiesList` | GET /communities — browse communities (popular/new, per AI model). |
| `communityNewGet` | GET /communities/new — the create-community form. |
| `communityNewPost` | POST /communities/new — validate and create a community (3 per user per day). |
| `submitPost` | POST /submit — create a post (rate-limited), auto-upvote it, bump the community's post count. |
| `postPage` | GET /p/:id — a post with its comment tree. |
| `postEdit` | POST /p/:id/edit — the author edits the body. |
| `postDelete` | POST /p/:id/delete — the author deletes their post (content erased, the row stays for the thread). |
| `commentEdit` | POST /comment/:id/edit — the author edits a comment. |
| `commentDelete` | POST /comment/:id/delete — the author deletes a comment. |
| `vote` | POST /vote — set, change or clear a vote on a post or comment. The target row is locked so the score can't drift under concurrent votes. |
| `search` | GET /search — rate-limited full-text search. |
| `legal` | Handler factory for the Privacy and Terms pages. |
| `home` | GET / — the front page feed, optionally filtered by AI model (?tag=), sorted Hot/New/Top. |
| `getCommunity` | Look up a live (not removed) community by name, case-insensitively, with its AI tag. |
| `submitGet` | GET /submit — the create-post form (optionally prefilled with ?c=community). |
| `commentCreate` | POST /p/:id/comment — add a comment or reply (rate-limited), auto-upvote it, bump the post's comment count. |
| `report` | POST /report — a user reports a post, comment or community for the admin queue. |
| `profile` | GET /u/:name — a user's public profile with their posts or comments. |

### `src/routes/admin.js` — Moderation routes

| Function | What it does |
|---|---|
| `reportsPage` | GET /admin — the open reports queue with a preview of each reported item. |
| `remove` | POST /admin/remove — hide a post, comment or whole community and resolve its reports. |
| `dismiss` | POST /admin/dismiss — close a report without removing anything. |
| `setBan` | Build the POST handler that bans or unbans a user (a ban also signs them out everywhere). |
| `saveTag` | POST /admin/tag — add an AI model tag, or rename an existing one. |

### `public/app.js` — in-browser enhancements (about 1.9 KB)

Votes update without reloading (falls back to a normal form post); comment threads collapse and expand; password fields show a live rule checker. Nothing breaks if JavaScript is off.

### `public/app.css` — the whole stylesheet (about 2 KB over the wire)

Sections are labelled in the file: variables, base, header, buttons, layout, cards, posts, votes, tabs, forms, comments, footer, responsive. Colours are CSS variables; dark mode swaps their values automatically.

### `scripts/` — command-line tools

| Script | Use |
|---|---|
| `migrate.js` | Apply pending database migrations, then exit. |
| `make-admin.js <user> [--revoke]` | Give or remove admin rights (also signs that user out). |
| `gen-keys.js` | Print fresh `APP_SECRET`, `DATA_KEY`, `ORIGIN_SECRET`. |
| `gmail-auth.js <id> <secret>` | One-time Gmail sending setup. |
| `build-logo.js` | Regenerate the animated logo SVGs in `public/`. |

## Configuration (environment variables)

All read once in `config.js` into the frozen `config` object. In production a missing required value stops the server at startup.

| Variable | `config` field | Meaning | Default |
|---|---|---|---|
| `NODE_ENV` | `isProd` | `production` turns on strict checks, Secure cookies, HSTS | dev |
| `PORT`, `HOST` | `port`, `host` | Listen address | 8080, 0.0.0.0 |
| `BASE_URL` (or Render's `RENDER_EXTERNAL_URL`) | `baseUrl` | Public https URL, used in emails and origin checks | required in prod |
| `SITE_NAME` | `siteName` | Name in titles and emails | prompts360 |
| `WEB_CONCURRENCY` | `workers` | Server processes per container | 1 |
| `DATABASE_URL` | `databaseUrl` | PostgreSQL connection string | local dev DB |
| `DATABASE_READ_URL` | `databaseReadUrl` | Optional read-replica connection | none |
| `DATABASE_CA_CERT` | `databaseCa` | Database CA certificate (PEM text or file path) | none |
| `DATABASE_TLS` | `databaseTls` | `off` only for a private network without TLS | verify |
| `DB_POOL_MAX` | `dbPoolMax` | Max connections per process | 20 |
| `DB_STARTUP_PARAMS` | (read in `db.js`) | `0` when behind PgBouncer | 1 |
| `VALKEY_URL` | `valkeyUrl` | `redis://` or `rediss://` (TLS) connection string | local dev |
| `VALKEY_CA_CERT` | `valkeyCa` | CA for a private-CA `rediss://` server | none |
| `APP_SECRET` | `appSecret` | Root secret for fingerprint, pepper, CSRF and form-token keys. **Never change after launch.** | dev key |
| `DATA_KEY`, `DATA_KEY_OLD` | `dataKey`, `dataKeyOld` | AES-256 key for queued emails, and the previous key during rotation | dev key |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | `turnstileSiteKey`, `turnstileSecret` | Cloudflare captcha | required in prod |
| `ORIGIN_SECRET` | `originSecret` | Header value that proves a request came through Cloudflare | none |
| `CLIENT_IP_HEADER` | `clientIpHeader` | Header holding the real visitor IP (`do-connecting-ip`, `cf-connecting-ip`) | none |
| `COOKIE_SECURE` | `cookieSecure` | Force Secure cookies outside production | on in prod |
| `SESSION_IDLE_SEC`, `SESSION_MAX_SEC` | `sessionIdleSec`, `sessionMaxSec` | Session idle timeout and hard limit | 2 h, 24 h |
| `ARGON_MEMORY_KIB`, `ARGON_TIME`, `ARGON_CONCURRENCY` | `argon.memoryCost`, `argon.timeCost`, `argonConcurrency` | Password-hash cost and max simultaneous hashes | 64 MiB, 3, 4 |
| `MAIL_TRANSPORT`, `MAIL_FROM` | `mail.transports`, `mail.from` | How and from whom to send email (`gmail`, `resend`, `console`; comma list = fallbacks) | gmail in prod |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | `mail.gmail*` | Gmail API credentials | none |
| `RESEND_API_KEY` | `mail.resendApiKey` | Optional fallback sender | none |
| `IP_BURST`, `IP_RATE` | `ipBurst`, `ipRate` | Per-IP flood guard: burst size, refill per second | 120, 4 |
| `EDGE_CACHE_SEC`, `MICROCACHE_SEC` | `edgeCacheSec`, `microCacheSec` | Seconds logged-out pages are cached at the CDN and in-process | 30, 5 |

## Database (PostgreSQL)

Schema is in `migrations/*.sql`, applied in order by `db.js migrate()`.

| Table | Holds | Key columns |
|---|---|---|
| `users` | Accounts | `username`, `email_bidx` (keyed email fingerprint, never the address), `pass_hash` (Argon2id), `is_admin`, `verified_at`, `banned_at`, `deleted_at` |
| `ai_tags` | AI model categories | `slug`, `name`, `sort` |
| `communities` | Topic spaces (`c/name`) | `name`, `title`, `description`, `ai_tag_id`, `creator_id`, `post_count`, `removed_at` |
| `posts` | Posts | `community_id`, `ai_tag_id`, `author_id`, `title`, `url`, `body`, `score`, `hot` (precomputed rank), `comment_count`, `search` (full-text vector), `deleted_at`, `removed_at` |
| `comments` | Threaded comments | `post_id`, `parent_id`, `author_id`, `depth`, `body`, `score`, `deleted_at`, `removed_at` |
| `post_votes`, `comment_votes` | One vote per user per item | `user_id`, item id, `value` (+1 or -1) |
| `reports` | User reports | `reporter_id`, one of `post_id`/`comment_id`/`community_id`, `reason`, `resolved_at` |
| `auth_tokens` | Single-use email links | `token_hash` (SHA-256), `user_id`, `purpose` (`verify`/`reset`), `expires_at` |
| `email_outbox` | Pending emails (encrypted) | `payload_enc`, `attempts`, `next_attempt_at` |
| `schema_migrations` | Which migrations ran | `version` |

`hot_rank(score, created)` is a SQL function computing the Hot ranking (see the Hot/New/Top explanation in the README). `deleted_at` means the author deleted it; `removed_at` means an admin removed it.

## Valkey keys

| Key | Value | Lifetime |
|---|---|---|
| `s:<sha256 of session token>` | hash `{u: user id, n: username, a: admin flag, t: start time}` | 2 h idle, 24 h max |
| `us:<user id>` | set of that user's session keys (for sign-out-everywhere) | 24 h |
| `rl:<name>:<id>` | rate-limit counter (see below) | the limit's window |
| `feed:<sort>:<window>:<community>:<tag>:<cursor>` | cached JSON page of posts | 10 s (60 s for windowed Top) |

Rate-limit names (`ratelimit.js LIMITS`): `signup`, `login`, `loginfail`, `forgot`, `forgot-e`, `resend-ip`, `resend-e`, `pwchange`, `post`, `postDay`, `comment`, `commentDay`, `vote`, `community`, `report`, `edit`, `search`.

## Naming conventions

- `req` is the incoming request, `res` the response. `req.user` is the logged-in user or `null`; `req.body` the parsed form; `req.query` the URL parameters; `req.ip` the visitor IP; `req.cookieToken` the raw session cookie.
- `q` / `qr` run a query on the primary / read replica; `one` returns a single row; `tx(fn)` runs `fn` inside a transaction.
- `bidx` is a keyed fingerprint (blind index) of an email; `_csrf` and `_ft` are the hidden form tokens; `ft` is a logged-out form token.
- `cursor` / `after` is the keyset-pagination marker for the next page.
- `p.` is the `posts` table alias in SQL, `c.` communities, `u.` users, `t.` ai_tags.


> `VALKEY_URL=memory` selects `MemoryClient` in `src/kv.js`: the same API as the Valkey client, kept in this process's memory (single-instance deploys only; data is lost on restart).


## Superadmin dashboard (`src/admin/`)
- `index.js` route table under `ADMIN_PATH`; `auth.js` separate login/session/password; `crud.js` generic table CRUD over a whitelist registry (`TABLES`); `pages.js` dashboard, live data, logs, texts, import, reports, account; `stats.js` metric queries; `ui.js` shell and SVG charts.
- `src/wys.js` + `public/editor.js` / `editor.css`: WYSIWYG editor for Markdown fields (post text, community description, all dashboard Markdown fields). The textarea is the no-JS fallback; the editor script converts its DOM to Markdown on submit (no innerHTML, pasted HTML dropped). Markdown supports `\*` style escapes.
- `src/site.js` (editable texts, menus, pages), `src/metrics.js` (per-minute aggregates, event log), `src/seo.js` (robots, sitemap, JSON-LD).
- Site design editor (dashboard → Site design): `src/design.js` (draft/live/versions, validation, per-request design via AsyncLocalStorage, hashed CSS/JS assets), `src/design-defaults.js` (theme options + default markup of the five templates: header, footer, hero, sidebar, post card), `src/tpl.js` (logic-less template engine: `{{x}}` escaped, `{{#if}}/{{else}}/{{#unless}}/{{#each}}`, `{{{x}}}` only un-escapes server-made HTML), `src/admin/design.js` (UI + handlers), migration `005_design.sql` (`design_draft`, `design_versions`). Layers: built-in < live (newest version) < draft. Live files `/x/site.<hash>.css|js` (public, immutable); draft files under the admin path (admin only, no-store). Preview = `pv=1` cookie + valid admin session.
