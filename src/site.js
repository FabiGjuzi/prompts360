// site.js — everything on the site that an editor can change from the dashboard.
//   TEXTS    : registry of every editable string (key -> group, label, built-in default, input size).
//   t(key)   : the text to show = the dashboard override if one exists, otherwise the built-in default.
//   nav()    : header/footer links.   pageBySlug(): free-form pages.
// Overrides live in the site_settings table. A snapshot is kept in memory and refreshed after every
// dashboard save and at most every 15 s (so other app instances pick changes up too).
import { q } from './db.js';
import { config } from './config.js';

// [key, group, label, default, rows]   rows: 1 = one-line input, >1 = textarea
const R = [
  // ---- Brand & SEO ----
  ['site_name', 'Brand & SEO', 'Site name', config.siteName],
  ['slogan', 'Brand & SEO', 'Slogan (shown under the logo)', 'Communicating better for a more intelligent World'],
  ['seo.home_title', 'Brand & SEO', 'Home page <title>', 'prompts360 — Prompts for ChatGPT, Claude, Gemini and every AI model'],
  ['seo.description', 'Brand & SEO', 'Default meta description', 'Anonymous community for prompts, tips and discussion about ChatGPT, Claude, Gemini and every other AI model.', 3],
  ['seo.theme_color', 'Brand & SEO', 'Browser theme colour (hex)', '#4f46e5'],
  ['seo.twitter', 'Brand & SEO', 'Twitter/X handle (optional, e.g. @prompts360)', ''],
  ['seo.robots_extra', 'Brand & SEO', 'Extra robots.txt lines (one per line, e.g. Disallow: /private)', '', 4],
  // ---- Header & footer ----
  ['ui.skip', 'Header & footer', 'Skip-link text', 'Skip to content'],
  ['ui.search_placeholder', 'Header & footer', 'Search box placeholder', 'Search'],
  ['ui.search_label', 'Header & footer', 'Search box accessible label', 'Search posts'],
  ['ui.post_button', 'Header & footer', 'Post button', '+ Post'],
  ['ui.login', 'Header & footer', 'Log in button', 'Log in'],
  ['ui.signup', 'Header & footer', 'Sign up button', 'Sign up'],
  ['ui.menu_profile', 'Header & footer', 'Account menu: profile', 'Profile'],
  ['ui.menu_new_community', 'Header & footer', 'Account menu: new community', 'New community'],
  ['ui.menu_settings', 'Header & footer', 'Account menu: settings', 'Settings'],
  ['ui.menu_logout', 'Header & footer', 'Account menu: log out', 'Log out'],
  ['footer.copy', 'Header & footer', 'Footer text ({year} and {site} are replaced)', '© {year} {site}'],
  // ---- Home page ----
  ['home.heading', 'Home page', 'Main heading (H1)', 'Prompts for every AI model'],
  ['home.intro', 'Home page', 'Intro paragraph', 'Anonymous prompts, tips and talk about ChatGPT, Claude, Gemini, Grok, Llama and more. Copy what works, share what you find.', 3],
  ['home.empty', 'Home page', 'Empty feed message', 'No posts yet.'],
  ['feed.hot', 'Home page', 'Sort tab: Hot', 'Hot'],
  ['feed.new', 'Home page', 'Sort tab: New', 'New'],
  ['feed.top', 'Home page', 'Sort tab: Top', 'Top'],
  ['feed.next', 'Home page', '"Next page" button', 'Next page →'],
  // ---- Sidebar ----
  ['side.home_title', 'Sidebar', 'Home box title', 'Home'],
  ['side.home_text', 'Sidebar', 'Home box text', 'Anonymous prompts, tips and talk about every AI model.', 2],
  ['side.create_post', 'Sidebar', 'Create post button', 'Create post'],
  ['side.create_community', 'Sidebar', 'Create community button', 'Create community'],
  ['side.models_title', 'Sidebar', 'Models box title', 'Models'],
  ['side.all', 'Sidebar', 'Models: "All" link', 'All'],
  ['side.browse', 'Sidebar', 'Browse communities link', 'Browse communities →'],
  ['side.join_text', 'Sidebar', 'Join box text (visitors)', 'Join anonymously — no real name needed.'],
  // ---- Account pages ----
  ['login.title', 'Account pages', 'Log in: heading', 'Log in'],
  ['login.button', 'Account pages', 'Log in: button', 'Log in'],
  ['signup.title', 'Account pages', 'Sign up: heading', 'Create an account'],
  ['signup.intro', 'Account pages', 'Sign up: intro (optional)', '', 2],
  ['signup.button', 'Account pages', 'Sign up: button', 'Sign up'],
  ['forgot.title', 'Account pages', 'Forgot password: heading', 'Forgot password'],
  ['forgot.intro', 'Account pages', 'Forgot password: intro', 'Enter the email you signed up with. If it matches an account, we\'ll send a reset link (valid 30 minutes).', 2],
  ['forgot.button', 'Account pages', 'Forgot password: button', 'Send reset link'],
  ['resend.title', 'Account pages', 'Resend verification: heading', 'Resend verification'],
  ['resend.intro', 'Account pages', 'Resend verification: intro', 'Enter the email you signed up with. We don\'t store it, so we check it against a one-way fingerprint and, if it matches an unverified account, send a fresh link.', 3],
  ['resend.button', 'Account pages', 'Resend verification: button', 'Send new link'],
  ['reset.title', 'Account pages', 'Reset password: heading', 'Choose a new password'],
  ['reset.button', 'Account pages', 'Reset password: button', 'Change password'],
  ['verify.title', 'Account pages', 'Verify email: heading', 'Verify your email'],
  ['verify.button', 'Account pages', 'Verify email: button', 'Verify my email'],
  ['settings.title', 'Account pages', 'Settings: heading', 'Settings'],
  // ---- Forms & lists ----
  ['submit.title', 'Forms & lists', 'New post: heading', 'Create a post'],
  ['submit.button', 'Forms & lists', 'New post: button', 'Post'],
  ['cform.title', 'Forms & lists', 'New community: heading', 'Create a community'],
  ['cform.intro', 'Forms & lists', 'New community: intro', 'A community is a topic space (like a subreddit) where people post. Pick which AI it\'s about.', 2],
  ['cform.button', 'Forms & lists', 'New community: button', 'Create community'],
  ['communities.title', 'Forms & lists', 'Communities page: heading', 'Communities'],
  ['communities.empty', 'Forms & lists', 'Communities page: empty message', 'No communities yet.'],
  ['search.title', 'Forms & lists', 'Search page: heading', 'Search'],
  ['search.none', 'Forms & lists', 'Search: nothing found', 'Nothing found.'],
  ['post.comment_placeholder', 'Forms & lists', 'Comment box placeholder', 'Add a comment (Markdown supported)'],
  ['post.comment_button', 'Forms & lists', 'Comment button', 'Comment'],
  ['post.no_comments', 'Forms & lists', 'No comments message', 'No comments yet.'],
  // ---- Errors ----
  ['err.404', 'Errors', '404 message', 'Page not found.'],
  ['err.429', 'Errors', 'Too many requests message', 'Slow down — too many requests.'],
  // ---- Flash messages ----
  ['n.verified', 'Flash messages', 'After verifying email', 'Email verified — you can log in now.'],
  ['n.reset', 'Flash messages', 'After password reset', 'Password changed. Log in with your new password.'],
  ['n.pwchanged', 'Flash messages', 'After changing password', 'Password changed. Other sessions were signed out.'],
  ['n.logout', 'Flash messages', 'After logging out', 'You are logged out.'],
  ['n.deleted', 'Flash messages', 'After deleting', 'Deleted.'],
  ['n.removed', 'Flash messages', 'After removal by the administrator', 'Removed by the administrator.'],
  ['n.reported', 'Flash messages', 'After a report', 'Thanks — the administrator will review your report.'],
  ['n.community', 'Flash messages', 'After creating a community', 'Community created.'],
  ['n.edited', 'Flash messages', 'After editing', 'Saved.'],
  ['n.accountdeleted', 'Flash messages', 'After deleting an account', 'Your account and content were deleted.'],
];

