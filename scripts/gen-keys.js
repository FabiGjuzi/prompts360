// Print fresh random secrets for the environment. Store them in your host's secret settings, never in git.
import crypto from 'node:crypto';

const k = () => crypto.randomBytes(32).toString('base64');
console.log(`APP_SECRET=${k()}`);
console.log(`DATA_KEY=${k()}`);
console.log(`ORIGIN_SECRET=${crypto.randomBytes(24).toString('base64url')}`);
console.log('\nBack up DATA_KEY somewhere safe: without it, stored emails cannot be decrypted.');
