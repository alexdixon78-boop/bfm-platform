/**
 * Task #191 — Regression check for the per-mediator refresh-token preservation
 * fix in `googleCalendarService.exchangeCodeAndSave` (server/services/google-
 * calendar.service.ts).
 *
 * BACKGROUND
 * Google's OAuth token endpoint only returns a `refresh_token` on the FIRST
 * grant (and on a re-grant where the user explicitly clicks "remove access"
 * first). Every subsequent re-auth returns an `access_token` ONLY. The
 * pre-fix code unconditionally wrote `googleRefreshToken: tokens.refresh_token
 * ?? null` which silently wiped a perfectly good refresh token every time the
 * mediator re-authorised — guaranteeing the calendar would auto-disconnect
 * within a few hours.
 *
 * The fix: only write `googleRefreshToken` when `tokens.refresh_token` is
 * actually present (COALESCE-style preservation).
 *
 * THIS SCRIPT
 * Greps the source file for the regression pattern and asserts the fix is in
 * place. It does NOT make any DB or Google API calls — purely static.
 *
 * Run with:  npx tsx scripts/verify-task-191-refresh-token-preservation.ts
 * Exits 0 on pass, 1 on regression.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVICE_PATH = resolve(__dirname, "..", "server", "services", "google-calendar.service.ts");

function fail(msg: string): never {
  console.error(`\u274C  Task #191 regression: ${msg}`);
  process.exit(1);
}

function pass(msg: string) {
  console.log(`\u2705  ${msg}`);
}

const src = readFileSync(SERVICE_PATH, "utf8");

// Locate the mediator-side exchangeCodeAndSave method.
const exchangeIdx = src.indexOf("exchangeCodeAndSave");
if (exchangeIdx === -1) fail("Could not find exchangeCodeAndSave in google-calendar.service.ts");

// Look at a window starting from the method declaration through the next
// 4000 chars (well past where the updateUser call lives).
const window = src.slice(exchangeIdx, exchangeIdx + 4000);

// REGRESSION PATTERN — what we MUST NOT see again. The pre-fix code did:
//   googleRefreshToken: tokens.refresh_token ?? null
// or any unconditional `googleRefreshToken: tokens.refresh_token` inside the
// updateUser payload.
const badPatterns: RegExp[] = [
  /googleRefreshToken:\s*tokens\.refresh_token\s*\?\?\s*null/,
  /googleRefreshToken:\s*tokens\.refresh_token\s*,?\s*\n/,
];
for (const re of badPatterns) {
  if (re.test(window)) {
    fail(
      `Found regression: \`${re.source}\` matches inside exchangeCodeAndSave. ` +
      `This will overwrite a healthy refresh token with undefined/null on re-auth.`,
    );
  }
}

// FIX PATTERN — there must be a guard that only writes the field when
// tokens.refresh_token is truthy. We accept either an `if (tokens.refresh_token)`
// guard or an explicit `...(tokens.refresh_token ? { googleRefreshToken: ... } : {})`
// spread.
const fixPatterns: RegExp[] = [
  /if\s*\(\s*tokens\.refresh_token\s*\)/,
  /tokens\.refresh_token\s*\?\s*\{\s*googleRefreshToken/,
];
const fixed = fixPatterns.some((re) => re.test(window));
if (!fixed) {
  fail(
    "exchangeCodeAndSave does not appear to guard googleRefreshToken behind a " +
    "`if (tokens.refresh_token)` check. The fix may have regressed.",
  );
}

pass("exchangeCodeAndSave preserves an existing refresh token when Google omits it on re-auth.");

// Also verify the shared reauth-fan-out helper exists (required by Task #191).
const helperPath = resolve(__dirname, "..", "server", "services", "calendar-reauth.service.ts");
let helperSrc = "";
try {
  helperSrc = readFileSync(helperPath, "utf8");
} catch {
  fail("calendar-reauth.service.ts is missing — shared fan-out helper required by Task #191.");
}
if (!/markMediatorNeedsReauthAndNotify/.test(helperSrc) || !/markBfmNeedsReauthAndNotify/.test(helperSrc)) {
  fail("calendar-reauth.service.ts is missing the required exports.");
}
if (!/IS DISTINCT FROM 'needs_reauth'/.test(helperSrc)) {
  fail("calendar-reauth.service.ts is not using the atomic compare-and-set guard.");
}
if (!/entity:\s*"mediator_calendar"/.test(helperSrc)) {
  fail('Mediator audit entries must use entity: "mediator_calendar" (Task #191 contract).');
}
pass("Shared reauth-fan-out helper present, atomic, and uses the mediator_calendar audit entity.");

// ── Ordering check: helper MUST run BEFORE any inline pre-write of
// `lastError = 'needs_reauth'` in the real-call paths, otherwise the
// helper's atomic compare-and-set will see needs_reauth already set and
// firstFlip will be false → no audit, no email, no notification.

function assertHelperFirst(methodName: string, helperFnName: string, errorField: string) {
  // Capture from the method declaration through the next `^  }` (end of
  // method) to scope our search.
  const methodStart = src.indexOf(`async ${methodName}(`);
  if (methodStart === -1) fail(`Could not find ${methodName} in google-calendar.service.ts`);
  // Use a generous window — methods aren't huge.
  const methodSrc = src.slice(methodStart, methodStart + 6000);
  const helperIdx = methodSrc.indexOf(helperFnName);
  if (helperIdx === -1) {
    fail(`${methodName} does not call ${helperFnName} — real-call path is missing reauth fan-out.`);
  }
  // Find any inline pre-write of `<errorField>: "needs_reauth"` BEFORE the
  // helper call. Must not exist, otherwise firstFlip will be swallowed.
  const preWriteRe = new RegExp(`${errorField}\\s*:\\s*"needs_reauth"`);
  const preMatch = methodSrc.slice(0, helperIdx).match(preWriteRe);
  if (preMatch) {
    fail(
      `${methodName} writes \`${errorField}: "needs_reauth"\` BEFORE calling ${helperFnName}. ` +
      `This masks the helper's atomic compare-and-set and silently swallows first-flip fan-out.`,
    );
  }
}

assertHelperFirst("syncCalendar", "markMediatorNeedsReauthAndNotify", "lastCalendarSyncError");
pass("syncCalendar invokes the reauth helper BEFORE any inline lastCalendarSyncError write.");

assertHelperFirst("bfmHealthCheck", "markBfmNeedsReauthAndNotify", "lastHealthCheckError");
pass("bfmHealthCheck invokes the reauth helper BEFORE any inline lastHealthCheckError write.");

// ── BFM lifecycle stickiness check: the early "not_connected" branch in
// bfmHealthCheck must preserve a prior needs_reauth flag, otherwise the
// daily sweep silently downgrades the row and the UI loses the distinct
// "Reauthentication required" state.
const bfmIdx = src.indexOf("async bfmHealthCheck(");
const bfmHead = src.slice(bfmIdx, bfmIdx + 2000);
if (!/needs_reauth/.test(bfmHead) || !/lastHealthCheckError\s*===\s*"needs_reauth"|conn\?\.googleRefreshToken/.test(bfmHead)) {
  fail(
    'bfmHealthCheck early-exit branch must preserve a prior needs_reauth flag (do not downgrade to "not_connected"). ' +
    "See task #191 BFM lifecycle requirement.",
  );
}
pass("bfmHealthCheck preserves a sticky needs_reauth flag on its early-exit path.");

// ── De-dupe check: server/index.ts must NOT independently send a BFM admin
// alert when the failure is needs_reauth — the helper already owns that
// fan-out. If the outer job re-fires, admins get a fresh red email every
// 24h while the calendar is in needs_reauth.
const indexPath = resolve(__dirname, "..", "server", "index.ts");
const indexSrc = readFileSync(indexPath, "utf8");
const sweepIdx = indexSrc.indexOf("runBfmHealthCheck");
const sweepBlock = indexSrc.slice(sweepIdx, sweepIdx + 4000);
if (!/!result\.needsReauth/.test(sweepBlock)) {
  fail(
    "runBfmHealthCheck in server/index.ts must guard its own admin email/notification fan-out " +
    "behind `if (!result.needsReauth)` so duplicate alerts are suppressed for needs_reauth.",
  );
}
pass("runBfmHealthCheck suppresses duplicate admin alerts for needs_reauth.");

console.log("\nAll Task #191 regression checks passed.");
