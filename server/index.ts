import "dotenv/config";
import { loadRuntimeEnv } from "./config/runtime-env";

loadRuntimeEnv()
  .then(async () => {
    await import("./app");
  })
  .catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[RuntimeEnv] App startup failed: ${message}`);
    process.exit(1);
  });
