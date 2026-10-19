/**
 * Rebuild provider-backed bookable availability for every connected mediator.
 * Safe to rerun: normal reconciliation recreates only missing unbooked slots
 * and preserves appointments through its existing retirement rules.
 */
import "dotenv/config";
import { loadRuntimeEnv } from "../config/runtime-env";

async function main() {
  await loadRuntimeEnv();
  const { pool } = await import("../db");
  const { storage } = await import("../storage");
  const { googleCalendarService } = await import("../services/google-calendar.service");
  const { outlookCalendarService } = await import("../services/outlook-calendar.service");

  try {
    const mediators = (await storage.listUsers()).filter((mediator) =>
      mediator.role === "mediator" &&
      mediator.status === "active" &&
      ((mediator.activeCalendarProvider === "google" && mediator.googleCalendarConnected)
        || (mediator.activeCalendarProvider === "outlook" && mediator.outlookCalendarConnected)),
    );
    const results: Array<{
      mediatorId: string;
      provider: "google" | "outlook";
      outcome: "repaired" | "unchanged" | "error";
      syncedCount?: number;
      reconciliation?: unknown;
      error?: string;
    }> = [];

    for (const mediator of mediators) {
      const provider = mediator.activeCalendarProvider;
      if (provider !== "google" && provider !== "outlook") continue;
      try {
        const result = provider === "outlook"
          ? await outlookCalendarService.syncCalendar(mediator.id, "timestamp_repair")
          : await googleCalendarService.syncCalendar(mediator.id, "manual_sync");
        results.push({
          mediatorId: mediator.id,
          provider,
          outcome: provider === "outlook" && result.reconciliation.updated > 0 ? "repaired" : "unchanged",
          syncedCount: result.syncedCount,
          reconciliation: result.reconciliation,
        });
      } catch (error) {
        results.push({
          mediatorId: mediator.id,
          provider,
          outcome: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    console.log(JSON.stringify({
      processed: results.length,
      succeeded: results.filter((result) => result.error === undefined).length,
      failed: results.filter((result) => result.error !== undefined).length,
      results,
    }, null, 2));
    if (results.some((result) => result.error !== undefined)) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
