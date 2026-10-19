/**
 * Source-level regression coverage for authenticated Gmail inline images.
 *
 * Run with: npx tsx tests/gmail-inline-images.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("schema and bootstrap define inline Gmail image asset storage", () => {
  const schemaSource = read("../shared/schema.ts");
  const bootstrapSource = read("../server/db-bootstrap.ts");

  assert.match(schemaSource, /export const gmailMailInlineAssets = pgTable\("gmail_mail_inline_assets"/);
  assert.match(schemaSource, /importedMailId:\s*varchar\("imported_mail_id"\)/);
  assert.match(schemaSource, /contentId:\s*text\("content_id"\)\.notNull\(\)/);
  assert.match(schemaSource, /data:\s*text\("data"\)\.notNull\(\)/);
  assert.match(schemaSource, /uniqueIndex\("gmail_mail_inline_assets_mail_content_idx"\)/);
  assert.match(bootstrapSource, /CREATE TABLE IF NOT EXISTS gmail_mail_inline_assets/);
  assert.match(bootstrapSource, /UNIQUE \(imported_mail_id, content_id\)/);
});

test("mail service stores inline image assets and rewrites cid references to authenticated CRM URLs", () => {
  const serviceSource = read("../server/services/gmail-mail.service.ts");

  assert.match(serviceSource, /inlineImages/);
  assert.match(serviceSource, /extractInlineImage/);
  assert.match(serviceSource, /storeInlineImages/);
  assert.match(serviceSource, /rewriteCidImageSources/);
  assert.match(serviceSource, /\/api\/mail\/messages\/\$\{importedMailId\}\/inline-images\/\$\{asset\.id\}/);
  assert.match(serviceSource, /getInlineImageAsset/);
});

test("mail routes expose an authenticated admin-only inline image endpoint", () => {
  const routeSource = read("../server/routes/mail.routes.ts");

  assert.match(routeSource, /router\.get\("\/api\/mail\/messages\/:id\/inline-images\/:assetId"/);
  assert.match(routeSource, /requireMailAdmin/);
  assert.match(routeSource, /getInlineImageAsset/);
  assert.match(routeSource, /res\.setHeader\("Content-Type", asset\.mimeType\)/);
  assert.match(routeSource, /Buffer\.from\(asset\.data, "base64"\)/);
});
