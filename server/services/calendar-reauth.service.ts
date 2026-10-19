/**
 * Task #191 — Single canonical "this Google Calendar token has died" fan-out.
 *
 * Called by the proactive 15-min probe AND by every real Google API call site
 * (syncCalendar, bfmHealthCheck, etc.) so the mediator/admin gets notified the
 * very first time the token dies — regardless of which path discovered it.
 *
 * The flip is implemented as an atomic compare-and-set: the UPDATE … WHERE
 * lastError IS DISTINCT FROM 'needs_reauth' … RETURNING pattern guarantees
 * that only one caller "wins" the transition out of a healthy state, even if
 * the daily BFM health check, the 15-min probe, and a concurrent booking
 * attempt all detect the same incident at the same instant. firstFlip=true
 * is the gate for fan-out (audit + email + in-app notification).
 */

import { db } from "../db";
import { storage } from "../storage";
import { logAudit } from "./audit-log.service";
import { bfmCalendarConnection, users } from "@shared/schema";
import { and, eq, sql as dsql } from "drizzle-orm";

const BFM_ROW_ID = "bfm";

/**
 * Mark a mediator's Google Calendar as needing reauth + (on first detection)
 * email the mediator, create an in-app notification, and write an audit entry.
 * Idempotent: safe to call multiple times for the same incident — only the
 * winning UPDATE gets firstFlip=true.
 *
 * @param mediatorId - The mediator's user id.
 * @param errorCode  - Classified Google error (e.g. "needs_reauth", "invalid_grant").
 * @param source     - Where the failure was detected ("probe" | "sync" | "booking" | …)
 *                     used in audit + log lines for forensics.
 */
export async function markMediatorNeedsReauthAndNotify(
  mediatorId: string,
  errorCode: string,
  source: string,
): Promise<{ firstFlip: boolean }> {
  const flipped = await db
    .update(users)
    .set({
      googleCalendarConnected: false,
      lastCalendarSyncError: "needs_reauth",
    })
    .where(
      and(
        eq(users.id, mediatorId),
        dsql`${users.lastCalendarSyncError} IS DISTINCT FROM 'needs_reauth'`,
      ),
    )
    .returning({ id: users.id });

  const firstFlip = flipped.length > 0;
  if (!firstFlip) return { firstFlip: false };

  const mediator = await storage.getUser(mediatorId).catch(() => null);
  if (!mediator) return { firstFlip: true };

  // Audit log — entity uses the requested `mediator_calendar` taxonomy so
  // BFM-vs-mediator events stay distinguishable in reports.
  try {
    await logAudit({
      userId: null,
      action: "auto_flipped_needs_reauth",
      entity: "mediator_calendar",
      entityId: mediatorId,
      details: JSON.stringify({
        source,
        errorCode,
        mediatorEmail: mediator.email,
        lastKnownGoodAt: mediator.lastCalendarSyncAt ?? null,
      }),
    });
  } catch (err) {
    console.error(`[Calendar Reauth] Audit log failed for mediator ${mediator.email}:`, err);
  }

  // Email the affected mediator with a reconnect link.
  try {
    const { sendMediatorCalendarReauthEmail } = await import("./email.service");
    // Match the rest of email.service.ts: fall back to the public marketing
    // domain when APP_URL is unset so the CTA never renders as a relative
    // path inside an email client (mailto handlers / Outlook treat
    // "/appointments" as a broken link).
    const baseUrl = (process.env.APP_URL || "https://brighterfuturemediation.co.uk").replace(/\/+$/, "");
    await sendMediatorCalendarReauthEmail(
      mediator.email,
      mediator.name,
      `${baseUrl}/appointments`,
    );
  } catch (err) {
    console.error(`[Calendar Reauth] Email failed for mediator ${mediator.email}:`, err);
  }

  // In-app red-urgency notification on the mediator's own dashboard.
  try {
    const { notificationService } = await import("./notification.service");
    await notificationService.createNotification({
      recipientId: mediatorId,
      recipientRole: "mediator",
      type: "calendar_reauth_required",
      urgency: "red",
      caseId: null,
      appointmentId: null,
      title: "Action required: reconnect your Google Calendar",
      message:
        "Google has revoked our access to your calendar. Open Appointments \u2192 Calendar settings to reconnect, otherwise clients can't book your slots.",
      caseNoteRequired: false,
    });
  } catch (err) {
    console.error(`[Calendar Reauth] In-app notify failed for mediator ${mediator.email}:`, err);
  }

  return { firstFlip: true };
}

/**
 * Same fan-out for the BFM info@ org calendar. Audit entity = "bfm_calendar".
 * Email + in-app notification respect the existing healthCheckAlertsEnabled
 * toggle (so superadmins can pause noisy alerts without losing the audit
 * record or the disconnect itself).
 */
export async function markBfmNeedsReauthAndNotify(
  errorCode: string,
  source: string,
): Promise<{ firstFlip: boolean }> {
  const flipped = await db
    .update(bfmCalendarConnection)
    .set({
      googleCalendarConnected: false,
      googleAccessToken: null,
      lastHealthCheckError: "needs_reauth",
      lastHealthCheckAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(bfmCalendarConnection.id, BFM_ROW_ID),
        dsql`${bfmCalendarConnection.lastHealthCheckError} IS DISTINCT FROM 'needs_reauth'`,
      ),
    )
    .returning({ id: bfmCalendarConnection.id });

  const firstFlip = flipped.length > 0;
  if (!firstFlip) return { firstFlip: false };

  try {
    await logAudit({
      userId: null,
      action: "auto_flipped_needs_reauth",
      entity: "bfm_calendar",
      entityId: BFM_ROW_ID,
      details: JSON.stringify({ source, errorCode }),
    });
  } catch (err) {
    console.error("[Calendar Reauth] BFM audit log failed:", err);
  }

  // Read the toggle AFTER the flip so the disconnect itself always happens.
  let alertsEnabled = true;
  try {
    const { googleCalendarService } = await import("./google-calendar.service");
    const conn = await googleCalendarService.getBfmConnection();
    alertsEnabled = !!conn?.healthCheckAlertsEnabled;
  } catch {
    /* fall through — default to alerting */
  }
  if (!alertsEnabled) return { firstFlip: true };

  try {
    const { sendBfmCalendarHealthAlert } = await import("./email.service");
    await sendBfmCalendarHealthAlert(errorCode || "needs_reauth", true);
  } catch (err) {
    console.error("[Calendar Reauth] BFM email failed:", err);
  }

  try {
    const allUsers = await storage.listUsers();
    const admins = allUsers.filter(
      (u) => (u.role === "superadmin" || u.role === "subadmin") && u.status === "active",
    );
    if (admins.length > 0) {
      const { notificationService } = await import("./notification.service");
      await Promise.all(
        admins.map((a) =>
          notificationService
            .createNotification({
              recipientId: a.id,
              recipientRole: "admin",
              type: "bfm_calendar_health",
              urgency: "red",
              caseId: null,
              appointmentId: null,
              title: "BFM organisation calendar needs attention",
              message:
                "Google rejected the saved token. Please reconnect on the Settings page so bookings can resume.",
              caseNoteRequired: false,
            })
            .catch(() => undefined),
        ),
      );
    }
  } catch (err) {
    console.error("[Calendar Reauth] BFM admin notify failed:", err);
  }

  return { firstFlip: true };
}
