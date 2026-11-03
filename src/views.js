import { html, raw, timeAgo, plural, slugify, esc } from './html.js';
import { markdown } from './markdown.js';
import { config } from './config.js';
import { assets } from './assets.js';

const NOTICES = {
  verified: 'Email verified — you can log in now.',
  reset: 'Password changed. Log in with your new password.',
  pwchanged: 'Password changed. Other sessions were signed out.',
  logout: 'You are logged out.',
  deleted: 'Deleted.',
  removed: 'Removed by admin.',
  reported: 'Thanks — the admin will review your report.',
  community: 'Community created.',
  edited: 'Saved.',
  banned: 'User banned and signed out everywhere.',
  unbanned: 'User unbanned.',
  accountdeleted: 'Your account and content were deleted.',
};

export const SLOGAN = 'Communicating better for a more intelligent World';

// Animated logo (360.si → 3pSI and back, forever) is a separate, cached SVG made by scripts/build-logo.js.
// <picture> picks the dark-mode file and, for visitors who ask for reduced motion, a still version.
const logo = () => html`<picture>
<source media="(prefers-reduced-motion: reduce) and (prefers-color-scheme: dark)" srcset="${assets.logoStaticDark}">
<source media="(prefers-reduced-motion: reduce)" srcset="${assets.logoStaticLight}">
<source media="(prefers-color-scheme: dark)" srcset="${assets.logoDark}">
<img class="logo" src="${assets.logoLight}" alt="" width="74" height="34"></picture>`;

const csrfField = user => user ? html`<input type="hidden" name="_csrf" value="${user.csrf}">` : '';
export const formField = ft => html`<input type="hidden" name="_ft" value="${ft}">`;
const captcha = action => config.turnstileSiteKey
  ? html`<div class="cf-turnstile" data-sitekey="${config.turnstileSiteKey}" data-action="${action}" data-theme="auto"></div>`
  : '';

export function layout({ title, user, content, sidebar, q = '', turnstile = false, notice, desc, noindex }) {
  const n = notice && NOTICES[notice];
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title ? `${title} · ` : ''}${config.siteName}</title>
<meta name="description" content="${desc || 'Anonymous community for prompts, tips and discussion about ChatGPT, Claude, Gemini and every other AI model.'}">
${noindex ? raw('<meta name="robots" content="noindex">') : ''}
<link rel="stylesheet" href="${assets.css}"><link rel="icon" href="${assets.icon}" type="image/svg+xml">
<script src="${assets.js}" defer></script>
${turnstile && config.turnstileSiteKey ? raw('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>') : ''}
</head><body>
<header class="top"><div class="bar">
<a class="brand" href="/" aria-label="360.si — ${SLOGAN}">${logo()}<span class="slogan">${SLOGAN}</span></a>
<form class="search" action="/search" role="search"><input name="q" type="search" placeholder="Search" maxlength="200" value="${q}" aria-label="Search posts"></form>
<nav>${user ? html`<a class="btn" href="/submit">+ Post</a>
<details class="menu"><summary>${user.username}</summary><div>
<a href="/u/${user.username}">Profile</a><a href="/communities/new">New community</a><a href="/settings">Settings</a>
${user.is_admin ? html`<a href="/admin">Admin</a>` : ''}
<form method="post" action="/logout">${csrfField(user)}<button>Log out</button></form></div></details>`
  : html`<a class="btn ghost" href="/login">Log in</a><a class="btn" href="/signup">Sign up</a>`}</nav>
</div></header>
<main class="${sidebar ? 'grid' : 'single'}"><div class="col">${n ? html`<p class="notice">${n}</p>` : ''}${content}</div>${sidebar || ''}</main>
<footer><a href="/search">Search</a> · <a href="/communities">Communities</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · © ${new Date().getFullYear()} ${config.siteName}</footer>
</body></html>`;
}

export function sidebar({ tags, activeTag, user, community }) {
  return html`<aside>
