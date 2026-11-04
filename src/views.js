// views.js — every HTML page and component, written as html`` templates (escape-by-default).
// Page-level functions (signupForm, postPage …) return html; layout() wraps them in the site chrome.
import { html, raw, timeAgo, plural, slugify } from './html.js';
import { markdown } from './markdown.js';
import { config } from './config.js';
import { assets } from './assets.js';
import { t, nav, siteName } from './site.js';

// Flash messages shown after a redirect (?n=<key>); only keys 'n.<key>' that exist in the texts registry are ever displayed.
const NOTICE_KEYS = new Set(['verified', 'reset', 'pwchanged', 'logout', 'deleted', 'removed', 'reported', 'community', 'edited', 'accountdeleted']);

// Animated logo (360.si → 3pSI and back, forever) is a separate, cached SVG made by scripts/build-logo.js.
// <picture> picks the dark-mode file and, for visitors who ask for reduced motion, a still version.
const logo = () => html`<picture>
<source media="(prefers-reduced-motion: reduce) and (prefers-color-scheme: dark)" srcset="${assets.logoStaticDark}">
<source media="(prefers-reduced-motion: reduce)" srcset="${assets.logoStaticLight}">
<source media="(prefers-color-scheme: dark)" srcset="${assets.logoDark}">
<img class="logo" src="${assets.logoLight}" alt="" width="74" height="34"></picture>`;

/** Hidden CSRF input for logged-in forms (empty for visitors). */
const csrfField = user => user ? html`<input type="hidden" name="_csrf" value="${user.csrf}">` : '';
/** Hidden signed token input for logged-out forms (login, signup, reset, …). */
const formField = ft => html`<input type="hidden" name="_ft" value="${ft}">`;
/** Cloudflare Turnstile widget for `action` (empty when no site key is configured). */
const captcha = action => config.turnstileSiteKey
  ? html`<div class="cf-turnstile" data-sitekey="${config.turnstileSiteKey}" data-action="${action}" data-theme="auto"></div>`
  : '';

