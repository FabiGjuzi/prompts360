// One-time helper: get a Gmail API refresh token for sending email. Run it on YOUR computer:
//   node scripts/gmail-auth.js <CLIENT_ID> <CLIENT_SECRET>
// It opens a local callback on 127.0.0.1, prints a Google consent URL, and prints GMAIL_REFRESH_TOKEN.
// Scope is gmail.send only: the token can send mail but can't read your inbox.
import http from 'node:http';
import crypto from 'node:crypto';

const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) { console.error('usage: node scripts/gmail-auth.js <CLIENT_ID> <CLIENT_SECRET>'); process.exit(1); }

const PORT = 53682, redirect = `http://127.0.0.1:${PORT}/callback`;
const verifier = crypto.randomBytes(48).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const state = crypto.randomBytes(16).toString('hex');
const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId, redirect_uri: redirect, response_type: 'code', access_type: 'offline', prompt: 'consent',
  scope: 'https://www.googleapis.com/auth/gmail.send', state, code_challenge: challenge, code_challenge_method: 'S256',
});

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, redirect);
  if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
  if (u.searchParams.get('state') !== state) { res.writeHead(400).end('State mismatch'); return; }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: u.searchParams.get('code') || '', client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }),
  });
  const j = await r.json();
  res.writeHead(200, { 'content-type': 'text/plain' }).end(j.refresh_token ? 'Done. Go back to your terminal.' : `Failed: ${JSON.stringify(j)}`);
  console.log(j.refresh_token ? `\nGMAIL_REFRESH_TOKEN=${j.refresh_token}\n` : `\nFailed: ${JSON.stringify(j)}\n`);
  server.close();
});
server.listen(PORT, '127.0.0.1', () => console.log(`Open this URL, sign in with the Gmail account that will send mail, and approve:\n\n${url}\n`));