${community ? html`<section class="card about"><h2>c/${community.name}</h2><p>${community.description || community.title}</p>
<p class="meta">${plural(community.post_count, 'post')} · <a href="/?tag=${community.tag_slug}">${community.tag_name}</a> · created ${timeAgo(community.created_at)}</p>
<a class="btn wide" href="/submit?c=${community.name}">Create post</a></section>` : html`<section class="card">
<h2>Home</h2><p>Anonymous prompts, tips and talk about every AI model.</p>
<a class="btn wide" href="/submit">Create post</a><a class="btn ghost wide" href="/communities/new">Create community</a></section>`}
<section class="card"><h2>Models</h2><ul class="tags">
<li><a href="/"${!activeTag ? raw(' class="on"') : ''}>All</a></li>
${tags.map(t => html`<li><a href="/?tag=${t.slug}"${activeTag === t.slug ? raw(' class="on"') : ''}>${t.name}</a></li>`)}
</ul><a class="more" href="/communities">Browse communities →</a></section>
${!user ? html`<section class="card"><p>Join anonymously — no real name needed.</p><a class="btn wide" href="/signup">Sign up</a></section>` : ''}
</aside>`;
}

const author = name => name ? html`<a href="/u/${name}">u/${name}</a>` : html`<span>[deleted]</span>`;

function voteBox(type, id, score, vote, user, back) {
  if (!user) return html`<div class="vote"><a href="/login" class="up" aria-label="Upvote">▲</a><b>${score}</b><a href="/login" class="dn" aria-label="Downvote">▼</a></div>`;
  const f = dir => html`<form method="post" action="/vote" class="v">${csrfField(user)}<input type="hidden" name="type" value="${type}"><input type="hidden" name="id" value="${id}"><input type="hidden" name="dir" value="${vote === dir ? 0 : dir}"><input type="hidden" name="back" value="${back}"><button class="${dir > 0 ? 'up' : 'dn'}${vote === dir ? ' on' : ''}" aria-label="${dir > 0 ? 'Upvote' : 'Downvote'}" aria-pressed="${vote === dir}">${dir > 0 ? '▲' : '▼'}</button></form>`;
  return html`<div class="vote" data-v="${vote || 0}">${f(1)}<b>${score}</b>${f(-1)}</div>`;
}

// Plain-text teaser: drop code blocks and Markdown syntax, keep the words (escaped later by html``).
const excerpt = s => s ? s.replace(/```[\s\S]*?(?:```|$)/g, ' … ')
  .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
  .replace(/^[ \t]*(?:#{1,6}|>|[-*+]|\d{1,9}[.)])[ \t]+/gm, '')
  .replace(/[*_~`]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 220) : '';

export function postList(posts, votes, user, { back, showCommunity = true, nextUrl, empty = 'No posts yet.' }) {
  if (!posts.length) return html`<p class="card empty">${empty}</p>`;
  return html`<ol class="posts">${posts.map(p => html`<li class="card post">
${voteBox('p', p.id, p.score, votes.get(p.id), user, back)}
<div class="body"><p class="meta">${showCommunity ? html`<a class="c" href="/c/${p.community}">c/${p.community}</a> · ` : ''}<a class="tag" href="/?tag=${p.tag_slug}">${p.tag_name}</a> · ${author(p.author)} · ${timeAgo(p.created_at)}</p>
<h2><a href="/p/${p.id}/${slugify(p.title)}">${p.title}</a>${p.url ? html` <a class="dom" href="${p.url}" rel="nofollow ugc noopener noreferrer">(${hostOf(p.url)})</a>` : ''}</h2>
${p.excerpt ? html`<p class="ex">${excerpt(p.excerpt)}</p>` : ''}
<p class="acts"><a href="/p/${p.id}/${slugify(p.title)}">${plural(p.comment_count, 'comment')}</a></p></div></li>`)}</ol>
${nextUrl ? html`<a class="btn ghost wide next" href="${nextUrl}" rel="next">Next page →</a>` : ''}`;
}

