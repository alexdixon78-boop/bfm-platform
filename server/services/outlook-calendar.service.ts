import { storage } from "../storage";
import { db } from "../db";
import { logger } from "../logger";
import { logAudit } from "./audit-log.service";
import { calendarWebhookSubscriptions, type InsertOutlookCalendarEvent } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import type { CalendarAvailabilityReconciliationCounts, CalendarAvailabilityTrigger } from "./calendar-availability-reconciliation-runtime";
import { parseCalendarDateTimeInstant } from "../utils/google-calendar-time";

const TENANT = process.env.MICROSOFT_TENANT_ID?.trim() || "common";
const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID?.trim() || "";
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET?.trim() || "";
const REDIRECT_URI_ENV = process.env.MICROSOFT_REDIRECT_URI?.trim() || "";
const BFM_EMAIL = "info@brighterfuturemediation.co.uk";

function isConfigured(): boolean {
  return !!CLIENT_ID && !!CLIENT_SECRET;
}

export function hasOutlookWriteScope(scopeGranted: string | null | undefined): boolean {
  return !!scopeGranted && scopeGranted.split(/\s+/).includes("Calendars.ReadWrite");
}

function getRedirectUri(fallbackBaseUrl: string): string {
  if (REDIRECT_URI_ENV) return REDIRECT_URI_ENV;
  return `${fallbackBaseUrl.replace(/\/$/, "")}/api/auth/callback/outlook`;
}

function getAuthorizeUrl(state: string, redirectUri: string): string {
  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(TENANT)}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", "openid profile email offline_access User.Read Calendars.ReadWrite");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access User.Read Calendars.ReadWrite",
  });

  const tokenRes = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(TENANT)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const tokenJson = await tokenRes.json().catch(() => null) as
    | { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string }
    | null;

  if (!tokenRes.ok || !tokenJson?.access_token) {
    const message = tokenJson?.error_description || tokenJson?.error || `Microsoft token exchange failed (${tokenRes.status})`;
    throw new Error(message);
  }

  return tokenJson;
}

async function fetchProfileEmail(accessToken: string): Promise<string | null> {
  const meRes = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!meRes.ok) return null;
  const meJson = await meRes.json().catch(() => null) as { mail?: string | null; userPrincipalName?: string | null } | null;
  return meJson?.mail || meJson?.userPrincipalName || null;
}

async function refreshAccessToken(mediatorId: string): Promise<string> {
  const user = await storage.getUser(mediatorId);
  if (!user?.outlookRefreshToken) {
    throw new Error("Mediator not connected to Microsoft Outlook");
  }
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: user.outlookRefreshToken,
    scope: "openid profile email offline_access User.Read Calendars.ReadWrite",
  });
  const tokenRes = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(TENANT)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokenJson = await tokenRes.json().catch(() => null) as
    | { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string }
    | null;
  if (!tokenRes.ok || !tokenJson?.access_token) {
    const message = tokenJson?.error_description || tokenJson?.error || `Microsoft token refresh failed (${tokenRes.status})`;
    const update: Parameters<typeof storage.updateUser>[1] = { lastOutlookSyncError: "needs_reauth" };
    if (tokenJson?.error === "invalid_grant") {
      update.outlookCalendarConnected = false;
    }
    await storage.updateUser(mediatorId, update).catch(() => undefined);
    throw new Error(message);
  }
  const scope = tokenJson.scope ?? user.outlookScopeGranted ?? null;
  await storage.updateUser(mediatorId, {
    outlookAccessToken: tokenJson.access_token,
    outlookRefreshToken: tokenJson.refresh_token ?? user.outlookRefreshToken,
    outlookTokenExpiresAt: tokenJson.expires_in ? new Date(Date.now() + tokenJson.expires_in * 1000) : null,
    outlookScopeGranted: scope,
    outlookCalendarConnected: hasOutlookWriteScope(scope),
    lastOutlookSyncError: hasOutlookWriteScope(scope) ? null : "needs_write_scope",
  });
  return tokenJson.access_token;
}

