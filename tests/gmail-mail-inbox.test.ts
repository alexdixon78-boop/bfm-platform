/**
 * Regression tests for the manual Gmail pull inbox.
 *
 * Run with: npx tsx tests/gmail-mail-inbox.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("BFM OAuth requests Gmail readonly while mediator OAuth stays calendar-only", () => {
  const source = read("../server/services/google-calendar.service.ts");
  const bfmScopeBlock = source.match(/const BFM_SCOPES = \[([\s\S]*?)\];/);
  const mediatorScopeBlock = source.match(/const SCOPES = \[([\s\S]*?)\];/);

  assert.ok(bfmScopeBlock, "BFM_SCOPES should be defined separately");
  assert.ok(mediatorScopeBlock, "mediator SCOPES should remain separate");
  assert.match(source, /GMAIL_READONLY_SCOPE = "https:\/\/www\.googleapis\.com\/auth\/gmail\.readonly"/);
  assert.match(bfmScopeBlock[1], /GMAIL_READONLY_SCOPE/);
  assert.doesNotMatch(mediatorScopeBlock[1], /GMAIL_READONLY_SCOPE/);
  assert.match(source, /hasGmailReadonlyScope/);
  assert.match(source, /scope: BFM_SCOPES/);
});

test("schema and bootstrap define imported Gmail mail records", () => {
  const schemaSource = read("../shared/schema.ts");
  const bootstrapSource = read("../server/db-bootstrap.ts");

  assert.match(schemaSource, /export const gmailMessages = pgTable\("gmail_messages"/);
  assert.match(schemaSource, /gmailMessageId:\s*text\("gmail_message_id"\)\.notNull\(\)\.unique\(\)/);
  assert.match(schemaSource, /gmailThreadId:\s*text\("gmail_thread_id"\)/);
  assert.match(schemaSource, /fromEmail:\s*text\("from_email"\)\.notNull\(\)/);
  assert.match(schemaSource, /sanitizedHtmlBody:\s*text\("sanitized_html_body"\)/);
  assert.match(schemaSource, /linkedEnquiryId:\s*varchar\("linked_enquiry_id"\)/);
  assert.match(schemaSource, /linkedCaseId:\s*varchar\("linked_case_id"\)/);
  assert.match(bootstrapSource, /CREATE TABLE IF NOT EXISTS gmail_messages/);
  assert.match(bootstrapSource, /gmail_message_id TEXT NOT NULL UNIQUE/);
});

test("mail routes expose preview, import, list, detail and conversion endpoints for admins only", () => {
  const routeSource = read("../server/routes/mail.routes.ts");
  const serviceSource = read("../server/services/gmail-mail.service.ts");
  const indexSource = read("../server/routes/index.ts");

  assert.match(indexSource, /import mailRoutes from "\.\/mail\.routes"/);
  assert.match(indexSource, /app\.use\(mailRoutes\)/);
  assert.match(routeSource, /requireMailAdmin/);
  assert.match(routeSource, /user\.role !== "superadmin" && user\.role !== "subadmin"/);
  assert.match(routeSource, /router\.post\("\/api\/mail\/gmail\/preview"/);
  assert.match(routeSource, /router\.post\("\/api\/mail\/gmail\/import"/);
  assert.match(routeSource, /router\.get\("\/api\/mail\/messages"/);
  assert.match(routeSource, /router\.get\("\/api\/mail\/messages\/:id"/);
  assert.match(routeSource, /router\.post\("\/api\/mail\/messages\/:id\/convert"/);
  assert.match(serviceSource, /previewRecent/);
  assert.match(serviceSource, /previewSearch/);
  assert.match(serviceSource, /importMessages/);
  assert.match(serviceSource, /markConverted/);
  assert.match(serviceSource, /onConflictDoUpdate/);
});

test("mail inbox UI is routed below Enquiries and supports manual pull plus convert-to-enquiry", () => {
  const sidebarSource = read("../client/src/components/layout/app-sidebar.tsx");
  const layoutSource = read("../client/src/components/layout/dashboard-layout.tsx");
  const pageSource = read("../client/src/pages/mail-inbox.tsx");

  assert.match(sidebarSource, /Mail Inbox/);
  assert.match(sidebarSource, /url: "\/mail-inbox"/);
  assert.match(sidebarSource, /staffOnly: true/);
  assert.match(layoutSource, /MailInboxPage/);
  assert.match(layoutSource, /path="\/mail-inbox"/);
  assert.match(pageSource, /\/api\/mail\/gmail\/preview/);
  assert.match(pageSource, /\/api\/mail\/gmail\/import/);
  assert.match(pageSource, /\/api\/mail\/messages/);
  assert.match(pageSource, /searchQuery/);
  assert.match(pageSource, /recentLimit/);
  assert.match(pageSource, /Convert to enquiry/);
  assert.match(pageSource, /\/api\/enquiries/);
  assert.match(pageSource, /\/api\/mail\/messages\/\$\{selectedMessage\.id\}\/convert/);
  assert.match(pageSource, /Converted/);
});

test("mail inbox delete actions use repo modal confirmations instead of browser confirm", () => {
  const pageSource = read("../client/src/pages/mail-inbox.tsx");

  assert.match(pageSource, /DeleteDialog/);
  assert.match(pageSource, /Delete imported email from active inbox views\?/);
  assert.match(pageSource, /Delete selected imported emails from active inbox views\?/);
  assert.match(pageSource, /button-confirm-delete-imported-mail/);
  assert.match(pageSource, /button-confirm-bulk-delete-imported-mail/);
  assert.match(pageSource, /original email stays in Gmail/);
  assert.match(pageSource, /restored from Deleted mail/);
  assert.doesNotMatch(pageSource, /window\.confirm/);
});

test("mail preview handles recent and general Gmail search request payloads separately", () => {
  const routeSource = read("../server/routes/mail.routes.ts");
  const serviceSource = read("../server/services/gmail-mail.service.ts");
  const pageSource = read("../client/src/pages/mail-inbox.tsx");

  assert.match(routeSource, /z\.discriminatedUnion\("mode"/);
  assert.match(routeSource, /z\.literal\("recent"\)/);
  assert.match(routeSource, /mode:\s*z\.literal\("search"\)/);
  assert.match(routeSource, /searchQuery:\s*z\.string\(\)\.trim\(\)\.min\(1/);
  assert.doesNotMatch(routeSource, /senderEmail:\s*z\.string\(\)\.trim\(\)\.email\(\)/);
  assert.match(serviceSource, /previewSearch\(searchQuery: string, limit: number\)/);
  assert.match(serviceSource, /q = input\.mode === "search" && input\.searchQuery/);
  assert.match(pageSource, /const \[searchQuery, setSearchQuery\]/);
  assert.match(pageSource, /Search Gmail/);
  assert.match(pageSource, /Name, partial email, subject, or Gmail search query/);
  assert.match(pageSource, /const payload = mode === "search"/);
  assert.match(pageSource, /searchQuery:\s*searchQuery\.trim\(\)/);
  assert.match(pageSource, /:\s*\{\s*mode,\s*recentLimit\s*\}/);
  assert.match(pageSource, /apiRequest\("POST", "\/api\/mail\/gmail\/preview", payload\)/);
  assert.doesNotMatch(pageSource, /senderEmail/);
});

test("mail detail refreshes missing bodies and renders HTML before plain text and snippets", () => {
  const routeSource = read("../server/routes/mail.routes.ts");
  const serviceSource = read("../server/services/gmail-mail.service.ts");
  const pageSource = read("../client/src/pages/mail-inbox.tsx");

  assert.match(serviceSource, /getImportedWithBodyRepair/);
  assert.match(serviceSource, /needsBodyRepair/);
  assert.match(serviceSource, /repairImportedBody/);
  assert.match(routeSource, /getImportedWithBodyRepair/);
  assert.match(routeSource, /bodyRefreshWarning/);
  assert.match(routeSource, /\/api\/mail\/messages\/:id\/inline-images\/:assetId/);
  assert.match(routeSource, /getInlineImageAsset/);
  assert.match(serviceSource, /gmailMailInlineAssets/);
  assert.match(serviceSource, /rewriteCidImageSources/);
  assert.match(pageSource, /apiRequest\("GET", `\/api\/mail\/messages\/\$\{message\.id\}`\)/);
  assert.match(pageSource, /bodyRefreshWarning/);
  assert.match(pageSource, /selectedImported\.textBody/);
  assert.match(pageSource, /selectedImported\.sanitizedHtmlBody/);
  assert.match(pageSource, /bodyView/);
  assert.match(pageSource, /HTML/);
  assert.match(pageSource, /Plain text/);
  assert.match(pageSource, /Only the Gmail snippet is available/);
  assert.match(pageSource, /selectedImported\.sanitizedHtmlBody && bodyView === "html"/);
});

test("gmail preview distinguishes deleted imported messages from active CRM imports", () => {
  const pageSource = read("../client/src/pages/mail-inbox.tsx");

  assert.match(pageSource, /previewImportBadgeLabel/);
  assert.match(pageSource, /importedStatus === "deleted"/);
  assert.match(pageSource, /Imported then deleted/);
  assert.match(pageSource, /Already archived/);
  assert.match(pageSource, /Already converted/);
  assert.match(pageSource, /Already in CRM/);
  assert.match(pageSource, /disabled=\{!!message\.alreadyImported\}/);
});

test("mail inbox uses friendly API error messages instead of raw thrown payloads", () => {
  const pageSource = read("../client/src/pages/mail-inbox.tsx");

  assert.match(pageSource, /getApiErrorMessage/);
  assert.match(pageSource, /getApiErrorMessage\(error,\s*"preview"\)/);
  assert.match(pageSource, /getApiErrorMessage\(error,\s*"import"\)/);
  assert.match(pageSource, /getApiErrorMessage\(error,\s*"convert"\)/);
  assert.match(pageSource, /getApiErrorMessage\(error,\s*"detail"\)/);
  assert.doesNotMatch(pageSource, /description:\s*error\.message/);
  assert.doesNotMatch(pageSource, /description:\s*error instanceof Error \? error\.message/);
});
