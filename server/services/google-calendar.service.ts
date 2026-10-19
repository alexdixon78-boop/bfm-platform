import { google, calendar_v3 } from "googleapis";
import { storage } from "../storage";
import { db } from "../db";
import { logAudit } from "./audit-log.service";
import { logger } from "../logger";
import { bfmCalendarConnection, calendarWebhookSubscriptions, users, type BfmCalendarConnection, type InsertGoogleCalendarEvent } from "@shared/schema";
import { and, eq, sql as dsql } from "drizzle-orm";
import { CALENDAR_AVAILABILITY_BFM_EMAIL } from "./calendar-availability-recognition";
import type { CalendarAvailabilityTrigger } from "./calendar-availability-reconciliation-runtime";
import { parseGoogleDateTimeInstant } from "../utils/google-calendar-time";
import { UK_TIME_ZONE } from "../utils/uk-wall-clock";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
export const BFM_EMAIL = process.env.BFM_CALENDAR_EMAIL ?? "info@brighterfuturemediation.co.uk";

const READ_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const CALENDAR_MANAGEMENT_SCOPE = "https://www.googleapis.com/auth/calendar";
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const USERINFO_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

const SCOPES = [WRITE_SCOPE, USERINFO_SCOPE];
const BFM_SCOPES = [WRITE_SCOPE, GMAIL_READONLY_SCOPE, USERINFO_SCOPE];

type GCalAttendee = {
  email?: string | null;
  displayName?: string | null;
  responseStatus?: string | null;
};

function isConfigured(): boolean {
  return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI);
}

function createOAuthClient() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

// BFM uses GOOGLE_REDIRECT_URI + "/bfm" (must be registered in Google Cloud).
function getBfmRedirectUri(): string {
  if (!GOOGLE_REDIRECT_URI) throw new Error("GOOGLE_REDIRECT_URI not configured");
  return `${GOOGLE_REDIRECT_URI.replace(/\/+$/, "")}/bfm`;
}

function createBfmOAuthClient() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    getBfmRedirectUri(),
  );
}

// Build attendee list for a recreated parent event during restore. Parses the
// JSON snapshot of original attendees and guarantees BFM_EMAIL is present.
function buildRestoreAttendees(
  snapshot: string | null | undefined,
): { email: string; displayName?: string }[] {
  if (!snapshot) return [{ email: BFM_EMAIL }];
  try {
    const parsed = JSON.parse(snapshot) as Array<{ email?: string; displayName?: string }>;
    if (!Array.isArray(parsed) || parsed.length === 0) return [{ email: BFM_EMAIL }];
    const cleaned = parsed
      .filter(a => typeof a?.email === "string" && a.email.length > 0)
      .map(a => ({ email: a.email as string, displayName: a.displayName }));
    if (!cleaned.some(a => a.email === BFM_EMAIL)) {
      cleaned.push({ email: BFM_EMAIL, displayName: "Brighter Future Mediation" });
    }
    return cleaned;
  } catch (err) {
    console.warn("[GoogleCalendar] Could not parse parentEventOriginalAttendees snapshot:", err);
    return [{ email: BFM_EMAIL }];
  }
}

function isBfmRelated(
  organizer: { email?: string | null } | undefined | null,
  attendees: GCalAttendee[] | undefined | null
): { relevant: boolean; isOrganiser: boolean; bfmAttendee: GCalAttendee | null } {
  const bfmEmailLc = BFM_EMAIL.toLowerCase();
  const acceptedBfmEmails = new Set([bfmEmailLc, CALENDAR_AVAILABILITY_BFM_EMAIL.toLowerCase()]);
  const orgEmail = (organizer?.email ?? "").toLowerCase();
  const isOrganiser = acceptedBfmEmails.has(orgEmail);
  const bfmAttendee = (attendees ?? []).find(a => acceptedBfmEmails.has((a.email ?? "").toLowerCase())) ?? null;
  return {
    relevant: isOrganiser || !!bfmAttendee,
    isOrganiser,
    bfmAttendee,
  };
}

export function hasWriteScope(scopeGranted: string | null | undefined): boolean {
  if (!scopeGranted) return false;
  const scopes = scopeGranted.split(/\s+/);
  // Either the events-only write scope or the broader full-calendar scope
  // grants permission to insert/patch/delete events on the user's calendar.
  return scopes.includes(WRITE_SCOPE) || scopes.includes(CALENDAR_MANAGEMENT_SCOPE);
}

export function hasGmailReadonlyScope(scopeGranted: string | null | undefined): boolean {
  if (!scopeGranted) return false;
  return scopeGranted.split(/\s+/).includes(GMAIL_READONLY_SCOPE);
}

export class GoogleCalendarService {
  isConfigured(): boolean {
    return isConfigured();
  }