async function getAccessToken(mediatorId: string): Promise<string> {
  const user = await storage.getUser(mediatorId);
  if (!user?.outlookAccessToken) {
    return refreshAccessToken(mediatorId);
  }
  const expiresAt = user.outlookTokenExpiresAt?.getTime() ?? 0;
  if (expiresAt && expiresAt - Date.now() < 60_000) {
    return refreshAccessToken(mediatorId);
  }
  if (!hasOutlookWriteScope(user.outlookScopeGranted)) {
    throw new Error("Microsoft Outlook calendar write access is required");
  }
  return user.outlookAccessToken;
}

async function graphRequest<T>(mediatorId: string, path: string, init: RequestInit = {}): Promise<T> {
  const accessToken = await getAccessToken(mediatorId);
  const url = /^https:\/\//i.test(path) ? path : `https://graph.microsoft.com/v1.0${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) return null as T;
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (payload as { error?: { message?: string } } | null)?.error?.message
      || `Microsoft Graph request failed (${res.status})`;
    const err = new Error(message);
    (err as { status?: number; response?: { status?: number } }).status = res.status;
    (err as { status?: number; response?: { status?: number } }).response = { status: res.status };
    throw err;
  }
  return payload as T;
}

function toGraphEvent(data: {
  summary?: string;
  description?: string;
  start?: Date;
  end?: Date;
  attendees?: { email: string; displayName?: string; responseStatus?: string }[];
  location?: string;
  allDayStart?: string;
  allDayEndExclusive?: string;
}) {
  return {
    ...(data.summary !== undefined ? { subject: data.summary } : {}),
    ...(data.description !== undefined ? { body: { contentType: "text", content: data.description ?? "" } } : {}),
    ...(data.allDayStart ? { start: { dateTime: `${data.allDayStart}T00:00:00`, timeZone: "GMT Standard Time" }, isAllDay: true }
      : data.start ? { start: { dateTime: data.start.toISOString(), timeZone: "UTC" }, isAllDay: false } : {}),
    ...(data.allDayEndExclusive ? { end: { dateTime: `${data.allDayEndExclusive}T00:00:00`, timeZone: "GMT Standard Time" } }
      : data.end ? { end: { dateTime: data.end.toISOString(), timeZone: "UTC" } } : {}),
    ...(data.location !== undefined ? { location: { displayName: data.location ?? "" } } : {}),
    ...(data.attendees ? {
      attendees: data.attendees
        .filter((attendee) => attendee.email)
        .map((attendee) => ({
          emailAddress: {
            address: attendee.email,
            name: attendee.displayName ?? attendee.email,
          },
          type: "required",
        })),
    } : {}),
  };
}

function isGoneError(err: unknown): boolean {
  const status = (err as { code?: number; status?: number; response?: { status?: number } })?.code
    ?? (err as { status?: number })?.status
    ?? (err as { response?: { status?: number } })?.response?.status;
  return status === 404 || status === 410;
}

function parseAttendeeSnapshot(snapshot: string | null | undefined): { email: string; displayName?: string }[] | undefined {
  if (!snapshot) return undefined;
  try {
    const parsed = JSON.parse(snapshot);
    if (!Array.isArray(parsed)) return undefined;
    return parsed
      .filter((attendee) => typeof attendee?.email === "string" && attendee.email.length > 0)
      .map((attendee) => ({
        email: attendee.email,
        displayName: typeof attendee.displayName === "string" ? attendee.displayName : undefined,
      }));
  } catch {
    return undefined;
  }
}

function graphResponseToAttendanceStatus(response: string | null | undefined): string {
  if (!response) return "needsAction";
  if (response === "accepted" || response === "tentativelyAccepted" || response === "declined" || response === "notResponded") {
    if (response === "notResponded") return "needsAction";
    if (response === "tentativelyAccepted") return "tentative";
    return response;
  }
  return response;
}

function outlookDateTimeToDate(value: string | null | undefined, timeZoneHint?: string | null): Date | null {
  if (!value) return null;
  try {
    return parseCalendarDateTimeInstant(value, timeZoneHint);
  } catch {
    return null;
  }
}

