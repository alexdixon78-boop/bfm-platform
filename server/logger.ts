type LogLevel = "debug" | "info" | "warn" | "error";

type RequestLogInput = {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  responseBody?: unknown;
};

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEY_PATTERN =
  /(email|phone|mobile|telephone|address|postcode|token|secret|password|code|url|link)/i;

function currentLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  if (
    configured === "debug" ||
    configured === "info" ||
    configured === "warn" ||
    configured === "error"
  ) {
    return configured;
  }
  return "info";
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[currentLevel()];
}

function shouldLogResponseBodies(): boolean {
  return (
    process.env.LOG_RESPONSE_BODIES === "true" ||
    process.env.LOG_LEVEL?.toLowerCase() === "debug"
  );
}

function formatTime(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function shortId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, 8)
    : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeSummaryText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .slice(0, 160);
}

function stringifyMeta(meta: unknown): string {
  if (meta === undefined) return "";
  if (meta instanceof Error) return ` ${meta.message}`;
  if (typeof meta === "string") return ` ${meta}`;
  try {
    return ` ${JSON.stringify(redactLogMeta(meta))}`;
  } catch {
    return " [unserializable meta]";
  }
}

export function redactLogMeta(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactLogMeta(item));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => {
      if (key === "id") return [key, shortId(nested) ?? nested];
      if (SENSITIVE_KEY_PATTERN.test(key)) return [key, "[redacted]"];
      return [key, redactLogMeta(nested)];
    }),
  );
}

export function summarizeResponseBody(body: unknown): string | undefined {
  if (body === undefined) return undefined;

  if (Array.isArray(body)) {
    return `result=array count=${body.length}`;
  }

  if (!isPlainObject(body)) {
    return `result=${body}`;
  }

  const parts = ["result=object"];
  const id = shortId(body.id);
  if (id) parts.push(`user=${id}`);
  if (typeof body.message === "string")
    parts.push(`message="${sanitizeSummaryText(body.message)}"`);
  if (typeof body.role === "string") parts.push(`role=${body.role}`);
  if (typeof body.status === "string") parts.push(`status=${body.status}`);

  if (isPlainObject(body.errors)) {
    parts.push(`errors=${Object.keys(body.errors).join(",")}`);
  }

  for (const key of ["items", "data", "messages"]) {
    const value = body[key];
    if (Array.isArray(value)) parts.push(`${key}=${value.length}`);
  }

  const processed = body.processed;
  if (Array.isArray(processed)) parts.push(`processed=${processed.length}`);

  const summary = body.summary;
  if (isPlainObject(summary)) {
    const received = summary.receivedMessageCount;
    const duplicates = summary.duplicateCount;
    const statuses = summary.statusUpdateCount;
    if (typeof received === "number") parts.push(`received=${received}`);
    if (typeof duplicates === "number") parts.push(`duplicates=${duplicates}`);
    if (typeof statuses === "number") parts.push(`statuses=${statuses}`);
  }

  for (const key of ["total", "page", "pageSize", "limit", "totalPages"]) {
    const value = body[key];
    if (typeof value === "number" || typeof value === "string") {
      parts.push(`${key}=${value}`);
    }
  }

  return parts.length > 1 ? parts.join(" ") : "result=object";
}

export function isConfidentialResponsePath(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return lowerPath.startsWith("/api/complaints")
    || lowerPath.startsWith("/api/complaint-attachments")
    || /^\/api\/cases\/[^/]+\/complaints(?:\/|$)/.test(lowerPath)
    || /^\/api\/cases\/[^/]+\/private-notes(?:\/|$)/.test(lowerPath);
}

export function formatRequestLogLine(input: RequestLogInput): string {
  let line = `${input.method} ${input.path} ${input.statusCode} ${input.durationMs}ms`;
  if (shouldLogResponseBodies() && input.responseBody !== undefined) {
    line += ` body=${JSON.stringify(redactLogMeta(input.responseBody))}`;
    return line;
  }

  const summary = summarizeResponseBody(input.responseBody);
  if (summary) line += ` ${summary}`;
  return line;
}

function write(
  level: LogLevel,
  source: string,
  message: string,
  meta?: unknown,
) {
  if (!shouldLog(level)) return;
  const line = `${formatTime()} [${source}] ${message}${stringifyMeta(meta)}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug(message: string, meta?: unknown, source = "express") {
    write("debug", source, message, meta);
  },
  info(message: string, meta?: unknown, source = "express") {
    write("info", source, message, meta);
  },
  warn(message: string, meta?: unknown, source = "express") {
    write("warn", source, message, meta);
  },
  error(message: string, meta?: unknown, source = "express") {
    write("error", source, message, meta);
  },
};
