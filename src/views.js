// views.js — every HTML page and component, written as html`` templates (escape-by-default).
// Page-level functions (signupForm, postPage …) return html; layout() wraps them in the site chrome.
import { html, raw, timeAgo, plural, slugify } from './html.js';
import { markdown, plain } from './markdown.js';
import { wys, hasEditor } from './wys.js';
import { tpl, current as design, isPreview } from './design.js';
import { config } from './config.js';
import { assets } from './assets.js';
import { t, nav, siteName, conn } from './site.js';
import { levelOf, communityMin, getTiers } from './points.js';

// Flash messages shown after a redirect (?n=<key>); only keys 'n.<key>' that exist in the texts registry are ever displayed.
const NOTICE_KEYS = new Set(['verified', 'reset', 'pwchanged', 'logout', 'deleted', 'removed', 'reported', 'community', 'edited', 'reposted', 'accountdeleted']);

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

const uiTexts = () => Object.fromEntries(['skip', 'search_placeholder', 'search_label', 'post_button', 'login', 'signup', 'menu_profile', 'menu_new_community', 'menu_settings', 'menu_notifications', 'menu_logout'].map(k => [k, t(`ui.${k}`)]));

/** The full HTML page: head (SEO, social cards, structured data), header (logo + slogan + search + account menu), main column + sidebar, footer. */
export function layout({ title, fullTitle, user, content, sidebar, q = '', turnstile = false, notice, desc, noindex, canonical, jsonld, ogType = 'website' }) {
  const n = notice && NOTICE_KEYS.has(notice) && t(`n.${notice}`);
  const D = design(), preview = isPreview();
  const edit = hasEditor([].concat(content, sidebar).join(''));
  const site = siteName(), slogan = t('slogan');
  const docTitle = fullTitle || (title ? `${title} · ${site}` : site);
  const description = desc || t('seo.description');
  const url = canonical ? `${config.baseUrl}${canonical === '/' ? '' : canonical}${canonical === '/' ? '/' : ''}` : '';
  const tw = t('seo.twitter');
  const ld = jsonld ? [].concat(jsonld) : [];
  const links = nav('header'), foot = nav('footer');
  // Analytics/ads only on public, indexable pages: never on account, reset/verify, search, profile, notification or preview pages.
  const track = !noindex && !preview && !turnstile && !!(conn('ga4') || conn('adsense'));
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${docTitle}</title>
<meta name="description" content="${description}">
<meta name="theme-color" content="${t('seo.theme_color')}">
${conn('gsc') ? html`<meta name="google-site-verification" content="${conn('gsc')}">` : ''}${track && conn('adsense') ? html`<meta name="google-adsense-account" content="ca-${conn('adsense')}">` : ''}
${noindex || preview ? raw('<meta name="robots" content="noindex,follow">') : raw('<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">')}
${url && !noindex && !preview ? html`<link rel="canonical" href="${url}">` : ''}
<meta property="og:site_name" content="${site}"><meta property="og:type" content="${ogType}"><meta property="og:title" content="${docTitle}">
<meta property="og:description" content="${description}">${url ? html`<meta property="og:url" content="${url}">` : ''}
<meta property="og:image" content="${config.baseUrl}${assets.og}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${site} — ${slogan}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${docTitle}"><meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${config.baseUrl}${assets.og}">
${tw ? html`<meta name="twitter:site" content="${tw}">` : ''}
<link rel="stylesheet" href="${assets.css}">${D.css ? html`<link rel="stylesheet" href="${D.css.url}">` : ''}<link rel="icon" href="${assets.icon}" type="image/svg+xml"><link rel="apple-touch-icon" href="${assets.touch}">
<link rel="sitemap" type="application/xml" href="/sitemap.xml">
<script src="${assets.js}" defer></script>${track ? html`${conn('ga4') ? html`<meta name="p360-ga" content="${conn('ga4')}">` : ''}${conn('adsense') ? html`<meta name="p360-ads" content="${conn('adsense')}">` : ''}<script src="${assets.consentJs}" defer></script>` : ''}${D.js ? html`<script src="${D.js.url}" defer></script>` : ''}${edit ? html`<link rel="stylesheet" href="${assets.editorCss}"><script src="${assets.editorJs}" defer></script>` : ''}
${turnstile && config.turnstileSiteKey ? raw('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>') : ''}
${ld.map(o => raw(`<script type="application/ld+json">${ldJson(o)}</script>`))}
</head><body>
${preview ? html`<div class="pvbar" role="status">Previewing the unpublished draft · <a href="${config.adminPath}/design/preview?on=0">Exit preview</a> · <a href="${config.adminPath}/design">Back to the editor</a></div>` : ''}<a class="skip" href="#main">${t('ui.skip')}</a>
${tpl('header', { site, slogan, logo: logo(), q, links, user: user ? { username: user.username, csrf: csrfField(user), unread: user.unread || 0, points: user.points || 0, level: user.level || levelOf(user.points).name } : null, ui: uiTexts() })}
<main id="main" class="${sidebar ? 'grid' : 'single'}"><div class="col">${n ? html`<p class="notice" role="status">${n}</p>` : ''}${content}</div>${sidebar || ''}</main>
${tpl('footer', { links: foot, copy: t('footer.copy', { year: new Date().getFullYear(), site }) + (t('footer.agents') ? ` · ${t('footer.agents')}` : ''), year: new Date().getFullYear(), site })}
</body></html>`;
}

/** Right-hand column: about box (home or community), AI model filter chips, sign-up prompt. */
export function sidebar({ tags, activeTag, user, community }) {
  const side = Object.fromEntries(['home_title', 'home_text', 'create_post', 'create_community', 'models_title', 'all', 'browse', 'join_text'].map(k => [k, t(`side.${k}`)]));
  return tpl('sidebar', {
    community: community ? { name: community.name, about: community.description ? raw(markdown(community.description)) : html`<p>${community.title}</p>`, posts: plural(community.post_count, 'post'),
      tag_slug: community.tag_slug, tag_name: community.tag_name, created: timeAgo(community.created_at), submit_url: `/submit?c=${community.name}` } : null,
    post_url: `/submit${activeTag ? `?m=${activeTag}` : ''}`, tags: tags.map(tg => ({ slug: tg.slug, name: tg.name, active: activeTag === tg.slug })), all_active: !activeTag,
    user: user ? { username: user.username } : null, side, ui: uiTexts(),
  });
}

/** Link to a user's profile, or '[deleted]'. */
const author = (name, points) => name ? html`<a href="/u/${name}">u/${name}</a>${points === undefined ? '' : html` <span class="lvl" title="${points} points">${levelOf(points).name}</span>`}` : html`<span>[deleted]</span>`;

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
  return html`<ol class="posts">${posts.map(p => {
    const url = `/p/${p.id}/${slugify(p.title)}`;
    return tpl('post_card', { votes: voteBox('p', p.id, p.score, votes.get(p.id), user, back), title: p.title, url, community: p.community, show_community: showCommunity, tag: p.tag_name, tag_slug: p.tag_slug,
      author: p.author || null, author_level: p.author && p.author_points !== undefined ? levelOf(p.author_points).name : '', author_points: p.author_points ?? 0, age: timeAgo(p.created_at), link: p.url ? { url: p.url, host: hostOf(p.url) } : null, excerpt: p.excerpt ? excerpt(p.excerpt) : '', comments: plural(p.comment_count, 'comment'), score: p.score, id: p.id,
      is_repost: Boolean(p.repost_of), quote: p.repost_of ? quoteData(p) : null, reposts: p.reposts ? plural(p.reposts, 'repost') : '', reposts_url: `/reposts/${p.id}` });
  })}</ol>
${nextUrl ? html`<a class="btn ghost wide next" href="${nextUrl}" rel="next">${t('feed.next')}</a>` : ''}`;
}

/** The embedded original of a repost, as plain values (used by the card template and the post page). */
function quoteData(p) {
  const gone = Boolean(p.o_gone);
  return { gone, url: gone ? '' : `/p/${p.o_id}/${slugify(p.o_title)}`, title: gone ? '' : p.o_title, community: p.o_community, tag: p.o_tag_name, tag_slug: p.o_tag_slug,
    author: gone ? null : p.o_author || null, age: gone ? '' : timeAgo(p.o_created), excerpt: gone || !p.o_excerpt ? '' : excerpt(p.o_excerpt) };
}
/** Twitter-style quote card for the post page (same markup as the card template's default). */
function quoteCard(p) {
  const q = quoteData(p);
  return html`<blockquote class="quote">${q.gone ? html`<p class="muted">This post is no longer available.</p>` : html`<p class="meta"><a class="c" href="/c/${q.community}">c/${q.community}</a> · <a class="tag" href="/m/${q.tag_slug}">${q.tag}</a> · ${author(q.author)} · ${q.age}</p>
<h2><a href="${q.url}">${q.title}</a></h2>${q.excerpt ? html`<p class="ex">${q.excerpt}</p>` : ''}`}</blockquote>`;
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
${type === 'p' ? wys({ name: 'body', md: editBody, rows: 8, max: 40000, label: 'Post text', hlevel: 2, hoff: 0 }) : wys({ name: 'body', md: editBody, rows: 5, max: 10000, required: true, label: 'Comment', compact: true })}<button class="btn">Save</button></form></details>` : ''}
${mine ? html`<details class="inline"><summary>delete</summary><form method="post" action="/${type === 'p' ? 'p' : 'comment'}/${id}/delete">${csrfField(user)}<button class="btn danger sm">Yes, delete</button></form></details>` : ''}
${!mine && reportable ? reportForm(user, type, id) : ''}`;
}

/** Collapsible 'report' form for a post, comment or community. */
export function reportForm(user, type, id) {
  return html`<details class="inline"><summary>report</summary><form method="post" action="/report" class="stack">${csrfField(user)}
