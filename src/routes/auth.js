import { config } from '../config.js';
import { q, one, tx } from '../db.js';
import {
  hashPassword, verifyPassword, burnPasswordTime, emailIndex, normalizeEmail,
  randomToken, sha256, formToken, ipKey,
} from '../crypto.js';
import { createSession, destroySession, destroyAllSessions, cookieHeader, clearCookieHeader } from '../session.js';
import { hit, peek, reset, LIMITS } from '../ratelimit.js';
import { verifyHuman, turnstileEnabled } from '../turnstile.js';
import { queueEmail, templates } from '../mail.js';
import { page, redirect, str } from '../http.js';
import * as V from '../views.js';
import { html, safeBack } from '../html.js';
import { genAnonName, usernameProblem, emailOk, passwordProblem, ANON_RE } from '../validate.js';

const tooMany = s => `Too many attempts. Try again in ${Math.ceil(s / 60)} minute${s > 60 ? 's' : ''}.`;
// Captcha script loads only where a captcha is shown — never on pages whose URL carries a secret token.
const authPage = (req, res, title, content, status = 200, captcha = true) =>
  page(req, res, { status, title, content, turnstile: captcha && turnstileEnabled(), cache: false, noindex: true });

async function issueToken(db, userId, purpose, ttlSec) {
  const token = randomToken(32);
  await db.query('DELETE FROM auth_tokens WHERE user_id = $1 AND purpose = $2', [userId, purpose]);
  await db.query(
    `INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4))`, [sha256(token), userId, purpose, ttlSec]);
  return token;
}

async function consumeToken(token, purpose) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return one(
    `DELETE FROM auth_tokens WHERE token_hash = $1 AND purpose = $2 AND expires_at > now() RETURNING user_id`,
    [sha256(token), purpose]);
}

// ---------- Sign up ----------
async function signupGet(req, res) {
  if (req.user) return redirect(res, '/');
  return authPage(req, res, 'Sign up', V.signupForm({ ft: formToken(), suggested: genAnonName() }));
}

