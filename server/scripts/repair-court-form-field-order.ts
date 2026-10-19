import "dotenv/config";
import { loadRuntimeEnv } from "../config/runtime-env";

async function main() {
  await loadRuntimeEnv();

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for court-forms:repair-field-order");
  }

  const { repairCourtFormTemplateFieldOrder } = await import("../services/court-form-field-order-repair.service");
  const { pool } = await import("../db");

  const result = await repairCourtFormTemplateFieldOrder();
  try {
    console.log(JSON.stringify(result, null, 2));
    if (result.failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main()
  .catch((err) => {
    console.error("Court form field order repair failed", err);
    process.exitCode = 1;
  });
