// Email: a durable, encrypted outbox in PostgreSQL + pluggable HTTPS transports.
// Default transport is the Gmail API (free; HTTPS port 443, so it works where SMTP ports are blocked).
// MAIL_TRANSPORT can list several, e.g. "gmail,resend": the next one is tried when one fails/hits quota.
import crypto from 'node:crypto';
import { config } from './config.js';
import { q, primary } from './db.js';
import { encrypt, decrypt } from './crypto.js';

export const sentForTests = [];

// ---------- Queue ----------
export async function queueEmail(client, msg) {
  const db = client || primary;
  await db.query('INSERT INTO email_outbox (payload_enc) VALUES ($1)', [encrypt(JSON.stringify(msg), 'outbox')]);
  if (!client) setImmediate(() => drainOutbox().catch(() => {})); // inside a tx: the worker picks it up after commit
}

let inflight = null;
/** Send due emails. Concurrent callers share the run in progress instead of starting another. */
export function drainOutbox() {
  return (inflight ||= drain().finally(() => { inflight = null; }));
}
async function drain() {
  {
    for (;;) {
      // Lease up to 10 due messages (SKIP LOCKED: many instances can drain one queue without double-sending).
      // Sending happens outside any transaction; a crashed sender's lease simply expires and is retried.
      const { rows } = await q(
        `UPDATE email_outbox SET attempts = attempts + 1, next_attempt_at = now() + interval '5 minutes'
         WHERE id IN (SELECT id FROM email_outbox WHERE next_attempt_at <= now()
                      ORDER BY next_attempt_at LIMIT 10 FOR UPDATE SKIP LOCKED)
         RETURNING id, payload_enc, attempts`);
      for (const r of rows) {
        try {
          await send(JSON.parse(decrypt(r.payload_enc, 'outbox')));
          await q('DELETE FROM email_outbox WHERE id = $1', [r.id]);
        } catch (e) {
          const err = String(e.message || e).slice(0, 300);
          console.error('[mail] send failed:', err);
          if (r.attempts >= 12) { await q('DELETE FROM email_outbox WHERE id = $1', [r.id]); continue; }
          const backoff = e.quota ? 1800 : Math.min(3600, 30 * 2 ** r.attempts);
          await q(`UPDATE email_outbox SET last_error = $2, next_attempt_at = now() + make_interval(secs => $3)
                   WHERE id = $1`, [r.id, err, backoff]);
        }
      }
      if (rows.length < 10) break;
    }
  }
}

// ---------- Transports ----------
async function send(msg) {
  let lastErr;
  for (const name of config.mail.transports) {
    try { return await TRANSPORTS[name](msg); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('no mail transport configured');
}

let gmailToken = { value: '', exp: 0 };
async function gmailAccessToken() {
  if (gmailToken.value && Date.now() < gmailToken.exp - 60_000) return gmailToken.value;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.mail.gmailClientId, client_secret: config.mail.gmailClientSecret,
      refresh_token: config.mail.gmailRefreshToken, grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`gmail oauth: ${j.error || res.status}`);
  gmailToken = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return gmailToken.value;
}

const b64h = s => `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;
function mime(msg) {
  const boundary = `b_${crypto.randomBytes(12).toString('hex')}`;
  return [
    `From: ${config.mail.from}`, `To: ${msg.to}`, `Subject: ${b64h(msg.subject)}`, 'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(msg.text).toString('base64').replace(/.{76}/g, '$&\r\n'),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(msg.html).toString('base64').replace(/.{76}/g, '$&\r\n'),
    `--${boundary}--`, '',
  ].join('\r\n');
}

const TRANSPORTS = {
  async gmail(msg) {
    if (!/^[^\s<>"',;]+@[^\s<>"',;]+$/.test(msg.to)) throw new Error('bad recipient'); // header-injection guard
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { authorization: `Bearer ${await gmailAccessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ raw: Buffer.from(mime(msg)).toString('base64url') }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return;
    const body = await res.text().catch(() => '');
    const err = new Error(`gmail ${res.status}: ${body.slice(0, 200)}`);
    if (res.status === 429 || /limit|quota/i.test(body)) err.quota = true; // ~500/day on personal Gmail
    if (res.status === 401) gmailToken = { value: '', exp: 0 };
    throw err;
  },
  async resend(msg) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.mail.resendApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: config.mail.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) { const e = new Error(`resend ${res.status}`); e.quota = res.status === 429; throw e; }
  },
  async console(msg) { console.log(`[mail] to=${msg.to} subject="${msg.subject}"\n${msg.text}\n`); },
  async memory(msg) { sentForTests.push(msg); },
};

// ---------- Templates ----------
const wrap = (title, bodyHtml) => `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px;color:#1a1a1b">
<h2 style="margin:0 0 16px">${title}</h2>${bodyHtml}
<p style="color:#787c7e;font-size:12px;margin-top:32px">${config.siteName} · If you didn't request this, you can ignore this email.</p></body></html>`;
const button = (href, label) => `<p><a href="${href}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">${label}</a></p><p style="font-size:12px;color:#787c7e;word-break:break-all">${href}</p>`;
const escMail = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const templates = {
  verify: (to, username, link) => ({
    to, subject: `Verify your ${config.siteName} account`,
    text: `Welcome to ${config.siteName}!\n\nYour username: ${username}\n(you'll need it to log in)\n\nVerify your email (link valid for 24 hours):\n${link}\n`,
    html: wrap('Verify your email', `<p>Your username: <b>${escMail(username)}</b><br>You'll need it to log in.</p>${button(link, 'Verify email')}<p>This link is valid for 24 hours.</p>`),
  }),
  reset: (to, username, link) => ({
    to, subject: `Reset your ${config.siteName} password`,
    text: `Someone asked to reset the password for ${username}.\n\nReset it here (valid for 30 minutes):\n${link}\n`,
    html: wrap('Reset your password', `<p>Someone asked to reset the password for <b>${escMail(username)}</b>.</p>${button(link, 'Choose a new password')}<p>This link is valid for 30 minutes and works once.</p>`),
  }),
  exists: (to, username) => ({
    to, subject: `Sign-up attempt on ${config.siteName}`,
    text: `Someone tried to create a new account with this email, but it already belongs to ${username}.\n\nIf that was you, log in or use "Forgot password":\n${config.baseUrl}/login\n`,
    html: wrap('You already have an account', `<p>Someone tried to sign up with this email, but it already belongs to <b>${escMail(username)}</b>.</p>${button(`${config.baseUrl}/login`, 'Log in')}`),
  }),
};

export async function emailCount() { return Number((await q('SELECT count(*) FROM email_outbox')).rows[0].count); }
