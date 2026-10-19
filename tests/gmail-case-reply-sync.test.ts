import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCaseReplyAddress,
  canLinkCaseReplySender,
  extractCaseReplyToken,
  hasSafeReplyAttachmentSignature,
  hashCaseReplyToken,
  normalizeEmailAddress,
  redactCaseReplyAddress,
  validateReplyAttachment,
} from "../server/services/gmail-case-reply-utils";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("case reply addresses use an opaque plus tag without storing the raw token", () => {
  const token = "A_secure-token.123";
  assert.equal(
    buildCaseReplyAddress("Info@BrighterFutureMediation.co.uk", token),
    "info+bfm-A_secure-token.123@brighterfuturemediation.co.uk",
  );
  assert.equal(
    extractCaseReplyToken('Brighter Future Mediation <info+bfm-A_secure-token.123@brighterfuturemediation.co.uk>'),
    token,
  );
  assert.equal(extractCaseReplyToken("info@brighterfuturemediation.co.uk"), null);
  assert.equal(hashCaseReplyToken(token), hashCaseReplyToken(token));
  assert.notEqual(hashCaseReplyToken(token), token);
  assert.equal(
    redactCaseReplyAddress(buildCaseReplyAddress("info@example.com", token)),
    "info+bfm-[redacted]@example.com",
  );
  assert.equal(
    redactCaseReplyAddress(`To: info+bfm-${token}@example.com, copy+bfm-second@example.com`),
    "To: info+bfm-[redacted]@example.com, copy+bfm-[redacted]@example.com",
  );
});

test("sender matching is case-insensitive and strips display-name wrappers", () => {
  assert.equal(normalizeEmailAddress('Client Name <CLIENT@example.com>'), "client@example.com");
  assert.equal(normalizeEmailAddress(" client@example.com "), "client@example.com");
  assert.equal(canLinkCaseReplySender(false, "CLIENT@example.com", "client@example.com"), true);
  assert.equal(canLinkCaseReplySender(false, "forwarder@example.com", "client@example.com"), false);
  assert.equal(canLinkCaseReplySender(true, "forwarder@example.com", "client@example.com"), true);
});

test("reply attachments enforce type and per-file size limits", () => {
  assert.deepEqual(validateReplyAttachment("evidence.pdf", "application/pdf", 1024), { ok: true });
  assert.deepEqual(validateReplyAttachment("photo.jpg", "image/jpeg", 10 * 1024 * 1024), { ok: true });
  assert.deepEqual(validateReplyAttachment("payload.exe", "application/octet-stream", 20), {
    ok: false,
    reason: "unsupported_type",
  });
  assert.deepEqual(validateReplyAttachment("payload.exe", "application/pdf", 20), {
    ok: false,
    reason: "unsupported_type",
  });
  assert.equal(hasSafeReplyAttachmentSignature("application/pdf", Buffer.from("%PDF-1.7")), true);
  assert.equal(hasSafeReplyAttachmentSignature("application/pdf", Buffer.from("MZ executable")), false);
  assert.deepEqual(validateReplyAttachment("large.pdf", "application/pdf", 10 * 1024 * 1024 + 1), {
    ok: false,
    reason: "too_large",
  });
});

test("schema, migration, bootstrap, and delivery service persist reply matching state", () => {
  const schema = read("../shared/schema.ts");
  const migration = read("../migrations/0057_gmail_case_reply_sync.sql");
  const journal = read("../migrations/meta/_journal.json");
  const bootstrap = read("../server/db-bootstrap.ts");
  const emailService = read("../server/services/case-email.service.ts");
  const delivery = read("../server/services/email.service.ts");

  for (const field of ["replyTokenHash", "replyToEmail", "gmailThreadId"]) {
    assert.match(schema, new RegExp(`${field}:`));
  }
  assert.match(schema, /gmailCaseReplyAttachments = pgTable\("gmail_case_reply_attachments"/);
  assert.match(schema, /gmailReplySyncState = pgTable\("gmail_reply_sync_state"/);
  assert.match(migration, /reply_token_hash/);
  assert.match(migration, /gmail_case_reply_attachments/);
  assert.match(migration, /gmail_reply_sync_state/);
  assert.match(journal, /0057_gmail_case_reply_sync/);
  const journalEntries = JSON.parse(journal).entries as Array<{ idx: number; when: number }>;
  const migration56 = journalEntries.find((entry) => entry.idx === 56)!;
  const migration57 = journalEntries.find((entry) => entry.idx === 57)!;
  assert.ok(migration57.when > migration56.when, "migration 0057 must sort after 0056");
  assert.match(bootstrap, /gmail_case_reply_attachments/);
  assert.match(bootstrap, /gmail_reply_sync_state/);
  assert.match(emailService, /hashCaseReplyToken/);
  assert.match(emailService, /replyTo:/);
  assert.match(delivery, /replyTo\?: string/);
  assert.match(delivery, /reply_to/);
});

test("reply sync, detail API, worker, and UI are wired end to end", () => {
  const sync = read("../server/services/gmail-case-reply-sync.service.ts");
  const routes = read("../server/routes/case-communication.routes.ts");
  const app = read("../server/app.ts");
  const page = read("../client/src/pages/case-detail.tsx");
  const mail = read("../server/services/gmail-mail.service.ts");
  const docs = read("../replit.md");

  assert.match(sync, /async syncReplies/);
  assert.match(sync, /pg_try_advisory_lock/);
  assert.match(sync, /gmail_case_reply/);
  assert.match(sync, /case_linked/);
  assert.match(sync, /toEmails: redactCaseReplyAddress/);
  assert.match(sync, /createNotification/);
  assert.match(sync, /id: row\.id/);
  assert.match(sync, /id: attachmentState\.id/);
  assert.match(sync, /checkpointAt: attemptAt/);
  assert.match(sync, /recipientRole: "gmail_case_reply_recipient"/);
  assert.match(sync, /isNull\(gmailMessages\.linkedEnquiryId\)/);
  assert.match(routes, /communications\/:communicationId\/email/);
  assert.match(routes, /getEmailDetail/);
  assert.match(app, /gmailCaseReplySyncService\.syncReplies/);
  assert.match(app, /2 \* 60 \* 1000/);
  assert.match(page, /hasEmailDetail/);
  assert.match(page, /attachmentCount/);
  assert.match(page, /communication-email-detail/);
  assert.match(mail, /case_linked/);
  assert.match(mail, /isNull\(gmailMessages\.linkedCaseEmailMessageId\)/);
  assert.match(read("../client/src/pages/mail-inbox.tsx"), /!selectedImported\.linkedCaseEmailMessageId/);
  assert.match(docs, /Automatic Gmail Reply Capture/);
});
