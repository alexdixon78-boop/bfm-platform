import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("template management and case composer use a shared visual editor", () => {
  const page = readFileSync(new URL("../client/src/pages/email-templates.tsx", import.meta.url), "utf8");
  const composer = readFileSync(new URL("../client/src/components/cases/case-email-composer.tsx", import.meta.url), "utf8");
  const editor = readFileSync(new URL("../client/src/components/email/email-rich-text-editor.tsx", import.meta.url), "utf8");
  assert.match(page, /EmailRichTextEditor/);
  assert.match(composer, /EmailRichTextEditor/);
  assert.match(editor, /EditorContent/);
  assert.match(editor, /insertContent/);
});
