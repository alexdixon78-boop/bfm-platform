import { QueryClient, QueryFunction } from "@tanstack/react-query";

export type ApiErrorContext = "preview" | "import" | "detail" | "convert" | "mailAction" | "default";

export type ParsedApiError = {
  statusCode?: number;
  userMessage: string;
  validationFields: string[];
};

const DEFAULT_ERROR_MESSAGES: Record<ApiErrorContext, string> = {
  preview: "Could not preview Gmail messages.",
  import: "Could not import selected emails.",
  detail: "Could not load this email. Please try again.",
  convert: "Could not convert this email to an enquiry.",
  mailAction: "Could not update this email. Please try again.",
  default: "Something went wrong. Please try again.",
};

const SENSITIVE_ERROR_PATTERN = /(token|secret|password|refresh|access[_ -]?token|https?:\/\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseThrownError(value: unknown): { statusCode?: number; rawBody?: string; rawMessage: string } {
  const rawMessage = value instanceof Error ? value.message : String(value ?? "");
  const match = rawMessage.match(/^(\d{3}):\s*([\s\S]*)$/);
  if (!match) return { rawMessage };
  return { statusCode: Number(match[1]), rawBody: match[2], rawMessage };
}

function validationFieldsFrom(errors: unknown): string[] {
  if (!isRecord(errors)) return [];
  return Object.keys(errors).filter(Boolean);
}

function cleanMessage(message: string, fallback: string): string {
  const trimmed = message.trim();
  if (!trimmed || SENSITIVE_ERROR_PATTERN.test(trimmed) || /<[a-z][\s\S]*>/i.test(trimmed)) {
    return fallback;
  }
  return trimmed;
}

export function parseApiError(error: unknown, context: ApiErrorContext = "default"): ParsedApiError {
  const fallback = DEFAULT_ERROR_MESSAGES[context] ?? DEFAULT_ERROR_MESSAGES.default;
  const parsedThrown = parseThrownError(error);
  const rawBody = parsedThrown.rawBody;

  if (!rawBody) {
    return {
      statusCode: parsedThrown.statusCode,
      userMessage: cleanMessage(parsedThrown.rawMessage, fallback),
      validationFields: [],
    };
  }

  try {
    const body = JSON.parse(rawBody) as unknown;
    if (!isRecord(body)) {
      return { statusCode: parsedThrown.statusCode, userMessage: fallback, validationFields: [] };
    }
    const validationFields = validationFieldsFrom(body.errors);
    const message = typeof body.message === "string" ? cleanMessage(body.message, fallback) : fallback;
    return {
      statusCode: parsedThrown.statusCode,
      userMessage: validationFields.length > 0 ? `${message}: ${validationFields.join(", ")}` : message,
      validationFields,
    };
  } catch {
    return { statusCode: parsedThrown.statusCode, userMessage: fallback, validationFields: [] };
  }
}

export function getApiErrorMessage(error: unknown, context: ApiErrorContext = "default"): string {
  const parsed = parseApiError(error, context);
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const rawLower = raw.toLowerCase();
  const lower = parsed.userMessage.toLowerCase();

  if (lower.includes("bfm google account is not connected") || rawLower.includes("bfm google account is not connected")) {
    return "Connect the BFM Google account before previewing mail.";
  }
  if (lower.includes("gmail.readonly") || lower.includes("must be reconnected") || rawLower.includes("gmail.readonly") || rawLower.includes("must be reconnected")) {
    return "Reconnect the BFM Google account to grant Gmail access.";
  }
  if (/(invalid_grant|unauthorized_client|access_denied|insufficient permission|permission denied|expired)/i.test(parsed.userMessage)
    || /(invalid_grant|unauthorized_client|access_denied|insufficient permission|permission denied|expired)/i.test(raw)) {
    return "Gmail access has expired. Reconnect the BFM Google account.";
  }
  if (parsed.validationFields.includes("senderEmail")) {
    return "Enter a valid sender email address.";
  }
  if (parsed.validationFields.includes("searchQuery")) {
    return "Enter a name, email, or search term.";
  }
  if (context === "import" && lower.includes("select at least one")) {
    return "Select at least one email to import.";
  }

  return parsed.userMessage;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
  // Guard: if a 2xx response has HTML content-type it means the Vite SPA
  // catch-all fired instead of the API handler. Treat this as an error so
  // queries surface a proper failure rather than a JSON parse exception.
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/html")) {
    throw new Error(`Expected JSON but received HTML — the API route may be missing or failed silently`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
    cache: "no-store",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      cache: "no-store",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

export async function refreshClientDashboardActions() {
  const queries = [
    { queryKey: ["/api/dashboard/client"] },
    { queryKey: ["/api/client/cases/missing-demographics"] },
  ];

  await Promise.all(queries.map((query) => queryClient.invalidateQueries(query)));
  await Promise.all(queries.map((query) => queryClient.refetchQueries(query)));
}
