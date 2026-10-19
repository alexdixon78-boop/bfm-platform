/**
 * Regression checks for the documented confidentiality and data-isolation contract.
 *
 * Run with: npx tsx tests/replit-confidentiality-data-isolation-docs.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const docs = readFileSync(new URL("../replit.md", import.meta.url), "utf8");

test("documents the manual case confidentiality marker and its boundaries", () => {
  assert.match(docs, /\*\*Case Confidentiality Marker\*\*/);
  assert.match(docs, /`cases\.confidential`[\s\S]*`BOOLEAN NOT NULL DEFAULT false`/);
  assert.match(docs, /`PATCH \/api\/cases\/:id\/confidential`/);
  assert.match(docs, /Safeguarding concerns never enable this marker automatically/);
  assert.match(docs, /independent of `safeguardingConfidential`/);
  assert.match(docs, /clients never receive the case flag/);
  assert.match(docs, /derive `caseConfidential`[\s\S]*return `false` when no linked case exists/);
  assert.match(docs, /`0037_case_confidential_flag\.sql`/);
});

test("documents every centralized case access tier and reduced role scope", () => {
  assert.match(docs, /\*\*Case Access And Client Data Isolation\*\*/);
  for (const tier of [
    "admin",
    "full_mediator",
    "session_co_mediator",
    "miam_only_mediator",
    "session_observer",
    "client_party",
    "none",
  ]) {
    assert.equal(docs.includes(`\`${tier}\``), true, `missing documented access tier: ${tier}`);
  }
  assert.match(docs, /explicit allowlisted DTOs/);
  assert.match(docs, /MIAM-only mediators are restricted to their assigned parties and MIAM workflow/);
  assert.match(docs, /Accepted co-mediators and observers can find the case in the Cases listing/);
  assert.match(docs, /appointments and sessions are limited to exact accepted assignments/);
  assert.match(docs, /Accepted co-mediators have the same non-admin Mediation Sessions actions as that session's lead, while observers remain read-only/);
  assert.match(docs, /Confidential notes, communication ledgers, proofing, finance/);
});

test("documents client appointment visibility and audited meeting-link release", () => {
  assert.match(docs, /Clients see only appointments assigned to their own party plus genuinely joint appointments where `partyId` is null/);
  assert.match(docs, /appointment lists, case history, joining, cancellation requests, and dashboard queries use the same predicate/);
  assert.match(docs, /exclude other-party identity, notes, raw meeting links, Xero\/payment internals, and staff metadata/);
  assert.match(docs, /`POST \/api\/appointments\/:id\/join`/);
});

test("documents protected case-document downloads and legacy URL blocking", () => {
  assert.match(docs, /\*\*Protected Case Documents\*\*/);
  assert.match(docs, /`GET \/api\/case-documents\/:documentId\/download`/);
  assert.match(docs, /`reviewed`[\s\S]*`sharedWithClients`[\s\S]*`partyId` null/);
  assert.match(docs, /never expose the database `storageKey`/);
  assert.match(docs, /Missing and unauthorized IDs both return a generic `404`/);
  assert.match(docs, /`\/uploads\/case-documents\/\*` is blocked/);
  assert.match(docs, /`X-Content-Type-Options: nosniff`/);
  assert.match(docs, /successful and denied attempts are audit-logged/);
});

test("documents API no-store behavior and complete browser logout cleanup", () => {
  assert.match(docs, /Every `\/api` response receives `Cache-Control: no-store`/);
  assert.match(docs, /Logout destroys the server session and clears the session cookie/);
  assert.match(docs, /cancels active authenticated queries/);
  assert.match(docs, /clears the previous user's React Query data and transient session storage/);
  assert.match(docs, /redirects to `\/login` with history replacement/);
  assert.match(docs, /Protected APIs continue to enforce the server session and return `401` after logout/);
});