  getOAuthUrl(state: string): string {
    const oauth2Client = createOAuthClient();
    return oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      state,
      prompt: "consent",
      include_granted_scopes: true,
    });
  }

  async exchangeCodeAndSave(
    mediatorId: string,
    code: string
  ): Promise<{ email: string; scope: string | null }> {
    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.access_token) {
      throw new Error("No access token received from Google");
    }

    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email ?? "";

    const expiresAt = tokens.expiry_date
      ? new Date(tokens.expiry_date)
      : new Date(Date.now() + 3600 * 1000);

    const grantedScope = tokens.scope ?? null;
    const grantedWrite = hasWriteScope(grantedScope);

    // Task #191 — Mirror the BFM COALESCE protection: a re-auth that omits
    // refresh_token (Google does this when the user has previously consented
    // and the token hasn't been revoked) must NOT wipe the previously stored
    // refresh token. Only include the field in the update when we have a value.
    const updatePayload: Parameters<typeof storage.updateUser>[1] = {
      googleAccessToken: tokens.access_token,
      // Only mark as connected when we have write scope — prevents booking from
      // silently returning zero slots for a "connected" mediator without edit perms.
      googleCalendarConnected: grantedWrite,
      googleCalendarEmail: email,
      googleTokenExpiresAt: expiresAt,
      googleScopeGranted: grantedScope,
      lastCalendarSyncError: grantedWrite ? null : "needs_write_scope",
    };
    if (tokens.refresh_token) {
      updatePayload.googleRefreshToken = tokens.refresh_token;
    }
    await storage.updateUser(mediatorId, updatePayload);

    return { email, scope: grantedScope };
  }

  private async getAuthenticatedClient(mediatorId: string) {
    const user = await storage.getUser(mediatorId);
    if (!user || !user.googleAccessToken) {
      throw new Error("Mediator not connected to Google Calendar");
    }

    const oauth2Client = createOAuthClient();
    const credentials: Record<string, string | number | null | undefined> = {
      access_token: user.googleAccessToken,
    };
    if (user.googleRefreshToken) credentials.refresh_token = user.googleRefreshToken;
    if (user.googleTokenExpiresAt) credentials.expiry_date = user.googleTokenExpiresAt.getTime();
    oauth2Client.setCredentials(credentials);

    oauth2Client.on("tokens", async (newTokens) => {
      const updateData: Parameters<typeof storage.updateUser>[1] = {};
      if (newTokens.access_token) updateData.googleAccessToken = newTokens.access_token;
      if (newTokens.expiry_date) updateData.googleTokenExpiresAt = new Date(newTokens.expiry_date);
      if (newTokens.refresh_token) updateData.googleRefreshToken = newTokens.refresh_token;
      if (Object.keys(updateData).length > 0) {
        await storage.updateUser(mediatorId, updateData);
      }
    });

    return oauth2Client;
  }

  async hasWriteAccess(mediatorId: string): Promise<boolean> {
    const user = await storage.getUser(mediatorId);
    if (!user || !user.googleCalendarConnected) return false;
    return hasWriteScope(user.googleScopeGranted);
  }

  async createAvailabilityWatch(
    mediatorId: string,
    input: { channelId: string; token: string; webhookUrl: string },
  ): Promise<{ resourceId: string; expiresAt: Date | null }> {
    const auth = await this.getAuthenticatedClient(mediatorId);
    const calendar = google.calendar({ version: "v3", auth });
    const expiration = Date.now() + 6 * 24 * 60 * 60 * 1000;
    const response = await calendar.events.watch({
      calendarId: "primary",
      requestBody: {
        id: input.channelId,
        type: "web_hook",
        address: input.webhookUrl,
        token: input.token,
        expiration: String(expiration),
      },
    });
    if (!response.data.resourceId) throw new Error("Google did not return a webhook resource ID");
    return {
      resourceId: response.data.resourceId,
      expiresAt: response.data.expiration ? new Date(Number(response.data.expiration)) : null,
    };
  }

  async syncCalendar(mediatorId: string, reconciliationTrigger: CalendarAvailabilityTrigger = "fallback_sweep"): Promise<{ syncedCount: number; reconciliation: import("./calendar-availability-reconciliation-runtime").CalendarAvailabilityReconciliationCounts }> {
    try {
      const result = await this._syncCalendarInternal(mediatorId, reconciliationTrigger);
      // Preserve needs_write_scope flag even on a successful read-only sync
      const user = await storage.getUser(mediatorId);
      const preserveFlag = user && !hasWriteScope(user.googleScopeGranted) ? "needs_write_scope" : null;
      await storage.updateUser(mediatorId, {
        lastCalendarSyncAt: new Date(),
        lastCalendarSyncError: preserveFlag,
      });
      return result;
    } catch (err: unknown) {
      const errorCode = this._classifyError(err);
      if (errorCode === "needs_reauth") {
        // Task #191 — Helper MUST run FIRST so its atomic compare-and-set
        // wins the transition out of the healthy state and triggers the
        // first-flip fan-out (audit + email + in-app notification). Any
        // pre-write of lastCalendarSyncError='needs_reauth' here would mask
        // the flip and silently swallow the notification.
        try {
          const { markMediatorNeedsReauthAndNotify } = await import("./calendar-reauth.service");
          await markMediatorNeedsReauthAndNotify(mediatorId, errorCode, "sync");
        } catch (notifyErr) {
          console.error("[syncCalendar] reauth fan-out failed:", notifyErr);
        }
        // Stamp the sync timestamp + clear the access token only (keep the
        // refresh token in place — preserves the "reauth required" vs "never
        // connected" distinction the UI relies on, and gives the user the
        // option to recover without losing audit-trail context).
        await storage.updateUser(mediatorId, {
          googleAccessToken: null,
          googleTokenExpiresAt: null,
          lastCalendarSyncAt: new Date(),
        });
      } else {
        await storage.updateUser(mediatorId, {
          lastCalendarSyncAt: new Date(),
          lastCalendarSyncError: errorCode,
        });
      }
      throw err;
    }
  }

  /**
   * Task #191 — Lightweight liveness probe for a single mediator's Google
   * token. Calls oAuth2Client.getAccessToken() (no calendar API quota cost)
   * to force a refresh attempt. On invalid_grant flips the user to
   * needs_reauth without waiting for the next booking/sync to discover it.
   * Returns { ok, needsReauth, error? } so the sweep caller can fan out
   * email + in-app notifications.
   */
  async probeMediatorToken(mediatorId: string): Promise<{ ok: boolean; needsReauth: boolean; firstFlip: boolean; error?: string }> {
    const user = await storage.getUser(mediatorId);
    if (!user || !user.googleRefreshToken) {
      return { ok: false, needsReauth: false, firstFlip: false, error: "no_refresh_token" };
    }
    try {
      const oauth2Client = createOAuthClient();
      const credentials: Record<string, string | number | null | undefined> = {
        access_token: user.googleAccessToken ?? undefined,
        refresh_token: user.googleRefreshToken,
      };
      if (user.googleTokenExpiresAt) credentials.expiry_date = user.googleTokenExpiresAt.getTime();
      oauth2Client.setCredentials(credentials);
      // Persist any rotated tokens the refresh emits.
      oauth2Client.on("tokens", async (newTokens) => {
        const updateData: Parameters<typeof storage.updateUser>[1] = {};
        if (newTokens.access_token) updateData.googleAccessToken = newTokens.access_token;
        if (newTokens.expiry_date) updateData.googleTokenExpiresAt = new Date(newTokens.expiry_date);
        if (newTokens.refresh_token) updateData.googleRefreshToken = newTokens.refresh_token;
        if (Object.keys(updateData).length > 0) {
          await storage.updateUser(mediatorId, updateData).catch(() => undefined);
        }
      });
      await oauth2Client.getAccessToken();
      // Healthy: clear stale needs_reauth flag if it was set.
      if (user.lastCalendarSyncError === "needs_reauth") {
        await storage.updateUser(mediatorId, { lastCalendarSyncError: null });
      }
      return { ok: true, needsReauth: false, firstFlip: false };
    } catch (err) {
      const errorCode = this._classifyError(err);
      const needsReauth = errorCode === "needs_reauth";
      let firstFlip = false;
      if (needsReauth) {
        // Delegate to the shared reauth fan-out helper — atomic compare-and-
        // set ensures only one caller (probe / sync / booking) wins the flip
        // and triggers email + notification + audit.
        const { markMediatorNeedsReauthAndNotify } = await import("./calendar-reauth.service");
        const r = await markMediatorNeedsReauthAndNotify(mediatorId, errorCode, "probe");
        firstFlip = r.firstFlip;
      }
      return { ok: !needsReauth, needsReauth, firstFlip, error: errorCode };
    }
  }

  /**
   * Task #191 — Same liveness probe for the BFM info@ row. Cheap getAccessToken
   * call, no calendar API quota. Distinct from bfmHealthCheck (which lists
   * events) so the 15-min sweep can fire often without burning quota.
   */
  async probeBfmToken(): Promise<{ ok: boolean; needsReauth: boolean; firstFlip: boolean; error?: string }> {
    const conn = await this.getBfmConnection();
    if (!conn || !conn.googleRefreshToken) {
      return { ok: false, needsReauth: false, firstFlip: false, error: "no_refresh_token" };
    }
    try {
      const oauth2Client = createBfmOAuthClient();
      const credentials: Record<string, string | number | null | undefined> = {
        access_token: conn.googleAccessToken ?? undefined,
        refresh_token: conn.googleRefreshToken,
      };
      if (conn.googleTokenExpiresAt) credentials.expiry_date = conn.googleTokenExpiresAt.getTime();
      oauth2Client.setCredentials(credentials);
      oauth2Client.on("tokens", async (newTokens) => {
        const update: Record<string, unknown> = { updatedAt: new Date() };
        if (newTokens.access_token) update.googleAccessToken = newTokens.access_token;
        if (newTokens.expiry_date) update.googleTokenExpiresAt = new Date(newTokens.expiry_date);
        if (newTokens.refresh_token) update.googleRefreshToken = newTokens.refresh_token;
        if (Object.keys(update).length > 1) {
          await db
            .update(bfmCalendarConnection)
            .set(update)
            .where(eq(bfmCalendarConnection.id, GoogleCalendarService.BFM_ROW_ID))
            .catch(() => undefined);
        }
      });
      await oauth2Client.getAccessToken();
      if (conn.lastHealthCheckError === "needs_reauth") {
        await db
          .update(bfmCalendarConnection)
          .set({ lastHealthCheckError: null, updatedAt: new Date() })
          .where(eq(bfmCalendarConnection.id, GoogleCalendarService.BFM_ROW_ID));
      }
      return { ok: true, needsReauth: false, firstFlip: false };
    } catch (err) {
      const errorCode = this._classifyError(err);
      const needsReauth = errorCode === "needs_reauth";
      let firstFlip = false;
      if (needsReauth) {
        const { markBfmNeedsReauthAndNotify } = await import("./calendar-reauth.service");
        const r = await markBfmNeedsReauthAndNotify(errorCode, "probe");
        firstFlip = r.firstFlip;
      }
      return { ok: !needsReauth, needsReauth, firstFlip, error: errorCode };
    }
  }

  private _classifyError(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    const anyErr = err as { response?: { data?: { error?: string } }; code?: string | number };
    const oauthError = anyErr?.response?.data?.error;
    if (oauthError === "invalid_grant" || /invalid_grant/i.test(message)) {
      return "needs_reauth";
    }
    return message.slice(0, 250);
  }

  private async _syncCalendarInternal(
    mediatorId: string,
    reconciliationTrigger: CalendarAvailabilityTrigger,
  ): Promise<{ syncedCount: number; reconciliation: import("./calendar-availability-reconciliation-runtime").CalendarAvailabilityReconciliationCounts }> {
    const auth = await this.getAuthenticatedClient(mediatorId);
    const calendar = google.calendar({ version: "v3", auth });

    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const ninetyDaysAhead = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    logger.info(
      `Starting sync for mediator ${mediatorId.slice(0, 8)}: window ${ninetyDaysAgo.toISOString()} to ${ninetyDaysAhead.toISOString()}`,
      undefined,
      "GoogleCalendar",
    );

    const items: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;
    do {
      const eventsRes = await calendar.events.list({
        calendarId: "primary",
        timeMin: ninetyDaysAgo.toISOString(),
        timeMax: ninetyDaysAhead.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 2500,
        pageToken,
      });
      items.push(...(eventsRes.data.items ?? []));
      pageToken = eventsRes.data.nextPageToken ?? undefined;
    } while (pageToken);

    const allUsers = await storage.listUsers();
    const bfmStaffEmails = new Set<string>(
      allUsers
        .filter(u =>
          u.status === "active" &&
          (u.role === "mediator" || u.role === "superadmin" || u.role === "subadmin")
        )
        .flatMap(u => [
          u.email.toLowerCase(),
          ...(u.googleCalendarEmail ? [u.googleCalendarEmail.toLowerCase()] : []),
        ])
    );

    // Build email → user map for the Google-side auto-accept patch
    const emailToUser = new Map<string, typeof allUsers[number]>();
    for (const u of allUsers) {
      if (u.email) emailToUser.set(u.email.toLowerCase(), u);
      if (u.googleCalendarEmail) emailToUser.set(u.googleCalendarEmail.toLowerCase(), u);
    }

    const toUpsert: InsertGoogleCalendarEvent[] = [];
    for (const item of items) {
      if (!item.id) continue;
      if (item.status === "cancelled") continue;

      const itemAttendees: GCalAttendee[] = item.attendees ?? [];
      const { relevant, isOrganiser, bfmAttendee } = isBfmRelated(item.organizer, itemAttendees);
      if (!relevant) continue;

      const isAllDay = !!(item.start?.date && !item.start?.dateTime);

      let startAt: Date;
      let endAt: Date;

      if (isAllDay) {
        const startDate = item.start?.date;
        const endDate = item.end?.date;
        if (!startDate || !endDate) continue;
        startAt = new Date(startDate + "T00:00:00Z");
        endAt = new Date(endDate + "T00:00:00Z");
      } else {
        const startDateTime = item.start?.dateTime;
        const endDateTime = item.end?.dateTime;
        if (!startDateTime || !endDateTime) continue;
        try {
          startAt = parseGoogleDateTimeInstant(startDateTime, item.start?.timeZone);
          endAt = parseGoogleDateTimeInstant(endDateTime, item.end?.timeZone);
        } catch (err) {
          console.warn(`[GoogleCalendar] Skipping event ${item.id} with invalid dateTime:`, err);
          continue;
        }
      }

      const organiserEmail = (item.organizer?.email ?? "").toLowerCase();
      const organiserIsBfmStaff = !!organiserEmail && bfmStaffEmails.has(organiserEmail);

      // ── Google-side auto-accept ────────────────────────────────────────────
      // If a BFM staff member organised this event and the BFM mailbox is still
      // needsAction, patch the event on Google (using the organiser's own token)
      // so info@ shows as Accepted in Google itself, not just in our DB.
      let effectiveItemAttendees = itemAttendees;
      if (
        organiserIsBfmStaff &&
        bfmAttendee &&
        bfmAttendee.responseStatus !== "accepted" &&
        item.id
      ) {
        const organiserUser = emailToUser.get(organiserEmail);
        if (
          organiserUser &&
          organiserUser.googleCalendarConnected &&
          hasWriteScope(organiserUser.googleScopeGranted)
        ) {
          try {
            const organiserAuth = await this.getAuthenticatedClient(organiserUser.id);
            const organiserCalendar = google.calendar({ version: "v3", auth: organiserAuth });
            const bfmEmailLc = BFM_EMAIL.toLowerCase();
            const updatedAttendees = itemAttendees.map(a => ({
              email: a.email ?? "",
              ...(a.displayName ? { displayName: a.displayName } : {}),
              responseStatus: (a.email ?? "").toLowerCase() === bfmEmailLc ? "accepted" : (a.responseStatus ?? "needsAction"),
            }));
            await organiserCalendar.events.patch({
              calendarId: "primary",
              eventId: item.id,
              sendUpdates: "none",
              requestBody: { attendees: updatedAttendees },
            });
            logAudit({
              action: "update",
              entity: "google_calendar_event",
              entityId: organiserUser.id,
              details: JSON.stringify({
                op: "bfm_auto_accept_google_patch",
                googleEventId: item.id,
                organiserId: organiserUser.id,
                organiserEmail,
              }),
            });
            // Re-read from Google so stored attendees reflect the actual API state
            try {
              const refreshed = await organiserCalendar.events.get({
                calendarId: "primary",
                eventId: item.id,
              });
              effectiveItemAttendees = (refreshed.data.attendees ?? []).map(a => ({
                email: a.email ?? "",
                displayName: a.displayName ?? undefined,
                responseStatus: a.responseStatus ?? "needsAction",
              }));
            } catch (getErr) {
              // Re-read failed — fall back to local mutation which is functionally correct
              effectiveItemAttendees = itemAttendees.map(a =>
                (a.email ?? "").toLowerCase() === bfmEmailLc ? { ...a, responseStatus: "accepted" } : a
              );
            }
          } catch (patchErr) {
            logAudit({
              action: "update",
              entity: "google_calendar_event",
              entityId: mediatorId,
              details: JSON.stringify({
                op: "bfm_auto_accept_google_patch_failed",
                googleEventId: item.id,
                organiserEmail,
                error: (patchErr as Error)?.message ?? String(patchErr),
              }),
            });
            // Fall through — internal bfmAttendanceStatus override still covers the side panel
          }
        }
      }
      // ────────────────────────────────────────────────────────────────────────

      const attendees = effectiveItemAttendees.map(a => ({
        email: a.email ?? "",
        displayName: a.displayName ?? undefined,
        responseStatus: a.responseStatus ?? "needsAction",
      }));

      let bfmAttendanceStatus: string;
      if (isOrganiser) {
        bfmAttendanceStatus = "organiser";
      } else if (organiserIsBfmStaff && bfmAttendee) {
        bfmAttendanceStatus = "accepted";
      } else {
        bfmAttendanceStatus = bfmAttendee?.responseStatus ?? "needsAction";
      }

      toUpsert.push({
        mediatorId,
        googleEventId: item.id,
        externalSeriesId: item.recurringEventId ?? null,
        organizerEmail: item.organizer?.email ?? null,
        title: item.summary ?? null,
        startAt,
        endAt,
        isAllDay,
        attendees,
        bfmAttendanceStatus,
        isOrganiser,
        syncedAt: new Date(),
      });
    }

    await storage.upsertGoogleCalendarEvents(toUpsert);

    const keptIds = toUpsert.map(e => e.googleEventId);
    await storage.deleteStaleGoogleCalendarEventsInRange(mediatorId, keptIds, ninetyDaysAgo, ninetyDaysAhead);
    const { reconcileMediatorCalendarAvailability } = await import("./calendar-availability-reconciliation-runtime");
    const reconciliation = await reconcileMediatorCalendarAvailability(mediatorId, "google", reconciliationTrigger);

    logger.info(
      `Sync complete for mediator ${mediatorId.slice(0, 8)}: ${toUpsert.length} event(s) upserted in window ${ninetyDaysAgo.toISOString()} to ${ninetyDaysAhead.toISOString()}`,
      undefined,
      "GoogleCalendar",
    );

    return { syncedCount: toUpsert.length, reconciliation };
  }

  async disconnectCalendar(mediatorId: string): Promise<void> {
    const { deactivateImportedCalendarAvailabilityForDisconnect } = await import("./calendar-availability-reconciliation-runtime");
    await deactivateImportedCalendarAvailabilityForDisconnect(mediatorId, "google");
    await storage.deleteGoogleCalendarEventsByMediator(mediatorId);
    await db.update(calendarWebhookSubscriptions).set({ status: "disconnected", updatedAt: new Date() }).where(and(
      eq(calendarWebhookSubscriptions.mediatorId, mediatorId),
      eq(calendarWebhookSubscriptions.provider, "google"),
    ));
    const user = await storage.getUser(mediatorId);
    await storage.updateUser(mediatorId, {
      googleAccessToken: null,
      googleRefreshToken: null,
      googleCalendarConnected: false,
      googleCalendarEmail: null,
      googleTokenExpiresAt: null,
      googleScopeGranted: null,
      // Clear scope-error flag so mediator returns to normal manual-availability
      // state. Without this, a mediator who disconnects after being flagged with
      // "needs_write_scope" would remain permanently unbookable.
      lastCalendarSyncError: null,
      lastCalendarSyncAt: null,
      activeCalendarProvider: user?.outlookCalendarConnected ? "outlook" : null,
    });
  }

  async getEventsByDateRange(mediatorId: string, start: Date, end: Date) {
    return storage.listGoogleCalendarEventsByDateRange(mediatorId, start, end);
  }

  async getEventById(mediatorId: string, googleEventId: string): Promise<{
    id: string;
    summary: string | null;
    start: Date;
    end: Date;
    isAllDay: boolean;
    attendees: { email: string; displayName?: string; responseStatus?: string }[];
    organizerEmail: string | null;
    htmlLink: string | null;
  } | null> {
    const auth = await this.getAuthenticatedClient(mediatorId);
    const calendar = google.calendar({ version: "v3", auth });
    try {
      const res = await calendar.events.get({ calendarId: "primary", eventId: googleEventId });
      const item = res.data;
      if (!item || item.status === "cancelled") return null;
      const startStr = item.start?.dateTime ?? item.start?.date;
      const endStr = item.end?.dateTime ?? item.end?.date;
      if (!startStr || !endStr) return null;
      return {
        id: item.id ?? googleEventId,
        summary: item.summary ?? null,
        start: new Date(startStr),
        end: new Date(endStr),
        isAllDay: !!(item.start?.date && !item.start?.dateTime),
        attendees: (item.attendees ?? []).map(a => ({
          email: a.email ?? "",
          displayName: a.displayName ?? undefined,
          responseStatus: a.responseStatus ?? undefined,
        })),
        organizerEmail: item.organizer?.email ?? null,
        htmlLink: item.htmlLink ?? null,
      };
    } catch (err) {
      // Distinguish "not found / gone" (event truly absent) from transient
      // errors (network, auth, quota). Callers that need fail-safe behaviour
      // should use getEventByIdStrict instead.
      const status = (err as { code?: number; status?: number; response?: { status?: number } })?.code
        ?? (err as { status?: number })?.status
        ?? (err as { response?: { status?: number } })?.response?.status;
      if (status === 404 || status === 410) return null;
      // For non-404/410, fall through to null for backward compatibility but
      // log so transient failures aren't silently masked.
      console.warn(`[GoogleCalendar] getEventById transient error for event ${googleEventId}:`, err);
      return null;
    }
  }

  /**
   * Strict variant of getEventById: returns "missing" only on 404/410, and
   * throws on transient errors so callers can avoid making destructive
   * decisions (e.g. recreating a parent event) on incomplete information.
   */
  async getEventByIdStrict(mediatorId: string, googleEventId: string): Promise<
    | { kind: "found"; event: NonNullable<Awaited<ReturnType<GoogleCalendarService["getEventById"]>>> }
    | { kind: "missing" }
  > {
    const auth = await this.getAuthenticatedClient(mediatorId);
    const calendar = google.calendar({ version: "v3", auth });
    try {
      const res = await calendar.events.get({ calendarId: "primary", eventId: googleEventId });
      const item = res.data;
      if (!item || item.status === "cancelled") return { kind: "missing" };
      const startStr = item.start?.dateTime ?? item.start?.date;
      const endStr = item.end?.dateTime ?? item.end?.date;
      if (!startStr || !endStr) return { kind: "missing" };
      return {
        kind: "found",
        event: {
          id: item.id ?? googleEventId,
          summary: item.summary ?? null,
          start: new Date(startStr),
          end: new Date(endStr),
          isAllDay: !!(item.start?.date && !item.start?.dateTime),
          attendees: (item.attendees ?? []).map(a => ({
            email: a.email ?? "",
            displayName: a.displayName ?? undefined,
            responseStatus: a.responseStatus ?? undefined,
          })),
          organizerEmail: item.organizer?.email ?? null,
          htmlLink: item.htmlLink ?? null,
        },
      };
    } catch (err) {
      const status = (err as { code?: number; status?: number; response?: { status?: number } })?.code
        ?? (err as { status?: number })?.status
        ?? (err as { response?: { status?: number } })?.response?.status;
      if (status === 404 || status === 410) return { kind: "missing" };
      throw err;
    }
  }

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
    }
  ): Promise<string> {
    const auth = await this.getAuthenticatedClient(mediatorId);
    const calendar = google.calendar({ version: "v3", auth });
    let res;
    try {
      res = await calendar.events.insert({
        calendarId: "primary",
        sendUpdates: "none",
        requestBody: {
          summary: data.summary,
          description: data.description,
          location: data.location,
          start: data.allDayStart ? { date: data.allDayStart } : { dateTime: data.start.toISOString() },
          end: data.allDayEndExclusive ? { date: data.allDayEndExclusive } : { dateTime: data.end.toISOString() },
          attendees: data.attendees,
        },
      });
    } catch (err) {
      logAudit({
        action: "create",
        entity: "google_calendar_event",
        entityId: mediatorId,
        details: JSON.stringify({
          op: "google_api_insert_failed",
          summary: data.summary,
          start: data.start.toISOString(),
          end: data.end.toISOString(),
          error: (err as Error)?.message ?? String(err),
        }),
      });
      throw err;
    }
    if (!res.data.id) throw new Error("Google did not return event ID after insert");
    logAudit({
      action: "create",
      entity: "google_calendar_event",
      entityId: mediatorId,
      details: JSON.stringify({
        op: "google_api_insert",
        googleEventId: res.data.id,
        summary: data.summary,
        start: data.start.toISOString(),
        end: data.end.toISOString(),
        attendeeEmails: (data.attendees ?? []).map(a => a.email),
      }),
    });
    return res.data.id;
  }

  async patchEvent(
    mediatorId: string,
    googleEventId: string,
    patch: { summary?: string; start?: Date; end?: Date; description?: string; allDayStart?: string; allDayEndExclusive?: string }
  ): Promise<void> {
    const auth = await this.getAuthenticatedClient(mediatorId);
    const calendar = google.calendar({ version: "v3", auth });
    const requestBody: Record<string, unknown> = {};
    if (patch.summary !== undefined) requestBody.summary = patch.summary;
    if (patch.description !== undefined) requestBody.description = patch.description;
    if (patch.allDayStart) requestBody.start = { date: patch.allDayStart };
    else if (patch.start) requestBody.start = { dateTime: patch.start.toISOString() };
    if (patch.allDayEndExclusive) requestBody.end = { date: patch.allDayEndExclusive };
    else if (patch.end) requestBody.end = { dateTime: patch.end.toISOString() };
    try {
      await calendar.events.patch({
        calendarId: "primary",
        eventId: googleEventId,
        sendUpdates: "none",
        requestBody,
      });
    } catch (err) {
      logAudit({
        action: "update",
        entity: "google_calendar_event",
        entityId: mediatorId,
        details: JSON.stringify({
          op: "google_api_patch_failed",
          googleEventId,
          patch: {
            summary: patch.summary,
            start: patch.start?.toISOString(),
            end: patch.end?.toISOString(),
          },
          error: (err as Error)?.message ?? String(err),
        }),
      });
      throw err;
    }
    logAudit({
      action: "update",
      entity: "google_calendar_event",
      entityId: mediatorId,
      details: JSON.stringify({
        op: "google_api_patch",
        googleEventId,
        patch: {
          summary: patch.summary,
          start: patch.start?.toISOString(),
          end: patch.end?.toISOString(),
        },
      }),
    });
  }

  async syncMediatorBookingEventAttendees(
    mediatorId: string,
    googleEventId: string,
    changes: {
      add?: Array<{ email: string; displayName?: string; optional?: boolean }>;
      removeEmails?: string[];
    },
  ): Promise<void> {
    const auth = await this.getAuthenticatedClient(mediatorId);
    const calendar = google.calendar({ version: "v3", auth });
    const add = (changes.add ?? []).filter((attendee) => attendee.email);
    const removeEmails = new Set((changes.removeEmails ?? []).map((email) => email.toLowerCase()));
    try {
      const current = await calendar.events.get({ calendarId: "primary", eventId: googleEventId });
      const attendees = [...(current.data.attendees ?? [])];
      const byEmail = new Map(attendees.map((attendee) => [(attendee.email ?? "").toLowerCase(), attendee]));

      for (const email of Array.from(removeEmails)) {
        byEmail.delete(email);
      }
      for (const attendee of add) {
        const key = attendee.email.toLowerCase();
        byEmail.set(key, {
          ...byEmail.get(key),
          email: attendee.email,
          displayName: attendee.displayName,
          optional: attendee.optional,
        });
      }

      await calendar.events.patch({
        calendarId: "primary",
        eventId: googleEventId,
        sendUpdates: "all",
        requestBody: { attendees: Array.from(byEmail.values()) },
      });
      logAudit({
        action: "update",
        entity: "google_calendar_event",
        entityId: mediatorId,
        details: JSON.stringify({
          op: "google_api_sync_attendees",
          googleEventId,
          addedEmails: add.map((attendee) => attendee.email),
          removedEmails: Array.from(removeEmails),
        }),
      });
    } catch (err) {
      logAudit({
        action: "update",
        entity: "google_calendar_event",
        entityId: mediatorId,
        details: JSON.stringify({
          op: "google_api_sync_attendees_failed",
          googleEventId,
          addedEmails: add.map((attendee) => attendee.email),
          removedEmails: Array.from(removeEmails),
          error: (err as Error)?.message ?? String(err),
        }),
      });
      throw err;
    }
  }

  async deleteEvent(mediatorId: string, googleEventId: string): Promise<void> {
    const auth = await this.getAuthenticatedClient(mediatorId);
    const calendar = google.calendar({ version: "v3", auth });
    try {
      await calendar.events.delete({
        calendarId: "primary",
        eventId: googleEventId,
        sendUpdates: "none",
      });
      logAudit({
        action: "delete",
        entity: "google_calendar_event",
        entityId: mediatorId,
        details: JSON.stringify({ op: "google_api_delete", googleEventId }),
      });
    } catch (err: unknown) {
      const status = (err as { code?: number; response?: { status?: number } })?.code
        ?? (err as { response?: { status?: number } })?.response?.status;
      if (status === 404 || status === 410) {
        logAudit({
          action: "delete",
          entity: "google_calendar_event",
          entityId: mediatorId,
          details: JSON.stringify({ op: "google_api_delete_already_gone", googleEventId, status }),
        });
        return;
      }
      logAudit({
        action: "delete",
        entity: "google_calendar_event",
        entityId: mediatorId,
        details: JSON.stringify({
          op: "google_api_delete_failed",
          googleEventId,
          error: (err as Error)?.message ?? String(err),
        }),
      });
      throw err;
    }
  }

  /**
   * Split a Google availability event around a booked window.
   * Returns the IDs of the new BFM Booking event and any trailing remnant.
   *
   * Cases:
   *  - Booking exactly fills parent: delete parent, create booking event only.
   *  - Booking at start: delete parent, create booking + trailing remnant.
   *  - Booking at end: shrink parent, create booking only.
   *  - Booking in middle: shrink parent (lead remnant), create booking + trailing remnant.
   */
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
    parentAttendees?: { email: string; displayName?: string }[]
  ): Promise<{ googleBookingEventId: string; googleTrailingRemnantEventId: string | null }> {
    const remnantAttendees: { email: string; displayName?: string }[] =
      parentAttendees && parentAttendees.length > 0
        ? parentAttendees
        : [{ email: BFM_EMAIL }];
    const parentStartMs = parentStart.getTime();
    const parentEndMs = parentEnd.getTime();
    const bookStartMs = booking.start.getTime();
    const bookEndMs = booking.end.getTime();

    if (bookStartMs < parentStartMs || bookEndMs > parentEndMs) {
      throw new Error("Booking window is outside parent event window");
    }

    const exactFill = bookStartMs === parentStartMs && bookEndMs === parentEndMs;
    const atStart = bookStartMs === parentStartMs;
    const atEnd = bookEndMs === parentEndMs;

    let bookingEventId: string;
    let trailingRemnantId: string | null = null;

    // Track compensating actions to roll back on failure
    type Compensation = () => Promise<void>;
    const compensations: Compensation[] = [];
    const safeCompensate = async () => {
      // Run in reverse so latest mutation undone first
      for (let i = compensations.length - 1; i >= 0; i--) {
        try { await compensations[i](); } catch (cErr) {
          console.error("[GoogleCalendar] Compensation step failed (manual cleanup may be needed):", cErr);
        }
      }
    };

    const recreateParent = async () => {
      try {
        await this.createEvent(mediatorId, {
          summary: parentTitle ?? "Available",
          start: parentStart,
          end: parentEnd,
          attendees: remnantAttendees,
        });
      } catch (cErr) {
        console.error("[GoogleCalendar] Failed to recreate parent during rollback:", cErr);
      }
    };
    const restoreParentEnd = async () => {
      try {
        await this.patchEvent(mediatorId, parentGoogleEventId, { end: parentEnd });
      } catch (cErr) {
        console.error("[GoogleCalendar] Failed to restore parent end during rollback:", cErr);
      }
    };

    try {
      if (exactFill) {
        await this.deleteEvent(mediatorId, parentGoogleEventId);
        compensations.push(recreateParent);
        bookingEventId = await this.createEvent(mediatorId, {
          summary: booking.summary,
          description: booking.description,
          start: booking.start,
          end: booking.end,
          attendees: booking.attendees,
          location: booking.location,
        });
      } else if (atStart) {
        await this.deleteEvent(mediatorId, parentGoogleEventId);
        compensations.push(recreateParent);
        bookingEventId = await this.createEvent(mediatorId, {
          summary: booking.summary,
          description: booking.description,
          start: booking.start,
          end: booking.end,
          attendees: booking.attendees,
          location: booking.location,
        });
        const createdBookingId = bookingEventId;
        compensations.push(async () => { await this.deleteEvent(mediatorId, createdBookingId); });
        trailingRemnantId = await this.createEvent(mediatorId, {
          summary: parentTitle ?? "Available",
          start: booking.end,
          end: parentEnd,
          attendees: remnantAttendees,
        });
      } else if (atEnd) {
        await this.patchEvent(mediatorId, parentGoogleEventId, { end: booking.start });
        compensations.push(restoreParentEnd);
        bookingEventId = await this.createEvent(mediatorId, {
          summary: booking.summary,
          description: booking.description,
          start: booking.start,
          end: booking.end,
          attendees: booking.attendees,
          location: booking.location,
        });
      } else {
        // middle
        await this.patchEvent(mediatorId, parentGoogleEventId, { end: booking.start });
        compensations.push(restoreParentEnd);
        bookingEventId = await this.createEvent(mediatorId, {
          summary: booking.summary,
          description: booking.description,
          start: booking.start,
          end: booking.end,
          attendees: booking.attendees,
          location: booking.location,
        });
        const createdBookingId = bookingEventId;
        compensations.push(async () => { await this.deleteEvent(mediatorId, createdBookingId); });
        trailingRemnantId = await this.createEvent(mediatorId, {
          summary: parentTitle ?? "Available",
          start: booking.end,
          end: parentEnd,
          attendees: remnantAttendees,
        });
      }
    } catch (err) {
      await safeCompensate();
      logAudit({
        action: "update",
        entity: "google_calendar",
        entityId: mediatorId,
        details: JSON.stringify({
          op: "split_failed",
          parentGoogleEventId,
          appointmentId: appointmentIdForAudit,
          error: err instanceof Error ? err.message : String(err),
        }),
      });
      throw err;
    }

    logAudit({
      action: "update",
      entity: "google_calendar",
      entityId: mediatorId,
      details: JSON.stringify({
        op: "split_booking",
        parentGoogleEventId,
        appointmentId: appointmentIdForAudit,
        bookingEventId,
        trailingRemnantId,
        exactFill,
        atStart,
        atEnd,
      }),
    });

    return { googleBookingEventId: bookingEventId, googleTrailingRemnantEventId: trailingRemnantId };
  }

  // Restore the original Google parent event after a booking is cancelled,
  // expired, rescheduled, or deleted. Pre-flight is read-only; on transient
  // failures returns aborted=true with no Google writes performed. Then
  // attempts parent restore first, deletes booking/remnant after.
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
    const isGoneError = (err: unknown): boolean => {
      const status = (err as { code?: number; status?: number; response?: { status?: number } })?.code
        ?? (err as { status?: number })?.status
        ?? (err as { response?: { status?: number } })?.response?.status;
      return status === 404 || status === 410;
    };

    // PRE-FLIGHT: read-only checks. Transient failures abort with aborted=true.
    let liveAppts;
    try {
      liveAppts = await storage.listAppointmentsByMediatorAndDateRange(
        mediatorId,
        info.parentEventOriginalStart,
        info.parentEventOriginalEnd,
      );
    } catch (err) {
      console.error("[GoogleCalendar] Failed to query live appointments during restore:", err);
      logAudit({
        action: "update",
        entity: "google_calendar",
        entityId: mediatorId,
        details: JSON.stringify({
          op: "restore_after_cancel_aborted",
          parentGoogleEventId: info.parentGoogleEventId,
          appointmentId: appointmentIdForAudit,
          reason: "DB query for live appointments failed (no Google writes performed)",
        }),
      });
      return { restoredParentId: null, aborted: true };
    }

    const parentLookup = await this.getEventByIdStrict(mediatorId, info.parentGoogleEventId)
      .catch(err => {
        console.error("[GoogleCalendar] Strict parent lookup failed during restore:", err);
        return { kind: "transient" as const };
      });

    if ((parentLookup as { kind: string }).kind === "transient") {
      logAudit({
        action: "update",
        entity: "google_calendar",
        entityId: mediatorId,
        details: JSON.stringify({
          op: "restore_after_cancel_aborted",
          parentGoogleEventId: info.parentGoogleEventId,
          appointmentId: appointmentIdForAudit,
          reason: "transient API error looking up parent event (no Google writes performed)",
        }),
      });
      return { restoredParentId: null, aborted: true };
    }

    const parentExists = parentLookup.kind === "found";

    const blockerRanges = liveAppts
      .filter(a => a.id !== excludeAppointmentId
        && a.id !== appointmentIdForAudit
        && a.status !== "cancelled"
        && a.status !== "expired")
      .map(a => {
        const s = new Date(a.dateTime);
        return { start: s, end: new Date(s.getTime() + a.duration * 60000) };
      })
      .filter(r => r.end.getTime() > info.parentEventOriginalStart.getTime()
        && r.start.getTime() < info.parentEventOriginalEnd.getTime())
      .map(r => ({
        start: new Date(Math.max(r.start.getTime(), info.parentEventOriginalStart.getTime())),
        end: new Date(Math.min(r.end.getTime(), info.parentEventOriginalEnd.getTime())),
      }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    const mergedBlockers: { start: Date; end: Date }[] = [];
    for (const r of blockerRanges) {
      const last = mergedBlockers[mergedBlockers.length - 1];
      if (last && r.start.getTime() <= last.end.getTime()) {
        if (r.end.getTime() > last.end.getTime()) last.end = r.end;
      } else {
        mergedBlockers.push({ ...r });
      }
    }

    const gaps: { start: Date; end: Date }[] = [];
    let cursor = info.parentEventOriginalStart;
    for (const b of mergedBlockers) {
      if (b.start.getTime() > cursor.getTime()) {
        gaps.push({ start: cursor, end: b.start });
      }
      if (b.end.getTime() > cursor.getTime()) cursor = b.end;
      if (cursor.getTime() >= info.parentEventOriginalEnd.getTime()) break;
    }
    if (cursor.getTime() < info.parentEventOriginalEnd.getTime()) {
      gaps.push({ start: cursor, end: info.parentEventOriginalEnd });
    }

    // WRITES — order: critical parent restore FIRST. If it fails, abort
    // BEFORE any deletes so callers can refuse the DB transition without
    // having mutated Google. Deletes of the BFM Booking and remnant run
    // afterwards as best-effort cleanup; their failures only leave benign
    // booked appointment events behind, which the availability filter excludes
    // from window detection.

    let restoredParentId: string | null = null;
    let parentWriteFailed = false;
    let cleanupFailed = false;

    if (gaps.length === 0) {
      if (parentExists) {
        try {
          await this.deleteEvent(mediatorId, info.parentGoogleEventId);
        } catch (err) {
          if (!isGoneError(err)) {
            console.error("[GoogleCalendar] delete fully-occupied parent failed:", err);
            parentWriteFailed = true;
          }
        }
      }
    } else {
      const [firstGap, ...restGaps] = gaps;
      try {
        if (parentExists) {
          await this.patchEvent(mediatorId, info.parentGoogleEventId, {
            start: firstGap.start,
            end: firstGap.end,
          });
          restoredParentId = info.parentGoogleEventId;
        } else {
          restoredParentId = await this.createEvent(mediatorId, {
            summary: info.parentEventOriginalTitle ?? "Available",
            start: firstGap.start,
            end: firstGap.end,
            attendees: buildRestoreAttendees(info.parentEventOriginalAttendees),
          });
        }
      } catch (err) {
        console.error("[GoogleCalendar] restore parent for first gap failed:", err);
        parentWriteFailed = true;
      }

      if (!parentWriteFailed) {
        for (const g of restGaps) {
          try {
            await this.createEvent(mediatorId, {
              summary: info.parentEventOriginalTitle ?? "Available",
              start: g.start,
              end: g.end,
              attendees: buildRestoreAttendees(info.parentEventOriginalAttendees),
            });
          } catch (err) {
            console.error("[GoogleCalendar] create gap availability event failed:", err);
            parentWriteFailed = true;
          }
        }
      }
    }

    // If parent restore failed, abort BEFORE deleting the booking/remnant —
    // this preserves the original Google state so the caller can keep the
    // appointment active and a retry/sync can reconcile.
    if (parentWriteFailed) {
      logAudit({
        action: "update",
        entity: "google_calendar",
        entityId: mediatorId,
        details: JSON.stringify({
          op: "restore_after_cancel_aborted",
          parentGoogleEventId: info.parentGoogleEventId,
          appointmentId: appointmentIdForAudit,
          reason: "parent restore write failed (booking/remnant left intact)",
        }),
      });
      return { restoredParentId: null, aborted: true };
    }

    // Best-effort cleanup of the spawned booking/remnant events.
    if (info.googleBookingEventId) {
      try {
        await this.deleteEvent(mediatorId, info.googleBookingEventId);
      } catch (err) {
        if (!isGoneError(err)) {
          console.error("[GoogleCalendar] cleanup BFM booking event failed:", err);
          cleanupFailed = true;
        }
      }
    }
    if (info.googleTrailingRemnantEventId) {
      try {
        await this.deleteEvent(mediatorId, info.googleTrailingRemnantEventId);
      } catch (err) {
        if (!isGoneError(err)) {
          console.error("[GoogleCalendar] cleanup trailing remnant failed:", err);
          cleanupFailed = true;
        }
      }
    }

    logAudit({
      action: "update",
      entity: "google_calendar",
      entityId: mediatorId,
      details: JSON.stringify({
        op: "restore_after_cancel",
        parentGoogleEventId: info.parentGoogleEventId,
        restoredParentId,
        deletedBookingId: info.googleBookingEventId,
        deletedRemnantId: info.googleTrailingRemnantEventId,
        gaps: gaps.map(g => ({ start: g.start.toISOString(), end: g.end.toISOString() })),
        liveBlockers: mergedBlockers.map(b => ({
          start: b.start.toISOString(),
          end: b.end.toISOString(),
        })),
        appointmentId: appointmentIdForAudit,
        cleanupFailed,
      }),
    });

    // Parent is restored. Cleanup leftovers (if any) are benign because the
    // availability filter excludes booked appointment titles. Caller commits
    // the DB transition.
    return { restoredParentId, aborted: false };
  }

  // BFM org info@ calendar (singleton row in bfm_calendar_connection).
  private static readonly BFM_ROW_ID = "bfm";

  async getBfmConnection(): Promise<BfmCalendarConnection | null> {
    const rows = await db
      .select()
      .from(bfmCalendarConnection)
      .where(eq(bfmCalendarConnection.id, GoogleCalendarService.BFM_ROW_ID));
    return rows[0] ?? null;
  }

  // Task #189 — Toggle for the daily background health-check sweep's admin
  // notification + email fan-out. Upserts the singleton row so the toggle can
  // be flipped before any superadmin has connected the BFM Google account.
  async setBfmHealthCheckAlerts(enabled: boolean): Promise<void> {
    const now = new Date();
    // When re-enabling, clear lastHealthCheckAt so the 23h sweep throttle in
    // server/index.ts doesn't suppress the next 15-min tick — guarantees the
    // toggle takes effect on the next sweep regardless of recent activity.
    const set: Record<string, unknown> = { healthCheckAlertsEnabled: enabled, updatedAt: now };
    if (enabled) set.lastHealthCheckAt = null;
    await db
      .insert(bfmCalendarConnection)
      .values({
        id: GoogleCalendarService.BFM_ROW_ID,
        healthCheckAlertsEnabled: enabled,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: bfmCalendarConnection.id,
        set,
      });
  }

  /**
   * True iff the org info@ calendar has tokens with write scope. Used as the
   * hard-block gate before any booking is allowed to write to either calendar.
   */
  async isBfmConnected(): Promise<boolean> {
    const conn = await this.getBfmConnection();
    return !!(conn && conn.googleCalendarConnected && conn.googleRefreshToken && hasWriteScope(conn.googleScopeGranted));
  }

  getBfmOAuthUrl(state: string): string {
    const oauth2Client = createBfmOAuthClient();
    return oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: BFM_SCOPES,
      state,
      prompt: "consent",
      include_granted_scopes: true,
    });
  }

  async exchangeCodeAndSaveBfm(
    code: string,
    connectedByUserId: string,
  ): Promise<{ email: string; scope: string | null }> {
    const oauth2Client = createBfmOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.access_token) throw new Error("No access token received from Google");

    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email ?? "";

    // Hard-enforce that only the org info@ mailbox can be connected here.
    if (email.trim().toLowerCase() !== BFM_EMAIL.toLowerCase()) {
      const now = new Date();
      await db
        .insert(bfmCalendarConnection)
        .values({
          id: GoogleCalendarService.BFM_ROW_ID,
          googleCalendarConnected: false,
          googleCalendarEmail: email || null,
          lastHealthCheckAt: now,
          lastHealthCheckError: "wrong_account",
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: bfmCalendarConnection.id,
          set: {
            googleCalendarConnected: false,
            lastHealthCheckAt: now,
            lastHealthCheckError: "wrong_account",
            updatedAt: now,
          },
        });
      const err = new Error(`wrong_account:${email}`);
      (err as Error & { code?: string }).code = "wrong_account";
      throw err;
    }

    const expiresAt = tokens.expiry_date
      ? new Date(tokens.expiry_date)
      : new Date(Date.now() + 3600 * 1000);

    const grantedScope = tokens.scope ?? null;
    const grantedWrite = hasWriteScope(grantedScope);

    const now = new Date();
    const values = {
      id: GoogleCalendarService.BFM_ROW_ID,
      googleAccessToken: tokens.access_token,
      googleRefreshToken: tokens.refresh_token ?? null,
      googleCalendarConnected: grantedWrite,
      googleCalendarEmail: email,
      googleTokenExpiresAt: expiresAt,
      googleScopeGranted: grantedScope,
      lastHealthCheckAt: null,
      lastHealthCheckError: grantedWrite ? null : "needs_write_scope",
      connectedAt: now,
      connectedByUserId,
      updatedAt: now,
    };

    // Preserve existing refresh token if Google omits it on re-consent.
    await db
      .insert(bfmCalendarConnection)
      .values(values)
      .onConflictDoUpdate({
        target: bfmCalendarConnection.id,
        set: {
          googleAccessToken: values.googleAccessToken,
          googleRefreshToken: tokens.refresh_token
            ? values.googleRefreshToken
            : dsql`COALESCE(${bfmCalendarConnection.googleRefreshToken}, EXCLUDED.google_refresh_token)`,
          googleCalendarConnected: values.googleCalendarConnected,
          googleCalendarEmail: values.googleCalendarEmail,
          googleTokenExpiresAt: values.googleTokenExpiresAt,
          googleScopeGranted: values.googleScopeGranted,
          lastHealthCheckError: values.lastHealthCheckError,
          connectedAt: values.connectedAt,
          connectedByUserId: values.connectedByUserId,
          updatedAt: values.updatedAt,
        },
      });

    return { email, scope: grantedScope };
  }

  async disconnectBfm(): Promise<void> {
    const now = new Date();
    await db
      .insert(bfmCalendarConnection)
      .values({
        id: GoogleCalendarService.BFM_ROW_ID,
        googleAccessToken: null,
        googleRefreshToken: null,
        googleCalendarConnected: false,
        googleCalendarEmail: null,
        googleTokenExpiresAt: null,
        googleScopeGranted: null,
        lastHealthCheckAt: null,
        lastHealthCheckError: null,
        connectedAt: null,
        connectedByUserId: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: bfmCalendarConnection.id,
        set: {
          googleAccessToken: null,
          googleRefreshToken: null,
          googleCalendarConnected: false,
          googleCalendarEmail: null,
          googleTokenExpiresAt: null,
          googleScopeGranted: null,
          lastHealthCheckAt: null,
          lastHealthCheckError: null,
          connectedAt: null,
          connectedByUserId: null,
          updatedAt: now,
        },
      });
  }

  private async getBfmAuthClient() {
    const conn = await this.getBfmConnection();
    if (!conn || !conn.googleAccessToken) {
      throw new Error("BFM organisation calendar is not connected");
    }
    const oauth2Client = createOAuthClient();
    const credentials: Record<string, string | number | null | undefined> = {
      access_token: conn.googleAccessToken,
    };
    if (conn.googleRefreshToken) credentials.refresh_token = conn.googleRefreshToken;
    if (conn.googleTokenExpiresAt) credentials.expiry_date = conn.googleTokenExpiresAt.getTime();
    oauth2Client.setCredentials(credentials);

    oauth2Client.on("tokens", async (newTokens) => {
      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (newTokens.access_token) update.googleAccessToken = newTokens.access_token;
      if (newTokens.expiry_date) update.googleTokenExpiresAt = new Date(newTokens.expiry_date);
      if (newTokens.refresh_token) update.googleRefreshToken = newTokens.refresh_token;
      if (Object.keys(update).length > 1) {
        await db
          .update(bfmCalendarConnection)
          .set(update)
          .where(eq(bfmCalendarConnection.id, GoogleCalendarService.BFM_ROW_ID));
      }
    });

    return oauth2Client;
  }

  private async getBfmPrimaryCalendarClient() {
    const auth = await this.getBfmAuthClient();
    return {
      calendar: google.calendar({ version: "v3", auth }),
      calendarId: "primary",
    };
  }

  async upsertInternalTaskEvent(
    googleEventId: string | null,
    requestBody: calendar_v3.Schema$Event,
  ): Promise<string> {
    const { calendar, calendarId } = await this.getBfmPrimaryCalendarClient();
    if (googleEventId) {
      try {
        const updated = await calendar.events.update({
          calendarId,
          eventId: googleEventId,
          sendUpdates: requestBody.attendees?.length ? "all" : "none",
          requestBody,
        });
        return updated.data.id ?? googleEventId;
      } catch (error) {
        const status = (error as { code?: number; response?: { status?: number } }).code
          ?? (error as { response?: { status?: number } }).response?.status;
        if (status !== 404 && status !== 410) throw error;
      }
    }
    const created = await calendar.events.insert({ calendarId, sendUpdates: requestBody.attendees?.length ? "all" : "none", requestBody });
    if (!created.data.id) throw new Error("Google did not return a task event ID");
    return created.data.id;
  }

  async deleteInternalTaskEvent(googleEventId: string): Promise<void> {
    const { calendar, calendarId } = await this.getBfmPrimaryCalendarClient();
    try {
      await calendar.events.delete({ calendarId, eventId: googleEventId, sendUpdates: "all" });
    } catch (error) {
      const status = (error as { code?: number; response?: { status?: number } }).code
        ?? (error as { response?: { status?: number } }).response?.status;
      if (status !== 404 && status !== 410) throw error;
    }
  }

  async getInternalTaskEvent(googleEventId: string): Promise<calendar_v3.Schema$Event | null> {
    const { calendar, calendarId } = await this.getBfmPrimaryCalendarClient();
    try {
      const event = await calendar.events.get({ calendarId, eventId: googleEventId });
      return event.data.status === "cancelled" ? null : event.data;
    } catch (error) {
      const status = (error as { code?: number; response?: { status?: number } }).code
        ?? (error as { response?: { status?: number } }).response?.status;
      if (status === 404 || status === 410) return null;
      throw error;
    }
  }

  /**
   * Lightweight liveness ping for the org info@ calendar. On success clears
   * lastHealthCheckError; on auth failure (invalid_grant) marks the row
   * disconnected so the booking gate hard-fails until a superadmin reconnects.
   * Returns { ok, error?, needsReauth? } so the caller can decide whether to
   * notify staff.
   */
  async bfmHealthCheck(): Promise<{ ok: boolean; error?: string; needsReauth?: boolean }> {
    const conn = await this.getBfmConnection();
    if (!conn || !conn.googleCalendarConnected || !conn.googleAccessToken) {
      const now = new Date();
      // Task #191 — Preserve a sticky needs_reauth flag here. After the
      // helper flips a dying token to needs_reauth it nulls
      // googleAccessToken (so booking is hard-blocked until reconnect),
      // which would otherwise cause this branch to overwrite the error
      // back to not_connected on the next sweep — losing the distinct
      // "Reauthentication required" UI state and re-triggering admin
      // alerts forever. We only stamp not_connected for rows that have
      // never carried a refresh token (truly never set up).
      const errorToSet = conn?.lastHealthCheckError === "needs_reauth" || conn?.googleRefreshToken
        ? (conn.lastHealthCheckError ?? "not_connected")
        : "not_connected";
      await db
        .insert(bfmCalendarConnection)
        .values({
          id: GoogleCalendarService.BFM_ROW_ID,
          lastHealthCheckAt: now,
          lastHealthCheckError: errorToSet,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: bfmCalendarConnection.id,
          set: { lastHealthCheckAt: now, lastHealthCheckError: errorToSet, updatedAt: now },
        });
      return {
        ok: false,
        error: errorToSet,
        needsReauth: errorToSet === "needs_reauth",
      };
    }
    try {
      const auth = await this.getBfmAuthClient();
      const calendar = google.calendar({ version: "v3", auth });
      await calendar.events.list({
        calendarId: "primary",
        maxResults: 1,
        singleEvents: true,
        timeMin: new Date().toISOString(),
      });
      const now = new Date();
      await db
        .update(bfmCalendarConnection)
        .set({ lastHealthCheckAt: now, lastHealthCheckError: null, updatedAt: now })
        .where(eq(bfmCalendarConnection.id, GoogleCalendarService.BFM_ROW_ID));
      return { ok: true };
    } catch (err) {
      const errorCode = this._classifyError(err);
      const needsReauth = errorCode === "needs_reauth";
      const now = new Date();
      // Task #191 — Helper MUST run FIRST on the needs_reauth branch so its
      // atomic compare-and-set wins the transition and fan-out fires.
      // Otherwise pre-writing lastHealthCheckError='needs_reauth' here would
      // mask the flip and the daily admin alert would never go out.
      if (needsReauth) {
        try {
          const { markBfmNeedsReauthAndNotify } = await import("./calendar-reauth.service");
          await markBfmNeedsReauthAndNotify(errorCode, "health_check");
        } catch (notifyErr) {
          console.error("[bfmHealthCheck] reauth fan-out failed:", notifyErr);
        }
      } else {
        // Non-reauth errors: just stamp the row so admins can see the latest
        // failure code on the Settings panel.
        await db
          .update(bfmCalendarConnection)
          .set({
            lastHealthCheckAt: now,
            lastHealthCheckError: errorCode,
            updatedAt: now,
          })
          .where(eq(bfmCalendarConnection.id, GoogleCalendarService.BFM_ROW_ID));
      }
      return { ok: false, error: errorCode, needsReauth };
    }
  }

  /**
   * Create a "client-side" event on the BFM info@ calendar with
   * sendUpdates:"all" so Google emails the calendar invite to the client
   * from info@. The mediator email is intentionally NEVER included in the
   * attendee list — that's the point of this whole split.
   */
  async createBfmEvent(data: {
    summary: string;
    description?: string;
    start: Date;
    end: Date;
    clientEmail: string;
    clientName?: string;
    location?: string;
  }): Promise<string> {
    return (await this.createBfmEventWithUid(data)).eventId;
  }

  async createBfmEventWithUid(data: {
    eventId?: string;
    summary: string;
    description?: string;
    start: Date;
    end: Date;
    clientEmail: string;
    clientName?: string;
    location?: string;
  }): Promise<{ eventId: string; icalUid: string }> {
    const auth = await this.getBfmAuthClient();
    const calendar = google.calendar({ version: "v3", auth });
    const attendees = [
      { email: BFM_EMAIL, displayName: "Brighter Future Mediation", responseStatus: "accepted" },
      { email: data.clientEmail, ...(data.clientName ? { displayName: data.clientName } : {}) },
    ];
    let res;
    try {
      res = await calendar.events.insert({
        calendarId: "primary",
        sendUpdates: "all",
        requestBody: {
          ...(data.eventId ? { id: data.eventId } : {}),
          summary: data.summary,
          description: data.description,
          location: data.location,
          start: { dateTime: data.start.toISOString(), timeZone: UK_TIME_ZONE },
          end: { dateTime: data.end.toISOString(), timeZone: UK_TIME_ZONE },
          attendees,
        },
      });
    } catch (err) {
      const status = (err as { code?: number; response?: { status?: number } })?.code
        ?? (err as { response?: { status?: number } })?.response?.status;
      if (status === 409 && data.eventId) {
        const existing = await calendar.events.get({ calendarId: "primary", eventId: data.eventId });
        if (existing.data.iCalUID) return { eventId: data.eventId, icalUid: existing.data.iCalUID };
      }
      logAudit({
        action: "create",
        entity: "bfm_calendar_event",
        entityId: GoogleCalendarService.BFM_ROW_ID,
        details: JSON.stringify({
          op: "bfm_insert_failed",
          summary: data.summary,
          start: data.start.toISOString(),
          end: data.end.toISOString(),
          clientEmail: data.clientEmail,
          error: (err as Error)?.message ?? String(err),
        }),
      });
      throw err;
    }
    if (!res.data.id) throw new Error("Google did not return event ID after BFM insert");
    logAudit({
      action: "create",
      entity: "bfm_calendar_event",
      entityId: GoogleCalendarService.BFM_ROW_ID,
      details: JSON.stringify({
        op: "bfm_insert",
        googleEventId: res.data.id,
        clientEmail: data.clientEmail,
        start: data.start.toISOString(),
        end: data.end.toISOString(),
      }),
    });
    const icalUid = res.data.iCalUID || (await calendar.events.get({ calendarId: "primary", eventId: res.data.id })).data.iCalUID;
    if (!icalUid) throw new Error("Google did not return a calendar UID after BFM insert");
    return { eventId: res.data.id, icalUid };
  }

  async patchBfmEvent(
    googleEventId: string,
    patch: { summary?: string; description?: string; start?: Date; end?: Date },
  ): Promise<void> {
    const auth = await this.getBfmAuthClient();
    const calendar = google.calendar({ version: "v3", auth });
    const requestBody: Record<string, unknown> = {};
    if (patch.summary !== undefined) requestBody.summary = patch.summary;
    if (patch.description !== undefined) requestBody.description = patch.description;
    if (patch.start) requestBody.start = { dateTime: patch.start.toISOString(), timeZone: UK_TIME_ZONE };
    if (patch.end) requestBody.end = { dateTime: patch.end.toISOString(), timeZone: UK_TIME_ZONE };
    try {
      await calendar.events.patch({
        calendarId: "primary",
        eventId: googleEventId,
        sendUpdates: "all",
        requestBody,
      });
      logAudit({
        action: "update",
        entity: "bfm_calendar_event",
        entityId: GoogleCalendarService.BFM_ROW_ID,
        details: JSON.stringify({
          op: "bfm_patch",
          googleEventId,
          patch: { summary: patch.summary, start: patch.start?.toISOString(), end: patch.end?.toISOString() },
        }),
      });
    } catch (err) {
      logAudit({
        action: "update",
        entity: "bfm_calendar_event",
        entityId: GoogleCalendarService.BFM_ROW_ID,
        details: JSON.stringify({
          op: "bfm_patch_failed",
          googleEventId,
          error: (err as Error)?.message ?? String(err),
        }),
      });
      throw err;
    }
  }

  async deleteBfmEvent(googleEventId: string): Promise<void> {
    const auth = await this.getBfmAuthClient();
    const calendar = google.calendar({ version: "v3", auth });
    try {
      await calendar.events.delete({
        calendarId: "primary",
        eventId: googleEventId,
        sendUpdates: "all",
      });
      logAudit({
        action: "delete",
        entity: "bfm_calendar_event",
        entityId: GoogleCalendarService.BFM_ROW_ID,
        details: JSON.stringify({ op: "bfm_delete", googleEventId }),
      });
    } catch (err) {
      const status = (err as { code?: number; response?: { status?: number } })?.code
        ?? (err as { response?: { status?: number } })?.response?.status;
      if (status === 404 || status === 410) {
        logAudit({
          action: "delete",
          entity: "bfm_calendar_event",
          entityId: GoogleCalendarService.BFM_ROW_ID,
          details: JSON.stringify({ op: "bfm_delete_already_gone", googleEventId, status }),
        });
        return;
      }
      logAudit({
        action: "delete",
        entity: "bfm_calendar_event",
        entityId: GoogleCalendarService.BFM_ROW_ID,
        details: JSON.stringify({
          op: "bfm_delete_failed",
          googleEventId,
          error: (err as Error)?.message ?? String(err),
        }),
      });
      throw err;
    }
  }

  /**
   * Read-only fetch of a single event from the BFM info@ calendar. Used by
   * the appointment side panel to surface live attendees / RSVP / last sync
   * to staff. Returns null on 404/410 or transient lookup failure.
   */
  async getBfmEventById(googleEventId: string): Promise<{
    id: string;
    summary: string | null;
    start: Date;
    end: Date;
    attendees: { email: string; displayName?: string; responseStatus?: string }[];
    organizerEmail: string | null;
    htmlLink: string | null;
  } | null> {
    try {
      const auth = await this.getBfmAuthClient();
      const calendar = google.calendar({ version: "v3", auth });
      const res = await calendar.events.get({ calendarId: "primary", eventId: googleEventId });
      const item = res.data;
      if (!item || item.status === "cancelled") return null;
      const startStr = item.start?.dateTime ?? item.start?.date;
      const endStr = item.end?.dateTime ?? item.end?.date;
      if (!startStr || !endStr) return null;
      return {
        id: item.id ?? googleEventId,
        summary: item.summary ?? null,
        start: new Date(startStr),
        end: new Date(endStr),
        attendees: (item.attendees ?? []).map(a => ({
          email: a.email ?? "",
          displayName: a.displayName ?? undefined,
          responseStatus: a.responseStatus ?? undefined,
        })),
        organizerEmail: item.organizer?.email ?? null,
        htmlLink: item.htmlLink ?? null,
      };
    } catch (err) {
      const status = (err as { code?: number; response?: { status?: number } })?.code
        ?? (err as { response?: { status?: number } })?.response?.status;
      if (status === 404 || status === 410) return null;
      console.warn(`[GoogleCalendar] getBfmEventById transient error for ${googleEventId}:`, err);
      return null;
    }
  }
}

export const googleCalendarService = new GoogleCalendarService();
