import "dotenv/config";
import { runLoggedTask } from "./db-command-runner";
import { loadRuntimeEnv } from "../config/runtime-env";

async function main() {
  await loadRuntimeEnv();
  const { runDatabaseBootstrap } = await import("../db-bootstrap");
  const { pool } = await import("../db");
  try {
    await runDatabaseBootstrap();
  } finally {
    await pool.end();
  }
}

runLoggedTask("DbBootstrap", main, {
  command: "tsx",
  args: ["server/scripts/db-bootstrap.ts"],
});
