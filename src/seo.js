// seo.js — everything search engines see besides the page HTML: robots.txt, sitemap.xml, structured data (JSON-LD).
import { qr } from './db.js';
import { config } from './config.js';
import { t, siteName, allPages } from './site.js';
import { esc } from './html.js';
import { assets } from './assets.js';

const base = config.baseUrl;
const abs = path => `${base}${path}`;

// ---------- robots.txt ----------
/** robots.txt: block account/search pages (the dashboard path is NOT listed — that would reveal it; it answers 404 and noindex anyway). */
export function robotsTxt() {
  const extra = t('seo.robots_extra').split('\n').map(l => l.trim()).filter(l => /^[A-Za-z-]+:\s*\S/.test(l));
  return ['User-agent: *', 'Disallow: /login', 'Disallow: /signup', 'Disallow: /forgot', 'Disallow: /reset', 'Disallow: /verify', 'Disallow: /resend',
    'Disallow: /search', 'Disallow: /settings', 'Disallow: /submit', 'Disallow: /communities/new', ...extra, '', `Sitemap: ${abs('/sitemap.xml')}`, ''].join('\n');
}

// ---------- sitemap.xml ----------
let cache = { at: 0, xml: '' };
export const clearSeoCache = () => { cache.at = 0; };
const iso = d => (d ? new Date(d).toISOString().slice(0, 10) : undefined);
const entry = (loc, lastmod, freq, prio) => `<url><loc>${esc(abs(loc))}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<changefreq>${freq}</changefreq><priority>${prio}</priority></url>`;

/** sitemap.xml: home, models, communities, published pages and up to 45,000 newest posts. Cached 10 minutes (and cleared on every dashboard edit). */
export async function sitemapXml() {
  if (Date.now() - cache.at < 600_000 && cache.xml) return cache.xml;
  const [tags, comms, posts] = await Promise.all([
    qr(`SELECT slug FROM ai_tags WHERE enabled ORDER BY sort`),
    qr(`SELECT name, created_at FROM communities WHERE removed_at IS NULL ORDER BY id DESC LIMIT 5000`),
    qr(`SELECT id, title, created_at, coalesce(edited_at, created_at) AS m FROM posts WHERE deleted_at IS NULL AND removed_at IS NULL ORDER BY id DESC LIMIT 45000`),
  ]);
  const { slugify } = await import('./html.js');
  const urls = [entry('/', undefined, 'hourly', '1.0'), entry('/communities', undefined, 'daily', '0.7'),
    ...tags.rows.map(r => entry(`/m/${r.slug}`, undefined, 'daily', '0.9')),
    ...allPages().filter(p => !p.noindex).map(p => entry(`/${p.slug}`, iso(p.updated_at), 'monthly', '0.3')),
    ...comms.rows.map(r => entry(`/c/${r.name}`, iso(r.created_at), 'daily', '0.6')),
    ...posts.rows.map(r => entry(`/p/${r.id}/${slugify(r.title)}`, iso(r.m), 'weekly', '0.8'))];
  cache = { at: Date.now(), xml: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>` };
  return cache.xml;
}

// ---------- JSON-LD builders ----------
const org = () => ({ '@type': 'Organization', '@id': abs('/#org'), name: siteName(), url: abs('/'), logo: abs(assets.touch) });
export const ldHome = () => ({ '@context': 'https://schema.org', '@graph': [org(),
  { '@type': 'WebSite', '@id': abs('/#site'), url: abs('/'), name: siteName(), description: t('seo.description'), publisher: { '@id': abs('/#org') },
    potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: abs('/search?q={search_term_string}') }, 'query-input': 'required name=search_term_string' } }] });
export const ldBreadcrumbs = items => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(path) })) });
export const ldPost = p => ({ '@context': 'https://schema.org', '@type': 'DiscussionForumPosting', headline: p.title.slice(0, 110), url: abs(p.path),
  datePublished: new Date(p.created_at).toISOString(), ...(p.edited_at ? { dateModified: new Date(p.edited_at).toISOString() } : {}),
  author: { '@type': 'Person', name: p.author || 'anonymous' }, text: (p.body || '').slice(0, 5000),
  interactionStatistic: [{ '@type': 'InteractionCounter', interactionType: 'https://schema.org/CommentAction', userInteractionCount: p.comment_count },
    { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: Math.max(0, p.score) }],
  isPartOf: { '@type': 'WebSite', '@id': abs('/#site') } });
export const ldCollection = (name, description, path) => ({ '@context': 'https://schema.org', '@type': 'CollectionPage', name, description, url: abs(path), isPartOf: { '@type': 'WebSite', '@id': abs('/#site') } });
export const ldWebPage = (name, description, path) => ({ '@context': 'https://schema.org', '@type': 'WebPage', name, description, url: abs(path), isPartOf: { '@type': 'WebSite', '@id': abs('/#site') } });
