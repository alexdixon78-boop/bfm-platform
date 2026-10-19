import { Router } from "express";
import crypto from "crypto";
import { requireAuth } from "../middleware/auth";
import { googleCalendarService, hasWriteScope, hasGmailReadonlyScope, BFM_EMAIL } from "../services/google-calendar.service";
import { outlookCalendarService, hasOutlookWriteScope } from "../services/outlook-calendar.service";
import { storage } from "../storage";
import { db } from "../db";
import { logAudit } from "../services/audit-log.service";
import { logger } from "../logger";
import { z } from "zod";
import { appointments, calendarWebhookSubscriptions, isMediationRoleQualifiedFor, mediatorCalendarAvailabilitySources, mediatorServiceApprovals, mediatorServiceScheduleSlots, mediatorServiceTypes, serviceTypes } from "@shared/schema";
import type { User } from "@shared/schema";
import { and, eq, gte, inArray, lte, ne, or } from "drizzle-orm";
import { deriveCalendarWebhookToken, secureTokenMatches } from "../services/calendar-availability-webhook";
import { completeCalendarAvailabilityReconciliationJob, enqueueCalendarAvailabilityReconciliation } from "../services/calendar-availability-job.service";
import { buildAvailabilityFingerprint } from "../services/calendar-availability-reconciliation";
import { getMediatorCalendarProviderService, isCalendarProvider } from "../services/mediator-calendar-provider.service";
import { toUkWallClockDateTime } from "../utils/uk-wall-clock";
import {
  buildCalendarOAuthRedirectUrl,
  parseCalendarOAuthReturnTarget,
  type CalendarOAuthErrorCode,
  type CalendarOAuthProvider,
  type CalendarOAuthReturnTarget,
} from "../services/calendar-oauth-flow";
import { ensureCalendarAvailabilitySubscription } from "../services/calendar-webhook-subscription.service";
import { buildCalendarAvailabilityProjectionDiagnostic, getMediatorBookingEligibilityReasons } from "../services/calendar-availability-diagnostics";
import { getEffectiveApprovalStatus } from "../services/mediator-service-approval.service";
import { mediatorProfileRepository } from "../repositories/mediator-profile.repository";

const healthAlertsToggleSchema = z.object({ enabled: z.boolean() });
const activeCalendarProviderSchema = z.object({ provider: z.enum(["google", "outlook"]) });
const groupedAvailabilityPatchSchema = z.union([
  z.object({ startAt: z.coerce.date(), endAt: z.coerce.date() }),
  z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
  }).transform((value) => ({
    startAt: toUkWallClockDateTime(value.date, value.startTime),
    endAt: toUkWallClockDateTime(value.date, value.endTime),
  })),
]).refine((value) => value.endAt > value.startAt, { message: "End time must be after start time" });

const router = Router();

router.post("/api/public/calendar/webhooks/google", async (req, res) => {
  const channelId = req.header("x-goog-channel-id")?.trim();
  const resourceId = req.header("x-goog-resource-id")?.trim();
  const suppliedToken = req.header("x-goog-channel-token")?.trim();
  const secret = process.env.CALENDAR_WEBHOOK_SECRET?.trim();
  if (!channelId || !resourceId || !suppliedToken || !secret) return res.sendStatus(401);

  const [subscription] = await db.select().from(calendarWebhookSubscriptions).where(and(
    eq(calendarWebhookSubscriptions.provider, "google"),
    eq(calendarWebhookSubscriptions.channelId, channelId),
    eq(calendarWebhookSubscriptions.status, "active"),
  )).limit(1);
  if (!subscription || subscription.resourceId !== resourceId || (subscription.expiresAt && subscription.expiresAt <= new Date())) return res.sendStatus(401);
  const expected = deriveCalendarWebhookToken(secret, "google", subscription.mediatorId, channelId);
  if (!secureTokenMatches(expected, suppliedToken)) return res.sendStatus(401);

  await db.update(calendarWebhookSubscriptions).set({ lastNotificationAt: new Date(), updatedAt: new Date() })
    .where(eq(calendarWebhookSubscriptions.id, subscription.id));
  await enqueueCalendarAvailabilityReconciliation({
    mediatorId: subscription.mediatorId,
    provider: "google",
    trigger: "webhook",
    dedupeKey: `google:${channelId}:${req.header("x-goog-message-number") ?? Date.now()}`,
  });
  return res.sendStatus(202);
});

router.post("/api/public/calendar/webhooks/outlook", async (req, res) => {
  const validationToken = typeof req.query.validationToken === "string" ? req.query.validationToken : null;
  if (validationToken) return res.type("text/plain").status(200).send(validationToken);
  const secret = process.env.CALENDAR_WEBHOOK_SECRET?.trim();
  if (!secret) return res.sendStatus(401);
  const notifications = Array.isArray(req.body?.value) ? req.body.value : [];
  if (notifications.length === 0) return res.sendStatus(202);

  for (const item of notifications) {
    const subscriptionId = typeof item?.subscriptionId === "string" ? item.subscriptionId : "";
    const suppliedState = typeof item?.clientState === "string" ? item.clientState : "";
    const [subscription] = await db.select().from(calendarWebhookSubscriptions).where(and(
      eq(calendarWebhookSubscriptions.provider, "outlook"),
      eq(calendarWebhookSubscriptions.externalSubscriptionId, subscriptionId),
      eq(calendarWebhookSubscriptions.status, "active"),
    )).limit(1);
    if (!subscription || (subscription.expiresAt && subscription.expiresAt <= new Date())) return res.sendStatus(401);
    const expected = deriveCalendarWebhookToken(secret, "outlook", subscription.mediatorId, subscription.channelId ?? subscriptionId);
    if (!secureTokenMatches(expected, suppliedState)) return res.sendStatus(401);
    await db.update(calendarWebhookSubscriptions).set({ lastNotificationAt: new Date(), updatedAt: new Date() })
      .where(eq(calendarWebhookSubscriptions.id, subscription.id));
    await enqueueCalendarAvailabilityReconciliation({
      mediatorId: subscription.mediatorId,
      provider: "outlook",
      trigger: item?.lifecycleEvent ? "lifecycle" : "webhook",
      dedupeKey: `outlook:${subscriptionId}:${item?.id ?? item?.resourceData?.id ?? Date.now()}`,
      payload: { changeType: item?.changeType ?? null, lifecycleEvent: item?.lifecycleEvent ?? null },
    });
  }
  return res.sendStatus(202);
});

const CONFIGURED_APP_URL = process.env.APP_URL
  ? process.env.APP_URL.replace(/\/$/, "")
  : null;

function getBaseUrl(req: any): string {
  if (CONFIGURED_APP_URL) return CONFIGURED_APP_URL;
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string | undefined) || req.headers.host;
  return `${proto}://${host}`;
}

