import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { systemEmailCatalog } from "../server/services/system-email-catalog";

test("all existing email service senders have registered system templates", () => {
  const source = readFileSync(new URL("../server/services/email.service.ts", import.meta.url), "utf8");
  assert.equal(systemEmailCatalog.length, 44);
  assert.equal(new Set(systemEmailCatalog.map(item => item.code)).size, 44);
  assert.equal((source.match(/templateCode: "SYSTEM_/g) || []).length, 43);
  assert.deepEqual(systemEmailCatalog.find(item => item.code === "SYSTEM_TEAM_USER_INVITE")?.requiredVariables, ["invite_url"]);
  assert.deepEqual(systemEmailCatalog.find(item => item.code === "SYSTEM_PASSWORD_RESET")?.requiredVariables, ["reset_url"]);
  assert.deepEqual(systemEmailCatalog.find(item => item.code === "SYSTEM_WHATS_APP_CASE_OTP")?.requiredVariables, ["code"]);
  assert.deepEqual(systemEmailCatalog.find(item => item.code === "SYSTEM_CLIENT_DOCUMENT_REQUEST")?.requiredVariables, ["request_url"]);
});
