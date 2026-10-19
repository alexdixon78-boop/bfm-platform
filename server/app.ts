import express from "express";
import { fileStorageService, LOCAL_UPLOAD_ROOT } from "./services/file-storage.service";
import { registerRoutes } from "./routes/index";
import { serveStatic } from "./static";
import { createServer } from "http";
import { errorHandler } from "./middleware/error-handler";
import { appointmentService } from "./services/appointment.service";
import { notificationService } from "./services/notification.service";
import { storage } from "./storage";
import { sendTaskFollowUpReminderEmail } from "./services/email.service";
import { xeroService } from "./services/xero.service";
import { pool } from "./db";
import { checkDatabaseHealth } from "./db-health";
import { formatRequestLogLine, isConfidentialResponsePath, logger } from "./logger";
import { appointmentCalendarSyncService } from "./services/appointment-calendar-sync.service";
import { whatsappOutboxService } from "./services/whatsapp-outbox.service";
import { whatsappMediaWorkerService } from "./services/whatsapp-media-worker.service";
import { gmailCaseReplySyncService } from "./services/gmail-case-reply-sync.service";

const app = express();
const httpServer = createServer(app);
const shutdownTimers: NodeJS.Timeout[] = [];
let shuttingDown = false;
let serverListening = false;
let readinessStatus:
  | { ok: true; checkedAt: string }
  | { ok: false; status: string; reason?: string; checkedAt?: string } = {
  ok: false,
  status: "starting",
};

function trackTimeout(callback: () => void | Promise<void>, delayMs: number) {
  const timer = setTimeout(callback, delayMs);
  shutdownTimers.push(timer);
  return timer;
}

function trackInterval(callback: () => void | Promise<void>, delayMs: number) {
  const timer = setInterval(callback, delayMs);
  shutdownTimers.push(timer);
  return timer;
}

async function timeStartupPhase<T>(name: string, callback: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await callback();
    log(`Startup phase "${name}" completed in ${Date.now() - startedAt}ms`);
    return result;
  } catch (err) {
    logger.error(`Startup phase "${name}" failed after ${Date.now() - startedAt}ms`, err);
    throw err;
  }
}

function sanitizeReadinessReason(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  return raw.length > 160 ? `${raw.slice(0, 157)}...` : raw;
}

async function evaluateReadiness() {
  if (shuttingDown) {
    readinessStatus = {
      ok: false,
      status: "shutting_down",
      checkedAt: new Date().toISOString(),
    };
    return readinessStatus;
  }
  if (!serverListening) {
    readinessStatus = {
      ok: false,
      status: "starting",
      checkedAt: new Date().toISOString(),
    };
    return readinessStatus;
  }

  const dbHealth = await checkDatabaseHealth(pool);
  if (!dbHealth.ok) {
    readinessStatus = {
      ok: false,
      status: "database_unavailable",
      reason: dbHealth.reason,
      checkedAt: new Date().toISOString(),
    };
    return readinessStatus;
  }

  try {
    const result = await pool.query<{
      users_table: string | null;
      session_table: string | null;
    }>(
      "select to_regclass('public.users')::text as users_table, to_regclass('public.session')::text as session_table",
    );
    const row = result.rows[0];
    const missing = [
      row?.users_table ? null : "users",
      row?.session_table ? null : "session",
    ].filter(Boolean);
    if (missing.length > 0) {
      readinessStatus = {
        ok: false,
        status: "database_bootstrap_required",
        reason: `Missing table(s): ${missing.join(", ")}. Run npm run db:bootstrap.`,
        checkedAt: new Date().toISOString(),
      };
      return readinessStatus;
    }
  } catch (err) {
    readinessStatus = {
      ok: false,
      status: "database_readiness_check_failed",
      reason: sanitizeReadinessReason(err),
      checkedAt: new Date().toISOString(),
    };
    return readinessStatus;
  }

  readinessStatus = { ok: true, checkedAt: new Date().toISOString() };
  return readinessStatus;
}

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "40mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "40mb" }));