export const outlookCalendarService = {
  isConfigured,

  getOAuthUrl(state: string, redirectUri: string): string {
    return getAuthorizeUrl(state, redirectUri);
  },

  getRedirectUri,

  async disconnectCalendar(mediatorId: string): Promise<void> {
    const { deactivateImportedCalendarAvailabilityForDisconnect } = await import("./calendar-availability-reconciliation-runtime");
    await deactivateImportedCalendarAvailabilityForDisconnect(mediatorId, "outlook");
    await storage.deleteOutlookCalendarEventsByMediator(mediatorId);
    await db.update(calendarWebhookSubscriptions).set({ status: "disconnected", updatedAt: new Date() }).where(and(
      eq(calendarWebhookSubscriptions.mediatorId, mediatorId),
      eq(calendarWebhookSubscriptions.provider, "outlook"),
    ));
    const user = await storage.getUser(mediatorId);
    await storage.updateUser(mediatorId, {
      outlookAccessToken: null,
      outlookRefreshToken: null,
      outlookCalendarConnected: false,
      outlookCalendarEmail: null,
      outlookTokenExpiresAt: null,
      outlookScopeGranted: null,
      lastOutlookSyncAt: null,
      lastOutlookSyncError: null,
      activeCalendarProvider: user?.googleCalendarConnected ? "google" : null,
    });
  },

  async createAvailabilitySubscription(
    mediatorId: string,
    input: { clientState: string; webhookUrl: string },
  ): Promise<{ subscriptionId: string; expiresAt: Date }> {
    const expirationDateTime = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString();
    const subscription = await graphRequest<{ id: string; expirationDateTime: string }>(mediatorId, "/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        changeType: "created,updated,deleted",
        notificationUrl: input.webhookUrl,
        lifecycleNotificationUrl: input.webhookUrl,
        resource: "/me/events",
        expirationDateTime,
        clientState: input.clientState,
      }),
    });
    if (!subscription.id) throw new Error("Microsoft Graph did not return a subscription ID");
    return { subscriptionId: subscription.id, expiresAt: new Date(subscription.expirationDateTime) };
  },

  async exchangeCodeAndSave(mediatorId: string, code: string, redirectUri: string): Promise<{ email: string | null; scope: string | null }> {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const scope = tokens.scope ?? null;
    const hasWriteScope = !!scope && scope.split(/\s+/).includes("Calendars.ReadWrite");
    const email = await fetchProfileEmail(tokens.access_token!);

    await storage.updateUser(mediatorId, {
      outlookAccessToken: tokens.access_token ?? null,
      outlookRefreshToken: tokens.refresh_token ?? null,
      outlookCalendarConnected: hasWriteScope,
      outlookCalendarEmail: email,
      outlookTokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
      outlookScopeGranted: scope,
      lastOutlookSyncAt: new Date(),
      lastOutlookSyncError: hasWriteScope ? null : "needs_write_scope",
      ...(hasWriteScope ? { activeCalendarProvider: "outlook" as const } : {}),
    });

    if (hasWriteScope) {
      logger.info("[Outlook OAuth] Outlook calendar connected", {
        mediatorId,
        email,
        scope,
      });
    }

    if (!hasWriteScope) {
      logger.warn("[Outlook OAuth] Connected without Calendars.ReadWrite scope", { mediatorId, scope });
    }

    return { email, scope };
  },

  async createEvent(
    mediatorId: string,
    data: {
      summary: string;
      description?: string;
      start: Date;
      end: Date;
      attendees?: { email: string; displayName?: string; responseStatus?: string }[];
      location?: string;
      allDayStart?: string;
      allDayEndExclusive?: string;
    },
  ): Promise<string> {
    const created = await graphRequest<{ id?: string }>(mediatorId, "/me/events", {
      method: "POST",
      body: JSON.stringify(toGraphEvent(data)),
    });
    if (!created?.id) throw new Error("Microsoft Graph did not return an event id");
    return created.id;
  },

  async patchEvent(
    mediatorId: string,
    eventId: string,
    patch: {
      summary?: string;
      description?: string;
      start?: Date;
      end?: Date;
      attendees?: { email: string; displayName?: string; responseStatus?: string }[];
      location?: string;
      allDayStart?: string;
      allDayEndExclusive?: string;
    },
  ): Promise<void> {
    await graphRequest(mediatorId, `/me/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      body: JSON.stringify(toGraphEvent(patch)),
    });
  },

  async deleteEvent(mediatorId: string, eventId: string): Promise<void> {
    try {
      await graphRequest(mediatorId, `/me/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
    } catch (err) {
      if (!isGoneError(err)) throw err;
    }
  },

  async getEventById(mediatorId: string, eventId: string): Promise<{
    id: string;
    summary: string | null;
    start: Date;
    end: Date;
    isAllDay: boolean;
    attendees: { email: string; displayName?: string; responseStatus?: string }[];
    organizerEmail: string | null;
    htmlLink: string | null;
  } | null> {
    try {
      const event = await graphRequest<{
        id?: string;
        subject?: string | null;
        isAllDay?: boolean;
        start?: { dateTime?: string | null; timeZone?: string | null };
        end?: { dateTime?: string | null; timeZone?: string | null };
        attendees?: { emailAddress?: { address?: string | null; name?: string | null }; status?: { response?: string | null } }[];
        organizer?: { emailAddress?: { address?: string | null } };
        webLink?: string | null;
      }>(mediatorId, `/me/events/${encodeURIComponent(eventId)}`, {
        headers: { Prefer: 'outlook.timezone="UTC"' },
      });
      const start = outlookDateTimeToDate(event?.start?.dateTime, event?.start?.timeZone);
      const end = outlookDateTimeToDate(event?.end?.dateTime, event?.end?.timeZone);
      if (!start || !end) return null;
      return {
        id: event.id ?? eventId,
        summary: event.subject ?? null,
        start,
        end,
        isAllDay: !!event.isAllDay,
        attendees: (event.attendees ?? []).map((attendee) => ({
          email: attendee.emailAddress?.address ?? "",
          displayName: attendee.emailAddress?.name ?? undefined,
          responseStatus: attendee.status?.response ?? undefined,
        })),
        organizerEmail: event.organizer?.emailAddress?.address ?? null,
        htmlLink: event.webLink ?? null,
      };
    } catch (err) {
      if (isGoneError(err)) return null;
      console.warn(`[OutlookCalendar] getEventById transient error for event ${eventId}:`, err);
      return null;
    }
  },

  async syncCalendar(mediatorId: string, reconciliationTrigger: CalendarAvailabilityTrigger = "fallback_sweep"): Promise<{ syncedCount: number; reconciliation: CalendarAvailabilityReconciliationCounts }> {
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const ninetyDaysAhead = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    try {
      logger.info(
        `Starting Outlook sync for mediator ${mediatorId.slice(0, 8)}: window ${ninetyDaysAgo.toISOString()} to ${ninetyDaysAhead.toISOString()}`,
        undefined,
        "OutlookCalendar",
      );

      type CalendarViewPage = {
        value?: Array<{
          id?: string;
          subject?: string | null;
          isCancelled?: boolean;
          isAllDay?: boolean;
          start?: { dateTime?: string | null; timeZone?: string | null };
          end?: { dateTime?: string | null; timeZone?: string | null };
          attendees?: { emailAddress?: { address?: string | null; name?: string | null }; status?: { response?: string | null } }[];
          organizer?: { emailAddress?: { address?: string | null } };
          seriesMasterId?: string | null;
        }>;
        "@odata.nextLink"?: string;
      };
      const allItems: NonNullable<CalendarViewPage["value"]> = [];
      let nextPath: string | null = `/me/calendarView?startDateTime=${encodeURIComponent(ninetyDaysAgo.toISOString())}&endDateTime=${encodeURIComponent(ninetyDaysAhead.toISOString())}&$top=250&$select=id,subject,isCancelled,isAllDay,start,end,attendees,organizer,seriesMasterId`;
      while (nextPath) {
        const page: CalendarViewPage = await graphRequest<CalendarViewPage>(mediatorId, nextPath, {
          headers: { Prefer: 'outlook.timezone="UTC"' },
        });
        allItems.push(...(page.value ?? []));
        nextPath = page["@odata.nextLink"] ?? null;
      }

      const toUpsert: InsertOutlookCalendarEvent[] = [];
      const bfmEmail = BFM_EMAIL.toLowerCase();
      for (const item of allItems) {
        if (!item.id || item.isCancelled) continue;
        const startAt = outlookDateTimeToDate(item.start?.dateTime, item.start?.timeZone);
        const endAt = outlookDateTimeToDate(item.end?.dateTime, item.end?.timeZone);
        if (!startAt || !endAt) continue;

        const attendees = (item.attendees ?? []).map((attendee) => ({
          email: attendee.emailAddress?.address ?? "",
          displayName: attendee.emailAddress?.name ?? undefined,
          responseStatus: graphResponseToAttendanceStatus(attendee.status?.response),
        }));
        const organizerEmail = item.organizer?.emailAddress?.address?.toLowerCase() ?? "";
        const isOrganiser = organizerEmail === bfmEmail;
        const bfmAttendee = attendees.find((attendee) => attendee.email.toLowerCase() === bfmEmail);
        if (!isOrganiser && !bfmAttendee) continue;

        toUpsert.push({
          mediatorId,
          outlookEventId: item.id,
          externalSeriesId: item.seriesMasterId ?? null,
          organizerEmail: item.organizer?.emailAddress?.address ?? null,
          title: item.subject ?? null,
          startAt,
          endAt,
          isAllDay: !!item.isAllDay,
          attendees,
          bfmAttendanceStatus: isOrganiser ? "organiser" : bfmAttendee?.responseStatus ?? null,
          isOrganiser,
          syncedAt: new Date(),
        });
      }

      await storage.upsertOutlookCalendarEvents(toUpsert);
      await storage.deleteStaleOutlookCalendarEventsInRange(
        mediatorId,
        toUpsert.map((event) => event.outlookEventId),
        ninetyDaysAgo,
        ninetyDaysAhead,
      );
      await storage.updateUser(mediatorId, {
        lastOutlookSyncAt: new Date(),
        lastOutlookSyncError: null,
      });
      const { reconcileMediatorCalendarAvailability } = await import("./calendar-availability-reconciliation-runtime");
      const reconciliation = await reconcileMediatorCalendarAvailability(mediatorId, "outlook", reconciliationTrigger);

      logger.info(
        `Outlook sync complete for mediator ${mediatorId.slice(0, 8)}: ${toUpsert.length} event(s) upserted`,
        undefined,
        "OutlookCalendar",
      );
      return { syncedCount: toUpsert.length, reconciliation };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const syncError = /invalid_grant|expired|unauthorized|interaction_required/i.test(message)
        ? "needs_reauth"
        : /Calendars\.ReadWrite|write access/i.test(message)
          ? "needs_write_scope"
          : "sync_failed";
      await storage.updateUser(mediatorId, {
        lastOutlookSyncAt: new Date(),
        lastOutlookSyncError: syncError,
      }).catch(() => undefined);
      throw err;
    }
  },

  async splitAvailabilityForBooking(
    mediatorId: string,
    parentGoogleEventId: string,
    parentStart: Date,
    parentEnd: Date,
    parentTitle: string | null,
    booking: {
      start: Date;
      end: Date;
      summary: string;
      description?: string;
      attendees?: { email: string; displayName?: string; responseStatus?: string }[];
      location?: string;
    },
    appointmentIdForAudit?: string,
    parentAttendees?: { email: string; displayName?: string }[],
  ): Promise<{ googleBookingEventId: string | null; googleTrailingRemnantEventId: string | null }> {
    const exactFill = booking.start.getTime() === parentStart.getTime() && booking.end.getTime() === parentEnd.getTime();
    const atStart = booking.start.getTime() === parentStart.getTime();
    const atEnd = booking.end.getTime() === parentEnd.getTime();
    const remnantAttendees = parentAttendees && parentAttendees.length > 0 ? parentAttendees : booking.attendees;
    let bookingEventId: string | null = null;
    let trailingRemnantId: string | null = null;

    if (exactFill) {
      await this.patchEvent(mediatorId, parentGoogleEventId, {
        summary: booking.summary,
        description: booking.description,
        start: booking.start,
        end: booking.end,
        attendees: booking.attendees,
        location: booking.location,
      });
      bookingEventId = parentGoogleEventId;
    } else if (atStart) {
      await this.deleteEvent(mediatorId, parentGoogleEventId);
      bookingEventId = await this.createEvent(mediatorId, booking);
      trailingRemnantId = await this.createEvent(mediatorId, {
        summary: parentTitle ?? "Available",
        start: booking.end,
        end: parentEnd,
        attendees: remnantAttendees,
      });
    } else if (atEnd) {
      await this.patchEvent(mediatorId, parentGoogleEventId, { end: booking.start });
      bookingEventId = await this.createEvent(mediatorId, booking);
    } else {
      await this.patchEvent(mediatorId, parentGoogleEventId, { end: booking.start });
      bookingEventId = await this.createEvent(mediatorId, booking);
      trailingRemnantId = await this.createEvent(mediatorId, {
        summary: parentTitle ?? "Available",
        start: booking.end,
        end: parentEnd,
        attendees: remnantAttendees,
      });
    }

    logAudit({
      action: "update",
      entity: "outlook_calendar",
      entityId: mediatorId,
      details: JSON.stringify({
        op: "split_booking",
        parentGoogleEventId,
        appointmentId: appointmentIdForAudit,
        bookingEventId,
        trailingRemnantId,
      }),
    });
    return { googleBookingEventId: bookingEventId, googleTrailingRemnantEventId: trailingRemnantId };
  },

  async restoreParentEventForCancelledBooking(
    mediatorId: string,
    info: {
      parentGoogleEventId: string;
      parentEventOriginalStart: Date;
      parentEventOriginalEnd: Date;
      parentEventOriginalTitle: string | null;
      parentEventOriginalAttendees?: string | null;
      googleBookingEventId: string | null;
      googleTrailingRemnantEventId: string | null;
    },
    appointmentIdForAudit?: string,
    excludeAppointmentId?: string,
  ): Promise<{ restoredParentId: string | null; aborted?: boolean }> {
    const liveAppts = await storage.listAppointmentsByMediatorAndDateRange(
      mediatorId,
      info.parentEventOriginalStart,
      info.parentEventOriginalEnd,
    );
    const blockers = liveAppts
      .filter((appt) => appt.id !== excludeAppointmentId
        && appt.id !== appointmentIdForAudit
        && appt.status !== "cancelled"
        && appt.status !== "expired")
      .map((appt) => {
        const start = new Date(appt.dateTime);
        return { start, end: new Date(start.getTime() + appt.duration * 60000) };
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    let cursor = info.parentEventOriginalStart;
    const gaps: { start: Date; end: Date }[] = [];
    for (const blocker of blockers) {
      if (blocker.start > cursor) gaps.push({ start: cursor, end: blocker.start });
      if (blocker.end > cursor) cursor = blocker.end;
    }
    if (cursor < info.parentEventOriginalEnd) gaps.push({ start: cursor, end: info.parentEventOriginalEnd });

    let restoredParentId: string | null = null;
    const parentExists = !!(await this.getEventById(mediatorId, info.parentGoogleEventId));
    if (gaps.length === 0) {
      if (parentExists) await this.deleteEvent(mediatorId, info.parentGoogleEventId);
    } else {
      const [firstGap, ...restGaps] = gaps;
      if (parentExists) {
        await this.patchEvent(mediatorId, info.parentGoogleEventId, { start: firstGap.start, end: firstGap.end });
        restoredParentId = info.parentGoogleEventId;
      } else {
        restoredParentId = await this.createEvent(mediatorId, {
          summary: info.parentEventOriginalTitle ?? "Available",
          start: firstGap.start,
          end: firstGap.end,
          attendees: parseAttendeeSnapshot(info.parentEventOriginalAttendees),
        });
      }
      for (const gap of restGaps) {
        await this.createEvent(mediatorId, {
          summary: info.parentEventOriginalTitle ?? "Available",
          start: gap.start,
          end: gap.end,
          attendees: parseAttendeeSnapshot(info.parentEventOriginalAttendees),
        });
      }
    }
    if (info.googleBookingEventId) await this.deleteEvent(mediatorId, info.googleBookingEventId);
    if (info.googleTrailingRemnantEventId) await this.deleteEvent(mediatorId, info.googleTrailingRemnantEventId);
    logAudit({
      action: "update",
      entity: "outlook_calendar",
      entityId: mediatorId,
      details: JSON.stringify({ op: "restore_after_cancel", parentGoogleEventId: info.parentGoogleEventId, restoredParentId, appointmentId: appointmentIdForAudit }),
    });
    return { restoredParentId, aborted: false };
  },
};
