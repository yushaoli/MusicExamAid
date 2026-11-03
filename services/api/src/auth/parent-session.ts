import * as crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { signSessionPayload } from './family-session';

const MAX_PARENT_SESSION_SECONDS = 2 * 60 * 60;
const COOKIE_NAME = 'mea_parent_session';

export interface ParentSession {
  openid: string;
  expiresAt: number;
}

export function isValidParentOpenid(openid: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(openid);
}

export function buildSignedParentToken(
  openid: string, ttlSeconds = MAX_PARENT_SESSION_SECONDS,
): string {
  if (!isValidParentOpenid(openid)) throw new Error('A valid WeChat OpenID is required');
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > MAX_PARENT_SESSION_SECONDS) {
    throw new Error('Parent session lifetime must be between 1 second and 2 hours');
  }
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const encodedOpenid = Buffer.from(openid, 'utf8').toString('base64url');
  const payload = `parent.v1.${encodedOpenid}.${expiresAt}`;
  return `${payload}.${signSessionPayload(payload)}`;
}

export function verifySignedParentToken(token?: string | null): ParentSession | null {
  const match = /^parent\.v1\.([A-Za-z0-9_-]+)\.(\d{10,12})\.([0-9a-f]{32})$/
    .exec(String(token || '').trim());
  if (!match) return null;
  const expiresAt = Number(match[2]);
  const now = Math.floor(Date.now() / 1000);
  if (expiresAt <= now || expiresAt > now + MAX_PARENT_SESSION_SECONDS) return null;
  const openid = Buffer.from(match[1], 'base64url').toString('utf8');
  if (!isValidParentOpenid(openid) || Buffer.from(openid, 'utf8').toString('base64url') !== match[1]) return null;
  const expected = signSessionPayload(`parent.v1.${match[1]}.${match[2]}`);
  if (!crypto.timingSafeEqual(Buffer.from(match[3], 'hex'), Buffer.from(expected, 'hex'))) return null;
  return {openid, expiresAt};
}

export function extractAndVerifyRequestParentSession(req: FastifyRequest): ParentSession | null {
  const header = verifySignedParentToken(String(req.headers['x-mea-parent-session'] || ''));
  if (header) return header;
  const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  const fromBearer = bearer && verifySignedParentToken(bearer[1]);
  if (fromBearer) return fromBearer;
  const cookie = /(?:^|;\s*)mea_parent_session=([^;]+)/.exec(String(req.headers.cookie || ''));
  try { return cookie ? verifySignedParentToken(decodeURIComponent(cookie[1])) : null; }
  catch { return null; }
}

export function parentSessionCookie(token: string | null): string {
  return `${COOKIE_NAME}=${token || ''}; Path=/; Max-Age=${token ? MAX_PARENT_SESSION_SECONDS : 0}; HttpOnly; SameSite=Lax` +
    (process.env.NODE_ENV === 'production' ? '; Secure' : '');
}

export async function requireVerifiedParent(
  req: FastifyRequest, reply: FastifyReply,
): Promise<ParentSession | null> {
  reply.header('Cache-Control', 'no-store');
  const session = extractAndVerifyRequestParentSession(req);
  if (!session) {
    reply.code(401).send({error: 'UNAUTHORIZED', message: '请使用微信登录家长账号'});
    return null;
  }
  return session;
}