app.get("/healthz", (_req, res) => {
  if (shuttingDown) {
    return res.status(503).json({ ok: false, status: "shutting_down" });
  }
  return res.json({ ok: true });
});

app.get("/readyz", async (_req, res) => {
  const status = await evaluateReadiness();
  return res.status(status.ok ? 200 : 503).json(status);
});

app.get("/uploads/mediator-service-approvals/:fileName", async (req, res, next) => {
  if (!fileStorageService.isS3Enabled()) return next();
  try {
    const file = await fileStorageService.getMediatorServiceApprovalFile(req.params.fileName);
    if (file.contentType) res.setHeader("Content-Type", file.contentType);
    if (file.contentLength != null) res.setHeader("Content-Length", String(file.contentLength));
    res.setHeader("Cache-Control", "private, max-age=300");
    file.body.on("error", next);
    file.body.pipe(res);
  } catch (err) {
    next(err);
  }
});
app.get("/uploads/profile-images/:fileName", async (req, res, next) => {
  try {
    const file = await fileStorageService.getProfileImage(req.params.fileName);
    res.setHeader("Content-Type", file.contentType || (req.params.fileName.endsWith(".png") ? "image/png" : req.params.fileName.endsWith(".webp") ? "image/webp" : "image/jpeg"));
    if (file.contentLength != null) res.setHeader("Content-Length", String(file.contentLength));
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    file.body.on("error", next);
    file.body.pipe(res);
  } catch (error) { next(error); }
});
app.all("/uploads/case-documents/:fileName", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.status(404).json({ message: "Document not found" });
});
app.all("/uploads/complaint-attachments/:fileName", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.status(404).json({ message: "Attachment not found" });
});
app.use("/uploads", express.static(LOCAL_UPLOAD_ROOT));

export function log(message: string, source = "express") {
  logger.info(message, undefined, source);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: unknown = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const confidentialComplaintPath = isConfidentialResponsePath(path);
      log(
        formatRequestLogLine({
          method: req.method,
          path,
          statusCode: res.statusCode,
          durationMs: duration,
          responseBody: confidentialComplaintPath ? undefined : capturedJsonResponse,
        }),
      );
    }
  });

  next();
});

