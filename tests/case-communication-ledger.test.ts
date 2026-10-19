import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("case communication ledger schema, migration, bootstrap, and journal are present", () => {
  const schema = read("../shared/schema.ts");
  const migration = read("../migrations/0018_case_communication_ledger.sql");
  const actorRepairMigration = read("../migrations/0019_case_communication_actor_history.sql");
  const journal = read("../migrations/meta/_journal.json");
  const bootstrap = read("../server/db-bootstrap.ts");

  assert.match(schema, /caseCommunicationLogs = pgTable\("case_communication_logs"/);
  for (const field of [
    "caseId",
    "caseRef",
    "partyId",
    "clientId",
    "recipientType",
    "recipientName",
    "recipientEmail",
    "recipientPhone",
    "channel",
    "direction",
    "trigger",
    "templateName",
    "sentAt",
    "deliveryStatus",
    "sourceEntityType",
    "sourceEntityId",
    "providerMessageId",
    "actorType",
    "actorId",
    "preview",
    "metadata",
    "backfillConfidence",
  ]) {
    assert.match(schema, new RegExp(`${field}:`), `${field} should exist on caseCommunicationLogs`);
  }

  assert.match(migration, /CREATE TABLE "case_communication_logs"/);
  assert.match(migration, /"case_id" varchar NOT NULL/);
  assert.match(migration, /"case_ref" text NOT NULL/);
  assert.match(migration, /"backfill_confidence" text NOT NULL DEFAULT 'exact'/);
  assert.match(migration, /case_communication_logs_source_unique_idx/);
  assert.match(journal, /"tag": "0018_case_communication_ledger"/);
  assert.match(journal, /"tag": "0019_case_communication_actor_history"/);
  assert.match(actorRepairMigration, /DROP CONSTRAINT IF EXISTS "case_communication_logs_actor_id_users_id_fk"/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS case_communication_logs/);
  assert.match(bootstrap, /case_communication_logs_source_unique_idx/);
  assert.match(schema, /actorId: varchar\("actor_id"\),/);
  const communicationDefinition = schema.slice(schema.indexOf('export const caseCommunicationLogs'), schema.indexOf('export const miamRecords'));
  assert.doesNotMatch(communicationDefinition, /actorId: varchar\("actor_id"\)\.references/);
  assert.match(bootstrap, /actor_id VARCHAR,\n/);
  const communicationBootstrap = bootstrap.slice(bootstrap.indexOf('CREATE TABLE IF NOT EXISTS case_communication_logs'), bootstrap.indexOf('CREATE TABLE IF NOT EXISTS email_templates'));
  assert.doesNotMatch(communicationBootstrap, /actor_id VARCHAR REFERENCES users\(id\)/);
});

test("communication ledger service provides idempotent future writes and best-effort historical backfill", () => {
  const service = read("../server/services/case-communication-log.service.ts");
  const script = read("../server/scripts/backfill-case-communication-logs.ts");

  assert.match(service, /class CaseCommunicationLogService/);
  assert.match(service, /async record\(input: RecordCommunicationInput\)/);
  assert.match(service, /onConflictDoNothing/);
  assert.match(service, /async backfillExistingRecords/);
  assert.match(service, /backfillFromCaseActivities/);
  assert.match(service, /backfillFromWhatsappMessages/);
  assert.match(service, /backfillFromGmailMessages/);
  assert.match(service, /backfillConfidence: "exact"/);
  assert.match(service, /backfillConfidence: "inferred"/);
  assert.match(service, /backfillConfidence: "partial"/);
  assert.match(service, /deliveryStatus: normalizeDeliveryStatus/);
  assert.match(script, /import "dotenv\/config"/);
  assert.match(script, /runLoggedTask\("CaseCommunicationBackfill"/);
});

test("case communication routes expose staff-only manual logging and filterable case ledger listing", () => {
  const routes = read("../server/routes/case-communication.routes.ts");
  const index = read("../server/routes/index.ts");

  assert.match(routes, /\/api\/cases\/:id\/communications/);
  assert.match(routes, /\/api\/cases\/:id\/communications\/manual/);
  assert.match(routes, /requirePermission\("cases", "view"\)/);
  assert.match(routes, /requirePermission\("cases", "edit"\)/);
  assert.match(routes, /user\.role === "client"/);
  assert.match(routes, /channel/);
  assert.match(routes, /deliveryStatus/);
  assert.match(routes, /recipientId/);
  assert.match(routes, /dateFrom/);
  assert.match(routes, /dateTo/);
  assert.match(index, /caseCommunicationRoutes/);
});

test("future email, WhatsApp, Gmail, and manual flows write to the dedicated communication ledger", () => {
  const activity = read("../server/services/case-activity.service.ts");
  const whatsapp = read("../server/services/whatsapp-conversation.service.ts");
  const gmail = read("../server/services/gmail-mail.service.ts");
  const routes = read("../server/routes/case-activity.routes.ts");

  assert.match(activity, /caseCommunicationLogService\.record/);
  assert.match(activity, /sourceEntityType: "case_activity"/);
  assert.match(whatsapp, /caseCommunicationLogService\.recordWhatsappMessage/);
  assert.match(gmail, /caseCommunicationLogService\.recordGmailMessage/);
  assert.match(routes, /caseCommunicationLogService\.recordManualCommunication/);
});

test("case detail communications tab uses the dedicated ledger and replit documents the architecture", () => {
  const casePage = read("../client/src/pages/case-detail.tsx");
  const replit = read("../replit.md");

  assert.match(casePage, /CaseCommunicationsLedger/);
  assert.match(casePage, /\/api\/cases\/\$\{caseId\}\/communications/);
  assert.match(casePage, /data-testid="case-communication-row"/);
  assert.match(casePage, /select-communication-channel/);
  assert.match(casePage, /select-communication-delivery-status/);
  assert.match(casePage, /select-communication-recipient/);
  assert.match(casePage, /\/api\/cases\/\$\{caseId\}\/communications\/manual/);

  assert.match(replit, /Case Communication Ledger/);
  assert.match(replit, /case_communication_logs/);
  assert.match(replit, /best-effort historical backfill/);
});
