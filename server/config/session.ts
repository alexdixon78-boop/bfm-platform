import session from "express-session";
import pgSession from "connect-pg-simple";
import type { Express } from "express";
import { getPostgresPoolConfig } from "./postgres";

const PgStore = pgSession(session);

function getSessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production" || process.env.CONFIG_SOURCE === "aws") {
    throw new Error("SESSION_SECRET is required");
  }
  return "brighter-future-mediation-local-dev";
}

export function configureSession(app: Express) {
  app.set("trust proxy", 1);

  const sessionStore = new PgStore({
    conObject: getPostgresPoolConfig(),
    createTableIfMissing: false,
  });
  const explicitSecureCookie = process.env.SESSION_COOKIE_SECURE?.toLowerCase();
  const secureCookie =
    explicitSecureCookie === "true"
      ? true
      : explicitSecureCookie === "false"
        ? false
        : process.env.NODE_ENV === "production" || process.env.CONFIG_SOURCE === "aws";

  const sessionMiddleware = session({
    store: sessionStore,
    secret: getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: secureCookie,
      sameSite: "lax",
    },
  });

  app.use(sessionMiddleware);
  return { sessionMiddleware, sessionStore };
}
