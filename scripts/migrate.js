// Apply pending database migrations, then exit. Used as the App Platform pre-deploy job.
import { migrate, closeDb } from '../src/db.js';

await migrate();
await closeDb();
console.log('[migrate] up to date');