/** Registry: key -> { key, group, label, def, rows }. */
export const TEXTS = Object.freeze(Object.fromEntries(R.map(([key, group, label, def, rows = 1]) => [key, { key, group, label, def, rows }])));

// ---------- Snapshot (refreshed from the database) ----------
let snap = { at: 0, over: new Map(), nav: { header: [], footer: [] }, pages: [], pageIdx: new Map() };
let loading = null;

/** Reload overrides, links and pages from the database. */
export function refreshSite() {
  loading ||= (async () => {
    const [s, n, p] = await Promise.all([
      q('SELECT key, value FROM site_settings'),
      q(`SELECT area, label, url FROM nav_links WHERE enabled ORDER BY sort, id`),
      q(`SELECT slug, title, body, meta_description, noindex, updated_at FROM pages WHERE published`),
    ]);
    const nav = { header: [], footer: [] };
    for (const r of n.rows) nav[r.area].push({ label: r.label, url: r.url });
    snap = { at: Date.now(), over: new Map(s.rows.map(r => [r.key, r.value])), nav, pages: p.rows, pageIdx: new Map(p.rows.map(r => [r.slug, r])) };
  })().finally(() => { loading = null; });
  return loading;
}
/** Make sure a snapshot exists (waits for the first load; later refreshes happen in the background). */
export async function ensureSite() {
  if (!snap.at) await refreshSite();
  else if (Date.now() - snap.at > 15_000) refreshSite().catch(e => console.error('[site]', e.message));
}

/** The text for `key`: dashboard override, else built-in default. {a} placeholders are filled from `vars`. */
export function t(key, vars) {
  const d = TEXTS[key];
  let v = snap.over.get(key);
  if (v === undefined || v === '') v = d ? d.def : '';
  if (vars) v = v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return v;
}
/** True if the editor set their own value for `key`. */
export const isOverridden = key => (snap.over.get(key) ?? '') !== '';
/** Header/footer links: [{label, url}]. */
export const nav = area => snap.nav[area] || [];
/** A published page by slug, or undefined. */
export const pageBySlug = slug => snap.pageIdx.get(slug);
/** All published pages (for the sitemap). */
export const allPages = () => snap.pages;
/** Brand name. */
export const siteName = () => t('site_name');
