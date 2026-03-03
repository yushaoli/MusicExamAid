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