function getCalendarOAuthReturnRequest(req: any): { requested: boolean; target: CalendarOAuthReturnTarget } {
  const requested = typeof req.query.returnTo === "string";
  return {
    requested,
    target: parseCalendarOAuthReturnTarget(req.query.returnTo) ?? "dashboard",
  };
}

function sendCalendarOAuthStartError(
  req: any,
  res: any,
  provider: CalendarOAuthProvider,
  code: CalendarOAuthErrorCode,
  status: number,
  message: string,
) {
  const returnRequest = getCalendarOAuthReturnRequest(req);
  if (returnRequest.requested) {
    return res.redirect(buildCalendarOAuthRedirectUrl(getBaseUrl(req), returnRequest.target, provider, { error: code }));
  }
  return res.status(status).json({ success: false, message });
}

function calendarOAuthLoginUrl(req: any, provider: CalendarOAuthProvider): string {
  const url = new URL("/login", getBaseUrl(req));
  url.searchParams.set("calendarError", "session_expired");
  url.searchParams.set("calendarProvider", provider);
  return url.toString();
}

function clearMediatorCalendarOAuthSession(req: any, provider: CalendarOAuthProvider): void {
  if (provider === "google") {
    delete req.session.googleOAuthState;
    delete req.session.googleOAuthMediatorId;
    delete req.session.googleOAuthReturnTo;
    return;
  }
  delete req.session.outlookOAuthState;
  delete req.session.outlookOAuthMediatorId;
  delete req.session.outlookOAuthReturnTo;
}

async function loadUser(req: any, res: any): Promise<User | null> {
  const user = await storage.getUser(req.session.userId);
  if (!user) {
    res.status(401).json({ success: false, message: "Not authenticated" });
    return null;
  }
  return user;
}

type CalendarProvider = "google" | "outlook";

function isActiveCalendarReady(user: User): user is User & { activeCalendarProvider: CalendarProvider } {
  return (user.activeCalendarProvider === "google" && !!user.googleCalendarConnected)
    || (user.activeCalendarProvider === "outlook" && !!user.outlookCalendarConnected);
}

function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

async function listServiceScheduleEventCards(target: User, start: Date, end: Date) {
  const rows = await db
    .select({
      id: mediatorServiceScheduleSlots.id,
      mediatorId: mediatorServiceScheduleSlots.mediatorId,
      serviceTypeId: mediatorServiceScheduleSlots.serviceTypeId,
      startAt: mediatorServiceScheduleSlots.startAt,
      endAt: mediatorServiceScheduleSlots.endAt,
      googleEventId: mediatorServiceScheduleSlots.googleEventId,
      calendarProvider: mediatorServiceScheduleSlots.calendarProvider,
      serviceTypeName: serviceTypes.name,
      serviceTypeCategory: serviceTypes.category,
    })
    .from(mediatorServiceScheduleSlots)
    .leftJoin(serviceTypes, eq(serviceTypes.id, mediatorServiceScheduleSlots.serviceTypeId))
    .where(and(
      eq(mediatorServiceScheduleSlots.mediatorId, target.id),
      eq(mediatorServiceScheduleSlots.lifecycle, "active"),
      lte(mediatorServiceScheduleSlots.startAt, end),
      gte(mediatorServiceScheduleSlots.endAt, start),
    ))
    .orderBy(mediatorServiceScheduleSlots.startAt);

  const appointments = await storage.listAppointmentsByMediatorAndDateRange(target.id, start, end);
  const blockers = appointments
    .filter((appt) => appt.status !== "cancelled" && appt.status !== "expired")
    .map((appt) => {
      const apptStart = new Date(appt.dateTime);
      return { startAt: apptStart, endAt: new Date(apptStart.getTime() + appt.duration * 60000) };
    })
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const cards: Array<Record<string, unknown>> = [];
  const externalEventIds = new Set<string>();
  for (const row of rows) {
    if (row.googleEventId) externalEventIds.add(row.googleEventId);
    let pieces = [{
      startAt: new Date(Math.max(row.startAt.getTime(), start.getTime())),
      endAt: new Date(Math.min(row.endAt.getTime(), end.getTime())),
    }];
    for (const blocker of blockers) {
      const nextPieces = [];
      for (const piece of pieces) {
        if (!rangesOverlap(piece.startAt, piece.endAt, blocker.startAt, blocker.endAt)) {
          nextPieces.push(piece);
          continue;
        }
        if (piece.startAt < blocker.startAt) {
          nextPieces.push({ startAt: piece.startAt, endAt: new Date(Math.min(blocker.startAt.getTime(), piece.endAt.getTime())) });
        }
        if (blocker.endAt < piece.endAt) {
          nextPieces.push({ startAt: new Date(Math.max(blocker.endAt.getTime(), piece.startAt.getTime())), endAt: piece.endAt });
        }
      }
      pieces = nextPieces;
    }
    for (let index = 0; index < pieces.length; index++) {
      const piece = pieces[index];
      if (piece.endAt <= piece.startAt) continue;
      cards.push({
        id: `service-slot:${row.id}:${index}`,
        title: row.serviceTypeName ?? "Service availability",
        startAt: piece.startAt,
        endAt: piece.endAt,
        isAllDay: false,
        attendees: [],
        bfmAttendanceStatus: "accepted",
        isOrganiser: true,
        syncedAt: null,
        mediatorId: target.id,
        mediatorName: target.name,
        mediatorEmail: target.email,
        mediatorAvailabilityColor: target.availabilityColor ?? null,
        bfmCalendarEmail: BFM_EMAIL,
        calendarProvider: row.calendarProvider === "outlook" || row.calendarProvider === "google" ? row.calendarProvider : target.activeCalendarProvider,
        sourceKind: "service_schedule",
        serviceTypeId: row.serviceTypeId,
        serviceTypeName: row.serviceTypeName,
        serviceTypeCategory: row.serviceTypeCategory,
        parentGoogleEventId: row.googleEventId,
      });
    }
  }
  return { cards, externalEventIds };
}

function getCachedEventExternalId(event: { googleEventId?: string | null; outlookEventId?: string | null }): string | null {
  return event.googleEventId ?? event.outlookEventId ?? null;
}

