import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { canTransition, canParentEditRegistration, formatRmbYuan, RegistrationStatus, resolveSubjectName } from '@musicexamaid/shared';
import { getPostgresPool as getLivePostgresPool } from '../store/postgres';
import type { StoredRegistration } from '../store/repository';
import {
  LEARNER_PROFILE_FIELDS, type LearnerProfilePatch,
  REGISTRATION_DETAIL_FIELDS, type RegistrationDetailsPatch,
} from '../store/repository';
import { toPublicLearner } from './learners';
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

interface ParentRegistrationBody {
  learner_id?: string;
  institution_id?: string;
  class_id?: string;
  cycle_id?: string;
  subject_id?: string;
  level?: number;
  exam_mode?: '现场' | '视频' | '音基';
  exam_site_id_optional?: string;
  repertoire?: string[];
}

function toParentRegistration(registration: StoredRegistration) {
  const {snapshot_json: _snapshot, ...publicFields} = registration;
  return {
    ...publicFields,
    subject_name: resolveSubjectName(registration.subject_id),
    has_snapshot: registration.snapshot_json !== null,
  };
}

function isLearnerProfilePatch(body: unknown): body is LearnerProfilePatch {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const entries = Object.entries(body);
  if (entries.length === 0) return false;
  const allowed = new Set<string>(LEARNER_PROFILE_FIELDS);
  return entries.every(([field, value]) => {
    if (!allowed.has(field) || typeof value !== 'string' || value.length > 500) return false;
    if (field === 'gender') return value === '男' || value === '女';
    if (field === 'dob') {
      const date = new Date(value);
      return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }
    if (['name_cn', 'nationality', 'guardian_phone'].includes(field)) return value.trim().length > 0;
    return true;
  });
}

function isRegistrationDetailsPatch(body: unknown): body is RegistrationDetailsPatch {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const entries = Object.entries(body);
  if (entries.length === 0) return false;
  const allowed = new Set<string>(REGISTRATION_DETAIL_FIELDS);
  return entries.every(([field, value]) => {
    if (!allowed.has(field)) return false;
    if (field === 'level') return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10;
    if (field === 'exam_mode') return value === '现场' || value === '视频' || value === '音基';
    if (field === 'repertoire') {
      return Array.isArray(value) && value.length <= 20 && value.every(item =>
        typeof item === 'string' && item.trim().length > 0 && item.length <= 500);
    }
    return typeof value === 'string' && value.length <= 128 &&
      (field === 'exam_site_id_optional' || value.trim().length > 0);
  });
}

