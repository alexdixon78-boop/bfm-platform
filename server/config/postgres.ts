import { types, type PoolConfig } from "pg";

types.setTypeParser(types.builtins.TIMESTAMP, (value) => {
  if (value === "infinity") return Number.POSITIVE_INFINITY;
  if (value === "-infinity") return Number.NEGATIVE_INFINITY;
  return new Date(`${value.replace(" ", "T")}Z`);
});

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const LONG_SECRET_PATTERN = /\b[A-Za-z0-9_-]{20,}\b/g;

function isLocalDatabaseUrl(databaseUrl: string) {
  try {
    const host = new URL(databaseUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

export function shouldUsePostgresSsl(databaseUrl = process.env.DATABASE_URL) {
  const sslMode = process.env.PGSSLMODE?.toLowerCase();
  const databaseSsl = process.env.DATABASE_SSL?.toLowerCase();

  if (databaseSsl === "false" || sslMode === "disable") return false;
  if (databaseSsl === "true" || sslMode === "require") return true;
  if (!databaseUrl) return false;

  return !isLocalDatabaseUrl(databaseUrl);
}

export function getPostgresPoolConfig(): PoolConfig {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required before opening a PostgreSQL connection");
  }
  return {
    connectionString: process.env.DATABASE_URL,
    ssl: shouldUsePostgresSsl() ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
  };
}

export function sanitizePostgresPoolError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  const redacted = raw
    .replace(EMAIL_PATTERN, "[redacted]")
    .replace(LONG_SECRET_PATTERN, "[redacted]");
  return redacted.length > 180 ? `${redacted.slice(0, 177)}...` : redacted;
}

export function getDrizzleKitPostgresCredentials() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !shouldUsePostgresSsl(databaseUrl)) {
    return { url: databaseUrl ?? "" };
  }

  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    ssl: "require" as const,
  };
}