async function listMergedMediatorCalendarEvents(target: User, start: Date, end: Date) {
  if (!isActiveCalendarReady(target)) return [];
  const { cards: serviceSlotCards, externalEventIds } = await listServiceScheduleEventCards(target, start, end);
  const cachedEvents = target.activeCalendarProvider === "outlook"
    ? await storage.listOutlookCalendarEventsByDateRange(target.id, start, end)
    : await storage.listGoogleCalendarEventsByDateRange(target.id, start, end);
  const cachedCards = cachedEvents
    .filter((ev) => {
      const externalId = getCachedEventExternalId(ev);
      return !externalId || !externalEventIds.has(externalId);
    })
    .map(ev => ({
      ...ev,
      bfmAttendanceStatus: ev.bfmAttendanceStatus ?? null,
      isOrganiser: !!ev.isOrganiser,
      mediatorId: target.id,
      mediatorName: target.name,
      mediatorEmail: target.email,
      mediatorAvailabilityColor: target.availabilityColor ?? null,
      bfmCalendarEmail: BFM_EMAIL,
      calendarProvider: target.activeCalendarProvider,
      sourceKind: "calendar_cache",
    }));
  return [...serviceSlotCards, ...cachedCards];
}

async function completeMediatorCalendarSetup(mediatorId: string, provider: CalendarOAuthProvider) {
  let delayed = false;
  try {
    if (provider === "google") await googleCalendarService.syncCalendar(mediatorId);
    else await outlookCalendarService.syncCalendar(mediatorId);
  } catch (error) {
    delayed = true;
    logger.error(`[${provider} OAuth] Initial calendar sync delayed`, error);
  }
  try {
    const subscription = await ensureCalendarAvailabilitySubscription(mediatorId, provider);
    if ("skipped" in subscription && subscription.skipped === "configuration") delayed = true;
  } catch (error) {
    delayed = true;
    logger.error(`[${provider} OAuth] Initial webhook subscription delayed`, error);
  }
  return delayed ? "initial_sync_delayed" as const : undefined;
}

router.get("/api/auth/google", async (req, res) => {
  const returnRequest = getCalendarOAuthReturnRequest(req);
  const user = req.session.userId ? await storage.getUser(req.session.userId) : null;
  if (!user) {
    if (returnRequest.requested) return res.redirect(calendarOAuthLoginUrl(req, "google"));
    return res.status(401).json({ success: false, message: "Not authenticated" });
  }
  if (!googleCalendarService.isConfigured()) {
    return sendCalendarOAuthStartError(req, res, "google", "not_configured", 503, "Google Calendar integration is not configured");
  }
  if (user.role !== "mediator") {
    return sendCalendarOAuthStartError(req, res, "google", "mediator_only", 403, "Only mediators can connect Google Calendar");
  }
  if (user.outlookCalendarConnected) {
    return sendCalendarOAuthStartError(req, res, "google", "disconnect_existing_provider", 409, "This mediator already has Microsoft Outlook connected. Disconnect it before connecting Google Calendar.");
  }

  const state = crypto.randomBytes(16).toString("hex");
  req.session.googleOAuthState = state;
  req.session.googleOAuthMediatorId = user.id;
  req.session.googleOAuthReturnTo = returnRequest.target;
  try {
    return res.redirect(googleCalendarService.getOAuthUrl(state));
  } catch (error) {
    clearMediatorCalendarOAuthSession(req, "google");
    logger.error("[Google OAuth] Could not start authorization", error);
    return sendCalendarOAuthStartError(req, res, "google", "start_failed", 500, "Could not start Google Calendar authorization");
  }
});

router.get("/api/auth/callback/google", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;

  const baseUrl = getBaseUrl(req);
  const returnTo = req.session.googleOAuthReturnTo ?? "dashboard";
  const redirect = (result: Parameters<typeof buildCalendarOAuthRedirectUrl>[3]) =>
    res.redirect(buildCalendarOAuthRedirectUrl(baseUrl, returnTo, "google", result));

  logger.info("[Google OAuth] Callback received", {
    baseUrl,
    appUrlConfigured: !!CONFIGURED_APP_URL,
    hasCode: !!code,
    hasState: !!state,
    error: error || null,
    forwardedHost: req.headers["x-forwarded-host"] || null,
    host: req.headers.host || null,
    sessionHasState: !!req.session.googleOAuthState,
    sessionHasMediator: !!req.session.googleOAuthMediatorId,
  });

  if (error) {
    logger.error("[Google OAuth] Error from Google", { error });
    if (!state || !req.session.googleOAuthState || state !== req.session.googleOAuthState || !req.session.googleOAuthMediatorId) {
      return redirect({ error: "invalid_state" });
    }
    clearMediatorCalendarOAuthSession(req, "google");
    return redirect({ error: "access_denied" });
  }

  if (!code || !state) {
    logger.error("[Google OAuth] Missing code or state in callback");
    if (state && state === req.session.googleOAuthState && req.session.googleOAuthMediatorId) {
      clearMediatorCalendarOAuthSession(req, "google");
    }
    return redirect({ error: "missing_params" });
  }

  const sessionState = req.session.googleOAuthState;
  const mediatorId = req.session.googleOAuthMediatorId;

  if (!sessionState || sessionState !== state || !mediatorId) {
    return redirect({ error: "invalid_state" });
  }

  clearMediatorCalendarOAuthSession(req, "google");

  try {
    const mediator = await storage.getUser(mediatorId);
    if (mediator?.outlookCalendarConnected) {
      return redirect({ error: "disconnect_existing_provider" });
    }
    const { email, scope } = await googleCalendarService.exchangeCodeAndSave(mediatorId, code);

    logAudit({
      userId: mediatorId,
      action: "connect",
      entity: "google_calendar",
      entityId: mediatorId,
      details: JSON.stringify({ googleCalendarEmail: email, scope }),
    });

    if (!hasWriteScope(scope)) {
      // exchangeCodeAndSave already set googleCalendarConnected=false and
      // lastCalendarSyncError="needs_write_scope" — skip sync (not connected).
      return redirect({ error: "missing_write_scope" });
    }

    await storage.updateUser(mediatorId, { activeCalendarProvider: "google" });
    const warning = await completeMediatorCalendarSetup(mediatorId, "google");
    return redirect({ connected: true, warning });
  } catch (err) {
    logger.error("[Google OAuth] Callback error", err);
    return redirect({ error: "exchange_failed" });
  }
});