<input type="hidden" name="type" value="${type}"><input type="hidden" name="id" value="${id}">
<input name="reason" maxlength="500" required placeholder="What's wrong?"><button class="btn sm">Send report</button></form></details>`;
}

/** Collapsible 'repost' form: an optional comment, then the post is quoted in the same community with the same model tag. */
function repostForm(user, id) {
  return html`<details class="inline"><summary>repost</summary><form method="post" action="/p/${id}/repost" class="stack">${csrfField(user)}
${wys({ name: 'body', md: '', rows: 4, max: 40000, label: 'Your comment (optional)' })}<button class="btn sm">Repost</button></form></details>`;
}

/** A single post: body, comment box, sort tabs and the comment tree. */
export function postPage({ post, comments, votes, cvotes, user, sort }) {
  const back = `/p/${post.id}`;
  const gone = post.deleted_at || post.removed_at;
  return html`<article class="card post full">
${voteBox('p', post.id, post.score, votes.get(post.id), gone ? null : user, back)}
<div class="body"><p class="meta"><a class="c" href="/c/${post.community}">c/${post.community}</a> · <a class="tag" href="/m/${post.tag_slug}">${post.tag_name}</a> · ${author(post.author, post.author_points)} · ${timeAgo(post.created_at)}${post.edited_at ? ' · edited' : ''}</p>
<h1>${post.removed_at ? '[removed]' : post.repost_of && !post.deleted_at ? html`<span class="rp" aria-hidden="true">↻</span> Repost: ${post.title}` : post.title}</h1>
${!gone && post.url ? html`<p><a class="dom" href="${post.url}" rel="nofollow ugc noopener noreferrer">${post.url}</a></p>` : ''}
<div class="md">${post.removed_at ? html`<p class="muted">Removed by admin.</p>` : post.deleted_at ? html`<p class="muted">Deleted by author.</p>` : post.body ? raw(markdown(post.body, { min: 2, off: 0 })) : ''}</div>
${post.repost_of && !gone ? quoteCard(post) : ''}
<div class="acts"><span>${plural(post.comment_count, 'comment')}</span>${post.reposts ? html` · <a href="/reposts/${post.id}">${plural(post.reposts, 'repost')}</a>` : ''} ${user && !gone && !post.o_gone ? repostForm(user, post.id) : ''} ${controls({ user, ownerName: post.author, type: 'p', id: post.id, back, editBody: post.body, removed: post.removed_at, deleted: post.deleted_at })}</div>
</div></article>
${user && !gone ? html`<form method="post" action="/p/${post.id}/comment" class="card stack reply">${csrfField(user)}
${wys({ name: 'body', md: '', rows: 4, max: 10000, required: true, label: t('post.comment_placeholder'), compact: true })}<button class="btn">${t('post.comment_button')}</button></form>`
  : !user ? html`<p class="card empty"><a href="/login">Log in</a> or <a href="/signup">sign up</a> to comment.</p>` : ''}
