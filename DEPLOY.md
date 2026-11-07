# Deploying prompts360.si


> **Budget layout (≈ $20/month):** `.do/app.yaml` runs one 512 MB web container ($5) plus a managed PostgreSQL cluster (~$15) and uses
> `VALKEY_URL=memory` (an in-process store, see `MemoryClient` in `src/kv.js`) instead of a managed Valkey. Sessions and rate-limit
> counters then reset on every deploy and are not shared between instances, so add a real Valkey before running 2+ instances.

## Free test link first (Render, $0, about 10 minutes)

`render.yaml` sets up the whole stack on Render's free tier: the app, PostgreSQL and Valkey. It's for trying the site, not launching it:
- The site sleeps after 15 minutes with no visitors, and the first visit after that takes about a minute.
- The free database is deleted after 30 days.
- The captcha uses Cloudflare's always-pass test keys.
- Emails aren't sent. The verify and reset links appear in the service's **Logs** tab.

1. Put this folder in a GitHub repo, for example `FabiGjuzi/prompts360` (private is fine).
2. Open `https://render.com/deploy?repo=https://github.com/FabiGjuzi/prompts360`, sign in with GitHub, and click **Apply**.
3. When it shows **Live**, your link is `https://prompts360.onrender.com` (Render adds a suffix if that name is taken).
4. Sign up. Then open **Dashboard → prompts360 → Logs**, find the `verify?t=…` link and open it.
5. Superadmin: add the encrypted env vars `ADMIN_PATH` and `ADMIN_BOOTSTRAP_HASH` (see `scripts/make-admin-hash.js`). Without `ADMIN_PATH` the dashboard does not exist.

---

You need three things for either path: secrets, Turnstile keys and a Gmail sender (steps 1–3). Then pick **Path A** (easiest, autoscaling) or **Path B** (edge caching, more control). The app is the same container in both; only environment variables differ.

---

## 1. Generate secrets

> `APP_SECRET` must never change after launch: it keys the email fingerprints, so changing it would lock every user out of password recovery.

```bash
node scripts/gen-keys.js
```

This prints `APP_SECRET`, `DATA_KEY` and `ORIGIN_SECRET`. Keep a copy of `DATA_KEY` in a password manager. Without it, stored emails can't be decrypted and nobody can reset a password.

To rotate `DATA_KEY` later, move the old value to `DATA_KEY_OLD` and set a new `DATA_KEY`. New writes use the new key and old rows still decrypt.

## 2. Move DNS to Cloudflare (free) and create Turnstile keys

1. Create a free Cloudflare account. Add the site `prompts360.si` and choose the Free plan.
2. Cloudflare shows two nameservers. In GoDaddy, go to **Domain → DNS → Nameservers → Change → "I'll use my own nameservers"** and paste them. The domain stays registered at GoDaddy; only DNS moves.
3. Go to **Turnstile → Add widget**. Set the hostname to `prompts360.si`, mode Managed. Copy the **Site key** into `TURNSTILE_SITE_KEY` and the **Secret key** into `TURNSTILE_SECRET`.

## 3. Gmail sender (free, about 500 emails/day)

1. Create a Gmail account for the site, for example `prompts360.noreply@gmail.com`, and turn on 2-step verification.
2. In <https://console.cloud.google.com>, create a project, then go to **APIs & Services → Enable APIs** and enable the **Gmail API**.
3. Open the **OAuth consent screen**. Choose External, enter an app name, and add the `gmail.send` scope. Then click **Publish app** so it's In production. Apps left in "Testing" get refresh tokens that expire after 7 days. Google will show an "unverified app" warning when you approve it yourself; that's expected.
4. Under **Credentials → Create credentials → OAuth client ID**, choose type **Desktop app**. Copy the client ID and secret.
5. On your own computer, inside this folder:
   ```bash
   node scripts/gmail-auth.js <CLIENT_ID> <CLIENT_SECRET>
   ```
   Open the printed URL, sign in as the sender account and approve. Copy the printed `GMAIL_REFRESH_TOKEN`.
6. Set `MAIL_TRANSPORT=gmail` and `MAIL_FROM=prompts360 <prompts360.noreply@gmail.com>`, plus `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` and `GMAIL_REFRESH_TOKEN`.

**Limit:** Gmail allows about 500 sends per day for a personal account and 2,000 for Google Workspace. Because users can't log in before verifying, that's also your daily signup ceiling. Mail over the limit waits in the encrypted queue and retries automatically.

When you outgrow it, add a provider and list it as a fallback, for example `MAIL_TRANSPORT=gmail,resend` with `RESEND_API_KEY`. Resend is free for 3,000 emails a month.

---

## Path A — DigitalOcean App Platform (recommended to start)

Autoscaling containers with no servers to patch. DigitalOcean's built-in Cloudflare edge provides DDoS protection and TLS.

1. **Push this folder to a private GitHub repo**, for example `FabiGjuzi/prompts360`, and edit `repo:` in `.do/app.yaml` if the name differs.
2. **Create the databases** in the same region as the app (`nyc` in the spec):
   - **Databases → PostgreSQL**. For read replicas, choose an edition and plan that supports read-only nodes; the Standard edition dropped them for new clusters from Oct–Nov 2026. Name it `prompts360-db`.
   - **Databases → Valkey**. Copy its `rediss://` connection string into `VALKEY_URL`.