router.get("/api/auth/outlook", async (req, res) => {
  const returnRequest = getCalendarOAuthReturnRequest(req);
  const user = req.session.userId ? await storage.getUser(req.session.userId) : null;
  if (!user) {
    if (returnRequest.requested) return res.redirect(calendarOAuthLoginUrl(req, "outlook"));
    return res.status(401).json({ success: false, message: "Not authenticated" });
  }
  if (!outlookCalendarService.isConfigured()) {
    return sendCalendarOAuthStartError(req, res, "outlook", "not_configured", 503, "Microsoft Outlook integration is not configured");
  }
  if (user.role !== "mediator") {
    return sendCalendarOAuthStartError(req, res, "outlook", "mediator_only", 403, "Only mediators can connect Outlook Calendar");
  }
  if (user.googleCalendarConnected) {
    return sendCalendarOAuthStartError(req, res, "outlook", "disconnect_existing_provider", 409, "This mediator already has Google Calendar connected. Disconnect it before connecting Microsoft Outlook.");
  }

  const state = crypto.randomBytes(16).toString("hex");
  req.session.outlookOAuthState = state;
  req.session.outlookOAuthMediatorId = user.id;
  req.session.outlookOAuthReturnTo = returnRequest.target;

  try {
    const baseUrl = getBaseUrl(req);
    const redirectUri = outlookCalendarService.getRedirectUri(baseUrl);
    return res.redirect(outlookCalendarService.getOAuthUrl(state, redirectUri));
  } catch (error) {
    clearMediatorCalendarOAuthSession(req, "outlook");
    logger.error("[Outlook OAuth] Could not start authorization", error);
    return sendCalendarOAuthStartError(req, res, "outlook", "start_failed", 500, "Could not start Microsoft Outlook authorization");
  }
});

router.get("/api/auth/callback/outlook", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;
  const baseUrl = getBaseUrl(req);
  const returnTo = req.session.outlookOAuthReturnTo ?? "dashboard";
  const redirect = (result: Parameters<typeof buildCalendarOAuthRedirectUrl>[3]) =>
    res.redirect(buildCalendarOAuthRedirectUrl(baseUrl, returnTo, "outlook", result));

  if (error) {
    logger.error("[Outlook OAuth] Error from Microsoft", { error });
    if (!state || !req.session.outlookOAuthState || state !== req.session.outlookOAuthState || !req.session.outlookOAuthMediatorId) {
      return redirect({ error: "invalid_state" });
    }
    clearMediatorCalendarOAuthSession(req, "outlook");
    return redirect({ error: "access_denied" });
  }

  if (!code || !state) {
    logger.error("[Outlook OAuth] Missing code or state in callback");
    if (state && state === req.session.outlookOAuthState && req.session.outlookOAuthMediatorId) {
      clearMediatorCalendarOAuthSession(req, "outlook");
    }
    return redirect({ error: "missing_params" });
  }

  const sessionState = req.session.outlookOAuthState;
  const mediatorId = req.session.outlookOAuthMediatorId;
  if (!sessionState || sessionState !== state || !mediatorId) {
    return redirect({ error: "invalid_state" });
  }
  clearMediatorCalendarOAuthSession(req, "outlook");

  try {
    const mediator = await storage.getUser(mediatorId);
    if (mediator?.googleCalendarConnected) {
      return redirect({ error: "disconnect_existing_provider" });
    }
    const redirectUri = outlookCalendarService.getRedirectUri(baseUrl);
    const { email, scope } = await outlookCalendarService.exchangeCodeAndSave(mediatorId, code, redirectUri);
    logAudit({
      userId: mediatorId,
      action: "connect",
      entity: "outlook_calendar",
      entityId: mediatorId,
      details: JSON.stringify({ outlookCalendarEmail: email, scope }),
    });

    const grantedWriteScope = !!scope && scope.split(/\s+/).includes("Calendars.ReadWrite");
    if (!grantedWriteScope) {
      return redirect({ error: "missing_write_scope" });
    }

    const warning = await completeMediatorCalendarSetup(mediatorId, "outlook");
    return redirect({ connected: true, warning });
  } catch (err) {
    logger.error("[Outlook OAuth] Callback error", err);
    return redirect({ error: "exchange_failed" });
  }
});

router.post("/api/calendar/sync/:mediatorId", requireAuth, async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;

  const { mediatorId } = req.params;

  if (user.role !== "superadmin" && user.role !== "subadmin" && user.id !== mediatorId) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  const target = await storage.getUser(mediatorId);
  if (!target || target.role !== "mediator") {
    return res.status(404).json({ success: false, message: "Mediator not found" });
  }
  const activeProvider = target.activeCalendarProvider;
  const activeCalendarReady =
    (activeProvider === "google" && !!target.googleCalendarConnected) ||
    (activeProvider === "outlook" && !!target.outlookCalendarConnected);
  if (!activeCalendarReady) {
    return res.status(400).json({ success: false, message: "No active connected calendar provider" });
  }

  try {
    const result = activeProvider === "outlook"
      ? await outlookCalendarService.syncCalendar(mediatorId, "manual_sync")
      : await googleCalendarService.syncCalendar(mediatorId, "manual_sync");
    logAudit({
      userId: user.id,
      action: "sync",
      entity: activeProvider === "outlook" ? "outlook_calendar" : "google_calendar",
      entityId: mediatorId,
      details: JSON.stringify({ provider: activeProvider, syncedCount: result.syncedCount, reconciliation: result.reconciliation }),
    });
    return res.json({ success: true, provider: activeProvider, syncedCount: result.syncedCount, reconciliation: result.reconciliation });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Sync failed";
    logger.error("[Calendar] Sync error", {
      mediatorId,
      provider: activeProvider,
      err,
    });
    return res.status(500).json({ success: false, message });
  }
});

// POST /api/calendar/sync-all
// Superadmin / subadmin only — triggers a background sync for every active
// mediator with an active connected calendar whose last sync is older than 60 s.
// Uses Promise.allSettled so one mediator's failure does not abort the others.
// Returns syncedMediatorIds so the frontend can update its per-mediator cooldown map.
router.post("/api/calendar/sync-all", requireAuth, async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;

  if (user.role !== "superadmin" && user.role !== "subadmin") {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  const allUsers = await storage.listUsers();
  const connected = allUsers.filter((u) => {
    if (u.role !== "mediator" || u.status !== "active") return false;
    return (u.activeCalendarProvider === "google" && !!u.googleCalendarConnected)
      || (u.activeCalendarProvider === "outlook" && !!u.outlookCalendarConnected);
  });

  const COOLDOWN_MS = 60_000;
  const now = Date.now();

  // Per-mediator cooldown: skip mediators whose lastCalendarSyncAt is within
  // the last 60 seconds — mirrors the frontend opportunistic-sync cooldown.
  const due = connected.filter((u) => {
    const lastSyncAt = u.activeCalendarProvider === "outlook" ? u.lastOutlookSyncAt : u.lastCalendarSyncAt;
    if (!lastSyncAt) return true;
    return now - new Date(lastSyncAt).getTime() >= COOLDOWN_MS;
  });
  const skipped = connected.length - due.length;

  const results = await Promise.allSettled(
    due.map((m) => (
      m.activeCalendarProvider === "outlook"
        ? outlookCalendarService.syncCalendar(m.id)
        : googleCalendarService.syncCalendar(m.id)
    ).then(() => m.id)),
  );

  let synced = 0;
  let failed = 0;
  const syncedMediatorIds: string[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      synced++;
      syncedMediatorIds.push(r.value);
    } else {
      failed++;
      logger.error("[Google Calendar] sync-all partial failure", r.reason);
    }
  }

  return res.json({ success: true, total: connected.length, synced, skipped, failed, syncedMediatorIds });
});

