/**
 * PostgreSQL client & SQL migration runner for MusicExamAid (`ubtxiaomi.ts.xgar.com.cn:55432`).
 */

import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { loadConfig } from '@musicexamaid/shared';

let sharedPool: Pool | null = null;

export function getPostgresPool(connectionString?: string): Pool {
  if (!sharedPool) {
    const envPath = path.resolve(__dirname, '../../../../infra/.env.shared');
    const url =
      connectionString ||
      process.env.POSTGRES_URL ||
      loadConfig(envPath).POSTGRES_URL;
    sharedPool = new Pool({
      connectionString: url,
      connectionTimeoutMillis: 3000,
      max: 10,
    });
  }
  return sharedPool;
}

export const getPool = getPostgresPool;

export async function closePool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = null;
  }
}

export async function runSqlMigrations(
  pool: Pool = getPostgresPool(),
  migrationsDir = path.resolve(__dirname, '../../../../infra/migrations'),
): Promise<string[]> {
  const files = fs
    .readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const applied: string[] = [];
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const { rows: existingRows } = await client.query<{ filename: string }>(
      `SELECT filename FROM schema_migrations`,
    );
    const alreadyApplied = new Set(existingRows.map(r => r.filename));

    for (const file of files) {
      if (alreadyApplied.has(file)) {
        continue;
      }
      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, 'utf8');
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING`,
        [file],
      );
      applied.push(file);
    }
  } finally {
    client.release();
  }
  return applied;
}

if (require.main === module) {
  runSqlMigrations()
    .then(applied => {
      console.log('[migrate] Applied migrations:', applied.join(', '));
      return sharedPool?.end();
    })
    .catch(err => {
      console.error('[migrate] Failed to apply migrations:', err.message);
      process.exit(1);
    });
}
