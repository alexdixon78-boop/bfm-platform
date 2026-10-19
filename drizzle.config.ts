import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { getDrizzleKitPostgresCredentials } from "./server/config/postgres";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is unavailable. Use `npm run db:generate` so runtime configuration (including AWS Secrets Manager) is loaded before Drizzle starts.",
  );
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: getDrizzleKitPostgresCredentials(),
});