router.get("/api/calendar/status/me", requireAuth, async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "mediator") {
    return res.json({
      role: user.role,
      googleCalendarConnected: false,
      googleCalendarEmail: null,
      lastCalendarSyncAt: null,
      lastCalendarSyncError: null,
      hasWriteScope: false,
      configured: googleCalendarService.isConfigured(),
      outlookCalendarConnected: false,
      outlookCalendarEmail: null,
      lastOutlookSyncAt: null,
      lastOutlookSyncError: null,
      outlookConfigured: outlookCalendarService.isConfigured(),
      hasOutlookWriteScope: false,
      activeCalendarProvider: null,
    });
  }
  const scopeOk = hasWriteScope(user.googleScopeGranted);
  // needsWriteScope uses lastCalendarSyncError as the canonical source so it
  // stays in sync with the same flag that drives availability gating. This
  // prevents state drift: e.g. a mediator who has googleScopeGranted from an
  // old token but lastCalendarSyncError="needs_write_scope" from the backfill.
  const needsWriteScope = user.lastCalendarSyncError === "needs_write_scope";
  // Task #191 — explicit needsReauth flag for the UI badge, derived from the
  // same canonical lastCalendarSyncError column so frontend banners and
  // backend booking gate stay aligned.
  const needsReauth = user.lastCalendarSyncError === "needs_reauth";
  return res.json({
    role: user.role,
    googleCalendarConnected: !!user.googleCalendarConnected,
    googleCalendarEmail: user.googleCalendarEmail ?? null,
    lastCalendarSyncAt: user.lastCalendarSyncAt ?? null,
    lastCalendarSyncError: user.lastCalendarSyncError ?? null,
    hasWriteScope: scopeOk,
    needsWriteScope,
    needsReauth,
    configured: googleCalendarService.isConfigured(),
    outlookCalendarConnected: !!user.outlookCalendarConnected,
    outlookCalendarEmail: user.outlookCalendarEmail ?? null,
    lastOutlookSyncAt: user.lastOutlookSyncAt ?? null,
    lastOutlookSyncError: user.lastOutlookSyncError ?? null,
    hasOutlookWriteScope: !!user.outlookScopeGranted && user.outlookScopeGranted.split(/\s+/).includes("Calendars.ReadWrite"),
    outlookConfigured: outlookCalendarService.isConfigured(),
    activeCalendarProvider: user.activeCalendarProvider ?? null,
  });
});

router.get("/api/calendar/availability-import-status", requireAuth, async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  return res.json({ enabled: true });
});

router.get("/api/mediators/:mediatorId/calendar-availability-diagnostics", requireAuth, async (req, res) => {
  const actor = await loadUser(req, res);
  if (!actor) return;
  const mediatorId = req.params.mediatorId;
  if (!(actor.role === "superadmin" || actor.role === "subadmin" || (actor.role === "mediator" && actor.id === mediatorId))) {
    return res.status(403).json({ message: "Access denied" });
  }
  const mediator = await storage.getUser(mediatorId);
  if (!mediator || mediator.role !== "mediator") return res.status(404).json({ message: "Mediator not found" });
  const provider = mediator.activeCalendarProvider;
  if (!isCalendarProvider(provider)) return res.json({ provider: null, events: [], serviceEligibility: [] });

  const [profile, approvals, assignments, sources, slots, cachedEvents] = await Promise.all([
    mediatorProfileRepository.getProfile(mediatorId),
    db.select().from(mediatorServiceApprovals).where(eq(mediatorServiceApprovals.mediatorId, mediatorId)),
    db.select({ serviceTypeId: mediatorServiceTypes.serviceTypeId, mediationRoleQualification: mediatorServiceTypes.mediationRoleQualification }).from(mediatorServiceTypes).where(eq(mediatorServiceTypes.mediatorId, mediatorId)),
    db.select().from(mediatorCalendarAvailabilitySources).where(and(
      eq(mediatorCalendarAvailabilitySources.mediatorId, mediatorId),
      eq(mediatorCalendarAvailabilitySources.provider, provider),
      eq(mediatorCalendarAvailabilitySources.origin, "mediator_invite"),
    )),
    db.select().from(mediatorServiceScheduleSlots).where(and(
      eq(mediatorServiceScheduleSlots.mediatorId, mediatorId),
      eq(mediatorServiceScheduleSlots.lifecycle, "active"),
    )),
    provider === "outlook"
      ? storage.listOutlookCalendarEventsByDateRange(mediatorId, new Date(Date.now() - 90 * 86400000), new Date(Date.now() + 90 * 86400000))
      : storage.listGoogleCalendarEventsByDateRange(mediatorId, new Date(Date.now() - 90 * 86400000), new Date(Date.now() + 90 * 86400000)),
  ]);
  const services = await Promise.all(approvals.map(async (approval) => ({
    approval,
    service: await storage.getServiceType(approval.serviceTypeId),
  })));
  const assignmentByServiceId = new Map(assignments.map((assignment) => [assignment.serviceTypeId, assignment]));
  const approvedServiceIds = services
    .filter(({ approval, service }) => !!service?.isActive && getEffectiveApprovalStatus(approval) === "approved")
    .map(({ approval }) => approval.serviceTypeId);
  const sourceByEventId = new Map(sources.map((source) => [source.externalEventId, source]));
  const connectedEmail = provider === "outlook" ? mediator.outlookCalendarEmail : mediator.googleCalendarEmail;
  const panelActive = !profile || (profile.panelStatus ?? "Active") === "Active";
  const serviceEligibility = services.map(({ approval, service }) => ({
    serviceTypeId: approval.serviceTypeId,
    serviceName: service?.name ?? null,
    reasons: getMediatorBookingEligibilityReasons({
      assignedToService: assignmentByServiceId.has(approval.serviceTypeId),
      accountActive: mediator.status === "active",
      panelActive,
      serviceActive: !!service?.isActive,
      approvalApproved: getEffectiveApprovalStatus(approval) === "approved",
      roleQualified: !service || (!(service.category === "MIAM" || service.name.toLowerCase().includes("miam"))
        || isMediationRoleQualifiedFor(assignmentByServiceId.get(approval.serviceTypeId)?.mediationRoleQualification, "lead_mediator")),
    }),
  }));
  const events = cachedEvents.map((event) => {
    const externalEventId = "outlookEventId" in event ? event.outlookEventId : event.googleEventId;
    const source = sourceByEventId.get(externalEventId);
    const activeSlotServiceIds = slots
      .filter((slot) => slot.availabilitySourceId === source?.id)
      .map((slot) => slot.serviceTypeId);
    const diagnostic = buildCalendarAvailabilityProjectionDiagnostic({
      provider,
      externalEventId,
      externalSeriesId: event.externalSeriesId,
      title: event.title,
      startAt: event.startAt,
      endAt: event.endAt,
      isAllDay: event.isAllDay,
      organizerEmail: event.organizerEmail,
      attendees: event.attendees ?? [],
      connectedEmail,
      approvedServiceIds,
      activeSlotServiceIds,
    });
    return { externalEventId, title: event.title, startAt: event.startAt, endAt: event.endAt, sourceState: source?.state ?? null, ...diagnostic };
  });
  return res.json({ provider, events, serviceEligibility });
});

