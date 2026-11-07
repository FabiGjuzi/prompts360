// admin/index.js — the dashboard's route table. Every route lives under config.adminPath (a secret path).
// With no ADMIN_PATH configured (production default) there are no routes at all: the dashboard does not exist.
import { config } from '../config.js';
import * as A from './pages.js';
import * as C from './crud.js';
import * as G from './design.js';
import * as X from './export.js';
import { geoJson } from './livemap.js';
import { bulkPosts, postsPublish } from './bulk.js';
import * as K from './tasks.js';
import * as Z from './geoip.js';

const P = config.adminPath;
const R = rest => new RegExp(`^${P}${rest}$`);
const T = '/t/([a-z_]{1,30})';
const ID = '([a-z0-9_.:-]{1,90})';
const open = { admin: 'open' }, need = { admin: 'required' }, post = { admin: 'required', form: 'admin' };
const big = { ...post, bodyLimit: 5_000_000 };

/** [method, URL regex, handler, options] — same shape as the public route tables. */
export const adminRoutes = !P ? [] : [
  ['GET', R(''), A.home, open],
  ['POST', R('/login'), A.loginPost, { admin: 'open', form: 'anon' }],
  ['POST', R('/logout'), A.logoutPost, post],
  ['GET', R('/live'), A.live, need],
  ['GET', R('/live\\.json'), A.liveJson, need],
  ['GET', R('/charts\\.json'), A.chartsJson, need],
  ['GET', R('/geo\\.json'), geoJson, need],
  ['GET', R('/logs'), A.logs, need],
  ['GET', R('/texts'), A.texts, need],
  ['POST', R('/texts'), A.textsPost, { ...post, bodyLimit: 400_000 }],
  ['GET', R('/design'), G.designPage, need],
  ['POST', R('/design/save'), G.designSave, { ...post, bodyLimit: 400_000 }],
  ['POST', R('/design/publish'), G.designPublish, post],
  ['POST', R('/design/discard'), G.designDiscard, post],
  ['POST', R('/design/restore'), G.designRestore, post],
  ['GET', R('/design/preview'), G.designPreview, need],
  ['GET', R('/design/draft\\.([A-Za-z0-9_-]{10})\\.(css|js)'), G.designDraftFile, need],
  ['GET', R('/export'), X.exportPage, need],
  ['GET', R('/export/content/(communities|posts|drafts)\\.csv'), X.exportContent, need],
  ['GET', R('/export/table/([a-z_]{1,40})\\.csv'), X.exportTable, need],
  ['GET', R('/export/all\\.zip'), X.exportAll, need],
  ['GET', R('/export/template/(communities|posts)\\.csv'), X.exportTemplate, need],
  ['GET', R('/import'), A.importGet, need],
  ['POST', R('/import'), A.importPost, big],
  ['GET', R('/connections'), A.connections, need],
  ['POST', R('/connections'), A.connectionsPost, post],
  ['POST', R('/bulk/posts'), bulkPosts, { ...post, bodyLimit: 131_072 }],
  ['GET', R('/posts/(\\d{1,15})/preview'), A.postPreview, need],
  ['POST', R('/posts/publish'), postsPublish, post],
  ['GET', R('/reports'), A.reports, need],
  ['POST', R('/reports/(\\d{1,15})/remove'), A.reportAction(true), post],
  ['POST', R('/reports/(\\d{1,15})/resolve'), A.reportAction(false), post],
  ['GET', R('/tasks'), K.list, need],
  ['GET', R('/tasks/new'), K.newForm, need],
  ['POST', R('/tasks/new'), K.create, { ...post, bodyLimit: 40_000 }],
  ['GET', R('/tasks/(\\d{1,15})'), K.editForm, need],
  ['POST', R('/tasks/(\\d{1,15})'), K.update, { ...post, bodyLimit: 40_000 }],
  ['POST', R('/tasks/(\\d{1,15})/delete'), K.remove, post],
  ['POST', R('/tasks/(\\d{1,15})/toggle'), K.toggle, post],
  ['POST', R('/tasks/(\\d{1,15})/run'), K.run, post],
  ['GET', R('/tasks/(\\d{1,15})/runs'), K.runs, need],
  ['GET', R('/geoip'), Z.page, need],
  ['POST', R('/geoip/refresh'), Z.refresh, post],
  ['POST', R('/geoip/reset'), Z.reset, post],
  ['GET', R('/geoip/file\\.csv'), Z.file, need],
  ['GET', R('/geoip/raw'), Z.rawGet, need],
  ['POST', R('/geoip/raw'), Z.rawPost, { ...post, bodyLimit: 800_000 }],
  ['GET', R('/db'), A.dbIndex, need],
  ['GET', R('/account'), A.account, need],
  ['POST', R('/account'), A.accountPost, post],
  ['GET', R(`${T}`), C.list, need],
  ['GET', R(`${T}/new`), C.newForm, need],
  ['POST', R(`${T}/new`), C.create, { ...post, bodyLimit: 200_000 }],
  ['POST', R(`${T}/${ID}/delete`), C.remove, post],
  ['GET', R(`${T}/${ID}`), C.editForm, need],
  ['POST', R(`${T}/${ID}`), C.update, { ...post, bodyLimit: 200_000 }],
];
