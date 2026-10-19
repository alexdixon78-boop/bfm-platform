/**
 * Regression checks for the Role Permissions save action layout.
 *
 * Run with: npx tsx tests/settings-role-permissions-layout.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const settingsSource = readFileSync(
  new URL("../client/src/pages/settings.tsx", import.meta.url),
  "utf8",
);

function rolePermissionsCardSource(): string {
  const titleIndex = settingsSource.indexOf(">Internal Role Access</CardTitle>");
  assert.notEqual(titleIndex, -1, "Internal Role Access title is missing");

  const cardStart = settingsSource.lastIndexOf("<Card className=", titleIndex);
  assert.notEqual(cardStart, -1, "Internal Role Access card is missing");

  const cardEnd = settingsSource.indexOf("</Card>", titleIndex);
  assert.notEqual(cardEnd, -1, "Internal Role Access card is not closed");

  return settingsSource.slice(cardStart, cardEnd + "</Card>".length);
}

test("Save permissions belongs to the Role Permissions card instead of the page header", () => {
  const cardSource = rolePermissionsCardSource();

  assert.match(cardSource, /data-testid="card-role-permissions"/);
  assert.match(cardSource, /data-testid="button-save-permissions"/);

  const cardStart = settingsSource.indexOf(cardSource);
  const buttonIndex = settingsSource.indexOf('data-testid="button-save-permissions"');
  assert.ok(buttonIndex > cardStart, "Save permissions must render after the Role Permissions card opens");
  assert.ok(
    buttonIndex < cardStart + cardSource.length,
    "Save permissions must render before the Role Permissions card closes",
  );
});

test("Save permissions retains its mutation, disabled state, and pending label", () => {
  const cardSource = rolePermissionsCardSource();
  const buttonTestIdIndex = cardSource.indexOf('data-testid="button-save-permissions"');
  const buttonStart = cardSource.lastIndexOf("<Button", buttonTestIdIndex);
  const buttonEnd = cardSource.indexOf("</Button>", buttonTestIdIndex);

  assert.notEqual(buttonStart, -1, "Save permissions button opening tag is missing");
  assert.notEqual(buttonEnd, -1, "Save permissions button closing tag is missing");

  const buttonSource = cardSource.slice(buttonStart, buttonEnd + "</Button>".length);
  assert.match(buttonSource, /onClick=\{\(\) => saveMutation\.mutate\(changedPermissions\)\}/);
  assert.match(buttonSource, /disabled=\{!hasChanges \|\| saveMutation\.isPending\}/);
  assert.match(buttonSource, /saveMutation\.isPending \? "Saving\.\.\." : "Save permissions"/);
});