async function loadEditableAvailabilitySource(req: any, res: any) {
  const actor = await loadUser(req, res);
  if (!actor) return null;
  const mediatorId = req.params.mediatorId;
  if (!(actor.role === "superadmin" || actor.role === "subadmin" || (actor.role === "mediator" && actor.id === mediatorId))) {
    res.status(403).json({ message: "Access denied" });
    return null;
  }
  const [source] = await db.select().from(mediatorCalendarAvailabilitySources).where(and(
    eq(mediatorCalendarAvailabilitySources.id, req.params.sourceId),
    eq(mediatorCalendarAvailabilitySources.mediatorId, mediatorId),
  )).limit(1);
  if (!source) {
    res.status(404).json({ message: "Calendar availability was not found" });
    return null;
  }
  if (!isCalendarProvider(source.provider)) {
    res.status(409).json({ message: "This calendar provider is not supported" });
    return null;
  }
  return { actor, source };
}

router.patch("/api/mediators/:mediatorId/calendar-availability-sources/:sourceId", requireAuth, async (req, res) => {
  const loaded = await loadEditableAvailabilitySource(req, res);
  if (!loaded) return;
  const parsed = groupedAvailabilityPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid availability time" });
  const { source, actor } = loaded;
  const providerService = getMediatorCalendarProviderService(source.provider as "google" | "outlook");
  const providerEvent = await providerService.getEventById(source.mediatorId, source.externalEventId);
  if (!providerEvent) return res.status(409).json({ message: "The connected calendar event no longer exists. Sync the calendar and try again." });
  const expectedFingerprint = buildAvailabilityFingerprint({
    title: providerEvent.summary,
    startAt: parsed.data.startAt,
    endAt: parsed.data.endAt,
    isAllDay: false,
    attendees: providerEvent.attendees,
  });
  await db.update(mediatorCalendarAvailabilitySources).set({ expectedProviderFingerprint: expectedFingerprint, updatedAt: new Date() })
    .where(eq(mediatorCalendarAvailabilitySources.id, source.id));
  const mutationJob = await enqueueCalendarAvailabilityReconciliation({
    mediatorId: source.mediatorId,
    provider: source.provider as "google" | "outlook",
    trigger: "bfm_mutation_retry",
    dedupeKey: `mutation:patch:${source.id}`,
    payload: { operation: "patch", sourceId: source.id, startAt: parsed.data.startAt.toISOString(), endAt: parsed.data.endAt.toISOString(), expectedFingerprint },
    nextAttemptAt: new Date(Date.now() + 30_000),
  });
  try {
    await providerService.patchEvent(source.mediatorId, source.externalEventId, {
      start: parsed.data.startAt,
      end: parsed.data.endAt,
    });
  } catch (error) {
    await logAudit({ userId: actor.id, action: "calendar_availability_reconciliation_failure", entity: "mediator_calendar_availability_source", entityId: source.id, details: JSON.stringify({ trigger: "bfm_update", provider: source.provider, externalEventId: source.externalEventId, error: error instanceof Error ? error.message : String(error) }) });
    return res.status(502).json({ message: "The connected calendar could not be updated. No BFM availability was changed." });
  }
  await db.transaction(async (tx) => {
    const now = new Date();
    await tx.update(mediatorCalendarAvailabilitySources).set({ isAllDay: false, startAt: parsed.data.startAt, endAt: parsed.data.endAt, providerFingerprint: expectedFingerprint, expectedProviderFingerprint: null, state: "active", historicalAt: null, outOfWindowAt: null, updatedAt: now }).where(eq(mediatorCalendarAvailabilitySources.id, source.id));
    if (!source.isAllDay) {
      await tx.update(mediatorServiceScheduleSlots).set({ startAt: parsed.data.startAt, endAt: parsed.data.endAt, updatedAt: now }).where(and(eq(mediatorServiceScheduleSlots.availabilitySourceId, source.id), eq(mediatorServiceScheduleSlots.lifecycle, "active")));
      return;
    }
    const slots = await tx.select().from(mediatorServiceScheduleSlots).where(and(
      eq(mediatorServiceScheduleSlots.availabilitySourceId, source.id),
      eq(mediatorServiceScheduleSlots.lifecycle, "active"),
    ));
    const conflicts = await tx.select({ dateTime: appointments.dateTime, duration: appointments.duration }).from(appointments).where(and(
      eq(appointments.availabilitySourceId, source.id),
      ne(appointments.status, "cancelled"),
      ne(appointments.status, "expired"),
    ));
    const bookedIds = slots.filter((slot) => conflicts.some((appointment) => {
      const appointmentStart = new Date(appointment.dateTime);
      const appointmentEnd = new Date(appointmentStart.getTime() + appointment.duration * 60_000);
      return appointmentStart < slot.endAt && slot.startAt < appointmentEnd;
    })).map((slot) => slot.id);
    const deleteIds = slots.filter((slot) => !bookedIds.includes(slot.id)).map((slot) => slot.id);
    if (bookedIds.length) await tx.update(mediatorServiceScheduleSlots).set({ lifecycle: "retired", retiredReason: "bfm_all_day_converted_to_timed", retiredAt: now, updatedAt: now }).where(inArray(mediatorServiceScheduleSlots.id, bookedIds));
    if (deleteIds.length) await tx.delete(mediatorServiceScheduleSlots).where(inArray(mediatorServiceScheduleSlots.id, deleteIds));
    const serviceTypeIds = Array.from(new Set(slots.map((slot) => slot.serviceTypeId)));
    if (serviceTypeIds.length) await tx.insert(mediatorServiceScheduleSlots).values(serviceTypeIds.map((serviceTypeId) => ({
      mediatorId: source.mediatorId,
      serviceTypeId,
      startAt: parsed.data.startAt,
      endAt: parsed.data.endAt,
      googleEventId: source.externalEventId,
      calendarProvider: source.provider,
      availabilitySourceId: source.id,
      lifecycle: "active",
    }))).onConflictDoNothing();
  });
  await completeCalendarAvailabilityReconciliationJob(mutationJob?.id);
  await logAudit({
    userId: actor.id,
    action: "calendar_availability_bfm_originated_update",
    entity: "mediator_calendar_availability_source",
    entityId: source.id,
    entityRef: source.externalSeriesId ?? source.externalEventId,
    details: JSON.stringify({ correlationId: source.auditCorrelationId, trigger: "bfm_update", provider: source.provider, before: { startAt: source.startAt, endAt: source.endAt }, after: parsed.data }),
  });
  return res.json({ id: source.id, startAt: parsed.data.startAt, endAt: parsed.data.endAt });
});