function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'link'; } }

export function sortTabs(base, sort, t, extra = '') {
  const sep = base.includes('?') ? '&' : '?';
  const tab = (s, label) => html`<a href="${base}${sep}sort=${s}${extra}"${sort === s ? raw(' class="on"') : ''}>${label}</a>`;
  return html`<nav class="tabs card">${tab('hot', 'Hot')}${tab('new', 'New')}${tab('top', 'Top')}
${sort === 'top' ? html`<span class="sp"></span>${['day', 'week', 'month', 'year', 'all'].map(w => html`<a href="${base}${sep}sort=top&t=${w}${extra}"${t === w ? raw(' class="on sm"') : raw(' class="sm"')}>${w}</a>`)}` : ''}</nav>`;
}

export function communityHeader(c) {
  return html`<section class="card chead"><h1>${c.title}</h1><p class="meta">c/${c.name} · <a class="tag" href="/?tag=${c.tag_slug}">${c.tag_name}</a></p></section>`;
}

// ---------- Post page ----------
function controls({ user, ownerName, type, id, back, editBody, removed, deleted, reportable = true }) {
  if (!user || removed || deleted) return '';
  const mine = user.username === ownerName;
  return html`${mine && editBody !== undefined ? html`<details class="inline"><summary>edit</summary>
<form method="post" action="/${type === 'p' ? 'p' : 'comment'}/${id}/edit" class="stack">${csrfField(user)}
<textarea name="body" rows="5" maxlength="${type === 'p' ? 40000 : 10000}"${type === 'c' ? raw(' required') : ''}>${editBody}</textarea><button class="btn">Save</button></form></details>` : ''}
${mine ? html`<details class="inline"><summary>delete</summary><form method="post" action="/${type === 'p' ? 'p' : 'comment'}/${id}/delete">${csrfField(user)}<button class="btn danger sm">Yes, delete</button></form></details>` : ''}
${!mine && reportable ? reportForm(user, type, id) : ''}
${user.is_admin ? html`<form method="post" action="/admin/remove" class="inline">${csrfField(user)}<input type="hidden" name="type" value="${type}"><input type="hidden" name="id" value="${id}"><input type="hidden" name="back" value="${back}"><button class="link danger">remove</button></form>` : ''}`;
}

export function reportForm(user, type, id) {
  return html`<details class="inline"><summary>report</summary><form method="post" action="/report" class="stack">${csrfField(user)}
<input type="hidden" name="type" value="${type}"><input type="hidden" name="id" value="${id}">
<input name="reason" maxlength="500" required placeholder="What's wrong?"><button class="btn sm">Send report</button></form></details>`;
}

export function postPage({ post, comments, votes, cvotes, user, sort }) {
  const back = `/p/${post.id}`;
  const gone = post.deleted_at || post.removed_at;
  return html`<article class="card post full">
${voteBox('p', post.id, post.score, votes.get(post.id), gone ? null : user, back)}
<div class="body"><p class="meta"><a class="c" href="/c/${post.community}">c/${post.community}</a> · <a class="tag" href="/?tag=${post.tag_slug}">${post.tag_name}</a> · ${author(post.author)} · ${timeAgo(post.created_at)}${post.edited_at ? ' · edited' : ''}</p>
<h1>${post.removed_at ? '[removed]' : post.title}</h1>
${!gone && post.url ? html`<p><a class="dom" href="${post.url}" rel="nofollow ugc noopener noreferrer">${post.url}</a></p>` : ''}
<div class="md">${post.removed_at ? html`<p class="muted">Removed by admin.</p>` : post.deleted_at ? html`<p class="muted">Deleted by author.</p>` : raw(markdown(post.body))}</div>
<div class="acts"><span>${plural(post.comment_count, 'comment')}</span> ${controls({ user, ownerName: post.author, type: 'p', id: post.id, back, editBody: post.body, removed: post.removed_at, deleted: post.deleted_at })}</div>
</div></article>
${user && !gone ? html`<form method="post" action="/p/${post.id}/comment" class="card stack reply">${csrfField(user)}
<textarea name="body" rows="4" maxlength="10000" required placeholder="Add a comment (Markdown supported)"></textarea><button class="btn">Comment</button></form>`
  : !user ? html`<p class="card empty"><a href="/login">Log in</a> or <a href="/signup">sign up</a> to comment.</p>` : ''}
<nav class="tabs card"><a href="${back}"${sort !== 'new' ? raw(' class="on"') : ''}>Best</a><a href="${back}?sort=new"${sort === 'new' ? raw(' class="on"') : ''}>New</a></nav>
<section class="comments">${comments.length ? commentTree(comments, cvotes, user, back, gone) : html`<p class="muted pad">No comments yet.</p>`}</section>`;
}

