import * as crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { extractAndVerifyRequestFamilySession, signSessionPayload } from './family-session';

const MAX_TEACHER_SESSION_SECONDS = 8 * 60 * 60;
const MAX_AGENT_ID = 2_147_483_647;
const COOKIE_NAME = 'mea_teacher_session';

export interface TeacherSession {
  agentId: number;
  expiresAt: number;
  inviteDigest: string;
}

export function isStrongTeacherInvite(agentId: number, invite: string): boolean {
  const match = /^t_inv_(\d+)_[0-9a-f]{32}$/.exec(invite);
  return Boolean(match && Number(match[1]) === agentId &&
    Number.isInteger(agentId) && agentId > 0 && agentId <= MAX_AGENT_ID);
}

function inviteDigest(invite: string): string {
  return crypto.createHash('sha256').update(invite).digest('hex').slice(0, 32);
}

export function buildSignedTeacherToken(
  agentId: number, invite: string, ttlSeconds = MAX_TEACHER_SESSION_SECONDS,
): string {
  if (!isStrongTeacherInvite(agentId, invite)) throw new Error('A random 128-bit teacher invite is required');
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > MAX_TEACHER_SESSION_SECONDS) {
    throw new Error('Teacher session lifetime must be between 1 second and 8 hours');
  }
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `teacher.v1.${agentId}.${expiresAt}.${inviteDigest(invite)}`;
  return `${payload}.${signSessionPayload(payload)}`;
}

export function verifySignedTeacherToken(token?: string | null): TeacherSession | null {
  const match = /^teacher\.v1\.(\d{1,10})\.(\d{10,12})\.([0-9a-f]{32})\.([0-9a-f]{32})$/.exec(String(token || '').trim());
  if (!match) return null;
  const agentId = Number(match[1]);
  const expiresAt = Number(match[2]);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(agentId) || agentId <= 0 || agentId > MAX_AGENT_ID ||
      expiresAt <= now || expiresAt > now + MAX_TEACHER_SESSION_SECONDS) return null;
  const payload = `teacher.v1.${match[1]}.${match[2]}.${match[3]}`;
  const expected = signSessionPayload(payload);
  if (!crypto.timingSafeEqual(Buffer.from(match[4], 'hex'), Buffer.from(expected, 'hex'))) return null;
  return {agentId, expiresAt, inviteDigest: match[3]};
}

export function teacherSessionCookie(token: string | null): string {
  return `${COOKIE_NAME}=${token || ''}; Path=/; Max-Age=${token ? MAX_TEACHER_SESSION_SECONDS : 0}; HttpOnly; SameSite=Lax` +
    (process.env.NODE_ENV === 'production' ? '; Secure' : '');
}

function requestTeacherSession(req: FastifyRequest): TeacherSession | null {
  const header = verifySignedTeacherToken(String(req.headers['x-mea-teacher-session'] || ''));
  if (header) return header;
  const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  const fromBearer = bearer && verifySignedTeacherToken(bearer[1]);
  if (fromBearer) return fromBearer;
  const cookie = /(?:^|;\s*)mea_teacher_session=([^;]+)/.exec(String(req.headers.cookie || ''));
  try { return cookie ? verifySignedTeacherToken(decodeURIComponent(cookie[1])) : null; }
  catch { return null; }
}

export type HistoricalLookupScope = {role: 'admin'} | {role: 'teacher'; agentId: number};

/** Authenticate before opening storage. A referral code is never learner ownership. */
export async function requireHistoricalLookupScope(
  req: FastifyRequest, reply: FastifyReply, getPool: () => Pick<Pool, 'query'>,
): Promise<HistoricalLookupScope | null> {
  reply.header('Cache-Control', 'no-store');
  if (extractAndVerifyRequestFamilySession(req)) return {role: 'admin'};
  const session = requestTeacherSession(req);
  if (session) {
    // Recheck the current invite on every request: rotating/removing it revokes
    // prior sessions immediately, without returning the invite to the client.
    const {rows} = await getPool().query<{agent_id: number; invite_token: string | null}>(
      'SELECT agent_id, invite_token FROM kjzx_partner_agents WHERE agent_id = $1::int', [session.agentId],
    );
    const agent = rows[0];
    if (agent && Number(agent.agent_id) === session.agentId &&
        isStrongTeacherInvite(session.agentId, agent.invite_token || '') &&
        crypto.timingSafeEqual(Buffer.from(session.inviteDigest, 'hex'), Buffer.from(inviteDigest(agent.invite_token!), 'hex'))) {
      return {role: 'teacher', agentId: session.agentId};
    }
  }
  reply.code(401).send({error: 'UNAUTHORIZED', message: '请先通过授权微信或老师专属链接登录'});
  return null;
}