router.delete("/api/mediators/:mediatorId/calendar-availability-sources/:sourceId", requireAuth, async (req, res) => {
  const loaded = await loadEditableAvailabilitySource(req, res);
  if (!loaded) return;
  const { source, actor } = loaded;
  const providerService = getMediatorCalendarProviderService(source.provider as "google" | "outlook");
  await db.update(mediatorCalendarAvailabilitySources).set({ expectedProviderFingerprint: "deleted", updatedAt: new Date() })
    .where(eq(mediatorCalendarAvailabilitySources.id, source.id));
  const mutationJob = await enqueueCalendarAvailabilityReconciliation({
    mediatorId: source.mediatorId,
    provider: source.provider as "google" | "outlook",
    trigger: "bfm_mutation_retry",
    dedupeKey: `mutation:delete:${source.id}`,
    payload: { operation: "delete", sourceId: source.id },
    nextAttemptAt: new Date(Date.now() + 30_000),
  });
  try {
    await providerService.deleteEvent(source.mediatorId, source.externalEventId);
  } catch (error) {
    await logAudit({ userId: actor.id, action: "calendar_availability_reconciliation_failure", entity: "mediator_calendar_availability_source", entityId: source.id, details: JSON.stringify({ trigger: "bfm_delete", provider: source.provider, externalEventId: source.externalEventId, error: error instanceof Error ? error.message : String(error) }) });
    return res.status(502).json({ message: "The connected calendar event could not be deleted. No BFM availability was changed." });
  }
  const conflicts = await db.select({ id: appointments.id, serviceTypeId: appointments.serviceTypeId }).from(appointments).where(and(
    eq(appointments.mediatorId, source.mediatorId),
    or(
      eq(appointments.availabilitySourceId, source.id),
      eq(appointments.parentGoogleEventId, source.externalEventId),
    ),
    ne(appointments.status, "cancelled"),
    ne(appointments.status, "expired"),
  ));
  const linkedSlots = await db.select({ id: mediatorServiceScheduleSlots.id, serviceTypeId: mediatorServiceScheduleSlots.serviceTypeId })
    .from(mediatorServiceScheduleSlots)
    .where(and(
      eq(mediatorServiceScheduleSlots.availabilitySourceId, source.id),
      eq(mediatorServiceScheduleSlots.lifecycle, "active"),
    ));
  const bookedServiceIds = new Set(conflicts.flatMap((appointment) => appointment.serviceTypeId ? [appointment.serviceTypeId] : []));
  const bookedRowIds = conflicts.length > 0 && bookedServiceIds.size === 0
    ? linkedSlots.map((slot) => slot.id)
    : linkedSlots.filter((slot) => bookedServiceIds.has(slot.serviceTypeId)).map((slot) => slot.id);
  const unbookedRowIds = linkedSlots.filter((slot) => !bookedRowIds.includes(slot.id)).map((slot) => slot.id);
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(mediatorCalendarAvailabilitySources).set({ state: "deleted", deletedAt: now, expectedProviderFingerprint: null, updatedAt: now }).where(eq(mediatorCalendarAvailabilitySources.id, source.id));
    if (bookedRowIds.length) await tx.update(mediatorServiceScheduleSlots).set({ lifecycle: "retired", retiredReason: "bfm_deleted", retiredAt: now, updatedAt: now }).where(inArray(mediatorServiceScheduleSlots.id, bookedRowIds));
    if (unbookedRowIds.length) await tx.delete(mediatorServiceScheduleSlots).where(inArray(mediatorServiceScheduleSlots.id, unbookedRowIds));
  });
  await completeCalendarAvailabilityReconciliationJob(mutationJob?.id);
  await logAudit({ userId: actor.id, action: "calendar_availability_bfm_originated_deletion", entity: "mediator_calendar_availability_source", entityId: source.id, entityRef: source.externalSeriesId ?? source.externalEventId, details: JSON.stringify({ correlationId: source.auditCorrelationId, trigger: "bfm_delete", provider: source.provider, affectedAllLinkedServices: source.scopeMode === "all_approved_services", appointmentConflicts: conflicts.map((row) => row.id) }) });
  return res.status(204).send();
});

router.patch("/api/calendar/active-provider", requireAuth, async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "mediator") {
    return res.status(403).json({ success: false, message: "Only mediators can choose an active calendar provider" });
  }
  const parsed = activeCalendarProviderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Invalid calendar provider" });
  }
  const provider = parsed.data.provider;
  if (provider === "google" && (!user.googleCalendarConnected || !hasWriteScope(user.googleScopeGranted))) {
    return res.status(400).json({ success: false, message: "Google Calendar is not connected with write access" });
  }
  if (provider === "outlook" && (!user.outlookCalendarConnected || !hasOutlookWriteScope(user.outlookScopeGranted))) {
    return res.status(400).json({ success: false, message: "Microsoft Outlook is not connected with write access" });
  }
  await storage.updateUser(user.id, { activeCalendarProvider: provider });
  await logAudit({
    userId: user.id,
    action: "update",
    entity: "calendar_provider",
    entityId: user.id,
    details: JSON.stringify({ activeCalendarProvider: provider }),
  });
  return res.json({ success: true, activeCalendarProvider: provider });
});

router.get("/api/calendar/events", requireAuth, async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;

  if (user.role !== "superadmin" && user.role !== "subadmin") {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  const { from, to } = req.query as { from?: string; to?: string };
  const start = from ? new Date(from) : new Date();
  const end = to ? new Date(to) : new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000);

  const allUsers = await storage.listUsers();
  const mediators = allUsers.filter((u) =>
    u.role === "mediator" && u.status === "active" && (
      (u.activeCalendarProvider === "google" && !!u.googleCalendarConnected) ||
      (u.activeCalendarProvider === "outlook" && !!u.outlookCalendarConnected)
    )
  );

  const perMediator = await Promise.all(
    mediators.map((m) => listMergedMediatorCalendarEvents(m, start, end))
  );

  return res.json(perMediator.flat());
});

