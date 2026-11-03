// Cloudflare Turnstile server-side check. Fails closed: network errors or timeouts count as "not human".
import { config } from './config.js';

/** True when a Turnstile secret key is configured. */
export const turnstileEnabled = () => Boolean(config.turnstileSecret);
// Cloudflare's documented test secrets (1x…AA always passes) reply with a placeholder hostname/action.
// True when using Cloudflare's published always-pass test secret (test deployments only).
const TEST_SECRET = /^[123]x0+[A-Z]{2}$/.test(config.turnstileSecret);

/** Ask Cloudflare whether `token` is a real solved captcha for this form (`action`) and this site. Any error or timeout counts as 'not human'. */
export async function verifyHuman(token, ip, action) {
  if (!turnstileEnabled()) return !config.isProd; // dev/test only; production refuses to boot without keys
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: config.turnstileSecret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000),
    });
    const r = await res.json();
    if (!r.success) return false;
    if (TEST_SECRET) return true;
    if (r.action && action && r.action !== action) return false;           // token minted for another form
    if (r.hostname && r.hostname !== new URL(config.baseUrl).hostname) return false;
    return true;
  } catch {
    return false;
  }
}