function commentTree(nodes, cvotes, user, back, locked) {
  return html`<ul class="tree">${nodes.map(c => {
    const gone = c.deleted_at || c.removed_at;
    return html`<li class="cm" id="c${c.id}"><div class="ch"><button class="tog" type="button" aria-label="Collapse thread">[–]</button>
${gone ? html`<span class="muted">[${c.removed_at ? 'removed' : 'deleted'}]</span>` : html`${author(c.author)}`} <span class="muted">· ${c.score} pts · ${timeAgo(c.created_at)}${c.edited_at ? ' · edited' : ''}</span></div>
<div class="cb">${gone ? '' : html`<div class="md">${raw(markdown(c.body))}</div>`}
<div class="acts">${gone ? '' : voteBox('c', c.id, c.score, cvotes.get(c.id), user, `${back}#c${c.id}`)}
${user && !gone && !locked ? html`<details class="inline"><summary>reply</summary><form method="post" action="${back}/comment" class="stack">${csrfField(user)}<input type="hidden" name="parent" value="${c.id}"><textarea name="body" rows="3" maxlength="10000" required></textarea><button class="btn sm">Reply</button></form></details>` : ''}
${controls({ user, ownerName: c.author, type: 'c', id: c.id, back: `${back}#c${c.id}`, editBody: c.body, removed: c.removed_at, deleted: c.deleted_at })}</div>
${c.children.length ? commentTree(c.children, cvotes, user, back, locked) : ''}</div></li>`;
  })}</ul>`;
}

// ---------- Forms ----------
const err = e => e ? html`<p class="error" role="alert">${e}</p>` : '';
const pwRules = 'At least 12 characters, with an uppercase letter and a number.';

export function signupForm({ ft, suggested, v = {}, error }) {
  return html`<section class="card form"><h1>Create an account</h1>${err(error)}
<form method="post" action="/signup" class="stack" id="signup">${formField(ft)}<input type="hidden" name="suggested" value="${suggested}">
<label>Username <small>(leave blank to keep ${suggested})</small><input name="username" maxlength="20" pattern="[A-Za-z0-9_\\-]{3,20}" placeholder="${suggested}" value="${v.username || ''}" autocomplete="username"></label>
<label>Email <small>(for verification and password resets — never shown)</small><input name="email" type="email" maxlength="254" required value="${v.email || ''}" autocomplete="email"></label>
<label>Password<input name="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label>
<label>Repeat password<input name="password2" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label>
<p class="hint" id="pwhint">${pwRules}</p>
${captcha('signup')}<button class="btn wide">Sign up</button></form>
<p class="muted">Already have an account? <a href="/login">Log in</a></p></section>`;
}

export function loginForm({ ft, error, username = '', back = '' }) {
  return html`<section class="card form"><h1>Log in</h1>${err(error)}
<form method="post" action="/login" class="stack">${formField(ft)}<input type="hidden" name="back" value="${back}">
<label>Username<input name="username" maxlength="20" required value="${username}" autocomplete="username"></label>
<label>Password<input name="password" type="password" maxlength="128" required autocomplete="current-password"></label>
${captcha('login')}<button class="btn wide">Log in</button></form>
<p class="muted"><a href="/forgot">Forgot password?</a> · <a href="/resend">Resend verification</a> · <a href="/signup">Create an account</a></p></section>`;
}

