// tpl.js — tiny logic-less template language for the editable parts of the site (header, footer, hero, sidebar, post card).
//   {{name}} / {{a.b}}  value, HTML-escaped.   {{{name}}}  same rule: HTML is only ever output unescaped when the value is a
//                       Raw object that the server itself produced (a plain string is escaped even in triple braces).
//   {{#if x}}…{{else}}…{{/if}}   {{#unless x}}…{{/unless}}   {{#each list}}…{{/each}}   {{this}}   {{! comment }}
// There is no code execution, no includes and no property access beyond the variables the server passes in (own properties only),
// so a template can restyle markup but can never read secrets, loop forever or inject script. Output size and depth are capped.
import { esc, Raw } from './html.js';

const MAX_DEPTH = 12, MAX_NODES = 20_000, MAX_OUT = 1_500_000, MAX_EACH = 500;
const BAD = new Set(['__proto__', 'constructor', 'prototype']);
const TAG = /\{\{\{\s*([^{}]+?)\s*\}\}\}|\{\{\s*([^{}]*?)\s*\}\}/g;

export class TemplateError extends Error {}

/** Parse template source into a node tree. Throws TemplateError with a line number on a mistake. */
export function parse(src) {
  const root = { t: 'root', kids: [] };
  const stack = [root];
  let last = 0, m;
  const line = i => src.slice(0, i).split('\n').length;
  const top = () => stack[stack.length - 1];
  const add = n => (top().alt || top().kids).push(n);
  const text = s => { if (s) add({ t: 'text', s }); };
  TAG.lastIndex = 0;
  while ((m = TAG.exec(src))) {
    text(src.slice(last, m.index));
    last = m.index + m[0].length;
    const body = (m[1] ?? m[2]).trim();
    if (m[1] !== undefined) { add({ t: 'var', p: path(body, line(m.index)) }); continue; }
    if (body.startsWith('!')) continue;
    if (body.startsWith('#')) {
      const [kw, ...rest] = body.slice(1).trim().split(/\s+/);
      if (!['if', 'unless', 'each'].includes(kw) || rest.length !== 1) throw new TemplateError(`Line ${line(m.index)}: unknown or malformed block "{{${body}}}".`);
      const node = { t: kw, p: path(rest[0], line(m.index)), kids: [], alt: null, at: line(m.index) };
      add(node);
      if (stack.length >= MAX_DEPTH) throw new TemplateError(`Line ${line(m.index)}: blocks are nested too deeply (max ${MAX_DEPTH}).`);
      stack.push(node);
      continue;
    }
    if (body.startsWith('/')) {
      const kw = body.slice(1).trim(), n = top();
      if (stack.length === 1 || n.t !== kw) throw new TemplateError(`Line ${line(m.index)}: "{{/${kw}}}" does not match an open "{{#${kw}}}"${stack.length > 1 ? ` (the open block is "{{#${n.t}}}" from line ${n.at})` : ''}.`);
      stack.pop();
      continue;
    }
    if (body === 'else') {
      const n = top();
      if (n.t !== 'if' && n.t !== 'unless' && n.t !== 'each') throw new TemplateError(`Line ${line(m.index)}: "{{else}}" must be inside an if/unless/each block.`);
      if (n.alt) throw new TemplateError(`Line ${line(m.index)}: only one "{{else}}" per block.`);
      n.alt = []; continue;
    }
    add({ t: 'var', p: path(body, line(m.index)) });
  }
  text(src.slice(last));
  if (stack.length > 1) { const n = top(); throw new TemplateError(`"{{#${n.t}}}" opened on line ${n.at} is never closed.`); }
  if (/\{\{|\}\}/.test(src.replace(TAG, ''))) throw new TemplateError('Unbalanced "{{" or "}}" found (a tag was not closed).');
  return root;
}
function path(p, ln) {
  if (p === 'this') return ['this'];
  if (!/^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)*$/.test(p) || p.split('.').some(s => BAD.has(s))) throw new TemplateError(`Line ${ln}: "${p.slice(0, 40)}" is not a valid variable name.`);
  return p.split('.');
}

function lookup(scopes, p) {
  if (p[0] === 'this') return scopes[scopes.length - 1];
  let v;
  let found = false;
  for (let i = scopes.length - 1; i >= 0 && !found; i--) {
    const s = scopes[i];
    if (s && typeof s === 'object' && Object.hasOwn(s, p[0])) { v = s[p[0]]; found = true; }
  }
  if (!found) return undefined;
  for (let i = 1; i < p.length; i++) {
    if (v && typeof v === 'object' && !(v instanceof Raw) && Object.hasOwn(v, p[i])) v = v[p[i]]; else return undefined;
  }
  return v;
}
const truthy = v => v instanceof Raw ? v.s !== '' : Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v !== '' : typeof v === 'number' ? v !== 0 : Boolean(v);
const show = v => v instanceof Raw ? v.s : (typeof v === 'string' || typeof v === 'number') ? esc(v) : v === true ? 'true' : '';

/** Render a parsed template with `data`. Throws TemplateError if limits are exceeded. */
export function render(tree, data) {
  let out = '', nodes = 0;
  const walk = (kids, scopes) => {
    for (const n of kids) {
      if (++nodes > MAX_NODES) throw new TemplateError('Template is too complex to render (too many steps).');
      if (n.t === 'text') out += n.s;
      else if (n.t === 'var') out += show(lookup(scopes, n.p));
      else {
        const v = lookup(scopes, n.p);
        if (n.t === 'if') walk(truthy(v) ? n.kids : n.alt || [], scopes);
        else if (n.t === 'unless') walk(!truthy(v) ? n.kids : n.alt || [], scopes);
        else if (n.t === 'each') {
          if (Array.isArray(v) && v.length) for (const item of v.slice(0, MAX_EACH)) walk(n.kids, [...scopes, item]);
          else if (n.alt) walk(n.alt, scopes);
        }
      }
      if (out.length > MAX_OUT) throw new TemplateError('Template output is too large.');
    }
  };
  walk(tree.kids, [data]);
  return new Raw(out);
}

/** Static checks for markup an editor may save: scripts and event handlers belong in "Custom JavaScript" (the site's security policy blocks inline code anyway). */
export function lintMarkup(src) {
  if (/<\s*script\b/i.test(src)) return 'Remove the <script> tag: put scripts in the Custom JavaScript tab (inline scripts are blocked by the site’s security policy).';
  if (/\son[a-z]+\s*=/i.test(src.replace(/\{\{[^}]*\}\}/g, ''))) return 'Remove inline event attributes like onclick="…": add the behaviour in the Custom JavaScript tab instead.';
  if (/javascript\s*:/i.test(src)) return 'javascript: links are not allowed.';
  if (/<\s*(iframe|object|embed|base|meta\s+http-equiv)\b/i.test(src)) return 'iframe, object, embed, base and meta refresh tags are not allowed.';
  if (/<\s*style\b/i.test(src)) return 'Remove the <style> tag: put styles in the Custom CSS tab.';
  return '';
}
