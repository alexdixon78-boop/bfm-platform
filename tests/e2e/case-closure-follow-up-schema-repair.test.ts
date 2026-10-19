/**
 * PostgreSQL integration coverage for the case-closure follow-up schema repair.
 *
 * The test runs the real migration in isolated temporary schemas. It never
 * changes application tables in the public schema.
 *
 * Run with:
 *   npx tsx tests/e2e/case-closure-follow-up-schema-repair.test.ts
 */
import "dotenv/config";

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { Client } from "pg";

import { getPostgresPoolConfig } from "../../server/config/postgres";
import { loadRuntimeEnv } from "../../server/config/runtime-env";

const migrationUrl = new URL(
  "../../migrations/0039_case_closure_party_follow_up_schema_repair.sql",
  import.meta.url,
);

const expectedColumns = new Map<string, string>([
  ["follow_up_consent_token_hash", "text"],
  ["follow_up_consent_token_expires_at", "timestamp without time zone"],
  ["follow_up_consent_request_sent_at", "timestamp without time zone"],
  ["follow_up_consent_email_status", "text"],
  ["follow_up_consent_email_last_error", "text"],
  ["follow_up_consent_decided_at", "timestamp without time zone"],
  ["follow_up_consent_decision_source", "text"],
]);

function schemaName(label: string) {
  return `test_follow_up_repair_${process.pid}_${Date.now()}_${label}`;
}

let client: Client;

test.before(async () => {
  await loadRuntimeEnv();
  client = new Client(getPostgresPoolConfig());
  await client.connect();
});

test.after(async () => {
  await client?.end();
});

async function createLegacyTable(client: Client, schema: string) {
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  await client.query(`
    CREATE TABLE case_closure_party_follow_ups (
      id varchar PRIMARY KEY,
      closure_record_id varchar NOT NULL,
      case_id varchar NOT NULL,
      party_id varchar NOT NULL,
      client_id varchar NOT NULL,
      consent_status text NOT NULL,
      consent_source text NOT NULL DEFAULT 'closure_admin',
      exclusion_reason text,
      consent_recorded_at timestamp NOT NULL DEFAULT now(),
      consent_recorded_by varchar,
      follow_up_tasks_scheduled integer NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      UNIQUE (closure_record_id, party_id)
    )
  `);
}

test("0039 repairs the observed legacy table without changing existing consent data", { concurrency: false }, async () => {
  assert.ok(existsSync(migrationUrl), "0039 schema-repair migration must exist");
  const migrationSql = readFileSync(migrationUrl, "utf8");
  const schema = schemaName("happy");

  try {
    await createLegacyTable(client, schema);
    await client.query(`
      INSERT INTO case_closure_party_follow_ups (
        id, closure_record_id, case_id, party_id, client_id,
        consent_status, consent_source, follow_up_tasks_scheduled
      ) VALUES (
        'follow-up-1', 'closure-1', 'case-1', 'party-1', 'client-1',
        'granted', 'closure_admin', 3
      )
    `);

    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(migrationSql);
    await client.query("COMMIT");

    const columns = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: "YES" | "NO";
      column_default: string | null;
    }>(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = 'case_closure_party_follow_ups'
    `, [schema]);
    const columnsByName = new Map(columns.rows.map((column) => [column.column_name, column]));

    for (const [columnName, dataType] of expectedColumns) {
      assert.equal(columnsByName.get(columnName)?.data_type, dataType, `${columnName} should use ${dataType}`);
    }
    assert.equal(columnsByName.get("closure_record_id")?.is_nullable, "YES");
    assert.equal(columnsByName.get("follow_up_consent_email_status")?.is_nullable, "NO");
    assert.match(
      columnsByName.get("follow_up_consent_email_status")?.column_default ?? "",
      /not_attempted/,
    );

    const existing = await client.query<{
      consent_status: string;
      consent_source: string;
      follow_up_tasks_scheduled: number;
      follow_up_consent_email_status: string;
    }>(`
      SELECT consent_status, consent_source, follow_up_tasks_scheduled,
             follow_up_consent_email_status
      FROM "${schema}".case_closure_party_follow_ups
      WHERE id = 'follow-up-1'
    `);
    assert.deepEqual(existing.rows, [{
      consent_status: "granted",
      consent_source: "closure_admin",
      follow_up_tasks_scheduled: 3,
      follow_up_consent_email_status: "not_attempted",
    }]);

    const indexes = await client.query<{ indexname: string; indexdef: string }>(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = $1
        AND tablename = 'case_closure_party_follow_ups'
    `, [schema]);
    const indexesByName = new Map(indexes.rows.map((index) => [index.indexname, index.indexdef]));
    assert.match(
      indexesByName.get("case_closure_party_follow_ups_case_party_unique") ?? "",
      /CREATE UNIQUE INDEX.*\(case_id, party_id\)/i,
    );
    assert.match(
      indexesByName.get("case_closure_party_follow_ups_token_hash_unique") ?? "",
      /CREATE UNIQUE INDEX.*\(follow_up_consent_token_hash\).*WHERE.*IS NOT NULL/i,
    );

    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(migrationSql);
    await client.query("COMMIT");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
});