export function forgotForm({ ft, error }) {
  return html`<section class="card form"><h1>Forgot password</h1>${err(error)}
<p>Enter the email you signed up with. If it matches an account, we'll send a reset link (valid 30 minutes).</p>
<form method="post" action="/forgot" class="stack">${formField(ft)}
<label>Email<input name="email" type="email" maxlength="254" required autocomplete="email"></label>
${captcha('forgot')}<button class="btn wide">Send reset link</button></form></section>`;
}

export function resendForm({ ft, error }) {
  return html`<section class="card form"><h1>Resend verification</h1>${err(error)}
<p>Enter the email you signed up with. We don't store it, so we check it against a one-way fingerprint and, if it matches an unverified account, send a fresh link.</p>
<form method="post" action="/resend" class="stack">${formField(ft)}
<label>Email<input name="email" type="email" maxlength="254" required autocomplete="email"></label>
${captcha('resend')}<button class="btn wide">Send new link</button></form></section>`;
}

export function resetForm({ ft, token, error }) {
  return html`<section class="card form"><h1>Choose a new password</h1>${err(error)}
<form method="post" action="/reset" class="stack" id="signup">${formField(ft)}<input type="hidden" name="t" value="${token}">
<label>New password<input name="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label>
<label>Repeat password<input name="password2" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label>
<p class="hint" id="pwhint">${pwRules}</p><button class="btn wide">Change password</button></form></section>`;
}

export function verifyForm({ ft, token }) {
  return html`<section class="card form"><h1>Verify your email</h1>
<form method="post" action="/verify" class="stack">${formField(ft)}<input type="hidden" name="t" value="${token}"><button class="btn wide">Verify my email</button></form></section>`;
}

export const message = (title, text, extra = '') => html`<section class="card form"><h1>${title}</h1><p>${text}</p>${extra}</section>`;

export function submitForm({ user, community = '', v = {}, error }) {
  return html`<section class="card form wide"><h1>Create a post</h1>${err(error)}
<form method="post" action="/submit" class="stack">${csrfField(user)}
<label>Community<input name="community" maxlength="21" required placeholder="e.g. prompt_engineering" value="${v.community || community}"></label>
<label>Title<input name="title" maxlength="300" required value="${v.title || ''}"></label>
<label>Link <small>(optional)</small><input name="url" type="url" maxlength="2000" placeholder="https://" value="${v.url || ''}"></label>
<label>Text <small>(optional · Markdown: **bold**, *italic*, \`code\`, \`\`\`blocks\`\`\`, [links](https://…))</small><textarea name="body" rows="10" maxlength="40000">${v.body || ''}</textarea></label>
<button class="btn">Post</button></form></section>`;
}

export function communityForm({ user, tags, v = {}, error }) {
  return html`<section class="card form wide"><h1>Create a community</h1>${err(error)}
<p class="muted">A community is a topic space (like a subreddit) where people post. Pick which AI it's about.</p>
<form method="post" action="/communities/new" class="stack">${csrfField(user)}
<label>Name <small>(3–21 letters, numbers or _ · becomes c/name · can't be changed)</small><input name="name" maxlength="21" pattern="[A-Za-z0-9_]{3,21}" required value="${v.name || ''}"></label>
<label>Title<input name="title" maxlength="100" required value="${v.title || ''}"></label>
<label>AI model<select name="tag" required><option value="">Choose…</option>${tags.map(t => html`<option value="${t.slug}"${v.tag === t.slug ? raw(' selected') : ''}>${t.name}</option>`)}</select></label>
<label>Description <small>(optional)</small><textarea name="description" rows="4" maxlength="1000">${v.description || ''}</textarea></label>
<button class="btn">Create community</button></form></section>`;
}

