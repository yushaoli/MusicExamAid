/**
 * WeChat Service Account (服务号) & WeCom (企业微信) integration routes.
 *
 * Endpoints:
 * - GET  /webhooks/wechat-mp       WeChat Service Account URL verification (`echostr`)
 * - POST /webhooks/wechat-mp       WeChat Service Account inbound event/message webhook
 * - GET  /webhooks/wecom           WeCom callback URL verification
 * - POST /webhooks/wecom           WeCom inbound event webhook
 * - POST /notifications/wecom      Send or preview a WeCom alert via `wecom.xgar.com.cn`
 * - POST /notifications/wechat-mp  Build/send a Service Account template message to a parent
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  verifyWeChatSignature,
  buildServiceAccountTemplatePayload,
  RegistrationStatus,
} from '@musicexamaid/shared';
import type { RegistrationStatusType } from '@musicexamaid/shared';

interface WeChatWebhookQuery {
  signature?: string;
  msg_signature?: string;
  timestamp?: string;
  nonce?: string;
  echostr?: string;
}

interface WeComSendBody {
  msg?: string;
}

interface WeChatMpTemplateBody {
  mp_openid?: string;
  registration_id?: string;
  to_status?: RegistrationStatusType;
  teacher_notes?: string;
}

const KNOWN_STATUSES = new Set<string>(Object.values(RegistrationStatus));

function isRegistrationStatus(val: unknown): val is RegistrationStatusType {
  return typeof val === 'string' && KNOWN_STATUSES.has(val);
}

/**
 * Dispatch a markdown message to the xgar WeCom relay (`POST https://wecom.xgar.com.cn/send/<token>`)
 * when `WECOM_RELAY_TOKEN` is configured; otherwise return `{ status: 'dry_run' }`.
 */
export async function dispatchWeComAlert(
  msg: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ status: 'sent' | 'dry_run' | 'failed'; relayUrl: string; error?: string }> {
  const baseUrl = (env.WECOM_RELAY_URL || 'https://wecom.xgar.com.cn/send').replace(/\/+$/, '');
  const token = (env.WECOM_RELAY_TOKEN || '').trim();

  if (!token) {
    return {
      status: 'dry_run',
      relayUrl: `${baseUrl}/<WECOM_RELAY_TOKEN>`,
    };
  }

  const targetUrl = `${baseUrl}/${encodeURIComponent(token)}`;
  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg }),
    });
    if (!res.ok) {
      return {
        status: 'failed',
        relayUrl: `${baseUrl}/***`,
        error: `HTTP ${res.status}`,
      };
    }
    return { status: 'sent', relayUrl: `${baseUrl}/***` };
  } catch (err) {
    return {
      status: 'failed',
      relayUrl: `${baseUrl}/***`,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  // 1. WeChat Service Account (服务号) server verification
  app.get(
    '/webhooks/wechat-mp',
    async (
      req: FastifyRequest<{ Querystring: WeChatWebhookQuery }>,
      reply: FastifyReply,
    ) => {
      const { signature = '', timestamp = '', nonce = '', echostr = '' } = req.query ?? {};
      const token = process.env.WECHAT_MP_TOKEN || 'dev_wechat_mp_token';

      if (!verifyWeChatSignature({ token, signature, timestamp, nonce })) {
        return reply.code(403).send({
          error: 'INVALID_SIGNATURE',
          message: 'WeChat Service Account webhook signature verification failed',
        });
      }

      return reply.type('text/plain').code(200).send(echostr);
    },
  );

  // 2. WeChat Service Account inbound event receiver (subscribe / unsubscribe / messages)
  app.post(
    '/webhooks/wechat-mp',
    async (
      req: FastifyRequest<{ Querystring: WeChatWebhookQuery }>,
      reply: FastifyReply,
    ) => {
      const { signature = '', timestamp = '', nonce = '' } = req.query ?? {};
      const token = process.env.WECHAT_MP_TOKEN || 'dev_wechat_mp_token';

      if (
        signature &&
        !verifyWeChatSignature({ token, signature, timestamp, nonce })
      ) {
        return reply.code(403).send({
          error: 'INVALID_SIGNATURE',
          message: 'WeChat Service Account webhook signature verification failed',
        });
      }

      // WeChat requires literal "success" within 5 seconds to acknowledge receipt
      return reply.type('text/plain').code(200).send('success');
    },
  );

  // 3. WeCom callback verification & event receiver
  app.get(
    '/webhooks/wecom',
    async (
      req: FastifyRequest<{ Querystring: WeChatWebhookQuery }>,
      reply: FastifyReply,
    ) => {
      const {
        msg_signature = '',
        signature = '',
        timestamp = '',
        nonce = '',
        echostr = '',
      } = req.query ?? {};
      const token = process.env.WECOM_CALLBACK_TOKEN || process.env.WECHAT_MP_TOKEN || 'dev_wecom_token';
      const sig = msg_signature || signature;

      const valid =
        verifyWeChatSignature({ token, signature: sig, timestamp, nonce, encrypt: echostr }) ||
        verifyWeChatSignature({ token, signature: sig, timestamp, nonce });

      if (!valid) {
        return reply.code(403).send({
          error: 'INVALID_SIGNATURE',
          message: 'WeCom webhook signature verification failed',
        });
      }

      return reply.type('text/plain').code(200).send(echostr);
    },
  );

  app.post('/webhooks/wecom', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.type('text/plain').code(200).send('success');
  });

  // 4. Outbound WeCom alert via xgar relay (`https://wecom.xgar.com.cn/send/<token>`)
  app.post(
    '/notifications/wecom',
    async (
      req: FastifyRequest<{ Body: WeComSendBody }>,
      reply: FastifyReply,
    ) => {
      const msg = req.body?.msg?.trim();
      if (!msg) {
        return reply.code(400).send({
          error: 'VALIDATION_ERROR',
          message: 'msg is required',
        });
      }

      const result = await dispatchWeComAlert(msg);
      return reply.code(200).send({
        channel: 'wecom',
        ...result,
        msg,
      });
    },
  );

  // 5. Outbound WeChat Service Account template message builder/dispatcher for parents
  app.post(
    '/notifications/wechat-mp',
    async (
      req: FastifyRequest<{ Body: WeChatMpTemplateBody }>,
      reply: FastifyReply,
    ) => {
      const body = req.body ?? {};
      if (
        !body.mp_openid ||
        !body.registration_id ||
        !isRegistrationStatus(body.to_status)
      ) {
        return reply.code(400).send({
          error: 'VALIDATION_ERROR',
          message: 'mp_openid, registration_id, and a valid to_status are required',
        });
      }

      const templateId =
        process.env.WECHAT_MP_REVIEW_TEMPLATE_ID || 'stub_review_template_id';
      const miniProgramAppId =
        process.env.WECHAT_MINI_APPID || 'wxaf3466a310a8bd07';

      const payload = buildServiceAccountTemplatePayload({
        mpOpenId: body.mp_openid,
        templateId,
        miniProgramAppId,
        registrationId: body.registration_id,
        toStatus: body.to_status,
        teacherNotes: body.teacher_notes,
      });

      return reply.code(200).send({
        channel: 'wechat_mp',
        status: process.env.WECHAT_MP_SECRET ? 'queued' : 'dry_run',
        payload,
      });
    },
  );
}