/** JSON-LD must not be able to close its own <script>: escape < and the JS line separators. */
const ldJson = o => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** The full HTML page: head (SEO, social cards, structured data), header (logo + slogan + search + account menu), main column + sidebar, footer. */
export function layout({ title, fullTitle, user, content, sidebar, q = '', turnstile = false, notice, desc, noindex, canonical, jsonld, ogType = 'website' }) {
  const n = notice && NOTICE_KEYS.has(notice) && t(`n.${notice}`);
  const site = siteName(), slogan = t('slogan');
  const docTitle = fullTitle || (title ? `${title} · ${site}` : site);
  const description = desc || t('seo.description');
  const url = canonical ? `${config.baseUrl}${canonical === '/' ? '' : canonical}${canonical === '/' ? '/' : ''}` : '';
  const tw = t('seo.twitter');
  const ld = jsonld ? [].concat(jsonld) : [];
  const links = nav('header'), foot = nav('footer');
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${docTitle}</title>
<meta name="description" content="${description}">
<meta name="theme-color" content="${t('seo.theme_color')}">
${noindex ? raw('<meta name="robots" content="noindex,follow">') : raw('<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">')}
${url && !noindex ? html`<link rel="canonical" href="${url}">` : ''}
<meta property="og:site_name" content="${site}"><meta property="og:type" content="${ogType}"><meta property="og:title" content="${docTitle}">
<meta property="og:description" content="${description}">${url ? html`<meta property="og:url" content="${url}">` : ''}
<meta property="og:image" content="${config.baseUrl}${assets.og}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${site} — ${slogan}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${docTitle}"><meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${config.baseUrl}${assets.og}">
${tw ? html`<meta name="twitter:site" content="${tw}">` : ''}
<link rel="stylesheet" href="${assets.css}"><link rel="icon" href="${assets.icon}" type="image/svg+xml"><link rel="apple-touch-icon" href="${assets.touch}">
<link rel="sitemap" type="application/xml" href="/sitemap.xml">
<script src="${assets.js}" defer></script>
${turnstile && config.turnstileSiteKey ? raw('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>') : ''}
${ld.map(o => raw(`<script type="application/ld+json">${ldJson(o)}</script>`))}
</head><body>
<a class="skip" href="#main">${t('ui.skip')}</a>
<header class="top"><div class="bar">
<a class="brand" href="/" aria-label="${site} — ${slogan}">${logo()}<span class="slogan">${slogan}</span></a>
<form class="search" action="/search" role="search"><input name="q" type="search" placeholder="${t('ui.search_placeholder')}" maxlength="200" value="${q}" aria-label="${t('ui.search_label')}"></form>
${links.length ? html`<nav class="links" aria-label="Main">${links.map(l => html`<a href="${l.url}">${l.label}</a>`)}</nav>` : ''}
<nav aria-label="Account">${user ? html`<a class="btn" href="/submit">${t('ui.post_button')}</a>
<details class="menu"><summary>${user.username}</summary><div>
<a href="/u/${user.username}">${t('ui.menu_profile')}</a><a href="/communities/new">${t('ui.menu_new_community')}</a><a href="/settings">${t('ui.menu_settings')}</a>
<form method="post" action="/logout">${csrfField(user)}<button>${t('ui.menu_logout')}</button></form></div></details>`
  : html`<a class="btn ghost" href="/login">${t('ui.login')}</a><a class="btn" href="/signup">${t('ui.signup')}</a>`}</nav>
</div></header>
<main id="main" class="${sidebar ? 'grid' : 'single'}"><div class="col">${n ? html`<p class="notice" role="status">${n}</p>` : ''}${content}</div>${sidebar || ''}</main>
<footer><nav aria-label="Footer">${foot.map(l => html`<a href="${l.url}">${l.label}</a>`)}</nav><p>${t('footer.copy', { year: new Date().getFullYear(), site })}</p></footer>
</body></html>`;
}

/** Right-hand column: about box (home or community), AI model filter chips, sign-up prompt. */
export function sidebar({ tags, activeTag, user, community }) {
  return html`<aside>
${community ? html`<section class="card about"><h2>c/${community.name}</h2><p>${community.description || community.title}</p>
<p class="meta">${plural(community.post_count, 'post')} · <a href="/m/${community.tag_slug}">${community.tag_name}</a> · created ${timeAgo(community.created_at)}</p>
<a class="btn wide" href="/submit?c=${community.name}">${t('side.create_post')}</a></section>` : html`<section class="card">
<h2>${t('side.home_title')}</h2><p>${t('side.home_text')}</p>
<a class="btn wide" href="/submit">${t('side.create_post')}</a><a class="btn ghost wide" href="/communities/new">${t('side.create_community')}</a></section>`}
<section class="card"><h2>${t('side.models_title')}</h2><ul class="tags">
<li><a href="/"${!activeTag ? raw(' class="on" aria-current="page"') : ''}>${t('side.all')}</a></li>
${tags.map(tg => html`<li><a href="/m/${tg.slug}"${activeTag === tg.slug ? raw(' class="on" aria-current="page"') : ''}>${tg.name}</a></li>`)}
</ul><a class="more" href="/communities">${t('side.browse')}</a></section>
${!user ? html`<section class="card"><p>${t('side.join_text')}</p><a class="btn wide" href="/signup">${t('ui.signup')}</a></section>` : ''}
</aside>`;
}

/** Link to a user's profile, or '[deleted]'. */
const author = name => name ? html`<a href="/u/${name}">u/${name}</a>` : html`<span>[deleted]</span>`;

/** Up/down arrows with the score. Logged-in users get real forms (no-JS works; app.js upgrades them to in-place updates); visitors get login links. */
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

/** A list of post cards with vote boxes, plus a 'Next page' link when there are more. */
export function postList(posts, votes, user, { back, showCommunity = true, nextUrl, empty = t('home.empty') }) {
  if (!posts.length) return html`<p class="card empty">${empty}</p>`;
  return html`<ol class="posts">${posts.map(p => html`<li class="card post">
${voteBox('p', p.id, p.score, votes.get(p.id), user, back)}
<div class="body"><p class="meta">${showCommunity ? html`<a class="c" href="/c/${p.community}">c/${p.community}</a> · ` : ''}<a class="tag" href="/m/${p.tag_slug}">${p.tag_name}</a> · ${author(p.author)} · ${timeAgo(p.created_at)}</p>
<h2><a href="/p/${p.id}/${slugify(p.title)}">${p.title}</a>${p.url ? html` <a class="dom" href="${p.url}" rel="nofollow ugc noopener noreferrer">(${hostOf(p.url)})</a>` : ''}</h2>
${p.excerpt ? html`<p class="ex">${excerpt(p.excerpt)}</p>` : ''}
<p class="acts"><a href="/p/${p.id}/${slugify(p.title)}">${plural(p.comment_count, 'comment')}</a></p></div></li>`)}</ol>
${nextUrl ? html`<a class="btn ghost wide next" href="${nextUrl}" rel="next">${t('feed.next')}</a>` : ''}`;
}

/** Domain shown next to link posts, e.g. 'example.com'. */
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'link'; } }

/** Hot / New / Top tabs (plus time-window chips for Top). */
export function sortTabs(base, sort, win, extra = '') {
  const sep = base.includes('?') ? '&' : '?';
  const tab = (s, label) => html`<a href="${base}${sep}sort=${s}${extra}"${sort === s ? raw(' class="on"') : ''}>${label}</a>`;
  return html`<nav class="tabs card">${tab('hot', t('feed.hot'))}${tab('new', t('feed.new'))}${tab('top', t('feed.top'))}
${sort === 'top' ? html`<span class="sp"></span>${['day', 'week', 'month', 'year', 'all'].map(w => html`<a href="${base}${sep}sort=top&t=${w}${extra}"${win === w ? raw(' class="on sm"') : raw(' class="sm"')}>${w}</a>`)}` : ''}</nav>`;
}

/** Title block at the top of a community page. */
export function communityHeader(c) {
  return html`<section class="card chead"><h1>${c.title}</h1><p class="meta">c/${c.name} · <a class="tag" href="/m/${c.tag_slug}">${c.tag_name}</a></p></section>`;
}

// ---------- Post page ----------
/** Edit / delete / report / admin-remove controls for a post or comment, shown according to who is looking. */
function controls({ user, ownerName, type, id, back, editBody, removed, deleted, reportable = true }) {
  if (!user || removed || deleted) return '';
  const mine = user.username === ownerName;
  return html`${mine && editBody !== undefined ? html`<details class="inline"><summary>edit</summary>
<form method="post" action="/${type === 'p' ? 'p' : 'comment'}/${id}/edit" class="stack">${csrfField(user)}
<textarea name="body" rows="5" maxlength="${type === 'p' ? 40000 : 10000}"${type === 'c' ? raw(' required') : ''}>${editBody}</textarea><button class="btn">Save</button></form></details>` : ''}
${mine ? html`<details class="inline"><summary>delete</summary><form method="post" action="/${type === 'p' ? 'p' : 'comment'}/${id}/delete">${csrfField(user)}<button class="btn danger sm">Yes, delete</button></form></details>` : ''}
${!mine && reportable ? reportForm(user, type, id) : ''}`;
}

/** Collapsible 'report' form for a post, comment or community. */
export function reportForm(user, type, id) {
  return html`<details class="inline"><summary>report</summary><form method="post" action="/report" class="stack">${csrfField(user)}
<input type="hidden" name="type" value="${type}"><input type="hidden" name="id" value="${id}">
<input name="reason" maxlength="500" required placeholder="What's wrong?"><button class="btn sm">Send report</button></form></details>`;
}

/** A single post: body, comment box, sort tabs and the comment tree. */
export function postPage({ post, comments, votes, cvotes, user, sort }) {
  const back = `/p/${post.id}`;
  const gone = post.deleted_at || post.removed_at;
  return html`<article class="card post full">
${voteBox('p', post.id, post.score, votes.get(post.id), gone ? null : user, back)}
<div class="body"><p class="meta"><a class="c" href="/c/${post.community}">c/${post.community}</a> · <a class="tag" href="/m/${post.tag_slug}">${post.tag_name}</a> · ${author(post.author)} · ${timeAgo(post.created_at)}${post.edited_at ? ' · edited' : ''}</p>
<h1>${post.removed_at ? '[removed]' : post.title}</h1>
${!gone && post.url ? html`<p><a class="dom" href="${post.url}" rel="nofollow ugc noopener noreferrer">${post.url}</a></p>` : ''}
<div class="md">${post.removed_at ? html`<p class="muted">Removed by admin.</p>` : post.deleted_at ? html`<p class="muted">Deleted by author.</p>` : raw(markdown(post.body))}</div>
<div class="acts"><span>${plural(post.comment_count, 'comment')}</span> ${controls({ user, ownerName: post.author, type: 'p', id: post.id, back, editBody: post.body, removed: post.removed_at, deleted: post.deleted_at })}</div>
</div></article>
${user && !gone ? html`<form method="post" action="/p/${post.id}/comment" class="card stack reply">${csrfField(user)}
<textarea name="body" rows="4" maxlength="10000" required placeholder="${t('post.comment_placeholder')}"></textarea><button class="btn">${t('post.comment_button')}</button></form>`
  : !user ? html`<p class="card empty"><a href="/login">Log in</a> or <a href="/signup">sign up</a> to comment.</p>` : ''}
<nav class="tabs card"><a href="${back}"${sort !== 'new' ? raw(' class="on"') : ''}>Best</a><a href="${back}?sort=new"${sort === 'new' ? raw(' class="on"') : ''}>New</a></nav>
<section class="comments">${comments.length ? commentTree(comments, cvotes, user, back, gone) : html`<p class="muted pad">${t('post.no_comments')}</p>`}</section>`;
}

/** Recursively render nested comments with collapse, vote, reply, edit, delete and report controls. */
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
/** Red error box for form pages (empty when there's no error). */
const err = e => e ? html`<p class="error" role="alert">${e}</p>` : '';
// Password rule text shown under every password field (enforced server-side in validate.passwordProblem).
const pwRules = 'At least 12 characters, with an uppercase letter and a number.';

/** Sign-up page: username (placeholder = generated anon name), email, password twice, captcha. */
export function signupForm({ ft, suggested, v = {}, error }) {
  return html`<section class="card form"><h1>${t('signup.title')}</h1>${t('signup.intro') ? html`<p>${t('signup.intro')}</p>` : ''}${err(error)}
<form method="post" action="/signup" class="stack" id="signup">${formField(ft)}<input type="hidden" name="suggested" value="${suggested}">
<label>Username <small>(leave blank to keep ${suggested})</small><input name="username" maxlength="20" pattern="[A-Za-z0-9_\\-]{3,20}" placeholder="${suggested}" value="${v.username || ''}" autocomplete="username"></label>
<label>Email <small>(for verification and password resets — never shown)</small><input name="email" type="email" maxlength="254" required value="${v.email || ''}" autocomplete="email"></label>
<label>Password<input name="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label>
<label>Repeat password<input name="password2" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label>
<p class="hint" id="pwhint">${pwRules}</p>
${captcha('signup')}<button class="btn wide">${t('signup.button')}</button></form>
<p class="muted">Already have an account? <a href="/login">Log in</a></p></section>`;
}

/** Login page: username, password, captcha, forgot/resend/sign-up links. */
export function loginForm({ ft, error, username = '', back = '' }) {
  return html`<section class="card form"><h1>${t('login.title')}</h1>${err(error)}
<form method="post" action="/login" class="stack">${formField(ft)}<input type="hidden" name="back" value="${back}">
<label>Username<input name="username" maxlength="20" required value="${username}" autocomplete="username"></label>
<label>Password<input name="password" type="password" maxlength="128" required autocomplete="current-password"></label>
${captcha('login')}<button class="btn wide">${t('login.button')}</button></form>
<p class="muted"><a href="/forgot">Forgot password?</a> · <a href="/resend">Resend verification</a> · <a href="/signup">Create an account</a></p></section>`;
}

/** Forgot-password page: email + captcha. */
export function forgotForm({ ft, error }) {
  return html`<section class="card form"><h1>${t('forgot.title')}</h1>${err(error)}
<p>${t('forgot.intro')}</p>
<form method="post" action="/forgot" class="stack">${formField(ft)}
<label>Email<input name="email" type="email" maxlength="254" required autocomplete="email"></label>
${captcha('forgot')}<button class="btn wide">${t('forgot.button')}</button></form></section>`;
}

/** Resend-verification page: email + captcha. */
export function resendForm({ ft, error }) {
  return html`<section class="card form"><h1>${t('resend.title')}</h1>${err(error)}
<p>${t('resend.intro')}</p>
<form method="post" action="/resend" class="stack">${formField(ft)}
<label>Email<input name="email" type="email" maxlength="254" required autocomplete="email"></label>
${captcha('resend')}<button class="btn wide">${t('resend.button')}</button></form></section>`;
}

/** Choose-a-new-password page (reached from the emailed link). */
export function resetForm({ ft, token, error }) {
  return html`<section class="card form"><h1>${t('reset.title')}</h1>${err(error)}
<form method="post" action="/reset" class="stack" id="signup">${formField(ft)}<input type="hidden" name="t" value="${token}">
<label>New password<input name="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label>
<label>Repeat password<input name="password2" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label>
<p class="hint" id="pwhint">${pwRules}</p><button class="btn wide">${t('reset.button')}</button></form></section>`;
}

/** Email verification confirmation button (a POST, so email-scanner bots can't consume the link). */
export function verifyForm({ ft, token }) {
  return html`<section class="card form"><h1>${t('verify.title')}</h1>
<form method="post" action="/verify" class="stack">${formField(ft)}<input type="hidden" name="t" value="${token}"><button class="btn wide">${t('verify.button')}</button></form></section>`;
}

export const message = (title, text, extra = '') => html`<section class="card form"><h1>${title}</h1><p>${text}</p>${extra}</section>`;

/** Create-post form. */
export function submitForm({ user, community = '', v = {}, error }) {
  return html`<section class="card form wide"><h1>${t('submit.title')}</h1>${err(error)}
<form method="post" action="/submit" class="stack">${csrfField(user)}
<label>Community<input name="community" maxlength="21" required placeholder="e.g. prompt_engineering" value="${v.community || community}"></label>
<label>Title<input name="title" maxlength="300" required value="${v.title || ''}"></label>
<label>Link <small>(optional)</small><input name="url" type="url" maxlength="2000" placeholder="https://" value="${v.url || ''}"></label>
<label>Text <small>(optional · Markdown: **bold**, *italic*, \`code\`, \`\`\`blocks\`\`\`, [links](https://…))</small><textarea name="body" rows="10" maxlength="40000">${v.body || ''}</textarea></label>
<button class="btn">${t('submit.button')}</button></form></section>`;
}

/** Create-community form with the AI model picker. */
export function communityForm({ user, tags, v = {}, error }) {
  return html`<section class="card form wide"><h1>${t('cform.title')}</h1>${err(error)}
<p class="muted">${t('cform.intro')}</p>
<form method="post" action="/communities/new" class="stack">${csrfField(user)}
<label>Name <small>(3–21 letters, numbers or _ · becomes c/name · can't be changed)</small><input name="name" maxlength="21" pattern="[A-Za-z0-9_]{3,21}" required value="${v.name || ''}"></label>
<label>Title<input name="title" maxlength="100" required value="${v.title || ''}"></label>
<label>AI model<select name="tag" required><option value="">Choose…</option>${tags.map(t => html`<option value="${t.slug}"${v.tag === t.slug ? raw(' selected') : ''}>${t.name}</option>`)}</select></label>
<label>Description <small>(optional)</small><textarea name="description" rows="4" maxlength="1000">${v.description || ''}</textarea></label>
<button class="btn">${t('cform.button')}</button></form></section>`;
}

/** Browse communities: Popular/New tabs, model filter, list. */
export function communitiesPage({ list, tags, tag, sort, nextUrl, user }) {
  const extra = tag ? `&tag=${tag}` : '';
  return html`<section class="card chead"><h1>${t('communities.title')}</h1>${user ? html`<a class="btn sm" href="/communities/new">+ New community</a>` : ''}</section>
<nav class="tabs card"><a href="/communities?sort=popular${extra}"${sort !== 'new' ? raw(' class="on"') : ''}>Popular</a><a href="/communities?sort=new${extra}"${sort === 'new' ? raw(' class="on"') : ''}>New</a>
<span class="sp"></span><form action="/communities" class="tagpick"><input type="hidden" name="sort" value="${sort}"><select name="tag" aria-label="Filter by AI model"><option value="">All models</option>${tags.map(t => html`<option value="${t.slug}"${tag === t.slug ? raw(' selected') : ''}>${t.name}</option>`)}</select><button class="btn sm ghost">Filter</button></form></nav>
${list.length ? html`<ul class="clist">${list.map(c => html`<li class="card"><a href="/c/${c.name}"><b>c/${c.name}</b> — ${c.title}</a>
<p class="meta"><a class="tag" href="/m/${c.tag_slug}">${c.tag_name}</a> · ${plural(c.post_count, 'post')}</p>${c.description ? html`<p class="ex">${c.description.slice(0, 200)}</p>` : ''}</li>`)}</ul>` : html`<p class="card empty">${t('communities.empty')}</p>`}
${nextUrl ? html`<a class="btn ghost wide next" href="${nextUrl}" rel="next">${t('feed.next')}</a>` : ''}`;
}

/** A user's profile with Posts / Comments tabs (and the ban button for admins). */
export function profilePage({ profile, tab, items, votes, user, nextUrl }) {
  const base = `/u/${profile.username}`;
  return html`<section class="card chead"><h1>u/${profile.username}</h1><p class="meta">joined ${timeAgo(profile.created_at)}${profile.banned_at ? ' · suspended' : ''}</p></section>
<nav class="tabs card"><a href="${base}"${tab !== 'comments' ? raw(' class="on"') : ''}>Posts</a><a href="${base}?tab=comments"${tab === 'comments' ? raw(' class="on"') : ''}>Comments</a></nav>
${tab === 'comments'
    ? (items.length ? html`<ul class="clist">${items.map(c => html`<li class="card"><p class="meta">on <a href="/p/${c.post_id}/${slugify(c.post_title)}#c${c.id}">${c.post_title}</a> · ${c.score} pts · ${timeAgo(c.created_at)}</p><div class="md">${raw(markdown(c.body))}</div></li>`)}</ul>
       ${nextUrl ? html`<a class="btn ghost wide next" href="${nextUrl}">Next page →</a>` : ''}` : html`<p class="card empty">No comments.</p>`)
    : postList(items, votes, user, { back: base, nextUrl, empty: 'No posts.' })}`;
}

/** Change password and delete account forms. */
export function settingsPage({ user, error, ok }) {
  return html`<section class="card form"><h1>${t('settings.title')}</h1>${err(error)}${ok ? html`<p class="notice">${ok}</p>` : ''}
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

/** Search box and results. */
export function searchPage({ q, posts, votes, user, nextUrl }) {
  return html`<section class="card"><h1>${q ? html`Results for “${q}”` : t('search.title')}</h1>
<form action="/search" class="sform" role="search"><input name="q" type="search" maxlength="200" value="${q}" placeholder="${t('ui.search_label')}" aria-label="${t('ui.search_label')}"><button class="btn">${t('search.title')}</button></form></section>
${q ? postList(posts, votes, user, { back: `/search?q=${encodeURIComponent(q)}`, nextUrl, empty: t('search.none') }) : ''}`;
}

/** A free-form page from the dashboard (Privacy, Terms, About …): Markdown body. */
export function cmsPage(p) {
  return html`<section class="card form wide md"><h1>${p.title}</h1>${raw(markdown(p.body, { min: 2, off: 0 }))}</section>`;
}

/** Hero block at the top of the home page and of each model landing page. */
export function hero(heading, intro) {
  return html`<section class="card hero"><h1>${heading}</h1>${intro ? html`<p>${intro}</p>` : ''}</section>`;
}

/** Content of an error page. */
export const errorPage = (status, text) => html`<section class="card form"><h1>${status}</h1><p>${text}</p><p><a href="/">Back to home</a></p></section>`;
