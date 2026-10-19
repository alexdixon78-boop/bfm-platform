type Queryable = {
  query(sql: string): Promise<unknown>;
};

type DatabaseHealth =
  | { ok: true }
  | {
      ok: false;
      reason: string;
    };

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const LONG_SECRET_PATTERN = /\b[A-Za-z0-9_-]{20,}\b/g;

function sanitizeReason(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  const redacted = raw
    .replace(EMAIL_PATTERN, "[redacted]")
    .replace(LONG_SECRET_PATTERN, "[redacted]");
  return redacted.length > 140 ? `${redacted.slice(0, 137)}...` : redacted;
}

export async function checkDatabaseHealth(
  queryable: Queryable,
): Promise<DatabaseHealth> {
  try {
    await queryable.query("select 1");
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: sanitizeReason(err) };
  }
}
