/**
 * WeChat Service Account (服务号) and WeCom (企业微信) integration helpers.
 *
 * Includes:
 * - SHA1 signature verification for WeChat MP / WeCom webhook callbacks
 * - Markdown message formatters for the xgar WeCom relay (`https://wecom.xgar.com.cn/send/<token>`)
 * - WeChat Service Account template message payload builder (deep-linking to Mini Program)
 */

import * as crypto from 'crypto';
import type { RegistrationStatus } from './registration-status';

// ---------------------------------------------------------------------------
// 1. Webhook Signature Verification (WeChat Service Account & WeCom)
// ---------------------------------------------------------------------------

/**
 * Compute the SHA1 signature over sorted `[token, timestamp, nonce, encrypt?]`.
 */
export function computeWeChatSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt?: string,
): string {
  const parts = encrypt !== undefined
    ? [token, timestamp, nonce, encrypt]
    : [token, timestamp, nonce];
  const joined = [...parts].sort().join('');
  return crypto.createHash('sha1').update(joined, 'utf8').digest('hex');
}

/**
 * Verify a WeChat Service Account or WeCom callback signature in constant time.
 */
export function verifyWeChatSignature(params: {
  token: string;
  signature: string;
  timestamp: string;
  nonce: string;
  encrypt?: string;
}): boolean {
  const { token, signature, timestamp, nonce, encrypt } = params;
  if (!token || !signature || !timestamp || !nonce) return false;
  const expected = computeWeChatSignature(token, timestamp, nonce, encrypt);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(signature, 'utf8'),
  );
}

// ---------------------------------------------------------------------------
// 2. WeCom Relay Message Formatting (xgar pattern: POST /send/<token>)
// ---------------------------------------------------------------------------

const STATUS_LABELS_CN: Record<RegistrationStatus, string> = {
  draft: '草稿 (Draft)',
  submitted: '待老师审核 (Submitted)',
  needs_change: '需家长修改 (Needs Change)',
  confirmed: '老师已确认 (Confirmed)',
  locked: '已锁定归档 (Locked)',
};

export interface WeComStatusAlertInput {
  registrationId: string;
  fromStatus: RegistrationStatus;
  toStatus: RegistrationStatus;
  teacherNotes?: string;
}

/**
 * Format a WeCom markdown alert for registration status changes.
 * Compatible with `POST https://wecom.xgar.com.cn/send/<PROJECT_TOKEN>`.
 */
export function formatWeComStatusAlert(input: WeComStatusAlertInput): string {
  const fromLabel = STATUS_LABELS_CN[input.fromStatus] ?? input.fromStatus;
  const toLabel = STATUS_LABELS_CN[input.toStatus] ?? input.toStatus;
  const lines = [
    `**[考级助手] 报名状态变更**`,
    `> 报名单号: \`${input.registrationId}\``,
    `> 状态流转: ${fromLabel} → **${toLabel}**`,
  ];
  if (input.teacherNotes && input.teacherNotes.trim()) {
    lines.push(`> 审核备注: ${input.teacherNotes.trim()}`);
  }
  return lines.join('\n');
}

export interface WeComExportAlertInput {
  jobId: string;
  cycleId: string;
  batchType: 'institution' | 'super';
  itemCount: number;
}

/**
 * Format a WeCom markdown alert when an Excel export batch job is queued.
 */
export function formatWeComExportAlert(input: WeComExportAlertInput): string {
  return [
    `**[考级助手] 导出任务已入队**`,
    `> 任务ID: \`${input.jobId}\``,
    `> 考期: ${input.cycleId} (${input.batchType})`,
    `> 报名人数: **${input.itemCount}**`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 3. WeChat Service Account Template Message Builder (Parent Notifications)
// ---------------------------------------------------------------------------

export interface ServiceAccountTemplateInput {
  mpOpenId: string;
  templateId: string;
  miniProgramAppId: string;
  registrationId: string;
  toStatus: RegistrationStatus;
  teacherNotes?: string;
  updatedAtIso?: string;
}

export interface ServiceAccountTemplatePayload {
  touser: string;
  template_id: string;
  miniprogram: {
    appid: string;
    pagepath: string;
  };
  data: {
    first: { value: string };
    keyword1: { value: string };
    keyword2: { value: string };
    remark: { value: string };
  };
}

/**
 * Build a standard WeChat Official/Service Account template message payload
 * that deep-links the parent directly to the Mini Program registration detail page.
 */
export function buildServiceAccountTemplatePayload(
  input: ServiceAccountTemplateInput,
): ServiceAccountTemplatePayload {
  const statusLabel = STATUS_LABELS_CN[input.toStatus] ?? input.toStatus;
  const dateStr = (input.updatedAtIso ?? new Date().toISOString()).slice(0, 10);
  const defaultRemark =
    input.toStatus === 'needs_change'
      ? '请点击进入小程序补充或修改报名信息后重新提交。'
      : '点击卡片可打开「考级助手」小程序查看详情。';

  return {
    touser: input.mpOpenId,
    template_id: input.templateId,
    miniprogram: {
      appid: input.miniProgramAppId,
      pagepath: `pages/registration/detail/detail?id=${encodeURIComponent(input.registrationId)}`,
    },
    data: {
      first: { value: `您的音乐考级报名状态已更新（单号：${input.registrationId}）` },
      keyword1: { value: statusLabel },
      keyword2: { value: dateStr },
      remark: {
        value: input.teacherNotes?.trim()
          ? `老师备注：${input.teacherNotes.trim()}\n${defaultRemark}`
          : defaultRemark,
      },
    },
  };
}
