import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { getPostgresPool as getLivePostgresPool } from '../store/postgres';
import { requireVerifiedFamilyAdmin } from '../auth/family-session';
import {
  buildSignedParentToken,
  isValidParentOpenid,
  parentSessionCookie,
  requireVerifiedParent,
} from '../auth/parent-session';

export interface ParentAccessOptions {
  postgresPool?: Pick<Pool, 'query'>;
}

interface ParentGrantBody {
  parent_openid?: string;
}

export async function parentAccessRoutes(
  app: FastifyInstance, opts: ParentAccessOptions = {},
): Promise<void> {
  const getPool = () => opts.postgresPool ?? getLivePostgresPool();

  app.post(
    '/parent/auth',
    async (req: FastifyRequest<{Body?: {code?: string}}>, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');
      const code = String(req.body?.code || '').trim();
      if (!code || code.length > 256) {
        return reply.code(400).send({error: 'VALIDATION_ERROR', message: 'A wx.login code is required'});
      }
      const appid = String(process.env.WECHAT_MINI_APPID || '').trim();
      const secret = String(process.env.WECHAT_MINI_SECRET || '').trim();
      if (!appid || !secret) {
        return reply.code(503).send({error: 'PARENT_AUTH_NOT_CONFIGURED'});
      }

      const query = new URLSearchParams({
        appid, secret, js_code: code, grant_type: 'authorization_code',
      });
      let result: {openid?: string; unionid?: string; errcode?: number};
      try {
        const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query}`);
        if (!response.ok) throw new Error('WeChat login exchange failed');
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== 'object') throw new Error('Invalid WeChat login response');
        result = payload as typeof result;
      } catch {
        return reply.code(502).send({error: 'PARENT_AUTH_UNAVAILABLE'});
      }
      const openid = String(result.openid || '');
      if (result.errcode || !isValidParentOpenid(openid)) {
        return reply.code(401).send({error: 'PARENT_AUTH_FAILED', message: '微信登录校验失败'});
      }

      // The upstream session_key is deliberately neither returned nor persisted.
      const token = buildSignedParentToken(openid);
      reply.header('Set-Cookie', parentSessionCookie(token));
      return reply.send({role: 'parent', parent_token: token, expires_in: 7200});
    },
  );

  app.get('/parent/session', async (req, reply) => {
    const session = await requireVerifiedParent(req, reply);
    if (!session) return;
    const {rows} = await getPool().query<{learner_id: string}>(
      `SELECT learner_id FROM parent_learner_grants
       WHERE parent_openid = $1 AND revoked_at IS NULL ORDER BY granted_at, learner_id`,
      [session.openid],
    );
    return reply.send({
      role: 'parent',
      expires_at: new Date(session.expiresAt * 1000).toISOString(),
      learner_ids: rows.map(row => row.learner_id),
    });
  });

  app.put(
    '/parent/learners/:learnerId/grant',
    async (
      req: FastifyRequest<{Params: {learnerId: string}; Body?: ParentGrantBody}>,
      reply: FastifyReply,
    ) => {
      await requireVerifiedFamilyAdmin(req, reply);
      if (reply.sent) return;
      const openid = String(req.body?.parent_openid || '').trim();
      if (!isValidParentOpenid(openid)) {
        return reply.code(400).send({error: 'VALIDATION_ERROR', message: 'A valid parent OpenID is required'});
      }
      if (!app.store.getLearner(req.params.learnerId)) {
        return reply.code(404).send({error: 'LEARNER_NOT_FOUND'});
      }
      await getPool().query(
        `INSERT INTO parent_learner_grants
           (parent_openid, learner_id, granted_by, granted_at, revoked_at)
         VALUES ($1, $2, 'family_admin', NOW(), NULL)
         ON CONFLICT (parent_openid, learner_id) DO UPDATE
         SET granted_by = 'family_admin', granted_at = NOW(), revoked_at = NULL`,
        [openid, req.params.learnerId],
      );
      return reply.send({granted: true, learner_id: req.params.learnerId, parent_openid: openid});
    },
  );

  app.delete(
    '/parent/learners/:learnerId/grant',
    async (
      req: FastifyRequest<{Params: {learnerId: string}; Body?: ParentGrantBody}>,
      reply: FastifyReply,
    ) => {
      await requireVerifiedFamilyAdmin(req, reply);
      if (reply.sent) return;
      const openid = String(req.body?.parent_openid || '').trim();
      if (!isValidParentOpenid(openid)) {
        return reply.code(400).send({error: 'VALIDATION_ERROR', message: 'A valid parent OpenID is required'});
      }
      const result = await getPool().query(
        `UPDATE parent_learner_grants SET revoked_at = NOW()
         WHERE parent_openid = $1 AND learner_id = $2 AND revoked_at IS NULL`,
        [openid, req.params.learnerId],
      );
      return reply.send({revoked: (result.rowCount || 0) > 0,
        learner_id: req.params.learnerId, parent_openid: openid});
    },
  );

  app.get(
    '/parent/learners/:learnerId/grants',
    async (
      req: FastifyRequest<{Params: {learnerId: string}}>, reply: FastifyReply,
    ) => {
      await requireVerifiedFamilyAdmin(req, reply);
      if (reply.sent) return;
      const {rows} = await getPool().query(
        `SELECT parent_openid, learner_id, granted_by, granted_at, revoked_at
         FROM parent_learner_grants WHERE learner_id = $1 ORDER BY granted_at, parent_openid`,
        [req.params.learnerId],
      );
      return reply.send({items: rows});
    },
  );
}
