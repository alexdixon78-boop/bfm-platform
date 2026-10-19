import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

test("template schema stores lifecycle, source guidance, and variable metadata", () => {
  const source = readFileSync(new URL("../shared/schema.ts", import.meta.url), "utf8");
  const table = source.slice(source.indexOf('export const emailTemplates = pgTable("email_templates"'), source.indexOf("export type EmailTemplate ="));
  for (const column of ["kind", "status", "guidance", "variables", "requiredVariables"]) {
    assert.match(table, new RegExp(`${column}:`));
  }
});

test("E1 personalisation repair preserves template copy while replacing only the legacy token", () => {
  const migrationPath = new URL("../migrations/0050_email_template_personalisation_repair.sql", import.meta.url);
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
  const bootstrap = readFileSync(new URL("../server/db-bootstrap.ts", import.meta.url), "utf8");

  for (const source of [migration, bootstrap]) {
    assert.match(source, /personalise_this_to_respond_to_the_client_x27_s_enquiry/);
    assert.match(source, /personalised_response/);
    assert.match(source, /Personalised response/);
    assert.match(source, /WHERE code = 'E1'/);
    assert.match(source, /jsonb_array_elements/);
  }
});
