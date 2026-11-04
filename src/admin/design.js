// admin/design.js — "Site design" editor: theme, custom CSS, custom JavaScript, templates, history.
// Everything is edited in a DRAFT; visitors only see changes after Publish. Preview shows the draft on the real site to this admin only.
import { html, raw } from '../html.js';
import { redirect, send, str, clearMicro, HttpError } from '../http.js';
import { config } from '../config.js';
import { logEvent } from '../metrics.js';
import * as D from '../design.js';
import { adminPage, csrf, when, P } from './ui.js';

const TABS = [['theme', 'Theme'], ['css', 'Custom CSS'], ['js', 'Custom JavaScript'], ['templates', 'Templates'], ['history', 'History & rollback']];
const FLASH = { saved: 'Draft saved. Use Preview to see it on the site, Publish to make it live.', published: 'Published. Visitors now see this design.', discarded: 'Draft discarded: it is a copy of the live design again.', loaded: 'Version loaded into the draft. Preview it, then Publish.', rolled: 'Rolled back: that version is live again.' };
const tabUrl = (tab, extra = '') => `${P}/design?tab=${tab}${extra}`;

/** Status bar shown on every tab: what is live, whether the draft differs, and the three actions. */
function statusBar(req, st) {
  return html`<section class="card dstat"><div><b>Live:</b> ${st.liveMeta.id ? html`version #${st.liveMeta.id} · ${when(st.liveMeta.created_at)}${st.liveMeta.note ? html` · “${st.liveMeta.note}”` : ''}` : 'built-in design'}
 &nbsp;·&nbsp; <b>Draft:</b> ${st.changed ? html`<span class="pill warn">unpublished changes</span>` : html`<span class="pill ok">same as live</span>`}</div>
<div class="row">
<a class="btn" href="${P}/design/preview?on=1">Preview draft on the site</a>
<form method="post" action="${P}/design/publish" class="inline">${csrf(req)}<input name="note" maxlength="300" placeholder="What changed? (optional note)" aria-label="Version note"${st.changed ? '' : raw(' disabled')}><button class="btn primary"${st.changed ? '' : raw(' disabled')}>Publish</button></form>
<form method="post" action="${P}/design/discard" class="inline">${csrf(req)}<button class="btn danger"${st.hasDraftRow && st.changed ? '' : raw(' disabled')}>Discard draft</button></form></div></section>`;
}

const errBox = errors => errors?.length ? html`<div class="error" role="alert"><b>Not saved:</b><ul>${errors.map(e => html`<li>${e}</li>`)}</ul></div>` : '';

function themeTab(req, th, errors) {
  const val = (key, def) => (/^#[0-9a-fA-F]{6}$/.test(th[key]) || typeof th[key] === 'number' || /^\d+$/.test(th[key]) ? th[key] : def);
  if (!D.FONTS[th.font]) th = { ...th, font: '' };
  if (!D.SHAPES[th.shape]) th = { ...th, shape: '' };
  const colors = (mode) => COLORS_FOR(mode).map(([k, label, def]) => html`<div class="fld colorfld"><label for="${mode}_${k}">${label}</label><input type="color" id="${mode}_${k}" name="${mode === 'light' ? 'c' : 'd'}.${k}" value="${val(mode === 'light' ? k : `dark_${k}`, def)}" data-var="${k}" data-mode="${mode}"></div>`);
  const stack = D.FONTS[th.font || 'system'][1];
  return html`${errBox(errors)}<form method="post" action="${P}/design/save" class="edit wide">${csrf(req)}<input type="hidden" name="tab" value="theme">
<div class="split"><div>
<fieldset><legend>Colours — light mode</legend>${colors('light')}</fieldset>
<fieldset><legend>Colours — dark mode <small>(shown to visitors whose device is set to dark)</small></legend>${colors('dark')}</fieldset>
<fieldset><legend>Typography and layout</legend>
<div class="fld"><label for="font">Font</label><select id="font" name="font" data-font>${Object.entries(D.FONTS).map(([k, [lab, st]]) => html`<option value="${k}" data-stack="${st}"${(th.font || 'system') === k ? raw(' selected') : ''}>${lab}</option>`)}</select><small>Only fonts already on the visitor’s device (no external font files: the security policy blocks them).</small></div>
<div class="fld"><label for="shape">Button shape</label><select id="shape" name="shape" data-shape>${Object.entries(D.SHAPES).map(([k, [lab, r]]) => html`<option value="${k}" data-radius="${r}"${(th.shape || 'pill') === k ? raw(' selected') : ''}>${lab}</option>`)}</select></div>
${D.NUMBERS.map(([k, label, def, min, max]) => html`<div class="fld"><label for="n_${k}">${label}</label><input type="number" id="n_${k}" name="n.${k}" min="${min}" max="${max}" step="1" value="${val(k, def)}" data-num="${k}"><small>${min}–${max}, default ${def}</small></div>`)}
</fieldset></div>
<div><section class="card sticky"><h2>Live preview</h2><p class="muted">Updates as you change the controls. Nothing is saved until you press Save.</p>
${['light', 'dark'].map(mode => html`<div class="tprev" data-tprev="${mode}"><div class="tp-bar"><b>${mode === 'light' ? 'Light' : 'Dark'}</b><span class="tp-btn">Post</span></div>
<div class="tp-card"><p class="tp-meta"><span class="tp-tag">Claude</span> · u/sam · 2h ago</p><h3>A prompt that explains things simply</h3><p class="tp-text">Body text with a <a href="#" class="tp-link" tabindex="-1">link</a> and <span class="tp-mu">muted text</span>.</p>
<p><span class="tp-up">▲ 12</span> <span class="tp-dn">▼</span> <span class="tp-err">error text</span></p></div></div>`)}
<span hidden data-stack-now="${stack}"></span></section></div></div>
<div class="savebar"><button class="btn primary">Save to draft</button> <button class="btn" name="reset" value="theme" formnovalidate>Reset theme to defaults</button></div></form>`;
}
const COLORS_FOR = mode => D.COLORS.filter(([, , , dark]) => mode === 'light' || dark).map(([k, label, light, dark]) => [k, label, mode === 'light' ? light : dark]);

function codeTab(req, kind, value, errors) {
  const css = kind === 'css';
  return html`${errBox(errors)}<form method="post" action="${P}/design/save" class="edit wide">${csrf(req)}<input type="hidden" name="tab" value="${kind}">
<p class="muted">${css ? raw('Your stylesheet is loaded <b>after</b> the theme and the built-in styles on every public page, so your rules win. The dashboard itself never loads it, so a mistake here cannot lock you out. Served as a separate file; the strict Content-Security-Policy stays on.')
    : raw('Runs on <b>every public page</b> after it loads (deferred). Served as a separate file, so the strict security policy stays on. Rules that apply: <b>no inline <code>&lt;script&gt;</code> tags</b>; no <code>innerHTML</code> (use <code>textContent</code> or <code>createElement</code>: pages enforce Trusted Types); scripts, images and requests to other websites are blocked by the policy. Syntax is checked when you save; the code is never run on the server. A broken script can be removed with History &amp; rollback.')}</p>
<div class="fld"><label for="code">${css ? 'Custom CSS' : 'Custom JavaScript'}</label><textarea id="code" name="${kind}" class="code" rows="30" maxlength="210000" spellcheck="false" autocapitalize="off" autocomplete="off" data-count="200000">${value}</textarea><small data-counter>Max 200,000 characters.</small></div>
<div class="savebar"><button class="btn primary">Save to draft</button></div></form>`;
}

function templatesTab(req, st, name, srcOverride, errors) {
  const T = D.TEMPLATES[name];
  const custom = st.draft.templates[name];
  return html`${errBox(errors)}<div class="split2"><nav class="tpls" aria-label="Templates"><h2>Templates</h2><ul>${Object.entries(D.TEMPLATES).map(([k, v]) => html`<li><a href="${tabUrl('templates', `&tpl=${k}`)}"${k === name ? raw(' class="on" aria-current="page"') : ''}>${v.label}${st.draft.templates[k] ? raw(' <em>custom</em>') : ''}</a></li>`)}</ul></nav>
<div><form method="post" action="${P}/design/save" class="edit wide">${csrf(req)}<input type="hidden" name="tab" value="templates"><input type="hidden" name="tpl" value="${name}">
<h2>${T.label}${custom ? raw(' <span class="pill warn">customised</span>') : ''}</h2><p class="muted">${T.note}</p>
<div class="fld"><label for="src">HTML template</label><textarea id="src" name="src" class="code" rows="26" maxlength="55000" spellcheck="false" autocapitalize="off" autocomplete="off" data-count="50000">${srcOverride ?? custom ?? T.src}</textarea><small data-counter>Max 50,000 characters.</small></div>
<div class="savebar"><button class="btn primary">Save to draft</button> <button class="btn" name="reset" value="1" formnovalidate>Reset this template to the built-in one</button></div></form>
<details open class="ref"><summary>Variables you can use in this template</summary><table class="t"><tbody>${T.vars.map(([n, d]) => html`<tr><td><code>{{${n}}}</code></td><td>${d}</td></tr>`)}</tbody></table></details>
<details class="ref"><summary>Template syntax</summary><table class="t"><tbody>
<tr><td><code>{{name}}</code></td><td>Insert a value. Text is HTML-escaped automatically; values that are ready-made HTML (like <code>{{{logo}}}</code>) are inserted as markup.</td></tr>
<tr><td><code>{{user.username}}</code></td><td>Reach inside an object.</td></tr>
<tr><td><code>{{#if x}}…{{else}}…{{/if}}</code></td><td>Show a block when <code>x</code> is not empty / not zero / true. <code>{{#unless x}}…{{/unless}}</code> is the opposite.</td></tr>
<tr><td><code>{{#each list}}…{{/each}}</code></td><td>Repeat for every item (inside, use the item’s fields directly; <code>{{this}}</code> is the item itself). Add <code>{{else}}</code> for an empty list.</td></tr>
<tr><td><code>{{! note }}</code></td><td>A comment that is not output.</td></tr>
<tr><td>Not allowed</td><td><code>&lt;script&gt;</code>, <code>&lt;style&gt;</code>, <code>onclick=</code>-style attributes, <code>javascript:</code>, iframes: use the CSS and JavaScript tabs. If a custom template ever fails, the built-in one is used automatically.</td></tr></tbody></table></details></div></div>`;
}

async function historyTab(req, st) {
  const rows = await D.versions();
  const act = (id, mode, label, cls = '') => html`<form method="post" action="${P}/design/restore" class="inline">${csrf(req)}<input type="hidden" name="id" value="${id}"><input type="hidden" name="mode" value="${mode}"><button class="btn sm ${cls}">${label}</button></form>`;
  return html`<p class="muted">Every Publish is kept (the latest 100). <b>Publish this version</b> is a one-click rollback: it makes that version live again and adds it to the history. <b>Load into draft</b> lets you review or edit it first.</p>
<table class="t"><thead><tr><th>Version</th><th>Published</th><th>Note</th><th>Customises</th><th></th></tr></thead><tbody>
${rows.map(r => html`<tr><td>#${r.id}${Number(r.id) === st.liveMeta.id ? raw(' <span class="pill ok">live</span>') : ''}</td><td>${when(r.created_at)}</td><td>${r.note || '–'}</td><td>${D.summarize(D.normalize(r.data).data)}</td>
<td class="row">${Number(r.id) === st.liveMeta.id ? '' : act(r.id, 'publish', 'Publish this version', 'primary')}${act(r.id, 'draft', 'Load into draft')}</td></tr>`)}
<tr><td>Built-in</td><td>–</td><td>The original design shipped with the site</td><td>nothing</td><td class="row">${st.liveMeta.id ? act(0, 'publish', 'Publish built-in design', 'primary') : ''}${act(0, 'draft', 'Load into draft')}</td></tr></tbody></table>`;
}

/** GET /design */
export async function designPage(req, res, ctx = {}) {
  const st = D.state();
  const tab = ctx.tab || (TABS.some(([k]) => k === req.query.get('tab')) ? req.query.get('tab') : 'theme');
  const tplName = ctx.tpl || (D.TEMPLATES[req.query.get('tpl')] ? req.query.get('tpl') : 'header');
  const body = tab === 'theme' ? themeTab(req, ctx.theme || st.draft.theme, ctx.errors)
    : tab === 'css' ? codeTab(req, 'css', ctx.value ?? st.draft.css, ctx.errors)
      : tab === 'js' ? codeTab(req, 'js', ctx.value ?? st.draft.js, ctx.errors)
        : tab === 'templates' ? templatesTab(req, st, tplName, ctx.src, ctx.errors) : await historyTab(req, st);
  const content = html`<p class="muted">Change how the public site looks, like a theme editor. Everything here edits a <b>draft</b>: visitors keep seeing the live design until you press <b>Publish</b>, and every published version can be rolled back.</p>
${statusBar(req, st)}
<nav class="dtabs" aria-label="Design sections">${TABS.map(([k, l]) => html`<a href="${tabUrl(k)}"${k === tab ? raw(' class="on" aria-current="page"') : ''}>${l}</a>`)}</nav>${body}`;
  return adminPage(req, res, { title: 'Site design', active: '/design', content, flash: FLASH[req.query.get('n')], status: ctx.errors?.length ? 400 : 200 });
}

/** POST /design/save — validates and stores into the draft. Never touches what visitors see. */
export async function designSave(req, res) {
  const b = req.body, tab = ['theme', 'css', 'js', 'templates'].includes(b.tab) ? b.tab : 'theme';
  let patch, ctx = { tab };
  if (tab === 'theme') {
    if (b.reset === 'theme') patch = { theme: {} };
    else {
      const theme = {};
      for (const [k, , , dark] of D.COLORS) { theme[k] = str(b[`c.${k}`], 9); if (dark) theme[`dark_${k}`] = str(b[`d.${k}`], 9); }
      theme.font = str(b.font, 20); theme.shape = str(b.shape, 20);
      for (const [k] of D.NUMBERS) theme[k] = str(b[`n.${k}`], 6);
      patch = { theme }; ctx.theme = theme;
    }
  } else if (tab === 'css' || tab === 'js') { const v = str(b[tab], 260_000); patch = { [tab]: v }; ctx.value = v; }
  else {
    const name = D.TEMPLATES[b.tpl] ? b.tpl : null;
    if (!name) throw new HttpError(404, 'Page not found.');
    ctx.tpl = name;
    const src = b.reset ? '' : str(b.src, 60_000);
    patch = { templates: { [name]: src } }; ctx.src = src;
  }
  const { errors } = await D.saveDraft(patch);
  if (errors.length) { ctx.errors = errors; return designPage(req, res, ctx); }
  logEvent('info', 'admin', `Design draft saved (${tab}${ctx.tpl ? `: ${ctx.tpl}` : ''})`);
  return redirect(res, tabUrl(tab, `${ctx.tpl ? `&tpl=${ctx.tpl}` : ''}&n=saved`));
}

/** POST /design/publish */
export async function designPublish(req, res) {
  if (!D.state().changed) return redirect(res, tabUrl('theme'));
  const id = await D.publish(str(req.body.note, 300).trim());
  clearMicro();
  logEvent('info', 'admin', `Design published as version #${id}`);
  return redirect(res, `${P}/design?n=published`);
}
/** POST /design/discard */
export async function designDiscard(req, res) { await D.discardDraft(); logEvent('info', 'admin', 'Design draft discarded'); return redirect(res, `${P}/design?n=discarded`); }
/** POST /design/restore — load a version into the draft, or publish it again (rollback). id 0 = built-in design. */
export async function designRestore(req, res) {
  const id = Number(str(req.body.id, 16));
  if (!Number.isInteger(id) || id < 0) throw new HttpError(404, 'Page not found.');
  const data = await D.versionData(id);
  if (!data) throw new HttpError(404, 'That version does not exist.');
  if (req.body.mode === 'publish') {
    const nid = await D.publish(id === 0 ? 'Rolled back to the built-in design' : `Rolled back to version #${id}`, data);
    clearMicro(); logEvent('info', 'admin', `Design rolled back to ${id === 0 ? 'built-in' : `#${id}`} (new version #${nid})`);
    return redirect(res, `${P}/design?tab=history&n=rolled`);
  }
  await D.loadIntoDraft(data);
  logEvent('info', 'admin', `Design version ${id === 0 ? 'built-in' : `#${id}`} loaded into the draft`);
  return redirect(res, `${P}/design?n=loaded`);
}
/** GET /design/preview?on=1|0 — toggles the preview cookie (honoured only together with a valid admin session). */
export async function designPreview(req, res) {
  const on = req.query.get('on') === '1';
  res.setHeader('Set-Cookie', `pv=${on ? '1' : ''}; Path=/; HttpOnly; SameSite=Strict${config.cookieSecure ? '; Secure' : ''}; Max-Age=${on ? 7200 : 0}`);
  return redirect(res, on ? '/' : `${P}/design`);
}
/** GET /design/draft.<hash>.css|js — the draft's files, for the preview only (admin session required by the route). */
export async function designDraftFile(req, res, [hash, ext]) {
  const a = D.draftAsset(hash, ext);
  if (!a) throw new HttpError(404, 'Page not found.');
  res.setHeader('Cache-Control', 'no-store');
  return send(req, res, 200, a.raw, a.type);
}
