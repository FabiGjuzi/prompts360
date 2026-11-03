// Grant (or revoke with --revoke) site-admin rights, then sign the user out so the change applies.
// Usage: node scripts/make-admin.js <username> [--revoke]
import { q, closeDb } from '../src/db.js';
import { connectKv, closeKv } from '../src/kv.js';
import { destroyAllSessions } from '../src/session.js';

const [name, flag] = process.argv.slice(2);
if (!name) { console.error('usage: node scripts/make-admin.js <username> [--revoke]'); process.exit(1); }
const admin = flag !== '--revoke';
const { rows } = await q('UPDATE users SET is_admin = $2 WHERE lower(username) = lower($1) AND deleted_at IS NULL RETURNING id, username', [name, admin]);
if (!rows.length) { console.error(`No user named ${name}`); process.exitCode = 1; }
else {
  await connectKv();
  await destroyAllSessions(rows[0].id);
  await closeKv();
  console.log(`${rows[0].username} is ${admin ? 'now an admin' : 'no longer an admin'} (signed out; log in again).`);
}
await closeDb();
