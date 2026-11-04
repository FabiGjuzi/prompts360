# Security model

Every row below is enforced in code and, where marked ✅, proven by the automated attack suite (`test/security.test.js`, 16 tests). The suite runs against a real PostgreSQL and Valkey and passes.

## What is stored, and how

| Data | Storage | Notes |
|---|---|---|
| Password | **Argon2id** (64 MiB, t=3, p=1, RFC 9106) + secret pepper | Memory-hard, unlike SHA-256, which a GPU can test billions of times per second. A stolen database can't be cracked offline without the pepper, which lives outside the DB. ✅ |
| Email | **Not stored.** Only a keyed **HMAC-SHA256** fingerprint | Signup, recovery and re-verification take the address the user types, fingerprint it, find the account, and mail the typed address. A database leak contains no addresses, encrypted or not. ✅ |
| Email/reset tokens | **SHA-256** of a 256-bit random token | Single-use; 24 h for verification, 30 min for reset. ✅ |
| Session tokens | **SHA-256** of a 256-bit random token, in Valkey | 2 h idle and 24 h absolute expiry; the cookie dies with the browser. ✅ |
| Queued emails | AES-256-GCM | The recipient is held only until the message is sent, then the row is deleted. ✅ |
| IP addresses | **Never stored** | Rate-limit keys use an HMAC of the IP and expire. ✅ |
| Posts, comments, communities | Plaintext | Public by design. Encrypting them would prevent indexing and search and protect nothing, since anyone can read them on the site. Disk-level encryption at rest comes from the managed database. |

Keys are separated with HKDF: index, pepper, CSRF, IP hashing and form tokens each use their own key. `DATA_KEY` can be rotated through `DATA_KEY_OLD`.

## Attacks and defences

