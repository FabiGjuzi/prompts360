// Central configuration. Everything comes from environment variables; production refuses to start
// if a security-relevant value is missing (fail closed instead of running half-configured).
const env = process.env;
const isProd = env.NODE_ENV === 'production';

function req(name, fallbackForDev) {
  const v = env[name];
  if (v && v.trim()) return v.trim();
  if (!isProd && fallbackForDev !== undefined) return fallbackForDev;
  throw new Error(`Missing required environment variable ${name}`);
}
function int(name, def) {
  const v = parseInt(env[name] ?? '', 10);
  return Number.isFinite(v) ? v : def;
}

const DEV_KEY = Buffer.alloc(32, 0x5a).toString('base64'); // dev only — production rejects it

export const config = Object.freeze({
  isProd,
  port: int('PORT', 8080),
  host: env.HOST || '0.0.0.0',
  // Render sets RENDER_EXTERNAL_URL automatically, so the free test deploy needs no BASE_URL.
  baseUrl: (env.BASE_URL || env.RENDER_EXTERNAL_URL || (isProd ? req('BASE_URL') : 'http://localhost:8080')).replace(/\/+$/, ''),
  siteName: env.SITE_NAME || 'prompts360',
  workers: int('WEB_CONCURRENCY', 1),

  databaseUrl: req('DATABASE_URL', 'postgres://postgres:devpass@127.0.0.1:54329/prompts360'),
  databaseReadUrl: env.DATABASE_READ_URL || '',
  databaseCa: env.DATABASE_CA_CERT || '',
  // "off" only for a private network where the DB has no TLS (e.g. Render's internal URL). Default: verify.
  databaseTls: env.DATABASE_TLS === 'off' ? 'off' : 'verify',
  dbPoolMax: int('DB_POOL_MAX', 20),
  valkeyUrl: req('VALKEY_URL', 'redis://127.0.0.1:6380/0'),

  // Secrets: APP_SECRET derives the HMAC/pepper sub-keys (HKDF); DATA_KEY is the AES-256-GCM key.
  appSecret: req('APP_SECRET', DEV_KEY),
  dataKey: req('DATA_KEY', DEV_KEY),
  dataKeyOld: env.DATA_KEY_OLD || '',

  // Cloudflare: Turnstile captcha + optional origin lock (secret header added by a Cloudflare Transform Rule).
  turnstileSiteKey: req('TURNSTILE_SITE_KEY', ''),
  turnstileSecret: req('TURNSTILE_SECRET', ''),
  originSecret: env.ORIGIN_SECRET || '',
  clientIpHeader: (env.CLIENT_IP_HEADER || '').toLowerCase(),

  cookieSecure: isProd || env.COOKIE_SECURE === '1',
  sessionIdleSec: int('SESSION_IDLE_SEC', 2 * 3600),
  sessionMaxSec: int('SESSION_MAX_SEC', 24 * 3600),

  // Argon2id (RFC 9106 second recommended profile: 64 MiB, t=3, p=1).
  argon: { memoryCost: int('ARGON_MEMORY_KIB', 65536), timeCost: int('ARGON_TIME', 3), parallelism: 1 },
  argonConcurrency: int('ARGON_CONCURRENCY', 4),

  mail: {
    transports: (env.MAIL_TRANSPORT || (isProd ? 'gmail' : 'console')).split(',').map(s => s.trim()).filter(Boolean),
    from: env.MAIL_FROM || 'prompts360 <no-reply@localhost>',
    gmailClientId: env.GMAIL_CLIENT_ID || '',
    gmailClientSecret: env.GMAIL_CLIENT_SECRET || '',
    gmailRefreshToken: env.GMAIL_REFRESH_TOKEN || '',
    resendApiKey: env.RESEND_API_KEY || '',
  },

  // Per-IP flood guard (token bucket per app process): burst size and sustained requests/second.
  ipBurst: int('IP_BURST', 120),
  ipRate: int('IP_RATE', 4),

  // Seconds a logged-out page may be cached by Cloudflare, and inside each app process.
  edgeCacheSec: int('EDGE_CACHE_SEC', 30),
  microCacheSec: int('MICROCACHE_SEC', 5),
});

if (isProd) {
  for (const k of ['appSecret', 'dataKey']) {
    if (config[k].length < 32) throw new Error(`${k} must be at least 32 random characters (node scripts/gen-keys.js)`);
    if (config[k] === DEV_KEY) throw new Error(`${k} is the development key`);
  }
  if (!config.baseUrl.startsWith('https://')) throw new Error('BASE_URL must be https:// in production');
  if (!config.turnstileSecret || !config.turnstileSiteKey) throw new Error('Turnstile keys are required in production');
  if (/^[123]x0+[A-Z]{2}$/.test(config.turnstileSecret)) console.warn('[config] WARNING: Cloudflare TEST captcha keys in use — bots are NOT blocked. Replace before launch.');
  // A client-IP header is only trustworthy if the platform overwrites it (App Platform's do-connecting-ip)
  // or the origin is locked to the proxy that sets it. Otherwise anyone could spoof it to dodge rate limits.
  if (config.clientIpHeader && config.clientIpHeader !== 'do-connecting-ip' && !config.originSecret)
    throw new Error(`CLIENT_IP_HEADER=${config.clientIpHeader} requires ORIGIN_SECRET (see DEPLOY.md)`);
}