router.get("/api/calendar/events/:mediatorId", requireAuth, async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;

  const { mediatorId } = req.params;

  if (user.role !== "superadmin" && user.role !== "subadmin" && user.id !== mediatorId) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  const target = await storage.getUser(mediatorId);
  if (!target || target.role !== "mediator") {
    return res.status(404).json({ success: false, message: "Mediator not found" });
  }

  const { from, to } = req.query as { from?: string; to?: string };
  const start = from ? new Date(from) : new Date();
  const end = to ? new Date(to) : new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000);

  return res.json(await listMergedMediatorCalendarEvents(target, start, end));
});

// ─── BFM Organisation Calendar (info@) routes ──────────────────────────────
// Superadmin-managed. The org calendar is the "client-side" leg of the
// two-event booking flow — see google-calendar.service.ts for context.
router.get("/api/auth/google/bfm", requireAuth, async (req, res) => {
  if (!googleCalendarService.isConfigured()) {
    return res.status(503).json({ success: false, message: "Google Calendar integration is not configured" });
  }
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "superadmin") {
    return res.status(403).json({ success: false, message: "Only superadmins can connect the BFM organisation calendar" });
  }

  const state = crypto.randomBytes(16).toString("hex");
  req.session.bfmGoogleOAuthState = state;
  req.session.bfmGoogleOAuthUserId = user.id;

  const url = googleCalendarService.getBfmOAuthUrl(state);
  return res.redirect(url);
});

router.get("/api/auth/callback/google/bfm", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;
  const baseUrl = getBaseUrl(req);

  if (error) {
    logger.error("[BFM OAuth] Error from Google", { error });
    return res.redirect(`${baseUrl}/settings?bfmCalendarError=access_denied`);
  }
  if (!code || !state) {
    return res.redirect(`${baseUrl}/settings?bfmCalendarError=missing_params`);
  }

  const sessionState = req.session.bfmGoogleOAuthState;
  const connectedByUserId = req.session.bfmGoogleOAuthUserId;
  if (!sessionState || sessionState !== state || !connectedByUserId) {
    return res.redirect(`${baseUrl}/settings?bfmCalendarError=invalid_state`);
  }
  delete req.session.bfmGoogleOAuthState;
  delete req.session.bfmGoogleOAuthUserId;

  try {
    const { email, scope } = await googleCalendarService.exchangeCodeAndSaveBfm(code, connectedByUserId);
    logAudit({
      userId: connectedByUserId,
      action: "connect",
      entity: "bfm_calendar",
      entityId: "bfm",
      details: JSON.stringify({ googleCalendarEmail: email, scope }),
    });
    if (!hasWriteScope(scope)) {
      return res.redirect(`${baseUrl}/settings?bfmCalendarError=missing_write_scope`);
    }
    // Run an immediate health check so the connection panel reflects a real
    // green state rather than "never checked".
    googleCalendarService
      .bfmHealthCheck()
      .catch((err) =>
        logger.error("[BFM OAuth] Post-connect health check failed", err),
      );
    return res.redirect(`${baseUrl}/settings?bfmCalendarConnected=true`);
  } catch (err) {
    logger.error("[BFM OAuth] Callback error", err);
    const code = (err as { code?: string })?.code;
    if (code === "wrong_account") {
      return res.redirect(`${baseUrl}/settings?bfmCalendarError=wrong_account`);
    }
    return res.redirect(`${baseUrl}/settings?bfmCalendarError=exchange_failed`);
  }
});

router.get("/api/calendar/bfm/status", requireAuth, async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "superadmin" && user.role !== "subadmin") {
    return res.status(403).json({ success: false, message: "Access denied" });
  }
  const conn = await googleCalendarService.getBfmConnection();
  return res.json({
    configured: googleCalendarService.isConfigured(),
    connected: !!(conn && conn.googleCalendarConnected),
    googleCalendarEmail: conn?.googleCalendarEmail ?? null,
    lastHealthCheckAt: conn?.lastHealthCheckAt ?? null,
    lastHealthCheckError: conn?.lastHealthCheckError ?? null,
    connectedAt: conn?.connectedAt ?? null,
    connectedByUserId: conn?.connectedByUserId ?? null,
    hasWriteScope: hasWriteScope(conn?.googleScopeGranted),
    hasGmailReadonlyScope: hasGmailReadonlyScope(conn?.googleScopeGranted),
    healthCheckAlertsEnabled: !!conn?.healthCheckAlertsEnabled,
  });
});

// Task #189 — Superadmin-only toggle for the daily BFM info@ calendar health
// check email + admin notification fan-out. The booking gate is unaffected,
// and the manual "Run health check now" button still works regardless.
router.patch("/api/calendar/bfm/health-check-alerts", requireAuth, async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "superadmin") {
    return res.status(403).json({ success: false, message: "Only superadmins can change this setting" });
  }
  const parsed = healthAlertsToggleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "enabled must be a boolean" });
  }
  const { enabled } = parsed.data;
  await googleCalendarService.setBfmHealthCheckAlerts(enabled);
  logAudit({
    userId: user.id,
    action: "update_health_alerts",
    entity: "bfm_calendar",
    entityId: "bfm",
    details: JSON.stringify({ enabled }),
  });
  return res.json({ success: true, healthCheckAlertsEnabled: enabled });
});

router.delete("/api/calendar/bfm/disconnect", requireAuth, async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "superadmin") {
    return res.status(403).json({ success: false, message: "Only superadmins can disconnect the BFM organisation calendar" });
  }
  await googleCalendarService.disconnectBfm();
  logAudit({
    userId: user.id,
    action: "disconnect",
    entity: "bfm_calendar",
    entityId: "bfm",
    details: JSON.stringify({}),
  });
  return res.json({ success: true });
});

router.post("/api/calendar/bfm/health-check", requireAuth, async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "superadmin" && user.role !== "subadmin") {
    return res.status(403).json({ success: false, message: "Access denied" });
  }
  const result = await googleCalendarService.bfmHealthCheck();
  return res.json(result);
});

router.delete("/api/calendar/disconnect/:mediatorId", requireAuth, async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;

  const { mediatorId } = req.params;

  if (user.role !== "superadmin" && user.role !== "subadmin" && user.id !== mediatorId) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  const target = await storage.getUser(mediatorId);
  if (!target || target.role !== "mediator") {
    return res.status(404).json({ success: false, message: "Mediator not found" });
  }

  const requestedProvider = req.query.provider === "outlook" ? "outlook" : "google";
  if (requestedProvider === "outlook") await outlookCalendarService.disconnectCalendar(mediatorId);
  else await googleCalendarService.disconnectCalendar(mediatorId);

  logAudit({
    userId: user.id,
    action: "disconnect",
    entity: `${requestedProvider}_calendar`,
    entityId: mediatorId,
    details: JSON.stringify({ provider: requestedProvider }),
  });

  return res.json({ success: true, provider: requestedProvider });
});

export default router;
