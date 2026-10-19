import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { calendarWebhookSubscriptions } from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { logAudit } from "./audit-log.service";
import { deriveCalendarWebhookToken } from "./calendar-availability-webhook";
import { googleCalendarService } from "./google-calendar.service";
import { outlookCalendarService } from "./outlook-calendar.service";
import { notificationService } from "./notification.service";

type Provider = "google" | "outlook";

function webhookBaseUrl() {
  return process.env.APP_URL?.trim().replace(/\/+$/, "") ?? null;
}

export async function ensureCalendarAvailabilitySubscription(mediatorId: string, provider: Provider) {
  const secret = process.env.CALENDAR_WEBHOOK_SECRET?.trim();
  const baseUrl = webhookBaseUrl();
  if (!secret || !baseUrl?.startsWith("https://")) return { skipped: "configuration" as const };
  const renewalThreshold = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const [latest] = await db.select().from(calendarWebhookSubscriptions).where(and(
    eq(calendarWebhookSubscriptions.mediatorId, mediatorId),
    eq(calendarWebhookSubscriptions.provider, provider),
  )).orderBy(desc(calendarWebhookSubscriptions.expiresAt)).limit(1);
  if (latest?.status === "active" && latest.expiresAt && latest.expiresAt > renewalThreshold) return { skipped: "healthy" as const };

  const channelId = randomUUID();
  const clientState = deriveCalendarWebhookToken(secret, provider, mediatorId, channelId);
  const endpoint = `${baseUrl}/api/public/calendar/webhooks/${provider}`;
  try {
    if (provider === "google") {
      const created = await googleCalendarService.createAvailabilityWatch(mediatorId, { channelId, token: clientState, webhookUrl: endpoint });
      await db.insert(calendarWebhookSubscriptions).values({
        mediatorId,
        provider,
        channelId,
        resourceId: created.resourceId,
        clientStateHash: createHash("sha256").update(clientState).digest("hex"),
        expiresAt: created.expiresAt,
      });
    } else {
      const created = await outlookCalendarService.createAvailabilitySubscription(mediatorId, { clientState, webhookUrl: endpoint });
      await db.insert(calendarWebhookSubscriptions).values({
        mediatorId,
        provider,
        externalSubscriptionId: created.subscriptionId,
        channelId,
        clientStateHash: createHash("sha256").update(clientState).digest("hex"),
        expiresAt: created.expiresAt,
      });
    }
    await logAudit({
      action: latest ? "calendar_subscription_renewal" : "calendar_subscription_creation",
      entity: "calendar_webhook_subscription",
      entityId: mediatorId,
      details: JSON.stringify({ mediatorId, provider, channelId }),
    });
    return { created: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failureCount = (latest?.renewalFailureCount ?? 0) + 1;
    if (latest) {
      await db.update(calendarWebhookSubscriptions).set({
        status: failureCount >= 3 ? "failed" : "retrying",
        renewalFailureCount: failureCount,
        lastError: message.slice(0, 2000),
        updatedAt: new Date(),
      }).where(eq(calendarWebhookSubscriptions.id, latest.id));
    } else {
      await db.insert(calendarWebhookSubscriptions).values({
        mediatorId,
        provider,
        channelId,
        status: failureCount >= 3 ? "failed" : "retrying",
        renewalFailureCount: failureCount,
        lastError: message.slice(0, 2000),
      });
    }
    await logAudit({
      action: "calendar_subscription_failure",
      entity: "calendar_webhook_subscription",
      entityId: mediatorId,
      details: JSON.stringify({ mediatorId, provider, failureCount, error: message }),
    });
    if (failureCount === 3) {
      const admins = (await storage.listUsers()).filter((user) => user.status === "active" && (user.role === "superadmin" || user.role === "subadmin"));
      if (admins.length) {
        await notificationService.createNotification({
          recipientId: admins[0].id,
          recipientRole: "task_assignee",
          assignedTo: admins[0].id,
          assignedUserIds: admins.map((admin) => admin.id),
          assignedBy: null,
          type: "calendar_subscription_failure",
          urgency: "red",
          title: "Calendar updates need attention",
          message: `BFM could not renew the ${provider} calendar connection for mediator ID ${mediatorId}. The 15-minute calendar check will continue while access remains available. /mediators/${mediatorId}`,
          status: "active",
          caseNoteRequired: false,
        }).catch(() => undefined);
      }
    }
    throw error;
  }
}

export async function renewCalendarAvailabilitySubscriptions() {
  const mediators = (await storage.listUsers()).filter(
    (user) => user.role === "mediator" && user.status === "active",
  );
  let attempted = 0;
  for (const mediator of mediators) {
    const providers: Provider[] = mediator.activeCalendarProvider === "google" && mediator.googleCalendarConnected
      ? ["google"]
      : mediator.activeCalendarProvider === "outlook" && mediator.outlookCalendarConnected
        ? ["outlook"]
        : [];
    for (const provider of providers) {
      attempted += 1;
      await ensureCalendarAvailabilitySubscription(mediator.id, provider).catch(() => undefined);
    }
  }
  return { attempted };
}