<nav class="tabs card"><a href="${back}"${sort !== 'new' ? raw(' class="on"') : ''}>Best</a><a href="${back}?sort=new"${sort === 'new' ? raw(' class="on"') : ''}>New</a></nav>
<section class="comments">${comments.length ? commentTree(comments, cvotes, user, back, gone) : html`<p class="muted pad">${t('post.no_comments')}</p>`}</section>`;
}

/** Recursively render nested comments with collapse, vote, reply, edit, delete and report controls. */
function commentTree(nodes, cvotes, user, back, locked) {
  return html`<ul class="tree">${nodes.map(c => {
    const gone = c.deleted_at || c.removed_at;
    return html`<li class="cm" id="c${c.id}"><div class="ch"><button class="tog" type="button" aria-label="Collapse thread">[–]</button>
${gone ? html`<span class="muted">[${c.removed_at ? 'removed' : 'deleted'}]</span>` : html`${author(c.author, c.author_points)}`} <span class="muted">· ${c.score} pts · ${timeAgo(c.created_at)}${c.edited_at ? ' · edited' : ''}</span></div>
<div class="cb">${gone ? '' : html`<div class="md">${raw(markdown(c.body))}</div>`}
<div class="acts">${gone ? '' : voteBox('c', c.id, c.score, cvotes.get(c.id), user, `${back}#c${c.id}`)}
${user && !gone && !locked ? html`<details class="inline"><summary>reply</summary><form method="post" action="${back}/comment" class="stack">${csrfField(user)}<input type="hidden" name="parent" value="${c.id}">${wys({ name: 'body', md: '', rows: 3, max: 10000, required: true, label: 'Reply', compact: true })}<button class="btn sm">Reply</button></form></details>` : ''}
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

/** Create-post form: community (pre-filled when you came from a community) + AI model tag + WYSIWYG text. */
export function submitForm({ user, community = '', v = {}, error, tags = [], communities = [] }) {
  const tag = v.tag || '';
  return html`<section class="card form wide"><h1>${t('submit.title')}</h1>${err(error)}
<form method="post" action="/submit" class="stack">${csrfField(user)}
<label>Community<input name="community" maxlength="21" required list="community-list" autocomplete="off" placeholder="Start typing a community name" value="${v.community || community}" data-tags="1"></label>
<datalist id="community-list">${communities.map(c => html`<option value="${c.name}" data-tag="${c.tag}"></option>`)}</datalist>
<label>AI model <small>(shown as the post's tag)</small><select name="tag" required><option value="">Choose…</option>${tags.map(m => html`<option value="${m.slug}"${tag === m.slug ? raw(' selected') : ''}>${m.name}</option>`)}</select></label>
<label>Title<input name="title" maxlength="300" required value="${v.title || ''}"></label>
<label>Link <small>(optional)</small><input name="url" type="url" maxlength="2000" placeholder="https://" value="${v.url || ''}"></label>
<div class="lbl">Body <small>(required)</small>${wys({ name: 'body', md: v.body || '', rows: 10, max: 40000, label: 'Post body', required: true, hlevel: 2, hoff: 0 })}</div>
<button class="btn">${t('submit.button')}</button></form></section>`;
}

/** Create-community form with the AI model picker and a WYSIWYG description. */
/** Level name, point total and a progress bar to the next level (profile page). */
function levelBox(points = 0) {
  const L = levelOf(points);
  return html`<p class="lvlbox"><span class="lvl">${L.name}</span> · <b>${points}</b> points · level ${L.level} of ${getTiers().length}</p>${L.next ? html`<p class="meta"><progress value="${points - L.min}" max="${L.next.min - L.min}" aria-label="Progress to ${L.next.name}"></progress> ${L.toNext} more to ${L.next.name}</p>` : ''}`;
}
/** How points are earned (shown where people ask for them). */
const pointsHelp = () => html`<details class="inline"><summary>How points work</summary><ul>
<li><b>5</b> points for each post you publish</li><li><b>2</b> points for each comment (not on your own post)</li><li><b>2</b> points when you repost someone's post, and 2 for the author of the post you reposted</li>
<li><b>1</b> point when you vote on a post or comment, and 1 for its author (not on your own)</li><li>Deleting or removing content takes its points back. Levels: ${getTiers().map(([m, n]) => `${n} ${m}`).join(', ')}.</li></ul></details>`;

export function communityForm({ user, tags, v = {}, error, points = Infinity }) {
  const need = communityMin(), locked = points < need;
  return html`<section class="card form wide"><h1>${t('cform.title')}</h1>${err(error)}
<p class="muted">${t('cform.intro')}</p>
${locked ? html`<div class="notice" role="status"><b>You need ${need} points to create a community.</b> You have ${points} (${need - points} to go). ${levelBox(points)}${pointsHelp()}</div>` : ''}
<form method="post" action="/communities/new" class="stack"><fieldset class="plain"${locked ? raw(' disabled') : ''}>${csrfField(user)}
<label>Name <small>(3–21 letters, numbers or _ · becomes c/name · unique · can't be changed)</small><input name="name" maxlength="21" pattern="[A-Za-z0-9_]{3,21}" required value="${v.name || ''}"></label>
<label>Title<input name="title" maxlength="100" required value="${v.title || ''}"></label>
<label>AI model<select name="tag" required><option value="">Choose…</option>${tags.map(t => html`<option value="${t.slug}"${v.tag === t.slug ? raw(' selected') : ''}>${t.name}</option>`)}</select></label>
<div class="lbl">Description <small>(optional)</small>${wys({ name: 'description', md: v.description || '', rows: 6, max: 4000, label: 'Community description' })}</div>
<button class="btn">${t('cform.button')}</button></fieldset></form></section>`;
}

/** Browse communities: Popular/New tabs, model filter, list. */
export function communitiesPage({ list, tags, tag, sort, nextUrl, user }) {
  const extra = tag ? `&tag=${tag}` : '';
  return html`<section class="card chead"><h1>${t('communities.title')}</h1>${user ? html`<a class="btn sm" href="/communities/new">+ New community</a>` : ''}</section>
<nav class="tabs card"><a href="/communities?sort=popular${extra}"${sort !== 'new' ? raw(' class="on"') : ''}>Popular</a><a href="/communities?sort=new${extra}"${sort === 'new' ? raw(' class="on"') : ''}>New</a>
<span class="sp"></span><form action="/communities" class="tagpick"><input type="hidden" name="sort" value="${sort}"><select name="tag" aria-label="Filter by AI model"><option value="">All models</option>${tags.map(t => html`<option value="${t.slug}"${tag === t.slug ? raw(' selected') : ''}>${t.name}</option>`)}</select><button class="btn sm ghost">Filter</button></form></nav>
${list.length ? html`<ul class="clist">${list.map(c => html`<li class="card"><a href="/c/${c.name}"><b>c/${c.name}</b> — ${c.title}</a>
<p class="meta"><a class="tag" href="/m/${c.tag_slug}">${c.tag_name}</a> · ${plural(c.post_count, 'post')}</p>${c.description ? html`<p class="ex">${plain(c.description).slice(0, 200)}</p>` : ''}</li>`)}</ul>` : html`<p class="card empty">${t('communities.empty')}</p>`}
${nextUrl ? html`<a class="btn ghost wide next" href="${nextUrl}" rel="next">${t('feed.next')}</a>` : ''}`;
}

/** A user's profile with Posts / Comments tabs (and the ban button for admins). */
export function profilePage({ profile, tab, items, votes, user, nextUrl }) {
  const base = `/u/${profile.username}`;
  return html`<section class="card chead"><h1>u/${profile.username}</h1><p class="meta">joined ${timeAgo(profile.created_at)}${profile.banned_at ? ' · suspended' : ''}</p>${levelBox(profile.points)}</section>
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
  return tpl('hero', { heading, intro: intro || '' });
}

/** Content of an error page. */
export const errorPage = (status, text) => html`<section class="card form"><h1>${status}</h1><p>${text}</p><p><a href="/">Back to home</a></p></section>`;

/** The notifications list (newest first). */
export function notificationsPage(rows) {
  return html`<section class="card form wide"><h1>Notifications</h1>${rows.length ? html`<ol class="notifs">${rows.map(n => {
    const gone = n.deleted_at || n.removed_at;
    return html`<li${n.read_at ? '' : raw(' class="unread"')}>${author(n.actor)} reposted your post ${gone ? html`<span class="muted">(since removed)</span>` : html`<a href="/p/${n.post_id}/${slugify(n.title)}">${n.title}</a>`} <span class="muted">· ${timeAgo(n.created_at)}</span></li>`;
  })}</ol>` : html`<p class="empty">Nothing yet. When someone reposts one of your posts, you will see it here.</p>`}</section>`;
}
