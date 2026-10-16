/**
 * Environment configuration loader.
 *
 * Usage:
 *   import { loadConfig } from '@musicexamaid/shared';
 *   const cfg = loadConfig();              // validates process.env only
 *   const cfg = loadConfig('/path/.env');  // merges file first, then process.env wins
 */

import { z } from 'zod';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const ConfigSchema = z.object({
  POSTGRES_URL: z.string().url('POSTGRES_URL must be a valid URL'),
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL'),
  S3_ENDPOINT: z.string().url('S3_ENDPOINT must be a valid URL'),
  S3_ACCESS_KEY: z.string().min(1, 'S3_ACCESS_KEY is required'),
  S3_SECRET_KEY: z.string().min(1, 'S3_SECRET_KEY is required'),
  S3_BUCKET: z.string().min(1, 'S3_BUCKET is required'),
  PORT: z
    .string()
    .regex(/^\d+$/, 'PORT must be a numeric string')
    .optional()
    .default('3000')
    .transform(v => parseInt(v, 10)),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .optional()
    .default('development'),

  // xgar.com.cn public endpoint
  PUBLIC_BASE_URL: z
    .string()
    .url('PUBLIC_BASE_URL must be a valid URL')
    .optional()
    .default('https://mea.xgar.com.cn'),

  // WeChat Mini Program
  WECHAT_MINI_APPID: z.string().optional().default('wxaf3466a310a8bd07'),
  WECHAT_MINI_SECRET: z.string().optional().default(''),

  // WeChat Service Account (服务号 / 公众号)
  WECHAT_MP_APPID: z.string().optional().default(''),
  WECHAT_MP_SECRET: z.string().optional().default(''),
  WECHAT_MP_TOKEN: z.string().optional().default(''),
  WECHAT_MP_ENCODING_AES_KEY: z.string().optional().default(''),
  WECHAT_MP_REVIEW_TEMPLATE_ID: z.string().optional().default(''),

  // WeCom (企业微信)
  WECOM_CORPID: z.string().optional().default('wwdf0a37a3059d0f1c'),
  WECOM_AGENTID: z.string().optional().default('1000004'),
  WECOM_SECRET: z.string().optional().default(''),
  WECOM_RELAY_URL: z
    .string()
    .url('WECOM_RELAY_URL must be a valid URL')
    .optional()
    .default('https://wecom.xgar.com.cn/send'),
  WECOM_RELAY_TOKEN: z.string().optional().default(''),
});

export type Config = z.infer<typeof ConfigSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a KEY=VALUE env file into a plain object.
 * Lines starting with `#` and blank lines are ignored.
 * `process.env` values always take precedence over file values.
 */
export function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const raw of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Load and validate environment configuration.
 *
 * @param envFilePath  Optional path to an `.env`-style file (e.g. `infra/.env.shared`).
 *                     File values act as defaults; actual `process.env` values win.
 * @throws             If required variables are missing or malformed.
 */
export function loadConfig(envFilePath?: string): Config {
  const fileVars = envFilePath ? parseEnvFile(envFilePath) : {};
  // process.env values override file values
  const merged: Record<string, unknown> = { ...fileVars, ...process.env };

  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Environment configuration is invalid:\n${issues}`);
  }
  return result.data;
}
