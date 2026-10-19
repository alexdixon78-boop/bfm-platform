export const CALENDLY_CONSULTATION_ENDPOINT_PATH =
  "/api/public/integrations/calendly-consultations";

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export type CalendlySubscriptionConfigStatus = {
  calendlyPatConfigured: boolean;
  calendlyWebhookSigningKeyConfigured: boolean;
  calendlyOrganizationUriConfigured: boolean;
};

export type SafeCalendlySubscription = {
  uri: string | null;
  callbackUrl: string | null;
  state: string | null;
  events: string[];
  scope: string | null;
  organization: string | null;
};

export type CalendlySubscriptionUpdateResult = {
  deletedCount: number;
  preflight: CalendlyCallbackPreflightResult;
  subscription: SafeCalendlySubscription;
};

export type CalendlyCallbackPreflightResult = {
  ok: true;
  status: number;
  reason: string;
};

export class CalendlyApiError extends Error {
  status: number;
  safeMessage: string;

  constructor(status: number, safeMessage: string) {
    super(safeMessage);
    this.name = "CalendlyApiError";
    this.status = status;
    this.safeMessage = safeMessage;
  }
}

export function getCalendlySubscriptionConfigStatus(
  env: NodeJS.ProcessEnv = process.env,
): CalendlySubscriptionConfigStatus {
  return {
    calendlyPatConfigured: Boolean(env.CALENDLY_PAT),
    calendlyWebhookSigningKeyConfigured: Boolean(env.CALENDLY_WEBHOOK_SIGNING_KEY),
    calendlyOrganizationUriConfigured: Boolean(env.CALENDLY_ORGANIZATION_URI),
  };
}

export function validateCalendlyCallbackUrl(
  value: string,
): { ok: true } | { ok: false; message: string } {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, message: "Calendly callback URL must be a valid URL" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, message: "Calendly callback URL must use HTTPS" };
  }
  if (!parsed.pathname.endsWith(CALENDLY_CONSULTATION_ENDPOINT_PATH)) {
    return {
      ok: false,
      message: `Calendly callback URL must end with ${CALENDLY_CONSULTATION_ENDPOINT_PATH}`,
    };
  }
  return { ok: true };
}

function answerToString(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function parseJsonObject(text: string): Record<string, unknown> {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object"
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function sanitizeHtmlReason(text: string, fallback: string): string {
  const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/\s+/g, " ")
    .trim();
  const raw = title || fallback || "HTML error response";
  const lastSegment = raw.split("|").pop()?.trim() || raw;
  return lastSegment.replace(/^\d+\s*:\s*/i, "").trim() || "HTML error response";
}

async function parseCalendlyResponse(response: Response): Promise<{
  body: Record<string, unknown>;
  safeErrorReason: string;
}> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/html") || /<html|<!DOCTYPE/i.test(text)) {
    return {
      body: {},
      safeErrorReason: sanitizeHtmlReason(text, response.statusText),
    };
  }
  const body = parseJsonObject(text);
  return {
    body,
    safeErrorReason:
      answerToString(body.message) ||
      answerToString(body.title) ||
      response.statusText ||
      "Calendly API request failed",
  };
}

async function calendlyRequest(
  fetchImpl: FetchImpl,
  token: string,
  url: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const { body, safeErrorReason } = await parseCalendlyResponse(response);
  if (!response.ok) {
    throw new CalendlyApiError(
      response.status,
      safeErrorReason,
    );
  }
  return body;
}

