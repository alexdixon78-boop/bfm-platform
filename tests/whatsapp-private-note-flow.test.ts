import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), "utf8") : "";

describe("WhatsApp private-note workflow", () => {
  it("uses separate case-reference, email, OTP, and draft states", () => {
    const automation = read("server/services/whatsapp-automation.service.ts");
    assert.match(automation, /awaiting_case_reference/);
    assert.match(automation, /awaiting_identity_email/);
    assert.match(automation, /awaiting_private_note_content/);
    assert.match(automation, /finish_private_note/);
    assert.match(automation, /cancel_private_note/);
    assert.doesNotMatch(automation, /extractCaseRefAndEmail/);
  });

  it("implements a dedicated private-note service", () => {
    const service = read("server/services/whatsapp-private-note.service.ts");
    for (const method of ["startSession", "startPhoneMatchedSession", "setCaseReference", "submitIdentity", "appendText", "attachInboundMedia", "complete", "cancel", "listForActor", "redactText", "redactAttachment"]) {
      assert.match(service, new RegExp(`async ${method}\\(`));
    }
    assert.match(service, /No case matched those details/);
    assert.match(service, /noWhatsappOrVoicemail/);
    assert.match(service, /caseCommunicationLogService\.record/);
    assert.match(service, /caseActivityService\.log/);
    assert.match(service, /type: "private_whatsapp_note_received"/);
    assert.match(service, /relatedEntityType: "case_private_note"/);
    assert.match(service, /Private WhatsApp note received/);
    assert.doesNotMatch(service, /description:.*note\.body/s);
  });

  it("stores verified WhatsApp contact context and reuses only exact active phone matches", () => {
    const service = read("server/services/whatsapp-private-note.service.ts");
    assert.match(service, /findUniquePhoneCaseContext/);
    assert.match(service, /verificationStatus: "verified"/);
    assert.match(service, /clientId: party\?\.clientId \|\| null/);
    assert.match(service, /partyId: session\.partyId/);
    assert.match(service, /caseId: session\.caseId/);
    assert.match(service, /"identity_required" as const/);
    assert.match(service, /"verified" as const/);
  });

  it("exposes authenticated private-note APIs", () => {
    const routes = read("server/routes/whatsapp-private-note.routes.ts");
    assert.match(routes, /\/api\/cases\/:caseId\/private-notes/);
    assert.match(routes, /attachments\/:attachmentId\/download/);
    assert.match(routes, /\/redact/);
    assert.match(routes, /user\.role !== "superadmin"/);
  });

  it("lets administrators requeue failed attachments without weakening blocked-file rules", () => {
    const routes = read("server/routes/whatsapp-private-note.routes.ts");
    const service = read("server/services/whatsapp-private-note.service.ts");
    assert.match(routes, /attachments\/:attachmentId\/retry/);
    assert.match(routes, /superadmin.*subadmin|subadmin.*superadmin/s);
    assert.match(service, /async retryAttachment\(/);
    assert.match(service, /status: "queued"/);
    assert.match(service, /retryCount: 0/);
    assert.match(service, /eq\(casePrivateNoteAttachments\.status, "failed"\)/);
    assert.match(service, /gte\(casePrivateNoteAttachments\.retryCount, 6\)/);
  });

  it("uses case-detail capability for the Notes tab and renders recoverable load failures", () => {
    const caseService = read("server/services/case.service.ts");
    const page = read("client/src/pages/case-detail.tsx");
    const panel = read("client/src/components/cases/private-case-notes-panel.tsx");
    assert.match(caseService, /privateNotesAccess/);
    assert.match(page, /caseData\?\.privateNotesAccess/);
    assert.doesNotMatch(page, /private-notes\/access/);
    assert.match(panel, /Failed to load private notes/);
    assert.match(panel, /notes\.refetch/);
    assert.match(panel, /refetchInterval/);
    assert.match(panel, /Retry/);
  });

  it("enforces OTP expiry, attempts, invalidation, and send throttling", () => {
    const otp = read("server/services/whatsapp-otp.service.ts");
    assert.match(otp, /OTP_TTL_MINUTES = 10/);
    assert.match(otp, /OTP_MAX_ATTEMPTS = 5/);
    assert.match(otp, /OTP_MAX_SENDS_PER_HOUR = 3/);
    assert.match(otp, /OTP_RESEND_SECONDS = 60/);
    assert.match(otp, /consumedAt: new Date\(\)/);
  });
});
