import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Pool } from 'pg';
import { runSqlMigrations } from '../store/postgres';

it('rolls schema and ledger back together on failure and skips committed migrations on rerun', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mea-migrations-test-'));
  fs.writeFileSync(path.join(dir, '001_probe.sql'), '-- test wrapper\nBEGIN;\nSELECT 123;\nCOMMIT;\n');
  let failLedger = true;
  let pending = false;
  let committed = false;
  let released = false;
  const applied = new Set<string>();
  const calls: string[] = [];
  const client = {query: async (sql: string, args?: string[]) => {
    calls.push(sql);
    if (sql.includes('SELECT filename')) return {rows: [...applied].map(filename => ({filename}))};
    if (sql === 'BEGIN') { pending = true; return {rows: []}; }
    if (sql.includes('SELECT 123')) {
      assert.equal(pending, true);
      assert.doesNotMatch(sql, /^\s*(BEGIN|COMMIT)\s*;/im);
    }
    if (sql.includes('INSERT INTO schema_migrations')) {
      assert.equal(pending, true);
      if (failLedger) throw new Error('simulated ledger failure');
      applied.add(args![0]);
    }
    if (sql === 'ROLLBACK') pending = false;
    if (sql === 'COMMIT') { pending = false; committed = true; }
    return {rows: []};
  }, release: () => { released = true; }};
  const pool = {connect: async () => client} as unknown as Pool;
  try {
    await assert.rejects(runSqlMigrations(pool, dir), /simulated ledger failure/);
    assert.equal(committed, false);
    assert.ok(calls.includes('ROLLBACK'));
    assert.equal(released, true);
    assert.equal(applied.size, 0);
    failLedger = false;
    assert.deepEqual(await runSqlMigrations(pool, dir), ['001_probe.sql']);
    assert.equal(committed, true);
    assert.deepEqual(await runSqlMigrations(pool, dir), []);
    assert.ok(calls[0].includes('pg_advisory_lock'));
    assert.ok(calls.at(-1)!.includes('pg_advisory_unlock'));
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