| Attack | Defence | Test |
|---|---|---|
| SQL injection | 100% parameterised queries. Sort orders, windows and table names come from fixed whitelists, never user text. | ✅ 6 payloads × 10 inputs plus login, time-based probe, DB integrity check |
| Stored or reflected XSS | Escape-by-default templates. The Markdown renderer escapes before formatting and only emits `http(s)` links. Strict CSP `script-src 'self'` with no inline script and no `unsafe-*`. | ✅ 12 payloads in titles, bodies, comments, links and search |
| CSRF | Per-session synchronizer token, `SameSite=Lax`, and an Origin / `Sec-Fetch-Site` check. Logged-out forms carry a signed, expiring token, which stops login CSRF. | ✅ |
| Brute force / credential stuffing | Turnstile captcha, 20 logins per 15 min per IP, and a 15-min lockout after 10 failures per account. Argon2 cost per guess. | ✅ |
| Account enumeration | Identical responses for existing and new emails on signup and forgot-password. The real owner is notified by email. Constant-time password check for unknown users. | ✅ |
| Session hijack / fixation | HttpOnly `__Host-` cookie, Secure, a new token at every login, server-side revocation on logout, password change, reset, ban or delete. | ✅ |
| Clickjacking | `frame-ancestors 'none'` and `X-Frame-Options: DENY` | ✅ |
| Open redirect | Only same-site relative paths are accepted. | ✅ |
| IDOR (editing others' content) | Every write checks `author_id`; dashboard routes need a separate admin session. | ✅ |
| Prototype / parameter pollution | Null-prototype body objects, dangerous keys dropped, first value wins. | ✅ |
| Cryptojacking and injected miners | CSP blocks any script not served by the site. The only third-party script is Turnstile, and only on captcha pages. No CDNs or analytics. One third-party library (the `pg` database driver), 0 known vulnerabilities. | ✅ |
| Layer-7 DDoS / floods | Per-IP token bucket, rate limits on every write action, Argon2 concurrency cap, 16 KB default body limit, 10 s header and 15 s request timeouts, 5 s SQL statement timeout, and logged-out pages served from a micro-cache. | ✅ |
| Volumetric DDoS | Absorbed at the edge: DigitalOcean's built-in Cloudflare (Path A), or your Cloudflare plus an origin lock (Path B). No application code can stop this kind; it must be the network. | ✅ origin lock |
| ReDoS | Bounded, non-nested regexes, checked against 40,000-character pathological input. | ✅ |
| Path traversal / file disclosure | Assets are served from an in-memory map; there is no filesystem access by URL. | ✅ |
| Information leakage | Generic error pages with no stack traces or SQL. Production refuses to start with missing or dev keys. | ✅ |
| Email header injection | Strict recipient validation; MIME is built with encoded headers. | Code |
| Spoofed client IP | The IP header is trusted only when the platform sets it or the origin secret is present; production refuses to start otherwise. | ✅ |

## Remaining risks to know about

- **Email fingerprints are guessable if the secret leaks.** The fingerprint is keyed with `APP_SECRET`, which is kept outside the database, so a stolen database alone reveals nothing. If the database and `APP_SECRET` both leak, an attacker can test a known address ("is this person a member?") but can't list members. **Never change `APP_SECRET`** after launch, or every account loses its recovery link.
- **No stored address means no other emails.** The site can't email users about bans or announcements, and a user who typed their address wrong at signup can't be reached. Unverified accounts are deleted after 48 hours, and the username is freed.

- **Account lockout abuse.** Someone could deliberately fail logins to lock a known username for 15 minutes. The captcha and per-IP limits make this costly, and "Forgot password" still works during a lockout.
- **Gmail's cap** is about 500 emails a day. Past it, signups queue until the next day. Add a fallback transport before you get big.
- **Compromise of the running server** would expose its keys, as with any app that must decrypt data to use it. Keep secrets in the platform's secret store, use 2FA on DigitalOcean, Cloudflare, GitHub and Google, and restrict who can deploy.
- **Content moderation** is admin-only; with growth you'll want more moderators.

## Superadmin dashboard
- Hidden path (`ADMIN_PATH`, 16-80 chars, required to match in production); every admin URL returns 404 without a valid admin session.
- Separate account (Argon2id + pepper), Turnstile on login, 8 attempts / 15 min / IP, uniform failure messages, optional `ADMIN_IP_ALLOW`.
- Cookie `__Host-asid` (HttpOnly, SameSite=Strict, UA-bound), idle 30 min, absolute 8 h; CSRF token derived per admin session; password change signs out all admin sessions.
- CRUD only on whitelisted tables; password hashes, email indexes, tokens and the mail outbox are never exposed; every write is audited in the event log.
- Metrics are aggregate only: no IPs, user agents or user IDs are stored.
- Strict CSP with Trusted Types on the dashboard; no inline scripts or styles.

## Site design editor
- Custom CSS/JS are served as separate content-hashed files from our own origin, so the strict CSP (`script-src 'self'`, Trusted Types, no inline) is unchanged; no `<script>`, `<style>`, event attributes, `javascript:`, iframes or `<base>` are accepted in templates. Third-party script hosts are not allowed (would need a CSP allowlist, not built).
- Templates are logic-less and escape by default; only server-generated HTML (vote widget, logo, CSRF field) is un-escaped; prototype names are rejected; depth/size/output limits; a template that fails at render time falls back to the built-in one.
- Edits go to a draft. Visitors see it only after Publish. Preview needs both the `pv` cookie and a valid admin session (and the IP allowlist), pages are `no-store` + `noindex`. All changes are audited; every publish is a version that can be rolled back.
- Risk to know: published custom JS runs on every public page, so a compromised admin session means site-wide script. The dashboard itself never loads custom CSS/JS, so a broken design cannot lock the admin out.

## CSV export / import
- Export is admin-only (404 otherwise), `no-store`, audited. Only registry tables and their registry columns are exported (never password hashes, email fingerprints, tokens, the mail queue or admin account); cells starting with = + - @ are prefixed with ' to stop spreadsheet formula injection.
- Import reads CSV/JSON as text only (the browser reads the chosen file; no multipart upload), caps size and rows, validates every field as before, and never treats cell content as HTML (Markdown is rendered by the safe renderer).
