import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const readIfPresent = (file: string) => fs.existsSync(path.join(root, file)) ? read(file) : "";

describe("private WhatsApp case schema", () => {
  it("defines dedicated private-note records, sessions, and attachments", () => {
    const schema = read("shared/schema.ts");
    assert.match(schema, /export const casePrivateNotes/);
    assert.match(schema, /export const casePrivateNoteAttachments/);
    assert.match(schema, /export const whatsappPrivateNoteSessions/);
    assert.match(schema, /authorPartyId/);
    assert.match(schema, /textRedactedAt/);
  });

  it("associates individual WhatsApp messages to a case and party", () => {
    const schema = read("shared/schema.ts");
    assert.match(schema, /caseId: varchar\("case_id"\).*whatsappMessages/s);
    assert.match(schema, /contentClassification/);
    assert.match(schema, /caseAssignmentSource/);
  });

  it("defines WhatsApp preferences, templates, and outbound media", () => {
    const schema = read("shared/schema.ts");
    assert.match(schema, /export const partyWhatsappPreferences/);
    assert.match(schema, /export const whatsappTemplateCatalog/);
    assert.match(schema, /export const whatsappOutboundMedia/);
  });

  it("ships both production migrations", () => {
    const privateNotes = readIfPresent("migrations/0058_private_case_notes.sql");
    const caseMessaging = readIfPresent("migrations/0059_case_whatsapp_messaging.sql");
    assert.match(privateNotes, /CREATE TABLE "case_private_notes"/);
    assert.match(privateNotes, /CREATE TABLE "whatsapp_private_note_sessions"/);
    assert.match(caseMessaging, /ALTER TABLE "whatsapp_messages"/);
    assert.match(caseMessaging, /CREATE TABLE "party_whatsapp_preferences"/);
  });
});
