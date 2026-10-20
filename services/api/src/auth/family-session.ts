import * as crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

const MAX_SESSION_SECONDS = 7 * 24 * 60 * 60;
const DEV_SIGNING_KEY = 'mea_family_secret_002120';

function getSigningSecret(): string {
  const secret = process.env.SESSION_SIGNING_KEY || process.env.SNAPSHOT_AES_KEY_HEX ||
    process.env.ENCRYPTION_KEY;
  if (process.env.NODE_ENV === 'production' &&
      (!secret || Buffer.byteLength(secret) < 32 || secret === DEV_SIGNING_KEY ||
       secret === 'default-32-char-key-for-dev-only!' || /CHANGE_ME/i.test(secret))) {
    throw new Error('A random session signing key of at least 32 bytes is required in production');
  }
  return secret || DEV_SIGNING_KEY;
}

export function assertProductionAuthConfig(): void {
  if (process.env.NODE_ENV !== 'production') return;
  getSigningSecret();
  if (process.env.ENFORCE_SERVER_AUTH !== '1') {
    throw new Error('ENFORCE_SERVER_AUTH=1 is required in production');
  }
}

export function buildSignedFamilyToken(ttlSeconds = MAX_SESSION_SECONDS): string {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > MAX_SESSION_SECONDS) {
    throw new Error('Session lifetime must be between 1 second and 7 days');
  }
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `v1.${expiresAt}`;
  const sig = crypto.createHmac('sha256', getSigningSecret()).update(payload)
    .digest('hex').slice(0, 32);
  return `${payload}.${sig}`;
}

export function verifySignedFamilyToken(rawToken?: string | null): boolean {
  const match = /^v1\.(\d{10,12})\.([0-9a-f]{32})$/.exec(String(rawToken || '').trim());
  if (!match) return false; // Legacy tokens have no expiry and must be replaced by a fresh login.
  const expiresAt = Number(match[1]);
  const now = Math.floor(Date.now() / 1000);
  if (expiresAt <= now || expiresAt > now + MAX_SESSION_SECONDS) return false;
  const expected = crypto.createHmac('sha256', getSigningSecret()).update(`v1.${expiresAt}`)
    .digest('hex').slice(0, 32);
  return crypto.timingSafeEqual(Buffer.from(match[2], 'hex'), Buffer.from(expected, 'hex'));
}

export function extractAndVerifyRequestFamilySession(req: FastifyRequest): boolean {
  if (verifySignedFamilyToken(String(req.headers['x-mea-session'] || ''))) return true;
  const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  if (bearer && verifySignedFamilyToken(bearer[1])) return true;
  const cookie = /(?:^|;\s*)mea_family_session=([^;]+)/.exec(String(req.headers.cookie || ''));
  try {
    return Boolean(cookie && verifySignedFamilyToken(decodeURIComponent(cookie[1])));
  } catch {
    return false;
  }
}

export async function requireFamilyAdminPreHandler(
  req: FastifyRequest, reply: FastifyReply,
): Promise<void> {
  if (process.env.ENFORCE_SERVER_AUTH !== '1' && process.env.NODE_ENV !== 'production') return;
  if (!extractAndVerifyRequestFamilySession(req)) {
    reply.code(401).send({error: 'UNAUTHORIZED', message: '请先使用授权微信号扫码登录'});
  }
}

export function familySessionCookie(token: string): string {
  return `mea_family_session=${token}; Path=/; Max-Age=${MAX_SESSION_SECONDS}; HttpOnly; SameSite=Lax` +
    (process.env.NODE_ENV === 'production' ? '; Secure' : '');
}
