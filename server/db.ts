import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import {
  getPostgresPoolConfig,
  sanitizePostgresPoolError,
} from "./config/postgres";
import { logger } from "./logger";

export const pool = new Pool(getPostgresPoolConfig());

pool.on("error", (err) => {
  logger.error(
    "PostgreSQL pool idle client error; client will be discarded",
    sanitizePostgresPoolError(err),
    "postgres",
  );
});

export const db = drizzle(pool, { schema });