async function signupPost(req, res) {
  const b = req.body;
  const v = { username: str(b.username, 20).trim(), email: str(b.email, 254).trim() };
  let suggested = ANON_RE.test(b.suggested || '') ? b.suggested : genAnonName();
  const again = (error, status = 400) =>
    authPage(req, res, 'Sign up', V.signupForm({ ft: formToken(), suggested, v, error }), status);

  const rl = await hit(`signup:${ipKey(req.ip)}`, ...LIMITS.signupIp);
  if (!rl.ok) return again(tooMany(rl.retryAfter), 429);
  if (!(await verifyHuman(b['cf-turnstile-response'], req.ip, 'signup'))) return again('Please complete the captcha.');

  const username = v.username || suggested;
  const pw = str(b.password, 200), pw2 = str(b.password2, 200);
  const problem = usernameProblem(username) || (!emailOk(v.email) && 'Enter a valid email address.') || passwordProblem(pw, pw2, username);
  if (problem) return again(problem);

  // Always hash, so "email already registered" can't be detected from response time.
  const passHash = await hashPassword(pw);
  const bidx = emailIndex(v.email);
  const done = () => authPage(req, res, 'Check your email', V.message('Check your email',
    `We sent a verification link to the address you entered. Click it within 24 hours, then log in.`,
    html`<p>Your username is <b>${username}</b> — save it, you need it to log in.</p><p class="muted">Didn't get it? Check spam, or try logging in to resend.</p>`));

  const existing = await one('SELECT id, username, verified_at FROM users WHERE email_bidx = $1', [bidx]);
  if (existing) {
    // Same response as a fresh signup (no account enumeration); the real owner gets an explanatory email.
    if (existing.verified_at) await queueEmail(null, templates.exists(normalizeEmail(v.email), existing.username));
    else {
      const t = await issueToken({ query: q }, existing.id, 'verify', 86400);
      await queueEmail(null, templates.verify(normalizeEmail(v.email), existing.username, `${config.baseUrl}/verify?t=${t}`));
    }
    return done();
  }
  if (await one('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username])) {
    if (!v.username) { suggested = genAnonName(); return again('That generated name was just taken — here is a new one, submit again.'); }
    return again('That username is taken.');
  }
  try {
    await tx(async db => {
      const { rows: [u] } = await db.query(
        'INSERT INTO users (username, email_bidx, pass_hash) VALUES ($1, $2, $3) RETURNING id',
        [username, bidx, passHash]);
      const t = await issueToken(db, u.id, 'verify', 86400);
      await queueEmail(db, templates.verify(normalizeEmail(v.email), username, `${config.baseUrl}/verify?t=${t}`));
    });
  } catch (e) {
    if (e.code === '23505') return again('That username is taken.'); // unique race
    throw e;
  }
  return done();
}

// ---------- Email verification (GET shows a button so link scanners can't burn the token) ----------
async function verifyGet(req, res) {
  return authPage(req, res, 'Verify email', V.verifyForm({ ft: formToken(), token: req.query.get('t') || '' }), 200, false);
}
async function verifyPost(req, res) {
  const row = await consumeToken(req.body.t, 'verify');
  if (!row) return authPage(req, res, 'Link expired', V.message('Link expired or already used',
    'Log in with your username and password and we will send you a fresh link.'), 400);
  await q('UPDATE users SET verified_at = coalesce(verified_at, now()) WHERE id = $1', [row.user_id]);
  return redirect(res, '/login?n=verified');
}

// ---------- Log in / out ----------
async function loginGet(req, res) {
  if (req.user) return redirect(res, '/');
  return authPage(req, res, 'Log in', V.loginForm({ ft: formToken(), back: safeBack(req.query.get('back') || '', '') }));
}

async function loginPost(req, res) {
  const b = req.body;
  const username = str(b.username, 20).trim();
  const back = safeBack(str(b.back, 500), '/');
  const again = (error, status = 400) =>
    authPage(req, res, 'Log in', V.loginForm({ ft: formToken(), error, username, back }), status);

  const rl = await hit(`login:${ipKey(req.ip)}`, ...LIMITS.loginIp);
  if (!rl.ok) return again(tooMany(rl.retryAfter), 429);
  if (!(await verifyHuman(b['cf-turnstile-response'], req.ip, 'login'))) return again('Please complete the captcha.');

  const failKey = `loginfail:${username.toLowerCase()}`;
  if ((await peek(failKey)) >= LIMITS.loginUserFail[0]) return again('This account is temporarily locked after too many failed attempts. Try again in 15 minutes or reset your password.', 429);

  const pw = str(b.password, 200);
  const user = /^[A-Za-z0-9_-]{3,20}$/.test(username)
    ? await one('SELECT id, username, pass_hash, is_admin, verified_at, banned_at, deleted_at FROM users WHERE lower(username) = lower($1)', [username])
    : null;
  const ok = user && !user.deleted_at ? await verifyPassword(user.pass_hash, pw) : await burnPasswordTime(pw);
  if (!ok) {
    await hit(failKey, ...LIMITS.loginUserFail);
    return again('Wrong username or password.', 401);
  }
  if (user.banned_at) return again('This account is suspended.', 403);
  if (!user.verified_at) {
    // We no longer keep the address, so we can't re-send from here: the user types it on /resend.
    return again('Verify your email first. Lost the link? Use “Resend verification” below.', 403);
  }
  await reset(failKey);
  await destroySession(req.cookieToken); // never reuse a pre-login session (fixation)
  const token = await createSession(user);
  res.setHeader('Set-Cookie', cookieHeader(token));
  return redirect(res, back);
}

async function logoutPost(req, res) {
  await destroySession(req.cookieToken);
  res.setHeader('Set-Cookie', clearCookieHeader());
  return redirect(res, '/?n=logout');
}

// ---------- Forgot / reset password ----------
async function forgotGet(req, res) {
  return authPage(req, res, 'Forgot password', V.forgotForm({ ft: formToken() }));
}
async function forgotPost(req, res) {
  const email = str(req.body.email, 254).trim();
  const again = (error, status = 400) => authPage(req, res, 'Forgot password', V.forgotForm({ ft: formToken(), error }), status);
  const rl = await hit(`forgot:${ipKey(req.ip)}`, ...LIMITS.forgotIp);
  if (!rl.ok) return again(tooMany(rl.retryAfter), 429);
  if (!(await verifyHuman(req.body['cf-turnstile-response'], req.ip, 'forgot'))) return again('Please complete the captcha.');
  if (!emailOk(email)) return again('Enter a valid email address.');

  const bidx = emailIndex(email);
  const perEmail = await hit(`forgot-e:${bidx.toString('base64url')}`, ...LIMITS.forgotEmail);
  if (perEmail.ok) {
    const u = await one('SELECT id, username FROM users WHERE email_bidx = $1 AND banned_at IS NULL AND deleted_at IS NULL', [bidx]);
    if (u) {
      const t = await issueToken({ query: q }, u.id, 'reset', 1800);
      await queueEmail(null, templates.reset(normalizeEmail(email), u.username, `${config.baseUrl}/reset?t=${t}`));
    }
  }
  // Identical answer whether or not the email exists.
  return authPage(req, res, 'Check your email', V.message('Check your email',
    'If that email belongs to an account, a reset link is on its way. It works once and expires in 30 minutes.'));
}

async function resetGet(req, res) {
  return authPage(req, res, 'Reset password', V.resetForm({ ft: formToken(), token: req.query.get('t') || '' }), 200, false);
}
async function resetPost(req, res) {
  const token = str(req.body.t, 100);
  const pw = str(req.body.password, 200), pw2 = str(req.body.password2, 200);
  const problem = passwordProblem(pw, pw2);
  if (problem) return authPage(req, res, 'Reset password', V.resetForm({ ft: formToken(), token, error: problem }), 400, false);
  const row = await consumeToken(token, 'reset');
  if (!row) return authPage(req, res, 'Link expired', V.message('Link expired or already used',
    html`Request a new one on the <a href="/forgot">forgot password</a> page.`), 400);
  const u = await one('SELECT username FROM users WHERE id = $1', [row.user_id]);
  if (u && pw.toLowerCase().includes(u.username.toLowerCase()))
    return authPage(req, res, 'Reset password', V.message('Try again', html`Password can’t contain your username. <a href="/forgot">Request a new link</a>.`), 400);
  // The reset link proves email ownership, so it also completes verification.
  await q('UPDATE users SET pass_hash = $2, verified_at = coalesce(verified_at, now()) WHERE id = $1', [row.user_id, await hashPassword(pw)]);
  await destroyAllSessions(row.user_id);
  await reset(`loginfail:${u?.username.toLowerCase()}`);
  return redirect(res, '/login?n=reset');
}

// ---------- Resend verification (user types the address; we only keep its fingerprint) ----------
async function resendGet(req, res) {
  return authPage(req, res, 'Resend verification', V.resendForm({ ft: formToken() }));
}
async function resendPost(req, res) {
  const email = str(req.body.email, 254).trim();
  const again = (error, status = 400) => authPage(req, res, 'Resend verification', V.resendForm({ ft: formToken(), error }), status);
  const rl = await hit(`resend-ip:${ipKey(req.ip)}`, ...LIMITS.resendIp);
  if (!rl.ok) return again(tooMany(rl.retryAfter), 429);
  if (!(await verifyHuman(req.body['cf-turnstile-response'], req.ip, 'resend'))) return again('Please complete the captcha.');
  if (!emailOk(email)) return again('Enter a valid email address.');
  const bidx = emailIndex(email);
  if ((await hit(`resend-e:${bidx.toString('base64url')}`, 1, 600)).ok) {
    const u = await one('SELECT id, username FROM users WHERE email_bidx = $1 AND verified_at IS NULL AND banned_at IS NULL AND deleted_at IS NULL', [bidx]);
    if (u) {
      const t = await issueToken({ query: q }, u.id, 'verify', 86400);
      await queueEmail(null, templates.verify(normalizeEmail(email), u.username, `${config.baseUrl}/verify?t=${t}`));
    }
  }
  return authPage(req, res, 'Check your email', V.message('Check your email',
    'If that address belongs to an account that still needs verifying, a new link is on its way (valid 24 hours).'));
}

// ---------- Settings ----------
async function settingsGet(req, res) {
  return page(req, res, { title: 'Settings', content: V.settingsPage({ user: req.user }), noindex: true });
}
async function settingsPassword(req, res) {
  const b = req.body, user = req.user;
  const bad = error => page(req, res, { status: 400, title: 'Settings', content: V.settingsPage({ user, error }), noindex: true });
  const rl = await hit(`pwchange:${user.id}`, 5, 900);
  if (!rl.ok) return bad(tooMany(rl.retryAfter));
  const row = await one('SELECT pass_hash FROM users WHERE id = $1', [user.id]);
  if (!(await verifyPassword(row?.pass_hash, str(b.current, 200)))) return bad('Current password is wrong.');
  const problem = passwordProblem(str(b.password, 200), str(b.password2, 200), user.username);
  if (problem) return bad(problem);
  await q('UPDATE users SET pass_hash = $2 WHERE id = $1', [user.id, await hashPassword(b.password)]);
  await destroyAllSessions(user.id);              // sign out everywhere else…
  const token = await createSession(user);        // …and keep this browser signed in with a fresh session
  res.setHeader('Set-Cookie', cookieHeader(token));
  return redirect(res, '/settings?n=pwchanged');
}

async function settingsDelete(req, res) {
  const b = req.body, user = req.user;
  const bad = error => page(req, res, { status: 400, title: 'Settings', content: V.settingsPage({ user, error }), noindex: true });
  const rl = await hit(`pwchange:${user.id}`, 5, 900);
  if (!rl.ok) return bad(tooMany(rl.retryAfter));
  if (b.confirm !== 'DELETE') return bad('Type DELETE to confirm.');
  const row = await one('SELECT pass_hash FROM users WHERE id = $1', [user.id]);
  if (!(await verifyPassword(row?.pass_hash, str(b.current, 200)))) return bad('Password is wrong.');
  await tx(async db => {
    // Erase credentials and personal data; username stays reserved so nobody can impersonate it.
    await db.query(`UPDATE users SET email_bidx = NULL, pass_hash = NULL, deleted_at = now() WHERE id = $1`, [user.id]);
    await db.query(`UPDATE posts SET title = '[deleted]', body = '', url = NULL, deleted_at = coalesce(deleted_at, now()) WHERE author_id = $1`, [user.id]);
    await db.query(`UPDATE comments SET body = '[deleted]', deleted_at = coalesce(deleted_at, now()) WHERE author_id = $1`, [user.id]);
    await db.query(`DELETE FROM auth_tokens WHERE user_id = $1`, [user.id]);
  });
  await destroyAllSessions(user.id);
  res.setHeader('Set-Cookie', clearCookieHeader());
  return redirect(res, '/?n=accountdeleted');
}

export const authRoutes = [
  ['GET', /^\/signup$/, signupGet],
  ['POST', /^\/signup$/, signupPost, { form: 'anon' }],
  ['GET', /^\/verify$/, verifyGet],
  ['POST', /^\/verify$/, verifyPost, { form: 'anon' }],
  ['GET', /^\/resend$/, resendGet],
  ['POST', /^\/resend$/, resendPost, { form: 'anon' }],
  ['GET', /^\/login$/, loginGet],
  ['POST', /^\/login$/, loginPost, { form: 'anon' }],
  ['POST', /^\/logout$/, logoutPost, { form: 'user', auth: 'user' }],
  ['GET', /^\/forgot$/, forgotGet],
  ['POST', /^\/forgot$/, forgotPost, { form: 'anon' }],
  ['GET', /^\/reset$/, resetGet],
  ['POST', /^\/reset$/, resetPost, { form: 'anon' }],
  ['GET', /^\/settings$/, settingsGet, { auth: 'user' }],
  ['POST', /^\/settings\/password$/, settingsPassword, { form: 'user', auth: 'user' }],
  ['POST', /^\/settings\/delete$/, settingsDelete, { form: 'user', auth: 'user' }],
];
