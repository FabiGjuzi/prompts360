// Make the superadmin password: prints a random 12-character password and its Argon2id hash.
//   APP_SECRET=<production secret> node scripts/make-admin-hash.js [outfile]
// The hash is peppered with APP_SECRET exactly like user passwords, so it must be made with the production value.
// Put the HASH in the ADMIN_BOOTSTRAP_HASH environment variable (it creates the account on first login attempt).
// The password itself is shown once and is never stored on the server. With [outfile] both are written there (mode 600) instead of printed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { hashPassword } from '../src/crypto.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // 57 symbols, no look-alikes (0 O 1 l I) ≈ 70 bits for 12 characters
const password = Array.from({ length: 12 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const hash = await hashPassword(password);
const out = process.argv[2];
if (out) { fs.writeFileSync(out, `PASSWORD=${password}\nADMIN_BOOTSTRAP_HASH=${hash}\n`, { mode: 0o600 }); console.log(`written to ${out}`); }
else console.log(`PASSWORD=${password}\nADMIN_BOOTSTRAP_HASH=${hash}`);
