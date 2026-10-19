import "dotenv/config";
import { runLoggedTask } from "./db-command-runner";
import { loadRuntimeEnv } from "../config/runtime-env";

async function main() {
  await loadRuntimeEnv();
  const { caseCommunicationLogService } = await import("../services/case-communication-log.service");
  const { pool } = await import("../db");

  try {
    const result = await caseCommunicationLogService.backfillExistingRecords();
    console.log("[CaseCommunicationBackfill] Complete", result);
  } finally {
    await pool.end();
  }
}

runLoggedTask("CaseCommunicationBackfill", main, {
  command: "tsx",
  args: ["server/scripts/backfill-case-communication-logs.ts"],
});