export function communitiesPage({ list, tags, tag, sort, nextUrl, user }) {
  const extra = tag ? `&tag=${tag}` : '';
  return html`<section class="card chead"><h1>Communities</h1>${user ? html`<a class="btn sm" href="/communities/new">+ New community</a>` : ''}</section>
<nav class="tabs card"><a href="/communities?sort=popular${extra}"${sort !== 'new' ? raw(' class="on"') : ''}>Popular</a><a href="/communities?sort=new${extra}"${sort === 'new' ? raw(' class="on"') : ''}>New</a>
<span class="sp"></span><form action="/communities" class="tagpick"><input type="hidden" name="sort" value="${sort}"><select name="tag" aria-label="Filter by AI model"><option value="">All models</option>${tags.map(t => html`<option value="${t.slug}"${tag === t.slug ? raw(' selected') : ''}>${t.name}</option>`)}</select><button class="btn sm ghost">Filter</button></form></nav>
${list.length ? html`<ul class="clist">${list.map(c => html`<li class="card"><a href="/c/${c.name}"><b>c/${c.name}</b> — ${c.title}</a>
<p class="meta"><a class="tag" href="/communities?tag=${c.tag_slug}">${c.tag_name}</a> · ${plural(c.post_count, 'post')}</p>${c.description ? html`<p class="ex">${c.description.slice(0, 200)}</p>` : ''}</li>`)}</ul>` : html`<p class="card empty">No communities yet.</p>`}
${nextUrl ? html`<a class="btn ghost wide next" href="${nextUrl}">Next page →</a>` : ''}`;
}

export function profilePage({ profile, tab, items, votes, user, nextUrl }) {
  const base = `/u/${profile.username}`;
  return html`<section class="card chead"><h1>u/${profile.username}</h1><p class="meta">joined ${timeAgo(profile.created_at)}${profile.banned_at ? ' · suspended' : ''}</p>
${user?.is_admin && user.id !== profile.id ? html`<form method="post" action="/admin/${profile.banned_at ? 'unban' : 'ban'}" class="inline">${csrfField(user)}<input type="hidden" name="id" value="${profile.id}"><button class="btn sm danger">${profile.banned_at ? 'Unban' : 'Ban user'}</button></form>` : ''}</section>
<nav class="tabs card"><a href="${base}"${tab !== 'comments' ? raw(' class="on"') : ''}>Posts</a><a href="${base}?tab=comments"${tab === 'comments' ? raw(' class="on"') : ''}>Comments</a></nav>
${tab === 'comments'
    ? (items.length ? html`<ul class="clist">${items.map(c => html`<li class="card"><p class="meta">on <a href="/p/${c.post_id}/${slugify(c.post_title)}#c${c.id}">${c.post_title}</a> · ${c.score} pts · ${timeAgo(c.created_at)}</p><div class="md">${raw(markdown(c.body))}</div></li>`)}</ul>
       ${nextUrl ? html`<a class="btn ghost wide next" href="${nextUrl}">Next page →</a>` : ''}` : html`<p class="card empty">No comments.</p>`)
    : postList(items, votes, user, { back: base, nextUrl, empty: 'No posts.' })}`;
}

export function settingsPage({ user, error, ok }) {
  return html`<section class="card form"><h1>Settings</h1>${err(error)}${ok ? html`<p class="notice">${ok}</p>` : ''}
<h2>Change password</h2><form method="post" action="/settings/password" class="stack" id="signup">${csrfField(user)}
<label>Current password<input name="current" type="password" maxlength="128" required autocomplete="current-password"></label>
<label>New password<input name="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label>
<label>Repeat new password<input name="password2" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label>
<p class="hint" id="pwhint">${pwRules}</p><button class="btn">Change password</button></form>
<h2>Delete account</h2><p class="muted">Erases your email, password, posts and comments. This can't be undone.</p>
<form method="post" action="/settings/delete" class="stack">${csrfField(user)}
<label>Password<input name="current" type="password" maxlength="128" required autocomplete="current-password"></label>
<label>Type DELETE to confirm<input name="confirm" required pattern="DELETE"></label><button class="btn danger">Delete my account</button></form></section>`;
}

