/**
 * Creates the admin-wide review notification for each unresolved live-mediator
 * service submission. Safe to rerun: the service deduplicates by review key.
 */
import "dotenv/config";
import { loadRuntimeEnv } from "../config/runtime-env";

async function main() {
  await loadRuntimeEnv();
  const { pool } = await import("../db");
  const { backfillPendingMediatorServiceReviewNotifications } = await import("../services/mediator-service-approval.service");

  try {
    console.log(JSON.stringify(await backfillPendingMediatorServiceReviewNotifications(), null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
