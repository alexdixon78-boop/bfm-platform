import { test } from "node:test";
import assert from "node:assert/strict";
import { types } from "pg";
import {
  getPostgresPoolConfig,
  sanitizePostgresPoolError,
  shouldUsePostgresSsl,
} from "../server/config/postgres";

test("postgres timestamps without time zones are parsed as UTC regardless of the host timezone", () => {
  const previousTimeZone = process.env.TZ;
  try {
    process.env.TZ = "Asia/Calcutta";
    const parsed = types
      .getTypeParser(types.builtins.TIMESTAMP)
      ("2026-10-14 09:00:00");

    assert.ok(parsed instanceof Date);
    assert.equal(parsed.toISOString(), "2026-10-14T09:00:00.000Z");
  } finally {
    if (previousTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previousTimeZone;
    }
  }
});

test("postgres config enables remote SSL and pool timeout hardening", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  try {
    process.env.DATABASE_URL =
      "postgres://postgres:secret@dev-bfm-db.example.com:5432/postgres";

    const config = getPostgresPoolConfig();

    assert.equal(config.connectionString, process.env.DATABASE_URL);
    assert.deepEqual(config.ssl, { rejectUnauthorized: false });
    assert.equal(config.connectionTimeoutMillis, 10_000);
    assert.equal(config.idleTimeoutMillis, 30_000);
    assert.equal(config.keepAlive, true);
  } finally {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
});

test("postgres ssl stays disabled for local database urls", () => {
  assert.equal(
    shouldUsePostgresSsl("postgres://user:pass@localhost:5432/app"),
    false,
  );
  assert.equal(
    shouldUsePostgresSsl("postgres://user:pass@127.0.0.1:5432/app"),
    false,
  );
});

test("postgres pool config requires an explicit DATABASE_URL", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  try {
    delete process.env.DATABASE_URL;
    assert.throws(
      () => getPostgresPoolConfig(),
      /DATABASE_URL is required before opening a PostgreSQL connection/,
    );
  } finally {
    if (previousDatabaseUrl !== undefined) {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
});

test("postgres pool error logging redacts sensitive details", () => {
  const result = sanitizePostgresPoolError(
    new Error(
      "read ETIMEDOUT for admin@example.com with token abcdefghijklmnopqrstuvwxyz",
    ),
  );

  assert.match(result, /read ETIMEDOUT/);
  assert.doesNotMatch(result, /admin@example.com/);
  assert.doesNotMatch(result, /abcdefghijklmnopqrstuvwxyz/);
  assert.ok(result.length <= 180);
});