export function searchPage({ q, posts, votes, user, nextUrl }) {
  return html`<section class="card"><h1>${q ? html`Results for “${q}”` : 'Search'}</h1>
<form action="/search" class="sform" role="search"><input name="q" type="search" maxlength="200" value="${q}" placeholder="Search posts" aria-label="Search posts"><button class="btn">Search</button></form></section>
${q ? postList(posts, votes, user, { back: `/search?q=${encodeURIComponent(q)}`, nextUrl, empty: 'Nothing found.' }) : ''}`;
}

export function adminPage({ user, reports, tags }) {
  return html`<section class="card chead"><h1>Admin · open reports</h1></section>
${reports.length ? html`<ul class="clist">${reports.map(r => html`<li class="card"><p class="meta">#${r.id} · ${r.kind} · reported by ${author(r.reporter)} · ${timeAgo(r.created_at)}</p>
<p><b>Reason:</b> ${r.reason}</p><p class="ex"><a href="${r.link}">${r.preview || '(open)'}</a>${r.target_author ? html` — by ${author(r.target_author)}` : ''}${r.target_gone ? ' · already removed/deleted' : ''}</p>
<div class="acts"><form method="post" action="/admin/remove" class="inline">${csrfField(user)}<input type="hidden" name="type" value="${r.type}"><input type="hidden" name="id" value="${r.target_id}"><input type="hidden" name="back" value="/admin"><button class="btn sm danger">Remove</button></form>
<form method="post" action="/admin/dismiss" class="inline">${csrfField(user)}<input type="hidden" name="id" value="${r.id}"><button class="btn sm ghost">Dismiss</button></form></div></li>`)}</ul>` : html`<p class="card empty">No open reports.</p>`}
<section class="card form wide"><h2>AI model tags</h2><p class="muted">Add a tag, or reuse a slug to rename it.</p>
<p>${tags.map(t => html`<span class="tag">${t.slug}: ${t.name}</span> `)}</p>
<form method="post" action="/admin/tag" class="row">${csrfField(user)}<input name="slug" placeholder="slug (a-z, 0-9, -)" pattern="[a-z0-9\\-]{1,30}" required><input name="name" placeholder="Display name" maxlength="40" required><button class="btn sm">Save tag</button></form></section>`;
}

export function legalPage(kind) {
  if (kind === 'privacy') return html`<section class="card form wide md"><h1>Privacy</h1>
<p><b>What we store:</b> your username, a one-way keyed fingerprint of your email (never the address itself, so we can find your account when you type it for verification or a password reset, but can't read it back), a one-way Argon2id hash of your password, and the posts, comments, communities and votes you create.</p>
<p><b>What we don't store:</b> your IP address, real name, or tracking cookies. The only cookie is a session cookie that ends when you close your browser or after 2 hours of inactivity.</p>
<p><b>Third parties:</b> Cloudflare (network protection and captcha) and Google Gmail (sending account emails) process data on our behalf.</p>
<p><b>Your rights:</b> you can delete your account and all your content at any time from Settings.</p>
<p class="muted">Template — review with a lawyer before launch.</p></section>`;
  return html`<section class="card form wide md"><h1>Terms</h1>
<p>Be civil. No illegal content, spam, harassment, malware, or sharing of other people's private information. The admin may remove content or suspend accounts that break these rules. Content is provided as-is by users.</p>
<p class="muted">Template — review with a lawyer before launch.</p></section>`;
}

export const errorPage = (status, text) => html`<section class="card form"><h1>${status}</h1><p>${text}</p><p><a href="/">Back to home</a></p></section>`;
export { esc };