(async () => {
  await timeStartupPhase("route registration", () => registerRoutes(httpServer, app));

  app.use(errorHandler);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    await timeStartupPhase("static setup", async () => {
      serveStatic(app);
    });
  } else {
    await timeStartupPhase("vite setup", async () => {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    });
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.once("error", (err) => {
    readinessStatus = {
      ok: false,
      status: "listen_failed",
      reason: sanitizeReadinessReason(err),
      checkedAt: new Date().toISOString(),
    };
    logger.error(`HTTP server failed to listen on port ${port}`, err);
    process.exit(1);
  });
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      // reusePort: true,
    },
    () => {
      serverListening = true;
      log(`Server ready on port ${port}`);

      void (async () => {
        const readiness = await evaluateReadiness();
        if (!readiness.ok) {
          logger.error("Readiness check failed", readiness);
          return;
        }

        const dbHealth = await checkDatabaseHealth(pool);
        if (dbHealth.ok) {
          log("Database connected");
        } else {
          logger.error(`Database unavailable: ${dbHealth.reason}`);
        }

        const { googleCalendarService } =
          await import("./services/google-calendar.service");
        log(
          `Google Calendar ${googleCalendarService.isConfigured() ? "configured" : "not configured"}`,
        );
      })().catch((err) => {
        logger.error("Boot health report failed", err);
      });

      let calendarSyncRunning = false;
      const runCalendarSync = async () => {
        if (calendarSyncRunning) return;
        const { googleCalendarService } =
          await import("./services/google-calendar.service");
        const { outlookCalendarService } =
          await import("./services/outlook-calendar.service");
        if (!googleCalendarService.isConfigured() && !outlookCalendarService.isConfigured()) return;
        calendarSyncRunning = true;
        try {
          const allUsers = await storage.listUsers();
          const connected = allUsers.filter((u) =>
            u.role === "mediator" && (u.googleCalendarConnected || u.outlookCalendarConnected),
          );
          if (connected.length === 0) return;
          const { logAudit } = await import("./services/audit-log.service");
          let okCount = 0;
          let failCount = 0;
          for (const m of connected) {
            const providers = [
              ...(m.googleCalendarConnected ? [{ name: "google" as const, sync: () => googleCalendarService.syncCalendar(m.id) }] : []),
              ...(m.outlookCalendarConnected ? [{ name: "outlook" as const, sync: () => outlookCalendarService.syncCalendar(m.id) }] : []),
            ];
            for (const provider of providers) {
              try {
                const { syncedCount } = await provider.sync();
                okCount++;
                logAudit({
                  action: "auto_sync_calendar",
                  entity: `${provider.name}_calendar`,
                  entityId: m.id,
                  details: JSON.stringify({ syncedCount }),
                });
              } catch (err) {
                failCount++;
                const reason = err instanceof Error ? err.message : String(err);
                logger.error("[Calendar Auto-Sync] Failed", { mediatorId: m.id, provider: provider.name, reason });
                if (/invalid_grant/i.test(reason)) {
                  logAudit({ action: "reauth_calendar", entity: `${provider.name}_calendar`, entityId: m.id, details: JSON.stringify({ reason: "invalid_grant" }) });
                }
              }
            }
          }
          if (okCount > 0 || failCount > 0) {
            log(
              `Calendar auto-sync: ${okCount} ok, ${failCount} failed (of ${connected.length})`,
            );
          }
        } catch (err) {
          logger.error("[Calendar Auto-Sync] Job error", err);
        } finally {
          calendarSyncRunning = false;
        }
      };
      trackTimeout(runCalendarSync, 30 * 1000);
      trackInterval(runCalendarSync, 15 * 60 * 1000);

      let calendarAvailabilityJobsRunning = false;
      const runCalendarAvailabilityJobs = async () => {
        if (calendarAvailabilityJobsRunning) return;
        calendarAvailabilityJobsRunning = true;
        try {
          const { processCalendarAvailabilityReconciliationJobs } = await import("./services/calendar-availability-job.service");
          await processCalendarAvailabilityReconciliationJobs();
        } catch (err) {
          logger.error("[Calendar Availability] Reconciliation worker failed", err);
        } finally {
          calendarAvailabilityJobsRunning = false;
        }
      };
      trackTimeout(runCalendarAvailabilityJobs, 5 * 1000);
      trackInterval(runCalendarAvailabilityJobs, 5 * 1000);

      const runCalendarSubscriptionRenewal = async () => {
        try {
          const { renewCalendarAvailabilitySubscriptions } = await import("./services/calendar-webhook-subscription.service");
          await renewCalendarAvailabilitySubscriptions();
        } catch (err) {
          logger.error("[Calendar Availability] Subscription renewal failed", err);
        }
      };
      trackTimeout(runCalendarSubscriptionRenewal, 45 * 1000);
      trackInterval(runCalendarSubscriptionRenewal, 60 * 60 * 1000);

      let taskCalendarJobsRunning = false;
      let taskCalendarSweepCount = 0;
      const runTaskCalendarJobs = async () => {
        if (taskCalendarJobsRunning) return;
        taskCalendarJobsRunning = true;
        try {
          const { taskCalendarService } = await import("./services/task-calendar.service");
          const { activateDueTaskOccurrences, extendTaskSeries } = await import("./services/manual-task.service");
          await extendTaskSeries();
          await activateDueTaskOccurrences();
          await taskCalendarService.deactivateCompletedSchedules(50);
          await taskCalendarService.processDueJobs(50);
          await taskCalendarService.sendDueReminders();
          taskCalendarSweepCount += 1;
          if (taskCalendarSweepCount % 15 === 0) {
            await taskCalendarService.reconcileActiveSchedules(50);
          }
        } catch (err) {
          logger.error("[Task Calendar] Background sweep failed", err);
        } finally {
          taskCalendarJobsRunning = false;
        }
      };
      trackTimeout(runTaskCalendarJobs, 10 * 1000);
      trackInterval(runTaskCalendarJobs, 60 * 1000);
      log("Background jobs registered");

      // Daily ping of the info@ calendar; notify admins on failure so a
      // disconnect is caught before the next booking attempt is blocked.
      let bfmHealthRunning = false;
      // Task #189 — sweep ticks every 15 min so the superadmin toggle takes
      // effect on the next tick, but the actual Google probe is throttled to
      // once per 24h to avoid hammering the API.
      const BFM_HEALTH_MIN_INTERVAL_MS = 23 * 60 * 60 * 1000;
      const runBfmHealthCheck = async () => {
        if (bfmHealthRunning) return;
        const { googleCalendarService } =
          await import("./services/google-calendar.service");
        if (!googleCalendarService.isConfigured()) return;
        // Toggle + throttle gate. Manual "Run health check now" from the
        // Settings panel calls bfmHealthCheck directly and bypasses both.
        try {
          const conn = await googleCalendarService.getBfmConnection();
          if (!conn?.healthCheckAlertsEnabled) {
            logger.debug("[BFM Health] Daily alerts disabled; skipping sweep");
            return;
          }
          const lastAt = conn.lastHealthCheckAt
            ? new Date(conn.lastHealthCheckAt).getTime()
            : 0;
          if (Date.now() - lastAt < BFM_HEALTH_MIN_INTERVAL_MS) {
            return;
          }
        } catch (err) {
          logger.error("[BFM Health] Failed to read toggle state", err);
          return;
        }
        bfmHealthRunning = true;
        try {
          const result = await googleCalendarService.bfmHealthCheck();
          if (!result.ok) {
            log(
              `[BFM Health] FAILED: ${result.error}${result.needsReauth ? " (needs reauth)" : ""}`,
            );
            // Task #191 — De-dupe BFM alerts. needs_reauth fan-out is owned
            // by markBfmNeedsReauthAndNotify (atomic first-flip gate inside
            // bfmHealthCheck), so this outer job only fires admin alerts for
            // OTHER failure codes (network errors, quota, etc). Without this
            // gate we'd send a fresh red admin email + notification on every
            // 24h sweep while the calendar is still in needs_reauth.
            if (!result.needsReauth) {
              try {
                const allUsers = await storage.listUsers();
                const admins = allUsers.filter(
                  (u) =>
                    (u.role === "superadmin" || u.role === "subadmin") &&
                    u.status === "active",
                );
                if (admins.length > 0) {
                  const { notificationService } =
                    await import("./services/notification.service");
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
                          message: `Health check failed (${result.error}). Bookings are hard-blocked until this is fixed.`,
                          caseNoteRequired: false,
                        })
                        .catch((err: unknown) =>
                          logger.error("[BFM Health] admin notification failed", {
                            adminId: a.id,
                            err,
                          }),
                        ),
                    ),
                  );
                }
              } catch (notifyErr) {
                logger.error("[BFM Health] Failed to notify admins", notifyErr);
              }
              try {
                const { sendBfmCalendarHealthAlert } =
                  await import("./services/email.service");
                await sendBfmCalendarHealthAlert(
                  result.error ?? "unknown",
                  false,
                );
              } catch (emailErr) {
                logger.error(
                  "[BFM Health] Failed to send admin email alert",
                  emailErr,
                );
              }
            }
          } else {
            log(`[BFM Health] OK`);
          }
        } catch (err) {
          logger.error("[BFM Health] Job error", err);
        } finally {
          bfmHealthRunning = false;
        }
      };
      trackTimeout(runBfmHealthCheck, 60 * 1000);
      trackInterval(runBfmHealthCheck, 15 * 60 * 1000);

      // Task #191 — Proactive token-refresh probe for every connected Google
      // account (BFM + each mediator). Cheap getAccessToken() call (no calendar
      // API quota cost). Throttled to ~6h per healthy account so we don't
      // hammer Google. Flips dead tokens to needs_reauth immediately and fans
      // out an email + in-app notification to the affected mediator instead of
      // waiting for the next booking/sync to discover it.
      const TOKEN_PROBE_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
      const lastProbeAtByUser = new Map<string, number>();
      let lastBfmProbeAt = 0;
      let tokenProbeRunning = false;
      const runTokenRefreshProbes = async () => {
        if (tokenProbeRunning) return;
        const { googleCalendarService } =
          await import("./services/google-calendar.service");
        if (!googleCalendarService.isConfigured()) return;
        tokenProbeRunning = true;
        try {
          // ── BFM probe ────────────────────────────────────────────────────
          try {
            const conn = await googleCalendarService.getBfmConnection();
            const wasNeedsReauth =
              conn?.lastHealthCheckError === "needs_reauth";
            const dueByThrottle =
              Date.now() - lastBfmProbeAt >= TOKEN_PROBE_MIN_INTERVAL_MS;
            if (
              conn?.googleRefreshToken &&
              (wasNeedsReauth ? false : dueByThrottle)
            ) {
              lastBfmProbeAt = Date.now();
              const result = await googleCalendarService.probeBfmToken();
              // Fan-out (audit + email + admin notification) is handled
              // inside the probe via the shared calendar-reauth helper, which
              // uses an atomic compare-and-set so duplicates are impossible
              // even if the daily BFM health-check job runs in the same tick.
              if (result.needsReauth && result.firstFlip) {
                log(`[Token Probe] BFM info@ token died: ${result.error}`);
              }
            }
          } catch (bfmErr) {
            logger.error("[Token Probe] BFM probe error", bfmErr);
          }

          // ── Per-mediator probes ───────────────────────────────────────────
          const allUsers = await storage.listUsers();
          const candidates = allUsers.filter(
            (u) =>
              u.role === "mediator" &&
              u.status === "active" &&
              !!u.googleRefreshToken,
          );
          for (const mediator of candidates) {
            const lastAt = lastProbeAtByUser.get(mediator.id) ?? 0;
            const wasNeedsReauth =
              mediator.lastCalendarSyncError === "needs_reauth";
            // Skip when already in needs_reauth state (no point hammering Google
            // — admin/mediator must reconnect manually). Skip healthy accounts
            // probed within the last 6h to keep API noise minimal.
            if (wasNeedsReauth) continue;
            if (Date.now() - lastAt < TOKEN_PROBE_MIN_INTERVAL_MS) continue;
            lastProbeAtByUser.set(mediator.id, Date.now());
            try {
              const result = await googleCalendarService.probeMediatorToken(
                mediator.id,
              );
              // Fan-out (audit + email + in-app notification) is handled
              // inside the probe via the shared calendar-reauth helper.
              if (result.needsReauth && result.firstFlip) {
                log(
                  `[Token Probe] Mediator ${mediator.id.slice(0, 8)} token died: ${result.error}`,
                );
              }
            } catch (probeErr) {
              logger.error("[Token Probe] Mediator probe error", {
                mediatorId: mediator.id,
                err: probeErr,
              });
            }
          }
        } catch (err) {
          logger.error("[Token Probe] Sweep error", err);
        } finally {
          tokenProbeRunning = false;
        }
      };
      // First run 90s after boot (after the BFM health check), then every 15min.
      trackTimeout(runTokenRefreshProbes, 90 * 1000);
      trackInterval(runTokenRefreshProbes, 15 * 60 * 1000);

      // One-time boot backfill: flag any Google-connected mediators that lack write scope
      // so the banner shows immediately without waiting for a manual sync.
      trackTimeout(async () => {
        try {
          const { hasWriteScope } =
            await import("./services/google-calendar.service");
          const allUsers = await storage.listUsers();
          // Flag Google-connected mediators that lack write scope — do NOT disconnect
          // them (recoverable state). Only update the sync error flag so banners show.
          const affected = allUsers.filter(
            (u) =>
              u.role === "mediator" &&
              u.googleCalendarConnected &&
              !hasWriteScope(u.googleScopeGranted) &&
              u.lastCalendarSyncError !== "needs_write_scope",
          );
          for (const m of affected) {
            await storage.updateUser(m.id, {
              lastCalendarSyncError: "needs_write_scope",
            });
            log(
              `[Boot backfill] Flagged mediator ${m.id.slice(0, 8)} as needs_write_scope`,
            );
          }
          if (affected.length > 0) {
            log(
              `[Boot backfill] Flagged ${affected.length} mediator(s) missing write scope`,
            );
          }
        } catch (err) {
          logger.error("[Boot backfill] Failed", err);
        }
      }, 5 * 1000);

      let appointmentCalendarSyncRunning = false;
      const runAppointmentCalendarSync = async () => {
        if (appointmentCalendarSyncRunning) return;
        appointmentCalendarSyncRunning = true;
        try {
          const repaired = await appointmentCalendarSyncService.repairPaidPublicBookingHolds();
          const processed = await appointmentCalendarSyncService.processDueJobs();
          if (repaired.repaired > 0 || processed.processed > 0) {
            log(`Appointment calendar sync: repaired ${repaired.repaired}, processed ${processed.processed}`);
          }
        } catch (err) {
          logger.error("[Appointment Calendar Sync] Worker error", err);
        } finally {
          appointmentCalendarSyncRunning = false;
        }
      };
      trackTimeout(runAppointmentCalendarSync, 15 * 1000);
      trackInterval(runAppointmentCalendarSync, 60 * 1000);

      let whatsappOutboxWorkerRunning = false;
      const runWhatsappOutboxWorker = async () => {
        if (whatsappOutboxWorkerRunning) return;
        whatsappOutboxWorkerRunning = true;
        try {
          const result = await whatsappOutboxService.processDue(20);
          if (result.processed > 0) {
            logger.info("Outbox worker processed due messages", result, "whatsapp");
          }
        } catch (err) {
          logger.error("Outbox worker failed", err, "whatsapp");
        } finally {
          whatsappOutboxWorkerRunning = false;
        }
      };
      trackTimeout(runWhatsappOutboxWorker, 15 * 1000);
      trackInterval(runWhatsappOutboxWorker, 60 * 1000);

      let whatsappMediaWorkerRunning = false;
      const runWhatsappMediaWorker = async () => {
        if (whatsappMediaWorkerRunning) return;
        whatsappMediaWorkerRunning = true;
        try {
          const result = await whatsappMediaWorkerService.processDue(10);
          if (result.processed > 0) logger.info("Media worker processed attachments", result, "whatsapp");
        } catch (err) {
          logger.error("Media worker failed", err, "whatsapp");
        } finally {
          whatsappMediaWorkerRunning = false;
        }
      };
      trackTimeout(runWhatsappMediaWorker, 20 * 1000);
      trackInterval(runWhatsappMediaWorker, 60 * 1000);

      let gmailReplySyncRunning = false;
      const runGmailReplySync = async () => {
        if (gmailReplySyncRunning) return;
        gmailReplySyncRunning = true;
        try {
          const result = await gmailCaseReplySyncService.syncReplies();
          if (result.linked > 0 || result.failed > 0) {
            logger.info("Gmail case reply sync completed", result, "gmail");
          }
        } catch (err) {
          logger.error("Gmail case reply sync failed", err, "gmail");
        } finally {
          gmailReplySyncRunning = false;
        }
      };
      trackTimeout(runGmailReplySync, 30 * 1000);
      trackInterval(runGmailReplySync, 2 * 60 * 1000);

      let backgroundJobRunning = false;
      trackInterval(
        async () => {
          if (backgroundJobRunning) return;
          backgroundJobRunning = true;
        try {
            const alerted = await appointmentService.createHeldPaymentAlerts();
            if (alerted.length > 0) {
              log(`Created ${alerted.length} payment-hold appointment alert(s)`);
            }
            const appointmentReminders = await appointmentService.sendScheduledAppointmentReminders();
            if (appointmentReminders.reminded > 0) {
              log(`Sent ${appointmentReminders.reminded} scheduled appointment reminder email(s)`);
            }
            const expired = await appointmentService.expireHeld();
            if (expired.length > 0) {
              log(`Expired ${expired.length} payment-hold appointment(s)`);
              const { logAudit } = await import("./services/audit-log.service");
              for (const appt of expired) {
                logAudit({
                  action: "expire_appointment",
                  entity: "appointment",
                  entityId: appt.id,
                  details: JSON.stringify({
                    caseId: appt.caseId,
                    partyId: appt.partyId,
                    dateTime: appt.dateTime,
                  }),
                });
              }
            }
            const { mediationSessionService } = await import("./services/mediation-session.service");
            const expiredSessions = await mediationSessionService.expireSessionHolds();
            if (expiredSessions.length > 0) {
              log(`Expired ${expiredSessions.length} mediation-session hold appointment(s)`);
            }
            const sessionPaymentReminders = await mediationSessionService.sendUnpaidPaymentReminders();
            if (sessionPaymentReminders.reminded > 0 || sessionPaymentReminders.adminTasks > 0) {
              log(`Created ${sessionPaymentReminders.reminded} mediation-session payment reminder(s) and ${sessionPaymentReminders.adminTasks} admin task(s)`);
            }
          } catch (err) {
            logger.error("[Expiry] Error in expiry job", err);
          }

          try {
            const { buildServiceApprovalActionPath, mediatorServiceApprovalService } = await import("./services/mediator-service-approval.service");
            const sweep = await mediatorServiceApprovalService.sweepExpiriesAndReminders();
            if (sweep.expired.length > 0 || sweep.reminderDue.length > 0) {
              const allUsers = await storage.listUsers();
              const admins = allUsers.filter(
                (u) => (u.role === "superadmin" || u.role === "subadmin") && u.status === "active",
              );
              for (const row of sweep.expired) {
                const service = await storage.getServiceType(row.serviceTypeId);
                const label = service?.name ?? "service";
                const actionPath = row.mediatorId ? buildServiceApprovalActionPath(row.mediatorId, row.serviceTypeId) : "/tasks";
                if (row.mediatorId) {
                  await notificationService.createNotification({
                    recipientId: row.mediatorId,
                    recipientRole: "mediator",
                    type: "service_approval_expired",
                    urgency: "amber",
                    caseId: null,
                    appointmentId: null,
                    title: `${label} approval expired`,
                    message: `Your approval for ${label} has expired. Please upload a refreshed certificate here: ${actionPath}.`,
                    caseNoteRequired: false,
                  }).catch(() => {});
                }
                for (const admin of admins) {
                  await notificationService.createNotification({
                    recipientId: admin.id,
                    recipientRole: "admin",
                    type: "service_approval_expired",
                    urgency: "amber",
                    caseId: null,
                    appointmentId: null,
                    title: `${label} approval expired`,
                    message: `Approval for ${label} on mediator ${row.mediatorId ?? row.applicantId ?? "unknown"} has expired. Open it here: ${actionPath}.`,
                    caseNoteRequired: false,
                  }).catch(() => {});
                }
              }
              for (const row of sweep.reminderDue) {
                const service = await storage.getServiceType(row.serviceTypeId);
                const label = service?.name ?? "service";
                const actionPath = row.mediatorId ? buildServiceApprovalActionPath(row.mediatorId, row.serviceTypeId) : "/tasks";
                if (row.mediatorId) {
                  await notificationService.createNotification({
                    recipientId: row.mediatorId,
                    recipientRole: "mediator",
                    type: "service_approval_expiry_reminder",
                    urgency: "blue",
                    caseId: null,
                    appointmentId: null,
                    title: `${label} approval expires soon`,
                    message: `Your approval for ${label} expires in 7 days. Please reupload your certificate here if needed: ${actionPath}.`,
                    caseNoteRequired: false,
                  }).catch(() => {});
                }
                for (const admin of admins) {
                  await notificationService.createNotification({
                    recipientId: admin.id,
                    recipientRole: "admin",
                    type: "service_approval_expiry_reminder",
                    urgency: "blue",
                    caseId: null,
                    appointmentId: null,
                    title: `${label} approval expires soon`,
                    message: `Approval for ${label} on mediator ${row.mediatorId ?? row.applicantId ?? "unknown"} expires in 7 days. Open it here: ${actionPath}.`,
                    caseNoteRequired: false,
                  }).catch(() => {});
                }
              }
            }
          } catch (err) {
            logger.error("[Service Approval Sweep] Error", err);
          }

          try {
            await xeroService.syncPendingInvoices(20);
          } catch (err) {
            logger.error("[Xero] Error in pending invoice sync sweep", err);
          }

          try {
            const persistentFollowUps = await notificationService.ensurePersistentIntakeFollowUps();
            if (persistentFollowUps.length > 0) {
              log(`Created ${persistentFollowUps.length} persistent intake follow-up task(s)`);
            }

            const escalated =
              await notificationService.escalateOverdueFollowUps();
            const dynamicDueAlerts = await notificationService.notifyDueDynamicIntakeFollowUps();
            if (dynamicDueAlerts.length > 0) {
              log(`Created ${dynamicDueAlerts.length} dynamic intake follow-up due alert(s)`);
            }
            if (escalated.length > 0) {
              log(`Escalated ${escalated.length} overdue follow-up task(s)`);
              const allUsers = await storage.listUsers();
              const adminUsers = allUsers.filter(
                (u) =>
                  (u.role === "superadmin" || u.role === "subadmin") &&
                  u.status === "active",
              );

              const baseUrl =
                process.env.BASE_URL ||
                (process.env.REPLIT_DEV_DOMAIN
                  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
                  : "");

              for (const task of escalated) {
                const recipientIds = Array.from(
                  new Set([
                    ...(task.assignedUserIds ?? []),
                    task.assignedTo,
                  ].filter((id): id is string => typeof id === "string" && id.length > 0)),
                );
                const recipients = recipientIds
                  .map((id) => allUsers.find((u) => u.id === id && u.status === "active"))
                  .filter((u): u is NonNullable<typeof u> => !!u);

                const caseRef = task.caseId
                  ? await storage
                      .getCase(task.caseId)
                      .then((c) => c?.caseRef)
                      .catch(() => undefined)
                  : undefined;

                const taskUrl = baseUrl
                  ? task.complaintId
                    ? `${baseUrl}/complaints/${task.complaintId}`
                    : `${baseUrl}/tasks`
                  : undefined;

                if (recipients.length > 0) {
                  for (const recipient of recipients) {
                    await sendTaskFollowUpReminderEmail(
                      recipient.email,
                      recipient.name,
                      task.title,
                      caseRef,
                      taskUrl,
                    );
                  }
                } else if (!task.complaintId) {
                  for (const admin of adminUsers) {
                    await sendTaskFollowUpReminderEmail(
                      admin.email,
                      admin.name,
                      task.title,
                      caseRef,
                      taskUrl,
                    );
                  }
                }
              }
            }
          } catch (err) {
            logger.error("[FollowUp] Error in follow-up escalation job", err);
          } finally {
            backgroundJobRunning = false;
          }
        },
        5 * 60 * 1000,
      );
      log(
        "Scheduled jobs armed: calendar sync, BFM health, token probe, expiry/service/Xero/follow-up sweeps",
      );
    },
  );
})().catch((err) => {
  readinessStatus = {
    ok: false,
    status: "startup_failed",
    reason: sanitizeReadinessReason(err),
    checkedAt: new Date().toISOString(),
  };
  logger.error("Server startup failed", err);
  process.exit(1);
});

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`Received ${signal}; shutting down`);
  for (const timer of shutdownTimers) clearTimeout(timer);

  const forceExit = setTimeout(() => {
    logger.error("Graceful shutdown timed out; forcing exit");
    process.exit(1);
  }, 25_000);
  forceExit.unref();

  try {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    await pool.end();
    log("Graceful shutdown complete");
    process.exit(0);
  } catch (err) {
    logger.error("Graceful shutdown failed", err);
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