test("0039 aborts transactionally when legacy case-party duplicates need manual resolution", { concurrency: false }, async () => {
  assert.ok(existsSync(migrationUrl), "0039 schema-repair migration must exist");
  const migrationSql = readFileSync(migrationUrl, "utf8");
  const schema = schemaName("duplicates");

  try {
    await createLegacyTable(client, schema);
    await client.query(`
      INSERT INTO case_closure_party_follow_ups (
        id, closure_record_id, case_id, party_id, client_id, consent_status
      ) VALUES
        ('follow-up-1', 'closure-1', 'case-1', 'party-1', 'client-1', 'granted'),
        ('follow-up-2', 'closure-2', 'case-1', 'party-1', 'client-1', 'declined')
    `);

    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await assert.rejects(
      client.query(migrationSql),
      /duplicate \(case_id, party_id\).*manual resolution/i,
    );
    await client.query("ROLLBACK");

    const postRollback = await client.query<{
      closure_record_nullable: "YES" | "NO";
      token_column_count: string;
      row_count: string;
    }>(`
      SELECT
        (SELECT is_nullable
           FROM information_schema.columns
          WHERE table_schema = $1
            AND table_name = 'case_closure_party_follow_ups'
            AND column_name = 'closure_record_id') AS closure_record_nullable,
        (SELECT count(*)::text
           FROM information_schema.columns
          WHERE table_schema = $1
            AND table_name = 'case_closure_party_follow_ups'
            AND column_name = 'follow_up_consent_token_hash') AS token_column_count,
        (SELECT count(*)::text
           FROM "${schema}".case_closure_party_follow_ups) AS row_count
    `, [schema]);
    assert.deepEqual(postRollback.rows, [{
      closure_record_nullable: "NO",
      token_column_count: "0",
      row_count: "2",
    }]);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
});

test("0039 aborts transactionally when non-null consent token hashes are duplicated", { concurrency: false }, async () => {
  assert.ok(existsSync(migrationUrl), "0039 schema-repair migration must exist");
  const migrationSql = readFileSync(migrationUrl, "utf8");
  const schema = schemaName("token_duplicates");

  try {
    await createLegacyTable(client, schema);
    await client.query(`
      ALTER TABLE case_closure_party_follow_ups
      ADD COLUMN follow_up_consent_token_hash text
    `);
    await client.query(`
      INSERT INTO case_closure_party_follow_ups (
        id, closure_record_id, case_id, party_id, client_id, consent_status,
        follow_up_consent_token_hash
      ) VALUES
        ('follow-up-1', 'closure-1', 'case-1', 'party-1', 'client-1', 'pending', 'same-hash'),
        ('follow-up-2', 'closure-2', 'case-2', 'party-2', 'client-2', 'pending', 'same-hash')
    `);

    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await assert.rejects(
      client.query(migrationSql),
      /duplicate non-null follow_up_consent_token_hash.*manual resolution/i,
    );
    await client.query("ROLLBACK");

    const postRollback = await client.query<{
      closure_record_nullable: "YES" | "NO";
      email_status_column_count: string;
      row_count: string;
    }>(`
      SELECT
        (SELECT is_nullable
           FROM information_schema.columns
          WHERE table_schema = $1
            AND table_name = 'case_closure_party_follow_ups'
            AND column_name = 'closure_record_id') AS closure_record_nullable,
        (SELECT count(*)::text
           FROM information_schema.columns
          WHERE table_schema = $1
            AND table_name = 'case_closure_party_follow_ups'
            AND column_name = 'follow_up_consent_email_status') AS email_status_column_count,
        (SELECT count(*)::text
           FROM "${schema}".case_closure_party_follow_ups) AS row_count
    `, [schema]);
    assert.deepEqual(postRollback.rows, [{
      closure_record_nullable: "NO",
      email_status_column_count: "0",
      row_count: "2",
    }]);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
});
