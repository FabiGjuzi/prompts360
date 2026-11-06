// design-defaults.js — the built-in design: theme values and the default source of every editable template, with the list of
// variables each template receives. The markup here is exactly what the site rendered before templates were editable.
import { raw } from './html.js';

// ---------- Theme ----------
// [key, label, default]. Light colours are the base; dark colours are applied from the visitor's system setting.
export const COLORS = [
  ['bg', 'Page background', '#eceff3', '#0e1013'], ['card', 'Cards and panels', '#ffffff', '#171a1f'], ['hl', 'Subtle fill (inputs, chips)', '#f6f7f9', '#1e2229'],
  ['tx', 'Text', '#1c1e21', '#e4e6eb'], ['mu', 'Muted text', '#565e6a', '#949ba6'], ['bd', 'Borders', '#dde1e7', '#2a2e36'],
  ['ac', 'Links and accent', '#4f46e5', '#818cf8'], ['ach', 'Link hover', '#4338ca', '#a5b4fc'],
  ['btn', 'Buttons', '#4f46e5', null], ['btnh', 'Button hover', '#4338ca', null],
  ['up', 'Upvote', '#f0640c', '#fb8a3c'], ['dn', 'Downvote', '#6366f1', '#a5b4fc'], ['er', 'Errors', '#c62828', '#ef7a7a'],
];
export const FONTS = {
  system: ['System UI (default)', 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif'],
  humanist: ['Humanist sans', '"Segoe UI",Candara,"Helvetica Neue",Arial,sans-serif'],
  rounded: ['Rounded', 'ui-rounded,"Hiragino Maru Gothic ProN",Quicksand,"Segoe UI",sans-serif'],
  serif: ['Serif', 'Georgia,"Times New Roman",serif'],
  mono: ['Monospace', 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'],
};
export const SHAPES = { pill: ['Pill (default)', '999px'], rounded: ['Rounded', '8px'], square: ['Square', '0'] };
export const NUMBERS = [['fs', 'Base font size (px)', 15, 13, 20], ['w', 'Page width (px)', 1120, 880, 1600], ['r', 'Card corner radius (px)', 10, 0, 24]];

// ---------- Templates ----------
const V = (...a) => a;   // [name, description] pairs
const UI = ['ui', 'Object with the text labels edited under "Texts & slogan": skip, search_placeholder, search_label, post_button, login, signup, menu_profile, menu_new_community, menu_settings, menu_notifications, menu_logout'];
const SIDE = ['side', 'Object with the sidebar texts: home_title, home_text, create_post, create_community, models_title, all, browse, join_text'];

export const TEMPLATES = {
  header: {
    label: 'Header', note: 'Top bar on every page: logo, slogan, search, menu links and the account area.',
    src: `<header class="top"><div class="bar">
<a class="brand" href="/" aria-label="{{site}} — {{slogan}}">{{{logo}}}<span class="slogan">{{slogan}}</span></a>
<form class="search" action="/search" role="search"><input name="q" type="search" placeholder="{{ui.search_placeholder}}" maxlength="200" value="{{q}}" aria-label="{{ui.search_label}}"></form>
{{#if links}}<nav class="links" aria-label="Main">{{#each links}}<a href="{{url}}">{{label}}</a>{{/each}}</nav>{{/if}}
<nav aria-label="Account">{{#if user}}<a class="btn" href="/submit">{{ui.post_button}}</a>
<details class="menu"><summary>{{user.username}}{{#if user.unread}} <b class="badge">{{user.unread}}</b>{{/if}}</summary><div>
<a href="/u/{{user.username}}">{{ui.menu_profile}}</a><a href="/notifications">{{ui.menu_notifications}}{{#if user.unread}} ({{user.unread}}){{/if}}</a><a href="/communities/new">{{ui.menu_new_community}}</a><a href="/settings">{{ui.menu_settings}}</a>
<form method="post" action="/logout">{{{user.csrf}}}<button>{{ui.menu_logout}}</button></form></div></details>{{else}}<a class="btn ghost" href="/login">{{ui.login}}</a><a class="btn" href="/signup">{{ui.signup}}</a>{{/if}}</nav>
</div></header>`,
    vars: [V('site', 'Site name'), V('slogan', 'Slogan'), V('logo', 'The animated 360.si logo (HTML)'), V('q', 'Current search text'), V('links', 'List of header menu links: each has label and url'), V('user', 'Logged-in user (empty for visitors): username, csrf (HTML hidden field for forms), unread (number of unread notifications)'), UI],
    sample: () => ({ site: 'Site', slogan: 'Slogan', logo: raw('<i></i>'), q: 'x', links: [{ label: 'A', url: '/a' }], user: { username: 'sam', unread: 2, csrf: raw('<input type="hidden" name="_csrf" value="x">') }, ui: ui() }),
  },
  footer: {
    label: 'Footer', note: 'Bottom of every page.',
    src: `<footer><nav aria-label="Footer">{{#each links}}<a href="{{url}}">{{label}}</a>{{/each}}</nav><p>{{copy}}</p></footer>`,
    vars: [V('links', 'List of footer links: each has label and url'), V('copy', 'The footer text (from Texts & slogan)'), V('year', 'Current year'), V('site', 'Site name')],
    sample: () => ({ links: [{ label: 'A', url: '/a' }], copy: '© 2026 Site', year: 2026, site: 'Site' }),
  },
  hero: {
    label: 'Home / model hero', note: 'The heading block at the top of the home page and of every AI-model page.',
    src: `<section class="card hero"><h1>{{heading}}</h1>{{#if intro}}<p>{{intro}}</p>{{/if}}</section>`,
    vars: [V('heading', 'Main heading (the page H1 — keep exactly one H1 on the page)'), V('intro', 'Intro paragraph (may be empty)')],
    sample: () => ({ heading: 'H', intro: 'I' }),
  },
  sidebar: {
    label: 'Sidebar', note: 'Right-hand column: about box, AI-model list and sign-up prompt.',
    src: `<aside>
{{#if community}}<section class="card about"><h2>c/{{community.name}}</h2><div class="md">{{{community.about}}}</div>
<p class="meta">{{community.posts}} · <a href="/m/{{community.tag_slug}}">{{community.tag_name}}</a> · created {{community.created}}</p>
<a class="btn wide" href="{{community.submit_url}}">{{side.create_post}}</a></section>{{else}}<section class="card">
<h2>{{side.home_title}}</h2><p>{{side.home_text}}</p>
<a class="btn wide" href="{{post_url}}">{{side.create_post}}</a><a class="btn ghost wide" href="/communities/new">{{side.create_community}}</a></section>{{/if}}
<section class="card"><h2>{{side.models_title}}</h2><ul class="tags">
<li><a href="/"{{#if all_active}} class="on" aria-current="page"{{/if}}>{{side.all}}</a></li>
{{#each tags}}<li><a href="/m/{{slug}}"{{#if active}} class="on" aria-current="page"{{/if}}>{{name}}</a></li>{{/each}}
</ul><a class="more" href="/communities">{{side.browse}}</a></section>
{{#unless user}}<section class="card"><p>{{side.join_text}}</p><a class="btn wide" href="/signup">{{ui.signup}}</a></section>{{/unless}}
</aside>`,
    vars: [V('community', 'The community being viewed (empty elsewhere): name, about (HTML), posts ("3 posts"), tag_slug, tag_name, created ("2d ago"), submit_url'), V('post_url', 'Link for the "Create post" button on non-community pages'),
      V('tags', 'List of AI models: each has slug, name, active (true for the current one)'), V('all_active', 'True when no model is selected'), V('user', 'Logged-in user (empty for visitors)'), SIDE, UI],
    sample: () => ({ community: { name: 'c', about: raw('<p>a</p>'), posts: '1 post', tag_slug: 't', tag_name: 'T', created: '1d ago', submit_url: '/submit?c=c' }, post_url: '/submit', tags: [{ slug: 't', name: 'T', active: true }], all_active: false, user: null,
      side: { home_title: 'a', home_text: 'b', create_post: 'c', create_community: 'd', models_title: 'e', all: 'f', browse: 'g', join_text: 'h' }, ui: ui() }),
  },
  post_card: {
    label: 'Post card', note: 'One post in a feed (home, model, community, search and profile lists).',
    src: `<li class="card post{{#if is_repost}} repost{{/if}}">
{{{votes}}}
<div class="body"><p class="meta">{{#if show_community}}<a class="c" href="/c/{{community}}">c/{{community}}</a> · {{/if}}<a class="tag" href="/m/{{tag_slug}}">{{tag}}</a> · {{#if author}}<a href="/u/{{author}}">u/{{author}}</a>{{else}}<span>[deleted]</span>{{/if}} · {{age}}{{#if is_repost}} · <span class="rp">↻ reposted</span>{{/if}}</p>
{{#if is_repost}}{{#if excerpt}}<p class="ex">{{excerpt}}</p>{{/if}}<blockquote class="quote">{{#if quote.gone}}<p class="muted">This post is no longer available.</p>{{else}}<p class="meta"><a class="c" href="/c/{{quote.community}}">c/{{quote.community}}</a> · <a class="tag" href="/m/{{quote.tag_slug}}">{{quote.tag}}</a> · {{#if quote.author}}<a href="/u/{{quote.author}}">u/{{quote.author}}</a>{{else}}<span>[deleted]</span>{{/if}} · {{quote.age}}</p>
<h2><a href="{{quote.url}}">{{quote.title}}</a></h2>{{#if quote.excerpt}}<p class="ex">{{quote.excerpt}}</p>{{/if}}{{/if}}</blockquote>{{else}}<h2><a href="{{url}}">{{title}}</a>{{#if link}} <a class="dom" href="{{link.url}}" rel="nofollow ugc noopener noreferrer">({{link.host}})</a>{{/if}}</h2>
{{#if excerpt}}<p class="ex">{{excerpt}}</p>{{/if}}{{/if}}
<p class="acts"><a href="{{url}}">{{comments}}</a>{{#if reposts}} · <a href="{{reposts_url}}">{{reposts}}</a>{{/if}}</p></div></li>`,
    vars: [V('votes', 'The up/down vote box (HTML)'), V('title', 'Post title'), V('url', 'Link to the post page'), V('community', 'Community name'), V('show_community', 'False on a community page'), V('tag', 'AI model name'), V('tag_slug', 'AI model slug'),
      V('author', 'Author username (empty if deleted)'), V('age', '"3h ago"'), V('link', 'External link (empty for text posts): url, host'), V('excerpt', 'Plain-text teaser'), V('comments', '"3 comments"'), V('score', 'Score as a number'), V('id', 'Post id'),
      V('is_repost', 'True when this post is a repost (quote post)'), V('quote', 'For reposts, the embedded original: gone (true if removed), url, title, community, tag, tag_slug, author, age, excerpt'), V('reposts', 'How many times this post was reposted, e.g. "2 reposts" (empty if none)'), V('reposts_url', 'Link to the list of reposts')],
    sample: () => ({ votes: raw('<div class="vote"></div>'), title: 'T', url: '/p/1/t', community: 'c', show_community: true, tag: 'T', tag_slug: 't', author: 'a', age: '1h ago', link: { url: 'https://x.test', host: 'x.test' }, excerpt: 'e', comments: '0 comments', score: 1, id: 1, is_repost: true, quote: { gone: false, url: '/p/2/q', title: 'Q', community: 'c', tag: 'T', tag_slug: 't', author: 'b', age: '2h ago', excerpt: 'q' }, reposts: '1 repost', reposts_url: '/reposts/1' }),
  },
};
const ui = () => ({ skip: 's', search_placeholder: 'a', search_label: 'b', post_button: 'c', login: 'd', signup: 'e', menu_profile: 'f', menu_new_community: 'g', menu_settings: 'h', menu_logout: 'i' });