3. **Create the app:** `doctl apps create --spec .do/app.yaml`, or use **Apps → Create → From GitHub** and import the spec.
4. Fill in the `SECRET` env vars in the app's Settings: `APP_SECRET`, `DATA_KEY`, `VALKEY_URL`, `TURNSTILE_SECRET` and the `GMAIL_*` values. Also set `TURNSTILE_SITE_KEY` and `MAIL_FROM`.
5. **Domain:** in the app go to **Settings → Domains → Add** `prompts360.si` and choose "You manage your domain". In Cloudflare DNS, create the CNAME DigitalOcean shows, with proxy status **DNS only (grey cloud)**. App Platform already sits behind Cloudflare, and orange-clouding it through your own account isn't supported.
6. Deploy. The `migrate` pre-deploy job creates the schema.
7. Sign up on the site, then make yourself admin:
   ```bash
   doctl apps console <app-id> web      # or the Console tab in the control panel
   # (no longer needed: use the superadmin dashboard, see ADMIN_PATH)
   ```

**Visitor map:** DigitalOcean's edge sends `do-connecting-ip` but no country header, so on this path the dashboard map shows "No country information is arriving" until a country source is added. Path B (orange-cloud Cloudflare) sends `cf-ipcountry`, which the app reads by default (`COUNTRY_HEADER`).

**Settings already in the spec for this path:** `CLIENT_IP_HEADER=do-connecting-ip` (DigitalOcean's edge sets it, so it's safe to trust) and `EDGE_CACHE_SEC=0` (the platform CDN can't skip cache for logged-in users). Logged-out pages are still micro-cached for 5 s inside each instance.

**Scaling:** autoscaling runs from 2 to 20 instances at 70% CPU. Raise `max_instance_count`, add a read replica and set `DATABASE_READ_URL`, then scale the database plan as needed.

## Path B — Droplets + Load Balancer + your own Cloudflare proxy

Use this path when you want Cloudflare to cache logged-out pages at the edge, so most views never reach your servers, and to use Cloudflare's WAF and rate-limit rules.

1. **Databases:** the same managed PostgreSQL and Valkey as Path A.
2. **Droplets:** create 2 or more Ubuntu droplets in the same VPC. On each one:
   ```bash
   curl -fsSL https://get.docker.com | sh
   git clone <your repo> prompts360 && cd prompts360
   docker build -t prompts360 .
   docker run -d --restart=always --name web -p 8080:8080 --env-file /root/prompts360.env \
     -v /root/ca-certificate.crt:/app/ca.crt:ro prompts360
   ```
   Put all variables in `/root/prompts360.env` with permissions `chmod 600`. Download the database's CA certificate from DigitalOcean (**Database → Connection details → Download CA certificate**) to `/root/ca-certificate.crt`, and set `DATABASE_CA_CERT=/app/ca.crt`. Run `docker exec web node scripts/migrate.js` once.
3. **Load balancer:** forward HTTPS 443 to droplet port 8080 over HTTP, with health check `/healthz`. In Cloudflare go to **SSL/TLS → Origin Server → Create certificate** and upload it to the load balancer.
4. **Firewalls:** droplets accept port 8080 only from the load balancer. The load balancer's firewall allows only Cloudflare's IP ranges (<https://www.cloudflare.com/ips/>).
5. **Cloudflare:**
   - **DNS:** an `A` record from `prompts360.si` to the load balancer IP, **Proxied (orange)**.
   - **SSL/TLS:** set the mode to **Full (strict)**, turn on Always Use HTTPS, and set minimum TLS to 1.2.
   - **Rules → Transform Rules → Modify Request Header:** for all requests, set the static header `x-origin-secret` to your `ORIGIN_SECRET`. The app answers `403` to anything without it, so attackers can't bypass Cloudflare.
   - **Caching → Cache Rules**, in this order (later rules win):
     1. Name it "Cache HTML" with condition `http.host eq "prompts360.si"`. Choose **Eligible for cache** and set Edge TTL to **Use cache-control header if present, bypass cache if not**.
     2. Name it "Bypass logged-in" with condition `http.cookie contains "__Host-sid"`. Choose **Bypass cache**.
   - **Security → Bots:** turn on Bot Fight Mode. Optionally add a rate-limiting rule on `/login` and `/signup`.
6. **Environment for this path:** `CLIENT_IP_HEADER=cf-connecting-ip`, `ORIGIN_SECRET=<value>`, `EDGE_CACHE_SEC=30`, and `WEB_CONCURRENCY=<vCPUs>`.

---

## Database notes

- **Direct vs pooled connections:** migrations work on either. If `DATABASE_URL` is a PgBouncer pool in transaction mode, set `DB_STARTUP_PARAMS=0` and run this once as admin:
  ```sql
  ALTER ROLE <app_user> SET statement_timeout = '5s';
  ALTER ROLE <app_user> SET idle_in_transaction_session_timeout = '10s';
  ```
- **Least privilege:** create an app user that can read and write tables but not create roles or databases.
- **Backups:** managed PostgreSQL takes daily backups with point-in-time recovery. Backups contain only encrypted emails and hashed passwords, but treat them as sensitive anyway.
- **Cleanup:** unverified signups older than 48 h are deleted automatically, which frees the username and email.

## Before launch

- [ ] Read `/privacy` and `/terms`. They're templates; have a lawyer review them. The `.si` domain and EU visitors make GDPR relevant.
- [ ] Test signup → email → verify → login on the live domain.
- [ ] Set `ADMIN_PATH` + `ADMIN_BOOTSTRAP_HASH`; log in to the dashboard; change the password under Account.
- [ ] Optionally submit the domain to <https://hstspreload.org> (the HSTS header is already set).
