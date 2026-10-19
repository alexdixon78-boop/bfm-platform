/**
 * Re-import Google timed events after the timestamp representation repair.
 * This is safe to rerun: it relies on the normal sync/reconciliation path,
 * preserves appointments, and marks its source updates as timestamp repairs.
 */
import "dotenv/config";
import { loadRuntimeEnv } from "../config/runtime-env";

async function main() {
  await loadRuntimeEnv();
  const { pool } = await import("../db");
  const { storage } = await import("../storage");
  const { googleCalendarService } = await import("../services/google-calendar.service");

  try {
    const mediators = (await storage.listUsers()).filter((mediator) =>
      mediator.role === "mediator" &&
      mediator.status === "active" &&
      mediator.googleCalendarConnected,
    );
    const results: Array<{ mediatorId: string; syncedCount?: number; error?: string }> = [];

    for (const mediator of mediators) {
      try {
        const { syncedCount } = await googleCalendarService.syncCalendar(mediator.id, "timestamp_repair");
        results.push({ mediatorId: mediator.id, syncedCount });
      } catch (error) {
        results.push({
          mediatorId: mediator.id,
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
