import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("WhatsApp private media is downloaded, size-limited, type-detected, and privately stored without a scanner dependency", () => {
  const worker = read("server/services/whatsapp-media-worker.service.ts");
  const validation = read("server/services/whatsapp-media-validation.ts");
  assert.match(worker, /downloadMedia/);
  assert.match(worker, /validateWhatsappMediaBuffer/);
  assert.match(worker, /savePrivateCaseNoteAttachment/);
  assert.doesNotMatch(worker, /clamav/i);
  assert.match(validation, /MAX_WHATSAPP_MEDIA_BYTES/);
  assert.match(validation, /image\/jpeg/);
  assert.match(validation, /image\/png/);
  assert.match(validation, /application\/pdf/);
  assert.match(validation, /wordprocessingml\.document/);
  assert.match(validation, /application\/msword/);
  assert.match(validation, /text\/plain/);
  assert.match(worker, /"blocked"/);
});

test("outbound media is uploaded only after type and size validation", () => {
  const worker = read("server/services/whatsapp-media-worker.service.ts");
  assert.match(worker, /openCaseDocumentByStorageKey/);
  assert.match(worker, /openWhatsappOutboundMedia/);
  assert.match(worker, /readAndValidateWhatsappMedia/);
  assert.match(worker, /uploadMedia/);
  assert.match(worker, /metaMediaId/);
  assert.match(worker, /status: "clean"/);
  assert.doesNotMatch(worker, /clamav/i);
});

test("media failures are logged safely and invalid files are not retried", () => {
  const worker = read("server/services/whatsapp-media-worker.service.ts");
  assert.match(worker, /logger\.warn\("WhatsApp media processing failed"/);
  assert.match(worker, /failureCategory/);
  assert.match(worker, /WhatsappMediaValidationError/);
  assert.match(worker, /"blocked"/);
  assert.doesNotMatch(worker, /logger\.warn\([^\n]*fileName/);
});

test("private attachment processing cannot revive cancelled or redacted media", () => {
  const worker = read("server/services/whatsapp-media-worker.service.ts");
  assert.match(worker, /innerJoin\(casePrivateNotes/);
  assert.match(worker, /inArray\(casePrivateNotes\.status, \["draft", "completed"\]\)/);
  assert.match(worker, /eq\(casePrivateNoteAttachments\.status, "quarantined"\)/);
  assert.match(worker, /isNull\(casePrivateNoteAttachments\.redactedAt\)/);
  assert.match(worker, /deletePrivateCaseNoteAttachment\(stored\.storageKey\)/);
  assert.match(worker, /eq\(casePrivateNoteAttachments\.processingLeaseExpiresAt, leaseExpiresAt\)/);
  assert.match(worker, /crypto\.randomUUID\(\)/);
  const notes = read("server/services/whatsapp-private-note.service.ts");
  assert.match(notes, /status: "cancelled"[\s\S]*status: "failed"[\s\S]*deletePrivateCaseNoteAttachment/);
  assert.match(notes, /status: "redacted"[\s\S]*deletePrivateCaseNoteAttachment/);
});

test("the application schedules the media worker", () => {
  const app = read("server/app.ts");
  assert.match(app, /whatsappMediaWorkerService/);
  assert.match(app, /processDue/);
});