export async function preflightCalendlyCallbackUrl(
  callbackUrl: string,
  fetchImpl: FetchImpl = fetch,
): Promise<CalendlyCallbackPreflightResult> {
  let response: Response;
  try {
    response = await fetchImpl(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "invitee.created",
        payload: {},
        preflight: true,
      }),
    });
  } catch (error) {
    throw new CalendlyApiError(
      502,
      `Callback URL is not reachable by the server: ${error instanceof Error ? error.message : "network error"}`,
    );
  }

  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? parseJsonObject(text) : {};
  const message = answerToString(body.message);
  if (
    response.status === 401 &&
    contentType.includes("application/json") &&
    message === "Invalid Calendly webhook signature"
  ) {
    return {
      ok: true,
      status: response.status,
      reason: "Webhook endpoint reached",
    };
  }

  const reason = contentType.includes("text/html") || /<html|<!DOCTYPE/i.test(text)
    ? sanitizeHtmlReason(text, response.statusText)
    : message || response.statusText || `HTTP ${response.status}`;
  throw new CalendlyApiError(
    response.status || 502,
    `Callback URL is not reachable by the server: ${reason}`,
  );
}

function toSafeSubscription(resource: Record<string, unknown>): SafeCalendlySubscription {
  return {
    uri: answerToString(resource.uri) || null,
    callbackUrl: answerToString(resource.callback_url || resource.callbackUrl) || null,
    state: answerToString(resource.state) || null,
    events: Array.isArray(resource.events)
      ? resource.events.map(answerToString).filter(Boolean)
      : [],
    scope: answerToString(resource.scope) || null,
    organization: answerToString(resource.organization) || null,
  };
}

function isConsultationSubscription(resource: Record<string, unknown>): boolean {
  const callbackUrl = answerToString(resource.callback_url || resource.callbackUrl);
  if (!callbackUrl) return false;
  try {
    return new URL(callbackUrl).pathname.endsWith(CALENDLY_CONSULTATION_ENDPOINT_PATH);
  } catch {
    return callbackUrl.includes(CALENDLY_CONSULTATION_ENDPOINT_PATH);
  }
}

export async function createCalendlyWebhookSubscription(options: {
  callbackUrl: string;
  token: string;
  signingKey: string;
  organizationUri: string;
  fetchImpl?: FetchImpl;
}): Promise<CalendlySubscriptionUpdateResult> {
  const fetchImpl = options.fetchImpl || fetch;
  const preflight = await preflightCalendlyCallbackUrl(options.callbackUrl, fetchImpl);
  const query = new URLSearchParams({
    scope: "organization",
    organization: options.organizationUri,
  });
  const listed = await calendlyRequest(
    fetchImpl,
    options.token,
    `https://api.calendly.com/webhook_subscriptions?${query}`,
  );
  const collection = Array.isArray(listed.collection) ? listed.collection : [];
  const existingConsultationSubscriptions = collection.filter((item): item is Record<string, unknown> =>
    Boolean(item && typeof item === "object" && isConsultationSubscription(item as Record<string, unknown>)),
  );
  const exactActive = existingConsultationSubscriptions.find((item) =>
    answerToString(item.callback_url || item.callbackUrl) === options.callbackUrl &&
    answerToString(item.state || "active") === "active",
  );

  if (exactActive) {
    return {
      deletedCount: 0,
      preflight,
      subscription: toSafeSubscription(exactActive),
    };
  }

  const created = await calendlyRequest(
    fetchImpl,
    options.token,
    "https://api.calendly.com/webhook_subscriptions",
    {
      method: "POST",
      body: JSON.stringify({
        url: options.callbackUrl,
        events: ["invitee.created"],
        organization: options.organizationUri,
        scope: "organization",
        signing_key: options.signingKey,
      }),
    },
  );
  const resource = created.resource && typeof created.resource === "object"
    ? created.resource as Record<string, unknown>
    : created;
  const createdUri = answerToString(resource.uri);
  const stale = existingConsultationSubscriptions.filter((item) =>
    answerToString(item.uri) !== createdUri,
  );

  for (const item of stale) {
    const uri = answerToString(item.uri);
    if (uri) {
      await calendlyRequest(fetchImpl, options.token, uri, { method: "DELETE" });
    }
  }

  return {
    deletedCount: stale.length,
    preflight,
    subscription: toSafeSubscription(resource),
  };
}