export async function parentAccessRoutes(
  app: FastifyInstance, opts: ParentAccessOptions = {},
): Promise<void> {
  const getPool = () => opts.postgresPool ?? getLivePostgresPool();
  const activeLearnerIds = async (openid: string): Promise<string[]> => {
    const {rows} = await getPool().query<{learner_id: string}>(
      `SELECT learner_id FROM parent_learner_grants
       WHERE parent_openid = $1 AND revoked_at IS NULL ORDER BY granted_at, learner_id`,
      [openid],
    );
    return rows.map(row => row.learner_id);
  };

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
    return reply.send({
      role: 'parent',
      expires_at: new Date(session.expiresAt * 1000).toISOString(),
      learner_ids: await activeLearnerIds(session.openid),
    });
  });

  app.get('/parent/learners', async (req, reply) => {
    const session = await requireVerifiedParent(req, reply);
    if (!session) return;
    const items = [];
    for (const learnerId of await activeLearnerIds(session.openid)) {
      const learner = app.store.getLearner(learnerId);
      if (learner) items.push(toPublicLearner(learner));
    }
    return reply.send({items});
  });

  app.get(
    '/parent/learners/:learnerId',
    async (
      req: FastifyRequest<{Params: {learnerId: string}}>, reply: FastifyReply,
    ) => {
      const session = await requireVerifiedParent(req, reply);
      if (!session) return;
      const granted = (await activeLearnerIds(session.openid)).includes(req.params.learnerId);
      if (!granted) return reply.code(404).send({error: 'LEARNER_NOT_FOUND'});
      const learner = app.store.getLearner(req.params.learnerId);
      if (!learner) return reply.code(404).send({error: 'LEARNER_NOT_FOUND'});
      return reply.send(toPublicLearner(learner));
    },
  );

  app.patch(
    '/parent/learners/:learnerId',
    async (
      req: FastifyRequest<{Params: {learnerId: string}; Body: unknown}>, reply: FastifyReply,
    ) => {
      const session = await requireVerifiedParent(req, reply);
      if (!session) return;
      const granted = (await activeLearnerIds(session.openid)).includes(req.params.learnerId);
      if (!granted) return reply.code(404).send({error: 'LEARNER_NOT_FOUND'});
      if (!isLearnerProfilePatch(req.body)) {
        return reply.code(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Supply profile/contact fields only; document identifiers and photos require an administrator',
        });
      }
      const learner = app.store.updateLearnerProfile(req.params.learnerId, req.body);
      if (!learner) return reply.code(404).send({error: 'LEARNER_NOT_FOUND'});
      return reply.send(toPublicLearner(learner));
    },
  );

  app.get('/parent/registrations', async (req, reply) => {
    const session = await requireVerifiedParent(req, reply);
    if (!session) return;
    const granted = new Set(await activeLearnerIds(session.openid));
    if (granted.size === 0) return reply.send({items: []});
    const items = app.store.listRegistrations()
      .filter(registration => granted.has(registration.learner_id))
      .map(registration => ({
        ...toParentRegistration(registration),
        learner_name_cn: app.store.getLearner(registration.learner_id)?.name_cn ?? '',
      }));
    return reply.send({items});
  });

  app.get(
    '/parent/registrations/:registrationId',
    async (
      req: FastifyRequest<{Params: {registrationId: string}}>, reply: FastifyReply,
    ) => {
      const session = await requireVerifiedParent(req, reply);
      if (!session) return;
      const granted = new Set(await activeLearnerIds(session.openid));
      if (granted.size === 0) return reply.code(404).send({error: 'REGISTRATION_NOT_FOUND'});
      const registration = app.store.getRegistration(req.params.registrationId);
      if (!registration || !granted.has(registration.learner_id)) {
        return reply.code(404).send({error: 'REGISTRATION_NOT_FOUND'});
      }
      return reply.send(toParentRegistration(registration));
    },
  );

  app.get(
    '/parent/registrations/:registrationId/checkout-preview',
    async (
      req: FastifyRequest<{Params: {registrationId: string}}>, reply: FastifyReply,
    ) => {
      const session = await requireVerifiedParent(req, reply);
      if (!session) return;
      const granted = new Set(await activeLearnerIds(session.openid));
      if (granted.size === 0) return reply.code(404).send({error: 'REGISTRATION_NOT_FOUND'});
      const registration = app.store.getRegistration(req.params.registrationId);
      if (!registration || !granted.has(registration.learner_id)) {
        return reply.code(404).send({error: 'REGISTRATION_NOT_FOUND'});
      }
      if (Object.keys(req.query as Record<string, unknown>).length > 0) {
        return reply.code(400).send({error: 'VALIDATION_ERROR', message: 'Checkout preview accepts no pricing or identity overrides'});
      }
      if (!Number.isInteger(registration.level) || registration.level < 1 || registration.level > 10) {
        return reply.code(409).send({error: 'REGISTRATION_PRICING_UNAVAILABLE'});
      }
      const rate = app.store.getTeacherGradeRateSchedule(registration.teacher_id)
        .find(item => item.levelNum === registration.level);
      if (!rate || !Number.isSafeInteger(rate.feeFen) || rate.feeFen < 0) {
        return reply.code(409).send({error: 'REGISTRATION_PRICING_UNAVAILABLE'});
      }
      // A price preview is neither an order nor evidence of a payment.
      return reply.send({
        status: 'preview_only',
        payment_available: false,
        quote: {
          registration_id: registration.id,
          level: registration.level,
          currency: 'CNY',
          exam_fee_fen: rate.feeFen,
          exam_fee_yuan: formatRmbYuan(rate.feeFen),
        },
      });
    },
  );

  app.patch(
    '/parent/registrations/:registrationId',
    async (
      req: FastifyRequest<{Params: {registrationId: string}; Body: unknown}>, reply: FastifyReply,
    ) => {
      const session = await requireVerifiedParent(req, reply);
      if (!session) return;
      const granted = new Set(await activeLearnerIds(session.openid));
      if (granted.size === 0) return reply.code(404).send({error: 'REGISTRATION_NOT_FOUND'});
      const registration = app.store.getRegistration(req.params.registrationId);
      if (!registration || !granted.has(registration.learner_id)) {
        return reply.code(404).send({error: 'REGISTRATION_NOT_FOUND'});
      }
      if (!canParentEditRegistration(registration.status)) {
        return reply.code(409).send({error: 'REGISTRATION_NOT_EDITABLE'});
      }
      if (!isRegistrationDetailsPatch(req.body)) {
        return reply.code(400).send({error: 'VALIDATION_ERROR', message: 'Supply valid registration detail fields only'});
      }
      if (req.body.level !== undefined && req.body.level !== registration.level &&
          app.store.hasRegistrationPayment(registration.id)) {
        return reply.code(409).send({error: 'REGISTRATION_PRICE_LOCKED'});
      }
      const updated = app.store.updateRegistrationDetails(registration.id, req.body);
      if (!updated) return reply.code(404).send({error: 'REGISTRATION_NOT_FOUND'});
      return reply.send(toParentRegistration(updated));
    },
  );

  app.post(
    '/parent/registrations',
    async (
      req: FastifyRequest<{Body?: ParentRegistrationBody}>, reply: FastifyReply,
    ) => {
      const session = await requireVerifiedParent(req, reply);
      if (!session) return;
      const body = req.body ?? {};
      const learnerId = String(body.learner_id || '');
      const level = Number(body.level);
      if (!learnerId || !body.cycle_id || !body.subject_id ||
          !Number.isInteger(level) || level < 1 || level > 10) {
        return reply.code(400).send({
          error: 'VALIDATION_ERROR',
          message: 'learner_id, cycle_id, subject_id, and level (1..10) are required',
        });
      }
      const granted = (await activeLearnerIds(session.openid)).includes(learnerId);
      if (!granted) return reply.code(404).send({error: 'LEARNER_NOT_FOUND'});
      const registration = app.store.createRegistration({
        learner_id: learnerId,
        institution_id: body.institution_id ?? body.class_id ?? null,
        cycle_id: body.cycle_id,
        subject_id: body.subject_id,
        level,
        exam_mode: body.exam_mode ?? '现场',
        exam_site_id_optional: body.exam_site_id_optional,
        repertoire: body.repertoire ?? [],
      });
      return reply.code(201).send(toParentRegistration(registration));
    },
  );

  app.post(
    '/parent/registrations/:registrationId/submit',
    async (
      req: FastifyRequest<{Params: {registrationId: string}}>, reply: FastifyReply,
    ) => {
      const session = await requireVerifiedParent(req, reply);
      if (!session) return;
      const granted = new Set(await activeLearnerIds(session.openid));
      if (granted.size === 0) return reply.code(404).send({error: 'REGISTRATION_NOT_FOUND'});
      const registration = app.store.getRegistration(req.params.registrationId);
      if (!registration || !granted.has(registration.learner_id)) {
        return reply.code(404).send({error: 'REGISTRATION_NOT_FOUND'});
      }
      if (!canTransition(registration.status, RegistrationStatus.SUBMITTED)) {
        return reply.code(409).send({
          error: 'INVALID_STATUS_TRANSITION',
          message: `Cannot submit registration from ${registration.status}`,
        });
      }
      const updated = app.store.transitionRegistration({
        id: registration.id,
        from_status: registration.status,
        to_status: RegistrationStatus.SUBMITTED,
      });
      return reply.send(toParentRegistration(updated));
    },
  );

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
